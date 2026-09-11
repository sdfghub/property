import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { TemplateService } from '../billing/template.service'
import { VendorInvoiceService } from '../billing/vendor-invoice.service'
import { IntakeImportService } from './intake-import.service'
import { IntakePromptService, type IntakeCatalogue } from './intake-prompt.service'
import { remainingBlockers, type Blocker } from './intake-blockers'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

export type AppliedRefs = {
  /** templates this record has called saveBillTemplateState for, written BEFORE the call so a partial
   *  failure (e.g. missing meter readings) can be retried without tripping TEMPLATE_ALREADY_SUBMITTED */
  attemptedTemplates: string[]
  templateInstanceIds: string[]
  vendorInvoiceIds: string[]
  vendorInvoiceDocIds: string[]
  standaloneInvoiceId?: string | null
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
    const catalogue = await this.prompt.buildCatalogue(community.id, batch.period.code)
    if (catalogue.period.status !== 'OPEN') {
      throw new ConflictException({ message: `Period ${catalogue.period.code} is ${catalogue.period.status}; intake applies only into OPEN periods`, blockers: [{ code: 'PERIOD_NOT_OPEN', overridable: false }] })
    }

    // FAILED records were approved before they failed (e.g. missing meter readings) — retrying is the fix
    const where: any = { batchId: batch.id, status: { in: ['APPROVED', 'FAILED'] }, kind: 'INVOICE' }
    if (recordIds?.length) where.id = { in: recordIds }
    const records = await this.prisma.intakeRecord.findMany({ where, orderBy: { index: 'asc' } })
    if (!records.length) return { applied: [], failed: [], batchStatus: batch.status }

    await this.prisma.intakeBatch.update({ where: { id: batch.id }, data: { status: 'APPLYING', error: null } })
    const applied: Array<{ recordId: string; appliedRefs: AppliedRefs }> = []
    const failed: Array<{ recordId: string; error: string }> = []
    try {
      for (const record of records) {
        try {
          const refs = await this.applyRecord(record, catalogue, batch, roles)
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
    return { applied, failed, batchStatus: after.status }
  }

  // ── one record ────────────────────────────────────────────────────────────────────────────────

  private async applyRecord(record: any, catalogue: IntakeCatalogue, batch: any, roles: RoleAssignment[]): Promise<AppliedRefs> {
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    // re-check against the live catalogue right before writing; hard blockers cannot be overridden
    const rawWarnings = (batch.raw as any)?.records?.[record.index]?.warnings
    const prior: any = record.appliedRefs ?? {}
    const [checked] = this.importer.checkRecords([{ id: record.id, index: record.index, input: this.importer.toInput(record, rawWarnings), review: record.review ?? null, ownTemplates: prior.attemptedTemplates ?? [] }], catalogue)
    const left = remainingBlockers(checked.blockers as Blocker[], (record.review as any)?.overrides ?? [])
    if (left.length) throw new ConflictException(`Blocked: ${left.map((b) => `${b.code} (${b.message})`).join('; ')}`)

    const { invoice, mapping } = this.effective(record)
    const refs: AppliedRefs = { templateInstanceIds: [], vendorInvoiceIds: [], vendorInvoiceDocIds: [], standaloneInvoiceId: null, attemptedTemplates: [...((prior.attemptedTemplates as string[]) ?? [])] }
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

        if (!refs.attemptedTemplates.includes(code)) refs.attemptedTemplates.push(code)
        await persistRefs()
        const instance: any = await this.templates.saveBillTemplateState(catalogue.community.id, catalogue.period.code, code, roles, { state: 'SUBMITTED', values })
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

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────

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
