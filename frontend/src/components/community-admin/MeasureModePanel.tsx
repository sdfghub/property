import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

type MeterType = { code: string; name?: string | null; unit?: string | null; mode: 'INDEX' | 'CONSUMPTION' }

export function MeasureModePanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  const meterModes = meta?.meterModes ?? []
  const [types, setTypes] = React.useState<MeterType[] | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setTypes(null); setError(null)
    api.get<{ types: MeterType[] }>(`/communities/${communityId}/measure-modes`)
      .then((r: { types: MeterType[] }) => setTypes(r.types || []))
      .catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  async function setMode(code: string, mode: 'INDEX' | 'CONSUMPTION') {
    setBusy(code); setError(null)
    try {
      await api.post(`/communities/${communityId}/measure-modes`, { [code]: mode })
      setTypes((prev) => (prev || []).map((tp) => (tp.code === code ? { ...tp, mode } : tp)))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(null) }
  }

  if (!communityId) return null

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('meterMode.title', 'Mod citire contoare')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('meterMode.hint', 'Pentru fiecare tip de contor: „Index" = se introduce citirea contorului (consum = citire − citire anterioară); „Consum" = se introduce direct consumul.')}
      </div>
      {error && <div className="badge negative">{error}</div>}
      {!types ? <div className="empty">{t('common.loading', 'Loading…')}</div> : types.length === 0 ? (
        <div className="muted">{t('meterMode.none', 'Comunitatea nu are contoare.')}</div>
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          {types.map((tp) => (
            <div key={tp.code} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 0', borderTop: '1px solid var(--border,#eee)' }}>
              <div className="stack" style={{ gap: 0 }}>
                <span>{tp.name || tp.code} <span className="muted">({tp.code}{tp.unit ? ` · ${tp.unit}` : ''})</span></span>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {meterModes.map((m) => (
                  <button key={m.key} type="button" disabled={busy === tp.code}
                    className={`btn small ${tp.mode === m.key ? 'primary' : 'ghost'}`}
                    onClick={() => setMode(tp.code, m.key as 'INDEX' | 'CONSUMPTION')}>
                    {t(`meterMode.${m.key.toLowerCase()}`, m.label)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
