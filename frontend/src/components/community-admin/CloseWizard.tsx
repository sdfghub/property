import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'
import type { CommunityAdminTabKey } from './CommunityAdminDashboard'
import { UnitAttributesTable } from './UnitAttributesTable'

type Props = { communityId: string; onNavigate: (tab: CommunityAdminTabKey) => void; readOnly?: boolean }

type Editable = {
  period?: { code: string; status: string; dueDate?: string | null } | null
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canPrepare?: boolean
  canClose?: boolean
  checklist?: Record<string, any>
} | null

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

// The 7 steps mirror the real backend gates (PeriodService.getEditable/prepare/approve) plus the
// two per-unit confirmations (CPI/cotă-parte, residents) that feed allocation — nothing here is
// decorative. CPI and residents are always shown inline (their own step, live total, save-to-
// continue) rather than tucked behind a disclosure, per how the association actually works through
// a close: confirm the two per-unit numbers first, since everything else allocates off them.
const STEPS = ['cpi', 'residents', 'meters', 'invoices', 'allocate', 'prepare', 'cenzor'] as const
type StepKey = typeof STEPS[number]

const STEP_TITLE_KEY: Record<StepKey, string> = {
  cpi: 'close.wizard.cpiTitle', residents: 'close.residents', meters: 'close.readings',
  invoices: 'close.invoices', allocate: 'close.allocate', prepare: 'close.review', cenzor: 'close.cenzor',
}

