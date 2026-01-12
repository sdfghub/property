import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { getPushPermission, isPushSupported, registerPushToken, requestPushPermission } from '../services/push'

export function PushPrompt({ variant = 'card' }: { variant?: 'card' | 'menu' }) {
  const { api, user } = useAuth()
  const { t } = useI18n()
  const storageKey = 'pe-push-disabled'
  const [supported, setSupported] = React.useState<boolean | null>(null)
  const [permission, setPermission] = React.useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [registered, setRegistered] = React.useState(false)
  const [disabling, setDisabling] = React.useState(false)
  const [disabled, setDisabled] = React.useState(() => {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(storageKey) === 'true'
  })

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
    if (disabled) return
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
  const wrap = (content: React.ReactNode) =>
    variant === 'menu' ? (
      <div className="stack" style={{ gap: 8 }}>
        {content}
      </div>
    ) : (
      <div className="card soft" style={{ marginTop: 12 }}>
        {content}
      </div>
    )

  const disablePush = async () => {
    if (!user) return
    setDisabling(true)
    setError(null)
    try {
      const tokens = await api.get<Array<{ id: string }>>('/push-tokens')
      if (Array.isArray(tokens) && tokens.length) {
        await Promise.all(tokens.map((t) => api.del(`/push-tokens/${t.id}`)))
      }
      setRegistered(false)
      setDisabled(true)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, 'true')
      }
    } catch (err: any) {
      setError(err?.message || t('push.error'))
    } finally {
      setDisabling(false)
    }
  }

  if (permission === 'granted' && registered && !disabled) {
    return wrap(
      <>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('push.ready.title')}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t('push.ready.body')}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" type="button" onClick={disablePush} disabled={disabling}>
              {disabling ? t('push.working') : t('push.disable.cta')}
            </button>
          </div>
        </div>
        {error && <div className="badge negative" style={{ marginTop: 8 }}>{error}</div>}
      </>,
    )
  }

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      setDisabled(false)
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(storageKey)
      }
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

  return wrap(
    <>
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
      {error && <div className="badge negative" style={{ marginTop: 8 }}>{error}</div>}
    </>,
  )
}
