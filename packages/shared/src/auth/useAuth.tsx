import React from 'react'
import { createApiClient } from '../api/client'
import type { ApiClient } from '../api/client'
import type { RoleAssignment, User } from '../api/types'
import type { AuthState, AuthStorage } from './storage'

type AuthStatus = 'idle' | 'loading' | 'ready'

export type AuthContextValue = {
  user: User | null
  accessToken?: string
  roles: RoleAssignment[]
  activeRole?: RoleAssignment | null
  status: AuthStatus
  api: ApiClient
  loginWithPassword: (payload: { email: string; password: string; inviteToken?: string | null }) => Promise<void>
  registerWithPassword: (payload: { email: string; password: string; name?: string; inviteToken?: string | null }) => Promise<void>
  oauthLogin: (payload: { provider: string; providerUserId: string; email?: string; name?: string; inviteToken?: string | null }) => Promise<void>
  getInviteSummary: (token: string) => Promise<any>
  refreshSession: () => Promise<void>
  logout: () => Promise<void>
  error: string | null
  setActiveRole: (role: RoleAssignment) => void
}

type AuthProviderProps = {
  children: React.ReactNode
  baseUrl: string
  storage: AuthStorage
}

// Auth context: handles magic link + invite login, token refresh, role selection.
// The goal is to keep auth flows decoupled from UI components and provide a single source of truth for tokens.
const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children, baseUrl, storage }: AuthProviderProps) {
  const [auth, setAuth] = React.useState<AuthState>(() => storage.load())
  const [status, setStatus] = React.useState<AuthStatus>(auth.accessToken ? 'ready' : 'idle')
  const [error, setError] = React.useState<string | null>(null)
  const apiBase = baseUrl.replace(/\/$/, '')

  // Persist auth bundle on every change so the session survives refreshes.
  React.useEffect(() => {
    storage.save(auth)
  }, [auth, storage])

  // Keep roles in sync with current access token (they live in JWT).
  React.useEffect(() => {
    const rolesFromToken = decodeRoles(auth.accessToken)
    if (rolesFromToken.length && JSON.stringify(rolesFromToken) !== JSON.stringify(auth.roles)) {
      setAuth((prev) => {
        const matchesActive = rolesFromToken.find(
          (r) => r.role === prev.activeRole?.role && r.scopeType === prev.activeRole?.scopeType && r.scopeId === prev.activeRole?.scopeId,
        )
        return {
          ...prev,
          roles: rolesFromToken,
          activeRole: matchesActive ?? rolesFromToken[0],
        }
      })
    }
  }, [auth.accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearAuth = React.useCallback(() => {
    setAuth({ user: null, accessToken: undefined, refreshToken: undefined, roles: [], activeRole: null })
    setStatus('idle')
    storage.clear()
  }, [storage])

  const setTokensWithRoles = React.useCallback((data: { accessToken?: string; refreshToken?: string; user?: User | null }) => {
    const roles = decodeRoles(data.accessToken)
    setAuth((prev) => ({
      ...prev,
      ...data,
      roles,
      activeRole: roles.length ? roles[0] : null,
    }))
  }, [])

  const api = React.useMemo(
    () =>
      createApiClient({
        baseUrl: apiBase,
        getTokens: () => ({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }),
        saveTokens: (tokens) => setTokensWithRoles(tokens),
        onUnauthorized: clearAuth,
      }),
    [apiBase, auth.accessToken, auth.refreshToken, clearAuth, setTokensWithRoles],
  )

  async function loginWithPassword(payload: { email: string; password: string; inviteToken?: string | null }) {
    setStatus('loading')
    setError(null)
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        inviteToken: payload.inviteToken ?? undefined,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      setStatus(auth.accessToken ? 'ready' : 'idle')
      setError(text || 'Unable to sign in')
      throw new Error(text || 'Unable to sign in')
    }
    const data = await res.json()
    setTokensWithRoles({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken })
    setStatus('ready')
  }

  async function registerWithPassword(payload: { email: string; password: string; name?: string; inviteToken?: string | null }) {
    setStatus('loading')
    setError(null)
    const res = await fetch(`${apiBase}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: payload.email,
        password: payload.password,
        name: payload.name,
        inviteToken: payload.inviteToken ?? undefined,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      setStatus(auth.accessToken ? 'ready' : 'idle')
      setError(text || 'Unable to create account')
      throw new Error(text || 'Unable to create account')
    }
    const data = await res.json()
    setTokensWithRoles({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken })
    setStatus('ready')
  }

  async function oauthLogin(payload: { provider: string; providerUserId: string; email?: string; name?: string; inviteToken?: string | null }) {
    setStatus('loading')
    setError(null)
    const res = await fetch(`${apiBase}/auth/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: payload.provider,
        providerUserId: payload.providerUserId,
        email: payload.email,
        name: payload.name,
        inviteToken: payload.inviteToken ?? undefined,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      setStatus(auth.accessToken ? 'ready' : 'idle')
      setError(text || 'Unable to sign in')
      throw new Error(text || 'Unable to sign in')
    }
    const data = await res.json()
    setTokensWithRoles({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken })
    setStatus('ready')
  }

  async function getInviteSummary(token: string) {
    const res = await fetch(`${apiBase}/invites/${encodeURIComponent(token)}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || 'Unable to load invite')
    }
    return res.json()
  }

  async function refreshSession() {
    const refreshed = await api.refreshAccessToken()
    if (!refreshed) {
      throw new Error('Unable to refresh session')
    }
  }

  const refreshOnce = React.useRef(false)
  React.useEffect(() => {
    if (refreshOnce.current) return
    if (!auth.accessToken && !auth.refreshToken) return
    refreshOnce.current = true
    refreshSession().catch(() => clearAuth())
  }, [auth.accessToken, auth.refreshToken, clearAuth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear local state and notify backend to revoke refresh token.
  async function logout() {
    const refreshToken = auth.refreshToken
    clearAuth()
    try {
      await fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      // dev-only fallback
    }
  }

  const setActiveRole = React.useCallback((role: RoleAssignment) => {
    setAuth((prev) => ({ ...prev, activeRole: role }))
  }, [])

  const value: AuthContextValue = {
    user: auth.user,
    accessToken: auth.accessToken,
    roles: auth.roles,
    activeRole: auth.activeRole,
    status,
    api,
    loginWithPassword,
    registerWithPassword,
    oauthLogin,
    getInviteSummary,
    refreshSession,
    logout,
    error,
    setActiveRole,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

function decodeRoles(token?: string): RoleAssignment[] {
  // JWT payload carries roles; decode locally to drive UI role switching.
  if (!token) return []
  const parsed = parseJwt(token)
  if (!parsed || !Array.isArray(parsed.roles)) return []
  return parsed.roles
    .map((r: any) => ({
      role: r.role,
      scopeType: r.scopeType,
      scopeId: r.scopeId ?? null,
    }))
    .filter((r: RoleAssignment) => !!r.role && !!r.scopeType)
}

function parseJwt(token: string): any | null {
  try {
    const base64 = token.split('.')[1]
    const decoded = decodeBase64(base64.replace(/-/g, '+').replace(/_/g, '/'))
    if (!decoded) return null
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function decodeBase64(input: string): string | null {
  if (typeof atob === 'function') return atob(input)
  if (typeof Buffer !== 'undefined') return Buffer.from(input, 'base64').toString('utf-8')
  return null
}
