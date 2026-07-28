import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

// Admin panel to create/list/void corrections (declarations → derived ledger). Targets the community's
// current non-CLOSED period; the type selector switches the form. See CorrectionType in the backend.
type Ctx = {
  funds: { code: string; name: string }[]
  billingEntities: { id: string; code: string; name: string }[]
  period: { code: string; status: string } | null
}
const TYPES = ['MANUAL_ADJUSTMENT', 'CREDIT_TRANSFER', 'PENALTY_WRITEOFF', 'PAYMENT_REATTRIB', 'RESHUFFLE'] as const
type Kind = (typeof TYPES)[number]

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CorrectionsPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  const typeLabel = (k: string) => meta?.correctionTypes?.find((m: any) => m.key === k)?.label || k
  const statusMeta = (s: string) => meta?.correctionStatuses?.find((m: any) => m.key === s)

  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN' || activeRole?.role === 'SYSTEM_ADMIN'

  const [rows, setRows] = React.useState<any[]>([])
  const [ctx, setCtx] = React.useState<Ctx | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const [type, setType] = React.useState<Kind>('MANUAL_ADJUSTMENT')
  const [f, setF] = React.useState<any>({ billingEntityId: '', fundCode: '', amount: '', fromFund: '', toFund: '', note: '' })
  const [perBe, setPerBe] = React.useState<Record<string, string>>({})

  const load = React.useCallback(() => {
    if (!communityId) return
    setLoading(true)
    Promise.all([
      api.get<any[]>(`/communities/${communityId}/corrections`),
      api.get<Ctx>(`/communities/${communityId}/corrections/context`),
    ])
      .then(([list, c]: [any[], Ctx]) => { setRows(list || []); setCtx(c) })
      .catch((e: any) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [api, communityId])

  React.useEffect(() => { load() }, [load])

  const reshuffleNet = Object.values(perBe).reduce((s, v) => s + (Number(v) || 0), 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy('create'); setError(null)
    try {
      const body: any = { type, note: f.note || undefined }
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
      setF({ billingEntityId: '', fundCode: '', amount: '', fromFund: '', toFund: '', note: '' }); setPerBe({}); setShowForm(false)
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function voidCorrection(id: string) {
    setBusy(id); setError(null)
    try { await api.post(`/communities/${communityId}/corrections/${id}/void`, {}); load() }
    catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  if (loading) return <div className="empty">{t('common.loading', 'Se încarcă…')}</div>

  const funds = ctx?.funds ?? []
  const bes = ctx?.billingEntities ?? []
  const period = ctx?.period ?? null
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
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>{t('corr.title', 'Corecții')}</h4>
        <div className="muted">
          {period
            ? `${t('corr.targets', 'Se aplică pe perioada')}: ${period.code} (${period.status})`
            : t('corr.noPeriod', 'Nicio perioadă deschisă')}
        </div>
        {isAdmin && period && (
          <button className="btn primary small" type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t('common.cancel', 'Anulează') : `+ ${t('corr.new', 'Corecție nouă')}`}
          </button>
        )}
      </div>

      {error && <div className="badge negative">{error}</div>}

      {isAdmin && showForm && period && (
        <form className="card soft stack" style={{ gap: 8 }} onSubmit={submit}>
          <label className="label"><span>{t('corr.type', 'Tip')}</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as Kind)}>
              {TYPES.map((k) => <option key={k} value={k}>{typeLabel(k)}</option>)}
            </select>
          </label>

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
              <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>PENALIZARI</span>
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
                  {t('corr.net', 'Net')}: <b style={{ fontVariantNumeric: 'tabular-nums', color: Math.abs(reshuffleNet) < 0.5 ? 'var(--good,#16a34a)' : 'var(--danger,#dc2626)' }}>{money(reshuffleNet)}</b>
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
          <button className="btn primary small" type="submit" disabled={busy === 'create'} style={{ alignSelf: 'flex-start' }}>
            {t('common.confirm', 'Adaugă')}
          </button>
        </form>
      )}

      {!rows.length ? (
        <div className="empty">{t('corr.none', 'Nicio corecție.')}</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ padding: '8px 10px' }}>{t('corr.type', 'Tip')}</th>
                <th style={{ padding: '8px 10px' }}>{t('corr.entity', 'Unitate / fond')}</th>
                <th style={{ padding: '8px 10px' }}>{t('corr.period', 'Perioadă')}</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>{t('corr.amount', 'Sumă')}</th>
                <th style={{ padding: '8px 10px' }}>{t('corr.status', 'Stare')}</th>
                <th style={{ padding: '8px 10px' }}></th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border, #eee)', opacity: r.status === 'VOID' ? 0.55 : 1 }}>
                  <td style={{ padding: '6px 10px' }}>{typeLabel(r.type)}</td>
                  <td style={{ padding: '6px 10px' }}>
                    {r.type === 'RESHUFFLE'
                      ? `${Object.keys(r.payload?.perBe || {}).length} unități · ${r.fundCode || ''}`
                      : `${r.billingEntity?.name || r.billingEntity?.code || '—'}${r.fundCode ? ' · ' + r.fundCode : ''}`}
                    {r.note ? <div className="muted" style={{ fontSize: 11 }}>{r.note}</div> : null}
                  </td>
                  <td style={{ padding: '6px 10px' }}>{r.periodCode}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{r.amount != null ? money(r.amount) : (r.type === 'RESHUFFLE' ? '—' : '')}</td>
                  <td style={{ padding: '6px 10px' }}><span className={`badge ${statusMeta(r.status)?.tone || 'secondary'}`}>{statusMeta(r.status)?.label || r.status}</span></td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                    {isAdmin && r.status === 'ACTIVE' && (
                      <button className="btn ghost small" type="button" disabled={busy === r.id} onClick={() => voidCorrection(r.id)}>{t('corr.void', 'Anulează')}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
