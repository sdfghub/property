import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { CommunityService } from './community.service'

@Controller('api/communities')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class CommunityController {
  constructor(private svc: CommunityService) {}

  @Get()
  async list(@Req() req: any) {
    // Support either req.user.id or req.user.sub (depending on your JWT)
    const userId: string = req.user?.id ?? req.user?.sub
    return this.svc.listForUser(userId)
  }
}
