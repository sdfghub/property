// Deterministic checks that turn an agent's proposal into something an admin can trust — or into a
// list of reasons why not. Pure functions over the catalogue so they run identically at import, on
// every review save, in `intake:validate`, and again right before apply.
import { INTAKE_BLOCKER_META } from '../../common/enums-meta'
import type { IntakeCatalogue } from './intake-prompt.service'
import type { BankLineMapping, InvoiceMapping } from './intake-contract'

export type Blocker = { code: string; message: string; path?: string; overridable: boolean }

const OVERRIDABLE = new Map(INTAKE_BLOCKER_META.map((m) => [m.key, m.overridable]))
export const isOverridable = (code: string) => OVERRIDABLE.get(code) === true
export const isHard = (b: Blocker) => !b.overridable

/** "AQUATIM S.A." / "S.C. Aquatim SA" / "Aquatim" → "aquatim". */
export function normalizeVendorName(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?c\.?|s\.?r\.?l\.?|s\.?a\.?|p\.?f\.?a\.?|i\.?i\.?|srl|sa|sc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export const normalizeInvoiceNumber = (v: string) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '')
const normTaxId = (v: string | null | undefined) => String(v ?? '').replace(/^ro/i, '').replace(/\D/g, '')
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const r2 = (n: number) => Math.round(n * 100) / 100

export type ResolvedVendor = { vendorId: string | null; name: string | null; how: 'ID' | 'TAX_ID' | 'NAME' | 'NEW' | 'NONE' }

export function resolveVendor(mapping: InvoiceMapping['vendor'], invoiceVendorName: string | null, invoiceTaxId: string | null, catalogue: IntakeCatalogue): ResolvedVendor {
  const byId = mapping.vendorId ? catalogue.vendors.find((v) => v.id === mapping.vendorId) : null
  if (byId) return { vendorId: byId.id, name: byId.name, how: 'ID' }
  const taxId = normTaxId(mapping.taxId ?? invoiceTaxId)
  if (taxId) {
    const v = catalogue.vendors.find((x) => normTaxId(x.taxId) === taxId)
    if (v) return { vendorId: v.id, name: v.name, how: 'TAX_ID' }
  }
  const wanted = normalizeVendorName(mapping.name ?? invoiceVendorName)
  if (wanted) {
    const v = catalogue.vendors.find((x) => {
      const have = normalizeVendorName(x.name)
      return have === wanted || have.includes(wanted) || wanted.includes(have)
    })
    if (v) return { vendorId: v.id, name: v.name, how: 'NAME' }
  }
  if (mapping.match === 'NEW' && (mapping.name || invoiceVendorName)) return { vendorId: null, name: mapping.name ?? invoiceVendorName, how: 'NEW' }
  return { vendorId: null, name: mapping.name ?? invoiceVendorName, how: 'NONE' }
}

export type InvoiceCheckInput = {
  invoice: any // InvoiceBlock (extracted)
  mapping: InvoiceMapping // effective = review ?? proposal
  confidence: number | null
  sourceSha256: string | null
  /** sibling records in the same batch, for in-batch duplicate detection */
  siblings: Array<{ id: string; number: string | null; vendorKey: string; sha256: string | null }>
  selfId: string
  /** templates this very record already submitted (appliedRefs.attemptedTemplates) — a retry after a
   *  partial failure must not be blocked by its own earlier attempt */
  ownTemplates?: string[]
}

export type InvoiceCheckResult = {
  blockers: Blocker[]
  resolved: {
    vendor: ResolvedVendor
    templates: string[]
    duplicateOfInvoiceId: string | null
    duplicateOfRecordId: string | null
    allocationsTotal: number
    /** template → itemKey → amount, with each template's existing FILLED values merged (for the UI preview) */
    byTemplate: Record<string, Record<string, number>>
  }
}

