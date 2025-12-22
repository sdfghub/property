import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type TxClient = any

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
                   'refId', le.ref_id
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
        applications: { select: { id: true, amount: true, chargeId: true } },
      } as any,
    })
    if (!payment) throw new NotFoundException('Payment not found')
    return payment
  }

  private async findOpenCharges(
    client: TxClient,
    communityId: string,
    billingEntityId: string,
    allowedChargeIds?: string[],
  ) {
    return client.$queryRawUnsafe(
      `
      SELECT le.id,
             (le.amount - COALESCE(app.paid,0))::numeric AS remaining,
             le.created_at AS "createdAt",
             le.bucket
      FROM be_ledger_entry le
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
      ORDER BY le.created_at ASC
    `,
      communityId,
      billingEntityId,
      ...(allowedChargeIds && allowedChargeIds.length ? [allowedChargeIds] : []),
    )
  }

  private async applyPayment(
    client: TxClient,
    paymentId: any,
    amount: number,
    communityId: string,
    billingEntityId: string,
    allowedChargeIds?: string[],
  ) {
    const charges = await this.findOpenCharges(client, communityId, billingEntityId, allowedChargeIds)
    let remaining = amount
    const apps: Array<{ paymentId: string; chargeId: string; amount: number }> = []
    for (const c of charges) {
      if (remaining <= 0) break
      const apply = Math.min(remaining, Number(c.remaining))
      if (apply > 0) {
        apps.push({ paymentId: String(paymentId), chargeId: c.id, amount: apply })
        remaining -= apply
      }
    }
    if (apps.length) {
      await (client as any).paymentApplication.createMany({ data: apps, skipDuplicates: true })
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

  private async upsertPaymentLedger(
    communityId: string,
    periodId: string,
    billingEntityId: string,
    paymentId: string,
    amount: number,
    currency: string,
  ) {
    await this.prisma.beLedgerEntry.upsert({
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
        },
      })
    }

    await this.upsertPaymentLedger(communityId, periodId, beId, payment.id, amount, body.currency || 'RON')

    if (body.applyMode === 'none') {
      return { payment, applied: 0, remaining: amount }
    }

    const { applied, remaining } = await this.applyPayment(this.prisma, payment.id, amount, communityId, beId)
    return { payment, applied, remaining }
  }

  async reapply(communityId: string, paymentId: string) {
    const payment = await (this.prisma as any).payment.findFirst({
      where: { id: paymentId, communityId },
      select: { id: true, amount: true, billingEntityId: true },
    })
    if (!payment) throw new NotFoundException('Payment not found')
    await (this.prisma as any).paymentApplication.deleteMany({ where: { paymentId } })
    return this.applyPayment(this.prisma, paymentId, Number(payment.amount), communityId, payment.billingEntityId)
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
      const payments: Array<{ id: string; amount: number }> = (await (client as any).payment.findMany({
        where: { communityId, billingEntityId: beId },
        orderBy: { ts: 'asc' },
        select: { id: true, amount: true },
      })) as Array<{ id: string; amount: number }>
      const beChargeIds = charges
        .filter((c: { billingEntityId: string }) => c.billingEntityId === beId)
        .map((c: { id: string }) => c.id)
      this.logger.log(
        `[PAY] BE=${beId} charges=${beChargeIds.length} payments=${payments.length} (period=${periodId})`,
      )
      if (!payments.length) continue
      for (const p of payments) {
        const res = await this.applyPayment(client, String((p as any).id), Number(p.amount), communityId, beId, beChargeIds)
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
