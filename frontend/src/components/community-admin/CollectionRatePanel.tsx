import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata } from '../../hooks/useMetadata'

type Metric = { owed: number; paid: number; outstanding: number; ratePct: number | null }
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

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

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

export function CollectionRatePanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
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

  React.useEffect(() => {
    if (!communityId) return
    api.get<any[]>(`/communities/${communityId}/periods`)
      .then((rows: any[]) => setPeriods(rows || []))
      .catch(() => setPeriods([]))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    const qs = new URLSearchParams()
    if (period) qs.set('period', period)
    if (domain) qs.set('domain', domain)
    api.get<Report>(`/communities/${communityId}/reports/collection-rate${qs.toString() ? `?${qs}` : ''}`)
      .then((r: Report) => { if (alive) { setData(r); setLoading(false); if (!period && r?.period?.code) setPeriod(r.period.code) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period, domain])

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
              <Stat label={t('collection.owed', 'Datorat')} value={money(data.totals.owed)} />
              <Stat label={t('collection.paid', 'Plătit')} value={money(data.totals.paid)} />
              <Stat label={t('collection.outstanding', 'Restant')} value={money(data.totals.outstanding)} />
              <Stat label="CPI" value={String(data.totals.cpi)} />
            </div>
            {!data.checks.identityOk ? (
              <div className="muted" style={{ marginTop: 8, color: '#dc2626' }}>
                {t('collection.identityWarn', 'Atenție: datorat − plătit ≠ restant')} ({money(data.checks.residual)})
              </div>
            ) : null}
          </div>

          {/* History: collection rate + outstanding over periods */}
          {data.history && data.history.length > 1 ? <HistoryChart history={data.history} /> : null}

          {/* Tree: domain → fund → billing entity */}
          <div className="card">
            <div className="row" style={{ gap: 12, padding: '0 4px 6px', fontSize: 12 }}>
              <span className="muted" style={{ flex: 1 }}>{t('collection.tree', 'Domeniu / fond / proprietar')}</span>
              <span className="muted" style={{ width: 190, textAlign: 'right' }}>{t('collection.rate', 'Grad')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.owed', 'Datorat')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.paid', 'Plătit')}</span>
              <span className="muted" style={{ width: 130, textAlign: 'right' }}>{t('collection.outstanding', 'Restant')}</span>
              <span className="muted" style={{ width: 60, textAlign: 'right' }}>CPI</span>
            </div>

            {data.domains.map((d) => {
              const dk = `d:${d.key}`
              return (
                <div key={dk}>
                  <TreeRow depth={0} open={!!expanded[dk]} onToggle={() => toggle(dk)}
                    name={d.label} m={d} cpi={d.cpi} strong />
                  {expanded[dk] && d.funds.map((f) => {
                    const fk = `f:${d.key}:${f.code}`
                    const leaves = data.rows
                      .filter((r) => r.byFund[f.code])
                      .map((r) => ({ row: r, m: r.byFund[f.code] }))
                      .sort((a, b) => b.m.outstanding - a.m.outstanding)
                    return (
                      <div key={fk}>
                        <TreeRow depth={1} open={!!expanded[fk]} onToggle={() => toggle(fk)}
                          name={f.shortName || f.label} m={f} cpi={f.cpi} />
                        {expanded[fk] && leaves.map(({ row, m }) => (
                          <TreeRow key={`${fk}:${row.beId}`} depth={2} name={row.displayName} m={m} cpi={row.cpi} />
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
function HistoryChart({ history }: { history: HistoryPoint[] }) {
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
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    setHi(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / plotW) * (n - 1)))))
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>Evoluție pe perioade — grad de colectare & restanță</span>
        <span className="row" style={{ gap: 12, fontSize: 11 }}>
          <span style={{ color: '#2563eb' }}>▬ grad (%)</span>
          <span className="muted">▧ restanță (scalat)</span>
        </span>
      </div>
      <div style={{ position: 'relative', marginTop: 6 }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" style={{ display: 'block', overflow: 'visible' }}
          onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
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

function TreeRow({ depth, name, m, cpi, open, onToggle, strong }: {
  depth: number
  name: string
  m: Metric
  cpi?: number
  open?: boolean
  onToggle?: () => void
  strong?: boolean
}) {
  const clickable = !!onToggle
  return (
    <div
      className="row"
      onClick={onToggle}
      role={clickable ? 'button' : undefined}
      aria-expanded={clickable ? !!open : undefined}
      style={{
        gap: 12, alignItems: 'center', padding: '6px 4px',
        paddingLeft: 4 + depth * 18,
        borderTop: '1px solid rgba(128,128,128,0.15)',
        cursor: clickable ? 'pointer' : 'default',
        fontWeight: strong ? 600 : 400,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {clickable ? <span className="muted" style={{ marginRight: 6 }}>{open ? '▾' : '▸'}</span> : null}
        {name}
      </span>
      <span className="row" style={{ width: 190, gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
        <span style={{ flex: 1 }}><Bar pct={m.ratePct} /></span>
        <span style={{ width: 54, textAlign: 'right', color: rateColor(m.ratePct) }}>
          {m.ratePct == null ? '—' : `${m.ratePct}%`}
        </span>
      </span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.owed)}</span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.paid)}</span>
      <span style={{ width: 130, textAlign: 'right' }}>{money(m.outstanding)}</span>
      <span className="muted" style={{ width: 60, textAlign: 'right' }}>{cpi == null ? '' : cpi}</span>
    </div>
  )
}
