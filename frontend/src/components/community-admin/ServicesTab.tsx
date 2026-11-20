import React from 'react'
import { ServiceEquipmentPanel } from './ServiceEquipmentPanel'
import { createPortal } from 'react-dom'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { ServicesReport } from './ServicesReport'
import { AggregateRow, Dot, TONE, TrendMark, type Agg, type Status, type Trend } from './ServicesDashboard'

// Labels for levels, statuses and priorities come from the endpoint payload (backend is the
// source of truth); this file only maps a level number to a badge tone. The status, the
// satisfaction shown (`satisfaction`: empty for an Indisponibil service), the domain averages and
// the trends are the same as on the services dashboard (ServicesDashboard.tsx), from the same API.
type ScaleEntry = { level: number | null; label: string; definition: string }
type CodeLabel = { code: string; label: string }

export type ServiceItem = {
  id: string
  domain: string
  name: string
  sortOrder: number
  levelDefs?: Record<string, string> | null
  level: number | null
  comment?: string | null
  actions?: string | null
  workStatus?: string | null
  priority?: string | null
  assessedAt?: string | null
  status?: string | null
  satisfaction?: number | null
  trend?: Trend
  providedBy?: string | null
  tier?: string | null
}

export type Tier = { code: string; label: string; definition: string; examples: string }

export type Catalog = {
  scale: ScaleEntry[]
  workStatuses: CodeLabel[]
  priorities: CodeLabel[]
  items: ServiceItem[]
  statuses?: Status[]
  aggregates?: { domains: Array<Agg & { domain: string }>; tiers?: Array<Agg & { tier: string }>; overall: Agg }
  tiers?: Tier[]
  trendSince?: string
  providers?: Array<{ code: string; label: string; note: string }>
}

type HistoryRow = {
  id: string
  level: number | null
  comment?: string | null
  actions?: string | null
  workStatus?: string | null
  priority?: string | null
  status?: string | null
  createdAt: string
  assessedBy?: { name?: string | null; email?: string | null } | null
}

type Draft = { level: number | null; comment: string; actions: string; workStatus: string; priority: string; status: string }

type Props = {
  communityId: string
  communityName?: string
  readOnly?: boolean
}

const LEVELS = [0, 1, 2, 3, 4, 5]

function levelTone(level: number | null): string {
  if (level === null) return 'badge'
  if (level <= 1) return 'badge negative'
  if (level === 2) return 'badge warning'
  if (level === 3) return 'badge'
  return 'badge positive'
}

function priorityTone(code?: string | null): string {
  if (code === 'CRITICAL') return 'badge negative'
  if (code === 'HIGH') return 'badge warning'
  return 'badge'
}

