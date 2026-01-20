import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ensureLedgerEntryDetail } from './ledger-detail.util'

type TxClient = any
type PaymentAllocationSpec = {
  source: 'AUTO_DETAIL' | 'SPEC'
  paymentId: string
  chargeId: string
  detailId: string
  unitId?: string | null
  bucket?: string | null
  billingEntityId?: string | null
  lineIndex?: number | null
  amount: number
}
type AllocationSpecLine = {
  amount: number
  billingEntityId?: string
  bucket?: string
  unitId?: string
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
                   'bucket', le.bucket,
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
    filters?: { bucket?: string; unitId?: string },
    excludedChargeIds?: string[],
  ) {
    return client.$queryRawUnsafe(
      `
      SELECT le.id AS "chargeId",
             le.created_at AS "chargeCreatedAt",
             le.bucket AS "chargeBucket",
             d.id AS "detailId",
             d.unit_id AS "unitId",
             d.amount::numeric AS "detailAmount",
             COALESCE(app.paid,0)::numeric AS "chargeApplied"
      FROM be_ledger_entry le
      JOIN be_ledger_entry_detail d ON d.ledger_entry_id = le.id
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
        ${filters?.bucket ? `AND d.bucket = ${allowedChargeIds?.length ? '$4' : '$3'}` : ''}
        ${
          filters?.unitId
            ? `AND d.unit_id = ${allowedChargeIds?.length ? (filters?.bucket ? '$5' : '$4') : filters?.bucket ? '$4' : '$3'}`
            : ''
        }
        ${excludedChargeIds && excludedChargeIds.length ? `AND le.id::text <> ALL(${
          allowedChargeIds?.length
            ? filters?.bucket
              ? filters?.unitId
                ? '$6'
                : '$5'
              : filters?.unitId
                ? '$5'
                : '$4'
            : filters?.bucket
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
      ...(filters?.bucket ? [filters.bucket] : []),
      ...(filters?.unitId ? [filters.unitId] : []),
      ...(excludedChargeIds && excludedChargeIds.length ? [excludedChargeIds] : []),
    )
  }

  private buildAppsFromDetails(
    detailRows: any[],
    amount: number,
    paymentId: string,
    source: 'AUTO_DETAIL' | 'SPEC',
    specMeta?: { bucket?: string | null; unitId?: string | null; billingEntityId?: string | null; lineIndex?: number },
  ) {
    const byCharge = new Map<
      string,
      {
        chargeId: string
        chargeCreatedAt: Date
        chargeBucket: string
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
          chargeBucket: r.chargeBucket,
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
    const charges = Array.from(byCharge.values()).sort(
      (a, b) => a.chargeCreatedAt.getTime() - b.chargeCreatedAt.getTime(),
    )
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
              bucket: specMeta?.bucket ?? c.chargeBucket ?? null,
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
      const detailRows = await this.findOpenChargeDetails(
        client,
        communityId,
        lineBeId,
        allowedChargeIds,
        { bucket: line.bucket, unitId: line.unitId },
        Array.from(coveredChargeIds),
      )
      const res = this.buildAppsFromDetails(detailRows, lineAmount, paymentId, 'SPEC', {
        bucket: line.bucket ?? null,
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
    allocationSpec.forEach((line, idx) => {
      const amt = Number(line?.amount ?? 0)
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
      if (line.bucket != null && typeof line.bucket !== 'string') {
        throw new BadRequestException(`allocationSpec[${idx}].bucket must be a string`)
      }
    })
    if (total - amount > 0.01) {
      throw new BadRequestException('allocationSpec total cannot exceed payment amount')
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

  private async upsertUnallocatedPaymentDetail(
    client: TxClient,
    entry: {
      id: string
      communityId: string
      periodId: string
      billingEntityId: string
      kind: string
      bucket: string
      currency: string | null
      refType: string | null
      refId: string | null
    },
    paymentId: string,
    amount: number,
  ) {
    const allocatedRows: Array<{ total: any }> = await (client as any).$queryRawUnsafe(
      `
      SELECT COALESCE(SUM(amount),0) AS total
      FROM be_ledger_entry_detail
      WHERE ledger_entry_id = $1
        AND (meta->>'reason' IS NULL OR meta->>'reason' <> 'payment-unallocated')
    `,
      entry.id,
    )
    const allocated = Number(allocatedRows?.[0]?.total ?? 0)
    const desired = Math.max(0, amount - allocated)
    const existing: Array<{ id: string }> = await (client as any).$queryRawUnsafe(
      `
      SELECT id
      FROM be_ledger_entry_detail
      WHERE ledger_entry_id = $1
        AND meta->>'reason' = 'payment-unallocated'
      LIMIT 1
    `,
      entry.id,
    )
    const existingId = existing?.[0]?.id ?? null
    if (desired <= 0) {
      if (existingId) {
        await (client as any).beLedgerEntryDetail.delete({ where: { id: existingId } })
      }
      return
    }
    if (existingId) {
      await (client as any).beLedgerEntryDetail.update({
        where: { id: existingId },
        data: { amount: desired },
      })
      return
    }
    await (client as any).beLedgerEntryDetail.create({
      data: {
        ledgerEntryId: entry.id,
        communityId: entry.communityId,
        periodId: entry.periodId,
        billingEntityId: entry.billingEntityId,
        kind: entry.kind,
        bucket: entry.bucket,
        currency: entry.currency || 'RON',
        refType: entry.refType,
        refId: entry.refId,
        amount: desired,
        meta: {
          synthetic: true,
          reason: 'payment-unallocated',
          paymentId,
        },
      },
    })
  }

  private async applyPayment(
    client: TxClient,
    paymentId: any,
    amount: number,
    communityId: string,
    billingEntityId: string,
    allowedChargeIds?: string[],
    allocationSpec?: AllocationSpecLine[] | null,
  ) {
    const paymentIdStr = String(paymentId)
    let apps: Array<{ paymentId: string; chargeId: string; amount: number; spec: PaymentAllocationSpec | any }> = []
    let remaining = amount
    if (allocationSpec && allocationSpec.length) {
      const res = await this.applyPaymentWithSpec(
        client,
        paymentIdStr,
        amount,
        communityId,
        billingEntityId,
        allocationSpec,
        allowedChargeIds,
      )
      apps = res.apps
      remaining = res.remaining
    } else {
      const detailRows = await this.findOpenChargeDetails(client, communityId, billingEntityId, allowedChargeIds)
      const res = this.buildAppsFromDetails(detailRows, amount, paymentIdStr, 'AUTO_DETAIL')
      apps = res.apps
      remaining = res.remaining
    }
    const paymentLedgerEntryId = await this.getPaymentLedgerEntryId(
      client,
      communityId,
      billingEntityId,
      paymentIdStr,
    )
    const paymentLedgerEntry = paymentLedgerEntryId
      ? await (client as any).beLedgerEntry.findUnique({
          where: { id: paymentLedgerEntryId },
          select: {
            id: true,
            communityId: true,
            periodId: true,
            billingEntityId: true,
            kind: true,
            bucket: true,
            currency: true,
            refType: true,
            refId: true,
          },
        })
      : null
    if (paymentLedgerEntryId) {
      if (allowedChargeIds && allowedChargeIds.length) {
        await (client as any).$executeRawUnsafe(
          `DELETE FROM be_ledger_entry_detail
           WHERE ledger_entry_id = $1
             AND (meta->>'chargeId') = ANY($2::text[])`,
          paymentLedgerEntryId,
          allowedChargeIds,
        )
      } else {
        await (client as any).beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: paymentLedgerEntryId } })
      }
    }
    if (apps.length) {
      await (client as any).paymentApplication.createMany({ data: apps, skipDuplicates: true })
      if (paymentLedgerEntryId && paymentLedgerEntry) {
        await (client as any).beLedgerEntryDetail.createMany({
          data: apps.map((app) => ({
            ledgerEntryId: paymentLedgerEntryId,
            communityId: paymentLedgerEntry.communityId,
            periodId: paymentLedgerEntry.periodId,
            billingEntityId: paymentLedgerEntry.billingEntityId,
            kind: paymentLedgerEntry.kind,
            bucket: paymentLedgerEntry.bucket,
            currency: paymentLedgerEntry.currency,
            refType: paymentLedgerEntry.refType,
            refId: paymentLedgerEntry.refId,
            amount: app.amount,
            meta: app.spec,
          })),
          skipDuplicates: true,
        })
      }
    }
    if (paymentLedgerEntry) {
      await this.upsertUnallocatedPaymentDetail(client, paymentLedgerEntry, paymentIdStr, amount)
    }
    return { applied: amount - remaining, remaining }
  }

  private async latestPeriodId(communityId: string) {
    const p = await this.prisma.period.findFirst({
      where: { communityId },
      orderBy: [{ seq: 'desc' }],
      select: { id: true },
    })
    return p?.id ?? 'PAYMENT'
  }

  private async getPaymentLedgerEntryId(
    client: TxClient,
    communityId: string,
    billingEntityId: string,
    paymentId: string,
  ) {
    const entry = await (client as any).beLedgerEntry.findFirst({
      where: {
        communityId,
        billingEntityId,
        refType: 'PAYMENT',
        refId: paymentId,
        bucket: 'PAYMENT',
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    return entry?.id ?? null
  }

  private async upsertPaymentLedger(
    communityId: string,
    periodId: string,
    billingEntityId: string,
    paymentId: string,
    amount: number,
    currency: string,
  ) {
    const entry = await this.prisma.beLedgerEntry.upsert({
      where: {
        communityId_periodId_billingEntityId_refType_refId_bucket: {
          communityId,
          periodId,
          billingEntityId,
          refType: 'PAYMENT',
          refId: paymentId,
          bucket: 'PAYMENT',
        },
      },
      update: { amount, currency },
      create: {
        communityId,
        periodId,
        billingEntityId,
        kind: 'PAYMENT',
        amount,
        currency,
        refType: 'PAYMENT',
        refId: paymentId,
        bucket: 'PAYMENT',
      },
    })
    await ensureLedgerEntryDetail(this.prisma, entry, amount, {
      synthetic: true,
      reason: 'payment',
      paymentId,
    })
    return entry.id
  }

  async createOrApply(communityId: string, body: any) {
    if (!body.billingEntityId) throw new BadRequestException('billingEntityId is required')
    if (body.amount == null) throw new BadRequestException('amount is required')
    const beId = await this.ensureBillingEntity(communityId, body.billingEntityId)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    const periodId = await this.latestPeriodId(communityId)

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

    await this.upsertPaymentLedger(communityId, periodId, beId, payment.id, amount, body.currency || 'RON')

    if (body.applyMode === 'none') {
      return { payment, applied: 0, remaining: amount }
    }

    const { applied, remaining } = await this.applyPayment(
      this.prisma,
      payment.id,
      amount,
      communityId,
      beId,
      undefined,
      allocationSpec,
    )
    return { payment, applied, remaining }
  }

  async createIntent(communityId: string, body: any) {
    if (!body.billingEntityId) throw new BadRequestException('billingEntityId is required')
    if (body.amount == null) throw new BadRequestException('amount is required')
    const beId = await this.ensureBillingEntity(communityId, body.billingEntityId)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    const allocationSpec = Array.isArray(body.allocationSpec) ? body.allocationSpec : null
    await this.validateAllocationSpec(communityId, beId, allocationSpec, amount)
    const payment = await (this.prisma as any).payment.create({
      data: {
        communityId,
        billingEntityId: beId,
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
    const updated = await (this.prisma as any).payment.update({
      where: { id: payment.id },
      data: {
        status: 'POSTED',
        provider: body.provider ?? payment.provider ?? null,
        providerRef: body.providerRef ?? payment.providerRef ?? null,
        providerMeta: body.providerMeta ?? payment.providerMeta ?? null,
        allocationSpec,
        confirmedAt: new Date(),
      },
    })

    await this.upsertPaymentLedger(
      communityId,
      await this.latestPeriodId(communityId),
      payment.billingEntityId,
      payment.id,
      Number(payment.amount),
      payment.currency || 'RON',
    )
    await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId: payment.id } })
    const { applied, remaining } = await this.applyPayment(
      this.prisma,
      payment.id,
      Number(payment.amount),
      communityId,
      payment.billingEntityId,
      undefined,
      allocationSpec as any,
    )
    return { payment: updated, applied, remaining }
  }

  async reapply(communityId: string, paymentId: string) {
    const payment = await (this.prisma as any).payment.findFirst({
      where: { id: paymentId, communityId },
      select: { id: true, amount: true, billingEntityId: true, allocationSpec: true },
    })
    if (!payment) throw new NotFoundException('Payment not found')
    await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId } })
    return this.applyPayment(
      this.prisma,
      paymentId,
      Number(payment.amount),
      communityId,
      payment.billingEntityId,
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

    this.logger.log(
      `[PAY] Reapplying payments for period=${periodId} community=${communityId} charges=${charges.length}`,
    )

    const beIds = Array.from(new Set(charges.map((c: { billingEntityId: string }) => c.billingEntityId))) as string[]
    for (const beId of beIds) {
      const payments: Array<{ id: string; amount: number; allocationSpec?: any }> = (await (client as any).payment.findMany({
        where: { communityId, billingEntityId: beId },
        orderBy: { ts: 'asc' },
        select: { id: true, amount: true, allocationSpec: true },
      })) as Array<{ id: string; amount: number; allocationSpec?: any }>
      const beChargeIds = charges
        .filter((c: { billingEntityId: string }) => c.billingEntityId === beId)
        .map((c: { id: string }) => c.id)
      this.logger.log(
        `[PAY] BE=${beId} charges=${beChargeIds.length} payments=${payments.length} (period=${periodId})`,
      )
      if (!payments.length) continue
      for (const p of payments) {
        const res = await this.applyPayment(
          client,
          String((p as any).id),
          Number(p.amount),
          communityId,
          beId,
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
}
