import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { CommunicationsService } from './communications.service'

@Controller('communities/:communityId/announcements')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunicationsController {
  constructor(private readonly svc: CommunicationsService) {}

  @Get()
  list(@Param('communityId') communityId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listAnnouncements(communityId, userId, req.user?.roles ?? [])
  }

  @Get(':announcementId')
  get(
    @Param('communityId') communityId: string,
    @Param('announcementId') announcementId: string,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.getAnnouncement(communityId, announcementId, userId, req.user?.roles ?? [])
  }

  @Post()
  create(@Param('communityId') communityId: string, @Body() body: any, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.createAnnouncement(communityId, userId, req.user?.roles ?? [], body)
  }

  @Patch(':announcementId')
  update(
    @Param('communityId') communityId: string,
    @Param('announcementId') announcementId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.updateAnnouncement(communityId, announcementId, userId, req.user?.roles ?? [], body)
  }

  @Post(':announcementId/cancel')
  cancel(
    @Param('communityId') communityId: string,
    @Param('announcementId') announcementId: string,
    @Req() req: any,
  ) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.cancelAnnouncement(communityId, announcementId, userId, req.user?.roles ?? [])
  }
}