export function checkInvoice(input: InvoiceCheckInput, catalogue: IntakeCatalogue): InvoiceCheckResult {
  const { invoice, mapping } = input
  const blockers: Blocker[] = []
  const push = (code: string, message: string, path?: string) => blockers.push({ code, message, path, overridable: isOverridable(code) })

  if (catalogue.period.status !== 'OPEN') push('PERIOD_NOT_OPEN', `Period ${catalogue.period.code} is ${catalogue.period.status}`)

  const vendor = resolveVendor(mapping.vendor, invoice?.vendorName ?? null, invoice?.vendorTaxId ?? null, catalogue)
  if (vendor.how === 'NONE' || vendor.how === 'NEW') push('VENDOR_UNKNOWN', vendor.name ? `"${vendor.name}" is not a known vendor` : 'No vendor identified', 'mapping.vendor')

  const gross = money(invoice?.gross)
  const net = money(invoice?.net)
  const vat = money(invoice?.vat)
  if (gross != null && net != null && vat != null && Math.abs(net + vat - gross) > 0.01) {
    push('AMOUNT_MISMATCH', `net ${r2(net)} + vat ${r2(vat)} ≠ gross ${r2(gross)}`, 'invoice.gross')
  }

  const allocations = Array.isArray(mapping.allocations) ? mapping.allocations : []
  const byTemplate: Record<string, Record<string, number>> = {}
  const templates = new Set<string>()
  let total = 0
  allocations.forEach((a, i) => {
    const t = catalogue.templates.find((x) => x.code === a.templateCode)
    const path = `mapping.allocations[${i}]`
    if (!t) return push('UNKNOWN_TEMPLATE', `Template "${a.templateCode}" does not exist`, path)
    templates.add(t.code)
    const item = t.items.find((x) => x.key === a.itemKey)
    if (!item) return push('UNKNOWN_ITEM', `Template ${t.code} has no item "${a.itemKey}"`, path)
    if (item.expenseTypeCode) {
      const et = catalogue.expenseTypes.find((x) => x.code === item.expenseTypeCode)
      if (!et) push('UNKNOWN_EXPENSE_TYPE', `Expense type "${item.expenseTypeCode}" (item ${a.itemKey}) does not exist`, path)
      else if (!et.fundCode) push('EXPENSE_TYPE_NO_FUND', `Expense type ${et.code} has no fundCode configured`, path)
    }
    const amt = money(a.amount) ?? 0
    total += amt
    byTemplate[t.code] = byTemplate[t.code] || {}
    byTemplate[t.code][item.key] = r2((byTemplate[t.code][item.key] ?? 0) + amt)
    if ((t.instanceState === 'SUBMITTED' || t.instanceState === 'CLOSED') && !(input.ownTemplates ?? []).includes(t.code)) {
      if (!blockers.some((b) => b.code === 'TEMPLATE_ALREADY_SUBMITTED' && b.path === `mapping.allocations.${t.code}`))
        push('TEMPLATE_ALREADY_SUBMITTED', `Template ${t.code} is already ${t.instanceState} for ${catalogue.period.code}`, `mapping.allocations.${t.code}`)
    }
    if (t.vendorName && vendor.name && normalizeVendorName(t.vendorName) !== normalizeVendorName(vendor.name)) {
      const norm = (s: string) => normalizeVendorName(s)
      const a1 = norm(t.vendorName), a2 = norm(vendor.name)
      if (!(a1.includes(a2) || a2.includes(a1)) && !blockers.some((b) => b.code === 'VENDOR_MISMATCH'))
        push('VENDOR_MISMATCH', `Template ${t.code} is configured for "${t.vendorName}", invoice vendor is "${vendor.name}"`, 'mapping.vendor')
    }
  })
  total = r2(total)
  // merge-not-clobber: a hand-entered value on a FILLED instance is never silently overwritten
  for (const [code, items] of Object.entries(byTemplate)) {
    const t = catalogue.templates.find((x) => x.code === code)
    for (const [key, amt] of Object.entries(items)) {
      if ((input.ownTemplates ?? []).includes(code)) continue // values this record staged itself are not a conflict
      const existing = money((t?.instanceValues as any)?.[key])
      if (existing != null && Math.abs(existing - amt) > 0.005) push('VALUE_CONFLICT', `Template ${code} already holds ${key} = ${existing} (import says ${amt})`, `mapping.allocations.${code}.${key}`)
    }
  }

  if (!allocations.length) {
    const fb = mapping.fallback
    if (!fb || (!fb.fundCode && !fb.expenseTypeCode)) push('NO_ALLOCATION', 'No template allocation and no fallback fund/expense type', 'mapping')
    else {
      if (fb.fundCode && !catalogue.funds.some((f) => f.code === fb.fundCode)) push('UNKNOWN_FUND', `Fund "${fb.fundCode}" does not exist`, 'mapping.fallback.fundCode')
      if (fb.expenseTypeCode && !catalogue.expenseTypes.some((e) => e.code === fb.expenseTypeCode)) push('UNKNOWN_EXPENSE_TYPE', `Expense type "${fb.expenseTypeCode}" does not exist`, 'mapping.fallback.expenseTypeCode')
      if (!fb.fundCode) {
        const et = catalogue.expenseTypes.find((e) => e.code === fb.expenseTypeCode)
        if (et && !et.fundCode) push('EXPENSE_TYPE_NO_FUND', `Expense type ${et.code} has no fundCode configured`, 'mapping.fallback')
        if (!et) push('UNKNOWN_FUND', 'Fallback needs a fund code', 'mapping.fallback.fundCode')
      }
    }
  } else if (gross != null && Math.abs(total - gross) > 0.01) {
    push('ALLOCATION_SUM_MISMATCH', `allocations sum to ${total}, invoice gross is ${r2(gross)}`, 'mapping.allocations')
  }

  const start = invoice?.servicePeriodStart as string | null
  const end = invoice?.servicePeriodEnd as string | null
  const target = catalogue.period.code
  const prev = prevPeriodCode(target)
  const within = (p: string | null) => !p || p === target || p === prev
  if (!within(start) || !within(end)) push('PERIOD_MISMATCH', `service period ${start ?? '?'}..${end ?? '?'} is not ${prev}/${target}`, 'invoice.servicePeriodStart')

  // duplicates — existing invoices (number + vendor), then siblings in this batch
  const number = String(invoice?.number ?? '').trim()
  const vendorKey = vendor.vendorId ?? normalizeVendorName(vendor.name)
  let duplicateOfInvoiceId: string | null = null
  if (number) {
    // "TMA10 1015558474" ≡ "TMA10-1015558474" ≡ "TMA10/1015558474": compare alphanumerics only
    const numNorm = normalizeInvoiceNumber(number)
    // an invoice this record already produced (fully, or partially before a failure) is not a duplicate
    const ownInstanceIds = new Set(catalogue.templates.filter((t) => (input.ownTemplates ?? []).includes(t.code)).map((t) => t.instanceId).filter(Boolean))
    const own = (i: { templateInstanceId: string | null; intakeRecordId: string | null }) => i.intakeRecordId === input.selfId || (i.templateInstanceId != null && ownInstanceIds.has(i.templateInstanceId))
    const hit = [...catalogue.unpaidInvoices, ...catalogue.recentInvoices].find((i) => {
      if (own(i)) return false
      if (!i.number || normalizeInvoiceNumber(i.number) !== numNorm) return false
      const iv = (i as any).vendorId ?? normalizeVendorName(i.vendorName)
      return !vendorKey || !iv || iv === vendorKey || normalizeVendorName(i.vendorName) === normalizeVendorName(vendor.name)
    })
    if (hit) {
      duplicateOfInvoiceId = hit.id
      push('DUPLICATE_INVOICE', `Invoice ${number} from ${hit.vendorName ?? 'this vendor'} already exists`, 'invoice.number')
    }
  }
  let duplicateOfRecordId: string | null = null
  const sib = input.siblings.find(
    (s) => s.id !== input.selfId && ((input.sourceSha256 && s.sha256 && s.sha256 === input.sourceSha256) || (number && s.number && normalizeInvoiceNumber(s.number) === normalizeInvoiceNumber(number) && s.vendorKey === vendorKey)),
  )
  if (sib) {
    duplicateOfRecordId = sib.id
    push('DUPLICATE_IN_BATCH', `Same invoice appears twice in this import`, 'invoice.number')
  }

  if (input.confidence != null && input.confidence < 0.6) push('LOW_CONFIDENCE', `agent confidence ${input.confidence}`)

  return { blockers, resolved: { vendor, templates: [...templates], duplicateOfInvoiceId, duplicateOfRecordId, allocationsTotal: total, byTemplate } }
}

