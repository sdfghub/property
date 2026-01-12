import React from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import type { PeriodRef } from '@shared/api/types'
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

export function MainScreen() {
  const { api, activeRole, roles, logout } = useAuth()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const routeParams = route?.params as { section?: string; periodCode?: string } | undefined
  const [section, setSection] = React.useState<string>(routeParams?.section || 'Dashboard')
  const isDashboardView = section === 'Dashboard'
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
  const [refreshKey] = React.useState(0)
  const { beMetaMap, setBeMeta } = beScope
  const periodTotal = React.useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows])

  const beRole =
    (activeRole?.scopeType === 'BILLING_ENTITY' ? activeRole : null) || roles.find((role) => role.scopeType === 'BILLING_ENTITY') || null
  const beRoles = roles.filter((role) => role.scopeType === 'BILLING_ENTITY' && role.scopeId)
  const beId = beScope.selectedBeId || beRole?.scopeId || ''

  React.useEffect(() => {
    if (routeParams?.section && routeParams.section !== section) {
      setSection(routeParams.section)
    }
  }, [routeParams?.section, section])

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
    setEventsLoading(true)
    setPollsLoading(true)
    setProgramsLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/be/${beId}/dashboard`)
      .then((data) => {
        if (!active) return
        const period = data?.period
        setPreviousPeriodCode(data?.previousPeriod?.code ?? null)
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
        setEvents(Array.isArray(data?.events) ? data.events : [])
        setPolls(Array.isArray(data?.polls) ? data.polls : [])
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
          setEventsLoading(false)
          setPollsLoading(false)
          setProgramsLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [api, beId, isDashboardView, setBeMeta, refreshKey])

  const communityId = beMetaMap[beId]?.communityId

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

  if (!beId) {
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

  const title = section
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
      {isExpensesView ? (
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
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Last closed period</Text>
            {statementLoading ? (
              <View style={styles.cardLoading}>
                <ActivityIndicator />
                <Text style={styles.muted}>Loading statement…</Text>
              </View>
            ) : statement ? (
              <>
                <Text style={styles.cardValue}>{statement.periodCode}</Text>
                <View style={[styles.cardRow, styles.cardRowInline]}>
                  <Text style={styles.cardSubtle}>Starting balance:</Text>
                  {previousPeriodCode && statementDetail?.statement && Number(statementDetail.statement.dueEnd || 0) !== 0 ? (
                    <TouchableOpacity
                      style={styles.valueButton}
                      onPress={() =>
                        navigation.navigate('StatementDetail', {
                          beId,
                          periodCode: previousPeriodCode,
                          programBuckets,
                        })
                      }
                    >
                      <Text style={[styles.valueButtonText, statement.dueStart <= 0 ? styles.balanceGood : styles.balanceBad]}>
                        {statement.dueStart.toFixed(2)} {statement.currency || 'RON'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={[styles.cardSubtle, statement.dueStart <= 0 ? styles.balanceGood : styles.balanceBad]}>
                      {statement.dueStart.toFixed(2)} {statement.currency || 'RON'}
                    </Text>
                  )}
                </View>
                <View style={[styles.cardRow, styles.cardRowInline]}>
                  <Text style={styles.cardSubtle}>Charges this period:</Text>
                  <TouchableOpacity
                    style={styles.valueButton}
                    onPress={() => setStatementDetailOpen((prev) => !prev)}
                  >
                    <Text style={styles.valueButtonText}>
                      {statement.charges.toFixed(2)} {statement.currency || 'RON'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.cardRow, styles.cardRowInline]}>
                  <Text style={styles.cardSubtle}>Statement:</Text>
                  <TouchableOpacity
                    style={styles.valueButton}
                    onPress={() =>
                      navigation.navigate('StatementDetail', {
                        beId,
                        periodCode: statement.periodCode,
                        programBuckets,
                      })
                    }
                  >
                    <Text style={styles.valueButtonText}>View</Text>
                  </TouchableOpacity>
                </View>
                {statementDetailOpen ? (
                  <View style={styles.statementDetail}>
                    {statementDetail?.ledgerEntries?.length ? (
                      statementDetail.ledgerEntries
                        .filter((entry: any) => entry.kind === 'CHARGE')
                        .map((entry: any) => {
                          const program = programBuckets[entry.bucket || '']
                          const label = program?.name
                            ? program.name
                            : program?.code
                              ? program.code
                              : entry.bucket === 'ALLOCATED_EXPENSE'
                                ? 'Allocated'
                                : String(entry.bucket || 'Charge')
                          const onPress =
                            entry.bucket === 'ALLOCATED_EXPENSE' && statement?.periodCode
                              ? () => navigation.navigate('Main', { section: 'Expenses', periodCode: statement.periodCode })
                              : program?.id
                                ? () => navigation.navigate('ProgramDetail', { programId: program.id })
                                : null
                          return (
                            <TouchableOpacity key={entry.id} style={styles.statementRow} onPress={onPress} disabled={!onPress}>
                              <View style={styles.statementRowHeader}>
                                <Text style={styles.statementRowTitle}>{label}</Text>
                                <Text style={styles.statementRowAmount}>{formatMoney(entry.amount, entry.currency)}</Text>
                              </View>
                            </TouchableOpacity>
                          )
                        })
                    ) : (
                      <Text style={styles.muted}>No charges.</Text>
                    )}
                  </View>
                ) : null}
                {statementDetail?.statement ? (
                  <View style={styles.statementSummary}>
                    <Text style={styles.cardSubtle}>
                      Payments: {formatMoney(statementDetail.statement.payments, statementDetail.statement.currency)}
                    </Text>
                    <Text style={styles.cardSubtle}>
                      Adjustments: {formatMoney(statementDetail.statement.adjustments, statementDetail.statement.currency)}
                    </Text>
                    <Text style={styles.cardSubtle}>
                      Due end: {formatMoney(statementDetail.statement.dueEnd, statementDetail.statement.currency)}
                    </Text>
                    {Number(statementDetail.statement.dueEnd || 0) > 0 ? (
                      <TouchableOpacity style={styles.paymentButton} onPress={() => Alert.alert('Coming soon', 'Payments are coming soon.')}>
                        <Text style={styles.paymentButtonText}>Pay balance</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.muted}>No closed periods yet.</Text>
            )}
          </View>

          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Upcoming events</Text>
            {eventsLoading ? (
              <View style={styles.cardLoading}>
                <ActivityIndicator />
                <Text style={styles.muted}>Loading events…</Text>
              </View>
            ) : events.length ? (
              events.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.cardRow}
                  onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
                >
                  <View style={styles.pollRowTitle}>
                    <View
                      style={[
                        styles.pollStatusPill,
                        event.rsvpStatus === 'GOING'
                          ? styles.pollStatusPillOk
                          : event.rsvpStatus === 'NOT_GOING'
                            ? styles.pollStatusPillNo
                            : styles.pollStatusPillWarn,
                      ]}
                    >
                      <Text style={styles.pollStatusPillText}>
                        {event.rsvpStatus === 'GOING'
                          ? 'Going'
                          : event.rsvpStatus === 'NOT_GOING'
                            ? 'Not going'
                            : 'RSVP'}
                      </Text>
                    </View>
                    <Text style={styles.cardRowTitle}>{event.title}</Text>
                  </View>
                  <Text style={styles.cardRowMeta}>{formatDate(event.startAt)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.muted}>No upcoming events.</Text>
            )}
          </View>

          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Active polls</Text>
            {pollsLoading ? (
              <View style={styles.cardLoading}>
                <ActivityIndicator />
                <Text style={styles.muted}>Loading polls…</Text>
              </View>
            ) : polls.length ? (
              polls.map((poll) => (
                <TouchableOpacity
                  key={poll.id}
                  style={styles.cardRow}
                  onPress={() => navigation.navigate('PollDetail', { pollId: poll.id })}
                >
                  <View style={styles.pollRowTitle}>
                    <View style={[styles.pollStatusPill, poll.userVoted ? styles.pollStatusPillOk : styles.pollStatusPillWarn]}>
                      <Text style={styles.pollStatusPillText}>{poll.userVoted ? 'Voted' : 'Vote'}</Text>
                    </View>
                    <Text style={styles.cardRowTitle}>{poll.title}</Text>
                  </View>
                  {poll.userVoted ? <Text style={styles.cardRowMeta}>Your vote: {formatVoteSummary(poll)}</Text> : null}
                  <Text style={styles.cardRowMeta}>Ends {formatDate(poll.endAt)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.muted}>No active polls.</Text>
            )}
          </View>
        </ScrollView>
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
