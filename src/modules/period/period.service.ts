// src/modules/period/period.service.ts
import { Injectable, BadRequestException, ConflictException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { AllocationService } from '../billing/allocation.service'
import { PaymentService } from '../billing/payment.service'
import { FeaturesService } from '../features/features.service'
import { PenaltyLedgerService } from './penalty-ledger.service'
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
    private readonly features: FeaturesService,
    private readonly penaltyLedger: PenaltyLedgerService,
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
      select: { seq: true, code: true, dueDate: true, endDate: true },
    })
    const nextSeq = (last?.seq ?? 0) + 1
    const code = explicitCode || this.inferPeriodCode(last?.code, nextSeq)
    const existing = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code } } })
    if (existing) throw new ConflictException(`Period ${code} already exists`)
    // Derive the period's real month bounds from a YYYY-MM code — the penalty engine counts
    // penalizable days within [startDate, endDate], so these must be the actual month, not "today".
    const mm = /^(\d{4})-(\d{2})$/.exec(code)
    const startDate = mm ? new Date(Date.UTC(Number(mm[1]), Number(mm[2]) - 1, 1)) : new Date()
    const endDate = mm ? new Date(Date.UTC(Number(mm[1]), Number(mm[2]), 0)) : new Date()
    // Carry the previous month's penalty settings forward: the penalty rate already lives on each fund
    // (its current value is stamped at close) and grace is community-wide, so both persist automatically.
    // The one per-period setting is the due date (scadența) — copy the previous month's convention (same
    // number of days after the period ends) so the admin doesn't re-enter it every month. Admin can edit it.
    let dueDate: Date | null = null
    if (last?.dueDate && last?.endDate) {
      const offsetMs = new Date(last.dueDate).getTime() - new Date(last.endDate).getTime()
      dueDate = new Date(endDate.getTime() + offsetMs)
    }
    const created = await this.prisma.period.create({
      data: {
        communityId,
        code,
        seq: nextSeq,
        status: 'OPEN',
        startDate,
        endDate,
        dueDate,
      },
      select: { id: true, code: true, status: true, seq: true, dueDate: true },
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
    return { period, meters, bills, canClose, canPrepare, checklist: (period as any).checklist || {} }
  }

  /** Per-area "mark complete" checklist for the monthly-close board (persisted on Period.checklist). */
  async getChecklist(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    return {
      code: period.code,
      status: period.status,
      editable: period.status !== 'CLOSED',
      checklist: ((period as any).checklist as Record<string, any>) || {},
    }
  }

  /** Toggle one area's completion (admin). Rejected on a CLOSED period. `by` is stamped for the audit hint. */
  async setChecklist(communityId: string, periodCode: string, body: any, by?: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status === 'CLOSED') throw new BadRequestException('Perioada este închisă (doar vizualizare)')
    const areaKey = String(body?.areaKey ?? '').trim()
    if (!areaKey || areaKey.length > 64) throw new BadRequestException('areaKey invalid')
    const done = body?.done === undefined ? true : Boolean(body.done)
    const cur = (period as any).checklist && typeof (period as any).checklist === 'object' ? { ...(period as any).checklist } : {}
    if (done) cur[areaKey] = { at: new Date().toISOString(), by: by || null }
    else delete cur[areaKey]
    await this.prisma.period.update({ where: { id: period.id }, data: { checklist: cur } })
    return { ok: true, checklist: cur }
  }

  async prepare(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'OPEN') throw new BadRequestException('Period must be OPEN to prepare')
    // A period can only be prepared/closed once it has actually ended: penalties and allocations
    // must not accrue over time (days) that has not yet elapsed.
    if (new Date(period.endDate) > new Date()) {
      throw new BadRequestException(
        `Period ${periodCode} has not ended yet — cannot prepare/close a future period`,
      )
    }

    // ensure allocations are up to date before staging ledger/statement rows
    await this.recomputeAllocations(communityId, period)

    return this.prisma.$transaction(async (tx) => {
      const blockers = await this.getEditable(communityId)
      if (blockers.meters.open.length || blockers.bills.open.length) {
        throw new BadRequestException(
          `Templates must be closed before prepare. Open meters: ${blockers.meters.open.join(', ')}; bills: ${blockers.bills.open.join(', ')}`,
        )
      }

      // post opening balances as charges (idempotent)
      await this.postOpeningBalances(tx, communityId, period.id)

      // stage principal charges
      await this.postChargesForStage(tx, communityId, period.id, 'CLOSE_PREP')

      // Apply payments BEFORE accruing penalties. The penalty ledger's payer-favored paydown reads
      // this period's payments from the PAYMENT ledger, which reapplyForPeriod posts — so it must run
      // first, otherwise advance() sees zero payments and over-penalizes anyone who paid. (This also
      // means be_statement below reflects payments on a fresh close, not only on a later cycle.)
      this.log('[PAY] reapplying payments during prepare', { communityId, period: period.id })
      await this.paymentService.reapplyForPeriod(tx, communityId, period.id)

      if (await this.features.isEnabled(communityId, 'penalties')) {
        // stateful penalty aging ledger: ensure this period's buckets, then advance (provisional).
        // Runs after payments so the paydown is applied before accrual; penalty charges it posts are
        // new debt and are intentionally left unsettled by this period's principal payment.
        await this.penaltyLedger.ensureBuckets(tx, communityId, period.id)
        await this.penaltyLedger.advance(tx, communityId, period.id, { commit: false })
      }

      // statements reflect staged charges, applied payments, and posted penalties
      await this.computeStatements(tx, communityId, period.id)
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
        where: { communityId, periodId: period.id, refType: { in: ['CLOSE_FINAL', 'PENALTY_CLOSE_FINAL'] }, refId: period.id },
      })
      await tx.communityLedgerEntry.deleteMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id },
      })

      // promote ledger rows to FINAL (incl. penalty ledger, which uses a dedicated refType)
      await tx.beLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        data: { refType: 'CLOSE_FINAL' },
      })
      await tx.beLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'PENALTY_CLOSE_PREP', refId: period.id },
        data: { refType: 'PENALTY_CLOSE_FINAL' },
      })
      await tx.communityLedgerEntry.updateMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_PREP', refId: period.id },
        data: { refType: 'CLOSE_FINAL' },
      })
      // freeze the penalty bucket state for this period (provisional → committed)
      await this.penaltyLedger.commitPeriod(tx, communityId, period.id)

      // ensure statements exist/updated (idempotent)
      await this.computeStatements(tx, communityId, period.id)
      await this.computeCommunityStatements(tx, communityId, period.id)

      // roll-forward opening balances to next period
      const next = await this.nextPeriodId(tx, communityId, period.seq)
      if (next) {
        const statements = await tx.beStatement.findMany({
          where: { communityId, periodId: period.id },
          select: { billingEntityId: true, fundId: true, currency: true, dueEnd: true },
        })
        for (const s of statements) {
          if (!s.fundId) continue
          const existing = await tx.beOpeningBalance.findFirst({
            where: {
              communityId,
              periodId: next,
              billingEntityId: s.billingEntityId,
              fundId: s.fundId,
              unitId: null,
            },
            select: { id: true },
          })
          if (existing?.id) {
            await tx.beOpeningBalance.update({
              where: { id: existing.id },
              data: { amount: s.dueEnd, currency: s.currency },
            })
          } else {
            await tx.beOpeningBalance.create({
              data: {
                communityId,
                periodId: next,
                billingEntityId: s.billingEntityId,
                fundId: s.fundId,
                unitId: null,
                amount: s.dueEnd,
                currency: s.currency,
              },
            })
          }
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

  /** Operator-entered due date (scadență) for the period; drives penalty aging. */
  async setDueDate(communityId: string, periodCode: string, dueDate: string | null) {
    const period = await this.getPeriod(communityId, periodCode)
    const d = dueDate ? new Date(dueDate) : null
    if (dueDate && Number.isNaN(d!.getTime())) throw new BadRequestException('Invalid dueDate')
    await this.prisma.period.update({ where: { id: period.id }, data: { dueDate: d } })
    return { ok: true, code: periodCode, dueDate: d }
  }

  /**
   * Per-period settings bundle for the admin panel: the period's own fields (due date editable;
   * start/end/status read-only), the community-wide grace days, and each penalty-source fund's rate.
   * For a CLOSED period the rate is what was STAMPED on that period's debt buckets (read-only history);
   * for a non-closed period it is the fund's current rate (what gets stamped at its close).
   */
  async getSettings(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    const community = await this.prisma.community.findUnique({
      where: { id: communityId }, select: { penaltyGraceDays: true },
    })
    const funds = await this.prisma.fund.findMany({
      where: { communityId }, select: { id: true, code: true, name: true, allocation: true }, orderBy: { code: 'asc' },
    })
    const isClosed = period.status === 'CLOSED'
    const stampedByFund = new Map<string, number>()
    if (isClosed) {
      // Rate stamped on this period's debt: engine-created buckets use origin_key 'period:<id>';
      // migrated historical debt uses 'migrated-debt:%' buckets dated to that period's due date.
      const rows: Array<{ fundId: string; rate: number | null }> = await this.prisma.$queryRawUnsafe(
        `select fund_id as "fundId", max(rate_per_day_pct)::float8 as rate
           from penalty_bucket
          where community_id = $1
            and (origin_key = $2 or (origin_key like 'migrated-debt%' and due_date::date = $3::date))
          group by fund_id`,
        communityId, `period:${period.id}`, period.dueDate,
      )
      for (const r of rows) stampedByFund.set(r.fundId, Number(r.rate ?? 0))
    }
    const penaltyFunds = funds
      .filter((f) => (f.allocation as any)?.penaltyPerDayPct != null) // penalty-source funds (penalty-ledger.service penalFunds)
      .map((f) => {
        const alloc = (f.allocation as any) || {}
        const stamped = isClosed && stampedByFund.has(f.id)
        return {
          code: f.code,
          name: f.name,
          penaltyFundCode: alloc.penaltyFundCode || 'PENALIZARI',
          ratePerDayPct: stamped ? (stampedByFund.get(f.id) as number) : Number(alloc.penaltyPerDayPct ?? 0),
          stamped,
        }
      })
    return {
      period: {
        code: period.code,
        status: period.status,
        dueDate: period.dueDate,
        startDate: period.startDate,
        endDate: period.endDate,
        preparedAt: period.preparedAt,
        closedAt: period.closedAt,
        editable: !isClosed,
      },
      graceDays: Number((community as any)?.penaltyGraceDays ?? 30),
      penaltyFunds,
    }
  }

  /** Apply only the provided settings (admin). Penalty rates are the fund's current rate (applied at the
   *  next close via bucket stamping) and cannot be changed on a CLOSED period. */
  async setSettings(communityId: string, periodCode: string, body: any) {
    const period = await this.getPeriod(communityId, periodCode)
    const out: any = { ok: true, code: periodCode }

    if (body?.dueDate !== undefined) {
      const d = body.dueDate ? new Date(body.dueDate) : null
      if (body.dueDate && Number.isNaN(d!.getTime())) throw new BadRequestException('Invalid dueDate')
      await this.prisma.period.update({ where: { id: period.id }, data: { dueDate: d } })
      out.dueDate = d
    }

    if (body?.graceDays !== undefined && body.graceDays !== null) {
      const g = Math.round(Number(body.graceDays))
      if (!Number.isFinite(g) || g < 0 || g > 365) throw new BadRequestException('Invalid graceDays')
      await this.prisma.community.update({ where: { id: communityId }, data: { penaltyGraceDays: g } })
      out.graceDays = g
    }

    if (body?.penaltyRates && typeof body.penaltyRates === 'object') {
      if (period.status === 'CLOSED') throw new BadRequestException('Cannot change penalty rates on a closed period')
      for (const [fundCode, pctRaw] of Object.entries(body.penaltyRates as Record<string, any>)) {
        const pct = Number(pctRaw)
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new BadRequestException(`Invalid rate for ${fundCode}`)
        const fund = await this.prisma.fund.findFirst({ where: { communityId, code: fundCode }, select: { id: true, allocation: true } })
        if (!fund) throw new BadRequestException(`Fund ${fundCode} not found`)
        const alloc = (fund.allocation as any) || {}
        // merge so method/weights/penaltyFundCode survive (fund.service overwrites the whole allocation)
        await this.prisma.fund.update({ where: { id: fund.id }, data: { allocation: { ...alloc, penaltyPerDayPct: pct } } })
      }
      out.penaltyRates = body.penaltyRates
    }

    return out
  }

  /** Per-unit residents count + sqm (cotă) effective for a period. Residents/SQM are UNIT-scoped
   *  PeriodMeasure rows read as "latest value at or before this period" (allocation.service semantics),
   *  so a closed period shows the values that applied then. */
  async getUnitAttributes(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    const units = await this.prisma.unit.findMany({
      where: { communityId }, select: { id: true, code: true }, orderBy: { order: 'asc' },
    })
    const rows: Array<{ scopeId: string; typeCode: string; value: number }> = await this.prisma.$queryRawUnsafe(
      `select distinct on (pm.scope_id, pm.type_code)
              pm.scope_id as "scopeId", pm.type_code as "typeCode", pm.value::float8 as value
         from period_measure pm join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.type_code in ('RESIDENTS','SQM')
          and pm.scope_type::text = 'UNIT' and p.seq <= $2
        order by pm.scope_id, pm.type_code, p.seq desc`,
      communityId, period.seq,
    )
    const byUnit = new Map<string, { residents?: number; sqm?: number }>()
    for (const r of rows) {
      const u = byUnit.get(r.scopeId) ?? {}
      if (r.typeCode === 'RESIDENTS') u.residents = Number(r.value); else u.sqm = Number(r.value)
      byUnit.set(r.scopeId, u)
    }
    const label = (code: string) => code.split('-').slice(3).join('-') || code // "…-U28-AP 1/B" → "AP 1/B"
    return {
      period: { code: period.code, status: period.status, editable: period.status !== 'CLOSED' },
      units: units.map((u) => ({
        unitId: u.id, code: u.code, label: label(u.code),
        residents: byUnit.get(u.id)?.residents ?? null,
        sqm: byUnit.get(u.id)?.sqm ?? null,
      })),
    }
  }

  /** Set per-unit residents/sqm for a (non-closed) period. Writes UNIT-scoped PeriodMeasure rows;
   *  they take effect on the next allocation recompute. */
  async setUnitAttributes(communityId: string, periodCode: string, body: any) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status === 'CLOSED') throw new BadRequestException('Cannot edit a closed period')
    const units = await this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
    const codeById = new Map(units.map((u) => [u.id, u.code]))
    const writes: any[] = []
    const apply = (typeCode: 'RESIDENTS' | 'SQM', origin: string, map: any) => {
      for (const [unitId, raw] of Object.entries(map || {})) {
        const val = Number(raw)
        if (!Number.isFinite(val) || val < 0) throw new BadRequestException(`Invalid ${typeCode} for unit ${unitId}`)
        const code = codeById.get(unitId); if (!code) continue
        writes.push(this.prisma.periodMeasure.upsert({
          where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId, periodId: period.id, scopeType: 'UNIT' as any, scopeId: unitId, typeCode } },
          update: { value: val, origin: origin as any },
          create: { communityId, periodId: period.id, scopeType: 'UNIT' as any, scopeId: unitId, typeCode, origin: origin as any, value: val, meterId: `${typeCode}-${code}` },
        }))
      }
    }
    apply('RESIDENTS', 'DECLARATION', body?.residents)
    apply('SQM', 'ADMIN', body?.sqm)
    if (writes.length) await this.prisma.$transaction(writes)
    return { ok: true, code: periodCode, updated: writes.length }
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
      // clean penalty artifacts (dedicated PENALTY_* refTypes + penalty:* community charges); these
      // are not covered by the CLOSE_* cleanup above, so leaving them would double-count on re-prepare.
      const penaltyLedgerRows = await tx.beLedgerEntry.findMany({
        where: { communityId, periodId: period.id, refType: { in: ['PENALTY_CLOSE_PREP', 'PENALTY_CLOSE_FINAL'] } },
        select: { id: true },
      })
      if (penaltyLedgerRows.length) {
        const ids = penaltyLedgerRows.map((e) => e.id)
        await tx.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: ids } } })
        await tx.beLedgerEntry.deleteMany({ where: { id: { in: ids } } })
      }
      const penaltyCharges = await tx.communityCharge.findMany({
        where: { communityId, periodId: period.id, sourceKey: { startsWith: 'penalty:' } },
        select: { id: true },
      })
      if (penaltyCharges.length) {
        const chargeIds = penaltyCharges.map((c) => c.id)
        await tx.communityChargeLine.deleteMany({ where: { chargeId: { in: chargeIds } } })
        await tx.communityCharge.deleteMany({ where: { id: { in: chargeIds } } })
      }
      // undo this period's penalty bucket advance (drops its PenaltyBucketPeriod rows, reopens settled buckets)
      await this.penaltyLedger.revertPeriod(tx, communityId, period.id)
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

  private async postOpeningBalances(tx: TxOrClient, communityId: string, periodId: string) {
    const existing = await tx.beLedgerEntry.findFirst({
      where: { communityId, periodId, refType: 'OPENING_BALANCE' },
      select: { id: true },
    })
    if (existing) return

    const openings = await tx.beOpeningBalance.findMany({
      where: { communityId, periodId, fundId: { not: null }, unitId: { not: null } },
      select: {
        billingEntityId: true,
        fundId: true,
        unitId: true,
        amount: true,
        currency: true,
      },
    })
    if (!openings.length) return

    const byBeFund = new Map<string, { billingEntityId: string; fundId: string; currency: string; amount: number }>()
    for (const o of openings) {
      const fundId = o.fundId as string
      const key = `${o.billingEntityId}::${fundId}`
      const entry = byBeFund.get(key) ?? {
        billingEntityId: o.billingEntityId,
        fundId,
        currency: o.currency ?? 'RON',
        amount: 0,
      }
      entry.amount += Number(o.amount ?? 0)
      byBeFund.set(key, entry)
    }

    const ledgerByKey = new Map<string, { id: string; billingEntityId: string; fundId: string; currency: string }>()
    for (const entry of byBeFund.values()) {
      const le = await tx.beLedgerEntry.create({
        data: {
          communityId,
          periodId,
          billingEntityId: entry.billingEntityId,
          kind: 'CHARGE',
          lane: 'ACCRUAL',
          amount: entry.amount,
          currency: entry.currency,
          fundId: entry.fundId,
          refType: 'OPENING_BALANCE',
          refId: periodId,
        },
        select: { id: true },
      })
      ledgerByKey.set(`${entry.billingEntityId}::${entry.fundId}`, {
        id: le.id,
        billingEntityId: entry.billingEntityId,
        fundId: entry.fundId,
        currency: entry.currency,
      })
    }

    for (const o of openings) {
      const fundId = o.fundId as string
      const unitId = o.unitId as string
      const le = ledgerByKey.get(`${o.billingEntityId}::${fundId}`)
      if (!le) continue
      await tx.beLedgerEntryDetail.create({
        data: {
          ledgerEntryId: le.id,
          communityId,
          periodId,
          billingEntityId: o.billingEntityId,
          kind: 'CHARGE',
          fundId,
          currency: o.currency ?? le.currency ?? 'RON',
          refType: 'OPENING_BALANCE',
          refId: periodId,
          unitId,
          amount: Number(o.amount ?? 0),
        },
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
    // Only pre-existing NON-fund charges (e.g. expense/vendor-invoice allocations) are read into the
    // ledger totals here. Fund contributions (sourceType FUND) and penalties are (re)generated below /
    // in the penalty stage, so including them would double-count on every re-prepare.
    const existingCharges = await tx.communityCharge.findMany({
      where: { communityId, periodId, status: 'ACTIVE', NOT: { sourceType: 'FUND' } },
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
            meta: { source: 'FUND', fundCode: proj.code, allocation: { method, unitMeasure: w, totalMeasure: totalWeight, base: amount } },
          })
          const beTotals = beFundTotals.get(beId) ?? new Map<string, number>()
          beTotals.set(fundId, (beTotals.get(fundId) ?? 0) + amt)
          beFundTotals.set(beId, beTotals)
          fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + amt)
          const dk = `${beId}::${fundId}`
          const byUnit = detailMap.get(dk) ?? new Map<string, { amount: number; meta?: any }>()
          const entry = byUnit.get(u.id) ?? { amount: 0, meta: { source: 'FUND', fundCode: proj.code, allocation: { method, unitMeasure: w, totalMeasure: totalWeight, base: amount } } }
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
      const fundIds = new Set<string>()
      const ledgerFunds = await tx.beLedgerEntry.findMany({
        where: { communityId, periodId, billingEntityId: be.id },
        select: { fundId: true },
        distinct: ['fundId'],
      })
      ledgerFunds.forEach((r) => r.fundId && fundIds.add(r.fundId))
      const openingFunds = await tx.beOpeningBalance.findMany({
        where: { communityId, periodId, billingEntityId: be.id },
        select: { fundId: true },
      })
      openingFunds.forEach((r) => r.fundId && fundIds.add(r.fundId))
      if (previousPeriod) {
        const prevFunds = await tx.beStatement.findMany({
          where: { communityId, periodId: previousPeriod.id, billingEntityId: be.id },
          select: { fundId: true },
        })
        prevFunds.forEach((r) => r.fundId && fundIds.add(r.fundId))
      }

      for (const fundId of fundIds) {
        const previousStatement = previousPeriod
          ? await tx.beStatement.findUnique({
              where: {
                communityId_periodId_billingEntityId_fundId: {
                  communityId,
                  periodId: previousPeriod.id,
                  billingEntityId: be.id,
                  fundId,
                },
              },
              select: { dueEnd: true, currency: true },
            })
          : null

        const openings = await tx.beOpeningBalance.findMany({
          where: { communityId, periodId, billingEntityId: be.id, fundId },
          select: { amount: true, currency: true },
        })
        const openingAmount = openings.reduce((s, o) => s + Number(o.amount ?? 0), 0)
        const openingCurrency = openings.find((o) => o.currency)?.currency ?? 'RON'

        const [chargesAgg, paymentsAgg, adjustmentsAgg] = await Promise.all([
          tx.beLedgerEntry.aggregate({
            _sum: { amount: true },
            where: {
              communityId,
              periodId,
              billingEntityId: be.id,
              fundId,
              kind: 'CHARGE',
              lane: 'ACCRUAL',
              NOT: { refType: 'OPENING_BALANCE' },
            },
          }),
          tx.beLedgerEntry.aggregate({
            _sum: { amount: true },
            where: { communityId, periodId, billingEntityId: be.id, fundId, kind: 'PAYMENT', lane: 'CASH' },
          }),
          tx.beLedgerEntry.aggregate({
            _sum: { amount: true },
            where: { communityId, periodId, billingEntityId: be.id, fundId, kind: 'ADJUSTMENT', lane: 'ACCRUAL' },
          }),
        ])

        const dueStart = Number(previousStatement?.dueEnd ?? openingAmount ?? 0)
        const charges = Number(chargesAgg._sum.amount ?? 0)
        const payments = Number(paymentsAgg._sum.amount ?? 0)
        const adjustments = Number(adjustmentsAgg._sum.amount ?? 0)
        const dueEnd = dueStart + charges - payments + adjustments

        await this.recomputeRunningDue(tx, communityId, periodId, be.id, fundId, dueStart)

        await tx.beStatement.upsert({
          where: {
            communityId_periodId_billingEntityId_fundId: {
              communityId,
              periodId,
              billingEntityId: be.id,
              fundId,
            },
          },
          update: {
            dueStart,
            charges,
            payments,
            adjustments,
            dueEnd,
            currency: previousStatement?.currency ?? openingCurrency ?? 'RON',
          },
          create: {
            communityId,
            periodId,
            billingEntityId: be.id,
            fundId,
            dueStart,
            charges,
            payments,
            adjustments,
            dueEnd,
            currency: previousStatement?.currency ?? openingCurrency ?? 'RON',
          },
        })
      }
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
    fundId: string,
    openingDue: number,
  ) {
    const entries = await tx.beLedgerEntry.findMany({
      where: { communityId, periodId, billingEntityId: beId, fundId },
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
