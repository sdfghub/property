import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// Istoric încasări / plăți pe perioade — Asociație: table Perioada | Încasări | Plăți | Sold (Listă) or a
// wallet-style chart: sold inițial + încasări stacked up, plăți down, sold line (Grafic); per owner / unit: receipts matrix.
// Data: GET reports/cash-history (CashTx grouped by register cycle; RON only in the totals).
type Flow = { in: number; out: number }
type Row = {
  periodCode: string; status: string | null; from: string | null; to: string | null
  in: number; out: number; net: number; cumulative: number; transfers: number
  countIn: number; countOut: number; eur: Flow
  byFund: Array<{ code: string; name: string } & Flow>
  byAccount: Array<{ code: string; name: string; currency: string } & Flow>
}
type AccountHist = {
  code: string; name: string; currency: string; balance: number
  periods: Array<{ periodCode: string; opening: number; in: number; out: number; closing: number; rate?: number; rateSell?: number; rateDate?: string; rateEstimated?: boolean }>
  fxRates?: Array<{ date: string; rate: number; sell: number; source?: string; bnr?: number }>
  opening: number
  anchored: boolean
  checkpoints: Array<{ date: string; balance: number; source?: string; app: number; diff: number }>
}
type Entity = { id: string; label: string; sub?: string | null; byPeriod: Record<string, number>; total: number }
type Payload = {
  rows: Row[]
  accounts: AccountHist[]
  receipts: { units: Entity[]; owners: Entity[] }
  totals: { in: number; out: number; net: number; transfers: number; eur: Flow }
}
type Mode = 'assoc' | 'owner' | 'unit'

const C_IN = '#2a78d6'
const C_OUT = '#eb6834'
const money = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const short = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString('ro-RO', { maximumFractionDigits: 1 })}M`
  if (a >= 1000) return `${Math.round(n / 1000).toLocaleString('ro-RO')}k`
  return String(Math.round(n))
}
const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '')
// round axis maximum: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k
function niceMax(v: number) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, transform: 'translate(-50%, -100%)', pointerEvents: 'none',
      background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
      boxShadow: '0 4px 14px rgba(0,0,0,.12)', fontSize: 12, whiteSpace: 'nowrap', zIndex: 5, color: 'var(--text)',
    }}>{children}</div>
  )
}

const W = 900
const PAD = { l: 56, r: 12, t: 12, b: 28 }

function FlowChart({ rows, onPick, t, single }: { rows: Row[]; onPick: (code: string) => void; t: (k: string, d?: any) => string; single?: boolean }) {
  const [hover, setHover] = React.useState<number | null>(null)
  const H = 260
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.in, r.out)), 1))
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const band = iw / rows.length
  const bw = Math.min(28, Math.max(4, (band - 10) / 2))
  const y = (v: number) => PAD.t + ih - (v / max) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const r = hover != null ? rows[hover] : null
  const bar = (x: number, v: number, fill: string) => {
    const h = Math.max(0, (v / max) * ih)
    if (h <= 0) return null
    const rr = Math.min(4, h, bw / 2)
    const top = PAD.t + ih - h
    // rounded data end, square on the baseline
    return <path d={`M${x},${PAD.t + ih}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + bw - rr}Q${x + bw},${top} ${x + bw},${top + rr}V${PAD.t + ih}Z`} fill={fill} />
  }
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={t('cashHist.chartFlow', 'Încasări și plăți pe perioade')}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(0,0,0,0.08)" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{short(v)}</text>
          </g>
        ))}
        {rows.map((row, i) => {
          const cx = PAD.l + band * i + band / 2
          return (
            <g key={row.periodCode}>
              {hover === i && <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="rgba(0,0,0,0.04)" />}
              {single ? bar(cx - bw / 2, row.in, C_IN) : <>{bar(cx - bw - 1, row.in, C_IN)}{bar(cx + 1, row.out, C_OUT)}</>}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)">{row.periodCode}</text>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih + PAD.b} fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick(row.periodCode)} />
            </g>
          )
        })}
      </svg>
      {r && hover != null && (
        <Tip x={`${((PAD.l + band * hover + band / 2) / W) * 100}%` as any} y={0}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{r.periodCode}{r.from ? ` · ${dmy(r.from)} – ${dmy(r.to)}` : ''}</div>
          <div><span style={{ color: C_IN }}>■</span> {t('cashHist.in', 'Încasări')}: <strong>{money(r.in)}</strong>{!single && ` (${r.countIn})`}</div>
          {!single && <>
            <div><span style={{ color: C_OUT }}>■</span> {t('cashHist.out', 'Plăți')}: <strong>{money(r.out)}</strong> ({r.countOut})</div>
            <div>{t('cashHist.net', 'Net')}: <strong>{money(r.net)}</strong></div>
          </>}
        </Tip>
      )}
    </div>
  )
}

// Monotone cubic (Fritsch–Carlson): smooth through every point, never overshoots between them.
function smoothPath(p: Array<[number, number]>) {
  if (p.length < 2) return p.length ? `M${p[0][0]},${p[0][1]}` : ''
  const n = p.length
  const m = p.slice(0, -1).map((a, i) => (p[i + 1][1] - a[1]) / (p[i + 1][0] - a[0]))
  const tg = p.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tg[i] = 0; tg[i + 1] = 0; continue }
    const a = tg[i] / m[i], b = tg[i + 1] / m[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); tg[i] = k * a * m[i]; tg[i + 1] = k * b * m[i] }
  }
  let d = `M${p[0][0]},${p[0][1]}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (p[i + 1][0] - p[i][0]) / 3
    d += ` C${p[i][0] + dx},${p[i][1] + tg[i] * dx} ${p[i + 1][0] - dx},${p[i + 1][1] - tg[i + 1] * dx} ${p[i + 1][0]},${p[i + 1][1]}`
  }
  return d
}
// bar segment with optional rounded outer end ('up' = rounded top, 'down' = rounded bottom)
function segPath(x: number, w: number, y0: number, y1: number, round: 'up' | 'down' | null) {
  const top = Math.min(y0, y1), bot = Math.max(y0, y1), h = bot - top
  if (h <= 0.5) return ''
  const r = round ? Math.min(6, w / 2, h) : 0
  if (round === 'up') return `M${x},${bot} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bot} Z`
  if (round === 'down') return `M${x},${top} V${bot - r} Q${x},${bot} ${x + r},${bot} H${x + w - r} Q${x + w},${bot} ${x + w},${bot - r} V${top} Z`
  return `M${x},${top} H${x + w} V${bot} H${x} Z`
}
const C_BAL = 'var(--accent, #0071e3)'
// three tones of gray: sold inițial (lightest), încasări, plăți (darkest)
const G_OPEN = '#d8d8de'
const G_IN = '#a1a1a8'
const G_OUT = '#5b5b62'
const range = (r: { from: string | null; to: string | null }) => (r.from ? `${dmy(r.from)} – ${dmy(r.to)}` : '')
const CHART_CSS = `
.chx-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: chx-draw 1.1s cubic-bezier(.4,0,.2,1) .15s forwards }
.chx-bar { transform-box: view-box; animation: chx-grow .7s cubic-bezier(.2,.8,.2,1) both }
.chx-fade { animation: chx-fade .8s ease-out .5s both }
.chx-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: transparent; border-radius: 999px; padding: 4px 11px; font-size: 12px; color: var(--text); cursor: pointer; transition: opacity .2s, background .2s }
.chx-chip[aria-pressed=false] { opacity: .45 }
.chx-chip:hover { background: rgba(0,0,0,.04) }
@keyframes chx-draw { to { stroke-dashoffset: 0 } }
@keyframes chx-grow { from { transform: scaleY(0) } }
@keyframes chx-fade { from { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .chx-line, .chx-bar, .chx-fade { animation: none; stroke-dashoffset: 0 } }
`

