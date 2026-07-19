import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { PrismaService } from '../user/prisma.service'

@Controller('communities/:communityId')
@UseGuards(JwtAuthGuard, ScopesGuard)
@Scopes({ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeParam: 'communityId' })
export class CommunityStructureController {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCommunity(communityId: string) {
    const community = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { id: true, code: true },
    })
    if (!community) {
      throw new NotFoundException('Community not found')
    }
    return community
  }

  private async resolvePeriod(communityId: string, periodCode: string) {
    const period = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: periodCode } },
      select: { id: true, seq: true, code: true },
    })
    if (!period) {
      throw new NotFoundException(`Period ${periodCode} not found`)
    }
    return period
  }

  @Get('units')
  async listUnits(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.unit.findMany({
      where: { communityId: community.id },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
  }

  @Post('units')
  async createUnit(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const code = String(body?.code || '').trim()
    if (!code) throw new BadRequestException('unit.code is required')
    const order = Number(body?.order ?? 0)
    const existing = await this.prisma.unit.findUnique({
      where: { code_communityId: { code, communityId: community.id } },
    })
    if (existing) return { ok: true, created: false, unit: existing }
    const unit = await this.prisma.unit.create({
      data: { communityId: community.id, code, order: Number.isFinite(order) ? order : 0 },
    })
    return { ok: true, created: true, unit }
  }

  @Get('unit-groups')
  async listUnitGroups(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.unitGroup.findMany({
      where: { communityId: community.id },
      orderBy: { code: 'asc' },
    })
  }

  @Post('unit-groups')
  async createUnitGroup(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const code = String(body?.code || '').trim()
    const name = String(body?.name || '').trim()
    if (!code || !name) throw new BadRequestException('unit-group code and name are required')
    const existing = await this.prisma.unitGroup.findUnique({
      where: { code_communityId: { code, communityId: community.id } },
    })
    if (existing) return { ok: true, created: false, unitGroup: existing }
    const unitGroup = await this.prisma.unitGroup.create({
      data: { communityId: community.id, code, name },
    })
    return { ok: true, created: true, unitGroup }
  }

  @Post('unit-groups/:groupId/members')
  async addUnitGroupMember(
    @Param('communityId') communityId: string,
    @Param('groupId') groupId: string,
    @Body() body: any,
  ) {
    const community = await this.resolveCommunity(communityId)
    const unitCode = String(body?.unitCode || '').trim()
    const startPeriodCode = String(body?.startPeriodCode || '').trim()
    const endPeriodCode = body?.endPeriodCode ? String(body?.endPeriodCode).trim() : null
    if (!unitCode || !startPeriodCode) {
      throw new BadRequestException('unitCode and startPeriodCode are required')
    }
    const unit = await this.prisma.unit.findUnique({
      where: { code_communityId: { code: unitCode, communityId: community.id } },
      select: { id: true },
    })
    if (!unit) throw new NotFoundException(`Unit ${unitCode} not found`)
    const startPeriod = await this.resolvePeriod(community.id, startPeriodCode)
    const endPeriod = endPeriodCode ? await this.resolvePeriod(community.id, endPeriodCode) : null
    const existing = await this.prisma.unitGroupMember.findFirst({
      where: {
        groupId,
        unitId: unit.id,
        startSeq: startPeriod.seq,
        endSeq: endPeriod?.seq ?? null,
      },
    })
    if (existing) return { ok: true, created: false, member: existing }
    const member = await this.prisma.unitGroupMember.create({
      data: {
        groupId,
        unitId: unit.id,
        startPeriodId: startPeriod.id,
        endPeriodId: endPeriod?.id ?? null,
        startSeq: startPeriod.seq,
        endSeq: endPeriod?.seq ?? null,
      },
    })
    return { ok: true, created: true, member }
  }

  @Get('billing-entities')
  async listBillingEntities(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.billingEntity.findMany({
      where: { communityId: community.id },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
  }

  @Post('billing-entities')
  async createBillingEntity(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const code = String(body?.code || '').trim()
    const name = String(body?.name || '').trim()
    if (!code || !name) throw new BadRequestException('billing-entity code and name are required')
    const order = Number(body?.order ?? 0)
    const existing = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code, communityId: community.id } },
    })
    if (existing) return { ok: true, created: false, billingEntity: existing }
    const billingEntity = await this.prisma.billingEntity.create({
      data: {
        communityId: community.id,
        code,
        name,
        order: Number.isFinite(order) ? order : 0,
      },
    })
    return { ok: true, created: true, billingEntity }
  }

  // Admin: set/clear a billing entity's display name (empty → clear, falls back to the computed default).
  @Patch('billing-entities/:beCode/display-name')
  async setBillingEntityDisplayName(@Param('communityId') communityId: string, @Param('beCode') beCode: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const raw = body?.displayName
    const displayName = raw == null || String(raw).trim() === '' ? null : String(raw).trim()
    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId: community.id } }, select: { id: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    const updated = await this.prisma.billingEntity.update({
      where: { id: be.id }, data: { displayName } as any, select: { code: true, name: true, displayName: true },
    })
    return { ok: true, billingEntity: updated }
  }

  @Post('billing-entities/:beId/members')
  async addBillingEntityMember(
    @Param('communityId') communityId: string,
    @Param('beId') beId: string,
    @Body() body: any,
  ) {
    const community = await this.resolveCommunity(communityId)
    const unitCode = String(body?.unitCode || '').trim()
    const startPeriodCode = String(body?.startPeriodCode || '').trim()
    const endPeriodCode = body?.endPeriodCode ? String(body?.endPeriodCode).trim() : null
    if (!unitCode || !startPeriodCode) {
      throw new BadRequestException('unitCode and startPeriodCode are required')
    }
    const unit = await this.prisma.unit.findUnique({
      where: { code_communityId: { code: unitCode, communityId: community.id } },
      select: { id: true },
    })
    if (!unit) throw new NotFoundException(`Unit ${unitCode} not found`)
    const startPeriod = await this.resolvePeriod(community.id, startPeriodCode)
    const endPeriod = endPeriodCode ? await this.resolvePeriod(community.id, endPeriodCode) : null
    const existing = await this.prisma.billingEntityMember.findFirst({
      where: {
        billingEntityId: beId,
        unitId: unit.id,
        startSeq: startPeriod.seq,
        endSeq: endPeriod?.seq ?? null,
      },
    })
    if (existing) return { ok: true, created: false, member: existing }
    const member = await this.prisma.billingEntityMember.create({
      data: {
        billingEntityId: beId,
        unitId: unit.id,
        startPeriodId: startPeriod.id,
        endPeriodId: endPeriod?.id ?? null,
        startSeq: startPeriod.seq,
        endSeq: endPeriod?.seq ?? null,
      },
    })
    return { ok: true, created: true, member }
  }

  @Get('allocation-rules')
  async listAllocationRules(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.allocationRule.findMany({
      where: { communityId: community.id },
      orderBy: { id: 'asc' },
    })
  }

  @Post('allocation-rules')
  async createAllocationRule(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const method = String(body?.method || '').trim()
    const name = body?.name ? String(body?.name).trim() : null
    if (!method) throw new BadRequestException('allocation-rule method is required')
    const rule = await this.prisma.allocationRule.create({
      data: { communityId: community.id, method: method as any, name, params: body?.params ?? null },
    })
    return { ok: true, created: true, rule }
  }

  @Get('split-groups')
  async listSplitGroups(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.splitGroup.findMany({
      where: { communityId: community.id },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
  }

  @Post('split-groups')
  async createSplitGroup(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const code = String(body?.code || '').trim()
    const name = String(body?.name || '').trim()
    if (!code || !name) throw new BadRequestException('split-group code and name are required')
    const order = body?.order != null ? Number(body.order) : null
    const existing = await this.prisma.splitGroup.findUnique({
      where: { communityId_code: { communityId: community.id, code } },
    })
    if (existing) return { ok: true, created: false, splitGroup: existing }
    const splitGroup = await this.prisma.splitGroup.create({
      data: { communityId: community.id, code, name, order: Number.isFinite(order) ? order : null },
    })
    return { ok: true, created: true, splitGroup }
  }

  @Post('split-groups/:splitGroupId/members')
  async addSplitGroupMember(
    @Param('communityId') communityId: string,
    @Param('splitGroupId') splitGroupId: string,
    @Body() body: any,
  ) {
    await this.resolveCommunity(communityId)
    const splitNodeId = String(body?.splitNodeId || '').trim()
    if (!splitNodeId) throw new BadRequestException('splitNodeId is required')
    const existing = await this.prisma.splitGroupMember.findUnique({
      where: { splitGroupId_splitNodeId: { splitGroupId, splitNodeId } },
    })
    if (existing) return { ok: true, created: false, member: existing }
    const member = await this.prisma.splitGroupMember.create({
      data: { splitGroupId, splitNodeId },
    })
    return { ok: true, created: true, member }
  }

  @Get('derived-meter-rules')
  async listDerivedRules(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.derivedMeterRule.findMany({
      where: { communityId: community.id },
      orderBy: { id: 'asc' },
    })
  }

  @Post('derived-meter-rules')
  async createDerivedRule(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const scopeType = String(body?.scopeType || 'COMMUNITY').trim()
    const sourceType = String(body?.sourceType || '').trim()
    const targetType = String(body?.targetType || '').trim()
    if (!sourceType || !targetType) throw new BadRequestException('sourceType and targetType are required')
    const subtractTypes = body?.subtractTypes ?? []
    const existing = await this.prisma.derivedMeterRule.findUnique({
      where: {
        communityId_scopeType_sourceType_targetType: {
          communityId: community.id,
          scopeType: scopeType as any,
          sourceType,
          targetType,
        },
      },
    })
    if (existing) return { ok: true, created: false, rule: existing }
    const rule = await this.prisma.derivedMeterRule.create({
      data: {
        communityId: community.id,
        scopeType: scopeType as any,
        sourceType,
        subtractTypes,
        targetType,
        origin: body?.origin ?? 'DERIVED',
      },
    })
    return { ok: true, created: true, rule }
  }

  @Get('aggregation-rules')
  async listAggregationRules(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    return this.prisma.aggregationRule.findMany({
      where: { communityId: community.id },
      orderBy: { id: 'asc' },
    })
  }

  @Post('aggregation-rules')
  async createAggregationRule(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const targetType = String(body?.targetType || '').trim()
    if (!targetType) throw new BadRequestException('targetType is required')
    const unitTypes = Array.isArray(body?.unitTypes) ? body.unitTypes : []
    const residualType = body?.residualType ?? null
    const existing = await this.prisma.aggregationRule.findUnique({
      where: { communityId_targetType: { communityId: community.id, targetType } },
    })
    if (existing) return { ok: true, created: false, rule: existing }
    const rule = await this.prisma.aggregationRule.create({
      data: {
        communityId: community.id,
        targetType,
        unitTypes,
        residualType,
      },
    })
    return { ok: true, created: true, rule }
  }

  @Get('meters')
  async listMeters(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    const units = await this.prisma.unit.findMany({
      where: { communityId: community.id },
      select: { code: true },
    })
    const scopeCodes = [community.code, ...units.map((u) => u.code)]
    return (this.prisma as any).meter.findMany({
      where: { scopeCode: { in: scopeCodes } },
      orderBy: { meterId: 'asc' },
    })
  }

  @Post('meters')
  async createMeter(@Param('communityId') communityId: string, @Body() body: any) {
    await this.resolveCommunity(communityId)
    const meterId = String(body?.meterId || '').trim()
    const scopeType = String(body?.scopeType || '').trim()
    const scopeCode = String(body?.scopeCode || '').trim()
    const typeCode = String(body?.typeCode || '').trim()
    if (!meterId || !scopeType || !scopeCode || !typeCode) {
      throw new BadRequestException('meterId, scopeType, scopeCode, typeCode are required')
    }
    const existing = await (this.prisma as any).meter.findUnique({ where: { meterId } })
    if (existing) return { ok: true, created: false, meter: existing }
    const meter = await (this.prisma as any).meter.create({
      data: {
        meterId,
        name: body?.name ?? null,
        scopeType,
        scopeCode,
        typeCode,
        origin: body?.origin ?? 'METER',
        installedAt: body?.installedAt ? new Date(body.installedAt) : null,
        retiredAt: body?.retiredAt ? new Date(body.retiredAt) : null,
        multiplier: body?.multiplier ?? null,
        notes: body?.notes ?? null,
      },
    })
    return { ok: true, created: true, meter }
  }
}
