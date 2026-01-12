import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { EngagementService } from './engagement.service'

@Controller('communities/:communityId/polls')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PollsController {
  constructor(private readonly svc: EngagementService) {}

  @Get()
  list(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listPolls(communityId, userId, req.user?.roles ?? [])
  }

  @Get(':pollId')
  get(@Param('communityId') communityId: string, @Param('pollId') pollId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.getPoll(communityId, pollId, userId, req.user?.roles ?? [])
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createPoll(communityId, userId, req.user?.roles ?? [], body)
  }

  @Patch(':pollId')
  update(
    @Param('communityId') communityId: string,
    @Param('pollId') pollId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.updatePoll(communityId, pollId, userId, req.user?.roles ?? [], body)
  }

  @Post(':pollId/approve')
  approve(@Param('communityId') communityId: string, @Param('pollId') pollId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.approvePoll(communityId, pollId, userId, req.user?.roles ?? [])
  }

  @Post(':pollId/reject')
  reject(
    @Param('communityId') communityId: string,
    @Param('pollId') pollId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.rejectPoll(communityId, pollId, userId, req.user?.roles ?? [], body)
  }

  @Post(':pollId/close')
  close(@Param('communityId') communityId: string, @Param('pollId') pollId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.closePoll(communityId, pollId, userId, req.user?.roles ?? [])
  }

  @Post(':pollId/publish-results')
  publishResults(@Param('communityId') communityId: string, @Param('pollId') pollId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.publishPollResults(communityId, pollId, userId, req.user?.roles ?? [])
  }

  @Post(':pollId/vote')
  vote(
    @Param('communityId') communityId: string,
    @Param('pollId') pollId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.votePoll(communityId, pollId, userId, req.user?.roles ?? [], body)
  }
}
