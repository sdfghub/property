import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import type { Community } from '../../api/types'
import { API_BASE } from '../../api/client'
import { CommunityUsersPanel } from '../CommunityUsersPanel'
import { CommunityExpensesPanel } from '../CommunityExpensesPanel'
import { CommunityMetersPanel } from '../CommunityMetersPanel'
import { PeriodAdmin } from '../PeriodAdmin'
import { OverviewTab } from './OverviewTab'
import { ConfigTab } from './ConfigTab'
import { ProgramsTab } from './ProgramsTab'
import { EventsTab } from './EventsTab'
import { PollsTab } from './PollsTab'
import { NotificationsTab } from './NotificationsTab'
import { CommunicationsTab } from './CommunicationsTab'
import { InventoryTab } from './InventoryTab'

export type CommunityAdminTabKey =
  | 'overview'
  | 'config'
  | 'meters'
  | 'expenses'
  | 'programs'
  | 'events'
  | 'polls'
  | 'communications'
  | 'inventory'
  | 'notifications'
  | 'payments'
  | 'statements'
  | 'users'
  | 'health'
  | 'periodFocus'

type Props = {
  forceCommunityId?: string
  requestedTab?: CommunityAdminTabKey | null
  onTabRequestHandled?: () => void
  communitiesOverride?: Community[]
  onCommunityConfigLoaded?: (community: { id?: string; code?: string; name?: string } | null, billingEntities: any[]) => void
}

