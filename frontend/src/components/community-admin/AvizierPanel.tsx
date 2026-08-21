import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { PenaltyOverrideModal } from './PenaltyOverrideModal'
import { beLabel } from './beLabel'

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Column labels come from the backend (avizier.categoryLabels — expense-type/fund names + APA_DIF);
// the frontend no longer hardcodes any code→label knowledge and falls back to the raw code.

// Numeric-column headers wrap (multi-word labels stack) so columns shrink to the small numbers below.
const TH_WRAP: React.CSSProperties = { whiteSpace: 'normal', verticalAlign: 'bottom', maxWidth: 112 }

export function AvizierPanel({
  communityId,
  cenzorEnabled = true,
  reportPath,
  periodsPath,
  readOnly = false,
  onOpenConfig,
}: {
  communityId: string
  cenzorEnabled?: boolean
  // Resident (read-only) mode: point the fetches at the me/ + closed-periods routes and drop every
  // interactive drilldown / admin control (residents only get the whole-community table to read).
  reportPath?: string
  periodsPath?: string
  readOnly?: boolean
  // Jumps to the admin "Config" tab's Avizier section (grouping/order/labels) — omitted in resident
  // read-only mode, where there's nothing to configure.
  onOpenConfig?: () => void
}) {
  const { api, activeRole } = useAuth()
  const { t: rawT, lang } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const periodLabel = (code?: string) => {
    if (!code) return ''
    const [y, m] = code.split('-').map(Number)
    if (!y || !m) return code
    return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', { month: 'long', year: 'numeric' })
  }
  // Încasări columns always reflect the *previous* period's collection cycle — the code is one
  // calendar month behind whatever period is currently selected.
  const prevPeriodCode = (code?: string) => {
    if (!code) return ''
    const [y, m] = code.split('-').map(Number)
    if (!y || !m) return ''
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const avizierBase = reportPath ?? `/communities/${communityId}/finance/avizier`
  const periodsBase = periodsPath ?? `/communities/${communityId}/periods`
  const RO = !!readOnly

  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState<string>('')
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [signBusy, setSignBusy] = React.useState<string | null>(null)
  const [signMsg, setSignMsg] = React.useState<string | null>(null)

  const isCensor = !RO && activeRole?.role === 'CENSOR' && cenzorEnabled
  const isAdmin = !RO && activeRole?.role === 'COMMUNITY_ADMIN'
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
    api.get<any>(`${avizierBase}${q}`).then((d: any) => setData(d)).catch(() => {})
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
  // Category-level expand: within a fund, breaks "Curente" into its underlying expense categories.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const toggleGroup = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  // Band-level collapse: folds every fund under a super-group band (or the grand-total band) into
  // one combined "Total" column. The grand-total band ('__total__') starts collapsed, matching the
  // reference report's default "De plată" state.
  const [collapsedBands, setCollapsedBands] = React.useState<Set<string>>(new Set(['__total__']))
  const toggleBand = (k: string) => setCollapsedBands((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  // Fund-level collapse: folds a single fund's own Curente+Restanțe into one combined "Total"
  // column, independently of its siblings — one level below band-level collapse.
  const [collapsedFunds, setCollapsedFunds] = React.useState<Set<string>>(new Set())
  const toggleFund = (k: string) => setCollapsedFunds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const [soldDetail, setSoldDetail] = React.useState<{ be: string; data: any } | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)
  const [showInfo, setShowInfo] = React.useState(true) // #7 INFO columns (CPI / persoane / consum apă)
  const [showIncasari, setShowIncasari] = React.useState(true) // per-fund/De-plată Încasări column (prior period's receipts)
  const [publicMode, setPublicMode] = React.useState(false) // #10 GDPR: hide owner names (posted/exported view)
  // Zoom: one stepper that bulk-sets every band/fund/category collapse state at once —
  // 0 = every super-band collapsed, 1 = bands open but every fund collapsed, 2 = normal
  // (Curente/Restanțe per fund, the landing state), 3 = every multi-category fund expanded.
  const [zoomLevel, setZoomLevel] = React.useState(2)
  // Single-column sort applied to the row list (not the totals row, which stays a whole-community sum).
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const toggleSort = (k: string) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc') }
    else setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
  }
  const SortIcon = ({ k }: { k: string }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle', flex: '0 0 auto' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )
  // A header's label and its trailing sort icon as one flex unit — auto table-layout sizes a
  // column to its widest cell's *intrinsic* content width, and two sibling inline-blocks (a
  // label/button plus the icon button) can independently wrap apart if that width is tight.
  // Flexing them together makes their combined width the intrinsic width, so they never split.
  const HLabel = ({ children }: { children: React.ReactNode }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{children}</span>
  )
  // Row filter: CPI range + an explicit hidden-unit set (checklist), both scoped to the Apartament column.
  // The popover renders as position:fixed at the end of the tree (not nested inside the sticky
  // header cell) — the table's own sticky first-column cells create competing stacking contexts
  // that would otherwise paint over an absolutely-positioned child of the sticky header.
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [filterAnchor, setFilterAnchor] = React.useState<{ top: number; left: number } | null>(null)
  const [filterCpiMin, setFilterCpiMin] = React.useState('')
  const [filterCpiMax, setFilterCpiMax] = React.useState('')
  const [unitSearch, setUnitSearch] = React.useState('')
  const [hiddenUnits, setHiddenUnits] = React.useState<Set<string>>(new Set())
  const toggleUnitHidden = (be: string) => setHiddenUnits((s) => { const n = new Set(s); n.has(be) ? n.delete(be) : n.add(be); return n })
  const filterActive = hiddenUnits.size > 0 || filterCpiMin !== '' || filterCpiMax !== ''

  const openSold = (beCode: string) => {
    if (RO) return
    setSoldDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/explain-sold?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d) => setSoldDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setSoldDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [payDetail, setPayDetail] = React.useState<{ be: string; data: any } | null>(null)
  const openPayments = (beCode: string) => {
    if (RO) return
    setPayDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/payments?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d: any) => setPayDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setPayDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [adjDetail, setAdjDetail] = React.useState<{ be: string; data: any } | null>(null)
  const openAdjustments = (beCode: string) => {
    if (RO) return
    setAdjDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/adjustments?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d: any) => setAdjDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setAdjDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const openExplain = (beCode: string, category: string) => {
    if (RO) return
    setExplain({ be: beCode, cat: category, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/explain?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}&category=${encodeURIComponent(category)}`)
      .then((d) => setExplain((cur) => (cur && cur.be === beCode && cur.cat === category ? { ...cur, data: d } : cur)))
      .catch(() => setExplain((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
  }

  const [penDetail, setPenDetail] = React.useState<{ be: string; scope: 'month' | 'total'; fund?: string; data: any } | null>(null)
  const [penExpanded, setPenExpanded] = React.useState<Set<number>>(new Set())
  const togglePenBucket = (i: number) => setPenExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const openPenalty = (beCode: string, scope: 'month' | 'total', fund?: string) => {
    if (RO) return
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
    api.get<any[]>(periodsBase).then((rows) => {
      const sorted = (rows || []).slice().sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
      setPeriods(sorted)
      // default to the newest period (the one being closed), not the latest CLOSED one
      if (sorted.length) setPeriod((cur) => cur || sorted[0].code)
      else setLoading(false)
    }).catch(() => { setPeriods([]); setLoading(false) })
  }, [api, communityId, periodsBase])

  React.useEffect(() => {
    if (!communityId || !period) return
    let alive = true
    setLoading(true)
    api.get<any>(`${avizierBase}?period=${encodeURIComponent(period)}`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period, avizierBase])

  const cats: string[] = data?.categories ?? []
  const rows: any[] = data?.rows ?? []
  const totals = data?.totals
  const hasAdj = Math.abs(Number(totals?.adjustments ?? 0)) > 0.005

  // Group category columns under their owning fund; each group is a collapsible column.
  // `superGroup` is the coarse avizier bucket (Întreținere / Fond Operațional / Fond Reabilitare)
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
    | { kind: 'incasari'; group: Group; sg?: SuperGroup }
    | { kind: 'cat'; cat: string; group: Group; sg?: SuperGroup }
    | { kind: 'curente'; group: Group; sg?: SuperGroup }
    | { kind: 'restante'; group: Group; sg?: SuperGroup }
    | { kind: 'fundTotal'; group: Group; sg?: SuperGroup }
    | { kind: 'pen'; scope: 'month' | 'total'; group: Group; sg?: SuperGroup }
    | { kind: 'bandTotal'; sg: SuperGroup; bandGroups: Group[] }
    | { kind: 'adjustments'; group: Group; sg?: SuperGroup }
    | { kind: 'finalTotal'; group: Group; sg?: SuperGroup }

  // Synthetic pseudo-fund for the grand bottom line — mirrors the reference report's unified
  // "De plată" band (Încasări / Curente / Restanțe / Total), collapsible exactly like a real fund.
  const DEPLATA_SG: SuperGroup = { key: '__total__', label: t('avizier.grandTotal', 'De plată') }
  const DEPLATA_GROUP: Group = { key: '__total__', label: DEPLATA_SG.label, superGroup: DEPLATA_SG, categories: [] }
  const isDeplata = (g: Group) => g.key === DEPLATA_GROUP.key
  // Stable identity for a column, independent of its current position — used to target sort at a
  // column that may disappear/reappear as bands and funds collapse/expand.
  const colKey = (col: Col): string =>
    col.kind === 'bandTotal' ? `bandTotal:${col.sg.key}`
      : col.kind === 'pen' ? `pen:${col.group.key}:${col.scope}`
        : col.kind === 'cat' ? `cat:${col.cat}`
          : `${col.kind}:${col.group.key}`
  // Zoom: bulk-sets collapsedBands/collapsedFunds/expanded for every fund at once, leaving the
  // grand-total band's own collapse state untouched (it's controlled independently, like the
  // reference report's "De plată").
  const applyZoom = (level: number) => {
    const clamped = Math.max(0, Math.min(3, level))
    setZoomLevel(clamped)
    const nextBands = new Set<string>(collapsedBands.has(DEPLATA_SG.key) ? [DEPLATA_SG.key] : [])
    const nextFunds = new Set<string>()
    const nextExpanded = new Set<string>()
    if (clamped === 0) {
      for (const g of groups) if (g.superGroup) nextBands.add(g.superGroup.key)
    } else if (clamped === 1) {
      for (const g of groups) nextFunds.add(g.key)
    } else if (clamped === 3) {
      for (const g of groups) if (g.categories.length > 1) nextExpanded.add(g.key)
    }
    setCollapsedBands(nextBands)
    setCollapsedFunds(nextFunds)
    setExpanded(nextExpanded)
  }

  const cols: Col[] = []
  const emittedBands = new Set<string>()
  for (const g of groups) {
    const sg = g.superGroup
    // A collapsed super-band folds every one of its funds into a single combined column.
    if (sg && collapsedBands.has(sg.key)) {
      if (emittedBands.has(sg.key)) continue
      emittedBands.add(sg.key)
      const bandGroups = groups.filter((x) => x.superGroup?.key === sg.key)
      cols.push({ kind: 'bandTotal', sg, bandGroups })
      continue
    }
    // A collapsed fund folds just its own Curente+Restanțe into one combined column.
    if (collapsedFunds.has(g.key)) {
      cols.push({ kind: 'fundTotal', group: g, sg })
      continue
    }
    if (showIncasari) cols.push({ kind: 'incasari', group: g, sg })
    if (g.categories.length > 1 && expanded.has(g.key)) {
      g.categories.forEach((c) => cols.push({ kind: 'cat', cat: c, group: g, sg }))
    }
    cols.push({ kind: 'curente', group: g, sg })
    cols.push({ kind: 'restante', group: g, sg })
    // a fund's penalties (this month + cumulative) sit immediately to the right of the fund's column
    if (penaltyFunds.includes(g.key)) {
      cols.push({ kind: 'pen', scope: 'month', group: g, sg })
      cols.push({ kind: 'pen', scope: 'total', group: g, sg })
    }
  }
  // The grand-total band — always present, defaults collapsed (see collapsedBands init) to a single
  // "Total" column, exactly like the reference report's "De plată" band.
  if (collapsedBands.has(DEPLATA_SG.key)) {
    cols.push({ kind: 'finalTotal', group: DEPLATA_GROUP, sg: DEPLATA_SG })
  } else {
    if (showIncasari) cols.push({ kind: 'incasari', group: DEPLATA_GROUP, sg: DEPLATA_SG })
    cols.push({ kind: 'curente', group: DEPLATA_GROUP, sg: DEPLATA_SG })
    cols.push({ kind: 'restante', group: DEPLATA_GROUP, sg: DEPLATA_SG })
    if (hasAdj) cols.push({ kind: 'adjustments', group: DEPLATA_GROUP, sg: DEPLATA_SG })
    cols.push({ kind: 'finalTotal', group: DEPLATA_GROUP, sg: DEPLATA_SG })
  }

  // Row 1: contiguous runs of columns sharing a super-group, for the spanning band header row.
  const sgRuns: { key: string; label: string; span: number }[] = []
  for (const col of cols) {
    const key = col.sg?.key ?? '_'
    const label = col.sg?.label ?? ''
    const last = sgRuns[sgRuns.length - 1]
    if (last && last.key === key) last.span++
    else sgRuns.push({ key, label, span: 1 })
  }
  // Row 2: contiguous runs of columns sharing an owning fund (or the grand-total band), for the
  // spanning fund header row. A collapsed super-band's single combined column has no one fund to
  // name (its row-1 label already says so), same for the grand-total band.
  const groupOf = (col: Col): { key: string; label: string; kind: 'band' | 'deplata' | 'fund' } =>
    col.kind === 'bandTotal' ? { key: `b:${col.sg.key}`, label: '', kind: 'band' }
      : isDeplata(col.group) ? { key: 'deplata', label: '', kind: 'deplata' }
        : { key: col.group.key, label: col.group.label, kind: 'fund' }
  const groupRuns: { key: string; label: string; span: number; kind: 'band' | 'deplata' | 'fund' }[] = []
  for (const col of cols) {
    const g = groupOf(col)
    const last = groupRuns[groupRuns.length - 1]
    if (last && last.key === g.key) last.span++
    else groupRuns.push({ ...g, span: 1 })
  }
  // #8 configurator: which INFO columns the community enabled, and how many are visible now.
  const infoCfg = (data?.config?.info ?? { cpi: true, residents: true, consumption: true }) as { cpi: boolean; residents: boolean; consumption: boolean }
  const infoVis = { cpi: showInfo && infoCfg.cpi !== false, residents: showInfo && infoCfg.residents !== false, consumption: showInfo && infoCfg.consumption !== false }
  const infoCount = (infoVis.cpi ? 1 : 0) + (infoVis.residents ? 1 : 0) + (infoVis.consumption ? 1 : 0)
  // `periods` is sorted newest-first (see the fetch effect above), so "older" moves the index forward
  // and "newer" moves it back.
  const periodIdx = periods.findIndex((p) => p.code === period)
  const goPeriod = (dir: 1 | -1) => {
    const idx = periodIdx + dir
    if (idx >= 0 && idx < periods.length) setPeriod(periods[idx].code)
  }
  const sumCats = (charges: Record<string, number>, keys: string[]) => keys.reduce((s, c) => s + (Number(charges?.[c]) || 0), 0)
  const leadColspan = 1 + infoCount
  // Încasări always reports the prior period's collection cycle, so every Încasări header carries
  // that period code (e.g. "Încasări (2026-05)" while viewing 2026-06).
  const incasariLabel = `${t('avizier.incasari', 'Încasări')} (${prevPeriodCode(data?.period?.code || period)})`
  // The value a given column would display for a row — reused so sort can target any column,
  // including ones derived at render time (fundTotal/bandTotal/finalTotal).
  const colValue = (r: any, col: Col): number => {
    switch (col.kind) {
      case 'incasari': return isDeplata(col.group) ? (Number(r.payments) || 0) : (Number(r.paymentsByFund?.[col.group.key]) || 0)
      case 'cat': return Number(r.charges?.[col.cat]) || 0
      case 'curente': return isDeplata(col.group) ? (Number(r.curentTotal) || 0) : sumCats(r.charges, col.group.categories)
      case 'restante': return isDeplata(col.group) ? round2((Number(r.soldPrecedent) || 0) - (Number(r.payments) || 0)) : (Number(r.soldByFund?.[col.group.key]) || 0)
      case 'pen': return Number(r.penaltyByFund?.[col.group.key]?.[col.scope]) || 0
      case 'fundTotal': return round2(sumCats(r.charges, col.group.categories) + (Number(r.soldByFund?.[col.group.key]) || 0))
      case 'bandTotal': return round2(col.bandGroups.reduce((s, g) => s + sumCats(r.charges, g.categories) + (Number(r.soldByFund?.[g.key]) || 0), 0))
      case 'adjustments': return Number(r.adjustments) || 0
      case 'finalTotal': return Number(r.totalDue) || 0
    }
  }
  const sortValueOf = (r: any): number | string => {
    if (sortKey === 'name') return beLabel(r, { publicMode }).primary
    if (sortKey === 'cpi') return Number(r.cpi) || 0
    if (sortKey === 'residents') return Number(r.residents) || 0
    if (sortKey === 'consumption') return Number(r.consumption) || 0
    const col = cols.find((c) => colKey(c) === sortKey)
    return col ? colValue(r, col) : 0
  }
  // Filter (CPI range + explicit hidden units) and sort only affect the row list — the totals row
  // stays the whole-community sum supplied by the backend.
  let displayRows = rows
  if (filterActive) {
    displayRows = displayRows.filter((r) => {
      if (hiddenUnits.has(r.beCode)) return false
      const cpi = Number(r.cpi) || 0
      if (filterCpiMin !== '' && cpi < Number(filterCpiMin)) return false
      if (filterCpiMax !== '' && cpi > Number(filterCpiMax)) return false
      return true
    })
  }
  if (sortKey) {
    displayRows = displayRows.slice().sort((a, b) => {
      const va = sortValueOf(a); const vb = sortValueOf(b)
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (Number(va) - Number(vb))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  return (
    <div
      className="stack"
      style={fullscreen
        ? { gap: 12, position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg, #fff)', padding: 16, overflow: 'auto' }
        // The table below is wider than the viewport (many fund columns) and scrolls within its own
        // card — but without an explicit width here, this whole column shrink-wraps to that width too,
        // dragging the header/toolbar off-screen to the right along with it. minWidth:0 lets a flex
        // child actually shrink below its content's natural width instead of overriding it.
        : { gap: 12, width: '100%', minWidth: 0 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, minWidth: 0 }}>
        <div className="stack" style={{ gap: 2 }}>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.2 }}>{t('avizier.title', 'Avizier')}</h2>
            {data?.period?.status ? <span className={`badge ${data.period.status === 'CLOSED' ? 'secondary' : 'tertiary'}`}>{data.period.status}</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{t('avizier.list', 'Listă de întreținere')} · {periodLabel(data?.period?.code || period)}</div>
        </div>
        <div className="row" style={{ gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {data?.period?.afisareDate && (
            <div className="stack" style={{ gap: 1 }}>
              <span className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('avizier.afisare', 'Data afișării')}</span>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{new Date(data.period.afisareDate).toLocaleDateString('ro-RO')}</span>
            </div>
          )}
          {data?.period?.dueDate && (
            <div className="stack" style={{ gap: 1 }}>
              <span className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('avizier.due', 'Scadență')}</span>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{new Date(data.period.dueDate).toLocaleDateString('ro-RO')}</span>
            </div>
          )}
          <button
            type="button"
            className="btn small"
            onClick={() => setPublicMode((v) => !v)}
            title={t('avizier.publicToggle', 'Mod public: ascunde numele proprietarilor (GDPR) pentru afișare/print')}
            aria-pressed={!publicMode}
            style={{ borderRadius: 999, ...(publicMode ? { background: 'none', color: 'var(--text, #1d1d1f)', borderColor: 'var(--border, #e5e5e5)' } : {}) }}
          >
            👤 {t('avizier.publicOff', 'Nume')}
          </button>
          <button type="button" className="btn small" style={{ borderRadius: 999, background: 'none', color: 'var(--text, #1d1d1f)', borderColor: 'var(--border, #e5e5e5)' }}
            onClick={() => window.print()} title={t('avizier.print', 'Printează')}>
            🖨 {t('avizier.print', 'Printează')}
          </button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 4, alignItems: 'center' }}>
          <button type="button" className="btn ghost small" disabled={periodIdx < 0 || periodIdx >= periods.length - 1}
            onClick={() => goPeriod(1)} title={t('avizier.prevPeriod', 'Perioada anterioară')} aria-label={t('avizier.prevPeriod', 'Perioada anterioară')}>‹</button>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
          </select>
          <button type="button" className="btn ghost small" disabled={periodIdx <= 0}
            onClick={() => goPeriod(-1)} title={t('avizier.nextPeriod', 'Perioada următoare')} aria-label={t('avizier.nextPeriod', 'Perioada următoare')}>›</button>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div className="row" style={{ gap: 0, alignItems: 'center', border: '1px solid var(--border, #e5e5e5)', borderRadius: 999, padding: '2px 2px' }}>
            <button type="button" onClick={() => applyZoom(zoomLevel - 1)} disabled={zoomLevel <= 0}
              title={t('avizier.zoomOut', 'Comprimă o treaptă')} aria-label={t('avizier.zoomOut', 'Comprimă o treaptă')}
              style={{ background: 'none', border: 'none', width: 24, height: 24, borderRadius: '50%', cursor: zoomLevel <= 0 ? 'default' : 'pointer', color: zoomLevel <= 0 ? 'var(--border, #ccc)' : 'var(--text, #1d1d1f)', fontSize: 15, lineHeight: 1 }}>
              −
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted, #666)', padding: '0 6px' }}>{t('avizier.zoom', 'Zoom')}</span>
            <button type="button" onClick={() => applyZoom(zoomLevel + 1)} disabled={zoomLevel >= 3}
              title={t('avizier.zoomIn', 'Detaliază o treaptă')} aria-label={t('avizier.zoomIn', 'Detaliază o treaptă')}
              style={{ background: 'none', border: 'none', width: 24, height: 24, borderRadius: '50%', cursor: zoomLevel >= 3 ? 'default' : 'pointer', color: zoomLevel >= 3 ? 'var(--border, #ccc)' : 'var(--text, #1d1d1f)', fontSize: 15, lineHeight: 1 }}>
              +
            </button>
          </div>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowInfo((v) => !v)}
            title={t('avizier.infoToggle', 'Arată/ascunde coloanele informative (CPI, persoane, consum apă)')}
            aria-pressed={showInfo}
            style={{ borderRadius: 999 }}
          >
            {showInfo ? '☑ ' : '☐ '}{t('avizier.info', 'Info')}
          </button>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setShowIncasari((v) => !v)}
            title={t('avizier.incasariToggle', 'Arată/ascunde coloana de încasări')}
            aria-pressed={showIncasari}
            style={{ borderRadius: 999 }}
          >
            {showIncasari ? '☑ ' : '☐ '}{t('avizier.incasari', 'Încasări')}
          </button>
          {isAdmin && onOpenConfig && (
            <button
              type="button"
              className="btn ghost small"
              onClick={onOpenConfig}
              title={t('avizier.openConfig', 'Configurare avizier — grupare, ordine, etichete')}
              style={{ borderRadius: 999 }}
            >
              ⚙ {t('avizierCfg.title', 'Configurare avizier')}
            </button>
          )}
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet (Esc)') : t('avizier.fullscreen', 'Ecran complet')}
            aria-label={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet') : t('avizier.fullscreen', 'Ecran complet')}
            style={{ borderRadius: 999 }}
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
      ) : !displayRows.length ? (
        <div className="empty">{t('avizier.filterNone', 'Niciun apartament nu corespunde filtrului.')}</div>
      ) : (
        <div className="card" style={{ overflowX: 'auto', padding: 0, minWidth: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }} colSpan={leadColspan} />
                {sgRuns.map((run, i) => {
                  const collapsible = run.key !== '_'
                  const isCollapsed = collapsedBands.has(run.key)
                  return (
                    <th key={`bd${i}`} colSpan={run.span}
                      onClick={collapsible ? () => toggleBand(run.key) : undefined}
                      title={collapsible ? t('avizier.collapseBand', 'Restrânge/extinde tot grupul') : undefined}
                      style={{
                        padding: '4px 10px', textAlign: 'center', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600,
                        color: isCollapsed ? 'var(--accent, #0071e3)' : 'var(--muted, #666)', cursor: collapsible ? 'pointer' : 'default',
                        borderLeft: run.label ? '1px solid var(--border, #e5e5e5)' : 'none',
                      }}>
                      {collapsible ? (isCollapsed ? '+ ' : '− ') : ''}{run.label}
                    </th>
                  )
                })}
              </tr>
              <tr style={{ background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }} colSpan={leadColspan} />
                {groupRuns.map((run, i) => (
                  <th key={`gr${i}`} colSpan={run.span}
                    onClick={run.kind === 'fund' ? () => toggleFund(run.key) : undefined}
                    title={run.kind === 'fund' ? t('avizier.collapseFund', 'Restrânge/extinde acest fond') : undefined}
                    style={{
                      padding: '4px 10px', textAlign: 'center', fontSize: 11, fontWeight: 500,
                      color: run.kind === 'fund' && collapsedFunds.has(run.key) ? 'var(--accent, #0071e3)' : 'var(--muted, #666)',
                      cursor: run.kind === 'fund' ? 'pointer' : 'default', borderLeft: '1px solid var(--border, #e5e5e5)',
                    }}>
                    {run.kind === 'fund' ? `${collapsedFunds.has(run.key) ? '+' : '−'} ${run.label}` : ''}
                  </th>
                ))}
              </tr>
              <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)', maxWidth: 190 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {t('avizier.entity', 'Apartament')}
                    <SortIcon k="name" />
                    <button type="button"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setFilterAnchor({ top: r.bottom + 6, left: r.left })
                        setFilterOpen((v) => !v)
                      }}
                      title={t('avizier.filter', 'Filtrează')}
                      style={{ background: 'none', border: 'none', padding: '0 0 0 4px', cursor: 'pointer', fontSize: 12, color: filterActive ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)' }}>
                      ▽
                    </button>
                  </span>
                </th>
                {infoVis.cpi && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.cpiHint', 'Cotă-parte indiviză')}><HLabel>{t('avizier.cpi', 'CPI')}<SortIcon k="cpi" /></HLabel></th>}
                {infoVis.residents && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.persHint', 'Număr persoane')}><HLabel>{t('avizier.pers', 'Pers.')}<SortIcon k="residents" /></HLabel></th>}
                {infoVis.consumption && <th style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)', fontWeight: 400 }} title={t('avizier.apaHint', 'Consum apă (mc)')}><HLabel>{t('avizier.apa', 'Apă (mc)')}<SortIcon k="consumption" /></HLabel></th>}
                {cols.map((col, i) => {
                  if (col.kind === 'incasari') return (
                    <th key={`i${i}`} style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)' }}><HLabel>{incasariLabel}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                  if (col.kind === 'cat') return (
                    <th key={`c${i}`} style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 400, color: 'var(--muted, #666)' }}><HLabel>{catLabel(col.cat)}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                  if (col.kind === 'curente') {
                    const expandable = !isDeplata(col.group) && col.group.categories.length > 1
                    const isExpandedTail = expandable && expanded.has(col.group.key)
                    return (
                      <th key={`cu${i}`} style={{ ...TH_WRAP, padding: '8px 10px' }}>
                        <HLabel>
                          {expandable ? (
                            <button type="button" onClick={() => toggleGroup(col.group.key)} title={t('avizier.expand', 'Detaliază')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: isExpandedTail ? 700 : 400 }}>
                              {isExpandedTail ? '− ' : '+ '}{isExpandedTail ? t('avizier.total', 'Total') : t('avizier.curente', 'Curente')}
                            </button>
                          ) : t('avizier.curente', 'Curente')}
                          <SortIcon k={colKey(col)} />
                        </HLabel>
                      </th>
                    )
                  }
                  if (col.kind === 'restante') return (
                    <th key={`r${i}`} style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--muted, #666)' }}><HLabel>{t('avizier.soldPrec', 'Restanțe')}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                  if (col.kind === 'pen') return (
                    <th key={`p${i}`} style={{ ...TH_WRAP, padding: '8px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}
                      title={`${col.scope === 'total' ? t('avizier.penTotalHint', 'Penalizări restante (rămase de plată, acumulate)') : t('avizier.penMonthHint', 'Penalizări curente (luna aceasta)')} — ${catLabels[col.group.key] ?? col.group.key}`}>
                      <HLabel>
                        {col.scope === 'total' ? t('avizier.penTotalShort', 'Penaliz. restante') : t('avizier.penMonthShort', 'Penaliz. curente')}
                        <SortIcon k={colKey(col)} />
                      </HLabel>
                    </th>
                  )
                  if (col.kind === 'fundTotal') return (
                    <th key={`ft${i}`} style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 700 }}><HLabel>{t('avizier.total', 'Total')}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                  if (col.kind === 'bandTotal') return (
                    <th key={`bt${i}`} style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 700 }} title={t('avizier.bandCollapsedHint', 'Grup restrâns — sumă pe toate fondurile din grup')}>
                      <HLabel>{t('avizier.total', 'Total')}<SortIcon k={colKey(col)} /></HLabel>
                    </th>
                  )
                  if (col.kind === 'adjustments') return (
                    <th key={`a${i}`} style={{ ...TH_WRAP, padding: '8px 10px' }} title={t('avizier.adjustmentsHint', 'Corecții fără numerar (ex. scutire penalizări)')}><HLabel>{t('avizier.adjustments', 'Ajustări')}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                  return (
                    <th key={`fin${i}`} style={{ ...TH_WRAP, padding: '8px 10px', fontWeight: 700 }}><HLabel>{t('avizier.total', 'Total')}<SortIcon k={colKey(col)} /></HLabel></th>
                  )
                })}
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {displayRows.map((r, rowIdx) => {
                const hov = hoverBe === r.beCode
                const zebraBg = rowIdx % 2 === 1 ? 'var(--muted-bg, #fafafa)' : 'var(--bg, #fff)'
                const rowBg = hov ? 'var(--hover-bg, #eef4ff)' : zebraBg
                return (
                <tr key={r.beCode} onMouseEnter={() => setHoverBe(r.beCode)} onMouseLeave={() => setHoverBe(null)}
                  style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right', background: rowBg }}>
                  <td style={{ textAlign: 'left', padding: '6px 10px', position: 'sticky', left: 0, background: hov ? 'var(--hover-bg, #eef4ff)' : zebraBg,
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
                          {RO ? (
                            <span style={{ fontWeight: 600 }}>{l.primary}</span>
                          ) : (
                            <button type="button" onClick={() => openSold(r.beCode)} title={t('avizier.rowDetail', 'Vezi restanțe/încasări pe fonduri')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600, textDecoration: 'underline dotted' }}>
                              {l.primary}
                            </button>
                          )}
                          {l.secondary ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{l.secondary}</span> : null}
                          {isAdmin && hov && !publicMode ? <button type="button" title={t('avizier.rename', 'Redenumește')}
                            onClick={(e) => { e.stopPropagation(); setEditBe({ be: r.beCode, value: r.displayName || '' }) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--link, #2563eb)', fontSize: 11, marginLeft: 6, padding: 0 }}>✎</button> : null}
                        </span>
                      )
                    })()}
                  </td>
                  {infoVis.cpi && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.cpi != null ? money(r.cpi) : ''}</td>}
                  {infoVis.residents && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.residents != null ? r.residents : ''}</td>}
                  {infoVis.consumption && <td style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.consumption != null ? money(r.consumption) : ''}</td>}
                  {cols.map((col, i) => {
                    if (col.kind === 'incasari') {
                      // The grand-total band's own Încasări carries the payments-journal drilldown —
                      // it's the only place that number appears now.
                      if (isDeplata(col.group)) return (
                        <td key={`i${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{r.payments ? (RO ? money(r.payments) : (
                          <button type="button" onClick={() => openPayments(r.beCode)} title={t('avizier.paymentsLog', 'Jurnal încasări')}
                            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--link, #2563eb)', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                            {money(r.payments)}
                          </button>
                        )) : ''}</td>
                      )
                      const v = r.paymentsByFund?.[col.group.key]
                      return <td key={`i${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{v ? money(v) : ''}</td>
                    }
                    if (col.kind === 'cat') {
                      const v = r.charges[col.cat]
                      return (
                        <td key={`c${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>
                          {v ? (RO ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span> : (
                            <button type="button" onClick={() => openCell(r.beCode, col.cat)} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          )) : ''}
                        </td>
                      )
                    }
                    if (col.kind === 'curente') {
                      if (isDeplata(col.group)) return (
                        <td key={`cu${i}`} style={{ padding: '6px 10px', fontWeight: 700 }}>{r.curentTotal ? money(r.curentTotal) : ''}</td>
                      )
                      const single = col.group.categories.length === 1
                      const v = sumCats(r.charges, col.group.categories)
                      return (
                        <td key={`cu${i}`} style={{ padding: '6px 10px', fontWeight: expanded.has(col.group.key) ? 700 : 400 }}>
                          {v ? (single ? (RO ? money(v) : (
                            <button type="button" onClick={() => openCell(r.beCode, col.group.categories[0])} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          )) : money(v)) : ''}
                        </td>
                      )
                    }
                    if (col.kind === 'restante') {
                      // Net of this period's fund-scoped payments (dueStart − payments), NOT clamped at
                      // zero — an owner who paid more than they owed shows a negative (credit) figure.
                      if (isDeplata(col.group)) {
                        const v = round2((Number(r.soldPrecedent) || 0) - (Number(r.payments) || 0))
                        return <td key={`r${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>{v ? money(v) : ''}</td>
                      }
                      const v = r.soldByFund?.[col.group.key]
                      return (
                        <td key={`r${i}`} style={{ padding: '6px 10px', color: 'var(--muted, #666)' }}>
                          {v ? (RO ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span> : (
                            <button type="button" onClick={() => openSold(r.beCode)} title={t('avizier.soldDetail', 'Din ce fonduri e compus?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          )) : ''}
                        </td>
                      )
                    }
                    if (col.kind === 'pen') {
                      const v = r.penaltyByFund?.[col.group.key]?.[col.scope]
                      const editable = canOverride && col.scope === 'month'
                      return (
                        <td key={`p${i}`} style={{ padding: '6px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}>
                          {v ? (RO ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(v)}</span> : (
                            <button type="button" onClick={() => openPenalty(r.beCode, col.scope, col.group.key)} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          )) : ''}
                          {editable ? (
                            <button type="button" onClick={() => setOvrTarget({ be: r.beCode, beName: r.beName, computed: Number(v) || 0 })} title={t('avizier.override', 'Ajustează manual penalizarea')}
                              style={{ background: 'none', border: 'none', padding: '0 0 0 6px', cursor: 'pointer', color: 'var(--link, #2563eb)', fontSize: 12 }}>✎</button>
                          ) : null}
                        </td>
                      )
                    }
                    if (col.kind === 'fundTotal') {
                      const v = round2(sumCats(r.charges, col.group.categories) + (Number(r.soldByFund?.[col.group.key]) || 0))
                      return <td key={`ft${i}`} style={{ padding: '6px 10px', fontWeight: 700 }}>{v ? money(v) : ''}</td>
                    }
                    if (col.kind === 'bandTotal') {
                      const v = round2(col.bandGroups.reduce((s, g) => s + sumCats(r.charges, g.categories) + (Number(r.soldByFund?.[g.key]) || 0), 0))
                      return <td key={`bt${i}`} style={{ padding: '6px 10px', fontWeight: 700 }}>{v ? money(v) : ''}</td>
                    }
                    if (col.kind === 'adjustments') return (
                      <td key={`a${i}`} style={{ padding: '6px 10px' }}>{r.adjustments ? (RO ? money(r.adjustments) : (
                        <button type="button" onClick={() => openAdjustments(r.beCode)} title={t('avizier.adjustments', 'Ajustări')}
                          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--link, #2563eb)', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                          {money(r.adjustments)}
                        </button>
                      )) : ''}</td>
                    )
                    // finalTotal
                    return <td key={`fin${i}`} style={{ padding: '6px 10px', fontWeight: 700 }}>{money(r.totalDue)}</td>
                  })}
                </tr>
                )
              })}
              {totals ? (
                <tr style={{ borderTop: '2px solid var(--border, #ccc)', textAlign: 'right', fontWeight: 700, background: 'var(--muted-bg, #f4f4f5)' }}>
                  <td style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }}>{t('avizier.totalRow', 'TOTAL')}</td>
                  {infoVis.cpi && <td style={{ padding: '8px 10px' }}>{totals.cpi != null ? money(totals.cpi) : ''}</td>}
                  {infoVis.residents && <td style={{ padding: '8px 10px' }}>{totals.residents != null ? totals.residents : ''}</td>}
                  {infoVis.consumption && <td style={{ padding: '8px 10px' }}>{totals.consumption != null ? money(totals.consumption) : ''}</td>}
                  {cols.map((col, i) => {
                    if (col.kind === 'incasari') return (
                      <td key={`i${i}`} style={{ padding: '8px 10px' }}>{money(isDeplata(col.group) ? totals.payments : totals.paymentsByFund?.[col.group.key])}</td>
                    )
                    if (col.kind === 'curente') return (
                      <td key={`cu${i}`} style={{ padding: '8px 10px' }}>{money(isDeplata(col.group) ? totals.curentTotal : sumCats(totals.byCategory || {}, col.group.categories))}</td>
                    )
                    if (col.kind === 'restante') return (
                      <td key={`r${i}`} style={{ padding: '8px 10px' }}>
                        {money(isDeplata(col.group) ? round2((Number(totals.soldPrecedent) || 0) - (Number(totals.payments) || 0)) : totals.soldByFund?.[col.group.key])}
                      </td>
                    )
                    if (col.kind === 'cat') return (
                      <td key={`c${i}`} style={{ padding: '8px 10px' }}>{money(totals.byCategory?.[col.cat])}</td>
                    )
                    if (col.kind === 'pen') return (
                      <td key={`p${i}`} style={{ padding: '8px 10px', color: 'var(--danger, #b45309)' }}>{money(totals.penaltyByFund?.[col.group.key]?.[col.scope])}</td>
                    )
                    if (col.kind === 'fundTotal') return (
                      <td key={`ft${i}`} style={{ padding: '8px 10px' }}>{money(round2(sumCats(totals.byCategory || {}, col.group.categories) + (Number(totals.soldByFund?.[col.group.key]) || 0)))}</td>
                    )
                    if (col.kind === 'bandTotal') return (
                      <td key={`bt${i}`} style={{ padding: '8px 10px' }}>{money(round2(col.bandGroups.reduce((s, g) => s + sumCats(totals.byCategory || {}, g.categories) + (Number(totals.soldByFund?.[g.key]) || 0), 0)))}</td>
                    )
                    if (col.kind === 'adjustments') return (
                      <td key={`a${i}`} style={{ padding: '8px 10px' }}>{money(totals.adjustments)}</td>
                    )
                    return <td key={`fin${i}`} style={{ padding: '8px 10px' }}>{money(totals.totalDue)}</td>
                  })}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {filterOpen && filterAnchor && (
        <>
          <div onClick={() => setFilterOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
          <div onClick={(e) => e.stopPropagation()} className="card"
            style={{ position: 'fixed', top: filterAnchor.top, left: filterAnchor.left, width: 260, zIndex: 1001, textAlign: 'left', fontWeight: 400, background: 'var(--bg, #fff)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 12 }}>
            <div className="stack" style={{ gap: 8 }}>
              <div>
                <label className="muted" style={{ fontSize: 11 }}>{t('avizier.cpi', 'CPI')}</label>
                <div className="row" style={{ gap: 6, marginTop: 2 }}>
                  <input className="input" type="number" step="0.01" placeholder={t('avizier.min', 'Min')} value={filterCpiMin}
                    onChange={(e) => setFilterCpiMin(e.target.value)} style={{ width: '50%', fontSize: 12, padding: '4px 6px' }} />
                  <input className="input" type="number" step="0.01" placeholder={t('avizier.max', 'Max')} value={filterCpiMax}
                    onChange={(e) => setFilterCpiMax(e.target.value)} style={{ width: '50%', fontSize: 12, padding: '4px 6px' }} />
                </div>
              </div>
              <input className="input" placeholder={t('avizier.searchUnit', 'Caută apartament')} value={unitSearch}
                onChange={(e) => setUnitSearch(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }} />
              <button type="button"
                onClick={() => setHiddenUnits(hiddenUnits.size ? new Set() : new Set(rows.map((r) => r.beCode)))}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--link, #2563eb)', fontSize: 12, textAlign: 'left' }}>
                {hiddenUnits.size ? t('avizier.selectAll', 'Selectează tot') : t('avizier.deselectAll', 'Deselectează tot')}
              </button>
              <div style={{ maxHeight: 220, overflow: 'auto' }} className="stack">
                {rows
                  .filter((r) => !unitSearch || beLabel(r, { publicMode }).primary.toLowerCase().includes(unitSearch.toLowerCase()))
                  .map((r) => (
                    <label key={r.beCode} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
                      <input type="checkbox" checked={!hiddenUnits.has(r.beCode)} onChange={() => toggleUnitHidden(r.beCode)} />
                      <span style={{ flex: 1 }}>{beLabel(r, { publicMode }).primary}</span>
                      <span className="muted">{r.cpi != null ? money(r.cpi) : ''}</span>
                    </label>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}

      {soldDetail && (
        <div onClick={() => setSoldDetail(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, width: '90%', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
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
                <thead>
                  <tr style={{ textAlign: 'right', color: 'var(--muted, #666)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>{t('avizier.fund', 'Fond')}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 400 }} title={t('avizier.soldPrecHint', 'Ce era de plată din luna trecută')}>{t('avizier.soldPrec', 'Restanțe')}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 400 }} title={t('avizier.incasariHint', 'Ce s-a încasat luna aceasta')}>{t('avizier.incasari', 'Încasări')}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 400 }} title={t('avizier.netHint', 'Restanțe rămase (Restanțe − Încasări), fără cheltuielile din luna curentă')}>{t('avizier.net', 'Net')}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 400 }} title={t('avizier.curenteHint', 'Cheltuielile din luna curentă')}>{t('avizier.curente', 'Curente')}</th>
                    <th style={{ padding: '4px 8px', fontWeight: 700 }} title={t('avizier.totalHint', 'Net + Curente — tot ce rămâne de plată')}>{t('avizier.total', 'Total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(soldDetail.data.rows || []).map((r: any) => (
                    <tr key={r.fundCode} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '6px 8px' }}>{r.fundName}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.dueStart)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.payments)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.amount)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.charges)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{money(r.totalDue)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border, #ccc)', fontWeight: 700 }}>
                    <td style={{ padding: '8px' }}>{t('avizier.totalRow', 'TOTAL')}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.dueStartTotal)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.paymentsTotal)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.total)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.chargesTotal)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{money(soldDetail.data.totalDueTotal)}</td>
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
                      <td style={{ padding: '6px 8px' }}>{r.account}{r.cycle === 'prior' ? <span className="badge warn" style={{ marginLeft: 4 }} title={t('avizier.payPrior', 'Achitare ciclu anterior')}>{t('avizier.abbrevPrev', 'ant.')}</span> : null}</td>
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