export function ServicesTab({ communityId, communityName, readOnly = false }: Props) {
  const { api } = useAuth()
  const { t, lang } = useI18n()
  const [catalog, setCatalog] = React.useState<Catalog | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [domainFilter, setDomainFilter] = React.useState<string>('')
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [history, setHistory] = React.useState<HistoryRow[] | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [showScale, setShowScale] = React.useState(false)
  const [view, setView] = React.useState<'table' | 'report'>('table')
  // Same switch (and remembered choice) as the dashboard.
  const [showMissing, setShowMissingState] = React.useState<boolean>(() => {
    try { return localStorage.getItem('svcdash.showMissing') !== '0' } catch { return true }
  })
  const setShowMissing = (v: boolean) => {
    setShowMissingState(v)
    try { localStorage.setItem('svcdash.showMissing', v ? '1' : '0') } catch { /* ignore */ }
  }

  const load = React.useCallback(async () => {
    if (!communityId) return
    setLoading(true)
    setError(null)
    try {
      setCatalog(await api.get<Catalog>(`/communities/${communityId}/services?lang=${lang}`))
    } catch (err: any) {
      setError(err?.message || t('services.errorLoad', 'Failed to load services'))
    } finally {
      setLoading(false)
    }
  }, [api, communityId, t, lang])

  React.useEffect(() => {
    load()
  }, [load])

  const scaleLabel = React.useCallback(
    (level: number | null) => catalog?.scale.find((s) => s.level === level)?.label ?? '',
    [catalog],
  )
  const statusLabel = (code?: string | null) => catalog?.workStatuses.find((s) => s.code === code)?.label ?? ''
  const priorityLabel = (code?: string | null) => catalog?.priorities.find((p) => p.code === code)?.label ?? ''

  const statuses = catalog?.statuses ?? []
  const statusOf = (code?: string | null) => statuses.find((s) => s.code === code)
  const isMissing = (it: ServiceItem) => statusOf(it.status)?.tone === 'grey'
  // What the dashboard shows as satisfaction (an Indisponibil service has none).
  const sat = (it: ServiceItem) => (it.satisfaction !== undefined ? it.satisfaction : it.level)
  const items = catalog?.items ?? []
  const domains = React.useMemo(() => Array.from(new Set(items.map((i) => i.domain))), [items])
  const visible = (domainFilter ? items.filter((i) => i.domain === domainFilter) : items).filter((i) => showMissing || !isMissing(i))
  const groups = React.useMemo(() => {
    const out: Array<{ domain: string; rows: ServiceItem[] }> = []
    for (const it of visible) {
      const g = out.find((x) => x.domain === it.domain)
      if (g) g.rows.push(it)
      else out.push({ domain: it.domain, rows: [it] })
    }
    return out
  }, [visible])

  const assessed = items.filter((i) => sat(i) != null)
  const countByLevel = (lvl: number | null) => items.filter((i) => (sat(i) ?? null) === lvl).length
  const missingCount = items.filter(isMissing).length
  const since = catalog?.trendSince ?? ''
  const criticalCount = items.filter((i) => i.priority === 'CRITICAL').length

  const toggleOpen = async (item: ServiceItem) => {
    if (openId === item.id) {
      setOpenId(null)
      return
    }
    setOpenId(item.id)
    setDraft({
      level: item.level,
      comment: item.comment ?? '',
      actions: item.actions ?? '',
      workStatus: item.workStatus ?? '',
      priority: item.priority ?? '',
      status: item.status ?? '',
    })
    setHistory(null)
    try {
      setHistory(await api.get<HistoryRow[]>(`/communities/${communityId}/services/${item.id}/history`))
    } catch {
      setHistory([])
    }
  }

  const save = async (item: ServiceItem) => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/communities/${communityId}/services/${item.id}/assessments`, {
        level: draft.level,
        comment: draft.comment,
        actions: draft.actions,
        workStatus: draft.workStatus || null,
        priority: draft.priority || null,
        status: draft.status || null,
      })
      setOpenId(null)
      await load()
    } catch (err: any) {
      setError(err?.message || t('services.errorSave', 'Failed to save the evaluation'))
    } finally {
      setSaving(false)
    }
  }

  const levelText = (level: number | null) =>
    level === null ? t('services.na', 'N/A') : `${level} – ${scaleLabel(level)}`

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>{t('services.title', 'Service catalog & evaluation')}</h3>
            <div className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: 720 }}>
              {t('services.subtitle', 'Current condition of the building’s common services and infrastructure. The level reflects today’s situation; contracted or planned work does not raise it until it is in service.')}
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className={view === 'table' ? 'btn small' : 'btn ghost small'} type="button" onClick={() => setView('table')}>
              {t('services.view.table', 'Table')}
            </button>
            <button className={view === 'report' ? 'btn small' : 'btn ghost small'} type="button" onClick={() => setView('report')}>
              {t('services.view.report', 'Report')}
            </button>
            {view === 'report' ? (
              <button className="btn small" type="button" onClick={() => window.print()} disabled={!catalog}>
                {t('services.savePdf', 'Save PDF')}
              </button>
            ) : (
              <button className="btn ghost small" type="button" onClick={() => setShowScale((v) => !v)}>
                {showScale ? t('services.hideScale', 'Hide scale') : t('services.showScale', 'Evaluation scale')}
              </button>
            )}
          </div>
        </div>
        {view === 'report' && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            {t('services.savePdfHint', 'In the print dialog choose “Save as PDF” as the destination.')}
          </div>
        )}

        {catalog && items.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {catalog.aggregates && (
              <span className="pill-tight" style={{ minWidth: 220 }}>
                <AggregateRow name={t('services.average', 'Average level')} agg={catalog.aggregates.overall} statuses={statuses} since={since} />
              </span>
            )}
            <span className="pill-tight">
              {t('services.assessedCount', { done: assessed.length, total: items.length })}
            </span>
            {LEVELS.map((lvl) => (
              <span key={lvl} className={levelTone(lvl)} title={scaleLabel(lvl)}>
                {lvl}: {countByLevel(lvl)}
              </span>
            ))}
            <span className="badge" title={scaleLabel(null)}>
              {t('services.na', 'N/A')}: {countByLevel(null)}
            </span>
            {criticalCount > 0 && (
              <span className="badge negative">
                {t('services.criticalCount', { count: criticalCount })}
              </span>
            )}
          </div>
        )}
        {catalog && statuses.length > 0 && (
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', fontSize: 12, marginTop: 10, alignItems: 'center' }}>
            {statuses.map((s) => (
              <span key={s.code} className="row" style={{ gap: 6, alignItems: 'center' }} title={`${s.label} (${s.value}): ${s.definition}`}>
                <Dot status={s} />{s.label} <strong>{items.filter((i) => i.status === s.code).length}</strong>
              </span>
            ))}
            <label className="row" style={{ gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
              <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />
              {t('svcdash.showMissing', { n: missingCount })}
            </label>
          </div>
        )}

        {view === 'table' && showScale && catalog && (
          <table className="table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>{t('services.col.level', 'Level')}</th>
                <th style={{ width: 200 }}>{t('services.col.name', 'Name')}</th>
                <th>{t('services.col.definition', 'Definition')}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.scale.map((s) => (
                <tr key={String(s.level)}>
                  <td><span className={levelTone(s.level)}>{s.level === null ? t('services.na', 'N/A') : s.level}</span></td>
                  <td><strong>{s.label}</strong></td>
                  <td className="muted">{s.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}

      {view === 'report' && catalog && (
        <>
          <ServicesReport catalog={catalog} communityName={communityName} />
          {createPortal(
            <div className="services-print-root" style={{ display: 'none' }}>
              <ServicesReport catalog={catalog} communityName={communityName} />
            </div>,
            document.body,
          )}
        </>
      )}

      {view === 'table' && (
      <div className="card">
        {domains.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button"
              className={domainFilter ? 'btn ghost small' : 'btn small'}
              onClick={() => setDomainFilter('')}
            >
              {t('services.allDomains', 'All')}
            </button>
            {domains.map((d) => (
              <button
                key={d}
                type="button"
                className={domainFilter === d ? 'btn small' : 'btn ghost small'}
                onClick={() => setDomainFilter(d)}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {loading && !catalog ? (
          <div className="muted">{t('services.loading', 'Loading…')}</div>
        ) : items.length === 0 ? (
          <div className="empty">{t('services.empty', 'No services in the catalog yet.')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>{t('services.col.service', 'Service')}</th>
                  <th style={{ minWidth: 120 }}>{t('svcdash.status', 'Stare')}</th>
                  <th style={{ minWidth: 150 }}>{t('services.col.level', 'Level')}</th>
                  <th>{t('services.col.workStatus', 'Work status')}</th>
                  <th>{t('services.col.priority', 'Priority')}</th>
                  <th style={{ minWidth: 260 }}>{t('services.col.comment', 'Situation / comment')}</th>
                  <th style={{ minWidth: 220 }}>{t('services.col.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <React.Fragment key={g.domain}>
                    <tr>
                      <td colSpan={7} style={{ background: 'var(--accent-soft)', fontSize: 13 }}>
                        <div style={{ maxWidth: 360 }}>
                          <AggregateRow name={`${g.domain} (${items.filter((i) => i.domain === g.domain && !isMissing(i)).length})`} agg={catalog?.aggregates?.domains.find((d) => d.domain === g.domain)} statuses={statuses} since={since} />
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((item) => (
                      <React.Fragment key={item.id}>
                        <tr onClick={() => toggleOpen(item)} style={{ cursor: 'pointer', verticalAlign: 'top' }}>
                          <td style={isMissing(item) ? { color: TONE.grey } : undefined}>
                            <strong style={item.providedBy ? { fontStyle: 'italic' } : undefined}>{item.name}</strong>
                            {item.providedBy && (() => {
                              const p = catalog?.providers?.find((x) => x.code === item.providedBy)
                              return p ? <sup title={`${p.label}: ${p.note}`} aria-label={`${p.label}: ${p.note}`} style={{ marginLeft: 2, cursor: 'help' }}>*</sup> : null
                            })()}
                            {item.tier && (
                              <div className="muted" style={{ fontSize: 11, marginTop: 2 }} title={catalog?.tiers?.find((x) => x.code === item.tier)?.definition}>
                                {catalog?.tiers?.find((x) => x.code === item.tier)?.label ?? item.tier}
                              </div>
                            )}
                            {item.assessedAt && (
                              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                {t('services.assessedOn', 'Assessed')} {new Date(item.assessedAt).toLocaleDateString()}
                              </div>
                            )}
                          </td>
                          <td>
                            {statusOf(item.status)
                              ? <span className="row" style={{ gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><Dot status={statusOf(item.status)} />{statusOf(item.status)!.label}</span>
                              : <span className="muted">—</span>}
                          </td>
                          <td>
                            <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                              <TrendMark trend={item.trend} since={since} />
                              <span className={levelTone(sat(item) ?? null)}>{isMissing(item) ? t('services.notEvaluated', 'nu se evaluează') : levelText(sat(item) ?? null)}</span>
                            </span>
                          </td>
                          <td>{item.workStatus ? <span className="badge">{statusLabel(item.workStatus)}</span> : <span className="muted">—</span>}</td>
                          <td>{item.priority ? <span className={priorityTone(item.priority)}>{priorityLabel(item.priority)}</span> : <span className="muted">—</span>}</td>
                          <td style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{item.comment || <span className="muted">—</span>}</td>
                          <td style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{item.actions || <span className="muted">—</span>}</td>
                        </tr>
                        {openId === item.id && draft && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--bg)' }}>
                              <div className="stack" style={{ gap: 12, padding: '4px 0' }}>
                                <div>
                                  <label className="label">{t('svcdash.status', 'Stare')}</label>
                                  <select className="input" disabled={readOnly} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                                    <option value="">{t('svcdash.unset', 'Stare nesetată')}</option>
                                    {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                                  </select>
                                  {statusOf(draft.status) && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{statusOf(draft.status)!.definition}</div>}
                                </div>
                                <div>
                                  <label className="label">{t('services.levelFor', { name: item.name })}</label>
                                  {statusOf(draft.status)?.code === 'UNAVAILABLE' && (
                                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('services.unavailableNoLevel', 'Serviciul este Indisponibil: nu are evaluare; nivelul se salvează gol.')}</div>
                                  )}
                                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', opacity: statusOf(draft.status)?.code === 'UNAVAILABLE' ? 0.4 : 1 }}>
                                    {[...LEVELS, null].map((lvl) => {
                                      const selected = draft.level === lvl
                                      const def = lvl === null ? scaleLabel(null) : item.levelDefs?.[String(lvl)] || scaleLabel(lvl)
                                      return (
                                        <button
                                          key={String(lvl)}
                                          type="button"
                                          disabled={readOnly || statusOf(draft.status)?.code === 'UNAVAILABLE'}
                                          onClick={() => setDraft({ ...draft, level: lvl })}
                                          className="card"
                                          style={{
                                            padding: '8px 10px',
                                            width: 150,
                                            textAlign: 'left',
                                            cursor: readOnly ? 'default' : 'pointer',
                                            border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
                                            background: selected ? 'var(--accent-soft)' : 'var(--panel)',
                                          }}
                                        >
                                          <span className={levelTone(lvl)}>{lvl === null ? t('services.na', 'N/A') : lvl}</span>
                                          <div style={{ fontSize: 12, marginTop: 6 }}>{def}</div>
                                        </button>
                                      )
                                    })}
                                  </div>
                                </div>

                                <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                                  <div>
                                    <label className="label">{t('services.col.workStatus', 'Work status')}</label>
                                    <select
                                      className="input"
                                      disabled={readOnly}
                                      value={draft.workStatus}
                                      onChange={(e) => setDraft({ ...draft, workStatus: e.target.value })}
                                    >
                                      <option value="">—</option>
                                      {catalog?.workStatuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="label">{t('services.col.priority', 'Priority')}</label>
                                    <select
                                      className="input"
                                      disabled={readOnly}
                                      value={draft.priority}
                                      onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                                    >
                                      <option value="">—</option>
                                      {catalog?.priorities.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                                    </select>
                                  </div>
                                </div>

                                <div>
                                  <label className="label">{t('services.col.comment', 'Situation / comment')}</label>
                                  <textarea
                                    className="input"
                                    style={{ minHeight: 70 }}
                                    readOnly={readOnly}
                                    value={draft.comment}
                                    onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="label">{t('services.col.actions', 'Actions')}</label>
                                  <textarea
                                    className="input"
                                    style={{ minHeight: 70 }}
                                    readOnly={readOnly}
                                    value={draft.actions}
                                    onChange={(e) => setDraft({ ...draft, actions: e.target.value })}
                                  />
                                </div>

                                <div className="row" style={{ gap: 8 }}>
                                  {!readOnly && (
                                    <button className="btn" type="button" disabled={saving} onClick={() => save(item)}>
                                      {saving ? t('services.saving', 'Saving…') : t('services.save', 'Save evaluation')}
                                    </button>
                                  )}
                                  <button className="btn ghost" type="button" onClick={() => setOpenId(null)}>
                                    {t('services.close', 'Close')}
                                  </button>
                                </div>

                                <ServiceEquipmentPanel communityId={communityId} serviceId={item.id} readOnly={readOnly} />

                                <div>
                                  <label className="label">{t('services.history', 'Evaluation history')}</label>
                                  {history === null ? (
                                    <div className="muted">{t('services.loading', 'Loading…')}</div>
                                  ) : history.length === 0 ? (
                                    <div className="muted">{t('services.noHistory', 'No previous evaluations.')}</div>
                                  ) : (
                                    <div className="stack" style={{ gap: 6 }}>
                                      {history.map((h) => (
                                        <div key={h.id} className="row" style={{ gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                                          <span className="muted">{new Date(h.createdAt).toLocaleDateString()}</span>
                                          {statusOf(h.status) && <span className="row" style={{ gap: 4, alignItems: 'center' }}><Dot status={statusOf(h.status)} />{statusOf(h.status)!.label}</span>}
                                          <span className={levelTone(h.level)}>{levelText(h.level)}</span>
                                          {h.workStatus && <span className="badge">{statusLabel(h.workStatus)}</span>}
                                          {h.priority && <span className={priorityTone(h.priority)}>{priorityLabel(h.priority)}</span>}
                                          <span className="muted">
                                            {h.assessedBy?.name || h.assessedBy?.email || t('services.noAssessor', 'no user (import / script)')}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      )}

      {view === 'table' && (
      <div className="muted" style={{ fontSize: 12 }}>
        {t('services.note', 'The quality level is kept separate from the work status and the priority: a service can be at level 0 today while already contracted for remediation.')}
      </div>
      )}
    </div>
  )
}
