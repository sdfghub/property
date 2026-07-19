import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

export function CommitteeDecisionsPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  const statusMeta = (s: string) => meta?.committeeDecisionStatuses?.find((m) => m.key === s)

  const role = activeRole?.role
  const isAdmin = role === 'COMMUNITY_ADMIN' || role === 'SYSTEM_ADMIN'
  const isCommittee = role === 'EXECUTIVE_COMITEE_MEMBER'

  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const [form, setForm] = React.useState({ title: '', description: '', amount: '' })

  const load = React.useCallback(() => {
    if (!communityId) return
    setLoading(true)
    api.get<any>(`/communities/${communityId}/committee/decisions`)
      .then((d: any) => setData(d))
      .catch((e: any) => setError(e?.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [api, communityId])

  React.useEffect(() => { load() }, [load])

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return
    setBusy('create'); setError(null)
    try {
      await api.post(`/communities/${communityId}/committee/decisions`, {
        title: form.title.trim(),
        description: form.description || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
      })
      setForm({ title: '', description: '', amount: '' }); setShowForm(false)
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function vote(id: string, v: 'APPROVE' | 'REJECT') {
    setBusy(id); setError(null)
    try {
      await api.post(`/communities/${communityId}/committee/decisions/${id}/vote`, { vote: v })
      load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  async function cancel(id: string) {
    setBusy(id); setError(null)
    try { await api.post(`/communities/${communityId}/committee/decisions/${id}/cancel`, {}); load() }
    catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  const decisions: any[] = data?.decisions ?? []

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>{t('committee.title', 'Decizii comitet executiv')}</h4>
        <div className="muted">
          {t('committee.members', 'Membri comitet')}: {data?.memberCount ?? 0} · {t('committee.majority', 'Majoritate necesară')}: {data?.majorityNeeded ?? '—'}
        </div>
        {isAdmin && (
          <button className="btn primary small" type="button" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t('common.cancel', 'Anulează') : `+ ${t('committee.propose', 'Propunere nouă')}`}
          </button>
        )}
      </div>

      {error && <div className="badge negative">{error}</div>}

      {isAdmin && showForm && (
        <form className="card soft stack" style={{ gap: 8 }} onSubmit={createProposal}>
          <input className="input" placeholder={t('committee.propTitle', 'Titlu propunere')}
            value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} required />
          <textarea className="input" placeholder={t('committee.propDesc', 'Descriere (opțional)')} rows={2}
            value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input className="input" type="number" step="0.01" style={{ width: 160 }} placeholder={t('committee.propAmount', 'Sumă (opțional)')}
              value={form.amount} onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))} />
            <button className="btn primary small" type="submit" disabled={busy === 'create'}>{t('common.confirm', 'Trimite')}</button>
          </div>
        </form>
      )}

      {!decisions.length ? (
        <div className="empty">{t('committee.none', 'Nicio decizie încă.')}</div>
      ) : decisions.map((d) => (
        <div key={d.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}>
              <strong>{d.title}{d.amount != null ? ` · ${money(d.amount, d.currency)}` : ''}</strong>
              {d.description ? <div className="muted" style={{ fontSize: 13 }}>{d.description}</div> : null}
              <div className="muted" style={{ fontSize: 12 }}>{new Date(d.createdAt).toLocaleDateString('ro-RO')}</div>
            </div>
            <span className={`badge ${statusMeta(d.status)?.tone || 'secondary'}`}>{t(`committee.status.${d.status}`, statusMeta(d.status)?.label || d.status)}</span>
          </div>
          <div className="row" style={{ gap: 12, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge positive">✓ {d.approveCount}</span>
            <span className="badge negative">✕ {d.rejectCount}</span>
            <span className="muted" style={{ fontSize: 12 }}>/ {data?.memberCount ?? 0} {t('committee.members', 'membri')}</span>
            {d.myVote ? <span className="muted" style={{ fontSize: 12 }}>· {t('committee.youVoted', 'Ai votat')}: {t(`committee.vote.${d.myVote}`, d.myVote)}</span> : null}
            <div style={{ flex: 1 }} />
            {isCommittee && d.status === 'OPEN' && (
              <>
                <button className={`btn small ${d.myVote === 'APPROVE' ? 'primary' : 'secondary'}`} type="button"
                  disabled={busy === d.id} onClick={() => vote(d.id, 'APPROVE')}>{t('committee.approve', 'Aprob')}</button>
                <button className={`btn small ${d.myVote === 'REJECT' ? 'primary' : 'ghost'}`} type="button"
                  disabled={busy === d.id} onClick={() => vote(d.id, 'REJECT')}>{t('committee.reject', 'Resping')}</button>
              </>
            )}
            {isAdmin && d.status === 'OPEN' && (
              <button className="btn ghost small" type="button" disabled={busy === d.id} onClick={() => cancel(d.id)}>{t('committee.cancel', 'Anulează')}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
