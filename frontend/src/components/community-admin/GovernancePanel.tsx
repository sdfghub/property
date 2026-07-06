import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type Member = { assignmentId: string; userId: string; email: string; name?: string | null; role: string; createdAt?: string }
type Pending = { id: string; email: string; role: string; createdAt?: string; expiresAt?: string }

const ROLE_LABEL: Record<string, string> = {
  COMMUNITY_ADMIN: 'Administrator',
  CENSOR: 'Cenzor',
  EXECUTIVE_COMITEE_MEMBER: 'Comitet executiv',
}
const GROUPS: Array<{ role: string }> = [
  { role: 'COMMUNITY_ADMIN' },
  { role: 'CENSOR' },
  { role: 'EXECUTIVE_COMITEE_MEMBER' },
]

export function GovernancePanel({ communityId, features }: { communityId: string; features?: Record<string, boolean> | null }) {
  const cenzorOn = features ? features.cenzor !== false : true
  const committeeOn = features ? features.committee === true : false
  const { api, user } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const rl = (r: string) => t(`role.${r}`, ROLE_LABEL[r] || r)

  const [members, setMembers] = React.useState<Member[]>([])
  const [pending, setPending] = React.useState<Pending[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [invite, setInvite] = React.useState({ email: '', role: 'COMMUNITY_ADMIN' })

  const load = React.useCallback(() => {
    if (!communityId) return
    setLoading(true)
    Promise.all([
      api.get<Member[]>(`/communities/${communityId}/roles`).catch(() => []),
      api.get<Pending[]>(`/invites/community/${communityId}/pending`).catch(() => []),
    ]).then(([m, p]) => {
      setMembers(Array.isArray(m) ? m : [])
      setPending(Array.isArray(p) ? p : [])
    }).finally(() => setLoading(false))
  }, [api, communityId])

  React.useEffect(() => { load() }, [load])

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!invite.email.trim()) return
    setBusy('invite'); setError(null)
    try {
      await api.post(`/invites/community/${communityId}`, { email: invite.email.trim(), role: invite.role })
      setInvite({ email: '', role: invite.role })
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function remove(m: Member) {
    setBusy(m.assignmentId); setError(null)
    try {
      await api.del(`/communities/${communityId}/roles/${m.userId}/${m.role}`)
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function cancelInvite(p: Pending) {
    setBusy(p.id); setError(null)
    try {
      await api.del(`/invites/community/${communityId}/pending/${p.id}`)
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h4 style={{ margin: 0 }}>{t('gov.title', 'Roluri & acces')}</h4>
      {error && <div className="badge negative">{error}</div>}

      {/* Invite */}
      <form className="card soft row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={sendInvite}>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
          <label className="label">{t('gov.inviteEmail', 'Invită după email')}</label>
          <input className="input" type="email" placeholder="email@exemplu.ro"
            value={invite.email} onChange={(e) => setInvite((s) => ({ ...s, email: e.target.value }))} required />
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <label className="label">{t('gov.role', 'Rol')}</label>
          <select className="input" value={invite.role} onChange={(e) => setInvite((s) => ({ ...s, role: e.target.value }))}>
            <option value="COMMUNITY_ADMIN">{rl('COMMUNITY_ADMIN')}</option>
            {cenzorOn && <option value="CENSOR">{rl('CENSOR')}</option>}
            {committeeOn && <option value="EXECUTIVE_COMITEE_MEMBER">{rl('EXECUTIVE_COMITEE_MEMBER')}</option>}
          </select>
        </div>
        <button className="btn primary" type="submit" disabled={busy === 'invite'}>
          {busy === 'invite' ? t('common.loading', '…') : t('gov.invite', 'Invită / atribuie')}
        </button>
      </form>
      <div className="muted" style={{ fontSize: 12, marginTop: -8 }}>
        {t('gov.inviteHint', 'Dacă utilizatorul există deja, rolul se aplică imediat; altfel primește o invitație pe email.')}
      </div>

      {/* Members grouped by role */}
      {GROUPS.map(({ role }) => {
        const rows = members.filter((m) => m.role === role)
        return (
          <div key={role} className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{rl(role)}</h4>
              <span className="badge secondary">{rows.length}</span>
            </div>
            {rows.length ? (
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                {rows.map((m) => (
                  <div key={m.assignmentId} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
                    <div className="stack" style={{ gap: 0 }}>
                      <span>{m.name || m.email}{m.userId === (user?.id) ? ` · ${t('gov.you', 'tu')}` : ''}</span>
                      {m.name ? <span className="muted" style={{ fontSize: 12 }}>{m.email}</span> : null}
                    </div>
                    <button className="btn ghost small" type="button" disabled={busy === m.assignmentId}
                      onClick={() => remove(m)}>{t('gov.remove', 'Revocă')}</button>
                  </div>
                ))}
              </div>
            ) : <div className="empty" style={{ marginTop: 8 }}>{t('gov.noneRole', 'Niciun membru cu acest rol.')}</div>}
          </div>
        )
      })}

      {/* Pending invites */}
      <div className="card">
        <h4 style={{ marginTop: 0 }}>{t('gov.pending', 'Invitații în așteptare')}</h4>
        {pending.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {pending.map((p) => (
              <div key={p.id} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
                <span>{p.email} <span className="badge tertiary">{rl(p.role)}</span></span>
                <button className="btn ghost small" type="button" disabled={busy === p.id} onClick={() => cancelInvite(p)}>{t('gov.cancel', 'Anulează')}</button>
              </div>
            ))}
          </div>
        ) : <div className="empty">{t('gov.noPending', 'Nicio invitație în așteptare.')}</div>}
      </div>
    </div>
  )
}
