import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { EngagementService } from './engagement.service'

@Controller('communities/:communityId/events')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class EventsController {
  constructor(private readonly svc: EngagementService) {}

  @Get()
  list(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listEvents(communityId, userId, req.user?.roles ?? [])
  }

  @Get(':eventId')
  get(@Param('communityId') communityId: string, @Param('eventId') eventId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.getEvent(communityId, eventId, userId, req.user?.roles ?? [])
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createEvent(communityId, userId, req.user?.roles ?? [], body)
  }

  @Patch(':eventId')
  update(
    @Param('communityId') communityId: string,
    @Param('eventId') eventId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.updateEvent(communityId, eventId, userId, req.user?.roles ?? [], body)
  }

  @Delete(':eventId')
  remove(@Param('communityId') communityId: string, @Param('eventId') eventId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.deleteEvent(communityId, eventId, userId, req.user?.roles ?? [])
  }

  @Post(':eventId/rsvp')
  rsvp(@Param('communityId') communityId: string, @Param('eventId') eventId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.setEventRsvp(communityId, eventId, userId, req.user?.roles ?? [], body)
  }
}
