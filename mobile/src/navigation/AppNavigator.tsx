import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '@shared/auth/useAuth'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { AppState, Platform } from 'react-native'
import { BeScopeProvider } from '../contexts/BeScopeContext'
import { LoginScreen } from '../screens/LoginScreen'
import { MainScreen } from '../screens/MainScreen'
import { ProgramDetailScreen } from '../screens/ProgramDetailScreen'
import { PollDetailScreen } from '../screens/PollDetailScreen'
import { EventDetailScreen } from '../screens/EventDetailScreen'
import { StatementDetailScreen } from '../screens/StatementDetailScreen'

const Stack = createNativeStackNavigator()

export function AppNavigator() {
  const { accessToken, api, user } = useAuth()
  const lastTokenRef = React.useRef<string | null>(null)
  const inFlightRef = React.useRef(false)
  const retryTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (!accessToken || !user) {
      lastTokenRef.current = null
      return
    }
    let active = true
    const register = async () => {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const settings = await Notifications.getPermissionsAsync()
        if (settings.status !== 'granted') return
        const projectId = Constants.expoConfig?.extra?.eas?.projectId
        const tokenResponse = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
        const token = tokenResponse?.data
        if (!token || !active) return
        if (lastTokenRef.current === token) return
        await api.post('/push-tokens', {
          token,
          platform: Platform.OS.toUpperCase(),
          deviceInfo: {
            appVersion: Constants.expoConfig?.version || null,
            appId: Constants.expoConfig?.slug || null,
          },
        })
        if (active) lastTokenRef.current = token
      } finally {
        inFlightRef.current = false
      }
    }

    const registerWithRetry = (attempt = 0) => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      register().catch(() => {
        if (!active) return
        if (attempt >= 3) return
        const delayMs = [1000, 5000, 15000][attempt] || 15000
        retryTimeoutRef.current = setTimeout(() => registerWithRetry(attempt + 1), delayMs)
      })
    }

    registerWithRetry()

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') registerWithRetry()
    })

    return () => {
      active = false
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      subscription.remove()
    }
  }, [accessToken, api, user])

  if (!accessToken) return <LoginScreen />
  return (
    <BeScopeProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen name="ProgramDetail" component={ProgramDetailScreen} />
          <Stack.Screen name="PollDetail" component={PollDetailScreen} />
          <Stack.Screen name="EventDetail" component={EventDetailScreen} />
          <Stack.Screen name="StatementDetail" component={StatementDetailScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </BeScopeProvider>
  )
}
