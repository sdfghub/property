// The `intake-import/v1` contract: the JSON an external agent must produce from a zip of invoices and
// bank statements so the app can import it as proposals (see docs/intake.md).
//
// Two layers on purpose:
//   - the zod schemas below are PURE (no transforms), so `z.toJSONSchema` renders them faithfully into
//     the prompt pack an agent reads;
//   - `normalizePayload` runs BEFORE validation and is deliberately liberal about the near-misses agents
//     produce (numbers as strings, "1.234,56", "01.07.2026" dates, "2026-07-01" where a period code is
//     expected, missing optional keys). Validation errors then point at what is genuinely wrong.
import { z } from 'zod'

export const CONTRACT_VERSION = 'intake-import/v1'
// Bump when the prompt wording/guidelines change in a way that affects what agents emit. Batches record
// which version the agent used so prompt regressions can be traced.
export const PROMPT_VERSION = '2026-09-11.1'

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const PeriodCode = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM')
const Money = z.number().describe('Amount in the invoice currency, dot decimal, no thousands separator')
const Str = z.string().nullable()

export const InvoiceLineSchema = z.object({
  description: Str,
  quantity: Money.nullable(),
  unitPrice: Money.nullable(),
  net: Money.nullable(),
  vat: Money.nullable(),
  gross: Money.nullable(),
})

export const InvoiceBlockSchema = z.object({
  vendorName: Str.describe('Supplier name as printed (e.g. "AQUATIM S.A.")'),
  vendorTaxId: Str.describe('Supplier CUI/CIF, digits only, no "RO" prefix'),
  vendorIban: Str,
  number: Str.describe('Invoice series + number as printed, e.g. "TM 1234567"'),
  issueDate: IsoDate.nullable().describe('Data emiterii'),
  dueDate: IsoDate.nullable().describe('Termen de plată / scadența'),
  servicePeriodStart: PeriodCode.nullable().describe('First month of the billed service period'),
  servicePeriodEnd: PeriodCode.nullable().describe('Last month of the billed service period'),
  currency: Str.describe('ISO code, usually "RON"'),
  net: Money.nullable(),
  vat: Money.nullable(),
  gross: Money.nullable().describe('Total de plată (with VAT)'),
  lines: z.array(InvoiceLineSchema),
})

export const AllocationSchema = z.object({
  templateCode: z.string().describe('A template code from the catalogue, never invented'),
  itemKey: z.string().describe('An item key of that template'),
  amount: Money.describe('Gross amount allocated to this item'),
  reason: Str,
})

export const VendorMappingSchema = z.object({
  match: z.enum(['EXISTING', 'NEW', 'UNKNOWN']),
  vendorId: Str.describe('Catalogue vendor id when match = EXISTING'),
  name: Str,
  taxId: Str,
  iban: Str,
})

export const InvoiceMappingSchema = z.object({
  vendor: VendorMappingSchema,
  allocations: z.array(AllocationSchema).describe('May span several templates; the sum should equal gross'),
  fallback: z
    .object({ fundCode: Str, expenseTypeCode: Str })
    .nullable()
    .describe('Only when no template fits: the invoice is created without expense lines'),
  duplicateOf: z
    .object({ invoiceNumber: Str, vendorName: Str })
    .nullable()
    .describe('Set when this looks like an invoice already in the catalogue'),
})

const recordBase = {
  sourceFile: Str.describe('File name inside the archive this record came from'),
  sourceSha256: Str.describe('SHA-256 of that file if you can compute it, else null'),
  confidence: z.number().min(0).max(1),
  rationale: Str.describe('One sentence: why this mapping'),
  warnings: z.array(z.string()).describe('Anything ambiguous, instead of guessing'),
}

export const InvoiceRecordSchema = z.object({
  kind: z.literal('INVOICE'),
  ...recordBase,
  invoice: InvoiceBlockSchema,
  mapping: InvoiceMappingSchema,
})

