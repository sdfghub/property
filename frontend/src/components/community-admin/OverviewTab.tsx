import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { BillingEntitiesPeriodView } from './BillingEntitiesPeriodView'
import { BillTemplatesHost } from '../bills/BillTemplatesHost'
import { MeterTemplatesHost } from '../meters/MeterTemplatesHost'

type EditablePeriod = {
  period?: { code: string; status: string }
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canClose?: boolean
  canPrepare?: boolean
} | null

type DashboardData = {
  currentPeriod?: EditablePeriod
  lastClosedPeriod?: { code: string; closedAt?: string } | null
  tasks?: any[]
  incidents?: any[]
  upcomingEvents?: any[]
  ongoingPolls?: any[]
}

type Props = {
  editablePeriod: EditablePeriod
  onGoPeriod: () => void
  onGoMeters?: () => void
  onGoBills?: () => void
  onAddInvoice?: () => void
  onPrepare?: () => void
  onClose?: () => void
  busy?: 'prepare' | 'close' | 'reopen' | 'create' | null
  onRecompute?: () => void
  summary?: any | null
  summaryError?: string | null
  summaryLoading?: boolean
  onLoadSummary?: () => void
  lastClosed?: { code: string; closedAt?: string } | null
  onReopen?: () => void
  onReopenPrepared?: () => void
  onCreatePeriod?: () => void
  onGoStatements?: () => void
  lastClosedSummary?: any | null
  onLoadLastClosedSummary?: () => void
  communityId?: string
  programs?: any[]
  invoices?: any[]
  invoicesLoading?: boolean
  invoicesError?: string | null
  onReloadInvoices?: () => void
  onLinkInvoice?: (
    invoiceId: string,
    programId: string,
    amount?: number | null,
    portionKey?: string | null,
    newInvoicePayload?: any,
  ) => Promise<string | null>
  dashboardData?: DashboardData | null
  dashboardLoading?: boolean
  dashboardError?: string | null
  onEnsurePrograms?: () => void
  onEnsureInvoices?: () => void
}

