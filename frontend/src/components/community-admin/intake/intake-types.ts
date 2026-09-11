// Shapes returned by /communities/:id/intake/* (see backend src/modules/intake). Kept loose on purpose:
// the JSON blocks are the agent's contract objects and the admin edits them in place.
export type Blocker = { code: string; message: string; path?: string; overridable: boolean }

export type IntakeBatchSummary = {
  id: string
  periodCode: string | null
  status: string
  contractVersion: string
  promptVersion: string | null
  agentLabel: string | null
  sourceFileName: string | null
  stats: { records: number; byStatus: Record<string, number>; byKind: Record<string, number> } | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type Allocation = { templateCode: string; itemKey: string; amount: number; reason: string | null }
export type VendorMapping = { match: 'EXISTING' | 'NEW' | 'UNKNOWN'; vendorId: string | null; name: string | null; taxId: string | null; iban: string | null }
export type InvoiceMapping = {
  vendor: VendorMapping
  allocations: Allocation[]
  fallback: { fundCode: string | null; expenseTypeCode: string | null } | null
  duplicateOf: { invoiceNumber: string | null; vendorName: string | null } | null
}
export type InvoiceHeader = {
  vendorName: string | null
  vendorTaxId: string | null
  vendorIban: string | null
  number: string | null
  issueDate: string | null
  dueDate: string | null
  servicePeriodStart: string | null
  servicePeriodEnd: string | null
  currency: string | null
  net: number | null
  vat: number | null
  gross: number | null
  lines?: Array<{ description: string | null; quantity: number | null; unitPrice: number | null; net: number | null; vat: number | null; gross: number | null }>
}

export type IntakeRecordRow = {
  id: string
  index: number
  kind: 'INVOICE' | 'BANK_LINE' | 'OTHER'
  status: string
  sourceFile: string | null
  sourceSha256: string | null
  confidence: number | null
  rationale: string | null
  extracted: any
  proposal: any
  review: { invoice?: Partial<InvoiceHeader>; mapping?: InvoiceMapping; overrides?: string[] } | null
  effective: { invoice: InvoiceHeader; mapping: InvoiceMapping } | null
  resolved: any
  blockers: Blocker[]
  remaining: Blocker[]
  duplicateOfInvoiceId: string | null
  duplicateOfRecordId: string | null
  appliedRefs: any
  appliedAt: string | null
  error: string | null
}

export type IntakeContext = {
  community: { id: string; code: string; name: string }
  period: { id: string; code: string; status: string; startDate: string; endDate: string }
  templates: Array<{
    code: string
    name: string
    vendorName: string | null
    fundCode: string | null
    instanceState: string | null
    items: Array<{ key: string; label: string; expenseTypeCode: string | null; fundCode: string | null }>
  }>
  expenseTypes: Array<{ code: string; name: string; fundCode: string | null }>
  funds: Array<{ code: string; name: string }>
  vendors: Array<{ id: string; name: string; taxId: string | null; iban: string | null }>
}

export type ContractIssue = { index: number | null; path: string; message: string }