// Wallet-style balance chart. Per period: sold inițial + încasări stacked up, plăți stacked down (negative);
// the blue line is the closing balance = sold inițial + încasări − plăți. Big number on top follows the cursor.
// `flags[k]` = statement checks that disagree with the app inside period k (red); `openFlag` = before the first one.
type Span = { periodCode: string; from: string | null; to: string | null; in: number; out: number }
type Check = AccountHist['checkpoints'][number]
const C_RED = '#d70015'
// statement vs app: under 10 (in the account's currency) = yellow, 10 or more = red
const C_WARN = '#a15c00'
const WARN_LIMIT = 10
const oneColor = (c: Check) => (Math.abs(c.diff) >= WARN_LIMIT ? C_RED : C_WARN)
const sevColor = (cs?: Check[]) => (!cs?.length ? null : cs.some((c) => Math.abs(c.diff) >= WARN_LIMIT) ? C_RED : C_WARN)
const sevBg = (c: string | null) => (!c ? undefined : c === C_RED ? 'rgba(215,0,21,0.06)' : 'rgba(255,204,0,0.16)')
const sevFill = (c: string) => (c === C_RED ? C_RED : '#f0a800')
function BalanceChart({ items, open, bal, title, unit, inLabel, outLabel, flags, openFlag, t }: {
  items: Span[]; open: number[]; bal: number[]; title: string; unit: string; inLabel: string; outLabel: string
  flags?: Check[][]; openFlag?: Check[]; t: (k: string, d?: any) => string
}) {
  const [hover, setHover] = React.useState<number | null>(null)
  const [on, setOn] = React.useState({ open: true, in: true, out: true, bal: true })
  const gid = React.useId().replace(/:/g, '')
  const H = 300, P = { l: 4, r: 44, t: 24, b: 30 }
  const upTop = items.map((r, i) => (on.open ? open[i] : 0) + (on.in ? r.in : 0))
  const hi = niceMax(Math.max(...(on.bal ? bal : []), ...upTop, 1))
  const lo = Math.min(0, ...(on.bal ? bal : []), ...(on.open ? open : []), ...(on.out ? items.map((r) => -r.out) : [0]))
  const loN = lo < 0 ? -niceMax(-lo) : 0
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - loN) / (hi - loN))
  const zero = y(0)
  const bw = (W - P.l - P.r) / items.length
  const cx = (i: number) => P.l + bw * (i + 0.5)
  const w = Math.max(10, Math.min(64, bw * 0.46))
  const pts = bal.map((v, i) => [cx(i), y(v)] as [number, number])
  const line = smoothPath(pts)
  const area = `${line} L${pts[pts.length - 1][0]},${zero} L${pts[0][0]},${zero} Z`
  const i = hover ?? items.length - 1
  const r = items[i]
  const bad = (k: number) => !!flags?.[k]?.length
  const hereFlags = [...(i === 0 ? openFlag ?? [] : []), ...(flags?.[i] ?? [])]
  const step = Math.max(1, Math.ceil(items.length / 10))
  const ticks = [loN, 0, hi / 2, hi].filter((v, k, a) => a.indexOf(v) === k && (v === 0 || Math.abs(y(v) - zero) > 14))
  const chips: Array<{ k: keyof typeof on; c: string; l: string; line?: boolean }> = [
    { k: 'open', c: G_OPEN, l: t('cashHist.openingShort', 'Sold inițial') },
    { k: 'in', c: G_IN, l: inLabel },
    { k: 'out', c: G_OUT, l: outLabel },
    { k: 'bal', c: C_BAL, l: t('cashHist.balance', 'Sold'), line: true },
  ]
  const stat = (c: string, l: string, v: string, color?: string | null) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 2, color: color ?? undefined }}>{v}</div>
    </div>
  )
  return (
    <div style={{ background: 'var(--card, #fff)', borderRadius: 18, border: '1px solid var(--border)', padding: '20px 20px 8px', boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04)' }}>
      <style>{CHART_CSS}</style>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{title}</div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, marginTop: 2 }}>
            {money(bal[i])}<span style={{ fontSize: 17, fontWeight: 500, color: 'var(--muted)', marginLeft: 6, letterSpacing: 0 }}>{unit}</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{r.periodCode}</span> · {range(r)}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <button key={c.k} type="button" className="chx-chip" aria-pressed={on[c.k]} onClick={() => setOn((s) => ({ ...s, [c.k]: !s[c.k] }))}>
              <span style={c.line ? { width: 12, height: 3, borderRadius: 2, background: c.c } : { width: 9, height: 9, borderRadius: 3, background: c.c }} />{c.l}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, margin: '16px 0 4px', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        {stat(G_OPEN, t('cashHist.openingShort', 'Sold inițial'), money(open[i]), i === 0 ? sevColor(openFlag) : null)}
        {stat(G_IN, `+ ${inLabel}`, money(r.in))}
        {stat(G_OUT, `− ${outLabel}`, money(r.out))}
        {stat(C_BAL, `= ${t('cashHist.balance', 'Sold')}`, money(bal[i]), sevColor(flags?.[i]))}
      </div>
      <div style={{ minHeight: 22, fontSize: 12, fontWeight: 500 }}>
        {hereFlags.map((c) => (
          <span key={c.date} style={{ marginRight: 14, color: oneColor(c) }}>● {t('cashHist.diffAt', { date: dmy(c.date), st: money(c.balance), app: money(c.app), diff: money(c.diff) })}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0071e3" stopOpacity={0.16} />
            <stop offset="100%" stopColor="#0071e3" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--muted)' : 'var(--border)'} strokeOpacity={v === 0 ? 0.35 : 1} strokeDasharray={v === 0 ? undefined : '2 5'} />
            <text x={W - P.r + 8} y={y(v) + 4} fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{v === 0 ? '0' : short(v)}</text>
          </g>
        ))}
        {on.bal && <path d={area} fill={`url(#${gid})`} className="chx-fade" style={{ pointerEvents: 'none' }} />}
        {hover !== null && <rect x={cx(i) - bw / 2 + 4} y={P.t - 8} width={bw - 8} height={H - P.t - P.b + 8} rx={10} fill="rgba(0,0,0,.035)" />}
        {items.map((row, k) => {
          const x = cx(k) - w / 2
          const o = on.open ? open[k] : 0
          const top = o + (on.in ? row.in : 0)
          const dim = hover !== null && hover !== k ? 0.4 : 1
          const openSev = k === 0 ? sevColor(openFlag) : null
          return (
            <g key={row.periodCode} opacity={dim} style={{ transition: 'opacity .2s' }}>
              <g className="chx-bar" style={{ transformOrigin: `0 ${zero}px`, animationDelay: `${k * 60}ms` }}>
                {on.open && <path d={segPath(x, w, zero, y(o), on.in && row.in ? null : 'up')} fill={!openSev ? G_OPEN : openSev === C_RED ? '#f5c6cb' : '#ffe8a3'} stroke={openSev ? sevFill(openSev) : 'none'} strokeWidth={1.5} />}
                {on.in && <path d={segPath(x, w, on.open && o > 0 ? y(o) - 2 : zero, y(top), 'up')} fill={G_IN} />}
                {on.out && <path d={segPath(x, w, zero + 2, y(-row.out), 'down')} fill={G_OUT} />}
              </g>
            </g>
          )
        })}
        {on.bal && <path d={line} pathLength={1} className="chx-line" fill="none" stroke={C_BAL} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />}
        {on.bal && pts.map(([px, py], k) => {
          const sc = sevColor(flags?.[k])
          const c = sc ? sevFill(sc) : C_BAL
          return (
            <g key={k} className="chx-fade" style={{ pointerEvents: 'none' }}>
              {sc && <circle cx={px} cy={py} r={11} fill={c} fillOpacity={0.16} />}
              <circle cx={px} cy={py} r={k === i || bad(k) ? 6 : 3} fill={k === i || bad(k) ? c : 'var(--card, #fff)'} stroke={k === i || bad(k) ? 'var(--card, #fff)' : c} strokeWidth={k === i ? 2.5 : 2} />
            </g>
          )
        })}
        {items.map((row, k) => (k % step === 0 || k === items.length - 1) && (
          <text key={row.periodCode} x={cx(k)} y={H - 8} textAnchor="middle" fontSize={12} fill={sevColor(flags?.[k]) ?? (k === 0 ? sevColor(openFlag) : null) ?? (k === i ? 'var(--text)' : 'var(--muted)')} fontWeight={k === i ? 600 : 400}>{row.periodCode}</text>
        ))}
        {items.map((row, k) => (
          <rect key={row.periodCode} x={P.l + bw * k} y={0} width={bw} height={H} fill="transparent" onMouseEnter={() => setHover(k)} />
        ))}
      </svg>
    </div>
  )
}

