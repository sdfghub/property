import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import type { CommunityAdminTabKey } from './CommunityAdminDashboard'

type Props = {
  communityId: string
  onNavigate: (tab: CommunityAdminTabKey, extra?: Record<string, string>) => void
  /** Active role — tailors which cards/actions the home shows. Defaults to full admin. */
  viewerRole?: string
}

type Editable = {
  period?: { code: string; status: string } | null
  lastClosed?: { code: string } | null
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canPrepare?: boolean
  canClose?: boolean
} | null

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

/** Compute the single "next action" in the monthly spine from the editable-period gate. */
function nextAction(ed: Editable, t: (k: string, d?: string) => string): { label: string; tab: CommunityAdminTabKey } {
  if (!ed || !ed.period) return { label: t('today.action.createPeriod', 'Start a new month'), tab: 'periodFocus' }
  const st = ed.period.status
  const metersOpen = (ed.meters?.open?.length ?? 0) > 0
  const billsOpen = (ed.bills?.open?.length ?? 0) > 0
  if (st === 'OPEN' && metersOpen) return { label: t('today.action.readings', 'Enter meter readings'), tab: 'meters' }
  if (st === 'OPEN' && billsOpen) return { label: t('today.action.invoices', 'Record invoices & expenses'), tab: 'expenses' }
  if (st === 'OPEN' && ed.canPrepare) return { label: t('today.action.prepare', 'Review & prepare the list'), tab: 'close' }
  if (st === 'PREPARED') return { label: t('today.action.close', 'Send to cenzor / close'), tab: 'close' }
  if (st === 'CLOSED') return { label: t('today.action.next', 'Start the next month'), tab: 'periodFocus' }
  return { label: t('today.action.open', 'Open the monthly close'), tab: 'close' }
}

