import React from 'react'
import { useI18n } from '../../i18n/useI18n'

type SortKey = 'vendor' | 'count' | 'gross' | 'paid' | 'due'

// Per-vendor status ("situație pe furnizori") — same invoices as InvoicesStatusTable/listInvoices,
// rolled up by vendor (PPC, Aquatim, Larisuk etc.) instead of listed one row per invoice.
export function VendorSummaryTable({ invoices }: { invoices: any[] }) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [sortKey, setSortKey] = React.useState<SortKey>('due')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')

  const byVendor = new Map<string, { name: string; count: number; gross: number; paid: number; due: number }>()
  for (const inv of invoices ?? []) {
    const name = inv.vendor?.name || inv.vendorName || t('unpaid.vendor', 'Furnizor necunoscut')
    const row = byVendor.get(name) ?? { name, count: 0, gross: 0, paid: 0, due: 0 }
    const gross = Number(inv.gross ?? 0)
    const paid = Number(inv.paid ?? 0)
    const due = inv.due != null ? Number(inv.due) : gross - paid
    row.count += 1
    row.gross += gross
    row.paid += paid
    row.due += due
    byVendor.set(name, row)
  }
  let rows = Array.from(byVendor.values())

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc') }
    else setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }
  const value = (r: (typeof rows)[number]): number | string =>
    sortKey === 'vendor' ? r.name.toLowerCase() : r[sortKey]
  rows = [...rows].sort((a, b) => {
    const va = value(a); const vb = value(b)
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : Number(va) - Number(vb)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const totals = rows.reduce((acc, r) => ({ gross: acc.gross + r.gross, paid: acc.paid + r.paid, due: acc.due + r.due }), { gross: 0, paid: 0, due: 0 })
  const money = (n: number) => `${n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`

  const SortIcon = ({ k }: { k: SortKey }) => (
    <button type="button" onClick={() => toggleSort(k)} title={t('avizier.sort', 'Sortează')}
      style={{ background: 'none', border: 'none', padding: '0 0 0 3px', cursor: 'pointer', color: sortKey === k ? 'var(--accent, #0071e3)' : 'var(--border, #ccc)', fontSize: 10, verticalAlign: 'middle' }}>
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </button>
  )
  const Th = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' }) => (
    <th style={{ padding: '6px 8px', textAlign: align }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}<SortIcon k={k} /></span>
    </th>
  )

  if (!rows.length) return <div className="empty">{t('vendorSummary.none', 'Nicio factură.')}</div>

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="muted" style={{ fontSize: 12 }}>{t('vendorSummary.title', 'Situație pe furnizori')}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {t('vendorSummary.total', 'Total')}: <strong>{money(totals.gross)}</strong> · {t('unpaid.paid', 'Achitat')}: <strong>{money(totals.paid)}</strong> · {t('invoices.remaining', 'Restanțe')}: <strong>{money(Math.max(totals.due, 0))}</strong>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <Th k="vendor" label={t('unpaid.vendor', 'Furnizor')} />
              <Th k="count" label={t('vendorSummary.invoiceCount', 'Facturi')} align="right" />
              <Th k="gross" label={t('invoices.payAmount', 'Sumă de plată')} align="right" />
              <Th k="paid" label={t('unpaid.paid', 'Achitat')} align="right" />
              <Th k="due" label={t('invoices.remaining', 'Restanțe')} align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                <td style={{ padding: '6px 8px' }}>{r.name}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.count}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.gross)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.paid)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.due > 0.005 ? 'var(--danger, #dc2626)' : r.due < -0.005 ? 'var(--success, #16a34a)' : undefined }}>
                  {Math.abs(r.due) > 0.005 ? money(r.due) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
