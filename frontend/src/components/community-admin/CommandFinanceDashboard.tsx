import React from 'react'
import type { CommunityAdminTabKey } from './CommunityAdminDashboard'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'


const fallbackBlockingItems = [
  { label: 'Meters open', value: '—', tone: 'warning' },
  { label: 'Bill templates open', value: '—', tone: 'warning' },
  { label: 'Invoices unlinked', value: '—', tone: 'danger' },
]

const receivables = [
  { name: 'BE-102', amount: '4,200 RON', due: '2 days overdue' },
  { name: 'BE-206', amount: '2,940 RON', due: 'Due tomorrow' },
  { name: 'BE-311', amount: '1,580 RON', due: 'Due in 3 days' },
]

const invoicesToPay = [
  { title: 'Elevator maintenance', amount: '8,900 RON', due: 'Due in 5 days' },
  { title: 'Cleaning supplies', amount: '1,240 RON', due: 'Due in 8 days' },
]

const maintenance = [
  { title: 'Boiler inspection', time: 'Next week' },
  { title: 'Roof safety check', time: 'Fri 09:00' },
]

const polls = [
  { title: 'Paint hallway walls', time: 'Ends Fri' },
  { title: 'Bike rack upgrade', time: 'Ends Mon' },
]

const events = [
  { title: 'Monthly committee meeting', time: 'Thu 18:00' },
  { title: 'Fire drill', time: 'Fri 10:00' },
]

const tasks = [
  { title: 'Finalize elevator maintenance invoice', status: 'In review' },
  { title: 'Upload water meter readings', status: 'Pending' },
  { title: 'Approve janitor compensation', status: 'Due today' },
]

const incidents = [
  { title: 'Garage door sensor offline', status: 'Active' },
  { title: 'Lobby light circuit', status: 'Investigating' },
]

