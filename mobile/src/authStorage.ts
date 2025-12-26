import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAuthStorage } from '@shared/auth/storage'
import type { AuthStorage, KeyValueStorage } from '@shared/auth/storage'

const STORAGE_KEY = 'pe-auth'
let cachedValue: string | null | undefined

const memoryStorage: KeyValueStorage = {
  getItem: (key) => (key === STORAGE_KEY ? (cachedValue ?? null) : null),
  setItem: (key, value) => {
    if (key !== STORAGE_KEY) return
    cachedValue = value
    void AsyncStorage.setItem(key, value)
  },
  removeItem: (key) => {
    if (key !== STORAGE_KEY) return
    cachedValue = null
    void AsyncStorage.removeItem(key)
  },
}

export async function hydrateAuthStorage() {
  cachedValue = await AsyncStorage.getItem(STORAGE_KEY)
}

export const authStorage: AuthStorage = createAuthStorage(STORAGE_KEY, () => memoryStorage)
