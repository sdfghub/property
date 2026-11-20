import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { shortUnit } from './beLabel'
import { budgetToEur, rateOf, type FxRates } from './budgetFx'
import { AnnualCards, Definitions, DimensionView, FundView, FxPanel, MonthCtx, type Metric, MultiYearView, ProjectModal, ProjectsView, ServiceView, YearSelector, type Annual, type MultiYear, type Portfolio } from './BudgetViews'

// Budget vs Forecast vs Actual. Every code/label (dimensions, maintenance kinds, services, statuses,
// metric names and their definitions) comes from the /budget payload — this file only lays it out.

type CodeLabel = { code: string; label: string; hint?: string; fm?: string }
type Metrics = {
  budget: number; estimate: number; committed: number | null; actual: number
  remainingCommitted: number; remainingUncommitted: number; forecast: number; variance: number
  paidByFund?: Record<string, number>; lineCount?: number
}
type Line = {
  id: string; code: string; dimension: string; maintenanceKind: string | null; maintenanceKindLabel: string | null
  serviceCode: string | null; serviceLabel: string | null; area: string | null; name: string
  projectCode: string | null; projectName: string | null; fundCode: string | null; fundName: string | null
  vendorName: string | null; status: string; statusLabel: string | null; assumption: string | null
  live: boolean; horizon: 'ANNUAL' | 'MULTIYEAR'; metrics: Metrics
}
type Dimension = CodeLabel & { horizon: string; totals: Metrics; groups: Array<{ key: string; label: string; totals: Metrics }> }
type FundRow = {
  code: string | null; name: string | null; dimensionHint: string | null; allocationSplit: string | null
  target: number | null; collected: number | null; paidFromFund: number; planned: Metrics; fundingGap: number | null
}
type Payload = {
  community: { id: string; name: string }
  versions: Array<{ code: string; name: string; fiscalYear: number }>
  version: { code: string; name: string; fiscalYear: number; status: string; notes: string | null; latestClosedPeriod: string | null; fxRates?: FxRates | null } | null
  meta: { dimensions: CodeLabel[]; metrics: CodeLabel[]; statuses: CodeLabel[] }
  programs: Array<{ code: string; name: string; objective: string | null; projects: CodeLabel[] }>
  lines: Line[]; dimensions: Dimension[]; funds: Array<FundRow & { available: number | null }>; totals: Metrics | null
  annual?: Annual; portfolio?: Portfolio; multiYear?: MultiYear
  selection?: { years: string[]; available: string[]; fiscalYear: number; currency: 'RON' | 'EUR'; fxRates: FxRates | null; fundBudgetRon: Record<string, Array<{ code: string; name: string; ron: number }>> }
}

const money = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cost variance: positive = forecast overrun. */
function varianceTone(v: number, budget: number): string {
  if (Math.abs(v) < 0.5) return 'var(--muted,#888)'
  if (v < 0) return '#16a34a'
  return budget > 0 && v / budget < 0.05 ? '#d97706' : '#dc2626'
}

