import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '@shared/auth/useAuth'
import { BeScopeProvider } from '../contexts/BeScopeContext'
import { LoginScreen } from '../screens/LoginScreen'
import { MainScreen } from '../screens/MainScreen'
import { ProgramDetailScreen } from '../screens/ProgramDetailScreen'
import { PollDetailScreen } from '../screens/PollDetailScreen'
import { EventDetailScreen } from '../screens/EventDetailScreen'
import { StatementDetailScreen } from '../screens/StatementDetailScreen'

const Stack = createNativeStackNavigator()

export function AppNavigator() {
  const { accessToken } = useAuth()
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
