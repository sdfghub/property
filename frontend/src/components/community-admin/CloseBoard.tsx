import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import type { CommunityAdminTabKey } from './CommunityAdminDashboard'
import { UnitAttributesTable } from './UnitAttributesTable'

type Props = { communityId: string; onNavigate: (tab: CommunityAdminTabKey) => void; readOnly?: boolean }

type Completed = { at?: string; by?: string } | null

type Editable = {
  period?: { code: string; status: string; dueDate?: string | null } | null
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canPrepare?: boolean
  canClose?: boolean
  checklist?: Record<string, Completed>
} | null

type StepStatus = 'done' | 'current' | 'todo' | 'blocked' | 'optional'

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

export function CloseBoard({ communityId, onNavigate, readOnly = false }: Props) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [ed, setEd] = React.useState<Editable>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [dueInput, setDueInput] = React.useState('')
  const [waterMethod, setWaterMethod] = React.useState<'PROPORTIONAL' | 'APA_DIF'>('PROPORTIONAL')

  const load = React.useCallback(async () => {
    const e = await api.get<Editable>(`/communities/${communityId}/periods/editable`).catch(() => null)
    setEd(e as Editable)
    setDueInput(toDateInput((e as any)?.period?.dueDate))
    const pcode = (e as any)?.period?.code
    if (pcode) {
      const s = await api.get<any>(`/communities/${communityId}/periods/${pcode}/settings`).catch(() => null)
      setWaterMethod(((s as any)?.waterDifferenceMethod as 'PROPORTIONAL' | 'APA_DIF') || 'PROPORTIONAL')
    }
    setLoading(false)
  }, [api, communityId])

  React.useEffect(() => { setLoading(true); load() }, [load])

  const code = ed?.period?.code
  const post = (path: string, body?: any) => api.post(`/communities/${communityId}/periods/${code}/${path}`, body)
  async function act(key: string, fn: () => Promise<any>) {
    setBusy(key); setErr(null)
    try { await fn(); await load() } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  // No open period → offer to create one
  if (!ed || !ed.period) {
    return (
      <div className="card ops-card">
        <h4 style={{ marginTop: 0 }}>{t('close.title', 'Monthly close')}</h4>
        <div className="muted">{t('close.noPeriod', 'No open period. Start a new month to begin the close.')}</div>
        {!readOnly && (
        <button className="btn primary" style={{ marginTop: 10 }} disabled={busy === 'create'}
          onClick={() => act('create', () => api.post(`/communities/${communityId}/periods/create`, {}))}>
          {busy === 'create' ? '…' : t('close.startMonth', 'Start a new month')}
        </button>
        )}
        {err ? <div className="badge negative" style={{ marginTop: 8 }}>{err}</div> : null}
      </div>
    )
  }

  const st = ed.period.status
  const metersDone = (ed.meters?.total ?? 0) > 0 && (ed.meters?.open?.length ?? 0) === 0
  const billsDone = (ed.bills?.total ?? 0) > 0 && (ed.bills?.open?.length ?? 0) === 0
  const dueSet = !!ed.period.dueDate
  const prepared = st === 'PREPARED' || st === 'CLOSED'
  const closed = st === 'CLOSED'

  // pick the first actionable non-done step as "current"
  const order: Array<[string, boolean]> = [
    ['meters', metersDone], ['invoices', billsDone], ['allocate', dueSet], ['prepare', prepared], ['cenzor', closed],
  ]
  const currentKey = order.find(([, done]) => !done)?.[0] ?? null
  const stat = (key: string, done: boolean, blocked = false): StepStatus =>
    done ? 'done' : blocked ? 'blocked' : key === currentKey ? 'current' : 'todo'

  // Per-area "mark complete" checklist (persisted on Period.checklist)
  const checklist: Record<string, Completed> = (ed.checklist as any) || {}
  const canEditChecklist = !readOnly && !closed
  const isMarked = (k: string) => !!checklist[k]
  const toggleArea = (k: string) => act(`ch:${k}`, () => post('checklist', { areaKey: k, done: !isMarked(k) }))
  const effStat = (k: string, derived: StepStatus): StepStatus => (isMarked(k) ? 'done' : derived)
  // props shared by every area card
  const area = (k: string) => ({
    areaKey: k,
    completed: checklist[k] ?? null,
    canComplete: canEditChecklist,
    toggleBusy: busy === `ch:${k}`,
    onToggleComplete: () => toggleArea(k),
    t,
  })
  // an area counts toward progress if manually marked OR derived-done
  const derivedDone: Record<string, boolean> = { residents: false, meters: metersDone, invoices: billsDone, allocate: dueSet, debtors: false, prepare: prepared, cenzor: closed }
  const AREA_KEYS = ['residents', 'meters', 'invoices', 'allocate', 'debtors', 'prepare', 'cenzor']
  const doneCount = AREA_KEYS.filter((k) => isMarked(k) || derivedDone[k]).length

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ margin: 0 }}>{t('close.title', 'Monthly close')} — <strong>{code}</strong> <span className={`badge ${closed ? 'secondary' : prepared ? 'tertiary' : 'negative'}`}>{st}</span></h4>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className={`badge ${doneCount === AREA_KEYS.length ? 'secondary' : 'muted'}`} title={t('close.progressHint', 'Zone bifate ca finalizate din totalul pașilor de închidere')}>
            {t('close.progress', 'Zone finalizate')}: {doneCount}/{AREA_KEYS.length}
          </span>
          <button className="btn ghost small" disabled={busy === 'reload'} onClick={() => act('reload', async () => {})}>{t('common.refresh', 'Refresh')}</button>
        </div>
      </div>
      {err ? <div className="badge negative">{err}</div> : null}

      <Step n={1} status={effStat('residents', 'optional')} {...area('residents')} title={t('close.residents', 'Confirmă persoane & cotă / mp')}
        desc={t('close.residentsDesc', 'Confirmă numărul de persoane și cota-parte/mp pe unitate înainte de alocare (determină cotele per-persoană și pe cotă-parte).')}>
        <UnitAttributesTable communityId={communityId} periodCode={code as string} editable={!readOnly && st === 'OPEN' && !isMarked('residents')} />
        {isMarked('residents') && !readOnly && st === 'OPEN' ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>🔒 {t('close.locked', 'Finalizat — doar citire. Anulează pentru a edita.')}</div> : null}
      </Step>

      <Step n={2} status={effStat('meters', stat('meters', metersDone))} {...area('meters')} title={t('close.readings', 'Meter readings')}
        desc={`${ed.meters?.closed ?? 0}/${ed.meters?.total ?? 0} ${t('close.templatesClosed', 'reading sheets closed')}`}>
        <button className="btn secondary small" onClick={() => onNavigate('meters')}>{metersDone ? t('common.review', 'Review') : t('close.enter', 'Enter readings')}</button>
      </Step>

      <Step n={3} status={effStat('invoices', stat('invoices', billsDone))} {...area('invoices')} title={t('close.invoices', 'Invoices & expenses')}
        desc={`${ed.bills?.closed ?? 0}/${ed.bills?.total ?? 0} ${t('close.billsClosed', 'bill sheets closed')}`}>
        <button className="btn secondary small" onClick={() => onNavigate('expenses')}>{billsDone ? t('common.review', 'Review') : t('close.record', 'Record invoices')}</button>
      </Step>

      <Step n={4} status={effStat('allocate', stat('allocate', dueSet))} {...area('allocate')} title={t('close.allocate', 'Allocate & due date')}
        desc={dueSet ? `${t('close.dueSet', 'Scadență')}: ${toDateInput(ed.period.dueDate)}` : t('close.allocateDesc', 'Recompute the allocation and set the payment due date (scadență).')}>
        {!readOnly && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn secondary small" disabled={busy === 'recompute'} onClick={() => act('recompute', () => post('recompute'))}>{busy === 'recompute' ? '…' : t('close.recompute', 'Recompute')}</button>
          <input type="date" className="input" value={dueInput} disabled={isMarked('allocate')} onChange={(e) => setDueInput(e.target.value)} style={{ width: 160 }} />
          <button className="btn secondary small" disabled={busy === 'due' || !dueInput || isMarked('allocate')} onClick={() => act('due', () => post('due-date', { dueDate: dueInput }))}>{busy === 'due' ? '…' : t('close.saveDue', 'Save scadență')}</button>
          {isMarked('allocate') ? <span className="muted" style={{ fontSize: 12 }}>🔒 {t('close.locked', 'Finalizat — doar citire. Anulează pentru a edita.')}</span> : null}
        </div>
        )}
        {!readOnly && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('close.waterMethod', 'Alocare apă rece')}:</span>
          <select className="input" value={waterMethod} disabled={busy === 'water' || st !== 'OPEN' || isMarked('allocate')} style={{ width: 260 }}
            onChange={(e) => { const v = e.target.value as 'PROPORTIONAL' | 'APA_DIF'; setWaterMethod(v); act('water', () => post('settings', { waterDifferenceMethod: v })) }}>
            <option value="PROPORTIONAL">{t('close.waterProportional', 'Proporțional cu consumul (o linie)')}</option>
            <option value="APA_DIF">{t('close.waterApaDif', 'Contorizat + diferență separată (apa-dif)')}</option>
          </select>
          {busy === 'water' ? <span className="muted" style={{ fontSize: 12 }}>…</span>
            : <span className="muted" style={{ fontSize: 12 }}>{t('close.waterMethodHint', 'se aplică la salvarea facturii de apă rece')}</span>}
        </div>
        )}
      </Step>

      <Step n={5} status={effStat('debtors', 'optional')} {...area('debtors')} title={t('close.debtors', 'Debtors & penalties review')}
        desc={t('close.debtorsDesc', 'Check outstanding balances and accrued penalties before publishing.')}>
        <button className="btn secondary small" onClick={() => onNavigate('debtors')}>{t('common.open', 'Open')}</button>
      </Step>

      <Step n={6} status={effStat('prepare', stat('prepare', prepared, st === 'OPEN' && !ed.canPrepare))} {...area('prepare')} title={t('close.review', 'Review & prepare avizier')}
        desc={st === 'OPEN' && !ed.canPrepare ? t('close.prepareBlocked', 'Close all reading & bill sheets first.') : t('close.reviewDesc', 'Generate the maintenance list for review.')}>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary small" onClick={() => onNavigate('avizier')}>{t('common.review', 'Review')}</button>
          {!readOnly && !prepared ? <button className="btn primary small" disabled={!ed.canPrepare || busy === 'prepare'} onClick={() => act('prepare', () => post('prepare'))}>{busy === 'prepare' ? '…' : t('close.prepare', 'Prepare')}</button> : null}
        </div>
      </Step>

      <Step n={7} status={effStat('cenzor', stat('cenzor', closed))} {...area('cenzor')} title={t('close.cenzor', 'Cenzor sign-off & publish')}
        desc={closed ? t('close.published', 'Published & closed. Balances rolled to next month.') : st === 'PREPARED' ? t('close.waitCenzor', 'Awaiting cenzor approval (requires CENSOR role).') : t('close.cenzorTodo', 'Available after the list is prepared.')}>
        {!readOnly && st === 'PREPARED' ? (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary small" disabled={busy === 'approve'} onClick={() => act('approve', () => post('approve'))}>{busy === 'approve' ? '…' : t('close.approve', 'Approve & publish')}</button>
            <button className="btn ghost small" disabled={busy === 'reject'} onClick={() => act('reject', () => post('reject'))}>{busy === 'reject' ? '…' : t('close.reject', 'Send back')}</button>
          </div>
        ) : null}
        {!readOnly && closed ? <button className="btn primary small" disabled={busy === 'create'} onClick={() => act('create', () => api.post(`/communities/${communityId}/periods/create`, {}))}>{busy === 'create' ? '…' : t('close.startNext', 'Start next month')}</button> : null}
      </Step>
    </div>
  )
}

