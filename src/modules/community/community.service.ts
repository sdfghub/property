import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import fs from 'fs'
import path from 'path'

type SplitLine = { text: string; depth: number; meta?: string | null; extra?: string | null }

function renderSplitLines(
  splits: any[],
  allocationRules: any[],
  splitNodeNames?: Record<string, string>,
  meterNames?: Map<string, string>,
  depth = 0,
): SplitLine[] {
  if (!Array.isArray(splits)) return []
  const lines: SplitLine[] = []
  const lookupName = (id: string) => {
    if (splitNodeNames && splitNodeNames[id]) return splitNodeNames[id]
    const rule = allocationRules.find((r: any) => r.code === id)
    return rule?.name || rule?.code || id
  }

  const computeMeta = (s: any) => {
    const share = typeof s.share === 'number' ? `${Math.round(s.share * 100)}%` : null
    let derived: string | null = null
    if (s.derivedShare === 'remainder') derived = 'remainder'
    else if (s.derivedShare && typeof s.derivedShare === 'object') {
      const d = s.derivedShare as any
      const label = (id?: string) => (id ? meterNames?.get(id) || id : undefined)
      if (d.partMeterId && d.totalMeterId) derived = `proportional ${label(d.partMeterId)}/${label(d.totalMeterId)}`
      else if (d.meterType) derived = `proportional ${d.meterType}`
      else derived = 'derived'
    }

    const alloc = s.allocation || {}
    const basis = alloc.basis
    const basisText = basis
      ? basis.type === 'GROUP'
        ? `${basis.name || basis.code || ''}`.trim()
        : basis.type === 'COMMUNITY'
        ? 'everybody'
        : basis.type || null
      : null
    const allocMethod = alloc.ruleCode || alloc.method
    const weight = alloc.weightSource ? `${alloc.weightSource}` : null

    const splitMeta = [share === '100%' ? null : share, derived].filter(Boolean)
    const allocText = [basisText, allocMethod, weight].filter(Boolean)

    return {
      splitMeta: splitMeta.length ? splitMeta.join(' · ') : null,
      allocText: allocText.length ? allocText.join(' · ') : null,
    }
  }

  splits.forEach((s) => {
    const label = lookupName(s.id || '')
    const { splitMeta, allocText } = computeMeta(s)

    const children = Array.isArray(s.children) ? s.children : []
    // Always render the split itself
    lines.push({ text: label, depth, meta: splitMeta || null, extra: null })

    if (children.length) {
      lines.push(...renderSplitLines(children, allocationRules, splitNodeNames, meterNames, depth + 1))
    } else if (allocText) {
      // Leaf: render allocation as a child line
      lines.push({ text: allocText, depth: depth + 1, meta: null, extra: null })
    }
  })
  return lines
}

type Role = 'SYSTEM_ADMIN' | 'COMMUNITY_ADMIN' | 'CENSOR' | 'BILLING_ENTITY_USER'
type ScopeType = 'SYSTEM' | 'COMMUNITY' | 'BILLING_ENTITY'

@Injectable()
export class CommunityService {
  constructor(private prisma: PrismaService) {}

