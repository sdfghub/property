// src/modules/period/period.service.ts
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import type { Prisma, PrismaClient } from '@prisma/client'

type CloseStage = 'CLOSE_PREP' | 'CLOSE_FINAL'
type TxOrClient = PrismaClient | Prisma.TransactionClient

@Injectable()
export class PeriodService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Public API ---

  async prepare(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode)
    if (period.status !== 'OPEN') throw new BadRequestException('Period must be OPEN to prepare')

    return this.prisma.$transaction(async (tx) => {
      // recompute allocations from current snapshots
      await this.recomputeAllocations(this.prisma, communityId, period.id)

      // stage charges & statements
      await this.postChargesForStage(this.prisma, communityId, period.id, 'CLOSE_PREP')
      await this.computeStatements(this.prisma, communityId, period.id)

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
    if (period.status !== 'CLOSED') throw new BadRequestException('Only CLOSED periods can be reopened')

    // guard: no later CLOSED period exists
    const laterClosed = await this.prisma.period.count({
      where: { communityId, seq: { gt: period.seq }, status: 'CLOSED' },
    })
    if (laterClosed > 0) throw new ConflictException('Cannot reopen: a later period is CLOSED')

    return this.prisma.$transaction(async (tx) => {
      // delete FINAL artifacts tied to this close
      await tx.beLedgerEntry.deleteMany({
        where: { communityId, periodId: period.id, refType: 'CLOSE_FINAL', refId: period.id },
      })
      await tx.beStatement.deleteMany({ where: { communityId, periodId: period.id } })

      // NOTE: we do NOT delete opening balances in the next period that were explicitly imported.
      // On next approve, roll-forward upsert will overwrite system-produced openings anyway.

      await tx.period.update({
        where: { id: period.id },
        data: { status: 'OPEN', closedAt: null },
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

  private async recomputeAllocations(tx: TxOrClient, communityId: string, periodId: string) {
    // Hook your existing allocation pipeline here.
    // e.g., await allocateAllForPeriod(tx, { communityId, periodId })
    return
  }

  private async postChargesForStage(
    tx: TxOrClient,
    communityId: string,
    periodId: string,
    stage: CloseStage,
  ) {
    // Sum unit allocations → per-BE CHARGE
    const rows: Array<{ beId: string; amount: number }> = await tx.$queryRawUnsafe(
      `
      SELECT bem.billing_entity_id AS "beId",
             COALESCE(SUM(a.amount), 0)::numeric AS amount
      FROM allocation_line a
      JOIN billing_entity_member bem ON bem.unit_id = a.unit_id
      WHERE a.community_id = $1 AND a.period_id = $2
      GROUP BY bem.billing_entity_id
      `,
      communityId,
      periodId,
    )

    for (const r of rows) {
      await tx.beLedgerEntry.upsert({
        where: {
          communityId_periodId_billingEntityId_refType_refId: {
            communityId,
            periodId,
            billingEntityId: r.beId,
            refType: stage,
            refId: periodId,
          },
        },
        update: { amount: r.amount },
        create: {
          communityId,
          periodId,
          billingEntityId: r.beId,
          kind: 'CHARGE',
          amount: r.amount,
          currency: 'RON',
          refType: stage,
          refId: periodId,
        },
      })
    }
  }

  private async computeStatements(tx: TxOrClient, communityId: string, periodId: string) {
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
}
