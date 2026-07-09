import { Controller, Param, Post, UseGuards, Req, ForbiddenException } from '@nestjs/common'
import { Body } from '@nestjs/common'
import { PeriodService } from './period.service'
import { FeaturesService } from '../features/features.service'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Get } from '@nestjs/common'

/** When the cenzor feature is ON, only the cenzor (or system admin) may approve/reject the
 *  close; when it's OFF, the community admin signs off. Respects the "act as" active role. */
async function ensureCanSignOff(features: FeaturesService, communityId: string, req: any) {
  if (!(await features.isEnabled(communityId, 'cenzor'))) return
  const roles: Array<{ role: string; scopeType: string; scopeId?: string | null }> = req?.user?.roles ?? []
  const active = req?.headers?.['x-active-role']
  const scopeId = req?.headers?.['x-active-scope-id'] ?? ''
  let eff = roles
  if (active) {
    const m = roles.filter((r) => r.role === active && (r.scopeId ?? '') === scopeId)
    if (m.length) eff = m
  }
  const ok =
    eff.some((r) => r.role === 'SYSTEM_ADMIN') ||
    eff.some((r) => r.role === 'CENSOR' && r.scopeType === 'COMMUNITY' && r.scopeId === communityId)
  if (!ok) throw new ForbiddenException('Sign-off requires the cenzor')
}

@Controller('communities/:communityId/periods/:periodCode')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class PeriodController {
  constructor(private readonly periods: PeriodService, private readonly features: FeaturesService) {}

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('prepare')
  prepare(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.prepare(c, p)
  }

  @Scopes({ role: ['CENSOR', 'COMMUNITY_ADMIN'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('approve')
  async approve(@Param('communityId') c: string, @Param('periodCode') p: string, @Req() req: any) {
    await ensureCanSignOff(this.features, c, req)
    return this.periods.approve(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('recompute')
  recompute(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.recompute(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('due-date')
  setDueDate(@Param('communityId') c: string, @Param('periodCode') p: string, @Body() body: any) {
    return this.periods.setDueDate(c, p, body?.dueDate ?? null)
  }

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('summary')
  summary(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.summary(c, p)
  }

  // Per-period settings: due date + per-fund penalty rate + community grace days.
  // Admin edits; cenzor/CEX may only view.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('settings')
  getSettings(@Param('communityId') c: string, @Param('periodCode') p: string) {
    return this.periods.getSettings(c, p)
  }

  @Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('settings')
  setSettings(@Param('communityId') c: string, @Param('periodCode') p: string, @Body() body: any) {
    return this.periods.setSettings(c, p, body || {})
  }

  @Scopes({ role: ['CENSOR', 'COMMUNITY_ADMIN'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Post('reject')
  async reject(@Param('communityId') c: string, @Param('periodCode') p: string, @Req() req: any) {
    await ensureCanSignOff(this.features, c, req)
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

  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
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
