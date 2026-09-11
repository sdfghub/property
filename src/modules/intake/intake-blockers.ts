// Deterministic checks that turn an agent's proposal into something an admin can trust — or into a
// list of reasons why not. Pure functions over the catalogue so they run identically at import, on
// every review save, in `intake:validate`, and again right before apply.
import { INTAKE_BLOCKER_META } from '../../common/enums-meta'
import type { IntakeCatalogue } from './intake-prompt.service'
import type { InvoiceMapping } from './intake-contract'

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
    const numNorm = number.replace(/\s+/g, '').toLowerCase()
    // an invoice this record already produced (fully, or partially before a failure) is not a duplicate
    const ownInstanceIds = new Set(catalogue.templates.filter((t) => (input.ownTemplates ?? []).includes(t.code)).map((t) => t.instanceId).filter(Boolean))
    const own = (i: { templateInstanceId: string | null; intakeRecordId: string | null }) => i.intakeRecordId === input.selfId || (i.templateInstanceId != null && ownInstanceIds.has(i.templateInstanceId))
    const hit = [...catalogue.unpaidInvoices, ...catalogue.recentInvoices].find((i) => {
      if (own(i)) return false
      if (!i.number || i.number.replace(/\s+/g, '').toLowerCase() !== numNorm) return false
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
    (s) => s.id !== input.selfId && ((input.sourceSha256 && s.sha256 && s.sha256 === input.sourceSha256) || (number && s.number && s.number.replace(/\s+/g, '').toLowerCase() === number.replace(/\s+/g, '').toLowerCase() && s.vendorKey === vendorKey)),
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
