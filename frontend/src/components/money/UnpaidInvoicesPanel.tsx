import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ro-RO') : '—')
// Unpaid + due date in the past = overdue (compare at day granularity, local midnight).
const isOverdue = (d?: string | null) => !!d && new Date(d) < new Date(new Date().toDateString())

export function UnpaidInvoicesPanel({ communityId, onPick }: { communityId: string; onPick?: (invoice: any) => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    api.get<any>(`/communities/${communityId}/finance/vendor-invoices/unpaid`)
      .then((d) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId])

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card ops-card">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div className="stack" style={{ gap: 2 }}>
            <div className="muted">{t('unpaid.total', 'Owed to suppliers')}</div>
            <strong style={{ fontSize: 22 }}>{money(data?.totalOutstanding)}</strong>
          </div>
          <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            <div className="muted">{t('unpaid.count', 'Open invoices')}</div>
            <strong style={{ fontSize: 22 }}>{data?.count ?? 0}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>{t('unpaid.title', 'Unpaid supplier invoices')}</h4>
        {data?.invoices?.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>{t('unpaid.number', 'Invoice')}</th>
                <th style={{ padding: '6px 8px' }}>{t('unpaid.vendor', 'Supplier')}</th>
                <th style={{ padding: '6px 8px' }}>{t('unpaid.due', 'Scadență')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('unpaid.gross', 'Gross')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('unpaid.paid', 'Paid')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('unpaid.outstanding', 'Outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv: any) => (
                <tr key={inv.id}
                  onClick={onPick ? () => onPick(inv) : undefined}
                  style={{ borderTop: '1px solid var(--border, #eee)', cursor: onPick ? 'pointer' : undefined }}
                  title={onPick ? t('paybill.pick', 'Plătește factura') : undefined}>
                  <td style={{ padding: '6px 8px' }}>{inv.number || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{inv.vendor || '—'}</td>
                  <td style={{ padding: '6px 8px', color: isOverdue(inv.dueDate) ? 'var(--danger, #dc2626)' : undefined, fontWeight: isOverdue(inv.dueDate) ? 600 : undefined }}
                    title={isOverdue(inv.dueDate) ? t('unpaid.overdue', 'Scadență depășită') : undefined}>
                    {fmtDate(inv.dueDate)}{isOverdue(inv.dueDate) ? ' ⚠' : ''}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(inv.gross, inv.currency)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(inv.paid, inv.currency)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{money(inv.outstanding, inv.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">{t('unpaid.clear', 'All supplier invoices are paid 🎉')}</div>}
      </div>
    </div>
  )
}
