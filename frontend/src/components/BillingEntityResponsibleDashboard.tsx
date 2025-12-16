import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import type { PeriodRef } from '../api/types'
import { BeFinancialsPanel } from './be/BeFinancialsPanel'

export function BillingEntityResponsibleDashboard({
  beId: forcedBeId,
  periodCode: forcedPeriodCode,
}: {
  beId?: string
  periodCode?: string
}) {
  const { api, activeRole } = useAuth()
  const { t } = useI18n()
  const [periodCode, setPeriodCode] = React.useState(forcedPeriodCode || '')
  const [periods, setPeriods] = React.useState<PeriodRef[]>([])
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const lastPeriodsKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    const beId = forcedBeId || activeRole?.scopeId
    if (!beId) return
    const key = `${beId}|${forcedPeriodCode || ''}`
    if (lastPeriodsKey.current === key) return
    lastPeriodsKey.current = key
    api
      .get<PeriodRef[]>(`/communities/be/${beId}/periods`)
      .then((rows) => {
        setPeriods(rows)
        if (forcedPeriodCode) {
          setPeriodCode(forcedPeriodCode)
        } else if (rows.length) {
          setPeriodCode(rows[rows.length - 1].code)
        }
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))
  }, [api, activeRole?.scopeId, forcedBeId, forcedPeriodCode])

  const beId = forcedBeId || activeRole?.scopeId || ''
  const canRenderPanel = beId && periodCode

  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="card">
        <h3>{t('be.viewHeading')}</h3>
        <p className="muted">{t('be.viewSubtitle')}</p>

        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="label">
              <span>Period code</span>
              <span className="muted">{t('be.periodClosedOnly')}</span>
            </label>
            <select className="input" value={periodCode} onChange={(e) => setPeriodCode(e.target.value)}>
              {periods.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </div>
          <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => setPeriodCode(periodCode)} disabled={loading}>
            {loading ? t('billing.loading') : 'Load'}
          </button>
        </div>

        {message && <div className="badge negative" style={{ marginTop: 8 }}>{message}</div>}
      </div>

      {canRenderPanel ? (
        <BeFinancialsPanel key={`${beId}:${periodCode}`} beId={beId} periodCode={periodCode} />
      ) : (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('be.periodRequired')}
        </div>
      )}
    </div>
  )
}
