// Invoices & expenses tab: per-period bill templates (the expense-entry mechanism).
//
// NOTE: an older per-period "expenses" model (GET/POST /periods/:code/expenses[/status]) was
// removed from the backend; the bill-template flow (BillTemplatesHost) replaced it. The legacy
// quick-add / custom-expense UI that called those endpoints was deleted here — it only produced
// 404s. Expenses are now entered as bill-template actuals.
import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { BillTemplatesHost } from './bills/BillTemplatesHost'

export function CommunityExpensesPanel({
  communityId,
  onBillStatusChange,
}: {
  communityId: string
  onBillStatusChange?: (summary: { total: number; closed: number }) => void
}) {
  const { api } = useAuth()
  const [openPeriods, setOpenPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [periodCode, setPeriodCode] = React.useState('')
  const [message, setMessage] = React.useState<string | null>(null)
  const [editable, setEditable] = React.useState<{ period?: { code: string; status: string } } | null>(null)
  const editablePeriod = editable?.period?.code || openPeriods[0]?.code || ''
  const canEdit = periodCode === editablePeriod && !!editablePeriod

  React.useEffect(() => {
    if (editable?.period?.code && editable?.period?.status !== 'CLOSED' && periodCode !== editable.period.code) {
      setPeriodCode(editable.period.code)
    }
  }, [editable?.period?.code, editable?.period?.status])

  React.useEffect(() => {
    if (!communityId) return
    setMessage(null)
    let alive = true
    // Load period sources together and choose the default ONCE with a clear precedence —
    // editable/open first, closed only as a last resort — so this tab opens the current month,
    // not a previous CLOSED one.
    Promise.all([
      api.get<any>(`/communities/${communityId}/periods/editable`).catch(() => null),
      api.get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/open`).catch(() => [] as any[]),
      api.get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/closed`).catch(() => [] as any[]),
    ])
      .then(([ed, open, closed]) => {
        if (!alive) return
        const openRows = Array.isArray(open) ? open : []
        const closedRows = Array.isArray(closed) ? closed : []
        setEditable(ed || null)
        setOpenPeriods(openRows)
        const preferred =
          (ed?.period?.code && ed.period.status !== 'CLOSED' ? ed.period.code : '') ||
          openRows[0]?.code ||
          closedRows[0]?.code ||
          ''
        // Don't clobber an existing (user) selection.
        setPeriodCode((cur) => cur || preferred)
      })
      .catch((err: any) => { if (alive) setMessage(err?.message || 'Could not load periods') })
    return () => { alive = false }
  }, [api, communityId])

  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
      {communityId && periodCode ? (
        <BillTemplatesHost
          communityId={communityId}
          periodCode={periodCode}
          canEdit={canEdit}
          onStatusChange={onBillStatusChange}
        />
      ) : null}
      {message && <div className="badge negative">{message}</div>}
    </div>
  )
}
