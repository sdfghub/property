import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { styles } from '../../styles/appStyles'
import { formatDate } from '../../utils/formatters'

type CommunityDashboardProps = {
  loading: boolean
  message: string | null
  live: {
    period: { code?: string } | null
    totals: { dueEnd: number } | null
    billingEntities: any[]
    previousClosed: { period: { code?: string } | null; totals: { dueEnd: number } | null } | null
  }
  beMetaMap: Record<string, { name?: string }>
  onBePress: (beId: string) => void
  onBeAdd: (beId: string, amount: number, label: string) => void
  onAddAll: (rows: any[]) => void
  events: any[]
  polls: any[]
  eventsLoading: boolean
  pollsLoading: boolean
  onEventPress: (id: string) => void
  onPollPress: (id: string) => void
  formatMoney: (value: number, currency?: string) => string
  isInCart: (beId: string) => boolean
}

export function CommunityDashboard({
  loading,
  message,
  live,
  beMetaMap,
  onBePress,
  onBeAdd,
  onAddAll,
  events,
  polls,
  eventsLoading,
  pollsLoading,
  onEventPress,
  onPollPress,
  formatMoney,
  isInCart,
}: CommunityDashboardProps) {
  const hideTotals = (live?.billingEntities?.length ?? 0) === 1
  return (
    <ScrollView contentContainerStyle={styles.dashboardStack}>
      {!hideTotals ? (
        <View style={styles.dashboardCard}>
          <Text style={styles.cardTitle}>Community totals</Text>
          {loading ? (
            <View style={styles.cardLoading}>
              <ActivityIndicator />
              <Text style={styles.muted}>Loading…</Text>
            </View>
          ) : live?.totals ? (
            <>
              <View style={[styles.cardRow, styles.cardRowInline]}>
                <Text style={styles.cardRowTitle}>Due now</Text>
                <Text style={styles.cardRowValue}>{formatMoney(live.totals.dueEnd, 'RON')}</Text>
                {live.totals.dueEnd <= 0 ? <Text style={styles.cardSubtle}>✓</Text> : null}
                {live?.billingEntities?.length ? (
                  <TouchableOpacity style={styles.buttonSecondarySmall} onPress={() => onAddAll(live.billingEntities)}>
                    <Text style={styles.buttonSecondaryText}>Add all</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {live?.period?.code ? <Text style={styles.cardSubtle}>Period: {live.period.code}</Text> : null}
              {live?.previousClosed?.period?.code && live?.previousClosed?.totals ? (
                <Text style={styles.cardSubtle}>
                  Previous closed {live.previousClosed.period.code}: {formatMoney(live.previousClosed.totals.dueEnd, 'RON')}
                </Text>
              ) : (
                <Text style={styles.cardSubtle}>Previous closed: n/a</Text>
              )}
            </>
          ) : (
            <Text style={styles.muted}>No data yet.</Text>
          )}
          {message ? <Text style={styles.error}>{message}</Text> : null}
        </View>
      ) : null}

      <View style={styles.dashboardCard}>
        {!hideTotals ? <Text style={styles.cardTitle}>By billing entity</Text> : null}
        {loading ? (
          <View style={styles.cardLoading}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading…</Text>
          </View>
        ) : live?.billingEntities?.length ? (
          live.billingEntities.map((row: any) => {
            const label = beMetaMap[row.billingEntityId]?.name || row.billingEntityId
            const due = Number(row.dueEnd || 0)
            const inCart = isInCart(row.billingEntityId)
            const initialDue = Number(row.previousClosedDue ?? 0)
            return (
              <View key={row.billingEntityId} style={styles.cardRow}>
                <TouchableOpacity onPress={() => onBePress(row.billingEntityId)}>
                  <Text style={styles.cardRowTitle}>{label}</Text>
                </TouchableOpacity>
                <Text style={styles.cardSubtle}>Initial due amount: {formatMoney(initialDue, 'RON')}</Text>
                <Text style={styles.cardSubtle}>Charges: {formatMoney(Number(row.charges || 0), 'RON')}</Text>
                <Text style={styles.cardSubtle}>Payments: {formatMoney(Number(row.payments || 0), 'RON')}</Text>
                <View style={[styles.cardRow, styles.cardRowInline]}>
                  <Text style={styles.cardRowTitle}>Due now</Text>
                  <Text style={styles.cardRowValue}>{formatMoney(due, 'RON')}</Text>
                  {due <= 0 ? <Text style={styles.cardSubtle}>✓</Text> : null}
                  {due > 0 && !inCart ? (
                    <TouchableOpacity
                      style={styles.buttonSecondarySmall}
                      onPress={() => onBeAdd(row.billingEntityId, due, label)}
                    >
                      <Text style={styles.buttonSecondaryText}>Add</Text>
                    </TouchableOpacity>
                  ) : due > 0 && inCart ? (
                    <Text style={styles.muted}>In cart</Text>
                  ) : null}
                </View>
              </View>
            )
          })
        ) : (
          <Text style={styles.muted}>No billing entities found.</Text>
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
            <TouchableOpacity key={event.id} style={styles.cardRow} onPress={() => onEventPress(event.id)}>
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
                    {event.rsvpStatus === 'GOING' ? 'Going' : event.rsvpStatus === 'NOT_GOING' ? 'Not going' : 'RSVP'}
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
            <TouchableOpacity key={poll.id} style={styles.cardRow} onPress={() => onPollPress(poll.id)}>
              <View style={styles.pollRowTitle}>
                <View style={[styles.pollStatusPill, poll.userVoted ? styles.pollStatusPillOk : styles.pollStatusPillWarn]}>
                  <Text style={styles.pollStatusPillText}>{poll.userVoted ? 'Voted' : 'Vote'}</Text>
                </View>
                <Text style={styles.cardRowTitle}>{poll.title}</Text>
              </View>
              <Text style={styles.cardRowMeta}>{formatDate(poll.endAt)}</Text>
            </TouchableOpacity>
          ))
        ) : (
          <Text style={styles.muted}>No active polls.</Text>
        )}
      </View>
    </ScrollView>
  )
}
