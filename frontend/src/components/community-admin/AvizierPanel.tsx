import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Short, friendly column headers for the known category codes (falls back to the code).
const CAT_LABEL: Record<string, string> = {
  APA_RECE: 'Apă rece', APA_METEO: 'Apă meteo', CURENT_SCARA: 'Curent scară', SALUBRITATE: 'Salubritate',
  CURATENIE: 'Curățenie', ADMINISTRARE: 'Administrare', COMISION_BANCA: 'Comision', INTERFON: 'Interfon',
  RULMENT: 'Rulment', REPARATII: 'Reparații', REABILITARE_1: 'Reab. 1', REABILITARE_2: 'Reab. 2',
  REABILITARE_3: 'Reab. 3', PENALIZARI: 'Penalizări',
}

// Category label, incl. per-fund penalty codes `PEN:<fund>` → "Penaliz. <fund>".
const catLabel = (c: string) =>
  c.startsWith('PEN:') ? `Penaliz. ${CAT_LABEL[c.slice(4)] || c.slice(4)}` : (CAT_LABEL[c] || c)

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

  const openSold = (beCode: string) => {
    setSoldDetail({ be: beCode, data: null })
    api.get<any>(`/communities/${communityId}/finance/avizier/explain-sold?period=${encodeURIComponent(data?.period?.code || period)}&be=${encodeURIComponent(beCode)}`)
      .then((d) => setSoldDetail((cur) => (cur && cur.be === beCode ? { ...cur, data: d } : cur)))
      .catch(() => setSoldDetail((cur) => (cur ? { ...cur, data: { error: true } } : cur)))
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
    }).catch(() => setPeriods([]))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    const q = period ? `?period=${encodeURIComponent(period)}` : ''
    api.get<any>(`/communities/${communityId}/finance/avizier${q}`)
      .then((d) => { if (alive) { setData(d); if (!period && d?.period?.code) setPeriod(d.period.code); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period])

  const cats: string[] = data?.categories ?? []
  const rows: any[] = data?.rows ?? []
  const totals = data?.totals

  // Group category columns under their owning fund; each group is a collapsible total column.
  const groups: { key: string; label: string; categories: string[] }[] =
    data?.groups ?? cats.map((c) => ({ key: c, label: catLabel(c), categories: [c] }))
  const penaltyFunds: string[] = data?.penaltyFunds ?? []
  type Col =
    | { kind: 'cat'; cat: string }
    | { kind: 'total'; group: { key: string; label: string; categories: string[] } }
    | { kind: 'pen'; fund: string; scope: 'month' | 'total' }
  const cols: Col[] = []
  for (const g of groups) {
    const isMulti = g.categories.length > 1
    if (isMulti && expanded.has(g.key)) {
      g.categories.forEach((c) => cols.push({ kind: 'cat', cat: c }))
      cols.push({ kind: 'total', group: g })
    } else {
      cols.push({ kind: 'total', group: g })
    }
    // a fund's penalties (this month + cumulative) sit immediately to the right of the fund's column
    if (penaltyFunds.includes(g.key)) {
      cols.push({ kind: 'pen', fund: g.key, scope: 'month' })
      cols.push({ kind: 'pen', fund: g.key, scope: 'total' })
    }
  }
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
          {data?.period?.dueDate ? <span className="muted">{t('avizier.due', 'Scadență')}: {new Date(data.period.dueDate).toLocaleDateString('ro-RO')}</span> : null}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }}>{t('avizier.entity', 'Apartament / Entitate')}</th>
                <th style={{ padding: '8px 10px' }}>{t('avizier.soldPrec', 'Sold precedent')}</th>
                {cols.map((col, i) => {
                  if (col.kind === 'cat') return (
                    <th key={`c${i}`} style={{ padding: '8px 10px', fontWeight: 400, color: 'var(--muted, #666)' }}>{catLabel(col.cat)}</th>
                  )
                  if (col.kind === 'pen') return (
                    <th key={`p${i}`} style={{ padding: '8px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}
                      title={`${col.scope === 'total' ? t('avizier.penTotalHint', 'Total penalizări acumulate') : t('avizier.penMonthHint', 'Penalizări luna aceasta')} — ${CAT_LABEL[col.fund] || col.fund}`}>
                      {col.scope === 'total' ? t('avizier.penTotalShort', 'Pen. total') : t('avizier.penMonthShort', 'Pen. lună')}
                    </th>
                  )
                  return (
                    <th key={`t${i}`} style={{ padding: '8px 10px' }}>
                      {col.group.categories.length > 1 ? (
                        <button type="button" onClick={() => toggleGroup(col.group.key)} title={t('avizier.expand', 'Detaliază')}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 700 }}>
                          {expanded.has(col.group.key) ? '▾ ' : '▸ '}{col.group.label}
                        </button>
                      ) : col.group.label}
                    </th>
                  )
                })}
                <th style={{ padding: '8px 10px' }}>{t('avizier.curent', 'Total lună')}</th>
                <th style={{ padding: '8px 10px' }}>{t('avizier.incasari', 'Încasări')}</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('avizier.total', 'Total de plată')}</th>
              </tr>
            </thead>
            <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((r) => (
                <tr key={r.beCode} style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right' }}>
                  <td style={{ textAlign: 'left', padding: '6px 10px', position: 'sticky', left: 0, background: 'var(--bg, #fff)' }}>
                    <span>{r.units?.join(', ') || r.beCode}</span>
                    {r.beName ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{r.beName}</span> : null}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {r.soldPrecedent ? (
                      <button type="button" onClick={() => openSold(r.beCode)} title={t('avizier.soldDetail', 'Din ce fonduri e compus?')}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                        {money(r.soldPrecedent)}
                      </button>
                    ) : ''}
                  </td>
                  {cols.map((col, i) => {
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
                      return (
                        <td key={`p${i}`} style={{ padding: '6px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}>
                          {v ? (
                            <button type="button" onClick={() => openPenalty(r.beCode, col.scope, col.fund)} title={t('avizier.explain', 'Cum s-a calculat?')}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                              {money(v)}
                            </button>
                          ) : ''}
                        </td>
                      )
                    }
                    const single = col.group.categories.length === 1
                    const v = sumCats(r.charges, col.group.categories)
                    return (
                      <td key={`t${i}`} style={{ padding: '6px 10px', fontWeight: expanded.has(col.group.key) ? 700 : 400 }}>
                        {v ? (single ? (
                          <button type="button" onClick={() => openCell(r.beCode, col.group.categories[0])} title={t('avizier.explain', 'Cum s-a calculat?')}
                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', textDecoration: 'underline dotted', fontVariantNumeric: 'tabular-nums' }}>
                            {money(v)}
                          </button>
                        ) : money(v)) : ''}
                      </td>
                    )
                  })}
                  <td style={{ padding: '6px 10px' }}>{money(r.curentTotal)}</td>
                  <td style={{ padding: '6px 10px' }}>{r.payments ? money(r.payments) : ''}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{money(r.totalDue)}</td>
                </tr>
              ))}
              {totals ? (
                <tr style={{ borderTop: '2px solid var(--border, #ccc)', textAlign: 'right', fontWeight: 700, background: 'var(--muted-bg, #f4f4f5)' }}>
                  <td style={{ textAlign: 'left', padding: '8px 10px', position: 'sticky', left: 0, background: 'var(--muted-bg, #f4f4f5)' }}>{t('avizier.totalRow', 'TOTAL')}</td>
                  <td style={{ padding: '8px 10px' }}>{money(totals.soldPrecedent)}</td>
                  {cols.map((col, i) => col.kind === 'cat' ? (
                    <td key={`c${i}`} style={{ padding: '8px 10px', fontWeight: 400 }}>{money(totals.byCategory?.[col.cat])}</td>
                  ) : col.kind === 'pen' ? (
                    <td key={`p${i}`} style={{ padding: '8px 10px', color: 'var(--danger, #b45309)', fontWeight: col.scope === 'total' ? 700 : 400 }}>{money(totals.penaltyByFund?.[col.fund]?.[col.scope])}</td>
                  ) : (
                    <td key={`t${i}`} style={{ padding: '8px 10px' }}>{money(sumCats(totals.byCategory || {}, col.group.categories))}</td>
                  ))}
                  <td style={{ padding: '8px 10px' }}>{money(totals.curentTotal)}</td>
                  <td style={{ padding: '8px 10px' }}>{money(totals.payments)}</td>
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
              <h4 style={{ margin: 0 }}>{t('avizier.soldTitle', 'Sold precedent — pe fonduri')}</h4>
              <button className="btn ghost small" onClick={() => setSoldDetail(null)}>✕</button>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{soldDetail.data?.beName || soldDetail.be} · {data?.period?.code}</div>
            {!soldDetail.data ? (
              <div className="empty">{t('common.loading', 'Loading…')}</div>
            ) : soldDetail.data.error ? (
              <div className="badge negative">{t('common.error', 'Error')}</div>
            ) : !(soldDetail.data.rows || []).length ? (
              <div className="empty">{t('avizier.soldNone', 'Fără sold precedent.')}</div>
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

      {explain && (
        <div onClick={() => setExplain(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div className="card" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 640, width: '90%', maxHeight: '80vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{t('avizier.howCalc', 'Cum s-a calculat')}: {CAT_LABEL[explain.cat] || explain.cat}</h4>
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
                  ? `${t('avizier.penTitleFund', 'Penalizări')} ${CAT_LABEL[penDetail.fund] || penDetail.fund} — ${t('avizier.penTitleCalc', 'detaliu de calcul')}`
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
                    <div className="muted" style={{ fontSize: 12 }}>{t('avizier.penMonth', 'Penalizări luna aceasta')}</div>
                    <strong style={{ fontSize: 18, color: 'var(--danger, #b45309)' }}>{money(penDetail.data.monthTotal)}</strong>
                  </div>
                  <div className="card soft" style={{ flex: 1, minWidth: 160 }}>
                    <div className="muted" style={{ fontSize: 12 }}>{t('avizier.penTotal', 'Total acumulat')}</div>
                    <strong style={{ fontSize: 18, color: 'var(--danger, #b45309)' }}>{money(penDetail.data.grandTotal)}</strong>
                  </div>
                </div>
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
                      {t('avizier.penPrincipal', 'Datorie')}: {money(b.principalOriginal)}
                      {' · '}{t('avizier.penRemaining', 'rămas')}: {money(b.principalRemaining)}
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
