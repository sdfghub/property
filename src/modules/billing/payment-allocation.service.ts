import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ALLOCATION_STRATEGY_META, resolveAllocationConfig, type PaymentAllocationConfig } from './payment-allocation'

type ConfigWithFunds = PaymentAllocationConfig & {
  funds: Array<{ code: string; name: string }>
  strategies: typeof ALLOCATION_STRATEGY_META
}

@Injectable()
export class PaymentAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolved allocation config + the community's funds (for building a fund-priority order). communityId = id or code. */
  async get(communityId: string): Promise<ConfigWithFunds> {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { id: true, paymentAllocation: true },
    })
    if (!c) throw new NotFoundException('Community not found')
    const cfg = resolveAllocationConfig(c.paymentAllocation)
    const funds = await this.prisma.fund.findMany({
      where: { communityId: c.id },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    })
    return { ...cfg, funds, strategies: ALLOCATION_STRATEGY_META }
  }

  /** Persist the allocation config (normalized; unknown strategy falls back to FIFO). */
  async set(communityId: string, body: any): Promise<PaymentAllocationConfig> {
    const cfg = resolveAllocationConfig(body)
    const res = await this.prisma.community.updateMany({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      data: { paymentAllocation: cfg as any },
    })
    if (!res.count) throw new NotFoundException('Community not found')
    return cfg
  }
}
