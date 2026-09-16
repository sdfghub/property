import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { usePeriodOptional } from '../../contexts/PeriodContext'

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`
const pct = (n: number | null | undefined) => n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`

type SortKey = 'debt' | 'pctOfTotal'

export function DebtorsPanel({ communityId, onPick }: { communityId: string; onPick?: (debtor: any) => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const shared = usePeriodOptional()
  const selectedCode = shared?.selectedCode
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  // Both columns are a positive linear function of the same underlying debt, so sorting by either
  // always yields the same row order — the point of exposing both is the direction toggle (largest/
  // smallest first), not a different ranking.
  const [sortKey, setSortKey] = React.useState<SortKey>('debt')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc') }
    else setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
  }
  const SortIcon = ({ k }: { k: SortKey }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )

  React.useEffect(() => {
    if (!communityId) return
    // Wait for the global period selector to resolve before fetching, so this doesn't briefly
    // load the "latest statement" default and then flash to the actually-selected period.
    if (shared && !selectedCode) return
    let alive = true
    setLoading(true)
    const q = selectedCode ? `?period=${encodeURIComponent(selectedCode)}` : ''
    api.get<any>(`/communities/${communityId}/finance/receivables${q}`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, selectedCode, shared])

  const sortedDebtors = React.useMemo(() => {
    const list: any[] = data?.debtors ?? []
    const sign = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => sign * ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0)))
  }, [data, sortKey, sortDir])

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>
  if (!data || !data.periodCode) return <div className="empty">{t('debtors.none', 'No statements yet — close a period to see debtors.')}</div>

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card ops-card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="muted">{t('debtors.total', 'Total outstanding (all funds)')} · {data.periodCode}</div>
            <strong style={{ fontSize: 22 }}>{money(data.totalDebt)}</strong>
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <div className="muted">{t('debtors.count', 'Units with debt')}</div>
            <strong style={{ fontSize: 22 }}>{data.debtorCount}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>{t('debtors.top', 'All debtors')}</h4>
        {sortedDebtors.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>{t('debtors.entity', 'Billing entity')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.debt', 'Debt')}<SortIcon k="debt" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.pct', '% of total')}<SortIcon k="pctOfTotal" /></th>
              </tr>
            </thead>
            <tbody>
              {sortedDebtors.map((d: any) => (
                <tr key={d.beCode}
                  onClick={onPick ? () => onPick(d) : undefined}
                  style={{ borderTop: '1px solid var(--border, #eee)', cursor: onPick ? 'pointer' : undefined }}
                  title={onPick ? t('debtors.pick', 'Înregistrează încasare') : undefined}>
                  <td style={{ padding: '6px 8px' }}>{d.beName || d.beCode}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.debt)}{onPick ? ' ›' : ''}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted, #666)' }}>{pct(d.pctOfTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">{t('debtors.clear', 'No debtors 🎉')}</div>}
      </div>
    </div>
  )
}
