import React from 'react'
import { useAuth } from '../../hooks/useAuth'

// Resident self-service: enter readings for your own unit's meters (the open period only).
// Uses GET/POST /me/communities/:id/periods/:code/meters — ownership enforced server-side.
type MyMeter = {
  meterId: string
  name?: string | null
  unitCode?: string | null
  typeCode?: string | null
  mode?: 'INDEX' | 'CONSUMPTION'
  value?: number | null
  reading?: number | null
  previousReading?: number | null
  selfReported?: boolean
}

export function MyMeterReadings({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const [period, setPeriod] = React.useState<{ code: string; status?: string; editable?: boolean } | null>(null)
  const [meters, setMeters] = React.useState<MyMeter[]>([])
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  const load = React.useCallback(() => {
    if (!communityId) return
    api.get<any[]>(`/communities/${communityId}/periods/open`)
      .then((rows: any[]) => {
        const code = Array.isArray(rows) && rows.length ? rows[0].code : null
        if (!code) { setPeriod(null); setMeters([]); setLoaded(true); return }
        return api.get<any>(`/me/communities/${communityId}/periods/${code}/meters`).then((r: any) => {
          setPeriod(r?.period ?? { code })
          const ms: MyMeter[] = r?.meters || []
          setMeters(ms)
          setValues(Object.fromEntries(ms.map((m) => [
            m.meterId,
            m.reading != null ? String(m.reading) : (m.mode !== 'INDEX' && m.value != null ? String(m.value) : ''),
          ])))
          setLoaded(true)
        })
      })
      .catch((e: any) => { setMsg(e?.message || 'Eroare'); setLoaded(true) })
  }, [api, communityId])

  React.useEffect(() => { load() }, [load])

  async function save(m: MyMeter) {
    const v = values[m.meterId]
    if (v === undefined || v === null || v === '') return
    setBusy(m.meterId); setMsg(null)
    try {
      await api.post(`/me/communities/${communityId}/periods/${period!.code}/meters`, { meterId: m.meterId, value: Number(v) })
      setMsg('Citire salvată')
      load()
    } catch (e: any) { setMsg(e?.message || 'Eroare la salvare') } finally { setBusy(null) }
  }

  // Nothing to show if the resident has no meters.
  if (loaded && !meters.length) return null

  const editable = period?.editable !== false

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>Citirile mele de contoare</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {period ? `Perioada curentă: ${period.code}` : 'Nicio perioadă deschisă pentru citiri.'}
      </div>
      {msg && <div className="badge">{msg}</div>}
      <div className="stack" style={{ gap: 8 }}>
        {meters.map((m) => {
          const isIndex = m.mode === 'INDEX'
          const entered = Number(values[m.meterId])
          const consumption = isIndex && !Number.isNaN(entered)
            ? (m.previousReading != null ? Math.max(0, entered - m.previousReading) : entered)
            : null
          return (
            <div key={m.meterId} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
              <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ minWidth: 200 }}>
                  {m.name || m.meterId}
                  <span className="muted" style={{ marginLeft: 6 }}>· {isIndex ? 'index (citire)' : 'consum'}</span>
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.001"
                  value={values[m.meterId] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [m.meterId]: e.target.value }))}
                  placeholder={isIndex ? 'citire contor' : '0.00'}
                  style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
                  disabled={!editable || busy === m.meterId}
                />
                <button className="btn small" type="button" disabled={!editable || busy === m.meterId} onClick={() => save(m)}>
                  {busy === m.meterId ? 'Salvez…' : 'Salvează'}
                </button>
              </div>
              {isIndex && (
                <div className="muted" style={{ fontSize: 12, paddingLeft: 4 }}>
                  {m.previousReading != null ? `citire anterioară: ${m.previousReading} → ` : 'prima citire → '}
                  consum: <strong>{consumption != null ? Number(consumption.toFixed(3)) : '—'}</strong>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
