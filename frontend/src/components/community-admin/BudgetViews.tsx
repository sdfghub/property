import React from 'react'
import { useI18n } from '../../i18n/useI18n'

// Fiscal-year views of the budget (by service, by fund), the strategic portfolio and the multi-year
// plan. Every label and number comes from the /budget payload (`annual`, `portfolio`, `multiYear`).

type MV = { budget: number; actual: number; forecast: number }
type Tot = { budget: number; actual: number; forecast: number; variance: number; months?: Record<string, MV> }
export type Metric = 'budget' | 'actual' | 'forecast' | 'variance'
/** Monthly layout: one column per month (Jan–Dec of each selected year) showing one metric. */
export const MonthCtx = React.createContext<{ monthly: boolean; metric: Metric; months: string[] }>({ monthly: false, metric: 'budget', months: [] })
const metricOf = (v: MV | undefined, k: Metric) => (!v ? 0 : k === 'variance' ? Math.round((v.forecast - v.budget) * 100) / 100 : v[k])
export function monthLabel(m: string, lang: string, withYear: boolean) {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1)
  const name = d.toLocaleString(lang === 'ro' ? 'ro-RO' : 'en-GB', { month: 'short' }).replace('.', '')
  return withYear ? `${name} ${m.slice(2, 4)}` : name
}
type Purpose = { code: string; label: string; dimension: string; dimensionLabel: string | null }
type Contribution = { kind: 'LINE' | 'PROJECT'; id: string; code: string; name: string; purpose?: string; weight?: number; fundName?: string | null; budget: number; actual: number; forecast: number; crossFund?: boolean; live?: boolean; months?: Record<string, MV>; costType?: string | null; costTypeLabel?: string | null }
type ServiceRow = { code: string | null; name: string | null; level: number | null; evaluated: boolean; totals: Tot; byPurpose: Record<string, Tot>; items: Contribution[] }
type Domain = { name: string | null; totals: Tot; byPurpose: Record<string, Tot>; services: ServiceRow[] }
type FundAnnual = { code: string | null; name: string | null; dimension: string | null; appFund: boolean; target: number | null; collected: number | null; totals: Tot; items: Contribution[] }
export type Annual = {
  year: number; years: string[]; months: string[]; purposes: Purpose[]; totals: Tot; byService: Domain[]; byFund: FundAnnual[]
  byPurpose: Array<{ code: string; totals: Tot }>
  byProject: Array<{ code: string; name: string; purpose: string; project: boolean; totals: Tot; items: Contribution[] }>
  check: { byService: number; byFund: number; byPurpose: number; byProject: number; total: number }
}
type Area = { key: string; estimate: number; budget: number; committed: number; paid: number; remainingToPay: number }
export type Project = {
  code: string; name: string; scope: string | null; programName: string; fundCode: string | null; fundName: string | null; fundLabel: string | null
  voteYear: number | null; durationYears: number | null; status: string; statusLabel: string | null
  budget: number | null; budgetEur: number | null; yearPlan: Record<string, number>
  linesBudget: number; estimate: number; committed: number; paid: number; remainingToPay: number; forecast: number; variance: number | null; paidPct: number | null
  paidByYear: Record<string, number>; undatedPaid: number; paidByFund: Array<{ code: string | null; name: string | null; amount: number }>
  serviceSplit: Array<{ code: string; weight: number; label: string | null }>; serviceSplitNote: string | null; source: string | null
  byArea: Area[]; byVendor: Area[]
  lines: Array<{ id: string; code: string; name: string; area: string | null; vendorName: string | null; fundName: string | null; statusLabel: string | null; metrics: { budget: number; committed: number | null; actual: number; forecast: number } }>
  year: { year: number; budget: number; actual: number; forecast: number; overdue: boolean }
}
export type Portfolio = { years: string[]; programs: Array<{ code: string; name: string; projects: Project[]; totals: Record<string, number> }> }
type YearMap = Record<string, number>
export type MultiYear = {
  year: number; years: string[]; totals: YearMap
  byService: Array<{ name: string | null; plan: YearMap; services: Array<{ code: string | null; name: string | null; plan: YearMap }> }>
  byFund: Array<{ code: string | null; name: string | null; appFund: boolean; plan: YearMap }>
}

export const money = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money0 = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 })
const pct = (n: number) => `${(Math.round(n * 1000) / 10).toLocaleString('ro-RO')}%`
const R = { textAlign: 'right' as const }
const GROUP_BG = 'var(--surface-2, rgba(0,0,0,0.04))'

// Run / Maintain / Transform: green / yellow / red from the Vicusia service-level scale (index.css).
export const PURPOSE_COLOR: Record<string, string> = {
  RUN: 'var(--purpose-run, #3f9c4a)', MAINTAIN: 'var(--purpose-maintain, #f2a900)', TRANSFORM: 'var(--purpose-transform, #b3261e)',
}

function tone(v: number, budget: number) {
  if (Math.abs(v) < 0.5) return 'var(--muted,#888)'
  if (v < 0) return 'var(--success,#248a3d)'
  return budget > 0 && v / budget < 0.05 ? 'var(--warn,#8a5200)' : 'var(--danger,#d70015)'
}
const signed = (v: number) => `${v > 0 ? '+' : ''}${money0(v)}`
/** "2026", "2022–2025" or "2022, 2026". */
export function yearsLabel(years: string[]) {
  const n = years.map(Number).sort((a, b) => a - b)
  if (n.length <= 1) return String(n[0] ?? '')
  return n.every((y, i) => i === 0 || y === n[i - 1] + 1) ? `${n[0]}–${n[n.length - 1]}` : n.join(', ')
}
const isEmpty = (x: { totals: Tot }) => !x.totals.budget && !x.totals.actual && !x.totals.forecast

const Dot = ({ purpose }: { purpose?: string }) =>
  purpose ? <span style={{ width: 8, height: 8, borderRadius: 2, background: PURPOSE_COLOR[purpose], display: 'inline-block', marginRight: 6, flex: 'none' }} /> : null

