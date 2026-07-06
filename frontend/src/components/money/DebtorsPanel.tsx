import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

export function DebtorsPanel({ communityId, onPick }: { communityId: string; onPick?: (debtor: any) => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    api.get<any>(`/communities/${communityId}/finance/receivables`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId])

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
        <h4 style={{ marginTop: 0 }}>{t('debtors.top', 'Top debtors')}</h4>
        {data.topDebtors?.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>{t('debtors.entity', 'Billing entity')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('debtors.debt', 'Debt')}</th>
              </tr>
            </thead>
            <tbody>
              {data.topDebtors.map((d: any) => (
                <tr key={d.beCode}
                  onClick={onPick ? () => onPick(d) : undefined}
                  style={{ borderTop: '1px solid var(--border, #eee)', cursor: onPick ? 'pointer' : undefined }}
                  title={onPick ? t('debtors.pick', 'Înregistrează încasare') : undefined}>
                  <td style={{ padding: '6px 8px' }}>{d.beName || d.beCode}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(d.debt)}{onPick ? ' ›' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">{t('debtors.clear', 'No debtors 🎉')}</div>}
      </div>
    </div>
  )
}
