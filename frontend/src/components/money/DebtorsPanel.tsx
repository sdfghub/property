import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { usePeriodOptional } from '../../contexts/PeriodContext'
import { beLabel, shortUnit, prettyBe } from '../community-admin/beLabel'

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`
const pct = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
const cpiFmt = (n: number | null | undefined) => n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round1 = (n: number) => Math.round(n * 10) / 10

type SortKey = 'debt' | 'pctOfTotal'
type ViewMode = 'list' | 'heatmap' | 'pareto'
type EntityMode = 'be' | 'unit'

// Debt-severity color: a CONTINUOUS gradient across the design system's Status hues (good/
// warning/serious/critical — see the dataviz skill's palette reference), keyed to each debtor's
// OWN share of total arrears (pctOfTotal, 0-100). Each severity BAND (small 0–2%, medium 2–10%,
// large 10%–worst debtor) is a gradient stop: the band's hue sits at the band's MIDPOINT and
// colors fade from one band into the next, so a band boundary (2%, 10%) is an even blend of the
// two neighbouring hues — 9.9% and 10.1% look almost identical instead of jumping orange -> red.
// Green joins the same gradient: full green at 0% (paid up or in credit), fading into full
// yellow at +0.5%, so the smallest arrears read as "almost paid up" rather than a hard edge.
const STATUS_GOOD = '#0ca30c'
const STATUS_WARNING = '#fab219'
const STATUS_SERIOUS = '#ec835a'
const STATUS_CRITICAL = '#d03b3b'
const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const lerpColor = (a: string, b: string, frac: number) => {
  const [ar, ag, ab] = hexToRgb(a); const [br, bg, bb] = hexToRgb(b)
  return rgbToHex(ar + (br - ar) * frac, ag + (bg - ag) * frac, ab + (bb - ab) * frac)
}
const isLightColor = ([r, g, b]: [number, number, number]) => (0.299 * r + 0.587 * g + 0.114 * b) > 170

type Category = 'critical' | 'serious' | 'warning' | 'good'
const CATEGORY_MAJOR_PCT = 10
const CATEGORY_MEDIUM_PCT = 2
// debt <= 0 -> good (green). Otherwise, by the debtor's OWN pctOfTotal: >=10% -> critical,
// >=2% -> serious, else (any smaller positive share) -> warning. Used for the List view's
// groupings/subtotals and the Pareto boundary/legend — NOT for the heatmap color itself anymore
// (see `heatColor`), which blends continuously through these same threshold values instead.
// Thresholds compare the share as DISPLAYED (1 decimal, see `pct`) so a debtor shown as "10,0%"
// is never categorized below the ">= 10%" band because its raw value was 9.98.
const categoryOf = (debt: number, pctOfTotal: number): Category => {
  if (debt <= 0.005) return 'good'
  const p = round1(pctOfTotal)
  if (p >= CATEGORY_MAJOR_PCT) return 'critical'
  if (p >= CATEGORY_MEDIUM_PCT) return 'serious'
  return 'warning'
}
const CATEGORY_COLOR: Record<Category, string> = { critical: STATUS_CRITICAL, serious: STATUS_SERIOUS, warning: STATUS_WARNING, good: STATUS_GOOD }
// Order used everywhere a category list is shown: worst first, good standing last.
const CATEGORY_LIST: { key: Category; labelKey: string; fallback: string }[] = [
  { key: 'critical', labelKey: 'debtors.heatmapColorHigh', fallback: 'Large arrears' },
  { key: 'serious', labelKey: 'debtors.paretoMid', fallback: 'Medium arrears' },
  { key: 'warning', labelKey: 'debtors.heatmapColorLow', fallback: 'Small arrears' },
  { key: 'good', labelKey: 'debtors.heatmapColorZero', fallback: 'No arrears / paid in advance' },
]
const HEAT_GOOD_PCT = 0
const HEAT_WARNING_PCT = 0.5
// `maxPositivePct` is the worst debtor's own pctOfTotal in the current set — it closes the large
// band (there is no fixed upper bound on an individual share), which places the red stop.
const heatColor = (debt: number, pctOfTotal: number, maxPositivePct: number) => {
  // Raw (unrounded) share: the gradient is continuous, so a 0.04% debtor must not collapse onto 0%.
  const p = debt > 0.005 ? pctOfTotal : HEAT_GOOD_PCT
  const stops: [number, string][] = [
    [HEAT_GOOD_PCT, STATUS_GOOD],
    [HEAT_WARNING_PCT, STATUS_WARNING],
    [(CATEGORY_MEDIUM_PCT + CATEGORY_MAJOR_PCT) / 2, STATUS_SERIOUS],
    [Math.max(CATEGORY_MAJOR_PCT, (CATEGORY_MAJOR_PCT + maxPositivePct) / 2), STATUS_CRITICAL],
  ]
  if (p <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [x0, c0] = stops[i - 1]; const [x1, c1] = stops[i]
    if (p <= x1) return lerpColor(c0, c1, x1 > x0 ? (p - x0) / (x1 - x0) : 1)
  }
  return stops[stops.length - 1][1]
}

// Column-based ("strip") treemap: always slices VERTICALLY into columns, each filled top-to-
// bottom, columns placed left-to-right — unlike a recursive binary-split treemap (which alternates
// between horizontal and vertical cuts and so reads like scattered quadrants), this guarantees a
// plain reading order matching the caller's given item order: read down the first (leftmost)
// column, then the next column to its right, and so on. Within each column, how many items it
// holds is decided by the classic squarify heuristic (keep adding items while the column's worst
// aspect ratio keeps improving), just restricted to the column axis only. `value` drives each
// tile's area; order is the caller's own.
type TreemapItem = { value: number; [k: string]: any }
type TreemapRect<T> = T & { x: number; y: number; w: number; h: number }
function buildTreemap<T extends TreemapItem>(items: T[], x: number, y: number, w: number, h: number): TreemapRect<T>[] {
  const positive = items.filter((i) => i.value > 0)
  if (!positive.length || w <= 0 || h <= 0) return []
  let remaining = positive
  let remainingTotal = remaining.reduce((s, i) => s + i.value, 0)
  let rx = x, ry = y, rw = w, rh = h
  const result: TreemapRect<T>[] = []

  // Classic squarify worst-ratio: the tallest and shortest tile in the trial column (proportional
  // to its max/min value) bound how far from square any tile in it will be, given the column's
  // own thickness (its share of the remaining width).
  const worstRatio = (colItems: TreemapItem[], colSum: number) => {
    const colThickness = (colSum / remainingTotal) * rw
    if (colThickness <= 0) return Infinity
    let maxV = -Infinity, minV = Infinity
    for (const it of colItems) { if (it.value > maxV) maxV = it.value; if (it.value < minV) minV = it.value }
    const maxHeight = (maxV / colSum) * rh
    const minHeight = (minV / colSum) * rh
    return Math.max(maxHeight / colThickness, colThickness / minHeight)
  }

  while (remaining.length) {
    let colLen = 1
    let colSum = remaining[0].value
    let bestWorst = worstRatio(remaining.slice(0, 1), colSum)
    while (colLen < remaining.length) {
      const testSum = colSum + remaining[colLen].value
      const testWorst = worstRatio(remaining.slice(0, colLen + 1), testSum)
      if (testWorst > bestWorst) break
      colSum = testSum; bestWorst = testWorst; colLen++
    }
    const col = remaining.slice(0, colLen)
    const colThickness = (colSum / remainingTotal) * rw
    let cy = ry
    for (const it of col) {
      const itemHeight = (it.value / colSum) * rh
      result.push({ ...it, x: rx, y: cy, w: colThickness, h: itemHeight })
      cy += itemHeight
    }
    rx += colThickness
    rw -= colThickness
    remaining = remaining.slice(colLen)
    remainingTotal -= colSum
  }
  return result
}
const HEATMAP_HEIGHT = 440
const PARETO_HEIGHT = 360
// Bars share the container's width so the whole chart fits without horizontal scrolling; this is
// only the CAP (a handful of debtors shouldn't produce huge slabs).
const PARETO_BAR_WIDTH = 36
const PARETO_GAP = 3 // dataviz spacer spec: a surface gap between adjacent bars
const PARETO_LABEL_BAND = 190 // MAX room below the bars for the rotated per-bar unit/owner label

export function DebtorsPanel({ communityId, onPick }: { communityId: string; onPick?: (debtor: any) => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const shared = usePeriodOptional()
  const selectedCode = shared?.selectedCode
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  // Both columns are a positive linear function of the same underlying debt, so sorting by either
  // always yields the same row order — the point of exposing both is the direction toggle (largest/
  // smallest first), not a different ranking.
  const [sortKey, setSortKey] = React.useState<SortKey>('debt')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const [view, setView] = React.useState<ViewMode>('list')
  const [mode, setMode] = React.useState<EntityMode>('be')
  // Same "Nume" toggle as the avizier: owner names hidden by default, shown on their own line under
  // the unit / billing-entity label when on.
  const [showNames, setShowNames] = React.useState(false)
  // Proprietar mode: a multi-unit billing entity's row expands (click on its name, like the avizier)
  // into its individual units — fed by the SAME receivables endpoint at unit grain, fetched alongside.
  const [unitRows, setUnitRows] = React.useState<any[]>([])
  const [expandedBe, setExpandedBe] = React.useState<Set<string>>(new Set())
  const toggleExpandedBe = (beCode: string) => setExpandedBe((prev) => {
    const next = new Set(prev)
    if (next.has(beCode)) next.delete(beCode); else next.add(beCode)
    return next
  })
  // Measured pixel size of the treemap's own container — the layout is computed in real pixels
  // (not percentages) so cut positions land exactly on rectangle edges at any container width.
  const treemapRef = React.useRef<HTMLDivElement>(null)
  const [treemapWidth, setTreemapWidth] = React.useState(0)
  const paretoRef = React.useRef<HTMLDivElement>(null)
  const [paretoWidth, setParetoWidth] = React.useState(0)
  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc') }
    else setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
  }
  const SortIcon = ({ k }: { k: SortKey }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )

  // Shared by every view (heatmap, Pareto, list), so the same debtor is never colored differently
  // depending on which view is open — 4 fixed, discrete swatches, no gradient.
  const categoryRange = (key: Category) => {
    if (key === 'critical') return `≥${CATEGORY_MAJOR_PCT}%`
    if (key === 'serious') return `${CATEGORY_MEDIUM_PCT}–${CATEGORY_MAJOR_PCT}%`
    if (key === 'warning') return `0–${CATEGORY_MEDIUM_PCT}%`
    return '0%'
  }
  const ColorLegend = () => (
    <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
      {CATEGORY_LIST.map((c) => (
        <span key={c.key} className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: CATEGORY_COLOR[c.key], display: 'inline-block', flex: 'none' }} />
          <span className="muted">{t(c.labelKey, c.fallback)} <span style={{ fontVariantNumeric: 'tabular-nums' }}>({categoryRange(c.key)})</span></span>
        </span>
      ))}
    </div>
  )

  React.useEffect(() => {
    if (view !== 'heatmap') return
    const el = treemapRef.current
    if (!el) return
    const update = () => setTreemapWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // `loading`: a Unitate/Proprietar or period switch unmounts the chart behind the loading
    // placeholder — re-attach to the NEW container once it's back, or the width stays 0 (blank chart).
  }, [view, loading])

  React.useEffect(() => {
    if (view !== 'pareto') return
    const el = paretoRef.current
    if (!el) return
    const update = () => setParetoWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
    // `loading`: a Unitate/Proprietar or period switch unmounts the chart behind the loading
    // placeholder — re-attach to the NEW container once it's back, or the width stays 0 (blank chart).
  }, [view, loading])

  React.useEffect(() => {
    if (!communityId) return
    // Wait for the global period selector to resolve before fetching, so this doesn't briefly
    // load the "latest statement" default and then flash to the actually-selected period.
    if (shared && !selectedCode) return
    let alive = true
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedCode) params.set('period', selectedCode)
    if (mode === 'unit') params.set('groupBy', 'unit')
    const q = params.toString() ? `?${params.toString()}` : ''
    api.get<any>(`/communities/${communityId}/finance/receivables${q}`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    setUnitRows([])
    if (mode === 'be') {
      const up = new URLSearchParams(params); up.set('groupBy', 'unit')
      api.get<any>(`/communities/${communityId}/finance/receivables?${up.toString()}`)
        .then((d: any) => { if (alive) setUnitRows(d?.debtors ?? []) })
        .catch(() => { if (alive) setUnitRows([]) })
    }
    return () => { alive = false }
  }, [api, communityId, selectedCode, shared, mode])
  const unitsByBe = React.useMemo(() => {
    const m = new Map<string, any[]>()
    for (const u of unitRows) if (u.beCode) m.set(u.beCode, [...(m.get(u.beCode) ?? []), u])
    for (const list of m.values()) list.sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    return m
  }, [unitRows])

  const sortedDebtors = React.useMemo(() => {
    const list: any[] = data?.debtors ?? []
    const sign = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0)))
  }, [data, sortKey, sortDir])

  // A unit-mode row has no `beCode` uniqueness guarantee (a multi-unit owner repeats it) — key and
  // label switch to the unit's own identity in that mode. Labels follow the avizier (`beLabel`):
  // the primary line is the unit code(s) — or the admin-set displayName, e.g. "AP 12" for a
  // 3-unit entity — and the owner name is the secondary line, shown only when "Nume" is on.
  const rowKey = (d: any) => (mode === 'unit' ? d.unitCode : d.beCode)
  const rowLabelParts = (d: any): { primary: string; secondary?: string } => {
    // `|| ''`: right after a Unitate/Proprietar switch the rows are briefly still the OTHER shape.
    if (mode === 'unit') return { primary: shortUnit(d.unitCode) || d.unitCode || d.beCode || '', secondary: prettyBe(d.beName) || d.beCode || undefined }
    return beLabel({ displayName: d.displayName, units: Array.isArray(d.unitCodes) ? d.unitCodes : [], beName: d.beName, beCode: d.beCode })
  }
  const rowLabel = (d: any) => rowLabelParts(d).primary
  const rowSecondary = (d: any) => (showNames ? rowLabelParts(d).secondary ?? null : null)
  // Short form for the Pareto chart's rotated per-bar axis labels — long owner names would be
  // unreadably long once rotated.
  const clip = (raw: string) => (!raw ? '' : raw.length > 24 ? `${raw.slice(0, 23)}…` : raw)
  const axisLabel = (d: any) => clip(rowLabel(d))
  const axisSecondary = (d: any) => { const s2 = rowSecondary(d); return s2 ? clip(s2) : null }

  // Pareto position per debtor: sort the FULL set by debt descending (independent of the list's
  // own sort toggle or the heatmap's CPI-tiebreak order) and take each one's running share of
  // total positive arrears — the input `heatColor` keys its severity band on, shared by every view
  // so the heatmap and the Pareto chart always color the same debtor the same way. `cumShare` only
  // feeds the Pareto chart's own cumulative line now — color categorization uses each debtor's OWN
  // pctOfTotal instead (see `categoryOf`), not this running total.
  const paretoOrder = React.useMemo(() => {
    const list: any[] = data?.debtors ?? []
    const positive = list.filter((d) => (Number(d.debt) || 0) > 0.005).sort((a, b) => (Number(b.debt) || 0) - (Number(a.debt) || 0))
    const total = positive.reduce((s, d) => s + Number(d.debt), 0)
    let running = 0
    return positive.map((d) => {
      running += Number(d.debt)
      return { ...d, cumShare: total > 0 ? running / total : 0 }
    })
  }, [data])
  // Rank (#) and running cumulative % per debtor, always in debt-descending order regardless of
  // the list's own sort toggle — the List view's "#" and "Cumulat %" columns read off this, same
  // source as the Pareto chart's line, so all three views agree on both numbers for a given debtor.
  const rankAndCumByKey = React.useMemo(() => {
    const m = new Map<string, { rank: number; cumPct: number }>()
    paretoOrder.forEach((d, i) => m.set(rowKey(d), { rank: i + 1, cumPct: (d.cumShare ?? 0) * 100 }))
    return m
  }, [paretoOrder, mode])
  const hasMissingCpi = React.useMemo(() => sortedDebtors.some((d) => d.cpi == null), [sortedDebtors])
  // Ceiling for the critical band's own shading — the worst debtor's pctOfTotal in this exact set.
  const maxPositivePct = React.useMemo(
    () => Math.max(CATEGORY_MAJOR_PCT + 0.01, ...sortedDebtors.map((d) => Number(d.pctOfTotal) || 0)),
    [sortedDebtors],
  )

  // List view groups debtors into the same 4 severity categories as the heatmap/Pareto colors,
  // each with its own subtotal (debt + CPI) and share of total arrears — sort order within a group
  // still follows the list's own toggle. `collapsed` only hides a group's member rows; the header
  // (and its subtotal) always stays visible.
  const [collapsed, setCollapsed] = React.useState<Set<Category>>(new Set())
  const toggleCollapsed = (key: Category) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const groupedByCategory = React.useMemo(() => {
    const totalPositive = sortedDebtors.reduce((s, d) => s + Math.max(0, Number(d.debt) || 0), 0)
    let runningPct = 0
    return CATEGORY_LIST.map((c) => {
      const rows = sortedDebtors.filter((d) => categoryOf(Number(d.debt) || 0, Number(d.pctOfTotal) || 0) === c.key)
      const subtotal = rows.reduce((s, d) => s + (Number(d.debt) || 0), 0)
      const subtotalPct = subtotal > 0 && totalPositive > 0 ? round1((subtotal / totalPositive) * 100) : 0
      const cpiSubtotal = rows.reduce((s, d) => s + (Number(d.cpi) || 0), 0)
      // Running total through this group, in the fixed critical->serious->warning->good order —
      // e.g. "Restanțe mari: 44.3%" then "Restanțe medii: 88.3%" (44.3% + medii's own share).
      runningPct += subtotalPct
      return { ...c, rows, subtotal, subtotalPct, cpiSubtotal, cumThroughGroup: round1(runningPct) }
    }).filter((g) => g.rows.length)
  }, [sortedDebtors])
  const listGrandTotal = React.useMemo(() => ({
    cpi: groupedByCategory.reduce((s, g) => s + g.cpiSubtotal, 0),
    debt: groupedByCategory.reduce((s, g) => s + g.subtotal, 0),
    pct: round1(groupedByCategory.reduce((s, g) => s + g.subtotalPct, 0)),
  }), [groupedByCategory])
  // Tile area is proportional to CPI (share of common ownership); a debtor with no recorded CPI
  // falls back to the set's own average rather than a fixed constant, so it still reads as a
  // "typical" unit's tile instead of an arbitrarily tiny or huge one. Traversal order is by
  // debt's share of total (pctOfTotal) descending, secondarily by CPI descending — independent of
  // the list's own sort toggle — so the heatmap always groups the worst debtors together, and
  // among equal shares (notably every 0%/paid-up row) the larger units lead.
  const treemapRects = React.useMemo(() => {
    if (!sortedDebtors.length || treemapWidth <= 0) return []
    const known = sortedDebtors.map((d) => Number(d.cpi)).filter((v) => Number.isFinite(v) && v > 0)
    const avgCpi = known.length ? known.reduce((s, v) => s + v, 0) / known.length : 1
    const items = [...sortedDebtors]
      .sort((a, b) => (Number(b.pctOfTotal) || 0) - (Number(a.pctOfTotal) || 0) || (Number(b.cpi) || 0) - (Number(a.cpi) || 0))
      .map((d) => ({ ...d, value: Number(d.cpi) > 0 ? Number(d.cpi) : avgCpi }))
    return buildTreemap(items, 0, 0, treemapWidth, HEATMAP_HEIGHT)
  }, [sortedDebtors, treemapWidth])

  // Pareto chart layout — the classic Pareto DUAL scale (the one broadly-recognized, expected
  // exception to "never dual-axis": bars and the cumulative line are two genuinely different
  // measures of the same ranking, always shown together this way). Bars are scaled to their OWN
  // maximum — the single biggest debtor's bar fills the full chart height — so every bar stays
  // legible even when the largest share is nowhere near 100%; the line stays on the plain 0–100%
  // cumulative scale, unchanged, which is what actually answers "how much of the total is this."
  // Always ordered by debt descending regardless of the list's own sort toggle, with every 0/credit
  // debtor appended at the flat 100% tail.
  const maxOwnPct = React.useMemo(
    () => Math.max(0.01, ...paretoOrder.map((d) => Number(d.pctOfTotal) || 0)),
    [paretoOrder],
  )
  const paretoBars = React.useMemo(() => {
    if (!data?.debtors?.length || paretoWidth <= 0) return []
    const zeroOrNeg = (data.debtors as any[]).filter((d) => (Number(d.debt) || 0) <= 0.005)
    const items = [...paretoOrder, ...zeroOrNeg]
    if (!items.length) return []
    const barW = Math.min(PARETO_BAR_WIDTH, (paretoWidth - PARETO_GAP * (items.length - 1)) / Math.max(1, items.length))
    return items.map((d, i) => {
      const x = i * (barW + PARETO_GAP)
      const ownPct = Math.max(0, Math.min(100, Number(d.pctOfTotal) || 0))
      const h = (ownPct / maxOwnPct) * PARETO_HEIGHT
      const cum = d.cumShare ?? 1
      return {
        key: rowKey(d), x, w: barW, h, y: PARETO_HEIGHT - h,
        cx: x + barW / 2, cy: PARETO_HEIGHT - cum * PARETO_HEIGHT,
        debt: d.debt, cpi: d.cpi, pctOfTotal: d.pctOfTotal, cumShare: cum,
        cat: categoryOf(Number(d.debt) || 0, Number(d.pctOfTotal) || 0),
        label: rowLabel(d), secondary: rowSecondary(d), axis: axisLabel(d), axis2: axisSecondary(d),
      }
    })
  }, [data, paretoOrder, paretoWidth, maxOwnPct, mode, showNames])
  // Vertical markers at the exact bar where the CUMULATIVE curve crosses 50% / 80% — the
  // color bands (which key off each debtor's own individual share, a different threshold set)
  // stay as they are; these markers answer a different question ("which debtors together cause
  // half the community's arrears") and belong on the cumulative line's own scale.
  // Placed AFTER the bar that pushes the cumulative total past 50%/80% (its right edge, `b.x + b.w`
  // — not before it, since the running total only actually exceeds the threshold once that bar's
  // own share is included), labeled with the EXACT cumulative value at that bar (e.g. "53.9%"),
  // not the round target — the real number the data lands on, not the abstract threshold.
  const paretoBoundaries = React.useMemo(() => {
    const out: { x: number; label: string }[] = []
    let crossed50 = false, crossed80 = false
    for (const b of paretoBars) {
      if (!crossed50 && b.cumShare > 0.5) { out.push({ x: b.x + b.w, label: pct(round1(b.cumShare * 100)) }); crossed50 = true }
      if (!crossed80 && b.cumShare > 0.8) { out.push({ x: b.x + b.w, label: pct(round1(b.cumShare * 100)) }); crossed80 = true }
    }
    return out
  }, [paretoBars])
  const paretoChartWidth = paretoBars.length ? paretoBars[paretoBars.length - 1].x + paretoBars[paretoBars.length - 1].w : paretoWidth
  // Label band sized to the longest axis label (~6px per char at 10px font) instead of a fixed
  // 190px, so short unit codes don't leave a tall empty strip under the chart.
  const paretoLabelBand = React.useMemo(
    () => Math.min(PARETO_LABEL_BAND, 12 + Math.max(0, ...paretoBars.map((b) => Math.max(String(b.axis ?? '').length, String(b.axis2 ?? '').length))) * 6),
    [paretoBars],
  )
  const paretoLinePoints = paretoBars.map((b) => `${b.cx},${b.cy}`).join(' ')

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>
  if (!data || !data.periodCode) return <div className="empty">{t('debtors.none', 'No statements yet — close a period to see debtors.')}</div>

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card ops-card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="muted">{t('debtors.total', 'Total outstanding (all funds)')} · {data.periodCode}</div>
            <strong style={{ fontSize: 22 }}>{money(data.totalDebt)}</strong>
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            {/* In debt / whole roster, at the grain currently shown (units vs billing entities) —
                `data.debtors` is refetched per mode and lists every active row, including 0/credit. */}
            <div className="muted">{mode === 'unit' ? t('debtors.count', 'Units with debt') : t('debtors.countBe', 'Billing entities with debt')}</div>
            <strong style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>
              {(data.debtors ?? []).filter((d: any) => (Number(d.debt) || 0) > 0.005).length} / {(data.debtors ?? []).length}
            </strong>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>{t('debtors.top', 'All debtors')}</h4>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
              <button type="button" className="btn ghost small"
                style={{ borderRadius: 0, background: mode === 'unit' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: mode === 'unit' ? 600 : 400 }}
                onClick={() => setMode('unit')}>
                {t('forecast.modeUnit', 'Unitate')}
              </button>
              <button type="button" className="btn ghost small"
                style={{ borderRadius: 0, background: mode === 'be' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: mode === 'be' ? 600 : 400 }}
                onClick={() => setMode('be')}>
                {t('forecast.modeOwner', 'Proprietar')}
              </button>
            </div>
            <button type="button" className="btn ghost small" onClick={() => setShowNames((v) => !v)}
              title={t('avizier.publicToggle', 'Mod public: ascunde numele proprietarilor (GDPR) pentru afișare/print')}
              aria-pressed={showNames} style={{ borderRadius: 999 }}>
              {showNames ? '☑ ' : '☐ '}{t('avizier.publicOff', 'Nume')}
            </button>
            <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
              <button type="button" className="btn ghost small"
                style={{ borderRadius: 0, background: view === 'list' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: view === 'list' ? 600 : 400 }}
                onClick={() => setView('list')}>
                {t('debtors.viewList', 'Listă')}
              </button>
              <button type="button" className="btn ghost small"
                style={{ borderRadius: 0, background: view === 'heatmap' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: view === 'heatmap' ? 600 : 400 }}
                onClick={() => setView('heatmap')}>
                {t('debtors.viewHeatmap', 'Heatmap')}
              </button>
              <button type="button" className="btn ghost small"
                style={{ borderRadius: 0, background: view === 'pareto' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: view === 'pareto' ? 600 : 400 }}
                onClick={() => setView('pareto')}>
                {t('debtors.viewPareto', 'Pareto')}
              </button>
            </div>
          </div>
        </div>

        {!sortedDebtors.length ? (
          <div className="empty">{t('debtors.clear', 'No debtors 🎉')}</div>
        ) : view === 'heatmap' ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>{t('debtors.heatmapHint', 'Tile size = CPI (share of common ownership); color = arrears size.')}</div>
            <div ref={treemapRef} style={{ position: 'relative', width: '100%', height: HEATMAP_HEIGHT, borderRadius: 8, overflow: 'hidden' }}>
              {treemapRects.map((r: any) => {
                const bg = heatColor(Number(r.debt) || 0, Number(r.pctOfTotal) || 0, maxPositivePct)
                const textColor = isLightColor(hexToRgb(bg)) ? '#1a1a19' : '#ffffff'
                const label = rowLabel(r)
                const secondary = rowSecondary(r)
                const showLabel = r.w >= 46 && r.h >= 30
                const fontSize = Math.max(10, Math.min(15, Math.min(r.w, r.h) / 6))
                return (
                  <div key={rowKey(r)}
                    onClick={onPick ? () => onPick(r) : undefined}
                    title={`${label}${secondary ? ` — ${secondary}` : ''} · ${money(r.debt)} · ${pct(r.pctOfTotal)} · CPI ${cpiFmt(r.cpi)}`}
                    style={{
                      position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h,
                      background: bg, boxSizing: 'border-box', border: '1px solid rgba(255,255,255,0.55)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', padding: 2, cursor: onPick ? 'pointer' : 'default',
                      color: textColor, textAlign: 'center', lineHeight: 1.2,
                    }}>
                    {showLabel ? (
                      <>
                        <span style={{ fontWeight: 700, fontSize }}>{label}</span>
                        {secondary ? <span style={{ fontWeight: 400, fontSize: fontSize * 0.75, opacity: 0.92, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</span> : null}
                        <span style={{ fontWeight: 500, fontSize: fontSize * 0.82, opacity: 0.92 }}>{money(r.debt)}</span>
                        {(Number(r.debt) || 0) > 0.005 ? <span style={{ fontWeight: 500, fontSize: fontSize * 0.75, opacity: 0.92 }}>{pct(r.pctOfTotal)}</span> : null}
                      </>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <ColorLegend />
            {hasMissingCpi ? <div className="muted" style={{ fontSize: 11 }}>{t('debtors.heatmapNoCpi', 'No CPI on file for some units — shown at default size.')}</div> : null}
          </div>
        ) : view === 'pareto' ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="muted" style={{ fontSize: 12 }}>{t('debtors.paretoHint', "Sorted by arrears, largest first. Bars = each debtor's own share of total arrears; the line = the running cumulative share.")}</div>
            <div ref={paretoRef} style={{ width: '100%', overflow: 'hidden' }}>
              <div style={{ position: 'relative', width: Math.max(paretoChartWidth, paretoWidth), height: PARETO_HEIGHT + paretoLabelBand }}>
                {[0.5, 0.8].map((frac) => (
                  <div key={frac} style={{ position: 'absolute', left: 0, right: 0, top: PARETO_HEIGHT - frac * PARETO_HEIGHT, borderTop: '1px solid var(--border, #ddd)' }} />
                ))}
                {paretoBoundaries.map((bnd, i) => (
                  <div key={i} style={{ position: 'absolute', left: bnd.x - 1, top: 0, height: PARETO_HEIGHT, borderLeft: '2px solid var(--text, #1a1a19)' }}>
                    <span style={{ position: 'absolute', left: 4, top: 2 + i * 14, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', background: 'var(--bg, #fff)', padding: '0 3px', borderRadius: 3 }}>{bnd.label}</span>
                  </div>
                ))}
                {paretoBars.map((b) => {
                  const bg = heatColor(Number(b.debt) || 0, Number(b.pctOfTotal) || 0, maxPositivePct)
                  return (
                    <div key={b.key}
                      onClick={onPick ? () => onPick(b) : undefined}
                      title={`${b.label}${b.secondary ? ` — ${b.secondary}` : ''} · ${money(b.debt)} · ${pct(b.pctOfTotal)} · ${t('debtors.paretoCumLabel', 'Cumulative %')} ${pct(round1(b.cumShare * 100))}`}
                      style={{
                        position: 'absolute', left: b.x, top: b.y, width: b.w, height: Math.max(2, b.h),
                        background: bg, cursor: onPick ? 'pointer' : 'default',
                        borderRadius: '3px 3px 0 0',
                      }}
                    />
                  )
                })}
                <svg width={Math.max(paretoChartWidth, paretoWidth)} height={PARETO_HEIGHT} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}>
                  <polyline points={paretoLinePoints} fill="none" stroke="var(--text, #1a1a19)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {paretoBars.length ? (
                    <>
                      <circle cx={paretoBars[0].cx} cy={paretoBars[0].cy} r={4} fill="var(--text, #1a1a19)" stroke="var(--bg, #fff)" strokeWidth={2} />
                      <circle cx={paretoBars[paretoBars.length - 1].cx} cy={paretoBars[paretoBars.length - 1].cy} r={4} fill="var(--text, #1a1a19)" stroke="var(--bg, #fff)" strokeWidth={2} />
                    </>
                  ) : null}
                </svg>
                {/* Per-bar axis label (unit label, plus the owner name as a 2nd line when "Nume" is
                    on), hung directly under its bar: vertical-rl + rotate(180deg) makes the text
                    read bottom-to-top with its END flush against the axis, and — unlike a transform on a
                    horizontal box — the element's layout box IS the rotated text, so nothing
                    overflows the band (no vertical scrollbar on the container). */}
                {paretoBars.map((b) => (
                  <div key={`lbl-${b.key}`} style={{
                    position: 'absolute', left: b.cx - (b.axis2 ? 12 : 6), top: PARETO_HEIGHT + 4, width: b.axis2 ? 24 : 12,
                    writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap',
                    // 'end' = bottom before the 180° turn = right under the axis after it, so every
                    // line (unit AND owner name, whatever their lengths) ends flush with the axis.
                    textAlign: 'end',
                    fontSize: 10, lineHeight: '12px', color: 'var(--muted, #666)',
                  }}>
                    {b.axis}
                    {/* Owner name as a second line — "under" the unit label once rotated. */}
                    {b.axis2 ? <><br /><span style={{ opacity: 0.8 }}>{b.axis2}</span></> : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 6, alignItems: 'center', fontSize: 11 }}>
              <div style={{ width: 18, height: 2, background: 'var(--text, #1a1a19)', display: 'inline-block' }} />
              <span className="muted">{t('debtors.paretoCumLabel', 'Cumulative %')}</span>
            </div>
            <ColorLegend />
            {hasMissingCpi ? <div className="muted" style={{ fontSize: 11 }}>{t('debtors.heatmapNoCpi', 'No CPI on file for some units — shown at default size.')}</div> : null}
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>#</th>
                  <th style={{ padding: '6px 8px' }}>{mode === 'unit' ? t('forecast.modeUnit', 'Unitate') : t('debtors.entity', 'Billing entity')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('avizier.cpiLabel', 'CPI')}</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.debt', 'Arrears')}<SortIcon k="debt" /></th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.pct', '% of total')}<SortIcon k="pctOfTotal" /></th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.paretoCumLabel', 'Cumulative %')}</th>
                </tr>
              </thead>
              {groupedByCategory.map((g) => {
                const [gr, gg, gb] = hexToRgb(CATEGORY_COLOR[g.key])
                const isCollapsed = collapsed.has(g.key)
                return (
                  <tbody key={g.key}>
                    <tr onClick={() => toggleCollapsed(g.key)} style={{ cursor: 'pointer' }} title={isCollapsed ? t('avizier.expColExpand', 'Expand') : t('avizier.expColCollapse', 'Collapse')}>
                      <td style={{ padding: '6px 8px', background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)' }} />
                      <td style={{ padding: '6px 8px', background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)', fontWeight: 600 }}>
                        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <span className="muted" style={{ fontSize: 10, width: 10, textAlign: 'center', flex: 'none' }}>{isCollapsed ? '▸' : '▾'}</span>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: CATEGORY_COLOR[g.key], display: 'inline-block', flex: 'none' }} />
                          {t(g.labelKey, g.fallback)}
                          <span className="muted" style={{ fontWeight: 400 }}>({g.rows.length})</span>
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)' }}>{cpiFmt(g.cpiSubtotal)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)' }}>{money(g.subtotal)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)' }}>{pct(g.subtotalPct)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, background: `rgba(${gr},${gg},${gb},0.12)`, borderTop: '2px solid var(--border, #ddd)' }}>{pct(g.cumThroughGroup)}</td>
                    </tr>
                    {!isCollapsed && g.rows.map((d: any) => {
                      const rc = rankAndCumByKey.get(rowKey(d))
                      const units = mode === 'be' ? (unitsByBe.get(d.beCode) ?? []) : []
                      const expandable = units.length > 1
                      const isExpanded = expandable && expandedBe.has(d.beCode)
                      return (
                        <React.Fragment key={rowKey(d)}>
                        <tr
                          onClick={onPick ? () => onPick(d) : undefined}
                          style={{ borderTop: '1px solid var(--border, #eee)', cursor: onPick ? 'pointer' : undefined }}
                          title={onPick ? t('debtors.pick', 'Înregistrează încasare') : undefined}>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{rc ? rc.rank : '—'}</td>
                          <td style={{ padding: '6px 8px', cursor: expandable ? 'pointer' : undefined }}
                            onClick={expandable ? (e) => { e.stopPropagation(); toggleExpandedBe(d.beCode) } : undefined}
                            title={expandable ? (isExpanded ? t('avizier.collapseUnits', 'Ascunde unitățile') : t('avizier.expandUnits', 'Arată unitățile')) : undefined}>
                            <span className="row" style={{ gap: 4, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                              {expandable ? <span className="muted" style={{ fontSize: 12, width: 10, flex: 'none' }}>{isExpanded ? '▾' : '▸'}</span> : null}
                              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <span>{rowLabel(d)}</span>
                                {rowSecondary(d) ? <span className="muted" style={{ fontSize: 12 }}>{rowSecondary(d)}</span> : null}
                              </span>
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{cpiFmt(d.cpi)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.debt)}{onPick ? ' ›' : ''}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{pct(d.pctOfTotal)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{rc ? pct(round1(rc.cumPct)) : '—'}</td>
                        </tr>
                        {/* The entity's individual units (same figures as the Unitate view), indented
                            under it; no rank/cumulative — those belong to the entity row. */}
                        {isExpanded && units.map((u: any) => (
                          <tr key={`${d.beCode}-${u.unitCode}`} style={{ background: 'var(--muted-bg, #f7f7f8)', fontSize: 12 }}>
                            <td />
                            <td style={{ padding: '4px 8px 4px 28px' }}>{shortUnit(u.unitCode) || u.unitCode}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{cpiFmt(u.cpi)}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(u.debt)}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{(Number(u.debt) || 0) > 0.005 ? pct(u.pctOfTotal) : '—'}</td>
                            <td />
                          </tr>
                        ))}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                )
              })}
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-strong, #999)', fontWeight: 700 }}>
                  <td style={{ padding: '6px 8px' }} />
                  <td style={{ padding: '6px 8px' }}>{t('avizier.total', 'Total')}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{cpiFmt(listGrandTotal.cpi)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(listGrandTotal.debt)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(listGrandTotal.pct)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(100)}</td>
                </tr>
              </tfoot>
            </table>
            <ColorLegend />
          </div>
        )}
      </div>
    </div>
  )
}
