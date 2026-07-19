import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { COMMUNITY_METADATA } from '../../common/enums-meta'

// Static reference data (fixed system taxonomies + their labels), identical for every
// community. Any authenticated user may read it.
@Controller('metadata')
@UseGuards(JwtAuthGuard)
export class MetadataController {
  @Get()
  get() {
    return COMMUNITY_METADATA
  }
}
