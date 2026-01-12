import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { NotificationsJobsService } from './notifications-jobs.service'

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class NotificationsJobsController {
  constructor(private readonly jobs: NotificationsJobsService) {}

  private isCommunityAdmin(roles: Array<{ role: string }>) {
    return roles.some((r) => r.role === 'COMMUNITY_ADMIN')
  }

  @Post('process-deliveries')
  process(@Req() req: any, @Body() body: any) {
    const roles = Array.isArray(req.user?.roles) ? req.user.roles : []
    if (!this.isCommunityAdmin(roles)) {
      throw new ForbiddenException('Admin permissions required')
    }
    const limit = body?.limit ? Number(body.limit) : undefined
    return this.jobs.processPendingDeliveries(limit)
  }
}
