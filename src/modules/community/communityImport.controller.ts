import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { PrismaService } from '../user/prisma.service'
import { parseCommunityDef } from '../../importers/community/parse'
import { applyCommunityPlan } from '../../importers/community/apply'
import { wipeCommunity } from '../../scripts/wipe-community'

type OpeningRow = {
  communityId: string
  periodCode: string
  beCode: string
  fundCode?: string
  unitCode?: string
  amount: number
  currency?: string
}

type OpeningUnitRow = {
  communityId: string
  periodCode: string
  unitCode: string
  fundCode: string
  amount: number
  currency?: string
}

@Controller('admin')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityImportController {
  constructor(private readonly prisma: PrismaService) {}

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post('communities/import')
  async importCommunity(@Body() body: any) {
    const def = body?.def ?? body
    if (!def?.id) throw new Error('def.id is required')
    const plan = parseCommunityDef(def)
    const stats = await applyCommunityPlan(plan)
    return { ok: true, communityId: plan.communityId, stats }
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post('communities/:communityId/wipe')
  async wipe(@Param('communityId') communityId: string, @Body() body: any) {
    await wipeCommunity(communityId, {
      keepExternalRefs: Boolean(body?.keepExternalRefs),
      keepVendors: body?.keepVendors !== false,
      keepInvoices: body?.keepInvoices !== false,
    })
    return { ok: true }
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post('opening-balances')
  async importOpening(@Body() body: any) {
    const rows: OpeningRow[] = Array.isArray(body?.rows) ? body.rows : body
    if (!Array.isArray(rows)) throw new Error('rows must be an array')
    let count = 0
    for (const r of rows) {
      if (!r?.communityId || !r?.periodCode || !r?.beCode) continue
      if (!Number.isFinite(Number(r.amount))) continue
      const period = await this.prisma.period.findUnique({
        where: { communityId_code: { communityId: r.communityId, code: r.periodCode } },
        select: { id: true },
      })
      if (!period) continue
      const be = await this.prisma.billingEntity.findUnique({
        where: { code_communityId: { code: r.beCode, communityId: r.communityId } },
        select: { id: true },
      })
      if (!be) continue
      let fundId: string | null = null
      if (r.fundCode) {
        const fund = await this.prisma.fund.findUnique({
          where: { communityId_code: { code: r.fundCode, communityId: r.communityId } },
          select: { id: true },
        })
        if (!fund) continue
        fundId = fund.id
      }
      let unitId: string | null = null
      if (r.unitCode) {
        const unit = await this.prisma.unit.findUnique({
          where: { code_communityId: { code: r.unitCode, communityId: r.communityId } },
          select: { id: true },
        })
        if (!unit) continue
        unitId = unit.id
      }
      if (fundId == null || unitId == null) {
        const existing = await this.prisma.beOpeningBalance.findFirst({
          where: {
            communityId: r.communityId,
            periodId: period.id,
            billingEntityId: be.id,
            fundId,
            unitId,
          },
          select: { id: true },
        })
        if (existing?.id) {
          await this.prisma.beOpeningBalance.update({
            where: { id: existing.id },
            data: { amount: Number(r.amount), currency: r.currency ?? 'RON' },
          })
        } else {
          await this.prisma.beOpeningBalance.create({
            data: {
              communityId: r.communityId,
              periodId: period.id,
              billingEntityId: be.id,
              fundId,
              unitId,
              amount: Number(r.amount),
              currency: r.currency ?? 'RON',
            },
          })
        }
      } else {
        await this.prisma.beOpeningBalance.upsert({
          where: {
            communityId_periodId_billingEntityId_fundId_unitId: {
              communityId: r.communityId,
              periodId: period.id,
              billingEntityId: be.id,
              fundId,
              unitId,
            },
          },
          update: { amount: Number(r.amount), currency: r.currency ?? 'RON' },
          create: {
            communityId: r.communityId,
            periodId: period.id,
            billingEntityId: be.id,
            fundId,
            unitId,
            amount: Number(r.amount),
            currency: r.currency ?? 'RON',
          },
        })
      }
      count += 1
    }
    return { ok: true, count }
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post('opening-balances/units')
  async importOpeningUnits(@Body() body: any) {
    const rows: OpeningUnitRow[] = Array.isArray(body?.rows) ? body.rows : body
    if (!Array.isArray(rows)) throw new Error('rows must be an array')
    const entries: Array<{
      communityId: string
      periodId: string
      beId: string
      unitId: string
      fundId: string
      currency: string
      amount: number
    }> = []
    for (const r of rows) {
      if (!r?.communityId || !r?.periodCode || !r?.unitCode) continue
      if (!r?.fundCode) continue
      if (!Number.isFinite(Number(r.amount))) continue
      const period = await this.prisma.period.findUnique({
        where: { communityId_code: { communityId: r.communityId, code: r.periodCode } },
        select: { id: true, seq: true },
      })
      if (!period) continue
      const unit = await this.prisma.unit.findUnique({
        where: { code_communityId: { code: r.unitCode, communityId: r.communityId } },
        select: { id: true },
      })
      if (!unit) continue
      const fund = await this.prisma.fund.findUnique({
        where: { communityId_code: { code: r.fundCode, communityId: r.communityId } },
        select: { id: true },
      })
      if (!fund) continue
      const bem = await this.prisma.billingEntityMember.findFirst({
        where: {
          unitId: unit.id,
          startSeq: { lte: period.seq },
          OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
        },
        select: { billingEntityId: true },
      })
      if (!bem) continue
      entries.push({
        communityId: r.communityId,
        periodId: period.id,
        beId: bem.billingEntityId,
        unitId: unit.id,
        fundId: fund.id,
        currency: r.currency ?? 'RON',
        amount: Number(r.amount),
      })
    }
    let count = 0
    for (const agg of entries) {
      await this.prisma.beOpeningBalance.upsert({
        where: {
          communityId_periodId_billingEntityId_fundId_unitId: {
            communityId: agg.communityId,
            periodId: agg.periodId,
            billingEntityId: agg.beId,
            fundId: agg.fundId,
            unitId: agg.unitId,
          },
        },
        update: { amount: agg.amount, currency: agg.currency },
        create: {
          communityId: agg.communityId,
          periodId: agg.periodId,
          billingEntityId: agg.beId,
          fundId: agg.fundId,
          unitId: agg.unitId,
          amount: agg.amount,
          currency: agg.currency,
        },
      })
      count += 1
    }
    return { ok: true, count }
  }
}
