import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// A service's equipment inside the units (e.g. Interfon → "Interfon (interior)": Audio / Video).
// The kinds and their variants come from the service (`equipmentDefs`); each unit picks its variant.
type Payload = {
  defs: Array<{ name: string; variants: string[] }>
  units: Array<{ id: string; label: string; equipment: Record<string, string> }>
}

export function ServiceEquipmentPanel({ communityId, serviceId, readOnly }: { communityId: string; serviceId: string; readOnly?: boolean }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [data, setData] = React.useState<Payload | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    setData(null)
    api.get<Payload>(`/communities/${communityId}/services/${serviceId}/equipment`).then(setData).catch((e: any) => setErr(e?.message ?? String(e)))
  }, [api, communityId, serviceId])

  if (!data) return err ? <div className="badge negative">{err}</div> : null
  if (!data.defs.length) return <div className="muted" style={{ fontSize: 12 }}>{t('equipment.none', 'Serviciul nu are echipamente definite.')}</div>

  const save = async (unitId: string, name: string, variant: string) => {
    setBusy(`${unitId}:${name}`)
    setErr(null)
    try {
      await api.patch(`/communities/${communityId}/services/${serviceId}/equipment`, variant === '\u0000' ? { unitId, name, remove: true } : { unitId, name, variant })
      setData((d) => d && {
        ...d,
        units: d.units.map((u) => {
          if (u.id !== unitId) return u
          const equipment = { ...u.equipment }
          if (variant === '\u0000') delete equipment[name]
          else equipment[name] = variant
          return { ...u, equipment }
        }),
      })
    } catch (e: any) {
      setErr(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <label className="label">{t('equipment.heading', 'Echipamente în unități')}</label>
      {err && <div className="badge negative">{err}</div>}
      {data.defs.map((def) => {
        const count = (v: string) => data.units.filter((u) => u.equipment[def.name] === v).length
        return (
          <div key={def.name} className="stack" style={{ gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 13 }}>
              <strong>{def.name}</strong>
              <span className="muted"> · {t('equipment.summary', { n: data.units.filter((u) => def.name in u.equipment).length })}
                {def.variants.map((v) => ` · ${v}: ${count(v)}`).join('')}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
              {data.units.map((u) => {
                const has = def.name in u.equipment
                return (
                  <label key={u.id} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 13, opacity: has ? 1 : 0.6 }}>
                    <span style={{ minWidth: 90 }}>{u.label}</span>
                    <select className="input" style={{ fontSize: 12, padding: '2px 4px', flex: 1 }} disabled={readOnly || busy === `${u.id}:${def.name}`}
                      value={has ? u.equipment[def.name] : '\u0000'} onChange={(e) => save(u.id, def.name, e.target.value)}
                      aria-label={`${def.name} – ${u.label}`}>
                      <option value={'\u0000'}>{t('equipment.notSet', '—')}</option>
                      {def.variants.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
