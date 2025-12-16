import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
export function BeFinancialsPanel({ beId, periodCode }: { beId: string; periodCode: string }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [aggMembers, setAggMembers] = React.useState<any[] | null>(null)
  const [aggSplits, setAggSplits] = React.useState<any[] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'UNIT' | 'SPLIT'>('UNIT')
  const [drillRows, setDrillRows] = React.useState<any[] | null>(null)
  const [drillMeta, setDrillMeta] = React.useState<{ unitName?: string; splitGroupName?: string } | null>(null)
  const [drillKey, setDrillKey] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const lastKey = React.useRef<string | null>(null)
  const [beInfo, setBeInfo] = React.useState<{ code?: string; name?: string } | null>(null)
  const [periodInfo, setPeriodInfo] = React.useState<{ code?: string } | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      const key = `${beId}|${periodCode}`
      if (lastKey.current === key) return
      if (!beId || !periodCode) return
      setLoading(true)
      setMessage(null)
      try {
        const [memberAgg, splitAgg] = await Promise.all([
          api.get<any>(`/communities/be/${beId}/periods/${periodCode}/allocations/aggregate?groupBy=MEMBER`).catch(() => null),
          api.get<any>(`/communities/be/${beId}/periods/${periodCode}/allocations/aggregate?groupBy=SPLIT_GROUP`).catch(() => null),
        ])
        if (!mounted) return
        lastKey.current = key
        setAggMembers(memberAgg?.rows || null)
        setAggSplits(splitAgg?.rows || null)
        if (memberAgg?.be) setBeInfo({ code: memberAgg.be.code, name: memberAgg.be.name })
        if (memberAgg?.period) setPeriodInfo({ code: memberAgg.period.code })
      } catch (err: any) {
        if (mounted) {
          setMessage(err?.message || 'Could not load allocations')
          // allow reattempt
          lastKey.current = null
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [api, beId, periodCode])

  if (!beId || !periodCode) return null

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>
          a{t('billing.beLabel') || 'Member'} · {beInfo?.code || beId} {beInfo?.name ? `(${beInfo.name})` : ''} ·{' '}
          {periodInfo?.code || periodCode}
        </h4>
        {loading && <div className="spinner" aria-label="loading" />}
      </div>
        {message && <div className="badge negative">{message}</div>}
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>{t('be.financials') || 'Financials'}</h4>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={`btn small ${activeTab === 'UNIT' ? 'primary' : 'ghost'}`}
              type="button"
              onClick={() => setActiveTab('UNIT')}
            >
              {t('be.aggregateMembers') || 'By member'}
            </button>
            <button
              className={`btn small ${activeTab === 'SPLIT' ? 'primary' : 'ghost'}`}
              type="button"
              onClick={() => setActiveTab('SPLIT')}
            >
              {t('be.aggregateSplits') || 'By split group'}
            </button>
          </div>
        </div>

        {activeTab === 'UNIT' && (
          <>
            <div className="badge" style={{ marginTop: 6 }}>{aggMembers?.length || 0}</div>
            {!aggMembers || aggMembers.length === 0 ? (
              <div className="empty">{t('be.noData') || 'No data'}</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                <th>{t('be.unit') || 'Unit'}</th>
                <th style={{ textAlign: 'right' }}>{t('be.amount') || 'Amount'}</th>
              </tr>
            </thead>
            <tbody>
              {aggMembers.map((r: any) => {
                const label = r.unitName || r.unitCode
                const isOpen = drillKey === `UNIT:${r.unitId}`
                return (
                  <React.Fragment key={r.unitId}>
                    <tr>
                      <td>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => {
                            setDrillRows(null)
                            setDrillMeta({ unitName: label })
                            setDrillKey(isOpen ? null : `UNIT:${r.unitId}`)
                            if (isOpen) return
                            api
                              .get<any>(
                                `/communities/be/${beId}/periods/${periodCode}/allocations/drill/member/${r.unitId}`,
                              )
                              .then((res) => {
                                setDrillRows(res?.rows || [])
                                if (res?.unit) setDrillMeta({ unitName: res.unit.name || res.unit.code })
                              })
                              .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
                          }}
                        >
                          {label}
                        </button>
                      </td>
                      <td style={{ textAlign: 'right' }}>{Number(r.amount).toFixed(2)}</td>
                    </tr>
                    {isOpen && drillRows && (
                      <tr>
                        <td colSpan={2}>
                          {drillRows.length === 0 ? (
                            <div className="empty">{t('be.noData') || 'No data'}</div>
                          ) : (
                            <table className="table muted" style={{ margin: 0 }}>
                              <thead>
                                <tr>
                                  <th>{t('be.splitGroup') || 'Split group'}</th>
                                  <th style={{ textAlign: 'right' }}>{t('be.amount') || 'Amount'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drillRows.map((dr: any, idx: number) => (
                                  <tr key={dr.splitGroupId || idx}>
                                    <td>{dr.splitGroupName || dr.splitGroupCode || '—'}</td>
                                    <td style={{ textAlign: 'right' }}>{Number(dr.amount || 0).toFixed(2)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
            )}
          </>
        )}

        {activeTab === 'SPLIT' && (
          <>
            <div className="badge" style={{ marginTop: 6 }}>{aggSplits?.length || 0}</div>
            {!aggSplits || aggSplits.length === 0 ? (
              <div className="empty">{t('be.noData') || 'No data'}</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('be.splitGroup') || 'Split group'}</th>
                    <th style={{ textAlign: 'right' }}>{t('be.amount') || 'Amount'}</th>
                  </tr>
                </thead>
                <tbody>
                  {aggSplits.map((r: any) => {
                    const label = r.splitGroupName || r.splitGroupCode
                    const isOpen = drillKey === `SPLIT:${r.splitGroupId}`
                    return (
                      <React.Fragment key={r.splitGroupId}>
                        <tr>
                          <td>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => {
                                setDrillRows(null)
                                setDrillMeta({ splitGroupName: label })
                                setDrillKey(isOpen ? null : `SPLIT:${r.splitGroupId}`)
                                if (isOpen) return
                                api
                                  .get<any>(
                                    `/communities/be/${beId}/periods/${periodCode}/allocations/drill/split-group/${r.splitGroupId}`,
                                  )
                                  .then((res) => {
                                    setDrillRows(res?.rows || [])
                                    if (res?.splitGroup?.name || res?.splitGroup?.code) {
                                      setDrillMeta({ splitGroupName: res.splitGroup.name || res.splitGroup.code })
                                    }
                                  })
                                  .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
                              }}
                            >
                              {label}
                            </button>
                          </td>
                          <td style={{ textAlign: 'right' }}>{Number(r.amount).toFixed(2)}</td>
                        </tr>
                        {isOpen && drillRows && (
                          <tr>
                            <td colSpan={2}>
                              {drillRows.length === 0 ? (
                                <div className="empty">{t('be.noData') || 'No data'}</div>
                              ) : (
                                <table className="table muted" style={{ margin: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>{t('be.unit') || 'Unit'}</th>
                                      <th style={{ textAlign: 'right' }}>{t('be.amount') || 'Amount'}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {drillRows.map((dr: any, idx: number) => (
                                      <tr key={dr.unitId || idx}>
                                        <td>{dr.unitName || dr.unitCode || '—'}</td>
                                        <td style={{ textAlign: 'right' }}>{Number(dr.amount || 0).toFixed(2)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* Inline drills are rendered directly below rows */}
    </div>
  )
}
