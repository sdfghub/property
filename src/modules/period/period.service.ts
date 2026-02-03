// src/modules/period/period.service.ts
import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { AllocationService } from '../billing/allocation.service'
import { PaymentService } from '../billing/payment.service'
import { ensureLedgerEntryDetail } from '../billing/ledger-detail.util'
import { ensureFundLedgerEntryDetail } from '../billing/fund-ledger-detail.util'
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

  async listAll(communityId: string) {
    return this.prisma.period.findMany({
      where: { communityId },
      orderBy: { seq: 'asc' },
      select: { id: true, code: true, seq: true, status: true, closedAt: true },
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
      await this.computeCommunityStatements(tx, communityId, period.id)

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
      // cleanup any previous finalize attempts to avoid unique conflicts
      await tx.beLedgerEntryDetail.deleteMany({
        where: { ledger: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id } },
      })
      await tx.communityLedgerEntryDetail.deleteMany({
        where: { ledger: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id } },
      })
      await tx.beLedgerEntry.deleteMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id },
      })
      await tx.communityLedgerEntry.deleteMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id },
      })

      // promote ledger rows to FINAL
      await tx.beLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        data: { refType: 'CLOSE_FINAL' },
      })
      await tx.communityLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        data: { refType: 'CLOSE_FINAL' },
      })

      // ensure statements exist/updated (idempotent)
      await this.computeStatements(tx, communityId, period.id)
      await this.computeCommunityStatements(tx, communityId, period.id)

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
        const communityStatement = await tx.communityStatement.findUnique({
          where: { communityId_periodId: { communityId, periodId: period.id } },
          select: { currency: true, dueEnd: true },
        })
        if (communityStatement) {
          await tx.communityOpeningBalance.upsert({
            where: { communityId_periodId: { communityId, periodId: next } },
            update: { amount: communityStatement.dueEnd, currency: communityStatement.currency },
            create: {
              communityId,
              periodId: next,
              amount: communityStatement.dueEnd,
              currency: communityStatement.currency,
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
             SUM(due_start)::numeric AS due_start,
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
      WITH expected AS (
        SELECT
          COALESCE(cc.allocation_snapshot->>'expenseType', 'custom') AS expense_type,
          SUM(cc.amount)::numeric AS expected
        FROM community_charge cc
        WHERE cc.community_id = $1
          AND cc.period_id = $2
          AND cc.source_type = 'EXPENSE'
        GROUP BY COALESCE(cc.allocation_snapshot->>'expenseType', 'custom')
      ),
      allocated AS (
        SELECT
          COALESCE(ccl.meta->>'expenseType', 'custom') AS expense_type,
          COALESCE(SUM(ccl.amount), 0)::numeric AS allocated
        FROM community_charge_line ccl
        JOIN community_charge cc ON cc.id = ccl.charge_id
        WHERE ccl.community_id = $1
          AND ccl.period_id = $2
          AND cc.source_type = 'EXPENSE'
        GROUP BY COALESCE(ccl.meta->>'expenseType', 'custom')
      )
      SELECT
        COALESCE(expected.expense_type, allocated.expense_type) AS expense_type,
        COALESCE(expected.expected, 0)::numeric AS expected,
        COALESCE(allocated.allocated, 0)::numeric AS allocated,
        (COALESCE(expected.expected, 0) - COALESCE(allocated.allocated, 0))::numeric AS delta
      FROM expected
      FULL OUTER JOIN allocated USING (expense_type)
      ORDER BY expense_type;
    `,
      communityId,
      period.id,
    )

    const beFundTotals = await this.prisma.$queryRawUnsafe(
      `
      SELECT be.code AS "beCode",
             be.id   AS "beId",
             be.name AS "beName",
             be."order" AS "beOrder",
             le.fund_id AS "fundId",
             SUM(le.amount)::numeric AS amount
      FROM be_ledger_entry le
      JOIN billing_entity be ON be.id = le.billing_entity_id
      WHERE le.community_id = $1 AND le.period_id = $2
        AND le.ref_type IN ($3, $4)
      GROUP BY be.id, be.code, be.name, be.order, le.fund_id
      ORDER BY be.order ASC, be.code ASC, le.fund_id ASC;
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
      beFundTotals,
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
      const communityEntries = await tx.communityLedgerEntry.findMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        select: { id: true },
      })
      if (communityEntries.length) {
        await tx.communityLedgerEntryDetail.deleteMany({
          where: { ledgerEntryId: { in: communityEntries.map((e) => e.id) } },
        })
        await tx.communityLedgerEntry.deleteMany({ where: { id: { in: communityEntries.map((e) => e.id) } } })
      }
      await tx.communityStatement.deleteMany({ where: { communityId, periodId: period.id } })

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
      const communityEntries = await tx.communityLedgerEntry.findMany({
        where: { communityId, periodId: period.id, refType: refTypeToClean, refId: period.id },
        select: { id: true },
      })
      if (communityEntries.length) {
        await tx.communityLedgerEntryDetail.deleteMany({
          where: { ledgerEntryId: { in: communityEntries.map((e) => e.id) } },
        })
        await tx.communityLedgerEntry.deleteMany({ where: { id: { in: communityEntries.map((e) => e.id) } } })
      }
      await tx.communityStatement.deleteMany({ where: { communityId, periodId: period.id } })

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
    const charges = await this.prisma.communityCharge.findMany({
      where: { communityId, periodId: period.id, sourceType: 'EXPENSE' },
      select: { id: true },
    })
    if (charges.length) return
  }

  private async postChargesForStage(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    stage: CloseStage,
  ) {
    const period = await tx.period.findUnique({ where: { id: periodId }, select: { seq: true } })
    const existingCharges = await tx.communityCharge.findMany({
      where: { communityId, periodId, status: 'ACTIVE' },
      include: { lines: true },
    })
    const hasChargeLines = existingCharges.some((c) => c.lines.length)
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

    const beFundTotals = new Map<string, Map<string, number>>() // beId -> fundId -> amount
    const detailMap = new Map<string, Map<string, { amount: number; meta?: any }>>() // beId::fundId -> unitId -> detail
    const fundTotals = new Map<string, number>() // fundId -> amount

    if (hasChargeLines) {
      for (const charge of existingCharges) {
        const fundId = charge.fundId
        for (const line of charge.lines) {
          const byFund = beFundTotals.get(line.billingEntityId) ?? new Map<string, number>()
          byFund.set(fundId, (byFund.get(fundId) ?? 0) + Number(line.amount))
          beFundTotals.set(line.billingEntityId, byFund)

          const dk = `${line.billingEntityId}::${fundId}`
          const byUnit = detailMap.get(dk) ?? new Map<string, { amount: number; meta?: any }>()
          const entry = byUnit.get(line.unitId) ?? { amount: 0, meta: line.meta }
          entry.amount += Number(line.amount)
          byUnit.set(line.unitId, entry)
          detailMap.set(dk, byUnit)

          if (charge.fundId) {
            fundTotals.set(charge.fundId, (fundTotals.get(charge.fundId) ?? 0) + Number(line.amount))
          }
        }
      }
    }

    // Fund contributions (per-period target split by rule)
    const funds = await tx.fund.findMany({ where: { communityId } })
    if (funds.length) {
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
      for (const proj of funds) {
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
        const fundId = proj.id
        const fundLines: Array<{ unitId: string; beId: string; amount: number; meta?: any }> = []
        let fundTotal = 0
        eligibleUnits.forEach((u) => {
          const beId = unitBe.get(u.id)
          if (!beId) return
          const w = weights.get(u.id) ?? 0
          const share = w / totalWeight
          const amt = amount * share
          fundTotal += amt
          fundLines.push({
            unitId: u.id,
            beId,
            amount: amt,
            meta: { source: 'FUND', fundCode: proj.code },
          })
          const beTotals = beFundTotals.get(beId) ?? new Map<string, number>()
          beTotals.set(fundId, (beTotals.get(fundId) ?? 0) + amt)
          beFundTotals.set(beId, beTotals)
          fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + amt)
          const dk = `${beId}::${fundId}`
          const byUnit = detailMap.get(dk) ?? new Map<string, { amount: number; meta?: any }>()
          const entry = byUnit.get(u.id) ?? { amount: 0, meta: { source: 'FUND', fundCode: proj.code } }
          entry.amount += amt
          byUnit.set(u.id, entry)
          detailMap.set(dk, byUnit)
        })
        if (fundLines.length) {
          const fundCharge = await tx.communityCharge.upsert({
            where: {
              communityId_periodId_sourceType_sourceId_sourceKey_fundId: {
                communityId,
                periodId,
                sourceType: 'FUND',
                sourceId: proj.id,
                sourceKey: `offset:${offset}`,
                fundId,
              },
            },
            update: {
              amount: fundTotal,
              currency: proj.currency || 'RON',
              allocationStrategy: method,
              allocationSnapshot: {
                method,
                basis,
                periodSeq,
                offset,
                amount: fundTotal,
              },
              status: 'ACTIVE',
              fundId: proj.id,
              meta: { source: 'FUND', fundCode: proj.code, offset },
            },
            create: {
              communityId,
              periodId,
              fundId: proj.id,
              sourceType: 'FUND',
              sourceId: proj.id,
              sourceKey: `offset:${offset}`,
              amount: fundTotal,
              currency: proj.currency || 'RON',
              allocationStrategy: method,
              allocationSnapshot: {
                method,
                basis,
                periodSeq,
                offset,
                amount: fundTotal,
              },
              status: 'ACTIVE',
              meta: { source: 'FUND', fundCode: proj.code, offset },
            },
          })
          await tx.communityChargeLine.deleteMany({ where: { chargeId: fundCharge.id } })
          await tx.communityChargeLine.createMany({
            data: fundLines.map((line) => ({
              chargeId: fundCharge.id,
              communityId,
              periodId,
              billingEntityId: line.beId,
              unitId: line.unitId,
              amount: line.amount,
              meta: line.meta,
            })),
            skipDuplicates: true,
          })
        }
      }
    }

    const communityFundTotals = new Map<string, number>()
    for (const [beId, fundIds] of beFundTotals.entries()) {
      for (const [fundId, amt] of fundIds.entries()) {
        communityFundTotals.set(fundId, (communityFundTotals.get(fundId) ?? 0) + amt)
        const le = await tx.beLedgerEntry.upsert({
          where: {
            communityId_periodId_billingEntityId_refType_refId_fundId: {
              communityId,
              periodId,
              billingEntityId: beId,
              refType: stage,
              refId: periodId,
              fundId,
            },
          },
          update: { amount: amt, fundId },
          create: {
            communityId,
            periodId,
            billingEntityId: beId,
            kind: 'CHARGE',
            lane: 'ACCRUAL',
            amount: amt,
            currency: 'RON',
            refType: stage,
            refId: periodId,
            fundId,
          },
        })
        const dk = `${beId}::${fundId}`
        const byUnit = detailMap.get(dk)
        if (byUnit && byUnit.size) {
          await tx.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: le.id } })
          await tx.beLedgerEntryDetail.createMany({
            data: Array.from(byUnit.entries()).map(([unitId, v]) => ({
              ledgerEntryId: le.id,
              communityId: le.communityId,
              periodId: le.periodId,
              billingEntityId: le.billingEntityId,
              kind: le.kind,
              fundId: le.fundId,
              currency: le.currency,
              refType: le.refType,
              refId: le.refId,
              unitId,
              amount: v.amount,
              meta: v.meta,
            })),
            skipDuplicates: true,
          })
        } else {
          await ensureLedgerEntryDetail(tx, le, amt, {
            synthetic: true,
            reason: 'no-unit',
            fundId,
          })
        }
      }
    }

    for (const [fundId, amt] of communityFundTotals.entries()) {
      const cle = await tx.communityLedgerEntry.upsert({
        where: {
          communityId_periodId_refType_refId_fundId_kind: {
            communityId,
            periodId,
            refType: stage,
            refId: periodId,
            fundId,
            kind: 'REVENUE',
          },
        },
        update: { amount: amt, fundId },
        create: {
          communityId,
          periodId,
          kind: 'REVENUE',
          lane: 'ACCRUAL',
          amount: amt,
          currency: 'RON',
          refType: stage,
          refId: periodId,
          fundId,
        },
      })
      await tx.communityLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: cle.id } })
      await tx.communityLedgerEntryDetail.create({
        data: {
          ledgerEntryId: cle.id,
          communityId: cle.communityId,
          periodId: cle.periodId,
          kind: cle.kind,
          fundId: cle.fundId,
          currency: cle.currency,
          refType: cle.refType,
          refId: cle.refId,
          amount: amt,
          meta: { synthetic: true, reason: 'fundId-total' },
        },
      })
    }

    for (const [fundId, amt] of fundTotals.entries()) {
      const ple = await tx.fundLedgerEntry.upsert({
        where: {
          communityId_fundId_periodId_refType_refId_kind: {
            communityId,
            fundId,
            periodId,
            refType: stage,
            refId: periodId,
            kind: 'REVENUE',
          },
        },
        update: { amount: amt, fundId },
        create: {
          communityId,
          fundId,
          periodId,
          kind: 'REVENUE',
          lane: 'ACCRUAL',
          amount: amt,
          currency: 'RON',
          refType: stage,
          refId: periodId,
        },
      })
      await tx.fundLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: ple.id } })
      await ensureFundLedgerEntryDetail(tx, ple, amt, {
        synthetic: true,
        reason: 'fund-total',
        fundId,
      })
    }
  }

  private async computeStatements(tx: TxOrClient, communityId: string, periodId: string) {
    const period = await tx.period.findUnique({
      where: { id: periodId },
      select: { endDate: true, seq: true, communityId: true },
    })
    const cutoff = period?.endDate ?? new Date()
    const bes = await tx.billingEntity.findMany({
      where: { communityId },
      select: { id: true },
    })

    for (const be of bes) {
      const previousPeriod = await tx.period.findFirst({
        where: { communityId, seq: { lt: period?.seq ?? 0 } },
        orderBy: { seq: 'desc' },
        select: { id: true },
      })
      const previousStatement = previousPeriod
        ? await tx.beStatement.findUnique({
            where: {
              communityId_periodId_billingEntityId: {
                communityId,
                periodId: previousPeriod.id,
                billingEntityId: be.id,
              },
            },
            select: { dueEnd: true, currency: true },
          })
        : null

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
          where: { communityId, periodId, billingEntityId: be.id, kind: 'CHARGE', lane: 'ACCRUAL' },
        }),
        tx.beLedgerEntry.aggregate({
          _sum: { amount: true },
          where: { communityId, periodId, billingEntityId: be.id, kind: 'PAYMENT', lane: 'CASH' },
        }),
        tx.beLedgerEntry.aggregate({
          _sum: { amount: true },
          where: { communityId, periodId, billingEntityId: be.id, kind: 'ADJUSTMENT', lane: 'ACCRUAL' },
        }),
      ])

      const dueStart = Number(previousStatement?.dueEnd ?? opening?.amount ?? 0)
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
          currency: previousStatement?.currency ?? opening?.currency ?? 'RON',
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
          currency: previousStatement?.currency ?? opening?.currency ?? 'RON',
        },
      })
    }
  }

  private async computeCommunityStatements(tx: TxOrClient, communityId: string, periodId: string) {
    const period = await tx.period.findUnique({
      where: { id: periodId },
      select: { seq: true },
    })
    const previousPeriod = await tx.period.findFirst({
      where: { communityId, seq: { lt: period?.seq ?? 0 } },
      orderBy: { seq: 'desc' },
      select: { id: true },
    })
    const previousStatement = previousPeriod
      ? await tx.communityStatement.findUnique({
          where: { communityId_periodId: { communityId, periodId: previousPeriod.id } },
          select: { dueEnd: true, currency: true },
        })
      : null
    const opening = await tx.communityOpeningBalance.findUnique({
      where: { communityId_periodId: { communityId, periodId } },
      select: { amount: true, currency: true },
    })

    const [chargesAgg, paymentsAgg, adjustmentsAgg] = await Promise.all([
      tx.communityLedgerEntry.aggregate({
        _sum: { amount: true },
        where: { communityId, periodId, kind: 'REVENUE', lane: 'ACCRUAL' },
      }),
      tx.communityLedgerEntry.aggregate({
        _sum: { amount: true },
        where: { communityId, periodId, kind: 'PAYMENT', lane: 'CASH' },
      }),
      tx.communityLedgerEntry.aggregate({
        _sum: { amount: true },
        where: { communityId, periodId, kind: { in: ['ADJUSTMENT', 'FUND_SPEND'] }, lane: 'ACCRUAL' },
      }),
    ])

    const dueStart = Number(previousStatement?.dueEnd ?? opening?.amount ?? 0)
    const charges = Number(chargesAgg._sum.amount ?? 0)
    const payments = Number(paymentsAgg._sum.amount ?? 0)
    const adjustments = Number(adjustmentsAgg._sum.amount ?? 0)
    const dueEnd = dueStart + charges - payments + adjustments

    await this.recomputeCommunityRunningDue(tx, communityId, periodId, dueStart)

    await tx.communityStatement.upsert({
      where: { communityId_periodId: { communityId, periodId } },
      update: {
        dueStart,
        charges,
        payments,
        adjustments,
        dueEnd,
        currency: previousStatement?.currency ?? opening?.currency ?? 'RON',
      },
      create: {
        communityId,
        periodId,
        dueStart,
        charges,
        payments,
        adjustments,
        dueEnd,
        currency: previousStatement?.currency ?? opening?.currency ?? 'RON',
      },
    })
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

  private async recomputeCommunityRunningDue(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    openingDue: number,
  ) {
    const entries = await tx.communityLedgerEntry.findMany({
      where: { communityId, periodId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, amount: true, kind: true },
    })

    let running = openingDue
    for (const entry of entries) {
      const delta = entry.kind === 'PAYMENT' ? -Number(entry.amount) : Number(entry.amount)
      running += delta
      await tx.communityLedgerEntry.update({
        where: { id: entry.id },
        data: { runningDue: running },
      })
    }
  }

  private log(message: string, meta?: any) {
    this.logger.log(message + (meta ? ` ${JSON.stringify(meta)}` : ''))
  }
}
