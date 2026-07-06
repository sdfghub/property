import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'

const FLAGS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'cenzor', label: 'Cenzor', hint: 'Rol cenzor + semnătură închidere' },
  { key: 'committee', label: 'Comitet executiv', hint: 'Rol comitet + decizii/vot' },
  { key: 'funds', label: 'Fonduri', hint: 'Fonduri de rezervă/reparații' },
  { key: 'penalties', label: 'Penalizări', hint: 'Penalizări de întârziere' },
  { key: 'meters', label: 'Contoare', hint: 'Citiri contoare / repartizare pe consum' },
  { key: 'announcements', label: 'Anunțuri' },
  { key: 'polls', label: 'Sondaje' },
  { key: 'events', label: 'Evenimente' },
  { key: 'inventory', label: 'Inventar' },
  { key: 'notifications', label: 'Notificări' },
  { key: 'tickets', label: 'Sarcini & incidente' },
]

export function FeatureToggles({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [flags, setFlags] = React.useState<Record<string, boolean> | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setFlags(null)
    api.get<Record<string, boolean>>(`/communities/${communityId}/features`)
      .then((f: Record<string, boolean>) => setFlags(f))
      .catch(() => setFlags(null))
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
          {FLAGS.map((f) => {
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
