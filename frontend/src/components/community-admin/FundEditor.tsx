import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

// #17 Fund configurator — create a new fund or edit the selected one, over the existing
// fund.controller endpoints (POST /funds, PATCH /funds/:id). Allocation is stored as JSON on the
// fund; we edit the fields owners care about (domain/type, method, short name, penalty rate) and
// merge them over the existing allocation so unrelated keys (split, targets, eur…) survive.
type Fund = {
  id?: string; code?: string; name?: string; description?: string | null; status?: string
  currency?: string; totalTarget?: number | null; startPeriodCode?: string | null; allocation?: any
}
type PeriodRow = { code: string; seq: number }

const STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED']

export function FundEditor({ communityCode, fund, onSaved }: { communityCode: string; fund: Fund | null; onSaved?: () => void | Promise<void> }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  const domains = meta?.fundDomains ?? []

  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<'create' | 'edit'>('create')
  const [periods, setPeriods] = React.useState<PeriodRow[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)

  const [form, setForm] = React.useState({
    code: '', name: '', description: '', status: 'PLANNED', currency: 'RON',
    totalTarget: '', startPeriodCode: '', type: '', method: '', shortName: '', penaltyPerDayPct: '',
  })
  const set = (patch: Partial<typeof form>) => setForm((s) => ({ ...s, ...patch }))

  React.useEffect(() => {
    if (!communityCode) return
    api.get<PeriodRow[]>(`/communities/${communityCode}/periods`)
      .then((rows: PeriodRow[]) => setPeriods([...(rows || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))))
      .catch(() => {})
  }, [api, communityCode])

  const loadForEdit = React.useCallback((f: Fund) => {
    const a = f.allocation || {}
    setForm({
      code: f.code || '', name: f.name || '', description: f.description || '', status: f.status || 'PLANNED',
      currency: f.currency || 'RON', totalTarget: f.totalTarget != null ? String(f.totalTarget) : '',
      startPeriodCode: f.startPeriodCode || '', type: a.type || '', method: a.method || '',
      shortName: a.shortName || '', penaltyPerDayPct: a.penaltyPerDayPct != null ? String(a.penaltyPerDayPct) : '',
    })
  }, [])

  const startEdit = () => { if (fund) { setMode('edit'); loadForEdit(fund); setOpen(true); setError(null); setMsg(null) } }
  const startCreate = () => {
    setMode('create'); setOpen(true); setError(null); setMsg(null)
    setForm({ code: '', name: '', description: '', status: 'PLANNED', currency: 'RON', totalTarget: '', startPeriodCode: '', type: '', method: '', shortName: '', penaltyPerDayPct: '' })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || (mode === 'create' && !form.code.trim())) { setError(t('fundEdit.needCodeName', 'Codul și numele sunt obligatorii')); return }
    setBusy(true); setError(null); setMsg(null)
    // merge allocation over the existing one (edit) so unrelated keys survive
    const baseAlloc = mode === 'edit' ? (fund?.allocation || {}) : {}
    const allocation: any = { ...baseAlloc }
    if (form.type) allocation.type = form.type
    if (form.method) allocation.method = form.method
    if (form.shortName) allocation.shortName = form.shortName
    if (form.penaltyPerDayPct !== '') allocation.penaltyPerDayPct = Number(form.penaltyPerDayPct)
    const body: any = {
      name: form.name.trim(),
      description: form.description || null,
      status: form.status,
      currency: form.currency || 'RON',
      totalTarget: form.totalTarget !== '' ? Number(form.totalTarget) : null,
      startPeriodCode: form.startPeriodCode || null,
      allocation: Object.keys(allocation).length ? allocation : null,
    }
    try {
      if (mode === 'create') {
        body.code = form.code.trim()
        await api.post(`/communities/${communityCode}/funds`, body)
      } else {
        await api.patch(`/communities/${communityCode}/funds/${encodeURIComponent(fund!.id || fund!.code || '')}`, body)
      }
      setMsg(t('common.save', 'Salvat')); setOpen(false)
      await onSaved?.()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  return (
    <div className="card soft">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{t('fundEdit.title', 'Configurare fonduri')}</strong>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          {msg && <span className="badge positive">{msg}</span>}
          {fund && <button type="button" className="btn ghost small" onClick={startEdit}>{t('fundEdit.edit', 'Editează fondul selectat')}</button>}
          <button type="button" className="btn primary small" onClick={startCreate}>{t('fundEdit.new', 'Fond nou')}</button>
        </div>
      </div>

      {open && (
        <form className="stack" style={{ gap: 8, marginTop: 10 }} onSubmit={save}>
          {error && <div className="badge negative">{error}</div>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 160 }} placeholder={t('fundEdit.code', 'Cod')} value={form.code} disabled={mode === 'edit'} onChange={(e) => set({ code: e.target.value })} required />
            <input className="input" style={{ minWidth: 220 }} placeholder={t('fundEdit.name', 'Nume')} value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            <select className="input" value={form.status} onChange={(e) => set({ status: e.target.value })} title={t('fundEdit.status', 'Stare')}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input className="input" placeholder={t('fundEdit.description', 'Descriere')} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select className="input" value={form.type} onChange={(e) => set({ type: e.target.value })} title={t('fundEdit.domain', 'Domeniu (grupare)')}>
              <option value="">{t('fundEdit.domain', 'Domeniu…')}</option>
              {domains.map((d) => <option key={d.key} value={d.label}>{d.label}</option>)}
            </select>
            <input className="input" style={{ width: 160 }} placeholder={t('fundEdit.method', 'Metodă alocare')} value={form.method} onChange={(e) => set({ method: e.target.value })} />
            <input className="input" style={{ width: 160 }} placeholder={t('fundEdit.shortName', 'Nume scurt')} value={form.shortName} onChange={(e) => set({ shortName: e.target.value })} />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" style={{ width: 140 }} type="number" step="0.01" placeholder={t('fundEdit.totalTarget', 'Țintă totală')} value={form.totalTarget} onChange={(e) => set({ totalTarget: e.target.value })} />
            <input className="input" style={{ width: 100 }} placeholder={t('fundEdit.currency', 'Monedă')} value={form.currency} onChange={(e) => set({ currency: e.target.value })} />
            <select className="input" value={form.startPeriodCode} onChange={(e) => set({ startPeriodCode: e.target.value })} title={t('fundEdit.startPeriod', 'Perioada de start')}>
              <option value="">{t('fundEdit.startPeriod', 'Start…')}</option>
              {periods.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
            </select>
            <input className="input" style={{ width: 120 }} type="number" step="0.001" placeholder={t('fundEdit.penalty', 'Penaliz. %/zi')} value={form.penaltyPerDayPct} onChange={(e) => set({ penaltyPerDayPct: e.target.value })} />
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn primary" type="submit" disabled={busy}>{mode === 'create' ? t('fundEdit.create', 'Creează fondul') : t('common.save', 'Salvează')}</button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>{t('common.cancel', 'Anulează')}</button>
          </div>
        </form>
      )}
    </div>
  )
}
