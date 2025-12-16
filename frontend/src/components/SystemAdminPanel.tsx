import React from 'react'
// System admin: community search + community-admin invite management.
// This screen assumes the user has SYSTEM scope and can see all communities.
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import type { Community } from '../api/types'

type AdminEntry = { assignmentId: string; userId: string; email: string; name?: string | null; createdAt: string }
type PendingInvite = {
  id: string
  email: string
  role: string
  createdAt: string
  expiresAt: string
}

export function SystemAdminPanel() {
  const { api } = useAuth()
  const { t } = useI18n()
  const [communities, setCommunities] = React.useState<Community[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [admins, setAdmins] = React.useState<AdminEntry[]>([])
  const [pending, setPending] = React.useState<PendingInvite[]>([])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [busyInvite, setBusyInvite] = React.useState(false)

  React.useEffect(() => {
    // System admins can search communities globally.
    api
      .get<Community[]>(`/communities${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then((rows) => {
        setCommunities(rows)
        if (!selectedId && rows.length) {
          setSelectedId(rows[0].id)
        }
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load communities'))
  }, [api, search, selectedId])

  React.useEffect(() => {
    // When a community is selected, load current admins + pending invites.
    if (!selectedId) return
    setLoading(true)
    setMessage(null)
    api
      .get<AdminEntry[]>(`/communities/${selectedId}/admins`)
      .then(setAdmins)
      .catch((err: any) => setMessage(err?.message || 'Could not load admins'))
      .finally(() => setLoading(false))

    api
      .get<PendingInvite[]>(`/invites/community/${selectedId}/pending`)
      .then(setPending)
      .catch((err: any) => setMessage(err?.message || 'Could not load invites'))
  }, [api, selectedId])

  // Remove an existing admin assignment for the active community.
  async function revoke(userId: string) {
    if (!selectedId) return
    setLoading(true)
    setMessage(null)
    try {
      await api.del(`/communities/${selectedId}/admins/${userId}`)
      setAdmins((prev) => prev.filter((a) => a.userId !== userId))
    } catch (err: any) {
      setMessage(err?.message || 'Could not revoke')
    } finally {
      setLoading(false)
    }
  }

  // Send a community-admin invite for the selected community.
  async function inviteAdmin(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId || !inviteEmail) return
    setBusyInvite(true)
    setMessage(null)
    try {
      await api.post('/invites', {
        email: inviteEmail,
        role: 'COMMUNITY_ADMIN',
        scopeType: 'COMMUNITY',
        scopeId: selectedId,
      })
      setInviteEmail('')
      const fresh = await api.get<PendingInvite[]>(`/invites/community/${selectedId}/pending`)
      setPending(fresh)
    } catch (err: any) {
      setMessage(err?.message || 'Could not invite admin')
    } finally {
      setBusyInvite(false)
    }
  }

  // Pending invites can be revoked; update local state afterwards.
  async function deletePendingInvite(id: string) {
    setLoading(true)
    setMessage(null)
    try {
      await api.del(`/invites/community/${selectedId}/pending/${id}`)
      setPending((prev) => prev.filter((p) => p.id !== id))
    } catch (err: any) {
      setMessage(err?.message || 'Could not delete invite')
    } finally {
      setLoading(false)
    }
  }

  const active = communities.find((c) => c.id === selectedId) ?? null
  const filtered = communities.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="grid two" style={{ marginTop: 18 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('communities.title')}</h2>
          {loading && <span className="badge">{t('communities.loading')}</span>}
        </div>
        <input
          className="input"
          placeholder={t('admin.searchCommunities')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ margin: '10px 0' }}
        />
        {!loading && filtered.length === 0 && <div className="empty">{t('communities.empty')}</div>}
        <div className="list">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="list-item"
              onClick={() => setSelectedId(c.id)}
              style={{
                borderColor: active?.id === c.id ? 'rgba(43,212,213,0.6)' : undefined,
                background: active?.id === c.id ? 'rgba(43,212,213,0.08)' : undefined,
              }}
            >
              <div>
                <strong>{c.name}</strong>
                <div className="muted">{t('communities.code', { code: c.code })}</div>
              </div>
              {active?.id === c.id ? <span className="chip">{t('communities.selected')}</span> : <span className="badge">{t('communities.view')}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {active ? (
          <div className="stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3>{active.name}</h3>
                <div className="muted">
                  {t('billing.communityLabel')}: {active.code}
                </div>
                <div className="badge" style={{ marginTop: 6 }}>Manage community admins</div>
              </div>
            </div>

            <div className="stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h4>{t('admin.adminsTitle')}</h4>
                <div className="badge">{t('admin.adminsCount', { count: admins.length })}</div>
              </div>
              {admins.length === 0 ? (
                <div className="empty">{t('admin.noAdmins')}</div>
              ) : (
                <div className="list">
                  {admins.map((a) => (
                    <div key={a.assignmentId} className="list-item" style={{ cursor: 'default' }}>
                      <div>
                        <strong>{a.email}</strong>
                        <div className="muted">{a.name ?? '—'}</div>
                      </div>
                      <button className="btn secondary" type="button" onClick={() => revoke(a.userId)} disabled={loading}>
                        {t('admin.revoke')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form className="stack" onSubmit={inviteAdmin}>
              <h4>{t('admin.inviteTitle')}</h4>
              <input
                className="input"
                type="email"
                placeholder="email@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
              <button className="btn" type="submit" disabled={busyInvite}>
                {busyInvite ? t('auth.sending') : t('admin.sendInvite')}
              </button>
            </form>

            <div className="stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h4>{t('admin.pendingTitle')}</h4>
                <div className="badge">{t('admin.pendingCount', { count: pending.length })}</div>
              </div>
              {pending.length === 0 ? (
                <div className="empty">{t('admin.noPending')}</div>
              ) : (
                <div className="list">
                  {pending.map((p) => (
                    <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
                      <div>
                        <strong>{p.email}</strong>
                        <div className="muted">
                          {p.role} · exp {new Date(p.expiresAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="badge">{new Date(p.createdAt).toLocaleDateString()}</div>
                        <button className="btn secondary" type="button" onClick={() => deletePendingInvite(p.id)} disabled={loading}>
                          {t('admin.revoke')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {message && <div className="badge negative">{message}</div>}
          </div>
        ) : (
          <div className="empty">{t('communities.empty')}</div>
        )}
      </div>
    </div>
  )
}
