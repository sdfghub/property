import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { beLabel, shortUnit } from './beLabel'

// #13 v2 follow-up: "will next month's bill look like, and what do I already owe" — a per-target
// (unit or owner) forecast, backed by ReportsService.forecastReport. Row 0 is the current period
// and folds in every prior restanță; rows 1..N-1 are pure month-by-month projections — see the
// backend method's own doc for exactly what's a real invoice vs. an estimate. `confirmed` marks,
// per cell, whether it's a ledger fact (restanță + an already-generated charge) or a projection —
// only the former renders in full color, everything else renders gray (see `cellStyle`).
type FundColumn = { code: string; name: string }
type FundGroup = { key: string; label: string }
type CollectionPoint = { periodCode: string; amount: number }
// Încasat + Restanță = Colectat by construction; Grad Încasare = Încasat/Colectat,
// Grad de Colectare = Colectat/Țintă. See reports.service.ts's `collectionStats`.
type CollectionStats = {
  colectat: number; restanta: number; incasat: number
  gradIncasarePct: number | null; gradColectarePct: number | null
}
type FundInfo = {
  code: string; name: string; group: FundGroup
  perPeriodAmount: number | null
  startPeriodCode: string | null; periodCount: number | null; endPeriodCode: string | null; windowDerived: boolean; closed: boolean
  totalTarget: number | null; totalCollected: number | null; penaltyRatePct: number | null
  collectionChart: CollectionPoint[] | null
  association: CollectionStats | null
  selected: CollectionStats | null
}
type GroupTotal = { key: string; label: string; totalCollected: number }
type RowConfirmed = { expenses: boolean; penalties: boolean; funds: Record<string, boolean> }
type ForecastRow = {
  periodCode: string
  isCurrent: boolean
  emitere: string | null
  scadenta: string | null
  expenses: number
  penalties: number
  funds: Record<string, number>
  total: number
  confirmed: RowConfirmed
}
type Forecast = {
  months: number
  target: { type: 'unit' | 'be'; code: string; name: string | null } | null
  current: { code: string; status: string } | null
  expensesLabel: string | null
  penaltiesLabel: string | null
  fundColumns: FundColumn[]
  fundsInfo: FundInfo[]
  groupTotals: GroupTotal[]
  grandTotalCollected: number
  fundsSummary: { association: CollectionStats; selected: CollectionStats }
  rows: ForecastRow[]
  assumptions: string[]
}
// Just enough of risk-detail's payload to populate the unit/owner picker — reusing that endpoint
// instead of adding a second listing one (CLAUDE.md rule 4: no local code→label maps; these labels
// already come from the backend, this just avoids fetching them twice under two different routes).
type PickerUnit = { unitId: string; unitCode: string; beCode: string | null; beName: string | null }
type PickerOwner = { beId: string; beCode: string | null; beName: string | null; displayName?: string | null; unitCodes: string[] }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const money = (n?: number | null) => (n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const RO_MONTHS_SHORT = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec']
// "DD MMM YY", e.g. "11 Sep 26" — requested explicitly over a locale date so the month never reads
// ambiguous between day/month order.
const fmtDate = (d?: string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  const yy = String(dt.getUTCFullYear()).slice(-2)
  return `${dd} ${RO_MONTHS_SHORT[dt.getUTCMonth()]} ${yy}`
}
const monthLabel = (code?: string | null) => {
  const m = code ? /^(\d{4})-(\d{2})$/.exec(code) : null
  return m ? `${RO_MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}` : (code ?? '—')
}
// Unconfirmed (projected/estimated) cells render gray to set them apart from ledger-confirmed
// ones — the whole point of the distinction the report makes.
const cellStyle = (confirmed: boolean): React.CSSProperties =>
  confirmed ? {} : { color: 'var(--muted, #9ca3af)' }
// A column unticked from the total still shows its real amount, struck through, so excluding it
// is visibly reversible rather than looking like missing data.
const excludedStyle = (excluded: boolean): React.CSSProperties =>
  excluded ? { textDecoration: 'line-through', opacity: 0.55 } : {}

// Compact text form of a fund's real per-period collection history — consecutive periods with the
// same amount collapse into one range ("Apr-25 – Oct-25: 220.596,25") instead of repeating an
// unchanged figure month after month, which is what actually makes a plateaued (finished) fund's
// history short to read.
const formatCollectionSchedule = (points: CollectionPoint[]): string => {
  const groups: { from: string; to: string; amount: number }[] = []
  for (const p of points) {
    const prev = groups[groups.length - 1]
    if (prev && Math.abs(prev.amount - p.amount) < 0.01) prev.to = p.periodCode
    else groups.push({ from: p.periodCode, to: p.periodCode, amount: p.amount })
  }
  return groups
    .map((g) => `${monthLabel(g.from)}${g.to !== g.from ? ` – ${monthLabel(g.to)}` : ''}: ${money(g.amount)}`)
    .join(' · ')
}

export function ForecastPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [mode, setMode] = React.useState<'unit' | 'owner'>('unit')
  const [units, setUnits] = React.useState<PickerUnit[]>([])
  const [owners, setOwners] = React.useState<PickerOwner[]>([])
  const [unitCode, setUnitCode] = React.useState('')
  const [beCode, setBeCode] = React.useState('')
  const [months, setMonths] = React.useState(8)
  const [data, setData] = React.useState<Forecast | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [pickerLoading, setPickerLoading] = React.useState(true)
  // The unit/owner list is fetched once on mount — if that one request fails (API restarting,
  // network blip) the pickers would silently stay empty. Retry automatically a few times, then
  // show an error with a manual retry instead of a dead, empty dropdown.
  const [pickerError, setPickerError] = React.useState(false)
  const [pickerAttempt, setPickerAttempt] = React.useState(0)
  const [fullscreen, setFullscreen] = React.useState(false)
  // Which of Cheltuieli Întreținere / the 5 funds count toward the total — admin can untick one
  // (e.g. a fund under renegotiation) without losing the column, only its contribution to the sum.
  // Keyed by column code; absent = included (so new fund codes default to "on").
  const [included, setIncluded] = React.useState<Record<string, boolean>>({})
  const isIncluded = (code: string) => included[code] !== false
  const toggleIncluded = (code: string) => setIncluded((prev) => ({ ...prev, [code]: !isIncluded(code) }))
  const [copied, setCopied] = React.useState(false)
  // Which row's penalty amount the explain popup is open for (null = closed).
  const [penaltyExplainRow, setPenaltyExplainRow] = React.useState<ForecastRow | null>(null)

  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setPickerLoading(true)
    setPickerError(false)
    const fetchPicker = (triesLeft: number) => {
      api.get<{ units: PickerUnit[]; owners: PickerOwner[] }>(`/communities/${communityId}/reports/risk-detail`)
        .then((d: { units: PickerUnit[]; owners: PickerOwner[] }) => {
          if (!alive) return
          const sortedUnits = [...(d.units || [])].sort((a, b) => a.unitCode.localeCompare(b.unitCode))
          const sortedOwners = [...(d.owners || [])].sort((a, b) => (a.beName || '').localeCompare(b.beName || ''))
          setUnits(sortedUnits)
          setOwners(sortedOwners)
          setPickerLoading(false)
        })
        .catch(() => {
          if (!alive) return
          if (triesLeft > 0) { retryTimer = setTimeout(() => fetchPicker(triesLeft - 1), 2000); return }
          setUnits([]); setOwners([]); setPickerLoading(false); setPickerError(true)
        })
    }
    fetchPicker(3)
    return () => { alive = false; if (retryTimer) clearTimeout(retryTimer) }
  }, [api, communityId, pickerAttempt])

  // Fullscreen has the vertical room for a couple more rows, so it shows `months` + 2 without the
  // admin having to bump the input themselves; leaving fullscreen goes back to exactly what they
  // configured. The input itself always reflects their own chosen base value, never the bumped one.
  const FULLSCREEN_EXTRA_MONTHS = 2
  const effectiveMonths = Math.min(24, months + (fullscreen ? FULLSCREEN_EXTRA_MONTHS : 0))
  const load = React.useCallback(() => {
    const code = mode === 'unit' ? unitCode : beCode
    if (!communityId || !code) { setData(null); return }
    setLoading(true)
    const qs = mode === 'unit' ? `unitCode=${encodeURIComponent(code)}` : `beCode=${encodeURIComponent(code)}`
    api.get<Forecast>(`/communities/${communityId}/reports/forecast?${qs}&months=${effectiveMonths}`)
      .then((d: Forecast) => { setData(d); setLoading(false) })
      .catch(() => { setData(null); setLoading(false) })
  }, [api, communityId, mode, unitCode, beCode, effectiveMonths])
  React.useEffect(() => { load() }, [load])

  const selectedCode = mode === 'unit' ? unitCode : beCode
  const targetLabel = mode === 'unit'
    ? units.find((u) => u.unitCode === unitCode)
    : owners.find((o) => o.beCode === beCode)
  const targetPrimaryLabel = targetLabel ? beLabel(mode === 'unit'
    ? { beCode: (targetLabel as PickerUnit).beCode ?? undefined, beName: (targetLabel as PickerUnit).beName ?? undefined, units: [(targetLabel as PickerUnit).unitCode] }
    : { beCode: (targetLabel as PickerOwner).beCode ?? undefined, beName: (targetLabel as PickerOwner).beName ?? undefined, units: (targetLabel as PickerOwner).unitCodes }).primary : (data?.target?.code ?? '')

  // "Total de plată" honoring the include/exclude checkboxes — Cheltuieli Întreținere, Penalități
  // and each fund only count while their own checkbox is checked.
  const rowTotal = React.useCallback((r: ForecastRow) => {
    if (!data) return r.total
    let t = isIncluded('EXPENSES') ? r.expenses : 0
    t += isIncluded('PENALIZARI') ? r.penalties : 0
    for (const f of data.fundColumns) t += isIncluded(f.code) ? (r.funds[f.code] ?? 0) : 0
    return round2(t)
  }, [data, included])

  // Grand totals across every displayed row — the summary footer.
  const summary = React.useMemo(() => {
    if (!data) return null
    const funds: Record<string, number> = {}
    for (const f of data.fundColumns) funds[f.code] = 0
    let expenses = 0, penalties = 0, total = 0
    for (const r of data.rows) {
      expenses += r.expenses; penalties += r.penalties; total += rowTotal(r)
      for (const f of data.fundColumns) funds[f.code] += r.funds[f.code] ?? 0
    }
    return { expenses, penalties, funds, total }
  }, [data, rowTotal])

  // Fund rows bucketed under their category (Întreținere / Operațional / Reabilitare — whatever
  // the backend's own avizier grouping calls them), in the order `groupTotals` already sorted them
  // server-side, so the client never hardcodes group order or labels. A group gets a subtotal row
  // only when at least one of its funds has a real "total colectat" (Cheltuieli Întreținere and
  // Penalizări don't — they're ongoing costs, not a fund with a finite target).
  const groupedFundsInfo = React.useMemo(() => {
    if (!data) return []
    const orderedKeys = [...data.groupTotals.map((g) => g.key), ...new Set(data.fundsInfo.map((f) => f.group.key))]
    const seen = new Set<string>()
    const order = orderedKeys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)))
    return order.map((key) => {
      const funds = data.fundsInfo.filter((f) => f.group.key === key)
      const label = funds[0]?.group.label ?? key
      const subtotal = data.groupTotals.find((g) => g.key === key)?.totalCollected ?? null
      return { key, label, funds, subtotal }
    })
  }, [data])

  // "<unitate/proprietar> - Fonduri <MM-YY> - <MM-YY>" — the payment reference an owner quotes on
  // a bank transfer covering the whole forecasted range. Copied/shown WITHOUT any extra label —
  // this string is meant to be pasted verbatim into a transfer's details field.
  const periodToMMYY = (code: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(code)
    return m ? `${m[2]}-${m[1].slice(-2)}` : code
  }
  const bankDetailsText = data && data.rows.length
    ? `${targetPrimaryLabel} - Fonduri ${periodToMMYY(data.rows[0].periodCode)} - ${periodToMMYY(data.rows[data.rows.length - 1].periodCode)}`
    : ''
  const copyBankDetails = () => {
    navigator.clipboard?.writeText(bankDetailsText)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => {})
  }

  // Why a given row's penalty isn't zero — mirrors `forecastReport`'s own doc: row 0 folds in every
  // prior restanță (a ledger fact once the period's charges are generated) plus that period's own
  // charge/estimate; every later row is a pure projection off the last billed amount, with no new
  // accrual simulated.
  const penaltyExplanation = (r: ForecastRow): string => {
    if (r.isCurrent) {
      return r.confirmed.penalties
        ? t('forecast.penaltyExplainCurrentConfirmed', 'Suma include restanța de penalizări acumulată din lunile anterioare, plus penalizarea deja generată și confirmată din ledger pentru luna curentă.')
        : t('forecast.penaltyExplainCurrentEstimate', 'Suma include restanța de penalizări acumulată din lunile anterioare, plus o estimare pentru luna curentă (bazată pe ultima penalizare facturată) — perioada încă nu a fost generată/confirmată din ledger.')
    }
    return t('forecast.penaltyExplainProjected', 'Sumă proiectată, egală cu ultima penalizare facturată — prognoza nu simulează acumularea de penalizări noi pentru lunile viitoare.')
  }

  return (
    <div
      className="stack"
      style={fullscreen
        ? { gap: 12, position: 'fixed', inset: 0, zIndex: 800, background: 'var(--bg, #fff)', padding: 16, overflow: 'auto' }
        : { gap: 12 }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0, fontSize: 20 }}>{t('forecast.title', 'Restanțe și prognoză costuri')}</h4>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              type="button" className="btn ghost small"
              style={{ borderRadius: 0, background: mode === 'unit' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: mode === 'unit' ? 600 : 400 }}
              onClick={() => setMode('unit')}
            >
              {t('forecast.modeUnit', 'Unitate')}
            </button>
            <button
              type="button" className="btn ghost small"
              style={{ borderRadius: 0, background: mode === 'owner' ? 'var(--muted-bg, #eef2ff)' : undefined, fontWeight: mode === 'owner' ? 600 : 400 }}
              onClick={() => setMode('owner')}
            >
              {t('forecast.modeOwner', 'Proprietar')}
            </button>
          </div>
          {mode === 'unit' ? (
            <select className="input" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} disabled={pickerLoading} style={{ minWidth: 220 }}>
              <option value="">{t('forecast.selectUnit', 'Alege o unitate…')}</option>
              {units.map((u) => {
                const label = beLabel({ beCode: u.beCode ?? undefined, beName: u.beName ?? undefined, units: [u.unitCode] })
                return <option key={u.unitId} value={u.unitCode}>{shortUnit(u.unitCode)}{label.secondary ? ` — ${label.secondary}` : ''}</option>
              })}
            </select>
          ) : (
            <select className="input" value={beCode} onChange={(e) => setBeCode(e.target.value)} disabled={pickerLoading} style={{ minWidth: 220 }}>
              <option value="">{t('forecast.selectOwner', 'Alege un proprietar…')}</option>
              {owners.map((o) => {
                const label = beLabel({ displayName: o.displayName, beCode: o.beCode ?? undefined, beName: o.beName ?? undefined, units: o.unitCodes })
                return <option key={o.beId} value={o.beCode ?? ''}>{label.primary}{label.secondary ? ` — ${label.secondary}` : ''}</option>
              })}
            </select>
          )}
          {pickerLoading ? <span className="muted" style={{ fontSize: 12 }}>{t('common.loading', 'Loading…')}</span> : null}
          {pickerError ? (
            <span className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--danger, #d32f2f)' }}>
              {t('forecast.pickerError', 'Lista de unități nu s-a putut încărca.')}
              <button type="button" className="btn ghost small" onClick={() => setPickerAttempt((n) => n + 1)}>{t('forecast.pickerRetry', 'Reîncearcă')}</button>
            </span>
          ) : null}
          <label className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 14 }}>{t('forecast.months', 'Luni')}</span>
            <input
              type="number" className="input" min={1} max={24} value={months} style={{ width: 64 }}
              onChange={(e) => setMonths(Math.max(1, Math.min(24, Math.round(Number(e.target.value) || 3))))}
            />
          </label>
          <button
            type="button" className="btn ghost small"
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? t('avizier.exitFullscreen', 'Ieși din ecran complet (Esc)') : t('avizier.fullscreen', 'Ecran complet')}
          >
            {fullscreen ? '🗗 ' + t('avizier.exit', 'Închide') : '⛶ ' + t('avizier.fullscreen', 'Ecran complet')}
          </button>
        </div>
      </div>

      {!selectedCode ? (
        <div className="empty">{t('forecast.empty', 'Alege o unitate sau un proprietar pentru a genera prognoza.')}</div>
      ) : loading ? (
        <div className="empty">{t('forecast.loading', 'Se încarcă…')}</div>
      ) : !data || !data.current ? (
        <div className="empty">{t('forecast.noData', 'Nu există încă nicio perioadă pentru această asociație.')}</div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 14 }}>{targetPrimaryLabel}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border,#ddd)' }}>
                  <th style={{ textAlign: 'left', padding: '9px 11px' }}>{t('forecast.colPeriod', 'Perioada')}</th>
                  <th style={{ textAlign: 'left', padding: '9px 11px' }}>{t('forecast.colIssued', 'Emitere')}</th>
                  <th style={{ textAlign: 'left', padding: '9px 11px' }}>{t('forecast.colDue', 'Scadență')}</th>
                  <th style={{ textAlign: 'right', padding: '9px 11px' }}>
                    <label className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center', fontWeight: 'inherit' }} title={t('forecast.excludeHint', 'Debifează pentru a exclude din total')}>
                      <input type="checkbox" checked={isIncluded('EXPENSES')} onChange={() => toggleIncluded('EXPENSES')} />
                      {data.expensesLabel}
                    </label>
                  </th>
                  <th style={{ textAlign: 'right', padding: '9px 11px' }}>
                    <label className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center', fontWeight: 'inherit' }} title={t('forecast.excludeHint', 'Debifează pentru a exclude din total')}>
                      <input type="checkbox" checked={isIncluded('PENALIZARI')} onChange={() => toggleIncluded('PENALIZARI')} />
                      {data.penaltiesLabel}
                    </label>
                  </th>
                  {data.fundColumns.map((f) => (
                    <th key={f.code} style={{ textAlign: 'right', padding: '9px 11px' }}>
                      <label className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center', fontWeight: 'inherit' }} title={t('forecast.excludeHint', 'Debifează pentru a exclude din total')}>
                        <input type="checkbox" checked={isIncluded(f.code)} onChange={() => toggleIncluded(f.code)} />
                        {f.name}
                      </label>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', padding: '9px 11px' }}>{t('forecast.colTotal', 'Total de plată')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.periodCode} style={{ borderBottom: '1px solid var(--border-soft,#eee)' }}>
                    <td style={{ padding: '9px 11px' }}>
                      {r.periodCode}
                      {r.isCurrent ? <span className="badge secondary" style={{ marginLeft: 6, fontWeight: 400 }}>{t('forecast.currentBadge', 'curentă + restanțe')}</span> : null}
                    </td>
                    <td style={{ padding: '9px 11px', ...cellStyle(r.isCurrent) }}>{fmtDate(r.emitere)}</td>
                    <td style={{ padding: '9px 11px', ...cellStyle(r.isCurrent) }}>{fmtDate(r.scadenta)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 11px', ...cellStyle(r.confirmed.expenses), ...excludedStyle(!isIncluded('EXPENSES')) }}>{money(r.expenses)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 11px', ...cellStyle(r.confirmed.penalties), ...excludedStyle(!isIncluded('PENALIZARI')) }}>
                      {Math.abs(r.penalties) > 0.005 ? (
                        <button
                          type="button"
                          onClick={() => setPenaltyExplainRow(r)}
                          title={t('forecast.penaltyExplainHint', 'Clic pentru detalii')}
                          style={{ font: 'inherit', color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
                        >
                          {money(r.penalties)}
                        </button>
                      ) : money(r.penalties)}
                    </td>
                    {data.fundColumns.map((f) => (
                      <td key={f.code} style={{ textAlign: 'right', padding: '9px 11px', ...cellStyle(r.confirmed.funds[f.code]), ...excludedStyle(!isIncluded(f.code)) }}>{money(r.funds[f.code] ?? 0)}</td>
                    ))}
                    <td style={{ textAlign: 'right', padding: '9px 11px', fontWeight: 600 }}>{money(rowTotal(r))}</td>
                  </tr>
                ))}
              </tbody>
              {summary ? (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border,#ddd)', fontWeight: 600 }}>
                    <td style={{ padding: '9px 11px' }} colSpan={3}>{t('forecast.summaryTotal', 'Total de plată (toate lunile)')}</td>
                    <td style={{ textAlign: 'right', padding: '9px 11px', ...excludedStyle(!isIncluded('EXPENSES')) }}>{money(summary.expenses)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 11px', ...excludedStyle(!isIncluded('PENALIZARI')) }}>{money(summary.penalties)}</td>
                    {data.fundColumns.map((f) => <td key={f.code} style={{ textAlign: 'right', padding: '9px 11px', ...excludedStyle(!isIncluded(f.code)) }}>{money(summary.funds[f.code] ?? 0)}</td>)}
                    <td style={{ textAlign: 'right', padding: '9px 11px' }}>{money(summary.total)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>

          {data.fundsInfo?.length ? (
            <details className="card soft" style={{ padding: '8px 10px' }}>
              <summary style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{t('forecast.fundsInfoTitle', 'Fonduri configurate')}</summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8, lineHeight: 1.3 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '5px 8px' }}>{t('forecast.fundsInfoFund', 'Fond')}</th>
                    <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.fundsInfoAmount', 'Sumă/perioadă')}</th>
                    <th style={{ textAlign: 'left', padding: '5px 8px' }}>{t('forecast.fundsInfoWindow', 'Fereastră de colectare')}</th>
                    <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.fundsInfoCollected', 'Total colectat / Țintă')}</th>
                    <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.fundsInfoPenalty', 'Penalizare')}</th>
                  </tr>
                </thead>
                {groupedFundsInfo.map((group) => (
                  <tbody key={group.key}>
                    <tr>
                      <td colSpan={5} style={{ padding: '6px 8px 2px', fontWeight: 600, borderTop: '1px solid var(--border,#ddd)' }}>{group.label}</td>
                    </tr>
                    {group.funds.map((f) => (
                      <tr key={f.code}>
                        <td style={{ padding: '5px 8px', verticalAlign: 'top' }}>
                          {f.name}
                          {f.closed ? <span className="badge secondary" style={{ marginLeft: 6, fontWeight: 400, fontSize: 12 }}>{t('forecast.fundClosed', 'Încheiat')}</span> : null}
                        </td>
                        <td style={{ textAlign: 'right', padding: '5px 8px', verticalAlign: 'top' }}>{f.perPeriodAmount != null ? money(f.perPeriodAmount) : '—'}</td>
                        <td style={{ padding: '5px 8px', verticalAlign: 'top' }}>
                          <span className="muted">
                            {f.startPeriodCode && f.endPeriodCode
                              ? `${monthLabel(f.startPeriodCode)} – ${monthLabel(f.endPeriodCode)} (${f.periodCount} ${t('forecast.fundsInfoMonths', 'luni')})`
                              : t('forecast.fundsInfoNoWindow', 'fără fereastră configurată — activ permanent')}
                          </span>
                          {f.collectionChart ? (
                            <div className="muted" style={{ fontSize: 12 }}>{formatCollectionSchedule(f.collectionChart)}</div>
                          ) : null}
                        </td>
                        <td style={{ textAlign: 'right', padding: '5px 8px', verticalAlign: 'top' }}>
                          {f.totalCollected != null
                            ? `${money(f.totalCollected)}${f.totalTarget != null ? ` / ${money(f.totalTarget)}` : ''}`
                            : '—'}
                        </td>
                        <td style={{ textAlign: 'right', padding: '5px 8px', verticalAlign: 'top' }}>{f.penaltyRatePct != null ? `${f.penaltyRatePct}%/zi` : '—'}</td>
                      </tr>
                    ))}
                    {group.subtotal != null ? (
                      <tr style={{ borderTop: '1px solid var(--border-soft,#eee)' }}>
                        <td colSpan={3} style={{ padding: '5px 8px', fontWeight: 600 }}>{t('forecast.groupSubtotal', 'Subtotal')} {group.label}</td>
                        <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 600 }}>{money(group.subtotal)}</td>
                        <td />
                      </tr>
                    ) : null}
                  </tbody>
                ))}
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border,#ddd)' }}>
                    <td colSpan={3} style={{ padding: '5px 8px', fontWeight: 700 }}>{t('forecast.grandTotalCollected', 'Total general colectat')}</td>
                    <td style={{ textAlign: 'right', padding: '5px 8px', fontWeight: 700 }}>{money(data.grandTotalCollected)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </details>
          ) : null}

          {data.fundsInfo?.some((f) => f.association) ? (
            <details className="card soft" style={{ padding: '8px 10px' }}>
              <summary style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                {t('forecast.collectionStatsTitle', 'Încasat / Restanță / Colectat / Țintă pe fonduri')}
              </summary>
              <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {t('forecast.identityHint', 'Încasat + Restanță = Colectat · Grad Încasare = Încasat din Colectat · Grad de Colectare = Colectat din Țintă')}
              </div>
              <div className="stack" style={{ gap: 16, marginTop: 8 }}>
                <FundCollectionTable
                  title={t('forecast.scopeAssociation', 'Asociație')}
                  rows={data.fundsInfo.filter((f) => f.association)}
                  scope="association"
                  summary={data.fundsSummary.association}
                />
                <FundCollectionTable
                  title={`${t('forecast.scopeSelected', 'Selecție')}: ${targetPrimaryLabel}`}
                  rows={data.fundsInfo.filter((f) => f.selected)}
                  scope="selected"
                  summary={data.fundsSummary.selected}
                />
              </div>
            </details>
          ) : null}

          {data.assumptions?.length ? (
            <details className="card soft" style={{ padding: 12 }}>
              <summary style={{ fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>{t('forecast.assumptions', 'Asumpții')}</summary>
              <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 14 }}>
                {data.assumptions.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
              </ol>
            </details>
          ) : null}

          {bankDetailsText ? (
            <div className="card soft" style={{ padding: 12 }}>
              <strong style={{ fontSize: 15 }}>{t('forecast.bankDetailsTitle', 'Detalii pentru transfer Bancar')}</strong>
              <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <code style={{ fontSize: 15, padding: '4px 8px', background: 'var(--muted-bg, #f3f4f6)', borderRadius: 4 }}>{bankDetailsText}</code>
                <button type="button" className="btn ghost small" onClick={copyBankDetails}>
                  {copied ? t('forecast.copied', 'Copiat!') : t('forecast.copy', 'Copiază')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {penaltyExplainRow && data ? (
        <div onClick={() => setPenaltyExplainRow(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, width: '90%', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 16 }}>{t('forecast.penaltyExplainTitle', 'De ce nu e zero penalizarea?')}</h4>
              <button className="btn ghost small" onClick={() => setPenaltyExplainRow(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {monthLabel(penaltyExplainRow.periodCode)}{penaltyExplainRow.isCurrent ? ` · ${t('forecast.currentBadge', 'curentă + restanțe')}` : ''}
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="muted">{data.penaltiesLabel}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(penaltyExplainRow.penalties)}</strong>
            </div>
            <p style={{ fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>{penaltyExplanation(penaltyExplainRow)}</p>
            <div className="muted" style={{ fontSize: 12, marginTop: 10, borderTop: '1px solid var(--border,#eee)', paddingTop: 8 }}>
              {t('forecast.penaltyExplainFormula', 'Formula folosită la nivel de întârziere: Penalizare = Restanță × Procent/zi × Număr de zile — vezi pagina Verificare penalități pentru calculul lună cu lună.')}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Per-fund Încasat/Restanță/Colectat/Țintă + the two grades, for one scope (association-wide or
// the currently selected unit/owner) — two of these render stacked, one per scope, sharing the
// exact same columns so the two numbers are easy to compare fund-by-fund.
function FundCollectionTable({ title, rows, scope, summary }: {
  title: string
  rows: FundInfo[]
  scope: 'association' | 'selected'
  summary: CollectionStats
}) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`)
  const sumTarget = rows.reduce((s, f) => s + (f.totalTarget ?? 0), 0)
  const hasTarget = rows.some((f) => f.totalTarget != null)
  return (
    <div>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 4, lineHeight: 1.3 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '5px 8px' }}>{t('forecast.fundsInfoFund', 'Fond')}</th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.colIncasat', 'Încasat')}</th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.colRestanta', 'Restanță')}</th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.colColectat', 'Colectat')}</th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }}>{t('forecast.colTinta', 'Țintă')}</th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }} title={t('forecast.colGradIncasareHint', 'Încasare din Colectat')}>
              {t('forecast.colGradIncasare', 'Grad Încasare')}
            </th>
            <th style={{ textAlign: 'right', padding: '5px 8px' }} title={t('forecast.colGradColectareHint', 'Colectat din Țintă')}>
              {t('forecast.colGradColectare', 'Grad de Colectare')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const s = (scope === 'association' ? f.association : f.selected)!
            return (
              <tr key={f.code}>
                <td style={{ padding: '5px 8px' }}>{f.name}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(s.incasat)}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(s.restanta)}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(s.colectat)}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{f.totalTarget != null ? money(f.totalTarget) : '—'}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{pct(s.gradIncasarePct)}</td>
                <td style={{ textAlign: 'right', padding: '5px 8px' }}>{pct(s.gradColectarePct)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid var(--border,#ddd)', fontWeight: 600 }}>
            <td style={{ padding: '5px 8px' }}>{t('forecast.fundsTotalRow', 'Total fonduri')}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(summary.incasat)}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(summary.restanta)}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{money(summary.colectat)}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{hasTarget ? money(sumTarget) : '—'}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{pct(summary.gradIncasarePct)}</td>
            <td style={{ textAlign: 'right', padding: '5px 8px' }}>{pct(summary.gradColectarePct)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