export function prevPeriodCode(code: string) {
  const [y, m] = code.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Records the v1 apply path cannot handle: they can only be skipped. */
export function phase2Blocker(kind: string): Blocker {
  return { code: 'PHASE2_UNSUPPORTED', message: `${kind} records are stored but not applied in this version`, overridable: false }
}

/** Filter a record's blockers by what the admin acknowledged; hard blockers never clear. */
export function remainingBlockers(blockers: Blocker[], overrides: string[] | undefined): Blocker[] {
  const ack = new Set(overrides ?? [])
  return blockers.filter((b) => !(b.overridable && ack.has(b.code)))
}

// ── Bank statement lines ───────────────────────────────────────────────────────────────────────────

/**
 * Idempotency key of a statement line. A bank reference alone is not unique: Libra books the commission
 * of a transfer under the transfer's own reference ("Comision tranzactie (FT26222VJN8V)"), so the key
 * carries the absolute amount too. Two lines with the same reference AND amount are a real duplicate.
 */
export const bankLineKey = (reference: string | null | undefined, amount: unknown): string | null => {
  const ref = reference ? String(reference).trim() : ''
  if (!ref) return null
  const n = Number(amount)
  return `${ref}/${Number.isFinite(n) ? Math.abs(n).toFixed(2) : '?'}`
}

/** period statuses a bank line may be applied into (invoices: OPEN only) */
export const BANK_LINE_PERIOD_STATUSES = new Set(['OPEN', 'PREPARED'])

export type BankRefs = {
  /** line keys (see bankLineKey) already booked as owner payments (Payment.providerRef + amount, or refId 'bank:<key>') */
  payments: Set<string>
  /** line keys already booked as vendor settlements (VendorPayment.refId 'bank:<key>') */
  vendorPayments: Set<string>
  /** line keys already booked as plain cash transactions (CashTx refType BANK_STATEMENT, refId key) */
  cashTx: Set<string>
}

export type BankLineCheckInput = {
  bankLine: any // BankLine (extracted)
  mapping: BankLineMapping | null // effective = review ?? proposal
  confidence: number | null
  selfId: string
  /** sibling bank lines in the batch, for in-batch duplicate lines */
  siblings: Array<{ id: string; lineKey: string | null }>
  existing: BankRefs
}

export type ResolvedBankLine = {
  target: string | null
  reference: string | null
  /** idempotency key: `<reference>/<abs amount>` — Libra stamps a transfer's commission with the transfer's reference */
  lineKey: string | null
  accountId: string | null
  accountCode: string | null
  unitId: string | null
  unitCode: string | null
  unitLabel: string | null
  billingEntityId: string | null
  billingEntityName: string | null
  suggestedUnitCode: string | null
  fundLines: Array<{ fundCode: string; amount: number }>
  advanceFundCode: string | null
  cycleCode: string | null
  invoices: Array<{ id: string; number: string | null; vendorName: string | null; outstanding: number }>
  outstandingTotal: number
  cashFundCode: string | null
  cashKind: string | null
  /** VENDOR_SETTLEMENT with no matching invoice and the admin/agent chose "pays a pre-cutover invoice" */
  openingInvoice: boolean
  /** number the OPENING invoice will carry (the first quoted number, else derived at apply) */
  openingNumber: string | null
}

export type BankLineCheckResult = { blockers: Blocker[]; resolved: ResolvedBankLine }

const normName = (s: string | null | undefined) => normalizeVendorName(s)
/** "ap 3" / "AP 3" / "ap.3" / "ap3" / "ap 4 (III)" → "ap 3" / "ap 4 (iii)" — for unit label matching */
const normUnitLabel = (s: string | null | undefined) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\bap(?:artament)?\.?\s*/g, 'ap ')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim()

