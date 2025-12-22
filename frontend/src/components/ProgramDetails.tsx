import React from 'react'
import { useI18n } from '../i18n/useI18n'

type Program = {
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

export function ProgramDetails({ program }: { program: Program }) {
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
  } = program

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
          {/*<div className="muted">{t('programs.label')}</div>*/}
          <h3>
            {name || code}
          </h3>
          {description && <p className="muted">{description}</p>}
        </div>
        {status && <div className="pill">{t(`programs.status.${status}` as any, status)}</div>}
      </div>

      <ul className="muted" style={{ marginTop: 8 }}>
        <li>
          {t('programs.target')} {totalTarget ?? t('common.unnamed')} {currency ?? 'RON'}
        </li>
        {startPeriodCode && <li>{t('programs.start')}: {startPeriodCode}</li>}
        {planSummary && <li>{t('programs.plan')}: {planSummary}</li>}
        {targets.length > 0 && !planSummary && !allEqual && (
          <li>
            <div className="row" style={{ alignItems: 'center', gap: 8 }}>
              <span>{t('programs.targets')}:</span>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setTargetsCollapsed((v) => !v)}
                style={{ padding: '4px 8px' }}
              >
                {targetsCollapsed ? t('programs.targets.show', 'Show') : t('programs.targets.hide', 'Hide')}
              </button>
            </div>
            {!targetsCollapsed && (
              <ul style={{ marginTop: 4 }}>
                {targets.map((tgt, idx) => (
                  <li key={`${code}-tgt-${idx}`}>
                    {t('programs.offset')} {idx + 1} ({tgt.offset}): {tgt.amount} {currency ?? 'RON'}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )}
        {defaultBucket && <li>{t('programs.bucket')}: {defaultBucket}</li>}
        {allocation && allocation.method && <li>{t('programs.allocation')}: {t(`alloc.${allocation.method}` as any, allocation.method)}</li>}
      </ul>
    </div>
  )
}