export function BudgetPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [raw, setData] = React.useState<Payload | null>(null)
  const [cur, setCur] = React.useState<'RON' | 'EUR'>('RON')
  const [years, setYears] = React.useState<string[] | null>(null)
  const [monthly, setMonthly] = React.useState(false)
  const [metric, setMetric] = React.useState<Metric>('budget')
  const [reload, setReload] = React.useState(0)
  const saveFx = async (year: string, body: { rate?: number; fundCode?: string; eur?: number }) => {
    await api.patch(`/communities/${communityId}/budget/fx-rates`, { version: versionCode || raw?.version?.code, year, ...body })
    setReload((n) => n + 1)
  }
  const rates = raw?.version?.fxRates ?? null
  const fy = raw?.version?.fiscalYear ?? 0
  // Every amount on the page is converted here; the line detail modal stays in RON (its calculation).
  // `annual` and `multiYear` come converted (year by year) from the API.
  const data = React.useMemo(() => (raw && raw.selection?.currency === 'EUR' && rates
    ? { ...budgetToEur(raw, rates, fy), annual: raw.annual, multiYear: raw.multiYear, selection: raw.selection } : raw), [raw, rates, fy])
  const sel = data?.selection
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [versionCode, setVersionCode] = React.useState<string>('')
  const [view, setView] = React.useState<'service' | 'fund' | 'projects' | 'multiyear' | 'dimension'>('service')
  const [projectCode, setProjectCode] = React.useState<string | null>(null)
  const [lineId, setLineId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true); setError(null)
    const q = new URLSearchParams()
    if (versionCode) q.set('version', versionCode)
    if (years?.length) q.set('years', years.join(','))
    if (cur === 'EUR') q.set('currency', 'EUR')
    api.get<Payload>(`/communities/${communityId}/budget${q.toString() ? `?${q}` : ''}`)
      .then((d: Payload) => setData(d))
      .catch((e: any) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [api, communityId, versionCode, years, cur, reload])

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>{t('budget.title', 'Buget vs Forecast vs Actual')}</h3>
          {data?.version && (
            <div className="muted" style={{ fontSize: 12 }}>
              {data.version.name} · {t('budget.reference', { p: data.version.latestClosedPeriod ?? '—' })}
              {cur === 'EUR' && rates && <> · {t('budget.fx.note', { y: fy, r: rateOf(rates, fy).toLocaleString('ro-RO', { minimumFractionDigits: 4 }), b: rates[String(fy)]?.basis ?? '' })}</>}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
            {([['service', t('budget.view.service', 'Pe servicii')], ['fund', t('budget.view.fund', 'Pe fond')], ['projects', t('budget.view.projects', 'Proiecte')], ['multiyear', t('budget.view.multiyear', 'Multi-an')], ['dimension', t('budget.view.dimension', 'Pe dimensiune')]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`btn small ${view === k ? '' : 'ghost'}`} onClick={() => setView(k)}>{l}</button>
            ))}
          </div>
          {rates && (
            <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
              {(['RON', 'EUR'] as const).map((c) => (
                <button key={c} type="button" className={`btn small ${cur === c ? '' : 'ghost'}`} onClick={() => setCur(c)}>{c === 'RON' ? 'lei' : '€'}</button>
              ))}
            </div>
          )}
          {data && data.versions.length > 1 && (
            <select className="input" value={versionCode || data.version?.code || ''} onChange={(e) => setVersionCode(e.target.value)}>
              {data.versions.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading && <div className="card"><div className="muted">{t('common.loading', 'Se încarcă…')}</div></div>}
      {error && <div className="card"><div className="badge negative">{error}</div></div>}
      {!loading && data && !data.version && (
        <div className="card"><div className="empty">{t('budget.empty', 'Nu există încă un buget. Încărcați-l cu npm run import:budget.')}</div></div>
      )}

      {data?.version && data.totals && (
        <>
          {sel && <YearSelector available={sel.available} selected={sel.years} fiscalYear={sel.fiscalYear} onChange={setYears} />}
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
              {([[false, t('budget.mo.year', 'Pe an')], [true, t('budget.mo.month', 'Pe luni')]] as const).map(([k, l]) => (
                <button key={String(k)} type="button" className={`btn small ${monthly === k ? '' : 'ghost'}`} onClick={() => setMonthly(k)}>{l}</button>
              ))}
            </div>
            {monthly && view !== 'multiyear' && (
              <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden' }}>
                {([['budget', t('budget.def.budget', 'Buget')], ['actual', t('budget.def.actual', 'Actual')], ['forecast', t('budget.def.forecast', 'Forecast')], ['variance', t('budget.def.variance', 'Abatere')]] as const).map(([k, l]) => (
                  <button key={k} type="button" className={`btn small ${metric === k ? '' : 'ghost'}`} onClick={() => setMetric(k)}>{l}</button>
                ))}
              </div>
            )}
            {monthly && view === 'multiyear' && <span className="muted" style={{ fontSize: 12 }}>{t('budget.mo.myBudget', 'Multi-an arată bugetul pe fiecare lună.')}</span>}
          </div>
          <Definitions />
          <MonthCtx.Provider value={{ monthly, metric: view === 'multiyear' ? 'budget' : metric, months: data.annual?.months ?? [] }}>
          {cur === 'EUR' && sel?.fxRates && <FxPanel years={sel.years} rates={sel.fxRates} fundBudgetRon={sel.fundBudgetRon} onSave={saveFx} />}
          {view !== 'multiyear' && data.annual && <AnnualCards annual={data.annual} />}
          {view === 'service' && data.annual && <ServiceView annual={data.annual} onLine={setLineId} onProject={setProjectCode} />}
          {view === 'fund' && data.annual && <FundView annual={data.annual} onLine={setLineId} onProject={setProjectCode} />}
          {view === 'multiyear' && data.multiYear && sel && <MultiYearView multiYear={data.multiYear} years={sel.years} unit={cur === 'EUR' ? '€' : 'lei'} rates={cur === 'EUR' ? rates : null} />}
          {view === 'projects' && data.portfolio && data.annual && <ProjectsView portfolio={data.portfolio} annual={data.annual} onProject={setProjectCode} />}
          {view === 'dimension' && data.annual && <DimensionView annual={data.annual} onLine={setLineId} onProject={setProjectCode} />}
          </MonthCtx.Provider>
        </>
      )}

      {projectCode && data?.portfolio && (() => {
        const p = data.portfolio.programs.flatMap((pg) => pg.projects).find((x) => x.code === projectCode)
        return p ? <ProjectModal project={p} years={data.portfolio.years} onClose={() => setProjectCode(null)} onLine={setLineId} /> : null
      })()}
      {lineId && <BudgetLineModal communityId={communityId} lineId={lineId} onClose={() => setLineId(null)} />}
    </div>
  )
}

type LineDetail = {
  meta: { metrics: CodeLabel[] }
  line: {
    code: string; name: string; dimensionLabel: string | null; maintenanceKindLabel: string | null
    serviceCode: string | null; serviceLabel: string | null; area: string | null
    project: { code: string; name: string; program: { code: string; name: string } | null } | null
    fundName: string | null; vendorName: string | null; documentRef: string | null; statusLabel: string | null
    quantity: number | null; unitOfMeasure: string | null; unitRate: number | null; assumption: string | null
    basis: { method?: string; formula?: string; forecastFormula?: string; source?: string; inputs?: Array<{ label: string; value: any }>; total?: number } | null
    fiscalYear: number
  }
  metrics: Metrics
  months: Array<{ periodCode: string; budget: number; actual: number | null; forecast: number; kind: string }> | null
  entries: Array<{ id: string; kind: string; kindLabel: string | null; date: string | null; amount: number; fundName: string | null; documentRef: string | null; description: string | null; note: string | null; inBaseline: boolean | null; sourceRow: number | null }>
  units: {
    method: { label: string; source: string; referencePeriod: string | null; detail: string }
    rows: Array<{ unitCode: string; unitName: string | null; unitType: string | null; weight: number; sharePct: number; budget: number; actual: number; forecast: number }>
    totals: { budget: number; actual: number; forecast: number; sharePct: number }
  }
}

function BudgetLineModal({ communityId, lineId, onClose }: { communityId: string; lineId: string; onClose: () => void }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [d, setD] = React.useState<LineDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<'calc' | 'units'>('calc')
  React.useEffect(() => {
    api.get<LineDetail>(`/communities/${communityId}/budget/lines/${lineId}`).then((x: LineDetail) => setD(x)).catch((e: any) => setError(e?.message ?? String(e)))
  }, [api, communityId, lineId])
  const ml = (c: string) => d?.meta.metrics.find((m) => m.code === c)?.label ?? c

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1000, width: '100%', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>{d?.line.name ?? '…'}</h4>
            {d && (
              <div className="muted" style={{ fontSize: 12 }}>
                {[d.line.dimensionLabel, d.line.maintenanceKindLabel, d.line.project ? `${d.line.project.program?.name ?? ''} → ${d.line.project.name}` : null, d.line.serviceLabel, d.line.area].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative">{error}</div>}
        {!d && !error && <div className="muted">{t('common.loading', 'Se încarcă…')}</div>}
        {d && (
          <div className="stack" style={{ gap: 12, marginTop: 8 }}>
            <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
              <span>{t('budget.col.fund', 'Fond sursă')}: <strong>{d.line.fundName ?? t('budget.fundToConfirm', 'de confirmat')}</strong></span>
              {d.line.vendorName && <span>{t('budget.vendor', 'Furnizor')}: <strong>{d.line.vendorName}</strong></span>}
              {d.line.documentRef && <span>{t('budget.document', 'Document')}: <strong>{d.line.documentRef}</strong></span>}
              <span>{t('budget.col.status', 'Stare')}: <strong>{d.line.statusLabel}</strong></span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {(['budget', 'estimate', 'committed', 'actual', 'remainingCommitted', 'remainingUncommitted', 'forecast', 'variance'] as const).map((k) => (
                <div key={k} className="card" style={{ padding: '6px 10px', minWidth: 110 }}>
                  <div className="muted" style={{ fontSize: 11 }} title={d.meta.metrics.find((m) => m.code === k)?.hint}>{ml(k)}</div>
                  <div style={{ fontWeight: 600, color: k === 'variance' ? varianceTone(d.metrics.variance, d.metrics.budget) : undefined }}>{money((d.metrics as any)[k])}</div>
                </div>
              ))}
            </div>

            <div className="row" style={{ gap: 0, border: '1px solid var(--border,#ddd)', borderRadius: 6, overflow: 'hidden', alignSelf: 'flex-start' }}>
              <button type="button" className={`btn small ${tab === 'calc' ? '' : 'ghost'}`} onClick={() => setTab('calc')}>{t('budget.tab.calc', 'Calculul liniei')}</button>
              <button type="button" className={`btn small ${tab === 'units' ? '' : 'ghost'}`} onClick={() => setTab('units')}>{t('budget.tab.units', 'Calcul pe unitate')}</button>
            </div>

            {tab === 'calc' && (
              <>
                {d.line.basis?.formula && (
                  <div className="card" style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
                    <div style={{ fontSize: 13 }}><strong>{t('budget.formula', 'Formula bugetului')}:</strong> {d.line.basis.formula}</div>
                    {d.line.basis.forecastFormula && <div style={{ fontSize: 13, marginTop: 4 }}><strong>{t('budget.forecastFormula', 'Formula forecastului')}:</strong> {d.line.basis.forecastFormula}</div>}
                    {d.line.quantity != null && (
                      <div style={{ fontSize: 13, marginTop: 4 }}>
                        {t('budget.qtyRate', { q: d.line.quantity, um: d.line.unitOfMeasure ?? '', r: money(d.line.unitRate), b: money(d.metrics.budget) })}
                      </div>
                    )}
                    {d.line.basis.source && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{t('budget.source', 'Sursă')}: {d.line.basis.source}</div>}
                    {d.line.assumption && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t('budget.assumption', 'Ipoteză')}: {d.line.assumption}</div>}
                    {!!d.line.basis.inputs?.length && !d.months && (
                      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
                        {d.line.basis.inputs.map((i) => <span key={i.label}>{i.label}: <strong>{typeof i.value === 'number' ? money(i.value) : String(i.value)}</strong></span>)}
                      </div>
                    )}
                  </div>
                )}
                {d.months && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('budget.month', 'Luna')}</th>
                        <th style={{ textAlign: 'right' }}>{ml('budget')}</th>
                        <th style={{ textAlign: 'right' }}>{ml('actual')}</th>
                        <th style={{ textAlign: 'right' }}>{ml('forecast')}</th>
                        <th style={{ textAlign: 'right' }}>{ml('variance')}</th>
                        <th>{t('budget.monthKind', 'Tip')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.months.map((m) => (
                        <tr key={m.periodCode}>
                          <td>{m.periodCode}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.budget)}</td>
                          <td style={{ textAlign: 'right' }}>{m.actual == null ? '—' : money(m.actual)}</td>
                          <td style={{ textAlign: 'right' }}>{money(m.forecast)}</td>
                          <td style={{ textAlign: 'right', color: varianceTone(m.forecast - m.budget, m.budget) }}>{money(m.forecast - m.budget)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{m.kind === 'ACTUAL' ? t('budget.monthKind.actual', 'real (lună închisă)') : m.kind === 'DRAFT' ? t('budget.monthKind.draft', 'ciornă (lună în pregătire)') : t('budget.monthKind.estimate', 'estimat')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {!!d.entries.length && (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('budget.entry.kind', 'Tip')}</th>
                        <th>{t('budget.entry.date', 'Data')}</th>
                        <th>{t('budget.entry.desc', 'Descriere / document')}</th>
                        <th>{t('budget.col.fund', 'Fond sursă')}</th>
                        <th style={{ textAlign: 'right' }}>{t('budget.entry.amount', 'Sumă')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.entries.map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontSize: 12 }}>{e.kindLabel}{e.inBaseline === false ? <span className="badge warning" style={{ marginLeft: 4 }}>{t('budget.entry.outside', 'în afara bugetului')}</span> : null}</td>
                          <td style={{ fontSize: 12 }}>{e.date ? new Date(e.date).toLocaleDateString('ro-RO') : '—'}</td>
                          <td style={{ fontSize: 12 }}>
                            {e.description ?? '—'}{e.documentRef ? <span className="muted"> · {e.documentRef}</span> : null}
                            {e.note && <div className="muted" style={{ fontSize: 11 }}>{e.note}</div>}
                            {e.sourceRow && <div className="muted" style={{ fontSize: 10 }}>{t('budget.entry.row', { r: e.sourceRow })}</div>}
                          </td>
                          <td style={{ fontSize: 12 }}>{e.fundName ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{money(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {tab === 'units' && (
              <>
                <div className="card" style={{ background: 'var(--surface-2, rgba(0,0,0,0.03))', fontSize: 13 }}>
                  <div><strong>{t('budget.units.key', 'Cheia de repartizare')}:</strong> {d.units.method.label}{d.units.method.referencePeriod ? ` · ${t('budget.units.ref', { p: d.units.method.referencePeriod })}` : ''}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{d.units.method.detail}</div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('budget.units.unit', 'Unitate')}</th>
                      <th style={{ textAlign: 'right' }}>{t('budget.units.weight', 'Bază')}</th>
                      <th style={{ textAlign: 'right' }}>{t('budget.units.share', 'Cotă %')}</th>
                      <th style={{ textAlign: 'right' }}>{ml('budget')}</th>
                      <th style={{ textAlign: 'right' }}>{ml('actual')}</th>
                      <th style={{ textAlign: 'right' }}>{ml('forecast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.units.rows.map((r) => (
                      <tr key={r.unitCode}>
                        <td>{r.unitName ?? shortUnit(r.unitCode)}{r.unitType ? <span className="muted" style={{ fontSize: 11 }}> · {r.unitType}</span> : null}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.weight)}</td>
                        <td style={{ textAlign: 'right' }}>{r.sharePct.toLocaleString('ro-RO', { maximumFractionDigits: 4 })}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.budget)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.actual)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.forecast)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--border,#ccc)', fontWeight: 600 }}>
                      <td>{t('budget.total', 'Total')}</td>
                      <td />
                      <td style={{ textAlign: 'right' }}>{d.units.totals.sharePct.toLocaleString('ro-RO', { maximumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right' }}>{money(d.units.totals.budget)}</td>
                      <td style={{ textAlign: 'right' }}>{money(d.units.totals.actual)}</td>
                      <td style={{ textAlign: 'right' }}>{money(d.units.totals.forecast)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