export function TodayHome({ communityId, onNavigate, viewerRole }: Props) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  // Fallback-aware: useI18n's t() returns the key itself when missing, so use the provided default.
  const t = (k: string, d = '') => {
    const v = rawT(k as any)
    return v && v !== k ? v : d
  }
  const [editable, setEditable] = React.useState<Editable>(null)
  const [dash, setDash] = React.useState<any>(null)
  const [receivables, setReceivables] = React.useState<any>(null)
  const [unpaid, setUnpaid] = React.useState<any>(null)
  const [funds, setFunds] = React.useState<any>(null)
  const [collection, setCollection] = React.useState<any>(null)
  const [decisions, setDecisions] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [reopenBusy, setReopenBusy] = React.useState(false)

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    const g = <T,>(url: string) => api.get<T>(url).catch(() => null)
    Promise.all([
      g<Editable>(`/communities/${communityId}/periods/editable`),
      g<any>(`/communities/${communityId}/dashboard`),
      g<any>(`/communities/${communityId}/finance/receivables`),
      g<any>(`/communities/${communityId}/finance/vendor-invoices/unpaid`),
      g<any>(`/communities/${communityId}/finance/funds-status`),
      g<any>(`/communities/${communityId}/finance/collection`),
      g<any>(`/communities/${communityId}/committee/decisions`),
    ]).then(([ed, d, r, u, f, c, dec]) => {
      if (!alive) return
      setEditable(ed as Editable)
      setDash(d)
      setReceivables(r)
      setUnpaid(u)
      setFunds(f)
      setCollection(c)
      setDecisions(dec)
      setLoading(false)
    })
    return () => { alive = false }
  }, [communityId, api])

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  const st = editable?.period?.status
  const statusClass = st === 'CLOSED' ? 'secondary' : st === 'PREPARED' ? 'tertiary' : 'negative'
  const tasks = dash?.tasks?.length ?? 0
  const incidents = dash?.incidents?.length ?? 0

  const isAdmin = !viewerRole || viewerRole === 'COMMUNITY_ADMIN'
  const isCensor = viewerRole === 'CENSOR'
  const isCommittee = viewerRole === 'EXECUTIVE_COMITEE_MEMBER'
  const decList: any[] = decisions?.decisions ?? []
  const openDecisions = decList.filter((d) => d.status === 'OPEN').length
  const pendingForMe = decList.filter((d) => d.status === 'OPEN' && !d.myVote).length

  // The single "next step" depends on the role.
  const action: { label: string; tab: CommunityAdminTabKey } = isCensor
    ? { label: st === 'PREPARED' ? t('today.action.signoff', 'Semnează avizierul') : t('today.action.viewAvizier', 'Vezi avizierul'), tab: 'avizier' }
    : isCommittee
      ? { label: pendingForMe > 0 ? `${t('today.action.vote', 'Votează deciziile')} (${pendingForMe})` : t('today.action.viewDecisions', 'Vezi deciziile'), tab: 'decisions' }
      : nextAction(editable, t)

  // When nothing is open, let the admin reopen the last closed period straight from the home.
  const lastClosedCode = !editable?.period ? editable?.lastClosed?.code : undefined
  const doReopen = async () => {
    if (!lastClosedCode) return
    setReopenBusy(true)
    try {
      await api.post(`/communities/${communityId}/periods/${lastClosedCode}/reopen`)
      onNavigate('close')
    } catch { setReopenBusy(false) }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* Next action strip */}
      <div className="card ops-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="muted">{t('today.currentPeriod', 'Current period')}</div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <strong style={{ fontSize: 20 }}>{editable?.period?.code ?? t('today.noPeriod', 'No open period')}</strong>
              {st ? <span className={`badge ${statusClass}`}>{st}</span> : null}
            </div>
          </div>
          <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
            <div className="muted">{t('today.nextStep', 'Next step')}</div>
            <div className="row" style={{ gap: 8 }}>
              {isAdmin && lastClosedCode ? (
                <button className="btn secondary" disabled={reopenBusy} onClick={doReopen}
                  title={t('today.reopenHint', 'Redeschide ultima lună închisă pentru corecții')}>
                  {reopenBusy ? '…' : `${t('today.reopen', 'Redeschide')} ${lastClosedCode}`}
                </button>
              ) : null}
              <button className="btn primary" onClick={() => onNavigate(action.tab)}>{action.label} →</button>
            </div>
          </div>
        </div>
        {isAdmin && editable?.period ? (
          <div className="row" style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="ops-chip">{t('today.meters', 'Meters')}: {editable.meters?.closed ?? 0}/{editable.meters?.total ?? 0}</span>
            <span className="ops-chip">{t('today.bills', 'Bills')}: {editable.bills?.closed ?? 0}/{editable.bills?.total ?? 0}</span>
          </div>
        ) : null}
      </div>

      {/* Money widgets (finance reads — visible to all roles that reach this home) */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        <Widget title={t('today.debtors', 'Debtors (restanțe)')} onClick={() => onNavigate('debtors')}
          main={money(receivables?.totalDebt)} sub={`${receivables?.debtorCount ?? 0} ${t('today.units', 'units')}`} tone="warn" />
        <Widget title={t('today.unpaidInvoices', 'Unpaid supplier invoices')} onClick={() => onNavigate('unpaidInvoices')}
          main={money(unpaid?.totalOutstanding)} sub={`${unpaid?.count ?? 0} ${t('today.invoices', 'invoices')}`} tone="danger" />
        <Widget title={t('today.collection', 'Collection this period')} onClick={() => onNavigate('collectionRate')}
          main={collection?.ratePct == null ? '—' : `${collection.ratePct}%`}
          sub={`${money(collection?.collected)} / ${money(collection?.charged)}`} tone="info" />
        {isAdmin && (
          <Widget title={t('today.todos', 'To-dos')} onClick={() => onNavigate('overview')}
            main={`${tasks + incidents}`} sub={`${tasks} ${t('today.tasks', 'tasks')} · ${incidents} ${t('today.incidents', 'incidents')}`} tone="neutral" />
        )}
        {(isCommittee || isAdmin) && (
          <Widget title={t('today.decisions', 'Committee decisions')} onClick={() => onNavigate('decisions')}
            main={`${openDecisions}`}
            sub={isCommittee && pendingForMe > 0 ? `${pendingForMe} ${t('today.toVote', 'to vote')}` : t('today.openDecisions', 'open')} tone="info" />
        )}
      </div>

      {/* Funds status */}
      {funds?.funds?.length ? (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ margin: 0 }}>{t('today.fundsStatus', 'Funds — collected vs target')}</h4>
            <button className="btn ghost small" onClick={() => onNavigate('funds')}>{t('common.open', 'Open')} →</button>
          </div>
          <div className="stack" style={{ gap: 4, marginTop: 8 }}>
            {funds.funds.map((f: any) => (
              <button key={f.code} type="button" className="row"
                onClick={() => onNavigate('funds', { fund: f.code })}
                style={{ justifyContent: 'space-between', gap: 12, background: 'none', border: 'none', padding: '6px 4px', cursor: 'pointer', textAlign: 'left', borderRadius: 6 }}
                title={t('today.openFund', 'Open fund')}>
                <span>{f.name} <span className="muted">({f.split ?? '—'})</span></span>
                <span className="muted">
                  {money(f.accrued, f.currency)}{f.totalTarget != null ? ` / ${money(f.totalTarget, f.currency)}` : ''}
                  {f.progressPct != null ? ` · ${f.progressPct}%` : ''} ›
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Community operations (admin + committee — cenzor is finance-only) */}
      {(isAdmin || isCommittee) && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <ListCard title={t('today.tasksTitle', 'Open tasks')} rows={(dash?.tasks ?? []).map((x: any) => x.title)} onOpen={() => onNavigate('inventory')} empty={t('today.noTasks', 'No open tasks')} t={t} />
          <ListCard title={t('today.incidentsTitle', 'Incidents')} rows={(dash?.incidents ?? []).map((x: any) => x.title)} onOpen={() => onNavigate('inventory')} empty={t('today.noIncidents', 'No incidents')} t={t} />
          <ListCard title={t('today.pollsTitle', 'Ongoing polls')} rows={(dash?.ongoingPolls ?? []).map((x: any) => x.question || x.title)} onOpen={() => onNavigate('polls')} empty={t('today.noPolls', 'No ongoing polls')} t={t} />
          <ListCard title={t('today.eventsTitle', 'Upcoming events')} rows={(dash?.upcomingEvents ?? []).map((x: any) => x.title)} onOpen={() => onNavigate('events')} empty={t('today.noEvents', 'No upcoming events')} t={t} />
        </div>
      )}
    </div>
  )
}

function Widget({ title, main, sub, onClick }: { title: string; main: string; sub?: string; tone?: string; onClick?: () => void }) {
  return (
    <div className={`card cmd-card${onClick ? '' : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="muted" style={{ fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{main}</div>
      {sub ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

function ListCard({ title, rows, onOpen, empty, t }: { title: string; rows: string[]; onOpen: () => void; empty: string; t: (k: string, d?: string) => string }) {
  return (
    <div className="card soft">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <button className="btn ghost small" onClick={onOpen}>{t('common.open', 'Open')}</button>
      </div>
      {rows.length ? (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {rows.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      ) : <div className="empty" style={{ marginTop: 8 }}>{empty}</div>}
    </div>
  )
}
