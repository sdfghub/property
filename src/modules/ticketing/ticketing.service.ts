import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { TicketStatus, TicketTag } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { INCIDENT_SERVICE_ACTION_META, metaKeys } from '../../common/enums-meta'
import { SERVICE_STATUSES, equipmentDefsOf } from '../services/services.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

const TICKET_TYPES = new Set(['INCIDENT', 'TASK', 'REQUEST'])
const TICKET_STATUSES = new Set(['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELED', 'REOPENED'])
const TICKET_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH'])
const TICKET_IMPACTS = new Set([
  'NUMAR_PERSOANE', 'PROPRIETAR', 'CHIRIAS', 'SERVICII', 'INFORMATII', 'ADEVERINTA', 'LUCRARI_TEHNICE',
])
const TICKET_REQUEST_KINDS = new Set(['SCHIMBARE', 'DEFECTIUNE', 'ACORD', 'ALTELE'])
const INCIDENT_ACTIONS = new Set(metaKeys(INCIDENT_SERVICE_ACTION_META))
const STATUS_VALUE = new Map(SERVICE_STATUSES.map((st) => [st.code as string, st.value]))
/** Short unit label from its code: "400191-C1-U7-AP 6" → "AP 6". */
const unitShort = (code: string) => code.split('-').slice(3).join('-') || code

