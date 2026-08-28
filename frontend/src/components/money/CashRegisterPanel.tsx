import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type SortKey = 'date' | 'amount'
type GroupBy = 'none' | 'account' | 'fund'

// The bank/cash register — every CashTx row (bank RON, bank EUR, petty cash), the same data the
// dashboard's "Sold Bancă/Numerar" and "Încasări" cards summarize. Deep-linked via URL params
// (same convention as FundsTab's `?fund=`):
//   ?account=<id>            — one account (from a "Sold ..." card click)
//   ?scope=receipts&period=X — receipts (IN) across all accounts since period X's own afisareDate
//                              (matches FinanceService.collection's "this period's real receipts")
// With no params, shows everything and lets the user switch accounts.
export function CashRegisterPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const params = new URLSearchParams(window.location.search)
  const initialAccount = params.get('account')
  const fixedAccountIds = params.get('accounts') // comma-separated, e.g. all accounts of one type+currency
  const scope = params.get('scope')
  const period = params.get('period')

  const [accounts, setAccounts] = React.useState<any[]>([])
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(initialAccount)
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none')

  const isReceiptsScope = scope === 'receipts' && !!period
  const isFixedMultiAccount = !!fixedAccountIds && !initialAccount && !isReceiptsScope

  React.useEffect(() => {
    if (!communityId) return
    api.get<any>(`/communities/${communityId}/cash-accounts/balances`)
      .then((b: any) => setAccounts(b?.accounts ?? []))
      .catch(() => setAccounts([]))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams()
    if (isReceiptsScope) {
      qs.set('direction', 'IN')
      qs.set('period', period as string)
      // accounts may not have loaded yet on first render — the effect below re-runs once they do.
      if (accounts.length) qs.set('accountIds', accounts.map((a) => a.id).join(','))
    } else if (isFixedMultiAccount) {
      qs.set('accountIds', fixedAccountIds as string)
    } else if (selectedAccountId) {
      qs.set('accountId', selectedAccountId)
    }
    api.get<any[]>(`/communities/${communityId}/cash-tx?${qs.toString()}`)
      .then((r: any[]) => { if (alive) setRows(Array.isArray(r) ? r : []) })
      .catch((err: any) => { if (alive) { setRows([]); setError(err?.message || 'Failed to load') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [api, communityId, selectedAccountId, isReceiptsScope, period, accounts])

  const total = rows.reduce((acc: Record<string, number>, r: any) => {
    const ccy = r.currency || 'RON'
    const amt = Number(r.amount || 0) * (r.direction === 'OUT' ? -1 : 1)
    acc[ccy] = (acc[ccy] ?? 0) + amt
    return acc
  }, {})

  const money = (n: number, ccy: string) =>
    `${n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc') }
    else setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }
  const sortValue = (r: any): number => {
    if (sortKey === 'date') return r.ts ? new Date(r.ts).getTime() : 0
    if (sortKey === 'amount') return Number(r.amount || 0)
    return 0
  }
  const compare = (a: any, b: any) => {
    const cmp = sortValue(a) - sortValue(b)
    return sortDir === 'asc' ? cmp : -cmp
  }
  const groupKeyOf = (r: any): string =>
    groupBy === 'account' ? (r.account?.name || '—') : (r.fund?.name || r.fund?.code || '—')

  let displayRows = rows
  if (groupBy !== 'none') {
    displayRows = [...rows].sort((a, b) => {
      const byGroup = groupKeyOf(a).localeCompare(groupKeyOf(b))
      return byGroup !== 0 ? byGroup : (sortKey ? compare(a, b) : 0)
    })
  } else if (sortKey) {
    displayRows = [...rows].sort(compare)
  }

  const SortIcon = ({ k }: { k: SortKey }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>
          {isReceiptsScope
            ? `${t('cashRegister.receiptsTitle', 'Încasări')} — ${period}`
            : t('cashRegister.title', 'Registru bancă / casă')}
        </h3>
        {!isReceiptsScope && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className={`btn small ${!selectedAccountId ? 'primary' : 'secondary'}`}
              onClick={() => setSelectedAccountId(null)}>
              {t('cashRegister.all', 'Toate')}
            </button>
            {accounts.map((a) => (
              <button key={a.id} type="button" className={`btn small ${selectedAccountId === a.id ? 'primary' : 'secondary'}`}
                onClick={() => setSelectedAccountId(a.id)}>
                {a.name} ({a.currency})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(total).map(([ccy, sum]) => (
            <span key={ccy} className="badge secondary" style={{ fontSize: 12 }}>
              {t('cashRegister.net', 'Net')}: <strong>{money(sum, ccy)}</strong>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('cashRegister.groupBy', 'Grupează după')}:</span>
          <button type="button" className={`btn ghost small ${groupBy === 'none' ? 'primary' : 'secondary'}`}
            onClick={() => setGroupBy('none')}>{t('cashRegister.groupNone', 'Fără')}</button>
          <button type="button" className={`btn ghost small ${groupBy === 'account' ? 'primary' : 'secondary'}`}
            onClick={() => setGroupBy('account')}>{t('cashRegister.account', 'Cont')}</button>
          <button type="button" className={`btn ghost small ${groupBy === 'fund' ? 'primary' : 'secondary'}`}
            onClick={() => setGroupBy('fund')}>{t('funds.label', 'Fond')}</button>
        </div>
      </div>

      {loading ? (
        <div className="empty">{t('common.loading', 'Loading…')}</div>
      ) : error ? (
        <div className="badge negative">{error}</div>
      ) : !rows.length ? (
        <div className="empty">{t('cashRegister.none', 'Nicio tranzacție.')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{t('cashRegister.date', 'Dată')}<SortIcon k="date" /></span></th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.account', 'Cont')}</th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.direction', 'Sens')}</th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.kind', 'Tip')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center' }}>{t('cashRegister.amount', 'Sumă')}<SortIcon k="amount" /></span></th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.unit', 'Unitate')}</th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.counterparty', 'De la / Furnizor')}</th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.invoiceNumber', 'Factură')}</th>
                <th style={{ padding: '6px 8px' }}>{t('funds.label', 'Fond')}</th>
                <th style={{ padding: '6px 8px' }}>{t('cashRegister.memo', 'Descriere')}</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r: any, i: number) => {
                const showGroupHeader = groupBy !== 'none' && (i === 0 || groupKeyOf(displayRows[i - 1]) !== groupKeyOf(r))
                return (
                  <React.Fragment key={r.id}>
                    {showGroupHeader && (
                      <tr>
                        <td colSpan={10} style={{ padding: '10px 8px 4px', fontWeight: 700, color: 'var(--muted, #666)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                          {groupKeyOf(r)}
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.ts ? new Date(r.ts).toLocaleDateString('ro-RO') : '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.account?.name || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span className={`badge ${r.direction === 'IN' ? 'positive' : 'negative'}`}>
                          {r.direction === 'IN' ? t('cashRegister.in', 'Încasare') : t('cashRegister.out', 'Plată')}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>{r.kind || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {money(Number(r.amount || 0), r.currency || 'RON')}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{r.unit || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.counterpartyName || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.invoiceNumber || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.fund?.name || r.fund?.code || '—'}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.memo || ''}>
                        {r.memo || '—'}
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
