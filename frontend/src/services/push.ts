import { initializeApp, getApps } from 'firebase/app'
import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import type { ApiClient } from '../api/client'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FCM_API_KEY,
  authDomain: import.meta.env.VITE_FCM_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FCM_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FCM_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FCM_SENDER_ID,
  appId: import.meta.env.VITE_FCM_APP_ID,
  measurementId: import.meta.env.VITE_FCM_MEASUREMENT_ID,
}

const vapidKey = import.meta.env.VITE_FCM_VAPID_KEY

function hasConfig() {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId &&
    firebaseConfig.measurementId &&
    vapidKey
  )
}

function getFirebaseApp() {
  if (!hasConfig()) return null
  const existing = getApps()
  if (existing.length) return existing[0]
  return initializeApp(firebaseConfig)
}

export async function isPushSupported() {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false
  return isSupported()
}

export function getPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.requestPermission()
}

export async function registerPushToken(api: ApiClient) {
  if (!(await isPushSupported())) return { ok: false, reason: 'unsupported' as const }
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' as const }
  const app = getFirebaseApp()
  if (!app) return { ok: false, reason: 'missing-config' as const }

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const messaging = getMessaging(app)
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
  if (!token) return { ok: false, reason: 'no-token' as const }

  await api.post('/push-tokens', {
    token,
    platform: 'WEB',
    deviceInfo: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      lang: navigator.language,
    },
  })

  return { ok: true, token }
}
