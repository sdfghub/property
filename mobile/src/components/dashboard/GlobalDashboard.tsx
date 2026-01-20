import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { styles } from '../../styles/appStyles'

type GlobalDashboardProps = {
  loading: boolean
  message: string | null
  totals: {
    live: { dueEnd: number; charges: number; payments: number }
    previousClosed: { dueEnd: number; charges: number; payments: number }
  } | null
  communities: Array<{ community?: any; live?: { totals?: any } }>
  onAddTotal: () => void
  onCommunityPress: (communityId: string) => void
  formatMoney: (value: number, currency?: string) => string
}

export function GlobalDashboard({
  loading,
  message,
  totals,
  communities,
  onAddTotal,
  onCommunityPress,
  formatMoney,
}: GlobalDashboardProps) {
  return (
    <ScrollView contentContainerStyle={styles.dashboardStack}>
      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>Financial situation</Text>
        {loading ? (
          <View style={styles.cardLoading}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading…</Text>
          </View>
        ) : totals ? (
          <>
            <Text style={styles.cardSubtle}>
              Initial due amount: {formatMoney(totals.previousClosed.dueEnd, 'RON')}
            </Text>
            <Text style={styles.cardSubtle}>
              Charges: {formatMoney(totals.live.charges, 'RON')}
            </Text>
            <Text style={styles.cardSubtle}>
              Payments: {formatMoney(totals.live.payments, 'RON')}
            </Text>
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardRowTitle}>Due now</Text>
              <Text style={styles.cardRowValue}>{formatMoney(totals.live.dueEnd, 'RON')}</Text>
              {totals.live.dueEnd <= 0 ? <Text style={styles.cardSubtle}>✓</Text> : null}
              {totals.live.dueEnd > 0 ? (
                <TouchableOpacity style={styles.buttonSecondarySmall} onPress={onAddTotal}>
                  <Text style={styles.buttonSecondaryText}>Add to cart</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : (
          <Text style={styles.muted}>No data yet.</Text>
        )}
        {message ? <Text style={styles.error}>{message}</Text> : null}
      </View>

      <View style={styles.dashboardCard}>
        <Text style={styles.cardTitle}>By community</Text>
        {loading ? (
          <View style={styles.cardLoading}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading…</Text>
          </View>
        ) : communities?.length ? (
          communities.map((row: any) => {
            const id = row?.community?.id || ''
            const label = row?.community?.name || row?.community?.code || id || 'Community'
            const liveTotals = row?.live?.totals || { dueEnd: 0, charges: 0, payments: 0 }
            const initialDue = Number(row?.live?.previousClosed?.totals?.dueEnd ?? 0)
            return (
              <TouchableOpacity
                key={id || label}
                style={styles.cardRow}
                onPress={() => id && onCommunityPress(id)}
              >
                <Text style={styles.cardRowTitle}>{label}</Text>
                <Text style={styles.cardSubtle}>Initial due amount: {formatMoney(initialDue, 'RON')}</Text>
                <Text style={styles.cardSubtle}>Charges: {formatMoney(liveTotals.charges, 'RON')}</Text>
                <Text style={styles.cardSubtle}>Payments: {formatMoney(liveTotals.payments, 'RON')}</Text>
                <View style={[styles.cardRow, styles.cardRowInline]}>
                  <Text style={styles.cardRowTitle}>Due now</Text>
                  <Text style={styles.cardRowValue}>{formatMoney(liveTotals.dueEnd, 'RON')}</Text>
                  {liveTotals.dueEnd <= 0 ? <Text style={styles.cardSubtle}>✓</Text> : null}
                </View>
              </TouchableOpacity>
            )
          })
        ) : (
          <Text style={styles.muted}>No communities found.</Text>
        )}
      </View>
    </ScrollView>
  )
}
