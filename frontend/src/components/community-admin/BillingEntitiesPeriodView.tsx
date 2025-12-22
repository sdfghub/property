import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { BeFinancialsPanel } from '../be/BeFinancialsPanel'

type Props = {
  summary: any
}

export function BillingEntitiesPeriodView({ summary }: Props) {
  const { t } = useI18n()
  const [drillBeId, setDrillBeId] = React.useState<string | null>(null)
  const [drillPeriod, setDrillPeriod] = React.useState<string | null>(null)

  if (!summary?.beBuckets?.length) return null

  const bucketKeys = Array.from(new Set(summary.beBuckets.map((b: any) => b.bucket)))
  const grouped = summary.beBuckets.reduce((map: Map<string, any[]>, row: any) => {
    const arr = map.get(row.beCode) ?? []
    arr.push(row)
    map.set(row.beCode, arr)
    return map
  }, new Map<string, any[]>())

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="card soft" style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>{t('billing.beLabel') || 'Member'}</th>
              {bucketKeys.map((b: string) => (
                <th key={b} style={{ textAlign: 'right' }}>
                  {t(b)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(grouped.entries()).map(([beCode, rows]) => {
              const beId = rows[0]?.beId || (rows[0] as any)?.beid || (rows[0] as any)?.be_id || null
              return (
                <React.Fragment key={beCode}>
                  <tr>
                    <td>{rows[0]?.beName || beCode}</td>
                    {bucketKeys.map((bucket) => {
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
  )
}