/** Run / Maintain / Transform split of one row, as a normalised bar with a text alternative. */
function PurposeBar({ byPurpose, purposes }: { byPurpose: Record<string, Tot>; purposes: Purpose[] }) {
  const vals = purposes.map((p) => ({ p, v: byPurpose[p.code]?.budget ?? 0 }))
  const total = vals.reduce((s, x) => s + x.v, 0)
  if (total <= 0 || vals.some((x) => x.v < 0)) return null
  const text = vals.filter((x) => x.v > 0).map((x) => `${x.p.label} ${pct(x.v / total)}`).join(' · ')
  return (
    <div role="img" aria-label={text} title={text} style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4, maxWidth: 200, background: 'var(--surface-2,#eee)' }}>
      {vals.map((x) => (x.v > 0 ? <div key={x.p.code} style={{ width: `${(x.v / total) * 100}%`, background: PURPOSE_COLOR[x.p.code] }} /> : null))}
    </div>
  )
}

function Legend({ purposes }: { purposes: Purpose[] }) {
  return (
    <div className="row" style={{ gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
      {purposes.map((p) => (
        <span key={p.code} className="row" style={{ gap: 4, alignItems: 'center' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: PURPOSE_COLOR[p.code], display: 'inline-block' }} />
          {p.label}
        </span>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="row" style={{ gap: 6, fontSize: 12, alignItems: 'center' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

export function AnnualCards({ annual }: { annual: Annual }) {
  const { t } = useI18n()
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
      {[...annual.purposes.map((p) => ({ key: p.code, label: p.label, color: PURPOSE_COLOR[p.code], tot: annual.byPurpose.find((x) => x.code === p.code)!.totals })),
        { key: 'TOTAL', label: t('budget.total', 'Total'), color: undefined as string | undefined, tot: annual.totals }].map((c) => (
        <div key={c.key} className="card" style={{ flex: '1 1 180px', minWidth: 180, borderTop: c.color ? `3px solid ${c.color}` : undefined }}>
          <div className="muted" style={{ fontSize: 12 }}>{c.label} · {yearsLabel(annual.years)}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{money0(c.tot.budget)}</div>
          <div className="muted" style={{ fontSize: 12 }}>{t('budget.annual.kpi', { a: money0(c.tot.actual), f: money0(c.tot.forecast) })}</div>
        </div>
      ))}
    </div>
  )
}

function CheckLine({ annual }: { annual: Annual }) {
  const { t } = useI18n()
  const c = annual.check
  const ok = [c.byService, c.byFund, c.byPurpose, c.byProject].every((v) => Math.abs(v - c.total) < 0.05)
  return ok
    ? <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t('budget.annual.checkShort', { v: money0(c.total) })}</div>
    : <div style={{ fontSize: 11, marginTop: 8 }}><span className="badge negative">{t('budget.annual.checkKo', 'nu se reconciliază')}</span> {t('budget.annual.check', { s: money(c.byService), f: money(c.byFund), p: money(c.byPurpose), j: money(c.byProject) })}</div>
}

function MonthHeads({ label }: { label: string }) {
  const { t, lang } = useI18n()
  const mc = React.useContext(MonthCtx)
  const multi = new Set(mc.months.map((m) => m.slice(0, 4))).size > 1
  return <>{mc.months.map((m) => <th key={m} style={R}>{monthLabel(m, lang, multi)}</th>)}<th style={R}>{t('budget.total', 'Total')} {label}</th></>
}

/** Budget / actual / forecast / variance cells. */
function Nums({ tot, strong }: { tot: Tot; strong?: boolean }) {
  const mc = React.useContext(MonthCtx)
  if (mc.monthly) {
    const k = mc.metric
    const total = k === 'variance' ? tot.variance : tot[k]
    const cell = (v: number, key: string, bold?: boolean) => (
      <td key={key} style={{ ...R, fontWeight: bold ? 700 : strong ? 600 : undefined, color: k === 'variance' ? tone(v, 1) : v ? undefined : 'var(--muted,#aaa)' }}>
        {k === 'variance' ? (Math.abs(v) < 0.5 ? '–' : signed(v)) : v ? money0(v) : '–'}
      </td>
    )
    return <>{mc.months.map((m) => cell(metricOf(tot.months?.[m], k), m))}{cell(total, 'total', true)}</>
  }
  return (
    <>
      <td style={{ ...R, fontWeight: strong ? 700 : 600 }}>{money0(tot.budget)}</td>
      <td style={R}>{money0(tot.actual)}</td>
      <td style={{ ...R, fontWeight: strong ? 700 : undefined }}>{money0(tot.forecast)}</td>
      <td style={{ ...R, color: tone(tot.variance, tot.budget) }}>{signed(tot.variance)}</td>
    </>
  )
}

function NumHead({ year, first, extra = [] }: { year: number | string; first: string; extra?: string[] }) {
  const { t, lang } = useI18n()
  const mc = React.useContext(MonthCtx)
  if (mc.monthly) {
    const multi = new Set(mc.months.map((m) => m.slice(0, 4))).size > 1
    return (
      <thead>
        <tr>
          <th>{first}</th>
          {extra.map((x) => <th key={x} style={R}>{x}</th>)}
          {mc.months.map((m) => <th key={m} style={R}>{monthLabel(m, lang, multi)}</th>)}
          <th style={R}>{t('budget.total', 'Total')} {year}</th>
        </tr>
      </thead>
    )
  }
  return (
    <thead>
      <tr>
        <th>{first}</th>
        {extra.map((x) => <th key={x} style={R}>{x}</th>)}
        <th style={R}>{t('budget.annual.budgetCol', { y: year })}</th>
        <th style={R}>{t('budget.annual.actualCol', 'Actual')}</th>
        <th style={R}>{t('budget.annual.forecastCol', 'Forecast')}</th>
        <th style={R}>{t('budget.annual.varianceCol', 'Abatere')}</th>
      </tr>
    </thead>
  )
}

function ContributionRows({ items, indent, pad, hideZero, onLine, onProject }: { items: Contribution[]; indent: number; pad: number; hideZero?: boolean; onLine: (id: string) => void; onProject: (code: string) => void }) {
  const { t } = useI18n()
  return (
    <>
      {items.filter((it) => !hideZero || it.budget || it.actual || it.forecast).map((it) => {
        const note = [it.weight != null && it.weight < 0.9999 ? pct(it.weight) : null, it.crossFund ? t('budget.fund.cross', 'plăți din acest fond') : null].filter(Boolean).join(' · ')
        return (
          <tr key={`${it.kind}-${it.id}`} onClick={() => (it.kind === 'LINE' ? onLine(it.id) : onProject(it.code))} style={{ cursor: 'pointer', fontSize: 12 }}>
            <td style={{ paddingLeft: indent }}>
              <Dot purpose={it.purpose} />{it.name}
              {/* What kind of cost this is (Proiect, Consum, Abonament, Reparație, …) — label from the API. */}
              {it.costTypeLabel && (
                <span className="badge" style={{ fontSize: 10, marginLeft: 6, padding: '1px 6px', verticalAlign: 'middle',
                  ...(it.costType === 'PROJECT' ? { background: 'var(--chip-bg)', color: 'var(--chip-text)', borderColor: 'var(--accent-border)' } : {}) }}>{it.costTypeLabel}</span>
              )}
              {note ? <span className="muted"> · {note}</span> : null}
            </td>
            {pad > 0 && <td colSpan={pad} />}
            <Nums tot={{ budget: it.budget, actual: it.actual, forecast: it.forecast, variance: Math.round((it.forecast - it.budget) * 100) / 100, months: it.months }} />
          </tr>
        )
      })}
    </>
  )
}

export function ServiceView({ annual, onLine, onProject }: { annual: Annual; onLine: (id: string) => void; onProject: (code: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const [hideEmpty, setHideEmpty] = React.useState(true)
  const P = annual.purposes
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <Legend purposes={P} />
        <Toggle checked={hideEmpty} onChange={setHideEmpty} label={t('budget.hideZero', 'ascunde înregistrările cu zero')} />
      </div>
      <table className="table" style={{ minWidth: 680 }}>
        <NumHead year={yearsLabel(annual.years)} first={t('budget.col.service', 'Serviciu')} />
        <tbody>
          {annual.byService.filter((d) => !hideEmpty || !isEmpty(d)).map((d) => {
            const dk = `d:${d.name}`
            const dOpen = open[dk] !== false
            return (
              <React.Fragment key={dk}>
                <tr onClick={() => setOpen((o) => ({ ...o, [dk]: !dOpen }))} style={{ cursor: 'pointer', background: GROUP_BG }}>
                  <td style={{ fontWeight: 700 }}>{dOpen ? '▾' : '▸'} {d.name ?? t('budget.svc.unassigned', 'Fără serviciu')}</td>
                  <Nums tot={d.totals} strong />
                </tr>
                {dOpen && d.services.filter((s) => !hideEmpty || !isEmpty(s)).map((s) => {
                  const sk = `s:${s.code}`
                  const sOpen = !!open[sk]
                  return (
                    <React.Fragment key={sk}>
                      <tr onClick={() => s.items.length && setOpen((o) => ({ ...o, [sk]: !sOpen }))} style={{ cursor: s.items.length ? 'pointer' : 'default' }}>
                        <td style={{ paddingLeft: 24 }}>
                          <div>
                            {s.items.length ? (sOpen ? '▾ ' : '▸ ') : ''}{s.name ?? t('budget.svc.unassigned', 'Fără serviciu')}
                            {s.evaluated && s.level != null && <span className="muted" title={t('budget.svc.levelHint', 'Nivelul actual al serviciului (0–5) din evaluarea serviciilor.')} style={{ fontSize: 11 }}> · {t('budget.svc.levelShort', { l: s.level })}</span>}
                          </div>
                          <PurposeBar byPurpose={s.byPurpose} purposes={P} />
                        </td>
                        <Nums tot={s.totals} />
                      </tr>
                      {sOpen && <ContributionRows items={s.items} indent={44} pad={0} hideZero={hideEmpty} onLine={onLine} onProject={onProject} />}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            )
          })}
          <tr style={{ borderTop: '2px solid var(--border,#ccc)' }}>
            <td style={{ fontWeight: 700 }}>{t('budget.total', 'Total')}</td>
            <Nums tot={annual.totals} strong />
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t('budget.svc.note', 'Un cost comun mai multor servicii se împarte după ponderile din „Proiect - Serviciu”. Pentru proiectele multianuale intră doar tranșa anului; forecastul proiectului cuprinde plățile anului și restul de cost estimat pentru tranșele rămase.')}</div>
      <CheckLine annual={annual} />
    </div>
  )
}

export function FundView({ annual, onLine, onProject }: { annual: Annual; onLine: (id: string) => void; onProject: (code: string) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const [hideEmpty, setHideEmpty] = React.useState(true)
  const hasSums = (f: FundAnnual) => !isEmpty(f)
  const rows = annual.byFund.filter((f) => !hideEmpty || hasSums(f))
  // Funds grouped by dimension (Operațional / Tactic / Strategic), each group with its subtotal.
  const groups = [...annual.purposes.map((p) => ({ key: p.dimension, label: p.label, purpose: p.code as string | undefined })),
    { key: '_', label: t('budget.fund.otherGroup', 'Alte fonduri'), purpose: undefined }]
    .map((g) => ({ ...g, funds: rows.filter((f) => (annual.purposes.some((p) => p.dimension === f.dimension) ? f.dimension : '_') === g.key) }))
    .filter((g) => g.funds.length)
  const subtotal = (fs: FundAnnual[]): Tot => {
    const months: Record<string, MV> = {}
    const t0 = { budget: 0, actual: 0, forecast: 0 }
    for (const f of fs) {
      t0.budget += f.totals.budget; t0.actual += f.totals.actual; t0.forecast += f.totals.forecast
      for (const [m, v] of Object.entries(f.totals.months ?? {})) {
        const x = (months[m] ??= { budget: 0, actual: 0, forecast: 0 })
        x.budget += v.budget; x.actual += v.actual; x.forecast += v.forecast
      }
    }
    return { ...t0, variance: Math.round((t0.forecast - t0.budget) * 100) / 100, months }
  }
  const sumOr = (fs: FundAnnual[], k: 'target' | 'collected') => (fs.some((f) => f[k] != null) ? fs.reduce((a, f) => a + (f[k] ?? 0), 0) : null)
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <Toggle checked={hideEmpty} onChange={setHideEmpty} label={t('budget.hideZero', 'ascunde înregistrările cu zero')} />
      </div>
      <table className="table" style={{ minWidth: 820 }}>
        <NumHead year={yearsLabel(annual.years)} first={t('budget.col.fund', 'Fond sursă')} extra={[t('budget.fund.target', 'Țintă fond'), t('budget.fund.collected', 'Încasat')]} />
        <tbody>
          {groups.map((g) => {
            const gk = `g:${g.key}`
            const gOpen = open[gk] !== false
            return (
              <React.Fragment key={gk}>
                <tr onClick={() => setOpen((o) => ({ ...o, [gk]: !gOpen }))} style={{ cursor: 'pointer', background: GROUP_BG }}>
                  <td style={{ fontWeight: 700 }}>{gOpen ? '▾' : '▸'} <Dot purpose={g.purpose} />{g.label}</td>
                  <td style={{ ...R, fontWeight: 700 }}>{money0(sumOr(g.funds, 'target'))}</td>
                  <td style={{ ...R, fontWeight: 700 }}>{money0(sumOr(g.funds, 'collected'))}</td>
                  <Nums tot={subtotal(g.funds)} strong />
                </tr>
          {gOpen && g.funds.map((f) => {
            const k = f.code ?? '_'
            const isOpen = !!open[k]
            return (
              <React.Fragment key={k}>
                <tr onClick={() => f.items.length && setOpen((o) => ({ ...o, [k]: !isOpen }))} style={{ cursor: f.items.length ? 'pointer' : 'default' }}>
                  <td style={{ fontWeight: 600, paddingLeft: 24 }}>
                    {f.items.length ? (isOpen ? '▾ ' : '▸ ') : ''}{f.name ?? <span className="badge warning">{t('budget.fundToConfirm', 'de confirmat')}</span>}
                    {!f.appFund && f.code && <span className="badge warning" style={{ marginLeft: 6, fontWeight: 400 }}>{t('budget.fund.notSetUp', 'neconstituit în aplicație')}</span>}
                  </td>
                  <td style={R}>{money0(f.target)}</td>
                  <td style={R} title={t('budget.fund.collectedHint', 'Încasări înregistrate în aplicație (registrul fondului); încasările dinainte de migrare nu sunt incluse.')}>{money0(f.collected)}</td>
                  <Nums tot={f.totals} />
                </tr>
                {isOpen && <ContributionRows items={f.items} indent={44} pad={2} hideZero={hideEmpty} onLine={onLine} onProject={onProject} />}
              </React.Fragment>
            )
          })}
              </React.Fragment>
            )
          })}
          <tr style={{ borderTop: '2px solid var(--border,#ccc)' }}>
            <td style={{ fontWeight: 700 }}>{t('budget.total', 'Total')}</td>
            <td colSpan={2} />
            <Nums tot={annual.totals} strong />
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t('budget.fund.annualNote', 'Bugetul și restul de cost estimat stau pe fondul din care e planificată linia sau proiectul; actualul urmează fondul fiecărei plăți, deci un proiect plătit din mai multe fonduri apare la fiecare dintre ele.')}</div>
      <CheckLine annual={annual} />
    </div>
  )
}

export function ProjectsView({ portfolio, annual, onProject }: { portfolio: Portfolio; annual: Annual; onProject: (code: string) => void }) {
  const { t } = useI18n()
  const [hideZero, setHideZero] = React.useState(true)
  const label = yearsLabel(annual.years)
  const sel = new Map(annual.byProject.flatMap((g) => g.items.filter((i) => i.kind === 'PROJECT').map((i) => [i.code, i] as [string, Contribution])))
  const totOf = (codes: string[]): Tot => {
    const months: Record<string, MV> = {}
    const t0 = codes.reduce((a, c) => {
      const i = sel.get(c)
      if (!i) return a
      for (const [m, v] of Object.entries(i.months ?? {})) {
        const x = (months[m] ??= { budget: 0, actual: 0, forecast: 0 })
        x.budget += v.budget; x.actual += v.actual; x.forecast += v.forecast
      }
      return { budget: a.budget + i.budget, actual: a.actual + i.actual, forecast: a.forecast + i.forecast }
    }, { budget: 0, actual: 0, forecast: 0 })
    return { ...t0, variance: Math.round((t0.forecast - t0.budget) * 100) / 100, months }
  }
  const mc = React.useContext(MonthCtx)
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <Toggle checked={hideZero} onChange={setHideZero} label={t('budget.hideZero', 'ascunde înregistrările cu zero')} />
      </div>
      <table className="table" style={{ minWidth: 860 }}>
        <thead>
          <tr>
            <th>{t('budget.prj.project', 'Proiect')}</th>
            <th>{t('budget.col.fund', 'Fond sursă')}</th>
            <th style={R} title={t('budget.prj.totalHint', 'Bugetul întregului proiect, toți anii (Portofoliu).')}>{t('budget.prj.budgetAll', 'Buget proiect (toți anii)')}</th>
            {mc.monthly ? <MonthHeads label={label} /> : (
              <>
                <th style={R}>{t('budget.annual.budgetCol', { y: label })}</th>
                <th style={R}>{t('budget.annual.actualCol', 'Actual')}</th>
                <th style={R}>{t('budget.annual.forecastCol', 'Forecast')}</th>
                <th style={R}>{t('budget.annual.varianceCol', 'Abatere')}</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {portfolio.programs.map((pg) => {
            const ps = pg.projects.filter((p) => { const i = sel.get(p.code); return !hideZero || (i && (i.budget || i.actual || i.forecast)) })
            if (!ps.length) return null
            return (
              <React.Fragment key={pg.code}>
                <tr style={{ background: GROUP_BG }}>
                  <td colSpan={2} style={{ fontWeight: 700 }}>{pg.name}</td>
                  <td style={{ ...R, fontWeight: 700 }}>{money0(pg.totals.budget)}</td>
                  <Nums tot={totOf(pg.projects.map((p) => p.code))} strong />
                </tr>
                {ps.map((p) => (
                  <tr key={p.code} onClick={() => onProject(p.code)} style={{ cursor: 'pointer' }}>
                    <td style={{ paddingLeft: 18 }}>
                      <div>{p.name}</div>
                      {p.budget ? (
                        <div title={t('budget.prj.paidPct', { p: p.paidPct ?? 0 })} style={{ height: 4, background: 'var(--surface-2,#eee)', borderRadius: 2, marginTop: 4, maxWidth: 220 }}>
                          <div style={{ width: `${Math.min(100, p.paidPct ?? 0)}%`, height: 4, borderRadius: 2, background: PURPOSE_COLOR.TRANSFORM }} />
                        </div>
                      ) : null}
                    </td>
                    <td style={{ fontSize: 12 }}>{p.fundName ?? '—'}</td>
                    <td style={R}>{money0(p.budget)}</td>
                    <Nums tot={totOf([p.code])} />
                  </tr>
                ))}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t('budget.prj.selNote', { y: label })}</div>
    </div>
  )
}

/** Run / Maintain / Transform → program or area → line / project, for the selected years. */
export function DimensionView({ annual, onLine, onProject }: { annual: Annual; onLine: (id: string) => void; onProject: (code: string) => void }) {
  const { t } = useI18n()
  const [hideZero, setHideZero] = React.useState(true)
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const P = annual.purposes
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <Legend purposes={P} />
        <Toggle checked={hideZero} onChange={setHideZero} label={t('budget.hideZero', 'ascunde înregistrările cu zero')} />
      </div>
      <table className="table" style={{ minWidth: 680 }}>
        <NumHead year={yearsLabel(annual.years)} first={t('budget.view.dimension', 'Pe dimensiune')} />
        <tbody>
          {P.map((p) => {
            const tot = annual.byPurpose.find((x) => x.code === p.code)!.totals
            if (hideZero && isEmpty({ totals: tot })) return null
            const pOpen = open[p.code] !== false
            return (
              <React.Fragment key={p.code}>
                <tr onClick={() => setOpen((o) => ({ ...o, [p.code]: !pOpen }))} style={{ cursor: 'pointer', background: GROUP_BG }}>
                  <td style={{ fontWeight: 700 }}>{pOpen ? '▾' : '▸'} <Dot purpose={p.code} />{p.label}</td>
                  <Nums tot={tot} strong />
                </tr>
                {pOpen && annual.byProject.filter((g) => g.purpose === p.code && (!hideZero || !isEmpty(g))).map((g) => {
                  const gk = `g:${g.code}`
                  const gOpen = !!open[gk]
                  return (
                    <React.Fragment key={gk}>
                      <tr onClick={() => setOpen((o) => ({ ...o, [gk]: !gOpen }))} style={{ cursor: 'pointer' }}>
                        <td style={{ paddingLeft: 24, fontWeight: 600 }}>{gOpen ? '▾' : '▸'} {g.name}</td>
                        <Nums tot={g.totals} />
                      </tr>
                      {gOpen && <ContributionRows items={g.items} indent={44} pad={0} hideZero={hideZero} onLine={onLine} onProject={onProject} />}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            )
          })}
          <tr style={{ borderTop: '2px solid var(--border,#ccc)' }}>
            <td style={{ fontWeight: 700 }}>{t('budget.total', 'Total')}</td>
            <Nums tot={annual.totals} strong />
          </tr>
        </tbody>
      </table>
      <CheckLine annual={annual} />
    </div>
  )
}

/** Year picker: default the fiscal year; click years to add/remove; past / current / future shortcuts. */
export function YearSelector({ available, selected, fiscalYear, onChange }: { available: string[]; selected: string[]; fiscalYear: number; onChange: (ys: string[]) => void }) {
  const { t } = useI18n()
  const set = new Set(selected)
  const past = available.filter((y) => Number(y) < fiscalYear)
  const future = available.filter((y) => Number(y) > fiscalYear)
  const same = (a: string[]) => a.length === selected.length && a.every((y) => set.has(y))
  const quick: Array<[string, string[]]> = [
    [t('budget.yr.past', 'Trecut'), past], [t('budget.yr.current', 'Anul curent'), [String(fiscalYear)]],
    [t('budget.yr.future', 'Viitor'), future], [t('budget.yr.all', 'Toți anii'), available],
  ]
  const toggle = (y: string) => {
    const next = set.has(y) ? selected.filter((x) => x !== y) : [...selected, y]
    if (next.length) onChange(next.sort())
  }
  return (
    <div className="card" style={{ padding: '8px 12px' }}>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600 }}>{t('budget.yr.showing', { y: yearsLabel(selected) })}</div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {available.map((y) => (
            <button key={y} type="button" className={`btn small ${set.has(y) ? '' : 'ghost'}`} onClick={() => toggle(y)} aria-pressed={set.has(y)}
              style={Number(y) === fiscalYear ? { outline: '1px solid var(--accent,#0071e3)', outlineOffset: -1 } : undefined}>{y}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {quick.filter(([, ys]) => ys.length).map(([l, ys]) => (
            <button key={l} type="button" className="btn small ghost" disabled={same(ys)} onClick={() => onChange(ys)}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Budget per year (Portofoliu), by service or by fund. Budget only. */
export function MultiYearView({ multiYear: m, years, unit, rates }: { multiYear: MultiYear; years: string[]; unit: string; rates: Record<string, { rate: number; basis: string }> | null }) {
  const { t } = useI18n()
  const [by, setBy] = React.useState<'service' | 'fund'>('service')
  const [hideEmpty, setHideEmpty] = React.useState(true)
  const [closed, setClosed] = React.useState<Record<string, boolean>>({})
  const mc = React.useContext(MonthCtx)
  const { lang } = useI18n()
  const yearsSel = [...years].sort()
  const Y = mc.monthly ? mc.months : yearsSel
  const multi = yearsSel.length > 1
  const total = (x: YearMap) => Y.reduce((s, y) => s + (x[y] ?? 0), 0)
  const show = (x: YearMap) => !hideEmpty || total(x) !== 0
  const cells = (x: YearMap, bold?: boolean) => (
    <>
      {Y.map((y) => (
        <td key={y} style={{ ...R, fontWeight: bold ? 600 : undefined, color: x[y] ? undefined : 'var(--muted,#aaa)', background: Number(y) === m.year ? 'var(--accent-soft, rgba(0,113,227,0.06))' : undefined }}>
          {x[y] ? money0(x[y]) : '–'}
        </td>
      ))}
      <td style={{ ...R, fontWeight: 700 }}>{money0(total(x))}</td>
    </>
  )
  const sumWhere = (f: (y: number) => boolean) => yearsSel.filter((y) => f(Number(y))).reduce((s, y) => s + (m.totals[y] ?? 0), 0)
  const first = yearsSel[0]
  const last = yearsSel[yearsSel.length - 1]
  const cards: Array<[string, number, boolean?]> = [
    [first === last ? t('budget.yr.showing', { y: first }) : t('budget.my.total', { a: first, b: last }), yearsSel.reduce((s, y) => s + (m.totals[y] ?? 0), 0), true],
    ...(Number(first) < m.year ? [[t('budget.my.past', { y: m.year - 1 }), sumWhere((y) => y < m.year)] as [string, number]] : []),
    [String(m.year), sumWhere((y) => y === m.year)],
    ...(Number(last) > m.year ? [[t('budget.my.future', { y: m.year + 1 }), sumWhere((y) => y > m.year)] as [string, number]] : []),
  ]
  return (
    <>
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
      {cards.map(([label, v, main]) => (
        <div key={label} className="card" style={{ flex: '1 1 160px', minWidth: 160, borderTop: main ? '3px solid var(--accent,#0071e3)' : undefined }}>
          <div className="muted" style={{ fontSize: 12 }}>{label}</div>
          <div style={{ fontSize: main ? 22 : 18, fontWeight: 600 }}>{money0(v)} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{unit}</span></div>
        </div>
      ))}
    </div>
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
          {([['service', t('budget.view.service', 'Pe servicii')], ['fund', t('budget.view.fund', 'Pe fond')]] as const).map(([k, l]) => (
            <button key={k} type="button" className={`btn small ${by === k ? '' : 'ghost'}`} onClick={() => setBy(k)}>{l}</button>
          ))}
        </div>
        <Toggle checked={hideEmpty} onChange={setHideEmpty} label={t('budget.hideZero', 'ascunde înregistrările cu zero')} />
      </div>
      <table className="table" style={{ minWidth: 220 + Y.length * 100 }}>
        <thead>
          <tr>
            <th>{by === 'fund' ? t('budget.col.fund', 'Fond sursă') : t('budget.col.service', 'Serviciu')}</th>
            {Y.map((y) => (
              <th key={y} style={R} title={rates?.[y]?.basis}>
                {mc.monthly ? monthLabel(y, lang, multi) : y}
                {!mc.monthly && rates?.[y] && <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>{t('budget.fx.rate', { r: rates[y].rate.toLocaleString('ro-RO', { minimumFractionDigits: 4 }) })}</div>}
              </th>
            ))}
            <th style={R}>{t('budget.total', 'Total')}</th>
          </tr>
        </thead>
        <tbody>
          {by === 'service' && m.byService.filter((d) => show(d.plan)).map((d) => {
            const k = d.name ?? '_'
            const isOpen = !closed[k]
            return (
              <React.Fragment key={k}>
                <tr onClick={() => setClosed((c) => ({ ...c, [k]: isOpen }))} style={{ cursor: 'pointer', background: GROUP_BG }}>
                  <td style={{ fontWeight: 700 }}>{isOpen ? '▾' : '▸'} {d.name ?? t('budget.svc.unassigned', 'Fără serviciu')}</td>
                  {cells(d.plan, true)}
                </tr>
                {isOpen && d.services.filter((x) => show(x.plan)).map((x) => (
                  <tr key={x.code ?? '_'}>
                    <td style={{ paddingLeft: 24 }}>{x.name ?? t('budget.svc.unassigned', 'Fără serviciu')}</td>
                    {cells(x.plan)}
                  </tr>
                ))}
              </React.Fragment>
            )
          })}
          {by === 'fund' && m.byFund.filter((f) => show(f.plan)).map((f) => (
            <tr key={f.code ?? '_'}>
              <td>
                {f.name ?? <span className="badge warning">{t('budget.fundToConfirm', 'de confirmat')}</span>}
                {!f.appFund && f.code && <span className="badge warning" style={{ marginLeft: 6 }}>{t('budget.fund.notSetUp', 'neconstituit în aplicație')}</span>}
              </td>
              {cells(f.plan)}
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid var(--border,#ccc)' }}>
            <td style={{ fontWeight: 700 }}>{t('budget.total', 'Total')}</td>
            {cells(m.totals, true)}
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t('budget.my.note', 'Bugetul pe ani din Portofoliu. Un cost comun mai multor servicii se împarte după ponderile din „Proiect - Serviciu”.')}</div>
    </div>
    </>
  )
}

export function ProjectModal({ project: p, years, onClose, onLine }: { project: Project; years: string[]; onClose: () => void; onLine: (id: string) => void }) {
  const { t } = useI18n()
  const [tab, setTab] = React.useState<'years' | 'areas' | 'vendors' | 'lines'>('years')
  const kpis: Array<[string, number | null, string?]> = [
    [t('budget.prj.budget', 'Buget proiect'), p.budget], [t('budget.prj.linesBudget', 'Bugetat pe linii'), p.linesBudget],
    [t('budget.prj.estimate', 'Estimare'), p.estimate], [t('budget.prj.committed', 'Angajat'), p.committed], [t('budget.prj.paid', 'Plătit'), p.paid],
    [t('budget.prj.remaining', 'Rest de plată'), p.remainingToPay], [t('budget.annual.forecastCol', 'Forecast'), p.forecast], [t('budget.annual.varianceCol', 'Abatere'), p.variance, 'v'],
  ]
  const yrs = [...new Set([...years, ...Object.keys(p.yearPlan), ...Object.keys(p.paidByYear)])].sort()
  const areaTable = (rows: Area[], head: string) => (
    <table className="table">
      <thead>
        <tr>
          <th>{head}</th>
          <th style={R}>{t('budget.prj.estimate', 'Estimare')}</th>
          <th style={R}>{t('budget.prj.inBudget', 'din care în buget')}</th>
          <th style={R}>{t('budget.prj.committed', 'Angajat')}</th>
          <th style={R}>{t('budget.prj.paid', 'Plătit')}</th>
          <th style={R}>{t('budget.prj.remaining', 'Rest de plată')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td style={R}>{money(r.estimate)}</td>
            <td style={R}>{money(r.budget)}</td>
            <td style={R}>{money(r.committed)}</td>
            <td style={R}>{money(r.paid)}</td>
            <td style={R}>{money(r.remainingToPay)}</td>
          </tr>
        ))}
        <tr style={{ borderTop: '2px solid var(--border,#ccc)', fontWeight: 600 }}>
          <td>{t('budget.total', 'Total')}</td>
          {(['estimate', 'budget', 'committed', 'paid', 'remainingToPay'] as const).map((k) => <td key={k} style={R}>{money(rows.reduce((s, r) => s + r[k], 0))}</td>)}
        </tr>
      </tbody>
    </table>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 999, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1040, width: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>{p.name}</h4>
            <div className="muted" style={{ fontSize: 12 }}>{[p.programName, p.scope !== p.name ? p.scope : null].filter(Boolean).join(' · ')}</div>
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
            <span>{t('budget.col.fund', 'Fond sursă')}: <strong>{p.fundName ?? '—'}</strong>{p.fundLabel && p.fundLabel !== p.fundName ? <span className="muted"> ({p.fundLabel})</span> : null}</span>
            <span>{t('budget.prj.vote', 'Vot / ani')}: <strong>{p.voteYear ?? '—'}{p.durationYears ? ` · ${t('budget.prj.years', { n: p.durationYears })}` : ''}</strong></span>
            {p.budgetEur != null && <span>EUR: <strong>{money(p.budgetEur)}</strong></span>}
            <span>{t('budget.col.status', 'Stare')}: <strong>{p.statusLabel}</strong></span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {kpis.map(([label, v, kind]) => (
              <div key={label} className="card" style={{ padding: '6px 10px', minWidth: 110 }}>
                <div className="muted" style={{ fontSize: 11 }}>{label}</div>
                <div style={{ fontWeight: 600, color: kind === 'v' && v != null ? tone(v, p.budget ?? 0) : undefined }}>{kind === 'v' && v != null ? signed(v) : money(v)}</div>
              </div>
            ))}
          </div>

          <div className="row" style={{ gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('budget.prj.byFund', 'Plăți pe fonduri')}</div>
              {p.paidByFund.length ? p.paidByFund.map((f) => <div key={f.code ?? '_'}>{f.name ?? t('budget.fundToConfirm', 'de confirmat')}: <strong>{money(f.amount)}</strong></div>) : <div>—</div>}
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('budget.prj.services', 'Servicii deservite')}</div>
              {p.serviceSplit.map((s) => <div key={s.code}>{s.label ?? t('budget.svc.unassigned', 'Fără serviciu')}: <strong>{pct(s.weight)}</strong></div>)}
              {p.serviceSplitNote && <div className="muted" style={{ fontSize: 11 }}>{p.serviceSplitNote}</div>}
            </div>
          </div>

          <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
            {([['years', t('budget.prj.tab.years', 'Tranșe și plăți pe ani')], ['areas', t('budget.prj.tab.areas', 'Pe arii de lucru')], ['vendors', t('budget.prj.tab.vendors', 'Pe furnizori')], ['lines', t('budget.prj.tab.lines', { n: p.lines.length })]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`btn small ${tab === k ? '' : 'ghost'}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === 'years' && (
            <>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('budget.prj.year', 'An')}</th>
                    <th style={R}>{t('budget.prj.tranche', 'Tranșă buget (Portofoliu)')}</th>
                    <th style={R}>{t('budget.prj.paid', 'Plătit')}</th>
                    <th style={R}>{t('budget.prj.diff', 'Plătit − tranșă')}</th>
                  </tr>
                </thead>
                <tbody>
                  {yrs.map((y) => {
                    const b = p.yearPlan[y] ?? 0
                    const a = p.paidByYear[y] ?? 0
                    return (
                      <tr key={y} style={{ fontWeight: y === String(p.year.year) ? 600 : undefined }}>
                        <td>{y}</td>
                        <td style={R}>{money(b)}</td>
                        <td style={R}>{money(a)}</td>
                        <td style={R}>{signed(Math.round((a - b) * 100) / 100)}</td>
                      </tr>
                    )
                  })}
                  {p.undatedPaid > 0 && (
                    <tr>
                      <td>{t('budget.prj.undated', 'Plăți fără dată în registru')}</td>
                      <td />
                      <td style={R}>{money(p.undatedPaid)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="card" style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))', fontSize: 13 }}>
                {t('budget.prj.yearSlice', { y: p.year.year, b: money(p.year.budget), a: money(p.year.actual), f: money(p.year.forecast) })}
                {p.year.overdue && <div style={{ marginTop: 4 }}><span className="badge warning">{t('budget.prj.overdue', 'tranșe depășite')}</span> {t('budget.prj.overdueHint', 'Tranșele din Portofoliu sunt în anii trecuți, dar proiectul are încă cost de plătit; restul e estimat în anul curent până la o replanificare.')}</div>}
              </div>
            </>
          )}
          {tab === 'areas' && areaTable(p.byArea, t('budget.prj.area', 'Arie de lucru'))}
          {tab === 'vendors' && areaTable(p.byVendor, t('budget.vendor', 'Furnizor'))}
          {tab === 'lines' && (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('budget.col.line', 'Linie')}</th>
                  <th>{t('budget.col.fund', 'Fond sursă')}</th>
                  <th style={R}>{t('budget.prj.inBudget', 'din care în buget')}</th>
                  <th style={R}>{t('budget.prj.committed', 'Angajat')}</th>
                  <th style={R}>{t('budget.prj.paid', 'Plătit')}</th>
                  <th style={R}>{t('budget.annual.forecastCol', 'Forecast')}</th>
                  <th>{t('budget.col.status', 'Stare')}</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.id} onClick={() => onLine(l.id)} style={{ cursor: 'pointer' }}>
                    <td><div>{l.name}</div>{l.area ? <div className="muted" style={{ fontSize: 11 }}>{l.area}</div> : null}</td>
                    <td style={{ fontSize: 12 }}>{l.fundName ?? '—'}</td>
                    <td style={R}>{money(l.metrics.budget)}</td>
                    <td style={R}>{l.metrics.committed == null ? '—' : money(l.metrics.committed)}</td>
                    <td style={R}>{money(l.metrics.actual)}</td>
                    <td style={R}>{money(l.metrics.forecast)}</td>
                    <td><span className="badge">{l.statusLabel}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {p.source && <div className="muted" style={{ fontSize: 11 }}>{t('budget.source', 'Sursă')}: {p.source}</div>}
        </div>
      </div>
    </div>
  )
}

type FxEntry = { rate: number; basis: string; fromFund?: { code: string; ron: number; eur: number }; manual?: boolean }
/**
 * EUR rates of the selected years, editable: type a rate, or pick a fund and its EUR amount in that
 * year (rate = the fund's RON budget that year ÷ the EUR amount).
 */
export function FxPanel({ years, rates, fundBudgetRon, onSave }: {
  years: string[]; rates: Record<string, FxEntry>; fundBudgetRon: Record<string, Array<{ code: string; name: string; ron: number }>>
  onSave: (year: string, body: { rate?: number; fundCode?: string; eur?: number }) => Promise<void>
}) {
  const { t } = useI18n()
  const [edit, setEdit] = React.useState<Record<string, { rate: string; fund: string; eur: string }>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const parse = (v: string) => Number(v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'))
  const parseRate = (v: string) => Number(v.trim().replace(',', '.'))
  const fmtRate = (r: number) => r.toLocaleString('ro-RO', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  const save = async (y: string, body: { rate?: number; fundCode?: string; eur?: number }) => {
    setBusy(y); setErr(null)
    try { await onSave(y, body); setEdit((e) => { const n = { ...e }; delete n[y]; return n }) } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setBusy(null) }
  }
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('budget.fx.title', 'Curs EUR pe ani')}</div>
      <table className="table" style={{ minWidth: 720 }}>
        <thead>
          <tr>
            <th>{t('budget.prj.year', 'An')}</th>
            <th>{t('budget.fx.rateCol', '1 € = lei')}</th>
            <th>{t('budget.fx.basis', 'Bază')}</th>
            <th>{t('budget.fx.fromFund', 'sau din fond: suma în EUR')}</th>
          </tr>
        </thead>
        <tbody>
          {[...years].sort().map((y) => {
            const r = rates[y]
            const e = edit[y] ?? { rate: r ? fmtRate(r.rate) : '', fund: r?.fromFund?.code ?? fundBudgetRon[y]?.[0]?.code ?? '', eur: r?.fromFund ? String(r.fromFund.eur) : '' }
            const set = (k: 'rate' | 'fund' | 'eur', v: string) => setEdit((x) => ({ ...x, [y]: { ...e, [k]: v } }))
            const funds = fundBudgetRon[y] ?? []
            const f = funds.find((x) => x.code === e.fund)
            const eurN = parse(e.eur)
            return (
              <tr key={y}>
                <td style={{ fontWeight: 600 }}>{y}</td>
                <td>
                  <div className="row" style={{ gap: 4, alignItems: 'center' }}>
                    <input className="input" style={{ width: 100 }} value={e.rate} onChange={(ev) => set('rate', ev.target.value)} inputMode="decimal" aria-label={t('budget.fx.rateCol', '1 € = lei')} />
                    <button type="button" className="btn small" disabled={busy === y || !(parseRate(e.rate) > 0) || (r && Math.abs(parseRate(e.rate) - r.rate) < 1e-7)} onClick={() => save(y, { rate: parseRate(e.rate) })}>{t('common.save', 'Salvează')}</button>
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{r?.basis ?? '—'}{r?.manual ? <span className="badge" style={{ marginLeft: 6 }}>{t('budget.fx.manual', 'editat')}</span> : null}</td>
                <td>
                  {funds.length ? (
                    <div className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select className="input" value={e.fund} onChange={(ev) => set('fund', ev.target.value)}>
                        {funds.map((x) => <option key={x.code} value={x.code}>{x.name} ({money0(x.ron)} lei)</option>)}
                      </select>
                      <span>=</span>
                      <input className="input" style={{ width: 110 }} value={e.eur} onChange={(ev) => set('eur', ev.target.value)} inputMode="decimal" placeholder="€" />
                      <span>€</span>
                      <button type="button" className="btn small" disabled={busy === y || !f || !(eurN > 0)} onClick={() => save(y, { fundCode: e.fund, eur: eurN })}>
                        {f && eurN > 0 ? t('budget.fx.apply', { r: fmtRate(f.ron / eurN) }) : t('budget.fx.applyEmpty', 'Aplică')}
                      </button>
                    </div>
                  ) : <span className="muted" style={{ fontSize: 12 }}>{t('budget.fx.noFund', 'niciun fond cu buget în acest an')}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {err && <div className="badge negative" style={{ marginTop: 6 }}>{err}</div>}
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('budget.fx.help', 'Fiecare an se convertește la cursul lui. „Din fond”: cursul = bugetul fondului în acel an (lei) ÷ suma în EUR, deci fondul are exact suma în EUR. Cursurile editate rămân și după reimportul bugetului.')}</div>
    </div>
  )
}

/** What Buget, Actual, Forecast and Abatere mean, and why they come in that order. */
export function Definitions() {
  const { t } = useI18n()
  return (
    <details className="card" style={{ padding: '8px 12px', fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('budget.def.title', 'Ce înseamnă Buget, Actual, Forecast și Abatere')}</summary>
      <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 12px' }}>
        <dt style={{ fontWeight: 600 }}>{t('budget.def.budget', 'Buget')}</dt><dd style={{ margin: 0 }}>{t('budget.def.budgetText', '')}</dd>
        <dt style={{ fontWeight: 600 }}>{t('budget.def.actual', 'Actual')}</dt><dd style={{ margin: 0 }}>{t('budget.def.actualText', '')}</dd>
        <dt style={{ fontWeight: 600 }}>{t('budget.def.forecast', 'Forecast')}</dt><dd style={{ margin: 0 }}>{t('budget.def.forecastText', '')}</dd>
        <dt style={{ fontWeight: 600 }}>{t('budget.def.variance', 'Abatere')}</dt><dd style={{ margin: 0 }}>{t('budget.def.varianceText', '')}</dd>
      </dl>
      <div className="muted" style={{ marginTop: 8 }}>{t('budget.def.order', '')}</div>
    </details>
  )
}
