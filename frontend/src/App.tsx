import React from 'react'
// Root app wiring auth + i18n + role-based dashboards.
// The shell handles language switching, role switching, and the login surface.
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CommunityExplorer } from './components/CommunityExplorer'
import { I18nProvider, useI18n } from './i18n/useI18n'
import { SystemAdminPanel } from './components/SystemAdminPanel'
import { CommunityAdminDashboard, type CommunityAdminTabKey } from './components/community-admin/CommunityAdminDashboard'
import { BillingEntityResponsibleDashboard } from './components/BillingEntityResponsibleDashboard'
import { PushPrompt } from './components/PushPrompt'
import { API_BASE } from './api/client'
import './styles/index.css'

type ScopePayload = {
  communities: Array<{ id: string; code: string; name: string }>
  billingEntities: Array<{ id: string; code?: string | null; name?: string | null; communityId?: string | null }>
}

let scopesCache: ScopePayload | null = null
let scopesPromise: Promise<ScopePayload> | null = null

async function fetchScopes(api: { get: <T>(path: string) => Promise<T> }) {
  if (scopesCache) return scopesCache
  if (scopesPromise) return scopesPromise
  scopesPromise = api
    .get<ScopePayload>('/communities/scopes')
    .then((data) => {
      scopesCache = data
      return data
    })
    .catch((err) => {
      scopesPromise = null
      throw err
    })
  return scopesPromise
}

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
            background: lang === l ? 'var(--accent-soft)' : undefined,
            borderColor: lang === l ? 'var(--accent-border)' : undefined,
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

