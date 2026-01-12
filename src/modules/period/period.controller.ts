import { Controller, Param, Post, UseGuards } from '@nestjs/common'
import { Body } from '@nestjs/common'
import { PeriodService } from './period.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Get } from '@nestjs/common'

@Controller('communities/:communityId/periods/:periodCode')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PeriodController {
  constructor(private readonly periods: PeriodService) {}

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('prepare')
  prepare(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.prepare(c, p)
  }

  @Scopes({ role: 'CENSOR', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('approve')
  approve(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.approve(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('recompute')
  recompute(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.recompute(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('summary')
  summary(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.summary(c, p)
  }

  @Scopes({ role: 'CENSOR', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reject')
  reject(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.reject(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reopen')
  reopen(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.reopen(c, p)
  }
}

@Controller('communities/:communityId/periods')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PeriodQueryController {
  constructor(private readonly periods: PeriodService) {}

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('editable')
  editable(@Param('communityId') c: string) {
    return this.periods.getEditable(c)
  }

  @Get()
  listAll(@Param('communityId') c: string) {
    return this.periods.listAll(c)
  }

  @Get('closed')
  listClosed(@Param('communityId') c: string) {
    return this.periods.listClosed(c)
  }

  @Get('open')
  listOpen(@Param('communityId') c: string) {
    return this.periods.listOpenOrDraft(c)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('create')
  create(@Param('communityId') c: string, @Body() body: any) {
    return this.periods.createNext(c, body?.code)
  }
}
