import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const TAGS = [
  'OUTAGE',
  'BREAKDOWN',
  'LEAK',
  'SAFETY',
  'SECURITY',
  'COMPLAINT',
  'ACCESS',
  'NOISE',
  'CLEANLINESS',
  'DAMAGE',
  'PREVENTIVE_MAINTENANCE',
  'INSPECTION',
  'REPAIR',
  'UPGRADE',
  'CLEANING',
  'VENDOR_VISIT',
  'COMPLIANCE',
  'METER_READING',
]

type Asset = {
  id: string
  name: string
  description?: string | null
  status?: string
  rules?: Array<{
    id: string
    title: string
    description?: string | null
    intervalDays: number
    nextDueAt: string
    enabled: boolean
    tags?: Array<{ tag: string }>
  }>
}

type Props = {
  communityId: string
}

export function InventoryTab({ communityId }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [assets, setAssets] = React.useState<Asset[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [expandedAssetId, setExpandedAssetId] = React.useState<string | null>(null)
  const lastLoadedRef = React.useRef<string | null>(null)

  const [assetForm, setAssetForm] = React.useState({
    name: '',
    description: '',
  })

  const [ruleFormByAsset, setRuleFormByAsset] = React.useState<Record<string, any>>({})

  const loadAssets = React.useCallback(async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      const rows = await api.get<Asset[]>(`/communities/${communityId}/inventory/assets`)
      setAssets(Array.isArray(rows) ? rows : [])
    } catch (err: any) {
      setAssets([])
      setError(err?.message || t('inventory.errorLoad', 'Failed to load assets'))
    } finally {
      setLoading(false)
    }
  }, [api, communityId, t])

  React.useEffect(() => {
    if (!communityId) return
    if (lastLoadedRef.current === communityId) return
    lastLoadedRef.current = communityId
    loadAssets()
  }, [communityId, loadAssets])

  const resetAssetForm = () => setAssetForm({ name: '', description: '' })

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!assetForm.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/inventory/assets`, {
        name: assetForm.name,
        description: assetForm.description || undefined,
      })
      resetAssetForm()
      await loadAssets()
    } catch (err: any) {
      setError(err?.message || t('inventory.errorCreateAsset', 'Failed to create asset'))
    } finally {
      setSaving(false)
    }
  }

  const ensureRuleForm = (assetId: string) => {
    setRuleFormByAsset((prev) => {
      if (prev[assetId]) return prev
      return {
        ...prev,
        [assetId]: {
          title: '',
          description: '',
          intervalDays: '30',
          nextDueAt: '',
          tags: [] as string[],
        },
      }
    })
  }

  const toggleTag = (assetId: string, tag: string) => {
    setRuleFormByAsset((prev) => {
      const current = prev[assetId]
      if (!current) return prev
      const nextTags = current.tags.includes(tag)
        ? current.tags.filter((t: string) => t !== tag)
        : [...current.tags, tag]
      return { ...prev, [assetId]: { ...current, tags: nextTags } }
    })
  }

  const handleCreateRule = async (assetId: string) => {
    const form = ruleFormByAsset[assetId]
    if (!form?.title || !form?.intervalDays || !form?.nextDueAt) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/inventory/assets/${assetId}/rules`, {
        title: form.title,
        description: form.description || undefined,
        intervalDays: Number(form.intervalDays),
        nextDueAt: form.nextDueAt,
        tags: form.tags || [],
      })
      setRuleFormByAsset((prev) => ({
        ...prev,
        [assetId]: { ...form, title: '', description: '', nextDueAt: '' },
      }))
      await loadAssets()
    } catch (err: any) {
      setError(err?.message || t('inventory.errorCreateRule', 'Failed to create rule'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3>{t('inventory.title', 'Inventory assets')}</h3>
            <p className="muted">{t('inventory.subtitle', 'Track assets and maintenance rules')}</p>
          </div>
          <button className="btn secondary" type="button" onClick={loadAssets} disabled={loading}>
            {loading ? t('inventory.loading', 'Loading…') : t('inventory.refresh', 'Refresh')}
          </button>
        </div>
        {error && <div className="badge negative" style={{ marginTop: 12 }}>{error}</div>}
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          {assets.length === 0 && !loading ? (
            <div className="muted">{t('inventory.empty', 'No assets yet.')}</div>
          ) : (
            assets.map((asset) => (
              <div key={asset.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <strong>{asset.name}</strong>
                    {asset.description ? <div className="muted">{asset.description}</div> : null}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t('inventory.rulesCount', { count: asset.rules?.length || 0 })}
                    </div>
                  </div>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => {
                      ensureRuleForm(asset.id)
                      setExpandedAssetId((prev) => (prev === asset.id ? null : asset.id))
                    }}
                  >
                    {expandedAssetId === asset.id ? t('inventory.hideRules', 'Hide rules') : t('inventory.showRules', 'Add rule')}
                  </button>
                </div>
                {expandedAssetId === asset.id ? (
                  <div className="stack" style={{ gap: 10, marginTop: 12 }}>
                    {asset.rules?.length ? (
                      <div className="stack" style={{ gap: 8 }}>
                        {asset.rules.map((rule) => (
                          <div key={rule.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                            <div>
                              <strong>{rule.title}</strong>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {t('inventory.ruleEvery', { days: rule.intervalDays })} · {t('inventory.nextDue')}:{' '}
                                {new Date(rule.nextDueAt).toLocaleDateString()}
                              </div>
                              {!!rule.tags?.length && (
                                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                  {rule.tags.map((tag) => (
                                    <span key={tag.tag} className="badge">
                                      {tag.tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="muted">{t('inventory.noRules', 'No rules yet.')}</div>
                    )}

                    <div className="card" style={{ padding: 12, borderStyle: 'dashed' }}>
                      <h4 style={{ margin: 0 }}>{t('inventory.newRule', 'New rule')}</h4>
                      <div className="stack" style={{ gap: 10, marginTop: 10 }}>
                        <div>
                          <label className="label">{t('inventory.ruleTitle', 'Title')}</label>
                          <input
                            className="input"
                            value={ruleFormByAsset[asset.id]?.title || ''}
                            onChange={(e) =>
                              setRuleFormByAsset((prev) => ({
                                ...prev,
                                [asset.id]: { ...prev[asset.id], title: e.target.value },
                              }))
                            }
                            placeholder={t('inventory.ruleTitlePlaceholder', 'Boiler inspection')}
                          />
                        </div>
                        <div>
                          <label className="label">{t('inventory.ruleDescription', 'Description')}</label>
                          <textarea
                            className="input"
                            style={{ minHeight: 70 }}
                            value={ruleFormByAsset[asset.id]?.description || ''}
                            onChange={(e) =>
                              setRuleFormByAsset((prev) => ({
                                ...prev,
                                [asset.id]: { ...prev[asset.id], description: e.target.value },
                              }))
                            }
                          />
                        </div>
                        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                          <div>
                            <label className="label">{t('inventory.intervalDays', 'Interval (days)')}</label>
                            <input
                              className="input"
                              type="number"
                              min="1"
                              value={ruleFormByAsset[asset.id]?.intervalDays || ''}
                              onChange={(e) =>
                                setRuleFormByAsset((prev) => ({
                                  ...prev,
                                  [asset.id]: { ...prev[asset.id], intervalDays: e.target.value },
                                }))
                              }
                            />
                          </div>
                          <div>
                            <label className="label">{t('inventory.nextDue', 'Next due')}</label>
                            <input
                              className="input"
                              type="datetime-local"
                              value={ruleFormByAsset[asset.id]?.nextDueAt || ''}
                              onChange={(e) =>
                                setRuleFormByAsset((prev) => ({
                                  ...prev,
                                  [asset.id]: { ...prev[asset.id], nextDueAt: e.target.value },
                                }))
                              }
                            />
                          </div>
                        </div>
                        <div>
                          <label className="label">{t('inventory.ruleTags', 'Tags')}</label>
                          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                            {TAGS.map((tag) => (
                              <label key={tag} className="row" style={{ gap: 6, alignItems: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={ruleFormByAsset[asset.id]?.tags?.includes(tag) || false}
                                  onChange={() => toggleTag(asset.id, tag)}
                                />
                                <span>{tag}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => handleCreateRule(asset.id)}
                          disabled={saving}
                        >
                          {saving ? t('inventory.saving', 'Saving…') : t('inventory.createRule', 'Create rule')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3>{t('inventory.newAsset', 'New asset')}</h3>
        <form className="stack" style={{ gap: 12, marginTop: 12 }} onSubmit={handleCreateAsset}>
          <div>
            <label className="label">{t('inventory.assetName', 'Asset name')}</label>
            <input
              className="input"
              value={assetForm.name}
              onChange={(e) => setAssetForm((s) => ({ ...s, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('inventory.assetDescription', 'Description')}</label>
            <textarea
              className="input"
              style={{ minHeight: 70 }}
              value={assetForm.description}
              onChange={(e) => setAssetForm((s) => ({ ...s, description: e.target.value }))}
            />
          </div>
          <button className="btn" type="submit" disabled={saving || !assetForm.name.trim()}>
            {saving ? t('inventory.saving', 'Saving…') : t('inventory.createAsset', 'Create asset')}
          </button>
        </form>
      </div>
    </div>
  )
}
