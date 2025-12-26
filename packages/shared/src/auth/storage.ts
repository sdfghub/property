import type { RoleAssignment, User } from '../api/types'

export type AuthState = {
  user: User | null
  accessToken?: string
  refreshToken?: string
  roles: RoleAssignment[]
  activeRole?: RoleAssignment | null
}

export const DEFAULT_AUTH_STATE: AuthState = {
  user: null,
  roles: [],
  activeRole: null,
}

export type KeyValueStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

export type AuthStorage = {
  load: () => AuthState
  save: (state: AuthState) => void
  clear: () => void
}

export function createAuthStorage(key: string, getStorage: () => KeyValueStorage | null): AuthStorage {
  const load = () => {
    const storage = getStorage()
    if (!storage) return { ...DEFAULT_AUTH_STATE }
    try {
      const raw = storage.getItem(key)
      if (!raw) return { ...DEFAULT_AUTH_STATE }
      const parsed = JSON.parse(raw)
      return {
        user: parsed.user ?? null,
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        roles: parsed.roles ?? [],
        activeRole: parsed.activeRole ?? null,
      }
    } catch {
      return { ...DEFAULT_AUTH_STATE }
    }
  }

  const save = (state: AuthState) => {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(key, JSON.stringify(state))
  }

  const clear = () => {
    const storage = getStorage()
    if (!storage) return
    if (storage.removeItem) {
      storage.removeItem(key)
      return
    }
    storage.setItem(key, JSON.stringify(DEFAULT_AUTH_STATE))
  }

  return { load, save, clear }
}
