import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, Linking, SafeAreaView, Text, TouchableOpacity, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { AuthProvider } from '@shared/auth/useAuth'
import { authStorage, hydrateAuthStorage } from './src/authStorage'
import { API_BASE } from './src/config'
import { AppNavigator } from './src/navigation/AppNavigator'
import { styles } from './src/styles/appStyles'

export default function App() {
  const [hydrated, setHydrated] = React.useState(false)
  const [pushStatus, setPushStatus] = React.useState<'idle' | 'granted' | 'denied'>('idle')

  React.useEffect(() => {
    hydrateAuthStorage().finally(() => setHydrated(true))
  }, [])

  React.useEffect(() => {
    let mounted = true
    const request = async () => {
      try {
        const settings = await Notifications.getPermissionsAsync()
        if (settings.status !== 'granted') {
          const requested = await Notifications.requestPermissionsAsync()
          if (!mounted) return
          setPushStatus(requested.status === 'granted' ? 'granted' : 'denied')
          return
        }
        if (!mounted) return
        setPushStatus('granted')
      } catch {
        if (mounted) setPushStatus('denied')
      }
    }
    request()
    return () => {
      mounted = false
    }
  }, [])

  const handlePushCta = async () => {
    try {
      const requested = await Notifications.requestPermissionsAsync()
      if (requested.status === 'granted') {
        setPushStatus('granted')
        return
      }
      await Linking.openSettings()
    } catch {
      // Ignore; the banner already communicates the state.
    }
  }

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
        {pushStatus === 'denied' ? (
          <View style={styles.pushBanner}>
            <View style={styles.pushBannerRow}>
              <Text style={styles.pushBannerText}>Enable notifications to get reminders about polls and events.</Text>
              <TouchableOpacity style={styles.pushBannerButton} onPress={handlePushCta}>
                <Text style={styles.pushBannerButtonText}>Enable</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <AppNavigator />
      </SafeAreaView>
    </AuthProvider>
  )
}
