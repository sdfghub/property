import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

// #8 Avizier configurator — per-community display config persisted under Community.features.avizierConfig
// (GET/PATCH /finance/avizier-config). Controls the INFO columns, the default view, the fund-group
// labels, and per-fund super-group membership overrides. The avizier applies these server-side.
type Config = {
  info: { cpi: boolean; residents: boolean; consumption: boolean }
  defaultView: 'fond' | 'stare'
  fundGroupOverrides: Record<string, string>
  fundGroupLabels: Record<string, string>
}

export function AvizierConfigPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()
  const superGroups = (meta as any)?.avizierFundGroups as { key: string; label: string }[] | undefined

  const [cfg, setCfg] = React.useState<Config | null>(null)
  const [funds, setFunds] = React.useState<{ code: string; name?: string }[]>([])
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    api.get<Config>(`/communities/${communityId}/finance/avizier-config`).then((d: Config) => setCfg(d)).catch((e: any) => setError(e?.message || 'Failed'))
    api.get<any[]>(`/communities/${communityId}/funds`).then((rows: any[]) => setFunds((rows || []).map((f) => ({ code: f.code, name: f.name })))).catch(() => {})
  }, [api, communityId])

  const patch = (p: Partial<Config>) => setCfg((c) => (c ? { ...c, ...p } : c))
  const setInfo = (k: 'cpi' | 'residents' | 'consumption', v: boolean) => setCfg((c) => (c ? { ...c, info: { ...c.info, [k]: v } } : c))
  const setLabel = (k: string, v: string) => setCfg((c) => (c ? { ...c, fundGroupLabels: { ...c.fundGroupLabels, [k]: v } } : c))
  const setOverride = (fund: string, v: string) => setCfg((c) => {
    if (!c) return c
    const o = { ...c.fundGroupOverrides }
    if (v) o[fund] = v; else delete o[fund]
    return { ...c, fundGroupOverrides: o }
  })

  async function save() {
    if (!cfg) return
    setBusy(true); setError(null); setMsg(null)
    try {
      // drop empty label overrides so they fall back to defaults
      const labels: Record<string, string> = {}
      for (const [k, v] of Object.entries(cfg.fundGroupLabels)) if (v && v.trim()) labels[k] = v.trim()
      await api.patch(`/communities/${communityId}/finance/avizier-config`, { ...cfg, fundGroupLabels: labels })
      setMsg(t('common.save', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  if (error && !cfg) return <div className="card" style={{ marginTop: 12 }}><div className="badge negative">{error}</div></div>
  if (!cfg) return <div className="card" style={{ marginTop: 12 }}><div className="muted">{t('common.loading', 'Loading…')}</div></div>

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('avizierCfg.title', 'Configurare avizier')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('avizierCfg.hint', 'Coloanele informative, vederea implicită, etichetele și gruparea fondurilor pe avizier.')}
      </div>
      {error && <div className="badge negative">{error}</div>}

      <div className="stack" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 4 }}>
          <label className="label">{t('avizierCfg.info', 'Coloane informative')}</label>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}><input type="checkbox" checked={cfg.info.cpi} onChange={(e) => setInfo('cpi', e.target.checked)} /> {t('avizierCfg.cpi', 'CPI')}</label>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}><input type="checkbox" checked={cfg.info.residents} onChange={(e) => setInfo('residents', e.target.checked)} /> {t('avizierCfg.residents', 'Persoane')}</label>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}><input type="checkbox" checked={cfg.info.consumption} onChange={(e) => setInfo('consumption', e.target.checked)} /> {t('avizierCfg.consumption', 'Consum apă')}</label>
          </div>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <label className="label">{t('avizierCfg.defaultView', 'Vedere implicită')}</label>
          <select className="input" style={{ width: 220 }} value={cfg.defaultView} onChange={(e) => patch({ defaultView: e.target.value as any })}>
            <option value="fond">{t('avizier.viewFond', 'Per fond')}</option>
            <option value="stare">{t('avizier.viewStare', 'Per stare (curent/restant)')}</option>
          </select>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <label className="label">{t('avizierCfg.labels', 'Etichete grupuri de fonduri')}</label>
          {(superGroups ?? []).map((sg) => (
            <div key={sg.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="muted" style={{ width: 140, fontSize: 12 }}>{sg.key}</span>
              <input className="input" style={{ minWidth: 220 }} placeholder={sg.label} value={cfg.fundGroupLabels[sg.key] ?? ''} onChange={(e) => setLabel(sg.key, e.target.value)} />
            </div>
          ))}
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <label className="label">{t('avizierCfg.overrides', 'Grupare fonduri (excepții)')}</label>
          <span className="muted" style={{ fontSize: 11 }}>{t('avizierCfg.overridesHint', 'Implicit gruparea urmează domeniul fondului; aici o poți forța per fond.')}</span>
          {funds.map((f) => (
            <div key={f.code} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ width: 160, fontSize: 13 }}>{f.name || f.code} <span className="muted" style={{ fontSize: 11 }}>({f.code})</span></span>
              <select className="input" value={cfg.fundGroupOverrides[f.code] ?? ''} onChange={(e) => setOverride(f.code, e.target.value)}>
                <option value="">{t('avizierCfg.auto', 'Automat')}</option>
                {(superGroups ?? []).map((sg) => <option key={sg.key} value={sg.key}>{sg.label}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
          {msg && <span className="badge positive">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
