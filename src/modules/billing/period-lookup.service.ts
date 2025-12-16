import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class BillingPeriodLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCommunityId(ref: string) {
    return this.ensureCommunityId(ref)
  }

  async getPeriod(communityRef: string, periodCode: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    const period = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: periodCode } },
      select: { id: true, seq: true, code: true, status: true },
    })
    if (!period) throw new NotFoundException(`Period ${periodCode} not found for ${communityId}`)
    return period
  }

  async listClosed(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    return this.prisma.period.findMany({
      where: { communityId, status: 'CLOSED' },
      select: { id: true, code: true, seq: true, status: true },
      orderBy: { seq: 'desc' },
    })
  }

  async listOpenOrDraft(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    return this.prisma.period.findMany({
      where: { communityId, status: { not: 'CLOSED' } },
      select: { id: true, code: true, seq: true, status: true },
      orderBy: { seq: 'asc' },
    })
  }

  async listClosedForBe(beId: string) {
    const be = await this.prisma.billingEntity.findUnique({
      where: { id: beId },
      select: { communityId: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    return this.listClosed(be.communityId)
  }

  async listAllForBe(beId: string) {
    const be = await this.prisma.billingEntity.findUnique({
      where: { id: beId },
      select: { communityId: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    return this.prisma.period.findMany({
      where: { communityId: be.communityId },
      select: { id: true, code: true, seq: true, status: true },
      orderBy: { seq: 'asc' },
    })
  }

  private async ensureCommunityId(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }
}