export const BankLineSchema = z.object({
  account: z.object({ iban: Str, bankName: Str }),
  date: IsoDate.nullable(),
  valueDate: IsoDate.nullable(),
  amount: Money.describe('Signed: credit (money in) positive, debit (money out) negative'),
  currency: Str,
  counterpartyName: Str,
  counterpartyIban: Str,
  description: Str,
  reference: Str.describe('Bank transaction reference, used later for idempotent import'),
  balanceAfter: Money.nullable(),
})

export const BankLineRecordSchema = z.object({
  kind: z.literal('BANK_LINE'),
  ...recordBase,
  bankLine: BankLineSchema,
  mapping: z.null().describe('Reserved for a later contract version — always null in v1'),
})

export const OtherRecordSchema = z.object({
  kind: z.literal('OTHER'),
  ...recordBase,
  note: Str.describe('What the document is and why it is not an invoice or a bank statement'),
})

export const IntakeRecordSchema = z.discriminatedUnion('kind', [InvoiceRecordSchema, BankLineRecordSchema, OtherRecordSchema])

export const ImportPayloadSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  promptVersion: Str.describe('Copy from the prompt pack'),
  community: Str.describe('Community code from the prompt pack'),
  periodCode: PeriodCode.describe('Target period from the prompt pack'),
  meta: z.object({
    agent: Str.describe('Who produced this, e.g. "claude-code / claude-opus-5"'),
    generatedAt: Str,
    sourceArchive: Str,
    notes: Str,
  }),
  records: z.array(IntakeRecordSchema),
})

export type ImportPayload = z.infer<typeof ImportPayloadSchema>
export type IntakeRecordInput = z.infer<typeof IntakeRecordSchema>
export type InvoiceRecordInput = z.infer<typeof InvoiceRecordSchema>
export type BankLineRecordInput = z.infer<typeof BankLineRecordSchema>
export type InvoiceMapping = z.infer<typeof InvoiceMappingSchema>
export type Allocation = z.infer<typeof AllocationSchema>

export const contractJsonSchema = () => z.toJSONSchema(ImportPayloadSchema, { target: 'draft-7' })

// ── Lenient normalisation ──────────────────────────────────────────────────────────────────────────

const MONEY_KEYS = new Set(['quantity', 'unitPrice', 'net', 'vat', 'gross', 'amount', 'balanceAfter'])
const DATE_KEYS = new Set(['issueDate', 'dueDate', 'date', 'valueDate'])
const PERIOD_KEYS = new Set(['servicePeriodStart', 'servicePeriodEnd', 'periodCode'])
const STRING_KEYS = new Set([
  'vendorName', 'vendorTaxId', 'vendorIban', 'number', 'currency', 'description', 'reason', 'vendorId', 'name',
  'taxId', 'iban', 'fundCode', 'expenseTypeCode', 'invoiceNumber', 'sourceFile', 'sourceSha256', 'rationale',
  'bankName', 'counterpartyName', 'counterpartyIban', 'reference', 'note', 'agent', 'generatedAt',
  'sourceArchive', 'notes', 'promptVersion', 'community',
])

export function coerceMoney(v: unknown): unknown {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return v
  let s = v.trim().replace(/\s/g, '').replace(/(RON|LEI|EUR)$/i, '')
  // "1.234,56" → "1234.56"; "1234,56" → "1234.56"; "1,234.56" → "1234.56"
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : v
}

export function coerceIsoDate(v: unknown): unknown {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return v
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return v
}

