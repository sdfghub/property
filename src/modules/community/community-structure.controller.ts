import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { Scopes } from '../../common/decorators/scopes.decorator'
import { PrismaService } from '../user/prisma.service'
import { resolveBeName } from '../../common/billing-entity-name.util'

type OwnerHistoryEntry = { name: string; startPeriodCode: string | null; endPeriodCode: string | null; current: boolean }
type TenantHistoryEntry = { name: string; source: string; confirmed: boolean }

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

  // Real unit codes carry a registry prefix ("400191-C1-U6-AP 1") — strip it for display.
  private unitLabel(code: string): string {
    return code.replace(/^\d+-C\d+-U\d+-/, '')
  }
  // Falls back to a guess only for a unit that predates the "Unit Definitions" import (no stored
  // `type`) — every real unit here now carries the association's own registry type directly
  // (Apartament, SAD, Boxa, Cale Evacuare, Cale Acces, Estetice si structurale, Tehnice,
  // Depozitare, Functionale), which is richer than this guess and always preferred when present.
  private unitTypeGuess(label: string): string {
    if (/^B\d+$/.test(label)) return 'Boxa'
    if (label.includes('SAD')) return 'SAD'
    if (label.includes('COMERCIAL')) return 'Comercial'
    return 'Apartament'
  }
  // The "default main contact" for a billing entity — the comma-segment of its own `name` flagged
  // via `primaryOwnerName`, else simply the first one. No query needed: both fields are already on
  // whichever BillingEntity row is in hand.
  private firstNameOf(name: string): string {
    return name.split(',')[0].trim()
  }
  // One shared row shape for every "Unități" listing (owner view, physical-group view) — same
  // fields regardless of which grouping is showing it.
  private buildUnitRow(
    unit: { code: string; name: string | null; type: string | null; floorNumber: number | null; floorName: string | null; staircase: string | null; location: string | null; surfaceMp: any; cfCode: string | null; propertyManagerName: string | null; propertyManagerPhone: string | null; propertyManagerEmail: string | null },
    weights: Record<string, number>,
    occupancy: { ownerByUnitCode: Map<string, string>; tenantByUnitCode: Map<string, string>; mainContactByUnitCode: Map<string, string>; beCodeByUnitCode: Map<string, string> },
    history: Map<string, { ownerHistory: OwnerHistoryEntry[]; tenantHistory: TenantHistoryEntry[] }>,
  ) {
    const round3 = (n: number) => Math.round(n * 1000) / 1000
    const label = unit.name || this.unitLabel(unit.code)
    const cpiPct = weights[unit.code] != null ? round3(Number(weights[unit.code])) : null
    const h = history.get(unit.code)
    return {
      code: unit.code, label, type: unit.type || this.unitTypeGuess(label), cpiPct,
      floorNumber: unit.floorNumber, floorName: unit.floorName,
      staircase: unit.staircase, location: unit.location,
      surfaceMp: unit.surfaceMp != null ? Number(unit.surfaceMp) : null,
      cfCode: unit.cfCode,
      owner: occupancy.ownerByUnitCode.get(unit.code) ?? null,
      tenant: occupancy.tenantByUnitCode.get(unit.code) ?? null,
      propertyManager: unit.propertyManagerName,
      propertyManagerPhone: unit.propertyManagerPhone,
      propertyManagerEmail: unit.propertyManagerEmail,
      mainContact: occupancy.mainContactByUnitCode.get(unit.code) ?? null,
      billingEntityCode: occupancy.beCodeByUnitCode.get(unit.code) ?? null,
      ownerHistory: h?.ownerHistory ?? [],
      tenantHistory: h?.tenantHistory ?? [],
    }
  }
  // The only place a unit's CPI (cotă parte indiviză) share is actually recorded is an
  // EXPLICIT-method fund's per-unit `allocation.weights` snapshot (see funds.json) — there is no
  // separate Unit.cpi column — so REABILITARE_1 is read here purely as that CPI source, not as a
  // fund-specific figure.
  private async loadUnitCpiWeights(communityId: string): Promise<Record<string, number>> {
    const fund = await this.prisma.fund.findFirst({ where: { communityId, code: 'REABILITARE_1' }, select: { allocation: true } })
    return (fund?.allocation as any)?.weights ?? {}
  }
  // Current owner (from the active BillingEntityMember, so it reflects an ownership transfer the
  // moment its new membership starts), tenant (from UnitTenant — only ever scoped to one exact
  // unit, so there's no "unnarrowed" case to worry about), and main contact (the owning entity's
  // primaryOwnerName, else its first name) per unit code.
  private async loadOccupancy(communityId: string): Promise<{ ownerByUnitCode: Map<string, string>; tenantByUnitCode: Map<string, string>; mainContactByUnitCode: Map<string, string>; beCodeByUnitCode: Map<string, string> }> {
    const [members, tenants] = await Promise.all([
      this.prisma.billingEntityMember.findMany({
        where: { billingEntity: { communityId }, endSeq: null },
        select: { unit: { select: { code: true } }, billingEntity: { select: { id: true, code: true, name: true, displayName: true, primaryOwnerName: true } } },
      }),
      this.prisma.unitTenant.findMany({ where: { unit: { communityId } }, select: { unit: { select: { code: true } }, name: true } }),
    ])
    const ownerByUnitCode = new Map<string, string>()
    const mainContactByUnitCode = new Map<string, string>()
    const beCodeByUnitCode = new Map<string, string>()
    for (const m of members) {
      ownerByUnitCode.set(m.unit.code, m.billingEntity.displayName || m.billingEntity.name)
      mainContactByUnitCode.set(m.unit.code, m.billingEntity.primaryOwnerName || this.firstNameOf(m.billingEntity.name))
      beCodeByUnitCode.set(m.unit.code, m.billingEntity.code)
    }
    const tenantByUnitCode = new Map<string, string>()
    for (const t of tenants) {
      const cur = tenantByUnitCode.get(t.unit.code)
      tenantByUnitCode.set(t.unit.code, cur ? `${cur}, ${t.name}` : t.name)
    }
    return { ownerByUnitCode, tenantByUnitCode, mainContactByUnitCode, beCodeByUnitCode }
  }
  // Full ownership (every BillingEntityMember, past and present, resolved to period codes via
  // startSeq/endSeq — the same versioning already used for ownership transfers) and tenancy
  // (every UnitTenant, in the order they were recorded — UnitTenant has no period versioning of
  // its own, so there is no start/end range to show per tenant) per unit code.
  // A name change mid-membership is a rare edge case; resolving at the membership's own start
  // (not "now") is a reasonable simplification — see resolveBeName below.
  private async loadUnitHistory(communityId: string): Promise<Map<string, { ownerHistory: OwnerHistoryEntry[]; tenantHistory: TenantHistoryEntry[] }>> {
    const [members, tenants, periods, nameHistoryRows] = await Promise.all([
      this.prisma.billingEntityMember.findMany({
        where: { billingEntity: { communityId } },
        select: { unit: { select: { code: true } }, billingEntity: { select: { id: true, name: true, displayName: true } }, startSeq: true, endSeq: true },
        orderBy: { startSeq: 'asc' },
      }),
      this.prisma.unitTenant.findMany({
        where: { unit: { communityId } },
        select: { unit: { select: { code: true } }, name: true, source: true, confirmed: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.period.findMany({ where: { communityId }, select: { seq: true, code: true } }),
      this.prisma.billingEntityNameHistory.findMany({
        where: { billingEntity: { communityId } },
        select: { billingEntityId: true, name: true, displayName: true, startSeq: true, endSeq: true },
      }),
    ])
    const nameHistoryByBe = new Map<string, typeof nameHistoryRows>()
    for (const h of nameHistoryRows) {
      const arr = nameHistoryByBe.get(h.billingEntityId) ?? []
      arr.push(h)
      nameHistoryByBe.set(h.billingEntityId, arr)
    }
    const codeBySeq = new Map(periods.map((p) => [p.seq, p.code]))
    const byUnit = new Map<string, { ownerHistory: OwnerHistoryEntry[]; tenantHistory: TenantHistoryEntry[] }>()
    const ensure = (code: string) => {
      let e = byUnit.get(code)
      if (!e) { e = { ownerHistory: [], tenantHistory: [] }; byUnit.set(code, e) }
      return e
    }
    for (const m of members) {
      const rn = resolveBeName(m.billingEntity, m.startSeq, nameHistoryByBe)
      ensure(m.unit.code).ownerHistory.push({
        name: rn.displayName || rn.name,
        startPeriodCode: codeBySeq.get(m.startSeq) ?? null,
        endPeriodCode: m.endSeq != null ? codeBySeq.get(m.endSeq) ?? null : null,
        current: m.endSeq == null,
      })
    }
    for (const t of tenants) {
      ensure(t.unit.code).tenantHistory.push({ name: t.name, source: t.source, confirmed: t.confirmed })
    }
    return byUnit
  }

  // #19 "Unități" (Informații asociație) — billing entities (owners) with their linked units and
  // each unit's CPI share. Broader read scope than the rest of this controller (CENSOR too), same
  // as VendorInvoiceController's dashboard summary, since this backs a page censors also see.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('billing-entities/detailed')
  async listBillingEntitiesDetailed(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    const round3 = (n: number) => Math.round(n * 1000) / 1000
    const unitSelect = { code: true, name: true, type: true, floorNumber: true, floorName: true, staircase: true, location: true, surfaceMp: true, cfCode: true, propertyManagerName: true, propertyManagerPhone: true, propertyManagerEmail: true } as const
    const [bes, members, weights, occupancy, history] = await Promise.all([
      this.prisma.billingEntity.findMany({ where: { communityId: community.id }, orderBy: [{ order: 'asc' }, { code: 'asc' }] }),
      this.prisma.billingEntityMember.findMany({
        where: { billingEntity: { communityId: community.id }, endSeq: null },
        select: { billingEntityId: true, unit: { select: unitSelect } },
      }),
      this.loadUnitCpiWeights(community.id),
      this.loadOccupancy(community.id),
      this.loadUnitHistory(community.id),
    ])
    const membersByBe = new Map<string, (typeof members)[number]['unit'][]>()
    for (const m of members) {
      const arr = membersByBe.get(m.billingEntityId) ?? []
      arr.push(m.unit)
      membersByBe.set(m.billingEntityId, arr)
    }
    const groups = bes.map((be) => {
      const units = (membersByBe.get(be.id) ?? []).map((u) => this.buildUnitRow(u, weights, occupancy, history))
      const totalCpiPct = round3(units.reduce((s, u) => s + (u.cpiPct ?? 0), 0))
      return { id: be.id, code: be.code, name: be.displayName || be.name, units, totalCpiPct }
    })
    return {
      groups,
      totalUnits: groups.reduce((s, g) => s + g.units.length, 0),
      totalGroups: groups.length,
      totalCpiPct: round3(groups.reduce((s, g) => s + g.totalCpiPct, 0)),
    }
  }

  // #20 "Grup unități" (Informații asociație) — the PHYSICAL clustering of each apartment/SAD unit
  // with its storage boxes (independent of who owns them — see billing-entities/detailed for the
  // ownership view). Only "PHYS_"-prefixed unit-groups are physical clusters; the rest of this
  // community's unit-groups are service-eligibility scopes (ALL_BILLABLE, SVC_APA_RECE, …) and are
  // deliberately excluded here.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('unit-groups/detailed')
  async listUnitGroupsDetailed(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    const round3 = (n: number) => Math.round(n * 1000) / 1000
    const unitSelect = { code: true, name: true, type: true, floorNumber: true, floorName: true, staircase: true, location: true, surfaceMp: true, cfCode: true, propertyManagerName: true, propertyManagerPhone: true, propertyManagerEmail: true } as const
    const [groups, members, weights, occupancy, history] = await Promise.all([
      this.prisma.unitGroup.findMany({ where: { communityId: community.id, code: { startsWith: 'PHYS_' } }, orderBy: { name: 'asc' } }),
      this.prisma.unitGroupMember.findMany({
        where: { group: { communityId: community.id, code: { startsWith: 'PHYS_' } }, endSeq: null },
        select: { groupId: true, unit: { select: unitSelect } },
      }),
      this.loadUnitCpiWeights(community.id),
      this.loadOccupancy(community.id),
      this.loadUnitHistory(community.id),
    ])
    const membersByGroup = new Map<string, (typeof members)[number]['unit'][]>()
    for (const m of members) {
      const arr = membersByGroup.get(m.groupId) ?? []
      arr.push(m.unit)
      membersByGroup.set(m.groupId, arr)
    }
    const groupRows = groups.map((g) => {
      const units = (membersByGroup.get(g.id) ?? []).map((u) => this.buildUnitRow(u, weights, occupancy, history))
      const totalCpiPct = round3(units.reduce((s, u) => s + (u.cpiPct ?? 0), 0))
      return { id: g.id, code: g.code, name: g.name, units, totalCpiPct }
    })
    // "Unit" counts residents' billable units; boxes and the building's common/technical spaces
    // (Cale Evacuare, Tehnice, …) are shown here too but tallied separately in the section header.
    const BILLABLE_TYPES = new Set(['apartament', 'sad', 'comercial'])
    const isType = (u: { type: string }, t: string) => u.type.toLowerCase() === t
    return {
      groups: groupRows,
      totalUnits: groupRows.reduce((s, g) => s + g.units.filter((u) => BILLABLE_TYPES.has(u.type.toLowerCase())).length, 0),
      totalBoxes: groupRows.reduce((s, g) => s + g.units.filter((u) => isType(u, 'boxa')).length, 0),
      totalCommonSpaces: groupRows.reduce((s, g) => s + g.units.filter((u) => !BILLABLE_TYPES.has(u.type.toLowerCase()) && !isType(u, 'boxa')).length, 0),
      totalGroups: groupRows.length,
      totalCpiPct: round3(groupRows.reduce((s, g) => s + g.totalCpiPct, 0)),
    }
  }

  // #21 "Persoane" (Informații asociație) — owners come straight from BillingEntity.name (no
  // storage of their own), property manager is plain columns on Unit (see units endpoints above).
  // This section is tenants only — the one fact that genuinely needs its own rows, since a unit
  // can have several tenant candidates awaiting review at once. Broader read scope, same reasoning
  // as the units endpoints above.
  @Scopes({ role: ['COMMUNITY_ADMIN', 'CENSOR'], scopeType: 'COMMUNITY', scopeParam: 'communityId' })
  @Get('tenants')
  async listTenants(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    const tenants = await this.prisma.unitTenant.findMany({
      where: { unit: { communityId: community.id } },
      include: { unit: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    })
    return tenants.map((t) => ({
      id: t.id, name: t.name, phone: t.phone, email: t.email, source: t.source, confirmed: t.confirmed,
      unitId: t.unit.id, unitCode: t.unit.code, unitLabel: t.unit.name || this.unitLabel(t.unit.code),
    }))
  }

  @Post('tenants')
  async createTenant(@Param('communityId') communityId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const name = String(body?.name || '').trim()
    if (!name) throw new BadRequestException('name is required')
    const unit = await this.prisma.unit.findUnique({ where: { code_communityId: { code: String(body?.unitCode || ''), communityId: community.id } }, select: { id: true } })
    if (!unit) throw new NotFoundException('Unit not found')
    return this.prisma.unitTenant.create({
      data: { unitId: unit.id, name, phone: body?.phone || null, email: body?.email || null, source: 'MANUAL', confirmed: true },
    })
  }

  @Patch('tenants/:tenantId')
  async updateTenant(@Param('communityId') communityId: string, @Param('tenantId') tenantId: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const tenant = await this.prisma.unitTenant.findFirst({ where: { id: tenantId, unit: { communityId: community.id } } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    const data: any = {}
    if (body?.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) throw new BadRequestException('name is required')
      data.name = name
    }
    if (body?.phone !== undefined) data.phone = body.phone || null
    if (body?.email !== undefined) data.email = body.email || null
    if (body?.confirmed !== undefined) data.confirmed = !!body.confirmed
    if (Object.keys(data).length === 0) throw new BadRequestException('No fields provided')
    return this.prisma.unitTenant.update({ where: { id: tenantId }, data })
  }

  @Delete('tenants/:tenantId')
  async deleteTenant(@Param('communityId') communityId: string, @Param('tenantId') tenantId: string) {
    const community = await this.resolveCommunity(communityId)
    const tenant = await this.prisma.unitTenant.findFirst({ where: { id: tenantId, unit: { communityId: community.id } } })
    if (!tenant) throw new NotFoundException('Tenant not found')
    await this.prisma.unitTenant.delete({ where: { id: tenantId } })
    return { ok: true }
  }

  // Set/clear a unit's facility contact — plain columns on Unit, at most one per unit.
  @Patch('units/:unitCode/property-manager')
  async setUnitPropertyManager(@Param('communityId') communityId: string, @Param('unitCode') unitCode: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const unit = await this.prisma.unit.findUnique({ where: { code_communityId: { code: unitCode, communityId: community.id } }, select: { id: true } })
    if (!unit) throw new NotFoundException('Unit not found')
    const name = body?.name != null ? String(body.name).trim() || null : null
    return this.prisma.unit.update({
      where: { id: unit.id },
      data: { propertyManagerName: name, propertyManagerPhone: name ? (body?.phone || null) : null, propertyManagerEmail: name ? (body?.email || null) : null },
    })
  }

  // Override which comma-segment of a billing entity's own name is its default point of contact —
  // null clears the override, back to "the first one".
  @Patch('billing-entities/:code/primary-owner')
  async setBillingEntityPrimaryOwner(@Param('communityId') communityId: string, @Param('code') code: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const be = await this.prisma.billingEntity.findUnique({ where: { code_communityId: { code, communityId: community.id } }, select: { id: true } })
    if (!be) throw new NotFoundException('Billing entity not found')
    const primaryOwnerName = body?.name != null ? String(body.name).trim() || null : null
    return this.prisma.billingEntity.update({ where: { id: be.id }, data: { primaryOwnerName } })
  }

  // Cash-register tenant inference: a receipt's `meta.payer` for a unit whose name doesn't
  // resemble any of that unit's owner names (shared name token = same family, e.g. a spouse or
  // relative paying — not flagged) becomes an unconfirmed tenant candidate. Idempotent: re-running
  // only adds names not already present for that exact unit.
  @Post('tenants/detect')
  async detectTenants(@Param('communityId') communityId: string) {
    const community = await this.resolveCommunity(communityId)
    const bes = await this.prisma.billingEntity.findMany({
      where: { communityId: community.id },
      include: { members: { where: { endSeq: null }, select: { unit: { select: { id: true, code: true } } } } },
    })
    const existingTenants = await this.prisma.unitTenant.findMany({ select: { unitId: true, name: true } })
    const tenantKey = (unitId: string, name: string) => `${unitId}::${name.trim().toLowerCase()}`
    const seenTenants = new Set(existingTenants.map((t) => tenantKey(t.unitId, t.name)))

    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').trim()
    const nameTokens = (s: string) => new Set(normalize(s).split(/\s+/).filter((t) => t.length > 2))
    const namesOverlap = (a: string, b: string) => {
      const tb = nameTokens(b)
      for (const t of nameTokens(a)) if (tb.has(t)) return true
      return false
    }
    // Real unit codes carry a registry prefix; register counterparty strings are the bare label
    // with the "AP " prefix dropped, and the commercial unit is abbreviated "SP COM".
    const registerLabel = (unitCode: string) => {
      const label = this.unitLabel(unitCode)
      if (label === 'SPAȚIU COMERCIAL') return 'SP COM'
      return label.replace(/^AP\s+/, '')
    }

    const inTx = await (this.prisma as any).cashTx.findMany({
      where: { communityId: community.id, direction: 'IN' },
      select: { meta: true },
    })
    const payersByLabel = new Map<string, Set<string>>()
    for (const tx of inTx as any[]) {
      const label = tx.meta?.counterparty
      const payer = tx.meta?.payer
      if (typeof label !== 'string' || typeof payer !== 'string' || !payer.trim()) continue
      const set = payersByLabel.get(label) ?? new Set<string>()
      set.add(payer.trim())
      payersByLabel.set(label, set)
    }

    let tenantsCreated = 0
    for (const be of bes) {
      const ownerNames = be.name.split(',').map((s) => s.trim()).filter(Boolean)
      // Per-unit, not per-BE: a payer is known to occupy exactly the unit whose register label
      // they paid for, so this narrows to that unit precisely instead of leaving it for a
      // multi-unit BE to sort out by hand later.
      for (const m of be.members) {
        for (const payer of payersByLabel.get(registerLabel(m.unit.code)) ?? []) {
          if (ownerNames.some((o) => namesOverlap(o, payer))) continue
          const key = tenantKey(m.unit.id, payer)
          if (seenTenants.has(key)) continue
          await this.prisma.unitTenant.create({ data: { unitId: m.unit.id, name: payer, source: 'INFERRED', confirmed: false } })
          seenTenants.add(key)
          tenantsCreated++
        }
      }
    }

    return { tenantsCreated }
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
    // A typo fix should also correct the currently open historical range's text (if this entity
    // was ever renamed) — otherwise the correction would only show from "now" onward and the old
    // typo would still surface for whatever periods that range covers.
    const openHistory = await this.prisma.billingEntityNameHistory.findFirst({ where: { billingEntityId: be.id, endSeq: null } })
    if (openHistory) {
      await this.prisma.billingEntityNameHistory.update({ where: { id: openHistory.id }, data: { displayName } })
    }
    return { ok: true, billingEntity: updated }
  }

  // Real rename, versioned like BillingEntityMember: snapshots the entity's current name/
  // displayName into a closed BillingEntityNameHistory row (valid through the period before
  // effectiveFromPeriodCode), then updates the live BillingEntity to the new values —
  // resolveBeName already treats the live fields as "current, unbounded" once no later history
  // row exists, so nothing else needs to change to make past periods keep reading the old name.
  @Post('billing-entities/:beCode/rename')
  async renameBillingEntity(@Param('communityId') communityId: string, @Param('beCode') beCode: string, @Body() body: any) {
    const community = await this.resolveCommunity(communityId)
    const be = await this.prisma.billingEntity.findUnique({ where: { code_communityId: { code: beCode, communityId: community.id } } })
    if (!be) throw new NotFoundException('Billing entity not found')
    const effectiveFromPeriodCode = String(body?.effectiveFromPeriodCode || '').trim()
    if (!effectiveFromPeriodCode) throw new BadRequestException('effectiveFromPeriodCode is required')
    const effectiveFrom = await this.resolvePeriod(community.id, effectiveFromPeriodCode)
    const newName = body?.name != null ? String(body.name).trim() : be.name
    const newDisplayName = body?.displayName !== undefined ? (String(body.displayName || '').trim() || null) : be.displayName
    if (!newName) throw new BadRequestException('name is required')

    // Every rename closes out whatever state was true immediately before it — either an already-
    // open history row from an earlier rename, or (the first rename ever) the entity's own current
    // name/displayName, treated as true "since always" — into a closed row, then opens a new row
    // for the new state. The open row's own name/displayName is kept mirrored onto the live
    // BillingEntity fields too, so any code that still reads them directly sees "current" correctly.
    const openHistory = await this.prisma.billingEntityNameHistory.findFirst({ where: { billingEntityId: be.id, endSeq: null } })
    const oldName = openHistory?.name ?? be.name
    const oldDisplayName = openHistory ? openHistory.displayName : be.displayName
    const startSeq = openHistory?.startSeq
      ?? (await this.prisma.period.findFirst({ where: { communityId: community.id }, orderBy: { seq: 'asc' }, select: { seq: true } }))?.seq
      ?? effectiveFrom.seq
    if (effectiveFrom.seq <= startSeq) {
      throw new BadRequestException('effectiveFromPeriodCode must be after the last recorded name change')
    }
    const endPeriod = await this.prisma.period.findFirst({ where: { communityId: community.id, seq: effectiveFrom.seq - 1 }, select: { id: true } })
    const startPeriod = openHistory
      ? { id: openHistory.startPeriodId }
      : await this.prisma.period.findFirst({ where: { communityId: community.id, seq: startSeq }, select: { id: true } })

    await this.prisma.$transaction([
      openHistory
        ? this.prisma.billingEntityNameHistory.update({
            where: { id: openHistory.id },
            data: { endSeq: effectiveFrom.seq - 1, endPeriodId: endPeriod?.id ?? null },
          })
        : this.prisma.billingEntityNameHistory.create({
            data: {
              billingEntityId: be.id,
              name: oldName,
              displayName: oldDisplayName,
              startPeriodId: startPeriod?.id ?? effectiveFrom.id,
              endPeriodId: endPeriod?.id ?? null,
              startSeq,
              endSeq: effectiveFrom.seq - 1,
            },
          }),
      this.prisma.billingEntityNameHistory.create({
        data: {
          billingEntityId: be.id,
          name: newName,
          displayName: newDisplayName,
          startPeriodId: effectiveFrom.id,
          endPeriodId: null,
          startSeq: effectiveFrom.seq,
          endSeq: null,
        },
      }),
      this.prisma.billingEntity.update({ where: { id: be.id }, data: { name: newName, displayName: newDisplayName } }),
    ])
    return { ok: true }
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
