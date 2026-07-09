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
import { CommandFinanceDashboard } from './CommandFinanceDashboard'
import { ConfigTab } from './ConfigTab'
import { FundsTab } from './FundsTab'
import { EventsTab } from './EventsTab'
import { PollsTab } from './PollsTab'
import { NotificationsTab } from './NotificationsTab'
import { CommunicationsTab } from './CommunicationsTab'
import { InventoryTab } from './InventoryTab'
import { TodayHome } from './TodayHome'
import { CloseBoard } from './CloseBoard'
import { DebtorsPanel } from '../money/DebtorsPanel'
import { UnpaidInvoicesPanel } from '../money/UnpaidInvoicesPanel'
import { MoneyHub } from '../money/MoneyHub'
import { AvizierPanel } from './AvizierPanel'
import { CommitteeDecisionsPanel } from './CommitteeDecisionsPanel'
import { GovernancePanel } from './GovernancePanel'

export type CommunityAdminTabKey =
  | 'today'
  | 'close'
  | 'avizier'
  | 'debtors'
  | 'unpaidInvoices'
  | 'overview'
  | 'commandFinance'
  | 'config'
  | 'meters'
  | 'expenses'
  | 'funds'
  | 'events'
  | 'polls'
  | 'communications'
  | 'inventory'
  | 'notifications'
  | 'decisions'
  | 'governance'
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
  /** Viewer's active role — restricts the nav for oversight roles (CENSOR / committee). Defaults to full admin. */
  viewerRole?: string
}

// Which tabs each role may see. Oversight roles get a read-focused subset; the admin-centric
// "today" home is excluded (they land on a role-appropriate page instead).
const OVERSIGHT_TABS: Record<string, CommunityAdminTabKey[]> = {
  CENSOR: ['today', 'close', 'avizier', 'funds', 'debtors', 'unpaidInvoices', 'decisions'],
  EXECUTIVE_COMITEE_MEMBER: ['today', 'close', 'avizier', 'funds', 'debtors', 'unpaidInvoices', 'decisions', 'communications', 'polls', 'events', 'inventory', 'notifications'],
}
function tabAllowedFor(key: CommunityAdminTabKey, viewerRole?: string): boolean {
  const allow = viewerRole ? OVERSIGHT_TABS[viewerRole] : undefined
  return allow ? allow.includes(key) : true
}
function defaultTabFor(_viewerRole?: string): CommunityAdminTabKey {
  return 'today' // every role lands on a role-aware Today home
}

// Which per-community feature flag gates each tab (tabs without an entry are always available).
const FEATURE_BY_TAB: Partial<Record<CommunityAdminTabKey, string>> = {
  funds: 'funds',
  meters: 'meters',
  communications: 'announcements',
  polls: 'polls',
  events: 'events',
  inventory: 'inventory',
  notifications: 'notifications',
  decisions: 'committee',
}
function featureAllowsTab(key: CommunityAdminTabKey, features?: Record<string, boolean> | null): boolean {
  const flag = FEATURE_BY_TAB[key]
  return !flag || !features || features[flag] !== false
}

