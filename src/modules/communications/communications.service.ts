import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AnnouncementAudienceType, AnnouncementImpactTag, BillingEntityRole } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

const AUDIENCE_TYPES = new Set(['COMMUNITY', 'UNIT_GROUP'])
const IMPACT_TAGS = new Set(['WATER', 'HEAT', 'ELEVATOR', 'ELECTRICITY', 'ACCESS', 'OTHER'])
const BE_ROLE_TYPES: BillingEntityRole[] = ['OWNER', 'RESIDENT', 'EXPENSE_RESPONSIBLE']
const BE_ROLE_SET = new Set<BillingEntityRole>(BE_ROLE_TYPES)

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private isCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    return roles.some(
      (r) => r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId === communityId,
    )
  }

  private async isCommunityMember(userId: string, communityId: string) {
    const match = await this.prisma.billingEntityUserRole.findFirst({
      where: { userId, billingEntity: { communityId } },
      select: { id: true },
    })
    return !!match
  }

  private async ensureCommunityMember(userId: string, roles: RoleAssignment[], communityId: string) {
    if (this.isCommunityAdmin(roles, communityId)) return
    if (await this.isCommunityMember(userId, communityId)) return
    throw new ForbiddenException('Not a community member')
  }

  private ensureCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    if (this.isCommunityAdmin(roles, communityId)) return
    throw new ForbiddenException('Admin permissions required')
  }

  private normalizeTitle(raw: any, field = 'title') {
    const value = String(raw ?? '').trim()
    if (!value) throw new BadRequestException(`${field} is required`)
    return value
  }

  private parseAudienceType(raw: any): AnnouncementAudienceType {
    const value = String(raw ?? '').toUpperCase()
    if (!AUDIENCE_TYPES.has(value)) throw new BadRequestException('Invalid audience type')
    return value as AnnouncementAudienceType
  }

  private normalizeImpactTags(raw: any): AnnouncementImpactTag[] {
    if (!Array.isArray(raw)) return []
    const tags = raw
      .map((tag) => String(tag ?? '').toUpperCase())
      .filter((tag) => IMPACT_TAGS.has(tag))
    return Array.from(new Set(tags)) as AnnouncementImpactTag[]
  }

  private parseDate(raw: any, field: string) {
    if (raw == null) return null
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) throw new BadRequestException(`${field} must be a valid date`)
    return dt
  }

  private parseTargetRoles(raw: any): BillingEntityRole[] | null {
    if (raw == null) return null
    if (!Array.isArray(raw)) throw new BadRequestException('Invalid target roles')
    if (raw.length === 0) throw new BadRequestException('Target roles are required')
    const roles = raw.map((r) => String(r ?? '').toUpperCase())
    const invalid = roles.find((r) => !BE_ROLE_SET.has(r as BillingEntityRole))
    if (invalid) throw new BadRequestException('Invalid target role')
    return Array.from(new Set(roles)) as BillingEntityRole[]
  }

  private async listUserBeRoles(communityId: string, userId: string) {
    const roles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { role: true },
    })
    return new Set(roles.map((r) => r.role))
  }

  private async listUserUnitGroupIds(communityId: string, userId: string) {
    const beIds = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { billingEntityId: true },
    })
    if (!beIds.length) return []

    const unitIds = await this.prisma.billingEntityMember.findMany({
      where: { billingEntityId: { in: beIds.map((b) => b.billingEntityId) } },
      select: { unitId: true },
    })
    if (!unitIds.length) return []

    const groups = await this.prisma.unitGroupMember.findMany({
      where: { unitId: { in: unitIds.map((u) => u.unitId) } },
      select: { groupId: true },
    })

    return Array.from(new Set(groups.map((g) => g.groupId)))
  }

  private async listCommunityUserIds(communityId: string, targetRoles: BillingEntityRole[]) {
    const communityAdmins = await this.prisma.roleAssignment.findMany({
      where: { role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: communityId },
      select: { userId: true },
    })
    const beRoleRows = await this.prisma.billingEntityUserRole.findMany({
      where: {
        role: { in: targetRoles },
        billingEntity: { communityId },
      },
      select: { userId: true },
    })

    const all = new Set<string>()
    communityAdmins.forEach((r) => all.add(r.userId))
    beRoleRows.forEach((r) => all.add(r.userId))
    return Array.from(all)
  }

  private async listUnitGroupUserIds(
    communityId: string,
    unitGroupIds: string[],
    targetRoles: BillingEntityRole[],
  ) {
    if (!unitGroupIds.length) return []
    const unitMembers = await this.prisma.unitGroupMember.findMany({
      where: { groupId: { in: unitGroupIds } },
      select: { unitId: true },
    })
    if (!unitMembers.length) return []

    const billingMembers = await this.prisma.billingEntityMember.findMany({
      where: { unitId: { in: unitMembers.map((u) => u.unitId) } },
      select: { billingEntityId: true },
    })
    if (!billingMembers.length) return []

    const beIds = Array.from(new Set(billingMembers.map((m) => m.billingEntityId)))
    const beRoleRows = await this.prisma.billingEntityUserRole.findMany({
      where: {
        billingEntityId: { in: beIds },
        role: { in: targetRoles },
      },
      select: { userId: true },
    })

    const communityAdmins = await this.prisma.roleAssignment.findMany({
      where: { role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: communityId },
      select: { userId: true },
    })

    const all = new Set<string>()
    communityAdmins.forEach((r) => all.add(r.userId))
    beRoleRows.forEach((r) => all.add(r.userId))
    return Array.from(all)
  }

  async listAnnouncements(communityId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const isAdmin = this.isCommunityAdmin(roles, communityId)

    if (isAdmin) {
      return this.prisma.announcement.findMany({
        where: { communityId },
        orderBy: { createdAt: 'desc' },
        include: { impactTags: true, audienceGroups: true, targetRoles: true },
      })
    }

    const groupIds = await this.listUserUnitGroupIds(communityId, userId)
    const userRoles = await this.listUserBeRoles(communityId, userId)
    const roleList = Array.from(userRoles)

    const rows = await this.prisma.announcement.findMany({
      where: {
        communityId,
        OR: [
          { audienceType: 'COMMUNITY' },
          {
            audienceType: 'UNIT_GROUP',
            audienceGroups: { some: { unitGroupId: { in: groupIds } } },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { impactTags: true, audienceGroups: true, targetRoles: true },
    })

    return rows.filter((row) => {
      const targets = row.targetRoles.length ? row.targetRoles.map((r) => r.role) : BE_ROLE_TYPES
      return targets.some((role) => roleList.includes(role))
    })
  }

  async getAnnouncement(communityId: string, announcementId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const announcement = await this.prisma.announcement.findFirst({
      where: { id: announcementId, communityId },
      include: { impactTags: true, audienceGroups: true, targetRoles: true },
    })
    if (!announcement) throw new NotFoundException('Announcement not found')

    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (isAdmin) return announcement

    const userRoles = await this.listUserBeRoles(communityId, userId)
    const targets = announcement.targetRoles.length ? announcement.targetRoles.map((r) => r.role) : BE_ROLE_TYPES
    const roleAllowed = targets.some((role) => userRoles.has(role))
    if (!roleAllowed) throw new ForbiddenException('Announcement access denied')

    if (announcement.audienceType === 'COMMUNITY') return announcement

    const groupIds = await this.listUserUnitGroupIds(communityId, userId)
    const allowed = announcement.audienceGroups.some((group) => groupIds.includes(group.unitGroupId))
    if (!allowed) throw new ForbiddenException('Announcement access denied')

    return announcement
  }

  async createAnnouncement(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    this.ensureCommunityAdmin(roles, communityId)

    const title = this.normalizeTitle(input?.title)
    const body = this.normalizeTitle(input?.body, 'body')
    const startsAt = this.parseDate(input?.startsAt, 'startsAt')
    const endsAt = this.parseDate(input?.endsAt, 'endsAt')
    const audienceType = this.parseAudienceType(input?.audienceType)
    const impactTags = this.normalizeImpactTags(input?.impactTags)
    const targetRoles = this.parseTargetRoles(input?.targetRoles)
    const effectiveRoles = targetRoles?.length ? targetRoles : [...BE_ROLE_TYPES]
    const audienceGroupIds = Array.isArray(input?.audienceGroupIds)
      ? input.audienceGroupIds.map((id: any) => String(id))
      : []

    if (audienceType === 'UNIT_GROUP' && audienceGroupIds.length === 0) {
      throw new BadRequestException('Audience groups are required')
    }

    if (audienceGroupIds.length) {
      const groups = await this.prisma.unitGroup.findMany({
        where: { id: { in: audienceGroupIds }, communityId },
        select: { id: true },
      })
      if (groups.length !== new Set(audienceGroupIds).size) {
        throw new BadRequestException('Invalid audience group')
      }
    }

    const announcement = await this.prisma.announcement.create({
      data: {
        communityId,
        title,
        body,
        startsAt,
        endsAt,
        audienceType,
        createdById: userId,
        impactTags: impactTags.length
          ? { create: impactTags.map((tag) => ({ tag: tag as AnnouncementImpactTag })) }
          : undefined,
        targetRoles: effectiveRoles.length ? { create: effectiveRoles.map((role) => ({ role })) } : undefined,
        audienceGroups: audienceGroupIds.length
          ? { create: audienceGroupIds.map((unitGroupId: string) => ({ unitGroupId })) }
          : undefined,
      },
      include: { impactTags: true, audienceGroups: true, targetRoles: true },
    })

    const recipientIds =
      audienceType === 'COMMUNITY'
        ? await this.listCommunityUserIds(communityId, effectiveRoles)
        : await this.listUnitGroupUserIds(communityId, audienceGroupIds, effectiveRoles)

    if (recipientIds.length) {
      await this.notifications.createNotificationsForUsers({
        userIds: recipientIds,
        source: 'COMMUNICATION',
        sourceId: announcement.id,
        title: announcement.title,
        body: announcement.body,
      data: { startsAt: announcement.startsAt, endsAt: announcement.endsAt, impactTags },
    })
    }

    return announcement
  }

  async updateAnnouncement(
    communityId: string,
    announcementId: string,
    _userId: string,
    roles: RoleAssignment[],
    input: any,
  ) {
    this.ensureCommunityAdmin(roles, communityId)

    const existing = await this.prisma.announcement.findFirst({ where: { id: announcementId, communityId } })
    if (!existing) throw new NotFoundException('Announcement not found')

    const data: any = {}
    if (input?.title != null) data.title = this.normalizeTitle(input.title)
    if (input?.body != null) data.body = this.normalizeTitle(input.body, 'body')
    if (input?.startsAt != null) data.startsAt = this.parseDate(input.startsAt, 'startsAt')
    if (input?.endsAt != null) data.endsAt = this.parseDate(input.endsAt, 'endsAt')

    const audienceType = input?.audienceType != null ? this.parseAudienceType(input.audienceType) : null
    if (audienceType) data.audienceType = audienceType

    const impactTags = this.normalizeImpactTags(input?.impactTags)
    const targetRoles = this.parseTargetRoles(input?.targetRoles)
    const audienceGroupIds = Array.isArray(input?.audienceGroupIds)
      ? input.audienceGroupIds.map((id: any) => String(id))
      : null

    if (audienceType === 'UNIT_GROUP' && audienceGroupIds?.length === 0) {
      throw new BadRequestException('Audience groups are required')
    }

    if (audienceGroupIds?.length) {
      const groups = await this.prisma.unitGroup.findMany({
        where: { id: { in: audienceGroupIds }, communityId },
        select: { id: true },
      })
      if (groups.length !== new Set(audienceGroupIds).size) {
        throw new BadRequestException('Invalid audience group')
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id: announcementId },
        data,
        include: { impactTags: true, audienceGroups: true, targetRoles: true },
      })

      if (Array.isArray(input?.impactTags)) {
        await tx.announcementImpactTagMap.deleteMany({ where: { announcementId } })
        if (impactTags.length) {
          await tx.announcementImpactTagMap.createMany({
            data: impactTags.map((tag) => ({ announcementId, tag: tag as AnnouncementImpactTag })),
          })
        }
      }

      if (Array.isArray(input?.audienceGroupIds)) {
        await tx.announcementAudienceGroup.deleteMany({ where: { announcementId } })
        if (audienceGroupIds?.length) {
          await tx.announcementAudienceGroup.createMany({
            data: audienceGroupIds.map((unitGroupId: string) => ({ announcementId, unitGroupId })),
          })
        }
      }

      if (Array.isArray(input?.targetRoles)) {
        await tx.announcementTargetRole.deleteMany({ where: { announcementId } })
        const roles = targetRoles?.length ? targetRoles : [...BE_ROLE_TYPES]
        await tx.announcementTargetRole.createMany({
          data: roles.map((role) => ({ announcementId, role })),
        })
      }

      return updated
    })
  }

  async cancelAnnouncement(communityId: string, announcementId: string, _userId: string, roles: RoleAssignment[]) {
    this.ensureCommunityAdmin(roles, communityId)

    const existing = await this.prisma.announcement.findFirst({ where: { id: announcementId, communityId } })
    if (!existing) throw new NotFoundException('Announcement not found')

    return this.prisma.announcement.update({
      where: { id: announcementId },
      data: { endsAt: new Date() },
      include: { impactTags: true, audienceGroups: true },
    })
  }
}
