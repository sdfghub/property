import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { getPushPermission, isPushSupported, registerPushToken, requestPushPermission } from '../services/push'

export function PushPrompt() {
  const { api, user } = useAuth()
  const { t } = useI18n()
  const [supported, setSupported] = React.useState<boolean | null>(null)
  const [permission, setPermission] = React.useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [registered, setRegistered] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [sendOk, setSendOk] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!user) return
    let mounted = true
    isPushSupported()
      .then((ok) => {
        if (!mounted) return
        setSupported(ok)
        setPermission(ok ? (getPushPermission() as any) : 'unsupported')
      })
      .catch(() => {
        if (!mounted) return
        setSupported(false)
        setPermission('unsupported')
      })
    return () => {
      mounted = false
    }
  }, [user])

  React.useEffect(() => {
    if (!user || supported !== true) return
    if (permission !== 'granted') return
    if (registered) return
    setBusy(true)
    setError(null)
    registerPushToken(api)
      .then((res) => {
        if (res.ok) setRegistered(true)
        else if (res.reason === 'missing-config') setError(t('push.missingConfig'))
      })
      .catch((err: any) => setError(err?.message || t('push.error')))
      .finally(() => setBusy(false))
  }, [api, permission, registered, supported, t, user])

  if (!user) return null
  if (supported === false || permission === 'unsupported') return null
  if (permission === 'granted' && registered) {
    return (
      <div className="card soft" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('push.ready.title')}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t('push.ready.body')}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" type="button" onClick={sendTest} disabled={sending}>
              {sending ? t('push.test.sending') : t('push.test.cta')}
            </button>
          </div>
        </div>
        {sendOk && <div className="badge positive" style={{ marginTop: 8 }}>{t('push.test.success')}</div>}
        {error && <div className="badge negative" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    )
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await requestPushPermission()
      const next = result === 'default' ? 'default' : result
      setPermission(next as any)
      if (result === 'granted') {
        const res = await registerPushToken(api)
        if (res.ok) setRegistered(true)
        else if (res.reason === 'missing-config') setError(t('push.missingConfig'))
        else if (res.reason === 'no-token') setError(t('push.noToken'))
      }
    } catch (err: any) {
      setError(err?.message || t('push.error'))
    } finally {
      setBusy(false)
    }
  }

  const openSettings = () => {
    window.open('https://support.google.com/chrome/answer/3220216', '_blank', 'noopener')
  }

  async function sendTest() {
    setSending(true)
    setError(null)
    setSendOk(null)
    try {
      const res = await api.post<{ messageId?: string }>('/push-tokens/test-send', {
        title: 'Test notification',
        body: 'Hello from the API',
        url: window.location.origin,
      })
      setSendOk(res?.messageId || 'sent')
    } catch (err: any) {
      setError(err?.message || t('push.test.error'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card soft" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {permission === 'denied' ? t('push.denied.title') : t('push.enable.title')}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {permission === 'denied' ? t('push.denied.body') : t('push.enable.body')}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {permission === 'denied' ? (
            <button className="btn secondary" type="button" onClick={openSettings}>
              {t('push.denied.cta')}
            </button>
          ) : (
            <button className="btn" type="button" onClick={enable} disabled={busy}>
              {busy ? t('push.working') : t('push.enable.cta')}
            </button>
          )}
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          className="btn secondary"
          type="button"
          onClick={sendTest}
          disabled={sending || permission !== 'granted'}
          title={permission !== 'granted' ? t('push.test.disabled') : undefined}
        >
          {sending ? t('push.test.sending') : t('push.test.cta')}
        </button>
        {sendOk && <span className="badge positive">{t('push.test.success')}</span>}
      </div>
      {error && <div className="badge negative" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
