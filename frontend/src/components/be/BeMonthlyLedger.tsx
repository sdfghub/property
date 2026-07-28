import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { BeFinancialsPanel } from './BeFinancialsPanel'

// Detailed monthly ledgers for a billing entity: a closed-period statement series (opening→closing
// per fund), and the full per-period financials for the selected month. Available to every sub-role
// of the BE (owner / resident / expense-responsible).
type FundRow = {
  fundId: string
  fundCode: string | null
  fundName: string | null
  dueStart: number
  charges: number
  payments: number
  adjustments: number
  dueEnd: number
}
type PeriodRow = {
  code: string
  seq: number
  status: string
  funds: FundRow[]
  totals: { dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number }
}

const money = (n: number | null | undefined) =>
  n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function BeMonthlyLedger({ beId }: { beId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [periods, setPeriods] = React.useState<PeriodRow[]>([])
  const [selected, setSelected] = React.useState<string>('')
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!beId) return
    setLoading(true)
    api.get<{ periods: PeriodRow[] }>(`/communities/be/${beId}/statements`)
      .then((r: { periods: PeriodRow[] }) => {
        const rows = r?.periods ?? []
        setPeriods(rows)
        if (rows.length) setSelected((cur) => cur || rows[0].code)
        setLoading(false)
      })
      .catch((e: any) => { setError(e?.message || 'Eroare'); setLoading(false) })
  }, [api, beId])

  if (loading) return <div className="empty">{t('common.loading', 'Se încarcă…')}</div>
  if (error) return <div className="badge negative">{error}</div>
  if (!periods.length) return <div className="empty">{t('be.noClosedPeriods', 'Nicio perioadă închisă încă.')}</div>

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t('ledger.period', 'Lună')}</th>
              <th style={{ padding: '8px 10px' }}>{t('ledger.dueStart', 'Sold precedent')}</th>
              <th style={{ padding: '8px 10px' }}>{t('ledger.charges', 'Facturat')}</th>
              <th style={{ padding: '8px 10px' }}>{t('ledger.payments', 'Încasat')}</th>
              <th style={{ padding: '8px 10px' }}>{t('ledger.adjustments', 'Ajustări')}</th>
              <th style={{ padding: '8px 10px', fontWeight: 700 }}>{t('ledger.dueEnd', 'Sold final')}</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const on = p.code === selected
              return (
                <tr
                  key={p.code}
                  onClick={() => setSelected(p.code)}
                  style={{
                    borderTop: '1px solid var(--border, #eee)', textAlign: 'right', cursor: 'pointer',
                    background: on ? 'var(--hover-bg, #eef4ff)' : undefined,
                  }}
                >
                  <td style={{ textAlign: 'left', padding: '6px 10px', fontWeight: on ? 700 : 500 }}>{p.code}</td>
                  <td style={{ padding: '6px 10px' }}>{money(p.totals.dueStart)}</td>
                  <td style={{ padding: '6px 10px' }}>{money(p.totals.charges)}</td>
                  <td style={{ padding: '6px 10px' }}>{money(p.totals.payments)}</td>
                  <td style={{ padding: '6px 10px' }}>{money(p.totals.adjustments)}</td>
                  <td style={{ padding: '6px 10px', fontWeight: 700 }}>{money(p.totals.dueEnd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected ? (
        <div className="stack" style={{ gap: 6 }}>
          <h4 style={{ margin: 0 }}>{t('ledger.detailFor', 'Detaliu lună')}: {selected}</h4>
          <BeFinancialsPanel key={`${beId}:${selected}`} beId={beId} periodCode={selected} />
        </div>
      ) : null}
    </div>
  )
}
