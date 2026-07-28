import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

type Metric = { owed: number; paid: number; outstanding: number; opening: number; charges: number; adjustments: number; ratePct: number | null }
type FundNode = Metric & { code: string; label: string; shortName: string | null; cpi: number }
type DomainNode = Metric & { key: string; label: string; cpi: number; funds: FundNode[] }
type BeRow = Metric & { beId: string; code: string | null; displayName: string; cpi: number; byFund: Record<string, Metric> }
type HistoryPoint = { periodCode: string; status: string; owed: number; paid: number; outstanding: number; ratePct: number | null }
type Report = {
  period: { code: string; status: string } | null
  totals: Metric & { cpi: number }
  domains: DomainNode[]
  rows: BeRow[]
  history?: HistoryPoint[]
  checks: { identityOk: boolean; residual: number }
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Rate colour thresholds — higher is better. */
function rateColor(pct: number | null): string {
  if (pct == null) return 'var(--muted, #888)'
  if (pct >= 95) return '#16a34a'
  if (pct >= 75) return '#d97706'
  if (pct >= 50) return '#ea580c'
  return '#dc2626'
}

function Bar({ pct }: { pct: number | null }) {
  const v = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div style={{ width: '100%', height: 8, borderRadius: 999, background: 'rgba(128,128,128,0.2)', overflow: 'hidden' }}>
      <div style={{ width: `${v}%`, height: '100%', background: rateColor(pct), transition: 'width .2s' }} />
    </div>
  )
}

