import React from 'react'
// Users tab: manage billing entity responsibles and pending invites for the community.
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'

type PendingInvite = {
  id: string
  email: string
  role: string
  beRoles?: string[]
  createdAt: string
  expiresAt: string
}

const BE_ROLES = ['OWNER', 'RESIDENT', 'EXPENSE_RESPONSIBLE'] as const

type BeUser = {
  userId: string
  email: string
  name?: string | null
  roles: string[]
}

type BeRow = {
  id: string
  code: string
  name: string
  responsibles: Array<{ userId: string; email: string; name?: string | null; assignmentId: string }>
  users: BeUser[]
  pending: PendingInvite[]
}

export function CommunityUsersPanel({ communityId }: { communityId: string }) {
  const { api, user, refreshSession } = useAuth()
  const { t } = useI18n()
  const [beRows, setBeRows] = React.useState<BeRow[]>([])
  const [beInviteEmail, setBeInviteEmail] = React.useState<Record<string, string>>({})
  const [beInviteRoles, setBeInviteRoles] = React.useState<Record<string, string[]>>({})
  const [busyInvite, setBusyInvite] = React.useState(false)
  const [beSearch, setBeSearch] = React.useState('')
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [savingRoles, setSavingRoles] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    setMessage(null)

    api
      .get<Array<{ id: string; code: string; name: string; responsibles?: BeRow['responsibles']; pending?: PendingInvite[]; users?: BeUser[] }>>(
        `/communities/${communityId}/billing-entities/responsibles`,
      )
      .then((rows) =>
        setBeRows(
          rows.map((r) => ({
            ...r,
            responsibles: r.responsibles ?? [],
            pending: r.pending ?? [],
            users: r.users ?? [],
          })),
        ),
      )
      .catch((err: any) => setMessage(err?.message || 'Could not load billing entities'))
      .finally(() => setLoading(false))
  }, [api, communityId])

  async function inviteBeUser(beId: string, email: string) {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) return
    setBusyInvite(true)
    setMessage(null)
    try {
      const roles = beInviteRoles[beId]?.length ? beInviteRoles[beId] : ['EXPENSE_RESPONSIBLE']
      await api.post('/invites', {
        email: trimmedEmail,
        role: 'BILLING_ENTITY_USER',
        scopeType: 'BILLING_ENTITY',
        scopeId: beId,
        beRoles: roles,
      })
      const fresh = await api.get<PendingInvite[]>(`/invites/billing-entity/${beId}/pending`)
      setBeRows((prev) => prev.map((be) => (be.id === beId ? { ...be, pending: fresh } : be)))
      setBeInviteEmail((prev) => ({ ...prev, [beId]: '' }))
      setBeInviteRoles((prev) => ({ ...prev, [beId]: ['EXPENSE_RESPONSIBLE'] }))
      if (user?.email && refreshSession && user.email.toLowerCase() === trimmedEmail.toLowerCase()) {
        try {
          await refreshSession()
        } catch {
          // Ignore refresh errors; invite succeeded and roles will sync on next auth refresh.
        }
      }
    } catch (err: any) {
      setMessage(err?.message || 'Could not invite responsible')
    } finally {
      setBusyInvite(false)
    }
  }

  async function deleteBeInvite(beId: string, inviteId: string) {
    setLoading(true)
    setMessage(null)
    try {
      await api.del(`/invites/billing-entity/${beId}/pending/${inviteId}`)
      setBeRows((prev) =>
        prev.map((be) => (be.id === beId ? { ...be, pending: be.pending.filter((p) => p.id !== inviteId) } : be)),
      )
    } catch (err: any) {
      setMessage(err?.message || 'Could not delete invite')
    } finally {
      setLoading(false)
    }
  }

  async function updateUserRoles(beId: string, userId: string, roles: string[]) {
    const key = `${beId}:${userId}`
    setSavingRoles((prev) => ({ ...prev, [key]: true }))
    setMessage(null)
    try {
      await api.patch(`/communities/${communityId}/billing-entities/${beId}/users/${userId}/roles`, { roles })
      setBeRows((prev) =>
        prev.map((be) => {
          if (be.id !== beId) return be
          const users = be.users
            .map((u) => (u.userId === userId ? { ...u, roles } : u))
            .filter((u) => u.roles.length > 0)
          return { ...be, users }
        }),
      )
    } catch (err: any) {
      setMessage(err?.message || 'Could not update roles')
    } finally {
      setSavingRoles((prev) => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div className="stack">
      <input
        className="input"
        placeholder={t('be.search')}
        value={beSearch}
        onChange={(e) => setBeSearch(e.target.value)}
      />

      {beRows.length === 0 ? (
        <div className="empty">{t('billing.noEntities')}</div>
      ) : (
        <div className="stack" style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
          {beRows
            .filter(
              (be) =>
                !beSearch ||
                be.code.toLowerCase().includes(beSearch.toLowerCase()) ||
                be.name.toLowerCase().includes(beSearch.toLowerCase()),
            )
            .map((be) => {
              const isOpen = expanded[be.id] ?? false
              return (
                <div key={be.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ padding: '6px 10px' }}
                        onClick={() => setExpanded((prev) => ({ ...prev, [be.id]: !isOpen }))}
                      >
                        {isOpen ? '−' : '+'}
                      </button>
                      <div>
                        <strong>{be.code}</strong> — {be.name}
                      </div>
                    </div>
                    <div className="badge">{t('admin.pendingCount', { count: be.pending.length })}</div>
                  </div>

                  {isOpen && (
                    <>
                      <div className="stack">
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <h4>{t('be.usersTitle', 'Users')}</h4>
                          <div className="badge">{be.users.length}</div>
                        </div>
                        {be.users.length === 0 ? (
                          <div className="empty">{t('be.noUsers', 'No users yet.')}</div>
                        ) : (
                          <div className="list">
                            {be.users.map((u) => {
                              const key = `${be.id}:${u.userId}`
                              const busy = !!savingRoles[key]
                              return (
                                <div key={u.userId} className="list-item" style={{ cursor: 'default' }}>
                                  <div style={{ flex: 1 }}>
                                    <strong>{u.email}</strong>
                                    <div className="muted">{u.name ?? '—'}</div>
                                  </div>
                                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                                    {BE_ROLES.map((role) => (
                                      <label key={role} className="row" style={{ gap: 6, alignItems: 'center' }}>
                                        <input
                                          type="checkbox"
                                          disabled={busy}
                                          checked={u.roles.includes(role)}
                                          onChange={() => {
                                            const next = u.roles.includes(role)
                                              ? u.roles.filter((r) => r !== role)
                                              : [...u.roles, role]
                                            updateUserRoles(be.id, u.userId, next)
                                          }}
                                        />
                                        <span>{role}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      <form
                        className="stack"
                        onSubmit={(e) => {
                          e.preventDefault()
                          inviteBeUser(be.id, beInviteEmail[be.id])
                        }}
                      >
                        <h4>{t('be.inviteLabel')}</h4>
                        <input
                          className="input"
                          type="email"
                          placeholder="email@example.com"
                          value={beInviteEmail[be.id] ?? ''}
                          onChange={(e) => setBeInviteEmail((prev) => ({ ...prev, [be.id]: e.target.value }))}
                          required
                        />
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          {BE_ROLES.map((role) => (
                            <label key={role} className="row" style={{ gap: 6, alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={(beInviteRoles[be.id] ?? ['EXPENSE_RESPONSIBLE']).includes(role)}
                                onChange={() =>
                                  setBeInviteRoles((prev) => {
                                    const current = prev[be.id] ?? ['EXPENSE_RESPONSIBLE']
                                    const next = current.includes(role)
                                      ? current.filter((r) => r !== role)
                                      : [...current, role]
                                    return { ...prev, [be.id]: next }
                                  })
                                }
                              />
                              <span>{role}</span>
                            </label>
                          ))}
                        </div>
                        <button className="btn secondary" type="submit" disabled={busyInvite}>
                          {busyInvite ? t('auth.sending') : t('admin.sendInvite')}
                        </button>
                      </form>

                      <div className="stack">
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <h4>{t('be.pendingTitle')}</h4>
                          <div className="badge">{be.pending.length}</div>
                        </div>
                        {be.pending.length === 0 ? (
                          <div className="empty">{t('be.pendingNone')}</div>
                        ) : (
                          <div className="list">
                            {be.pending.map((p) => (
                              <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
                                <div>
                                  <strong>{p.email}</strong>
                                  <div className="muted">
                                    {p.role}
                                    {p.beRoles?.length ? ` · ${p.beRoles.join(', ')}` : ''}
                                    {` · exp ${new Date(p.expiresAt).toLocaleDateString()}`}
                                  </div>
                                </div>
                                <button className="btn secondary" type="button" onClick={() => deleteBeInvite(be.id, p.id)} disabled={loading}>
                                  {t('admin.revoke')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
        </div>
      )}

      {message && <div className="badge negative">{message}</div>}
    </div>
  )
}