export function coercePeriodCode(v: unknown): unknown {
  if (v == null || v === '') return null
  if (typeof v !== 'string') return v
  const s = v.trim()
  let m = s.match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  m = s.match(/^(\d{1,2})[./-](\d{4})$/)
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`
  return v
}

function normalizeValue(key: string, v: unknown): unknown {
  if (MONEY_KEYS.has(key)) return coerceMoney(v)
  if (DATE_KEYS.has(key)) return coerceIsoDate(v)
  if (PERIOD_KEYS.has(key)) return coercePeriodCode(v)
  if (STRING_KEYS.has(key)) {
    if (v === undefined || v === '') return null
    if (typeof v === 'number') return String(v)
  }
  return v
}

function walk(node: unknown, key = ''): unknown {
  if (Array.isArray(node)) return node.map((x) => walk(x, key))
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = walk(normalizeValue(k, v), k)
    return out
  }
  return normalizeValue(key, node)
}

/** Fill the keys the contract requires but agents commonly omit, then coerce scalar near-misses. */
export function normalizePayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const p: any = walk(raw)
  p.contractVersion ??= CONTRACT_VERSION
  p.promptVersion ??= null
  p.community ??= null
  p.meta = { agent: null, generatedAt: null, sourceArchive: null, notes: null, ...(p.meta ?? {}) }
  p.records = Array.isArray(p.records) ? p.records : []
  for (const r of p.records) {
    if (!r || typeof r !== 'object') continue
    r.sourceFile ??= null
    r.sourceSha256 ??= null
    r.rationale ??= null
    r.warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : []
    if (typeof r.confidence !== 'number') r.confidence = Number(r.confidence)
    if (!Number.isFinite(r.confidence)) r.confidence = 0
    if (r.kind === 'INVOICE') {
      r.invoice = fillNull(r.invoice ?? {}, [
        'vendorName', 'vendorTaxId', 'vendorIban', 'number', 'issueDate', 'dueDate', 'servicePeriodStart',
        'servicePeriodEnd', 'currency', 'net', 'vat', 'gross',
      ])
      r.invoice.lines = Array.isArray(r.invoice.lines)
        ? r.invoice.lines.map((l: any) => fillNull(l ?? {}, ['description', 'quantity', 'unitPrice', 'net', 'vat', 'gross']))
        : []
      r.mapping = r.mapping ?? {}
      r.mapping.vendor = fillNull(r.mapping.vendor ?? { match: 'UNKNOWN' }, ['vendorId', 'name', 'taxId', 'iban'])
      r.mapping.allocations = Array.isArray(r.mapping.allocations)
        ? r.mapping.allocations.map((a: any) => fillNull(a ?? {}, ['reason']))
        : []
      r.mapping.fallback = r.mapping.fallback ? fillNull(r.mapping.fallback, ['fundCode', 'expenseTypeCode']) : null
      r.mapping.duplicateOf = r.mapping.duplicateOf ? fillNull(r.mapping.duplicateOf, ['invoiceNumber', 'vendorName']) : null
    } else if (r.kind === 'BANK_LINE') {
      r.bankLine = fillNull(r.bankLine ?? {}, [
        'date', 'valueDate', 'currency', 'counterpartyName', 'counterpartyIban', 'description', 'reference', 'balanceAfter',
      ])
      r.bankLine.account = fillNull(r.bankLine.account ?? {}, ['iban', 'bankName'])
      r.mapping = null
    } else if (r.kind === 'OTHER') {
      r.note ??= null
    }
  }
  return p
}

function fillNull(obj: any, keys: string[]) {
  for (const k of keys) if (obj[k] === undefined) obj[k] = null
  return obj
}

export type ContractIssue = { index: number | null; path: string; message: string }

/** Normalise + validate. Issues carry the record index so the admin can find the offending entry. */
export function parseImportPayload(raw: unknown): { ok: true; payload: ImportPayload } | { ok: false; issues: ContractIssue[] } {
  const res = ImportPayloadSchema.safeParse(normalizePayload(raw))
  if (res.success) return { ok: true, payload: res.data }
  const issues: ContractIssue[] = res.error.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '')
    const index = i.path[0] === 'records' && typeof i.path[1] === 'number' ? i.path[1] : null
    return { index, path, message: i.message }
  })
  return { ok: false, issues }
}
