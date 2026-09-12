import React from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { useMetadata, labelOf } from '../../../hooks/useMetadata'
import { DrawerShell } from '../../money/DrawerShell'
import { money } from '../../money/money-utils'
import { EMPTY_BANK_MAPPING, type Allocation, type BankLineMapping, type BankLineTarget, type Blocker, type IntakeContext, type IntakeRecordRow, type InvoiceHeader, type InvoiceMapping } from './intake-types'

// Per-record editor: the agent's extraction on the left (read-only, with its rationale and warnings),
// the mapping the app will apply on the right (editable). Save re-runs the checks; Approve additionally
// needs every remaining overridable blocker ticked. Hard blockers cannot be ticked away.
type Props = {
  record: IntakeRecordRow
  ctx: IntakeContext | null
  busy: boolean
  onClose: () => void
  onSave: (body: ReviewBody) => Promise<void>
  onApprove: (body: ReviewBody) => Promise<void>
}
export type ReviewBody = { invoice?: Partial<InvoiceHeader>; mapping?: InvoiceMapping | BankLineMapping; overrides?: string[] }
const TARGETS: BankLineTarget[] = ['OWNER_PAYMENT', 'VENDOR_SETTLEMENT', 'CASH_TX', 'IGNORE']
const CASH_KINDS = ['PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'OTHER'] as const

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const str = (v: unknown) => (v == null ? '' : String(v))

export function IntakeRecordDrawer({ record, ctx, busy, onClose, onSave, onApprove }: Props) {
  const { t, lang } = useI18n()
  const meta = useMetadata()
  const localized = (m: any) => (m ? (lang === 'en' ? m.labelEn || m.label : m.label) : null)
  const localizedHint = (m: any) => (m ? (lang === 'en' ? m.hintEn || m.hint : m.hint) : null)
  const blockerMeta = (c: string) => meta?.intakeBlockers?.find((m) => m.key === c)

  const isInvoice = record.kind === 'INVOICE'
  const isBank = record.kind === 'BANK_LINE'
  const locked = record.status === 'APPLIED' || record.status === 'STAGED' // staged values live on the template now; reopen to edit
  const [inv, setInv] = React.useState<InvoiceHeader>(() => ({ ...(record.effective?.invoice ?? record.extracted ?? {}) }))
  // bank line: the agent's mapping, completed with what the server resolved (suggested unit, account, default advance fund)
  const initialBank = (): BankLineMapping => {
    const line = record.extracted ?? {}
    // only a bank line's effective mapping is a BankLineMapping — an invoice's is an InvoiceMapping
    const eff = record.kind === 'BANK_LINE' ? ((record.effective as any)?.mapping as BankLineMapping | null | undefined) : null
    const m: BankLineMapping = structuredClone(eff ?? { ...EMPTY_BANK_MAPPING, target: (Number(line.amount) || 0) < 0 ? 'VENDOR_SETTLEMENT' : 'OWNER_PAYMENT', payerName: line.counterpartyName ?? null })
    const res = record.resolved ?? {}
    if (!m.unitCode && (res.unitCode || res.suggestedUnitCode)) m.unitCode = res.unitCode ?? res.suggestedUnitCode
    if (!m.accountCode && res.accountCode) m.accountCode = res.accountCode
    if (!m.advanceFundCode && (res.advanceFundCode || ctx?.defaultAdvanceFundCode)) m.advanceFundCode = res.advanceFundCode ?? ctx?.defaultAdvanceFundCode ?? null
    return m
  }
  const [bank, setBank] = React.useState<BankLineMapping>(initialBank)
  // the server may have matched the vendor by CUI/name even when the agent left vendorId null — show that
  const initialMap = () => {
    const m: InvoiceMapping = structuredClone((record.effective?.invoice ? record.effective.mapping : null) ?? { vendor: { match: 'UNKNOWN', vendorId: null, name: null, taxId: null, iban: null }, allocations: [], fallback: null, duplicateOf: null })
    const rv = record.resolved?.vendor
    if (!m.vendor.vendorId && rv?.vendorId) m.vendor = { ...m.vendor, match: 'EXISTING', vendorId: rv.vendorId, name: rv.name ?? m.vendor.name }
    return m
  }
  const [map, setMap] = React.useState<InvoiceMapping>(initialMap)
  const [overrides, setOverrides] = React.useState<string[]>(() => record.review?.overrides ?? [])
  React.useEffect(() => {
    setInv({ ...(record.effective?.invoice ?? record.extracted ?? {}) })
    setMap(initialMap())
    setBank(initialBank())
    setOverrides(record.review?.overrides ?? [])
  }, [record])
  const setB = (patch: Partial<BankLineMapping>) => setBank((b) => ({ ...b, ...patch }))
  const line = isBank ? (record.extracted ?? {}) : null
  const lineAmount = line ? Number(line.amount) || 0 : 0
  const fundSum = (bank.funds ?? []).reduce((s, f) => s + (Number(f.amount) || 0), 0)
  const unpaid = ctx?.unpaidInvoices ?? []
  const normNo = (v: string | null | undefined) => String(v ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  const invoiceChecked = (no: string | null) => bank.invoiceNumbers.some((n) => normNo(n) && normNo(no).endsWith(normNo(n)))
  const toggleInvoice = (no: string | null) => {
    if (!no) return
    setBank((b) => ({ ...b, invoiceNumbers: invoiceChecked(no) ? b.invoiceNumbers.filter((n) => !normNo(no).endsWith(normNo(n))) : [...b.invoiceNumbers, no] }))
  }

  const setHeader = (k: keyof InvoiceHeader, v: unknown) => setInv((s) => ({ ...s, [k]: v }))
  const setAlloc = (i: number, patch: Partial<Allocation>) => setMap((m) => ({ ...m, allocations: m.allocations.map((a, j) => (j === i ? { ...a, ...patch } : a)) }))
  const addAlloc = () => setMap((m) => ({ ...m, allocations: [...m.allocations, { templateCode: ctx?.templates[0]?.code ?? '', itemKey: ctx?.templates[0]?.items[0]?.key ?? '', amount: 0, reason: null }], fallback: null }))
  const removeAlloc = (i: number) => setMap((m) => ({ ...m, allocations: m.allocations.filter((_, j) => j !== i) }))
  const useFallback = () => setMap((m) => ({ ...m, allocations: [], fallback: { fundCode: ctx?.funds[0]?.code ?? null, expenseTypeCode: null } }))
  const setVendor = (vendorId: string) => {
    const v = ctx?.vendors.find((x) => x.id === vendorId)
    setMap((m) => ({ ...m, vendor: v ? { match: 'EXISTING', vendorId: v.id, name: v.name, taxId: v.taxId, iban: v.iban } : { match: 'NEW', vendorId: null, name: m.vendor.name ?? inv.vendorName ?? null, taxId: m.vendor.taxId ?? inv.vendorTaxId ?? null, iban: m.vendor.iban ?? inv.vendorIban ?? null } }))
  }

  const sum = map.allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const gross = inv.gross == null ? null : Number(inv.gross)
  const body = (): ReviewBody => isBank ? { mapping: bank, overrides } : ({
    invoice: {
      vendorName: inv.vendorName, vendorTaxId: inv.vendorTaxId, vendorIban: inv.vendorIban, number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate,
      servicePeriodStart: inv.servicePeriodStart, servicePeriodEnd: inv.servicePeriodEnd, currency: inv.currency, net: inv.net, vat: inv.vat, gross: inv.gross,
    },
    mapping: map,
    overrides,
  })
  const hard = record.blockers.filter((b) => !b.overridable)
  const soft = record.blockers.filter((b) => b.overridable)
  const toggle = (code: string) => setOverrides((o) => (o.includes(code) ? o.filter((c) => c !== code) : [...o, code]))

  return (
    <DrawerShell open onClose={onClose} width={900} title={<span>#{record.index} · {record.sourceFile ?? record.kind} <span className={`badge ${meta?.intakeRecordStatuses?.find((m) => m.key === record.status)?.tone || ''}`} style={{ marginLeft: 8 }}>{localized(meta?.intakeRecordStatuses?.find((m) => m.key === record.status)) || record.status}</span></span>}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── left: what the agent read ── */}
        <div className="stack" style={{ flex: '1 1 300px', gap: 10 }}>
          <div className="label">{t('intake.drawer.agent', 'What the agent read')}</div>
          {record.rationale && <div style={{ fontSize: 13 }}><em>{record.rationale}</em></div>}
          {record.confidence != null && <div className="muted" style={{ fontSize: 12 }}>{t('intake.col.confidence', 'Conf.')}: {Math.round(record.confidence * 100)}%</div>}
          <pre style={{ fontSize: 11, background: 'var(--field-bg)', padding: 10, borderRadius: 8, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.extracted, null, 2)}</pre>
          {record.kind === 'INVOICE' && record.proposal && (
            <details><summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>{t('intake.drawer.proposal', 'Agent\'s original mapping')}</summary>
              <pre style={{ fontSize: 11, background: 'var(--field-bg)', padding: 10, borderRadius: 8, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.proposal, null, 2)}</pre>
            </details>
          )}
          {isInvoice && record.appliedRefs && <div className="muted" style={{ fontSize: 12 }}>{t('intake.drawer.applied', 'Applied')}: {(record.appliedRefs.vendorInvoiceIds ?? []).length} {t('intake.drawer.invoices', 'invoice(s)')}, {(record.appliedRefs.templateInstanceIds ?? []).length} {t('intake.drawer.templates', 'template(s)')}</div>}
          {record.error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{record.error}</div>}
          {record.status === 'STAGED' && <div className="badge warning">{t('intake.msg.waitingFor', { types: (record.appliedRefs?.waitingFor ?? []).join(', ') })}</div>}
        </div>

        {/* ── right: what will be applied ── */}
        <div className="stack" style={{ flex: '1 1 380px', gap: 10 }}>
          {isBank ? (
            <>
              <div className="label">{t('intake.drawer.bankLine', 'Bank line')}</div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: lineAmount < 0 ? 'var(--danger)' : 'var(--success, inherit)' }}>{money(lineAmount, line?.currency ?? 'RON')}</strong> · {line?.date ?? '?'} · {line?.counterpartyName ?? '—'}
                {line?.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{line.description}</div>}
                {line?.reference && <div className="muted" style={{ fontSize: 11 }}>{t('intake.form.reference', 'Reference')}: {line.reference}</div>}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <label className="stack" style={{ gap: 2, flex: '1 1 180px' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.target', 'Book as')}</span>
                  <select className="input" value={bank.target} disabled={locked} onChange={(e) => setB({ target: e.target.value as BankLineTarget })}>
                    {TARGETS.map((x) => <option key={x} value={x}>{localized(meta?.intakeBankTargets?.find((m) => m.key === x)) || t(`intake.target.${x}`, x)}</option>)}
                  </select>
                </label>
                <label className="stack" style={{ gap: 2, flex: '1 1 180px' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.account', 'Bank account')}</span>
                  <select className="input" value={bank.accountCode ?? ''} disabled={locked} onChange={(e) => setB({ accountCode: e.target.value || null })}>
                    <option value="">{t('intake.form.accountAuto', '(by currency)')}</option>
                    {ctx?.cashAccounts.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.name} · {a.currency}</option>)}
                  </select>
                </label>
              </div>

              {bank.target === 'OWNER_PAYMENT' && (
                <>
                  <label className="stack" style={{ gap: 2 }}>
                    <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.unit', 'Unit · owner')}{record.resolved?.suggestedUnitCode && !record.resolved?.unitCode ? ` — ${t('intake.form.unitSuggested', 'suggested by payer name')}` : ''}</span>
                    <select className="input" value={bank.unitCode ?? ''} disabled={locked} onChange={(e) => setB({ unitCode: e.target.value || null })}>
                      <option value="">{t('intake.form.unitNone', '(not identified)')}{bank.payerName ? ` — ${bank.payerName}` : ''}</option>
                      {ctx?.units.map((u) => <option key={u.id} value={u.code}>{u.label} · {u.billingEntityName ?? '?'}</option>)}
                    </select>
                  </label>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="label" style={{ margin: 0 }}>{t('intake.form.namedFunds', 'Funds named on the line')}</div>
                    {!locked && <button className="btn tertiary small" onClick={() => setB({ funds: [...bank.funds, { fundCode: ctx?.funds[0]?.code ?? '', amount: 0 }] })}>{t('intake.form.addRow', '+ line')}</button>}
                  </div>
                  {bank.funds.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t('intake.form.noFundsHint', 'None: the whole amount is spread over the owner\'s open charges by the community\'s rule; any surplus becomes an advance.')}</div>}
                  {bank.funds.map((f, i) => (
                    <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <select className="input" value={f.fundCode} disabled={locked} onChange={(e) => setB({ funds: bank.funds.map((x, j) => (j === i ? { ...x, fundCode: e.target.value } : x)) })}>
                        {!ctx?.funds.some((x) => x.code === f.fundCode) && <option value={f.fundCode}>{f.fundCode} ?</option>}
                        {ctx?.funds.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                      </select>
                      <input className="input" style={{ width: 110, textAlign: 'right' }} value={str(f.amount)} disabled={locked} onChange={(e) => setB({ funds: bank.funds.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) ?? 0 } : x)) })} />
                      {!locked && <button className="btn tertiary small" onClick={() => setB({ funds: bank.funds.filter((_, j) => j !== i) })}>×</button>}
                    </div>
                  ))}
                  {bank.funds.length > 0 && <div className="muted" style={{ fontSize: 12, textAlign: 'right', color: fundSum > lineAmount + 0.005 ? 'var(--danger)' : undefined }}>{t('intake.form.sum', 'Sum')} {money(fundSum, line?.currency ?? 'RON')} / {money(lineAmount, line?.currency ?? 'RON')}</div>}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <label className="stack" style={{ gap: 2, flex: '1 1 180px' }}>
                      <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.advanceFund', 'Surplus goes to')}</span>
                      <select className="input" value={bank.advanceFundCode ?? ''} disabled={locked} onChange={(e) => setB({ advanceFundCode: e.target.value || null })}>
                        <option value="">{t('intake.form.fund', 'Fund')}…</option>
                        {ctx?.funds.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                      </select>
                    </label>
                    <Field label={t('intake.form.cycle', 'Cycle month (if named)')} value={str(bank.cycleCode)} onChange={(v) => setB({ cycleCode: v || null })} disabled={locked} placeholder={ctx?.period?.code ?? 'YYYY-MM'} />
                  </div>
                  {record.resolved?.billingEntityName && <div className="muted" style={{ fontSize: 12 }}>→ {record.resolved.billingEntityName}{record.resolved.cycleCode ? ` · ${record.resolved.cycleCode}` : ''}</div>}
                </>
              )}

              {bank.target === 'VENDOR_SETTLEMENT' && (
                <>
                  <div className="label" style={{ margin: 0 }}>{t('intake.form.settles', 'Settles invoice(s)')}</div>
                  {bank.invoiceNumbers.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('intake.form.quoted', 'Quoted on the line')}: {bank.invoiceNumbers.join(', ')}{bank.vendorName ? ` · ${bank.vendorName}` : ''}</div>}
                  {unpaid.length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t('intake.form.noUnpaid', 'No unpaid invoices in the books.')}</div>}
                  {unpaid.length > 0 && (
                    <div className="stack" style={{ gap: 4, maxHeight: 220, overflow: 'auto', fontSize: 13 }}>
                      {unpaid.map((u) => (
                        <label key={u.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <input type="checkbox" checked={invoiceChecked(u.number)} disabled={locked || !u.number} onChange={() => toggleInvoice(u.number)} />
                          <span style={{ flex: 1 }}>{u.vendorName ?? '?'} · {u.number ?? '—'}</span>
                          <span className="muted">{money(u.outstanding, line?.currency ?? 'RON')}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {(record.resolved?.invoices?.length ?? 0) > 0 && <div className="muted" style={{ fontSize: 12 }}>→ {record.resolved.invoices.map((x: any) => `${x.vendorName ?? '?'} ${x.number}`).join(', ')} · {t('intake.form.outstanding', 'outstanding')} {money(record.resolved.outstandingTotal, line?.currency ?? 'RON')}</div>}
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <label className="stack" style={{ gap: 2, flex: '1 1 180px' }}>
                      <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.fallbackFund', 'If no invoice matches: fund')}</span>
                      <select className="input" value={bank.fundCode ?? ''} disabled={locked} onChange={(e) => setB({ fundCode: e.target.value || null })}>
                        <option value="">{t('intake.form.fund', 'Fund')}…</option>
                        {ctx?.funds.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                      </select>
                    </label>
                  </div>
                </>
              )}

              {bank.target === 'CASH_TX' && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <label className="stack" style={{ gap: 2, flex: '1 1 160px' }}>
                    <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.fund', 'Fund')}</span>
                    <select className="input" value={bank.fundCode ?? ''} disabled={locked} onChange={(e) => setB({ fundCode: e.target.value || null })}>
                      <option value="">{t('intake.form.fund', 'Fund')}…</option>
                      {ctx?.funds.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 2, flex: '1 1 160px' }}>
                    <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.expenseType', 'Expense type')}</span>
                    <select className="input" value={bank.expenseTypeCode ?? ''} disabled={locked} onChange={(e) => setB({ expenseTypeCode: e.target.value || null })}>
                      <option value="">—</option>
                      {ctx?.expenseTypes.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 2, flex: '1 1 120px' }}>
                    <span className="muted" style={{ fontSize: 11 }}>{t('intake.form.kind', 'Kind')}</span>
                    <select className="input" value={bank.kind ?? ''} disabled={locked} onChange={(e) => setB({ kind: (e.target.value || null) as BankLineMapping['kind'] })}>
                      <option value="">OTHER</option>
                      {CASH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </label>
                </div>
              )}

              {bank.target === 'IGNORE' && <Field label={t('intake.form.reason', 'Reason')} value={str(bank.reason)} onChange={(v) => setB({ reason: v || null })} disabled={locked} />}

              {record.appliedRefs?.target && record.status === 'APPLIED' && (
                <div className="muted" style={{ fontSize: 12 }}>
                  {record.appliedRefs.paymentId && <>{t('intake.drawer.appliedPayment', 'Receipt booked')}: {money(record.appliedRefs.applied ?? 0, line?.currency ?? 'RON')} {t('intake.drawer.onCharges', 'on charges')}{(record.appliedRefs.advance ?? 0) > 0 ? `, ${money(record.appliedRefs.advance, line?.currency ?? 'RON')} ${t('intake.drawer.asAdvance', 'as advance')}` : ''}</>}
                  {record.appliedRefs.vendorPaymentIds?.length > 0 && <>{t('intake.drawer.appliedSettlement', 'Settlement booked')}: {record.appliedRefs.vendorPaymentIds.length} {t('intake.drawer.invoices', 'invoice(s)')}</>}
                  {record.appliedRefs.cashTxId && <>{t('intake.drawer.appliedCashTx', 'Cash transaction booked')}</>}
                </div>
              )}
            </>
          ) : !isInvoice ? (
            <div className="badge">{t('intake.drawer.otherDoc', 'Other documents are stored for reference; they can only be skipped.')}</div>
          ) : (
            <>
              <div className="label">{t('intake.drawer.invoice', 'Invoice')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Field label={t('intake.form.number', 'Number')} value={str(inv.number)} onChange={(v) => setHeader('number', v || null)} disabled={locked} />
                <Field label={t('intake.form.issueDate', 'Issued')} value={str(inv.issueDate)} onChange={(v) => setHeader('issueDate', v || null)} disabled={locked} placeholder="YYYY-MM-DD" />
                <Field label={t('intake.form.dueDate', 'Due')} value={str(inv.dueDate)} onChange={(v) => setHeader('dueDate', v || null)} disabled={locked} placeholder="YYYY-MM-DD" />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Field label={t('intake.form.net', 'Net')} value={str(inv.net)} onChange={(v) => setHeader('net', num(v))} disabled={locked} />
                <Field label={t('intake.form.vat', 'VAT')} value={str(inv.vat)} onChange={(v) => setHeader('vat', num(v))} disabled={locked} />
                <Field label={t('intake.form.gross', 'Gross')} value={str(inv.gross)} onChange={(v) => setHeader('gross', num(v))} disabled={locked} />
                <Field label={t('intake.form.servicePeriod', 'Service period')} value={str(inv.servicePeriodStart)} onChange={(v) => setHeader('servicePeriodStart', v || null)} disabled={locked} placeholder="YYYY-MM" />
                <Field label="→" value={str(inv.servicePeriodEnd)} onChange={(v) => setHeader('servicePeriodEnd', v || null)} disabled={locked} placeholder="YYYY-MM" />
              </div>

              <div className="label">{t('intake.form.vendor', 'Vendor')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="input" value={map.vendor.vendorId ?? ''} disabled={locked} onChange={(e) => setVendor(e.target.value)}>
                  <option value="">{t('intake.form.vendorNew', '(new vendor)')}: {map.vendor.name ?? inv.vendorName ?? '?'}</option>
                  {ctx?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.taxId ? ` · ${v.taxId}` : ''}</option>)}
                </select>
                {!map.vendor.vendorId && <Field label={t('intake.form.vendorName', 'Name')} value={str(map.vendor.name ?? inv.vendorName)} onChange={(v) => setMap((m) => ({ ...m, vendor: { ...m.vendor, match: 'NEW', name: v || null } }))} disabled={locked} />}
              </div>

              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="label" style={{ margin: 0 }}>{t('intake.form.allocations', 'Allocations to templates')}</div>
                {!locked && <div className="row" style={{ gap: 6 }}>
                  <button className="btn tertiary small" onClick={addAlloc}>{t('intake.form.addRow', '+ line')}</button>
                  <button className="btn tertiary small" onClick={useFallback}>{t('intake.form.useFallback', 'No template')}</button>
                </div>}
              </div>
              {map.allocations.length > 0 && (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>{t('intake.form.template', 'Template')}</th><th>{t('intake.form.item', 'Item')}</th><th style={{ textAlign: 'right' }}>{t('intake.form.amount', 'Amount')}</th><th></th></tr></thead>
                  <tbody>
                    {map.allocations.map((a, i) => {
                      const tpl = ctx?.templates.find((x) => x.code === a.templateCode)
                      const submitted = tpl?.instanceState === 'SUBMITTED' || tpl?.instanceState === 'CLOSED'
                      return (
                        <tr key={i}>
                          <td>
                            <select className="input" value={a.templateCode} disabled={locked} onChange={(e) => { const nt = ctx?.templates.find((x) => x.code === e.target.value); setAlloc(i, { templateCode: e.target.value, itemKey: nt?.items[0]?.key ?? '' }) }}>
                              {!tpl && <option value={a.templateCode}>{a.templateCode} ?</option>}
                              {ctx?.templates.map((x) => <option key={x.code} value={x.code}>{x.code}{x.vendorName ? ` · ${x.vendorName}` : ''}{x.instanceState === 'SUBMITTED' || x.instanceState === 'CLOSED' ? ' ✓' : ''}</option>)}
                            </select>
                            {submitted && <div className="muted" style={{ fontSize: 11 }}>{t('intake.form.alreadySubmitted', 'already submitted this period')}</div>}
                          </td>
                          <td>
                            <select className="input" value={a.itemKey} disabled={locked} onChange={(e) => setAlloc(i, { itemKey: e.target.value })}>
                              {!tpl?.items.some((it) => it.key === a.itemKey) && <option value={a.itemKey}>{a.itemKey} ?</option>}
                              {tpl?.items.map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }}><input className="input" style={{ width: 110, textAlign: 'right' }} value={str(a.amount)} disabled={locked} onChange={(e) => setAlloc(i, { amount: num(e.target.value) ?? 0 })} /></td>
                          <td>{!locked && <button className="btn tertiary small" onClick={() => removeAlloc(i)}>×</button>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={2} style={{ textAlign: 'right' }} className="muted">{t('intake.form.sum', 'Sum')}</td><td style={{ textAlign: 'right', color: gross != null && Math.abs(sum - gross) > 0.01 ? 'var(--danger)' : undefined }}>{money(sum, inv.currency ?? 'RON')}{gross != null ? ` / ${money(gross, inv.currency ?? 'RON')}` : ''}</td><td></td></tr></tfoot>
                </table>
              )}
              {map.allocations.length === 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>{t('intake.form.fallbackHint', 'No template: the invoice is recorded on a fund, without expense lines.')}</span>
                  <select className="input" value={map.fallback?.fundCode ?? ''} disabled={locked} onChange={(e) => setMap((m) => ({ ...m, fallback: { fundCode: e.target.value || null, expenseTypeCode: m.fallback?.expenseTypeCode ?? null } }))}>
                    <option value="">{t('intake.form.fund', 'Fund')}…</option>
                    {ctx?.funds.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.name}</option>)}
                  </select>
                  <select className="input" value={map.fallback?.expenseTypeCode ?? ''} disabled={locked} onChange={(e) => setMap((m) => ({ ...m, fallback: { fundCode: m.fallback?.fundCode ?? null, expenseTypeCode: e.target.value || null } }))}>
                    <option value="">{t('intake.form.expenseType', 'Expense type')}…</option>
                    {ctx?.expenseTypes.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {(hard.length > 0 || soft.length > 0) && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="label">{t('intake.drawer.blockers', 'Checks')}</div>
              {hard.map((b, i) => <BlockerRow key={`h${i}`} b={b} label={localized(blockerMeta(b.code)) || labelOf(meta?.intakeBlockers, b.code)} hint={localizedHint(blockerMeta(b.code))} />)}
              {soft.map((b, i) => (
                <label key={`s${i}`} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                  <input type="checkbox" checked={overrides.includes(b.code)} disabled={locked} onChange={() => toggle(b.code)} />
                  <span><strong>{localized(blockerMeta(b.code)) || labelOf(meta?.intakeBlockers, b.code)}</strong> — {b.message}{localizedHint(blockerMeta(b.code)) && <div className="muted" style={{ fontSize: 12 }}>{localizedHint(blockerMeta(b.code))}</div>}</span>
                </label>
              ))}
              {hard.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('intake.drawer.hardHint', 'Red checks must be fixed (in the mapping above, or in the community setup) — they cannot be acknowledged.')}</div>}
            </div>
          )}

          {(isInvoice || isBank) && !locked && (
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn secondary" disabled={busy} onClick={() => onSave(body())}>{t('intake.action.save', 'Save & re-check')}</button>
              <button className="btn" disabled={busy || hard.length > 0 || soft.some((b) => !overrides.includes(b.code))} onClick={() => onApprove(body())}>{t('intake.action.approve', 'Approve')}</button>
            </div>
          )}
        </div>
      </div>
    </DrawerShell>
  )
}

function Field({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <label className="stack" style={{ gap: 2, minWidth: 120, flex: '1 1 120px' }}>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <input className="input" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function BlockerRow({ b, label, hint }: { b: Blocker; label: string; hint: string | null }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span className="badge negative">{label}</span> {b.message}
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  )
}
