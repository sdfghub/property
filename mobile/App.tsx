import React from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AuthProvider, useAuth } from '@shared/auth/useAuth'
import type { PeriodRef } from '@shared/api/types'
import { authStorage, hydrateAuthStorage } from './src/authStorage'

export default function App() {
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    hydrateAuthStorage().finally(() => setHydrated(true))
  }, [])

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading session…</Text>
      </SafeAreaView>
    )
  }

  return (
    <AuthProvider baseUrl={API_BASE} storage={authStorage}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />
        <AuthGate />
      </SafeAreaView>
    </AuthProvider>
  )
}

const API_BASE = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:3000/api'

function AuthGate() {
  const { accessToken } = useAuth()
  return accessToken ? <BeHome /> : <LoginScreen />
}

function LoginScreen() {
  const { loginWithPassword, status, error } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [working, setWorking] = React.useState(false)

  async function submit() {
    if (!email || !password || working) return
    setWorking(true)
    try {
      await loginWithPassword({ email, password })
    } finally {
      setWorking(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Billing Entity Access</Text>
      <Text style={styles.muted}>Sign in to review allocations and expenses.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={[styles.button, (working || status === 'loading') && styles.buttonDisabled]} onPress={submit}>
        <Text style={styles.buttonText}>{working || status === 'loading' ? 'Signing in…' : 'Sign in'}</Text>
      </TouchableOpacity>
      <Text style={styles.mutedSmall}>API: {API_BASE}</Text>
    </View>
  )
}

type AggregateRow = {
  amount: number
  unitId?: string
  unitCode?: string
  unitName?: string
  splitGroupId?: string
  splitGroupCode?: string
  splitGroupName?: string
}

function BeHome() {
  const { api, activeRole, roles, logout } = useAuth()
  const [periods, setPeriods] = React.useState<PeriodRef[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'UNIT' | 'SPLIT'>('UNIT')
  const [rows, setRows] = React.useState<AggregateRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  const beRole =
    (activeRole?.scopeType === 'BILLING_ENTITY' ? activeRole : null) || roles.find((role) => role.scopeType === 'BILLING_ENTITY') || null
  const beId = beRole?.scopeId || ''

  React.useEffect(() => {
    if (!beId) return
    setLoading(true)
    api
      .get<PeriodRef[]>(`/communities/be/${beId}/periods`)
      .then((data) => {
        setPeriods(data)
        if (!selected && data.length) setSelected(data[data.length - 1].code)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))
      .finally(() => setLoading(false))
  }, [api, beId])

  React.useEffect(() => {
    if (!beId || !selected) return
    setLoading(true)
    setMessage(null)
    const groupBy = tab === 'UNIT' ? 'MEMBER' : 'SPLIT_GROUP'
    api
      .get<any>(`/communities/be/${beId}/periods/${selected}/allocations/aggregate?groupBy=${groupBy}`)
      .then((data) => setRows(data?.rows || []))
      .catch((err: any) => setMessage(err?.message || 'Could not load allocations'))
      .finally(() => setLoading(false))
  }, [api, beId, selected, tab])

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

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Expenses</Text>
        <TouchableOpacity onPress={logout}>
          <Text style={styles.link}>Sign out</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.mutedSmall}>Billing entity: {beId}</Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentButton, tab === 'UNIT' && styles.segmentButtonActive]} onPress={() => setTab('UNIT')}>
          <Text style={[styles.segmentLabel, tab === 'UNIT' && styles.segmentLabelActive]}>By member</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentButton, tab === 'SPLIT' && styles.segmentButtonActive]} onPress={() => setTab('SPLIT')}>
          <Text style={[styles.segmentLabel, tab === 'SPLIT' && styles.segmentLabelActive]}>By split</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sectionTitle}>Periods</Text>
      <FlatList
        data={periods}
        horizontal
        keyExtractor={(item) => item.id}
        style={styles.periodList}
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
      <View style={styles.listCard}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator />
            <Text style={styles.muted}>Loading…</Text>
          </View>
        ) : (
          <ScrollView>
            {rows.length === 0 ? (
              <Text style={styles.muted}>No data yet.</Text>
            ) : (
              rows.map((row, index) => {
                const label =
                  tab === 'UNIT'
                    ? row.unitName || row.unitCode || row.unitId || 'Member'
                    : row.splitGroupName || row.splitGroupCode || row.splitGroupId || 'Split group'
                return (
                  <View style={styles.row} key={`${tab}:${index}`}>
                    <Text style={styles.rowLabel}>{label}</Text>
                    <Text style={styles.rowAmount}>{Number(row.amount || 0).toFixed(2)}</Text>
                  </View>
                )
              })
            )}
          </ScrollView>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f7f7fb',
  },
  screen: {
    flex: 1,
    padding: 18,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  card: {
    backgroundColor: '#fff',
    margin: 18,
    padding: 18,
    borderRadius: 16,
    gap: 12,
    shadowColor: '#2a2a2a',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 20,
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#161616',
  },
  muted: {
    color: '#6b6b78',
  },
  mutedSmall: {
    color: '#6b6b78',
    fontSize: 12,
    marginTop: 6,
  },
  error: {
    color: '#b01b1b',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d2d2dd',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#91a7ff',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  link: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#ececff',
    padding: 4,
    borderRadius: 12,
    marginTop: 16,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#1d4ed8',
  },
  segmentLabel: {
    color: '#434354',
    fontWeight: '600',
  },
  segmentLabelActive: {
    color: '#fff',
  },
  sectionTitle: {
    marginTop: 18,
    fontSize: 14,
    fontWeight: '600',
    color: '#2a2a2a',
  },
  periodList: {
    marginTop: 10,
  },
  periodListContent: {
    gap: 8,
  },
  periodChip: {
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d2d2dd',
  },
  periodChipActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  periodChipText: {
    fontWeight: '600',
    color: '#2a2a2a',
  },
  periodChipTextActive: {
    color: '#fff',
  },
  listCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f4',
  },
  rowLabel: {
    flex: 1,
    color: '#2a2a2a',
  },
  rowAmount: {
    color: '#2a2a2a',
    fontWeight: '600',
  },
});
