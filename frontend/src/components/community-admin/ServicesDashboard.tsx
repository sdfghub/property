import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { bigNumberStyle, collapseBtnStyle, innerCardStyle, outerCardStyle, sectionLabelStyle } from './dashboardStyles'

// Services dashboard (Acasă → Today): every service of the catalogue, grouped by domain, with its
// operational status (colour) and satisfaction level (x/5). The admin can change a status and the
// order; the order is saved on the catalogue and applied to the avizier and the budget by the API.
// Status labels and their colour family come from the payload (`statuses[].tone`).

export type Status = { code: string; label: string; value: number; tone: 'red' | 'orange' | 'yellow' | 'green' | 'grey' | 'black'; definition: string }
export type Trend = { from: number; to: number; delta: number; count?: number } | null
export type Agg = { status: number | null; statusCount: number; statusCode: string | null; satisfaction: number | null; satisfactionCount: number; total: number; trend?: Trend }
type CodeLabel = { code: string; label: string }
// `satisfaction` = the level the dashboard shows (null for a service that does not exist now).
type Item = { id: string; domain: string; name: string; sortOrder: number; level: number | null; satisfaction: number | null; status: string | null; trend?: Trend; providedBy?: string | null; tier?: string | null; openIncidents?: number }
type Tier = { code: string; label: string; definition: string; examples: string }
type Catalog = { openIncidents?: number; statuses: Status[]; items: Item[]; aggregates: { domains: Array<Agg & { domain: string }>; tiers?: Array<Agg & { tier: string }>; overall: Agg }; trendSince: string; workStatuses: CodeLabel[]; priorities: CodeLabel[]; providers?: Array<{ code: string; label: string; note: string }>; tiers?: Tier[] }
// A card on the dashboard: one domain, or one service class (Vitale / Esențiale / Suplimentare).
type Card = { key: string; name: string; agg: Agg | undefined; items: Item[]; gi: number; definition?: string }

// Averages are shown rounded to a whole number; the hover shows them with one decimal.
const num = (v: number) => v.toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const whole = (v: number) => String(Math.round(v))

export const TONE: Record<Status['tone'], string> = {
  red: 'var(--svc-red, #b3261e)', orange: 'var(--svc-orange, #e8590c)', yellow: 'var(--svc-yellow, #f2a900)', green: 'var(--svc-green, #3f9c4a)',
  grey: 'var(--svc-grey, #a1a1a6)', black: 'var(--svc-black, #1d1d1f)',
}

export function Dot({ status, size = 12 }: { status: Status | undefined; size?: number }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flex: 'none', display: 'inline-block',
      background: status ? TONE[status.tone] : 'transparent',
      border: status ? '1px solid rgba(0,0,0,0.15)' : '1.5px dashed var(--muted, #888)',
    }} />
  )
}

const groupByDomain = (items: Item[]) => {
  const out: Array<{ domain: string; items: Item[] }> = []
  for (const it of items) {
    const g = out.find((x) => x.domain === it.domain)
    if (g) g.items.push(it)
    else out.push({ domain: it.domain, items: [it] })
  }
  return out
}

const monthName = (ym: string, lang: string) =>
  new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleString(lang === 'ro' ? 'ro-RO' : 'en-GB', { month: 'long', year: 'numeric' })

/** ▲ / ▼ against last month's satisfaction (nothing when unchanged or unknown). */
export function TrendMark({ trend, since, size = 12 }: { trend: Trend | undefined; since: string; size?: number }) {
  const { t, lang } = useI18n()
  // Always takes the same room (an invisible arrow when unchanged), so the numbers after it line up.
  if (!trend || !trend.delta) return <span aria-hidden style={{ visibility: 'hidden', fontSize: size, lineHeight: 1 }}>▲</span>
  const up = trend.delta > 0
  const label = t('svcdash.trend', { m: monthName(since, lang), a: num(trend.from), b: num(trend.to) })
  return (
    <span role="img" aria-label={label} title={label} style={{ color: up ? TONE.green : TONE.red, fontSize: size, lineHeight: 1 }}>{up ? '▲' : '▼'}</span>
  )
}

type HistoryRow = { id: string; createdAt: string; level: number | null; status: string | null; workStatus: string | null; priority: string | null; comment: string | null; actions: string | null; assessedBy?: { name: string | null; email: string | null } | null }

