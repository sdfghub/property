import React from 'react'
import { Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useAuth } from '@shared/auth/useAuth'
import { API_BASE } from '../config'
import { styles } from '../styles/appStyles'

export function LoginScreen() {
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
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
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
