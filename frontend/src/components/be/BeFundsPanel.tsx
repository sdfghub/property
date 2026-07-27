import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// Read-only fund details for owners / expense-responsibles: per-fund balance, target and progress.
type FundStatus = {
  code: string
  name: string
  currency: string
  totalTarget: number | null
  monthlyTarget: number | null
  accrued: number
  progressPct: number | null
}
type Balance = { id: string; code: string; name: string; balance: number }
type Payload = { status: { funds: FundStatus[] }; balances: Balance[] }

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

export function BeFundsPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    api.get<Payload>(`/me/communities/${communityId}/funds`)
      .then((r: Payload) => { setData(r); setLoading(false) })
      .catch((e: any) => { setError(e?.message || 'Eroare'); setLoading(false) })
  }, [api, communityId])

  if (loading) return <div className="empty">{t('common.loading', 'Se încarcă…')}</div>
  if (error) return <div className="badge negative">{error}</div>

  const balanceByCode = new Map((data?.balances ?? []).map((b) => [b.code, b.balance]))
  const funds = data?.status?.funds ?? []
  if (!funds.length) return <div className="empty">{t('funds.none', 'Niciun fond configurat.')}</div>

  return (
    <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t('funds.name', 'Fond')}</th>
            <th style={{ padding: '8px 10px' }}>{t('funds.balance', 'Sold curent')}</th>
            <th style={{ padding: '8px 10px' }}>{t('funds.accrued', 'Colectat')}</th>
            <th style={{ padding: '8px 10px' }}>{t('funds.target', 'Țintă')}</th>
            <th style={{ padding: '8px 10px' }}>{t('funds.monthly', 'Lunar')}</th>
            <th style={{ padding: '8px 10px' }}>{t('funds.progress', 'Progres')}</th>
          </tr>
        </thead>
        <tbody>
          {funds.map((f) => (
            <tr key={f.code} style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right' }}>
              <td style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>{f.name}</td>
              <td style={{ padding: '6px 10px' }}>{money(balanceByCode.get(f.code) ?? 0, f.currency)}</td>
              <td style={{ padding: '6px 10px' }}>{money(f.accrued, f.currency)}</td>
              <td style={{ padding: '6px 10px' }}>{money(f.totalTarget, f.currency)}</td>
              <td style={{ padding: '6px 10px' }}>{money(f.monthlyTarget, f.currency)}</td>
              <td style={{ padding: '6px 10px' }}>{f.progressPct == null ? '—' : `${f.progressPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
