import React from 'react'
import {
  ActivityIndicator,
  FlatList,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import type { PeriodRef } from '@shared/api/types'
import { CartPanel } from '../components/cart/CartPanel'
import { BeDashboard } from '../components/dashboard/BeDashboard'
import { CommunityDashboard } from '../components/dashboard/CommunityDashboard'
import { GlobalDashboard } from '../components/dashboard/GlobalDashboard'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatChannelLabel, formatDate, formatMoney, formatVoteSummary } from '../utils/formatters'
type AggregateRow = {
  amount: number
  unitId?: string
  unitCode?: string
  unitName?: string
  splitGroupId?: string
  splitGroupCode?: string
  splitGroupName?: string
}
type DueTotals = {
  dueStart: number
  charges: number
  payments: number
  adjustments: number
  dueEnd: number
}

export function MainScreen() {
  const { api, activeRole, roles, logout } = useAuth()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const routeParams = route?.params as { section?: string; periodCode?: string } | undefined
  const initialSection = routeParams?.section || 'My Dashboard'
  const [section, setSection] = React.useState<string>(initialSection)
  const isDashboardView = section === 'Dashboard'
  const isCommunityDashboardView = section === 'Community Dashboard'
  const isGlobalDashboardView = section === 'My Dashboard'
  const isExpensesView = section === 'Expenses'
  const isProgramsView = section === 'Programs'
  const isPollsView = section === 'Polls'
  const isEventsView = section === 'Events'
  const isNotificationsView = section === 'Notifications'
  const isCommunicationsView = section === 'Communications'
  const beScope = useBeScope()
  const [periods, setPeriods] = React.useState<PeriodRef[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'UNIT' | 'SPLIT'>('SPLIT')
  const [rows, setRows] = React.useState<AggregateRow[]>([])
  const [memberCount, setMemberCount] = React.useState<number | null>(null)
  const [expandedTopId, setExpandedTopId] = React.useState<string | null>(null)
  const [expandedTopRows, setExpandedTopRows] = React.useState<any[]>([])
  const [expandedTopLoading, setExpandedTopLoading] = React.useState(false)
  const [expandedMidId, setExpandedMidId] = React.useState<string | null>(null)
  const [expandedDetailRows, setExpandedDetailRows] = React.useState<any[]>([])
  const [expandedDetailLoading, setExpandedDetailLoading] = React.useState(false)
  const [statement, setStatement] = React.useState<{ periodCode: string; dueStart: number; charges: number; currency?: string } | null>(null)
  const [previousPeriodCode, setPreviousPeriodCode] = React.useState<string | null>(null)
  const [previousClosedStatement, setPreviousClosedStatement] = React.useState<{ periodCode: string; dueEnd: number; currency?: string } | null>(null)
  const [beLiveTotals, setBeLiveTotals] = React.useState<{ dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number } | null>(null)
  const [statementDetail, setStatementDetail] = React.useState<{ statement: any; ledgerEntries: any[] } | null>(null)
  const [statementDetailOpen, setStatementDetailOpen] = React.useState(false)
  const [events, setEvents] = React.useState<any[]>([])
  const [eventList, setEventList] = React.useState<any[]>([])
  const [polls, setPolls] = React.useState<any[]>([])
  const [programBuckets, setProgramBuckets] = React.useState<Record<string, { id: string; code: string; name: string }>>({})
  const [programList, setProgramList] = React.useState<any[]>([])
  const [pollList, setPollList] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [statementLoading, setStatementLoading] = React.useState(false)
  const [eventsLoading, setEventsLoading] = React.useState(false)
  const [pollsLoading, setPollsLoading] = React.useState(false)
  const [programsLoading, setProgramsLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [programsMessage, setProgramsMessage] = React.useState<string | null>(null)
  const [pollsMessage, setPollsMessage] = React.useState<string | null>(null)
  const [eventsMessage, setEventsMessage] = React.useState<string | null>(null)
  const [notifications, setNotifications] = React.useState<any[]>([])
  const [notificationPrefs, setNotificationPrefs] = React.useState<any[]>([])
  const [notificationsLoading, setNotificationsLoading] = React.useState(false)
  const [prefsLoading, setPrefsLoading] = React.useState(false)
  const [notificationsMessage, setNotificationsMessage] = React.useState<string | null>(null)
  const [announcements, setAnnouncements] = React.useState<any[]>([])
  const [announcementsLoading, setAnnouncementsLoading] = React.useState(false)
  const [announcementsMessage, setAnnouncementsMessage] = React.useState<string | null>(null)
  const [globalDue, setGlobalDue] = React.useState<{
    totals: { live: DueTotals; previousClosed: DueTotals }
    communities: any[]
  } | null>(null)
  const [globalDueLoading, setGlobalDueLoading] = React.useState(false)
  const [globalDueMessage, setGlobalDueMessage] = React.useState<string | null>(null)
  const [communityDue, setCommunityDue] = React.useState<{
    live: { period: any | null; totals: DueTotals; billingEntities: any[]; previousClosed: { period: any | null; totals: DueTotals } | null }
  } | null>(null)
  const [communityDueLoading, setCommunityDueLoading] = React.useState(false)
  const [communityDueMessage, setCommunityDueMessage] = React.useState<string | null>(null)
  const [selectedCommunityId, setSelectedCommunityId] = React.useState<string | null>(null)
  const [initializingDashboard, setInitializingDashboard] = React.useState(initialSection === 'My Dashboard')
  const [cartLines, setCartLines] = React.useState<Array<{ billingEntityId: string; bucket?: string | null; amount: number; label: string }>>([])
  const [cartPulse, setCartPulse] = React.useState(false)
  const [cartOpen, setCartOpen] = React.useState(false)
  const [cartMessage, setCartMessage] = React.useState<string | null>(null)
  const [cartSubmitting, setCartSubmitting] = React.useState(false)
  const [refreshKey] = React.useState(0)
  const { beMetaMap, setBeMeta } = beScope
  const periodTotal = React.useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows])

  const beRole =
    (activeRole?.scopeType === 'BILLING_ENTITY' ? activeRole : null) || roles.find((role) => role.scopeType === 'BILLING_ENTITY') || null
  const beRoles = roles.filter((role) => role.scopeType === 'BILLING_ENTITY' && role.scopeId)
  const beId = beScope.selectedBeId || beRole?.scopeId || ''

  React.useEffect(() => {
    if (routeParams?.section && routeParams.section !== section) {
      if (routeParams.section === 'My Dashboard') {
        setInitializingDashboard(true)
      }
      setSection(routeParams.section)
    }
  }, [routeParams?.section, section])

  React.useEffect(() => {
    if (selectedCommunityId) return
    if (beMetaMap[beId]?.communityId) {
      setSelectedCommunityId(beMetaMap[beId]?.communityId ?? null)
      return
    }
    const communityIds = Object.keys(beScope.communityMap || {})
    if (communityIds.length) setSelectedCommunityId(communityIds[0])
  }, [beId, beMetaMap, beScope.communityMap, selectedCommunityId])

  React.useEffect(() => {
    if (section !== 'My Dashboard') {
      setInitializingDashboard(false)
    }
  }, [section])

  React.useEffect(() => {
    if (!beId || !isExpensesView) return
    setLoading(true)
    api
      .get<PeriodRef[]>(`/communities/be/${beId}/periods`)
      .then((data) => {
        setPeriods(data)
        if (!selected && data.length) setSelected(data[data.length - 1].code)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))
      .finally(() => setLoading(false))
  }, [api, beId, isExpensesView, refreshKey])

  React.useEffect(() => {
    if (!beId || !selected || !isExpensesView) return
    setLoading(true)
    setMessage(null)
    const groupBy = tab === 'UNIT' ? 'MEMBER' : 'SPLIT_GROUP'
    api
      .get<any>(`/communities/be/${beId}/periods/${selected}/allocations/aggregate?groupBy=${groupBy}`)
      .then((data) => {
        setRows(data?.rows || [])
        if (data?.be?.id) {
          beScope.setBeMeta(data.be.id, { name: data.be.name || data.be.code || data.be.id, communityId: data.be.communityId })
        }
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load allocations'))
      .finally(() => setLoading(false))
  }, [api, beId, selected, tab, isExpensesView, refreshKey])

  React.useEffect(() => {
    if (!isExpensesView) return
    setMemberCount(null)
  }, [beId, isExpensesView, selected])

  React.useEffect(() => {
    if (!isExpensesView || !beId || !selected) return
    if (tab === 'UNIT') {
      setMemberCount(rows.length)
      return
    }
    if (memberCount !== null) return
    api
      .get<any>(`/communities/be/${beId}/periods/${selected}/allocations/aggregate?groupBy=MEMBER`)
      .then((data) => {
        setMemberCount(Array.isArray(data?.rows) ? data.rows.length : 0)
      })
      .catch(() => {
        setMemberCount(0)
      })
  }, [api, beId, isExpensesView, memberCount, rows.length, selected, tab])

  React.useEffect(() => {
    if (!isExpensesView || memberCount === null) return
    if (memberCount <= 1 && tab !== 'UNIT') {
      setTab('UNIT')
    }
  }, [isExpensesView, memberCount, tab])

  const loadTopDrill = React.useCallback(
    (topId: string) => {
      if (!beId || !selected || !topId) return
      setExpandedTopId(topId)
      setExpandedTopRows([])
      setExpandedMidId(null)
      setExpandedDetailRows([])
      setExpandedTopLoading(true)
      const url =
        tab === 'UNIT'
          ? `/communities/be/${beId}/periods/${selected}/allocations/drill/member/${topId}`
          : `/communities/be/${beId}/periods/${selected}/allocations/drill/split-group/${topId}`
      api
        .get<any>(url)
        .then((data) => {
          setExpandedTopRows(data?.rows || [])
        })
        .catch((err: any) => setMessage(err?.message || 'Could not load drilldown'))
        .finally(() => setExpandedTopLoading(false))
    },
    [api, beId, selected, tab],
  )

  const loadDetailDrill = React.useCallback(
    (topId: string, midId: string) => {
      if (!beId || !selected || !topId || !midId) return
      setExpandedMidId(midId)
      setExpandedDetailRows([])
      setExpandedDetailLoading(true)
      const unitId = tab === 'UNIT' ? topId : midId
      const splitGroupId = tab === 'UNIT' ? midId : topId
      api
        .get<any>(`/communities/be/${beId}/periods/${selected}/allocations/drill/detail/${unitId}/${splitGroupId}`)
        .then((data) => {
          setExpandedDetailRows(data?.rows || [])
        })
        .catch((err: any) => setMessage(err?.message || 'Could not load drilldown'))
        .finally(() => setExpandedDetailLoading(false))
    },
    [api, beId, selected, tab],
  )

  React.useEffect(() => {
    if (!isExpensesView) return
    setExpandedTopId(null)
    setExpandedTopRows([])
    setExpandedMidId(null)
    setExpandedDetailRows([])
  }, [beId, isExpensesView, selected, tab])

  React.useEffect(() => {
    if (!isExpensesView) return
    if (rows.length !== 1) return
    const onlyTopId = tab === 'UNIT' ? rows[0]?.unitId : rows[0]?.splitGroupId
    if (!onlyTopId || expandedTopId === onlyTopId) return
    loadTopDrill(onlyTopId)
  }, [expandedTopId, isExpensesView, loadTopDrill, rows, tab])

  React.useEffect(() => {
    if (!isExpensesView) return
    if (!expandedTopId || expandedTopRows.length !== 1) return
    const onlyMidId = tab === 'UNIT' ? expandedTopRows[0]?.splitGroupId : expandedTopRows[0]?.unitId
    if (!onlyMidId || expandedMidId === onlyMidId) return
    loadDetailDrill(expandedTopId, onlyMidId)
  }, [expandedDetailRows, expandedMidId, expandedTopId, expandedTopRows, isExpensesView, loadDetailDrill, tab])

  React.useEffect(() => {
    if (!beId || !isDashboardView) return
    let active = true
    setStatementLoading(true)
    setProgramsLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/be/${beId}/dashboard`)
      .then((data) => {
        if (!active) return
        const period = data?.period
        setPreviousPeriodCode(data?.previousPeriod?.code ?? null)
        if (data?.previousClosedStatement && data?.previousPeriod?.code) {
          setPreviousClosedStatement({
            periodCode: data.previousPeriod.code,
            dueEnd: Number(data.previousClosedStatement.dueEnd || 0),
            currency: data.previousClosedStatement.currency || 'RON',
          })
        } else {
          setPreviousClosedStatement(null)
        }
        const stmt = data?.statement
        if (period?.code) {
          if (stmt) {
            setStatement({
              periodCode: period.code,
              dueStart: Number(stmt.dueStart || 0),
              charges: Number(stmt.charges || 0),
              currency: stmt.currency || 'RON',
            })
          } else {
            setStatement({ periodCode: period.code, dueStart: 0, charges: 0, currency: 'RON' })
          }
        } else {
          setStatement(null)
        }
        setStatementDetail({
          statement: stmt || null,
          ledgerEntries: data?.ledgerEntries || [],
        })
        if (data?.live?.totals) {
          setBeLiveTotals({
            dueStart: Number(data.live.totals.dueStart || 0),
            charges: Number(data.live.totals.charges || 0),
            payments: Number(data.live.totals.payments || 0),
            adjustments: Number(data.live.totals.adjustments || 0),
            dueEnd: Number(data.live.totals.dueEnd || 0),
          })
        } else {
          setBeLiveTotals(null)
        }
        setProgramBuckets(data?.programBuckets || {})
        if (data?.be?.id) {
          setBeMeta(data.be.id, { name: data.be.name || data.be.code || data.be.id, communityId: data.be.communityId })
        }
      })
      .catch((err: any) => {
        if (active) setMessage(err?.message || 'Could not load dashboard')
      })
      .finally(() => {
        if (active) {
          setStatementLoading(false)
          setProgramsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [api, beId, isDashboardView, setBeMeta, refreshKey])

  const communityIdForBe = beMetaMap[beId]?.communityId || null
  const communityId = isCommunityDashboardView ? selectedCommunityId || communityIdForBe : communityIdForBe

  const cartTotal = React.useMemo(
    () => cartLines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
    [cartLines],
  )
  const cartCount = cartLines.length
  const cartKeys = React.useMemo(
    () => new Set(cartLines.map((line) => `${line.billingEntityId}::${line.bucket || 'ALL'}`)),
    [cartLines],
  )
  const isInCart = React.useCallback(
    (billingEntityId: string, bucket?: string | null) => {
      if (cartKeys.has(`${billingEntityId}::ALL`)) return true
      return cartKeys.has(`${billingEntityId}::${bucket || 'ALL'}`)
    },
    [cartKeys],
  )

  const pulseCart = React.useCallback(() => {
    setCartPulse(true)
    setTimeout(() => setCartPulse(false), 450)
  }, [])

  const addCartLine = React.useCallback(
    (line: { billingEntityId: string; bucket?: string | null; amount: number; label: string }) => {
      setCartLines((prev) => {
        const key = `${line.billingEntityId}::${line.bucket || 'ALL'}`
        const hasParent = prev.some((row) => `${row.billingEntityId}::${row.bucket || 'ALL'}` === `${line.billingEntityId}::ALL`)
        if (hasParent && line.bucket) {
          return prev
        }
        if (prev.some((row) => `${row.billingEntityId}::${row.bucket || 'ALL'}` === key)) {
          return prev
        }
        if (!line.bucket) {
          const filtered = prev.filter((row) => row.billingEntityId !== line.billingEntityId)
          return [...filtered, line]
        }
        return [...prev, line]
      })
      pulseCart()
    },
    [pulseCart],
  )

  const removeCartLine = React.useCallback((index: number) => {
    setCartLines((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clearCart = React.useCallback(() => {
    setCartLines([])
    setCartMessage(null)
    setCartOpen(false)
  }, [])

  const submitCart = React.useCallback(async () => {
    if (!cartLines.length) return
    setCartSubmitting(true)
    setCartMessage(null)
    try {
      const lines = cartLines.map((line) => ({
        billingEntityId: line.billingEntityId,
        amount: Number(line.amount || 0),
        bucket: line.bucket ?? undefined,
      }))
      await api.post('/me/payments', {
        currency: 'RON',
        lines,
      })
      clearCart()
    } catch (err: any) {
      setCartMessage(err?.message || 'Failed to submit cart')
    } finally {
      setCartSubmitting(false)
    }
  }, [api, cartLines, clearCart])

  const addGlobalTotals = React.useCallback(async () => {
    if (!globalDue?.communities?.length) {
      setCartMessage('No communities available to add.')
      return
    }
    setCartMessage(null)
    try {
      const communityIds = globalDue.communities
        .map((row: any) => row?.community?.id)
        .filter(Boolean) as string[]
      if (!communityIds.length) {
        setCartMessage('No communities available to add.')
        return
      }
      const results = await Promise.all(
        communityIds.map((communityId) => api.get<any>(`/me/communities/${communityId}/dashboard`)),
      )
      results.forEach((data) => {
        const items = Array.isArray(data?.live?.billingEntities) ? data.live.billingEntities : []
        items.forEach((row: any) => {
          const due = Number(row.dueEnd || 0)
          if (due <= 0) return
          if (isInCart(row.billingEntityId)) return
          const label = beMetaMap[row.billingEntityId]?.name || row.billingEntityId
          addCartLine({
            billingEntityId: row.billingEntityId,
            amount: due,
            label,
          })
        })
      })
    } catch (err: any) {
      setCartMessage(err?.message || 'Failed to add totals')
    }
  }, [addCartLine, api, beMetaMap, globalDue?.communities, isInCart])

  React.useEffect(() => {
    if (!isGlobalDashboardView) return
    let active = true
    setGlobalDueLoading(true)
    setGlobalDueMessage(null)
    api
      .get<any>('/me/dashboard')
      .then((data) => {
        if (!active) return
        const next = {
          totals: {
            live: data?.totals?.live || { dueStart: 0, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 },
            previousClosed:
              data?.totals?.previousClosed || { dueStart: 0, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 },
          },
          communities: Array.isArray(data?.communities) ? data.communities : [],
        }
        setGlobalDue(next)
      })
      .catch((err: any) => {
        if (active) setGlobalDueMessage(err?.message || 'Could not load dashboard')
      })
      .finally(() => {
        if (active) {
          setGlobalDueLoading(false)
          setInitializingDashboard(false)
        }
      })
    return () => {
      active = false
    }
  }, [api, isGlobalDashboardView, refreshKey])

  React.useEffect(() => {
    if (!isCommunityDashboardView || !communityId) return
    let active = true
    setCommunityDueLoading(true)
    setCommunityDueMessage(null)
    api
      .get<any>(`/me/communities/${communityId}/dashboard`)
      .then((data) => {
        if (!active) return
        setCommunityDue({
          live: {
            period: data?.live?.period ?? null,
            totals: data?.live?.totals || { dueStart: 0, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 },
            billingEntities: Array.isArray(data?.live?.billingEntities) ? data.live.billingEntities : [],
            previousClosed: data?.live?.previousClosed ?? null,
          },
        })
      })
      .catch((err: any) => {
        if (active) setCommunityDueMessage(err?.message || 'Could not load community dashboard')
      })
      .finally(() => {
        if (active) setCommunityDueLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, communityId, isCommunityDashboardView, refreshKey])

  React.useEffect(() => {
    if (!isCommunityDashboardView || !communityId) return
    let active = true
    setEventsLoading(true)
    setPollsLoading(true)
    const now = Date.now()
    Promise.all([
      api.get<any[]>(`/communities/${communityId}/events`),
      api.get<any[]>(`/communities/${communityId}/polls`),
    ])
      .then(([eventRows, pollRows]) => {
        if (!active) return
        const upcomingEvents = (eventRows || [])
          .filter((event: any) => new Date(event.endAt).getTime() >= now)
          .sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
          .slice(0, 4)
        const ongoingPolls = (pollRows || [])
          .filter((poll: any) => {
            const startAt = new Date(poll.startAt).getTime()
            const endAt = new Date(poll.endAt).getTime()
            return poll.status === 'APPROVED' && !poll.closedAt && now >= startAt && now <= endAt
          })
          .slice(0, 4)
        setEvents(upcomingEvents)
        setPolls(ongoingPolls)
      })
      .catch(() => {
        if (!active) return
        setEvents([])
        setPolls([])
      })
      .finally(() => {
        if (!active) return
        setEventsLoading(false)
        setPollsLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, communityId, isCommunityDashboardView, refreshKey])

  React.useEffect(() => {
    if (!communityId || !isEventsView) return
    setEventsLoading(true)
    setEventsMessage(null)
    api
      .get<any[]>(`/communities/${communityId}/events`)
      .then((rows) => setEventList(rows))
      .catch((err: any) => setEventsMessage(err?.message || 'Could not load events'))
      .finally(() => setEventsLoading(false))
  }, [api, communityId, isEventsView, refreshKey])

  React.useEffect(() => {
    if (!isExpensesView) return
    const targetPeriod = routeParams?.periodCode
    if (targetPeriod && targetPeriod !== selected) {
      setSelected(targetPeriod)
    }
  }, [isExpensesView, routeParams?.periodCode, selected])

  React.useEffect(() => {
    if (!communityId || !isProgramsView) return
    setProgramsLoading(true)
    setProgramsMessage(null)
    api
      .get<any[]>(`/communities/${communityId}/programs`)
      .then((rows) => setProgramList(rows))
      .catch((err: any) => setProgramsMessage(err?.message || 'Could not load programs'))
      .finally(() => setProgramsLoading(false))
  }, [api, communityId, isProgramsView, refreshKey])

  React.useEffect(() => {
    if (!communityId || !isPollsView) return
    setPollsLoading(true)
    setPollsMessage(null)
    api
      .get<any[]>(`/communities/${communityId}/polls`)
      .then((rows) => setPollList(rows))
      .catch((err: any) => setPollsMessage(err?.message || 'Could not load polls'))
      .finally(() => setPollsLoading(false))
  }, [api, communityId, isPollsView, refreshKey])

  React.useEffect(() => {
    if (!isNotificationsView) return
    setNotificationsLoading(true)
    setNotificationsMessage(null)
    api
      .get<any[]>('/notifications?limit=50')
      .then((rows) => setNotifications(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setNotificationsMessage(err?.message || 'Could not load notifications'))
      .finally(() => setNotificationsLoading(false))
  }, [api, isNotificationsView, refreshKey])

  React.useEffect(() => {
    if (!isNotificationsView) return
    setPrefsLoading(true)
    api
      .get<any[]>('/notification-preferences')
      .then((rows) => setNotificationPrefs(Array.isArray(rows) ? rows : []))
      .catch(() => setNotificationPrefs([]))
      .finally(() => setPrefsLoading(false))
  }, [api, isNotificationsView, refreshKey])

  React.useEffect(() => {
    if (!communityId || !isCommunicationsView) return
    setAnnouncementsLoading(true)
    setAnnouncementsMessage(null)
    api
      .get<any[]>(`/communities/${communityId}/announcements`)
      .then((rows) => setAnnouncements(Array.isArray(rows) ? rows : []))
      .catch((err: any) => setAnnouncementsMessage(err?.message || 'Could not load announcements'))
      .finally(() => setAnnouncementsLoading(false))
  }, [api, communityId, isCommunicationsView, refreshKey])

  const markNotificationRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`, {})
      setNotifications((prev) => prev.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)))
    } catch (err: any) {
      setNotificationsMessage(err?.message || 'Failed to mark as read')
    }
  }

  const updatePreference = async (channel: string, enabled: boolean) => {
    setPrefsLoading(true)
    try {
      const rows = await api.patch<any[]>('/notification-preferences', {
        preferences: [{ channel, enabled }],
      })
      setNotificationPrefs(Array.isArray(rows) ? rows : [])
    } catch {
      setNotificationsMessage('Failed to update preferences')
    } finally {
      setPrefsLoading(false)
    }
  }

  if (!beId && !isGlobalDashboardView && !isCommunityDashboardView) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>No billing entity assigned</Text>
        <Text style={styles.muted}>Your account needs a billing entity role.</Text>
        <TouchableOpacity style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const communityLabel = selectedCommunityId
    ? beScope.communityMap?.[selectedCommunityId]?.name ||
      beScope.communityMap?.[selectedCommunityId]?.code ||
      selectedCommunityId
    : null
  const title = initializingDashboard
    ? 'Loading'
    : isCommunityDashboardView && communityLabel
      ? communityLabel
      : section
  return (
      <ScreenChrome
        title={title}
        activeSection={section}
        onScopeChange={() => {
          setSelected(null)
          setRows([])
        }}
        onNavigateSection={(next) => {
          setSection(next)
          navigation.setParams({ section: next })
        }}
      >
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {cartCount > 0 ? (
        <TouchableOpacity
          style={[styles.cartFloating, cartPulse && styles.cartButtonPulse]}
          onPress={() => setCartOpen((open) => !open)}
        >
          <Text style={styles.cartButtonText}>{cartTotal.toFixed(2)}</Text>
          <View style={styles.cartBadge}>
            <Text style={styles.cartBadgeText}>{cartCount}</Text>
          </View>
        </TouchableOpacity>
      ) : null}
      <CartPanel
        open={cartOpen}
        lines={cartLines}
        total={cartTotal}
        submitting={cartSubmitting}
        message={cartMessage}
        beMetaMap={beMetaMap}
        onRemove={removeCartLine}
        onClear={clearCart}
        onSubmit={submitCart}
      />
      {initializingDashboard ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading…</Text>
        </View>
      ) : isGlobalDashboardView ? (
        <GlobalDashboard
          loading={globalDueLoading}
          message={globalDueMessage}
          totals={globalDue?.totals ?? null}
          communities={globalDue?.communities ?? []}
          onAddTotal={addGlobalTotals}
          onCommunityPress={(id) => {
            setSelectedCommunityId(id)
            setSection('Community Dashboard')
            navigation.setParams({ section: 'Community Dashboard' })
          }}
          formatMoney={formatMoney}
        />
      ) : isCommunityDashboardView ? (
        <CommunityDashboard
          loading={communityDueLoading}
          message={communityDueMessage}
          live={
            communityDue?.live ?? {
              period: null,
              totals: { dueStart: 0, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 },
              billingEntities: [],
              previousClosed: null,
            }
          }
          beMetaMap={beMetaMap}
          onBePress={(targetBeId) => {
            beScope.setSelectedBeId(targetBeId)
            setSection('Dashboard')
            navigation.setParams({ section: 'Dashboard' })
          }}
          onBeAdd={(targetBeId, amount, label) =>
            addCartLine({ billingEntityId: targetBeId, amount, label })
          }
          onAddAll={(rows) =>
            rows.forEach((row: any) => {
              const due = Number(row.dueEnd || 0)
              if (due <= 0) return
              if (isInCart(row.billingEntityId)) return
              const label = beMetaMap[row.billingEntityId]?.name || row.billingEntityId
              addCartLine({
                billingEntityId: row.billingEntityId,
                amount: due,
                label,
              })
            })
          }
          events={events}
          polls={polls}
          eventsLoading={eventsLoading}
          pollsLoading={pollsLoading}
          onEventPress={(id) => navigation.navigate('EventDetail', { eventId: id })}
          onPollPress={(id) => navigation.navigate('PollDetail', { pollId: id })}
          formatMoney={formatMoney}
          isInCart={isInCart}
        />
      ) : isExpensesView ? (
        <FlatList
          data={rows}
          keyExtractor={(_, index) => `${tab}:${index}`}
          contentContainerStyle={styles.expensesListContent}
          style={styles.expensesList}
          ListHeaderComponent={
            <View style={styles.expensesHeader}>
              <Text style={styles.sectionTitle}>Periods</Text>
              <View style={styles.periodRow}>
                <FlatList
                  data={periods}
                  horizontal
                  keyExtractor={(item) => item.id}
                  style={[styles.periodList, styles.periodListRow]}
                  contentContainerStyle={styles.periodListContent}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.periodChip, selected === item.code && styles.periodChipActive]}
                      onPress={() => setSelected(item.code)}
                    >
                      <Text style={[styles.periodChipText, selected === item.code && styles.periodChipTextActive]}>{item.code}</Text>
                    </TouchableOpacity>
                  )}
                />
                <View style={styles.periodTotal}>
                  <Text style={styles.periodTotalValue}>{periodTotal.toFixed(2)}</Text>
                </View>
              </View>
              <View style={styles.allocationsHeader}>
                <Text style={[styles.sectionTitle, styles.allocationsTitle]}>Allocations</Text>
                {memberCount === null || memberCount > 1 ? (
                  <TouchableOpacity
                    style={styles.toggleButton}
                    onPress={() => setTab((prev) => (prev === 'UNIT' ? 'SPLIT' : 'UNIT'))}
                  >
                    <Text style={styles.toggleIcon}>⇄</Text>
                    <Text style={styles.toggleLabel}>{tab === 'UNIT' ? 'By member' : 'By split'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
          ListEmptyComponent={
            loading ? (
              <View style={styles.centered}>
                <ActivityIndicator />
                <Text style={styles.muted}>Loading…</Text>
              </View>
            ) : (
              <Text style={styles.muted}>No data yet.</Text>
            )
          }
          renderItem={({ item }) => {
            const label =
              tab === 'UNIT'
                ? item.unitName || item.unitCode || item.unitId || 'Member'
                : item.splitGroupName || item.splitGroupCode || item.splitGroupId || 'Split group'
            const topId = tab === 'UNIT' ? item.unitId : item.splitGroupId
            const isExpanded = !!topId && expandedTopId === topId
            const hideTopRow = rows.length === 1 && isExpanded

            const handleTopPress = () => {
              if (!beId || !selected || !topId) return
              if (expandedTopId === topId) {
                setExpandedTopId(null)
                setExpandedTopRows([])
                setExpandedMidId(null)
                setExpandedDetailRows([])
                return
              }
              loadTopDrill(topId)
            }

            return (
              <View style={styles.expenseRowCard}>
                {!hideTopRow ? (
                  <TouchableOpacity style={styles.expenseRowCardRow} onPress={handleTopPress}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    <Text style={styles.rowAmount}>{Number(item.amount || 0).toFixed(2)}</Text>
                  </TouchableOpacity>
                ) : null}
                {isExpanded ? (
                  <View style={styles.expenseDrillBlock}>
                    {expandedTopLoading ? (
                      <View style={styles.cardLoading}>
                        <ActivityIndicator />
                        <Text style={styles.muted}>Loading…</Text>
                      </View>
                    ) : expandedTopRows.length ? (
                      expandedTopRows.length === 1 ? (
                        <View style={styles.expenseDetailList}>
                          {expandedDetailLoading ? (
                            <View style={styles.cardLoading}>
                              <ActivityIndicator />
                              <Text style={styles.muted}>Loading…</Text>
                            </View>
                          ) : expandedDetailRows.length ? (
                            expandedDetailRows.map((detail: any) => (
                              <View key={detail.allocationId || detail.expenseId} style={styles.expenseDetailCard}>
                                <View style={styles.expenseRowHeader}>
                                  <Text style={styles.expenseDetailLabel}>
                                    {detail.expenseDescription || detail.expenseTypeCode || 'Allocation'}
                                  </Text>
                                  <Text style={styles.expenseDetailAmount}>{formatMoney(detail.amount, detail.currency)}</Text>
                                </View>
                                <Text style={styles.cardRowMeta}>
                                  {detail.expenseTypeCode || '—'} {detail.expenseId ? `· ${detail.expenseId}` : ''}
                                </Text>
                              </View>
                            ))
                          ) : (
                            <Text style={styles.muted}>No detail rows.</Text>
                          )}
                        </View>
                      ) : (
                        expandedTopRows.map((child: any) => {
                          const childId = tab === 'UNIT' ? child.splitGroupId : child.unitId
                          const childLabel =
                            tab === 'UNIT'
                              ? child.splitGroupName || child.splitGroupCode || child.splitGroupId || 'Split group'
                              : child.unitName || child.unitCode || child.unitId || 'Member'
                          const isChildExpanded = !!childId && expandedMidId === childId
                          const handleChildPress = () => {
                            if (!beId || !selected || !childId || !topId) return
                            if (expandedMidId === childId) {
                              setExpandedMidId(null)
                              setExpandedDetailRows([])
                              return
                            }
                            loadDetailDrill(topId, childId)
                          }

                          return (
                            <View key={childId || childLabel} style={styles.expenseDrillCard}>
                              <TouchableOpacity style={styles.expenseDrillRowHeader} onPress={handleChildPress}>
                                <Text style={styles.expenseDrillLabel}>{childLabel}</Text>
                                <Text style={styles.expenseDrillAmount}>{Number(child.amount || 0).toFixed(2)}</Text>
                              </TouchableOpacity>
                              {isChildExpanded ? (
                                <View style={styles.expenseDetailList}>
                                  {expandedDetailLoading ? (
                                    <View style={styles.cardLoading}>
                                      <ActivityIndicator />
                                      <Text style={styles.muted}>Loading…</Text>
                                    </View>
                                  ) : expandedDetailRows.length ? (
                                    expandedDetailRows.map((detail: any) => (
                                      <View key={detail.allocationId || detail.expenseId} style={styles.expenseDetailCard}>
                                        <View style={styles.expenseRowHeader}>
                                          <Text style={styles.expenseDetailLabel}>
                                            {detail.expenseDescription || detail.expenseTypeCode || 'Allocation'}
                                          </Text>
                                          <Text style={styles.expenseDetailAmount}>{formatMoney(detail.amount, detail.currency)}</Text>
                                        </View>
                                        <Text style={styles.cardRowMeta}>
                                          {detail.expenseTypeCode || '—'} {detail.expenseId ? `· ${detail.expenseId}` : ''}
                                        </Text>
                                      </View>
                                    ))
                                  ) : (
                                    <Text style={styles.muted}>No detail rows.</Text>
                                  )}
                                </View>
                              ) : null}
                            </View>
                          )
                        })
                      )
                    ) : (
                      <Text style={styles.muted}>No drilldown rows.</Text>
                    )}
                  </View>
                ) : null}
              </View>
            )
          }}
        />
      ) : isDashboardView ? (
        <BeDashboard
          beId={beId}
          statementLoading={statementLoading}
          statement={statement}
          previousPeriodCode={previousPeriodCode}
          previousClosedStatement={previousClosedStatement}
          liveTotals={beLiveTotals}
          statementDetail={statementDetail}
          statementDetailOpen={statementDetailOpen}
          setStatementDetailOpen={(next) => setStatementDetailOpen(next)}
          programBuckets={programBuckets}
          onNavigateStatement={(periodCode) =>
            navigation.navigate('StatementDetail', { beId, periodCode, programBuckets })
          }
          onNavigateProgram={(programId) => navigation.navigate('ProgramDetail', { programId })}
          onNavigateExpenses={(periodCode) => navigation.navigate('Main', { section: 'Expenses', periodCode })}
          onAddBalance={() => {
            const dueEnd = Number(statementDetail?.statement?.dueEnd || 0)
            if (dueEnd <= 0) return
            addCartLine({
              billingEntityId: beId,
              amount: dueEnd,
              label: 'Balance',
            })
          }}
          onAddBucket={(bucket, amount, label) =>
            addCartLine({
              billingEntityId: beId,
              bucket,
              amount,
              label,
            })
          }
          isInCart={isInCart}
        />
      ) : isProgramsView ? (
        <>
          {programsMessage ? <Text style={styles.error}>{programsMessage}</Text> : null}
          <View style={styles.sectionTopSpacer} />
          {!communityId ? (
            <View style={styles.listCard}>
              <Text style={styles.muted}>Select a billing entity to see programs.</Text>
            </View>
          ) : programsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading programs…</Text>
            </View>
          ) : (
            <FlatList
              data={programList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.expensesListContent}
              ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.expenseRowCard}
                  onPress={() => navigation.navigate('ProgramDetail', { programId: item.id })}
                >
                  <Text style={styles.rowLabel}>{item.name || item.code}</Text>
                  <Text style={styles.rowAmount}>{formatMoney(item.balance, 'RON')}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : isPollsView ? (
        <>
          {pollsMessage ? <Text style={styles.error}>{pollsMessage}</Text> : null}
          <View style={styles.sectionTopSpacer} />
          {!communityId ? (
            <View style={styles.listCard}>
              <Text style={styles.muted}>Select a billing entity to see polls.</Text>
            </View>
          ) : pollsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading polls…</Text>
            </View>
          ) : (
            <FlatList
              data={pollList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.expensesListContent}
              ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.expenseRowCard}
                  onPress={() => navigation.navigate('PollDetail', { pollId: item.id })}
                >
                  <View style={styles.pollRowTitle}>
                    <View style={[styles.pollStatusPill, item.userVoted ? styles.pollStatusPillOk : styles.pollStatusPillWarn]}>
                      <Text style={styles.pollStatusPillText}>{item.userVoted ? 'Voted' : 'Vote'}</Text>
                    </View>
                    <Text style={styles.rowLabel}>{item.title}</Text>
                  </View>
                  {item.userVoted ? <Text style={styles.cardRowMeta}>Your vote: {formatVoteSummary(item)}</Text> : null}
                  <Text style={styles.cardRowMeta}>
                    {item.status} · Ends {formatDate(item.endAt)}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : isEventsView ? (
        <>
          {eventsMessage ? <Text style={styles.error}>{eventsMessage}</Text> : null}
          <View style={styles.sectionTopSpacer} />
          {!communityId ? (
            <View style={styles.listCard}>
              <Text style={styles.muted}>Select a billing entity to see events.</Text>
            </View>
          ) : eventsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading events…</Text>
            </View>
          ) : (
            <FlatList
              data={eventList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.expensesListContent}
              ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.expenseRowCard}
                  onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
                >
                  <View style={styles.pollRowTitle}>
                    <View
                      style={[
                        styles.pollStatusPill,
                        item.rsvpStatus === 'GOING'
                          ? styles.pollStatusPillOk
                          : item.rsvpStatus === 'NOT_GOING'
                            ? styles.pollStatusPillNo
                            : styles.pollStatusPillWarn,
                      ]}
                    >
                      <Text style={styles.pollStatusPillText}>
                        {item.rsvpStatus === 'GOING'
                          ? 'Going'
                          : item.rsvpStatus === 'NOT_GOING'
                            ? 'Not going'
                            : 'RSVP'}
                      </Text>
                    </View>
                    <Text style={styles.rowLabel}>{item.title}</Text>
                  </View>
                  <Text style={styles.cardRowMeta}>
                    {formatDate(item.startAt)} · {item.location || 'No location'}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : isNotificationsView ? (
        <>
          {notificationsMessage ? <Text style={styles.error}>{notificationsMessage}</Text> : null}
          <View style={styles.sectionTopSpacer} />
          {notificationsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading notifications…</Text>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.expensesListContent}
              ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
              ListHeaderComponent={
                <View style={styles.listCard}>
                  <Text style={styles.sectionTitle}>Preferences</Text>
                  {prefsLoading ? (
                    <Text style={styles.muted}>Loading preferences…</Text>
                  ) : (
                    notificationPrefs.map((pref) => (
                      <View key={pref.channel} style={styles.row}>
                        <Text style={styles.rowLabel}>{formatChannelLabel(pref.channel)}</Text>
                        <Switch
                          value={!!pref.enabled}
                          onValueChange={(value) => updatePreference(pref.channel, value)}
                        />
                      </View>
                    ))
                  )}
                </View>
              }
              ListEmptyComponent={<Text style={styles.muted}>No notifications yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.expenseRowCard}>
                  <View style={styles.pollRowTitle}>
                    <View
                      style={[
                        styles.pollStatusPill,
                        item.readAt ? styles.pollStatusPillOk : styles.pollStatusPillWarn,
                      ]}
                    >
                      <Text style={styles.pollStatusPillText}>{item.readAt ? 'Read' : 'Unread'}</Text>
                    </View>
                    <Text style={styles.rowLabel}>{item.title}</Text>
                  </View>
                  <Text style={styles.cardRowMeta}>{item.body}</Text>
                  <Text style={styles.cardRowMeta}>
                    {formatDate(item.createdAt)} · {item.source || 'SYSTEM'}
                  </Text>
                  {!item.readAt ? (
                    <TouchableOpacity style={styles.buttonSecondarySmall} onPress={() => markNotificationRead(item.id)}>
                      <Text style={styles.buttonSecondaryText}>Mark read</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            />
          )}
        </>
      ) : isCommunicationsView ? (
        <>
          {announcementsMessage ? <Text style={styles.error}>{announcementsMessage}</Text> : null}
          <View style={styles.sectionTopSpacer} />
          {!communityId ? (
            <View style={styles.listCard}>
              <Text style={styles.muted}>Select a billing entity to see communications.</Text>
            </View>
          ) : announcementsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading announcements…</Text>
            </View>
          ) : (
            <FlatList
              data={announcements}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.expensesListContent}
              ItemSeparatorComponent={() => <View style={styles.expenseSeparator} />}
              ListEmptyComponent={<Text style={styles.muted}>No announcements yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.expenseRowCard}>
                  <Text style={styles.rowLabel}>{item.title}</Text>
                  <Text style={styles.cardRowMeta}>{item.body}</Text>
                  {(item.startsAt || item.endsAt) && (
                    <Text style={styles.cardRowMeta}>
                      {item.startsAt ? formatDate(item.startsAt) : '—'} → {item.endsAt ? formatDate(item.endsAt) : '—'}
                    </Text>
                  )}
                  {!!item.impactTags?.length && (
                    <View style={styles.tagRow}>
                      {item.impactTags.map((tag: any) => (
                        <View key={tag.tag} style={styles.tagPill}>
                          <Text style={styles.tagText}>{tag.tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            />
          )}
        </>
      ) : (
        <View style={styles.listCard}>
          <Text style={styles.placeholderTitle}>{section}</Text>
          <Text style={styles.muted}>This section is coming soon.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}