function ProfileMenu({
  email,
  canOpenNotifications,
  onOpenNotifications,
  onLogout,
}: {
  email?: string | null
  canOpenNotifications: boolean
  onOpenNotifications: () => void
  onLogout: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button className="btn secondary" type="button" onClick={() => setOpen((prev) => !prev)}>
        {t('app.profile') || 'Profile'}
      </button>
      {open ? (
        <div
          className="card soft"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            minWidth: 220,
            zIndex: 40,
          }}
        >
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t('auth.emailLabel')}
              </div>
              <div className="badge" style={{ marginTop: 6 }}>
                {email || '-'}
              </div>
            </div>
            <PushPrompt variant="menu" />
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                onOpenNotifications()
                setOpen(false)
              }}
              disabled={!canOpenNotifications}
              title={!canOpenNotifications ? 'Available in community admin scope' : undefined}
            >
              {t('notifications.prefsTitle') || 'Notification settings'}
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                onLogout()
                setOpen(false)
              }}
            >
              {t('app.logout')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AppShell() {
  const { t } = useI18n()
  const { user, status, logout, roles, activeRole, setActiveRole, api } = useAuth()
  const params = React.useMemo(() => new URLSearchParams(window.location.search), [])
  const devCommunity = params.get('community')
  const uiVersion = (import.meta as any)?.env?.VITE_APP_VERSION as string | undefined
  const [apiVersion, setApiVersion] = React.useState<string | null>(null)
  const [adminTabRequest, setAdminTabRequest] = React.useState<CommunityAdminTabKey | null>(null)
  const [communityNames, setCommunityNames] = React.useState<Record<string, string>>({})
  const [beNames, setBeNames] = React.useState<Record<string, string>>({})
  const [accessibleCommunities, setAccessibleCommunities] = React.useState<Array<{ id: string; code: string; name: string }>>([])
  const apiBase = React.useMemo(() => API_BASE.replace(/\/$/, ''), [])
  const roleKey = user ? activeRole?.role || 'member' : 'signed-out'
  const versionLoadRef = React.useRef(false)
  const scopeLoadRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (versionLoadRef.current) return
    versionLoadRef.current = true
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

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.body.dataset.role = roleKey
  }, [roleKey])

  React.useEffect(() => {
    if (!user) {
      setCommunityNames({})
      setBeNames({})
      setAccessibleCommunities([])
      scopeLoadRef.current = null
      return
    }
    const scopeKey = `${user.id || ''}:${roles.length}`
    const hasScopes = accessibleCommunities.length > 0 || Object.keys(communityNames).length > 0
    if (scopeLoadRef.current === scopeKey && hasScopes) return
    let mounted = true
    async function loadScopeNames() {
      try {
        const scopeData = await fetchScopes(api)
        if (!mounted) return
        const communityMap: Record<string, string> = {}
        const communities = scopeData?.communities ?? []
        const billingEntities = scopeData?.billingEntities ?? []
        setAccessibleCommunities(communities)
        communities.forEach((c) => {
          const label = c.name || c.code || c.id
          communityMap[c.id] = label
          if (c.code) {
            communityMap[c.code] = label
          }
        })
        if (mounted) {
          setCommunityNames(communityMap)
          setBeNames(() => {
            const next: Record<string, string> = {}
            billingEntities.forEach((be) => {
              if (!be?.id) return
              const communityLabel = communityMap[be.communityId ?? ''] || (be.communityId ?? '')
              const beLabel = be.name || be.code || be.id
              const fullLabel = [communityLabel, beLabel].filter((val) => val != null && val !== '').join(' · ')
              next[be.id] = fullLabel
              if (be.code) {
                next[be.code] = fullLabel
              }
            })
            return next
          })
          scopeLoadRef.current = scopeKey
        }
      } catch {
        if (mounted) {
          setCommunityNames({})
          setBeNames({})
          setAccessibleCommunities([])
        }
        scopeLoadRef.current = null
      }
    }
    loadScopeNames()
    return () => {
      mounted = false
    }
  }, [api, user?.id, roles.length])

  const handleLogout = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete('invite')
      url.searchParams.delete('inviteToken')
      url.searchParams.delete('token')
      window.history.replaceState({}, document.title, url.toString())
    }
    logout()
  }, [logout])

  const handleOpenNotifications = React.useCallback(() => {
    if (activeRole?.role !== 'COMMUNITY_ADMIN') return
    setAdminTabRequest('notifications')
  }, [activeRole?.role])

  const handleCommunityConfigLoaded = React.useCallback(
    (community: { id?: string; code?: string; name?: string } | null, billingEntities: any[]) => {
      if (!community) return
      const communityLabel = communityNames[community.id ?? ''] || community.name || community.code || community.id || ''
      if (!communityLabel) return
      if (!Array.isArray(billingEntities) || billingEntities.length === 0) return
      setBeNames((prev) => {
        const next = { ...prev }
        billingEntities.forEach((be) => {
          if (be?.id) {
            const beLabel = be.name || be.code || be.id
            next[be.id] = [communityLabel, beLabel].filter((val) => val != null && val !== '').join(' · ')
          }
        })
        return next
      })
    },
    [communityNames],
  )

  return (
    <div className="app-shell" data-role={roleKey}>
      <div className="hero">
        <div>
          <h1>{t('app.console')}</h1>
        </div>
        {user ? (
          <div className="pill-tight">
            <div className="stack" style={{ gap: 4 }}>
              <RolePicker
                roles={roles}
                activeRole={activeRole}
                onChange={setActiveRole}
                communityNames={communityNames}
                beNames={beNames}
                accessibleCommunities={accessibleCommunities}
              />
            </div>
          </div>
        ) : (
          <div className="badge">{status === 'loading' ? t('status.connecting') : t('status.signedOut')}</div>
        )}
        <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <LangSwitch />
            {user ? (
              <ProfileMenu
                email={user.email}
                canOpenNotifications={activeRole?.role === 'COMMUNITY_ADMIN'}
                onOpenNotifications={handleOpenNotifications}
                onLogout={handleLogout}
              />
            ) : null}
          </div>
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
        <CommunityAdminDashboard
          forceCommunityId={devCommunity}
          requestedTab={adminTabRequest}
          onTabRequestHandled={() => setAdminTabRequest(null)}
          communitiesOverride={accessibleCommunities}
          onCommunityConfigLoaded={handleCommunityConfigLoaded}
        />
      ) : user ? (
        activeRole?.role === 'SYSTEM_ADMIN' ? (
          <SystemAdminPanel />
        ) : activeRole?.role === 'COMMUNITY_ADMIN' ? (
          <CommunityAdminDashboard
            requestedTab={adminTabRequest}
            onTabRequestHandled={() => setAdminTabRequest(null)}
            communitiesOverride={accessibleCommunities}
            onCommunityConfigLoaded={handleCommunityConfigLoaded}
          />
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
  communityNames,
  beNames,
  accessibleCommunities,
}: {
  roles: { role: string; scopeType: string; scopeId?: string | null }[]
  activeRole?: { role: string; scopeType: string; scopeId?: string | null } | null
  onChange: (r: { role: string; scopeType: string; scopeId?: string | null }) => void
  communityNames: Record<string, string>
  beNames: Record<string, string>
  accessibleCommunities: Array<{ id: string; code: string; name: string }>
}) {
  const { t } = useI18n()
  if (!roles.length) return null
  const roleLabels: Record<string, string> = {
    SYSTEM_ADMIN: t('role.systemAdmin') || 'System admin',
    COMMUNITY_ADMIN: t('role.communityAdmin') || 'Community admin',
    BILLING_ENTITY_USER: t('role.billingEntityUser') || 'Billing entity user',
    CENSOR: t('role.censor') || 'Censor',
  }
  const communityIndex = React.useMemo(() => {
    const map: Record<string, string> = { ...communityNames }
    accessibleCommunities.forEach((c) => {
      const label = c.name || c.code || c.id
      const keys = [c.id, c.code, c.id?.toUpperCase(), c.code?.toUpperCase()].filter(Boolean) as string[]
      keys.forEach((key) => {
        if (!map[key]) map[key] = label
      })
    })
    return map
  }, [accessibleCommunities, communityNames])
  function resolveScopeName(scopeType?: string | null, scopeId?: string | null) {
    if (!scopeId) return null
    if (scopeType === 'COMMUNITY') {
      const normalized = scopeId.trim()
      const direct = communityIndex[normalized] || communityIndex[normalized.toUpperCase()]
      if (direct) return direct
      const match = accessibleCommunities.find((c) => c.id === scopeId || c.code === scopeId)
      if (match) return match.name || match.code || match.id
      return scopeId
    }
    if (scopeType === 'BILLING_ENTITY') return beNames[scopeId] || scopeId
    return scopeId
  }
  const options = roles.map((r, idx) => {
    const scopeName = resolveScopeName(r.scopeType, r.scopeId)
    const label = [roleLabels[r.role] || r.role, scopeName].filter((val) => val != null && val !== '').join(' · ')
    return { label, value: `${label}__${idx}`, role: r }
  })
  const activeLabel =
    activeRole &&
    [roleLabels[activeRole.role] || activeRole.role, resolveScopeName(activeRole.scopeType, activeRole.scopeId)]
      .filter((val) => val != null && val !== '')
      .join(' · ')
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const displayLabel = activeLabel || options[0]?.label || ''
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <div className="scope-picker" ref={containerRef}>
        <div className="scope-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="badge scope-badge" title={displayLabel}>
            {displayLabel}
          </div>
          <button className="btn secondary scope-option" type="button" onClick={() => setOpen((prev) => !prev)}>
            {t('app.change') || 'Change'}
          </button>
        </div>
        {open && options.length ? (
          <div className="scope-drawer-overlay" role="dialog" aria-label={t('app.scope')}>
            <div className="scope-drawer-panel">
              <div className="scope-drawer-header">
                <span>{t('app.scope')}</span>
                <button className="btn secondary scope-drawer-close" type="button" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>
              <div className="scope-drawer" role="listbox">
                {options.map((opt) => {
                  const isActive =
                    activeRole?.role === opt.role.role &&
                    activeRole?.scopeType === opt.role.scopeType &&
                    activeRole?.scopeId === opt.role.scopeId
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className="scope-drawer-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(opt.role)
                        setOpen(false)
                      }}
                      style={{
                        background: isActive ? 'var(--accent-soft)' : undefined,
                        borderColor: isActive ? 'var(--accent-border)' : undefined,
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
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
