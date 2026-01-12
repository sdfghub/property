import React from 'react'
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useAuth } from '@shared/auth/useAuth'
import type { PeriodRef } from '@shared/api/types'
import { ScreenChrome } from '../components/ScreenChrome'
import { useBeScope } from '../contexts/BeScopeContext'
import { styles } from '../styles/appStyles'
import { formatDate, formatMoney } from '../utils/formatters'

type ProgramBucketMap = Record<string, { id: string; code: string; name: string }>

export function StatementDetailScreen() {
  const { api } = useAuth()
  const navigation = useNavigation<any>()
  const route = useRoute<any>()
  const { setBeMeta, beMetaMap } = useBeScope()
  const beId = route?.params?.beId as string | undefined
  const periodCode = route?.params?.periodCode as string | undefined
  const initialBuckets = (route?.params?.programBuckets as ProgramBucketMap | undefined) ?? {}
  const [detail, setDetail] = React.useState<any | null>(null)
  const [previousPeriodCode, setPreviousPeriodCode] = React.useState<string | null>(null)
  const [programBuckets, setProgramBuckets] = React.useState<ProgramBucketMap>(initialBuckets)
  const [programBucketsLoaded, setProgramBucketsLoaded] = React.useState<boolean>(
    Object.keys(initialBuckets).length > 0,
  )
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const communityId = beMetaMap[beId || '']?.communityId

  React.useEffect(() => {
    if (!beId || !periodCode) return
    setLoading(true)
    setMessage(null)
    api
      .get<any>(`/communities/be/${beId}/periods/${periodCode}/financials`)
      .then((data) => {
        setDetail(data || null)
        if (data?.be?.id) {
          setBeMeta(data.be.id, { name: data.be.name || data.be.code || data.be.id, communityId: data.be.communityId })
        }
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load statement'))
      .finally(() => setLoading(false))
  }, [api, beId, periodCode, setBeMeta])

  React.useEffect(() => {
    if (!beId || !periodCode) return
    api
      .get<PeriodRef[]>(`/communities/be/${beId}/periods/closed`)
      .then((rows) => {
        const idx = rows.findIndex((p) => p.code === periodCode)
        if (idx >= 0 && rows[idx + 1]) {
          setPreviousPeriodCode(rows[idx + 1].code)
        } else {
          setPreviousPeriodCode(null)
        }
      })
      .catch(() => setPreviousPeriodCode(null))
  }, [api, beId, periodCode])

  React.useEffect(() => {
    if (!communityId || programBucketsLoaded) return
    api
      .get<any[]>(`/communities/${communityId}/programs`)
      .then((rows) => {
        const next: ProgramBucketMap = {}
        rows.forEach((prog: any) => {
          if (prog?.bucket) next[prog.bucket] = { id: prog.id, code: prog.code, name: prog.name }
        })
        setProgramBuckets(next)
        setProgramBucketsLoaded(true)
      })
      .catch(() => {
        setProgramBucketsLoaded(true)
        // leave as-is; fallback to bucket labels
      })
  }, [api, communityId, programBucketsLoaded])

  React.useEffect(() => {
    if (!communityId) return
    setProgramBucketsLoaded(Object.keys(initialBuckets).length > 0)
  }, [communityId, initialBuckets])

  const statement = detail?.statement
  const ledgerEntries = Array.isArray(detail?.ledgerEntries) ? detail.ledgerEntries : []

  return (
    <ScreenChrome title="Statement">
      {message ? <Text style={styles.error}>{message}</Text> : null}
      {!beId || !periodCode ? (
        <View style={styles.listCard}>
          <Text style={styles.muted}>Statement not available.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.muted}>Loading statement…</Text>
        </View>
      ) : detail ? (
        <ScrollView contentContainerStyle={styles.dashboardStack}>
          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Period {detail?.period?.code || periodCode}</Text>
            <View style={[styles.cardRow, styles.cardRowInline]}>
              <Text style={styles.cardSubtle}>Opening balance:</Text>
              {previousPeriodCode && Number(statement?.dueEnd || 0) !== 0 ? (
                <TouchableOpacity
                  style={styles.valueButton}
                  onPress={() =>
                    navigation.push('StatementDetail', {
                      beId,
                      periodCode: previousPeriodCode,
                      programBuckets,
                    })
                  }
                >
                  <Text style={styles.valueButtonText}>{formatMoney(statement?.dueStart, statement?.currency)}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.cardSubtle}>{formatMoney(statement?.dueStart, statement?.currency)}</Text>
              )}
            </View>
            <Text style={styles.cardSubtle}>Charges: {formatMoney(statement?.charges, statement?.currency)}</Text>
            <Text style={styles.cardSubtle}>Payments: {formatMoney(statement?.payments, statement?.currency)}</Text>
            <Text style={styles.cardSubtle}>Adjustments: {formatMoney(statement?.adjustments, statement?.currency)}</Text>
            <Text style={styles.cardSubtle}>Due end: {formatMoney(statement?.dueEnd, statement?.currency)}</Text>
          </View>

          <View style={styles.dashboardCard}>
            <Text style={styles.cardTitle}>Ledger entries</Text>
            {ledgerEntries.length ? (
              ledgerEntries.map((entry: any) => {
                const program = programBuckets[entry.bucket || '']
                const label = program?.name
                  ? program.name
                  : program?.code
                    ? program.code
                    : entry.bucket === 'ALLOCATED_EXPENSE'
                      ? 'Allocated'
                      : String(entry.bucket || entry.kind || 'Entry')
                return (
                  <View key={entry.id} style={styles.cardRow}>
                    <View>
                      <Text style={styles.cardRowTitle}>{label}</Text>
                      <Text style={styles.cardRowMeta}>{entry.kind} · {formatDate(entry.createdAt)}</Text>
                    </View>
                    <Text style={styles.cardRowMeta}>{formatMoney(entry.amount, entry.currency)}</Text>
                  </View>
                )
              })
            ) : (
              <Text style={styles.muted}>No ledger entries.</Text>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.listCard}>
          <Text style={styles.muted}>No statement data.</Text>
        </View>
      )}
    </ScreenChrome>
  )
}
