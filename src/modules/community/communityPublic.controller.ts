import { Controller, Get } from '@nestjs/common'
import { CommunityService } from './community.service'

// Public endpoints (no auth) to support demo/preview.
@Controller('communities/public')
export class CommunityPublicController {
  constructor(private svc: CommunityService) {}

  @Get()
  async listAll() {
    return this.svc.listAll()
  }
}