export function CommandFinanceDashboard({
  communityCode,
  onNavigate,
  onPrepare,
  onClose,
  onReopen,
  onCreatePeriod,
  periodError,
}: {
  communityCode: string
  onNavigate?: (tab: CommunityAdminTabKey) => void
  onPrepare?: () => void
  onClose?: () => void
  onReopen?: () => void
  onCreatePeriod?: () => void
  periodError?: string | null
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [editablePeriod, setEditablePeriod] = React.useState<any | null>(null)
  const [lastClosed, setLastClosed] = React.useState<{ code: string } | null>(null)

  const go = (tab: CommunityAdminTabKey) => onNavigate?.(tab)
  React.useEffect(() => {
    if (!communityCode) return
    api
      .get<any>(`/communities/${communityCode}/periods/editable`)
      .then((res) => setEditablePeriod(res))
      .catch(() => setEditablePeriod(null))
    api
      .get<Array<{ code: string; status: string }>>(`/communities/${communityCode}/periods/closed`)
      .then((rows) => {
        const closed = rows?.find((r) => r.status === 'CLOSED') || null
        setLastClosed(closed ? { code: closed.code } : null)
      })
      .catch(() => setLastClosed(null))
  }, [api, communityCode])

  const periodCode = editablePeriod?.period?.code || null
  const periodStatus = editablePeriod?.period?.status || null
  const metersClosed = editablePeriod?.meters?.closed ?? 0
  const metersTotal = editablePeriod?.meters?.total ?? 0
  const billsClosed = editablePeriod?.bills?.closed ?? 0
  const billsTotal = editablePeriod?.bills?.total ?? 0
  const metersOpen = editablePeriod?.meters?.open?.length ?? null
  const billsOpen = editablePeriod?.bills?.open?.length ?? null
  const blockingItems = [
    { label: t('cmdfin.metersOpen', 'Meters open'), value: metersOpen ?? 0, tone: 'warning' },
    { label: t('cmdfin.billTemplatesOpen', 'Bill templates open'), value: billsOpen ?? 0, tone: 'warning' },
    { label: t('cmdfin.invoicesUnlinked', 'Invoices unlinked'), value: '—', tone: 'danger' },
  ]
  const parsedError = React.useMemo(() => {
    if (!periodError) return null
    let message = periodError
    if (message.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(message)
        if (parsed?.message) message = parsed.message
      } catch {
        // ignore parse errors
      }
    }
    const meterKey = 'Open meters:'
    const billsKey = '; bills:'
    if (message.includes(meterKey)) {
      const [, rest] = message.split(meterKey)
      const [metersRaw, billsRaw] = rest.split(billsKey)
      const meters = metersRaw ? metersRaw.split(',').map((v) => v.trim()).filter(Boolean) : []
      const bills = billsRaw ? billsRaw.split(',').map((v) => v.trim()).filter(Boolean) : []
      return {
        headline: message.split(meterKey)[0].trim(),
        meters,
        bills,
      }
    }
    return { headline: message, meters: [], bills: [] }
  }, [periodError])
  return (
    <div className="cmd-finance">
      <div className="cmd-strip">
        <div className="cmd-strip-main">
          <div className="cmd-kicker">{t('cmdfin.finalizePeriod','Finalize period')}</div>
          {periodCode ? (
            <>
              <div className="cmd-strip-title">
                {t('cmdfin.period','Period')} {periodCode}
                <span className="cmd-chip info">{periodStatus}</span>
              </div>
              <div className="cmd-strip-sub">
                <span className="cmd-chip neutral">{t('cmdfin.meters','Meters')} {metersClosed}/{metersTotal}</span>
                <span className="cmd-chip neutral">{t('cmdfin.bills','Bills')} {billsClosed}/{billsTotal}</span>
                <span className="cmd-chip neutral">{t('cmdfin.lastClosed','Last closed:')} {lastClosed?.code || '—'}</span>
              </div>
              <div className="cmd-strip-sub">
                {(blockingItems || fallbackBlockingItems).map((item) => (
                  <span key={item.label} className={`cmd-chip ${item.tone || 'neutral'}`}>
                    {item.label}: {item.value}
                  </span>
                ))}
              </div>
              {parsedError ? (
                <div className="cmd-alert">
                  <div className="cmd-alert-title">{t('cmdfin.prepareBlocked','Prepare blocked')}</div>
                  <div className="cmd-alert-body">{parsedError.headline}</div>
                  {(parsedError.meters.length || parsedError.bills.length) && (
                    <div className="cmd-alert-grid">
                      {parsedError.meters.length ? (
                        <div>
                          <div className="cmd-alert-label">{t('cmdfin.openMeters','Open meters')}</div>
                          <div className="cmd-alert-list">
                            {parsedError.meters.map((m) => (
                              <span key={m} className="cmd-chip warning">{m}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {parsedError.bills.length ? (
                        <div>
                          <div className="cmd-alert-label">{t('cmdfin.openBills','Open bills')}</div>
                          <div className="cmd-alert-list">
                            {parsedError.bills.map((b) => (
                              <span key={b} className="cmd-chip warning">{b}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="cmd-strip-title">{t('cmdfin.noActivePeriod','No active period')}</div>
              <div className="cmd-strip-sub">
                <span className="cmd-chip neutral">{t('cmdfin.lastClosed','Last closed:')} {lastClosed?.code || '—'}</span>
              </div>
            </>
          )}
        </div>
        <div className="cmd-strip-actions">
          {editablePeriod?.period ? (
            <>
              <button className="btn small" onClick={onPrepare}>{t('cmdfin.prepare','Prepare')}</button>
              <button className="btn small" onClick={onClose}>{t('cmdfin.close','Close')}</button>
              <button className="btn secondary small" onClick={onReopen}>{t('cmdfin.reopen','Reopen')}</button>
              <button className="btn secondary small" onClick={() => go('expenses')}>{t('cmdfin.addInvoice','Add invoice')}</button>
              <button className="btn secondary small" onClick={() => go('payments')}>{t('cmdfin.recordVendorPayment','Record vendor payment')}</button>
            </>
          ) : (
            <button className="btn small" onClick={onCreatePeriod}>{t('cmdfin.createPeriod','Create period')}</button>
          )}
        </div>
      </div>

      <div className="cmd-grid action-board">
        <div className="cmd-col span-3">
          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.receivables','Receivables')}</div>
                <h3>{t('cmdfin.notifyDueBillingEntities','Notify due billing entities')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('statements')}>{t('cmdfin.openList','Open list')}</button>
            </div>
            <div className="cmd-list">
              {receivables.map((row) => (
                <div key={row.name} className="cmd-list-row">
                  <div>
                    <div className="cmd-label">{row.name}</div>
                    <div className="cmd-sub">{row.due}</div>
                  </div>
                  <strong>{row.amount}</strong>
                </div>
              ))}
            </div>
            <div className="cmd-card-foot">
              <button className="btn small" onClick={() => go('statements')}>{t('cmdfin.sendReminders','Send reminders')}</button>
            </div>
          </div>

          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.payments','Payments')}</div>
                <h3>{t('cmdfin.invoicesToPay','Invoices to pay')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('payments')}>{t('cmdfin.openQueue','Open queue')}</button>
            </div>
            <div className="cmd-list">
              {invoicesToPay.map((inv) => (
                <div key={inv.title} className="cmd-list-row">
                  <div>
                    <div className="cmd-label">{inv.title}</div>
                    <div className="cmd-sub">{inv.due}</div>
                  </div>
                  <strong>{inv.amount}</strong>
                </div>
              ))}
            </div>
            <div className="cmd-card-foot">
              <button className="btn small" onClick={() => go('payments')}>{t('cmdfin.recordPayment','Record payment')}</button>
            </div>
          </div>
        </div>

        <div className="cmd-col">
          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.maintenance','Maintenance')}</div>
                <h3>{t('cmdfin.upcomingMaintenance','Upcoming maintenance')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('inventory')}>{t('cmdfin.openMaintenance','Open maintenance')}</button>
            </div>
            <div className="cmd-list">
              {maintenance.map((item) => (
                <div key={item.title} className="cmd-list-row">
                  <div className="cmd-label">{item.title}</div>
                  <span className="cmd-chip neutral">{item.time}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.polls','Polls')}</div>
                <h3>{t('cmdfin.openPolls','Open polls')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('polls')}>{t('cmdfin.viewPolls','View polls')}</button>
            </div>
            <div className="cmd-list">
              {polls.map((poll) => (
                <div key={poll.title} className="cmd-list-row">
                  <div className="cmd-label">{poll.title}</div>
                  <span className="cmd-chip info">{poll.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="cmd-col">
          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.events','Events')}</div>
                <h3>{t('cmdfin.upcomingEvents','Upcoming events')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('events')}>{t('cmdfin.viewEvents','View events')}</button>
            </div>
            <div className="cmd-list">
              {events.map((event) => (
                <div key={event.title} className="cmd-list-row">
                  <div className="cmd-label">{event.title}</div>
                  <span className="cmd-chip neutral">{event.time}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.tasks','Tasks')}</div>
                <h3>{t('cmdfin.todaysActions','Today’s actions')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('notifications')}>{t('cmdfin.viewTasks','View tasks')}</button>
            </div>
            <div className="cmd-list">
              {tasks.map((task) => (
                <div key={task.title} className="cmd-list-row">
                  <div className="cmd-label">{task.title}</div>
                  <span className="cmd-chip neutral">{task.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card cmd-card">
            <div className="cmd-card-head">
              <div>
                <div className="cmd-kicker">{t('cmdfin.incidents','Incidents')}</div>
                <h3>{t('cmdfin.activeIncidents','Active incidents')}</h3>
              </div>
              <button className="btn secondary small" onClick={() => go('health')}>{t('cmdfin.viewIncidents','View incidents')}</button>
            </div>
            <div className="cmd-list">
              {incidents.map((incident) => (
                <div key={incident.title} className="cmd-list-row">
                  <div className="cmd-label">{incident.title}</div>
                  <span className="cmd-chip warning">{incident.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
