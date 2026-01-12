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
  const { api, user, refreshSession } = useAuth()
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
  const [createCode, setCreateCode] = React.useState('')
  const [createName, setCreateName] = React.useState('')
  const [createPeriodCode, setCreatePeriodCode] = React.useState('')
  const [createPeriodStart, setCreatePeriodStart] = React.useState('')
  const [createPeriodEnd, setCreatePeriodEnd] = React.useState('')
  const [createDef, setCreateDef] = React.useState<any | null>(null)
  const [createDefName, setCreateDefName] = React.useState<string | null>(null)
  const [createBusy, setCreateBusy] = React.useState(false)
  const [createMessage, setCreateMessage] = React.useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = React.useState(false)
  const communityLoadRef = React.useRef<string | null>(null)
  const adminLoadRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    // System admins can search communities globally.
    if (communityLoadRef.current === search) return
    communityLoadRef.current = search
    api
      .get<Community[]>(`/communities${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then((rows) => {
        setCommunities(rows)
        if (!selectedId && rows.length) {
          setSelectedId(rows[0].id)
        }
      })
      .catch((err: any) => setMessage(err?.message || t('admin.errorLoadCommunities')))
  }, [api, search, t])

  React.useEffect(() => {
    // When a community is selected, load current admins + pending invites.
    if (!selectedId) return
    if (adminLoadRef.current === selectedId) return
    adminLoadRef.current = selectedId
    setLoading(true)
    setMessage(null)
    api
      .get<AdminEntry[]>(`/communities/${selectedId}/admins`)
      .then(setAdmins)
      .catch((err: any) => setMessage(err?.message || t('admin.errorLoadAdmins')))
      .finally(() => setLoading(false))

    api
      .get<PendingInvite[]>(`/invites/community/${selectedId}/pending`)
      .then(setPending)
      .catch((err: any) => setMessage(err?.message || t('admin.errorLoadInvites')))
  }, [api, selectedId, t])

  // Remove an existing admin assignment for the active community.
  async function revoke(userId: string) {
    if (!selectedId) return
    setLoading(true)
    setMessage(null)
    try {
      await api.del(`/communities/${selectedId}/admins/${userId}`)
      setAdmins((prev) => prev.filter((a) => a.userId !== userId))
    } catch (err: any) {
      setMessage(err?.message || t('admin.errorRevoke'))
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
      const targetEmail = inviteEmail.trim()
      await api.post('/invites', {
        email: targetEmail,
        role: 'COMMUNITY_ADMIN',
        scopeType: 'COMMUNITY',
        scopeId: selectedId,
      })
      setInviteEmail('')
      const [freshPending, freshAdmins] = await Promise.all([
        api.get<PendingInvite[]>(`/invites/community/${selectedId}/pending`),
        api.get<AdminEntry[]>(`/communities/${selectedId}/admins`),
      ])
      setPending(freshPending)
      setAdmins(freshAdmins)
      if (user?.email && user.email.toLowerCase() === targetEmail.toLowerCase()) {
        await refreshSession()
      }
    } catch (err: any) {
      setMessage(err?.message || t('admin.errorInvite'))
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
      setMessage(err?.message || t('admin.errorDeleteInvite'))
    } finally {
      setLoading(false)
    }
  }

  async function handleDefUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCreateMessage(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      setCreateDef(parsed)
      setCreateDefName(file.name)
      const resolvedCode = parsed?.code || parsed?.id
      if (!createCode && resolvedCode) setCreateCode(resolvedCode)
      if (!createName && parsed?.name) setCreateName(parsed.name)
      if (!createPeriodCode && parsed?.period?.code) setCreatePeriodCode(parsed.period.code)
      if (!createPeriodStart && parsed?.period?.start) setCreatePeriodStart(parsed.period.start)
      if (!createPeriodEnd && parsed?.period?.end) setCreatePeriodEnd(parsed.period.end)
    } catch (err: any) {
      setCreateDef(null)
      setCreateDefName(null)
      setCreateMessage(err?.message || t('admin.createDefInvalid'))
    } finally {
      e.target.value = ''
    }
  }

  function clearDef() {
    setCreateDef(null)
    setCreateDefName(null)
  }

  async function createCommunity(e: React.FormEvent) {
    e.preventDefault()
    setCreateBusy(true)
    setCreateMessage(null)
    try {
      const payload: any = {
        code: createCode.trim(),
        name: createName.trim(),
        periodCode: createPeriodCode.trim(),
      }
      if (createDef) {
        payload.def = createDef
      } else {
        payload.periodStart = createPeriodStart || undefined
        payload.periodEnd = createPeriodEnd || undefined
      }
      const created = await api.post<{ communityId: string; code: string; name: string }>(`/communities`, payload)
      setCommunities((prev) => {
        if (prev.find((c) => c.id === created.communityId)) return prev
        return [...prev, { id: created.communityId, code: created.code, name: created.name } as Community]
      })
      setSelectedId(created.communityId)
      setCreateMessage(t('admin.createSuccess', { code: created.code }))
      setCreateCode('')
      setCreateName('')
      setCreatePeriodCode('')
      setCreatePeriodStart('')
      setCreatePeriodEnd('')
      setCreateDef(null)
      setCreateDefName(null)
    } catch (err: any) {
      setCreateMessage(err?.message || t('admin.createError'))
    } finally {
      setCreateBusy(false)
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
        <button
          className="btn secondary"
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          style={{ marginTop: 8 }}
        >
          {showCreateForm ? t('admin.createHide') : t('admin.createShow')}
        </button>
        {showCreateForm && (
          <form className="stack" onSubmit={createCommunity} style={{ margin: '8px 0 12px' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h4>{t('admin.createTitle')}</h4>
                <div className="muted">{t('admin.createSubtitle')}</div>
              </div>
              {createBusy && <span className="badge">{t('admin.createLoading')}</span>}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder={t('admin.createCode')}
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value)}
                disabled={!!createDef}
                required
              />
              <input
                className="input"
                placeholder={t('admin.createName')}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={!!createDef}
                required
              />
              <input
                className="input"
                placeholder={t('admin.createPeriodCode')}
                value={createPeriodCode}
                onChange={(e) => setCreatePeriodCode(e.target.value)}
                disabled={!!createDef}
                required
              />
            </div>
            {!createDef && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input"
                  type="date"
                  placeholder={t('admin.createPeriodStart')}
                  value={createPeriodStart}
                  onChange={(e) => setCreatePeriodStart(e.target.value)}
                  required
                />
                <input
                  className="input"
                  type="date"
                  placeholder={t('admin.createPeriodEnd')}
                  value={createPeriodEnd}
                  onChange={(e) => setCreatePeriodEnd(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="btn secondary" style={{ cursor: createBusy ? 'not-allowed' : 'pointer' }}>
                {createDefName ? t('admin.createDefLoaded', { name: createDefName }) : t('admin.createUploadDef')}
                <input type="file" accept="application/json" style={{ display: 'none' }} onChange={handleDefUpload} disabled={createBusy} />
              </label>
              {createDef && (
                <button className="btn secondary" type="button" onClick={clearDef} disabled={createBusy}>
                  {t('admin.createClearDef')}
                </button>
              )}
              <button className="btn" type="submit" disabled={createBusy}>
                {t('admin.createSubmit')}
              </button>
            </div>
            {createMessage && <div className="badge">{createMessage}</div>}
          </form>
        )}
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
                <h3>{active.name} ({active.code})</h3>
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
                placeholder={t('admin.invitePlaceholder')}
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
                <div className="empty"></div>
              ) : (
                <div className="list">
                  {pending.map((p) => (
                    <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
                      <div>
                        <strong>{p.email}</strong>
                        <div className="muted">
                          {t('admin.inviteExpires', { role: p.role, date: new Date(p.expiresAt).toLocaleDateString() })}
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
