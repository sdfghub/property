import React from 'react'
import { useI18n } from '../i18n/useI18n'

type Fund = {
  code: string
  name?: string
  description?: string
  status?: string
  currency?: string
  totalTarget?: number
  startPeriodCode?: string
  targetPlan?: { periodCount: number; perPeriodAmount: number }
  targets?: Array<{ offset: number; amount: number }>
  defaultBucket?: string
  allocation?: any
}

export function FundDetails({ fund }: { fund: Fund }) {
  const { t } = useI18n()
  const {
    code,
    name,
    description,
    status,
    currency,
    totalTarget,
    startPeriodCode,
    targetPlan,
    targets = [],
    defaultBucket,
    allocation,
  } = fund

  const allEqual =
    targets.length > 0 &&
    targets.every((t) => t.amount === targets[0].amount)

  const [targetsCollapsed, setTargetsCollapsed] = React.useState(true)

  const planSummary =
    targetPlan && targetPlan.periodCount && targetPlan.perPeriodAmount
      ? `${targetPlan.periodCount} × ${targetPlan.perPeriodAmount} ${currency ?? 'RON'}`
      : null

  return (
    <div className="card soft">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          {/*<div className="muted">{t('funds.label')}</div>*/}
          <h3>
            {name || code}
          </h3>
          {description && <p className="muted">{description}</p>}
        </div>
        {status && <div className="pill">{t(`funds.status.${status}` as any, status)}</div>}
      </div>

      <ul className="muted" style={{ marginTop: 8 }}>
        <li>
          {t('funds.target')} {totalTarget ?? t('common.unnamed')} {currency ?? 'RON'}
        </li>
        {startPeriodCode && <li>{t('funds.start')}: {startPeriodCode}</li>}
        {planSummary && <li>{t('funds.plan')}: {planSummary}</li>}
        {targets.length > 0 && !planSummary && !allEqual && (
          <li>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span>{t('funds.targets')}:</span>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setTargetsCollapsed((v) => !v)}
                style={{ padding: '4px 8px' }}
              >
                {targetsCollapsed ? t('funds.targets.show', 'Show') : t('funds.targets.hide', 'Hide')}
              </button>
            </div>
            {!targetsCollapsed && (
              <ul style={{ marginTop: 4 }}>
                {targets.map((tgt, idx) => (
                  <li key={`${code}-tgt-${idx}`}>
                    {t('funds.offset')} {idx + 1} ({tgt.offset}): {tgt.amount} {currency ?? 'RON'}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {defaultBucket && <li>{t('funds.bucket')}: {defaultBucket}</li>}
        {allocation && allocation.method && <li>{t('funds.allocation')}: {t(`alloc.${allocation.method}` as any, allocation.method)}</li>}
      </ul>
    </div>
  )
}