// period code; hover shows the exact interval
function PeriodCell({ r, td, t, noCounts }: { r: Row; td: React.CSSProperties; t: (k: string, d?: any) => string; noCounts?: boolean }) {
  const [h, setH] = React.useState(false)
  const days = r.from && r.to ? Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) : null
  return (
    <td style={{ ...td, textAlign: 'left', fontWeight: 600, position: 'relative', cursor: 'default' }} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>
      <span style={{ borderBottom: '1px dotted var(--muted)' }}>{r.periodCode}</span>
      {h && r.from && (
        <div style={{
          position: 'absolute', left: 8, top: '100%', marginTop: -4, zIndex: 5, pointerEvents: 'none', whiteSpace: 'nowrap',
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', boxShadow: '0 4px 14px rgba(0,0,0,.12)',
          fontSize: 12, fontWeight: 400, color: 'var(--text)',
        }}>
          <div style={{ fontWeight: 600 }}>{range(r)}</div>
          <div className="muted">
            {days !== null && t('cashHist.days', { n: days })}
            {!noCounts && <>{' · '}{t('cashHist.txCount', { in: r.countIn, out: r.countOut })}</>}
          </div>
        </div>
      )}
    </td>
  )
}

// Display currency. EUR → lei at the bank's buy rate (what the association would get for its EUR),
// lei → EUR at the sell rate (what 1 EUR would cost it) — both from the dated rates on the EUR account.
type Fx = { cur: 'RON' | 'EUR'; unit: string; conv: (v: number, from: string, periodCode?: string | null) => number }
const IDENTITY_FX: Fx = { cur: 'RON', unit: 'lei', conv: (v) => v }

