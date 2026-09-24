import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { usePeriodOptional } from '../../contexts/PeriodContext'
import { beLabel, shortUnit, prettyBe } from './beLabel'

// #13 v2 Risk exposure ("risc de expunere"): every unit's live restanță, aged and broken down by
// EVERY fund (not just penalty-configured ones) — see reports.service.riskExposureDetail /
// PenaltyReconciliationService. Anchored live to the ledger, so it can never disagree with the
// avizier/debtors views the way the old PenaltyBucket-only report could.
export type Slice = {
  originKey: string; originPeriodCode: string | null; dueDate: string | null; firstPenalDay: string
  principal: number; ageDays: number; ratePerDayPct: number; penaltyProjected: number
}
type FundCell = { liveTotal: number; anchorTrusted: boolean; weightedAgeDays: number; tier: string; tierLabel: string; penaltyProjected: number; slices: Slice[] }
// `order` = the association's own configured display order (Unit.order / BillingEntity.order —
// same column the avizier's own default row order already follows) — every ACTIVE unit/owner now
// carries one (backend fix 2026-09: a unit/BE sitting at exactly zero on every fund this period
// used to be silently absent from these arrays entirely, not just orderless).
type UnitRow = { unitId: string; unitCode: string; beCode: string | null; beName: string | null; byFund: Record<string, FundCell>; outstanding: number; weightedAgeDays: number; order: number }
// BE-grain row for "Proprietar" mode — computed backend-side (reconcileBeFund), NOT pooled from
// unit rows client-side: a multi-unit BE whose per-unit split can't be trusted for this period
// shows zero on each of its unit rows (matching what avizier's own unit-mode view shows for those
// units — see resolveLiveTotal's doc), so summing unit rows client-side would silently UNDER-count
// exactly the BEs this mode most needs to surface. The backend's owner row is always the real,
// unambiguous BE total instead.
type OwnerRow = { beId: string; beCode: string | null; beName: string | null; displayName?: string | null; unitCodes: string[]; byFund: Record<string, FundCell>; outstanding: number; weightedAgeDays: number; order: number }
export type FundMeta = { fundId: string; fundCode: string; fundName: string; hasRateSchedule: boolean }
export type TierMeta = { key: string; label: string; hint?: string; tone?: string; count: number; outstanding: number; maxDays: number | null }
type FundCheck = { fundCode: string; reconciled: number; avizier: number; residual: number; ok: boolean }
type Report = {
  period: { code: string; status: string } | null
  funds: FundMeta[]
  units: UnitRow[]
  owners: OwnerRow[]
  tiers: TierMeta[]
  totals: { count: number; outstanding: number }
  checks: { byFund: FundCheck[]; allOk: boolean }
}

// One table row, mode-independent: either a single unit or an owner's units pooled together —
// both shapes reduce to "a label, a set of unit codes, and a byFund breakdown" so the rest of the
// component (sorting, filtering, the fund/age tables, the expand drilldowns) never needs to know
// which mode produced it.
type Row = { key: string; beCode?: string | null; label: { primary: string; secondary?: string }; unitCodes: string[]; byFund: Record<string, FundCell>; outstanding: number; weightedAgeDays: number; order: number }

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ro-RO') : '—')
// Verde / Galben / Portocaliu / Roșu — four clearly distinct hues per tier, not two shades of orange.
const TONE: Record<string, string> = { success: '#16a34a', warning: '#eab308', orange: '#f97316', destructive: '#dc2626' }
export const toneColor = (tone?: string) => TONE[tone || ''] || 'var(--muted, #888)'
// Pure lookup (usable outside the component, e.g. per-bucket rows in the expand drilldown, and by
// AvizierPanel's own restanță-cell drilldown, which reuses this same tiering) — mirrors the
// component's own tierOfDays callback, which just closes over `data.tiers`.
export const tierForDays = (tiers: TierMeta[], days: number) => tiers.find((tr) => tr.maxDays == null || days <= tr.maxDays) ?? tiers[tiers.length - 1]
const RO_MONTHS = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec']
const monthLabel = (code?: string | null) => {
  const m = code ? /^(\d{4})-(\d{2})$/.exec(code) : null
  return m ? `${RO_MONTHS[Number(m[2]) - 1]} ${m[1]}` : code
}

function SortArrow({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return null
  return <span style={{ marginLeft: 3, fontSize: 10 }}>{dir === 'desc' ? '▼' : '▲'}</span>
}

// Always renders a same-size dot — transparent (not omitted) for a no-risk tier — so a column of
// money figures stays aligned whether or not any given row happens to carry risk; only a genuine
// risk tier paints it and gets the hover label. `total`, when passed (row/footer callers only, not
// a single fund cell), triggers a different mark: real risk sits on at least one fund, but the
// row's own net total is zero or negative because a different fund is in credit — the debt is real
// and can't just cancel out against a surplus elsewhere, so flag it instead of a dot that would
// otherwise (correctly, but confusingly) vanish right where the Total column reads "nothing owed".
function RiskDotSpan({ tier, total, size = 8, t }: { tier?: TierMeta | null; total?: number; size?: number; t?: (k: string, d?: string) => string }) {
  const show = !!tier && tier.tone !== 'success'
  if (show && total != null && total <= 0.005) {
    const hint = t ? t('riskDetail.needsRedistribution', 'Există risc pe unele fonduri, dar totalul e zero sau negativ — administratorul trebuie să redistribuie fondurile') : undefined
    return <span title={hint} style={{ color: toneColor(tier!.tone), fontWeight: 700, flexShrink: 0 }}>⚠</span>
  }
  return (
    <span
      title={show ? tier!.label : undefined}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: show ? toneColor(tier!.tone) : 'transparent', flexShrink: 0 }}
    />
  )
}

