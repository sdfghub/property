// src/modules/period/period.service.ts
import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { AllocationService } from '../billing/allocation.service'
import { PaymentService } from '../billing/payment.service'
import type { Prisma, PrismaClient } from '@prisma/client'

type CloseStage = 'CLOSE_PREP' | 'CLOSE_FINAL'
type TxOrClient = PrismaClient | Prisma.TransactionClient

@Injectable()
export class PeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationService: AllocationService,
    private readonly paymentService: PaymentService,
  ) {}
  private readonly logger = new Logger(PeriodService.name)

  // --- Public API ---
  async listClosed(communityId: string) {
    return this.prisma.period.findMany({
      where: { communityId, status: 'CLOSED' },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
  }

  async listOpenOrDraft(communityId: string) {
    return this.prisma.period.findMany({
      where: { communityId, status: { not: 'CLOSED' } },
      orderBy: { seq: 'asc' },
      select: { id: true, code: true, seq: true, status: true },
    })
  }

  async createNext(communityId: string, explicitCode?: string) {
    const last = await this.prisma.period.findFirst({
      where: { communityId },
      orderBy: { seq: 'desc' },
      select: { seq: true, code: true },
    })
    const nextSeq = (last?.seq ?? 0) + 1
    const code = explicitCode || this.inferPeriodCode(last?.code, nextSeq)
    const existing = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code } } })
    if (existing) throw new ConflictException(`Period ${code} already exists`)
    const created = await this.prisma.period.create({
      data: {
        communityId,
        code,
        seq: nextSeq,
        status: 'OPEN',
        startDate: new Date(),
        endDate: new Date(),
      },
      select: { id: true, code: true, status: true, seq: true },
    })
    return created
  }

  async getEditable(communityId: string) {
    const period = await this.prisma.period.findFirst({
      where: { communityId, status: { not: 'CLOSED' } },
      orderBy: { seq: 'asc' },
    })
    if (!period) return { period: null, meters: { total: 0, closed: 0, open: [] }, bills: { total: 0, closed: 0, open: [] }, canClose: false }
    const meterTemplates = await (this.prisma as any).meterEntryTemplate.findMany({ where: { communityId }, select: { code: true, name: true } })
    const meterInstances = await (this.prisma as any).meterEntryTemplateInstance.findMany({
      where: { communityId, periodId: period.id },
      select: { templateId: true, state: true, template: { select: { code: true, name: true } } },
    })
    const meterStates = new Map<string, string>()
    meterInstances.forEach((i: any) => meterStates.set(i.template?.code, i.state))
    const metersOpen: string[] = []
    const metersClosed = meterTemplates.filter((m: any) => meterStates.get(m.code) === 'CLOSED').length
    meterTemplates.forEach((m: any) => {
      if (meterStates.get(m.code) !== 'CLOSED') metersOpen.push(m.code)
    })

    const billTemplates = await (this.prisma as any).billTemplate.findMany({ where: { communityId }, select: { code: true, name: true } })
    const billInstances = await (this.prisma as any).billTemplateInstance.findMany({
      where: { communityId, periodId: period.id },
      select: { templateId: true, state: true, template: { select: { code: true, name: true } } },
    })
    const billStates = new Map<string, string>()
    billInstances.forEach((i: any) => billStates.set(i.template?.code, i.state))
    const billsOpen: string[] = []
    const billsClosed = billTemplates.filter((b: any) => billStates.get(b.code) === 'CLOSED').length
    billTemplates.forEach((b: any) => {
      if (billStates.get(b.code) !== 'CLOSED') billsOpen.push(b.code)
    })

    const meters = { total: meterTemplates.length, closed: metersClosed, open: metersOpen }
    const bills = { total: billTemplates.length, closed: billsClosed, open: billsOpen }
    const allTemplatesClosed = meters.open.length === 0 && bills.open.length === 0
    const canPrepare = period.status === 'OPEN' && allTemplatesClosed
    const canClose = period.status === 'PREPARED' && allTemplatesClosed
    return { period, meters, bills, canClose, canPrepare }
  }

  async prepare(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'OPEN') throw new BadRequestException('Period must be OPEN to prepare')

    // ensure allocations are up to date before staging ledger/statement rows
    await this.recomputeAllocations(communityId, period)

    return this.prisma.$transaction(async (tx) => {
      const blockers = await this.getEditable(communityId)
      if (blockers.meters.open.length || blockers.bills.open.length) {
        throw new BadRequestException(
          `Templates must be closed before prepare. Open meters: ${blockers.meters.open.join(', ')}; bills: ${blockers.bills.open.join(', ')}`,
        )
      }

      // stage charges & statements
      await this.postChargesForStage(tx, communityId, period.id, 'CLOSE_PREP')
      await this.computeStatements(tx, communityId, period.id)
      // reapply payments against freshly staged charges
      this.log('[PAY] reapplying payments during prepare', { communityId, period: period.id })
      await this.paymentService.reapplyForPeriod(tx, communityId, period.id)

      // move to PREPARED
      await tx.period.update({
        where: { id: period.id },
        data: { status: 'PREPARED', preparedAt: new Date() },
      })
      return { ok: true }
    })
  }

  async approve(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'PREPARED') throw new BadRequestException('Period must be PREPARED to approve')

    return this.prisma.$transaction(async (tx) => {
      // promote ledger rows to FINAL
      await tx.beLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        data: { refType: 'CLOSE_FINAL' },
      })

      // ensure statements exist/updated (idempotent)
      await this.computeStatements(tx, communityId, period.id)

      // roll-forward opening balances to next period
      const next = await this.nextPeriodId(tx, communityId, period.seq)
      if (next) {
        const statements = await tx.beStatement.findMany({
          where: { communityId, periodId: period.id },
          select: { billingEntityId: true, currency: true, dueEnd: true },
        })
        for (const s of statements) {
          await tx.beOpeningBalance.upsert({
            where: {
              communityId_periodId_billingEntityId: {
                communityId,
                periodId: next,
                billingEntityId: s.billingEntityId,
              },
            },
            update: { amount: s.dueEnd, currency: s.currency },
            create: {
              communityId,
              periodId: next,
              billingEntityId: s.billingEntityId,
              amount: s.dueEnd,
              currency: s.currency,
            },
          })
        }
      }

      await tx.period.update({
        where: { id: period.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      })
      return { ok: true }
    })
  }

  async recompute(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    await this.recomputeAllocations(communityId, { id: period.id, seq: period.seq, code: period.code })
    return { ok: true }
  }

  async summary(communityId: string, periodCode: string) {
    const period = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: periodCode } },
      select: { id: true, code: true, status: true, preparedAt: true, closedAt: true },
    })
    if (!period) throw new BadRequestException('Period not found')

    const statements = await this.prisma.$queryRawUnsafe(
      `
      SELECT currency,
             SUM(charges)::numeric   AS charges,
             SUM(payments)::numeric  AS payments,
             SUM(due_end)::numeric   AS balance
      FROM be_statement
      WHERE community_id = $1 AND period_id = $2
      GROUP BY currency
      ORDER BY currency;
    `,
      communityId,
      period.id,
    )

    const allocations = await this.prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(et.code, 'custom') AS expense_type,
        SUM(e.allocatable_amount)::numeric AS expected,
        COALESCE(SUM(al.amount), 0)::numeric AS allocated,
        (SUM(e.allocatable_amount) - COALESCE(SUM(al.amount),0))::numeric AS delta
      FROM expense e
      JOIN period p ON p.id = e.period_id
      LEFT JOIN expense_type et ON et.id = e.expense_type_id
      LEFT JOIN allocation_line al ON al.expense_id = e.id
      WHERE e.community_id = $1 AND p.code = $2
      GROUP BY COALESCE(et.code, 'custom')
      ORDER BY expense_type;
    `,
      communityId,
      periodCode,
    )

    const beBuckets = await this.prisma.$queryRawUnsafe(
      `
      SELECT be.code AS "beCode",
             be.id   AS "beId",
             be.name AS "beName",
             be."order" AS "beOrder",
             le.bucket,
             SUM(le.amount)::numeric AS amount
      FROM be_ledger_entry le
      JOIN billing_entity be ON be.id = le.billing_entity_id
      WHERE le.community_id = $1 AND le.period_id = $2
        AND le.ref_type IN ($3, $4)
      GROUP BY be.id, be.code, be.name, be.order, le.bucket
      ORDER BY be.order ASC, be.code ASC, le.bucket ASC;
      `,
      communityId,
      period.id,
      'CLOSE_PREP',
      'CLOSE_FINAL',
    )

    return {
      period,
      statements,
      allocations,
      beBuckets,
    }
  }

  async reject(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'PREPARED') throw new BadRequestException('Period must be PREPARED to reject')

    return this.prisma.$transaction(async (tx) => {
      // remove staged artifacts
      await tx.beLedgerEntry.deleteMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
      })
      await tx.beStatement.deleteMany({ where: { communityId, periodId: period.id } })

      // back to OPEN
      await tx.period.update({
        where: { id: period.id },
        data: { status: 'OPEN', preparedAt: null },
      })
      return { ok: true }
    })
  }

  async reopen(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'CLOSED' && period.status !== 'PREPARED') {
      throw new BadRequestException('Only CLOSED or PREPARED periods can be reopened')
    }

    // guard: no later CLOSED period exists
    const laterClosed = await this.prisma.period.count({
      where: { communityId, seq: { gt: period.seq }, status: 'CLOSED' },
    })
    if (laterClosed > 0) throw new ConflictException('Cannot reopen: a later period is CLOSED')

    const refTypeToClean: CloseStage = period.status === 'CLOSED' ? 'CLOSE_FINAL' : 'CLOSE_PREP'

    return this.prisma.$transaction(async (tx) => {
      // delete artifacts tied to this stage
      const finalEntries = await tx.beLedgerEntry.findMany({
        where: { communityId, periodId: period.id, refType: refTypeToClean, refId: period.id },
        select: { id: true },
      })
      if (finalEntries.length) {
        const finalIds = finalEntries.map((e) => e.id)
        // Remove payment applications that point to these charges before deleting the ledger rows.
        const client: any = tx as any
        if (client.paymentApplication?.deleteMany) {
          await client.paymentApplication.deleteMany({
            where: { chargeId: { in: finalIds } },
          })
        }
        await tx.beLedgerEntryDetail.deleteMany({
          where: { ledgerEntryId: { in: finalIds } },
        })
        await tx.beLedgerEntry.deleteMany({
          where: { id: { in: finalIds } },
        })
      }
      await tx.beStatement.deleteMany({ where: { communityId, periodId: period.id } })

      // NOTE: we do NOT delete opening balances in the next period that were explicitly imported.
      // On next approve, roll-forward upsert will overwrite system-produced openings anyway.

      await tx.period.update({
        where: { id: period.id },
        data: { status: 'OPEN', closedAt: null, preparedAt: null },
      })
      return { ok: true }
    })
  }

  // --- Internals ---

  private async getPeriod(communityId: string, periodCode: string) {
    const period = await this.prisma.period.findFirst({
      where: { communityId, code: periodCode },
    })
    if (!period) throw new BadRequestException('Period not found')
    return period
  }

  private async nextPeriodId(tx: TxOrClient, communityId: string, seq: number): Promise<string | null> {
    const p = await tx.period.findFirst({
      where: { communityId, seq: { gt: seq } },
      orderBy: { seq: 'asc' },
      select: { id: true },
    })
    return p?.id ?? null
  }

  private inferPeriodCode(lastCode: string | undefined, nextSeq: number) {
    // Very lightweight guess: if last code matches YYYY-MM, increment month; otherwise fallback to seq.
    if (lastCode && /^\d{4}-\d{2}$/.test(lastCode)) {
      const [yStr, mStr] = lastCode.split('-')
      let y = Number(yStr)
      let m = Number(mStr)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
      return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}`
    }
    return `P-${nextSeq.toString().padStart(3, '0')}`
  }

  private async recomputeAllocations(communityId: string, period: { id: string; seq: number; code: string }) {
    // Idempotent: allocationService.createExpense clears prior allocations for the same expenseType/period
    const expenses = await this.prisma.expense.findMany({
      where: { communityId, periodId: period.id, expenseTypeId: { not: null } },
      select: { id: true, description: true, allocatableAmount: true, currency: true, expenseTypeId: true },
    })
    for (const exp of expenses) {
      await this.allocationService.createExpense(communityId, period, {
        description: exp.description,
        amount: Number(exp.allocatableAmount),
        currency: exp.currency || 'RON',
        expenseTypeId: exp.expenseTypeId ?? undefined,
      })
    }
  }

  private async postChargesForStage(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    stage: CloseStage,
  ) {
    const period = await tx.period.findUnique({ where: { id: periodId }, select: { seq: true } })
    const rules = await tx.bucketRule.findMany({ where: { communityId }, orderBy: { priority: 'asc' } })
    const splitGroups = await tx.splitGroupMember.findMany({
      where: { splitGroup: { communityId } },
      select: { splitNodeId: true, splitGroupId: true, splitGroup: { select: { code: true } } },
    })
    const groupByNode = new Map<string, string[]>()
    splitGroups.forEach((g) => {
      if (!g.splitGroup?.code) return
      const arr = groupByNode.get(g.splitNodeId) ?? []
      arr.push(g.splitGroup.code)
      groupByNode.set(g.splitNodeId, arr)
    })

    const allocations: Array<{ beId: string; unitId: string; amount: number; expenseType?: string | null; splitNodeId?: string | null }> =
      await tx.$queryRawUnsafe(
        `
        SELECT bem.billing_entity_id AS "beId",
               al.unit_id             AS "unitId",
               al.amount::numeric     AS amount,
               et.code                AS "expenseType",
               al.split_node_id       AS "splitNodeId"
        FROM allocation_line al
        JOIN billing_entity_member bem ON bem.unit_id = al.unit_id
        JOIN period p ON p.id = al.period_id
        LEFT JOIN expense e ON e.id = al.expense_id
        LEFT JOIN expense_type et ON et.id = e.expense_type_id
        WHERE al.community_id = $1 AND al.period_id = $2
          AND bem.start_seq <= p.seq AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
        `,
        communityId,
        periodId,
      )

    const bucketed = new Map<string, Map<string, number>>() // beId -> bucket -> amount
    const detailMap = new Map<string, Map<string, { amount: number; meta?: any }>>() // beId::bucket -> unitId -> detail
    const resolveBucket = (expType?: string | null, splitNodeId?: string | null): string => {
      const groupCodes = splitNodeId ? groupByNode.get(splitNodeId) ?? [] : []
      for (const r of rules) {
        if (r.programCode) continue
        if (r.expenseTypeCodes && expType && (r.expenseTypeCodes as any[]).includes(expType)) return r.code
        if (r.splitNodeIds && splitNodeId && (r.splitNodeIds as any[]).includes(splitNodeId)) return r.code
        if (r.splitGroupCodes && groupCodes.length) {
          const set = new Set(r.splitGroupCodes as any[])
          if (groupCodes.some((c) => set.has(c))) return r.code
        }
      }
      return 'ALLOCATED_EXPENSE'
    }

    for (const a of allocations) {
      const bucket = resolveBucket(a.expenseType, a.splitNodeId ?? undefined)
      const byBucket = bucketed.get(a.beId) ?? new Map<string, number>()
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + Number(a.amount))
      bucketed.set(a.beId, byBucket)
      const dk = `${a.beId}::${bucket}`
      const byUnit = detailMap.get(dk) ?? new Map<string, { amount: number; meta?: any }>()
      const entry = byUnit.get(a.unitId) ?? { amount: 0, meta: { source: 'ALLOC', expenseType: a.expenseType, splitNodeId: a.splitNodeId } }
      entry.amount += Number(a.amount)
      byUnit.set(a.unitId, entry)
      detailMap.set(dk, byUnit)
    }

    // Program contributions (per-period target split by rule)
    const programs = await tx.program.findMany({ where: { communityId } })
    if (programs.length) {
      const periodSeq = period?.seq ?? 0
      const periodSeqByCode = new Map<string, number>()
      const seedPeriods = await tx.period.findMany({
        where: { communityId },
        select: { code: true, seq: true },
      })
      seedPeriods.forEach((p) => periodSeqByCode.set(p.code, p.seq))

      const units = await tx.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
      const beMemberships = await tx.billingEntityMember.findMany({
        where: {
          billingEntity: { communityId },
          startSeq: { lte: period?.seq ?? 0 },
          OR: [{ endSeq: null }, { endSeq: { gte: period?.seq ?? 0 } }],
        },
        select: { unitId: true, billingEntityId: true },
      })
      const unitBe = new Map<string, string>()
      beMemberships.forEach((m) => unitBe.set(m.unitId, m.billingEntityId))
      const measures = await tx.periodMeasure.findMany({
        where: { communityId, periodId, scopeType: 'UNIT', typeCode: { in: ['SQM', 'RESIDENTS'] } },
        select: { scopeId: true, typeCode: true, value: true },
      })
      const measureByType = new Map<string, Map<string, number>>()
      for (const m of measures) {
        const map = measureByType.get(m.typeCode) ?? new Map<string, number>()
        map.set(m.scopeId, Number(m.value))
        measureByType.set(m.typeCode, map)
      }
      for (const proj of programs) {
        if (!proj.startPeriodCode) continue
        const startSeq = periodSeqByCode.get(proj.startPeriodCode)
        if (startSeq === undefined) continue
        const offset = periodSeq - startSeq
        if (offset < 0) continue

        let amount = 0
        const explicitTargets = (proj.targets as any[]) ?? []
        const hit = explicitTargets.find((t) => t?.offset === offset)
        if (hit?.amount != null) {
          amount = Number(hit.amount)
        } else if (proj.targetPlan) {
          const tp = proj.targetPlan as any
          const pc = Number(tp.periodCount ?? 0)
          const ppa = Number(tp.perPeriodAmount ?? 0)
          if (offset >= 0 && offset < pc) amount = ppa
        }
        if (!amount || amount <= 0) continue
        const method = (proj.allocation as any)?.method ?? 'BY_SQM'
        const basis = (proj.allocation as any)?.basis

        let eligibleUnits = units
        if (basis?.type === 'GROUP' && basis.code) {
          const g = await tx.unitGroup.findUnique({
            where: { code_communityId: { code: basis.code, communityId } },
            select: { id: true },
          })
          if (g) {
            const members = await tx.unitGroupMember.findMany({
              where: {
                groupId: g.id,
                startSeq: { lte: periodSeq },
                OR: [{ endSeq: null }, { endSeq: { gte: periodSeq } }],
              },
              select: { unitId: true },
            })
            const allowed = new Set(members.map((m) => m.unitId))
            eligibleUnits = units.filter((u) => allowed.has(u.id))
          } else {
            eligibleUnits = []
          }
        }
        if (!eligibleUnits.length) continue

        const weights: Map<string, number> = new Map()
        if (method === 'EXPLICIT') {
          const w = (proj.allocation as any)?.weights ?? {}
          eligibleUnits.forEach((u) => {
            const val = Number(w[u.code] ?? 0)
            if (val > 0) weights.set(u.id, val)
          })
        } else {
          let typeCode = 'SQM'
          if (method === 'BY_RESIDENTS') typeCode = 'RESIDENTS'
          const vals = measureByType.get(typeCode) ?? new Map()
          eligibleUnits.forEach((u) => {
            const val = vals.get(u.id)
            if (val !== undefined && val !== null && val > 0) weights.set(u.id, val)
          })
          if (method === 'EQUAL') {
            eligibleUnits.forEach((u) => weights.set(u.id, 1))
          }
        }
        const totalWeight = Array.from(weights.values()).reduce((s, v) => s + v, 0)
        if (totalWeight <= 0) continue
        const bucketCode = proj.defaultBucket ?? `PROGRAM:${proj.code}`
        eligibleUnits.forEach((u) => {
          const beId = unitBe.get(u.id)
          if (!beId) return
          const w = weights.get(u.id) ?? 0
          const share = w / totalWeight
          const amt = amount * share
          const beBuckets = bucketed.get(beId) ?? new Map<string, number>()
          beBuckets.set(bucketCode, (beBuckets.get(bucketCode) ?? 0) + amt)
          bucketed.set(beId, beBuckets)
          const dk = `${beId}::${bucketCode}`
          const byUnit = detailMap.get(dk) ?? new Map<string, { amount: number; meta?: any }>()
          const entry = byUnit.get(u.id) ?? { amount: 0, meta: { source: 'PROGRAM', programCode: proj.code } }
          entry.amount += amt
          byUnit.set(u.id, entry)
          detailMap.set(dk, byUnit)
        })
      }
    }

    for (const [beId, buckets] of bucketed.entries()) {
      for (const [bucket, amt] of buckets.entries()) {
        const le = await tx.beLedgerEntry.upsert({
          where: {
            communityId_periodId_billingEntityId_refType_refId_bucket: {
              communityId,
              periodId,
              billingEntityId: beId,
              refType: stage,
              refId: periodId,
              bucket,
            },
          },
          update: { amount: amt, bucket },
          create: {
            communityId,
            periodId,
            billingEntityId: beId,
            kind: 'CHARGE',
            amount: amt,
            currency: 'RON',
            refType: stage,
            refId: periodId,
            bucket,
          },
        })
        const dk = `${beId}::${bucket}`
        const byUnit = detailMap.get(dk)
        if (byUnit && byUnit.size) {
          await tx.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: le.id } })
          await tx.beLedgerEntryDetail.createMany({
            data: Array.from(byUnit.entries()).map(([unitId, v]) => ({
              ledgerEntryId: le.id,
              unitId,
              amount: v.amount,
              meta: v.meta,
            })),
            skipDuplicates: true,
          })
        }
      }
    }
  }

  private async computeStatements(tx: TxOrClient, communityId: string, periodId: string) {
    const period = await tx.period.findUnique({ where: { id: periodId }, select: { endDate: true } })
    const cutoff = period?.endDate ?? new Date()
    const bes = await tx.billingEntity.findMany({
      where: { communityId },
      select: { id: true },
    })

    for (const be of bes) {
      const opening = await tx.beOpeningBalance.findUnique({
        where: {
          communityId_periodId_billingEntityId: {
            communityId,
            periodId,
            billingEntityId: be.id,
          },
        },
        select: { amount: true, currency: true },
      })

      const [chargesAgg, paymentsAgg, adjustmentsAgg] = await Promise.all([
        tx.beLedgerEntry.aggregate({
          _sum: { amount: true },
          where: { communityId, periodId, billingEntityId: be.id, kind: 'CHARGE' },
        }),
        tx.beLedgerEntry.aggregate({
          _sum: { amount: true },
          where: { communityId, periodId, billingEntityId: be.id, kind: 'PAYMENT' },
        }),
        tx.beLedgerEntry.aggregate({
          _sum: { amount: true },
          where: { communityId, periodId, billingEntityId: be.id, kind: 'ADJUSTMENT' },
        }),
      ])

      const dueStart = Number(opening?.amount ?? 0)
      const charges = Number(chargesAgg._sum.amount ?? 0)
      const payments = Number(paymentsAgg._sum.amount ?? 0)
      const adjustments = Number(adjustmentsAgg._sum.amount ?? 0)
      const dueEnd = dueStart + charges - payments + adjustments

      await this.recomputeRunningDue(tx, communityId, periodId, be.id, dueStart)

      await tx.beStatement.upsert({
        where: {
          communityId_periodId_billingEntityId: {
            communityId,
            periodId,
            billingEntityId: be.id,
          },
        },
        update: {
          dueStart,
          charges,
          payments,
          adjustments,
          dueEnd,
          currency: opening?.currency ?? 'RON',
        },
        create: {
          communityId,
          periodId,
          billingEntityId: be.id,
          dueStart,
          charges,
          payments,
          adjustments,
          dueEnd,
          currency: opening?.currency ?? 'RON',
        },
      })
    }
  }

  private async recomputeRunningDue(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    beId: string,
    openingDue: number,
  ) {
    const entries = await tx.beLedgerEntry.findMany({
      where: { communityId, periodId, billingEntityId: beId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amount: true, kind: true },
    })

    let running = openingDue
    for (const entry of entries) {
      const delta = entry.kind === 'PAYMENT' ? -Number(entry.amount) : Number(entry.amount)
      running += delta
      await tx.beLedgerEntry.update({
        where: { id: entry.id },
        data: { runningDue: running },
      })
    }
  }

  private log(message: string, meta?: any) {
    this.logger.log(message + (meta ? ` ${JSON.stringify(meta)}` : ''))
  }
}
