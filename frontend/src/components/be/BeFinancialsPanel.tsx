import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { BeAllocationDetailTable } from './BeAllocationDetailTable'
export function BeFinancialsPanel({ beId, periodCode }: { beId: string; periodCode: string }) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [aggMembers, setAggMembers] = React.useState<any[] | null>(null)
  const [aggSplits, setAggSplits] = React.useState<any[] | null>(null)
  const [activeTab, setActiveTab] = React.useState<'UNIT' | 'SPLIT'>('UNIT')
  const [drillRows, setDrillRows] = React.useState<any[] | null>(null)
  const [drillMeta, setDrillMeta] = React.useState<{ unitName?: string; splitGroupName?: string } | null>(null)
  const [drillKey, setDrillKey] = React.useState<string | null>(null)
  const [detailLines, setDetailLines] = React.useState<any[] | null>(null)
  const [detailTitle, setDetailTitle] = React.useState<string | null>(null)
  const [detailKey, setDetailKey] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const lastKey = React.useRef<string | null>(null)
  const [beInfo, setBeInfo] = React.useState<{ code?: string; name?: string } | null>(null)
  const [periodInfo, setPeriodInfo] = React.useState<{ code?: string } | null>(null)
  const [communityId, setCommunityId] = React.useState<string | null>(null)

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
        if (memberAgg?.be?.communityId) setCommunityId(memberAgg.be.communityId)
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
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        {/*<div className="stack" style={{ gap: 2 }}>
          <div style={{ fontWeight: 600 }}>
            {t('billing.beLabel') || 'Member'} · {beInfo?.code || beId} {beInfo?.name ? `(${beInfo.name})` : ''}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{periodInfo?.code || periodCode}</div>
        </div>*/}
        {loading && <div className="spinner" aria-label="loading" />}
      </div>
      {message && <div className="badge negative">{message}</div>}
      <div className="card soft" style={{ padding: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {/*<h4 style={{ margin: 0 }}>{t('be.financials') || 'Financials'}</h4>*/}
          <div className="row" style={{ gap: 6 }}>
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
            {/*<div className="badge" style={{ marginTop: 6 }}>{aggMembers?.length || 0}</div>*/}
            {!aggMembers || aggMembers.length === 0 ? (
              <div className="empty">{t('be.noData') || 'No data'}</div>
            ) : (
              <table className="table" style={{ fontSize: 12 }}>
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
                                setDetailLines(null)
                                setDetailTitle(null)
                                setDetailKey(null)
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
                                    if (res?.rows?.length === 1 && res.rows[0].splitGroupId) {
                                      const only = res.rows[0]
                                      const key = `UNIT:${r.unitId}:${only.splitGroupId}`
                                      setDetailLines(null)
                                      setDetailTitle(`${label} · ${only.splitGroupName || only.splitGroupCode || ''}`)
                                      setDetailKey(key)
                                      api
                                        .get<any>(
                                          `/communities/be/${beId}/periods/${periodCode}/allocations/drill/detail/${r.unitId}/${only.splitGroupId}`,
                                        )
                                        .then((res2) => setDetailLines(res2?.rows || []))
                                        .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
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
                            <td colSpan={2} style={{ padding: '4px 6px 6px' }}>
                              {drillRows.length === 0 ? (
                                <div className="empty">{t('be.noData') || 'No data'}</div>
                              ) : drillRows.length === 1 ? (
                                <>
                                  {detailLines && detailTitle && detailKey === `UNIT:${r.unitId}:${drillRows[0].splitGroupId}` ? (
                                    <BeAllocationDetailTable title={detailTitle} lines={detailLines} />
                                  ) : (
                                    <div className="muted" style={{ fontSize: 11 }}>
                                      {t('common.loading') || 'Loading...'}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <table className="table muted" style={{ margin: 0, fontSize: 12 }}>
                                  <tbody>
                                    {drillRows.map((dr: any, idx: number) => (
                                      <React.Fragment key={dr.splitGroupId || idx}>
                                        <tr
                                          onClick={() => {
                                            if (!dr.splitGroupId) return
                                            setDetailLines(null)
                                            setDetailTitle(`${label} · ${dr.splitGroupName || dr.splitGroupCode || ''}`)
                                            setDetailKey(`UNIT:${r.unitId}:${dr.splitGroupId}`)
                                            api
                                              .get<any>(
                                                `/communities/be/${beId}/periods/${periodCode}/allocations/drill/detail/${r.unitId}/${dr.splitGroupId}`,
                                              )
                                              .then((res) => setDetailLines(res?.rows || []))
                                              .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
                                          }}
                                          style={{ cursor: 'pointer' }}
                                        >
                                          <td>{dr.splitGroupName || dr.splitGroupCode || '—'}</td>
                                          <td style={{ textAlign: 'right' }}>{Number(dr.amount || 0).toFixed(2)}</td>
                                        </tr>
                                        {detailLines && detailTitle && detailKey === `UNIT:${r.unitId}:${dr.splitGroupId}` && (
                                          <tr>
                                            <td colSpan={2}>
                                              <BeAllocationDetailTable title={detailTitle} lines={detailLines} />
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
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
            {/*<div className="badge" style={{ marginTop: 6 }}>{aggSplits?.length || 0}</div>*/}
            {!aggSplits || aggSplits.length === 0 ? (
              <div className="empty">{t('be.noData') || 'No data'}</div>
            ) : (
              <table className="table" style={{ fontSize: 12 }}>
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
                                setDetailLines(null)
                                setDetailTitle(null)
                                setDetailKey(null)
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
                                    if (res?.rows?.length === 1 && res.rows[0].unitId) {
                                      const only = res.rows[0]
                                      const key = `SPLIT:${r.splitGroupId}:${only.unitId}`
                                      setDetailLines(null)
                                      setDetailTitle(`${label} · ${only.unitName || only.unitCode || ''}`)
                                      setDetailKey(key)
                                      api
                                        .get<any>(
                                          `/communities/be/${beId}/periods/${periodCode}/allocations/drill/detail/${only.unitId}/${r.splitGroupId}`,
                                        )
                                        .then((res2) => setDetailLines(res2?.rows || []))
                                        .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
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
                            <td colSpan={2} style={{ padding: '4px 6px 6px' }}>
                              {drillRows.length === 0 ? (
                                <div className="empty">{t('be.noData') || 'No data'}</div>
                              ) : drillRows.length === 1 ? (
                                <>
                                  {detailLines && detailTitle && detailKey === `SPLIT:${r.splitGroupId}:${drillRows[0].unitId}` ? (
                                    <BeAllocationDetailTable title={detailTitle} lines={detailLines} />
                                  ) : (
                                    <div className="muted" style={{ fontSize: 11 }}>
                                      {t('common.loading') || 'Loading...'}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <table className="table muted" style={{ margin: 0, fontSize: 12 }}>
                                  <tbody>
                                    {drillRows.map((dr: any, idx: number) => (
                                      <React.Fragment key={dr.unitId || idx}>
                                        <tr
                                          onClick={() => {
                                            if (!dr.unitId) return
                                            setDetailLines(null)
                                            setDetailTitle(`${label} · ${dr.unitName || dr.unitCode || ''}`)
                                            setDetailKey(`SPLIT:${r.splitGroupId}:${dr.unitId}`)
                                            api
                                              .get<any>(
                                                `/communities/be/${beId}/periods/${periodCode}/allocations/drill/detail/${dr.unitId}/${r.splitGroupId}`,
                                              )
                                              .then((res) => setDetailLines(res?.rows || []))
                                              .catch((err: any) => setMessage(err?.message || 'Could not load drill'))
                                          }}
                                          style={{ cursor: 'pointer' }}
                                        >
                                          <td>{dr.unitName || dr.unitCode || '—'}</td>
                                          <td style={{ textAlign: 'right' }}>{Number(dr.amount || 0).toFixed(2)}</td>
                                        </tr>
                                        {detailLines && detailTitle && detailKey === `SPLIT:${r.splitGroupId}:${dr.unitId}` && (
                                          <tr>
                                            <td colSpan={2}>
                                              <BeAllocationDetailTable title={detailTitle} lines={detailLines} />
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
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
