import React from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatMoney } from '../utils/formatters'
export function ProgramDetailScreen() {
  const { api } = useAuth()
  const beScope = useBeScope()
  const communityId = beScope.beMetaMap[beScope.selectedBeId || '']?.communityId
  const route = useRoute<any>()
  const programId = route?.params?.programId as string | undefined
  const [detail, setDetail] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const loadProgram = React.useCallback(() => {
    if (!communityId || !programId) return
    setLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/${communityId}/programs/${programId}/ledger`)
      .then((data) => setDetail(data))
      .catch((err: any) => setMessage(err?.message || 'Could not load program'))
      .finally(() => setLoading(false))
  }, [api, communityId, programId])

  React.useEffect(() => {
    loadProgram()
  }, [loadProgram])

  return (
    <ScreenChrome title="Program">
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!communityId || !programId ? (
        <View style={styles.listCard}>
          <Text style={styles.muted}>Program not available.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading program…</Text>
        </View>
      ) : detail ? (
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>{detail.program?.name || detail.program?.code || 'Program'}</Text>
            <Text style={styles.cardSubtle}>Bucket: {detail.program?.bucket || '—'}</Text>
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
          <Text style={styles.muted}>No program data.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}
