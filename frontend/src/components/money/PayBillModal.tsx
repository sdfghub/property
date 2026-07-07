import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { DrawerShell } from './DrawerShell'
import { CashAccountSelect } from './CashAccountSelect'
import { FundSelect } from './FundSelect'
import { ReceiptPrintView, ReceiptData } from './ReceiptPrintView'
import { money, num2 } from './money-utils'

type Invoice = { id: string; number?: string; vendor?: string; currency?: string; gross: number; paid: number; outstanding: number; dueDate?: string | null }

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('ro-RO') : '')
// Unpaid + due date in the past = overdue (day granularity, local midnight).
const isOverdue = (d?: string | null) => !!d && new Date(d) < new Date(new Date().toDateString())

export function PayBillModal({
  communityId,
  communityCode,
  communityName,
  preselectInvoiceId,
  open,
  onClose,
  onDone,
}: {
  communityId: string
  communityCode: string
  communityName?: string
  preselectInvoiceId?: string
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const today = new Date().toISOString().slice(0, 10)
  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [loadingList, setLoadingList] = React.useState(false)
  const [invoiceId, setInvoiceId] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [ts, setTs] = React.useState(today)
  const [method, setMethod] = React.useState('')
  const [refId, setRefId] = React.useState('')
  const [accountId, setAccountId] = React.useState('')
  const [accountName, setAccountName] = React.useState('')
  const [fundId, setFundId] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<{ paid: number; remaining: number } | null>(null)
  const [receipt, setReceipt] = React.useState<ReceiptData | null>(null)

  const loadList = React.useCallback(() => {
    setLoadingList(true)
    return api.get<any>(`/communities/${communityId}/finance/vendor-invoices/unpaid`)
      .then((d) => setInvoices(d?.invoices || []))
      .catch(() => setInvoices([]))
      .finally(() => setLoadingList(false))
  }, [api, communityId])

  React.useEffect(() => { if (open) loadList() }, [open, loadList])
  React.useEffect(() => { if (open && preselectInvoiceId) setInvoiceId(preselectInvoiceId) }, [open, preselectInvoiceId])

  const inv = invoices.find((i) => i.id === invoiceId)
  const outstanding = num2(inv?.outstanding)
  const currency = inv?.currency || 'RON'
  const amt = num2(amount)
  const exceeds = amt > outstanding + 0.005

  React.useEffect(() => {
    if (inv) setAmount(String(num2(inv.outstanding)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId])

  function reset() {
    setInvoiceId(''); setAmount(''); setTs(today); setMethod(''); setRefId('')
    setFundId(''); setError(null); setSuccess(null); setReceipt(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!invoiceId || !amt) return
    if (!fundId) { setError(t('paybill.needFund', 'Alegeți fondul din care se plătește.')); return }
    if (!accountId) { setError(t('receipt.needAccount', 'Alegeți un cont / casierie.')); return }
    if (exceeds) { setError(t('paybill.exceeds', 'Suma depășește restul de plată.')); return }
    setSubmitting(true); setError(null)
    try {
      await api.post(`/communities/${communityId}/invoices/${invoiceId}/payments`, {
        amount: amt,
        currency,
        ts: ts || undefined,
        method: method || undefined,
        refId: refId || undefined,
        accountId: accountId || undefined,
        fundId: fundId || undefined,
      })
      setSuccess({ paid: amt, remaining: num2(outstanding - amt) })
      setReceipt({
        kind: 'OUT',
        number: refId || `${inv?.number || 'INV'}-${ts}`,
        date: ts || today,
        party: inv?.vendor || inv?.number || invoiceId,
        amount: amt,
        currency,
        method: method || undefined,
        accountName: accountName || undefined,
        communityName,
        lines: [{ label: `${t('paybill.invoice', 'Factură')} ${inv?.number || ''}`.trim(), amount: amt }],
      })
      onDone()
    } catch (err: any) {
      setError(err?.message || t('common.error', 'Eroare'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DrawerShell open={open} onClose={() => { reset(); onClose() }} title={t('money.payBill', 'Plată furnizor')}>
      {success ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="badge positive" style={{ alignSelf: 'flex-start' }}>{t('paybill.success', 'Plată înregistrată')}</div>
          <div className="card soft">
            <div>{t('paybill.paid', 'Plătit')}: <strong>{money(success.paid, currency)}</strong></div>
            <div className="muted">{t('paybill.remaining', 'Rest de plată')}: {money(success.remaining, currency)}</div>
          </div>
          {receipt && <ReceiptPrintView data={receipt} />}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn primary small" type="button" onClick={reset}>{t('paybill.another', 'Altă plată')}</button>
            <button className="btn ghost small" type="button" onClick={() => { reset(); onClose() }}>{t('common.close', 'Închide')}</button>
          </div>
        </div>
      ) : (
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="label">{t('paybill.invoice', 'Factură')}</label>
            {loadingList ? <div className="muted">{t('common.loading', 'Loading…')}</div> : (
              <select className="input" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                <option value="">{t('paybill.select', 'Selectează factura')}</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {(i.number || '—')} · {i.vendor || '—'} · {money(i.outstanding, i.currency)}{i.dueDate ? ` · scad. ${fmtDate(i.dueDate)}${isOverdue(i.dueDate) ? ' ⚠' : ''}` : ''}
                  </option>
                ))}
              </select>
            )}
            {inv && <div className="muted">{t('paybill.outstanding', 'Rest de plată')}: {money(outstanding, currency)}</div>}
            {inv?.dueDate && (
              <div className="muted" style={{ color: isOverdue(inv.dueDate) ? 'var(--danger, #dc2626)' : undefined, fontWeight: isOverdue(inv.dueDate) ? 600 : undefined }}>
                {t('paybill.due', 'Scadență')}: {fmtDate(inv.dueDate)}{isOverdue(inv.dueDate) ? ` — ${t('unpaid.overdue', 'depășită')}` : ''}
              </div>
            )}
            {!loadingList && invoices.length === 0 && <div className="empty">{t('unpaid.clear', 'Toate facturile sunt plătite 🎉')}</div>}
          </div>

          {inv && (
            <>
              <div className="stack" style={{ gap: 6 }}>
                <label className="label">{t('receipt.amount', 'Sumă')}</label>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" type="number" step="0.01" style={{ width: 140 }} value={amount}
                    onChange={(e) => setAmount(e.target.value)} required />
                  <button type="button" className="btn ghost small" onClick={() => setAmount(String(outstanding))}>
                    {t('paybill.payFull', 'Plătește integral')}
                  </button>
                </div>
              </div>

              <FundSelect communityCode={communityCode} value={fundId}
                label={t('paybill.fund', 'Plătește din fond')}
                onChange={(id) => { setFundId(id) }} />

              <CashAccountSelect communityId={communityId} value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccountName(acc?.name || '') }} />

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <div className="stack" style={{ gap: 4 }}>
                  <label className="label">{t('receipt.date', 'Data')}</label>
                  <input className="input" type="date" value={ts} onChange={(e) => setTs(e.target.value)} />
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  <label className="label">{t('receipt.method', 'Metodă')}</label>
                  <input className="input" style={{ width: 130 }} placeholder="transfer / cash" value={method} onChange={(e) => setMethod(e.target.value)} />
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  <label className="label">{t('receipt.ref', 'Referință')}</label>
                  <input className="input" style={{ width: 130 }} value={refId} onChange={(e) => setRefId(e.target.value)} />
                </div>
              </div>

              <div className="card soft muted" style={{ fontSize: 13 }}>
                {t('paybill.previewLead', 'Se plătește')} {money(amt, currency)} {t('paybill.previewOf', 'din')} {money(outstanding, currency)}
                {inv.vendor ? ` ${t('paybill.previewTo', 'către')} ${inv.vendor}` : ''}
                {accountName ? ` · ${t('paybill.previewFrom', 'din')} ${accountName}` : ''}.
              </div>

              {exceeds && <div className="badge warn">{t('paybill.exceedsWarn', 'Suma depășește restul de plată.')}</div>}
              {error && <div className="badge negative">{error}</div>}

              <button className="btn primary" type="submit" disabled={submitting || exceeds || !amt}>
                {submitting ? t('common.loading', '…') : t('common.confirm', 'Plătește')}
              </button>
            </>
          )}
        </form>
      )}
    </DrawerShell>
  )
}
