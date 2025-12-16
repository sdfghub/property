import React from 'react'
// Users tab: manage billing entity responsibles and pending invites for the community.
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'

type PendingInvite = {
  id: string
  email: string
  role: string
  createdAt: string
  expiresAt: string
}

type BeRow = {
  id: string
  code: string
  name: string
  responsibles: Array<{ userId: string; email: string; name?: string | null; assignmentId: string }>
  pending: PendingInvite[]
}

export function CommunityUsersPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [beRows, setBeRows] = React.useState<BeRow[]>([])
  const [beInviteEmail, setBeInviteEmail] = React.useState<Record<string, string>>({})
  const [busyInvite, setBusyInvite] = React.useState(false)
  const [beSearch, setBeSearch] = React.useState('')
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [periods, setPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [periodCode, setPeriodCode] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    setMessage(null)

    api
      .get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/closed`)
      .then((rows) => {
        setPeriods(rows)
        if (rows.length) setPeriodCode(rows[0].code)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))

    api
      .get<Array<{ id: string; code: string; name: string; responsibles?: BeRow['responsibles']; pending?: PendingInvite[] }>>(
        `/communities/${communityId}/billing-entities/responsibles`,
      )
      .then((rows) =>
        setBeRows(
          rows.map((r) => ({
            ...r,
            responsibles: r.responsibles ?? [],
            pending: r.pending ?? [],
          })),
        ),
      )
      .catch((err: any) => setMessage(err?.message || 'Could not load billing entities'))
      .finally(() => setLoading(false))
  }, [api, communityId])

  async function inviteBeUser(beId: string, email: string) {
    if (!email) return
    setBusyInvite(true)
    setMessage(null)
    try {
      await api.post('/invites', { email, role: 'BILLING_ENTITY_USER', scopeType: 'BILLING_ENTITY', scopeId: beId })
      const fresh = await api.get<PendingInvite[]>(`/invites/billing-entity/${beId}/pending`)
      setBeRows((prev) => prev.map((be) => (be.id === beId ? { ...be, pending: fresh } : be)))
      setBeInviteEmail((prev) => ({ ...prev, [beId]: '' }))
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

  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">
            <span>Period code</span>
            <span className="muted">{t('be.periodClosedOnly')}</span>
          </label>
          <select className="input" value={periodCode} onChange={(e) => setPeriodCode(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.code}>
                {p.code}
              </option>
            ))}
          </select>
        </div>
      </div>

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
                          <h4>{t('admin.adminsTitle')}</h4>
                          <div className="badge">{be.responsibles.length}</div>
                        </div>
                        {be.responsibles.length === 0 ? (
                          <div className="empty">{t('be.noResponsibles')}</div>
                        ) : (
                          <div className="list">
                            {be.responsibles.map((r) => (
                              <div key={r.assignmentId} className="list-item" style={{ cursor: 'default' }}>
                                <div>
                                  <strong>{r.email}</strong>
                                  <div className="muted">{r.name ?? '—'}</div>
                                </div>
                              </div>
                            ))}
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
                                    {p.role} · exp {new Date(p.expiresAt).toLocaleDateString()}
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
