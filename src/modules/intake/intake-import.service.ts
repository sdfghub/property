import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { IntakePromptService, type IntakeCatalogue } from './intake-prompt.service'
import { parseImportPayload, type ImportPayload, type IntakeRecordInput } from './intake-contract'
import { bankLineKey, checkBankLine, checkInvoice, normalizeVendorName, phase2Blocker, type BankRefs, type Blocker } from './intake-blockers'

export type CheckedRecord = {
  index: number
  kind: string
  sourceFile: string | null
  sourceSha256: string | null
  confidence: number | null
  rationale: string | null
  extracted: any
  proposal: any
  blockers: Blocker[]
  resolved: any
  status: 'PROPOSED' | 'NEEDS_REVIEW'
}

// Turns an agent payload into IntakeBatch + IntakeRecord rows and computes the blockers. The check
// logic itself is in intake-blockers.ts so `intake:validate` and the review endpoints share it.
@Injectable()
export class IntakeImportService {
  constructor(private readonly prisma: PrismaService, private readonly prompt: IntakePromptService) {}

  /** Parse + check without touching the DB — the validate script and a dry-run for the API. */
  async checkPayload(communityRef: string, raw: unknown, opts: { expectedPeriodCode?: string } = {}) {
    const parsed = parseImportPayload(raw)
    if (!parsed.ok) throw new BadRequestException({ message: 'Payload does not match the intake contract', issues: parsed.issues })
    const payload = parsed.payload
    if (opts.expectedPeriodCode && opts.expectedPeriodCode !== payload.periodCode) {
      throw new BadRequestException({ message: `Payload is for period ${payload.periodCode}, expected ${opts.expectedPeriodCode}`, issues: [] })
    }
    const catalogue = await this.prompt.buildCatalogue(communityRef, payload.periodCode)
    if (payload.community && payload.community !== catalogue.community.code) {
      throw new BadRequestException({ message: `Payload is for community ${payload.community}, not ${catalogue.community.code}`, issues: [] })
    }
    const bankRefs = await this.loadBankRefs(catalogue.community.id, payload.records)
    const records = this.checkRecords(payload.records.map((r, i) => ({ id: `#${i}`, index: i, input: r, review: null })), catalogue, bankRefs)
    return { payload, catalogue, records }
  }