  async listForUser(userId: string, q?: string) {
    // SYSTEM_ADMIN → all communities
    const sys = await this.prisma.roleAssignment.findFirst({
      where: { userId, role: 'SYSTEM_ADMIN' as Role, scopeType: 'SYSTEM' as ScopeType },
      select: { id: true },
    })
    if (sys) {
      return this.prisma.community.findMany({ select: { id: true, code: true, name: true } })
    }


    const communityIds = new Set<string>()

    // COMMUNITY-scoped roles → those communityIds directly
    const byCommunity = await this.prisma.roleAssignment.findMany({
      where: { userId, scopeType: 'COMMUNITY' as ScopeType },
      select: { scopeId: true },
    })
    byCommunity.forEach(x => { if (x.scopeId) communityIds.add(x.scopeId) })

    // BILLING_ENTITY-scoped roles → map BE → community
    const byBe = await this.prisma.roleAssignment.findMany({
      where: { userId, scopeType: 'BILLING_ENTITY' as ScopeType },
      select: { scopeId: true },
    })

    const beIds: string[] = byBe
      .map(x => x.scopeId)
      .filter((id): id is string => !!id)

    if (byBe.length) {
      const bes = await this.prisma.billingEntity.findMany({
        where: { id: { in: beIds } },
        select: { communityId: true },
      })
      bes.forEach(b => communityIds.add(b.communityId))
    }

    if (communityIds.size === 0) return []

    return this.prisma.community.findMany({
      where: { id: { in: Array.from(communityIds) } },
      select: { id: true, code: true, name: true },
      ...(q
        ? {
            where: {
              id: { in: Array.from(communityIds) },
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      orderBy: { name: 'asc' },
    })
  }

  async listAdmins(communityId: string) {
    const roles = await this.prisma.roleAssignment.findMany({
      where: { role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: communityId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createAt: 'desc' },
    })
    return roles.map(r => ({
      assignmentId: r.id,
      userId: r.userId,
      email: r.user?.email ?? '',
      name: r.user?.name ?? null,
      createdAt: r.createAt,
    }))
  }

  async revokeAdmin(communityId: string, userId: string) {
    const res = await this.prisma.roleAssignment.deleteMany({
      where: { userId, role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: communityId },
    })
    return { ok: true, removed: res.count }
  }

  async listBillingEntityResponsibles(communityId: string) {
    const bes = await this.prisma.billingEntity.findMany({
      where: { communityId },
      select: { id: true, code: true, name: true, order: true },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
    if (bes.length === 0) return []
    const beIds = bes.map(b => b.id)
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { role: 'BILLING_ENTITY_USER', scopeType: 'BILLING_ENTITY', scopeId: { in: beIds } },
      include: { user: { select: { id: true, email: true, name: true } } },
    })
    const pendingInvites = await this.prisma.invite.findMany({
      where: {
        role: 'BILLING_ENTITY_USER',
        scopeType: 'BILLING_ENTITY',
        scopeId: { in: beIds },
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, role: true, scopeId: true, createdAt: true, expiresAt: true },
    })
    const byBe = new Map<string, typeof assignments>()
    for (const a of assignments) {
      const list = byBe.get(a.scopeId || '') ?? []
      list.push(a)
      byBe.set(a.scopeId || '', list)
    }
    const pendingByBe = new Map<string, typeof pendingInvites>()
    for (const p of pendingInvites) {
      const list = pendingByBe.get(p.scopeId || '') ?? []
      list.push(p)
      pendingByBe.set(p.scopeId || '', list)
    }
    return bes.map(be => ({
      id: be.id,
      code: be.code,
      name: be.name,
      responsibles: (byBe.get(be.id) || []).map(a => ({
        userId: a.userId,
        email: a.user?.email ?? '',
        name: a.user?.name ?? null,
        assignmentId: a.id,
      })),
      pending: (pendingByBe.get(be.id) || []).map(p => ({
        id: p.id,
        email: p.email,
        role: p.role,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      })),
    }))
  }

  async getConfigSnapshot(communityCode: string) {
    // Prefer live data from DB (imported def.json). Fallback to file if not found.
    const community = await this.prisma.community.findFirst({
      where: { code: communityCode },
      select: { id: true, code: true, name: true },
    })
    if (community) {
      const rawUnits = await (this.prisma as any).unit.findMany({
        where: { communityId: community.id },
        select: { id: true, code: true, order: true },
        orderBy: [{ order: 'asc' }, { code: 'asc' }],
      })
      const unitCodes = rawUnits.map((u: any) => u.code)

    const results = await Promise.all([
      Promise.resolve(rawUnits),
      this.prisma.unitGroup.findMany({
        where: { communityId: community.id },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
        }),
        this.prisma.unitGroupMember.findMany({
          where: { group: { communityId: community.id } },
          select: { groupId: true, unitId: true, startSeq: true, endSeq: true },
        }),
        this.prisma.bucketRule.findMany({
          where: { communityId: community.id },
          orderBy: { priority: 'asc' },
        }),
        this.prisma.allocationRule.findMany({
          where: { communityId: community.id },
          orderBy: { id: 'asc' },
        }),
        this.prisma.expenseType.findMany({
          where: { communityId: community.id },
          select: { code: true, name: true, params: true },
        }),
        (this.prisma as any).splitGroup.findMany({
          where: { communityId: community.id },
          orderBy: [{ order: 'asc' }, { code: 'asc' }],
        }),
        this.prisma.splitGroupMember.findMany({
          where: { splitGroup: { communityId: community.id } },
          select: { splitGroupId: true, splitNodeId: true },
        }),
        (this.prisma as any).billingEntity.findMany({
          where: { communityId: community.id },
          select: { id: true, code: true, name: true, order: true },
          orderBy: [{ order: 'asc' }, { code: 'asc' }],
        }),
        (async () => {
          const bes = await this.prisma.billingEntity.findMany({
            where: { communityId: community.id },
            select: { id: true },
          })
          const beIds = bes.map((b) => b.id)
          if (!beIds.length) return { responsibles: [], pendingInvites: [] }
          const responsibles = await this.prisma.roleAssignment.findMany({
            where: { role: 'BILLING_ENTITY_USER', scopeType: 'BILLING_ENTITY', scopeId: { in: beIds } },
            include: { user: { select: { id: true, email: true, name: true } } },
          })
          const pendingInvites = await this.prisma.invite.findMany({
            where: {
              role: 'BILLING_ENTITY_USER',
              scopeType: 'BILLING_ENTITY',
              scopeId: { in: beIds },
              acceptedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true, email: true, role: true, scopeId: true, createdAt: true, expiresAt: true },
          })
          return { responsibles, pendingInvites }
        })(),
        this.prisma.billingEntityMember.findMany({
          where: { billingEntity: { communityId: community.id } },
          select: { unitId: true, billingEntityId: true },
        }),
        this.prisma.meter.findMany({
          where: { scopeCode: { in: [community.code, ...unitCodes] } },
          select: { meterId: true, name: true, notes: true },
          orderBy: { meterId: 'asc' },
        }),
      ])

      const billingEntitiesRaw = results[8]
      const beCodeById = new Map<string, string>()
      ;(billingEntitiesRaw as any[]).forEach((be: any) => {
        if (be && be.id) beCodeById.set(be.id, be.code ?? '')
      })

      const beMemberships = results[10] as Array<{ unitId: string; billingEntityId: string }>
      const meters = results[11] as Array<{ meterId: string; name?: string | null; notes?: string | null }>
      const beByUnit = new Map<string, string[]>()
      const unitCodeById = new Map<string, string>()
      rawUnits.forEach((u: any) => unitCodeById.set(u.id, u.code))
      const membersByBe = new Map<string, string[]>()
      beMemberships.forEach((m) => {
        const code = beCodeById.get(m.billingEntityId)
        if (!code) return
        const unitCode = unitCodeById.get(m.unitId)
        if (unitCode) {
          const list = membersByBe.get(m.billingEntityId) ?? []
          list.push(unitCode)
          membersByBe.set(m.billingEntityId, list)
        }
        const list = beByUnit.get(m.unitId) ?? []
        list.push(code)
        beByUnit.set(m.unitId, list)
      })

      const units = results[0].map((u: any, idx: number) => ({
        id: u.id,
        code: u.code,
        order: (u.order ?? idx) + 1,
        beCodes: beByUnit.get(u.id) ?? [],
      }))
      const unitGroups = results[1]
      const unitGroupMembers = results[2]
      const bucketRules = results[3]
      const allocationRules = results[4]
      const expenseTypes = results[5] as Array<{ params?: any }>
      const splitGroups = results[6]
      const splitGroupMembers = results[7]
      const billingEntities = (billingEntitiesRaw as any[]).map((be: any, idx: number) => ({
        id: be.id,
        code: be.code,
        name: be.name,
        order: (be.order ?? idx) + 1,
        units: membersByBe.get(be.id) ?? [],
      }))
      const beRespPending = results[9] as any

      const splitNodeNamesMap = (() => {
        const splitNodes = new Map<string, string>()
        expenseTypes.forEach((et) => {
          const template = (et.params as any)?.splitTemplate
          const collect = (arr: any[]) => {
            arr?.forEach((s) => {
              if (s?.id) splitNodes.set(s.id, s.name || s.id)
              if (Array.isArray(s?.children)) collect(s.children)
            })
          }
          if (Array.isArray(template)) collect(template)
          if (Array.isArray(template?.splits)) collect(template.splits)
        })
        return splitNodes
      })()

      return {
        community,
        units,
        unitGroups,
        unitGroupMembers,
        bucketRules,
        allocationRules,
        expenseSplits: expenseTypes.map((et) => {
          const template: any = (et.params as any)?.splitTemplate
          const rawSplits = Array.isArray(template?.splits) ? template.splits : Array.isArray(template) ? template : []

          // clone and hydrate basis with group names
          const groupNameByCode = new Map<string, string>()
          unitGroups.forEach((g: any) => {
            if (g?.code) groupNameByCode.set(g.code, g.name || g.code)
          })
          const splits = JSON.parse(JSON.stringify(rawSplits))
          const hydrateBasis = (arr: any[]) => {
            arr?.forEach((s) => {
              if (s?.allocation?.basis?.type === 'GROUP' && s.allocation.basis.code) {
                const name = groupNameByCode.get(s.allocation.basis.code)
                if (name) s.allocation.basis.name = name
              }
              if (Array.isArray(s?.children)) hydrateBasis(s.children)
            })
          }
          hydrateBasis(splits)

          const meterNameById = new Map<string, string>()
          meters.forEach((m) => {
            if (m.meterId) {
              if (m.name) meterNameById.set(m.meterId, m.name)
              else if (m.notes) meterNameById.set(m.meterId, m.notes)
            }
          })

          return {
            expenseTypeCode: (et as any).code ?? '',
            expenseTypeName: (et as any).name ?? (et as any).code ?? '',
            expenseName: (template as any)?.name || undefined,
            splitName: (template as any)?.name || undefined,
            splits,
            lines: renderSplitLines(splits, allocationRules, Object.fromEntries(splitNodeNamesMap), meterNameById, 0),
          }
        }),
        splitGroups,
        splitGroupMembers,
        billingEntities,
        beResponsibles: beRespPending.responsibles,
        bePendingInvites: beRespPending.pendingInvites,
        splitNodeNames: Object.fromEntries(splitNodeNamesMap),
      }
    }

    const defPath = path.join(process.cwd(), 'data', communityCode, 'def.json')
    if (!fs.existsSync(defPath)) return null
    try {
      return JSON.parse(fs.readFileSync(defPath, 'utf8'))
    } catch {
      return null
    }
  }

  async listPrograms(communityCode: string) {
    const community = await this.prisma.community.findFirst({
      where: { code: communityCode },
      select: { id: true },
    })
    if (!community) return null
    return this.prisma.program.findMany({
      where: { communityId: community.id },
      orderBy: { code: 'asc' },
    })
  }

  async listAll() {
    return this.prisma.community.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  async getMeterConfig(communityCode: string) {
    const community = await this.prisma.community.findFirst({
      where: { code: communityCode },
      select: { id: true, code: true },
    })
  if (!community) return null
  const unitCodes = await (this.prisma as any).unit.findMany({
    where: { communityId: community.id },
    select: { code: true },
  })
  const meters = await this.prisma.meter.findMany({
    where: { scopeCode: { in: [community.code, ...unitCodes.map((u: any) => u.code)] } },
    orderBy: { meterId: 'asc' },
  })
    const aggregationRules = await this.prisma.aggregationRule.findMany({
      where: { communityId: community.id },
      orderBy: { targetType: 'asc' },
    })
    const derivedMeters = await this.prisma.derivedMeterRule.findMany({
      where: { communityId: community.id },
      orderBy: { targetType: 'asc' },
    })
    const measureTypes = await this.prisma.measureType.findMany({
      select: { code: true, name: true, unit: true },
      orderBy: { code: 'asc' },
    })
    return { meters, aggregationRules, derivedMeters, measureTypes }
  }
}