/** Change log of one service: every saved evaluation/status change, newest first, with what changed. */
function ChangeLog({ communityId, item, cat, onClose }: { communityId: string; item: Item; cat: Catalog; onClose: () => void }) {
  const { api } = useAuth()
  const { t, lang } = useI18n()
  const [rows, setRows] = React.useState<HistoryRow[] | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    api.get<HistoryRow[]>(`/communities/${communityId}/services/${item.id}/history`).then((r: HistoryRow[]) => setRows(r)).catch((e: any) => setErr(e?.message ?? String(e)))
  }, [api, communityId, item.id])
  const lbl = (list: CodeLabel[], c: string | null) => (c ? list.find((x) => x.code === c)?.label ?? c : '—')
  const fields: Array<{ key: 'level' | 'status' | 'workStatus' | 'priority' | 'comment' | 'actions'; name: string; show: (v: any) => string; text?: boolean }> = [
    { key: 'level', name: t('svcdash.f.level', 'Satisfacție'), show: (v) => (v == null ? '—' : `${v}/5`) },
    { key: 'status', name: t('svcdash.status', 'Stare'), show: (v) => lbl(cat.statuses, v) },
    { key: 'workStatus', name: t('svcdash.f.work', 'Stadiu lucrări'), show: (v) => lbl(cat.workStatuses, v) },
    { key: 'priority', name: t('svcdash.f.priority', 'Prioritate'), show: (v) => lbl(cat.priorities, v) },
    { key: 'comment', name: t('svcdash.f.comment', 'Comentariu'), show: (v) => v ?? '—', text: true },
    { key: 'actions', name: t('svcdash.f.actions', 'Acțiuni'), show: (v) => v ?? '—', text: true },
  ]
  // Each entry lists only what differs from the entry before it (the first lists what was set).
  const asc = [...(rows ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const entries = asc.map((r, i) => ({
    r, first: i === 0,
    changes: fields.filter((f) => (i === 0 ? r[f.key] != null : r[f.key] !== asc[i - 1][f.key])).map((f) => ({ f, from: i === 0 ? null : asc[i - 1][f.key], to: r[f.key] })),
  })).filter((e) => e.changes.length).reverse()
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" role="dialog" aria-label={t('svcdash.log', { s: item.name })} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>{t('svcdash.log', { s: item.name })}</h4>
            <div className="muted" style={{ fontSize: 12 }}>{item.domain}</div>
          </div>
          <button className="btn ghost small" onClick={onClose} aria-label={t('svcdash.close', 'Închide')}>✕</button>
        </div>
        {err && <div className="badge negative">{err}</div>}
        {!rows && !err && <div className="muted">{t('common.loading', 'Se încarcă…')}</div>}
        {rows && !entries.length && <div className="muted" style={{ marginTop: 8 }}>{t('svcdash.logEmpty', 'Nicio modificare înregistrată.')}</div>}
        <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 12 }}>
          {entries.map(({ r, first, changes }) => (
            <li key={r.id} style={{ borderLeft: '3px solid var(--border, #e5e5ea)', paddingLeft: 10 }}>
              <div style={{ fontSize: 12 }} className="muted">
                {new Date(r.createdAt).toLocaleString(lang === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {r.assessedBy ? ` · ${r.assessedBy.name ?? r.assessedBy.email}` : ''}
                {first ? ` · ${t('svcdash.logFirst', 'prima evaluare')}` : ''}
              </div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 13 }}>
                {changes.map(({ f, from, to }) => (
                  <li key={f.key}>
                    <strong>{f.name}:</strong> {f.text || first ? f.show(to) : `${f.show(from)} → ${f.show(to)}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/**
 * A domain (or all services) shown like a service row: dot = average status (coloured as the nearest
 * 0–2 status), name, average satisfaction x/5 on the right. The tooltip gives the status average and
 * how many services each mean counts. `children` = trailing controls (e.g. the order arrows).
 */
/** The state shown for a group: its own state when no service is available, else the rounded average. */
export function aggState(agg: Agg | undefined, statuses: Status[]) {
  const own = agg?.statusCode ? statuses.find((s) => s.code === agg.statusCode) : undefined
  const dot = own ?? (agg?.status == null ? undefined : statuses.find((s) => s.value === Math.round(agg.status!)))
  return { own, dot }
}

export function AggregateRow({ name, agg, statuses, children, large, since }: { name: React.ReactNode; agg: Agg | undefined; statuses: Status[]; children?: React.ReactNode; large?: boolean; since: string }) {
  const { t } = useI18n()
  // No service available → the group takes that state (same look as such a service); otherwise the
  // dot is the status nearest to the average.
  const own = agg?.statusCode ? statuses.find((s) => s.code === agg.statusCode) : undefined
  // The dot is the status of the rounded average (1,5 → 2), like the whole numbers shown.
  const nearest = own ?? (agg?.status == null ? undefined : statuses.find((s) => s.value === Math.round(agg.status!)))
  const grey = own?.tone === 'grey' ? { color: TONE.grey } : undefined
  const maxStatus = Math.max(...statuses.map((s) => s.value))
  const title = own ? `${own.label}: ${own.definition}` : agg ? t('svcdash.aggHint', { v: agg.status == null ? '–' : num(agg.status), m: maxStatus, s: agg.statusCount, l: agg.satisfactionCount, n: agg.total }) : undefined
  return (
    <div className="row" title={title} style={{ gap: large ? 10 : 8, alignItems: 'center' }}>
      <Dot status={nearest} size={large ? 18 : 12} />
      <span style={{ flex: 1, minWidth: 0, fontWeight: 700, ...grey }}>{name}</span>
      <TrendMark trend={agg?.trend} since={since} size={large ? 18 : 12} />
      <span style={{ fontSize: large ? 22 : 12, whiteSpace: 'nowrap', fontWeight: large ? 700 : 600, ...grey }}
        title={agg?.satisfaction == null ? t('svcdash.satisfaction', 'Grad de satisfacție') : t('svcdash.satHover', { v: num(agg.satisfaction), n: agg.satisfactionCount })}>
        {agg?.satisfaction == null ? '–' : whole(agg.satisfaction)}/5
      </span>
      {children}
    </div>
  )
}

export function ServicesDashboard({ communityId, canEdit, onOpenIncidents }: { communityId: string; canEdit: boolean; onOpenIncidents?: () => void }) {
  const { api } = useAuth()
  const { t, lang } = useI18n()
  const [cat, setCat] = React.useState<Catalog | null>(null)
  const [hidden, setHidden] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<Item[] | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [logItem, setLogItem] = React.useState<Item | null>(null)
  // Collapsed card: only the header and the summary stay visible. Remembered per browser.
  const [collapsed, setCollapsedState] = React.useState<boolean>(() => {
    // Collapsed by default, like the other dashboard cards; the viewer's last choice is remembered.
    try { return localStorage.getItem('svcdash.collapsed') !== '0' } catch { return true }
  })
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v)
    try { localStorage.setItem('svcdash.collapsed', v ? '1' : '0') } catch { /* ignore */ }
  }
  // Show services whose status is the grey one (Indisponibil = the service does not exist here).
  // Remembered per browser; storage may be unavailable, so every access is guarded.
  const [showMissing, setShowMissingState] = React.useState<boolean>(() => {
    try { return localStorage.getItem('svcdash.showMissing') !== '0' } catch { return true }
  })
  const setShowMissing = (v: boolean) => {
    setShowMissingState(v)
    try { localStorage.setItem('svcdash.showMissing', v ? '1' : '0') } catch { /* ignore */ }
  }

  // Group the cards by service class (default) or by domain. Remembered per browser.
  const [groupBy, setGroupByState] = React.useState<'tier' | 'domain'>(() => {
    try { return localStorage.getItem('svcdash.groupBy') === 'domain' ? 'domain' : 'tier' } catch { return 'tier' }
  })
  const setGroupBy = (v: 'tier' | 'domain') => {
    setGroupByState(v)
    try { localStorage.setItem('svcdash.groupBy', v) } catch { /* ignore */ }
  }

  // Names, domains and labels come back in the UI language.
  const load = React.useCallback(() => {
    api.get<Catalog>(`/communities/${communityId}/services?lang=${lang}`)
      .then((c: Catalog) => setCat(c))
      .catch(() => setHidden(true)) // feature off or no access: the section is simply not shown
  }, [api, communityId, lang])
  React.useEffect(load, [load])

  if (hidden || !cat) return null
  const items = draft ?? [...cat.items].sort((a, b) => a.sortOrder - b.sortOrder)
  const groups = groupByDomain(items)
  const statusOf = (code: string | null) => cat.statuses.find((s) => s.code === code)
  const isMissing = (it: Item) => statusOf(it.status)?.tone === 'grey'
  const missingCount = items.filter(isMissing).length
  // While editing everything stays visible, so order and status can be changed for any service.
  // The order is edited per domain, so editing always shows the domain cards.
  const byTier = groupBy === 'tier' && !editing && (cat.tiers?.length ?? 0) > 0
  const cards: Card[] = byTier
    ? [
        ...cat.tiers!.map((tr, gi) => ({ key: tr.code, name: tr.label, definition: tr.definition, gi, items: items.filter((i) => i.tier === tr.code), agg: cat.aggregates?.tiers?.find((a) => a.tier === tr.code) })),
        { key: '__none', name: t('svcdash.noTier', 'Neclasificate'), gi: -1, items: items.filter((i) => !i.tier || !cat.tiers!.some((tr) => tr.code === i.tier)), agg: undefined },
      ].filter((c) => c.items.length)
    : groups.map((g, gi) => ({ key: g.domain, name: g.domain, gi, items: g.items, agg: cat.aggregates?.domains.find((d) => d.domain === g.domain) }))
  const visible = (g: { items: Item[] }) => (editing || showMissing ? g.items : g.items.filter((it) => !isMissing(it)))

  const flatten = (gs: typeof groups) => gs.flatMap((g) => g.items)
  const moveDomain = (i: number, d: -1 | 1) => {
    const gs = [...groups]
    const j = i + d
    if (j < 0 || j >= gs.length) return
    ;[gs[i], gs[j]] = [gs[j], gs[i]]
    setDraft(flatten(gs))
  }
  const moveItem = (gi: number, ii: number, d: -1 | 1) => {
    const gs = groups.map((g) => ({ ...g, items: [...g.items] }))
    const list = gs[gi].items
    const j = ii + d
    if (j < 0 || j >= list.length) return
    ;[list[ii], list[j]] = [list[j], list[ii]]
    setDraft(flatten(gs))
  }
  const saveOrder = async () => {
    if (!draft) { setEditing(false); return }
    setBusy(true); setErr(null)
    try {
      await api.patch(`/communities/${communityId}/services/order`, { ids: draft.map((x) => x.id) })
      setDraft(null); setEditing(false); setSaved(t('svcdash.orderSaved', 'Ordinea a fost salvată; avizierul și bugetul o folosesc de acum.'))
      load()
    } catch (e: any) { setErr(e?.message ?? String(e)) } finally { setBusy(false) }
  }
  const setStatus = async (it: Item, code: string) => {
    setErr(null)
    try {
      await api.patch(`/communities/${communityId}/services/${it.id}/status`, { status: code || null })
      setCat((c) => (c ? { ...c, items: c.items.map((x) => (x.id === it.id ? { ...x, status: code || null, satisfaction: code === 'UNAVAILABLE' ? null : x.level } : x)) } : c))
      load() // refresh the domain averages
      setDraft((d) => (d ? d.map((x) => (x.id === it.id ? { ...x, status: code || null } : x)) : d))
    } catch (e: any) { setErr(e?.message ?? String(e)) }
  }
  const counts = cat.statuses.map((s) => ({ s, n: items.filter((i) => i.status === s.code).length }))
  // Summary lists: services in the red status (value 0), and services whose satisfaction moved since last month.
  // "Critice": the not-functional (red) and high-risk (orange) services, worst first.
  const critical = items.filter((i) => ['red', 'orange'].includes(statusOf(i.status)?.tone ?? ''))
    .sort((a, b) => (statusOf(a.status)?.value ?? 0) - (statusOf(b.status)?.value ?? 0))
  const changed = items.filter((i) => i.trend && i.trend.delta).sort((a, b) => b.trend!.delta - a.trend!.delta)
  const unset = items.filter((i) => !statusOf(i.status)).length
  const arrow = (dir: -1 | 1, onClick: () => void, disabled: boolean) => {
    const label = dir < 0 ? t('svcdash.up', 'Mută mai sus') : t('svcdash.down', 'Mută mai jos')
    return (
      <button type="button" className="btn ghost small" style={{ padding: '0 6px', minWidth: 0 }} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
        {dir < 0 ? '↑' : '↓'}
      </button>
    )
  }

  const overall = cat.aggregates?.overall
  const { dot: overallDot } = aggState(overall, cat.statuses)
  const maxStatus = Math.max(...cat.statuses.map((s) => s.value))
  const linkStyle: React.CSSProperties = { gap: 6, alignItems: 'center', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }
  const available = items.filter((i) => !isMissing(i)).length
  const chip: React.CSSProperties = { gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }
  const values: React.CSSProperties = { gap: 10, flexWrap: 'wrap', alignItems: 'center' }
  return (
    <div style={outerCardStyle}>
      {/* Same pattern as the other dashboard cards: small caps label, big figure, round +/−. The
          header and summary are identical collapsed or expanded; editing lives in the expanded part. */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={sectionLabelStyle}>{t('svcdash.title', 'Servicii')} ({items.length})</div>
          <div className="row" style={{ ...bigNumberStyle, gap: 10, alignItems: 'center', fontVariantNumeric: 'tabular-nums', flexWrap: 'wrap' }}
            title={overall ? t('svcdash.aggHint', { v: overall.status == null ? '–' : num(overall.status), m: maxStatus, s: overall.statusCount, l: overall.satisfactionCount, n: overall.total }) : undefined}>
            {/* Dot first (like a domain), label, the whole satisfaction big with "/5" small, then the
                change since last month with one decimal. */}
            <Dot status={overallDot} size={18} />
            <span>{t('svcdash.overallLabel', 'Stare servicii')}</span>
            <span title={overall?.satisfaction == null ? undefined : t('svcdash.satHover', { v: num(overall.satisfaction), n: overall.satisfactionCount })}>
              {overall?.satisfaction == null ? '–' : whole(overall.satisfaction)}
              <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--muted, #737373)' }}>/5</span>
            </span>
            {overall?.trend?.delta ? (
              <span title={t('svcdash.trend', { m: monthName(cat.trendSince, lang), a: num(overall.trend.from), b: num(overall.trend.to) })}
                style={{ fontSize: 16, fontWeight: 600, color: overall.trend.delta > 0 ? TONE.green : TONE.red }}>
                {overall.trend.delta > 0 ? '▲ +' : '▼ −'}{num(Math.abs(overall.trend.delta))}
              </span>
            ) : null}
          </div>

          {/* Compact summary: label column + values, in the cards' muted "label:" style. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 12, rowGap: 4, fontSize: 12, marginTop: 8, alignItems: 'center' }}>
            <span className="muted">{t('svcdash.sumByStatus', { n: available })}:</span>
            <div className="row" style={values}>
              {counts.map(({ s, n }) => (
                <span key={s.code} className="row" style={chip} title={`${s.label} (${s.value}): ${s.definition}`}><Dot status={s} size={10} />{s.label} <strong>{n}</strong></span>
              ))}
              {unset > 0 && <span className="row" style={chip}><Dot status={undefined} size={10} />{t('svcdash.unset', 'Stare nesetată')} <strong>{unset}</strong></span>}
            </div>
            <span className="muted" title={t('svcdash.sumCriticalHint', 'Servicii Nefuncționale sau cu Risc mare')}>{t('svcdash.sumCritical', { n: critical.length })}:</span>
            <div className="row" style={values}>
              {critical.length ? critical.map((it) => (
                <button key={it.id} type="button" onClick={() => setLogItem(it)} className="row" title={`${it.domain} · ${t('svcdash.openLog', 'Vezi jurnalul modificărilor')}`} style={{ ...linkStyle, ...chip }}>
                  <Dot status={statusOf(it.status)} size={10} /><span style={it.providedBy ? { fontStyle: 'italic' } : undefined}>{it.name}{it.providedBy ? '*' : ''}</span>
                </button>
              )) : <span className="muted">{t('svcdash.none', 'niciunul')}</span>}
            </div>
            <span className="muted">{t('today.incidentsTitle', 'Incidente deschise')}: <strong style={{ color: cat.openIncidents ? TONE.red : undefined }}>{cat.openIncidents ?? 0}</strong></span>
            <div className="row" style={values}>
              {cat.items.some((it) => it.openIncidents) ? cat.items.filter((it) => it.openIncidents).map((it) => (
                <button key={it.id} type="button" onClick={onOpenIncidents} className="row" style={{ ...linkStyle, ...chip }}
                  title={it.openIncidents === 1 ? t('svcdash.incidentsOne', '1 incident deschis') : t('svcdash.incidents', { n: it.openIncidents ?? 0 })}>
                  <Dot status={statusOf(it.status)} size={10} /><span>{it.name}</span> <strong style={{ color: TONE.red }}>{it.openIncidents}</strong>
                </button>
              )) : <span className="muted">{t('svcdash.none', 'niciunul')}</span>}
            </div>
            <span className="muted">{t('svcdash.sumTrend', { m: monthName(cat.trendSince, lang) })}:</span>
            <div className="row" style={values}>
              {changed.length ? changed.map((it) => (
                <button key={it.id} type="button" onClick={() => setLogItem(it)} className="row" title={t('svcdash.openLog', 'Vezi jurnalul modificărilor')} style={{ ...linkStyle, ...chip }}>
                  <TrendMark trend={it.trend} since={cat.trendSince} />
                  <span style={it.providedBy ? { fontStyle: 'italic' } : undefined}>{it.name}{it.providedBy ? '*' : ''}</span>
                  <span className="muted">{it.trend!.from}→{it.trend!.to}</span>
                </button>
              )) : <span className="muted">{t('svcdash.noChange', 'fără schimbări')}</span>}
            </div>
          </div>
        </div>
        <button type="button" style={collapseBtnStyle} disabled={editing} onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
          title={collapsed ? t('svcdash.expand', 'Extinde') : t('svcdash.collapse', 'Restrânge')} aria-label={collapsed ? t('svcdash.expand', 'Extinde') : t('svcdash.collapse', 'Restrânge')}>
          {collapsed ? '+' : '−'}
        </button>
      </div>

      {!collapsed && (
      <div className="stack" style={{ gap: 10, marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="row" role="group" aria-label={t('svcdash.groupBy', 'Grupare')} style={{ gap: 4, alignItems: 'center', fontSize: 12 }}>
            <span className="muted">{t('svcdash.groupBy', 'Grupare')}:</span>
            {(['tier', 'domain'] as const).map((g) => (
              <button key={g} type="button" className="btn ghost small" disabled={editing} aria-pressed={groupBy === g}
                style={{ padding: '2px 8px', background: groupBy === g ? 'var(--accent-soft)' : undefined, borderColor: groupBy === g ? 'var(--accent-border)' : undefined }}
                onClick={() => setGroupBy(g)}>
                {g === 'tier' ? t('svcdash.byTier', 'Pe clase') : t('svcdash.byDomain', 'Pe domenii')}
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />
            {t('svcdash.showMissing', { n: missingCount })}
          </label>
        </div>
        {canEdit && (
          <div className="row" style={{ gap: 6 }}>
            {editing ? (
              <>
                <button type="button" className="btn small" disabled={busy} onClick={saveOrder}>{draft ? t('svcdash.saveOrder', 'Salvează ordinea') : t('svcdash.done', 'Gata')}</button>
                <button type="button" className="btn ghost small" disabled={busy} onClick={() => { setDraft(null); setEditing(false) }}>{t('common.cancel', 'Renunță')}</button>
              </>
            ) : (
              <button type="button" className="btn ghost small" onClick={() => { setEditing(true); setSaved(null) }}>{t('svcdash.edit', 'Editează ordinea și starea')}</button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {cards.map((g) => !visible(g).length ? null : (
          <div key={g.key} style={innerCardStyle}>
            <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--border, #e5e5e5)' }}>
              <AggregateRow name={`${g.name} (${g.items.filter((it) => !isMissing(it)).length})`} agg={g.agg} statuses={cat.statuses} since={cat.trendSince}>
                {editing && (
                  <>
                    {arrow(-1, () => moveDomain(g.gi, -1), g.gi === 0)}
                    {arrow(1, () => moveDomain(g.gi, 1), g.gi === groups.length - 1)}
                  </>
                )}
              </AggregateRow>
              {g.definition && <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.35 }}>{g.definition}</div>}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {visible(g).map((it, vi, list) => {
                const ii = g.items.indexOf(it)
                const st = statusOf(it.status)
                const grey = isMissing(it) ? { color: TONE.grey } : undefined
                const provider = it.providedBy ? cat.providers?.find((p) => p.code === it.providedBy) : undefined
                const domainHead = byTier && (vi === 0 || list[vi - 1].domain !== it.domain)
                return (
                  <React.Fragment key={it.id}>
                  {domainHead && (
                    <li className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: vi === 0 ? 0 : 4, opacity: 0.8 }}>{it.domain}</li>
                  )}
                  <li className="row" style={{ gap: 8, alignItems: 'center' }} title={`${byTier ? `${it.domain} · ` : ''}${st?.label ?? t('svcdash.unset', 'Stare nesetată')}`}>
                    <Dot status={st} />
                    <button type="button" onClick={() => setLogItem(it)} title={t('svcdash.openLog', 'Vezi jurnalul modificărilor')}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit', fontStyle: provider ? 'italic' : undefined, ...grey }}>
                      {it.name}
                      {provider && <sup title={`${provider.label}: ${provider.note}`} aria-label={`${provider.label}: ${provider.note}`} style={{ marginLeft: 2, fontStyle: 'normal', cursor: 'help' }}>*</sup>}
                    </button>
                    {!!it.openIncidents && (
                      <button type="button" onClick={onOpenIncidents} className="badge negative" style={{ border: 0, cursor: onOpenIncidents ? 'pointer' : 'default', fontSize: 11, padding: '1px 6px' }}
                        title={it.openIncidents === 1 ? t('svcdash.incidentsOne', '1 incident deschis') : t('svcdash.incidents', { n: it.openIncidents ?? 0 })}>
                        ⚠ {it.openIncidents}
                      </button>
                    )}
                    {editing ? (
                      <>
                        <select className="input" style={{ fontSize: 12, padding: '2px 4px', maxWidth: 130 }} value={it.status ?? ''} onChange={(e) => setStatus(it, e.target.value)} aria-label={t('svcdash.status', 'Stare')}>
                          <option value="">{t('svcdash.unset', 'Stare nesetată')}</option>
                          {cat.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                        </select>
                        {arrow(-1, () => moveItem(g.gi, ii, -1), ii === 0)}
                        {arrow(1, () => moveItem(g.gi, ii, 1), ii === g.items.length - 1)}
                      </>
                    ) : (
                      <>
                        <TrendMark trend={it.trend} since={cat.trendSince} />
                        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', ...grey }} title={t('svcdash.satisfaction', 'Grad de satisfacție')}>
                          {it.satisfaction == null ? '–' : it.satisfaction}/5
                        </span>
                      </>
                    )}
                  </li>
                  </React.Fragment>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {(cat.providers ?? []).filter((p) => items.some((i) => i.providedBy === p.code)).map((p) => (
        <div key={p.code} className="muted" style={{ fontSize: 12 }}><em>{t('svcdash.italicNote', 'Serviciile cu italic')}</em> <sup>*</sup> — {p.note}</div>
      ))}
      <details style={{ fontSize: 12 }}>
        <summary style={{ cursor: 'pointer' }}>{t('svcdash.defsTitle', 'Ce înseamnă stările și cum se calculează media')}</summary>
        <table className="table" style={{ marginTop: 6 }}>
          <tbody>
            {cat.statuses.map((s) => (
              <tr key={s.code}>
                <td style={{ whiteSpace: 'nowrap' }}><span className="row" style={{ gap: 6, alignItems: 'center' }}><Dot status={s} />{s.label}</span></td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{s.value}</td>
                <td>{s.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(cat.tiers?.length ?? 0) > 0 && (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>{t('svcdash.tierCol', 'Clasă')}</th><th>{t('svcdash.tierDef', 'Definiție')}</th><th>{t('svcdash.tierEx', 'Exemple')}</th></tr>
            </thead>
            <tbody>
              {cat.tiers!.map((tr) => (
                <tr key={tr.code}>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{tr.label}</td>
                  <td>{tr.definition}</td>
                  <td className="muted">{tr.examples || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted" style={{ marginTop: 6 }}>{t('svcdash.aggRule', 'Media stării unui domeniu = media valorilor 0–2 ale serviciilor lui; serviciile Indisponibile, Oprite sau fără stare nu intră în calcul. Media satisfacției = media nivelurilor 0–5; serviciile neevaluate nu intră în calcul.')}</div>
      </details>
      </div>
      )}
      {err && <div className="badge negative">{err}</div>}
      {saved && <div className="muted" style={{ fontSize: 12 }}>{saved}</div>}
      {logItem && <ChangeLog communityId={communityId} item={logItem} cat={cat} onClose={() => setLogItem(null)} />}
      {editing && <div className="muted" style={{ fontSize: 12 }}>{t('svcdash.orderHelp', 'Ordinea de aici se aplică și pe avizier (coloanele serviciilor) și în buget. Starea se salvează imediat; ordinea, la „Salvează ordinea”.')}</div>}
    </div>
  )
}
