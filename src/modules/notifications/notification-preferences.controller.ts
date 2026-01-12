import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { NotificationsService } from './notifications.service'

@Controller('notification-preferences')
@UseGuards(JwtAuthGuard)
export class NotificationPreferencesController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Req() req: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listPreferences(userId)
  }

  @Patch()
  update(@Req() req: any, @Body() body: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.updatePreferences(userId, body)
  }
}
