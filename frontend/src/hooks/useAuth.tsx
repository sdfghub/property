import React from 'react'
import { AuthProvider as SharedAuthProvider, useAuth as useSharedAuth } from '@shared/auth/useAuth'
import { createAuthStorage } from '@shared/auth/storage'
import { API_BASE } from '../api/client'

const storage = createAuthStorage('pe-auth', () => (typeof localStorage === 'undefined' ? null : localStorage))

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SharedAuthProvider baseUrl={API_BASE} storage={storage}>
      {children}
    </SharedAuthProvider>
  )
}

export const useAuth = useSharedAuth
