import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { IntakeImportService } from './intake-import.service'
import { IntakePromptService } from './intake-prompt.service'
import { InvoiceMappingSchema, InvoiceBlockSchema, BankLineMappingSchema } from './intake-contract'
import { remainingBlockers, type Blocker } from './intake-blockers'
import { INTAKE_BLOCKER_META, metaKeys } from '../../common/enums-meta'

const BLOCKER_CODES = new Set(metaKeys(INTAKE_BLOCKER_META))

export type ReviewInput = {
  /** partial header edits (number, dates, amounts) — merged over the agent's extraction */
  invoice?: Record<string, unknown>
  /** full mapping (vendor, allocations, fallback) — replaces the agent's proposal when present */
  mapping?: unknown
  /** overridable blocker codes the admin acknowledges */
  overrides?: string[]
}

// Batch/record lifecycle for the review UI. Nothing here writes domain rows — that is IntakeApplyService.
@Injectable()
export class IntakeService {
  constructor(private readonly prisma: PrismaService, private readonly importer: IntakeImportService, private readonly prompt: IntakePromptService) {}

  async listBatches(communityRef: string, limit = 20) {
    const community = await this.prompt.resolveCommunity(communityRef)
    const rows = await this.prisma.intakeBatch.findMany({
      where: { communityId: community.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: { period: { select: { code: true } } },
    })
    return rows.map((b) => this.batchSummary(b))
  }

  async getBatch(communityRef: string, batchId: string) {
    const community = await this.prompt.resolveCommunity(communityRef)
    const batch = await this.prisma.intakeBatch.findFirst({
      where: { id: batchId, communityId: community.id },
      include: { period: { select: { code: true } }, records: { orderBy: { index: 'asc' } } },
    })
    if (!batch) throw new NotFoundException('Batch not found')
    const { records, ...rest } = batch
    return { batch: this.batchSummary(rest), records: records.map((r) => this.recordRow(r)) }
  }

  async context(communityRef: string, periodCode: string) {
    return this.prompt.buildCatalogue(communityRef, periodCode)
  }

  async review(communityRef: string, batchId: string, recordId: string, input: ReviewInput) {
    const { record } = await this.loadRecord(communityRef, batchId, recordId)
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    if (record.kind === 'OTHER' && (input.invoice || input.mapping)) throw new BadRequestException('Other documents cannot be edited')
    if (record.kind === 'BANK_LINE' && input.invoice) throw new BadRequestException('Bank lines have no invoice header')
    const prev: any = record.review ?? {}
    const next: any = { ...prev }
    if (input.mapping !== undefined && record.kind === 'BANK_LINE') {
      const parsed = BankLineMappingSchema.safeParse(input.mapping)
      if (!parsed.success) throw new BadRequestException({ message: 'Invalid bank-line mapping', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      next.mapping = parsed.data
    } else if (input.mapping !== undefined) {
      const parsed = InvoiceMappingSchema.safeParse(input.mapping)
      if (!parsed.success) throw new BadRequestException({ message: 'Invalid mapping', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      next.mapping = parsed.data
    }
    if (input.invoice !== undefined) {
      const merged = { ...(record.extracted as any), ...input.invoice }
      const parsed = InvoiceBlockSchema.safeParse(merged)
      if (!parsed.success) throw new BadRequestException({ message: 'Invalid invoice header', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
      next.invoice = input.invoice
    }
    if (input.overrides !== undefined) {
      const bad = input.overrides.filter((c) => !BLOCKER_CODES.has(c))
      if (bad.length) throw new BadRequestException(`Unknown blocker code(s): ${bad.join(', ')}`)
      next.overrides = input.overrides
    }
    await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { review: next, status: record.status === 'SKIPPED' ? 'SKIPPED' : 'NEEDS_REVIEW' } })
    await this.importer.recheckBatch(batchId, record.id)
    return this.getRecord(batchId, record.id)
  }

  async approve(communityRef: string, batchId: string, recordId: string, overrides?: string[]) {
    const { record } = await this.loadRecord(communityRef, batchId, recordId)
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    if (record.kind === 'OTHER') throw new BadRequestException('Other documents can only be skipped')
    if (overrides) await this.review(communityRef, batchId, recordId, { overrides })
    else await this.importer.recheckBatch(batchId, record.id)
    const fresh = await this.prisma.intakeRecord.findUniqueOrThrow({ where: { id: record.id } })
    const left = remainingBlockers((fresh.blockers as Blocker[]) ?? [], ((fresh.review as any)?.overrides as string[]) ?? [])
    if (left.length) {
      throw new ConflictException({ message: 'Record still has blockers', blockers: left })
    }
    // a bank line the agent says to IGNORE is "approved" by skipping it — nothing to apply
    const effTarget = fresh.kind === 'BANK_LINE' ? (((fresh.review as any)?.mapping ?? fresh.proposal) as any)?.target : null
    await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: effTarget === 'IGNORE' ? 'SKIPPED' : 'APPROVED' } })
    await this.importer.refreshStats(batchId)
    return this.getRecord(batchId, record.id)
  }

  async skip(communityRef: string, batchId: string, recordId: string) {
    const { record } = await this.loadRecord(communityRef, batchId, recordId)
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'SKIPPED' } })
    await this.importer.refreshStats(batchId)
    return this.getRecord(batchId, record.id)
  }

  async reopen(communityRef: string, batchId: string, recordId: string) {
    const { record } = await this.loadRecord(communityRef, batchId, recordId)
    if (record.status === 'APPLIED') throw new ConflictException('Record is already applied')
    await this.prisma.intakeRecord.update({ where: { id: record.id }, data: { status: 'NEEDS_REVIEW' } })
    await this.importer.recheckBatch(batchId, record.id)
    return this.getRecord(batchId, record.id)
  }

  async recheck(communityRef: string, batchId: string) {
    await this.loadBatch(communityRef, batchId)
    await this.importer.recheckBatch(batchId)
    return this.getBatch(communityRef, batchId)
  }

  async deleteBatch(communityRef: string, batchId: string) {
    const batch = await this.loadBatch(communityRef, batchId)
    const applied = await this.prisma.intakeRecord.count({ where: { batchId: batch.id, status: 'APPLIED' } })
    if (applied) throw new ConflictException(`Batch has ${applied} applied record(s) and cannot be deleted`)
    await this.prisma.intakeBatch.delete({ where: { id: batch.id } }) // records cascade
    return { ok: true }
  }

  // ── shapes ─────────────────────────────────────────────────────────────────────────────────────

  batchSummary(b: any) {
    return {
      id: b.id,
      periodCode: b.period?.code ?? null,
      status: b.status,
      contractVersion: b.contractVersion,
      promptVersion: b.promptVersion,
      agentLabel: b.agentLabel,
      sourceFileName: b.sourceFileName,
      stats: b.stats ?? null,
      error: b.error ?? null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }
  }

  recordRow(r: any) {
    const review = (r.review as any) ?? null
    return {
      id: r.id,
      index: r.index,
      kind: r.kind,
      status: r.status,
      sourceFile: r.sourceFile,
      sourceSha256: r.sourceSha256,
      confidence: r.confidence,
      rationale: r.rationale,
      extracted: r.extracted,
      proposal: r.proposal,
      review,
      /** what apply would use: header + mapping after the admin's edits */
      effective:
        r.kind === 'INVOICE'
          ? { invoice: { ...(r.extracted ?? {}), ...(review?.invoice ?? {}) }, mapping: review?.mapping ?? r.proposal }
          : r.kind === 'BANK_LINE'
            ? { bankLine: r.extracted ?? {}, mapping: review?.mapping ?? (r.proposal && (r.proposal as any).target ? r.proposal : null) }
            : null,
      resolved: r.resolved,
      blockers: r.blockers ?? [],
      remaining: remainingBlockers((r.blockers as Blocker[]) ?? [], review?.overrides ?? []),
      duplicateOfInvoiceId: r.duplicateOfInvoiceId,
      duplicateOfRecordId: r.duplicateOfRecordId,
      appliedRefs: r.appliedRefs,
      appliedAt: r.appliedAt,
      error: r.error,
    }
  }

  async getRecord(batchId: string, recordId: string) {
    const r = await this.prisma.intakeRecord.findFirst({ where: { id: recordId, batchId } })
    if (!r) throw new NotFoundException('Record not found')
    return this.recordRow(r)
  }

  private async loadBatch(communityRef: string, batchId: string) {
    const community = await this.prompt.resolveCommunity(communityRef)
    const batch = await this.prisma.intakeBatch.findFirst({ where: { id: batchId, communityId: community.id } })
    if (!batch) throw new NotFoundException('Batch not found')
    return batch
  }

  private async loadRecord(communityRef: string, batchId: string, recordId: string) {
    const batch = await this.loadBatch(communityRef, batchId)
    const record = await this.prisma.intakeRecord.findFirst({ where: { id: recordId, batchId: batch.id } })
    if (!record) throw new NotFoundException('Record not found')
    return { batch, record }
  }
}
