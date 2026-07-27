import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// Read-only view of the association's outstanding vendor invoices, for owners / expense-responsibles.
type Invoice = {
  id: string
  number: string | null
  vendor: string | null
  currency: string
  issueDate: string | null
  dueDate: string | null
  gross: number
  paid: number
  outstanding: number
}
type Payload = { count: number; totalOutstanding: number; invoices: Invoice[] }

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('ro-RO') : '')

export function BeDueInvoicesPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    api.get<Payload>(`/me/communities/${communityId}/vendor-invoices/unpaid`)
      .then((r: Payload) => { setData(r); setLoading(false) })
      .catch((e: any) => { setError(e?.message || 'Eroare'); setLoading(false) })
  }, [api, communityId])

  if (loading) return <div className="empty">{t('common.loading', 'Se încarcă…')}</div>
  if (error) return <div className="badge negative">{error}</div>

  const invoices = data?.invoices ?? []
  if (!invoices.length) return <div className="empty">{t('invoices.none', 'Nicio factură neachitată.')}</div>

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <strong>{t('invoices.outstanding', 'De plată')}:</strong>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(data?.totalOutstanding)}</span>
        <span className="muted">({data?.count} {t('invoices.count', 'facturi')})</span>
      </div>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t('invoices.vendor', 'Furnizor')}</th>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t('invoices.number', 'Număr')}</th>
              <th style={{ padding: '8px 10px' }}>{t('invoices.due', 'Scadență')}</th>
              <th style={{ padding: '8px 10px' }}>{t('invoices.gross', 'Total')}</th>
              <th style={{ padding: '8px 10px' }}>{t('invoices.paid', 'Achitat')}</th>
              <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('invoices.remaining', 'Rest')}</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((iv) => (
              <tr key={iv.id} style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right' }}>
                <td style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>{iv.vendor || '—'}</td>
                <td style={{ textAlign: 'left', padding: '6px 10px' }}>{iv.number || '—'}</td>
                <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{date(iv.dueDate)}</td>
                <td style={{ padding: '6px 10px' }}>{money(iv.gross, iv.currency)}</td>
                <td style={{ padding: '6px 10px' }}>{money(iv.paid, iv.currency)}</td>
                <td style={{ padding: '6px 10px', fontWeight: 700 }}>{money(iv.outstanding, iv.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
