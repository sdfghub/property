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
  amount: number
  currency?: string
}

type OpeningUnitRow = {
  communityId: string
  periodCode: string
  unitCode: string
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
      await this.prisma.beOpeningBalance.upsert({
        where: {
          communityId_periodId_billingEntityId: {
            communityId: r.communityId,
            periodId: period.id,
            billingEntityId: be.id,
          },
        },
        update: { amount: Number(r.amount), currency: r.currency ?? 'RON' },
        create: {
          communityId: r.communityId,
          periodId: period.id,
          billingEntityId: be.id,
          amount: Number(r.amount),
          currency: r.currency ?? 'RON',
        },
      })
      count += 1
    }
    return { ok: true, count }
  }

  @Scopes({ role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' })
  @Post('opening-balances/units')
  async importOpeningUnits(@Body() body: any) {
    const rows: OpeningUnitRow[] = Array.isArray(body?.rows) ? body.rows : body
    if (!Array.isArray(rows)) throw new Error('rows must be an array')
    const aggregates = new Map<string, { communityId: string; periodId: string; beId: string; currency: string; amount: number }>()
    for (const r of rows) {
      if (!r?.communityId || !r?.periodCode || !r?.unitCode) continue
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
      const bem = await this.prisma.billingEntityMember.findFirst({
        where: {
          unitId: unit.id,
          startSeq: { lte: period.seq },
          OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
        },
        select: { billingEntityId: true },
      })
      if (!bem) continue
      const key = `${r.communityId}::${period.id}::${bem.billingEntityId}`
      const entry = aggregates.get(key) ?? {
        communityId: r.communityId,
        periodId: period.id,
        beId: bem.billingEntityId,
        currency: r.currency ?? 'RON',
        amount: 0,
      }
      entry.amount += Number(r.amount)
      aggregates.set(key, entry)
    }
    let count = 0
    for (const agg of aggregates.values()) {
      await this.prisma.beOpeningBalance.upsert({
        where: {
          communityId_periodId_billingEntityId: {
            communityId: agg.communityId,
            periodId: agg.periodId,
            billingEntityId: agg.beId,
          },
        },
        update: { amount: agg.amount, currency: agg.currency },
        create: {
          communityId: agg.communityId,
          periodId: agg.periodId,
          billingEntityId: agg.beId,
          amount: agg.amount,
          currency: agg.currency,
        },
      })
      count += 1
    }
    return { ok: true, count }
  }
}
