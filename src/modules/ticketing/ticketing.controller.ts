import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { TicketingService } from './ticketing.service'

@Controller('communities/:communityId/tickets')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class TicketingController {
  constructor(private readonly svc: TicketingService) {}

  @Get()
  list(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listTickets(communityId, userId, req.user?.roles ?? [])
  }

  @Get(':ticketId')
  get(@Param('communityId') communityId: string, @Param('ticketId') ticketId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.getTicket(communityId, ticketId, userId, req.user?.roles ?? [])
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createTicket(communityId, userId, req.user?.roles ?? [], body)
  }

  @Patch(':ticketId')
  update(
    @Param('communityId') communityId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.updateTicket(communityId, ticketId, userId, req.user?.roles ?? [], body)
  }

  @Post(':ticketId/status')
  changeStatus(
    @Param('communityId') communityId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.changeStatus(communityId, ticketId, userId, req.user?.roles ?? [], body)
  }

  @Post(':ticketId/comments')
  addComment(
    @Param('communityId') communityId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.addComment(communityId, ticketId, userId, req.user?.roles ?? [], body)
  }
}
