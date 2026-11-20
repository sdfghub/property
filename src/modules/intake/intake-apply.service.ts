import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { TemplateService } from '../billing/template.service'
import { VendorInvoiceService } from '../billing/vendor-invoice.service'
import { PaymentService } from '../billing/payment.service'
import { CashService } from '../billing/cash.service'
import { IntakeImportService } from './intake-import.service'
import { IntakePromptService, type IntakeCatalogue } from './intake-prompt.service'
import { BANK_LINE_PERIOD_STATUSES, remainingBlockers, type BankRefs, type Blocker } from './intake-blockers'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

export type AppliedRefs = {
  /** templates this record has called saveBillTemplateState for, written BEFORE the call so a partial
   *  failure (e.g. missing meter readings) can be retried without tripping TEMPLATE_ALREADY_SUBMITTED */
  attemptedTemplates: string[]
  /** STAGED: templates left FILLED (values on the template, no invoice/charges yet) and the measure
   *  types the allocation still needs — filled in on the next apply once the readings exist */
  stagedTemplates?: string[]
  waitingFor?: string[]
  templateInstanceIds: string[]
  vendorInvoiceIds: string[]
  vendorInvoiceDocIds: string[]
  standaloneInvoiceId?: string | null
  /** bank lines: what the line became */
  paymentId?: string | null
  vendorPaymentIds?: string[]
  cashTxId?: string | null
  applied?: number | null
  remaining?: number | null
  advance?: number | null
  target?: string | null
  openingInvoiceId?: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Writes approved invoice records into the books — and ONLY through the existing primitives:
//   • template path: TemplateService.saveBillTemplateState({state:'SUBMITTED'}) creates the VendorInvoice
//     + CommunityCharge rows (the same code the month-close uses), then we stamp provenance on it;
//   • no template: VendorInvoiceService.createInvoice (invoice only, no expense lines).
// Never ledger rows, never charges by hand (CLAUDE.md). Templates are left SUBMITTED, not CLOSED: closing
// belongs to the month-end checklist so the admin keeps that review step.
@Injectable()
export class IntakeApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
    private readonly invoices: VendorInvoiceService,
    private readonly payments: PaymentService,
    private readonly cash: CashService,
    private readonly importer: IntakeImportService,
    private readonly prompt: IntakePromptService,
  ) {}

  async applyBatch(communityRef: string, batchId: string, roles: RoleAssignment[], recordIds?: string[]) {
    const community = await this.prompt.resolveCommunity(communityRef)
    const batch = await this.prisma.intakeBatch.findFirst({ where: { id: batchId, communityId: community.id }, include: { period: true } })
    if (!batch) throw new NotFoundException('Batch not found')
    if (batch.status === 'APPLYING') throw new ConflictException('Batch is already being applied')

    // Precondition enforced HERE, not only at import: saveBillTemplateState silently reopens a PREPARED /
    // CLOSED period (template.service.ts, "Reopening any template moves the period back to OPEN").
    // Bank lines only touch payments / cash rows, which `prepare` re-applies, so they may also go into a
    // PREPARED month (the admin re-prepares afterwards); invoice records wait for OPEN and are left as they are.
    let catalogue = await this.prompt.buildCatalogue(community.id, batch.period.code)
    const periodOpen = catalogue.period.status === 'OPEN'
    if (!periodOpen && !BANK_LINE_PERIOD_STATUSES.has(catalogue.period.status)) {
      throw new ConflictException({ message: `Period ${catalogue.period.code} is ${catalogue.period.status}; intake applies only into OPEN (bank lines: OPEN or PREPARED) periods`, blockers: [{ code: 'PERIOD_NOT_OPEN', overridable: false }] })
    }

    // FAILED records were approved before they failed — retrying is the fix; STAGED ones are waiting for
    // meter readings and get finalised (FILLED → SUBMITTED) by the same apply once those exist
    const where: any = { batchId: batch.id, status: { in: ['APPROVED', 'FAILED', 'STAGED'] }, kind: { in: periodOpen ? ['INVOICE', 'BANK_LINE'] : ['BANK_LINE'] } }
    if (recordIds?.length) where.id = { in: recordIds }
    const all = await this.prisma.intakeRecord.findMany({ where, orderBy: { index: 'asc' } })
    // invoices first: a settlement in the same batch may target an invoice this batch creates
    const records = [...all.filter((r) => r.kind === 'INVOICE'), ...all.filter((r) => r.kind === 'BANK_LINE')]
    if (!records.length) return { applied: [], staged: [], failed: [], batchStatus: batch.status }

    await this.prisma.intakeBatch.update({ where: { id: batch.id }, data: { status: 'APPLYING', error: null } })
    const applied: Array<{ recordId: string; appliedRefs: AppliedRefs }> = []
    const staged: Array<{ recordId: string; waitingFor: string[] }> = []
    const failed: Array<{ recordId: string; error: string }> = []
    let bankRefs: BankRefs | null = null
    try {
      for (const record of records) {
        try {
          if (record.kind === 'BANK_LINE' && !bankRefs) {
            // invoices are done: refresh the catalogue (unpaid list) and load the booked bank references once
            catalogue = await this.prompt.buildCatalogue(community.id, batch.period.code)
            bankRefs = await this.importer.loadBankRefs(community.id, records.filter((r) => r.kind === 'BANK_LINE').map((r) => this.importer.toInput(r)))
          }
          const refs = record.kind === 'BANK_LINE' ? await this.applyBankLine(record, catalogue, batch, bankRefs!) : await this.applyRecord(record, catalogue, batch, roles)
          if (refs.target === 'IGNORE') {
            await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'SKIPPED', appliedRefs: refs as any, error: null } })
            continue
          }
          if (refs.waitingFor?.length) {
            await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'STAGED', appliedRefs: refs as any, error: null } })
            staged.push({ recordId: record.id, waitingFor: refs.waitingFor })
            for (const code of refs.stagedTemplates ?? []) {
              const t = catalogue.templates.find((x) => x.code === code)
              if (t) t.instanceState = 'FILLED'
            }
            continue
          }
          await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'APPLIED', appliedRefs: refs as any, appliedAt: new Date(), error: null } })
          applied.push({ recordId: record.id, appliedRefs: refs })
          // the catalogue must see the new instance state so a second record cannot re-submit the same template
          for (const code of refs.templateInstanceIds.length ? Object.keys(this.groupByTemplate(this.effective(record).mapping)) : []) {
            const t = catalogue.templates.find((x) => x.code === code)
            if (t) t.instanceState = 'SUBMITTED'
          }
        } catch (e: any) {
          const msg = e?.response?.message ?? e?.message ?? String(e)
          await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'FAILED', error: String(msg).slice(0, 2000) } })
          failed.push({ recordId: record.id, error: String(msg) })
        }
      }
    } finally {
      await this.prisma.intakeBatch.update({ where: { id: batch.id }, data: { status: 'REVIEW' } })
      await this.importer.refreshStats(batch.id) // decides REVIEW / APPLIED / FAILED from the records
    }
    const after = await this.prisma.intakeBatch.findUniqueOrThrow({ where: { id: batch.id }, select: { status: true } })
    return { applied, staged, failed, batchStatus: after.status }
  }

  // ── one record ────────────────────────────────────────────────────────────────────────────────

  private async applyRecord(record: any, catalogue: IntakeCatalogue, batch: any, roles: RoleAssignment[]): Promise<AppliedRefs> {
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    // re-check against the live catalogue right before writing; hard blockers cannot be overridden
    const rawWarnings = (batch.raw as any)?.records?.[record.index]?.warnings
    const prior: any = record.appliedRefs ?? {}
    const [checked] = this.importer.checkRecords([{ id: record.id, index: record.index, input: this.importer.toInput(record, rawWarnings), review: record.review ?? null, ownTemplates: [...(prior.attemptedTemplates ?? []), ...(prior.stagedTemplates ?? [])] }], catalogue)
    const left = remainingBlockers(checked.blockers as Blocker[], (record.review as any)?.overrides ?? [])
    if (left.length) throw new ConflictException(`Blocked: ${left.map((b) => `${b.code} (${b.message})`).join('; ')}`)

    const { invoice, mapping } = this.effective(record)
    const refs: AppliedRefs = { templateInstanceIds: [], vendorInvoiceIds: [], vendorInvoiceDocIds: [], standaloneInvoiceId: null, attemptedTemplates: [...((prior.attemptedTemplates as string[]) ?? [])] }
    // Stageable? Every expense type the allocations touch that allocates BY_CONSUMPTION needs UNIT
    // measures of its type in this period (allocation.service.ts unitMeasuresForWeight) — the engine never
    // falls back. Without them we place the amounts on the template as FILLED (what the manual form does)
    // and finish on a later apply, instead of failing.
    const missing = await this.missingMeasureTypes(catalogue, mapping)
    const provenance = {
      intakeBatchId: batch.id,
      intakeRecordId: record.id,
      agentLabel: batch.agentLabel ?? null,
      promptVersion: batch.promptVersion ?? null,
      contractVersion: batch.contractVersion,
      sourceFile: record.sourceFile ?? null,
    }
    const persistRefs = () => this.prisma.intakeRecord.update({ where: { id: record.id }, data: { appliedRefs: refs as any } })

    const groups = this.groupByTemplate(mapping)
    const templateCodes = Object.keys(groups)
    if (templateCodes.length) {
      const gross = money(invoice.gross)
      const net = money(invoice.net)
      const vat = money(invoice.vat)
      const grand = r2(templateCodes.reduce((s, c) => s + groups[c].total, 0))
      for (const code of templateCodes) {
        const t = catalogue.templates.find((x) => x.code === code)!
        const g = groups[code]
        const share = grand > 0 ? g.total / grand : 1 / templateCodes.length
        const single = templateCodes.length === 1
        const keys = t.invoiceKeys || {}
        const k = (name: string, dflt: string) => (keys[name] as string) || dflt
        // merge-not-clobber: keep every value the admin already typed, set ours (conflicts were blockers)
        const values: Record<string, unknown> = { ...(t.instanceValues ?? {}) }
        for (const [itemKey, amt] of Object.entries(g.items)) values[itemKey] = amt
        if (invoice.number != null) values[k('numberKey', 'invoiceNumber')] = invoice.number
        if (invoice.issueDate) values[k('issueDateKey', 'invoiceDate')] = invoice.issueDate
        if (invoice.dueDate) values[k('dueDateKey', 'invoiceDueDate')] = invoice.dueDate
        if (invoice.servicePeriodStart) values[k('serviceStartPeriodKey', 'serviceStartPeriod')] = invoice.servicePeriodStart
        if (invoice.servicePeriodEnd) values[k('serviceEndPeriodKey', 'serviceEndPeriod')] = invoice.servicePeriodEnd
        if (invoice.currency) values[k('currencyKey', 'invoiceCurrency')] = invoice.currency
        const gGross = single && gross != null ? gross : r2(g.total)
        const gNet = net == null ? null : single ? net : r2(net * share)
        const gVat = vat == null ? null : single ? vat : r2(vat * share)
        values[k('grossKey', 'invoiceGross')] = gGross
        if (gNet != null) values[k('netKey', 'invoiceNet')] = gNet
        if (gVat != null) values[k('vatKey', 'invoiceVat')] = gVat

        if (missing.length) {
          // values on the template, nothing allocated: the admin sees them in Cheltuieli right away
          await this.templates.saveBillTemplateState(catalogue.community.id, catalogue.period.code, code, roles, { state: 'FILLED', values })
          refs.stagedTemplates = [...(refs.stagedTemplates ?? []), code]
          refs.waitingFor = missing
          await persistRefs()
          continue
        }
        if (!refs.attemptedTemplates.includes(code)) refs.attemptedTemplates.push(code)
        await persistRefs()
        let instance: any
        try {
          instance = await this.templates.saveBillTemplateState(catalogue.community.id, catalogue.period.code, code, roles, { state: 'SUBMITTED', values })
        } catch (e: any) {
          // safety net for a case the pre-check did not foresee: the engine itself says readings are missing
          const m = /No (\S+) readings for this period/.exec(String(e?.message ?? e?.response?.message ?? ''))
          if (!m) throw e
          await this.templates.saveBillTemplateState(catalogue.community.id, catalogue.period.code, code, roles, { state: 'FILLED', values })
          refs.stagedTemplates = [...(refs.stagedTemplates ?? []), code]
          refs.waitingFor = [...new Set([...(refs.waitingFor ?? []), m[1]])]
          await persistRefs()
          continue
        }
        refs.templateInstanceIds.push(instance.id)
        await persistRefs()

        // saveBillTemplateState hard-sets source INTERNAL and rewrites provenance — stamp ours after it
        const vi = await this.prisma.vendorInvoice.findUnique({ where: { templateInstanceId: instance.id } })
        if (vi) {
          await this.prisma.vendorInvoice.update({
            where: { id: vi.id },
            data: {
              source: 'IMPORT',
              hash: record.sourceSha256 ?? vi.hash ?? null,
              net: gNet ?? vi.net,
              vat: gVat ?? vi.vat,
              issueDate: invoice.issueDate ? new Date(invoice.issueDate) : vi.issueDate,
              dueDate: invoice.dueDate ? new Date(invoice.dueDate) : vi.dueDate,
              provenance: { ...((vi.provenance as any) ?? {}), templateCode: code, templateName: t.name, ...provenance },
            },
          })
          refs.vendorInvoiceIds.push(vi.id)
          const doc = await this.linkDoc(vi.id, record, batch)
          if (doc) refs.vendorInvoiceDocIds.push(doc)
          await persistRefs()
        }
      }
      if (refs.waitingFor?.length) {
        // a spanning invoice may have finalised one template and staged another; the whole record stays
        // STAGED until every template is submitted, and the next apply re-runs all of them idempotently
        refs.stagedTemplates = [...new Set(refs.stagedTemplates ?? [])]
      }
      return refs
    }

    // no template → invoice only (no expense lines); guarded so a re-run does not create a second one
    const fb = mapping.fallback!
    const existing = await this.findStandalone(catalogue.community.id, record, invoice)
    let invoiceId = existing?.id ?? null
    if (!invoiceId) {
      const created = await this.invoices.createInvoice(catalogue.community.id, {
        vendorId: checked.resolved?.vendor?.vendorId ?? null,
        vendorName: checked.resolved?.vendor?.name ?? invoice.vendorName ?? mapping.vendor?.name ?? 'Furnizor necunoscut',
        vendorTaxId: mapping.vendor?.taxId ?? invoice.vendorTaxId ?? null,
        vendorIban: mapping.vendor?.iban ?? invoice.vendorIban ?? null,
        number: invoice.number ?? null,
        issueDate: invoice.issueDate ?? null,
        dueDate: invoice.dueDate ?? null,
        currency: invoice.currency ?? 'RON',
        net: money(invoice.net),
        vat: money(invoice.vat),
        gross: money(invoice.gross),
        fundCode: fb.fundCode ?? catalogue.expenseTypes.find((e) => e.code === fb.expenseTypeCode)?.fundCode,
        source: 'IMPORT',
        hash: record.sourceSha256 ?? null,
        provenance: { ...provenance, fallback: fb, expenseTypeCode: fb.expenseTypeCode ?? null },
      })
      invoiceId = created.id
    }
    refs.standaloneInvoiceId = invoiceId
    refs.vendorInvoiceIds.push(invoiceId)
    const doc = await this.linkDoc(invoiceId, record, batch)
    if (doc) refs.vendorInvoiceDocIds.push(doc)
    await persistRefs()
    return refs
  }

  // ── one bank line ─────────────────────────────────────────────────────────────────────────────

  private async applyBankLine(record: any, catalogue: IntakeCatalogue, batch: any, bankRefs: BankRefs): Promise<AppliedRefs> {
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    const rawWarnings = (batch.raw as any)?.records?.[record.index]?.warnings
    const siblings = await this.prisma.intakeRecord.findMany({ where: { batchId: batch.id, kind: 'BANK_LINE' }, select: { id: true, index: true, extracted: true, proposal: true, review: true, sourceFile: true, sourceSha256: true, confidence: true, rationale: true, kind: true } })
    const rows = siblings.map((r) => ({ id: r.id, index: r.index, input: this.importer.toInput(r as any, r.id === record.id ? rawWarnings : undefined), review: (r.review as any) ?? null }))
    const checked = this.importer.checkRecords(rows, catalogue, bankRefs).find((c) => c.index === record.index)!
    const left = remainingBlockers(checked.blockers as Blocker[], (record.review as any)?.overrides ?? [])
    if (left.length) throw new ConflictException(`Blocked: ${left.map((b) => `${b.code} (${b.message})`).join('; ')}`)

    const line = record.extracted ?? {}
    const mapping: any = (record.review as any)?.mapping ?? record.proposal ?? {}
    const res: any = checked.resolved ?? {}
    const reference: string | null = res.reference ?? null
    const lineKey: string | null = res.lineKey ?? null
    // idempotency: `bank:<reference>/<amount>` (a commission shares its transfer's reference), else the record
    const refKey = lineKey ? `bank:${lineKey}` : `intake:${record.id}`
    const amount = Number(line.amount ?? 0)
    const ts = line.date ? new Date(line.date) : new Date()
    const memo = [line.counterpartyName, line.description].filter(Boolean).join(' — ').slice(0, 500) || null
    const provenance = { intakeBatchId: batch.id, intakeRecordId: record.id, sourceFile: record.sourceFile ?? null, bankReference: reference }
    const refs: AppliedRefs = { attemptedTemplates: [], templateInstanceIds: [], vendorInvoiceIds: [], vendorInvoiceDocIds: [], target: mapping.target ?? null }
    const fundId = (code: string | null) => (code ? catalogue.funds.find((f) => f.code === code)?.id ?? null : null)

    if (mapping.target === 'IGNORE') return refs

    if (mapping.target === 'OWNER_PAYMENT') {
      // the same primitive as a hand-recorded receipt. No named funds → one advance line, and the engine
      // spreads the whole amount by the community strategy. Named funds → fixed lines for them, then a
      // fund-less fixed line for the remainder (FIFO over every open charge — a fixed line's leftover
      // would otherwise go straight to advance), and the advance line catches what nothing consumed.
      const spec: any[] = (res.fundLines ?? []).map((l: any) => ({ fundId: fundId(l.fundCode), amount: l.amount })).filter((l: any) => l.fundId)
      const named = r2(spec.reduce((s: number, l: any) => s + Number(l.amount || 0), 0))
      if (spec.length && amount - named > 0.005) spec.push({ amount: r2(amount - named) })
      const advanceFundId = fundId(res.advanceFundCode)
      if (!advanceFundId) throw new ConflictException('No advance fund resolved')
      spec.push({ advance: true, fundId: advanceFundId })
      const r = await this.payments.createOrApply(catalogue.community.id, {
        billingEntityId: res.billingEntityId,
        amount,
        currency: line.currency ?? 'RON',
        accountId: res.accountId,
        ts,
        method: 'BANK',
        refId: refKey,
        provider: 'intake',
        providerRef: reference,
        providerMeta: { cycleCode: res.cycleCode ?? catalogue.period.code, ...provenance },
        periodCode: catalogue.period.code,
        allocationSpec: spec,
      })
      refs.paymentId = r.payment?.id ?? null
      refs.applied = r.applied ?? null
      refs.remaining = r.remaining ?? null
      refs.advance = r.advance ?? null
      if (lineKey) bankRefs.payments.add(lineKey)
      return refs
    }

    if (mapping.target === 'VENDOR_SETTLEMENT') {
      const invoices: Array<{ id: string; outstanding: number }> = res.invoices ?? []
      if (!invoices.length) {
        const fid = fundId(res.cashFundCode)
        if (!fid) throw new ConflictException('No fund for an unmatched settlement')
        if (res.openingInvoice) {
          // INVOICE_NOT_FOUND acknowledged as "pays an invoice from before the books": a virtual OPENING
          // invoice for exactly this amount, settled by this line (docs/cutover.md)
          const vendorName: string | null = mapping.vendorName ?? line.counterpartyName ?? null
          const r = await this.invoices.payOpening(catalogue.community.id, {
            vendorName, number: res.openingNumber, amount: Math.abs(amount), currency: line.currency ?? 'RON', fundId: fid,
            issueDate: line.date ?? null, accountId: res.accountId, ts, method: 'BANK', refId: refKey,
            openingKey: refKey, provenance: { ...provenance, opening: true },
          })
          refs.vendorInvoiceIds = [r.invoice.id]
          refs.vendorPaymentIds = [r.payment.id]
          refs.openingInvoiceId = r.invoice.id
          if (lineKey) bankRefs.vendorPayments.add(lineKey)
          return refs
        }
        // INVOICE_NOT_FOUND acknowledged: book the outflow on the default fund, without an invoice
        const tx = await this.createCashTxOnce(catalogue.community.id, { accountId: res.accountId, fundId: fid, amount: Math.abs(amount), direction: 'OUT', kind: 'PAYMENT', ts, memo, reference: lineKey, meta: provenance })
        refs.cashTxId = tx.id
        if (lineKey) bankRefs.cashTx.add(lineKey)
        return refs
      }
      // split the payment over the matched invoices, oldest first; the last one absorbs any overpayment
      let left = Math.abs(amount)
      refs.vendorPaymentIds = []
      for (const [i, inv] of invoices.entries()) {
        const share = i === invoices.length - 1 ? r2(left) : r2(Math.min(left, inv.outstanding))
        if (share <= 0) continue
        const existing = await this.prisma.vendorPayment.findFirst({ where: { communityId: catalogue.community.id, refId: refKey, invoiceId: inv.id }, select: { id: true } })
        if (existing) { refs.vendorPaymentIds.push(existing.id); left = r2(left - share); continue }
        const vp: any = await this.invoices.createVendorPayment(catalogue.community.id, inv.id, { amount: share, accountId: res.accountId, ts, method: 'BANK', refId: refKey, currency: line.currency ?? 'RON' })
        refs.vendorPaymentIds.push(vp?.id ?? vp?.payment?.id ?? null)
        left = r2(left - share)
      }
      if (lineKey) bankRefs.vendorPayments.add(lineKey)
      return refs
    }

    if (mapping.target === 'CASH_TX') {
      const fid = fundId(res.cashFundCode)
      if (!fid) throw new ConflictException('No fund for the cash transaction')
      const tx = await this.createCashTxOnce(catalogue.community.id, { accountId: res.accountId, fundId: fid, amount: Math.abs(amount), direction: amount < 0 ? 'OUT' : 'IN', kind: res.cashKind ?? 'OTHER', ts, memo, reference: lineKey, meta: provenance })
      refs.cashTxId = tx.id
      if (lineKey) bankRefs.cashTx.add(lineKey)
      return refs
    }
    throw new ConflictException(`Unknown bank-line target ${mapping.target}`)
  }

  private async createCashTxOnce(communityId: string, p: { accountId: string; fundId: string; amount: number; direction: 'IN' | 'OUT'; kind: string; ts: Date; memo: string | null; reference: string | null; meta: any }) {
    if (p.reference) {
      const existing = await this.prisma.cashTx.findFirst({ where: { communityId, refType: 'BANK_STATEMENT', refId: p.reference, direction: p.direction, fundId: p.fundId }, select: { id: true } })
      if (existing) return existing
    }
    return this.cash.createTx(communityId, { accountId: p.accountId, fundId: p.fundId, amount: p.amount, direction: p.direction, kind: p.kind, ts: p.ts, memo: p.memo, refType: 'BANK_STATEMENT', refId: p.reference, meta: p.meta })
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────

  /** Measure types (e.g. WATER_COLD) the allocated expense types need and this period does not have. */
  private async missingMeasureTypes(catalogue: IntakeCatalogue, mapping: any): Promise<string[]> {
    const codes = new Set<string>()
    for (const a of (mapping?.allocations ?? []) as Array<{ templateCode: string; itemKey: string }>) {
      const t = catalogue.templates.find((x) => x.code === a.templateCode)
      const item = t?.items.find((x) => x.key === a.itemKey)
      if (item?.expenseTypeCode) codes.add(item.expenseTypeCode)
    }
    if (!codes.size) return []
    const ets = await this.prisma.expenseType.findMany({ where: { communityId: catalogue.community.id, code: { in: [...codes] } }, select: { code: true, params: true, ruleId: true } })
    const ruleIds = new Set<string>()
    const needed = new Set<string>()
    const fromRule = (rule: { method: string; params: any } | null | undefined, weight?: string | null) => {
      if (!rule || rule.method !== 'BY_CONSUMPTION') return
      needed.add(weight || rule.params?.weightSource || rule.params?.measureType || 'CONSUMPTION')
    }
    const leaves: Array<{ ruleCode?: string; weightSource?: string; method?: string; params?: any }> = []
    for (const et of ets) {
      ruleIds.add(et.ruleId)
      const tpl: any[] = Array.isArray((et.params as any)?.splitTemplate) ? (et.params as any).splitTemplate : []
      const walk = (nodes: any[]) => {
        for (const n of nodes) {
          if (n?.allocation) leaves.push(n.allocation)
          if (Array.isArray(n?.children)) walk(n.children)
        }
      }
      walk(tpl)
    }
    for (const l of leaves) if (l.ruleCode) ruleIds.add(`${l.ruleCode}-${catalogue.community.id}`)
    const rules = await this.prisma.allocationRule.findMany({ where: { id: { in: [...ruleIds] } }, select: { id: true, method: true, params: true } })
    const ruleById = new Map(rules.map((r) => [r.id, r]))
    for (const et of ets) {
      const tpl: any[] = Array.isArray((et.params as any)?.splitTemplate) ? (et.params as any).splitTemplate : []
      if (!tpl.length) fromRule(ruleById.get(et.ruleId))
    }
    for (const l of leaves) {
      if (l.method === 'BY_CONSUMPTION') needed.add(l.weightSource || l.params?.weightSource || 'CONSUMPTION')
      else if (l.ruleCode) fromRule(ruleById.get(`${l.ruleCode}-${catalogue.community.id}`), l.weightSource)
      else if (l.weightSource && l.weightSource !== 'SQM' && l.weightSource !== 'RESIDENTS') needed.add(l.weightSource)
    }
    const missing: string[] = []
    for (const typeCode of needed) {
      if (typeCode === 'SQM' || typeCode === 'RESIDENTS') continue
      const n = await this.prisma.periodMeasure.count({ where: { communityId: catalogue.community.id, periodId: catalogue.period.id, scopeType: 'UNIT', typeCode } })
      if (!n) missing.push(typeCode)
    }
    return missing.sort()
  }

  effective(record: any): { invoice: any; mapping: any } {
    const review = (record.review as any) ?? null
    return { invoice: { ...(record.extracted ?? {}), ...(review?.invoice ?? {}) }, mapping: review?.mapping ?? record.proposal ?? {} }
  }

  groupByTemplate(mapping: any): Record<string, { items: Record<string, number>; total: number }> {
    const out: Record<string, { items: Record<string, number>; total: number }> = {}
    for (const a of (mapping?.allocations ?? []) as Array<{ templateCode: string; itemKey: string; amount: number }>) {
      const g = (out[a.templateCode] = out[a.templateCode] || { items: {}, total: 0 })
      g.items[a.itemKey] = r2((g.items[a.itemKey] ?? 0) + (money(a.amount) ?? 0))
      g.total = r2(g.total + (money(a.amount) ?? 0))
    }
    return out
  }

  private async findStandalone(communityId: string, record: any, invoice: any) {
    if (record.sourceSha256) {
      const byHash = await this.prisma.vendorInvoice.findFirst({ where: { communityId, hash: record.sourceSha256 }, select: { id: true } })
      if (byHash) return byHash
    }
    const byRecord = await this.prisma.vendorInvoice.findFirst({
      where: { communityId, provenance: { path: ['intakeRecordId'], equals: record.id } },
      select: { id: true },
    })
    return byRecord
  }

  /** VendorInvoiceDoc points at the admin's file by name — v1 stores no bytes. */
  private async linkDoc(invoiceId: string, record: any, batch: any): Promise<string | null> {
    if (!record.sourceFile) return null
    const url = `intake://${batch.id}/${record.id}/${encodeURIComponent(String(record.sourceFile))}`
    const existing = await this.prisma.vendorInvoiceDoc.findFirst({ where: { invoiceId, url }, select: { id: true } })
    if (existing) return existing.id
    const ext = String(record.sourceFile).toLowerCase().split('.').pop()
    const mime = ext === 'pdf' ? 'application/pdf' : ext === 'xml' ? 'application/xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : null
    const doc = await this.prisma.vendorInvoiceDoc.create({ data: { invoiceId, url, mime, sha256: record.sourceSha256 ?? null, source: 'IMPORT' } })
    return doc.id
  }
}