export function CloseWizard({ communityId, onNavigate, readOnly = false }: Props) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, vars?: Record<string, string | number>, d = ''): string => {
    const v = rawT(k as any, vars as any)
    return v && v !== k ? v : d
  }
  const meta = useMetadata()

  const [ed, setEd] = React.useState<Editable>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [dueInput, setDueInput] = React.useState('')
  const [waterMethod, setWaterMethod] = React.useState<'PROPORTIONAL' | 'APA_DIF'>('PROPORTIONAL')
  const [stepIndex, setStepIndex] = React.useState<number | null>(null)

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

  const st = ed?.period?.status
  const metersDone = (ed?.meters?.total ?? 0) > 0 && (ed?.meters?.open?.length ?? 0) === 0
  const billsDone = (ed?.bills?.total ?? 0) > 0 && (ed?.bills?.open?.length ?? 0) === 0
  const dueSet = !!ed?.period?.dueDate
  const prepared = st === 'PREPARED' || st === 'CLOSED'
  const closed = st === 'CLOSED'
  const checklist: Record<string, any> = ed?.checklist || {}

  const stepDone: Record<StepKey, boolean> = {
    cpi: !!checklist.cpi, residents: !!checklist.residents,
    meters: metersDone, invoices: billsDone, allocate: dueSet, prepare: prepared, cenzor: closed,
  }

  // Land on the first not-yet-done step on the first successful load (e.g. after coming back from
  // recording invoices) — but never yank the user off a step they're deliberately reviewing.
  React.useEffect(() => {
    if (!ed?.period || stepIndex !== null) return
    const firstTodo = STEPS.findIndex((k) => !stepDone[k])
    setStepIndex(firstTodo === -1 ? STEPS.length - 1 : firstTodo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed])

  if (loading) return <div className="empty">{t('common.loading', undefined, 'Loading…')}</div>

  if (!ed || !ed.period) {
    return (
      <WizardShell title={t('close.title', undefined, 'Monthly close')}>
        <div className="muted">{t('close.noPeriod', undefined, 'No open period. Start a new month to begin the close.')}</div>
        {!readOnly && (
          <button className="btn primary" style={{ marginTop: 16 }} disabled={busy === 'create'}
            onClick={() => act('create', () => api.post(`/communities/${communityId}/periods/create`, {}))}>
            {busy === 'create' ? '…' : t('close.startMonth', undefined, 'Start a new month')}
          </button>
        )}
        {err ? <div className="badge negative" style={{ marginTop: 12 }}>{err}</div> : null}
      </WizardShell>
    )
  }

  if (closed) {
    return (
      <WizardShell title={t('close.wizard.doneTitle', { code: code! }, `${code} published`)}>
        <div className="muted" style={{ textAlign: 'center' }}>{t('close.published', undefined, 'Published & closed. Balances rolled to next month.')}</div>
        {!readOnly && (
          <button className="btn primary" style={{ marginTop: 16 }} disabled={busy === 'create'}
            onClick={() => act('create', () => api.post(`/communities/${communityId}/periods/create`, {}))}>
            {busy === 'create' ? '…' : t('close.startNext', undefined, 'Start next month')}
          </button>
        )}
        {err ? <div className="badge negative" style={{ marginTop: 12 }}>{err}</div> : null}
      </WizardShell>
    )
  }

  const idx = stepIndex ?? 0
  const stepKey = STEPS[idx]
  const canAdvance = stepDone[stepKey]
  const goto = (i: number) => setStepIndex(Math.max(0, Math.min(STEPS.length - 1, i)))
  const markDone = (areaKey: string) => act(`ch:${areaKey}`, () => post('checklist', { areaKey, done: true }))

  const blockerFor = (k: StepKey): string | null => {
    if (k === 'cpi' && !stepDone.cpi) return t('close.wizard.saveToContinue', undefined, 'Save to continue.')
    if (k === 'residents' && !stepDone.residents) return t('close.wizard.saveToContinue', undefined, 'Save to continue.')
    if (k === 'meters' && !metersDone) return t('close.wizard.metersBlocked', { list: (ed.meters?.open || []).join(', ') }, `Open reading sheets: ${(ed.meters?.open || []).join(', ')}`)
    if (k === 'invoices' && !billsDone) return t('close.wizard.billsBlocked', { list: (ed.bills?.open || []).join(', ') }, `Open bill sheets: ${(ed.bills?.open || []).join(', ')}`)
    if (k === 'allocate' && !dueSet) return t('close.wizard.dueMissing', undefined, 'Set a due date to continue.')
    if (k === 'prepare' && !prepared) return !ed.canPrepare ? t('close.prepareBlocked', undefined, 'Close all reading & bill sheets first.') : null
    if (k === 'cenzor' && !closed) return st === 'PREPARED' ? t('close.waitCenzor', undefined, 'Awaiting cenzor approval (requires CENSOR role).') : null
    return null
  }

  return (
    <WizardShell
      title={t(STEP_TITLE_KEY[stepKey], undefined, stepKey)}
      progress={<ProgressRail steps={STEPS} current={idx} done={stepDone} onJump={(i) => (stepDone[STEPS[i]] || i <= idx) && goto(i)} t={t} />}
    >
      {err ? <div className="badge negative" style={{ marginBottom: 8 }}>{err}</div> : null}

      {stepKey === 'cpi' && (
        <StepBody desc={t('close.wizard.cpiDesc', undefined, 'Confirm each unit\'s cotă-parte / mp before allocation — carried forward from last month by default.')}>
          <UnitAttributesTable communityId={communityId} periodCode={code as string} field="sqm"
            editable={!readOnly && st === 'OPEN'} onSaved={() => markDone('cpi')} />
        </StepBody>
      )}

      {stepKey === 'residents' && (
        <StepBody desc={t('close.residentsDesc', undefined, 'Confirm the number of residents per unit before allocation — carried forward from last month by default.')}>
          <UnitAttributesTable communityId={communityId} periodCode={code as string} field="residents"
            editable={!readOnly && st === 'OPEN'} onSaved={() => markDone('residents')} />
        </StepBody>
      )}

      {stepKey === 'meters' && (
        <StepBody desc={`${ed.meters?.closed ?? 0}/${ed.meters?.total ?? 0} ${t('close.templatesClosed', undefined, 'reading sheets closed')}`}>
          <button className="btn secondary" onClick={() => onNavigate('meters')}>
            {metersDone ? t('common.review', undefined, 'Review') : t('close.enter', undefined, 'Enter readings')}
          </button>
        </StepBody>
      )}

      {stepKey === 'invoices' && (
        <StepBody desc={`${ed.bills?.closed ?? 0}/${ed.bills?.total ?? 0} ${t('close.billsClosed', undefined, 'bill sheets closed')}`}>
          <button className="btn secondary" onClick={() => onNavigate('expenses')}>
            {billsDone ? t('common.review', undefined, 'Review') : t('close.record', undefined, 'Record invoices')}
          </button>
          <button className="btn link small" style={{ marginTop: 10 }} onClick={() => onNavigate('penaltyLedger')}>
            {t('close.wizard.optionalPenaltyLedger', undefined, 'Quick check: penalty ledger per unit')}
          </button>
        </StepBody>
      )}

      {stepKey === 'allocate' && (
        <StepBody desc={dueSet ? `${t('close.dueSet', undefined, 'Due date')}: ${toDateInput(ed.period.dueDate)}` : t('close.allocateDesc', undefined, 'Recompute the allocation and set the payment due date.')}>
          {!readOnly && (
            <div className="stack" style={{ gap: 10, alignItems: 'center' }}>
              <button className="btn secondary" disabled={busy === 'recompute'} onClick={() => act('recompute', () => post('recompute'))}>
                {busy === 'recompute' ? '…' : t('close.recompute', undefined, 'Recompute')}
              </button>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input type="date" className="input" value={dueInput} onChange={(e) => setDueInput(e.target.value)} style={{ width: 160 }} />
                <button className="btn secondary" disabled={busy === 'due' || !dueInput} onClick={() => act('due', () => post('due-date', { dueDate: dueInput }))}>
                  {busy === 'due' ? '…' : t('close.saveDue', undefined, 'Save due date')}
                </button>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12 }}>{t('close.waterMethod', undefined, 'Cold water allocation')}:</span>
                <select className="input" value={waterMethod} disabled={busy === 'water' || st !== 'OPEN'} style={{ width: 240 }}
                  onChange={(e) => { const v = e.target.value as 'PROPORTIONAL' | 'APA_DIF'; setWaterMethod(v); act('water', () => post('settings', { waterDifferenceMethod: v })) }}>
                  {(meta?.waterMethods ?? []).map((m) => <option key={m.key} value={m.key}>{m.hint || m.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </StepBody>
      )}

      {stepKey === 'prepare' && (
        <StepBody desc={t('close.reviewDesc', undefined, 'Generate the maintenance list for review.')}>
          <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
            <button className="btn secondary" onClick={() => onNavigate('avizier')}>{t('common.review', undefined, 'Review')}</button>
            {!readOnly && !prepared && (
              <button className="btn primary" disabled={!ed.canPrepare || busy === 'prepare'} onClick={() => act('prepare', () => post('prepare'))}>
                {busy === 'prepare' ? '…' : t('close.prepare', undefined, 'Prepare')}
              </button>
            )}
          </div>
          <button className="btn link small" style={{ marginTop: 10 }} onClick={() => onNavigate('debtors')}>
            {t('close.wizard.optionalDebtorsPenalties', undefined, 'Quick check: debtors & penalties')}
          </button>
        </StepBody>
      )}

      {stepKey === 'cenzor' && (
        <StepBody desc={st === 'PREPARED' ? t('close.waitCenzor', undefined, 'Awaiting cenzor approval (requires CENSOR role).') : t('close.cenzorTodo', undefined, 'Available after the list is prepared.')}>
          {!readOnly && st === 'PREPARED' ? (
            <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
              <button className="btn primary" disabled={busy === 'approve'} onClick={() => act('approve', () => post('approve'))}>
                {busy === 'approve' ? '…' : t('close.approve', undefined, 'Approve & publish')}
              </button>
              <button className="btn ghost" disabled={busy === 'reject'} onClick={() => act('reject', () => post('reject'))}>
                {busy === 'reject' ? '…' : t('close.reject', undefined, 'Send back')}
              </button>
            </div>
          ) : null}
          <button className="btn link small" style={{ marginTop: 10 }} onClick={() => onNavigate('penalties')}>
            {t('close.wizard.optionalPenalties', undefined, 'Quick check: penalties')}
          </button>
        </StepBody>
      )}

      {blockerFor(stepKey) && (
        <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 12, color: 'var(--negative, #c62828)' }}>
          {blockerFor(stepKey)}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 24 }}>
        <button className="btn ghost small" disabled={idx === 0} onClick={() => goto(idx - 1)}>
          {t('close.wizard.back', undefined, '← Back')}
        </button>
        <button className="btn primary" disabled={!canAdvance || idx === STEPS.length - 1} onClick={() => goto(idx + 1)}
          style={!canAdvance ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
          {t('close.wizard.continue', undefined, 'Continue')}
        </button>
      </div>
    </WizardShell>
  )
}

function WizardShell({ title, progress, children }: { title: string; progress?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ maxWidth: 560, margin: '24px auto', gap: 20 }}>
      {progress}
      <div className="card" style={{ textAlign: 'center', padding: '32px 28px' }}>
        <h3 style={{ margin: '0 0 16px' }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function StepBody({ desc, children }: { desc?: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: 16, alignItems: 'center', width: '100%' }}>
      {desc ? <div className="muted" style={{ fontSize: 14 }}>{desc}</div> : null}
      {children}
    </div>
  )
}

function ProgressRail({ steps, current, done, onJump, t }: {
  steps: readonly StepKey[]; current: number; done: Record<StepKey, boolean>
  onJump: (i: number) => void; t: (k: string, vars?: Record<string, string | number>, d?: string) => string
}) {
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {steps.map((k, i) => (
        <div key={k} role="button" onClick={() => onJump(i)}
          title={t(STEP_TITLE_KEY[k], undefined, k)}
          style={{
            width: 30, height: 4, borderRadius: 2, cursor: 'pointer',
            background: done[k] ? 'var(--accent, #2e7d32)' : i === current ? 'var(--info, #1565c0)' : 'var(--muted-bg, #e0e0e0)',
          }}
        />
      ))}
      <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
        {t('close.wizard.stepLabel', { n: current + 1, total: steps.length }, `Step ${current + 1} of ${steps.length}`)}
      </span>
    </div>
  )
}