  /** Persist a checked payload as a batch. */
  async importPayload(communityRef: string, raw: unknown, opts: { createdBy?: string | null; sourceFileName?: string | null; expectedPeriodCode?: string }) {
    const { payload, catalogue, records } = await this.checkPayload(communityRef, raw, opts)
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.intakeBatch.create({
        data: {
          communityId: catalogue.community.id,
          periodId: catalogue.period.id,
          status: 'REVIEW',
          contractVersion: payload.contractVersion,
          promptVersion: payload.promptVersion,
          agentLabel: payload.meta.agent,
          sourceFileName: opts.sourceFileName ?? payload.meta.sourceArchive ?? null,
          raw: payload as any,
          createdBy: opts.createdBy ?? null,
          stats: this.stats(records),
        },
      })
      for (const r of records) {
        await tx.intakeRecord.create({
          data: {
            batchId: b.id,
            communityId: catalogue.community.id,
            index: r.index,
            kind: r.kind as any,
            status: r.status,
            sourceFile: r.sourceFile,
            sourceSha256: r.sourceSha256,
            confidence: r.confidence,
            rationale: r.rationale,
            extracted: r.extracted,
            proposal: r.proposal,
            blockers: r.blockers as any,
            resolved: r.resolved,
            duplicateOfInvoiceId: r.resolved?.duplicateOfInvoiceId ?? null,
          },
        })
      }
      return b
    })
    // in-batch duplicate references point at sibling *indices* at check time; rewrite them to ids now
    const rows = await this.prisma.intakeRecord.findMany({ where: { batchId: batch.id }, select: { id: true, index: true, resolved: true } })
    const idByIndex = new Map(rows.map((r) => [`#${r.index}`, r.id]))
    for (const row of rows) {
      const dup = (row.resolved as any)?.duplicateOfRecordId as string | null
      if (dup && idByIndex.has(dup)) {
        await this.prisma.intakeRecord.update({
          where: { id: row.id },
          data: { duplicateOfRecordId: idByIndex.get(dup)!, resolved: { ...(row.resolved as any), duplicateOfRecordId: idByIndex.get(dup) } },
        })
      }
    }
    return batch
  }

  /**
   * Re-run the checks for every record of a batch against the live catalogue (after the admin edited a
   * mapping, or fixed a vendor / expense type elsewhere). Applied and skipped records are left alone.
   */
  async recheckBatch(batchId: string, onlyRecordId?: string) {
    const batch = await this.prisma.intakeBatch.findUnique({ where: { id: batchId }, include: { period: { select: { code: true } }, records: true } })
    if (!batch) throw new BadRequestException('Batch not found')
    const catalogue = await this.prompt.buildCatalogue(batch.communityId, batch.period.code)
    // agent warnings live only in the verbatim payload (batch.raw) — they must survive every recheck
    const rawRecords: any[] = Array.isArray((batch.raw as any)?.records) ? (batch.raw as any).records : []
    const inputs = batch.records.map((r) => ({
      id: r.id,
      index: r.index,
      input: this.toInput(r, rawRecords[r.index]?.warnings),
      review: (r.review as any) ?? null,
      ownTemplates: [...(((r.appliedRefs as any)?.attemptedTemplates as string[]) ?? []), ...(((r.appliedRefs as any)?.stagedTemplates as string[]) ?? [])],
    }))
    const bankRefs = await this.loadBankRefs(batch.communityId, inputs.map((i) => i.input))
    const checked = this.checkRecords(inputs, catalogue, bankRefs)
    for (const c of checked) {
      const row = batch.records.find((r) => r.index === c.index)!
      if (onlyRecordId && row.id !== onlyRecordId) continue
      if (row.status === 'APPLIED' || row.status === 'SKIPPED' || row.status === 'STAGED') continue
      const keepApproved = row.status === 'APPROVED' && !c.blockers.some((b) => !b.overridable)
      await this.prisma.intakeRecord.update({
        where: { id: row.id },
        data: {
          blockers: c.blockers as any,
          resolved: c.resolved,
          duplicateOfInvoiceId: c.resolved?.duplicateOfInvoiceId ?? null,
          duplicateOfRecordId: c.resolved?.duplicateOfRecordId ?? null,
          status: keepApproved ? 'APPROVED' : c.status,
        },
      })
    }
    await this.refreshStats(batchId)
    return catalogue
  }

  async refreshStats(batchId: string) {
    const rows = await this.prisma.intakeRecord.findMany({ where: { batchId }, select: { status: true, kind: true } })
    const byStatus: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    }
    const applicable = rows.filter((r) => r.kind === 'INVOICE' || r.kind === 'BANK_LINE')
    const anyApplied = rows.some((r) => r.status === 'APPLIED')
    const anyFailed = rows.some((r) => r.status === 'FAILED')
    const done = applicable.length > 0 && applicable.every((r) => r.status === 'APPLIED' || r.status === 'SKIPPED')
    // APPLIED when every invoice and bank line is applied/skipped; FAILED only when nothing at all got through; else REVIEW
    const status = done && anyApplied ? 'APPLIED' : anyFailed && !anyApplied ? 'FAILED' : 'REVIEW'
    const current = await this.prisma.intakeBatch.findUnique({ where: { id: batchId }, select: { status: true } })
    await this.prisma.intakeBatch.update({
      where: { id: batchId },
      data: { stats: { records: rows.length, byStatus, byKind }, ...(current?.status === 'APPLYING' ? {} : { status }) },
    })
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────

  /** Rebuild the contract-shaped record from stored columns (extracted + proposal). */
  toInput(r: { kind: string; sourceFile: string | null; sourceSha256: string | null; confidence: number | null; rationale: string | null; extracted: any; proposal: any }, warnings?: unknown): IntakeRecordInput {
    const base = { sourceFile: r.sourceFile, sourceSha256: r.sourceSha256, confidence: r.confidence ?? 0, rationale: r.rationale, warnings: Array.isArray(warnings) ? warnings.map(String) : ([] as string[]) }
    if (r.kind === 'INVOICE') return { kind: 'INVOICE', ...base, invoice: r.extracted, mapping: r.proposal } as any
    if (r.kind === 'BANK_LINE') return { kind: 'BANK_LINE', ...base, bankLine: r.extracted, mapping: r.proposal && (r.proposal as any).target ? r.proposal : null } as any
    return { kind: 'OTHER', ...base, note: r.extracted?.note ?? null } as any
  }

  checkRecords(rows: Array<{ id: string; index: number; input: IntakeRecordInput; review: any | null; ownTemplates?: string[] }>, catalogue: IntakeCatalogue, bankRefs: BankRefs = { payments: new Set(), vendorPayments: new Set(), cashTx: new Set() }): CheckedRecord[] {
    const bankSiblings = rows.filter((r) => r.input.kind === 'BANK_LINE').map((r) => ({ id: r.id, lineKey: bankLineKey((r.input as any).bankLine?.reference, (r.input as any).bankLine?.amount) }))
    // siblings for in-batch duplicate detection use the *effective* mapping's vendor
    const siblings = rows.map((row) => {
      if (row.input.kind !== 'INVOICE') return { id: row.id, number: null, vendorKey: '', sha256: row.input.sourceSha256 }
      const mapping = row.review?.mapping ?? row.input.mapping
      const invoice = { ...row.input.invoice, ...(row.review?.invoice ?? {}) }
      const vendorKey = mapping?.vendor?.vendorId ?? normalizeVendorName(mapping?.vendor?.name ?? invoice.vendorName)
      return { id: row.id, number: invoice.number, vendorKey, sha256: row.input.sourceSha256 }
    })
    return rows.map((row) => {
      const r = row.input
      const base = { index: row.index, sourceFile: r.sourceFile, sourceSha256: r.sourceSha256, confidence: r.confidence, rationale: r.rationale }
      if (r.kind === 'INVOICE') {
        // review = { invoice?: partial header edits, mapping?: full mapping, overrides?: string[] }
        const mapping = row.review?.mapping ?? r.mapping
        const invoice = { ...r.invoice, ...(row.review?.invoice ?? {}) }
        const res = checkInvoice({ invoice, mapping, confidence: r.confidence, sourceSha256: r.sourceSha256, siblings, selfId: row.id, ownTemplates: row.ownTemplates }, catalogue)
        const warnings: Blocker[] = (r.warnings ?? []).map((w) => ({ code: 'LOW_CONFIDENCE', message: `agent: ${w}`, overridable: true }))
        const blockers = [...res.blockers, ...(res.blockers.some((b) => b.code === 'LOW_CONFIDENCE') ? [] : warnings.slice(0, 1))]
        return { ...base, kind: 'INVOICE', extracted: r.invoice, proposal: r.mapping, blockers, resolved: res.resolved, status: blockers.length ? 'NEEDS_REVIEW' : 'PROPOSED' }
      }
      if (r.kind === 'BANK_LINE') {
        // review = { mapping?: full BankLineMapping, overrides?: string[] }
        const mapping = row.review?.mapping ?? r.mapping ?? null
        const res = checkBankLine({ bankLine: r.bankLine, mapping, confidence: r.confidence, selfId: row.id, siblings: bankSiblings, existing: bankRefs }, catalogue)
        const warnings: Blocker[] = (r.warnings ?? []).map((w) => ({ code: 'LOW_CONFIDENCE', message: `agent: ${w}`, overridable: true }))
        const blockers = [...res.blockers, ...(res.blockers.some((b) => b.code === 'LOW_CONFIDENCE') ? [] : warnings.slice(0, 1))]
        return { ...base, kind: 'BANK_LINE', extracted: r.bankLine, proposal: r.mapping ?? {}, blockers, resolved: res.resolved, status: blockers.length ? 'NEEDS_REVIEW' : 'PROPOSED' }
      }
      return { ...base, kind: 'OTHER', extracted: { note: r.note }, proposal: {}, blockers: [phase2Blocker('OTHER')], resolved: null, status: 'NEEDS_REVIEW' }
    })
  }

  /** Bank references already in the books, so a statement line imported twice (or after a register import) is refused. */
  async loadBankRefs(communityId: string, records: IntakeRecordInput[]): Promise<BankRefs> {
    const lines = records.filter((r) => r.kind === 'BANK_LINE').map((r: any) => r.bankLine ?? {})
    const refs = [...new Set(lines.map((l) => (l.reference ? String(l.reference).trim() : '')).filter(Boolean))]
    const keys = [...new Set(lines.map((l) => bankLineKey(l.reference, l.amount)).filter(Boolean))] as string[]
    const out: BankRefs = { payments: new Set(), vendorPayments: new Set(), cashTx: new Set() }
    if (!refs.length) return out
    const bankIds = keys.map((k) => `bank:${k}`)
    const [pays, vpays, txs] = await Promise.all([
      // register-imported receipts carry the bare reference in providerRef — key them with their own amount
      this.prisma.payment.findMany({ where: { communityId, OR: [{ providerRef: { in: refs } }, { refId: { in: bankIds } }] }, select: { providerRef: true, refId: true, amount: true } }),
      this.prisma.vendorPayment.findMany({ where: { communityId, refId: { in: bankIds } }, select: { refId: true } }),
      this.prisma.cashTx.findMany({ where: { communityId, refType: 'BANK_STATEMENT', refId: { in: keys } }, select: { refId: true } }),
    ])
    for (const p of pays) {
      if (p.refId?.startsWith('bank:')) out.payments.add(p.refId.slice(5))
      else if (p.providerRef) { const k = bankLineKey(p.providerRef, Number(p.amount)); if (k) out.payments.add(k) }
    }
    for (const v of vpays) if (v.refId?.startsWith('bank:')) out.vendorPayments.add(v.refId.slice(5))
    for (const t of txs) if (t.refId) out.cashTx.add(t.refId)
    return out
  }

  private stats(records: CheckedRecord[]) {
    const byStatus: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    for (const r of records) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1
    }
    return { records: records.length, byStatus, byKind }
  }
}

export type { ImportPayload }