const fmtDaysPrecise = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Shared "medie / max" subtitle under every money figure that has an age behind it (fund cells,
// row Total, footer TOTAL) — rounded to whole days on screen (a fraction of a day tells nobody
// anything at a glance), silently omitted when there's nothing to show (0z reads as noise, not
// information, on an empty or same-day cell), full un-rounded precision on hover so the exact
// figures are still one hover away.
function AgeSubtitle({ avg, max, t }: { avg: number; max: number; t: (k: string, d?: string) => string }) {
  const avgR = Math.round(avg)
  const maxR = Math.round(max)
  if (avgR <= 0 && maxR <= 0) return null
  const parts = [avgR > 0 ? `${avgR}z` : null, maxR > 0 ? `${maxR}z` : null].filter(Boolean)
  const title = `${t('riskDetail.avgLabel', 'Vechime medie')}: ${fmtDaysPrecise(avg)}z · ${t('riskDetail.maxLabel', 'Vechime maximă')}: ${fmtDaysPrecise(max)}z`
  return <div className="muted" style={{ fontSize: 10, fontWeight: 400 }} title={title}>{parts.join(' / ')}</div>
}

export function RiskPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN'

  // Follows the global period selector (top bar) like the other money reports; the local dropdown
  // is only a fallback when this panel is rendered outside a PeriodProvider.
  const shared = usePeriodOptional()
  const [periods, setPeriods] = React.useState<any[]>([])
  const [localPeriod, setPeriod] = React.useState('')
  const hasShared = !!shared // boolean for effect deps — the context value's identity may change per render
  const period = shared ? shared.selectedCode : localPeriod
  const [data, setData] = React.useState<Report | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [expanded, setExpanded] = React.useState<{ key: string; fundCode: string } | null>(null)
  const [reconcileFor, setReconcileFor] = React.useState<{ unitCode?: string; fundCode?: string } | null>(null)
  const [viewMode, setViewMode] = React.useState<'fund' | 'age'>('fund')
  const [rowMode, setRowMode] = React.useState<'unit' | 'owner'>('unit')
  const [expandedTier, setExpandedTier] = React.useState<{ key: string; tierKey: string } | null>(null)
  const [filterText, setFilterText] = React.useState('')
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const [fullscreen, setFullscreen] = React.useState(false)
  // Which tier cards are "in scope" — MULTI-select (e.g. Penalități + Sarcină în CF + Instanță = every
  // row accruing penalties); empty = every row (the gray "Toate" card). Clicking a card toggles it.
  const [tierFilter, setTierFilter] = React.useState<Set<string>>(new Set())
  const toggleTierFilter = (key: string) => setTierFilter((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  // Same "Nume" toggle as the avizier / restanțieri: owner names hidden by default, shown on their
  // own line under the unit / billing-entity label.
  const [showNames, setShowNames] = React.useState(false)
  // Proprietar mode: multi-unit billing entities expand into their individual unit rows.
  const [expandedOwners, setExpandedOwners] = React.useState<Set<string>>(new Set())
  const toggleOwner = (key: string) => setExpandedOwners((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  // Deselected columns (`fund:<code>` / `tier:<key>`): still shown (dimmed, so they can be re-selected)
  // but left out of the "Total selecție" column — e.g. keep only Sarcină în CF + Instanță to read the
  // exact amount to register in the Carte Funciară.
  const [hiddenCols, setHiddenCols] = React.useState<Set<string>>(new Set())
  const toggleCol = (key: string) => setHiddenCols((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Escape exits fullscreen — same convention as Avizier's own toggle.
  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  // Same 4 risk tiers as the fund matrix (`RISK_TIER_META`, via data.tiers) — but classified at
  // the SLICE level (each restanță has its own ageDays), per the association's request for a
  // per-risk-level breakdown alongside the per-fund one, not a coarser per-fund-average tiering.
  const tierOfDays = React.useCallback((days: number) => tierForDays(data?.tiers ?? [], days), [data])

  // Base rows for both row modes — one per unit, one per owner. Owner rows come straight from the
  // backend's own BE-grain reconciliation (`data.owners`), not a client-side sum of unit rows — see
  // OwnerRow's own doc for why pooling client-side would silently under-count. Unit rows are always
  // built too: in Proprietar mode they're the expanded children of a multi-unit owner.
  const unitRows: Row[] = React.useMemo(() => (data?.units ?? []).map((u) => ({
    key: u.unitId,
    beCode: u.beCode,
    label: { primary: shortUnit(u.unitCode) || u.unitCode, secondary: prettyBe(u.beName ?? '') || u.beCode || undefined },
    unitCodes: [u.unitCode],
    byFund: u.byFund,
    outstanding: u.outstanding,
    weightedAgeDays: u.weightedAgeDays,
    order: u.order,
  })), [data])
  const ownerRows: Row[] = React.useMemo(() => (data?.owners ?? []).map((o) => ({
    key: o.beId,
    beCode: o.beCode,
    label: beLabel({ displayName: o.displayName, beCode: o.beCode ?? undefined, beName: o.beName ?? undefined, units: o.unitCodes }),
    unitCodes: o.unitCodes,
    byFund: o.byFund,
    outstanding: o.outstanding,
    weightedAgeDays: o.weightedAgeDays,
    order: o.order,
  })), [data])
  const rows: Row[] = rowMode === 'unit' ? unitRows : ownerRows
  const allRows = React.useMemo(() => [...unitRows, ...ownerRows], [unitRows, ownerRows])
  const unitsByBeCode = React.useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const u of unitRows) if (u.beCode) m.set(u.beCode, [...(m.get(u.beCode) ?? []), u])
    for (const list of m.values()) list.sort((a, b) => a.order - b.order)
    return m
  }, [unitRows])

  // Per-row risk-tier breakdown ("Pe vechime"): every slice across every fund a row touches,
  // reclassified by its OWN age and summed per tier — works identically for a unit row or a
  // pooled owner row since both already carry the same byFund[...].slices shape.
  const rowTierData = React.useMemo(() => {
    const map = new Map<string, { byTier: Record<string, { total: number; slices: (Slice & { fundCode: string })[] }>; total: number }>()
    if (!data) return map
    for (const row of allRows) {
      const byTier: Record<string, { total: number; slices: (Slice & { fundCode: string })[] }> = {}
      for (const tr of data.tiers) byTier[tr.key] = { total: 0, slices: [] }
      let total = 0
      for (const fundCode of Object.keys(row.byFund)) {
        const cell = row.byFund[fundCode]
        for (const s of cell.slices) {
          if (s.principal <= 0.005) continue
          const tier = tierOfDays(s.ageDays)
          if (!tier) continue
          const bucket = byTier[tier.key]
          bucket.total = round2(bucket.total + s.principal)
          bucket.slices.push({ ...s, fundCode })
          total = round2(total + s.principal)
        }
      }
      map.set(row.key, { byTier, total })
    }
    return map
  }, [data, allRows, tierOfDays])

  // Oldest single slice each row is carrying, across every fund — the average alone hides a single
  // very old restanță sitting behind a pile of fresh ones, so the "max" figure shown alongside it is
  // what flags real risk for the row-level dot markers below (and the footer's own max-age figure).
  const rowMaxAge = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const row of allRows) {
      let max = 0
      for (const fundCode of Object.keys(row.byFund)) {
        for (const s of row.byFund[fundCode].slices) {
          if (s.principal <= 0.005) continue
          if (s.ageDays > max) max = s.ageDays
        }
      }
      map.set(row.key, max)
    }
    return map
  }, [allRows])

  const colsKeys = viewMode === 'fund' ? (data?.funds ?? []).map((f) => `fund:${f.fundCode}`) : (data?.tiers ?? []).map((tr) => `tier:${tr.key}`)
  const hasSelection = colsKeys.some((k) => hiddenCols.has(k))
  const colCount = colsKeys.length + 2 + (hasSelection ? 1 : 0)
  // Sum of the row's still-selected columns — fund view: each fund's live total (credits included,
  // so it nets exactly like the Total column); age view: each selected tier's restanță.
  const selectedTotal = (row: Row) => viewMode === 'fund'
    ? round2((data?.funds ?? []).reduce((s, f) => s + (hiddenCols.has(`fund:${f.fundCode}`) ? 0 : (row.byFund[f.fundCode]?.liveTotal ?? 0)), 0))
    : round2((data?.tiers ?? []).reduce((s, tr) => s + (hiddenCols.has(`tier:${tr.key}`) ? 0 : (rowTierData.get(row.key)?.byTier[tr.key]?.total ?? 0)), 0))
  const filteredRows = React.useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return rows.filter((r) => {
      // A row qualifies for a tier filter iff it actually carries debt classified into that tier
      // (rowTierData — the exact same per-slice classification "Pe vechime" and the cards below
      // use), not by its single worst-age slice — so a row can qualify under more than one tier.
      if (tierFilter.size) {
        const byTier = rowTierData.get(r.key)?.byTier
        if (![...tierFilter].some((k) => (byTier?.[k]?.total ?? 0) > 0.005)) return false
      }
      if (!q) return true
      return r.unitCodes.some((c) => c.toLowerCase().includes(q)) ||
        r.label.primary?.toLowerCase().includes(q) ||
        r.label.secondary?.toLowerCase().includes(q)
    })
  }, [rows, filterText, tierFilter, rowTierData])

  const sortedRows = React.useMemo(() => {
    // No explicit sort chosen yet — default to the association's own configured order (the same
    // number now shown before each row's name), matching what the avizier itself defaults to,
    // rather than whatever order the backend's own risk-detail array happened to arrive in.
    if (!sortKey) return filteredRows.slice().sort((a, b) => a.order - b.order)
    const valueOf = (r: Row): number => {
      if (sortKey === 'total') return r.outstanding
      if (sortKey === 'age') return r.weightedAgeDays
      if (sortKey.startsWith('fund:')) return r.byFund[sortKey.slice(5)]?.liveTotal ?? 0
      if (sortKey.startsWith('tier:')) return rowTierData.get(r.key)?.byTier[sortKey.slice(5)]?.total ?? 0
      if (sortKey === 'sel') return selectedTotal(r)
      return 0
    }
    return filteredRows.slice().sort((a, b) => (valueOf(a) - valueOf(b)) * (sortDir === 'asc' ? 1 : -1))
  }, [filteredRows, sortKey, sortDir, rowTierData, hiddenCols, viewMode])

  // Weighted-average age across the visible rows, for the TOTAL footer's own age subtitle — same
  // weighting (by outstanding) each row already uses for its own weightedAgeDays, so the footer
  // reads as "the portfolio's own average", not a plain mean of already-weighted per-row averages.
  const footerWeightedAge = React.useMemo(() => {
    const totalOutstanding = sortedRows.reduce((s, r) => s + r.outstanding, 0)
    if (totalOutstanding <= 0.005) return 0
    return round2(sortedRows.reduce((s, r) => s + r.weightedAgeDays * r.outstanding, 0) / totalOutstanding)
  }, [sortedRows])

  const footerMaxAge = React.useMemo(
    () => sortedRows.reduce((m, r) => Math.max(m, rowMaxAge.get(r.key) ?? 0), 0),
    [sortedRows, rowMaxAge],
  )

  // Tier summary cards ("Fără risc — N unități, Total X") — the exact same per-slice
  // classification "Pe vechime" already uses (rowTierData), not a coarser "this row's single worst
  // tier": a unit with some fresh debt and some debt that's aged into e.g. "Sarcina în CF"
  // contributes its own fresh slice's amount to the "Fără risc" card AND that older slice's
  // amount to the "Sarcina în CF" card — a row can count toward, and contribute money to, more
  // than one card at once. Works identically for a unit row or a pooled owner row (both already
  // carry the same per-fund slices), so — unlike the old fractional owner-mode split — this needs
  // no separate branch or a per-unit lookup table, and rowMode doesn't even appear in the deps
  // below. Always community-wide (every row, not just the filtered/sorted ones — clicking a card
  // sets tierFilter, it doesn't shrink the cards' own counts, or a click could never un-filter back
  // to a tier that just emptied itself).
  const tierCards = React.useMemo(() => {
    const tiers = data?.tiers ?? []
    const map = new Map<string, { count: number; outstanding: number }>()
    for (const tr of tiers) map.set(tr.key, { count: 0, outstanding: 0 })
    for (const row of rows) {
      const rowTiers = rowTierData.get(row.key)
      if (!rowTiers) continue
      for (const tr of tiers) {
        const bucket = rowTiers.byTier[tr.key]
        if (!bucket || bucket.total <= 0.005) continue
        const entry = map.get(tr.key)
        if (entry) { entry.count += 1; entry.outstanding = round2(entry.outstanding + bucket.total) }
      }
    }
    return map
  }, [data, rows, rowTierData])

  React.useEffect(() => {
    if (!communityId || hasShared) return
    api.get<any[]>(`/communities/${communityId}/periods`)
      .then((rows: any[]) => setPeriods([...(rows || [])].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))))
      .catch(() => setPeriods([]))
  }, [api, communityId, hasShared])

  const load = React.useCallback(() => {
    if (!communityId) return
    // Wait for the global selector to resolve, or we'd briefly load the backend's default period.
    if (hasShared && !period) return
    setLoading(true)
    const qs = period ? `?period=${encodeURIComponent(period)}` : ''
    api.get<Report>(`/communities/${communityId}/reports/risk-detail${qs}`)
      .then((d: Report) => { setData(d); setLoading(false); if (!hasShared && !period && d.period?.code) setPeriod(d.period.code) })
      .catch(() => { setData(null); setLoading(false) })
  }, [api, communityId, period, hasShared])
  React.useEffect(() => { load() }, [load])

  // ── Row rendering, shared by both views and by owner rows' expanded unit children ──────────────
  const dim = (key: string): React.CSSProperties => (hiddenCols.has(key) ? { opacity: 0.3 } : {})
  // Header checkbox that (de)selects a column — separate from the header's own sort button.
  const colToggle = (k: string) => (
    <button type="button" onClick={() => toggleCol(k)}
      title={hiddenCols.has(k) ? t('riskDetail.colSelect', 'Include coloana în Total selecție') : t('riskDetail.colDeselect', 'Exclude coloana din Total selecție')}
      style={{ background: 'none', border: 'none', padding: 0, marginRight: 2, cursor: 'pointer', fontSize: 12, color: 'var(--muted, #666)' }}>
      {hiddenCols.has(k) ? '☐' : '☑'}
    </button>
  )
  const bucketAges = (slices: Slice[]) => {
    const live = slices.filter((s) => s.principal > 0.005)
    const p = live.reduce((s, x) => s + x.principal, 0)
    return { avg: p > 0.005 ? live.reduce((s, x) => s + x.principal * x.ageDays, 0) / p : 0, max: live.reduce((m, x) => Math.max(m, x.ageDays), 0) }
  }

  // Name cell — same shape as the avizier / restanțieri: unit or billing-entity label, owner name on
  // its own line below when "Nume" is on; a multi-unit owner gets the ▸/▾ expander.
  const renderNameCell = (row: Row, child: boolean) => {
    const units = !child && rowMode === 'owner' && row.beCode ? (unitsByBeCode.get(row.beCode) ?? []) : []
    const expandable = units.length > 1
    const isOpen = expandable && expandedOwners.has(row.key)
    return (
      <td style={{ textAlign: 'left', padding: child ? '4px 10px 4px 34px' : '6px 10px', cursor: expandable ? 'pointer' : undefined }}
        onClick={expandable ? () => toggleOwner(row.key) : undefined}
        title={expandable ? (isOpen ? t('avizier.collapseUnits', 'Ascunde unitățile') : t('avizier.expandUnits', 'Arată unitățile')) : undefined}>
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
          <RiskDotSpan tier={tierOfDays(rowMaxAge.get(row.key) ?? 0)} total={row.outstanding} t={t} />
          {!child ? <span className="muted" style={{ fontSize: 11, minWidth: 16, textAlign: 'right' }}>{row.order || ''}</span> : null}
          {expandable ? <span className="muted" style={{ fontSize: 11, width: 10 }}>{isOpen ? '▾' : '▸'}</span> : null}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontWeight: child ? 400 : 600 }}>{row.label.primary}</span>
            {showNames && !child && row.label.secondary ? <span className="muted" style={{ fontSize: 11 }}>{row.label.secondary}</span> : null}
          </span>
        </span>
      </td>
    )
  }

  const renderSelectedTotalCell = (row: Row) => hasSelection ? (
    <td style={{ padding: '6px 10px', fontWeight: 700, background: 'var(--muted-bg, #f7f7f8)' }}>{money(selectedTotal(row))}</td>
  ) : null

  const renderFundRow = (row: Row, child: boolean) => {
    if (!data) return null
    const openFund = expanded?.key === row.key ? expanded.fundCode : null
    return (
      <React.Fragment key={row.key}>
        <tr style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right', ...(child ? { background: 'var(--muted-bg, #fafafa)', fontSize: 12 } : {}) }}>
          {renderNameCell(row, child)}
          {data.funds.map((f) => {
            const k = `fund:${f.fundCode}`
            const cell = row.byFund[f.fundCode]
            if (!cell || Math.abs(cell.liveTotal) <= 0.005) return <td key={f.fundId} style={{ padding: '6px 10px', ...dim(k) }} />
            // A row's visible cells must sum to its own Total column, same as the avizier itself
            // (which never hides a negative/credit fund) — a fund the unit is actually AHEAD on
            // renders as plain credit text, not a button, rather than disappearing.
            if (cell.liveTotal < 0) {
              return <td key={f.fundId} style={{ padding: '6px 10px', color: 'var(--success,#16a34a)', ...dim(k) }}>{money(cell.liveTotal)}</td>
            }
            // Dot color keys off the OLDEST slice in this cell, not the cell's own (average-based)
            // tier — a single ancient bucket hiding behind several fresh ones must still flag red.
            const cellMaxAge = bucketAges(cell.slices).max
            const isFundOpen = openFund === f.fundCode
            return (
              <td key={f.fundId} style={{ padding: '6px 10px', ...dim(k) }}>
                <button
                  type="button"
                  onClick={() => setExpanded(isFundOpen ? null : { key: row.key, fundCode: f.fundCode })}
                  className="btn ghost small"
                  style={{ padding: '2px 6px', background: isFundOpen ? 'var(--muted-bg, #eef2ff)' : undefined, display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', fontSize: 'inherit' }}
                >
                  <span>{money(cell.liveTotal)}</span>
                  {!cell.anchorTrusted ? <span title={t('riskDetail.untrusted', 'Sumă neconfirmată per unitate — repartizată egal în cadrul entității')}>⚠</span> : null}
                  <RiskDotSpan tier={tierOfDays(cellMaxAge)} />
                </button>
                <AgeSubtitle avg={cell.weightedAgeDays} max={cellMaxAge} t={t} />
              </td>
            )
          })}
          <td style={{ padding: '6px 10px' }}>
            <div style={{ fontWeight: 700, color: row.outstanding > 0.005 ? undefined : 'var(--success,#16a34a)' }}>{money(row.outstanding)}</div>
            <AgeSubtitle avg={row.weightedAgeDays} max={rowMaxAge.get(row.key) ?? 0} t={t} />
          </td>
          {renderSelectedTotalCell(row)}
        </tr>
        {openFund ? (
          <tr>
            <td colSpan={colCount} style={{ padding: '4px 10px 14px', background: 'var(--muted-bg, #fafafa)' }}>
              <RowSliceTable
                row={row} funds={data.funds} tiers={data.tiers} onlyFundCode={openFund} t={t} isAdmin={isAdmin}
                onReconcile={row.unitCodes.length === 1 ? (fundCode) => setReconcileFor({ unitCode: row.unitCodes[0], fundCode }) : undefined}
              />
            </td>
          </tr>
        ) : null}
      </React.Fragment>
    )
  }

  const renderTierRow = (row: Row, child: boolean) => {
    if (!data) return null
    const tierData = rowTierData.get(row.key)
    const openTier = expandedTier?.key === row.key ? expandedTier.tierKey : null
    return (
      <React.Fragment key={row.key}>
        <tr style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right', ...(child ? { background: 'var(--muted-bg, #fafafa)', fontSize: 12 } : {}) }}>
          {renderNameCell(row, child)}
          {data.tiers.map((tr) => {
            const k = `tier:${tr.key}`
            const bucket = tierData?.byTier[tr.key]
            if (!bucket || bucket.total <= 0.005) return <td key={tr.key} style={{ padding: '6px 10px', ...dim(k) }} />
            const isTierOpen = openTier === tr.key
            const ages = bucketAges(bucket.slices)
            return (
              <td key={tr.key} style={{ padding: '6px 10px', ...dim(k) }}>
                <button
                  type="button"
                  onClick={() => setExpandedTier(isTierOpen ? null : { key: row.key, tierKey: tr.key })}
                  className="btn ghost small"
                  style={{ padding: '2px 6px', background: isTierOpen ? 'var(--muted-bg, #eef2ff)' : undefined, display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', fontSize: 'inherit' }}
                >
                  <span>{money(bucket.total)}</span>
                  <RiskDotSpan tier={tr} />
                </button>
                <AgeSubtitle avg={ages.avg} max={ages.max} t={t} />
              </td>
            )
          })}
          {/* row.outstanding, NOT tierData.total: tierData only sums slices from funds the row
              actually owes on, so a row that's ahead on one fund and behind on another would show
              a Total here that doesn't net the credit, disagreeing with the fund view and avizier. */}
          <td style={{ padding: '6px 10px' }}>
            <div style={{ fontWeight: 700, color: row.outstanding > 0.005 ? undefined : 'var(--success,#16a34a)' }}>{money(row.outstanding)}</div>
            <AgeSubtitle avg={row.weightedAgeDays} max={rowMaxAge.get(row.key) ?? 0} t={t} />
          </td>
          {renderSelectedTotalCell(row)}
        </tr>
        {openTier ? (
          <tr>
            <td colSpan={colCount} style={{ padding: '4px 10px 14px', background: 'var(--muted-bg, #fafafa)' }}>
              <RowTierSliceTable
                tierLabel={data.tiers.find((tr) => tr.key === openTier)?.label ?? openTier}
                entry={tierData?.byTier[openTier] ?? { total: 0, slices: [] }}
                funds={data.funds} t={t}
              />
            </td>
          </tr>
        ) : null}
      </React.Fragment>
    )
  }

  // A top-level row plus, when it's an expanded multi-unit owner, its unit rows right under it.
  const renderRowWithChildren = (row: Row) => {
    const render = viewMode === 'fund' ? renderFundRow : renderTierRow
    const children = rowMode === 'owner' && row.beCode && expandedOwners.has(row.key) ? (unitsByBeCode.get(row.beCode) ?? []) : []
    return (
      <React.Fragment key={row.key}>
        {render(row, false)}
        {children.length > 1 ? children.map((u) => render(u, true)) : null}
      </React.Fragment>
    )
  }

  const entityHeader = rowMode === 'owner' ? t('riskDetail.rowModeOwner', 'Proprietar') : t('risk.entity', 'Unitate')

  return (
    <div
      className="stack"
      style={fullscreen
        ? { gap: 12, position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg, #fff)', padding: 16, overflow: 'auto' }
        : { gap: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>
          {t('risk.title', 'Risc de expunere')}
          {data?.period?.status ? <span className="badge secondary" style={{ marginLeft: 8 }}>{data.period.status}</span> : null}
          {data?.checks ? (
            <span
              className={`badge ${data.checks.allOk ? 'secondary' : 'negative'}`}
              style={{ marginLeft: 8, fontWeight: 400 }}
              title={data.checks.allOk
                ? t('riskDetail.checksOkHint', 'Restanțele pe fiecare fond se potrivesc exact cu Avizierul lunii.')
                : data.checks.byFund.filter((c) => !c.ok).map((c) => `${c.fundCode}: ${c.reconciled} ≠ ${c.avizier} (Δ${c.residual})`).join(' · ')}
            >
              {data.checks.allOk ? t('riskDetail.checksOk', '✓ Verificat cu Avizierul') : t('riskDetail.checksFail', '⚠ Nepotrivire cu Avizierul')}
            </span>
          ) : null}
        </h4>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin ? (
            <button className="btn ghost small" onClick={() => setReconcileFor({})}>
              {t('riskDetail.reconcileAll', 'Reconciliază toate fondurile')}
            </button>
          ) : null}
          <input
            className="input" style={{ minWidth: 160 }}
            placeholder={t('riskDetail.filterPlaceholder', 'Filtrează unitate/proprietar…')}
            value={filterText} onChange={(e) => setFilterText(e.target.value)}
          />
          <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              type="button"
              className="btn ghost small"
              style={{ borderRadius: 0, background: rowMode === 'unit' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: rowMode === 'unit' ? 600 : 400 }}
              onClick={() => setRowMode('unit')}
            >
              {t('riskDetail.rowModeUnit', 'Unitate')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              style={{ borderRadius: 0, background: rowMode === 'owner' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: rowMode === 'owner' ? 600 : 400 }}
              onClick={() => setRowMode('owner')}
            >
              {t('riskDetail.rowModeOwner', 'Proprietar')}
            </button>
          </div>
          <button type="button" className="btn ghost small" onClick={() => setShowNames((v) => !v)}
            title={t('avizier.publicToggle', 'Mod public: ascunde numele proprietarilor (GDPR) pentru afișare/print')}
            aria-pressed={showNames} style={{ borderRadius: 999 }}>
            {showNames ? '☑ ' : '☐ '}{t('avizier.publicOff', 'Nume')}
          </button>
          <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              type="button"
              className="btn ghost small"
              style={{ borderRadius: 0, background: viewMode === 'fund' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: viewMode === 'fund' ? 600 : 400 }}
              onClick={() => setViewMode('fund')}
            >
              {t('riskDetail.viewFund', 'Pe fonduri')}
            </button>
            <button
              type="button"
              className="btn ghost small"
              style={{ borderRadius: 0, background: viewMode === 'age' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: viewMode === 'age' ? 600 : 400 }}
              onClick={() => setViewMode('age')}
            >
              {t('riskDetail.viewAge', 'Pe vechime')}
            </button>
          </div>
          {!hasShared ? (
            <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
            </select>
          ) : null}
          <button
            type="button" className="btn ghost small"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet (Esc)') : t('avizier.fullscreen', 'Ecran complet')}
          >
            {fullscreen ? '🗗 ' + t('avizier.exit', 'Închide') : '⛶ ' + t('avizier.fullscreen', 'Ecran complet')}
          </button>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {viewMode === 'fund'
          ? t('riskDetail.hint', 'Vechimea medie ponderată a restanțelor (de la scadență) încadrează fiecare unitate într-un nivel de risc, pe fiecare fond — inclusiv cele fără penalizare configurată.')
          : t('riskDetail.hintAge', 'Suma restanțelor fiecărei unități, pe fiecare nivel de risc — fiecare restanță e încadrată după propria vechime, însumată pe toate fondurile.')}
      </div>

      {loading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !data ? (
        <div className="empty">{t('risk.none', 'Fără date pentru această perioadă.')}</div>
      ) : (
        <>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button" onClick={() => setTierFilter(new Set())}
              className="card soft"
              style={{
                flex: 1, minWidth: 160, borderLeft: '3px solid var(--muted, #9ca3af)', textAlign: 'left', cursor: 'pointer', font: 'inherit',
                boxShadow: tierFilter.size === 0 ? '0 0 0 2px var(--muted, #9ca3af)' : undefined,
              }}
            >
              <div className="muted" style={{ fontSize: 12 }}>{t('riskDetail.allUnits', 'Toate unitățile')}</div>
              <strong style={{ fontSize: 22, color: 'var(--muted, #6b7280)' }}>{rows.length}</strong>
              <div className="muted" style={{ fontSize: 11 }}>{t('riskDetail.allUnitsHint', 'Fără filtru pe nivel de risc')}</div>
              <div style={{ fontSize: 12, marginTop: 2 }}>{money(round2(rows.reduce((s, r) => s + r.outstanding, 0)))}</div>
            </button>
            {data.tiers.map((tr) => {
              const card = tierCards.get(tr.key) ?? { count: 0, outstanding: 0 }
              const active = tierFilter.has(tr.key)
              return (
              <button
                key={tr.key} type="button" onClick={() => toggleTierFilter(tr.key)}
                className="card soft"
                title={t('riskDetail.cardMultiHint', 'Click pentru a selecta / deselecta — se pot combina mai multe niveluri')}
                style={{
                  flex: 1, minWidth: 160, borderLeft: `3px solid ${toneColor(tr.tone)}`, textAlign: 'left', cursor: 'pointer', font: 'inherit',
                  boxShadow: active ? `0 0 0 2px ${toneColor(tr.tone)}` : undefined,
                }}
              >
                <div className="muted" style={{ fontSize: 12 }}>{active ? '☑ ' : '☐ '}{tr.label}</div>
                <strong style={{ fontSize: 22, color: toneColor(tr.tone) }}>{card.count}</strong>
                <div className="muted" style={{ fontSize: 11 }}>{tr.hint}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{money(card.outstanding)}</div>
              </button>
              )
            })}
          </div>

          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>{entityHeader}</th>
                  {viewMode === 'fund' ? data.funds.map((f) => (
                    <th key={f.fundId} style={{ padding: '8px 10px', maxWidth: 120, ...dim(`fund:${f.fundCode}`) }}>
                      <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 2 }}>
                        {colToggle(`fund:${f.fundCode}`)}
                        <button
                          type="button" onClick={() => toggleSort(`fund:${f.fundCode}`)}
                          className="btn ghost small" style={{ padding: '2px 4px', fontWeight: 600, whiteSpace: 'normal', textAlign: 'right', lineHeight: 1.2 }}
                          title={`${f.fundCode}${!f.hasRateSchedule ? ' — ' + t('riskDetail.noRateHint', 'Fond fără penalizare configurată — doar vechime, nicio penalizare calculată') : ''}`}
                        >
                          {f.fundName}{!f.hasRateSchedule ? <span className="muted" style={{ marginLeft: 3 }}>·</span> : null}
                          <SortArrow active={sortKey === `fund:${f.fundCode}`} dir={sortDir} />
                        </button>
                      </span>
                    </th>
                  )) : data.tiers.map((tr) => (
                    <th key={tr.key} style={{ padding: '8px 10px', ...dim(`tier:${tr.key}`) }} title={tr.hint}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        {colToggle(`tier:${tr.key}`)}
                        <button type="button" onClick={() => toggleSort(`tier:${tr.key}`)} className="btn ghost small" style={{ padding: '2px 4px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {tr.tone !== 'success' ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toneColor(tr.tone), flexShrink: 0 }} /> : null}
                          {tr.label}
                          <SortArrow active={sortKey === `tier:${tr.key}`} dir={sortDir} />
                        </button>
                      </span>
                    </th>
                  ))}
                  {/* One "Total" column carries both the sum and its own weighted-age subtitle. */}
                  <th style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      <button type="button" onClick={() => toggleSort('total')} className="btn ghost small" style={{ padding: '2px 4px', fontWeight: 600 }}>
                        {t('riskDetail.total', 'Total')}<SortArrow active={sortKey === 'total'} dir={sortDir} />
                      </button>
                      <button type="button" onClick={() => toggleSort('age')} className="btn ghost small" style={{ padding: '0 4px', fontWeight: 400, fontSize: 11 }}>
                        {t('riskDetail.avgAge', 'Vechime medie')}<SortArrow active={sortKey === 'age'} dir={sortDir} />
                      </button>
                    </div>
                  </th>
                  {hasSelection ? (
                    <th style={{ padding: '8px 10px' }} title={t('riskDetail.selTotalHint', 'Suma doar pe coloanele bifate')}>
                      <button type="button" onClick={() => toggleSort('sel')} className="btn ghost small" style={{ padding: '2px 4px', fontWeight: 600 }}>
                        {t('riskDetail.selTotal', 'Total selecție')}<SortArrow active={sortKey === 'sel'} dir={sortDir} />
                      </button>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                {sortedRows.length === 0 ? (
                  <tr><td colSpan={colCount} className="muted" style={{ padding: 12, textAlign: 'center' }}>{t('risk.noRows', 'Nicio restanță urmărită.')}</td></tr>
                ) : sortedRows.map(renderRowWithChildren)}
                <tr style={{ borderTop: '2px solid var(--border, #ccc)', textAlign: 'right', fontWeight: 700, background: 'var(--muted-bg, #f4f4f5)' }}>
                  <td style={{ textAlign: 'left', padding: '8px 10px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <RiskDotSpan tier={tierOfDays(footerMaxAge)} total={sortedRows.reduce((s, r) => s + r.outstanding, 0)} t={t} />
                      {t('risk.total', 'TOTAL')} ({sortedRows.length})
                    </span>
                  </td>
                  {viewMode === 'fund' ? data.funds.map((f) => {
                    const sum = sortedRows.reduce((s, r) => s + (r.byFund[f.fundCode]?.liveTotal ?? 0), 0)
                    return <td key={f.fundId} style={{ padding: '8px 10px', ...dim(`fund:${f.fundCode}`) }}>{Math.abs(sum) > 0.005 ? money(round2(sum)) : ''}</td>
                  }) : data.tiers.map((tr) => {
                    const slices = sortedRows.flatMap((r) => rowTierData.get(r.key)?.byTier[tr.key]?.slices ?? [])
                    const sum = sortedRows.reduce((s, r) => s + (rowTierData.get(r.key)?.byTier[tr.key]?.total ?? 0), 0)
                    const ages = bucketAges(slices)
                    return (
                      <td key={tr.key} style={{ padding: '8px 10px', ...dim(`tier:${tr.key}`) }}>
                        {sum > 0.005 ? <><div>{money(round2(sum))}</div><AgeSubtitle avg={ages.avg} max={ages.max} t={t} /></> : ''}
                      </td>
                    )
                  })}
                  <td style={{ padding: '8px 10px' }}>
                    <div>{money(round2(sortedRows.reduce((s, r) => s + r.outstanding, 0)))}</div>
                    <AgeSubtitle avg={footerWeightedAge} max={footerMaxAge} t={t} />
                  </td>
                  {hasSelection ? <td style={{ padding: '8px 10px' }}>{money(round2(sortedRows.reduce((s, r) => s + selectedTotal(r), 0)))}</td> : null}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {reconcileFor ? (
        <ReconcileDialog
          communityId={communityId} periodCode={period} target={reconcileFor}
          onClose={() => setReconcileFor(null)} onApplied={() => { setReconcileFor(null); load() }}
          api={api} t={t}
        />
      ) : null}
    </div>
  )
}

// Shows only the buckets for ONE fund (`onlyFundCode`) — clicking a fund's amount in the matrix
// scopes straight to its own restanțe, not every fund's slices mixed together. Works for a
// single-unit row or a pooled owner row alike (the "Reconciliază" action only makes sense for a
// single, unambiguous unit, so it's hidden — via a missing `onReconcile` — for a pooled row).
function RowSliceTable({ row, funds, tiers, onlyFundCode, t, isAdmin, onReconcile }: {
  row: Row; funds: FundMeta[]; tiers: TierMeta[]; onlyFundCode: string; t: (k: string, d?: string) => string; isAdmin: boolean; onReconcile?: (fundCode: string) => void
}) {
  const fundMeta = funds.find((f) => f.fundCode === onlyFundCode)
  const cell = row.byFund[onlyFundCode]
  const slices = (cell?.slices ?? []).slice().sort((a, b) => new Date(a.firstPenalDay).getTime() - new Date(b.firstPenalDay).getTime())
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: 12 }}>{fundMeta?.fundName ?? onlyFundCode}</strong>
        {isAdmin && onReconcile ? (
          <button className="btn ghost small" onClick={() => onReconcile(onlyFundCode)}>
            {t('riskDetail.reconcileFund', 'Reconciliază')}
          </button>
        ) : null}
      </div>
      <SliceTable rows={slices} showFundColumn={false} weightedAgeDays={cell?.weightedAgeDays ?? 0} tiers={tiers} t={t} />
    </div>
  )
}

// "Pe vechime" drilldown: every slice that fell into ONE risk tier for one row, grouped and
// sorted by fund (per the association's request — a mix of funds in date order was confusing to
// read), with a subtotal per fund group and a grand total at the bottom.
function RowTierSliceTable({ tierLabel, entry, funds, t }: {
  tierLabel: string; entry: { total: number; slices: (Slice & { fundCode: string })[] }; funds: FundMeta[]; t: (k: string, d?: string) => string
}) {
  const fundOrder = new Map(funds.map((f, i) => [f.fundCode, i]))
  const fundName = new Map(funds.map((f) => [f.fundCode, f.fundName]))
  const byFund = new Map<string, (Slice & { fundCode: string })[]>()
  for (const s of entry.slices) {
    const arr = byFund.get(s.fundCode) ?? []
    arr.push(s)
    byFund.set(s.fundCode, arr)
  }
  const groupKeys = Array.from(byFund.keys()).sort((a, b) => (fundOrder.get(a) ?? 99) - (fundOrder.get(b) ?? 99))
  const totalP = entry.slices.reduce((s, r) => s + r.principal, 0)
  const weighted = totalP > 0.005 ? round2(entry.slices.reduce((s, r) => s + r.principal * r.ageDays, 0) / totalP) : 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: 12 }}>{tierLabel}</strong>
      </div>
      {!entry.slices.length ? <div className="muted" style={{ fontSize: 12 }}>{t('risk.noRows', 'Nicio restanță urmărită.')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'right', borderBottom: '1px solid var(--border,#ddd)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('riskDetail.colOrigin', 'Lună origine')}</th>
              <th style={{ padding: '4px 8px' }}>{t('riskDetail.colDue', 'Scadență')}</th>
              <th style={{ padding: '4px 8px' }}>{t('riskDetail.colDays', 'Zile')}</th>
              <th style={{ padding: '4px 8px' }}>{t('riskDetail.colPrincipal', 'Restanță')}</th>
              <th style={{ padding: '4px 8px' }}>{t('riskDetail.colRate', 'Procent/zi')}</th>
              <th style={{ padding: '4px 8px' }}>{t('riskDetail.colPenalty', 'Penalizare estimată')}</th>
            </tr>
          </thead>
          <tbody>
            {groupKeys.map((fundCode) => {
              const rows = (byFund.get(fundCode) ?? []).slice().sort((a, b) => new Date(a.firstPenalDay).getTime() - new Date(b.firstPenalDay).getTime())
              const groupP = rows.reduce((s, r) => s + r.principal, 0)
              return (
                <React.Fragment key={fundCode}>
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'left', padding: '6px 8px 2px', fontWeight: 700, color: 'var(--muted,#666)' }}>{fundName.get(fundCode) ?? fundCode}</td>
                  </tr>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border,#eee)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '4px 8px 4px 16px' }}>{monthLabel(r.originPeriodCode) ?? t('penledger.carriedOver', 'Restanță reportată')}</td>
                      <td style={{ padding: '4px 8px' }}>{fmtDate(r.dueDate)}</td>
                      <td style={{ padding: '4px 8px' }}>{r.ageDays}</td>
                      <td style={{ padding: '4px 8px' }}>{money(r.principal)}</td>
                      <td style={{ padding: '4px 8px' }}>{r.ratePerDayPct}%</td>
                      <td style={{ padding: '4px 8px', color: 'var(--danger,#b45309)' }}>{money(r.penaltyProjected)}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--border,#eee)', textAlign: 'right', fontStyle: 'italic' }}>
                    <td style={{ textAlign: 'left', padding: '2px 8px 6px 16px' }}>{t('riskDetail.fundSubtotal', 'Subtotal fond')}</td>
                    <td /><td />
                    <td style={{ padding: '2px 8px 6px' }}>{money(groupP)}</td>
                    <td />
                    <td style={{ padding: '2px 8px 6px', color: 'var(--danger,#b45309)' }}>{money(rows.reduce((s, r) => s + r.penaltyProjected, 0))}</td>
                  </tr>
                </React.Fragment>
              )
            })}
            <tr style={{ borderTop: '2px solid var(--border,#ccc)', textAlign: 'right', fontWeight: 700 }}>
              <td style={{ textAlign: 'left', padding: '5px 8px' }}>{t('riskDetail.total', 'Total')}</td>
              <td />
              <td style={{ padding: '5px 8px' }}>{weighted}z</td>
              <td style={{ padding: '5px 8px' }}>{money(totalP)}</td>
              <td />
              <td style={{ padding: '5px 8px', color: 'var(--danger,#b45309)' }}>{money(entry.slices.reduce((s, r) => s + r.penaltyProjected, 0))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

// Shared slice table body (origin month · scadență · zile · restanță · procent/zi · penalizare),
// with a totals/aggregation row — used by RowSliceTable (single fund, so no Fond column needed),
// and exported for AvizierPanel's own per-restanță drilldown (same bucket-level view, different
// entry point — a click on a fund's restanță cell in the main matrix, not a fund-cell expand here).
export function SliceTable({ rows, showFundColumn, weightedAgeDays, tiers, t }: {
  rows: (Slice & { fundCode?: string })[]; showFundColumn: boolean; weightedAgeDays: number; tiers: TierMeta[]; t: (k: string, d?: string) => string
}) {
  if (!rows.length) return <div className="muted" style={{ fontSize: 12 }}>{t('risk.noRows', 'Nicio restanță urmărită.')}</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
      <thead>
        <tr style={{ textAlign: 'right', borderBottom: '1px solid var(--border,#ddd)' }}>
          {showFundColumn ? <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('riskDetail.colFund', 'Fond')}</th> : null}
          <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('riskDetail.colOrigin', 'Lună origine')}</th>
          <th style={{ padding: '4px 8px' }}>{t('riskDetail.colDue', 'Scadență')}</th>
          <th style={{ padding: '4px 8px' }}>{t('riskDetail.colDays', 'Zile')}</th>
          <th style={{ padding: '4px 8px' }}>{t('riskDetail.colPrincipal', 'Restanță')}</th>
          <th style={{ padding: '4px 8px' }}>{t('riskDetail.colRate', 'Procent/zi')}</th>
          <th style={{ padding: '4px 8px' }}>{t('riskDetail.colPenalty', 'Penalizare estimată')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          // Each bucket shows its OWN risk dot here — the collapsed cell above only shows the
          // worst one among them, this is where you see which specific bucket earned it.
          const tier = tierForDays(tiers, r.ageDays)
          return (
          <tr key={i} style={{ borderTop: '1px solid var(--border,#eee)', textAlign: 'right' }}>
            {showFundColumn ? <td style={{ textAlign: 'left', padding: '4px 8px' }}>{r.fundCode}</td> : null}
            <td style={{ textAlign: 'left', padding: '4px 8px' }}>{monthLabel(r.originPeriodCode) ?? t('penledger.carriedOver', 'Restanță reportată')}</td>
            <td style={{ padding: '4px 8px' }}>{fmtDate(r.dueDate)}</td>
            <td style={{ padding: '4px 8px' }}>{r.ageDays}</td>
            <td style={{ padding: '4px 8px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                {money(r.principal)}
                <RiskDotSpan tier={tier} />
              </span>
            </td>
            <td style={{ padding: '4px 8px' }}>{r.ratePerDayPct}%</td>
            <td style={{ padding: '4px 8px', color: 'var(--danger,#b45309)' }}>{money(r.penaltyProjected)}</td>
          </tr>
          )
        })}
        <tr style={{ borderTop: '2px solid var(--border,#ccc)', textAlign: 'right', fontWeight: 700 }}>
          <td colSpan={showFundColumn ? 2 : 1} style={{ textAlign: 'left', padding: '5px 8px' }}>{t('riskDetail.total', 'Total')}</td>
          <td />
          <td style={{ padding: '5px 8px' }}>{weightedAgeDays}z</td>
          <td style={{ padding: '5px 8px' }}>{money(rows.reduce((s, r) => s + r.principal, 0))}</td>
          <td />
          <td style={{ padding: '5px 8px', color: 'var(--danger,#b45309)' }}>{money(rows.reduce((s, r) => s + r.penaltyProjected, 0))}</td>
        </tr>
      </tbody>
    </table>
  )
}

function ReconcileDialog({ communityId, periodCode, target, onClose, onApplied, api, t }: {
  communityId: string; periodCode: string; target: { unitCode?: string; fundCode?: string }
  onClose: () => void; onApplied: () => void; api: any; t: (k: string, d?: string) => string
}) {
  const [preview, setPreview] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [applying, setApplying] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    api.post(`/communities/${communityId}/reports/reconcile-penalties`, { periodCode, unitCode: target.unitCode, fundCode: target.fundCode, apply: false })
      .then((d: any) => { setPreview(d); setLoading(false) })
      .catch(() => { setPreview(null); setLoading(false) })
  }, [api, communityId, periodCode, target])

  const apply = () => {
    setApplying(true)
    api.post(`/communities/${communityId}/reports/reconcile-penalties`, { periodCode, unitCode: target.unitCode, fundCode: target.fundCode, apply: true })
      .then(() => { setApplying(false); onApplied() })
      .catch(() => setApplying(false))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 520, width: '90%', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h4 style={{ marginTop: 0 }}>
          {t('riskDetail.reconcileTitle', 'Reconciliere penalizări')}
          {target.unitCode ? <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>{shortUnit(target.unitCode)}{target.fundCode ? ` · ${target.fundCode}` : ''}</span> : null}
        </h4>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          {t('riskDetail.reconcileHint', 'Reface vechimea penalizărilor din restanța curentă a ledger-ului — nu modifică nimic până confirmi.')}
        </div>
        {loading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !preview ? (
          <div className="badge negative">{t('common.error', 'Error')}</div>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              {t('riskDetail.reconcilePairs', 'Unități/fonduri afectate')}: <strong>{preview.results?.length ?? 0}</strong>
            </div>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost small" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
              <button className="btn small" disabled={applying || !preview.results?.length} onClick={apply}>
                {applying ? t('common.loading', 'Loading…') : t('riskDetail.reconcileConfirm', 'Confirmă și scrie')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
