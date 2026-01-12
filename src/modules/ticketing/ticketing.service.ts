import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { TicketStatus, TicketTag } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

const TICKET_TYPES = new Set(['INCIDENT', 'TASK'])
const TICKET_STATUSES = new Set(['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELED', 'REOPENED'])
const TICKET_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH'])
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
export class TicketingService {
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

  private parseTicketType(raw: any) {
    const value = String(raw ?? '').toUpperCase()
    if (!TICKET_TYPES.has(value)) throw new BadRequestException('Invalid ticket type')
    return value
  }

  private parseTicketStatus(raw: any) {
    const value = String(raw ?? '').toUpperCase()
    if (!TICKET_STATUSES.has(value)) throw new BadRequestException('Invalid ticket status')
    return value
  }

  private parseTicketPriority(raw: any) {
    if (!raw) return 'MEDIUM'
    const value = String(raw ?? '').toUpperCase()
    if (!TICKET_PRIORITIES.has(value)) throw new BadRequestException('Invalid priority')
    return value
  }

  private normalizeTags(raw: any) {
    if (!Array.isArray(raw)) return []
    const tags = raw
      .map((tag) => String(tag ?? '').toUpperCase())
      .filter((tag) => TICKET_TAGS.has(tag))
    return Array.from(new Set(tags)) as TicketTag[]
  }

  async listTickets(communityId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const isAdmin = this.isCommunityAdmin(roles, communityId)
    return this.prisma.ticket.findMany({
      where: isAdmin ? { communityId } : { communityId, createdById: userId },
      orderBy: { createdAt: 'desc' },
      include: { tags: true, assignee: { select: { id: true, name: true, email: true } } },
    })
  }

  async getTicket(communityId: string, ticketId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, communityId },
      include: { tags: true, events: true, assignee: { select: { id: true, name: true, email: true } } },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && ticket.createdById !== userId) {
      throw new ForbiddenException('Ticket access denied')
    }
    return ticket
  }

  async createTicket(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const type = this.parseTicketType(input?.type)
    const title = this.normalizeTitle(input?.title)
    const description = input?.description ? String(input.description) : null
    const priority = this.parseTicketPriority(input?.priority)
    const tags = this.normalizeTags(input?.tags)

    const assigneeId = input?.assigneeId ? String(input.assigneeId) : null
    const data: any = {
      communityId,
      type,
      title,
      description,
      priority,
      createdById: userId,
        tags: tags.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
    }

    if (assigneeId && this.isCommunityAdmin(roles, communityId)) {
      data.assigneeId = assigneeId
    }

    const ticket = await this.prisma.ticket.create({
      data,
      include: { tags: true, assignee: { select: { id: true, name: true, email: true } } },
    })

    if (assigneeId && this.isCommunityAdmin(roles, communityId)) {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: userId,
          type: 'ASSIGNMENT',
          metadata: { assigneeId },
        },
      })
    }

    if (tags.length) {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: userId,
          type: 'TAGS_UPDATED',
          metadata: { tags },
        },
      })
    }

    if (assigneeId && assigneeId !== userId) {
      await this.notifications.createNotificationsForUsers({
        userIds: [assigneeId],
        source: 'TICKET',
        sourceId: ticket.id,
        title: `New ticket: ${ticket.title}`,
        body: ticket.description || 'A ticket was assigned to you.',
      })
    }

    return ticket
  }

  async updateTicket(communityId: string, ticketId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, communityId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && ticket.createdById !== userId) {
      throw new ForbiddenException('Ticket access denied')
    }

    const data: any = {}
    if (input?.title != null) data.title = this.normalizeTitle(input.title)
    if (input?.description != null) data.description = String(input.description)
    if (input?.priority != null) data.priority = this.parseTicketPriority(input.priority)

    const tags = this.normalizeTags(input?.tags)
    const assigneeId = input?.assigneeId ? String(input.assigneeId) : null

    if (assigneeId && isAdmin) {
      data.assigneeId = assigneeId
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data,
        include: { tags: true, assignee: { select: { id: true, name: true, email: true } } },
      })

      if (Array.isArray(input?.tags)) {
        await tx.ticketTagMap.deleteMany({ where: { ticketId } })
        if (tags.length) {
          await tx.ticketTagMap.createMany({ data: tags.map((tag) => ({ ticketId, tag: tag as TicketTag })) })
        }
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: userId,
            type: 'TAGS_UPDATED',
            metadata: { tags },
          },
        })
      }

      if (assigneeId && isAdmin) {
        await tx.ticketEvent.create({
          data: {
            ticketId,
            actorId: userId,
            type: 'ASSIGNMENT',
            metadata: { assigneeId },
          },
        })
      }

      return updated
    })

    return result
  }

  async changeStatus(communityId: string, ticketId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, communityId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && ticket.createdById !== userId) {
      throw new ForbiddenException('Ticket access denied')
    }

    const status = this.parseTicketStatus(input?.status) as TicketStatus
    const comment = input?.comment ? String(input.comment) : null

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status },
    })

    await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        actorId: userId,
        type: 'STATUS_CHANGE',
        comment,
        metadata: { from: ticket.status, to: status },
      },
    })

    const recipients = [ticket.createdById, ticket.assigneeId].filter(
      (id): id is string => !!id && id !== userId,
    )
    if (recipients.length) {
      await this.notifications.createNotificationsForUsers({
        userIds: recipients,
        source: 'TICKET',
        sourceId: ticket.id,
        title: `Ticket ${ticket.title} updated`,
        body: `Status changed to ${status}.`,
      })
    }

    return updated
  }

  async addComment(communityId: string, ticketId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, communityId } })
    if (!ticket) throw new NotFoundException('Ticket not found')

    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && ticket.createdById !== userId) {
      throw new ForbiddenException('Ticket access denied')
    }

    const comment = String(input?.comment ?? '').trim()
    if (!comment) throw new BadRequestException('Comment is required')

    const event = await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        actorId: userId,
        type: 'COMMENT',
        comment,
      },
    })

    const recipients = [ticket.createdById, ticket.assigneeId].filter(
      (id): id is string => !!id && id !== userId,
    )
    if (recipients.length) {
      await this.notifications.createNotificationsForUsers({
        userIds: recipients,
        source: 'TICKET',
        sourceId: ticket.id,
        title: `New comment on ${ticket.title}`,
        body: comment,
      })
    }

    return event
  }
}