export function CollectionRatePanel({
  communityId,
  reportPath,
  periodsPath,
}: {
  communityId: string
  // Resident (read-only) mode points these at the me/ + closed-periods routes; admin uses the defaults.
  reportPath?: string
  periodsPath?: string
}) {
  const { api } = useAuth()
  const reportBase = reportPath ?? `/communities/${communityId}/reports/collection-rate`
  const periodsBase = periodsPath ?? `/communities/${communityId}/periods`
  const { t: rawT } = useI18n()
  // useI18n's t() returns the key itself when a translation is missing, so fall back explicitly.
  const t = (k: string, d = '') => {
    const v = rawT(k as any)
    return v && v !== k ? v : d
  }
  const meta = useMetadata()

  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState<string>('')
  const [domain, setDomain] = React.useState<string>('')
  const [data, setData] = React.useState<Report | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const [chartHistory, setChartHistory] = React.useState<HistoryPoint[]>([])

  React.useEffect(() => {
    if (!communityId) return
    api.get<any[]>(periodsBase)
      .then((rows: any[]) => setPeriods(rows || []))
      .catch(() => setPeriods([]))
  }, [api, communityId, periodsBase])

  // Full-timeline history for the chart (latest period), independent of the selected-period detail —
  // the per-period report truncates history to ≤ selected, so this keeps the chart complete.
  React.useEffect(() => {
    if (!communityId) return
    const q = domain ? `?domain=${encodeURIComponent(domain)}` : ''
    api.get<Report>(`/communities/${communityId}/reports/collection-rate${q}`)
      .then((r: Report) => setChartHistory(r.history ?? []))
      .catch(() => setChartHistory([]))
  }, [api, communityId, domain])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    const qs = new URLSearchParams()
    if (period) qs.set('period', period)
    if (domain) qs.set('domain', domain)
    api.get<Report>(`${reportBase}${qs.toString() ? `?${qs}` : ''}`)
      .then((r: Report) => { if (alive) { setData(r); setLoading(false); if (!period && r?.period?.code) setPeriod(r.period.code) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period, domain, reportBase])

  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }))

  const isEmpty = !loading && (!data || !data.domains.length)

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{t('collection.title', 'Grad de colectare')}</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}
            aria-label={t('collection.period', 'Perioadă')}>
            {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
          </select>
          <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)}
            aria-label={t('collection.domain', 'Domeniu')}>
            <option value="">{t('collection.allDomains', 'Toate domeniile')}</option>
            {(meta?.fundDomains ?? []).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="muted">{t('common.loading', 'Se încarcă…')}</div></div>
      ) : isEmpty ? (
        <div className="card">
          <div className="empty">{t('collection.empty', 'Nu există date pentru selecția curentă')}</div>
          {domain ? (
            <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => setDomain('')}>
              {t('collection.clearFilters', 'Șterge filtrele')}
            </button>
          ) : null}
        </div>
      ) : data ? (
        <>
          {/* History overview — click a period to load its detail below */}
          {chartHistory.length > 1 ? <HistoryChart history={chartHistory} selected={data.period?.code || period} onSelect={setPeriod} /> : null}

          {/* Per-period detail */}
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {t('collection.detailFor', 'Detaliu perioadă')}: <strong>{data.period?.code || period}</strong>
          </div>

          {/* Totals */}
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <span className="muted">{t('collection.rate', 'Grad de colectare')}</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: rateColor(data.totals.ratePct) }}>
                {data.totals.ratePct == null ? '—' : `${data.totals.ratePct} %`}
              </span>
            </div>
            <div style={{ marginTop: 8 }}><Bar pct={data.totals.ratePct} /></div>
            <div className="row" style={{ gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
              <Stat label={t('collection.charges', 'Facturat')} value={money(data.totals.charges)} />
              <Stat label={t('collection.adjustments', 'Ajustări')} value={money(data.totals.adjustments)} />
              <Stat label={t('collection.owed', 'Datorat')} value={money(data.totals.owed)} />
              <Stat label={t('collection.paid', 'Plătit')} value={money(data.totals.paid)} />
              <Stat label={t('collection.outstanding', 'Restant')} value={money(data.totals.outstanding)} />
            </div>
            <details className="muted" style={{ marginTop: 6, fontSize: 11 }}>
              <summary style={{ cursor: 'pointer' }}>
                {t('collection.owedFormula', 'Datorat = Sold precedent + Facturat + Ajustări · Grad = Plătit / Facturat')}
              </summary>
              <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55, maxWidth: 780 }}>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>{t('collection.charges', 'Facturat')}</strong> {t('collection.explain.chargesDef', 'este suma efectiv emisă drept cote (facturarea propriu-zisă), cumulată pe perioade. Pentru un fond a cărui facturare s-a încheiat, această valoare rămâne fixă.')}
                </p>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>{t('collection.owed', 'Datorat')}</strong> {t('collection.explain.owedDef1', 'este cât se datorează în total. Pe lângă Facturat, mai include două elemente care')} <em>{t('collection.explain.not', 'nu')}</em> {t('collection.explain.owedDef2', 'sunt facturi noi:')}
                </p>
                <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
                  <li>
                    <strong>{t('collection.opening', 'Sold precedent')}</strong> ({money(data.totals.opening)}) — {t('collection.explain.openingDef', 'restanțe reportate dinaintea primei perioade afișate.')}
                  </li>
                  <li>
                    <strong>{t('collection.adjustments', 'Ajustări')}</strong> ({money(data.totals.adjustments)}) — {t('collection.explain.adjustmentsDef', 'corecții de sold: repartizări/reponderări de cote între proprietari, reconcilieri cu registrul contabil, ștergeri de credite. Acestea mută sau corectează datoria, fără o facturare nouă.')}
                  </li>
                </ul>
                <p style={{ margin: '0 0 6px' }}>
                  {t('collection.explain.currentSelection', 'Pentru selecția curentă:')} <strong>{money(data.totals.charges)}</strong> ({t('collection.charges', 'Facturat')})
                  {' + '}{money(data.totals.opening)} ({t('collection.opening', 'Sold precedent')})
                  {' + '}{money(data.totals.adjustments)} ({t('collection.adjustments', 'Ajustări')})
                  {' = '}<strong>{money(data.totals.owed)}</strong> ({t('collection.owed', 'Datorat')}). {t('collection.explain.soDifference', 'Așadar diferența')}{' '}
                  <strong>{t('collection.owed', 'Datorat')} − {t('collection.charges', 'Facturat')} = {money(data.totals.owed - data.totals.charges)}</strong>{' '}
                  ({t('collection.explain.equalsOpeningPlusAdj', '= Sold precedent + Ajustări')}).
                </p>
                <p style={{ margin: 0 }}>
                  {t('collection.explain.sameDecomposition', 'Aceeași descompunere se aplică la fiecare nivel (domeniu, fond, proprietar). Gradul de colectare se raportează la')} <strong>{t('collection.charges', 'Facturat')}</strong> {t('collection.explain.rateBasis', '(Plătit ÷ Facturat), nu la Datorat.')}
                </p>
              </div>
            </details>
            {!data.checks.identityOk ? (
              <div className="muted" style={{ marginTop: 8, color: '#dc2626' }}>
                {t('collection.identityWarn', 'Atenție: datorat − plătit ≠ restant')} ({money(data.checks.residual)})
              </div>
            ) : null}
          </div>

          {/* Tree: domain → fund → billing entity */}
          <div className="card">
            <div className="row" style={{ gap: 12, padding: '0 4px 6px', fontSize: 12 }}>
              <span className="muted" style={{ flex: 1, minWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t('collection.tree', 'Domeniu / fond / proprietar')}</span>
              <span className="muted" style={{ width: 190, textAlign: 'right' }}>{t('collection.rate', 'Grad')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.charges', 'Facturat')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.owed', 'Datorat')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.paid', 'Plătit')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.outstanding', 'Restant')}</span>
            </div>

            {data.domains.map((d) => {
              const dk = `d:${d.key}`
              return (
                <div key={dk}>
                  <TreeRow depth={0} open={!!expanded[dk]} onToggle={() => toggle(dk)}
                    name={d.label} m={d} strong />
                  {expanded[dk] && d.funds.map((f) => {
                    const fk = `f:${d.key}:${f.code}`
                    const leaves = data.rows
                      .filter((r) => r.byFund[f.code])
                      .map((r) => ({ row: r, m: r.byFund[f.code] }))
                      .sort((a, b) => b.m.outstanding - a.m.outstanding)
                    return (
                      <div key={fk}>
                        <TreeRow depth={1} open={!!expanded[fk]} onToggle={() => toggle(fk)}
                          name={f.shortName || f.label} m={f} />
                        {expanded[fk] && leaves.map(({ row, m }) => (
                          <TreeRow key={`${fk}:${row.beId}`} depth={2} name={row.displayName} m={m} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

// Hand-rolled SVG chart (no charting dependency): collection rate % as a line (left, 0–100%),
// outstanding debt as a scaled area behind it, period on the horizontal axis. Hover for exact values.
function HistoryChart({ history, selected, onSelect }: { history: HistoryPoint[]; selected?: string; onSelect: (code: string) => void }) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [hi, setHi] = React.useState<number | null>(null)
  const firstNZ = history.findIndex((h) => h.owed > 0.005 || Math.abs(h.outstanding) > 0.005)
  const pts = firstNZ >= 0 ? history.slice(firstNZ) : history
  const n = pts.length
  if (n < 2) return null
  const W = 860, H = 240, padL = 8, padR = 8, padT = 16, padB = 28
  const plotW = W - padL - padR, plotH = H - padT - padB
  const maxOut = Math.max(1, ...pts.map((p) => p.outstanding))
  const X = (i: number) => padL + (i * plotW) / (n - 1)
  const yRate = (r: number | null) => padT + plotH - (Math.max(0, Math.min(100, r ?? 0)) / 100) * plotH
  const yOut = (o: number) => padT + plotH - (Math.max(0, o) / maxOut) * plotH
  const rateLine = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${yRate(p.ratePct).toFixed(1)}`).join(' ')
  const area = `M${X(0).toFixed(1)},${(padT + plotH).toFixed(1)} `
    + pts.map((p, i) => `L${X(i).toFixed(1)},${yOut(p.outstanding).toFixed(1)}`).join(' ')
    + ` L${X(n - 1).toFixed(1)},${(padT + plotH).toFixed(1)} Z`
  const step = Math.max(1, Math.ceil(n / 10))
  const showLabel = (i: number) => pts[i].periodCode.endsWith('-01') || i === 0 || i === n - 1 || i % step === 0
  const cur = hi != null ? pts[hi] : null
  const selIdx = pts.findIndex((p) => p.periodCode === selected)
  const idxFromEvent = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    return Math.max(0, Math.min(n - 1, Math.round(((px - padL) / plotW) * (n - 1))))
  }
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => setHi(idxFromEvent(e))
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => onSelect(pts[idxFromEvent(e)].periodCode)
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>{t('collection.chart.title', 'Evoluție pe perioade — grad de colectare & restanță')}</span>
        <span className="row" style={{ gap: 12, fontSize: 11 }}>
          <span style={{ color: '#2563eb' }}>▬ {t('collection.chart.rateLegend', 'grad (%)')}</span>
          <span className="muted">▧ {t('collection.chart.arrearsLegend', 'restanță (scalat)')}</span>
        </span>
      </div>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" style={{ display: 'block', overflow: 'visible', cursor: 'pointer' }}
          onMouseMove={onMove} onMouseLeave={() => setHi(null)} onClick={onClick}>
          {[0, 25, 50, 75, 100].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={yRate(g)} y2={yRate(g)} stroke="var(--border, #e5e5e5)" strokeWidth={0.6} strokeDasharray={g === 0 ? '' : '3 3'} />
              <text x={padL} y={yRate(g) - 2} fontSize={9} fill="var(--muted, #999)">{g}%</text>
            </g>
          ))}
          <path d={area} fill="var(--muted, #94a3b8)" opacity={0.16} />
          <path d={rateLine} fill="none" stroke="#2563eb" strokeWidth={1.6} />
          {pts.map((p, i) => showLabel(i)
            ? <text key={i} x={X(i)} y={H - 8} fontSize={9} fill="var(--muted, #999)" textAnchor="middle">{p.periodCode.slice(2)}</text>
            : null)}
          {selIdx >= 0 ? (
            <g>
              <line x1={X(selIdx)} x2={X(selIdx)} y1={padT} y2={padT + plotH} stroke="#2563eb" strokeWidth={1.4} strokeDasharray="4 2" />
              <circle cx={X(selIdx)} cy={yRate(pts[selIdx].ratePct)} r={4} fill="#2563eb" stroke="var(--bg, #fff)" strokeWidth={1.5} />
            </g>
          ) : null}
          {cur && hi != null ? (
            <g>
              <line x1={X(hi)} x2={X(hi)} y1={padT} y2={padT + plotH} stroke="var(--muted, #94a3b8)" strokeWidth={0.8} />
              <circle cx={X(hi)} cy={yRate(cur.ratePct)} r={3} fill="#2563eb" />
            </g>
          ) : null}
        </svg>
        {cur ? (
          <div style={{ position: 'absolute', top: 0, right: 0, background: 'var(--bg, #fff)', border: '1px solid var(--border, #e5e5e5)', borderRadius: 6, padding: '4px 8px', fontSize: 11, pointerEvents: 'none' }}>
            <strong>{cur.periodCode}</strong>{' · '}
            <span style={{ color: rateColor(cur.ratePct) }}>{cur.ratePct == null ? '—' : `${cur.ratePct}%`}</span>{' · '}
            {money(cur.outstanding)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function TreeRow({ depth, name, m, open, onToggle, strong }: {
  depth: number
  name: string
  m: Metric
  open?: boolean
  onToggle?: () => void
  strong?: boolean
}) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const clickable = !!onToggle
  return (
    <div
      className="row"
      onClick={onToggle}
      role={clickable ? 'button' : undefined}
      aria-expanded={clickable ? !!open : undefined}
      style={{
        gap: 12, alignItems: 'center', padding: '6px 4px',
        borderTop: '1px solid rgba(128,128,128,0.15)',
        cursor: clickable ? 'pointer' : 'default',
        fontWeight: strong ? 600 : 400,
      }}
    >
      {/* Indent lives INSIDE the name cell so the value columns keep a fixed position and stay
          aligned across drill levels (indenting the whole row shifted them rightward). */}
      <span style={{ flex: 1, minWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {depth > 0 ? <span style={{ display: 'inline-block', width: depth * 18 }} /> : null}
        {clickable ? <span className="muted" style={{ marginRight: 6 }}>{open ? '▾' : '▸'}</span> : null}
        {name}
      </span>
      <span className="row" style={{ width: 190, gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
        <span style={{ flex: 1 }}><Bar pct={m.ratePct} /></span>
        <span style={{ width: 54, textAlign: 'right', color: rateColor(m.ratePct) }}>
          {m.ratePct == null ? '—' : `${m.ratePct}%`}
        </span>
      </span>
      <span style={{ width: 130, textAlign: 'right' }} title={money(m.adjustments) + ' ' + t('collection.adjustmentsLabel', 'ajustări')}>{money(m.charges)}</span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.owed)}</span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.paid)}</span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.outstanding)}</span>
    </div>
  )
}
