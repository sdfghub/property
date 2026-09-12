import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { beLabel } from './beLabel'

const money = (n?: number | null) => (n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ro-RO') : null)

// "Fișă calcul penalizări" per unit, for the close wizard: pick a unit, see the same bucket-by-
// bucket calculation the avizier's ✎ drilldown uses (finance.explainPenalty / GET .../avizier/
// explain-penalty), laid out as one row per lună restantă instead of a modal you have to dig for.
// Reuses the existing penalty engine end to end — no calculation logic lives in this component.
export function PenaltyLedgerPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN'

  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState('')
  const [units, setUnits] = React.useState<any[]>([])
  const [fundName, setFundName] = React.useState<string | null>(null)
  const [unitsLoading, setUnitsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [beCode, setBeCode] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<any>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)

  // Default to the newest period (the one being worked on), with the option to pick an earlier one.
  React.useEffect(() => {
    api.get<any[]>(`/communities/${communityId}/periods`).then((rows: any[]) => {
      const sorted = (rows || []).slice().sort((a: any, b: any) => (b.seq ?? 0) - (a.seq ?? 0))
      setPeriods(sorted)
      setPeriod((cur) => cur || sorted[0]?.code || '')
    }).catch(() => {})
  }, [api, communityId])

  // Full debtor roster on the fund that actually carries a penalty rate today (backend defaults to
  // EXPENSES = Cheltuieli Întreținere) — every unit with a balance, not just the ones already being
  // charged a penalty this period, so you can pick any debtor and see where they stand.
  const loadUnits = React.useCallback(() => {
    if (!period) return
    setUnitsLoading(true)
    api.get<any>(`/communities/${communityId}/finance/debtors-by-fund?period=${encodeURIComponent(period)}`)
      .then((d: any) => {
        const rows = d?.debtors || []
        setUnits(rows)
        setFundName(d?.fundName ?? null)
        setUnitsLoading(false)
        setBeCode((cur) => (cur && rows.some((r: any) => r.beCode === cur) ? cur : rows[0]?.beCode || null))
      }).catch(() => { setUnits([]); setUnitsLoading(false) })
  }, [api, communityId, period])
  React.useEffect(() => { loadUnits() }, [loadUnits])

  const loadDetail = React.useCallback(() => {
    if (!period || !beCode) { setDetail(null); return }
    setDetailLoading(true)
    api.get<any>(`/communities/${communityId}/finance/avizier/explain-penalty?period=${encodeURIComponent(period)}&be=${encodeURIComponent(beCode)}`)
      .then((d: any) => { setDetail(d); setDetailLoading(false) })
      .catch(() => { setDetail({ error: true }); setDetailLoading(false) })
  }, [api, communityId, period, beCode])
  React.useEffect(() => { loadDetail() }, [loadDetail])

  const filteredUnits = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return units
    return units.filter((u) => (u.beName || '').toLowerCase().includes(q) || (u.beCode || '').toLowerCase().includes(q))
  }, [units, search])

  const periodEndDate = periods.find((p) => p.code === period)?.endDate as string | undefined
  const buckets: any[] = detail?.buckets || []
  const totals = buckets.reduce(
    (acc, b) => ({ restanta: acc.restanta + (b.principalRemaining || 0), penalizare: acc.penalizare + (b.penaltyToDate || 0) }),
    { restanta: 0, penalizare: 0 },
  )

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card ops-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h4 style={{ margin: 0 }}>
            {t('penledger.title', 'Verificare penalități')}
            {fundName ? <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>· {fundName}</span> : null}
          </h4>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {t('penledger.intro', 'Toate unitățile cu restanțe pe fondul care acumulează penalități azi — alege una ca să vezi calculul, lună de lună.')}
        </div>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ minWidth: 260, flex: '0 0 280px', padding: 10 }}>
          <input className="input" placeholder={t('penledger.search', 'Caută unitate…')} value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            <strong style={{ color: 'var(--text, inherit)' }}>{filteredUnits.length}</strong> {t('penledger.unitCount', 'unități cu restanțe')}
          </div>
          {unitsLoading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !filteredUnits.length ? (
            <div className="empty">{t('penledger.noUnits', 'Nicio unitate cu restanțe în această perioadă.')}</div>
          ) : (
            <div className="stack" style={{ gap: 2, maxHeight: 480, overflowY: 'auto' }}>
              {filteredUnits.map((u) => {
                const label = beLabel(u)
                const selected = u.beCode === beCode
                return (
                  <button key={u.beCode} type="button" onClick={() => setBeCode(u.beCode)}
                    className="btn ghost small"
                    style={{
                      justifyContent: 'space-between', textAlign: 'left', display: 'flex', gap: 8, width: '100%',
                      background: selected ? 'var(--muted-bg, #eef2ff)' : undefined,
                    }}>
                    <span>
                      {label.primary}
                      {label.secondary ? <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{label.secondary}</span> : null}
                    </span>
                    <strong style={{ color: (u.debt || 0) > 0 ? 'var(--danger,#b45309)' : 'var(--muted,#999)' }}>{money(u.debt)}</strong>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          {detailLoading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !beCode ? (
            <div className="empty">{t('penledger.pickUnit', 'Alege o unitate din listă.')}</div>
          ) : detail?.error ? (
            <div className="badge negative">{t('common.error', 'Error')}</div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: 0 }}>{detail?.beName || beCode}</h4>
                <span className="muted" style={{ fontSize: 12 }}>{detail?.periodCode}</span>
              </div>

              {detail?.override ? (
                <div className="card" style={{ background: 'var(--info-bg,#e3f2fd)', borderLeft: '3px solid var(--info,#1565c0)', padding: '8px 10px', marginTop: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>✎ {t('penreview.title', 'Penalizări — revizuire')}</div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>
                    {t('avizier.penCorrCalc', 'Calculat')}: <strong style={{ textDecoration: 'line-through' }}>{money(detail.override.computed)}</strong>
                    {' → '}{t('avizier.penCorrApproved', 'aprobat')}: <strong>{money(detail.override.approved)}</strong>
                  </div>
                </div>
              ) : null}

              {!buckets.length ? (
                <div className="empty" style={{ marginTop: 10 }}>{t('penledger.none', 'Nicio penalizare pentru această unitate.')}</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13, fontVariantNumeric: 'tabular-nums', minWidth: 620 }}>
                  <thead>
                    <tr style={{ textAlign: 'right', borderBottom: '2px solid var(--border,#ccc)' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('penledger.colMonth', 'Lună restantă')}</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('penledger.colPeriod', 'Perioadă calcul')}</th>
                      <th style={{ padding: '6px 8px' }}>{t('penledger.colDebt', 'Restanță')}</th>
                      <th style={{ padding: '6px 8px' }}>{t('penledger.colDays', 'Număr zile')}</th>
                      <th style={{ padding: '6px 8px' }}>{t('penledger.colRate', 'Procent')}</th>
                      <th style={{ padding: '6px 8px' }}>{t('penledger.colPenalty', 'Penalizări')}</th>
                      <th style={{ padding: '6px 8px' }}>{t('penledger.colTotal', 'Restanțe + penalizări')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buckets.map((b: any, i: number) => {
                      const from = fmtDate(b.firstPenalDay)
                      const to = fmtDate(periodEndDate)
                      const started = (b.totalDays || 0) > 0
                      return (
                        <tr key={i} style={{ textAlign: 'right', borderBottom: '1px solid var(--border,#eee)' }}>
                          <td style={{ textAlign: 'left', padding: '6px 8px' }}>
                            {b.label}
                            {b.capReached ? <span className="badge secondary" style={{ marginLeft: 6 }} title={t('avizier.penCapHint', 'Penalizarea a atins valoarea datoriei (plafon legal)')}>{t('avizier.penCap', 'plafonat')}</span> : null}
                          </td>
                          <td style={{ textAlign: 'left', padding: '6px 8px' }}>{started && from ? `${from} – ${to ?? '…'}` : '-'}</td>
                          <td style={{ padding: '6px 8px' }}>{money(b.principalRemaining)}</td>
                          <td style={{ padding: '6px 8px' }}>{b.totalDays}</td>
                          <td style={{ padding: '6px 8px' }}>{b.ratePerDayPct}%</td>
                          <td style={{ padding: '6px 8px', color: 'var(--danger,#b45309)' }}>{money(b.penaltyToDate)}</td>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{money((b.principalRemaining || 0) + (b.penaltyToDate || 0))}</td>
                        </tr>
                      )
                    })}
                    <tr style={{ textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--border,#ccc)' }}>
                      <td style={{ textAlign: 'left', padding: '8px 8px' }} colSpan={2}>{t('penledger.total', 'Total')}</td>
                      <td style={{ padding: '8px 8px' }}>{money(totals.restanta)}</td>
                      <td />
                      <td />
                      <td style={{ padding: '8px 8px', color: 'var(--danger,#b45309)' }}>{money(totals.penalizare)}</td>
                      <td style={{ padding: '8px 8px' }}>{money(totals.restanta + totals.penalizare)}</td>
                    </tr>
                  </tbody>
                </table>
                </div>
              )}
              {!isAdmin ? null : (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  {t('penledger.adjustHint', 'Pentru ajustări manuale, folosește fila „Penalizări” (revizuire).')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