// Apple-style segmented control
function Seg<K extends string>({ opts, value, onChange, label }: { opts: Array<[K, React.ReactNode]>; value: K; onChange: (k: K) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: 'inline-flex', alignSelf: 'flex-start', background: 'rgba(118,118,128,.12)', borderRadius: 9, padding: 2, gap: 2, maxWidth: '100%', overflowX: 'auto' }}>
      {opts.map(([k, l]) => {
        const on = k === value
        return (
          <button key={k} type="button" role="tab" aria-selected={on} onClick={() => onChange(k)} style={{
            border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 13px', fontSize: 13, whiteSpace: 'nowrap',
            fontWeight: on ? 600 : 500, color: 'var(--text)', background: on ? 'var(--card, #fff)' : 'transparent',
            boxShadow: on ? '0 1px 3px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)' : 'none', transition: 'background .15s, box-shadow .15s',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>{l}</button>
        )
      })}
    </div>
  )
}

// statement checks that disagree with the app, placed on the period containing their date ('' = before the first)
function checkFlags(a: AccountHist, rows: Row[]) {
  const by = new Map<string, Check[]>()
  for (const c of a.checkpoints) {
    if (Math.abs(c.diff) < 0.005) continue
    const d = c.date.slice(0, 10)
    const r = rows.find((x) => x.from && x.to && x.from.slice(0, 10) <= d && d <= x.to.slice(0, 10))
      ?? [...rows].reverse().find((x) => x.from && x.from.slice(0, 10) <= d)
    const key = r && a.periods.some((p) => p.periodCode === r.periodCode) ? r.periodCode : ''
    by.set(key, [...(by.get(key) ?? []), c])
  }
  return by
}