export function OverviewTab({
  communityId,
  editablePeriod,
  onGoPeriod,
  onGoMeters,
  onGoBills,
  onPrepare,
  onClose,
  busy,
  onRecompute,
  summary,
  summaryError,
  summaryLoading,
  onLoadSummary,
  lastClosed,
  onReopen,
  onReopenPrepared,
  onCreatePeriod,
  onGoStatements,
  lastClosedSummary,
  onLoadLastClosedSummary,
  onAddInvoice,
  programs = [],
  invoices = [],
  invoicesLoading,
  invoicesError,
  onReloadInvoices,
  onLinkInvoice,
  dashboardData,
  dashboardLoading,
  dashboardError,
  onEnsurePrograms,
  onEnsureInvoices,
}: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [linkInvoiceId, setLinkInvoiceId] = React.useState('')
  const [linkProgramId, setLinkProgramId] = React.useState('')
  const [linkAmount, setLinkAmount] = React.useState('')
  const [linkPortionKey, setLinkPortionKey] = React.useState('')
  const [linkBusy, setLinkBusy] = React.useState(false)
  const [showInvoiceForm, setShowInvoiceForm] = React.useState(false)
  const [showNewInvoice, setShowNewInvoice] = React.useState(false)
  const [newInv, setNewInv] = React.useState({
    vendorName: '',
    number: '',
    gross: '',
    currency: 'RON',
    issueDate: '',
  })
  const [showCustomForm, setShowCustomForm] = React.useState(false)
  const [customDesc, setCustomDesc] = React.useState('')
  const [customAmount, setCustomAmount] = React.useState('')
  const [customCurrency, setCustomCurrency] = React.useState('RON')
  const [customBusy, setCustomBusy] = React.useState(false)
  const [customMsg, setCustomMsg] = React.useState<string | null>(null)
  const [customTypeId, setCustomTypeId] = React.useState<string | null>(null)
  const [customAllocationMethod, setCustomAllocationMethod] = React.useState<string | null>(null)
  const [customAllocationParams, setCustomAllocationParams] = React.useState('')
  const [expenseTypes, setExpenseTypes] = React.useState<any[]>([])
  const [typesLoading, setTypesLoading] = React.useState(false)
  const [showMeterTemplates, setShowMeterTemplates] = React.useState(false)
  const [showBillTemplates, setShowBillTemplates] = React.useState(false)
  const [periodExpenses, setPeriodExpenses] = React.useState<any[]>([])
  const [expensesLoading, setExpensesLoading] = React.useState(false)
  const [expensesError, setExpensesError] = React.useState<string | null>(null)
  const [tasks, setTasks] = React.useState<any[]>([])
  const [incidents, setIncidents] = React.useState<any[]>([])
  const [ticketsLoading, setTicketsLoading] = React.useState(false)
  const [ticketsError, setTicketsError] = React.useState<string | null>(null)
  const [upcomingEvents, setUpcomingEvents] = React.useState<any[]>([])
  const [ongoingPolls, setOngoingPolls] = React.useState<any[]>([])
  const [eventsLoading, setEventsLoading] = React.useState(false)
  const [pollsLoading, setPollsLoading] = React.useState(false)
  const [eventsError, setEventsError] = React.useState<string | null>(null)
  const [pollsError, setPollsError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!showInvoiceForm && !showNewInvoice) return
    onEnsurePrograms?.()
    onEnsureInvoices?.()
  }, [onEnsurePrograms, onEnsureInvoices, showInvoiceForm, showNewInvoice])

  React.useEffect(() => {
    if (typeof dashboardLoading === 'boolean') {
      setTicketsLoading(dashboardLoading)
      setEventsLoading(dashboardLoading)
      setPollsLoading(dashboardLoading)
    }
    if (dashboardLoading) return
    if (dashboardError) {
      setTicketsError(dashboardError)
      setEventsError(dashboardError)
      setPollsError(dashboardError)
      setTasks([])
      setIncidents([])
      setUpcomingEvents([])
      setOngoingPolls([])
      return
    }
    setTicketsError(null)
    setEventsError(null)
    setPollsError(null)
    setTasks(dashboardData?.tasks ?? [])
    setIncidents(dashboardData?.incidents ?? [])
    setUpcomingEvents(dashboardData?.upcomingEvents ?? [])
    setOngoingPolls(dashboardData?.ongoingPolls ?? [])
  }, [dashboardData, dashboardError, dashboardLoading])

  React.useEffect(() => {
    if (!communityId || !editablePeriod?.period?.code || !showCustomForm) return
    setTypesLoading(true)
    api
      .get<any[]>(`/communities/${communityId}/periods/${editablePeriod.period.code}/expense-types`)
      .then((rows: any) => {
        const list = Array.isArray(rows)
          ? rows
          : Array.isArray(rows?.items)
          ? rows.items
          : Array.isArray(rows?.types)
          ? rows.types
          : []
        setExpenseTypes(list || [])
      })
      .catch((err: any) => {
        console.error('load expense types', err)
        setExpenseTypes([])
      })
      .finally(() => setTypesLoading(false))
  }, [api, communityId, editablePeriod?.period?.code, showCustomForm])

  React.useEffect(() => {
    if (!showCustomForm) return
    if (!communityId || !editablePeriod?.period?.code) return
    setExpensesLoading(true)
    setExpensesError(null)
    api
      .get<{ items: any[] }>(`/communities/${communityId}/periods/${editablePeriod.period.code}/expenses`)
      .then((res) => setPeriodExpenses(Array.isArray(res?.items) ? res.items : []))
      .catch((err: any) => {
        setPeriodExpenses([])
        setExpensesError(err?.message || 'Failed to load expenses')
      })
      .finally(() => setExpensesLoading(false))
  }, [api, communityId, editablePeriod?.period?.code, showCustomForm])


  const canLink =
    !!onLinkInvoice &&
    !!linkInvoiceId &&
    !!linkProgramId &&
    editablePeriod?.period?.status === 'OPEN'

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canLink || !onLinkInvoice) return
    setLinkBusy(true)
    try {
      await onLinkInvoice(
        linkInvoiceId,
        linkProgramId,
        linkAmount ? Number(linkAmount) : null,
        linkPortionKey || null,
      )
      setLinkAmount('')
      setLinkPortionKey('')
    } finally {
      setLinkBusy(false)
    }
  }
  return (
    <div className="grid three">
      <div className="card soft">
        <h3>{t('card.period.title')}</h3>
        {editablePeriod?.period ? (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{editablePeriod.period.code}</h4>
              <span className="badge secondary">{t(editablePeriod.period.status)}</span>
            </div>
            {/* <div className="muted">{t('card.period.subtitle')}</div>*/}
            {editablePeriod.period.status === 'OPEN' && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn secondary small"
                    type="button"
                    onClick={() => {
                      setShowCustomForm(false)
                      setShowMeterTemplates(false)
                      setShowBillTemplates(false)
                      setShowInvoiceForm((v) => !v)
                    }}
                  >
                    {showInvoiceForm
                      ? t('payments.hideForm', 'Hide invoice form')
                      : t('card.period.addInvoice', 'Add invoice & link to program')}
                  </button>
                  <button
                    className="btn secondary small"
                    type="button"
                    onClick={() => {
                      setShowInvoiceForm(false)
                      setShowMeterTemplates(false)
                      setShowBillTemplates(false)
                      setShowCustomForm((v) => !v)
                    }}
                  >
                    {t('card.period.addCustomExpense', 'Add custom expense')}
                  </button>
                  <button
                    className="btn secondary small"
                    type="button"
                    onClick={() => {
                      setShowInvoiceForm(false)
                      setShowCustomForm(false)
                      setShowBillTemplates(false)
                      setShowMeterTemplates((v) => !v)
                    }}
                    style={{
                      background: showMeterTemplates ? 'rgba(43,212,213,0.15)' : undefined,
                      borderColor: showMeterTemplates ? 'rgba(43,212,213,0.5)' : undefined,
                    }}
                  >
                    {t('card.period.metersStatus', {
                      closed: editablePeriod.meters?.closed ?? 0,
                      total: editablePeriod.meters?.total ?? 0,
                    })}
                  </button>
                  <button
                    className="btn secondary small"
                    type="button"
                    onClick={() => {
                      setShowInvoiceForm(false)
                      setShowCustomForm(false)
                      setShowMeterTemplates(false)
                      setShowBillTemplates((v) => !v)
                    }}
                    style={{
                      background: showBillTemplates ? 'rgba(43,212,213,0.15)' : undefined,
                      borderColor: showBillTemplates ? 'rgba(43,212,213,0.5)' : undefined,
                    }}
                  >
                    {t('card.period.billsStatus', {
                      closed: editablePeriod.bills?.closed ?? 0,
                      total: editablePeriod.bills?.total ?? 0,
                    })}
                  </button>
                  {onReloadInvoices && showInvoiceForm && (
                    <button className="btn ghost small" type="button" onClick={onReloadInvoices} disabled={!!invoicesLoading}>
                      {t('payments.reload', 'Reload')}
                    </button>
                  )}
                  {showInvoiceForm && invoicesLoading && <span className="muted">{t('communities.loading', 'Loading...')}</span>}
                  {showInvoiceForm && invoicesError && <span className="badge negative">{invoicesError}</span>}
                </div>
            {showInvoiceForm && (
              <div className="stack" style={{ gap: 6 }}>
                    <form className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={handleLink}>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => setShowNewInvoice((v) => !v)}
                        style={{ marginLeft: 4 }}
                      >
                        {showNewInvoice ? t('payments.hideForm', 'Hide invoice form') : t('payments.add', 'Add invoice')}
                      </button>
                    {showNewInvoice && (
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          className="input"
                          style={{ width: 160 }}
                          placeholder={t('payments.vendor', 'Vendor')}
                          value={newInv.vendorName}
                          onChange={(e) => setNewInv((s) => ({ ...s, vendorName: e.target.value }))}
                          required
                        />
                        <input
                          className="input"
                          style={{ width: 120 }}
                          placeholder={t('payments.number', 'Number')}
                          value={newInv.number}
                          onChange={(e) => setNewInv((s) => ({ ...s, number: e.target.value }))}
                          required
                        />
                        <input
                          className="input"
                          style={{ width: 100 }}
                          type="number"
                          step="0.01"
                          placeholder={t('payments.amount', 'Amount')}
                          value={newInv.gross}
                          onChange={(e) => setNewInv((s) => ({ ...s, gross: e.target.value }))}
                        />
                        <input
                          className="input"
                          style={{ width: 80 }}
                          placeholder={t('payments.currency', 'Currency')}
                          value={newInv.currency}
                          onChange={(e) => setNewInv((s) => ({ ...s, currency: e.target.value }))}
                        />
                        <input
                          className="input"
                          style={{ width: 140 }}
                          type="date"
                          value={newInv.issueDate}
                          onChange={(e) => setNewInv((s) => ({ ...s, issueDate: e.target.value }))}
                        />
                        <button
                          className="btn secondary small"
                          type="button"
                          disabled={linkBusy || !newInv.vendorName || !newInv.number}
                          onClick={async () => {
                            if (!newInv.vendorName || !newInv.number) return
                            setLinkBusy(true)
                            try {
                              const createdId = await onLinkInvoice?.('__create__', '', undefined, undefined, newInv)
                              if (createdId) {
                                setLinkInvoiceId(createdId)
                              }
                              setNewInv({ vendorName: '', number: '', gross: '', currency: 'RON', issueDate: '' })
                              setShowNewInvoice(false)
                            } finally {
                              setLinkBusy(false)
                            }
                          }}
                        >
                          {linkBusy ? t('common.loading') || 'Working…' : t('payments.save', 'Save invoice')}
                        </button>
                      </div>
                    )}
                     <br></br>
                      <div>Selecteaza factura existenta</div>
                      <select
                        className="input"
                        style={{ minWidth: 180 }}
                        value={linkInvoiceId}
                        onChange={(e) => setLinkInvoiceId(e.target.value)}
                      >
                        <option value="">{t('payments.selectInvoice', 'Select invoice')}</option>
                        {(invoices || []).map((inv: any) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.vendorName || inv.number || inv.id}
                          </option>
                        ))}
                      </select>
                      Selecteaza programul din care s-a efectuat plata
                      <select
                        className="input"
                        style={{ minWidth: 180 }}
                        value={linkProgramId}
                        onChange={(e) => setLinkProgramId(e.target.value)}
                      >
                        <option value="">{t('programs.select', 'Select program')}</option>
                        {programs.map((p: any) => (
                          <option key={p.id || p.code} value={p.id}>
                            {p.name || p.code}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        style={{ width: 100 }}
                        type="number"
                        step="0.01"
                        placeholder={t('payments.amount', 'Amount')}
                        value={linkAmount}
                        onChange={(e) => setLinkAmount(e.target.value)}
                      />
                      <input
                        className="input"
                        style={{ width: 120 }}
                        placeholder={t('programs.portionKey', 'Portion key')}
                        value={linkPortionKey}
                        onChange={(e) => setLinkPortionKey(e.target.value)}
                      />
                      <button className="btn primary small" type="submit" disabled={!canLink || linkBusy}>
                        {linkBusy ? t('common.loading') || 'Working…' : t('programs.linkInvoice', 'Link invoice')}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
            {editablePeriod.period.status === 'OPEN' && showMeterTemplates && communityId && editablePeriod.period.code && (
              <div className="stack" style={{ marginTop: 8 }}>
                <MeterTemplatesHost
                  communityId={communityId}
                  periodCode={editablePeriod.period.code}
                  canEdit
                  onStatusChange={() => {
                    // refresh badges if needed by caller
                  }}
                />
              </div>
            )}
            {editablePeriod.period.status === 'OPEN' && showBillTemplates && communityId && editablePeriod.period.code && (
              <div className="stack" style={{ marginTop: 8 }}>
                <BillTemplatesHost
                  communityId={communityId}
                  periodCode={editablePeriod.period.code}
                  canEdit
                  onStatusChange={() => {
                    // refresh badges if needed by caller
                  }}
                />
              </div>
            )}
            {editablePeriod.period.status === 'OPEN' && showCustomForm && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="muted">{t('card.period.addCustomExpense', 'Add custom expense')}</div>
                <form
                  className="grid two"
                  style={{ gap: 10, alignItems: 'center' }}
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!communityId || !editablePeriod.period?.code) return
                    if (!customTypeId) {
                      setCustomMsg(t('exp.typeRequired', 'Select an expense type to continue'))
                      return
                    }
                    setCustomBusy(true)
                    setCustomMsg(null)
                    try {
                      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/expenses`, {
                        description: customDesc,
                        amount: Number(customAmount),
                        currency: customCurrency || 'RON',
                        expenseTypeId: customTypeId || undefined,
                        allocationMethod: customAllocationMethod || undefined,
                        allocationParams: customAllocationParams ? JSON.parse(customAllocationParams) : undefined,
                      })
                      setCustomDesc('')
                      setCustomAmount('')
                      setCustomTypeId(null)
                      setCustomAllocationMethod(null)
                      setCustomAllocationParams('')
                      setCustomMsg(t('exp.added', 'Custom expense added'))
                    } catch (err: any) {
                      setCustomMsg(err?.message || 'Failed to add expense')
                    } finally {
                      setCustomBusy(false)
                    }
                  }}
                >
                  <div className="stack">
                    <label className="label">
                      <span>{t('exp.desc', 'Description')}</span>
                    </label>
                    <input
                      className="input"
                      value={customDesc}
                      onChange={(e) => setCustomDesc(e.target.value)}
                      required
                    />
                  </div>
                  <div className="stack">
                    <label className="label">
                      <span>{t('exp.amount', 'Amount')}</span>
                    </label>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <input
                        className="input"
                        style={{ width: 110 }}
                        type="number"
                        step="0.01"
                        placeholder={t('exp.amount', 'Amount')}
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        required
                      />
                      <input
                        className="input"
                        style={{ width: 80 }}
                        placeholder={t('payments.currency', 'Currency')}
                        value={customCurrency}
                        onChange={(e) => setCustomCurrency(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="stack">
                    <label className="label">
                      <span>{t('exp.type', 'Expense type')}</span>
                      {typesLoading && <span className="muted" style={{ marginLeft: 6 }}>{t('common.loading')}</span>}
                    </label>
                    <select
                      className="input"
                      value={customTypeId || ''}
                      onChange={(e) => setCustomTypeId(e.target.value || null)}
                      disabled={typesLoading}
                    >
                      <option value="">{t('exp.customType', 'Custom type')}</option>
                      {expenseTypes.map((et) => (
                        <option key={et.id} value={et.id}>
                          {et.code} — {et.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="stack">
                    <label className="label">
                      <span>{t('exp.customAlloc', 'Custom allocation')}</span>
                    </label>
                    <div className="stack" style={{ gap: 6 }}>
                      <select
                        className="input"
                        value={customAllocationMethod || ''}
                        onChange={(e) => setCustomAllocationMethod(e.target.value || null)}
                      >
                        <option value="">{t('exp.customAlloc', 'Custom allocation')}</option>
                        <option value="EQUAL">EQUAL</option>
                        <option value="BY_SQM">BY_SQM</option>
                        <option value="BY_RESIDENTS">BY_RESIDENTS</option>
                        <option value="BY_CONSUMPTION">BY_CONSUMPTION</option>
                        <option value="MIXED">MIXED</option>
                      </select>
                      <textarea
                        className="input"
                        rows={2}
                        placeholder={t('exp.customParams', 'Allocation params (JSON)')}
                        value={customAllocationParams}
                        onChange={(e) => setCustomAllocationParams(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button
                      className="btn primary small"
                      type="submit"
                      disabled={customBusy || !customDesc || !customAmount || !customTypeId}
                    >
                      {customBusy ? t('common.loading') || 'Working…' : t('exp.add', 'Add')}
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => setShowCustomForm(false)}>
                      {t('payments.hideForm', 'Hide')}
                    </button>
                  </div>
                  <div className="stack" style={{ gap: 4 }}>
                    {expensesLoading && <span className="muted">{t('communities.loading', 'Loading...')}</span>}
                    {expensesError && <span className="badge negative">{expensesError}</span>}
                  </div>
                </form>
                {customMsg && <div className="badge">{customMsg}</div>}
              </div>
            )}
            {!expensesLoading && (periodExpenses || []).length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>{t('exp.customList', 'Custom expenses entered')}</div>
                <ul className="muted" style={{ margin: 0, paddingLeft: 16 }}>
                  {(periodExpenses || []).map((e) => (
                    <li key={e.id}>
                      {e.description || e.id} — {e.allocatableAmount ?? e.amount ?? e.value ?? ''} {e.currency || 'RON'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(invoices || []).length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('payments.currentInvoices', 'Invoices for this period')}
                </div>
                <ul className="muted" style={{ margin: 0, paddingLeft: 16 }}>
                  {invoices.map((inv: any) => (
                    <li key={inv.id}>
                      {(inv.vendor?.name || inv.vendorName || inv.number || inv.id) as string}{' '}
                      {inv.gross ? `— ${inv.gross} ${inv.currency || ''}` : ''}
                      {inv.status ? ` (${inv.status})` : ''}
                      {inv.programInvoices?.length
                        ? ` · ${t('programs.label', 'Programs')}: ${inv.programInvoices
                            .map((pl: any) => pl.program?.name || pl.program?.code || pl.programId)
                            .join(', ')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {editablePeriod.period?.status !== 'OPEN' && (
                <>
                  <div className="badge">
                    {t('card.period.metersStatus', {
                      closed: editablePeriod.meters?.closed ?? 0,
                      total: editablePeriod.meters?.total ?? 0,
                    })}
                  </div>
                  <div className="badge">
                    {t('card.period.billsStatus', {
                      closed: editablePeriod.bills?.closed ?? 0,
                      total: editablePeriod.bills?.total ?? 0,
                    })}
                  </div>
                </>
              )}
              {/*!editablePeriod.canClose && (
                <div className="badge warn">
                  {t('card.period.openItems', {
                    meters: (editablePeriod.meters?.open || []).length,
                    bills: (editablePeriod.bills?.open || []).length,
                  })}
                </div>
              )*/}
            </div>
            <hr/>
            {(editablePeriod.canClose || editablePeriod.canPrepare || editablePeriod.period?.status === 'PREPARED') && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {editablePeriod.canPrepare && onPrepare && (
                  <button className="btn primary small" type="button" onClick={onPrepare} disabled={busy === 'prepare'}>
                    {busy === 'prepare' ? t('common.loading') || 'Working…' : t('card.period.prepare') || 'Prepare period'}
                  </button>
                )}
                {editablePeriod.canClose && onClose && (
                  <button className="btn primary small" type="button" onClick={onClose} disabled={busy === 'close'}>
                    {busy === 'close' ? t('common.loading') || 'Working…' : t('card.period.close') || 'Close period'}
                  </button>
                )}
                {editablePeriod.period?.status === 'PREPARED' && onRecompute && (
                  <button className="btn secondary small" type="button" onClick={onRecompute} disabled={busy === 'prepare'}>
                    {busy === 'prepare' ? t('common.loading') || 'Working…' : t('card.period.recompute') || 'Rerun allocations'}
                  </button>
                )}
                {editablePeriod.period?.status === 'PREPARED' && onReopenPrepared && (
                  <button className="btn tertiary small" type="button" onClick={onReopenPrepared} disabled={busy === 'reopen'}>
                    {busy === 'reopen' ? t('common.loading') || 'Working…' : t('card.period.reopen') || 'Reopen period'}
                  </button>
                )}
              </div>
            )}
            {editablePeriod.period?.status === 'PREPARED' && !summary && onLoadSummary && (
              <button
                className="btn secondary small"
                type="button"
                onClick={onLoadSummary}
                disabled={summaryLoading}
              >
                {summaryLoading ? t('common.loading') || 'Loading…' : t('card.period.loadSummary', 'Load summary')}
              </button>
            )}
            {summaryLoading && <div className="muted">{t('common.loading') || 'Loading…'}</div>}
            {summaryError && <div className="badge negative">{summaryError}</div>}
            {summary && editablePeriod.period?.status === 'PREPARED' && (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {summary.beBuckets?.length ? <BillingEntitiesPeriodView summary={summary} /> : null}
              </div>
            )}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            {t('card.period.noActive')}{' '}
            {onCreatePeriod && (
              <button
                className="btn primary small"
                type="button"
                onClick={onCreatePeriod}
                style={{ marginLeft: 6 }}
                disabled={busy === 'create'}
              >
                {busy === 'create' ? t('common.loading') || 'Working…' : t('card.period.create') || 'Create period'}
              </button>
            )}
          </p>
        )}
        {/*<div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span className="muted">{t('nav.gotoPeriodHint') || 'Jump to current period work:'}</span>
          <button className="btn tertiary" type="button" onClick={onGoPeriod}>
            {t('nav.gotoPeriod') || 'Go to period'}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          {t('card.period.prevNext')}
        </div>
        */}
      </div>
      <div className="card soft">
        <div className="muted">{t('card.period.prevNext')}</div>
        {lastClosed ? (
          <div className="stack" style={{ marginTop: 6 }}>
            <div>
              <strong>{t('card.period.lastClosed') || 'Last closed period'}:</strong> {lastClosed.code}
            </div>
            {lastClosed.closedAt && (
              <div className="muted" style={{ fontSize: 12 }}>
                {t('card.period.closedAt') || 'Closed at'}: {lastClosed.closedAt}
              </div>
            )}
            {onReopen && (
              <button
                className="btn tertiary small"
                type="button"
                onClick={onReopen}
                style={{ maxWidth: '160px' }}
                disabled={busy === 'reopen'}
              >
                {busy === 'reopen' ? t('common.loading') || 'Working…' : t('card.period.reopen') || 'Reopen period'}
              </button>
            )}
            {lastClosedSummary && lastClosedSummary.beBuckets?.length ? (
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <div className="muted">{t('card.period.lastClosedSummary', 'Summary')}</div>
                <BillingEntitiesPeriodView summary={lastClosedSummary} />
              </div>
            ) : (
              onLoadLastClosedSummary && (
                <button className="btn secondary small" type="button" onClick={onLoadLastClosedSummary}>
                  {t('card.period.loadSummary', 'Load summary')}
                </button>
              )
            )}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>{t('card.period.noClosed') || 'No closed periods'}</div>
        )}
      </div>
      <div className="card soft">
        <h3>{t('card.tasks.title', 'Upcoming tasks')}</h3>
        {ticketsLoading ? (
          <div className="muted">{t('card.tasks.loading', 'Loading…')}</div>
        ) : ticketsError ? (
          <div className="badge negative">{ticketsError}</div>
        ) : tasks.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {tasks.map((task) => (
              <div key={task.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="badge secondary">{task.status}</span>
                <span>{task.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">{t('card.tasks.empty', 'No upcoming tasks')}</div>
        )}
      </div>
      <div className="card soft">
        <h3>{t('card.incidents.title', 'Active incidents')}</h3>
        {ticketsLoading ? (
          <div className="muted">{t('card.incidents.loading', 'Loading…')}</div>
        ) : ticketsError ? (
          <div className="badge negative">{ticketsError}</div>
        ) : incidents.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {incidents.map((incident) => (
              <div key={incident.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span className="badge secondary">{incident.status}</span>
                <span>{incident.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">{t('card.incidents.empty', 'No active incidents')}</div>
        )}
      </div>
      <div className="card soft">
        <h3>{t('card.events.title', 'Upcoming events')}</h3>
        {eventsLoading ? (
          <div className="muted">{t('card.events.loading', 'Loading…')}</div>
        ) : eventsError ? (
          <div className="badge negative">{eventsError}</div>
        ) : upcomingEvents.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {upcomingEvents.map((event) => (
              <div key={event.id} className="stack" style={{ gap: 2 }}>
                <strong>{event.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(event.startAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">{t('card.events.empty', 'No upcoming events')}</div>
        )}
      </div>
      <div className="card soft">
        <h3>{t('card.polls.title', 'Ongoing polls')}</h3>
        {pollsLoading ? (
          <div className="muted">{t('card.polls.loading', 'Loading…')}</div>
        ) : pollsError ? (
          <div className="badge negative">{pollsError}</div>
        ) : ongoingPolls.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {ongoingPolls.map((poll) => (
              <div key={poll.id} className="stack" style={{ gap: 2 }}>
                <strong>{poll.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('card.polls.ends', { date: new Date(poll.endAt).toLocaleString() })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">{t('card.polls.empty', 'No ongoing polls')}</div>
        )}
      </div>
      {/*
      <div className="card soft">
        <div className="muted">{t('card.financials.label')}</div>
        <h3>{t('card.financials.title')}</h3>
        <p className="muted">{t('card.financials.subtitle')}</p>
        <ul className="muted" style={{ marginTop: 8 }}>
          <li>{t('card.financials.charges')}</li>
          <li>{t('card.financials.payments')}</li>
          <li>{t('card.financials.balance')}</li>
        </ul>
      </div>
      <div className="card soft">
        <div className="muted">{t('card.quick.label')}</div>
        <h3>{t('card.quick.title')}</h3>
        <p className="muted">{t('card.quick.subtitle')}</p>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button">
            {t('card.quick.addExpense')}
          </button>
          <button className="btn secondary" type="button">
            {t('card.quick.uploadMeters')}
          </button>
          <button className="btn secondary" type="button">
            {t('card.quick.sendInvite')}
          </button>
        </div>
      </div>
      */}
    </div>
  )
}
