import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { useAuth } from '../../hooks/useAuth'

// Shared "vendor invoices, paid/unpaid" table — used by OverviewTab (current period detail) and
// the current-month dashboard. `invoices` matches VendorInvoiceService.listInvoices's shape:
// { id, number, vendor, issueDate, dueDate, currency, gross, paid, paidAt, due, fundInvoices,
//   serviceStartPeriodId, serviceEndPeriodId, mergedIds? }.
// `paidAt` is the most recent payment date applied to the invoice (null if unpaid).
// `mergedIds` (when present) means this display row groups several underlying VendorInvoice rows
// sharing the same vendor+number (see listInvoices) — period/payment edits must apply to all of them.
type SortKey = 'vendor' | 'issueDate' | 'dueDate' | 'paidAt' | 'gross' | 'paid' | 'due'

export function InvoicesStatusTable({
  invoices, title, editable = false, communityId, onChanged,
}: { invoices: any[]; title?: string; editable?: boolean; communityId?: string; onChanged?: () => void }) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const { api } = useAuth()
  const [sortKey, setSortKey] = React.useState<SortKey | null>(null)
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc')
  const [groupByVendor, setGroupByVendor] = React.useState(false)
  const [periods, setPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [payingId, setPayingId] = React.useState<string | null>(null)
  const [payDate, setPayDate] = React.useState('')
  const [payAmount, setPayAmount] = React.useState('')
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editForm, setEditForm] = React.useState({ number: '', vendorName: '', issueDate: '', dueDate: '', gross: '', paidAmount: '', paidDate: '' })

  const [filterPeriodId, setFilterPeriodId] = React.useState('')
  const [filterStatus, setFilterStatus] = React.useState('')
  const [filterVendor, setFilterVendor] = React.useState('')

  React.useEffect(() => {
    if (!communityId) return
    api.get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods`)
      .then((rows: Array<{ id: string; code: string }>) => setPeriods(Array.isArray(rows) ? rows : []))
      .catch(() => setPeriods([]))
  }, [api, communityId])

  const periodCodeById = React.useMemo(() => new Map(periods.map((p) => [p.id, p.code])), [periods])

  const assignPeriod = async (inv: any, periodId: string | null) => {
    if (!communityId) return
    setBusyId(inv.id)
    setActionError(null)
    try {
      const ids: string[] = inv.mergedIds ?? [inv.id]
      for (const id of ids) {
        const full = await api.get<any>(`/communities/${communityId}/invoices/${id}`)
        await api.patch(`/communities/${communityId}/invoices/${id}`, {
          vendorId: full.vendor?.id,
          number: full.number,
          issueDate: full.issueDate,
          dueDate: full.dueDate,
          serviceStartPeriodId: periodId,
          serviceEndPeriodId: periodId,
          currency: full.currency,
          net: full.net,
          vat: full.vat,
          gross: full.gross,
          source: full.source,
          hash: full.hash,
          provenance: full.provenance,
        })
      }
      onChanged?.()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to assign period')
    } finally {
      setBusyId(null)
    }
  }

  const toDateInput = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : '')

  const startEdit = (inv: any, gross: number, paid: number) => {
    setEditingId(inv.id)
    const single = (inv.mergedIds ?? [inv.id]).length === 1
    setEditForm({
      number: inv.number || '',
      vendorName: inv.vendor?.name || inv.vendorName || '',
      issueDate: toDateInput(inv.issueDate),
      dueDate: toDateInput(inv.dueDate),
      gross: single ? String(gross) : '',
      paidAmount: inv.paymentId ? String(paid) : '',
      paidDate: inv.paymentId ? toDateInput(inv.paidAt) : '',
    })
  }

  const saveEdit = async (inv: any) => {
    if (!communityId) return
    setBusyId(inv.id)
    setActionError(null)
    try {
      const ids: string[] = inv.mergedIds ?? [inv.id]
      const singleRow = ids.length === 1
      for (const id of ids) {
        const full = await api.get<any>(`/communities/${communityId}/invoices/${id}`)
        await api.patch(`/communities/${communityId}/invoices/${id}`, {
          vendorId: editForm.vendorName ? undefined : full.vendor?.id,
          vendorName: editForm.vendorName || undefined,
          number: editForm.number || null,
          issueDate: editForm.issueDate || null,
          dueDate: editForm.dueDate || null,
          serviceStartPeriodId: full.serviceStartPeriodId,
          serviceEndPeriodId: full.serviceEndPeriodId,
          currency: full.currency,
          net: full.net,
          vat: full.vat,
          gross: singleRow && editForm.gross ? Number(editForm.gross) : full.gross,
          source: full.source,
          hash: full.hash,
          provenance: full.provenance,
        })
      }
      if (inv.paymentId && editForm.paidAmount) {
        await api.patch(`/communities/${communityId}/invoices/${inv.id}/payments/${inv.paymentId}`, {
          amount: Number(editForm.paidAmount),
          ts: editForm.paidDate || undefined,
        })
      }
      setEditingId(null)
      onChanged?.()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update invoice')
    } finally {
      setBusyId(null)
    }
  }

  const markUnpaid = async (inv: any) => {
    if (!communityId || !inv.paymentId) return
    if (!window.confirm(t('invoices.confirmMarkUnpaid', 'Șterge plata înregistrată și marchează factura neplătită?'))) return
    setBusyId(inv.id)
    setActionError(null)
    try {
      await api.del(`/communities/${communityId}/invoices/${inv.id}/payments/${inv.paymentId}`)
      setEditingId(null)
      onChanged?.()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to mark invoice unpaid')
    } finally {
      setBusyId(null)
    }
  }

  const markPaid = async (inv: any) => {
    if (!communityId || !payDate) return
    setBusyId(inv.id)
    setActionError(null)
    try {
      const ids: string[] = inv.mergedIds ?? [inv.id]
      const totalAmount = payAmount.trim() ? Number(payAmount) : null
      if (totalAmount != null && (!Number.isFinite(totalAmount) || totalAmount <= 0)) {
        throw new Error('Invalid amount')
      }
      if (ids.length === 1 || totalAmount == null) {
        // Single underlying invoice, or no explicit amount given (backend defaults to that
        // invoice's own gross) — no proportional split needed.
        for (const id of ids) {
          await api.post(`/communities/${communityId}/invoices/${id}/payments`, { ts: payDate, amount: totalAmount ?? undefined })
        }
      } else {
        // Merged display row (split invoice, e.g. one real bill across several service templates)
        // — distribute the entered total across the underlying rows by their own gross share, same
        // proportional approach used server-side for fund allocation (upsertCashTxForVendorPayment).
        const grossById = new Map<string, number>()
        for (const id of ids) {
          const full = await api.get<any>(`/communities/${communityId}/invoices/${id}`)
          grossById.set(id, Number(full.gross ?? 0))
        }
        const totalGross = Array.from(grossById.values()).reduce((s, g) => s + g, 0)
        let allocated = 0
        for (let i = 0; i < ids.length; i += 1) {
          const id = ids[i]
          const share = i === ids.length - 1
            ? totalAmount - allocated
            : Number(((totalGross > 0 ? grossById.get(id)! / totalGross : 1 / ids.length) * totalAmount).toFixed(2))
          allocated += share
          await api.post(`/communities/${communityId}/invoices/${id}/payments`, { ts: payDate, amount: share })
        }
      }
      setPayingId(null)
      setPayDate('')
      setPayAmount('')
      onChanged?.()
    } catch (err: any) {
      setActionError(err?.message || 'Failed to record payment')
    } finally {
      setBusyId(null)
    }
  }

  if (!invoices?.length) return null

  const allRows = invoices.map((inv: any) => {
    const gross = Number(inv.gross ?? 0)
    const paid = Number(inv.paid ?? 0)
    const due = inv.due != null ? Number(inv.due) : gross - paid
    const isPaid = due <= 0.005
    const isPartial = !isPaid && paid > 0.005
    const vendorName = inv.vendor?.name || inv.vendorName || ''
    return { inv, gross, paid, due, isPaid, isPartial, vendorName }
  })

  const vendorOptions = Array.from(new Set(allRows.map((r) => r.vendorName).filter(Boolean))).sort((a, b) => a.localeCompare(b))

  const rows = allRows.filter((r) => {
    if (filterPeriodId) {
      if (filterPeriodId === '__unassigned__') { if (r.inv.serviceStartPeriodId) return false }
      else if (r.inv.serviceStartPeriodId !== filterPeriodId) return false
    }
    if (filterStatus) {
      const matches = filterStatus === 'paid' ? r.isPaid : filterStatus === 'partial' ? r.isPartial : !r.isPaid && !r.isPartial
      if (!matches) return false
    }
    if (filterVendor && r.vendorName !== filterVendor) return false
    return true
  })

  const paidCount = rows.filter((r) => r.isPaid).length
  const partialCount = rows.filter((r) => r.isPartial).length
  const unpaidCount = rows.length - paidCount - partialCount
  const totalDue = rows.reduce((s, r) => s + Math.max(r.due, 0), 0)
  const totalGross = rows.reduce((s, r) => s + r.gross, 0)
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0)
  const totalNetDue = rows.reduce((s, r) => s + r.due, 0)
  const hasFilters = !!(filterPeriodId || filterStatus || filterVendor)

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('asc') }
    else setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
  }
  const sortValue = (r: (typeof rows)[number]): number | string => {
    switch (sortKey) {
      case 'vendor': return r.vendorName.toLowerCase()
      case 'issueDate': return r.inv.issueDate ? new Date(r.inv.issueDate).getTime() : -Infinity
      case 'dueDate': return r.inv.dueDate ? new Date(r.inv.dueDate).getTime() : -Infinity
      case 'paidAt': return r.inv.paidAt ? new Date(r.inv.paidAt).getTime() : -Infinity
      case 'gross': return r.gross
      case 'paid': return r.paid
      case 'due': return r.due
      default: return 0
    }
  }
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    const va = sortValue(a); const vb = sortValue(b)
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : Number(va) - Number(vb)
    return sortDir === 'asc' ? cmp : -cmp
  }

  let displayRows = rows
  if (groupByVendor) {
    displayRows = [...rows].sort((a, b) => {
      const byVendor = a.vendorName.toLowerCase().localeCompare(b.vendorName.toLowerCase())
      return byVendor !== 0 ? byVendor : (sortKey ? compare(a, b) : 0)
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
  const SortableTh = ({ k, label, align }: { k: SortKey; label: string; align?: 'right' }) => (
    <th style={{ padding: '6px 8px', textAlign: align }}>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}<SortIcon k={k} /></span>
    </th>
  )

  const dateStr = (d: any) => (d ? new Date(d).toLocaleDateString('ro-RO') : '—')

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {title ?? t('payments.currentInvoices', 'Invoices for this period')}
        </div>
        <span className="badge positive" style={{ fontSize: 11 }}>{t('invoices.paidCount', '{n} plătite').replace('{n}', String(paidCount))}</span>
        {partialCount > 0 && <span className="badge secondary" style={{ fontSize: 11 }}>{t('invoices.partialCount', '{n} parțial plătite').replace('{n}', String(partialCount))}</span>}
        <span className="badge negative" style={{ fontSize: 11 }}>{t('invoices.unpaidCount', '{n} neplătite').replace('{n}', String(unpaidCount))}</span>
        {totalDue > 0.005 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {t('invoices.totalDue', 'Total rămas de plată')}: <strong>{totalDue.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON</strong>
          </span>
        )}
        <button type="button" className="btn ghost small" aria-pressed={groupByVendor}
          onClick={() => setGroupByVendor((v) => !v)} style={{ marginLeft: 'auto', borderRadius: 999 }}
          title={t('invoices.groupByVendorHint', 'Grupează rândurile după furnizor')}>
          {groupByVendor ? '☑ ' : '☐ '}{t('invoices.groupByVendor', 'Grupează după furnizor')}
        </button>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" value={filterPeriodId} onChange={(e) => setFilterPeriodId(e.target.value)}
          aria-label={t('invoices.period', 'Perioadă')}>
          <option value="">{t('invoices.allPeriods', 'Toate perioadele')}</option>
          <option value="__unassigned__">{t('invoices.periodUnassigned', 'Neasignat')}</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
        <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          aria-label={t('invoices.status', 'Stare')}>
          <option value="">{t('invoices.allStatuses', 'Toate statusurile')}</option>
          <option value="paid">{t('invoices.statusPaid', 'Plătită')}</option>
          <option value="partial">{t('invoices.partial', 'Parțial plătită')}</option>
          <option value="unpaid">{t('invoices.unpaid', 'Neplătită')}</option>
        </select>
        <select className="input" value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)}
          aria-label={t('unpaid.vendor', 'Furnizor')}>
          <option value="">{t('invoices.allVendors', 'Toți furnizorii')}</option>
          {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        {hasFilters && (
          <button type="button" className="btn ghost small" onClick={() => { setFilterPeriodId(''); setFilterStatus(''); setFilterVendor('') }}>
            {t('collection.clearFilters', 'Șterge filtrele')}
          </button>
        )}
      </div>
      {actionError && <div className="badge negative">{actionError}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>{t('invoices.identifier', 'Identificator')}</th>
              <SortableTh k="vendor" label={t('unpaid.vendor', 'Furnizor')} />
              <SortableTh k="issueDate" label={t('invoices.issueDate', 'Data emitere')} />
              <SortableTh k="dueDate" label={t('invoices.dueDate', 'Data scadenței')} />
              <SortableTh k="paidAt" label={t('invoices.paidDate', 'Data plată')} />
              <SortableTh k="gross" label={t('invoices.payAmount', 'Sumă de plată')} align="right" />
              <SortableTh k="paid" label={t('unpaid.paid', 'Achitat')} align="right" />
              <SortableTh k="due" label={t('invoices.remaining', 'Restanțe')} align="right" />
              <th style={{ padding: '6px 8px' }}>{t('invoices.status', 'Stare')}</th>
              <th style={{ padding: '6px 8px' }}>{t('funds.label', 'Fonduri')}</th>
              <th style={{ padding: '6px 8px' }}>{t('invoices.period', 'Perioadă')}</th>
              {editable && <th style={{ padding: '6px 8px' }}>{t('invoices.actions', 'Acțiuni')}</th>}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ inv, gross, paid, due, isPaid, isPartial, vendorName }, i) => {
              const overdue = !isPaid && !!inv.dueDate && new Date(inv.dueDate) < new Date(new Date().toDateString())
              const statusLabel = isPaid ? t('invoices.statusPaid', 'Plătită') : isPartial ? t('invoices.partial', 'Parțial plătită') : t('invoices.unpaid', 'Neplătită')
              const statusClass = isPaid ? 'badge positive' : isPartial ? 'badge secondary' : 'badge negative'
              const showVendorHeader = groupByVendor && (i === 0 || displayRows[i - 1].vendorName !== vendorName)
              return (
                <React.Fragment key={inv.id}>
                  {showVendorHeader && (
                    <tr>
                      <td colSpan={editable ? 12 : 11} style={{ padding: '10px 8px 4px', fontWeight: 700, color: 'var(--muted, #666)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        {vendorName || '—'}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '1px solid var(--border, #eee)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      {editingId === inv.id ? (
                        <input className="input" style={{ minWidth: 110 }} value={editForm.number}
                          onChange={(e) => setEditForm((s) => ({ ...s, number: e.target.value }))}
                          aria-label={t('invoices.identifier', 'Identificator')} />
                      ) : (inv.number || '—')}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {editingId === inv.id ? (
                        <input className="input" style={{ minWidth: 110 }} value={editForm.vendorName}
                          onChange={(e) => setEditForm((s) => ({ ...s, vendorName: e.target.value }))}
                          aria-label={t('unpaid.vendor', 'Furnizor')} />
                      ) : (vendorName || '—')}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {editingId === inv.id ? (
                        <input type="date" className="input" style={{ minWidth: 130 }} value={editForm.issueDate}
                          onChange={(e) => setEditForm((s) => ({ ...s, issueDate: e.target.value }))}
                          aria-label={t('invoices.issueDate', 'Data emitere')} />
                      ) : dateStr(inv.issueDate)}
                    </td>
                    <td style={{ padding: '6px 8px', color: overdue ? 'var(--danger, #dc2626)' : undefined, fontWeight: overdue ? 600 : undefined }}
                      title={overdue ? t('unpaid.overdue', 'Scadență depășită') : undefined}>
                      {editingId === inv.id ? (
                        <input type="date" className="input" style={{ minWidth: 130 }} value={editForm.dueDate}
                          onChange={(e) => setEditForm((s) => ({ ...s, dueDate: e.target.value }))}
                          aria-label={t('invoices.dueDate', 'Data scadenței')} />
                      ) : <>{dateStr(inv.dueDate)}{overdue ? ' ⚠' : ''}</>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {editingId === inv.id && inv.paymentId ? (
                        <input type="date" className="input" style={{ minWidth: 130 }} value={editForm.paidDate}
                          onChange={(e) => setEditForm((s) => ({ ...s, paidDate: e.target.value }))}
                          aria-label={t('invoices.paidDate', 'Data plată')} />
                      ) : dateStr(inv.paidAt)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {editingId === inv.id ? (
                        (inv.mergedIds ?? [inv.id]).length === 1 ? (
                          <input type="number" step="0.01" className="input" style={{ minWidth: 90, textAlign: 'right' }} value={editForm.gross}
                            onChange={(e) => setEditForm((s) => ({ ...s, gross: e.target.value }))}
                            aria-label={t('invoices.payAmount', 'Sumă de plată')} />
                        ) : (
                          <span className="muted" title={t('invoices.mergedGrossHint', 'Sumă needitabilă pentru facturi grupate')}>
                            {gross.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {inv.currency || 'RON'}
                          </span>
                        )
                      ) : (
                        gross ? `${gross.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${inv.currency || 'RON'}` : '—'
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {editingId === inv.id && inv.paymentId ? (
                        <input type="number" step="0.01" min="0" className="input" style={{ minWidth: 90, textAlign: 'right' }} value={editForm.paidAmount}
                          onChange={(e) => setEditForm((s) => ({ ...s, paidAmount: e.target.value }))}
                          aria-label={t('unpaid.paid', 'Achitat')} />
                      ) : (
                        `${paid.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${inv.currency || 'RON'}`
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: due < -0.005 ? 'var(--success, #16a34a)' : undefined }}
                      title={due < -0.005 ? t('invoices.overpaidHint', 'Plătit mai mult decât suma de plată') : undefined}>
                      {/* Restanțe = Sumă de plată − Plătit, arătat direct (inclusiv negativ când s-a
                          plătit mai mult decât era de plată) — nu doar clamp la 0 ca un simplu neplătit/plătit. */}
                      {Math.abs(due) > 0.005 ? `${due.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${inv.currency || 'RON'}` : '—'}
                    </td>
                    <td style={{ padding: '6px 8px' }}><span className={statusClass}>{statusLabel}</span></td>
                    <td style={{ padding: '6px 8px' }}>
                      {inv.fundInvoices?.length
                        ? inv.fundInvoices.map((fl: any) => fl.fund?.name || fl.fund?.code || fl.fundId).join(', ')
                        : '—'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {editable ? (
                        <select
                          className="input"
                          style={{ minWidth: 110 }}
                          value={inv.serviceStartPeriodId ?? ''}
                          disabled={busyId === inv.id}
                          onChange={(e) => assignPeriod(inv, e.target.value || null)}
                          aria-label={t('invoices.period', 'Perioadă')}
                        >
                          <option value="">{t('invoices.periodUnassigned', 'Neasignat')}</option>
                          {periods.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                        </select>
                      ) : (
                        periodCodeById.get(inv.serviceStartPeriodId) || inv.serviceStartPeriodId || '—'
                      )}
                    </td>
                    {editable && (
                      <td style={{ padding: '6px 8px' }}>
                        {editingId === inv.id ? (
                          <div className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button type="button" className="btn primary small" disabled={busyId === inv.id}
                              onClick={() => saveEdit(inv)}>
                              {t('requests.update', 'Actualizează')}
                            </button>
                            <button type="button" className="btn ghost small" disabled={busyId === inv.id}
                              onClick={() => setEditingId(null)}>
                              {t('requests.cancel', 'Anulează')}
                            </button>
                            {inv.paymentId && (
                              <button type="button" className="btn ghost small" style={{ color: 'var(--danger, #dc2626)' }} disabled={busyId === inv.id}
                                onClick={() => markUnpaid(inv)}>
                                {t('invoices.markUnpaid', 'Marchează neplătită')}
                              </button>
                            )}
                          </div>
                        ) : payingId === inv.id ? (
                          <div className="row" style={{ gap: 4, alignItems: 'center', flexWrap: 'nowrap' }}>
                            <input
                              type="date"
                              className="input"
                              style={{ minWidth: 130 }}
                              value={payDate}
                              onChange={(e) => setPayDate(e.target.value)}
                              aria-label={t('invoices.paidDate', 'Data plată')}
                            />
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="input"
                              style={{ minWidth: 100 }}
                              value={payAmount}
                              onChange={(e) => setPayAmount(e.target.value)}
                              placeholder={t('invoices.paidAmount', 'Sumă plătită')}
                              aria-label={t('invoices.paidAmount', 'Sumă plătită')}
                            />
                            <button type="button" className="btn primary small" disabled={!payDate || !payAmount || busyId === inv.id}
                              onClick={() => markPaid(inv)}>
                              {t('invoices.confirm', 'Confirmă')}
                            </button>
                            <button type="button" className="btn ghost small" disabled={busyId === inv.id}
                              onClick={() => { setPayingId(null); setPayDate(''); setPayAmount('') }}>
                              {t('requests.cancel', 'Anulează')}
                            </button>
                          </div>
                        ) : (
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            <button type="button" className="btn ghost small" disabled={busyId === inv.id}
                              onClick={() => startEdit(inv, gross, paid)}>
                              {t('requests.edit', 'Editează')}
                            </button>
                            {!isPaid && (
                              <button type="button" className="btn secondary small" disabled={busyId === inv.id}
                                onClick={() => { setPayingId(inv.id); setPayDate(new Date().toISOString().slice(0, 10)); setPayAmount(due > 0.005 ? due.toFixed(2) : gross.toFixed(2)) }}>
                                {t('invoices.markPaid', 'Marchează plătită')}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border, #ddd)', fontWeight: 700 }}>
              <td colSpan={5} style={{ padding: '6px 8px' }}>{t('invoices.total', 'Total')} ({rows.length})</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {totalGross.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {totalPaid.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totalNetDue < -0.005 ? 'var(--success, #16a34a)' : undefined }}>
                {Math.abs(totalNetDue) > 0.005 ? `${totalNetDue.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON` : '—'}
              </td>
              <td colSpan={editable ? 4 : 3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