export function checkBankLine(input: BankLineCheckInput, catalogue: IntakeCatalogue): BankLineCheckResult {
  const { bankLine, mapping } = input
  const blockers: Blocker[] = []
  const push = (code: string, message: string, path?: string) => blockers.push({ code, message, path, overridable: isOverridable(code) })
  const amount = money(bankLine?.amount) ?? 0
  const reference = bankLine?.reference ? String(bankLine.reference).trim() : null
  const lineKey = bankLineKey(reference, bankLine?.amount)
  const resolved: ResolvedBankLine = {
    target: mapping?.target ?? null, reference, lineKey, accountId: null, accountCode: null, unitId: null, unitCode: null, unitLabel: null,
    billingEntityId: null, billingEntityName: null, suggestedUnitCode: null, fundLines: [], advanceFundCode: null,
    cycleCode: null, invoices: [], outstandingTotal: 0, cashFundCode: null, cashKind: null, openingInvoice: false, openingNumber: null,
  }

  // bank lines are plain payments/cash rows: `prepare` re-applies payments, so a PREPARED month is fine
  // (re-prepare afterwards); invoices need OPEN because submitting a template reopens the period.
  if (!BANK_LINE_PERIOD_STATUSES.has(catalogue.period.status)) push('PERIOD_NOT_OPEN', `Period ${catalogue.period.code} is ${catalogue.period.status}`)
  if (!mapping || !mapping.target) {
    push('NO_PROPOSAL', 'No mapping for this bank line', 'mapping')
    return { blockers, resolved }
  }
  if (mapping.target === 'IGNORE') return { blockers, resolved }

  // account: explicit code, else the single BANK account in the statement currency
  const currency = String(bankLine?.currency ?? 'RON').toUpperCase()
  const explicit = mapping.accountCode ? catalogue.cashAccounts.find((a) => a.code === mapping.accountCode) : null
  const candidates = explicit ? [explicit] : catalogue.cashAccounts.filter((a) => a.type === 'BANK' && a.currency.toUpperCase() === currency)
  if (candidates.length === 1) { resolved.accountId = candidates[0].id; resolved.accountCode = candidates[0].code }
  else push('ACCOUNT_UNKNOWN', candidates.length ? `${candidates.length} bank accounts in ${currency}` : `No bank account in ${currency}`, 'mapping.accountCode')

  // in-batch duplicate reference (same statement line twice, or the same line in two files)
  if (lineKey && input.siblings.some((s) => s.id !== input.selfId && s.lineKey && s.lineKey === lineKey)) {
    push('DUPLICATE_IN_BATCH', `Bank reference ${reference} with this amount appears twice in this import`, 'bankLine.reference')
  }

  if (mapping.target === 'OWNER_PAYMENT') {
    if (amount <= 0) push('AMOUNT_SIGN', 'An owner payment must be money in (positive amount)', 'bankLine.amount')
    if (lineKey && input.existing.payments.has(lineKey)) push('DUPLICATE_PAYMENT', `Payment with bank reference ${reference} already exists`, 'bankLine.reference')

    // unit → owner as of the period
    let unit = mapping.unitCode ? catalogue.units.find((u) => u.code === mapping.unitCode) ?? null : null
    if (mapping.unitCode && !unit) {
      // leniency: the agent may echo the label instead of the code
      const wanted = normUnitLabel(mapping.unitCode)
      unit = catalogue.units.find((u) => normUnitLabel(u.label) === wanted) ?? null
      if (!unit) push('UNIT_UNKNOWN', `Unit "${mapping.unitCode}" does not exist`, 'mapping.unitCode')
    }
    if (!mapping.unitCode) {
      // suggest by payer name ≈ owner name (all payer tokens present in the owner's name, or vice versa)
      const payer = normName(mapping.payerName ?? bankLine?.counterpartyName)
      const tokens = payer.split(' ').filter((t) => t.length > 2)
      const hits = tokens.length >= 2
        ? catalogue.units.filter((u) => {
            const owner = normName(u.billingEntityName)
            if (!owner) return false
            const ownerTokens = owner.split(' ').filter((t) => t.length > 2)
            return tokens.every((t) => ownerTokens.includes(t)) || ownerTokens.every((t) => tokens.includes(t))
          })
        : []
      const distinctOwners = new Set(hits.map((h) => h.billingEntityId))
      if (hits.length && distinctOwners.size === 1) {
        unit = hits[0]
        resolved.suggestedUnitCode = unit.code
        push('UNIT_SUGGESTED', `No unit on the line; "${mapping.payerName ?? bankLine?.counterpartyName}" matches owner ${unit.billingEntityName} (${unit.label})`, 'mapping.unitCode')
      } else {
        push('UNIT_UNSPECIFIED', hits.length ? `Payer matches ${distinctOwners.size} different owners` : 'No unit on the line and no owner matches the payer', 'mapping.unitCode')
      }
    }
    if (unit) {
      resolved.unitId = unit.id; resolved.unitCode = unit.code; resolved.unitLabel = unit.label
      if (!unit.billingEntityId) push('OWNER_UNKNOWN', `Unit ${unit.label} has no billing entity in ${catalogue.period.code}`, 'mapping.unitCode')
      else { resolved.billingEntityId = unit.billingEntityId; resolved.billingEntityName = unit.billingEntityName }
    }

    // named funds (optional) + advance fund
    let sum = 0
    for (const [i, f] of (mapping.funds ?? []).entries()) {
      if (!catalogue.funds.some((x) => x.code === f.fundCode)) push('FUND_UNKNOWN', `Fund "${f.fundCode}" does not exist`, `mapping.funds[${i}]`)
      const amt = money(f.amount) ?? 0
      sum += amt
      resolved.fundLines.push({ fundCode: f.fundCode, amount: r2(amt) })
    }
    if (sum > amount + 0.005) push('FUNDS_EXCEED_AMOUNT', `named funds sum to ${r2(sum)}, line amount is ${r2(amount)}`, 'mapping.funds')
    const dominant = resolved.fundLines.length ? [...resolved.fundLines].sort((a, b) => b.amount - a.amount)[0].fundCode : null
    resolved.advanceFundCode = mapping.advanceFundCode ?? dominant ?? catalogue.defaultAdvanceFundCode
    if (resolved.advanceFundCode && !catalogue.funds.some((x) => x.code === resolved.advanceFundCode)) push('FUND_UNKNOWN', `Advance fund "${resolved.advanceFundCode}" does not exist`, 'mapping.advanceFundCode')
    if (!resolved.advanceFundCode) push('FUND_UNKNOWN', 'No fund to credit an overpayment to', 'mapping.advanceFundCode')

    // cycle month
    resolved.cycleCode = mapping.cycleCode ?? catalogue.period.code
    if (mapping.cycleCode) {
      const p1 = prevPeriodCode(catalogue.period.code), p2 = prevPeriodCode(p1)
      if (![catalogue.period.code, p1, p2].includes(mapping.cycleCode)) push('CYCLE_MISMATCH', `cycle ${mapping.cycleCode} is not ${catalogue.period.code} / ${p1} / ${p2}`, 'mapping.cycleCode')
    }
  }

  if (mapping.target === 'VENDOR_SETTLEMENT') {
    if (amount >= 0) push('AMOUNT_SIGN', 'A supplier settlement must be money out (negative amount)', 'bankLine.amount')
    if (lineKey && input.existing.vendorPayments.has(lineKey)) push('DUPLICATE_SETTLEMENT', `Settlement with bank reference ${reference} already exists`, 'bankLine.reference')
    const wanted = (mapping.invoiceNumbers ?? []).map(normalizeInvoiceNumber).filter(Boolean)
    const hits = catalogue.unpaidInvoices.filter((i) => i.number && wanted.some((w) => normalizeInvoiceNumber(i.number!).endsWith(w) || w.endsWith(normalizeInvoiceNumber(i.number!))))
    const vendors = new Set(hits.map((h) => normName(h.vendorName)))
    // where an acknowledged INVOICE_NOT_FOUND settlement lands: the mapping's fund, else the default
    const fallbackFund = mapping.fundCode && catalogue.funds.some((x) => x.code === mapping.fundCode) ? mapping.fundCode : catalogue.defaultAdvanceFundCode
    if (mapping.fundCode && fallbackFund !== mapping.fundCode) push('FUND_UNKNOWN', `Fund "${mapping.fundCode}" does not exist`, 'mapping.fundCode')
    if (!wanted.length || !hits.length) {
      resolved.openingInvoice = mapping.openingInvoice === true
      resolved.openingNumber = mapping.invoiceNumbers?.[0] ?? null
      const landing = resolved.openingInvoice
        ? `on acknowledge a virtual pre-cutover invoice ${resolved.openingNumber ?? '(no number)'} is created on ${fallbackFund ?? '?'} and settled`
        : `on acknowledge the outflow is booked on ${fallbackFund ?? '?'} without an invoice`
      push('INVOICE_NOT_FOUND', `${wanted.length ? `No unpaid invoice matches ${mapping.invoiceNumbers.join(', ')}` : 'No invoice number quoted'} — ${landing}`, 'mapping.invoiceNumbers')
    }
    else if (vendors.size > 1) push('INVOICE_AMBIGUOUS', `Quoted number(s) match invoices of ${vendors.size} vendors`, 'mapping.invoiceNumbers')
    else {
      resolved.invoices = hits.map((h) => ({ id: h.id, number: h.number, vendorName: h.vendorName, outstanding: r2(h.outstanding) }))
      resolved.outstandingTotal = r2(hits.reduce((s, h) => s + h.outstanding, 0))
      if (-amount > resolved.outstandingTotal + 0.01) push('SETTLEMENT_EXCEEDS_OUTSTANDING', `paid ${r2(-amount)}, outstanding ${resolved.outstandingTotal}`, 'bankLine.amount')
    }
    resolved.cashFundCode = fallbackFund
  }

  if (mapping.target === 'CASH_TX') {
    if (lineKey && input.existing.cashTx.has(lineKey)) push('DUPLICATE_CASH_TX', `Cash transaction with bank reference ${reference} already exists`, 'bankLine.reference')
    let fundCode = mapping.fundCode ?? null
    if (!fundCode && mapping.expenseTypeCode) {
      const et = catalogue.expenseTypes.find((e) => e.code === mapping.expenseTypeCode)
      if (!et) push('UNKNOWN_EXPENSE_TYPE', `Expense type "${mapping.expenseTypeCode}" does not exist`, 'mapping.expenseTypeCode')
      else if (!et.fundCode) push('EXPENSE_TYPE_NO_FUND', `Expense type ${et.code} has no fundCode configured`, 'mapping.expenseTypeCode')
      else fundCode = et.fundCode
    }
    if (!fundCode) push('FUND_UNKNOWN', 'A cash transaction needs a fund', 'mapping.fundCode')
    else if (!catalogue.funds.some((x) => x.code === fundCode)) push('FUND_UNKNOWN', `Fund "${fundCode}" does not exist`, 'mapping.fundCode')
    resolved.cashFundCode = fundCode
    resolved.cashKind = mapping.kind ?? 'OTHER'
  }

  if (amount === 0) push('AMOUNT_SIGN', 'Zero amount', 'bankLine.amount')
  if (input.confidence != null && input.confidence < 0.6) push('LOW_CONFIDENCE', `agent confidence ${input.confidence}`)
  return { blockers, resolved }
}
