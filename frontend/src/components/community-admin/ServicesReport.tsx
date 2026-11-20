import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { Catalog, ServiceItem } from './ServicesTab'

// Static, paper-first rendering of the service catalog (A4 portrait). ServicesTab shows it on
// screen and portals a second copy into `.services-print-root` for printing — see the
// `.services-print-root` rule in styles/index.css. Labels come from the catalog payload.

const LEVELS = [0, 1, 2, 3, 4, 5]

/** Level → CSS modifier; colours live in index.css (`.svr-l0` … `.svr-l5`, `.svr-lna`). */
export function levelClass(level: number | null): string {
  return level === null ? 'svr-lna' : `svr-l${level}`
}

type Props = {
  catalog: Catalog
  communityName?: string
}

export function ServicesReport({ catalog, communityName }: Props) {
  const { t, lang } = useI18n()
  const items = catalog.items
  // Satisfaction as the dashboard shows it: an Indisponibil service has no evaluation.
  const lv = (i: ServiceItem) => (i.satisfaction !== undefined ? i.satisfaction : i.level)
  const scaleLabel = (level: number | null) => catalog.scale.find((s) => s.level === level)?.label ?? ''
  const statusLabel = (code?: string | null) => catalog.workStatuses.find((s) => s.code === code)?.label ?? ''
  const priorityLabel = (code?: string | null) => catalog.priorities.find((p) => p.code === code)?.label ?? ''
  const fmtDate = (d: string | Date) =>
    new Date(d).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-GB', { day: '2-digit', month: 'long', year: 'numeric' })

  const groups: Array<{ domain: string; rows: ServiceItem[] }> = []
  for (const it of items) {
    const g = groups.find((x) => x.domain === it.domain)
    if (g) g.rows.push(it)
    else groups.push({ domain: it.domain, rows: [it] })
  }

  const assessed = items.filter((i) => lv(i) !== null)
  // Same satisfaction average as the dashboard (Indisponibil and unevaluated services left out).
  const average = catalog.aggregates?.overall.satisfaction ?? (assessed.length ? assessed.reduce((s, i) => s + (lv(i) ?? 0), 0) / assessed.length : null)
  const critical = items.filter((i) => i.priority === 'CRITICAL').length
  const contracted = items.filter((i) => i.workStatus === 'CONTRACTED' || i.workStatus === 'IN_EXECUTION').length
  const distribution = [...LEVELS, null].map((lvl) => ({ lvl, count: items.filter((i) => lv(i) === lvl).length }))
  const lastAssessed = items.reduce<string | null>(
    (max, i) => (i.assessedAt && (!max || i.assessedAt > max) ? i.assessedAt : max),
    null,
  )

  const LevelBadge = ({ level }: { level: number | null }) => (
    <span className={`svr-badge ${levelClass(level)}`}>
      <b>{level === null ? t('services.na', 'N/A') : level}</b>
      <span>{scaleLabel(level)}</span>
    </span>
  )

  const Meter = ({ level }: { level: number | null }) => (
    <span className="svr-meter" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={level !== null && n <= level ? levelClass(level) : ''} />
      ))}
    </span>
  )

  return (
    <div className="svr">
      {/* ── Page 1: summary + overview ── */}
      <section className="svr-page">
        <header className="svr-head">
          <div className="svr-eyebrow">{communityName || ''}</div>
          <h1>{t('services.report.title', 'Service catalog & condition assessment')}</h1>
          <div className="svr-meta">
            {t('services.report.generated', { date: fmtDate(new Date()) })}
            {lastAssessed && <> · {t('services.report.lastAssessed', { date: fmtDate(lastAssessed) })}</>}
          </div>
          <p className="svr-lead">{t('services.subtitle')}</p>
        </header>

        <div className="svr-kpis">
          <div className="svr-kpi">
            <div className="svr-kpi-label">{t('services.average', 'Average level')}</div>
            <div className="svr-kpi-value">
              {average === null ? '—' : average.toFixed(1)}
              <small> / 5</small>
            </div>
          </div>
          <div className="svr-kpi">
            <div className="svr-kpi-label">{t('services.report.assessed', 'Assessed')}</div>
            <div className="svr-kpi-value">
              {assessed.length}
              <small> / {items.length}</small>
            </div>
          </div>
          <div className="svr-kpi svr-kpi-alert">
            <div className="svr-kpi-label">{t('services.report.critical', 'Critical priority')}</div>
            <div className="svr-kpi-value">{critical}</div>
          </div>
          <div className="svr-kpi">
            <div className="svr-kpi-label">{t('services.report.inProgress', 'Contracted / in execution')}</div>
            <div className="svr-kpi-value">{contracted}</div>
          </div>
        </div>

        <div className="svr-dist">
          <div className="svr-dist-bar">
            {distribution
              .filter((d) => d.count > 0)
              .map((d) => (
                <span key={String(d.lvl)} className={levelClass(d.lvl)} style={{ flexGrow: d.count }}>
                  {d.count}
                </span>
              ))}
          </div>
          <div className="svr-legend">
            {distribution.map((d) => (
              <span key={String(d.lvl)}>
                <i className={levelClass(d.lvl)} />
                {d.lvl === null ? t('services.na', 'N/A') : d.lvl} – {scaleLabel(d.lvl)} ({d.count})
              </span>
            ))}
          </div>
        </div>

        <h2>{t('services.report.overview', 'Overview')}</h2>
        <table className="svr-table">
          <thead>
            <tr>
              <th>{t('services.col.service', 'Service')}</th>
              <th>{t('services.col.level', 'Level')}</th>
              <th>{t('services.col.workStatus', 'Work status')}</th>
              <th>{t('services.col.priority', 'Priority')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.domain}>
                <tr className="svr-domain-row">
                  <td colSpan={4}>{g.domain}</td>
                </tr>
                {g.rows.map((it) => (
                  <tr key={it.id}>
                    <td className="svr-name">{it.providedBy ? <><em>{it.name}</em><sup title={catalog.providers?.find((p) => p.code === it.providedBy)?.note}>*</sup></> : it.name}</td>
                    <td>
                      <span className="svr-level-cell">
                        <Meter level={lv(it)} />
                        <LevelBadge level={lv(it)} />
                      </span>
                    </td>
                    <td>{it.workStatus ? statusLabel(it.workStatus) : <span className="svr-dim">—</span>}</td>
                    <td>
                      {it.priority ? (
                        <span className={`svr-prio svr-prio-${it.priority.toLowerCase()}`}>{priorityLabel(it.priority)}</span>
                      ) : (
                        <span className="svr-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Detail: one card per service, with its own level definitions ── */}
      <section className="svr-page svr-break">
        <h2>{t('services.report.detail', 'Service detail')}</h2>
        {groups.map((g) => (
          <div key={g.domain} className="svr-domain">
            {g.rows.map((it, i) => {
              const card = (
              <article key={it.id} className="svr-card">
                <div className="svr-card-head">
                  <h4>{it.providedBy ? <><em>{it.name}</em><sup title={catalog.providers?.find((p) => p.code === it.providedBy)?.note}>*</sup></> : it.name}</h4>
                  <div className="svr-card-tags">
                    <LevelBadge level={lv(it)} />
                    {it.workStatus && <span className="svr-tag">{statusLabel(it.workStatus)}</span>}
                    {it.priority && (
                      <span className={`svr-prio svr-prio-${it.priority.toLowerCase()}`}>{priorityLabel(it.priority)}</span>
                    )}
                  </div>
                </div>
                <div className="svr-card-body">
                  <div>
                    <div className="svr-field">{t('services.col.comment', 'Situation / comment')}</div>
                    <p>{it.comment || '—'}</p>
                  </div>
                  <div>
                    <div className="svr-field">{t('services.col.actions', 'Actions')}</div>
                    <p>{it.actions || '—'}</p>
                  </div>
                </div>
                {it.levelDefs && (
                  <div className="svr-ladder">
                    {LEVELS.map((lvl) => (
                      <div key={lvl} className={`svr-step ${lv(it) === lvl ? `svr-current ${levelClass(lvl)}` : ''}`}>
                        <b>{lvl}</b>
                        <span>{it.levelDefs?.[String(lvl)]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              )
              return i === 0 ? (
                <div key={it.id} className="svr-keep">
                  <h3>{g.domain}</h3>
                  {card}
                </div>
              ) : (
                card
              )
            })}
          </div>
        ))}
      </section>

      {/* ── Annex: general scale ── */}
      <section className="svr-page svr-break">
        <h2>{t('services.report.scale', 'General evaluation scale')}</h2>
        <table className="svr-table svr-scale">
          <tbody>
            {catalog.scale.map((s) => (
              <tr key={String(s.level)}>
                <td>
                  <span className={`svr-badge ${levelClass(s.level)}`}>
                    <b>{s.level === null ? t('services.na', 'N/A') : s.level}</b>
                  </span>
                </td>
                <td className="svr-name">{s.label}</td>
                <td>{s.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="svr-note">{t('services.note')}</p>
      </section>
    </div>
  )
}
