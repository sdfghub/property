import { ForbiddenException, Injectable } from '@nestjs/common'
import { BillingEntityRole } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

/**
 * Sub-role access checks for billing-entity users. The auth JWT flattens every
 * BillingEntityUserRole into a single BILLING_ENTITY_USER entry (auth.service.ts) and drops the
 * OWNER/RESIDENT/EXPENSE_RESPONSIBLE distinction, so any capability that depends on the sub-role is
 * enforced here — read live from the DB, which is authoritative and free of stale-token windows.
 */
@Injectable()
export class MemberAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Distinct BillingEntityRole sub-roles the user holds on any BE in this community. */
  async getCommunityRoles(userId: string | undefined, communityId: string): Promise<BillingEntityRole[]> {
    if (!userId) return []
    const rows = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { role: true },
    })
    return Array.from(new Set(rows.map((r) => r.role)))
  }

  isCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    return roles.some(
      (r) =>
        r.role === 'SYSTEM_ADMIN' ||
        (r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId === communityId),
    )
  }

  /**
   * Community-wide read gate: passes for a community/system admin, or a user holding at least one of
   * the `allowed` sub-roles on some BE in the community. Returns the caller's held sub-roles so a
   * caller can build a capability payload. Throws ForbiddenException otherwise (e.g. a RESIDENT-only
   * user asking for an OWNER/EXPENSE_RESPONSIBLE report).
   */
  async assertCommunityMemberRole(
    userId: string | undefined,
    communityId: string,
    allowed: BillingEntityRole[],
    roles: RoleAssignment[] = [],
  ): Promise<BillingEntityRole[]> {
    const held = await this.getCommunityRoles(userId, communityId)
    if (this.isCommunityAdmin(roles, communityId)) return held
    if (!held.some((r) => allowed.includes(r))) {
      throw new ForbiddenException('Insufficient billing-entity role for this community report')
    }
    return held
  }
}
