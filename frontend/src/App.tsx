import React from 'react'
// Root app wiring auth + i18n + role-based dashboards.
// The shell handles language switching, role switching, and the login surface.
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CommunityExplorer } from './components/CommunityExplorer'
import { I18nProvider, useI18n } from './i18n/useI18n'
import { SystemAdminPanel } from './components/SystemAdminPanel'
import { CommunityAdminDashboard } from './components/community-admin/CommunityAdminDashboard'
import { BillingEntityResponsibleDashboard } from './components/BillingEntityResponsibleDashboard'
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
  const { user, status, consumeMagicToken, consumeInviteToken, logout, requestMagicLink, error, roles, activeRole, setActiveRole } =
    useAuth()
  const [email, setEmail] = React.useState('')
  const [info, setInfo] = React.useState<string | null>(null)
  const [linkPending, setLinkPending] = React.useState(false)
  const [magicStatus, setMagicStatus] = React.useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const params = React.useMemo(() => new URLSearchParams(window.location.search), [])
  const devCommunity = params.get('community')

  // Auto-consume token from query string
  // Allows clicking emails that include ?token=... or pasting manually.
  React.useEffect(() => {
    const token = params.get('token')
    if (token) {
      setMagicStatus('working')
      consumeMagicToken(token)
        .then(() => {
          setMagicStatus('done')
          params.delete('token')
          window.history.replaceState({}, document.title, `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`)
          setTimeout(() => setMagicStatus('idle'), 1800)
        })
        .catch(() => setMagicStatus('error'))
    }
  }, [consumeMagicToken])

  async function handleRequestLink(e: React.FormEvent) {
    e.preventDefault()
    setLinkPending(true)
    setInfo(null)
    try {
      await requestMagicLink(email)
      setInfo(t('auth.linkInfo'))
    } catch (err: any) {
      setInfo(err?.message || t('common.error'))
    } finally {
      setLinkPending(false)
    }
  }

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
            <button className="btn secondary" style={{ padding: '8px 12px' }} onClick={logout}>
              {t('app.logout')}
            </button>
          </div>
        ) : (
          <div className="badge">{status === 'loading' ? t('status.connecting') : t('status.signedOut')}</div>
        )}
        <LangSwitch />
      </div>

      {magicStatus === 'working' && <div className="badge" style={{ marginTop: 12 }}>{t('auth.signingIn')}</div>}
      {magicStatus === 'error' && <div className="badge negative" style={{ marginTop: 12 }}>{t('auth.magicFail')}</div>}

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
        <div className="grid two" style={{ marginTop: 18 }}>
          <div className="card">
            <h2>{t('auth.requestTitle')}</h2>
            <p className="muted">{t('auth.requestHint')}</p>
            <form className="stack" onSubmit={handleRequestLink}>
              <label className="label">
                <span>{t('auth.emailLabel')}</span>
                <span className="muted">{t('auth.emailNote')}</span>
              </label>
              <input
                className="input"
                type="email"
                value={email}
                required
                placeholder="alex@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn" type="submit" disabled={linkPending}>
                {linkPending ? t('auth.sending') : t('auth.sendLink')}
              </button>
              {info && <div className="muted">{t('auth.linkInfo')}</div>}
              {error && (
                <div className="badge negative">
                  {t('common.error')}: {error}
                </div>
              )}
            </form>
            <div className="card">
              <h3>{t('auth.haveToken')}</h3>
              <p className="muted">
                {t('auth.tokenHint', { tokenParam: '?token=xyz' })}
              </p>
              <MagicTokenBox onConsume={consumeMagicToken} />
            </div>
          </div>

          <div className="grid two" style={{ marginTop: 18 }}>
            <div className="card">
              <h3>Accept an invite</h3>
              <p className="muted">Paste the invite token you received to sign in and claim your role.</p>
              <InviteTokenBox onConsume={consumeInviteToken} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MagicTokenBox({ onConsume }: { onConsume: (token: string) => Promise<void> }) {
  const { t } = useI18n()
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  // Small helper form to paste magic token printed in backend logs.
  async function handleUseToken(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setMsg(null)
    try {
      await onConsume(token)
      setMsg(t('auth.consumeSuccess'))
      setToken('')
    } catch (err: any) {
      setMsg(err?.message || t('auth.consumeError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={handleUseToken}>
      <label className="label">
        <span>{t('auth.pasteToken')}</span>
        <span className="muted">{t('auth.tokenNote')}</span>
      </label>
      <input
        className="input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="3dfc...8a12"
        autoComplete="off"
      />
      <button className="btn secondary" type="submit" disabled={busy}>
        {busy ? t('auth.consuming') : t('auth.consume')}
      </button>
      {msg && <div className="muted">{msg}</div>}
    </form>
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

function InviteTokenBox({ onConsume }: { onConsume: (token: string, name?: string) => Promise<void> }) {
  const [token, setToken] = React.useState('')
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)

  async function handleUseToken(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setBusy(true)
    setMsg(null)
    try {
      await onConsume(token, name || undefined)
      setMsg('Invite accepted. You are signed in.')
      setToken('')
    } catch (err: any) {
      setMsg(err?.message || 'Could not accept invite')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={handleUseToken}>
      <label className="label">
        <span>Invite token</span>
        <span className="muted">Paste the token from your invite link</span>
      </label>
      <input
        className="input"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="invite token"
        autoComplete="off"
      />
      <label className="label">
        <span>Name (optional)</span>
        <span className="muted">Will be saved on accept</span>
      </label>
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="off"
      />
      <button className="btn secondary" type="submit" disabled={busy}>
        {busy ? 'Working…' : 'Accept invite'}
      </button>
      {msg && <div className="muted">{msg}</div>}
    </form>
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
