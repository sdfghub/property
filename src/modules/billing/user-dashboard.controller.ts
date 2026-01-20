import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { BeQueryService } from './be-query.service'
import { PrismaService } from '../user/prisma.service'

@Controller('me')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class UserDashboardController {
  constructor(
    private readonly beQueries: BeQueryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('dashboard')
  async global(@Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId },
      select: {
        billingEntityId: true,
        billingEntity: { select: { id: true, code: true, name: true, communityId: true } },
      },
    })
    if (!beRoles.length) {
      return { totals: this.zeroTotals(), communities: [] }
    }

    const byCommunity = new Map<
      string,
      Array<{ id: string; code: string; name: string | null; communityId: string }>
    >()
    beRoles.forEach((r) => {
      const be = r.billingEntity
      if (!be?.communityId) return
      const list = byCommunity.get(be.communityId) ?? []
      list.push({ id: be.id, code: be.code, name: be.name ?? null, communityId: be.communityId })
      byCommunity.set(be.communityId, list)
    })

    const communityIds = Array.from(byCommunity.keys())
    const communityRows = await this.prisma.community.findMany({
      where: { id: { in: communityIds } },
      select: { id: true, code: true, name: true },
    })
    const communityMap = new Map(communityRows.map((c) => [c.id, c]))

    const rows = await Promise.all(
      communityIds.map(async (communityId) => {
        const beList = byCommunity.get(communityId) ?? []
        const beIds = beList.map((be) => be.id)
        const live = await this.getLiveBlock(communityId, beIds)
        return {
          community: communityMap.get(communityId) ?? { id: communityId, code: communityId, name: communityId },
          live,
        }
      }),
    )

    const totals = rows.reduce(
      (acc, row) => {
        this.sumTotalsInto(acc.live, row.live.totals)
        if (row.live.previousClosed?.totals) {
          this.sumTotalsInto(acc.previousClosed, row.live.previousClosed.totals)
        }
        return acc
      },
      { live: this.zeroTotals(), previousClosed: this.zeroTotals() },
    )

    return {
      totals,
      communities: rows,
    }
  }

  @Get('communities/:communityId/dashboard')
  async community(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { billingEntityId: true },
    })
    const beIds = beRoles.map((r) => r.billingEntityId)
    if (!beIds.length) {
      return {
        live: { period: null, totals: this.zeroTotals(), billingEntities: [], previousClosed: null },
      }
    }
    const live = await this.getLiveBlock(communityId, beIds)
    return { live }
  }

  private sumTotals(items: Array<{ dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number }>) {
    return items.reduce(
      (acc, item) => {
        acc.dueStart += Number(item.dueStart ?? 0)
        acc.charges += Number(item.charges ?? 0)
        acc.payments += Number(item.payments ?? 0)
        acc.adjustments += Number(item.adjustments ?? 0)
        acc.dueEnd += Number(item.dueEnd ?? 0)
        return acc
      },
      this.zeroTotals(),
    )
  }

  private sumTotalsInto(
    acc: { dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number },
    item: { dueStart: number; charges: number; payments: number; adjustments: number; dueEnd: number },
  ) {
    acc.dueStart += Number(item.dueStart ?? 0)
    acc.charges += Number(item.charges ?? 0)
    acc.payments += Number(item.payments ?? 0)
    acc.adjustments += Number(item.adjustments ?? 0)
    acc.dueEnd += Number(item.dueEnd ?? 0)
    return acc
  }

  private zeroTotals() {
    return { dueStart: 0, charges: 0, payments: 0, adjustments: 0, dueEnd: 0 }
  }

  private async getLiveBlock(communityId: string, beIds: string[]) {
    const activePeriod = await this.prisma.period.findFirst({
      where: { communityId, status: { in: ['OPEN', 'PREPARED'] } },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
    const latestClosed = await this.prisma.period.findFirst({
      where: { communityId, status: 'CLOSED' },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
    const livePeriod = activePeriod ?? latestClosed
    if (!livePeriod) {
      return { period: null, totals: this.zeroTotals(), billingEntities: [], previousClosed: null }
    }
    const res = await this.beQueries.getLedgerDueForPeriod(communityId, livePeriod.id, beIds, {})
    const previousClosed = await this.getPreviousClosedBlock(communityId, livePeriod, beIds)
    const previousByBe = new Map(
      (previousClosed?.items ?? []).map((item) => [item.billingEntityId, Number(item.dueEnd ?? 0)]),
    )
    const liveItems = (res.items || []).map((item) => ({
      ...item,
      previousClosedDue: previousByBe.get(item.billingEntityId) ?? 0,
    }))
    return {
      period: res.period,
      totals: this.sumTotals(res.items),
      billingEntities: liveItems,
      previousClosed: previousClosed ? { period: previousClosed.period, totals: previousClosed.totals } : null,
    }
  }

  private async getPreviousClosedBlock(
    communityId: string,
    livePeriod: { id: string; seq: number; status: string },
    beIds: string[],
  ) {
    const targetClosed =
      livePeriod.status === 'OPEN' || livePeriod.status === 'PREPARED'
        ? await this.prisma.period.findFirst({
            where: { communityId, status: 'CLOSED' },
            orderBy: { seq: 'desc' },
            select: { id: true, code: true, seq: true, status: true },
          })
        : await this.prisma.period.findFirst({
            where: { communityId, status: 'CLOSED', seq: { lt: livePeriod.seq } },
            orderBy: { seq: 'desc' },
            select: { id: true, code: true, seq: true, status: true },
          })
    if (!targetClosed) return null
    const statements = await this.prisma.beStatement.findMany({
      where: { communityId, periodId: targetClosed.id, billingEntityId: { in: beIds } },
      select: { billingEntityId: true, dueStart: true, charges: true, payments: true, adjustments: true, dueEnd: true },
    })
    const byBe = new Map(statements.map((s) => [s.billingEntityId, s]))
    const items = beIds.map((beId) => {
      const s = byBe.get(beId)
      return {
        billingEntityId: beId,
        dueStart: Number(s?.dueStart ?? 0),
        charges: Number(s?.charges ?? 0),
        payments: Number(s?.payments ?? 0),
        adjustments: Number(s?.adjustments ?? 0),
        dueEnd: Number(s?.dueEnd ?? 0),
        filtered: false,
      }
    })
    return {
      period: targetClosed,
      totals: this.sumTotals(items),
      items,
    }
  }
}
