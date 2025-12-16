import React from 'react'
import { API_BASE, ApiClient, createApiClient } from '../api/client'
import type { RoleAssignment, User } from '../api/types'
// Auth context: handles magic link + invite login, token refresh, role selection.
// The goal is to keep auth flows decoupled from UI components and provide a single source of truth for tokens.

type AuthState = {
  user: User | null
  accessToken?: string
  refreshToken?: string
  roles: RoleAssignment[]
  activeRole?: RoleAssignment | null
}

type AuthStatus = 'idle' | 'loading' | 'ready'

type AuthContextValue = {
  user: User | null
  accessToken?: string
  roles: RoleAssignment[]
  activeRole?: RoleAssignment | null
  status: AuthStatus
  api: ApiClient
  requestMagicLink: (email: string) => Promise<void>
  consumeMagicToken: (token: string) => Promise<void>
  consumeInviteToken: (token: string, name?: string) => Promise<void>
  logout: () => Promise<void>
  error: string | null
  setActiveRole: (role: RoleAssignment) => void
}

// Persist auth locally to avoid re-logins between refreshes.
const STORAGE_KEY = 'pe-auth'
const AuthContext = React.createContext<AuthContextValue | null>(null)

function loadCachedAuth(): AuthState {
  if (typeof localStorage === 'undefined') return { user: null, roles: [], activeRole: null }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { user: null, roles: [], activeRole: null }
    const parsed = JSON.parse(raw)
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      roles: parsed.roles ?? [],
      activeRole: parsed.activeRole ?? null,
    }
  } catch {
    return { user: null, roles: [], activeRole: null }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = React.useState<AuthState>(() => loadCachedAuth())
  const [status, setStatus] = React.useState<AuthStatus>(auth.accessToken ? 'ready' : 'idle')
  const [error, setError] = React.useState<string | null>(null)

  // Persist auth bundle on every change so tab refreshes keep the session.
  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  }, [auth])

  // Keep roles in sync with current access token (they live in JWT).
  React.useEffect(() => {
    const rolesFromToken = decodeRoles(auth.accessToken)
    if (rolesFromToken.length && JSON.stringify(rolesFromToken) !== JSON.stringify(auth.roles)) {
      setAuth((prev) => ({ ...prev, roles: rolesFromToken, activeRole: prev.activeRole ?? rolesFromToken[0] }))
    }
  }, [auth.accessToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const clearAuth = React.useCallback(() => {
    setAuth({ user: null, accessToken: undefined, refreshToken: undefined, roles: [], activeRole: null })
    setStatus('idle')
  }, [])

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
        getTokens: () => ({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }),
        saveTokens: (tokens) => setTokensWithRoles(tokens),
        onUnauthorized: clearAuth,
      }),
    [auth.accessToken, auth.refreshToken, clearAuth, setTokensWithRoles],
  )

  // Request a magic link; backend will email/print the link.
  async function requestMagicLink(email: string) {
    setError(null)
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/auth/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || 'Could not request link')
    }
  }

  // Consume a magic token (via query param or paste box) and store tokens.
  async function consumeMagicToken(token: string) {
    setStatus('loading')
    setError(null)
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/auth/consume-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const text = await res.text()
      setStatus(auth.accessToken ? 'ready' : 'idle')
      setError(text || 'Unable to sign in with token')
      throw new Error(text || 'Unable to sign in with token')
    }
    const data = await res.json()
    setTokensWithRoles({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken })
    setStatus('ready')
  }

  // Accept an invite token and attach optional display name.
  async function consumeInviteToken(token: string, name?: string) {
    setStatus('loading')
    setError(null)
    const res = await fetch(`${API_BASE.replace(/\/$/, '')}/invites/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, name }),
    })
    if (!res.ok) {
      const text = await res.text()
      setStatus(auth.accessToken ? 'ready' : 'idle')
      setError(text || 'Unable to accept invite')
      throw new Error(text || 'Unable to accept invite')
    }
    const data = await res.json()
    setTokensWithRoles({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken })
    setStatus('ready')
  }

  // Clear local state and notify backend to revoke refresh token.
  async function logout() {
    const refreshToken = auth.refreshToken
    clearAuth()
    try {
      await fetch(`${API_BASE.replace(/\/$/, '')}/auth/logout`, {
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
    requestMagicLink,
    consumeMagicToken,
    consumeInviteToken,
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
    const decoded = atob(base64.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decoded)
  } catch {
    return null
  }
}
