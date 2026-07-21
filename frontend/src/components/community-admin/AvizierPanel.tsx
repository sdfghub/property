import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { PenaltyOverrideModal } from './PenaltyOverrideModal'
import { beLabel } from './beLabel'

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Column labels come from the backend (avizier.categoryLabels — expense-type/fund names + APA_DIF);
// the frontend no longer hardcodes any code→label knowledge and falls back to the raw code.

// Numeric-column headers wrap (multi-word labels stack) so columns shrink to the small numbers below.
const TH_WRAP: React.CSSProperties = { whiteSpace: 'normal', verticalAlign: 'bottom', maxWidth: 80 }

export function AvizierPanel({ communityId, cenzorEnabled = true }: { communityId: string; cenzorEnabled?: boolean }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState<string>('')
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [signBusy, setSignBusy] = React.useState<string | null>(null)
  const [signMsg, setSignMsg] = React.useState<string | null>(null)

  const isCensor = activeRole?.role === 'CENSOR' && cenzorEnabled
  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN'
  const [hoverBe, setHoverBe] = React.useState<string | null>(null)
  const [editBe, setEditBe] = React.useState<{ be: string; value: string } | null>(null)
  const saveDisplayName = async () => {
    if (!editBe) return
    try {
      await api.patch(`/communities/${communityId}/billing-entities/${encodeURIComponent(editBe.be)}/display-name`, { displayName: editBe.value })
      setEditBe(null); reloadAvizier()
    } catch { setEditBe(null) }
  }
  const reloadAvizier = () => {
    const q = period ? `?period=${encodeURIComponent(period)}` : ''
    api.get<any>(`/communities/${communityId}/finance/avizier${q}`).then((d: any) => setData(d)).catch(() => {})
  }
  const signOff = async (action: 'approve' | 'reject') => {
    if (!data?.period?.code) return
    setSignBusy(action); setSignMsg(null)
    try {
      await api.post(`/communities/${communityId}/periods/${data.period.code}/${action}`, {})
      setSignMsg(action === 'approve' ? t('avizier.approved', 'Perioadă aprobată.') : t('avizier.rejected', 'Perioadă respinsă.'))
      reloadAvizier()
    } catch (e: any) {
      setSignMsg(e?.message || t('common.error', 'Eroare'))
    } finally { setSignBusy(null) }
  }
  const [explain, setExplain] = React.useState<{ be: string; cat: string; data: any } | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const toggleGroup = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const [soldDetail, setSoldDetail] = React.useState<{ be: string; data: any } | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [showInfo, setShowInfo] = React.useState(true) // #7 INFO columns (CPI / persoane / consum apă)
  const [publicMode, setPublicMode] = React.useState(false) // #10 GDPR: hide owner names (posted/exported view)
  const [viewMode, setViewMode] = React.useState<'fond' | 'stare' | 'risc'>('fond') // #5/#14 avizier views

  const openSold = (beCode: string) => {
    setSoldDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/explain-sold?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d) => setSoldDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setSoldDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [payDetail, setPayDetail] = React.useState<{ be: string; data: any } | null>(null)
  const openPayments = (beCode: string) => {
    setPayDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/payments?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d: any) => setPayDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setPayDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [adjDetail, setAdjDetail] = React.useState<{ be: string; data: any } | null>(null)
  const openAdjustments = (beCode: string) => {
    setAdjDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/adjustments?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d: any) => setAdjDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setAdjDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const openExplain = (beCode: string, category: string) => {
    setExplain({ be: beCode, cat: category, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/explain?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}&category=${encodeURIComponent(category)}`)
      .then((d) => setExplain((cur) => (cur && cur.be === beCode && cur.cat === category ? { ...cur, data: d } : cur)))
      .catch(() => setExplain((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [penDetail, setPenDetail] = React.useState<{ be: string; scope: 'month' | 'total'; fund?: string; data: any } | null>(null)
  const [penExpanded, setPenExpanded] = React.useState<Set<number>>(new Set())
  const togglePenBucket = (i: number) => setPenExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const openPenalty = (beCode: string, scope: 'month' | 'total', fund?: string) => {
    setPenExpanded(new Set())
    setPenDetail({ be: beCode, scope, fund, data: null })
    const fq = fund ? `&fund=${encodeURIComponent(fund)}` : ''
    api.get<any>(`/communities/${communityId}/finance/avizier/explain-penalty?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}${fq}`)
      .then((d) => setPenDetail((cur) => (cur && cur.be === beCode && cur.fund === fund ? { ...cur, data: d } : cur)))
      .catch(() => setPenDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  // Admin manual penalty override — modal extracted to PenaltyOverrideModal (shared with the wizard list).
  const [ovrTarget, setOvrTarget] = React.useState<{ be: string; beName?: string; computed: number } | null>(null)

  // Cell click router: penalty columns go to the rich per-bucket drilldown (per fund for a `PEN:<fund>`
  // category, all funds for the aggregate PENALIZARI); every other category keeps the generic per-unit
  // formula.
  const openCell = (beCode: string, category: string) =>
    category.startsWith('PEN:') ? openPenalty(beCode, 'month', category.slice(4))
      : category === 'PENALIZARI' ? openPenalty(beCode, 'month')
        : openExplain(beCode, category)

  // Escape exits fullscreen — but only when no drilldown modal is open (let those dismiss first).
  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !explain && !soldDetail && !penDetail) setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, explain, soldDetail, penDetail])

  React.useEffect(() => {
    if (!communityId) return
    api.get<any[]>(`/communities/${communityId}/periods`).then((rows) => {
      const sorted = (rows || []).slice().sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
      setPeriods(sorted)
      // default to the newest period (the one being closed), not the latest CLOSED one
      if (sorted.length) setPeriod((cur) => cur || sorted[0].code)
      else setLoading(false)
    }).catch(() => { setPeriods([]); setLoading(false) })
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId || !period) return
    let alive = true
    setLoading(true)
    api.get<any>(`/communities/${communityId}/finance/avizier?period=${encodeURIComponent(period)}`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period])

  // #8: apply the community's default view once (first time config arrives); user toggles then stick.
  const viewInit = React.useRef(false)
  React.useEffect(() => {
    if (!viewInit.current && data?.config?.defaultView) { setViewMode(data.config.defaultView); viewInit.current = true }
  }, [data])

  const cats: string[] = data?.categories ?? []
  const rows: any[] = data?.rows ?? []
  const totals = data?.totals
  const hasAdj = Math.abs(Number(totals?.adjustments ?? 0)) > 0.005

  // Group category columns under their owning fund; each group is a collapsible total column.
  // `superGroup` is the coarse avizier bucket (#2: Întreținere / Fond Operațional / Fond Reabilitare)
  // the backend assigns each fund group, used to band the columns under a spanning header row.
  type SuperGroup = { key: string; label: string }
  type Group = { key: string; label: string; superGroup?: SuperGroup; categories: string[] }
  const groups: Group[] =
    data?.groups ?? cats.map((c) => ({ key: c, label: catLabel(c), categories: [c] }))
  const penaltyFunds: string[] = data?.penaltyFunds ?? []
  const canOverride = isAdmin && data?.period?.status === 'PREPARED'
  // Column labels are supplied by the backend; fall back to the raw code.
  const catLabels: Record<string, string> = (data as any)?.categoryLabels ?? {}
  const catLabel = (c: string) => (c.startsWith('PEN:') ? `Penaliz. ${catLabels[c.slice(4)] ?? c.slice(4)}` : (catLabels[c] ?? c))
  type Col =
    | { kind: 'cat'; cat: string; sg?: SuperGroup }
    | { kind: 'total'; group: Group; sg?: SuperGroup }
    | { kind: 'pen'; fund: string; scope: 'month' | 'total'; sg?: SuperGroup }
  const cols: Col[] = []
  for (const g of groups) {
    const sg = g.superGroup
    const isMulti = g.categories.length > 1
    if (isMulti && expanded.has(g.key)) {
      g.categories.forEach((c) => cols.push({ kind: 'cat', cat: c, sg }))
      cols.push({ kind: 'total', group: g, sg })
    } else {
      cols.push({ kind: 'total', group: g, sg })
    }
    // a fund's penalties (this month + cumulative) sit immediately to the right of the fund's column
    if (penaltyFunds.includes(g.key)) {
      cols.push({ kind: 'pen', fund: g.key, scope: 'month', sg })
      cols.push({ kind: 'pen', fund: g.key, scope: 'total', sg })
    }
  }
  // #2: contiguous runs of columns sharing a super-group, for the spanning header band.
  const sgRuns: { key: string; label: string; span: number }[] = []
  for (const col of cols) {
    const key = col.sg?.key ?? '_'
    const label = col.sg?.label ?? ''
    const last = sgRuns[sgRuns.length - 1]
    if (last && last.key === key) last.span++
    else sgRuns.push({ key, label, span: 1 })
  }
  const hasSuperGroups = cols.some((c) => c.sg?.label) && new Set(cols.map((c) => c.sg?.key ?? '_')).size > 1
  // #5/#14 views: "Per fond" shows the full fund/service breakdown; "Per stare" collapses it to just
  // Restanțe (arrears) vs Curente (this month) — the fund columns and super-group band drop out, the
  // Restanțe / Total lună / Încasări / Total de plată columns stay. "Per risc" is deferred (Phase 4, #13).
  const detailed = viewMode === 'fond'
  const midCols = detailed ? cols : []
  const showSuperGroups = hasSuperGroups && detailed
  // #8 configurator: which INFO columns the community enabled, and how many are visible now.
  const infoCfg = (data?.config?.info ?? { cpi: true, residents: true, consumption: true }) as { cpi: boolean; residents: boolean; consumption: boolean }
  const infoVis = { cpi: showInfo && infoCfg.cpi !== false, residents: showInfo && infoCfg.residents !== false, consumption: showInfo && infoCfg.consumption !== false }
  const infoCount = (infoVis.cpi ? 1 : 0) + (infoVis.residents ? 1 : 0) + (infoVis.consumption ? 1 : 0)
  const sumCats = (charges: Record<string, number>, keys: string[]) => keys.reduce((s, c) => s + (Number(charges?.[c]) || 0), 0)

  return (
    <div
      className="stack"
      style={fullscreen
        ? { gap: 12, position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg, #fff)', padding: 16, overflow: 'auto' }
        : { gap: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>
          {t('avizier.title', 'Avizier')} — {t('avizier.list', 'listă de întreținere')}
          {data?.period?.status ? <span className={`badge ${data.period.status === 'CLOSED' ? 'secondary' : 'tertiary'}`} style={{ marginLeft: 8 }}>{data.period.status}</span> : null}
        </h4>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {data?.period?.afisareDate ? <span className="muted">{t('avizier.afisare', 'Data afișare')}: {new Date(data.period.afisareDate).toLocaleDateString('ro-RO')}</span> : null}
          {data?.period?.dueDate ? <span className="muted">{t('avizier.due', 'Scadență')}: {new Date(data.period.dueDate).toLocaleDateString('ro-RO')}</span> : null}
          <select className="input" value={viewMode} onChange={(e) => setViewMode(e.target.value as any)} title={t('avizier.viewTitle', 'Mod de afișare')}>
            <option value="fond">{t('avizier.viewFond', 'Per fond')}</option>
            <option value="stare">{t('avizier.viewStare', 'Per stare (curent/restant)')}</option>
            <option value="risc" disabled>{t('avizier.viewRisc', 'Per risc (în curând)')}</option>
          </select>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowInfo((v) => !v)}
            title={t('avizier.infoToggle', 'Arată/ascunde coloanele informative (CPI, persoane, consum apă)')}
            aria-pressed={showInfo}
          >
            {showInfo ? '☑ ' : '☐ '}{t('avizier.info', 'Info')}
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setPublicMode((v) => !v)}
            title={t('avizier.publicToggle', 'Mod public: ascunde numele proprietarilor (GDPR) pentru afișare/print')}
            aria-pressed={publicMode}
          >
            {publicMode ? '🙈 ' : '👁 '}{publicMode ? t('avizier.publicOn', 'Public') : t('avizier.publicOff', 'Nume')}
          </button>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
          </select>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet (Esc)') : t('avizier.fullscreen', 'Ecran complet')}
            aria-label={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet') : t('avizier.fullscreen', 'Ecran complet')}
          >
            {fullscreen ? '🗗 ' + t('avizier.exit', 'Închide') : '⛶ ' + t('avizier.fullscreen', 'Ecran complet')}
          </button>
        </div>
      </div>

      {isCensor && data?.period?.status === 'PREPARED' && (
        <div className="card soft row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div className="stack" style={{ gap: 2 }}>
            <strong>{t('avizier.signoffTitle', 'Semnătură cenzor')}</strong>
            <span className="muted" style={{ fontSize: 13 }}>{t('avizier.signoffHint', 'Verificați lista și aprobați sau respingeți închiderea perioadei.')}</span>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {signMsg && <span className="muted">{signMsg}</span>}
            <button className="btn primary small" type="button" disabled={!!signBusy} onClick={() => signOff('approve')}>
              {signBusy === 'approve' ? t('common.loading', '…') : t('avizier.approve', 'Aprobă închiderea')}
            </button>
            <button className="btn ghost small" type="button" disabled={!!signBusy} onClick={() => signOff('reject')}>
              {signBusy === 'reject' ? t('common.loading', '…') : t('avizier.reject', 'Respinge')}
            </button>
          </div>
        </div>
      )}

      {loading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !rows.length ? (
        <div className="empty">{t('avizier.none', 'No data for this period.')}</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              {showSuperGroups && (
                <tr style={{ background: 'var(--muted-bg, #f4f4f5)' }}>
                  <th style={{ position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }} colSpan={2 + infoCount} />
                  {sgRuns.map((run, i) => (
                    <th key={`sg${i}`} colSpan={run.span}
                      style={{ padding: '4px 10px', textAlign: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600, color: 'var(--muted, #666)', borderLeft: run.label ? '1px solid var(--border, #e5e5e5)' : 'none' }}>
                      {run.label}
                    </th>
                  ))}
                  <th colSpan={3 + (hasAdj ? 1 : 0)} />
                </tr>
              )}
              <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)', maxWidth: 190 }}>{t('avizier.entity', 'Apartament')}</th>
                {infoVis.cpi && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.cpiHint', 'Cotă-parte indiviză')}>{t('avizier.cpi', 'CPI')}</th>}
                {infoVis.residents && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.persHint', 'Număr persoane')}>{t('avizier.pers', 'Pers.')}</th>}
                {infoVis.consumption && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.apaHint', 'Consum apă (mc)')}>{t('avizier.apa', 'Apă (mc)')}</th>}
                <th style={{ ...TH_WRAP, padding: '8px 10px' }}>{t('avizier.soldPrec', 'Restanțe')}</th>
                {midCols.map((col, i) => {
                  if (col.kind === 'cat') return (
                    <th key={`c${i}`} style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 400, color: 'var(--muted, #666)' }}>{catLabel(col.cat)}</th>
                  )
                  if (col.kind === 'pen') return (
                    <th key={`p${i}`} style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}
                      title={`${col.scope === 'total' ? t('avizier.penTotalHint', 'Penalizări restante (rămase de plată, acumulate)') : t('avizier.penMonthHint', 'Penalizări curente (luna aceasta)')} — ${catLabels[col.fund] ?? col.fund}`}>
                      {col.scope === 'total' ? t('avizier.penTotalShort', 'Penaliz. restante') : t('avizier.penMonthShort', 'Penaliz. curente')}
                    </th>
                  )
                  return (
                    <th key={`t${i}`} style={{ ...TH_WRAP, padding: '8px 10px' }}>
                      {col.group.categories.length > 1 ? (
                        <button type="button" onClick={() => toggleGroup(col.group.key)} title={t('avizier.expand', 'Detaliază')}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 700 }}>
                          {expanded.has(col.group.key) ? '▾ ' : '▸ '}{col.group.label}
                        </button>
                      ) : col.group.label}
                    </th>
                  )
                })}
                <th style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 700 }}>{detailed ? t('avizier.curent', 'Total lună') : t('avizier.curente', 'Curente')}</th>
                <th style={{ ...TH_WRAP, padding: '8px 10px' }}>{t('avizier.incasari', 'Încasări')}</th>
                {hasAdj && <th style={{ ...TH_WRAP, padding: '8px 10px' }} title={t('avizier.adjustmentsHint', 'Corecții fără numerar (ex. scutire penalizări)')}>{t('avizier.adjustments', 'Ajustări')}</th>}
                <th style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 700 }}>{t('avizier.total', 'Total de plată')}</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {rows.map((r) => {
                const hov = hoverBe === r.beCode
                const rowBg = hov ? 'var(--hover-bg, #eef4ff)' : undefined
                return (
                <tr key={r.beCode} onMouseEnter={() => setHoverBe(r.beCode)} onMouseLeave={() => setHoverBe(null)}
                  style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right', background: rowBg }}>
                  <td style={{ textAlign: 'left', padding: '6px 10px', position: 'sticky', left: 0, background: hov ? 'var(--hover-bg, #eef4ff)' : 'var(--bg, #fff)',
                      maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    title={(() => { const l = beLabel(r, { publicMode }); return `${l.primary}${l.secondary ? ' · ' + l.secondary : ''}` })()}>
                    {editBe?.be === r.beCode ? (
                      <span className="row" style={{ gap: 4, alignItems: 'center' }}>
                        <input className="input" autoFocus value={editBe.value} placeholder={beLabel({ ...r, displayName: null }).primary}
                          onChange={(e) => setEditBe({ be: r.beCode, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setEditBe(null) }}
                          style={{ fontSize: 12, padding: '2px 4px', width: 150 }} />
                        <button type="button" className="btn ghost small" onClick={saveDisplayName} title={t('common.save', 'Salvează')}>✓</button>
                      </span>
                    ) : (() => {
                      const l = beLabel(r, { publicMode })
                      return (
                        <span>
                          <span style={{ fontWeight: 600 }}>{l.primary}</span>
                          {l.secondary ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{l.secondary}</span> : null}
                          {isAdmin && hov && !publicMode ? <button type="button" title={t('avizier.rename', 'Redenumește')}
                            onClick={() => setEditBe({ be: r.beCode, value: r.displayName || '' })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--link, #2563eb)', fontSize: 11, marginLeft: 6, padding: 0 }}>✎</button> : null}
                        </span>
                      )
                    })()}
                  </td>
                  {infoVis.cpi && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.cpi != null ? money(r.cpi) : ''}</td>}
                  {infoVis.residents && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.residents != null ? r.residents : ''}</td>}
                  {infoVis.consumption && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.consumption != null ? money(r.consumption) : ''}</td>}
                  <td style={{ padding: '6px 10px' }}>
                    {r.soldPrecedent ? (
                      <button type="button" onClick={() => openSold(r.beCode)} title={t('avizier.soldDetail', 'Din ce fonduri e compus?')}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                        {money(r.soldPrecedent)}
                      </button>
                    ) : ''}
                  </td>
                  {midCols.map((col, i) => {
                    if (col.kind === 'cat') {
                      const v = r.charges[col.cat]
                      return (
                        <td key={`c${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>
                          {v ? (
                            <button type="button" onClick={() => openCell(r.beCode, col.cat)} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          ) : ''}
                        </td>
                      )
                    }
                    if (col.kind === 'pen') {
                      const v = r.penaltyByFund?.[col.fund]?.[col.scope]
                      const editable = canOverride && col.scope === 'month'
                      return (
                        <td key={`p${i}`} style={{ padding: '6px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}>
                          {v ? (
                            <button type="button" onClick={() => openPenalty(r.beCode, col.scope, col.fund)} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          ) : ''}
                          {editable ? (
                            <button type="button" onClick={() => setOvrTarget({ be: r.beCode, beName: r.beName, computed: Number(v) || 0 })} title={t('avizier.override', 'Ajustează manual penalizarea')}
                              style={{ background: 'none', border: 'none', padding: '0 0 0 6px', cursor: 'pointer', color: 'var(--link, #2563eb)', fontSize: 12 }}>✎</button>
                          ) : null}
                        </td>
                      )
                    }
                    const single = col.group.categories.length === 1
                    const v = sumCats(r.charges, col.group.categories)
                    return (
                      <td key={`t${i}`} style={{ padding: '6px 10px', fontWeight: col.group.categories.length > 1 ? 700 : 400 }}>
                        {v ? (single ? (
                          <button type="button" onClick={() => openCell(r.beCode, col.group.categories[0])} title={t('avizier.explain', 'Cum s-a calculat?')}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                            {money(v)}
                          </button>
                        ) : money(v)) : ''}
                      </td>
                    )
                  })}
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{money(r.curentTotal)}</td>
                  <td style={{ padding: '6px 10px' }}>{r.payments ? (
                    <button type="button" onClick={() => openPayments(r.beCode)} title={t('avizier.paymentsLog', 'Jurnal încasări')}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--link, #2563eb)', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                      {money(r.payments)}
                    </button>
                  ) : ''}</td>
                  {hasAdj && <td style={{ padding: '6px 10px' }}>{r.adjustments ? (
                    <button type="button" onClick={() => openAdjustments(r.beCode)} title={t('avizier.adjustments', 'Ajustări')}
                      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--link, #2563eb)', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                      {money(r.adjustments)}
                    </button>
                  ) : ''}</td>}
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{money(r.totalDue)}</td>
                </tr>
                )
              })}
              {totals ? (
                <tr style={{ borderTop: '2px solid var(--border, #ccc)', textAlign: 'right', fontWeight: 700, background: 'var(--muted-bg, #f4f4f5)' }}>
                  <td style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }}>{t('avizier.totalRow', 'TOTAL')}</td>
                  {infoVis.cpi && <td style={{ padding: '8px 10px' }}>{totals.cpi != null ? money(totals.cpi) : ''}</td>}
                  {infoVis.residents && <td style={{ padding: '8px 10px' }}>{totals.residents != null ? totals.residents : ''}</td>}
                  {infoVis.consumption && <td style={{ padding: '8px 10px' }}>{totals.consumption != null ? money(totals.consumption) : ''}</td>}
                  <td style={{ padding: '8px 10px' }}>{money(totals.soldPrecedent)}</td>
                  {midCols.map((col, i) => col.kind === 'cat' ? (
                    <td key={`c${i}`} style={{ padding: '8px 10px', fontWeight: 400 }}>{money(totals.byCategory?.[col.cat])}</td>
                  ) : col.kind === 'pen' ? (
                    <td key={`p${i}`} style={{ padding: '8px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}>{money(totals.penaltyByFund?.[col.fund]?.[col.scope])}</td>
                  ) : (
                    <td key={`t${i}`} style={{ padding: '8px 10px' }}>{money(sumCats(totals.byCategory || {}, col.group.categories))}</td>
                  ))}
                  <td style={{ padding: '8px 10px' }}>{money(totals.curentTotal)}</td>
                  <td style={{ padding: '8px 10px' }}>{money(totals.payments)}</td>
                  {hasAdj && <td style={{ padding: '8px 10px' }}>{money(totals.adjustments)}</td>}
                  <td style={{ padding: '8px 10px' }}>{money(totals.totalDue)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {soldDetail && (
        <div onClick={() => setSoldDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, width: '90%', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{t('avizier.soldTitle', 'Restanțe — pe fonduri')}</h4>
              <button className="btn ghost small" onClick={() => setSoldDetail(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{soldDetail.data?.beName || soldDetail.be} · {data?.period?.code}</div>
            {!soldDetail.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : soldDetail.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : !(soldDetail.data.rows || []).length ? (
              <div className="empty">{t('avizier.soldNone', 'Fără restanțe.')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <tbody>
                  {(soldDetail.data.rows || []).map((r: any) => (
                    <tr key={r.fundCode} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '6px 8px' }}>{r.fundName}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border, #ccc)', fontWeight: 700 }}>
                    <td style={{ padding: '8px' }}>{t('avizier.total', 'Total')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {payDetail && (
        <div onClick={() => setPayDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, width: '92%', maxHeight: '82vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{t('avizier.paymentsTitle', 'Jurnal încasări — plăți proprietar')}</h4>
              <button className="btn ghost small" onClick={() => setPayDetail(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{payDetail.data?.beName || payDetail.be} · {data?.period?.code}</div>
            {!payDetail.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : payDetail.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : !(payDetail.data.rows || []).length ? (
              <div className="empty">{t('avizier.paymentsNone', 'Fără încasări înregistrate pentru această perioadă.')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted, #666)' }}>
                    <th style={{ padding: '4px 8px' }}>{t('avizier.payDate', 'Data')}</th>
                    <th style={{ padding: '4px 8px' }}>{t('avizier.payAccount', 'Cont')}</th>
                    <th style={{ padding: '4px 8px' }}>{t('avizier.payDetail', 'Detalii')}</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>{t('avizier.paySum', 'Sumă')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(payDetail.data.rows || []).map((r: any, i: number) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.date ? new Date(r.date).toLocaleDateString('ro-RO') : ''}</td>
                      <td style={{ padding: '6px 8px' }}>{r.account}{r.cycle === 'prior' ? <span className="badge warn" style={{ marginLeft: 4 }} title={t('avizier.payPrior', 'Achitare ciclu anterior')}>ant.</span> : null}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div>{r.memo || ''}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {r.ref ? `${r.ref} · ` : ''}{r.payer || ''}
                          {r.funds ? ' · ' + Object.entries(r.funds).map(([f, a]: any) => `${f}: ${money(a)}`).join(', ') : ''}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border, #ccc)', fontWeight: 700 }}>
                    <td colSpan={3} style={{ padding: '8px' }}>{t('avizier.total', 'Total')} ({(payDetail.data.rows || []).length})</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(payDetail.data.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {adjDetail && (
        <div onClick={() => setAdjDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, width: '90%', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{t('avizier.adjTitle', 'Ajustări — corecții fără numerar')}</h4>
              <button className="btn ghost small" onClick={() => setAdjDetail(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{adjDetail.data?.beName || adjDetail.be} · {data?.period?.code}</div>
            {!adjDetail.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : adjDetail.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : !(adjDetail.data.rows || []).length ? (
              <div className="empty">{t('avizier.adjNone', 'Fără ajustări.')}</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                <tbody>
                  {(adjDetail.data.rows || []).map((r: any) => (
                    <tr key={r.fundCode} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '6px 8px' }}>
                        {r.fundName}
                        {r.reason ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{r.reason === 'scutire-penalizari' ? t('avizier.adjForgive', 'scutire penalizări') : r.reason}</span> : null}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border, #ccc)', fontWeight: 700 }}>
                    <td style={{ padding: '8px' }}>{t('avizier.total', 'Total')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(adjDetail.data.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {ovrTarget && (
        <PenaltyOverrideModal communityId={communityId} period={data?.period?.code || period}
          be={ovrTarget.be} beName={ovrTarget.beName} computed={ovrTarget.computed}
          onClose={() => setOvrTarget(null)} onSaved={() => { setOvrTarget(null); reloadAvizier() }} />
      )}

      {explain && (
        <div onClick={() => setExplain(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, width: '90%', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{t('avizier.howCalc', 'Cum s-a calculat')}: {catLabels[explain.cat] ?? explain.cat}</h4>
              <button className="btn ghost small" onClick={() => setExplain(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{explain.data?.beName || explain.be} · {data?.period?.code}</div>
            {!explain.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : explain.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {(explain.data.parts || []).map((p: any, i: number) => (
                  <div key={i} className="card soft">
                    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <strong>{p.label}</strong>
                      <span className="badge secondary">{p.methodLabel}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                      {t('avizier.distributed', 'Total distribuit')}: {money(p.chargeTotal)}
                    </div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
                      {(p.lines || []).map((l: any, j: number) => (
                        <li key={j} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          <span className="muted">{l.unit}:</span> {l.formula}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="row" style={{ justifyContent: 'flex-end', fontWeight: 700 }}>
                  {t('avizier.total', 'Total')}: {money(explain.data.total)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {penDetail && (
        <div onClick={() => setPenDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720, width: '92%', maxHeight: '82vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>
                {penDetail.fund
                  ? `${t('avizier.penTitleFund', 'Penalizări')} ${catLabels[penDetail.fund] ?? penDetail.fund} — ${t('avizier.penTitleCalc', 'detaliu de calcul')}`
                  : t('avizier.penTitle', 'Penalizări — detaliu de calcul')}
              </h4>
              <button className="btn ghost small" onClick={() => setPenDetail(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              {penDetail.data?.beName || penDetail.be} · {data?.period?.code}
            </div>
            {!penDetail.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : penDetail.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : !(penDetail.data.buckets || []).length ? (
              <div className="empty">{t('avizier.penNone', 'Fără penalizări.')}</div>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <div className="card soft" style={{ flex: 1, minWidth: 160 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{t('avizier.penMonth', 'Penalizări curente')}</div>
                    <strong style={{ fontSize: 18, color: 'var(--danger, #b45309)' }}>{money(penDetail.data.monthTotal)}</strong>
                  </div>
                  <div className="card soft" style={{ flex: 1, minWidth: 160 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{t('avizier.penTotal', 'Penalizări restante')}</div>
                    <strong style={{ fontSize: 18, color: 'var(--danger, #b45309)' }}>{money(penDetail.data.grandTotal)}</strong>
                  </div>
                </div>
                {penDetail.data.override ? (
                  <div className="card" style={{ background: 'var(--info-bg,#e3f2fd)', borderLeft: '3px solid var(--info,#1565c0)', padding: '8px 10px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>✎ {t('avizier.penCorrTitle', 'Corecție manuală aplicată')}</div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      {t('avizier.penCorrCalc', 'Calculat')}: <strong style={{ textDecoration: 'line-through' }}>{money(penDetail.data.override.computed)}</strong>
                      {' → '}{t('avizier.penCorrApproved', 'aprobat')}: <strong>{money(penDetail.data.override.approved)}</strong>
                    </div>
                    {penDetail.data.override.comment ? <div className="muted" style={{ fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>“{penDetail.data.override.comment}”</div> : null}
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{penDetail.data.override.actor} · {new Date(penDetail.data.override.at).toLocaleString('ro-RO')}</div>
                  </div>
                ) : null}
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('avizier.penIntro', 'Fiecare sumă neachitată acumulează penalizări zilnic, din ziua de după scadență + perioada de grație, plafonat la valoarea datoriei.')}
                </div>
                {(penDetail.data.buckets || []).map((b: any, i: number) => (
                  <div key={i} className="card soft">
                    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                      <strong>{b.label}</strong>
                      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                        {b.capReached ? <span className="badge secondary" title={t('avizier.penCapHint', 'Penalizarea a atins valoarea datoriei (plafon legal)')}>{t('avizier.penCap', 'plafonat')}</span> : null}
                        <span className="badge secondary">{b.ratePerDayPct}%/{t('avizier.perDay', 'zi')}</span>
                        <button type="button" onClick={() => togglePenBucket(i)} title={t('avizier.expand', 'Detaliază')}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--link, #2563eb)', font: 'inherit', fontSize: 12 }}>
                          {penExpanded.has(i) ? '▾ ' : '▸ '}{t('avizier.penDetails', 'Detalii')}
                        </button>
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                      {!b.uncapped && <>{t('avizier.penPrincipal', 'Datorie')}: {money(b.principalOriginal)}{' · '}</>}
                      {t('avizier.penRemaining', 'rămas')}: {money(b.principalRemaining)}
                      {' → '}{t('avizier.penTarget', 'în fondul')} {b.targetFund}
                      {' · '}{t('avizier.penTotalDays', 'Total zile')}: <strong>{b.totalDays}</strong>
                      {' · '}{t('avizier.penToDate', 'acumulat')}: <strong>{money(b.penaltyToDate)}</strong>
                    </div>
                    {penExpanded.has(i) && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                      <thead>
                        <tr style={{ textAlign: 'right', color: 'var(--muted,#666)' }}>
                          <th style={{ textAlign: 'left', padding: '3px 6px' }}>{t('avizier.penPeriod', 'Perioadă')}</th>
                          <th style={{ padding: '3px 6px' }}>{t('avizier.penRem', 'Sold restant')}</th>
                          <th style={{ padding: '3px 6px' }} title={t('avizier.penDaysHint', 'Zile penalizate în această lună')}>{t('avizier.penDays', 'Zile')}</th>
                          <th style={{ padding: '3px 6px' }} title={t('avizier.penTotalDaysHint', 'Total zile de întârziere până la finalul lunii')}>{t('avizier.penTotalDays', 'Total zile')}</th>
                          <th style={{ padding: '3px 6px' }}>{t('avizier.penAdded', 'Penaliz. lună')}</th>
                          <th style={{ padding: '3px 6px' }}>{t('avizier.penCum', 'Cumulat')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(b.history || []).map((h: any, j: number) => (
                          <tr key={j} style={{ textAlign: 'right', borderTop: '1px solid var(--border,#eee)', fontWeight: h.current ? 700 : 400, background: h.current ? 'var(--muted-bg,#f4f4f5)' : undefined }}>
                            <td style={{ textAlign: 'left', padding: '3px 6px' }}>{h.periodCode}</td>
                            <td style={{ padding: '3px 6px' }}>{money(h.principalRemaining)}</td>
                            <td style={{ padding: '3px 6px' }}>{h.days}</td>
                            <td style={{ padding: '3px 6px', color: 'var(--muted,#666)' }}>{h.daysToDate}</td>
                            <td style={{ padding: '3px 6px' }}>{money(h.penaltyPosted)}</td>
                            <td style={{ padding: '3px 6px' }}>{money(h.penaltyAccrued)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