function AccountsView({ accounts: all, rows, view, fx, t, th, td }: { accounts: AccountHist[]; rows: Row[]; view: 'list' | 'chart'; fx: Fx; t: (k: string, d?: any) => string; th: React.CSSProperties; td: React.CSSProperties }) {
  const [sel, setSel] = React.useState<string>(all[0]?.code ?? '')
  const accounts = sel ? all.filter((a) => a.code === sel) : all
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Seg label={t('cashHist.account', 'Cont')} value={sel} onChange={setSel} opts={[
        ...all.map((a): [string, React.ReactNode] => {
          const sc = sevColor(a.checkpoints.filter((c) => Math.abs(c.diff) >= 0.005))
          return [a.code, <>{a.name}<span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{a.currency}</span>{sc && <span style={{ width: 7, height: 7, borderRadius: 4, background: sevFill(sc) }} />}</>]
        }),
        ['', t('cashHist.allAccounts', 'Toate')],
      ]} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('cashHist.accountsIntro', '')}</p>
      {accounts.map((a) => {
        const flags = checkFlags(a, rows)
        // amounts in the display currency (period rate where there is one, else the latest)
        const c = (v: number, code?: string | null) => fx.conv(v, a.currency, code)
        const unit = fx.unit
        const first = a.periods[0]?.periodCode
        const nDiff = a.checkpoints.filter((x) => Math.abs(x.diff) >= 0.005).length
        const items: Span[] = a.periods.map((p) => {
          const r = rows.find((x) => x.periodCode === p.periodCode)
          return { periodCode: p.periodCode, from: r?.from ?? null, to: r?.to ?? null, in: c(p.in, p.periodCode), out: c(p.out, p.periodCode) }
        })
        const tip = (cs: Check[]) => cs.map((x) => t('cashHist.diffAt', { date: dmy(x.date), st: money(c(x.balance)), app: money(c(x.app)), diff: money(c(x.diff)) })).join('\n')
        const sumDiff = a.checkpoints.reduce((s, x) => s + x.diff, 0)
        return (
          <div key={a.code} style={view === 'chart' ? { minWidth: 0 } : { border: '1px solid var(--border)', borderRadius: 14, padding: 14, minWidth: 0 }}>
            {view === 'chart' ? (
              <BalanceChart items={items} open={a.periods.map((p) => c(p.opening, p.periodCode))} bal={a.periods.map((p) => c(p.closing, p.periodCode))} title={a.name} unit={unit}
                inLabel={t('cashHist.inAll', 'Intrări')} outLabel={t('cashHist.outAll', 'Ieșiri')}
                flags={a.periods.map((p) => flags.get(p.periodCode) ?? [])} openFlag={flags.get('')} t={t} />
            ) : (
              <>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 15 }}>{a.name}</strong>
                  <span style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{money(c(a.balance))} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>{unit}</span></span>
                    {a.currency !== fx.cur && <span className="muted" style={{ display: 'block', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{money(a.balance)} {a.currency === 'RON' ? 'lei' : a.currency}</span>}
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead><tr>
                      <th style={{ ...th, textAlign: 'left' }}>{t('cashHist.period', 'Perioada')}</th>
                      <th style={th}>{t('cashHist.opening', 'Sold inițial')}</th>
                      <th style={th}>{t('cashHist.inAll', 'Intrări')}</th>
                      <th style={th}>{t('cashHist.outAll', 'Ieșiri')}</th>
                      <th style={th}>{t('cashHist.closing', 'Sold final')}</th>
                    </tr></thead>
                    <tbody>
                      {[...a.periods].reverse().map((p) => {
                        const f = flags.get(p.periodCode)
                        const r = rows.find((x) => x.periodCode === p.periodCode)
                        return (
                          <tr key={p.periodCode} style={{ background: sevBg(sevColor(f)) }} title={f ? tip(f) : undefined}>
                            {r ? <PeriodCell r={r} td={td} t={t} noCounts /> : <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{p.periodCode}</td>}
                            <td style={td} className="muted">{money(c(p.opening, p.periodCode))}</td>
                            <td style={td}>{p.in ? money(c(p.in, p.periodCode)) : '—'}</td>
                            <td style={td}>{p.out ? money(c(p.out, p.periodCode)) : '—'}</td>
                            <td style={{ ...td, fontWeight: 600, color: sevColor(f) ?? (p.closing < 0 ? C_RED : undefined) }}>{f && '● '}{money(c(p.closing, p.periodCode))}</td>
                          </tr>
                        )
                      })}
                      {a.anchored && (
                        <tr style={{ background: sevBg(sevColor(flags.get(''))) }} title={flags.get('') ? tip(flags.get('')!) : undefined}>
                          <td style={{ ...td, textAlign: 'left' }} className="muted" colSpan={4}>{t('cashHist.derivedOpening', 'Sold dinaintea primei perioade (dedus din extras)')}</td>
                          <td style={{ ...td, fontWeight: 600, color: sevColor(flags.get('')) ?? undefined }}>{flags.get('') && '● '}{money(c(a.opening, first))}</td>
                        </tr>
                      )}
                      <tr>
                        <td style={{ ...td, textAlign: 'left', fontWeight: 700 }} colSpan={2}>{t('cashHist.total', 'Total')}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{money(a.periods.reduce((s, p) => s + c(p.in, p.periodCode), 0))}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{money(a.periods.reduce((s, p) => s + c(p.out, p.periodCode), 0))}</td>
                        <td style={td} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {a.checkpoints.length > 0 && (
              <details style={{ marginTop: 10, padding: view === 'chart' ? '0 6px' : undefined }}>
                <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '4px 0' }}>
                  {t('cashHist.checksTitle', 'Verificare cu extrasele')} <span className="muted" style={{ fontWeight: 400 }}>({a.checkpoints.length})</span>
                  {' · '}
                  {nDiff ? <span style={{ color: sevColor(a.checkpoints.filter((x) => Math.abs(x.diff) >= 0.005)) ?? undefined }}>{t('cashHist.diffCount', { n: nDiff })}</span> : <span style={{ color: '#1a7f37' }}>✓ {t('cashHist.allMatch', 'toate se potrivesc')}</span>}
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 4 }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>{t('cashHist.checkDate', 'La data')}</th>
                    <th style={th}>{t('cashHist.checkStatement', 'Extras')}</th>
                    <th style={th}>{t('cashHist.checkApp', 'Aplicație')}</th>
                    <th style={th}>{t('cashHist.checkDiff', 'Diferență')}</th>
                  </tr></thead>
                  <tbody>
                    {[...a.checkpoints].reverse().map((x, i) => {
                      const ok = Math.abs(x.diff) < 0.005
                      return (
                        <tr key={x.date} title={x.source} style={{ background: ok ? undefined : sevBg(oneColor(x)) }}>
                          <td style={{ ...td, textAlign: 'left' }}>{dmy(x.date)}{i === 0 && <span className="muted"> · {t('cashHist.anchor', 'ancoră')}</span>}</td>
                          <td style={td}>{money(c(x.balance))}</td>
                          <td style={{ ...td, color: ok ? undefined : oneColor(x) }}>{money(c(x.app))}</td>
                          <td style={{ ...td, fontWeight: 600, color: ok ? '#1a7f37' : oneColor(x) }}>{ok ? '✓' : money(c(x.diff))}</td>
                        </tr>
                      )
                    })}
                    <tr>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }} colSpan={3}>{t('cashHist.checksTotal', 'Total diferențe')}</td>
                      <td style={{ ...td, fontWeight: 700, color: Math.abs(sumDiff) < 0.005 ? '#1a7f37' : Math.abs(sumDiff) < WARN_LIMIT ? C_WARN : C_RED }}>{money(c(sumDiff))}</td>
                    </tr>
                  </tbody>
                </table>
                {nDiff > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('cashHist.diffNote', '')}</div>}
              </details>
            )}
          </div>
        )
      })}
      {accounts.some((a) => !a.anchored) && (
        <div className="muted" style={{ fontSize: 12 }}>{t('cashHist.notAnchoredNote', '')}</div>
      )}
    </div>
  )
}

