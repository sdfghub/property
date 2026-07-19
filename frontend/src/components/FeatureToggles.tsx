import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'

// The feature catalog (codes + labels/hints) comes from the backend registry.
type FeatureMeta = { key: string; label: string; hint?: string }

export function FeatureToggles({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [flags, setFlags] = React.useState<Record<string, boolean> | null>(null)
  const [catalog, setCatalog] = React.useState<FeatureMeta[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setFlags(null)
    api.get<Record<string, boolean>>(`/communities/${communityId}/features`)
      .then((f: Record<string, boolean>) => setFlags(f))
      .catch(() => setFlags(null))
    api.get<FeatureMeta[]>(`/communities/${communityId}/features/registry`)
      .then((r: FeatureMeta[]) => setCatalog(r || []))
      .catch(() => setCatalog([]))
  }, [api, communityId])

  async function toggle(key: string) {
    if (!flags) return
    const next = !flags[key]
    setBusy(key); setError(null)
    try {
      const res = await api.post<Record<string, boolean>>(`/communities/${communityId}/features`, { [key]: next })
      setFlags(res)
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('features.title', 'Funcționalități active')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('features.hint', 'Activează/dezactivează module pentru această asociație.')}
      </div>
      {error && <div className="badge negative">{error}</div>}
      {!flags ? <div className="empty">{t('common.loading', 'Loading…')}</div> : (
        <div className="stack" style={{ gap: 2 }}>
          {catalog.map((f) => {
            const on = flags[f.key] !== false
            return (
              <label key={f.key} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', borderTop: '1px solid var(--border,#eee)', cursor: 'pointer' }}>
                <div className="stack" style={{ gap: 0 }}>
                  <span>{t(`features.flag.${f.key}`, f.label)}</span>
                  {f.hint ? <span className="muted" style={{ fontSize: 11 }}>{f.hint}</span> : null}
                </div>
                <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${on ? 'positive' : 'secondary'}`}>{on ? t('features.on', 'Activ') : t('features.off', 'Inactiv')}</span>
                  <input type="checkbox" checked={on} disabled={busy === f.key} onChange={() => toggle(f.key)} />
                </span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
