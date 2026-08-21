import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

// Admin panel to create/list/void corrections (declarations → derived ledger). Targets the community's
// current non-CLOSED period; the type selector switches the form. See CorrectionType in the backend.
type Ctx = {
  funds: { code: string; name: string }[]
  billingEntities: { id: string; code: string; name: string }[]
  expenseTypes: { code: string; name: string }[]
  period: { code: string; status: string } | null
  periods: { code: string; status: string }[]
}
const TYPES = ['MANUAL_ADJUSTMENT', 'CREDIT_TRANSFER', 'PENALTY_WRITEOFF', 'PAYMENT_REATTRIB', 'RESHUFFLE'] as const
type Kind = (typeof TYPES)[number]

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CorrectionsPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT, lang } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  // Metadata entries carry both `label` (RO) and `labelEn` — pick per the active UI language, RO as fallback.
  const localized = (m: any) => (m ? (lang === 'en' ? m.labelEn || m.label : m.label) : null)
  const localizedHint = (m: any) => (m ? (lang === 'en' ? m.hintEn || m.hint : m.hint) : null)
  // RESHUFFLE_TRUEUP is a display-only pseudo-key (see enums-meta.ts) — never a real `type` value, only
  // used to look up the "Regularizare" label/hint when a RESHUFFLE row's net amount isn't rounding-sized.
  const typeMeta = (k: string) => meta?.correctionTypes?.find((m: any) => m.key === k)
  const typeLabel = (k: string) => localized(typeMeta(k)) || k
  const statusMeta = (s: string) => meta?.correctionStatuses?.find((m: any) => m.key === s)
  const statusLabel = (s: string) => localized(statusMeta(s)) || s

  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN' || activeRole?.role === 'SYSTEM_ADMIN'

  const [rows, setRows] = React.useState<any[]>([])
  const [ctx, setCtx] = React.useState<Ctx | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const [type, setType] = React.useState<Kind>('MANUAL_ADJUSTMENT')
  const [f, setF] = React.useState<any>({ billingEntityId: '', fundCode: '', expenseTypeCode: '', amount: '', fromFund: '', toFund: '', note: '' })
  const [perBe, setPerBe] = React.useState<Record<string, string>>({})
  const [filterPeriod, setFilterPeriod] = React.useState('') // '' = all periods; client-side, options built from the loaded rows
  const [filterStatus, setFilterStatus] = React.useState('') // '' = all statuses; same
  const [openFilter, setOpenFilter] = React.useState<'period' | 'status' | null>(null) // which header filter picker is expanded
  const [asTodo, setAsTodo] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null) // set while editing (void old + create new)
  const [sortKey, setSortKey] = React.useState<'type' | 'period' | 'amount' | 'status' | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [impact, setImpact] = React.useState<{ row: any; data: any | null } | null>(null)
  const [showGlossary, setShowGlossary] = React.useState(false)

  const openImpact = (row: any) => {
    setImpact({ row, data: null })
    api.get<any>(`/communities/${communityId}/corrections/${row.id}/ledger`)
      .then((d: any) => setImpact((cur) => (cur && cur.row.id === row.id ? { ...cur, data: d } : cur)))
      .catch(() => setImpact((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  // Always fetch the full, unfiltered set — filtering happens client-side so the filter pickers can be
  // built from what's actually there (no options for periods/statuses that have zero corrections).
  const loadList = React.useCallback(() => {
    if (!communityId) return
    api.get<any[]>(`/communities/${communityId}/corrections`)
      .then((l: any[]) => setRows(l || []))
      .catch((e: any) => setError(e?.message || 'Failed to load'))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    Promise.all([
      api.get<Ctx>(`/communities/${communityId}/corrections/context`).then((c: Ctx) => setCtx(c)),
      api.get<any[]>(`/communities/${communityId}/corrections`).then((l: any[]) => setRows(l || [])),
    ])
      .catch((e: any) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [api, communityId])

  const reshuffleNet = Object.values(perBe).reduce((s, v) => s + (Number(v) || 0), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create'); setError(null)
    try {
      const body: any = { type, note: f.note || undefined, status: willBeTodo ? 'TODO' : undefined, expenseTypeCode: f.expenseTypeCode || undefined }
      if (type === 'RESHUFFLE') {
        body.fundCode = f.fundCode
        body.perBe = Object.fromEntries(Object.entries(perBe).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v as number) && Math.abs(v as number) >= 0.005))
      } else {
        body.amount = f.amount ? Number(f.amount) : undefined
        if (type !== 'PENALTY_WRITEOFF') body.billingEntityId = f.billingEntityId
        else body.billingEntityId = f.billingEntityId
        if (type === 'MANUAL_ADJUSTMENT' || type === 'CREDIT_TRANSFER') body.fundCode = f.fundCode
        if (type === 'PAYMENT_REATTRIB') { body.fromFund = f.fromFund; body.toFund = f.toFund }
      }
      await api.post(`/communities/${communityId}/corrections`, body)
      // Editing = declare the corrected version, then retire the original — never mutate a
      // declaration in place, so the audit trail (old, voided) stays intact.
      if (editingId) await api.post(`/communities/${communityId}/corrections/${editingId}/void`, {})
      cancelForm()
      loadList()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function voidCorrection(id: string) {
    setBusy(id); setError(null)
    try { await api.post(`/communities/${communityId}/corrections/${id}/void`, {}); loadList() }
    catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function voidFromEditor() {
    if (!editingId) return
    await voidCorrection(editingId)
    cancelForm()
  }

  function cancelForm() {
    setShowForm(false); setEditingId(null); setAsTodo(false)
    setF({ billingEntityId: '', fundCode: '', expenseTypeCode: '', amount: '', fromFund: '', toFund: '', note: '' }); setPerBe({})
  }

  function startEdit(row: any) {
    setType(row.type)
    setAsTodo(row.status === 'TODO')
    setEditingId(row.id)
    if (row.type === 'RESHUFFLE') {
      setF((s: any) => ({ ...s, fundCode: row.fundCode || '', expenseTypeCode: row.expenseTypeCode || '', note: row.note || '' }))
      setPerBe(Object.fromEntries(Object.entries(row.payload?.perBe || {}).map(([k, v]) => [k, String(v)])))
    } else {
      setF({
        billingEntityId: row.billingEntity?.id || '',
        fundCode: row.fundCode || '',
        expenseTypeCode: row.expenseTypeCode || '',
        amount: row.amount != null ? String(row.amount) : '',
        fromFund: row.payload?.fromFund || '',
        toFund: row.payload?.toFund || '',
        note: row.note || '',
      })
      setPerBe({})
    }
    setShowForm(true)
  }

  function toggleSort(k: 'type' | 'period' | 'amount' | 'status') {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }
  const sortArrow = (k: string) => (sortKey !== k ? '↕' : sortDir === 'asc' ? '↑' : '↓')
  // Minimal funnel glyph, same visual weight as the sort arrows — fills with the accent color once a
  // filter is actually applied, so an active filter reads at a glance without a permanent select box.
  const FilterIcon = ({ active }: { active: boolean }) => (
    <svg width="11" height="11" viewBox="0 0 16 16" style={{ display: 'block' }}>
      <path d="M2.5 3h11l-4.25 5.2V13l-2.5 1.3V8.2L2.5 3z"
        stroke={active ? 'var(--accent)' : 'var(--muted)'} strokeWidth="1.3" strokeLinejoin="round"
        fill={active ? 'var(--accent-soft)' : 'none'} />
    </svg>
  )

  if (loading) return <div className="empty">{t('common.loading', 'Se încarcă…')}</div>

  const funds = ctx?.funds ?? []
  const bes = ctx?.billingEntities ?? []
  const expenseTypes = ctx?.expenseTypes ?? []
  const period = ctx?.period ?? null
  const forceTodo = !period // no open period → the only option is an unattached TODO correction
  const willBeTodo = forceTodo || asTodo

  const fundName = (code: string | null | undefined) => (code ? funds.find((fu) => fu.code === code)?.name || code : '')
  // Some notes are written bilingually as "...RO: <romanian>\n\nEN: <english>..." (a convention, not a
  // schema field — corrections have one free-text note). Show only the half matching the active UI
  // language when that pattern is present; otherwise the note is single-language already, show it as-is.
  const localizedNote = (note: string | null | undefined): string => {
    if (!note) return ''
    const ro = note.match(/RO:\s*([\s\S]*?)(?=\n\s*EN:|$)/)
    const en = note.match(/EN:\s*([\s\S]*)/)
    if (ro && en) return (lang === 'en' ? en[1] : ro[1]).trim()
    return note
  }
  const expenseTypeName = (code: string | null | undefined) => (code ? expenseTypes.find((et) => et.code === code)?.name || code : null)
  // The one-liner shown in the table row — full detail (note, ledger legs) lives in the Impact popup only.
  const rowAmount = (r: any): number | null => {
    if (r.amount != null) return r.amount
    if (r.type === 'RESHUFFLE') return Object.values(r.payload?.perBe || {}).reduce((s: number, v: any) => s + Number(v), 0)
    return null
  }
  // RESHUFFLE covers two real-world cases sharing one mechanism: a true redistribution (net ≈ 0, small
  // differences are rounding) vs. a true-up of an estimate against the real amount (net is a real sum).
  // Display-only split — `type` sent to/received from the backend is always RESHUFFLE either way.
  const REDISTRIBUTION_THRESHOLD = 10 // lei — below this, a RESHUFFLE's net total reads as rounding noise
  const displayTypeKey = (r: any): string =>
    r.type === 'RESHUFFLE' && Math.abs(rowAmount(r) ?? 0) >= REDISTRIBUTION_THRESHOLD ? 'RESHUFFLE_TRUEUP' : r.type
  const summarize = (r: any): string => {
    const be = r.billingEntity?.name || r.billingEntity?.code
    // A named service (e.g. Comision Bancă) is more specific than the fund it lands on — call it out
    // when the correction is tied to one, falling back to the fund name otherwise.
    const service = expenseTypeName(r.expenseTypeCode)
    switch (r.type) {
      case 'RESHUFFLE': {
        const n = Object.keys(r.payload?.perBe || {}).length
        return `${n} ${t('corr.units', 'unități')} · ${service || fundName(r.fundCode)}`
      }
      case 'PAYMENT_REATTRIB':
        return `${be || '—'} · ${fundName(r.payload?.fromFund)} → ${fundName(r.payload?.toFund)}`
      case 'PENALTY_WRITEOFF':
        return `${be || '—'} · ${t('corr.penalties', 'Penalizări')}`
      case 'CREDIT_TRANSFER':
        return `${be || '—'} · ${service || fundName(r.fundCode)} (${t('corr.credit', 'credit')})`
      default:
        return `${be || '—'}${service || r.fundCode ? ' · ' + (service || fundName(r.fundCode)) : ''}`
    }
  }

  // Filter pickers are built from the data itself — only periods/statuses that at least one loaded
  // correction actually has, never the full static list of every period/status that could exist.
  const UNATTACHED = '__unattached__'
  const periodOptions = Array.from(new Set(rows.map((r) => r.periodCode || UNATTACHED)))
    .sort((a, b) => (a === UNATTACHED ? -1 : b === UNATTACHED ? 1 : b.localeCompare(a)))
  const statusOrder = (meta?.correctionStatuses ?? []).map((m: any) => m.key)
  const statusOptions = Array.from(new Set(rows.map((r) => r.status)))
    .sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b))
  const periodFilterLabel = (code: string) => (code === UNATTACHED ? t('corr.unattached', 'Neatribuit') : code)
  const filterActive = { period: !!filterPeriod, status: !!filterStatus }

  const filteredRows = rows.filter((r) => {
    if (filterPeriod && (r.periodCode || UNATTACHED) !== filterPeriod) return false
    if (filterStatus && r.status !== filterStatus) return false
    return true
  })

  // Client-side sort (rows are already fully fetched, not paginated; cheap to recompute per render —
  // no memo needed, which also avoids calling a hook after the `loading` early return above).
  // Unsorted default keeps the backend's own ordering — TODO/unattached rows first, then most recent period.
  const sortVal = (r: any): any => {
    if (sortKey === 'type') return typeLabel(displayTypeKey(r))
    if (sortKey === 'period') return r.periodCode || ''
    if (sortKey === 'amount') return rowAmount(r) ?? -Infinity
    if (sortKey === 'status') return statusLabel(r.status)
    return ''
  }
  const displayRows = !sortKey ? filteredRows : [...filteredRows].sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b)
    const mul = sortDir === 'asc' ? 1 : -1
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * mul
  })

  const beLabel = (b: { code: string; name: string }) => `${b.name || b.code}`
  const beSelect = (val: string, on: (v: string) => void) => (
    <select className="input" value={val} onChange={(e) => on(e.target.value)} required>
      <option value="">{t('corr.pickBe', '— unitate —')}</option>
      {bes.map((b) => <option key={b.id} value={b.id}>{beLabel(b)}</option>)}
    </select>
  )
  const fundSelect = (val: string, on: (v: string) => void) => (
    <select className="input" value={val} onChange={(e) => on(e.target.value)} required>
      <option value="">{t('corr.pickFund', '— fond —')}</option>
      {funds.map((fu) => <option key={fu.code} value={fu.code}>{fu.name || fu.code}</option>)}
    </select>
  )

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>{t('corr.title', 'Corecții')}</h4>
        <div className="muted" style={{ fontSize: 13 }}>
          {period
            ? `${t('corr.targets', 'Corecțiile noi se aplică pe')}: ${period.code} (${period.status})`
            : t('corr.noPeriod', 'Nicio perioadă deschisă pentru corecții noi')}
        </div>
        {isAdmin && (
          <button className="btn primary small" type="button" onClick={() => (showForm ? cancelForm() : setShowForm(true))}>
            {showForm ? t('common.cancel', 'Anulează') : (forceTodo ? t('corr.newUnattached', '+ Corecție nouă neatribuită') : `+ ${t('corr.new', 'Corecție nouă')}`)}
          </button>
        )}
      </div>

      {error && <div className="badge negative">{error}</div>}

      {isAdmin && showForm && (
        <form className="card stack" style={{ gap: 10 }} onSubmit={submit}>
          {editingId && <div style={{ fontWeight: 600, fontSize: 14 }}>{t('corr.editing', 'Editează corecția')}</div>}
          {forceTodo ? (
            <div className="muted" style={{ fontSize: 12 }}>{t('corr.noPeriod', 'Nicio perioadă deschisă pentru corecții noi')} — {t('corr.todoNote', 'Nu se aplică pe nicio perioadă până când un admin o atribuie ulterior.')}</div>
          ) : (
            <label className="row" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={asTodo} onChange={(e) => setAsTodo(e.target.checked)} />
              <span>{t('corr.saveTodo', 'Salvează ca neatribuită (TODO)')}</span>
            </label>
          )}
          {willBeTodo && !forceTodo && <div className="muted" style={{ fontSize: 12 }}>{t('corr.todoNote', 'Nu se aplică pe nicio perioadă până când un admin o atribuie ulterior.')}</div>}
          <label className="label"><span>{t('corr.type', 'Tip')}</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as Kind)}>
              {TYPES.map((k) => <option key={k} value={k}>{typeLabel(k)}</option>)}
            </select>
          </label>
          {expenseTypes.length > 0 && (
            <label className="label"><span>{t('corr.service', 'Serviciu (opțional)')}</span>
              <select className="input" value={f.expenseTypeCode} onChange={(e) => setF((s: any) => ({ ...s, expenseTypeCode: e.target.value }))}>
                <option value="">{t('corr.noService', '— niciunul —')}</option>
                {expenseTypes.map((et) => <option key={et.code} value={et.code}>{et.name}</option>)}
              </select>
            </label>
          )}

          {(type === 'MANUAL_ADJUSTMENT' || type === 'CREDIT_TRANSFER') && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {beSelect(f.billingEntityId, (v) => setF((s: any) => ({ ...s, billingEntityId: v })))}
              {fundSelect(f.fundCode, (v) => setF((s: any) => ({ ...s, fundCode: v })))}
              <input className="input" type="number" step="0.01" style={{ width: 140 }}
                placeholder={type === 'MANUAL_ADJUSTMENT' ? t('corr.amountSigned', 'Sumă (±)') : t('corr.amount', 'Sumă')}
                value={f.amount} onChange={(e) => setF((s: any) => ({ ...s, amount: e.target.value }))} required />
            </div>
          )}
          {type === 'PENALTY_WRITEOFF' && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {beSelect(f.billingEntityId, (v) => setF((s: any) => ({ ...s, billingEntityId: v })))}
              <input className="input" type="number" step="0.01" style={{ width: 140 }} placeholder={t('corr.amount', 'Sumă')}
                value={f.amount} onChange={(e) => setF((s: any) => ({ ...s, amount: e.target.value }))} required />
              <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>{t('corr.penalties', 'PENALIZARI')}</span>
            </div>
          )}
          {type === 'PAYMENT_REATTRIB' && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {beSelect(f.billingEntityId, (v) => setF((s: any) => ({ ...s, billingEntityId: v })))}
              {fundSelect(f.fromFund, (v) => setF((s: any) => ({ ...s, fromFund: v })))}
              <span className="muted" style={{ alignSelf: 'center' }}>→</span>
              {fundSelect(f.toFund, (v) => setF((s: any) => ({ ...s, toFund: v })))}
              <input className="input" type="number" step="0.01" style={{ width: 140 }} placeholder={t('corr.amount', 'Sumă')}
                value={f.amount} onChange={(e) => setF((s: any) => ({ ...s, amount: e.target.value }))} required />
            </div>
          )}
          {type === 'RESHUFFLE' && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {fundSelect(f.fundCode, (v) => setF((s: any) => ({ ...s, fundCode: v })))}
                <span className="muted" style={{ fontSize: 12 }}>
                  {t('corr.net', 'Net')}: <b style={{ fontVariantNumeric: 'tabular-nums', color: Math.abs(reshuffleNet) < 0.5 ? 'var(--success)' : 'var(--danger)' }}>{money(reshuffleNet)}</b>
                </span>
              </div>
              <div className="card" style={{ maxHeight: 240, overflowY: 'auto', padding: 8 }}>
                {bes.map((b) => (
                  <div key={b.id} className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13 }}>{beLabel(b)}</span>
                    <input className="input" type="number" step="0.01" style={{ width: 120 }} placeholder="0"
                      value={perBe[b.id] ?? ''} onChange={(e) => setPerBe((s) => ({ ...s, [b.id]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <input className="input" placeholder={t('corr.note', 'Notă (motiv, referință)')}
            value={f.note} onChange={(e) => setF((s: any) => ({ ...s, note: e.target.value }))} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary small" type="submit" disabled={busy === 'create'}>
              {t('common.confirm', 'Adaugă')}
            </button>
            {editingId && (
              <button className="btn ghost small" type="button" disabled={busy === editingId} onClick={voidFromEditor} style={{ color: 'var(--danger)' }}>
                {t('corr.voidCorrection', 'Anulează corecția')}
              </button>
            )}
          </div>
        </form>
      )}

      {!rows.length ? (
        <div className="empty">{t('corr.none', 'Nicio corecție.')}</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'var(--bg)' }}>
                <th style={{ padding: '10px 12px' }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center', userSelect: 'none' }}>
                    <span onClick={() => toggleSort('type')} style={{ cursor: 'pointer' }}>{t('corr.type', 'Tip')}</span>
                    <span onClick={() => toggleSort('type')} className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>{sortArrow('type')}</span>
                    <button type="button" onClick={() => setShowGlossary(true)}
                      className="muted" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '50%', width: 16, height: 16, fontSize: 10, lineHeight: 1, cursor: 'pointer', padding: 0 }}
                      title={t('corr.glossary', 'Tipuri de corecții')}>?</button>
                  </div>
                </th>
                <th style={{ padding: '10px 12px' }}>{t('corr.entity', 'Descriere')}</th>
                <th style={{ padding: '10px 12px', position: 'relative' }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center', userSelect: 'none' }}>
                    <span onClick={() => toggleSort('period')} style={{ cursor: 'pointer' }}>{t('corr.period', 'Perioadă')}</span>
                    <span onClick={() => toggleSort('period')} className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>{sortArrow('period')}</span>
                    {periodOptions.length > 1 && (
                      <button type="button" onClick={() => setOpenFilter((o) => (o === 'period' ? null : 'period'))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}
                        title={t('corr.filterBy', 'Filtrează')}>
                        <FilterIcon active={filterActive.period} />
                      </button>
                    )}
                  </div>
                  {openFilter === 'period' && (
                    <select className="input" autoFocus value={filterPeriod}
                      onChange={(e) => { setFilterPeriod(e.target.value); setOpenFilter(null) }}
                      onBlur={() => setOpenFilter(null)}
                      style={{ position: 'absolute', top: '100%', left: 12, marginTop: 4, fontSize: 12, padding: '5px 7px', zIndex: 5, width: 170, fontWeight: 400 }}>
                      <option value="">{t('corr.allPeriods', 'Toate')}</option>
                      {periodOptions.map((code) => <option key={code} value={code}>{periodFilterLabel(code)}</option>)}
                    </select>
                  )}
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('amount')}>
                  {t('corr.amount', 'Sumă')} <span className="muted" style={{ fontSize: 11 }}>{sortArrow('amount')}</span>
                </th>
                <th style={{ padding: '10px 12px', position: 'relative' }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center', userSelect: 'none' }}>
                    <span onClick={() => toggleSort('status')} style={{ cursor: 'pointer' }}>{t('corr.status', 'Stare')}</span>
                    <span onClick={() => toggleSort('status')} className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>{sortArrow('status')}</span>
                    {statusOptions.length > 1 && (
                      <button type="button" onClick={() => setOpenFilter((o) => (o === 'status' ? null : 'status'))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}
                        title={t('corr.filterBy', 'Filtrează')}>
                        <FilterIcon active={filterActive.status} />
                      </button>
                    )}
                  </div>
                  {openFilter === 'status' && (
                    <select className="input" autoFocus value={filterStatus}
                      onChange={(e) => { setFilterStatus(e.target.value); setOpenFilter(null) }}
                      onBlur={() => setOpenFilter(null)}
                      style={{ position: 'absolute', top: '100%', left: 12, marginTop: 4, fontSize: 12, padding: '5px 7px', zIndex: 5, width: 150, fontWeight: 400 }}>
                      <option value="">{t('corr.allStatuses', 'Toate')}</option>
                      {statusOptions.map((key) => <option key={key} value={key}>{localized(statusMeta(key))}</option>)}
                    </select>
                  )}
                </th>
                <th style={{ padding: '10px 12px' }}>{t('corr.actions', 'Acțiuni')}</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {!displayRows.length && (
                <tr><td colSpan={6} className="empty">{t('corr.noneFiltered', 'Nicio corecție corespunde filtrelor.')}</td></tr>
              )}
              {displayRows.map((r) => (
                <tr key={r.id} onClick={() => openImpact(r)}
                  style={{ borderTop: '1px solid var(--divider)', opacity: r.status === 'VOID' ? 0.5 : 1, cursor: 'pointer' }}>
                  <td style={{ padding: '10px 12px' }} title={localizedHint(typeMeta(displayTypeKey(r)))}>{typeLabel(displayTypeKey(r))}</td>
                  <td style={{ padding: '10px 12px' }}>{summarize(r)}</td>
                  <td style={{ padding: '10px 12px' }}>{r.periodCode || <span className="muted">{t('corr.unattached', 'Neatribuit')}</span>}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(rowAmount(r))}</td>
                  <td style={{ padding: '10px 12px' }}><span className={`badge ${statusMeta(r.status)?.tone || 'secondary'}`} title={lang === 'en' ? statusMeta(r.status)?.hintEn : statusMeta(r.status)?.hint}>{statusLabel(r.status)}</span></td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (r.status === 'ACTIVE' || r.status === 'TODO') && (
                      <button className="btn ghost small" type="button" disabled={busy === r.id} onClick={() => startEdit(r)}>{t('corr.edit', 'Editează')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {impact && (
        <div className="scope-drawer-overlay" onClick={() => setImpact(null)}>
          <div className="scope-drawer-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="scope-drawer-header" style={{ flex: '0 0 auto' }}>
              <span>{typeLabel(displayTypeKey(impact.row))}</span>
              <button className="btn ghost small" type="button" onClick={() => setImpact(null)}>{t('common.close', 'Închide')}</button>
            </div>
            <div style={{ fontSize: 13, flex: '0 0 auto' }}>{localizedHint(typeMeta(displayTypeKey(impact.row)))}</div>
            <div className="muted" style={{ fontSize: 13, flex: '0 0 auto' }}>{summarize(impact.row)}</div>
            <div className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>
              {impact.row.periodCode || t('corr.unattached', 'Neatribuit')} · {impact.row.reason}
            </div>

            {impact.row.note && (
              <div className="card" style={{ background: 'var(--bg)', boxShadow: 'none', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 110, overflowY: 'auto', flex: '0 0 auto' }}>
                {localizedNote(impact.row.note)}
              </div>
            )}

            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', marginTop: 4 }}>
            {!impact.data ? (
              <div className="empty">{t('common.loading', 'Se încarcă…')}</div>
            ) : impact.data.error ? (
              <div className="empty">{t('common.error', 'Eroare')}</div>
            ) : !impact.data.legs?.length ? (
              impact.row.payload?.perBe ? (
                // Not attached to a period yet (e.g. status TODO) — nothing derived into the ledger, but the
                // declared per-unit split is already known. Show it as a preview so "where did the 27 units
                // go?" has an answer even before this correction is ever applied.
                <>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    {t('corr.previewOnly', 'Previzualizare — corecția nu a fost încă aplicată pe nicio perioadă.')}
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead><tr style={{ textAlign: 'left', background: 'var(--bg)', position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px 10px' }}>{t('corr.entity', 'Unitate')}</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('corr.amount', 'Sumă')}</th>
                      </tr></thead>
                      <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {Object.entries(impact.row.payload.perBe).map(([beId, amt]: [string, any]) => (
                          <tr key={beId} style={{ borderTop: '1px solid var(--divider)' }}>
                            <td style={{ padding: '7px 10px' }}>{bes.find((b) => b.id === beId)?.name || beId}</td>
                            <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(Number(amt))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="empty">{t('corr.noLegs', 'Nicio linie de registru găsită.')}</div>
              )
            ) : (
              <>
                <div style={{ fontSize: 12 }}>
                  <span className={`badge ${impact.data.linked ? 'tertiary' : 'secondary'}`}>
                    {impact.data.linked ? t('corr.linked', 'Legături directe') : t('corr.matched', 'Potrivite după perioadă/motiv')}
                  </span>
                  <span style={{ marginLeft: 8 }}>{impact.data.legs.length} {t('corr.legs', 'linii')} · {t('corr.total', 'Total')}: <strong>{money(impact.data.total)}</strong></span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', background: 'var(--bg)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '8px 10px' }}>{t('corr.period', 'Perioadă')}</th>
                      <th style={{ padding: '8px 10px' }}>{t('corr.entity', 'Unitate')}</th>
                      <th style={{ padding: '8px 10px' }}>{t('corr.fund', 'Fond')}</th>
                      <th style={{ padding: '8px 10px' }}>{t('corr.kind', 'Fel')}</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('corr.amount', 'Sumă')}</th>
                    </tr></thead>
                    <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {impact.data.legs.map((l: any, i: number) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--divider)' }}>
                          <td style={{ padding: '7px 10px' }}>{l.period}</td>
                          <td style={{ padding: '7px 10px' }}>{l.bename || l.becode || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{l.fund || '—'}</td>
                          <td style={{ padding: '7px 10px' }}>{l.kind}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'right' }}>{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            </div>
          </div>
        </div>
      )}

      {showGlossary && (
        <div className="scope-drawer-overlay" onClick={() => setShowGlossary(false)}>
          <div className="scope-drawer-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '85vh', overflow: 'auto' }}>
            <div className="scope-drawer-header">
              <span>{t('corr.glossary', 'Tipuri de corecții')}</span>
              <button className="btn ghost small" type="button" onClick={() => setShowGlossary(false)}>{t('common.close', 'Închide')}</button>
            </div>
            <div className="stack" style={{ gap: 12 }}>
              {(meta?.correctionTypes ?? []).map((m: any) => (
                <div key={m.key}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{localized(m)}</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{localizedHint(m)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
