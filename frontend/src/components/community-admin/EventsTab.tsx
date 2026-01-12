import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const pad = (value: number) => String(value).padStart(2, '0')

function toDateTimeInput(value?: string | null) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(
    dt.getMinutes(),
  )}`
}

type EventItem = {
  id: string
  title: string
  description?: string | null
  startAt: string
  endAt: string
  location?: string | null
  attachments?: any
  visibility?: string
  deepLink?: string
  createdAt?: string
}

type Props = {
  communityCode: string
}

export function EventsTab({ communityCode }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [events, setEvents] = React.useState<EventItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const lastLoadedRef = React.useRef<string | null>(null)
  const [editForm, setEditForm] = React.useState({
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    location: '',
    visibility: 'COMMUNITY',
    attachments: '',
  })
  const [form, setForm] = React.useState({
    title: '',
    description: '',
    startAt: '',
    endAt: '',
    location: '',
    visibility: 'COMMUNITY',
    attachments: '',
  })

  const loadEvents = React.useCallback(async () => {
    if (!communityCode) return
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<EventItem[]>(`/communities/${communityCode}/events`)
      setEvents(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setEvents([])
      setError(err?.message || 'Failed to load events')
    } finally {
      setLoading(false)
    }
  }, [api, communityCode])

  React.useEffect(() => {
    if (!communityCode) return
    if (lastLoadedRef.current === communityCode) return
    lastLoadedRef.current = communityCode
    loadEvents()
  }, [communityCode, loadEvents])

  const resetForm = () =>
    setForm({
      title: '',
      description: '',
      startAt: '',
      endAt: '',
      location: '',
      visibility: 'COMMUNITY',
      attachments: '',
    })

  const parseAttachments = (raw: string) => {
    if (!raw || !raw.trim()) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error('Attachments must be valid JSON')
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.startAt || !form.endAt) return
    setSaving(true)
    setError(null)
    try {
      const attachments = parseAttachments(form.attachments)
      await api.post(`/communities/${communityCode}/events`, {
        title: form.title,
        description: form.description || undefined,
        startAt: form.startAt,
        endAt: form.endAt,
        location: form.location || undefined,
        visibility: form.visibility || 'COMMUNITY',
        attachments,
      })
      resetForm()
      await loadEvents()
    } catch (err: any) {
      setError(err?.message || 'Failed to create event')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (event: EventItem) => {
    setEditingId(event.id)
    setEditForm({
      title: event.title || '',
      description: event.description || '',
      startAt: toDateTimeInput(event.startAt),
      endAt: toDateTimeInput(event.endAt),
      location: event.location || '',
      visibility: event.visibility || 'COMMUNITY',
      attachments: event.attachments ? JSON.stringify(event.attachments, null, 2) : '',
    })
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      const attachments = parseAttachments(editForm.attachments)
      await api.patch(`/communities/${communityCode}/events/${editingId}`, {
        title: editForm.title || undefined,
        description: editForm.description || undefined,
        startAt: editForm.startAt || undefined,
        endAt: editForm.endAt || undefined,
        location: editForm.location || undefined,
        visibility: editForm.visibility || undefined,
        attachments,
      })
      setEditingId(null)
      await loadEvents()
    } catch (err: any) {
      setError(err?.message || 'Failed to update event')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (eventId: string) => {
    if (!window.confirm('Delete this event?')) return
    setSaving(true)
    setError(null)
    try {
      await api.del(`/communities/${communityCode}/events/${eventId}`)
      await loadEvents()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4>{t('events.heading', 'Community events')}</h4>
            <div className="muted">{t('events.subtitle', 'Create and manage community events.')}</div>
          </div>
          <button className="btn ghost small" type="button" onClick={() => loadEvents()} disabled={loading}>
            {t('events.reload', 'Reload')}
          </button>
        </div>
      </div>

      <form className="card" onSubmit={handleCreate}>
        <h4>{t('events.create', 'Create event')}</h4>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={t('events.title', 'Title')}
            value={form.title}
            onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="datetime-local"
            value={form.startAt}
            onChange={(e) => setForm((s) => ({ ...s, startAt: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="datetime-local"
            value={form.endAt}
            onChange={(e) => setForm((s) => ({ ...s, endAt: e.target.value }))}
            required
          />
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input
            className="input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={t('events.location', 'Location')}
            value={form.location}
            onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))}
          />
          <select
            className="input"
            style={{ minWidth: 160 }}
            value={form.visibility}
            onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value }))}
          >
            <option value="COMMUNITY">Community</option>
            <option value="ADMINS">Admins</option>
          </select>
        </div>
        <textarea
          className="input"
          style={{ minHeight: 80, marginTop: 8 }}
          placeholder={t('events.description', 'Description')}
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
        />
        <textarea
          className="input"
          style={{ minHeight: 80, marginTop: 8 }}
          placeholder={t('events.attachments', 'Attachments (JSON)')}
          value={form.attachments}
          onChange={(e) => setForm((s) => ({ ...s, attachments: e.target.value }))}
        />
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button className="btn primary" type="submit" disabled={saving}>
            {t('events.save', 'Save')}
          </button>
          <button className="btn ghost" type="button" onClick={resetForm} disabled={saving}>
            {t('events.clear', 'Clear')}
          </button>
        </div>
      </form>

      {error && <div className="badge negative">{error}</div>}
      {loading && <div className="muted">{t('events.loading', 'Loading...')}</div>}

      {events.length === 0 ? (
        <div className="empty">{t('events.empty', 'No events yet')}</div>
      ) : (
        <div className="stack">
          {events.map((event) => (
            <div key={event.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
              {editingId === event.id ? (
                <form className="stack" onSubmit={handleUpdate}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      style={{ minWidth: 200, flex: 1 }}
                      value={editForm.title}
                      onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))}
                      required
                    />
                    <input
                      className="input"
                      type="datetime-local"
                      value={editForm.startAt}
                      onChange={(e) => setEditForm((s) => ({ ...s, startAt: e.target.value }))}
                      required
                    />
                    <input
                      className="input"
                      type="datetime-local"
                      value={editForm.endAt}
                      onChange={(e) => setEditForm((s) => ({ ...s, endAt: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      style={{ minWidth: 200, flex: 1 }}
                      placeholder={t('events.location', 'Location')}
                      value={editForm.location}
                      onChange={(e) => setEditForm((s) => ({ ...s, location: e.target.value }))}
                    />
                    <select
                      className="input"
                      value={editForm.visibility}
                      onChange={(e) => setEditForm((s) => ({ ...s, visibility: e.target.value }))}
                    >
                      <option value="COMMUNITY">Community</option>
                      <option value="ADMINS">Admins</option>
                    </select>
                  </div>
                  <textarea
                    className="input"
                    style={{ minHeight: 80 }}
                    value={editForm.description}
                    onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))}
                  />
                  <textarea
                    className="input"
                    style={{ minHeight: 80 }}
                    value={editForm.attachments}
                    onChange={(e) => setEditForm((s) => ({ ...s, attachments: e.target.value }))}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" type="submit" disabled={saving}>
                      {t('events.update', 'Update')}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={saving}
                    >
                      {t('events.cancel', 'Cancel')}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="stack">
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <strong>{event.title}</strong>
                      <div className="muted">
                        {new Date(event.startAt).toLocaleString()} → {new Date(event.endAt).toLocaleString()}
                      </div>
                      {event.location && <div className="muted">{event.location}</div>}
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {event.deepLink && (
                        <a className="btn ghost small" href={event.deepLink} target="_blank" rel="noreferrer">
                          {t('events.link', 'Open link')}
                        </a>
                      )}
                      <button className="btn secondary small" type="button" onClick={() => startEdit(event)}>
                        {t('events.edit', 'Edit')}
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => handleDelete(event.id)}
                        disabled={saving}
                      >
                        {t('events.delete', 'Delete')}
                      </button>
                    </div>
                  </div>
                  {event.description && <div className="muted">{event.description}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