function Step({ n, status, title, desc, children, areaKey, completed, canComplete, onToggleComplete, toggleBusy, t }: {
  n: number; status: StepStatus; title: string; desc?: string; children?: React.ReactNode
  areaKey?: string; completed?: Completed; canComplete?: boolean; onToggleComplete?: () => void; toggleBusy?: boolean
  t?: (k: string, d?: string) => string
}) {
  const tr = t || ((_k: string, d = '') => d)
  const tone: Record<StepStatus, string> = { done: 'secondary', current: 'tertiary', todo: 'muted', blocked: 'negative', optional: 'muted' }
  const mark: Record<StepStatus, string> = { done: '✓', current: '▶', todo: String(n), blocked: '!', optional: '·' }
  return (
    <div className="card" style={{ opacity: status === 'todo' ? 0.85 : 1, borderLeft: completed ? '3px solid var(--accent, #2e7d32)' : undefined }}>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
          background: status === 'done' ? 'var(--accent, #2e7d32)' : status === 'current' ? 'var(--info, #1565c0)' : status === 'blocked' ? 'var(--negative, #c62828)' : 'var(--muted-bg, #e0e0e0)',
          color: status === 'todo' || status === 'optional' ? '#555' : '#fff', fontWeight: 700 }}>{mark[status]}</div>
        <div className="stack" style={{ gap: 6, flex: 1 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>{title}</strong>
            <span className={`badge ${tone[status]}`}>{status}</span>
          </div>
          {desc ? <div className="muted" style={{ fontSize: 13 }}>{desc}</div> : null}
          {children ? <div style={{ marginTop: 2 }}>{children}</div> : null}
          {areaKey ? (
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--border, #ececec)' }}>
              {completed ? (
                <>
                  <span className="badge secondary">✓ {tr('close.marked', 'Marcat finalizat')}</span>
                  {(completed.by || completed.at) ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {completed.by || ''}{completed.by && completed.at ? ' · ' : ''}{completed.at ? new Date(completed.at).toLocaleDateString() : ''}
                    </span>
                  ) : null}
                  {canComplete ? (
                    <button className="btn ghost small" disabled={toggleBusy} onClick={onToggleComplete}>{toggleBusy ? '…' : tr('close.undoComplete', 'Anulează')}</button>
                  ) : null}
                </>
              ) : (
                canComplete ? (
                  <button className="btn ghost small" disabled={toggleBusy} onClick={onToggleComplete}>{toggleBusy ? '…' : `✓ ${tr('close.markComplete', 'Marchează ca finalizată')}`}</button>
                ) : null
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