function EntityReceipts({ mode, data, fx, t, th, td }: { mode: 'owner' | 'unit'; data: Payload; fx: Fx; t: (k: string, d?: any) => string; th: React.CSSProperties; td: React.CSSProperties }) {
  const c = (v: number, code?: string) => fx.conv(v, 'RON', code)
  const totalOf = (e: Entity) => codesAll.reduce((s, k) => s + c(e.byPeriod[k] ?? 0, k), 0)
  const codesAll = data.rows.map((r) => r.periodCode)
  const list = mode === 'unit' ? data.receipts.units : data.receipts.owners
  const [sel, setSel] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [sortTotal, setSortTotal] = React.useState(false)
  React.useEffect(() => setSel(null), [mode])
  const codes = data.rows.map((r) => r.periodCode)
  const picked = sel != null ? list.find((e) => e.id === sel) : undefined
  const chartRows: Row[] = data.rows.map((r) => ({ ...r, in: c(picked ? picked.byPeriod[r.periodCode] ?? 0 : r.in, r.periodCode), out: 0 }))
  const name = (e: Entity) => e.label || t('cashHist.unassigned', 'Neatribuit')
  const qq = q.trim().toLowerCase()
  const shown = list
    .filter((e) => !qq || `${name(e)} ${e.sub ?? ''}`.toLowerCase().includes(qq))
    .sort((a, b) => (sortTotal ? totalOf(b) - totalOf(a) : 0))
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 0' }}>
        {picked ? <>{t('cashHist.receiptsOf', 'Încasări')}: {name(picked)}{picked.sub ? <span className="muted" style={{ fontWeight: 400 }}> · {picked.sub}</span> : null}</>
          : t('cashHist.receiptsAll', 'Încasări – toată asociația (alege un rând din tabel)')}
        {picked && <button type="button" className="btn small ghost" style={{ marginLeft: 8 }} onClick={() => setSel(null)}>{t('cashHist.clear', 'Toată asociația')}</button>}
      </div>
      <FlowChart rows={chartRows} onPick={() => {}} t={t} single />
      <div className="row" style={{ gap: 8, margin: '14px 0 6px', flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder={t('cashHist.search', 'Caută…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={`btn small ${sortTotal ? '' : 'ghost'}`} onClick={() => setSortTotal((v) => !v)}>{t('cashHist.sortTotal', 'Ordonează după total')}</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>{mode === 'unit' ? t('cashHist.unit', 'Unitate') : t('cashHist.owner', 'Proprietar')}</th>
            {codes.map((k) => <th key={k} style={th}>{k}</th>)}
            <th style={th}>{t('cashHist.total', 'Total')}</th>
          </tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id || 'none'} onClick={() => setSel(sel === e.id ? null : e.id)} style={{ cursor: 'pointer', background: sel === e.id ? 'rgba(42,120,214,0.08)' : undefined }}>
                <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 180 }}>
                  <div style={{ fontWeight: 600 }}>{name(e)}</div>
                  {e.sub && <div className="muted" style={{ fontSize: 12 }}>{e.sub}</div>}
                </td>
                {codes.map((k) => <td key={k} style={td} className={e.byPeriod[k] ? undefined : 'muted'}>{e.byPeriod[k] ? money(c(e.byPeriod[k], k)) : '—'}</td>)}
                <td style={{ ...td, fontWeight: 700 }}>{money(totalOf(e))}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{t('cashHist.total', 'Total')}</td>
              {data.rows.map((r) => <td key={r.periodCode} style={{ ...td, fontWeight: 700 }}>{money(c(r.in, r.periodCode))}</td>)}
              <td style={{ ...td, fontWeight: 700 }}>{money(data.rows.reduce((s, r) => s + c(r.in, r.periodCode), 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}

export function CashHistoryPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d: any = '') => {
    const v = rawT(k as any, typeof d === 'object' ? d : undefined)
    return v && v !== k ? v : typeof d === 'string' ? d : k
  }
  const [data, setData] = React.useState<Payload | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<Mode>('assoc')
  const [view, setView] = React.useState<'list' | 'chart'>('list')
  const [cash, setCash] = React.useState<'flows' | 'accounts'>('flows')
  const [cur, setCur] = React.useState<'RON' | 'EUR'>('RON')

  React.useEffect(() => {
    setData(null)
    api.get<Payload>(`/communities/${communityId}/reports/cash-history`).then(setData).catch((e: any) => setErr(e?.message ?? String(e)))
  }, [api, communityId])

  if (err) return <div className="card"><div className="badge negative">{err}</div></div>
  if (!data) return <div className="card muted">{t('cashHist.loading', 'Se încarcă…')}</div>
  const rows = data.rows
  // Sold total = every account at each period's end, in lei (statement-anchored closings; transfers
  // cancel out). Non-RON accounts at the recorded rate valid at the period's end (account.periods[i].rate);
  // their receipts / payments enter Încasări / Plăți at the same rate, so sold inițial + încasări − plăți = sold.
  const r2 = (n: number) => Math.round(n * 100) / 100
  const accs = data.accounts ?? []
  // the EUR account's dated rates: buy (EUR → lei) and sell (lei → EUR), per period and latest
  const eurAcc = accs.find((a) => a.currency === 'EUR' && a.fxRates?.length)
  const latest = eurAcc?.fxRates?.[eurAcc.fxRates.length - 1]
  const rateBy = new Map((eurAcc?.periods ?? []).filter((p) => p.rate).map((p) => [p.periodCode, { buy: p.rate!, sell: p.rateSell ?? p.rate!, date: p.rateDate }]))
  const rateFor = (code?: string | null) => (code && rateBy.get(code)) || (latest ? { buy: latest.rate, sell: latest.sell, date: latest.date } : null)
  const fx: Fx = !latest ? IDENTITY_FX : {
    cur, unit: cur === 'RON' ? 'lei' : 'EUR',
    conv: (v, from, code) => {
      if (from === cur) return v
      const k = rateFor(code)
      if (!k) return v
      return cur === 'RON' ? v * k.buy : v / k.sell
    },
  }
  const r4 = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 4 })
  const missingFx = accs.filter((a) => a.currency !== 'RON' && a.currency !== 'EUR' || (a.currency === 'EUR' && !a.fxRates?.length))
  // Sold total = every account at each period's end in the display currency (statement-anchored closings;
  // transfers cancel out), converted at that period's rate. Receipts / payments of the other currency at
  // the same rate, so sold inițial + încasări − plăți = sold.
  const tot = rows.map((r, i) => {
    let open = 0, close = 0
    const parts: string[] = []
    const code = r.periodCode
    for (const a of accs) {
      const p = a.periods[i]
      if (!p || missingFx.includes(a)) continue
      open += fx.conv(p.opening, a.currency, code)
      const v = fx.conv(p.closing, a.currency, code)
      close += v
      const k = rateFor(code)
      parts.push(a.currency === fx.cur || !k ? `${a.name}: ${money(p.closing)} ${fx.unit}`
        : fx.cur === 'RON' ? `${a.name}: ${money(p.closing)} EUR × ${r4(k.buy)} = ${money(v)} lei`
          : `${a.name}: ${money(p.closing)} lei ÷ ${r4(k.sell)} = ${money(v)} EUR`)
    }
    return {
      open: r2(open), bal: r2(close), parts,
      in: r2(fx.conv(r.in, 'RON', code) + fx.conv(r.eur.in, 'EUR', code)),
      out: r2(fx.conv(r.out, 'RON', code) + fx.conv(r.eur.out, 'EUR', code)),
    }
  })
  const bal = tot.map((x) => x.bal)
  const items = rows.map((r, i) => ({ ...r, in: tot[i].in, out: tot[i].out }))
  const fxNote = latest && (fx.cur === 'RON'
    ? t('cashHist.fxToRon', { rate: r4(latest.rate), date: dmy(latest.date) })
    : t('cashHist.fxToEur', { rate: r4(latest.sell), date: dmy(latest.date) }))
  const fxEst = eurAcc?.periods.some((p) => p.rateEstimated) && eurAcc?.fxRates ? t('cashHist.fxEstimated', { date: dmy(eurAcc.fxRates[0].date) }) : ''
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('cashHist.title', 'Istoric încasări și plăți')}</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t('cashHist.intro', 'Toate mișcările din casă și bancă, grupate pe perioada (lista) căreia îi aparțin. Transferurile între conturile asociației nu sunt nici încasări, nici plăți.')}</p>
        {!rows.length ? <div className="muted">{t('cashHist.empty', 'Nu există încasări sau plăți înregistrate.')}</div> : (
          <>
            <div className="row" style={{ gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 0 14px', borderTop: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <Seg label={t('cashHist.viewBy', '')} value={cash} onChange={setCash} opts={[['flows', t('cashHist.byFlows', 'Încasări / Plăți')], ['accounts', t('cashHist.byAccount', 'Pe cont bancar')]]} />
                {(cash === 'accounts' || mode === 'assoc') && (
                  <Seg value={view} onChange={setView} opts={[['list', <>☰ {t('cashHist.viewList', 'Listă')}</>], ['chart', <>◔ {t('cashHist.viewChart', 'Grafic')}</>]]} />
                )}
              </div>
              {latest && <Seg label={t('cashHist.currency', 'Monedă')} value={cur} onChange={setCur} opts={[['RON', 'RON'], ['EUR', 'EUR']]} />}
            </div>
            {cash === 'flows' && (
              <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('cashHist.viewBy', 'Încasări pe:')}</span>
                <Seg value={mode} onChange={setMode} opts={[['assoc', t('cashHist.byAssoc', 'Asociație')], ['owner', t('cashHist.byOwner', 'Proprietar')], ['unit', t('cashHist.byUnit', 'Unitate')]]} />
              </div>
            )}
            {cash === 'accounts' ? (
              <AccountsView accounts={data.accounts ?? []} rows={rows} view={view} fx={fx} t={t} th={th} td={td} />
            ) : mode !== 'assoc' ? (
              <EntityReceipts mode={mode} data={data} fx={fx} t={t} th={th} td={td} />
            ) : view === 'chart' ? (
              <BalanceChart items={items} open={tot.map((x) => x.open)} bal={bal}
                title={t('cashHist.balanceTotal', 'Sold bancă + casă')} unit={fx.unit}
                inLabel={t('cashHist.in', 'Încasări')} outLabel={t('cashHist.out', 'Plăți')} t={t} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left' }}>{t('cashHist.period', 'Perioada')}</th>
                      <th style={th}>{t('cashHist.in', 'Încasări')}</th>
                      <th style={th}>{t('cashHist.out', 'Plăți')}</th>
                      <th style={th} title={t('cashHist.balanceHint', '')}>{t('cashHist.balance', 'Sold')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
                      <tr key={r.periodCode}>
                        <PeriodCell r={r} td={td} t={t} />
                        <td style={td}>{money(tot[i].in)}</td>
                        <td style={td}>{money(tot[i].out)}</td>
                        <td style={{ ...td, fontWeight: 600, cursor: 'help' }} title={tot[i].parts.join('\n')}>{money(bal[i])}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{t('cashHist.total', 'Total')}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(tot.reduce((x, v) => x + v.in, 0))}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{money(tot.reduce((x, v) => x + v.out, 0))}</td>
                      <td style={td} />
                    </tr>
                  </tbody>
                </table>
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t('cashHist.balanceHint', '')}</div>
              </div>
            )}
            {(fxNote || missingFx.length > 0) && (
              <div style={{ fontSize: 12, marginTop: 10, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span aria-hidden>⇄</span>
                <div>
                  {fxNote && <span title={latest?.source}>{fxNote}{fxEst ? ' ' + fxEst : ''}</span>}
                  {missingFx.length > 0 && <div style={{ color: C_WARN }}>{t('cashHist.fxMissing', { acc: missingFx.map((a) => a.name).join(', ') })}</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
