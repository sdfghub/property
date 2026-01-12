import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { TicketTag } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { TicketingService } from '../ticketing/ticketing.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

const TICKET_TAGS = new Set([
  'OUTAGE',
  'BREAKDOWN',
  'LEAK',
  'SAFETY',
  'SECURITY',
  'COMPLAINT',
  'ACCESS',
  'NOISE',
  'CLEANLINESS',
  'DAMAGE',
  'PREVENTIVE_MAINTENANCE',
  'INSPECTION',
  'REPAIR',
  'UPGRADE',
  'CLEANING',
  'VENDOR_VISIT',
  'COMPLIANCE',
  'METER_READING',
])

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService, private readonly ticketing: TicketingService) {}

  private isCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    return roles.some(
      (r) => r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId === communityId,
    )
  }

  private ensureCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    if (this.isCommunityAdmin(roles, communityId)) return
    throw new ForbiddenException('Admin permissions required')
  }

  private normalizeName(raw: any, field = 'name') {
    const value = String(raw ?? '').trim()
    if (!value) throw new BadRequestException(`${field} is required`)
    return value
  }

  private normalizeTags(raw: any) {
    if (!Array.isArray(raw)) return []
    const tags = raw
      .map((tag) => String(tag ?? '').toUpperCase())
      .filter((tag) => TICKET_TAGS.has(tag))
    return Array.from(new Set(tags))
  }

  private parseIntervalDays(raw: any) {
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('intervalDays must be a positive number')
    }
    return Math.floor(value)
  }

  private parseDate(raw: any, field: string) {
    if (!raw) throw new BadRequestException(`${field} is required`)
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) throw new BadRequestException(`${field} must be a valid date`)
    return dt
  }

  async listAssets(communityId: string, _userId: string, roles: RoleAssignment[]) {
    this.ensureCommunityAdmin(roles, communityId)
    return this.prisma.inventoryAsset.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
      include: { rules: { include: { tags: true } } },
    })
  }

  async createAsset(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    this.ensureCommunityAdmin(roles, communityId)
    const name = this.normalizeName(input?.name)
    const description = input?.description ? String(input.description) : null
    const metadata = input?.metadata && typeof input.metadata === 'object' ? input.metadata : null

    return this.prisma.inventoryAsset.create({
      data: {
        communityId,
        name,
        description,
        metadata,
        createdById: userId,
      },
    })
  }

  async listRules(communityId: string, _userId: string, roles: RoleAssignment[]) {
    this.ensureCommunityAdmin(roles, communityId)
    return this.prisma.inventoryMaintenanceRule.findMany({
      where: { asset: { communityId } },
      orderBy: { nextDueAt: 'asc' },
      include: { asset: true, tags: true },
    })
  }

  async createRule(communityId: string, assetId: string, userId: string, roles: RoleAssignment[], input: any) {
    this.ensureCommunityAdmin(roles, communityId)
    const asset = await this.prisma.inventoryAsset.findFirst({ where: { id: assetId, communityId } })
    if (!asset) throw new NotFoundException('Asset not found')

    const title = this.normalizeName(input?.title, 'title')
    const description = input?.description ? String(input.description) : null
    const intervalDays = this.parseIntervalDays(input?.intervalDays)
    const nextDueAt = this.parseDate(input?.nextDueAt, 'nextDueAt')
    const tags = this.normalizeTags(input?.tags)

    return this.prisma.inventoryMaintenanceRule.create({
      data: {
        assetId,
        title,
        description,
        intervalDays,
        nextDueAt,
        enabled: input?.enabled == null ? true : !!input.enabled,
        createdById: userId,
        tags: tags.length ? { create: tags.map((tag) => ({ tag: tag as TicketTag })) } : undefined,
      },
      include: { tags: true, asset: true },
    })
  }

  async runRule(communityId: string, ruleId: string, userId: string, roles: RoleAssignment[], input: any) {
    this.ensureCommunityAdmin(roles, communityId)

    const rule = await this.prisma.inventoryMaintenanceRule.findFirst({
      where: { id: ruleId, asset: { communityId }, enabled: true },
      include: { tags: true, asset: true },
    })
    if (!rule) throw new NotFoundException('Rule not found')

    const title = input?.title ? String(input.title) : rule.title
    const description = input?.description ? String(input.description) : rule.description
    const tags = rule.tags.map((tag) => tag.tag)

    const ticket = await this.ticketing.createTicket(communityId, userId, roles, {
      type: 'TASK',
      title: `${rule.asset.name}: ${title}`,
      description,
      tags,
    })

    const nextDueAt = new Date(rule.nextDueAt)
    nextDueAt.setDate(nextDueAt.getDate() + rule.intervalDays)

    await this.prisma.inventoryMaintenanceRule.update({
      where: { id: rule.id },
      data: { nextDueAt },
    })

    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { sourceInventoryRuleId: rule.id },
    })

    return { ticketId: ticket.id, nextDueAt }
  }
}
