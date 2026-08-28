import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata, labelOf } from '../../hooks/useMetadata'

type RequestItem = {
  id: string
  title: string
  description?: string | null
  status: string
  impact?: string | null
  requestKind?: string | null
  createdAt?: string
}

const STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELED', 'REOPENED']

type Props = {
  communityId: string
  readOnly?: boolean
}

// Solicitări — resident/owner requests (certificate requests, technical works, etc.), backed by
// the ticketing system's Ticket.type = 'REQUEST' (see TicketingService), classified by Impact
// (who/what the request concerns) and Tip (the kind of request) — both metadata-driven, per
// CLAUDE.md rule 4 (no hardcoded code→label maps on the frontend).
export function RequestsTab({ communityId, readOnly = false }: Props) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()

  const [rows, setRows] = React.useState<RequestItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState('')
  const lastLoadedRef = React.useRef<string | null>(null)

  const [form, setForm] = React.useState({ title: '', description: '', impact: '', requestKind: '' })
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editForm, setEditForm] = React.useState({ title: '', description: '', impact: '', requestKind: '' })

  const load = React.useCallback(async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      const list = await api.get<RequestItem[]>(`/communities/${communityId}/tickets?type=REQUEST`)
      setRows(Array.isArray(list) ? list : [])
    } catch (err: any) {
      setRows([])
      setError(err?.message || 'Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    if (lastLoadedRef.current === communityId) return
    lastLoadedRef.current = communityId
    load()
  }, [communityId, load])

  const resetForm = () => setForm({ title: '', description: '', impact: '', requestKind: '' })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/tickets`, {
        type: 'REQUEST',
        title: form.title,
        description: form.description || undefined,
        impact: form.impact || undefined,
        requestKind: form.requestKind || undefined,
      })
      resetForm()
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to create request')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (r: RequestItem) => {
    setEditingId(r.id)
    setEditForm({
      title: r.title || '',
      description: r.description || '',
      impact: r.impact || '',
      requestKind: r.requestKind || '',
    })
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || !editForm.title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/communities/${communityId}/tickets/${editingId}`, {
        title: editForm.title,
        description: editForm.description || undefined,
        impact: editForm.impact || undefined,
        requestKind: editForm.requestKind || undefined,
      })
      setEditingId(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to update request')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (id: string, status: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/tickets/${id}/status`, { status })
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to update status')
    } finally {
      setSaving(false)
    }
  }

  const displayRows = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows

  const statusLabel = (s: string) => t(`requests.status.${s}`, s)

  return (
    <div className="stack">
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h4>{t('requests.heading', 'Solicitări')}</h4>
            <div className="muted">{t('requests.subtitle', 'Solicitări de la proprietari / chiriași — adeverințe, lucrări tehnice, acorduri etc.')}</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('requests.filterStatus', 'Status')}>
              <option value="">{t('requests.allStatuses', 'Toate statusurile')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
            <button className="btn ghost small" type="button" onClick={() => load()} disabled={loading}>
              {t('requests.reload', 'Reîncarcă')}
            </button>
          </div>
        </div>
      </div>

      {!readOnly && (
        <form className="card" onSubmit={handleCreate}>
          <h4>{t('requests.create', 'Solicitare nouă')}</h4>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ minWidth: 220, flex: 1 }}
              placeholder={t('requests.title', 'Titlu')}
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              required
            />
            <select
              className="input"
              style={{ minWidth: 180 }}
              value={form.impact}
              onChange={(e) => setForm((s) => ({ ...s, impact: e.target.value }))}
              aria-label={t('requests.impact', 'Impact')}
            >
              <option value="">{t('requests.impact', 'Impact')}</option>
              {(meta?.requestImpacts ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select
              className="input"
              style={{ minWidth: 160 }}
              value={form.requestKind}
              onChange={(e) => setForm((s) => ({ ...s, requestKind: e.target.value }))}
              aria-label={t('requests.kind', 'Tip')}
            >
              <option value="">{t('requests.kind', 'Tip')}</option>
              {(meta?.requestKinds ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <textarea
            className="input"
            style={{ minHeight: 80, marginTop: 8 }}
            placeholder={t('requests.description', 'Descriere')}
            value={form.description}
            onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          />
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn primary" type="submit" disabled={saving}>
              {t('requests.save', 'Salvează')}
            </button>
            <button className="btn ghost" type="button" onClick={resetForm} disabled={saving}>
              {t('requests.clear', 'Șterge câmpurile')}
            </button>
          </div>
        </form>
      )}

      {error && <div className="badge negative">{error}</div>}
      {loading && <div className="muted">{t('requests.loading', 'Se încarcă…')}</div>}

      {!loading && displayRows.length === 0 ? (
        <div className="empty">{t('requests.empty', 'Nicio solicitare')}</div>
      ) : (
        <div className="stack">
          {displayRows.map((r) => (
            <div key={r.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
              {editingId === r.id ? (
                <form className="stack" onSubmit={handleUpdate}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      style={{ minWidth: 220, flex: 1 }}
                      value={editForm.title}
                      onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))}
                      required
                    />
                    <select
                      className="input"
                      style={{ minWidth: 180 }}
                      value={editForm.impact}
                      onChange={(e) => setEditForm((s) => ({ ...s, impact: e.target.value }))}
                      aria-label={t('requests.impact', 'Impact')}
                    >
                      <option value="">{t('requests.impact', 'Impact')}</option>
                      {(meta?.requestImpacts ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <select
                      className="input"
                      style={{ minWidth: 160 }}
                      value={editForm.requestKind}
                      onChange={(e) => setEditForm((s) => ({ ...s, requestKind: e.target.value }))}
                      aria-label={t('requests.kind', 'Tip')}
                    >
                      <option value="">{t('requests.kind', 'Tip')}</option>
                      {(meta?.requestKinds ?? []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                  <textarea
                    className="input"
                    style={{ minHeight: 80 }}
                    value={editForm.description}
                    onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" type="submit" disabled={saving}>
                      {t('requests.update', 'Actualizează')}
                    </button>
                    <button className="btn ghost" type="button" onClick={() => setEditingId(null)} disabled={saving}>
                      {t('requests.cancel', 'Anulează')}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{r.title}</strong>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                      {r.impact && <span className="badge secondary">{labelOf(meta?.requestImpacts, r.impact)}</span>}
                      {r.requestKind && <span className="badge secondary">{labelOf(meta?.requestKinds, r.requestKind)}</span>}
                      {r.createdAt && <span className="muted" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</span>}
                    </div>
                    {r.description && <div className="muted" style={{ marginTop: 4 }}>{r.description}</div>}
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {readOnly ? (
                      <span className="badge secondary">{statusLabel(r.status)}</span>
                    ) : (
                      <>
                        <button className="btn secondary small" type="button" onClick={() => startEdit(r)}>
                          {t('requests.edit', 'Editează')}
                        </button>
                        <select
                          className="input"
                          value={r.status}
                          onChange={(e) => changeStatus(r.id, e.target.value)}
                          disabled={saving}
                          aria-label={t('requests.filterStatus', 'Status')}
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                        </select>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
