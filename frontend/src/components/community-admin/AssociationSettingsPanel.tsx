import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// #11 Configurare Asociație — the association's general settings (name, timezone, penalty grace days),
// over GET/PATCH /communities/:id/settings. Modeled on PaymentAllocationPanel. `code` is read-only.
// Note: penaltyGraceDays is the same Community scalar the period-settings panel also edits.
type Settings = { code: string; name: string; timezone: string; penaltyGraceDays: number }

export function AssociationSettingsPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [s, setS] = React.useState<Settings | null>(null)
  const [name, setName] = React.useState('')
  const [timezone, setTimezone] = React.useState('')
  const [graceDays, setGraceDays] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setS(null); setMsg(null); setError(null)
    api.get<Settings>(`/communities/${communityId}/settings`)
      .then((d: Settings) => {
        setS(d)
        setName(d.name ?? '')
        setTimezone(d.timezone ?? '')
        setGraceDays(String(d.penaltyGraceDays ?? ''))
      })
      .catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  async function save() {
    setBusy(true); setMsg(null); setError(null)
    try {
      const res = await api.patch<Settings>(`/communities/${communityId}/settings`, {
        name: name.trim(),
        timezone: timezone.trim(),
        penaltyGraceDays: graceDays === '' ? undefined : Number(graceDays),
      })
      setS(res)
      setMsg(t('common.save', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('assoc.title', 'Setări asociație')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('assoc.hint', 'Denumirea asociației, fusul orar și zilele de grație pentru penalizări.')}
      </div>
      {error && <div className="badge negative">{error}</div>}
      {!s ? <div className="empty">{t('common.loading', 'Loading…')}</div> : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>{t('assoc.code', 'Cod')}: <strong>{s.code}</strong></div>
          <div className="stack" style={{ gap: 2 }}>
            <label className="label">{t('assoc.name', 'Denumire asociație')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 320 }} />
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}>
              <label className="label">{t('assoc.timezone', 'Fus orar')}</label>
              <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: 220 }} />
              <span className="muted" style={{ fontSize: 11 }}>{t('assoc.timezoneHint', 'ex. Europe/Bucharest')}</span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <label className="label">{t('assoc.grace', 'Zile de grație')}</label>
              <input className="input" type="number" min={0} max={365} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} style={{ width: 120 }} />
              <span className="muted" style={{ fontSize: 11 }}>{t('assoc.graceHint', 'valabil pentru toată asociația')}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
            {msg && <span className="badge positive">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
