import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { BeFinancialsPanel } from '../be/BeFinancialsPanel'

type EditablePeriod = {
  period?: { code: string; status: string }
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canClose?: boolean
  canPrepare?: boolean
} | null

type Props = {
  editablePeriod: EditablePeriod
  onGoPeriod: () => void
  onGoMeters?: () => void
  onGoBills?: () => void
  onPrepare?: () => void
  onClose?: () => void
  busy?: 'prepare' | 'close' | 'reopen' | 'create' | null
  onRecompute?: () => void
  summary?: any | null
  summaryError?: string | null
  summaryLoading?: boolean
  lastClosed?: { code: string; closedAt?: string } | null
  onReopen?: () => void
  onCreatePeriod?: () => void
  onGoStatements?: () => void
}

export function OverviewTab({
  editablePeriod,
  onGoPeriod,
  onGoMeters,
  onGoBills,
  onPrepare,
  onClose,
  busy,
  onRecompute,
  summary,
  summaryError,
  summaryLoading,
  lastClosed,
  onReopen,
  onCreatePeriod,
  onGoStatements,
}: Props) {
  const { t } = useI18n()
  const [drillBeId, setDrillBeId] = React.useState<string | null>(null)
  const [drillPeriod, setDrillPeriod] = React.useState<string | null>(null)
  return (
    <div className="grid three">
      <div className="card soft">
        <h3>{t('card.period.title')}</h3>
        {editablePeriod?.period ? (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{editablePeriod.period.code}</h4>
              <span className="badge secondary">{editablePeriod.period.status}</span>
            </div>
            {/* <div className="muted">{t('card.period.subtitle')}</div>*/}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {onGoMeters ? (
                <button className="btn tertiary" type="button" onClick={onGoMeters}>
                  {t('card.period.metersStatus', {
                    closed: editablePeriod.meters?.closed ?? 0,
                    total: editablePeriod.meters?.total ?? 0,
                  })}
                </button>
              ) : (
                <div className="badge">
                  {t('card.period.metersStatus', {
                    closed: editablePeriod.meters?.closed ?? 0,
                    total: editablePeriod.meters?.total ?? 0,
                  })}
                </div>
              )}
              {onGoBills ? (
                <button className="btn tertiary" type="button" onClick={onGoBills}>
                  {t('card.period.billsStatus', {
                    closed: editablePeriod.bills?.closed ?? 0,
                    total: editablePeriod.bills?.total ?? 0,
                  })}
                </button>
              ) : (
                <div className="badge">
                  {t('card.period.billsStatus', {
                    closed: editablePeriod.bills?.closed ?? 0,
                    total: editablePeriod.bills?.total ?? 0,
                  })}
                </div>
              )}
              {/*!editablePeriod.canClose && (
                <div className="badge warn">
                  {t('card.period.openItems', {
                    meters: (editablePeriod.meters?.open || []).length,
                    bills: (editablePeriod.bills?.open || []).length,
                  })}
                </div>
              )*/}
            </div>
            {(editablePeriod.canClose || editablePeriod.canPrepare) && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {editablePeriod.canPrepare && onPrepare && (
                  <button className="btn primary small" type="button" onClick={onPrepare} disabled={busy === 'prepare'}>
                    {busy === 'prepare' ? t('common.loading') || 'Working…' : t('card.period.prepare') || 'Prepare period'}
                  </button>
                )}
                {editablePeriod.canClose && onClose && (
                  <button className="btn primary small" type="button" onClick={onClose} disabled={busy === 'close'}>
                    {busy === 'close' ? t('common.loading') || 'Working…' : t('card.period.close') || 'Close period'}
                  </button>
                )}
                {editablePeriod.period?.status === 'PREPARED' && onRecompute && (
                  <button className="btn secondary small" type="button" onClick={onRecompute} disabled={busy === 'prepare'}>
                    {busy === 'prepare' ? t('common.loading') || 'Working…' : t('card.period.recompute') || 'Rerun allocations'}
                  </button>
                )}
              </div>
            )}
            {summaryLoading && <div className="muted">{t('common.loading') || 'Loading…'}</div>}
            {summaryError && <div className="badge negative">{summaryError}</div>}
            {summary && (
              <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                {/*<div className="muted" style={{ fontWeight: 600 }}>{t('statements.heading')}</div>
                {summary.statements?.length ? (
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {summary.statements.map((s: any) => (
                      <div key={s.currency} className="badge tertiary">
                        {s.currency}: {Number(s.balance).toFixed(2)} (ch {Number(s.charges).toFixed(2)} / pay {Number(s.payments).toFixed(2)})
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">{t('statements.subtitle')}</div>
                )}*/}
                <div className="muted" style={{ fontWeight: 600 }}>{t('card.period.expenses')}</div>
                {summary.allocations?.length ? (
                  <div className="stack" style={{ gap: 4 }}>
                    {summary.allocations.map((row: any) => (
                      <div key={row.expense_type} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                        <span>{row.expense_type}</span>
                        <span>
                          {Number(row.allocated).toFixed(2)} / {Number(row.expected).toFixed(2)}{' '}
                          <span style={{ color: Math.abs(Number(row.delta)) < 0.01 ? '#7bd88a' : '#ffae42' }}>
                            ({Number(row.delta).toFixed(2)})
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">{t('card.period.noActive')}</div>
                )}
                {summary.beBuckets?.length ? (
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <div className="muted" style={{ fontWeight: 600 }}>{t('card.period.buckets') || 'Buckets by member'}</div>
                      {onGoStatements && (
                        <button className="btn tertiary small" type="button" onClick={onGoStatements}>
                          {t('tab.statements') || 'Statements'}
                        </button>
                      )}
                    </div>
                    <div className="card soft" style={{ overflowX: 'auto' }}>
                      <table className="table" style={{ width: '100%', fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>{t('billing.beLabel') || 'Member'}</th>
                            {Array.from(new Set(summary.beBuckets.map((b: any) => b.bucket))).map((b: string) => (
                              <th key={b} style={{ textAlign: 'right' }}>{b}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from(
                            summary.beBuckets.reduce((map: Map<string, any[]>, row: any) => {
                              const arr = map.get(row.beCode) ?? []
                              arr.push(row)
                              map.set(row.beCode, arr)
                              return map
                            }, new Map<string, any[]>()),
                          ).map(([beCode, rows]: [string, any[]]) => {
                            const beId = rows[0]?.beId || (rows[0] as any)?.beid || (rows[0] as any)?.be_id || null
                            const bucketKeys = Array.from(new Set(summary.beBuckets.map((b: any) => b.bucket)))
                            return (
                              <React.Fragment key={beCode}>
                                <tr>
                                  <td>{rows[0]?.beName || beCode}</td>
                                  {bucketKeys.map((bucket: string) => {
                                    const hit = rows.find((r: any) => r.bucket === bucket)
                                    return (
                                      <td key={`${beCode}:${bucket}`} style={{ textAlign: 'right' }}>
                                        {hit ? (
                                          bucket === 'ALLOCATED_EXPENSE' ? (
                                            <button
                                              className="btn ghost"
                                              type="button"
                                              onClick={() => {
                                                setDrillBeId(beId)
                                                setDrillPeriod(summary?.period?.code || null)
                                              }}
                                            >
                                              {Number(hit.amount).toFixed(2)}
                                            </button>
                                          ) : (
                                            Number(hit.amount).toFixed(2)
                                          )
                                        ) : (
                                          '–'
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                                {drillBeId === beId && drillPeriod === summary?.period?.code && (
                                  <tr>
                                    <td colSpan={1 + bucketKeys.length}>
                                      <BeFinancialsPanel key={`${beId}:${drillPeriod}`} beId={beId} periodCode={drillPeriod!} />
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
      </div>
        ) : (
          <p className="muted" style={{ marginTop: 6 }}>
            {t('card.period.noActive')}{' '}
            {onCreatePeriod && (
              <button
                className="btn primary small"
                type="button"
                onClick={onCreatePeriod}
                style={{ marginLeft: 6 }}
                disabled={busy === 'create'}
              >
                {busy === 'create' ? t('common.loading') || 'Working…' : t('card.period.create') || 'Create period'}
              </button>
            )}
          </p>
        )}
        {/*<div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
          <span className="muted">{t('nav.gotoPeriodHint') || 'Jump to current period work:'}</span>
          <button className="btn tertiary" type="button" onClick={onGoPeriod}>
            {t('nav.gotoPeriod') || 'Go to period'}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          {t('card.period.prevNext')}
        </div>
        */}
      </div>
      <div className="card soft">
        <div className="muted">{t('card.period.prevNext')}</div>
        {lastClosed ? (
          <div className="stack" style={{ marginTop: 6 }}>
            <div>
              <strong>{t('card.period.lastClosed') || 'Last closed period'}:</strong> {lastClosed.code}
            </div>
            {lastClosed.closedAt && (
              <div className="muted" style={{ fontSize: 12 }}>
                {t('card.period.closedAt') || 'Closed at'}: {lastClosed.closedAt}
              </div>
            )}
            {onReopen && (
              <button
                className="btn tertiary small"
                type="button"
                onClick={onReopen}
                style={{ maxWidth: '160px' }}
                disabled={busy === 'reopen'}
              >
                {busy === 'reopen' ? t('common.loading') || 'Working…' : t('card.period.reopen') || 'Reopen period'}
              </button>
            )}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 6 }}>{t('card.period.noClosed') || 'No closed periods'}</div>
        )}
      </div>
      <div className="card soft">
        <div className="muted">{t('card.financials.label')}</div>
        <h3>{t('card.financials.title')}</h3>
        <p className="muted">{t('card.financials.subtitle')}</p>
        <ul className="muted" style={{ marginTop: 8 }}>
          <li>{t('card.financials.charges')}</li>
          <li>{t('card.financials.payments')}</li>
          <li>{t('card.financials.balance')}</li>
        </ul>
      </div>
      <div className="card soft">
        <div className="muted">{t('card.quick.label')}</div>
        <h3>{t('card.quick.title')}</h3>
        <p className="muted">{t('card.quick.subtitle')}</p>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button">
            {t('card.quick.addExpense')}
          </button>
          <button className="btn secondary" type="button">
            {t('card.quick.uploadMeters')}
          </button>
          <button className="btn secondary" type="button">
            {t('card.quick.sendInvite')}
          </button>
        </div>
      </div>
    </div>
  )
}
