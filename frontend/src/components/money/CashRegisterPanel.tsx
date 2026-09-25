import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type SortKey = 'date' | 'amount'
type GroupBy = 'none' | 'account' | 'fund'
// One filter per table column: `text` = case- and diacritic-insensitive "contains", `pick` = a
// value from the column's own distinct values, plus a date and an amount range.
type Filters = {
  dateFrom: string; dateTo: string; amountMin: string; amountMax: string
  account: string; direction: string; kind: string; fund: string
  unit: string; counterparty: string; invoice: string; memo: string
}
const EMPTY_FILTERS: Filters = {
  dateFrom: '', dateTo: '', amountMin: '', amountMax: '',
  account: '', direction: '', kind: '', fund: '',
  unit: '', counterparty: '', invoice: '', memo: '',
}
const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const dayOf = (ts?: string | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : '')

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
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS)
  const [search, setSearch] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const setFilter = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }))

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

  const accountOf = (r: any) => r.account?.name || '—'
  const fundOf = (r: any) => r.fund?.name || r.fund?.code || '—'
  const directionLabel = (r: any) => (r.direction === 'IN' ? t('cashRegister.in', 'Încasare') : t('cashRegister.out', 'Plată'))

  // Distinct values per pick-list column, from the rows actually loaded.
  const distinct = (get: (r: any) => string) => Array.from(new Set(rows.map(get))).sort((a, b) => a.localeCompare(b, 'ro'))
  const accountOptions = React.useMemo(() => distinct(accountOf), [rows])
  const kindOptions = React.useMemo(() => distinct((r) => r.kind || '—'), [rows])
  const fundOptions = React.useMemo(() => distinct(fundOf), [rows])

  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length + (search.trim() ? 1 : 0)
  const filteredRows = React.useMemo(() => {
    const q = fold(search.trim())
    const has = (hay: unknown, needle: string) => !needle || fold(hay).includes(fold(needle))
    const min = filters.amountMin !== '' ? Number(filters.amountMin.replace(',', '.')) : null
    const max = filters.amountMax !== '' ? Number(filters.amountMax.replace(',', '.')) : null
    return rows.filter((r: any) => {
      const day = dayOf(r.ts)
      const amount = Number(r.amount || 0)
      if (filters.dateFrom && day < filters.dateFrom) return false
      if (filters.dateTo && day > filters.dateTo) return false
      if (min != null && !Number.isNaN(min) && amount < min) return false
      if (max != null && !Number.isNaN(max) && amount > max) return false
      if (filters.account && accountOf(r) !== filters.account) return false
      if (filters.direction && r.direction !== filters.direction) return false
      if (filters.kind && (r.kind || '—') !== filters.kind) return false
      if (filters.fund && fundOf(r) !== filters.fund) return false
      if (!has(r.unit, filters.unit) || !has(r.counterpartyName, filters.counterparty) || !has(r.invoiceNumber, filters.invoice) || !has(r.memo, filters.memo)) return false
      if (q) {
        const all = [day, r.ts ? new Date(r.ts).toLocaleDateString('ro-RO') : '', accountOf(r), directionLabel(r), r.kind, amount.toFixed(2),
          r.unit, r.counterpartyName, r.invoiceNumber, fundOf(r), r.memo].map(fold).join(' ')
        if (!all.includes(q)) return false
      }
      return true
    })
  }, [rows, filters, search])

  const netOf = (list: any[]) => list.reduce((acc: Record<string, number>, r: any) => {
    const ccy = r.currency || 'RON'
    acc[ccy] = (acc[ccy] ?? 0) + Number(r.amount || 0) * (r.direction === 'OUT' ? -1 : 1)
    return acc
  }, {})
  const total = netOf(filteredRows)

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
  const groupKeyOf = (r: any): string => (groupBy === 'account' ? accountOf(r) : fundOf(r))

  const displayRows = sortKey ? [...filteredRows].sort(compare) : filteredRows
  // Groups keep the (sorted) row order inside; each folds on its header.
  const groups = React.useMemo(() => {
    if (groupBy === 'none') return []
    const m = new Map<string, any[]>()
    for (const r of displayRows) m.set(groupKeyOf(r), [...(m.get(groupKeyOf(r)) ?? []), r])
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ro')).map(([key, list]) => ({ key, rows: list, net: netOf(list) }))
  }, [displayRows, groupBy])
  const toggleGroup = (k: string) => setCollapsed((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })

  const SortIcon = ({ k }: { k: SortKey }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )

  // Filter-row controls: compact, full-width in their cell, highlighted while active.
  const ctl = (active: boolean): React.CSSProperties => ({
    width: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 12, padding: '4px 6px', borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent, #0071e3)' : 'var(--border, #ddd)'}`,
    background: active ? 'var(--accent-soft, rgba(0,113,227,.08))' : 'var(--panel, #fff)', font: 'inherit',
  })
  const textFilter = (k: keyof Filters, label: string) => (
    <input type="search" value={filters[k]} onChange={(e) => setFilter(k, e.target.value)}
      placeholder={t('cashRegister.filterText', 'Filtrează…')} aria-label={label} style={ctl(!!filters[k])} />
  )
  const pickFilter = (k: keyof Filters, label: string, options: { value: string; label: string }[]) => (
    <select value={filters[k]} onChange={(e) => setFilter(k, e.target.value)} aria-label={label} style={ctl(!!filters[k])}>
      <option value="">{t('cashRegister.filterAll', 'Toate')}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
  const asOptions = (xs: string[]) => xs.map((x) => ({ value: x, label: x }))

  const renderRow = (r: any) => (
    <tr key={r.id} style={{ borderTop: '1px solid var(--border, #eee)' }}>
      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{r.ts ? new Date(r.ts).toLocaleDateString('ro-RO') : '—'}</td>
      <td style={{ padding: '6px 8px' }}>{accountOf(r)}</td>
      <td style={{ padding: '6px 8px' }}>
        <span className={`badge ${r.direction === 'IN' ? 'positive' : 'negative'}`}>{directionLabel(r)}</span>
      </td>
      <td style={{ padding: '6px 8px' }}>{r.kind || '—'}</td>
      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {money(Number(r.amount || 0), r.currency || 'RON')}
      </td>
      <td style={{ padding: '6px 8px' }}>{r.unit || '—'}</td>
      <td style={{ padding: '6px 8px' }}>{r.counterpartyName || '—'}</td>
      <td style={{ padding: '6px 8px' }}>{r.invoiceNumber || '—'}</td>
      <td style={{ padding: '6px 8px' }}>{fundOf(r)}</td>
      <td style={{ padding: '6px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.memo || ''}>
        {r.memo || '—'}
      </td>
    </tr>
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

      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="search" className="input" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t('cashRegister.search', 'Caută în tot registrul…')} aria-label={t('cashRegister.search', 'Caută în tot registrul…')}
          style={{ flex: '1 1 260px', minWidth: 200 }} />
        {activeFilterCount ? (
          <button type="button" className="btn ghost small" onClick={() => { setFilters(EMPTY_FILTERS); setSearch('') }}>
            ✕ {t('cashRegister.resetFilters', 'Resetează filtrele')} ({activeFilterCount})
          </button>
        ) : null}
        <span className="muted" style={{ fontSize: 12 }}>
          {t('cashRegister.shown', '{shown} din {total} tranzacții').replace('{shown}', String(filteredRows.length)).replace('{total}', String(rows.length))}
        </span>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(total).map(([ccy, sum]) => (
            <span key={ccy} className="badge secondary" style={{ fontSize: 12 }}>
              {t('cashRegister.net', 'Net')}: <strong>{money(sum, ccy)}</strong>
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('cashRegister.groupBy', 'Grupează după')}:</span>
          <button type="button" className={`btn ghost small ${groupBy === 'none' ? 'primary' : 'secondary'}`}
            onClick={() => setGroupBy('none')}>{t('cashRegister.groupNone', 'Fără')}</button>
          <button type="button" className={`btn ghost small ${groupBy === 'account' ? 'primary' : 'secondary'}`}
            onClick={() => { setGroupBy('account'); setCollapsed(new Set()) }}>{t('cashRegister.account', 'Cont')}</button>
          <button type="button" className={`btn ghost small ${groupBy === 'fund' ? 'primary' : 'secondary'}`}
            onClick={() => { setGroupBy('fund'); setCollapsed(new Set()) }}>{t('funds.label', 'Fond')}</button>
          {groupBy !== 'none' ? (
            <>
              <button type="button" className="btn ghost small" onClick={() => setCollapsed(new Set())}>{t('cashRegister.expandAll', 'Extinde tot')}</button>
              <button type="button" className="btn ghost small" onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))}>{t('cashRegister.collapseAll', 'Restrânge tot')}</button>
            </>
          ) : null}
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
              {/* One filter per column, right under its header. */}
              <tr style={{ verticalAlign: 'top' }}>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400, minWidth: 118 }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)}
                      aria-label={t('cashRegister.dateFrom', 'De la')} title={t('cashRegister.dateFrom', 'De la')} style={ctl(!!filters.dateFrom)} />
                    <input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)}
                      aria-label={t('cashRegister.dateTo', 'Până la')} title={t('cashRegister.dateTo', 'Până la')} style={ctl(!!filters.dateTo)} />
                  </div>
                </th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{pickFilter('account', t('cashRegister.account', 'Cont'), asOptions(accountOptions))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{pickFilter('direction', t('cashRegister.direction', 'Sens'), [{ value: 'IN', label: t('cashRegister.in', 'Încasare') }, { value: 'OUT', label: t('cashRegister.out', 'Plată') }])}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{pickFilter('kind', t('cashRegister.kind', 'Tip'), asOptions(kindOptions))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400, minWidth: 90 }}>
                  <div className="stack" style={{ gap: 3 }}>
                    <input type="text" inputMode="decimal" value={filters.amountMin} onChange={(e) => setFilter('amountMin', e.target.value)}
                      placeholder={t('cashRegister.amountMin', 'Min')} aria-label={t('cashRegister.amountMin', 'Min')} style={{ ...ctl(!!filters.amountMin), textAlign: 'right' }} />
                    <input type="text" inputMode="decimal" value={filters.amountMax} onChange={(e) => setFilter('amountMax', e.target.value)}
                      placeholder={t('cashRegister.amountMax', 'Max')} aria-label={t('cashRegister.amountMax', 'Max')} style={{ ...ctl(!!filters.amountMax), textAlign: 'right' }} />
                  </div>
                </th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{textFilter('unit', t('cashRegister.unit', 'Unitate'))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{textFilter('counterparty', t('cashRegister.counterparty', 'De la / Furnizor'))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{textFilter('invoice', t('cashRegister.invoiceNumber', 'Factură'))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{pickFilter('fund', t('funds.label', 'Fond'), asOptions(fundOptions))}</th>
                <th style={{ padding: '2px 4px 6px', fontWeight: 400 }}>{textFilter('memo', t('cashRegister.memo', 'Descriere'))}</th>
              </tr>
            </thead>
            <tbody>
              {!filteredRows.length ? (
                <tr><td colSpan={10} className="muted" style={{ padding: 14, textAlign: 'center' }}>{t('cashRegister.noMatch', 'Nicio tranzacție nu corespunde filtrelor.')}</td></tr>
              ) : groupBy === 'none' ? displayRows.map(renderRow) : groups.map((g) => {
                const open = !collapsed.has(g.key)
                return (
                  <React.Fragment key={g.key}>
                    <tr onClick={() => toggleGroup(g.key)} title={t('cashRegister.groupToggle', 'Click pentru a deschide / închide grupul')}
                      style={{ cursor: 'pointer', background: 'var(--muted-bg, #f4f4f5)', borderTop: '2px solid var(--border, #ddd)' }}>
                      <td colSpan={4} style={{ padding: '8px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="muted" style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
                          {g.key}
                          <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}>({g.rows.length})</span>
                        </span>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {Object.entries(g.net).map(([ccy, sum]) => <div key={ccy}>{money(sum, ccy)}</div>)}
                      </td>
                      <td colSpan={5} />
                    </tr>
                    {open ? g.rows.map(renderRow) : null}
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
