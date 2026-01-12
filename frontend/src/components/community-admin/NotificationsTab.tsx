import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: 'In-app',
  PUSH: 'Push',
  EMAIL: 'Email',
}

type NotificationItem = {
  id: string
  title: string
  body: string
  source?: string | null
  sourceId?: string | null
  createdAt: string
  readAt?: string | null
}

type PreferenceItem = {
  channel: string
  enabled: boolean
}

export function NotificationsTab() {
  const { api } = useAuth()
  const { t } = useI18n()
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([])
  const [prefs, setPrefs] = React.useState<PreferenceItem[]>([])
  const [unreadOnly, setUnreadOnly] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [prefsLoading, setPrefsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [prefsError, setPrefsError] = React.useState<string | null>(null)
  const [adminLimit, setAdminLimit] = React.useState('100')
  const [adminLoading, setAdminLoading] = React.useState(false)
  const [adminMessage, setAdminMessage] = React.useState<string | null>(null)
  const lastNotificationsKeyRef = React.useRef<string | null>(null)
  const lastPrefsKeyRef = React.useRef<string | null>(null)

  const loadNotifications = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams()
      query.set('limit', '50')
      if (unreadOnly) query.set('unread', 'true')
      const rows = await api.get<NotificationItem[]>(`/notifications?${query.toString()}`)
      setNotifications(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setNotifications([])
      setError(err?.message || t('notifications.errorLoad', 'Failed to load notifications'))
    } finally {
      setLoading(false)
    }
  }, [api, unreadOnly, t])

  const loadPrefs = React.useCallback(async () => {
    setPrefsLoading(true)
    setPrefsError(null)
    try {
      const rows = await api.get<PreferenceItem[]>('/notification-preferences')
      setPrefs(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setPrefs([])
      setPrefsError(err?.message || t('notifications.errorPrefs', 'Failed to load preferences'))
    } finally {
      setPrefsLoading(false)
    }
  }, [api, t])

  React.useEffect(() => {
    const key = `${unreadOnly ? 'unread' : 'all'}`
    if (lastNotificationsKeyRef.current === key) return
    lastNotificationsKeyRef.current = key
    loadNotifications()
  }, [loadNotifications, unreadOnly])

  React.useEffect(() => {
    const key = 'prefs'
    if (lastPrefsKeyRef.current === key) return
    lastPrefsKeyRef.current = key
    loadPrefs()
  }, [loadPrefs])

  const handleMarkRead = async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`, {})
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)))
    } catch (err: any) {
      setError(err?.message || t('notifications.errorRead', 'Failed to mark as read'))
    }
  }

  const updatePref = async (channel: string, enabled: boolean) => {
    setPrefsLoading(true)
    setPrefsError(null)
    try {
      const rows = await api.patch<PreferenceItem[]>('/notification-preferences', {
        preferences: [{ channel, enabled }],
      })
      setPrefs(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setPrefsError(err?.message || t('notifications.errorPrefsSave', 'Failed to update preferences'))
    } finally {
      setPrefsLoading(false)
    }
  }

  const processDeliveries = async () => {
    setAdminLoading(true)
    setAdminMessage(null)
    setError(null)
    try {
      const limit = adminLimit ? Number(adminLimit) : undefined
      const res = await api.post<{ processed: number }>('/admin/notifications/process-deliveries', {
        limit: Number.isFinite(limit) ? limit : undefined,
      })
      setAdminMessage(
        t('notifications.adminProcessed', { count: res?.processed ?? 0 }) || `Processed ${res?.processed ?? 0}`,
      )
    } catch (err: any) {
      setError(err?.message || t('notifications.errorProcess', 'Failed to process deliveries'))
    } finally {
      setAdminLoading(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3>{t('notifications.title', 'Notifications')}</h3>
            <p className="muted">{t('notifications.subtitle', 'Inbox + delivery controls')}</p>
          </div>
          <button className="btn secondary" type="button" onClick={loadNotifications} disabled={loading}>
            {loading ? t('notifications.loading', 'Loading…') : t('notifications.refresh', 'Refresh')}
          </button>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 12 }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            <span className="muted">{t('notifications.unreadOnly', 'Unread only')}</span>
          </label>
          {error && <span className="badge negative">{error}</span>}
        </div>
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {notifications.length === 0 && !loading ? (
            <div className="muted">{t('notifications.empty', 'No notifications yet.')}</div>
          ) : (
            notifications.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12, borderStyle: 'dashed' }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {item.body}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {new Date(item.createdAt).toLocaleString()} · {item.source || 'SYSTEM'}
                    </div>
                  </div>
                  <div className="stack" style={{ alignItems: 'flex-end' }}>
                    <span className={`badge ${item.readAt ? 'secondary' : ''}`}>
                      {item.readAt ? t('notifications.read', 'Read') : t('notifications.unread', 'Unread')}
                    </span>
                    {!item.readAt && (
                      <button className="btn ghost small" type="button" onClick={() => handleMarkRead(item.id)}>
                        {t('notifications.markRead', 'Mark read')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3>{t('notifications.prefsTitle', 'Notification preferences')}</h3>
        <p className="muted">{t('notifications.prefsSubtitle', 'Toggle delivery channels')}</p>
        {prefsError && <div className="badge negative" style={{ marginTop: 8 }}>{prefsError}</div>}
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {prefs.map((pref) => (
            <label key={pref.channel} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={pref.enabled}
                onChange={(e) => updatePref(pref.channel, e.target.checked)}
                disabled={prefsLoading}
              />
              <span>{CHANNEL_LABELS[pref.channel] || pref.channel}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t('notifications.adminTitle', 'Delivery queue')}</h3>
        <p className="muted">{t('notifications.adminSubtitle', 'Manually process pending deliveries')}</p>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', marginTop: 12 }}>
          <div style={{ maxWidth: 140 }}>
            <label className="label">
              <span>{t('notifications.adminLimit', 'Limit')}</span>
            </label>
            <input
              className="input"
              value={adminLimit}
              onChange={(e) => setAdminLimit(e.target.value)}
              placeholder="100"
            />
          </div>
          <button className="btn" type="button" onClick={processDeliveries} disabled={adminLoading}>
            {adminLoading ? t('notifications.processing', 'Processing…') : t('notifications.processNow', 'Process now')}
          </button>
          {adminMessage && <span className="badge positive">{adminMessage}</span>}
        </div>
      </div>
    </div>
  )
}
