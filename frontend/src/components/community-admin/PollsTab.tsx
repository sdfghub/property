import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const pad = (value: number) => String(value).padStart(2, '0')

function splitDateTime(value?: string | null) {
  if (!value) return { date: '', time: '' }
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return { date: '', time: '' }
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  }
}

function normalizeOptions(options: string[]) {
  const trimmed = options.map((opt) => opt.trim()).filter(Boolean)
  if (trimmed.length < 2) throw new Error('Please provide at least two options')
  const set = new Set<string>()
  const duplicates = new Set<string>()
  trimmed.forEach((opt) => {
    if (set.has(opt)) duplicates.add(opt)
    set.add(opt)
  })
  if (duplicates.size > 0) throw new Error('Options must be unique')
  return trimmed
}

type PollOption = {
  id: string
  text: string
  order: number
  votes?: number
}

type PollItem = {
  id: string
  title: string
  description?: string | null
  status: string
  allowsMultiple: boolean
  anonymized: boolean
  startAt: string
  endAt: string
  resultsPublished?: boolean
  publishedResultsAt?: string | null
  options?: PollOption[]
  deepLink?: string
}

type Props = {
  communityCode: string
}

export function PollsTab({ communityCode }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [polls, setPolls] = React.useState<PollItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [details, setDetails] = React.useState<Record<string, PollItem>>({})
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const lastLoadedRef = React.useRef<string | null>(null)
  const [editForm, setEditForm] = React.useState({
    title: '',
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    allowsMultiple: false,
    anonymized: false,
    options: ['', ''],
    voterScope: 'BE_RESPONSIBLES',
  })
  const [form, setForm] = React.useState({
    title: '',
    description: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    allowsMultiple: false,
    anonymized: false,
    options: ['', ''],
    voterScope: 'BE_RESPONSIBLES',
    saveAsDraft: false,
  })

  const loadPolls = React.useCallback(async () => {
    if (!communityCode) return
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<PollItem[]>(`/communities/${communityCode}/polls`)
      setPolls(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setPolls([])
      setError(err?.message || 'Failed to load polls')
    } finally {
      setLoading(false)
    }
  }, [api, communityCode])

  React.useEffect(() => {
    if (!communityCode) return
    if (lastLoadedRef.current === communityCode) return
    lastLoadedRef.current = communityCode
    loadPolls()
  }, [communityCode, loadPolls])

  const resetForm = () =>
    setForm({
      title: '',
      description: '',
      startDate: '',
      startTime: '',
      endDate: '',
      endTime: '',
      allowsMultiple: false,
      anonymized: false,
      options: ['', ''],
      voterScope: 'BE_RESPONSIBLES',
      saveAsDraft: false,
    })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.startDate || !form.startTime || !form.endDate || !form.endTime) return
    let options: string[]
    try {
      options = normalizeOptions(form.options)
    } catch (err: any) {
      setError(err?.message || 'Invalid poll options')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityCode}/polls`, {
        title: form.title,
        description: form.description || undefined,
        startAt: `${form.startDate}T${form.startTime}`,
        endAt: `${form.endDate}T${form.endTime}`,
        allowsMultiple: form.allowsMultiple,
        anonymized: form.anonymized,
        options,
        voterScope: form.voterScope,
        status: form.saveAsDraft ? 'DRAFT' : undefined,
      })
      resetForm()
      await loadPolls()
    } catch (err: any) {
      setError(err?.message || 'Failed to create poll')
    } finally {
      setSaving(false)
    }
  }

  const handleExpand = async (pollId: string) => {
    const next = !expanded[pollId]
    setExpanded((prev) => ({ ...prev, [pollId]: next }))
    if (next && !details[pollId]) {
      try {
        const poll = await api.get<PollItem>(`/communities/${communityCode}/polls/${pollId}`)
        setDetails((prev) => ({ ...prev, [pollId]: poll }))
      } catch (err: any) {
        setError(err?.message || 'Failed to load poll details')
      }
    }
  }

  const startEdit = (poll: PollItem) => {
    const start = splitDateTime(poll.startAt)
    const end = splitDateTime(poll.endAt)
    setEditingId(poll.id)
    setEditForm({
      title: poll.title || '',
      description: poll.description || '',
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      allowsMultiple: !!poll.allowsMultiple,
      anonymized: !!poll.anonymized,
      options: (poll.options || []).map((opt) => opt.text).length
        ? (poll.options || []).map((opt) => opt.text)
        : ['', ''],
      voterScope: 'BE_RESPONSIBLES',
    })
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    if (!editForm.startDate || !editForm.startTime || !editForm.endDate || !editForm.endTime) return
    let options: string[]
    try {
      options = normalizeOptions(editForm.options)
    } catch (err: any) {
      setError(err?.message || 'Invalid poll options')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/communities/${communityCode}/polls/${editingId}`, {
        title: editForm.title || undefined,
        description: editForm.description || undefined,
        startAt: `${editForm.startDate}T${editForm.startTime}`,
        endAt: `${editForm.endDate}T${editForm.endTime}`,
        allowsMultiple: editForm.allowsMultiple,
        anonymized: editForm.anonymized,
        options,
      })
      setEditingId(null)
      await loadPolls()
    } catch (err: any) {
      setError(err?.message || 'Failed to update poll')
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (pollId: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityCode}/polls/${pollId}/approve`, {})
      await loadPolls()
    } catch (err: any) {
      setError(err?.message || 'Failed to approve poll')
    } finally {
      setSaving(false)
    }
  }

  const handleReject = async (pollId: string) => {
    const reason = window.prompt('Rejection reason?')
    if (!reason) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityCode}/polls/${pollId}/reject`, { reason })
      await loadPolls()
    } catch (err: any) {
      setError(err?.message || 'Failed to reject poll')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = async (pollId: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityCode}/polls/${pollId}/close`, {})
      await loadPolls()
    } catch (err: any) {
      setError(err?.message || 'Failed to close poll')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async (pollId: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityCode}/polls/${pollId}/publish-results`, {})
      await loadPolls()
      const poll = await api.get<PollItem>(`/communities/${communityCode}/polls/${pollId}`)
      setDetails((prev) => ({ ...prev, [pollId]: poll }))
    } catch (err: any) {
      setError(err?.message || 'Failed to publish results')
    } finally {
      setSaving(false)
    }
  }

  const renderOptions = (poll: PollItem) => {
    const options = poll.options || []
    if (options.length === 0) return <div className="muted">No options</div>
    return (
      <ul className="muted" style={{ marginTop: 6 }}>
        {options.map((opt) => (
          <li key={opt.id}>
            {opt.text}
            {typeof opt.votes === 'number' ? ` • ${opt.votes} votes` : ''}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="stack">
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4>{t('polls.heading', 'Community polls')}</h4>
            <div className="muted">{t('polls.subtitle', 'Approve polls, manage votes, and publish results.')}</div>
          </div>
          <button className="btn ghost small" type="button" onClick={() => loadPolls()} disabled={loading}>
            {t('polls.reload', 'Reload')}
          </button>
        </div>
      </div>

      <form className="card" onSubmit={handleCreate}>
        <h4>{t('polls.create', 'Create poll')}</h4>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ minWidth: 220, flex: 1 }}
            placeholder={t('polls.title', 'Title')}
            value={form.title}
            onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((s) => ({ ...s, startDate: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="time"
            value={form.startTime}
            onChange={(e) => setForm((s) => ({ ...s, startTime: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="date"
            value={form.endDate}
            onChange={(e) => setForm((s) => ({ ...s, endDate: e.target.value }))}
            required
          />
          <input
            className="input"
            style={{ minWidth: 180 }}
            type="time"
            value={form.endTime}
            onChange={(e) => setForm((s) => ({ ...s, endTime: e.target.value }))}
            required
          />
        </div>
        <textarea
          className="input"
          style={{ minHeight: 80, marginTop: 8 }}
          placeholder={t('polls.description', 'Description')}
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
        />
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="muted">{t('polls.options', 'Options')}</div>
          {form.options.map((opt, idx) => (
            <div key={`${idx}-${opt}`} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder={`Option ${idx + 1}`}
                value={opt}
                onChange={(e) => {
                  const next = [...form.options]
                  next[idx] = e.target.value
                  setForm((s) => ({ ...s, options: next }))
                }}
                required
              />
              {form.options.length > 2 && (
                <button
                  className="btn ghost small"
                  type="button"
                  onClick={() => {
                    const next = form.options.filter((_, i) => i !== idx)
                    setForm((s) => ({ ...s, options: next }))
                  }}
                >
                  {t('polls.removeOption', 'Remove')}
                </button>
              )}
            </div>
          ))}
          <div>
            <button
              className="btn secondary small"
              type="button"
              onClick={() => setForm((s) => ({ ...s, options: [...s.options, ''] }))}
            >
              {t('polls.addOption', 'Add option')}
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.allowsMultiple}
              onChange={(e) => setForm((s) => ({ ...s, allowsMultiple: e.target.checked }))}
            />
            <span className="muted">{t('polls.multi', 'Allow multiple selections')}</span>
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.anonymized}
              onChange={(e) => setForm((s) => ({ ...s, anonymized: e.target.checked }))}
            />
            <span className="muted">{t('polls.anonymized', 'Anonymize public results')}</span>
          </label>
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.saveAsDraft}
              onChange={(e) => setForm((s) => ({ ...s, saveAsDraft: e.target.checked }))}
            />
            <span className="muted">{t('polls.draft', 'Save as draft')}</span>
          </label>
          <select
            className="input"
            style={{ minWidth: 180 }}
            value={form.voterScope}
            onChange={(e) => setForm((s) => ({ ...s, voterScope: e.target.value }))}
          >
            <option value="BE_RESPONSIBLES">BE responsibles</option>
            <option value="ALL_COMMUNITY_USERS">All community users</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <button className="btn primary" type="submit" disabled={saving}>
            {t('polls.save', 'Save')}
          </button>
          <button className="btn ghost" type="button" onClick={resetForm} disabled={saving}>
            {t('polls.clear', 'Clear')}
          </button>
        </div>
      </form>

      {error && <div className="badge negative">{error}</div>}
      {loading && <div className="muted">{t('polls.loading', 'Loading...')}</div>}

      {polls.length === 0 ? (
        <div className="empty">{t('polls.empty', 'No polls yet')}</div>
      ) : (
        <div className="stack">
          {polls.map((poll) => {
            const isOpen = expanded[poll.id] ?? false
            const detail = details[poll.id] || poll
            return (
              <div key={poll.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                {editingId === poll.id ? (
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
                        type="date"
                        value={editForm.startDate}
                        onChange={(e) => setEditForm((s) => ({ ...s, startDate: e.target.value }))}
                        required
                      />
                      <input
                        className="input"
                        type="time"
                        value={editForm.startTime}
                        onChange={(e) => setEditForm((s) => ({ ...s, startTime: e.target.value }))}
                        required
                      />
                      <input
                        className="input"
                        type="date"
                        value={editForm.endDate}
                        onChange={(e) => setEditForm((s) => ({ ...s, endDate: e.target.value }))}
                        required
                      />
                      <input
                        className="input"
                        type="time"
                        value={editForm.endTime}
                        onChange={(e) => setEditForm((s) => ({ ...s, endTime: e.target.value }))}
                        required
                      />
                    </div>
                    <textarea
                      className="input"
                      style={{ minHeight: 80 }}
                      value={editForm.description}
                      onChange={(e) => setEditForm((s) => ({ ...s, description: e.target.value }))}
                    />
                    <div className="stack">
                      <div className="muted">{t('polls.options', 'Options')}</div>
                      {editForm.options.map((opt, idx) => (
                        <div key={`${idx}-${opt}`} className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <input
                            className="input"
                            style={{ flex: 1 }}
                            placeholder={`Option ${idx + 1}`}
                            value={opt}
                            onChange={(e) => {
                              const next = [...editForm.options]
                              next[idx] = e.target.value
                              setEditForm((s) => ({ ...s, options: next }))
                            }}
                            required
                          />
                          {editForm.options.length > 2 && (
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() => {
                                const next = editForm.options.filter((_, i) => i !== idx)
                                setEditForm((s) => ({ ...s, options: next }))
                              }}
                            >
                              {t('polls.removeOption', 'Remove')}
                            </button>
                          )}
                        </div>
                      ))}
                      <div>
                        <button
                          className="btn secondary small"
                          type="button"
                          onClick={() => setEditForm((s) => ({ ...s, options: [...s.options, ''] }))}
                        >
                          {t('polls.addOption', 'Add option')}
                        </button>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={editForm.allowsMultiple}
                          onChange={(e) => setEditForm((s) => ({ ...s, allowsMultiple: e.target.checked }))}
                        />
                        <span className="muted">Allow multiple selections</span>
                      </label>
                      <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={editForm.anonymized}
                          onChange={(e) => setEditForm((s) => ({ ...s, anonymized: e.target.checked }))}
                        />
                        <span className="muted">Anonymize public results</span>
                      </label>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn primary" type="submit" disabled={saving}>
                        {t('polls.update', 'Update')}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                      >
                        {t('polls.cancel', 'Cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="stack">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <strong>{poll.title}</strong>
                        <div className="muted">
                          {new Date(poll.startAt).toLocaleString()} → {new Date(poll.endAt).toLocaleString()}
                        </div>
                        <div className="muted">
                          Status: {poll.status}
                          {poll.resultsPublished ? ' • Results published' : ''}
                          {poll.allowsMultiple ? ' • Multi-select' : ' • Single-select'}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn secondary small"
                          type="button"
                          onClick={() => handleExpand(poll.id)}
                        >
                          {isOpen ? 'Hide' : 'Details'}
                        </button>
                        {poll.deepLink && (
                          <a className="btn ghost small" href={poll.deepLink} target="_blank" rel="noreferrer">
                            {t('polls.link', 'Open link')}
                          </a>
                        )}
                        {poll.status === 'PROPOSED' && (
                          <button
                            className="btn primary small"
                            type="button"
                            onClick={() => handleApprove(poll.id)}
                            disabled={saving}
                          >
                            {t('polls.approve', 'Approve')}
                          </button>
                        )}
                        {poll.status === 'PROPOSED' && (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handleReject(poll.id)}
                            disabled={saving}
                          >
                            {t('polls.reject', 'Reject')}
                          </button>
                        )}
                        {(poll.status === 'DRAFT' || poll.status === 'PROPOSED') && (
                          <button
                            className="btn secondary small"
                            type="button"
                            onClick={() => startEdit(poll)}
                            disabled={saving}
                          >
                            {t('polls.edit', 'Edit')}
                          </button>
                        )}
                        {poll.status === 'APPROVED' && (
                          <button
                            className="btn secondary small"
                            type="button"
                            onClick={() => handleClose(poll.id)}
                            disabled={saving}
                          >
                            {t('polls.close', 'Close')}
                          </button>
                        )}
                        {(poll.status === 'CLOSED' || new Date(poll.endAt).getTime() <= Date.now()) &&
                          !poll.resultsPublished && (
                          <button
                            className="btn ghost small"
                            type="button"
                            onClick={() => handlePublish(poll.id)}
                            disabled={saving}
                          >
                            {t('polls.publish', 'Publish results')}
                          </button>
                        )}
                      </div>
                    </div>
                    {poll.description && <div className="muted">{poll.description}</div>}
                    {isOpen && (
                      <div className="card soft" style={{ marginTop: 8 }}>
                        <div className="muted">Options</div>
                        {renderOptions(detail)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
