import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const IMPACT_TAGS = ['WATER', 'HEAT', 'ELEVATOR', 'ELECTRICITY', 'ACCESS', 'OTHER'] as const
const AUDIENCE_TYPES = ['COMMUNITY', 'UNIT_GROUP'] as const
const BE_ROLES = ['OWNER', 'RESIDENT', 'EXPENSE_RESPONSIBLE'] as const

type UnitGroup = {
  id: string
  code?: string
  name?: string
}

type AnnouncementItem = {
  id: string
  title: string
  body: string
  startsAt?: string | null
  endsAt?: string | null
  audienceType: string
  impactTags?: Array<{ tag: string }>
  audienceGroups?: Array<{ unitGroupId: string }>
  targetRoles?: Array<{ role: string }>
  createdAt?: string
}

type Props = {
  communityId: string
  unitGroups: UnitGroup[]
}

const pad = (value: number) => String(value).padStart(2, '0')

function toDateTimeInput(value?: string | null) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(
    dt.getMinutes(),
  )}`
}

export function CommunicationsTab({ communityId, unitGroups }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [items, setItems] = React.useState<AnnouncementItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const lastLoadedRef = React.useRef<string | null>(null)

  const [form, setForm] = React.useState({
    title: '',
    body: '',
    startsAt: '',
    endsAt: '',
    audienceType: 'COMMUNITY',
    impactTags: [] as string[],
    audienceGroupIds: [] as string[],
    targetRoles: [...BE_ROLES],
  })

  const [editForm, setEditForm] = React.useState({
    title: '',
    body: '',
    startsAt: '',
    endsAt: '',
    audienceType: 'COMMUNITY',
    impactTags: [] as string[],
    audienceGroupIds: [] as string[],
    targetRoles: [...BE_ROLES],
  })

  const loadAnnouncements = React.useCallback(async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<AnnouncementItem[]>(`/communities/${communityId}/announcements`)
      setItems(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setItems([])
      setError(err?.message || t('communications.errorLoad', 'Failed to load announcements'))
    } finally {
      setLoading(false)
    }
  }, [api, communityId, t])

  React.useEffect(() => {
    if (!communityId) return
    if (lastLoadedRef.current === communityId) return
    lastLoadedRef.current = communityId
    loadAnnouncements()
  }, [communityId, loadAnnouncements])

  const toggleImpact = (value: string, isEditing: boolean) => {
    const setter = isEditing ? setEditForm : setForm
    setter((prev) => {
      const next = prev.impactTags.includes(value)
        ? prev.impactTags.filter((tag) => tag !== value)
        : [...prev.impactTags, value]
      return { ...prev, impactTags: next }
    })
  }

  const toggleGroup = (id: string, isEditing: boolean) => {
    const setter = isEditing ? setEditForm : setForm
    setter((prev) => {
      const next = prev.audienceGroupIds.includes(id)
        ? prev.audienceGroupIds.filter((gid) => gid !== id)
        : [...prev.audienceGroupIds, id]
      return { ...prev, audienceGroupIds: next }
    })
  }

  const toggleTargetRole = (role: string, isEditing: boolean) => {
    const setter = isEditing ? setEditForm : setForm
    setter((prev) => {
      const next = prev.targetRoles.includes(role)
        ? prev.targetRoles.filter((item) => item !== role)
        : [...prev.targetRoles, role]
      return { ...prev, targetRoles: next }
    })
  }

  const resetForm = () =>
    setForm({
      title: '',
      body: '',
      startsAt: '',
      endsAt: '',
      audienceType: 'COMMUNITY',
      impactTags: [],
      audienceGroupIds: [],
      targetRoles: [...BE_ROLES],
    })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title || !form.body) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/announcements`, {
        title: form.title,
        body: form.body,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        audienceType: form.audienceType,
        impactTags: form.impactTags,
        audienceGroupIds: form.audienceType === 'UNIT_GROUP' ? form.audienceGroupIds : [],
        targetRoles: form.targetRoles.length ? form.targetRoles : BE_ROLES,
      })
      resetForm()
      await loadAnnouncements()
    } catch (err: any) {
      setError(err?.message || t('communications.errorCreate', 'Failed to create announcement'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (item: AnnouncementItem) => {
    setEditingId(item.id)
    setEditForm({
      title: item.title || '',
      body: item.body || '',
      startsAt: toDateTimeInput(item.startsAt),
      endsAt: toDateTimeInput(item.endsAt),
      audienceType: item.audienceType || 'COMMUNITY',
      impactTags: (item.impactTags || []).map((tag) => tag.tag),
      audienceGroupIds: (item.audienceGroups || []).map((g) => g.unitGroupId),
      targetRoles: (item.targetRoles || []).length ? (item.targetRoles || []).map((r) => r.role) : [...BE_ROLES],
    })
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    setSaving(true)
    setError(null)
    try {
      await api.patch(`/communities/${communityId}/announcements/${editingId}`, {
        title: editForm.title || undefined,
        body: editForm.body || undefined,
        startsAt: editForm.startsAt || undefined,
        endsAt: editForm.endsAt || undefined,
        audienceType: editForm.audienceType,
        impactTags: editForm.impactTags,
        audienceGroupIds: editForm.audienceType === 'UNIT_GROUP' ? editForm.audienceGroupIds : [],
        targetRoles: editForm.targetRoles.length ? editForm.targetRoles : BE_ROLES,
      })
      setEditingId(null)
      await loadAnnouncements()
    } catch (err: any) {
      setError(err?.message || t('communications.errorUpdate', 'Failed to update announcement'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/announcements/${id}/cancel`, {})
      await loadAnnouncements()
    } catch (err: any) {
      setError(err?.message || t('communications.errorCancel', 'Failed to cancel announcement'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3>{t('communications.title', 'Communications')}</h3>
            <p className="muted">{t('communications.subtitle', 'Announcements to residents')}</p>
          </div>
          <button className="btn secondary" type="button" onClick={loadAnnouncements} disabled={loading}>
            {loading ? t('communications.loading', 'Loading…') : t('communications.refresh', 'Refresh')}
          </button>
        </div>
        {error && <div className="badge negative" style={{ marginTop: 12 }}>{error}</div>}
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          {items.length === 0 && !loading ? (
            <div className="muted">{t('communications.empty', 'No announcements yet.')}</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <strong>{item.title}</strong>
                    <div className="muted" style={{ marginTop: 4 }}>
                      {item.body}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {(item.startsAt || item.endsAt) && (
                        <span>
                          {item.startsAt ? new Date(item.startsAt).toLocaleString() : '—'} →{' '}
                          {item.endsAt ? new Date(item.endsAt).toLocaleString() : '—'}
                        </span>
                      )}
                      <span style={{ marginLeft: 8 }}>
                        {t('communications.audience', 'Audience')}: {item.audienceType}
                      </span>
                    </div>
                    {!!item.impactTags?.length && (
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {item.impactTags.map((tag) => (
                          <span key={tag.tag} className="badge">
                            {tag.tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {!!item.targetRoles?.length && (
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {item.targetRoles.map((role) => (
                          <span key={role.role} className="badge">
                            {role.role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <button className="btn ghost small" type="button" onClick={() => startEdit(item)}>
                      {t('communications.edit', 'Edit')}
                    </button>
                    <button className="btn ghost small" type="button" onClick={() => handleCancel(item.id)}>
                      {t('communications.cancel', 'Cancel')}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3>{t('communications.createTitle', 'New announcement')}</h3>
        <form className="stack" style={{ gap: 12, marginTop: 12 }} onSubmit={handleCreate}>
          <div>
            <label className="label">{t('communications.titleLabel', 'Title')}</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              placeholder={t('communications.titlePlaceholder', 'Service update')}
            />
          </div>
          <div>
            <label className="label">{t('communications.bodyLabel', 'Body')}</label>
            <textarea
              className="input"
              style={{ minHeight: 90 }}
              value={form.body}
              onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))}
              placeholder={t('communications.bodyPlaceholder', 'Tell residents what to expect.')}
            />
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div>
              <label className="label">{t('communications.startsAt', 'Starts at')}</label>
              <input
                className="input"
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => setForm((s) => ({ ...s, startsAt: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('communications.endsAt', 'Ends at')}</label>
              <input
                className="input"
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => setForm((s) => ({ ...s, endsAt: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('communications.audienceType', 'Audience type')}</label>
            <select
              className="input"
              value={form.audienceType}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  audienceType: e.target.value,
                  audienceGroupIds: e.target.value === 'UNIT_GROUP' ? s.audienceGroupIds : [],
                }))
              }
            >
              {AUDIENCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          {form.audienceType === 'UNIT_GROUP' && (
            <div>
              <label className="label">{t('communications.audienceGroups', 'Unit groups')}</label>
              <div className="stack" style={{ gap: 6 }}>
                {unitGroups.map((group) => (
                  <label key={group.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={form.audienceGroupIds.includes(group.id)}
                      onChange={() => toggleGroup(group.id, false)}
                    />
                    <span>{group.name || group.code || group.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="label">{t('communications.targetRoles', 'Target user types')}</label>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {BE_ROLES.map((role) => (
                <label key={role} className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.targetRoles.includes(role)}
                    onChange={() => toggleTargetRole(role, false)}
                  />
                  <span>{role}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">{t('communications.impact', 'Impact tags')}</label>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {IMPACT_TAGS.map((tag) => (
                <label key={tag} className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.impactTags.includes(tag)} onChange={() => toggleImpact(tag, false)} />
                  <span>{tag}</span>
                </label>
              ))}
            </div>
          </div>
          <button className="btn" type="submit" disabled={saving || !form.title || !form.body}>
            {saving ? t('communications.saving', 'Saving…') : t('communications.create', 'Create announcement')}
          </button>
        </form>
      </div>

      {editingId && (
        <div className="card">
          <h3>{t('communications.editTitle', 'Edit announcement')}</h3>
          <form className="stack" style={{ gap: 12, marginTop: 12 }} onSubmit={handleUpdate}>
            <div>
              <label className="label">{t('communications.titleLabel', 'Title')}</label>
              <input
                className="input"
                value={editForm.title}
                onChange={(e) => setEditForm((s) => ({ ...s, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('communications.bodyLabel', 'Body')}</label>
              <textarea
                className="input"
                style={{ minHeight: 90 }}
                value={editForm.body}
                onChange={(e) => setEditForm((s) => ({ ...s, body: e.target.value }))}
              />
            </div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div>
                <label className="label">{t('communications.startsAt', 'Starts at')}</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={editForm.startsAt}
                  onChange={(e) => setEditForm((s) => ({ ...s, startsAt: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{t('communications.endsAt', 'Ends at')}</label>
                <input
                  className="input"
                  type="datetime-local"
                  value={editForm.endsAt}
                  onChange={(e) => setEditForm((s) => ({ ...s, endsAt: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('communications.audienceType', 'Audience type')}</label>
              <select
                className="input"
                value={editForm.audienceType}
                onChange={(e) =>
                  setEditForm((s) => ({
                    ...s,
                    audienceType: e.target.value,
                    audienceGroupIds: e.target.value === 'UNIT_GROUP' ? s.audienceGroupIds : [],
                  }))
                }
              >
                {AUDIENCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            {editForm.audienceType === 'UNIT_GROUP' && (
              <div>
                <label className="label">{t('communications.audienceGroups', 'Unit groups')}</label>
                <div className="stack" style={{ gap: 6 }}>
                  {unitGroups.map((group) => (
                    <label key={group.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={editForm.audienceGroupIds.includes(group.id)}
                        onChange={() => toggleGroup(group.id, true)}
                      />
                      <span>{group.name || group.code || group.id}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="label">{t('communications.targetRoles', 'Target user types')}</label>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {BE_ROLES.map((role) => (
                  <label key={role} className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editForm.targetRoles.includes(role)}
                      onChange={() => toggleTargetRole(role, true)}
                    />
                    <span>{role}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('communications.impact', 'Impact tags')}</label>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                {IMPACT_TAGS.map((tag) => (
                  <label key={tag} className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editForm.impactTags.includes(tag)}
                      onChange={() => toggleImpact(tag, true)}
                    />
                    <span>{tag}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? t('communications.saving', 'Saving…') : t('communications.update', 'Update')}
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setEditingId(null)}
                disabled={saving}
              >
                {t('communications.cancelEdit', 'Cancel')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