const TICKET_INCLUDE = {
  tags: true,
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  serviceItem: { select: { id: true, name: true, domain: true, status: true } },
  reporterUnit: { select: { id: true, code: true } },
} as const

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

  private isCommunityOversight(roles: RoleAssignment[], communityId: string) {
    return roles.some(
      (r) =>
        (r.role === 'CENSOR' || r.role === 'EXECUTIVE_COMITEE_MEMBER') &&
        r.scopeType === 'COMMUNITY' &&
        r.scopeId === communityId,
    )
  }

  private async ensureCommunityMember(userId: string, roles: RoleAssignment[], communityId: string) {
    if (this.isCommunityAdmin(roles, communityId)) return
    if (this.isCommunityOversight(roles, communityId)) return
    if (await this.isCommunityMember(userId, communityId)) return
    throw new ForbiddenException('Not a community member')
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

  /** Only meaningful for REQUEST tickets — null for TASK/INCIDENT. */
  private parseImpact(raw: any) {
    if (raw == null) return null
    const value = String(raw).toUpperCase()
    if (!TICKET_IMPACTS.has(value)) throw new BadRequestException('Invalid impact')
    return value
  }

  private parseRequestKind(raw: any) {
    if (raw == null) return null
    const value = String(raw).toUpperCase()
    if (!TICKET_REQUEST_KINDS.has(value)) throw new BadRequestException('Invalid request kind')
    return value
  }

  private normalizeTags(raw: any) {
    if (!Array.isArray(raw)) return []
    const tags = raw
      .map((tag) => String(tag ?? '').toUpperCase())
      .filter((tag) => TICKET_TAGS.has(tag))
    return Array.from(new Set(tags)) as TicketTag[]
  }

  async listTickets(communityId: string, userId: string, roles: RoleAssignment[], filters?: { type?: string }) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const isAdmin = this.isCommunityAdmin(roles, communityId)
    const type = filters?.type ? this.parseTicketType(filters.type) : undefined
    return this.prisma.ticket.findMany({
      where: {
        communityId,
        ...(isAdmin ? {} : { createdById: userId }),
        ...(type ? { type: type as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: TICKET_INCLUDE,
    }).then((rows) => this.withAffectedUnits(rows))
  }

  /** Incidents scoped to an equipment get the units that have it (matching variant, if set). */
  private async withAffectedUnits<T extends { serviceItemId: string | null; equipmentName: string | null; equipmentVariant: string | null }>(rows: T[]) {
    const scoped = rows.filter((r) => r.serviceItemId && r.equipmentName)
    if (!scoped.length) return rows.map((r) => ({ ...r, affectedUnits: [] as Array<{ id: string; label: string }> }))
    const eq = await this.prisma.unitEquipment.findMany({
      where: { serviceItemId: { in: [...new Set(scoped.map((r) => r.serviceItemId!))] } },
      include: { unit: { select: { id: true, code: true, order: true } } },
      orderBy: { unit: { order: 'asc' } },
    })
    return rows.map((r) => ({
      ...r,
      affectedUnits: r.serviceItemId && r.equipmentName
        ? eq.filter((e) => e.serviceItemId === r.serviceItemId && e.name === r.equipmentName && (!r.equipmentVariant || e.variant === r.equipmentVariant))
          .map((e) => ({ id: e.unit.id, label: unitShort(e.unit.code) }))
        : [],
    }))
  }

  /**
   * Units of the community with the reporter details to prefill an incident's "Raportat de":
   * the current owner (billing entity) and the contact of its linked user or tenant.
   */
  async listReporters(communityId: string) {
    const units = await this.prisma.unit.findMany({
      where: { communityId },
      orderBy: { order: 'asc' },
      select: {
        id: true, code: true, name: true,
        propertyManagerName: true, propertyManagerPhone: true, propertyManagerEmail: true,
        tenants: { select: { name: true, phone: true, email: true }, take: 1 },
        BillingEntityMember: {
          where: { endPeriodId: null },
          select: { billingEntity: { select: { name: true, displayName: true, primaryOwnerName: true, userRoles: { select: { role: true, user: { select: { name: true, email: true } } } } } } },
          take: 1,
        },
      },
    })
    return units.map((u) => {
      const be = u.BillingEntityMember[0]?.billingEntity
      const owner = be?.userRoles.find((r) => r.role === 'OWNER')?.user ?? be?.userRoles[0]?.user
      const tenant = u.tenants[0]
      return {
        id: u.id,
        label: u.name || unitShort(u.code),
        name: be?.primaryOwnerName || be?.name || owner?.name || tenant?.name || u.propertyManagerName || null,
        email: owner?.email || tenant?.email || u.propertyManagerEmail || null,
        phone: tenant?.phone || u.propertyManagerPhone || null,
      }
    })
  }

  /** The creator's own unit (a resident reporting for their home), for when none is given. */
  private async ownUnitOf(userId: string, communityId: string) {
    const role = await this.prisma.billingEntityUserRole.findFirst({
      where: { userId, billingEntity: { communityId } },
      select: { user: { select: { name: true, email: true } }, billingEntity: { select: { members: { where: { endPeriodId: null }, select: { unitId: true }, take: 1 } } } },
    })
    const unitId = role?.billingEntity.members[0]?.unitId
    return unitId ? { unitId, name: role!.user.name, email: role!.user.email } : null
  }

  private text(raw: any): string | null {
    const v = String(raw ?? '').trim()
    return v ? v : null
  }

  /** Validates and returns the INCIDENT-only fields present in `input` (service, action, scope, reporter). */
  private async incidentFields(communityId: string, input: any, current?: { serviceItemId: string | null }) {
    const out: Record<string, any> = {}
    if ('serviceItemId' in (input ?? {})) {
      const id = this.text(input.serviceItemId)
      if (id) {
        const item = await this.prisma.serviceItem.findFirst({ where: { id, communityId }, select: { id: true } })
        if (!item) throw new BadRequestException('Unknown service')
      }
      out.serviceItemId = id
    }
    if ('serviceStatus' in (input ?? {})) {
      const v = this.text(input.serviceStatus)?.toUpperCase() ?? null
      if (v && !INCIDENT_ACTIONS.has(v)) throw new BadRequestException('Invalid service action')
      out.serviceStatus = v
    }
    const serviceItemId = 'serviceItemId' in out ? out.serviceItemId : current?.serviceItemId ?? null
    if ('equipmentName' in (input ?? {}) || 'equipmentVariant' in (input ?? {})) {
      const name = this.text(input.equipmentName)
      const variant = name ? this.text(input.equipmentVariant) : null
      if (name) {
        if (!serviceItemId) throw new BadRequestException('Equipment needs a service')
        const item = await this.prisma.serviceItem.findUnique({ where: { id: serviceItemId }, select: { equipmentDefs: true } })
        const def = equipmentDefsOf(item?.equipmentDefs).find((d) => d.name === name)
        if (!def) throw new BadRequestException('Unknown equipment for this service')
        if (variant && !def.variants.includes(variant)) throw new BadRequestException('Unknown equipment variant')
      }
      out.equipmentName = name
      out.equipmentVariant = variant
    } else if ('serviceItemId' in out && out.serviceItemId !== (current?.serviceItemId ?? null)) {
      out.equipmentName = null
      out.equipmentVariant = null
    }
    if ('reporterUnitId' in (input ?? {})) {
      const id = this.text(input.reporterUnitId)
      if (id) {
        const unit = await this.prisma.unit.findFirst({ where: { id, communityId }, select: { id: true } })
        if (!unit) throw new BadRequestException('Unknown reporter unit')
      }
      out.reporterUnitId = id
    }
    for (const k of ['reporterName', 'reporterPhone', 'reporterEmail'] as const) if (k in (input ?? {})) out[k] = this.text(input[k])
    return out
  }

  /** An incident's action lowers the service's status when it is worse (history row included). */
  private async applyServiceStatus(serviceItemId: string | null, action: string | null, userId: string) {
    if (!serviceItemId || !action) return
    const item = await this.prisma.serviceItem.findUnique({ where: { id: serviceItemId } })
    if (!item) return
    const cur = item.status ? STATUS_VALUE.get(item.status) : undefined
    // Only a service that works (0–3) is lowered; Indisponibil/Oprit stay as set by the admin.
    if (cur != null && (cur < 0 || cur <= STATUS_VALUE.get(action)!)) return
    await this.prisma.$transaction([
      this.prisma.serviceItem.update({ where: { id: serviceItemId }, data: { status: action as any } }),
      this.prisma.serviceAssessment.create({
        data: { serviceItemId, assessedById: userId, level: item.level, comment: item.comment, actions: item.actions, workStatus: item.workStatus, priority: item.priority, status: action as any },
      }),
    ])
  }


  async getTicket(communityId: string, ticketId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, communityId },
      include: { ...TICKET_INCLUDE, events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, name: true, email: true } } } } },
    })
    if (!ticket) throw new NotFoundException('Ticket not found')
    const isAdmin = this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && ticket.createdById !== userId) {
      throw new ForbiddenException('Ticket access denied')
    }
    return (await this.withAffectedUnits([ticket]))[0]
  }

  async createTicket(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const type = this.parseTicketType(input?.type)
    const title = this.normalizeTitle(input?.title)
    const description = input?.description ? String(input.description) : null
    const priority = this.parseTicketPriority(input?.priority)
    const tags = this.normalizeTags(input?.tags)
    const impact = type === 'REQUEST' ? this.parseImpact(input?.impact) : null
    const requestKind = type === 'REQUEST' ? this.parseRequestKind(input?.requestKind) : null

    const assigneeId = input?.assigneeId ? String(input.assigneeId) : null
    const data: any = {
      communityId,
      type,
      title,
      description,
      priority,
      impact,
      requestKind,
      createdById: userId,
        tags: tags.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
    }
    if (type === 'INCIDENT') {
      Object.assign(data, await this.incidentFields(communityId, input))
      // No reporter given: the creator reports for their own unit (residents), with their contact.
      if (!data.reporterUnitId) {
        const own = await this.ownUnitOf(userId, communityId)
        if (own) {
          data.reporterUnitId = own.unitId
          data.reporterName = data.reporterName ?? own.name
          data.reporterEmail = data.reporterEmail ?? own.email
        }
      }
    }

    if (assigneeId && this.isCommunityAdmin(roles, communityId)) {
      data.assigneeId = assigneeId
    }

    const ticket = await this.prisma.ticket.create({ data, include: TICKET_INCLUDE })
    if (type === 'INCIDENT') await this.applyServiceStatus(ticket.serviceItemId, ticket.serviceStatus, userId)

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
    if (ticket.type === 'REQUEST') {
      if (input?.impact != null) data.impact = this.parseImpact(input.impact)
      if (input?.requestKind != null) data.requestKind = this.parseRequestKind(input.requestKind)
    }
    if (ticket.type === 'INCIDENT') Object.assign(data, await this.incidentFields(communityId, input, ticket))

    const tags = this.normalizeTags(input?.tags)
    const assigneeId = input?.assigneeId ? String(input.assigneeId) : null

    if (assigneeId && isAdmin) {
      data.assigneeId = assigneeId
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({ where: { id: ticketId }, data, include: TICKET_INCLUDE })

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
    if (result.type === 'INCIDENT' && (data.serviceStatus || data.serviceItemId)) {
      await this.applyServiceStatus(result.serviceItemId, result.serviceStatus, userId)
    }
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