export function CommunityAdminDashboard({
  forceCommunityId,
  requestedTab,
  onTabRequestHandled,
  communitiesOverride,
  onCommunityConfigLoaded,
}: Props) {
  const { api, activeRole } = useAuth()
  const { t } = useI18n()
  const [communities, setCommunities] = React.useState<Community[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<CommunityAdminTabKey>('overview')
  const [configJson, setConfigJson] = React.useState<any>(null)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const [metersConfig, setMetersConfig] = React.useState<any | null>(null)
  const [programs, setPrograms] = React.useState<any[]>([])
  const [programError, setProgramError] = React.useState<string | null>(null)
  const [editablePeriod, setEditablePeriod] = React.useState<{
    period?: { code: string; status: string }
    meters?: { total: number; closed: number; open?: string[] }
    bills?: { total: number; closed: number; open?: string[] }
    canClose?: boolean
    canPrepare?: boolean
  } | null>(null)
  const [lastClosed, setLastClosed] = React.useState<{ code: string; closedAt?: string } | null>(null)
  const [lastClosedSummary, setLastClosedSummary] = React.useState<any | null>(null)
  const [busy, setBusy] = React.useState<null | 'prepare' | 'close' | 'reopen' | 'create'>(null)
  const [summary, setSummary] = React.useState<any | null>(null)
  const [summaryError, setSummaryError] = React.useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = React.useState(false)
  const [payments, setPayments] = React.useState<any[]>([])
  const [paymentsError, setPaymentsError] = React.useState<string | null>(null)
  const [paymentsLoading, setPaymentsLoading] = React.useState(false)
  const [showPaymentForm, setShowPaymentForm] = React.useState(false)
  const [navCollapsed, setNavCollapsed] = React.useState(false)
  const [dashboardData, setDashboardData] = React.useState<any | null>(null)
  const [dashboardLoading, setDashboardLoading] = React.useState(false)
  const [dashboardError, setDashboardError] = React.useState<string | null>(null)
  const [programsLoadedFor, setProgramsLoadedFor] = React.useState<string | null>(null)
  const [invoicesLoadedFor, setInvoicesLoadedFor] = React.useState<string | null>(null)
  const [newPayment, setNewPayment] = React.useState({
    billingEntityId: '',
    amount: '',
    currency: 'RON',
    ts: '',
    method: '',
    refId: '',
    applyMode: 'fifo',
  })
  const [overviewInv, setOverviewInv] = React.useState<any[]>([])
  const [overviewInvLoading, setOverviewInvLoading] = React.useState(false)
  const [overviewInvError, setOverviewInvError] = React.useState<string | null>(null)

  const navGroups: Array<{ label: string; items: Array<{ key: CommunityAdminTabKey; label: string }> }> = [
    {
      label: t('nav.core') || 'Core',
      items: [
        { key: 'overview', label: t('tab.overview') || 'Overview' },
        { key: 'programs', label: t('tab.programs') || 'Programs' },
        { key: 'events', label: t('tab.events') || 'Events' },
        { key: 'polls', label: t('tab.polls') || 'Polls' },
        { key: 'communications', label: t('tab.communications') || 'Communications' },
        { key: 'inventory', label: t('tab.inventory') || 'Inventory' },
        { key: 'notifications', label: t('tab.notifications') || 'Notifications' },
      ],
    },
    {
      label: t('nav.periodWork') || 'Period Work',
      items: [
        { key: 'periodFocus', label: t('tab.periodFocus') || 'Period' },
        { key: 'meters', label: t('tab.meters') || 'Meters' },
        { key: 'expenses', label: t('tab.expenses') || 'Expenses' },
        { key: 'statements', label: t('tab.statements') || 'Statements' },
      ],
    },
    {
      label: t('nav.admin') || 'Admin',
      items: [
        { key: 'users', label: t('tab.users') || 'Users' },
        { key: 'payments', label: t('tab.payments') || 'Payments' },
        { key: 'config', label: t('tab.config') || 'Config' },
        { key: 'health', label: t('tab.health') || 'Health' },
      ],
    },
  ]

  React.useEffect(() => {
    if (!requestedTab) return
    setActiveTab(requestedTab)
    onTabRequestHandled?.()
  }, [requestedTab, onTabRequestHandled])

  React.useEffect(() => {
    if (forceCommunityId) return
    if (!communitiesOverride || communitiesOverride.length === 0) return
    setCommunities(communitiesOverride)
    const scopedId = activeRole?.scopeId
    if (scopedId) {
      setSelectedId(scopedId)
    } else if (communitiesOverride.length) {
      setSelectedId(communitiesOverride[0].id)
    }
  }, [communitiesOverride, activeRole?.scopeId, forceCommunityId])

  React.useEffect(() => {
    const endpoint = forceCommunityId ? '/communities/public' : '/communities'
    if (!forceCommunityId && communitiesOverride && communitiesOverride.length) return
    api
      .get<Community[]>(endpoint)
      .then((rows) => {
        setCommunities(rows)
        const scopedId = forceCommunityId || activeRole?.scopeId
        if (scopedId) {
          setSelectedId(scopedId)
        } else if (rows.length) {
          setSelectedId(rows[0].id)
        }
      })
      .catch((err: any) => {
        if (forceCommunityId) {
          const fallback = { id: forceCommunityId, code: forceCommunityId, name: forceCommunityId } as Community
          setCommunities([fallback])
          setSelectedId(forceCommunityId)
        } else {
          setMessage(err?.message || 'Could not load communities')
        }
      })
  }, [api, activeRole?.scopeId, forceCommunityId])

  const activeCommunity = communities.find((c) => c.id === selectedId) ?? null
  const communityCode = activeCommunity?.code || forceCommunityId || ''
  const communityId = activeCommunity?.id || forceCommunityId || ''

  const fetchPayments = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    setPaymentsLoading(true)
    setPaymentsError(null)
    return fetch(`${API_BASE}/communities/${communityCode}/payments`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((rows) => setPayments(Array.isArray(rows) ? rows : []))
      .catch((err) => setPaymentsError(err?.message || 'Failed to load payments'))
      .finally(() => setPaymentsLoading(false))
  }, [communityCode])

  const refreshPrograms = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    setProgramError(null)
    return fetch(`${API_BASE}/community-programs/${communityCode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((rows) => setPrograms(Array.isArray(rows) ? rows : []))
      .catch((err) => setProgramError(err?.message || 'Failed to load programs'))
  }, [communityCode])

  const refreshEditable = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    return api
      .get<any>(`/communities/${communityCode}/periods/editable`)
      .then((res) => setEditablePeriod(res))
      .catch(() => setEditablePeriod(null))
  }, [api, communityCode])

  const refreshClosed = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    return api
      .get<Array<{ id: string; code: string; status: string; closedAt?: string }>>(`/communities/${communityCode}/periods/closed`)
      .then((rows) => {
        const last = rows?.[0]
        if (last?.status === 'CLOSED') {
          setLastClosed({ code: last.code, closedAt: (last as any).closedAt })
        } else {
          setLastClosed(null)
        }
      })
      .catch(() => setLastClosed(null))
  }, [api, communityCode])

  const loadSummary = React.useCallback(async () => {
    if (!communityCode || !editablePeriod?.period?.code) return
    setSummaryLoading(true)
    setSummaryError(null)
    try {
      const data = await api.get<any>(
        `/communities/${communityCode}/periods/${editablePeriod.period.code}/summary`,
      )
      setSummary(data || null)
    } catch (err: any) {
      setSummary(null)
      setSummaryError(err?.message || 'Failed to load summary')
    } finally {
      setSummaryLoading(false)
    }
  }, [api, communityCode, editablePeriod?.period?.code])

  const loadOverviewInvoices = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!communityCode) return
      setOverviewInvLoading(true)
      setOverviewInvError(null)
      try {
        const rows = await api.get<any[]>(`/communities/${communityCode}/invoices`, undefined, signal as any)
        const arr = Array.isArray(rows) ? rows : (rows as any)?.items || []
        if (!signal || !signal.aborted) setOverviewInv(arr || [])
      } catch (err: any) {
        if (signal && signal.aborted) return
        setOverviewInvError(err?.message || 'Failed to load invoices')
        setOverviewInv([])
      } finally {
        if (!signal || !signal.aborted) setOverviewInvLoading(false)
      }
    },
    [api, communityCode, editablePeriod?.period?.status],
  )

  const loadLastClosedSummary = React.useCallback(async () => {
    if (!communityCode || !lastClosed?.code) return
    try {
      const data = await api.get<any>(`/communities/${communityCode}/periods/${lastClosed.code}/summary`)
      setLastClosedSummary(data || null)
    } catch {
      setLastClosedSummary(null)
    }
  }, [api, communityCode, lastClosed?.code])

  React.useEffect(() => {
    if (!communityCode) {
      setSummary(null)
      setSummaryError(null)
    }
  }, [communityCode])

  React.useEffect(() => {
    if (!communityCode) return
    setConfigError(null)
    setProgramError(null)
    setPaymentsError(null)
  }, [communityCode])

  React.useEffect(() => {
    if (!communityId) {
      setDashboardData(null)
      setDashboardError(null)
      setDashboardLoading(false)
      return
    }
    let active = true
    setDashboardLoading(true)
    setDashboardError(null)
    api
      .get<any>(`/communities/${communityId}/dashboard`)
      .then((data) => {
        if (!active) return
        setDashboardData(data || null)
        if (data?.currentPeriod !== undefined) {
          setEditablePeriod(data.currentPeriod ?? null)
        }
        if (data?.lastClosedPeriod !== undefined) {
          setLastClosed(data?.lastClosedPeriod ?? null)
        }
      })
      .catch((err: any) => {
        if (!active) return
        setDashboardData(null)
        setDashboardError(err?.message || 'Failed to load dashboard')
      })
      .finally(() => {
        if (active) setDashboardLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityCode || activeTab !== 'payments') return
    fetchPayments()
  }, [activeTab, communityCode, fetchPayments])

  React.useEffect(() => {
    if (!communityCode || activeTab !== 'programs') return
    if (programsLoadedFor === communityCode) return
    setProgramsLoadedFor(communityCode)
    refreshPrograms()
  }, [activeTab, communityCode, programsLoadedFor, refreshPrograms])

  const ensureProgramsLoaded = React.useCallback(() => {
    if (!communityCode) return
    if (programsLoadedFor === communityCode) return
    setProgramsLoadedFor(communityCode)
    refreshPrograms()
  }, [communityCode, programsLoadedFor, refreshPrograms])

  const ensureInvoicesLoaded = React.useCallback(() => {
    if (!communityCode) return
    if (invoicesLoadedFor === communityCode) return
    setInvoicesLoadedFor(communityCode)
    loadOverviewInvoices()
  }, [communityCode, invoicesLoadedFor, loadOverviewInvoices])

  React.useEffect(() => {
    if (!communityCode) return
    if (activeTab !== 'meters' && activeTab !== 'config') return
    if (metersConfig && (metersConfig as any).__communityCode === communityCode) return
    fetch(`${API_BASE}/community-config/${communityCode}/meters`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data) => setMetersConfig({ ...data, __communityCode: communityCode }))
      .catch(() => setMetersConfig(null))
  }, [communityCode, activeTab, metersConfig])

  React.useEffect(() => {
    if (!communityCode) return
    const needsConfig = activeTab === 'config' || activeTab === 'communications' || activeTab === 'payments'
    if (!needsConfig) return
    if (configJson && (configJson as any)?.community?.code === communityCode) return
    setConfigError(null)
    fetch(`${API_BASE}/community-config/${communityCode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data) => {
        setConfigJson(data)
        onCommunityConfigLoaded?.(data?.community ?? null, data?.billingEntities ?? [])
      })
      .catch((err) => setConfigError(err?.message || 'Failed to load config'))
  }, [activeTab, communityCode, configJson, onCommunityConfigLoaded])

  const handlePrepare = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setBusy('prepare')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/prepare`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to prepare period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, editablePeriod?.period?.code, refreshEditable, refreshClosed])

  const handleClose = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setBusy('close')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/approve`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to close period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, editablePeriod?.period?.code, refreshEditable, refreshClosed])

  const handleReopen = React.useCallback(
    async (code?: string | null) => {
      const targetCode = code || lastClosed?.code
      if (!communityId || !targetCode) return
    try {
      setMessage(null)
      setBusy('reopen')
      await api.post(`/communities/${communityId}/periods/${targetCode}/reopen`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to reopen period')
    } finally {
      setBusy(null)
    }
    },
    [api, communityId, lastClosed?.code, refreshEditable, refreshClosed],
  )

  const handleCreatePeriod = React.useCallback(async () => {
    if (!communityId) return
    try {
      setMessage(null)
      setBusy('create')
      await api.post(`/communities/${communityId}/periods/create`, {})
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to create period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, refreshClosed, refreshEditable])

  if (!activeCommunity && !selectedId) {
    return (
      <div className="grid one" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="empty">{t('communities.empty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid one" style={{ marginTop: 18 }}>
      <div className="card">
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3>{activeCommunity?.name || forceCommunityId || 'Community'} ({activeCommunity?.code || forceCommunityId || 'N/A'})</h3>
            </div>
          </div>

          <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="card soft" style={{ minWidth: navCollapsed ? 56 : 220, maxWidth: navCollapsed ? 56 : 260 }}>
              <div className="stack" style={{ gap: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  {!navCollapsed && (
                    <div className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t('nav.menu') || 'Menu'}
                    </div>
                  )}
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => setNavCollapsed((v) => !v)}
                    title={navCollapsed ? 'Open menu' : 'Collapse menu'}
                  >
                    {navCollapsed ? '☰' : '×'}
                  </button>
                </div>
                {!navCollapsed &&
                  navGroups.map((group) => (
                    <div key={group.label} className="stack" style={{ gap: 6 }}>
                      <div className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {group.label}
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        {group.items.map((tab) => {
                          const isActive = activeTab === tab.key
                          return (
                            <button
                              key={tab.key}
                              className="btn secondary"
                              type="button"
                              onClick={() => setActiveTab(tab.key)}
                              style={{
                                justifyContent: 'flex-start',
                                padding: '10px 12px',
                                width: '100%',
                                background: isActive ? 'rgba(43,212,213,0.15)' : undefined,
                                borderColor: isActive ? 'rgba(43,212,213,0.5)' : undefined,
                              }}
                            >
                              {tab.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 280 }}>
              {activeTab === 'overview' && (
                <OverviewTab
                  communityId={activeCommunity!.id}
                  editablePeriod={editablePeriod}
                  onGoPeriod={() => setActiveTab('periodFocus')}
                  onGoMeters={() => setActiveTab('meters')}
                  onGoBills={() => setActiveTab('expenses')}
                  onAddInvoice={() => setActiveTab('expenses')}
                  onPrepare={handlePrepare}
                  onClose={handleClose}
                  busy={busy}
                  onRecompute={() => {
                    if (!communityId || !editablePeriod?.period?.code) return
                    setMessage(null)
                    setBusy('prepare')
                    api
                      .post(`/communities/${communityId}/periods/${editablePeriod.period.code}/recompute`)
                      .then(() => Promise.all([refreshEditable(), refreshClosed()]))
                      .catch((err: any) => setMessage(err?.message || 'Failed to recompute allocations'))
                      .finally(() => setBusy(null))
                  }}
                  lastClosed={lastClosed}
                  onReopen={() => handleReopen(null)}
                  onReopenPrepared={() => handleReopen(editablePeriod?.period?.code || null)}
                  onCreatePeriod={handleCreatePeriod}
                  summary={summary}
                  summaryError={summaryError}
                  summaryLoading={summaryLoading}
                  onLoadSummary={loadSummary}
                  onGoStatements={() => setActiveTab('statements')}
                  lastClosedSummary={lastClosedSummary}
                  onLoadLastClosedSummary={loadLastClosedSummary}
                  programs={programs}
                  invoices={overviewInv}
                  invoicesLoading={overviewInvLoading}
                  invoicesError={overviewInvError}
                  onReloadInvoices={() => loadOverviewInvoices()}
                  dashboardData={dashboardData}
                  dashboardLoading={dashboardLoading}
                  dashboardError={dashboardError}
                  onEnsurePrograms={ensureProgramsLoaded}
                  onEnsureInvoices={ensureInvoicesLoaded}
                  onLinkInvoice={async (invoiceId, programId, amount, portionKey, newInvoicePayload?: any) => {
                    // If invoiceId is a sentinel, create invoice first
                    let targetInvoiceId = invoiceId
                    if (invoiceId === '__create__' && newInvoicePayload) {
                      const created = await api.post<any>(`/communities/${communityCode}/invoices`, {
                        vendorName: newInvoicePayload.vendorName,
                        number: newInvoicePayload.number,
                        gross: newInvoicePayload.gross ? Number(newInvoicePayload.gross) : null,
                        currency: newInvoicePayload.currency || 'RON',
                        issueDate: newInvoicePayload.issueDate || null,
                      })
                      targetInvoiceId = created?.id || created?.invoiceId || created?.invoice?.id || null
                    }
                    if (targetInvoiceId && programId) {
                      await api.post(`/communities/${communityCode}/invoices/${targetInvoiceId}/program-links`, {
                        programId,
                        amount: amount ?? undefined,
                        portionKey: portionKey ?? undefined,
                      })
                    }
                    await loadOverviewInvoices()
                    return targetInvoiceId
                  }}
                />
              )}

              {activeTab === 'meters' && (
                <CommunityMetersPanel
                  communityId={activeCommunity!.id}
                  onStatusChange={() => refreshEditable()}
                />
              )}

              {activeTab === 'periodFocus' && (
                <PeriodAdmin
                  communityId={activeCommunity!.id}
                  communityCode={activeCommunity!.code}
                  onGoMeters={() => setActiveTab('meters')}
                  onGoExpenses={() => setActiveTab('expenses')}
                />
              )}

              {activeTab === 'config' && (
                <ConfigTab
                  configJson={configJson}
                  metersConfig={metersConfig}
                  configError={configError}
                  loadingLabel={t('config.loading')}
                />
              )}

              {activeTab === 'expenses' && (
                <CommunityExpensesPanel
                  communityId={activeCommunity!.id}
                  onBillStatusChange={() => refreshEditable()}
                />
              )}

              {activeTab === 'programs' && (
                <ProgramsTab
                  programs={programs}
                  programError={programError}
                  communityCode={communityCode}
                  onRefreshPrograms={refreshPrograms}
                />
              )}
              {activeTab === 'events' && <EventsTab communityCode={communityCode} />}
              {activeTab === 'polls' && <PollsTab communityCode={communityCode} />}
              {activeTab === 'communications' && (
                <CommunicationsTab communityId={communityId} unitGroups={configJson?.unitGroups || []} />
              )}
              {activeTab === 'inventory' && <InventoryTab communityId={communityId} />}
              {activeTab === 'notifications' && <NotificationsTab />}
              {activeTab === 'payments' && (
                <div className="card soft">
                  <div className="muted">{t('tab.payments', 'Payments')}</div>
                  <div className="row" style={{ marginTop: 6, gap: 8, alignItems: 'center' }}>
                    <button className="btn primary small" type="button" onClick={() => setShowPaymentForm((v) => !v)}>
                      {showPaymentForm ? t('payments.hideForm', 'Hide form') : t('payments.add', 'Add payment')}
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => fetchPayments()} disabled={paymentsLoading}>
                      {t('payments.reload', 'Reload')}
                    </button>
                    {paymentsLoading && <div className="muted">{t('communities.loading', 'Loading...')}</div>}
                  </div>
                  {showPaymentForm && (
                    <form
                      className="row"
                      style={{ gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (!newPayment.billingEntityId || !newPayment.amount) return
                        setPaymentsLoading(true)
                        setPaymentsError(null)
                        try {
                          await api.post(`/communities/${communityCode}/payments`, {
                            billingEntityId: newPayment.billingEntityId,
                            amount: Number(newPayment.amount),
                            currency: newPayment.currency || 'RON',
                            ts: newPayment.ts || undefined,
                            method: newPayment.method || undefined,
                            refId: newPayment.refId || undefined,
                            applyMode: newPayment.applyMode === 'none' ? 'none' : undefined,
                          })
                          setNewPayment({
                            billingEntityId: '',
                            amount: '',
                            currency: 'RON',
                            ts: '',
                            method: '',
                            refId: '',
                            applyMode: 'fifo',
                          })
                          await fetchPayments()
                        } catch (err: any) {
                          setPaymentsError(err?.message || 'Failed to add payment')
                        } finally {
                          setPaymentsLoading(false)
                        }
                      }}
                    >
                      <select
                        className="input"
                        style={{ minWidth: 180 }}
                        value={newPayment.billingEntityId}
                        onChange={(e) => setNewPayment((s) => ({ ...s, billingEntityId: e.target.value }))}
                      >
                        <option value="">{t('payments.selectBe', 'Select member')}</option>
                        {(configJson?.billingEntities || []).map((be: any) => (
                          <option key={be.id || be.code} value={be.id}>
                            {be.name || be.code || be.id}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        style={{ width: 120 }}
                        type="number"
                        step="0.01"
                        placeholder={t('payments.amount', 'Amount')}
                        value={newPayment.amount}
                        onChange={(e) => setNewPayment((s) => ({ ...s, amount: e.target.value }))}
                        required
                      />
                      <input
                        className="input"
                        style={{ width: 90 }}
                        placeholder={t('payments.currency', 'Currency')}
                        value={newPayment.currency}
                        onChange={(e) => setNewPayment((s) => ({ ...s, currency: e.target.value }))}
                      />
                      <input
                        className="input"
                        style={{ width: 160 }}
                        type="date"
                        value={newPayment.ts}
                        onChange={(e) => setNewPayment((s) => ({ ...s, ts: e.target.value }))}
                      />
                      <input
                        className="input"
                        style={{ width: 120 }}
                        placeholder={t('payments.method', 'Method')}
                        value={newPayment.method}
                        onChange={(e) => setNewPayment((s) => ({ ...s, method: e.target.value }))}
                      />
                      <input
                        className="input"
                        style={{ width: 140 }}
                        placeholder={t('payments.ref', 'Reference')}
                        value={newPayment.refId}
                        onChange={(e) => setNewPayment((s) => ({ ...s, refId: e.target.value }))}
                      />
                      <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={newPayment.applyMode !== 'none'}
                          onChange={(e) =>
                            setNewPayment((s) => ({ ...s, applyMode: e.target.checked ? 'fifo' : 'none' }))
                          }
                        />
                        <span className="muted">{t('payments.applyNow', 'Apply now')}</span>
                      </label>
                      <button className="btn primary small" type="submit" disabled={paymentsLoading}>
                        {t('payments.save', 'Save')}
                      </button>
                    </form>
                  )}
                  {paymentsError && <div className="badge negative">{paymentsError}</div>}
                  {!paymentsError && (
                    <ul className="muted" style={{ marginTop: 8 }}>
                      {payments.map((p) => (
                        <li key={p.id}>
                          {p.amount} {p.currency} • {p.billingEntityName || p.billingEntityCode || p.billingEntityId} •{' '}
                          {p.ts ? new Date(p.ts).toLocaleDateString() : ''}
                          {p.remaining != null ? ` • remaining ${p.remaining}` : ''}
                          {p.applications && p.applications.length > 0 && (
                            <div style={{ marginTop: 4, fontSize: 12, color: '#b8cee5' }}>
                              {t('payments.appliedTo', 'Applied to')}:{" "}
                              {p.applications
                                .map((a: any) => `${a.bucket || 'charge'} (${Number(a.amount).toFixed(2)})`)
                                .join(', ')}
                            </div>
                          )}
                        </li>
                      ))}
                      {payments.length === 0 && <li>{t('payments.empty', 'No payments yet')}</li>}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === 'statements' && (
                <div className="stack">
                  <h4>{t('statements.heading')}</h4>
                  <p className="muted">{t('statements.subtitle')}</p>
                </div>
              )}

              {activeTab === 'users' && <CommunityUsersPanel communityId={activeCommunity!.id} />}

              {activeTab === 'health' && (
                <div className="stack">
                  <h4>{t('health.heading')}</h4>
                  <p className="muted">{t('health.subtitle')}</p>
                </div>
              )}

              {message && <div className="badge negative">{message}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
