import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { PeriodService } from '../period/period.service'
import { TicketingService } from '../ticketing/ticketing.service'
import { EngagementService } from '../engagement/engagement.service'

@Controller('communities/:communityId/dashboard')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityDashboardController {
  constructor(
    private readonly periods: PeriodService,
    private readonly tickets: TicketingService,
    private readonly engagement: EngagementService,
  ) {}

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get()
  async get(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    const roles = req.user?.roles ?? []
    const [editable, closed, ticketList, events, polls] = await Promise.all([
      this.periods.getEditable(communityId),
      this.periods.listClosed(communityId),
      this.tickets.listTickets(communityId, userId, roles),
      this.engagement.listEvents(communityId, userId, roles),
      this.engagement.listPolls(communityId, userId, roles),
    ])

    const activeStatuses = new Set(['NEW', 'IN_PROGRESS', 'REOPENED'])
    const tasks = (ticketList || [])
      .filter((ticket: any) => ticket.type === 'TASK' && activeStatuses.has(ticket.status))
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 4)
    const incidents = (ticketList || [])
      .filter((ticket: any) => ticket.type === 'INCIDENT' && activeStatuses.has(ticket.status))
      .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 4)

    const now = Date.now()
    const upcomingEvents = (events || [])
      .filter((event: any) => new Date(event.endAt).getTime() >= now)
      .sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 4)

    const ongoingPolls = (polls || [])
      .filter((poll: any) => {
        const startAt = new Date(poll.startAt).getTime()
        const endAt = new Date(poll.endAt).getTime()
        return poll.status === 'APPROVED' && !poll.closedAt && now >= startAt && now <= endAt
      })
      .slice(0, 4)

    return {
      currentPeriod: editable ?? null,
      lastClosedPeriod: Array.isArray(closed) && closed.length ? closed[0] : null,
      tasks,
      incidents,
      upcomingEvents,
      ongoingPolls,
    }
  }
}
