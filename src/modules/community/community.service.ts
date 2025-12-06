import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type Role = 'SYSTEM_ADMIN' | 'COMMUNITY_ADMIN' | 'CENSOR' | 'BILLING_ENTITY_USER'
type ScopeType = 'SYSTEM' | 'COMMUNITY' | 'BILLING_ENTITY'

@Injectable()
export class CommunityService {
  constructor(private prisma: PrismaService) {}

  async listForUser(userId: string) {
    // SYSTEM_ADMIN → all communities
    const sys = await this.prisma.roleAssignment.findFirst({
      where: { userId, role: 'SYSTEM_ADMIN' as Role, scopeType: 'SYSTEM' as ScopeType },
      select: { id: true },
    })
    if (sys) {
      return this.prisma.community.findMany({ select: { id: true, code: true, name: true } })
    }


    const communityIds = new Set<string>()

    // COMMUNITY-scoped roles → those communityIds directly
    const byCommunity = await this.prisma.roleAssignment.findMany({
      where: { userId, scopeType: 'COMMUNITY' as ScopeType },
      select: { scopeId: true },
    })
    byCommunity.forEach(x => { if (x.scopeId) communityIds.add(x.scopeId) })

    // BILLING_ENTITY-scoped roles → map BE → community
    const byBe = await this.prisma.roleAssignment.findMany({
      where: { userId, scopeType: 'BILLING_ENTITY' as ScopeType },
      select: { scopeId: true },
    })

    const beIds: string[] = byBe
      .map(x => x.scopeId)
      .filter((id): id is string => !!id)

    if (byBe.length) {
      const bes = await this.prisma.billingEntity.findMany({
        where: { id: { in: beIds } },
        select: { communityId: true },
      })
      bes.forEach(b => communityIds.add(b.communityId))
    }

    if (communityIds.size === 0) return []

    return this.prisma.community.findMany({
      where: { id: { in: Array.from(communityIds) } },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    })
  }
}
