import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ensureCommunityLedgerEntryDetail } from './community-ledger-detail.util'
import { ensureFundLedgerEntryDetail } from './fund-ledger-detail.util'
import { buildChargeComparator, resolveAllocationConfig, type OrderableCharge } from './payment-allocation'

type TxClient = any
type PaymentAllocationSpec = {
  source: 'AUTO_DETAIL' | 'SPEC'
  paymentId: string
  chargeId: string
  detailId: string
  unitId?: string | null
  fundId?: string | null
  billingEntityId?: string | null
  lineIndex?: number | null
  amount: number
}
type AllocationSpecLine = {
  amount?: number
  billingEntityId?: string
  fundId?: string
  unitId?: string
  chargeId?: string
  advance?: boolean // credit/advance allocation to a fund (settles no charge)
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name)

  constructor(private readonly prisma: PrismaService) {}

  private async ensureBillingEntity(communityId: string, billingEntityId: string) {
    const be = await this.prisma.billingEntity.findFirst({
      where: { id: billingEntityId, communityId },
      select: { id: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found for community')
    return be.id
  }

  async listPayments(communityId: string) {
    return this.prisma.$queryRawUnsafe(
      `
      SELECT p.id,
             p.community_id    AS "communityId",
             p.billing_entity_id AS "billingEntityId",
             be.name           AS "billingEntityName",
             be.code           AS "billingEntityCode",
             p.account_id      AS "accountId",
             p.amount,
             p.currency,
             p.ts,
             p.method,
             p.ref_id           AS "refId",
             p.status,
             p.provider,
             p.provider_ref     AS "providerRef",
             COALESCE(app.applied, 0)::numeric AS applied,
             (p.amount - COALESCE(app.applied, 0))::numeric AS remaining,
             COALESCE(app2.apps, '[]') AS applications
      FROM payment p
      JOIN billing_entity be ON be.id = p.billing_entity_id
      LEFT JOIN (
        SELECT payment_id, SUM(amount) AS applied
        FROM payment_application
        GROUP BY payment_id
      ) app ON app.payment_id = p.id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object(
                   'amount', pa.amount,
                   'fundId', le.fund_id,
                   'chargeId', le.id,
                   'periodId', le.period_id,
                   'refType', le.ref_type,
                   'refId', le.ref_id,
                   'detailId', pa.spec->>'detailId',
                   'unitId', pa.spec->>'unitId'
                 )) AS apps
        FROM payment_application pa
        JOIN be_ledger_entry le ON le.id = pa.charge_id
        WHERE pa.payment_id = p.id
      ) app2 ON TRUE
      WHERE p.community_id = $1
      ORDER BY p.ts DESC;
    `,
      communityId,
    )
  }

  async getPayment(communityId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, communityId },
      select: {
        id: true,
        communityId: true,
        billingEntityId: true,
        amount: true,
        currency: true,
        ts: true,
        method: true,
        refId: true,
        status: true,
        provider: true,
        providerRef: true,
        allocationSpec: true,
        applications: { select: { id: true, amount: true, chargeId: true, spec: true } },
      } as any,
    })
    if (!payment) throw new NotFoundException('Payment not found')
    return payment
  }

  private async findOpenChargeDetails(
    client: TxClient,
    communityId: string,
    billingEntityId: string,
    allowedChargeIds?: string[],
    filters?: { fundId?: string; unitId?: string },
    excludedChargeIds?: string[],
  ) {
    return client.$queryRawUnsafe(
      `
      SELECT le.id AS "chargeId",
             le.created_at AS "chargeCreatedAt",
             le.fund_id AS "chargeFundId",
             le.period_id AS "chargePeriodId",
             p.seq AS "periodSeq",
             p.due_date AS "periodDueDate",
             le.amount::numeric AS "chargeAmount",
             d.id AS "detailId",
             d.unit_id AS "unitId",
             d.amount::numeric AS "detailAmount",
             COALESCE(app.paid,0)::numeric AS "chargeApplied"
      FROM be_ledger_entry le
      JOIN be_ledger_entry_detail d ON d.ledger_entry_id = le.id
      JOIN period p ON p.id = le.period_id
      LEFT JOIN (
        SELECT charge_id, SUM(amount) AS paid
        FROM payment_application
        GROUP BY charge_id
      ) app ON app.charge_id = le.id
      WHERE le.community_id = $1
        AND le.billing_entity_id = $2
        AND le.kind = 'CHARGE'
        AND (le.amount - COALESCE(app.paid,0)) > 0
        ${
          allowedChargeIds && allowedChargeIds.length
            ? `AND le.id::text = ANY($3::text[])`
            : ''
        }
        ${filters?.fundId ? `AND d.fund_id = ${allowedChargeIds?.length ? '$4' : '$3'}` : ''}
        ${
          filters?.unitId
            ? `AND d.unit_id = ${allowedChargeIds?.length ? (filters?.fundId ? '$5' : '$4') : filters?.fundId ? '$4' : '$3'}`
            : ''
        }
        ${excludedChargeIds && excludedChargeIds.length ? `AND le.id::text <> ALL(${
          allowedChargeIds?.length
            ? filters?.fundId
              ? filters?.unitId
                ? '$6'
                : '$5'
              : filters?.unitId
                ? '$5'
                : '$4'
            : filters?.fundId
              ? filters?.unitId
                ? '$5'
                : '$4'
              : filters?.unitId
                ? '$4'
                : '$3'
        }::text[])` : ''}
      ORDER BY le.created_at ASC, d.id ASC
    `,
      communityId,
      billingEntityId,
      ...(allowedChargeIds && allowedChargeIds.length ? [allowedChargeIds] : []),
      ...(filters?.fundId ? [filters.fundId] : []),
      ...(filters?.unitId ? [filters.unitId] : []),
      ...(excludedChargeIds && excludedChargeIds.length ? [excludedChargeIds] : []),
    )
  }

  async getOpenChargeSummary(
    communityId: string,
    billingEntityId: string,
    filters?: { fundId?: string; unitId?: string },
  ) {
    if (!billingEntityId) throw new BadRequestException('billingEntityId is required')
    const beId = await this.ensureBillingEntity(communityId, billingEntityId)
    const detailRows = await this.findOpenChargeDetails(this.prisma, communityId, beId, undefined, filters)
    const byCharge = new Map<
      string,
      {
        chargeId: string
        fundId: string | null
        unitId: string | null
        periodId: string | null
        chargeRemaining: number
        detailSum: number
      }
    >()
    for (const r of detailRows as any[]) {
      const remaining = Number(r.chargeAmount || 0) - Number(r.chargeApplied || 0)
      if (remaining <= 0) continue
      const key = r.chargeId
      const existing = byCharge.get(key)
      if (existing) {
        existing.detailSum += Number(r.detailAmount || 0)
      } else {
        byCharge.set(key, {
          chargeId: r.chargeId,
          fundId: r.chargeFundId ?? null,
          unitId: r.unitId ?? null,
          periodId: r.chargePeriodId ?? null,
          chargeRemaining: remaining,
          detailSum: Number(r.detailAmount || 0),
        })
      }
    }
    const raw = Array.from(byCharge.values())
    // resolve fund + period labels so the charge picker is human-readable
    const fundIds = Array.from(new Set(raw.map((c) => c.fundId).filter(Boolean))) as string[]
    const periodIds = Array.from(new Set(raw.map((c) => c.periodId).filter(Boolean))) as string[]
    const [funds, periods] = await Promise.all([
      fundIds.length ? this.prisma.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
      periodIds.length ? this.prisma.period.findMany({ where: { id: { in: periodIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
    ])
    const fundById = new Map(funds.map((f) => [f.id, f]))
    const periodById = new Map(periods.map((p) => [p.id, p]))
    const items = raw.map((c) => {
      const available = Math.min(c.chargeRemaining, c.detailSum)
      const f = c.fundId ? fundById.get(c.fundId) : null
      return {
        chargeId: c.chargeId,
        fundId: c.fundId,
        unitId: c.unitId,
        periodId: c.periodId,
        fundCode: f?.code ?? null,
        fundName: f?.name ?? null,
        periodCode: c.periodId ? periodById.get(c.periodId)?.code ?? null : null,
        available: Number(available.toFixed(4)),
      }
    })
    // stable order: oldest period first, then fund name
    items.sort((a, b) => (a.periodCode || '').localeCompare(b.periodCode || '') || (a.fundName || '').localeCompare(b.fundName || ''))
    const totalAvailable = items.reduce((s, i) => s + Number(i.available || 0), 0)
    return { items, totalAvailable: Number(totalAvailable.toFixed(4)) }
  }

  /**
   * Resolve the per-community charge-ordering comparator for the automatic spread.
   * Returns undefined for FIFO (fast path — no extra lookups), else builds the penalty-fund
   * set and fund-priority index the strategy needs.
   */
  private async resolveOrderComparator(
    client: TxClient,
    communityId: string,
  ): Promise<((a: OrderableCharge, b: OrderableCharge) => number) | undefined> {
    const c = await client.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { id: true, paymentAllocation: true },
    })
    const cfg = resolveAllocationConfig(c?.paymentAllocation)
    if (cfg.strategy === 'FIFO') return undefined

    const funds = await client.fund.findMany({
      where: { communityId: c?.id ?? communityId },
      select: { id: true, code: true, allocation: true },
    })
    const idByCode = new Map<string, string>(funds.map((f: any) => [f.code, f.id]))

    // Penalty funds = the resolved targets of any fund's penaltyFundCode (default 'PENALIZARI').
    const targetCodes = new Set<string>(['PENALIZARI'])
    for (const f of funds as any[]) {
      const pc = (f.allocation as any)?.penaltyFundCode
      if (pc) targetCodes.add(pc)
    }
    const penaltyFundIds = new Set<string>()
    for (const code of targetCodes) {
      const id = idByCode.get(code)
      if (id) penaltyFundIds.add(id)
    }

    const fundOrderIndex = new Map<string, number>()
    ;(cfg.fundOrder ?? []).forEach((code, i) => {
      const id = idByCode.get(code)
      if (id) fundOrderIndex.set(id, i)
    })

    return buildChargeComparator(cfg.strategy, { penaltyFundIds, fundOrderIndex })
  }

  private buildAppsFromDetails(
    detailRows: any[],
    amount: number,
    paymentId: string,
    source: 'AUTO_DETAIL' | 'SPEC',
    specMeta?: { fundId?: string | null; unitId?: string | null; billingEntityId?: string | null; lineIndex?: number },
    // Optional ordering strategy (per-community). Absent => FIFO (oldest charge first).
    comparator?: (a: { chargeCreatedAt: Date; periodSeq: number | null; chargeFundId: string | null }, b: { chargeCreatedAt: Date; periodSeq: number | null; chargeFundId: string | null }) => number,
  ) {
    const byCharge = new Map<
      string,
      {
        chargeId: string
        chargeCreatedAt: Date
        chargeFundId: string
        periodSeq: number | null
        chargeApplied: number
        details: Array<{ detailId: string; unitId?: string | null; detailAmount: number }>
      }
    >()
    for (const r of detailRows) {
      const existing = byCharge.get(r.chargeId)
      if (existing) {
        existing.details.push({
          detailId: r.detailId,
          unitId: r.unitId,
          detailAmount: Number(r.detailAmount),
        })
      } else {
        byCharge.set(r.chargeId, {
          chargeId: r.chargeId,
          chargeCreatedAt: r.chargeCreatedAt,
          chargeFundId: r.chargeFundId,
          periodSeq: r.periodSeq == null ? null : Number(r.periodSeq),
          chargeApplied: Number(r.chargeApplied),
          details: [
            {
              detailId: r.detailId,
              unitId: r.unitId,
              detailAmount: Number(r.detailAmount),
            },
          ],
        })
      }
    }
    const fifo = (a: { chargeCreatedAt: Date }, b: { chargeCreatedAt: Date }) =>
      a.chargeCreatedAt.getTime() - b.chargeCreatedAt.getTime()
    const charges = Array.from(byCharge.values()).sort(comparator ?? fifo)
    let remaining = amount
    const apps: Array<{ paymentId: string; chargeId: string; amount: number; spec: PaymentAllocationSpec | any }> = []
    const coveredChargeIds: string[] = []
    for (const c of charges) {
      if (remaining <= 0) break
      let appliedToCharge = c.chargeApplied
      let appliedToThisCharge = 0
      for (const d of c.details) {
        if (remaining <= 0) break
        const detailAmount = Number(d.detailAmount)
        const alreadyApplied = Math.min(detailAmount, appliedToCharge)
        const detailRemaining = Math.max(0, detailAmount - alreadyApplied)
        appliedToCharge = Math.max(0, appliedToCharge - detailAmount)
        if (detailRemaining <= 0) continue
        const apply = Math.min(remaining, detailRemaining)
        if (apply > 0) {
          apps.push({
            paymentId,
            chargeId: c.chargeId,
            amount: apply,
            spec: {
              source,
              paymentId,
              chargeId: c.chargeId,
              detailId: d.detailId,
              unitId: d.unitId ?? null,
              fundId: specMeta?.fundId ?? c.chargeFundId ?? null,
              amount: apply,
              billingEntityId: specMeta?.billingEntityId ?? null,
              lineIndex: specMeta?.lineIndex ?? null,
            },
          })
          remaining -= apply
          appliedToThisCharge += apply
        }
      }
      if (appliedToThisCharge > 0) coveredChargeIds.push(c.chargeId)
    }
    return { apps, remaining, coveredChargeIds }
  }

  private async applyPaymentWithSpec(
    client: TxClient,
    paymentId: string,
    amount: number,
    communityId: string,
    billingEntityId: string,
    allocationSpec: AllocationSpecLine[],
    allowedChargeIds?: string[],
  ) {
    let remaining = amount
    const apps: Array<{ paymentId: string; chargeId: string; amount: number; spec: any }> = []
    const coveredChargeIds = new Set<string>()
    for (let idx = 0; idx < allocationSpec.length; idx += 1) {
      if (remaining <= 0) break
      const line = allocationSpec[idx]
      const lineAmount = Math.min(remaining, Number(line?.amount ?? 0))
      if (!Number.isFinite(lineAmount) || lineAmount <= 0) continue
      const lineBeId = line.billingEntityId || billingEntityId
      // If the line targets a specific charge, settle exactly that charge (intersect
      // with any globally-allowed set); otherwise fall back to fund/unit matching.
      const lineAllowed = line.chargeId
        ? (allowedChargeIds && allowedChargeIds.length
            ? allowedChargeIds.filter((id) => id === line.chargeId)
            : [line.chargeId])
        : allowedChargeIds
      const detailRows = await this.findOpenChargeDetails(
        client,
        communityId,
        lineBeId,
        lineAllowed,
        { fundId: line.fundId, unitId: line.unitId },
        Array.from(coveredChargeIds),
      )
      const res = this.buildAppsFromDetails(detailRows, lineAmount, paymentId, 'SPEC', {
        fundId: line.fundId ?? null,
        unitId: line.unitId ?? null,
        billingEntityId: lineBeId ?? null,
        lineIndex: idx,
      })
      res.coveredChargeIds.forEach((id) => coveredChargeIds.add(id))
      apps.push(...res.apps)
      remaining -= lineAmount - res.remaining
    }
    return { apps, remaining }
  }

  private async validateAllocationSpec(
    communityId: string,
    billingEntityId: string,
    allocationSpec: AllocationSpecLine[] | null,
    amount: number,
  ) {
    if (!allocationSpec || !allocationSpec.length) return
    let total = 0
    const beIds = new Set<string>()
    const unitIds = new Set<string>()
    const advanceFundIds = new Set<string>()
    allocationSpec.forEach((line, idx) => {
      const amt = Number(line?.amount ?? 0)
      if (line.advance) {
        // advance/credit line: fund required, amount optional (leftover is computed)
        if (!line.fundId || typeof line.fundId !== 'string') {
          throw new BadRequestException(`allocationSpec[${idx}].fundId is required for an advance`)
        }
        if (line.amount != null && (!Number.isFinite(amt) || amt < 0)) {
          throw new BadRequestException(`allocationSpec[${idx}].amount must be >= 0`)
        }
        advanceFundIds.add(line.fundId)
        total += amt
        return
      }
      if (line.chargeId && line.amount == null) {
        // charge marker: restricts settlement to this charge (FIFO), no amount needed
        return
      }
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new BadRequestException(`allocationSpec[${idx}].amount must be positive`)
      }
      total += amt
      if (line.billingEntityId) {
        if (line.billingEntityId !== billingEntityId) {
          throw new BadRequestException('allocationSpec.billingEntityId must match payment billingEntityId')
        }
        beIds.add(line.billingEntityId)
      }
      if (line.unitId) unitIds.add(line.unitId)
      if (line.fundId != null && typeof line.fundId !== 'string') {
        throw new BadRequestException(`allocationSpec[${idx}].fundId must be a string`)
      }
    })
    if (total - amount > 0.01) {
      throw new BadRequestException('allocationSpec total cannot exceed payment amount')
    }
    if (advanceFundIds.size) {
      const rows = await this.prisma.fund.findMany({
        where: { communityId, id: { in: Array.from(advanceFundIds) } },
        select: { id: true },
      })
      if (rows.length !== advanceFundIds.size) {
        throw new BadRequestException('allocationSpec contains invalid advance fundId')
      }
    }
    if (beIds.size) {
      const rows = await this.prisma.billingEntity.findMany({
        where: { communityId, id: { in: Array.from(beIds) } },
        select: { id: true },
      })
      if (rows.length !== beIds.size) {
        throw new BadRequestException('allocationSpec contains invalid billingEntityId')
      }
    }
    if (unitIds.size) {
      const rows = await this.prisma.unit.findMany({
        where: { communityId, id: { in: Array.from(unitIds) } },
        select: { id: true },
      })
      if (rows.length !== unitIds.size) {
        throw new BadRequestException('allocationSpec contains invalid unitId')
      }
    }
  }

  private async replaceCommunityPaymentLedger(
    client: TxClient,
    entry: {
      communityId: string
      periodId: string
      kind: string
      fundId: string
      currency: string | null
      refType: string | null
      refId: string | null
    },
    paymentId: string,
    fundIdTotals: Map<string | null, number>,
  ) {
    const existing = await (client as any).communityLedgerEntry.findMany({
      where: { communityId: entry.communityId, refType: 'PAYMENT', refId: paymentId },
      select: { id: true },
    })
    if (existing.length) {
      await (client as any).communityLedgerEntryDetail.deleteMany({
        where: { ledgerEntryId: { in: existing.map((e: { id: string }) => e.id) } },
      })
      await (client as any).communityLedgerEntry.deleteMany({
        where: { id: { in: existing.map((e: { id: string }) => e.id) } },
      })
    }
    for (const [fundId, amount] of fundIdTotals.entries()) {
      const cle = await (client as any).communityLedgerEntry.create({
        data: {
          communityId: entry.communityId,
          periodId: entry.periodId,
          kind: 'PAYMENT',
          lane: 'CASH',
          amount,
          currency: entry.currency || 'RON',
          refType: 'PAYMENT',
          refId: paymentId,
          fundId,
        },
      })
      await ensureCommunityLedgerEntryDetail(client, cle, amount, {
        synthetic: true,
        reason: 'payment',
        paymentId,
        fundId,
      })
    }
  }

  private buildCommunityPaymentFundTotals(
    apps: Array<{ amount: number; spec?: any }>,
    remaining: number,
  ) {
    const totals = new Map<string | null, number>()
    for (const app of apps) {
      const fundId = app.spec?.fundId ?? null
      totals.set(fundId, (totals.get(fundId) ?? 0) + Number(app.amount))
    }
    if (remaining > 0) {
      totals.set(null, (totals.get(null) ?? 0) + remaining)
    }
    return totals
  }

  private async replaceFundPaymentLedger(
    client: TxClient,
    entry: {
      communityId: string
      periodId: string
      currency: string | null
    },
    paymentId: string,
    apps: Array<{ amount: number; spec?: any }>,
  ) {
    const fundTotals = new Map<string, number>()
    for (const app of apps) {
      const fundId = app.spec?.fundId ?? null
      if (!fundId) continue
      fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + Number(app.amount))
    }
    const existing = await (client as any).fundLedgerEntry.findMany({
      where: { communityId: entry.communityId, refType: 'PAYMENT', refId: paymentId },
      select: { id: true },
    })
    if (existing.length) {
      await (client as any).fundLedgerEntryDetail.deleteMany({
        where: { ledgerEntryId: { in: existing.map((e: { id: string }) => e.id) } },
      })
      await (client as any).fundLedgerEntry.deleteMany({
        where: { id: { in: existing.map((e: { id: string }) => e.id) } },
      })
    }
    for (const [fundId, amount] of fundTotals.entries()) {
      const ple = await (client as any).fundLedgerEntry.create({
        data: {
          communityId: entry.communityId,
          fundId,
          periodId: entry.periodId,
          kind: 'PAYMENT',
          lane: 'CASH',
          amount,
          currency: entry.currency || 'RON',
          refType: 'PAYMENT',
          refId: paymentId,
        },
      })
      await ensureFundLedgerEntryDetail(client, ple, amount, {
        synthetic: true,
        reason: 'payment',
        paymentId,
      })
    }
  }

  private async applyPayment(
    client: TxClient,
    paymentId: any,
    amount: number,
    communityId: string,
    billingEntityId: string,
    periodId: string,
    currency: string,
    allowedChargeIds?: string[],
    allocationSpec?: AllocationSpecLine[] | null,
  ) {
    const paymentIdStr = String(paymentId)
    // Classify spec lines:
    //  - advance line  → credit to a fund (settles no charge)
    //  - charge marker → { chargeId } with no amount: restrict settlement to this charge set (FIFO within it)
    //  - fixed line    → { fundId/unitId, amount }: legacy fixed-amount targeting
    const specLines = (allocationSpec || []) as AllocationSpecLine[]
    const advanceLines = specLines.filter((l) => l.advance)
    const chargeLines = specLines.filter((l) => !l.advance)
    const chargeMarkers = chargeLines.filter((l) => l.chargeId && l.amount == null)
    const fixedLines = chargeLines.filter((l) => l.amount != null)
    const advanceFundId = advanceLines.find((l) => l.fundId)?.fundId ?? null
    const explicitAdvance = advanceLines.reduce((s, l) => s + Number(l.amount ?? 0), 0)
    const chargeApplicable = Math.max(0, Number((amount - explicitAdvance).toFixed(4)))

    // Restrict the settleable charge set when the operator picked specific charges.
    let effectiveAllowed = allowedChargeIds
    if (chargeMarkers.length) {
      const markerIds = chargeMarkers.map((l) => l.chargeId as string)
      effectiveAllowed = allowedChargeIds && allowedChargeIds.length
        ? allowedChargeIds.filter((id) => markerIds.includes(id))
        : markerIds
    }

    let apps: Array<{ paymentId: string; chargeId: string; amount: number; spec: PaymentAllocationSpec | any }> = []
    let remaining = chargeApplicable
    if (chargeApplicable > 0) {
      if (fixedLines.length) {
        const res = await this.applyPaymentWithSpec(
          client,
          paymentIdStr,
          chargeApplicable,
          communityId,
          billingEntityId,
          fixedLines,
          effectiveAllowed,
        )
        apps = res.apps
        remaining = res.remaining
      } else {
        // Automatic spread across open charges, ordered by the community's allocation strategy
        // (default FIFO — oldest charge first). Restricted to the selected set when the operator
        // picked specific charges via charge markers.
        const comparator = await this.resolveOrderComparator(client, communityId)
        const detailRows = await this.findOpenChargeDetails(client, communityId, billingEntityId, effectiveAllowed)
        const res = this.buildAppsFromDetails(detailRows, chargeApplicable, paymentIdStr, 'AUTO_DETAIL', undefined, comparator)
        apps = res.apps
        remaining = res.remaining
      }
    } else {
      remaining = 0
    }

    // Money left after settling charges becomes an advance/credit — needs a target fund.
    const advanceTotal = Number((explicitAdvance + remaining).toFixed(4))
    if (advanceTotal > 0.0001 && !advanceFundId) {
      throw new BadRequestException('Payment exceeds open charges')
    }
    remaining = 0

    if (apps.length) {
      await (client as any).paymentApplication.createMany({ data: apps, skipDuplicates: true })
    }

    // Ledger view = charge applications + (optionally) the advance as a fund-only allocation.
    const ledgerApps = advanceTotal > 0 && advanceFundId
      ? [...apps, { paymentId: paymentIdStr, amount: advanceTotal, spec: { source: 'ADVANCE', paymentId: paymentIdStr, fundId: advanceFundId, amount: advanceTotal } }]
      : apps

    const fundTotals = new Map<string, number>()
    for (const app of ledgerApps) {
      const fundId = app.spec?.fundId ?? null
      if (!fundId) throw new BadRequestException('Payment allocation missing fundId')
      fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + Number(app.amount))
    }

    const existing = await (client as any).beLedgerEntry.findMany({
      where: { communityId, billingEntityId, refType: 'PAYMENT', refId: paymentIdStr },
      select: { id: true },
    })
    if (existing.length) {
      await (client as any).beLedgerEntryDetail.deleteMany({
        where: { ledgerEntryId: { in: existing.map((e: { id: string }) => e.id) } },
      })
      await (client as any).beLedgerEntry.deleteMany({ where: { id: { in: existing.map((e: { id: string }) => e.id) } } })
    }

    const ledgerByFund = new Map<string, any>()
    for (const [fundId, total] of fundTotals.entries()) {
      const le = await (client as any).beLedgerEntry.create({
        data: {
          communityId,
          periodId,
          billingEntityId,
          kind: 'PAYMENT',
          lane: 'CASH',
          amount: total,
          currency,
          refType: 'PAYMENT',
          refId: paymentIdStr,
          fundId,
        },
      })
      ledgerByFund.set(fundId, le)
    }

    if (ledgerApps.length) {
      await (client as any).beLedgerEntryDetail.createMany({
        data: ledgerApps.map((app) => {
          const fundId = app.spec?.fundId
          const le = ledgerByFund.get(fundId)
          return {
            ledgerEntryId: le.id,
            communityId,
            periodId,
            billingEntityId,
            kind: 'PAYMENT',
            fundId,
            currency,
            refType: 'PAYMENT',
            refId: paymentIdStr,
            unitId: app.spec?.unitId ?? null,
            amount: app.amount,
            meta: app.spec,
          }
        }),
        skipDuplicates: true,
      })
    }

    const entryCtx = { communityId, periodId, currency }
    const fundIdTotals = this.buildCommunityPaymentFundTotals(ledgerApps, 0)
    await this.replaceCommunityPaymentLedger(client, entryCtx as any, paymentIdStr, fundIdTotals)
    await this.replaceFundPaymentLedger(client, entryCtx as any, paymentIdStr, ledgerApps)
    return { applied: Number((amount - advanceTotal).toFixed(4)), remaining: 0, advance: advanceTotal }
  }

  private async latestPeriodId(communityId: string) {
    const p = await this.prisma.period.findFirst({
      where: { communityId },
      orderBy: [{ seq: 'desc' }],
      select: { id: true },
    })
    return p?.id ?? 'PAYMENT'
  }

  async createOrApply(communityId: string, body: any) {
    if (!body.billingEntityId) throw new BadRequestException('billingEntityId is required')
    if (body.amount == null) throw new BadRequestException('amount is required')
    const beId = await this.ensureBillingEntity(communityId, body.billingEntityId)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    const periodId = await this.latestPeriodId(communityId)
    const accountId = body.accountId ? await this.ensureCashAccount(communityId, body.accountId) : null

    // idempotent on refId if provided
    let payment = body.refId
      ? await (this.prisma as any).payment.findUnique({
          where: { refId: body.refId },
          select: { id: true },
        })
      : null

    const allocationSpec = Array.isArray(body.allocationSpec) ? body.allocationSpec : null
    await this.validateAllocationSpec(communityId, beId, allocationSpec, amount)

    if (payment) {
      await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId: payment.id } })
      payment = await (this.prisma as any).payment.update({
        where: { id: payment.id },
        data: {
          communityId,
          billingEntityId: beId,
          accountId: accountId ?? undefined,
          amount,
          currency: body.currency || 'RON',
          ts: body.ts ? new Date(body.ts) : undefined,
          method: body.method ?? undefined,
          status: 'POSTED',
          allocationSpec,
        },
      })
    } else {
      payment = await (this.prisma as any).payment.create({
        data: {
          communityId,
          billingEntityId: beId,
          accountId: accountId ?? null,
          amount,
          currency: body.currency || 'RON',
          ts: body.ts ? new Date(body.ts) : undefined,
          method: body.method ?? null,
          refId: body.refId ?? null,
          status: 'POSTED',
          allocationSpec,
        },
      })
    }

    if (body.applyMode === 'none') {
      // record-only: post cash only if an explicit spec provides the fund split
      await this.upsertCashTxForPayment(communityId, payment as any)
      return { payment, applied: 0, remaining: amount }
    }

    const { applied, remaining, advance } = await this.applyPayment(
      this.prisma,
      payment.id,
      amount,
      communityId,
      beId,
      periodId,
      body.currency || 'RON',
      undefined,
      allocationSpec,
    )
    // post cash AFTER applying so the per-fund split can be derived from the ledger
    await this.upsertCashTxForPayment(communityId, payment as any)
    return { payment, applied, remaining, advance }
  }

  async createIntent(communityId: string, body: any) {
    if (!body.billingEntityId) throw new BadRequestException('billingEntityId is required')
    if (body.amount == null) throw new BadRequestException('amount is required')
    const beId = await this.ensureBillingEntity(communityId, body.billingEntityId)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    const allocationSpec = Array.isArray(body.allocationSpec) ? body.allocationSpec : null
    await this.validateAllocationSpec(communityId, beId, allocationSpec, amount)
    const accountId = body.accountId ? await this.ensureCashAccount(communityId, body.accountId) : null
    const payment = await (this.prisma as any).payment.create({
      data: {
        communityId,
        billingEntityId: beId,
        accountId,
        amount,
        currency: body.currency || 'RON',
        ts: body.ts ? new Date(body.ts) : undefined,
        method: body.method ?? null,
        refId: body.refId ?? null,
        status: 'PENDING',
        provider: body.provider ?? null,
        providerRef: body.providerRef ?? null,
        providerMeta: body.providerMeta ?? null,
        allocationSpec,
      },
    })
    return {
      payment,
      intent: {
        provider: payment.provider,
        providerRef: payment.providerRef,
      },
    }
  }

  async confirmIntent(communityId: string, paymentId: string, body: any) {
    const payment = await (this.prisma as any).payment.findFirst({
      where: { id: paymentId, communityId },
    })
    if (!payment) throw new NotFoundException('Payment not found')
    if (payment.status === 'CANCELED') throw new BadRequestException('Payment is canceled')
    if (payment.status === 'POSTED') {
      return { payment, applied: 0, remaining: 0, alreadyConfirmed: true }
    }

    const allocationSpec = Array.isArray(body.allocationSpec) ? body.allocationSpec : payment.allocationSpec
    await this.validateAllocationSpec(communityId, payment.billingEntityId, allocationSpec as any, Number(payment.amount))
    const accountId = body.accountId ? await this.ensureCashAccount(communityId, body.accountId) : payment.accountId ?? null
    const updated = await (this.prisma as any).payment.update({
      where: { id: payment.id },
      data: {
        status: 'POSTED',
        provider: body.provider ?? payment.provider ?? null,
        providerRef: body.providerRef ?? payment.providerRef ?? null,
        providerMeta: body.providerMeta ?? payment.providerMeta ?? null,
        allocationSpec,
        confirmedAt: new Date(),
        accountId,
      },
    })

    await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId: payment.id } })
    const periodId = await this.latestPeriodId(communityId)
    const { applied, remaining } = await this.applyPayment(
      this.prisma,
      payment.id,
      Number(payment.amount),
      communityId,
      payment.billingEntityId,
      periodId,
      payment.currency || 'RON',
      undefined,
      allocationSpec as any,
    )
    await this.upsertCashTxForPayment(communityId, updated as any)
    return { payment: updated, applied, remaining }
  }

  async reapply(communityId: string, paymentId: string) {
    const payment = await (this.prisma as any).payment.findFirst({
      where: { id: paymentId, communityId },
      select: { id: true, amount: true, billingEntityId: true, allocationSpec: true, currency: true },
    })
    if (!payment) throw new NotFoundException('Payment not found')
    await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId } })
    const periodId = await this.latestPeriodId(communityId)
    return this.applyPayment(
      this.prisma,
      paymentId,
      Number(payment.amount),
      communityId,
      payment.billingEntityId,
      periodId,
      payment.currency || 'RON',
      undefined,
      payment.allocationSpec as any,
    )
  }

  /**
   * Idempotently reapply payments to charges in the given period.
   * Clears payment applications pointing to those charges, then reapplies payments chronologically.
   */
  async reapplyForPeriod(client: TxClient, communityId: string, periodId: string) {
    const charges = await client.beLedgerEntry.findMany({
      where: { communityId, periodId, kind: 'CHARGE' },
      select: { id: true, billingEntityId: true },
    })
    if (!charges.length) {
      this.logger.log(`[PAY] No charges found for period=${periodId}, nothing to reapply`)
      return
    }

    const chargeIds = charges.map((c: { id: string }) => c.id)
    await (client as any).paymentApplication.deleteMany({ where: { chargeId: { in: chargeIds } } })

    // A payment tagged with a collection cycle (providerMeta.cycleCode — e.g. imported cash-register
    // receipts) belongs to that cycle only. Without this scope, a prior cycle's receipt is re-applied
    // to a later period's charges, over-settling it and tripping "Payment exceeds open charges" on a
    // reopen→prepare. Untagged payments (no cycleCode) keep the cross-period net-out behavior.
    const period = await (client as any).period.findUnique({ where: { id: periodId }, select: { code: true } })
    const periodCode: string | null = period?.code ?? null

    this.logger.log(
      `[PAY] Reapplying payments for period=${periodId} community=${communityId} charges=${charges.length}`,
    )

    const beIds = Array.from(new Set(charges.map((c: { billingEntityId: string }) => c.billingEntityId))) as string[]
    for (const beId of beIds) {
      const allPayments: Array<{ id: string; amount: number; allocationSpec?: any; currency?: string; providerMeta?: any }> = (await (client as any).payment.findMany({
        where: { communityId, billingEntityId: beId },
        orderBy: { ts: 'asc' },
        select: { id: true, amount: true, allocationSpec: true, currency: true, providerMeta: true },
      })) as Array<{ id: string; amount: number; allocationSpec?: any; currency?: string; providerMeta?: any }>
      const payments = allPayments.filter((p) => {
        const cc = (p.providerMeta as any)?.cycleCode
        return !cc || !periodCode || cc === periodCode
      })
      const beChargeIds = charges
        .filter((c: { billingEntityId: string }) => c.billingEntityId === beId)
        .map((c: { id: string }) => c.id)
      this.logger.log(
        `[PAY] BE=${beId} charges=${beChargeIds.length} payments=${payments.length} (period=${periodId})`,
      )
      if (!payments.length) continue
      // Net out what each payment already settled elsewhere. This period's applications were just
      // deleted above, so any remaining applications belong to OTHER periods; only the unspent balance
      // may be applied here. Without this, a payment is re-applied at its full amount to every period
      // it is reapplied against, over-settling it and tripping "Payment exceeds open charges".
      const appliedRows: Array<{ paymentId: string; _sum: { amount: any } }> = await (client as any).paymentApplication.groupBy({
        by: ['paymentId'],
        where: { paymentId: { in: payments.map((p) => String((p as any).id)) } },
        _sum: { amount: true },
      })
      const appliedByPayment = new Map(appliedRows.map((r) => [r.paymentId, Number(r._sum.amount ?? 0)]))
      for (const p of payments) {
        const available = Number((Number(p.amount) - (appliedByPayment.get(String((p as any).id)) ?? 0)).toFixed(4))
        if (available <= 0.0001) {
          this.logger.log(`[PAY] Payment ${p.id} fully applied elsewhere, skipping for period=${periodId} BE=${beId}`)
          continue
        }
        const res = await this.applyPayment(
          client,
          String((p as any).id),
          available,
          communityId,
          beId,
          periodId,
          (p as any).currency || 'RON',
          beChargeIds,
          (p as any).allocationSpec ?? null,
        )
        if (res.applied) {
          this.logger.log(
            `[PAY] Applied ${res.applied} from payment=${p.id} to period=${periodId} BE=${beId} (remaining ${res.remaining})`,
          )
        } else {
          this.logger.log(
            `[PAY] Payment ${p.id} had nothing to apply for period=${periodId} BE=${beId} (amount=${p.amount})`,
          )
        }
      }
    }
  }

  private async upsertCashTxForPayment(
    communityId: string,
    payment: {
      id: string
      accountId?: string | null
      amount: any
      currency: string
      ts?: Date | null
      method?: string | null
      allocationSpec?: any[] | null
    },
  ) {
    if (!payment.accountId) return
    await this.prisma.cashTx.deleteMany({
      where: { communityId, refType: 'BE_PAYMENT', refId: payment.id, direction: 'IN' },
    })
    // Source of truth = the per-fund BE PAYMENT ledger entries posted by applyPayment
    // (covers FIFO, targeted charges, and advances). Skip silently if none (record-only).
    const les = await (this.prisma as any).beLedgerEntry.findMany({
      where: { communityId, kind: 'PAYMENT', refType: 'PAYMENT', refId: payment.id },
      select: { fundId: true, amount: true },
    })
    const fundTotals = new Map<string | null, number>()
    for (const le of les) {
      const fundId = le.fundId ?? null
      const amt = Number(le.amount || 0)
      if (!fundId || !Number.isFinite(amt) || amt <= 0) continue
      fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + amt)
    }
    const rows = Array.from(fundTotals.entries()).filter(([fundId]) => !!fundId).map(([fundId, amount]) => {
      return {
      communityId,
      accountId: payment.accountId as string,
      fundId,
      amount,
      currency: payment.currency || 'RON',
      ts: payment.ts ?? new Date(),
      direction: 'IN' as const,
      kind: 'PAYMENT' as const,
      status: 'POSTED' as const,
      refType: 'BE_PAYMENT',
      refId: payment.id,
      memo: payment.method ?? null,
      }
    })
    if (rows.length) {
      await this.prisma.cashTx.createMany({ data: rows })
    }
  }

  private async ensureCashAccount(communityId: string, accountId: string) {
    const account = await this.prisma.cashAccount.findFirst({ where: { id: accountId, communityId }, select: { id: true } })
    if (!account) throw new NotFoundException('Cash account not found')
    return account.id
  }
}