export function CommunityAdminDashboard({
  forceCommunityId,
  requestedTab,
  onTabRequestHandled,
  communitiesOverride,
  onCommunityConfigLoaded,
  viewerRole,
}: Props) {
  const { api, activeRole } = useAuth()
  const { t } = useI18n()
  // Oversight roles (cenzor / committee) see the panels read-only: no write controls rendered.
  const readOnly = viewerRole === 'CENSOR' || viewerRole === 'EXECUTIVE_COMITEE_MEMBER'
  const [communities, setCommunities] = React.useState<Community[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<CommunityAdminTabKey>(() => {
    const def = defaultTabFor(viewerRole)
    if (typeof window === 'undefined') return def
    const urlTab = new URLSearchParams(window.location.search).get('tab') as CommunityAdminTabKey | null
    return urlTab && tabAllowedFor(urlTab, viewerRole) ? urlTab : def
  })
  // Depth within the dashboard's own history entries (0 = landing) → controls Back visibility.
  const [histDepth, setHistDepth] = React.useState(0)
  const activeTabRef = React.useRef(activeTab)
  React.useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  const urlFor = (tab: CommunityAdminTabKey, extra?: Record<string, string>) => {
    const u = new URL(window.location.href)
    u.searchParams.set('tab', tab)
    u.searchParams.delete('fund')
    if (extra) Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v))
    return u.pathname + u.search + u.hash
  }
  // navigate() pushes a real browser history entry so both the in-app Back button and the
  // browser Back/Forward buttons move through the dashboard, and the URL is shareable.
  // `extra` adds deep-link params (e.g. { fund: 'RULMENT' }) the target panel can read.
  const navigate = React.useCallback((tab: CommunityAdminTabKey, extra?: Record<string, string>) => {
    if (typeof window === 'undefined') return
    if (tab === activeTabRef.current && !extra) return
    const depth = ((window.history.state?.depth as number) || 0) + 1
    window.history.pushState({ tab, depth }, '', urlFor(tab, extra))
    setHistDepth(depth)
    setActiveTab(tab)
  }, [])
  const goBack = React.useCallback(() => { window.history.back() }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    // seed a baseline history entry for the landing tab
    if (window.history.state?.tab == null) {
      window.history.replaceState({ tab: activeTabRef.current, depth: 0 }, '', urlFor(activeTabRef.current))
    } else {
      setHistDepth((window.history.state.depth as number) || 0)
    }
    const onPop = (e: PopStateEvent) => {
      const tab = (e.state?.tab as CommunityAdminTabKey) ||
        (new URLSearchParams(window.location.search).get('tab') as CommunityAdminTabKey) || 'today'
      setActiveTab(tab)
      setHistDepth((e.state?.depth as number) || 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [configJson, setConfigJson] = React.useState<any>(null)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const [features, setFeatures] = React.useState<Record<string, boolean> | null>(null)
  const [metersConfig, setMetersConfig] = React.useState<any | null>(null)
  const [funds, setFunds] = React.useState<any[]>([])
  const [fundError, setFundError] = React.useState<string | null>(null)
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
  const [periodActionError, setPeriodActionError] = React.useState<string | null>(null)
  const [navCollapsed, setNavCollapsed] = React.useState(false)
  const [dashboardData, setDashboardData] = React.useState<any | null>(null)
  const [dashboardLoading, setDashboardLoading] = React.useState(false)
  const [dashboardError, setDashboardError] = React.useState<string | null>(null)
  const [fundsLoadedFor, setFundsLoadedFor] = React.useState<string | null>(null)
  const [invoicesLoadedFor, setInvoicesLoadedFor] = React.useState<string | null>(null)
  const [overviewInv, setOverviewInv] = React.useState<any[]>([])
  const [overviewInvLoading, setOverviewInvLoading] = React.useState(false)
  const [overviewInvError, setOverviewInvError] = React.useState<string | null>(null)

  // Derived community identity — must be declared before the effects and nav below that reference it.
  // (Previously defined ~100 lines lower, after its first use, which threw a temporal-dead-zone
  // ReferenceError on every render and blanked the whole dashboard.)
  const activeCommunity = communities.find((c) => c.id === selectedId) ?? null
  const communityCode = activeCommunity?.code || forceCommunityId || ''
  const communityId = activeCommunity?.id || forceCommunityId || ''

  const navGroupsAll: Array<{ label: string; items: Array<{ key: CommunityAdminTabKey; label: string }> }> = [
    {
      label: t('nav.home') || 'Acasă',
      items: [
        { key: 'today', label: t('tab.today') || 'Today' },
      ],
    },
    {
      label: t('nav.monthlyClose') || 'Închiderea lunii',
      items: [
        { key: 'close', label: t('tab.close') || 'Monthly close' },
        { key: 'avizier', label: t('tab.avizier') || 'Avizier' },
        { key: 'meters', label: t('tab.meters') || 'Meters' },
        { key: 'expenses', label: t('tab.expenses') || 'Invoices & expenses' },
        { key: 'periodFocus', label: t('tab.periodFocus') || 'Period detail' },
      ],
    },
    {
      label: t('nav.money') || 'Bani',
      items: [
        { key: 'payments', label: t('tab.payments') || 'Payments' },
        { key: 'debtors', label: t('tab.debtors') || 'Debtors' },
        { key: 'unpaidInvoices', label: t('tab.unpaidInvoices') || 'Unpaid invoices' },
        { key: 'funds', label: t('tab.funds') || 'Funds' },
      ],
    },
    {
      label: t('nav.community') || 'Comunitate',
      items: [
        { key: 'decisions', label: t('tab.decisions') || 'Comitet executiv' },
        { key: 'communications', label: t('tab.communications') || 'Communications' },
        { key: 'polls', label: t('tab.polls') || 'Polls' },
        { key: 'events', label: t('tab.events') || 'Events' },
        { key: 'inventory', label: t('tab.inventory') || 'Inventory' },
        { key: 'notifications', label: t('tab.notifications') || 'Notifications' },
      ],
    },
    {
      label: t('nav.admin') || 'Administrare',
      items: [
        { key: 'governance', label: t('tab.governance') || 'Roluri & acces' },
        { key: 'users', label: t('tab.users') || 'Users' },
        { key: 'config', label: t('tab.config') || 'Config' },
      ],
    },
  ]

  // Oversight roles (cenzor / committee) get a read-focused subset of tabs.
  React.useEffect(() => {
    if (!communityId) return
    api.get<Record<string, boolean>>(`/communities/${communityId}/features`)
      .then((f: Record<string, boolean>) => setFeatures(f))
      .catch(() => setFeatures(null))
  }, [api, communityId])

  const navGroups = navGroupsAll
    .map((g) => ({ ...g, items: g.items.filter((i) => tabAllowedFor(i.key, viewerRole) && featureAllowsTab(i.key, features)) }))
    .filter((g) => g.items.length)

  // If the current tab isn't allowed for this role or is a disabled feature, send them home.
  React.useEffect(() => {
    if (!tabAllowedFor(activeTab, viewerRole) || !featureAllowsTab(activeTab, features)) navigate(defaultTabFor(viewerRole))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, viewerRole, features])

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

  const refreshFunds = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    setFundError(null)
    return fetch(`${API_BASE}/community-funds/${communityCode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((rows) => setFunds(Array.isArray(rows) ? rows : []))
      .catch((err) => setFundError(err?.message || 'Failed to load funds'))
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
    setFundError(null)
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
    if (!communityCode || activeTab !== 'funds') return
    if (fundsLoadedFor === communityCode) return
    setFundsLoadedFor(communityCode)
    refreshFunds()
  }, [activeTab, communityCode, fundsLoadedFor, refreshFunds])

  const ensureFundsLoaded = React.useCallback(() => {
    if (!communityCode) return
    if (fundsLoadedFor === communityCode) return
    setFundsLoadedFor(communityCode)
    refreshFunds()
  }, [communityCode, fundsLoadedFor, refreshFunds])

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
    const needsConfig = activeTab === 'config' || activeTab === 'communications' || activeTab === 'payments' || activeTab === 'overview'
    if (!needsConfig) return
    if (configJson && (configJson as any)?.community?.code === communityCode) return
    setConfigError(null)
    api.get<any>(`/community-config/${communityCode}`)
      .then((data) => {
        setConfigJson(data)
        onCommunityConfigLoaded?.(data?.community ?? null, data?.billingEntities ?? [])
      })
      .catch((err) => setConfigError(err?.message || 'Failed to load config'))
  }, [api, activeTab, communityCode, configJson, onCommunityConfigLoaded])

  const handlePrepare = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setPeriodActionError(null)
      setBusy('prepare')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/prepare`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to prepare period')
      setPeriodActionError(err?.message || 'Failed to prepare period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, editablePeriod?.period?.code, refreshEditable, refreshClosed])

  const handleClose = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setPeriodActionError(null)
      setBusy('close')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/approve`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to close period')
      setPeriodActionError(err?.message || 'Failed to close period')
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

  if (!communityId) {
    return (
      <div className="grid one" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="empty">{selectedId ? t('common.loading') || 'Loading…' : t('communities.empty')}</div>
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
                              onClick={() => navigate(tab.key)}
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
              {(() => {
                const group = navGroups.find((g) => g.items.some((i) => i.key === activeTab))
                const item = group?.items.find((i) => i.key === activeTab)
                return (
                  <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    {histDepth > 0 && (
                      <button className="btn ghost small" type="button" onClick={goBack}>← {t('common.back') || 'Back'}</button>
                    )}
                    <span className="muted" style={{ fontSize: 13 }}>
                      {group ? `${group.label} › ` : ''}
                      <strong>{item?.label ?? activeTab}</strong>
                    </span>
                  </div>
                )
              })()}
              {activeTab === 'today' && (
                <TodayHome communityId={communityId} onNavigate={navigate} viewerRole={viewerRole} />
              )}
              {activeTab === 'close' && (
                <CloseBoard communityId={communityId} onNavigate={navigate} readOnly={readOnly} />
              )}
              {activeTab === 'avizier' && <AvizierPanel communityId={communityId} cenzorEnabled={features ? features.cenzor !== false : true} />}
              {activeTab === 'debtors' && <DebtorsPanel communityId={communityId} />}
              {activeTab === 'decisions' && <CommitteeDecisionsPanel communityId={communityId} />}
              {activeTab === 'governance' && <GovernancePanel communityId={communityId} features={features} />}
              {activeTab === 'unpaidInvoices' && <UnpaidInvoicesPanel communityId={communityId} />}
              {activeTab === 'overview' && (
                <OverviewTab
                  communityId={communityId}
                  communityCode={communityCode}
                  communityName={activeCommunity?.name}
                  billingEntities={configJson?.billingEntities || []}
                  editablePeriod={editablePeriod}
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
                  lastClosedSummary={lastClosedSummary}
                  onLoadLastClosedSummary={loadLastClosedSummary}
                  funds={funds}
                  invoices={overviewInv}
                  invoicesLoading={overviewInvLoading}
                  invoicesError={overviewInvError}
                  onReloadInvoices={() => loadOverviewInvoices()}
                  dashboardData={dashboardData}
                  dashboardLoading={dashboardLoading}
                  dashboardError={dashboardError}
                  onEnsureFunds={ensureFundsLoaded}
                  onEnsureInvoices={ensureInvoicesLoaded}
                  onLinkInvoice={async (invoiceId, fundId, amount, portionKey, newInvoicePayload?: any) => {
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
                    if (targetInvoiceId && fundId) {
                      await api.post(`/communities/${communityCode}/invoices/${targetInvoiceId}/fund-links`, {
                        fundId,
                        amount: amount ?? undefined,
                        portionKey: portionKey ?? undefined,
                      })
                    }
                    await loadOverviewInvoices()
                    return targetInvoiceId
                  }}
                />
              )}
              {activeTab === 'commandFinance' && (
                <CommandFinanceDashboard
                  communityCode={communityCode}
                  onNavigate={(tab) => setActiveTab(tab)}
                  onPrepare={handlePrepare}
                  onClose={handleClose}
                  onReopen={() => handleReopen(editablePeriod?.period?.code || null)}
                  onCreatePeriod={handleCreatePeriod}
                  periodError={periodActionError}
                />
              )}

              {activeTab === 'meters' && (
                <CommunityMetersPanel
                  communityId={communityId}
                  onStatusChange={() => refreshEditable()}
                />
              )}

              {activeTab === 'periodFocus' && (
                <PeriodAdmin
                  communityId={communityId}
                  communityCode={communityCode}
                  onGoMeters={() => setActiveTab('meters')}
                  onGoExpenses={() => setActiveTab('expenses')}
                />
              )}

              {activeTab === 'config' && (
                <ConfigTab
                  communityId={communityId}
                  configJson={configJson}
                  metersConfig={metersConfig}
                  configError={configError}
                  loadingLabel={t('config.loading')}
                  readOnly={readOnly}
                />
              )}

              {activeTab === 'expenses' && (
                <CommunityExpensesPanel
                  communityId={communityId}
                  onBillStatusChange={() => refreshEditable()}
                />
              )}

              {activeTab === 'funds' && (
                <FundsTab
                  funds={funds}
                  fundError={fundError}
                  communityCode={communityCode}
                  onRefreshFunds={refreshFunds}
                  readOnly={readOnly}
                />
              )}
              {activeTab === 'events' && <EventsTab communityCode={communityCode} readOnly={readOnly} />}
              {activeTab === 'polls' && <PollsTab communityCode={communityCode} readOnly={readOnly} />}
              {activeTab === 'communications' && (
                <CommunicationsTab communityId={communityId} unitGroups={configJson?.unitGroups || []} readOnly={readOnly} />
              )}
              {activeTab === 'inventory' && <InventoryTab communityId={communityId} readOnly={readOnly} />}
              {activeTab === 'notifications' && <NotificationsTab readOnly={readOnly} />}
              {activeTab === 'payments' && (
                <MoneyHub
                  communityId={communityId}
                  communityCode={communityCode}
                  communityName={activeCommunity?.name}
                  billingEntities={configJson?.billingEntities || []}
                />
              )}

              {activeTab === 'statements' && (
                <div className="stack">
                  <h4>{t('statements.heading')}</h4>
                  <p className="muted">{t('statements.subtitle')}</p>
                </div>
              )}

              {activeTab === 'users' && <CommunityUsersPanel communityId={communityId} />}

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
