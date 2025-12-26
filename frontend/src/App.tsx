import React from 'react'
// Root app wiring auth + i18n + role-based dashboards.
// The shell handles language switching, role switching, and the login surface.
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CommunityExplorer } from './components/CommunityExplorer'
import { I18nProvider, useI18n } from './i18n/useI18n'
import { SystemAdminPanel } from './components/SystemAdminPanel'
import { CommunityAdminDashboard } from './components/community-admin/CommunityAdminDashboard'
import { BillingEntityResponsibleDashboard } from './components/BillingEntityResponsibleDashboard'
import { API_BASE } from './api/client'
import './styles/index.css'

function LangSwitch() {
  const { lang, setLang } = useI18n()
  // Very simple language toggle; persists via i18n context.
  return (
    <div className="pill-tight">
      {(['en', 'ro'] as const).map((l) => (
        <button
          key={l}
          className="btn secondary"
          style={{
            padding: '8px 10px',
            background: lang === l ? 'rgba(43, 212, 213, 0.15)' : undefined,
            borderColor: lang === l ? 'rgba(43, 212, 213, 0.5)' : undefined,
          }}
          type="button"
          onClick={() => setLang(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function AppShell() {
  const { t } = useI18n()
  const { user, status, logout, roles, activeRole, setActiveRole } = useAuth()
  const params = React.useMemo(() => new URLSearchParams(window.location.search), [])
  const devCommunity = params.get('community')
  const uiVersion = (import.meta as any)?.env?.VITE_APP_VERSION as string | undefined
  const [apiVersion, setApiVersion] = React.useState<string | null>(null)
  const apiBase = React.useMemo(() => API_BASE.replace(/\/$/, ''), [])

  React.useEffect(() => {
    let active = true
    async function loadVersion() {
      try {
        const res = await fetch(`${apiBase}/healthz`)
        if (!res.ok) return
        const data = await res.json()
        if (active && typeof data?.version === 'string' && data.version) {
          setApiVersion(data.version)
        }
      } catch {
        if (active) setApiVersion(null)
      }
    }
    void loadVersion()
    return () => {
      active = false
    }
  }, [apiBase])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const before = url.toString()
    url.searchParams.delete('invite')
    url.searchParams.delete('inviteToken')
    url.searchParams.delete('token')
    const after = url.toString()
    if (before !== after) {
      window.history.replaceState({}, document.title, after)
    }
  }, [])

  return (
    <div className="app-shell">
      <div className="hero">
        <div>
          <h1>{t('app.console')}</h1>
        </div>
        {user ? (
          <div className="pill-tight">
            <div className="stack" style={{ gap: 4 }}>
              <span>{user.email}</span>
              <RolePicker roles={roles} activeRole={activeRole} onChange={setActiveRole} />
            </div>
            <button
              className="btn secondary"
              style={{ padding: '8px 12px' }}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  const url = new URL(window.location.href)
                  url.searchParams.delete('invite')
                  url.searchParams.delete('inviteToken')
                  url.searchParams.delete('token')
                  window.history.replaceState({}, document.title, url.toString())
                }
                logout()
              }}
            >
              {t('app.logout')}
            </button>
          </div>
        ) : (
          <div className="badge">{status === 'loading' ? t('status.connecting') : t('status.signedOut')}</div>
        )}
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          <LangSwitch />
          {(uiVersion || apiVersion) && (
            <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>
              {uiVersion ? (
                <div>
                  {t('app.versionUi')}: {uiVersion}
                </div>
              ) : null}
              {apiVersion ? (
                <div>
                  {t('app.versionApi')}: {apiVersion}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {devCommunity ? (
        <CommunityAdminDashboard forceCommunityId={devCommunity} />
      ) : user ? (
        activeRole?.role === 'SYSTEM_ADMIN' ? (
          <SystemAdminPanel />
        ) : activeRole?.role === 'COMMUNITY_ADMIN' ? (
          <CommunityAdminDashboard />
        ) : activeRole?.role === 'BILLING_ENTITY_USER' ? (
          <BillingEntityResponsibleDashboard />
        ) : (
          <CommunityExplorer />
        )
      ) : (
        <div style={{ marginTop: 18 }}>
          <AuthCard />
        </div>
      )}
    </div>
  )
}

function RolePicker({
  roles,
  activeRole,
  onChange,
}: {
  roles: { role: string; scopeType: string; scopeId?: string | null }[]
  activeRole?: { role: string; scopeType: string; scopeId?: string | null } | null
  onChange: (r: { role: string; scopeType: string; scopeId?: string | null }) => void
}) {
  if (!roles.length) return null
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {roles.map((r, idx) => {
        const label = [r.role, r.scopeType !== 'SYSTEM' ? r.scopeType.toLowerCase() : null, r.scopeId]
          .filter(Boolean)
          .join(' · ')
        const selected = activeRole?.role === r.role && activeRole?.scopeId === r.scopeId && activeRole?.scopeType === r.scopeType
        return (
          <button
            key={`${r.role}-${r.scopeType}-${r.scopeId ?? idx}`}
            className="btn secondary"
            style={{
              padding: '6px 10px',
              background: selected ? 'rgba(43, 212, 213, 0.15)' : undefined,
              borderColor: selected ? 'rgba(43, 212, 213, 0.5)' : undefined,
            }}
            type="button"
            onClick={() => onChange(r)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function AuthCard() {
  const { t } = useI18n()
  const { loginWithPassword, registerWithPassword, getInviteSummary, error, status } = useAuth()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [name, setName] = React.useState('')
  const [working, setWorking] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [inviteSummary, setInviteSummary] = React.useState<any | null>(null)
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = React.useState(false)

  const inviteToken = React.useMemo(() => {
    const search = new URLSearchParams(window.location.search)
    return search.get('invite') || search.get('inviteToken') || search.get('token')
  }, [])
  const canRegister = Boolean(inviteToken)

  React.useEffect(() => {
    if (!inviteToken) return
    setInviteLoading(true)
    getInviteSummary(inviteToken)
      .then((data) => {
        setInviteSummary(data)
        if (data?.email && !email) setEmail(data.email)
      })
      .catch((err: any) => {
        setInviteError(err?.message || t('auth.invite.loadError'))
      })
      .finally(() => setInviteLoading(false))
  }, [getInviteSummary, inviteToken])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setWorking(true)
    setFormError(null)
    try {
      await loginWithPassword({ email, password, inviteToken })
    } catch (err: any) {
      setFormError(err?.message || t('common.error'))
    } finally {
      setWorking(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setWorking(true)
    setFormError(null)
    try {
      if (!canRegister) {
        setFormError(t('auth.invite.required'))
        return
      }
      await registerWithPassword({ email, password, name: name || undefined, inviteToken })
    } catch (err: any) {
      setFormError(err?.message || t('common.error'))
    } finally {
      setWorking(false)
    }
  }

  if (canRegister) {
    return (
      <div className="card">
        <h3>{t('auth.invite.title')}</h3>
        <p className="muted">{t('auth.invite.note')}</p>
        {inviteLoading && <div className="muted">{t('auth.invite.loading')}</div>}
        {inviteError && <div className="badge negative">{inviteError}</div>}
        {inviteSummary && (
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <span className="muted">{t('auth.invite.email')}</span>
              <div>{inviteSummary.email || t('auth.invite.noEmail')}</div>
            </div>
            <div>
              <span className="muted">{t('auth.invite.role')}</span>
              <div>{inviteSummary.role}</div>
            </div>
            <div>
              <span className="muted">{t('auth.invite.scope')}</span>
              <div>
                {inviteSummary.scopeType}
                {inviteSummary.scopeId ? ` · ${inviteSummary.scopeId}` : ''}
              </div>
            </div>
            </div>
          )}
        <form className="stack" onSubmit={handleRegister} style={{ marginTop: 12 }}>
          <label className="label">
            <span>{t('auth.emailLabel')}</span>
            <span className="muted">{t('auth.emailNote')}</span>
          </label>
          <input
            className="input"
            type="email"
            value={email}
            required
            readOnly={Boolean(inviteSummary?.email)}
            placeholder={t('auth.emailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="label">
            <span>{t('auth.passwordLabel')}</span>
            <span className="muted">{t('auth.passwordNote')}</span>
          </label>
          <input
            className="input"
            type="password"
            value={password}
            required
            placeholder={t('auth.passwordPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="label">
            <span>{t('auth.nameLabel')}</span>
            <span className="muted">{t('auth.nameNote')}</span>
          </label>
          <input
            className="input"
            value={name}
            placeholder={t('auth.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn" type="submit" disabled={working || status === 'loading'}>
            {working || status === 'loading' ? t('auth.working') : t('auth.registerCta')}
          </button>
          {(formError || error) && (
            <div className="badge negative">
              {t('common.error')}: {formError || error}
            </div>
          )}
        </form>
      </div>
    )
  }

  return (
    <div className="grid two">
      <div className="card">
        <h2>{t('auth.title')}</h2>
        <p className="muted">{t('auth.subtitle')}</p>
        <form className="stack" onSubmit={handleSubmit}>
          <label className="label">
            <span>{t('auth.emailLabel')}</span>
          </label>
          <input
            className="input"
            type="email"
            value={email}
            required
            readOnly={Boolean(inviteSummary?.email)}
            placeholder={t('auth.emailPlaceholder')}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="label">
            <span>{t('auth.passwordLabel')}</span>
            <span className="muted">{t('auth.passwordNote')}</span>
          </label>
          <input
            className="input"
            type="password"
            value={password}
            required
            placeholder={t('auth.passwordPlaceholder')}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn" type="submit" disabled={working || status === 'loading'}>
            {working || status === 'loading' ? t('auth.working') : t('auth.loginCta')}
          </button>
          {(formError || error) && (
            <div className="badge negative">
              {t('common.error')}: {formError || error}
            </div>
          )}
        </form>
      </div>
      <div />
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </I18nProvider>
  )
}
