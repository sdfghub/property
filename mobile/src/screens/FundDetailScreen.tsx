import React from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatMoney } from '../utils/formatters'
export function FundDetailScreen() {
  const { api } = useAuth()
  const beScope = useBeScope()
  const communityId = beScope.beMetaMap[beScope.selectedBeId || '']?.communityId
  const route = useRoute<any>()
  const fundId = route?.params?.fundId as string | undefined
  const [detail, setDetail] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const loadFund = React.useCallback(() => {
    if (!communityId || !fundId) return
    setLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/${communityId}/funds/${fundId}/ledger`)
      .then((data) => setDetail(data))
      .catch((err: any) => setMessage(err?.message || 'Could not load fund'))
      .finally(() => setLoading(false))
  }, [api, communityId, fundId])

  React.useEffect(() => {
    loadFund()
  }, [loadFund])

  return (
    <ScreenChrome title="Fund">
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!communityId || !fundId ? (
        <View style={styles.listCard}>
          <Text style={styles.muted}>Fund not available.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading fund…</Text>
        </View>
      ) : detail ? (
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>{detail.fund?.name || detail.fund?.code || 'Fund'}</Text>
            <Text style={styles.cardSubtle}>Bucket: {detail.fund?.bucket || '—'}</Text>
            <Text style={styles.cardSubtle}>
              Net: {formatMoney(detail.summary?.net, detail.summary?.currency || 'RON')}
            </Text>
            <Text style={styles.cardSubtle}>
              Inflow: {formatMoney(detail.summary?.inflow, detail.summary?.currency || 'RON')}
            </Text>
            <Text style={styles.cardSubtle}>
              Outflow: {formatMoney(detail.summary?.outflow, detail.summary?.currency || 'RON')}
            </Text>
          </View>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Recent entries</Text>
            {detail.recent?.length ? (
              detail.recent.map((entry: any) => (
                <View key={entry.id} style={styles.cardRow}>
                  <Text style={styles.cardRowTitle}>{entry.kind}</Text>
                  <Text style={styles.cardRowMeta}>{formatMoney(entry.amount, entry.currency)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>No ledger entries.</Text>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.listCard}>
          <Text style={styles.muted}>No fund data.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}
