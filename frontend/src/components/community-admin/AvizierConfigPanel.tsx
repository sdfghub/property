import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// #8/#16 Avizier configurator — per-community display config persisted under Community.features.avizierConfig
// (GET/PATCH /finance/avizier-config). Controls the INFO columns, the default view, the fund-group
// labels, per-fund super-group membership, and the display order of groups and funds (drag to reorder,
// drag a fund chip into another group's card to regroup it). The avizier applies all of this server-side.
type Config = {
  info: { cpi: boolean; residents: boolean; consumption: boolean }
  defaultView: 'fond' | 'fondStare' | 'stare'
  fundGroupOverrides: Record<string, string>
  fundGroupLabels: Record<string, string>
  groupOrder: string[]
  fundOrder: string[]
}
type FundCtx = { code: string; name?: string; defaultGroup: string }
type SuperGroupMeta = { key: string; label: string; hint?: string; sortOrder: number }

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="track" />
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  )
}

export function AvizierConfigPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [cfg, setCfg] = React.useState<Config | null>(null)
  const [funds, setFunds] = React.useState<FundCtx[]>([])
  const [superGroups, setSuperGroups] = React.useState<SuperGroupMeta[]>([])
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    Promise.all([
      api.get<Config>(`/communities/${communityId}/finance/avizier-config`),
      api.get<{ funds: FundCtx[]; superGroups: SuperGroupMeta[] }>(`/communities/${communityId}/finance/avizier-config/context`),
    ]).then(([c, ctx]: [Config, { funds: FundCtx[]; superGroups: SuperGroupMeta[] }]) => {
      const allGroupKeys: string[] = ctx.superGroups.map((g: SuperGroupMeta) => g.key)
      const allFundCodes: string[] = ctx.funds.map((f: FundCtx) => f.code)
      setCfg({
        ...c,
        groupOrder: [...c.groupOrder.filter((k: string) => allGroupKeys.includes(k)), ...allGroupKeys.filter((k: string) => !c.groupOrder.includes(k))],
        fundOrder: [...c.fundOrder.filter((k: string) => allFundCodes.includes(k)), ...allFundCodes.filter((k: string) => !c.fundOrder.includes(k))],
      })
      setFunds(ctx.funds)
      setSuperGroups(ctx.superGroups)
    }).catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  const fundByCode = React.useMemo(() => new Map(funds.map((f) => [f.code, f])), [funds])
  const groupByKey = React.useMemo(() => new Map(superGroups.map((g) => [g.key, g])), [superGroups])
  const effectiveGroupOf = (code: string) => cfg?.fundGroupOverrides[code] ?? fundByCode.get(code)?.defaultGroup ?? 'operational'

  const patch = (p: Partial<Config>) => setCfg((c) => (c ? { ...c, ...p } : c))
  const setInfo = (k: 'cpi' | 'residents' | 'consumption', v: boolean) => setCfg((c) => (c ? { ...c, info: { ...c.info, [k]: v } } : c))
  const setLabel = (k: string, v: string) => setCfg((c) => (c ? { ...c, fundGroupLabels: { ...c.fundGroupLabels, [k]: v } } : c))
  const reassignFund = (code: string, targetGroup: string) => setCfg((c) => {
    if (!c) return c
    const o = { ...c.fundGroupOverrides }
    if (targetGroup === fundByCode.get(code)?.defaultGroup) delete o[code]; else o[code] = targetGroup
    return { ...c, fundGroupOverrides: o }
  })

  // ── drag-to-reorder: super-group cards ──
  const [dragGroup, setDragGroup] = React.useState<string | null>(null)
  const [groupDropTarget, setGroupDropTarget] = React.useState<string | null>(null)
  const onGroupDragStart = (key: string) => (e: React.DragEvent) => { setDragGroup(key); e.dataTransfer.effectAllowed = 'move' }
  const onGroupDragOver = (key: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragGroup || dragGroup === key) return
    setGroupDropTarget(key)
    setCfg((c) => {
      if (!c) return c
      const from = c.groupOrder.indexOf(dragGroup)
      const to = c.groupOrder.indexOf(key)
      if (from < 0 || to < 0 || from === to) return c
      const next = c.groupOrder.slice()
      next.splice(from, 1)
      next.splice(to, 0, dragGroup)
      return { ...c, groupOrder: next }
    })
  }
  const onGroupDragEnd = () => { setDragGroup(null); setGroupDropTarget(null) }

  // ── drag-to-reorder / drag-to-regroup: fund chips ──
  const [dragFund, setDragFund] = React.useState<string | null>(null)
  const [fundDropZone, setFundDropZone] = React.useState<string | null>(null)
  const onFundDragStart = (code: string) => (e: React.DragEvent) => { setDragFund(code); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation() }
  const onFundDragOverChip = (code: string, groupKey: string) => (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (!dragFund || dragFund === code) return
    setFundDropZone(groupKey)
    setCfg((c) => {
      if (!c) return c
      const from = c.fundOrder.indexOf(dragFund)
      const to = c.fundOrder.indexOf(code)
      if (from < 0 || to < 0) return c
      const next = c.fundOrder.slice()
      next.splice(from, 1)
      next.splice(next.indexOf(code), 0, dragFund)
      return { ...c, fundOrder: next }
    })
    if (effectiveGroupOf(dragFund) !== groupKey) reassignFund(dragFund, groupKey)
  }
  const onGroupZoneDragOver = (groupKey: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragFund) return
    setFundDropZone(groupKey)
    if (effectiveGroupOf(dragFund) !== groupKey) {
      reassignFund(dragFund, groupKey)
      setCfg((c) => {
        if (!c) return c
        const next = c.fundOrder.filter((x) => x !== dragFund)
        next.push(dragFund)
        return { ...c, fundOrder: next }
      })
    }
  }
  const onFundDragEnd = () => { setDragFund(null); setFundDropZone(null) }

  async function save() {
    if (!cfg) return
    setBusy(true); setError(null); setMsg(null)
    try {
      const labels: Record<string, string> = {}
      for (const [k, v] of Object.entries(cfg.fundGroupLabels)) if (v && v.trim()) labels[k] = v.trim()
      const saved = await api.patch<Config>(`/communities/${communityId}/finance/avizier-config`, { ...cfg, fundGroupLabels: labels })
      setCfg((c) => (c ? { ...c, ...saved, groupOrder: c.groupOrder, fundOrder: c.fundOrder } : c))
      setMsg(t('common.save', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  if (error && !cfg) return <div className="card" style={{ marginTop: 12 }}><div className="badge negative">{error}</div></div>
  if (!cfg) return <div className="card" style={{ marginTop: 12 }}><div className="muted">{t('common.loading', 'Loading…')}</div></div>

  return (
    <div id="avizier-config" className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('avizierCfg.title', 'Configurare avizier')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        {t('avizierCfg.hint', 'Coloanele informative, vederea implicită, etichetele și gruparea fondurilor pe avizier.')}
      </div>
      {error && <div className="badge negative" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="stack" style={{ gap: 22 }}>
        <div className="stack" style={{ gap: 8 }}>
          <label className="label">{t('avizierCfg.info', 'Coloane informative')}</label>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <Switch checked={cfg.info.cpi} onChange={(v) => setInfo('cpi', v)} label={t('avizierCfg.cpi', 'CPI')} />
            <Switch checked={cfg.info.residents} onChange={(v) => setInfo('residents', v)} label={t('avizierCfg.residents', 'Persoane')} />
            <Switch checked={cfg.info.consumption} onChange={(v) => setInfo('consumption', v)} label={t('avizierCfg.consumption', 'Consum apă')} />
          </div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div>
            <label className="label">{t('avizierCfg.grouping', 'Grupare și ordine fonduri')}</label>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
              {t('avizierCfg.groupingHint', 'Trage un grup de sus în jos ca să-l reordonezi. Trage un fond într-un alt grup ca să-l muți acolo, sau în interiorul grupului ca să-l reordonezi.')}
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {cfg.groupOrder.map((gKey) => {
              const g = groupByKey.get(gKey)
              if (!g) return null
              const groupFunds = cfg.fundOrder.filter((code) => effectiveGroupOf(code) === gKey)
              const isDropTarget = groupDropTarget === gKey || fundDropZone === gKey
              return (
                <div
                  key={gKey}
                  className={`cfg-group-card${isDropTarget ? ' drag-over' : ''}`}
                  draggable
                  onDragStart={onGroupDragStart(gKey)}
                  onDragOver={onGroupDragOver(gKey)}
                  onDragEnd={onGroupDragEnd}
                >
                  <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <span className="cfg-group-handle" title={t('avizierCfg.dragToReorder', 'Trage pentru a reordona')}>⠿</span>
                    <input
                      className="input"
                      style={{ maxWidth: 260, fontWeight: 600, fontSize: 13.5 }}
                      placeholder={g.label}
                      value={cfg.fundGroupLabels[gKey] ?? ''}
                      onChange={(e) => setLabel(gKey, e.target.value)}
                    />
                    {g.hint && <span className="muted" style={{ fontSize: 11.5 }}>{g.hint}</span>}
                  </div>
                  <div
                    className={`fund-drop-zone row${fundDropZone === gKey && dragFund ? ' drag-over' : ''}`}
                    style={{ gap: 8, flexWrap: 'wrap', padding: 6 }}
                    onDragOver={onGroupZoneDragOver(gKey)}
                  >
                    {groupFunds.length ? groupFunds.map((code) => {
                      const f = fundByCode.get(code)
                      return (
                        <span
                          key={code}
                          className={`fund-chip${dragFund === code ? ' dragging' : ''}`}
                          draggable
                          onDragStart={onFundDragStart(code)}
                          onDragOver={onFundDragOverChip(code, gKey)}
                          onDragEnd={onFundDragEnd}
                          title={code}
                        >
                          <span className="grip">⠿</span>{f?.name || code}
                        </span>
                      )
                    }) : (
                      <span className="muted" style={{ fontSize: 11.5, padding: '4px 2px' }}>{t('avizierCfg.emptyGroup', 'Fără fonduri — trage unul aici')}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
          {msg && <span className="badge positive">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
