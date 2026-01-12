import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Req() req: any, @Query('limit') limit?: string, @Query('unread') unread?: string) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listNotifications(userId, {
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unread === 'true',
    })
  }

  @Post(':notificationId/read')
  markRead(@Param('notificationId') notificationId: string, @Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.markRead(userId, notificationId)
  }
}
