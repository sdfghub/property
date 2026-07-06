import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { AllocationMethod, ChargeSourceType, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from '../user/prisma.service'

type PeriodRef = { id: string; seq: number; code: string }

@Injectable()
export class AllocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-unit measures for an allocation weight source.
   *
   * SQM and RESIDENTS (persoane) are static unit attributes, not monthly readings, so they carry
   * forward: each unit uses the value from the most recent period (by seq) at or before this period in
   * which it was defined — typically only the first/onboarding period actually carries them. Meter /
   * consumption measures are genuinely period-specific and are read from the current period only.
   */
  private async unitMeasuresForWeight(
    communityId: string,
    typeCode: string,
    period: { id: string; seq: number },
  ): Promise<Array<{ scopeId: string; value: any; meterId: string | null }>> {
    const isStatic = typeCode === 'SQM' || typeCode === 'RESIDENTS'
    if (!isStatic) {
      return this.prisma.periodMeasure.findMany({
        where: { communityId, periodId: period.id, scopeType: 'UNIT', typeCode },
        select: { scopeId: true, value: true, meterId: true },
      })
    }
    return this.prisma.$queryRawUnsafe(
      `select distinct on (pm.scope_id)
              pm.scope_id as "scopeId", pm.value, pm.meter_id as "meterId"
         from period_measure pm
         join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.type_code = $2
          and pm.scope_type::text = 'UNIT' and p.seq <= $3
        order by pm.scope_id, p.seq desc`,
      communityId, typeCode, period.seq,
    )
  }

  async createExpense(
    communityId: string,
    period: PeriodRef,
    input: {
      description: string
      amount: number
      currency?: string
      expenseTypeId?: string
      expenseTypeCode?: string
      sourceType?: ChargeSourceType
      sourceId?: string
      sourceKey?: string | null
      fundId?: string | null
      allocationMethod?: string
      allocationParams?: any
      splits?: any[]
    },
  ) {
    if (!input.description || typeof input.description !== 'string') {
      throw new ForbiddenException('Description required')
    }
    if (typeof input.amount !== 'number' || Number.isNaN(input.amount)) {
      throw new ForbiddenException('Amount required')
    }
    let expenseTypeCode: string | null = input.expenseTypeCode ?? null
    if (input.expenseTypeId || input.expenseTypeCode) {
      const type = await this.prisma.expenseType.findFirst({
        where: {
          communityId,
          ...(input.expenseTypeId ? { id: input.expenseTypeId } : {}),
          ...(input.expenseTypeCode ? { code: input.expenseTypeCode } : {}),
        },
        select: { id: true, code: true, params: true },
      })
      if (!type) throw new NotFoundException('Expense type not found for community')
      expenseTypeCode = type.code
      input.expenseTypeId = type.id
    }

    const sourceId = input.sourceId || randomUUID()
    const sourceType = input.sourceType ?? ChargeSourceType.EXPENSE
    const sourceKey = input.sourceKey ?? 'default'

    const meterLabels = await this.getMeterLabelMap(communityId, period.id)
    // allocation_trace is tied to allocation_line/expense; skip when using charges

    const getSplitName = (node: any) => {
      return (
        node?.name ||
        node?.splitNode?.name ||
        node?.split_node?.name ||
        node?._storedMeta?.name ||
        node?._storedMeta?.splitNode?.name ||
        node?._storedMeta?.split_node?.name ||
        node?.id ||
        null
      )
    }

    const normalizeAllocationConfig = (alloc: any) => {
      if (!alloc) return null
      return {
        method: alloc.method ?? null,
        ruleCode: alloc.ruleCode ?? null,
        basis: alloc.basis ?? null,
        weightSource: alloc.weightSource ?? null,
        params: alloc.params ?? null,
        weights: alloc.weights ?? alloc.values ?? null,
      }
    }

    const attachAllocationMeasures = (
      trail: any[],
      unitMeasure?: number | null,
      totalMeasure?: number | null,
      meterId?: string | null,
      meterLabel?: string | null,
    ) => {
      if (!Array.isArray(trail) || !trail.length) return trail
      if (typeof unitMeasure !== 'number' || typeof totalMeasure !== 'number') return trail
      const copy = trail.slice()
      const last = copy[copy.length - 1] ?? {}
      const allocation = { ...(last.allocation ?? {}), unitMeasure, totalMeasure }
          if (meterId) {
            allocation.meterId = meterId
            if (meterLabel) allocation.meterLabel = meterLabel
          }
          if (totalMeasure != null) {
            allocation.totalMeterValue = totalMeasure
          }
      copy[copy.length - 1] = { ...last, allocation }
      return copy
    }

    const attachAllocationInfo = (
      trail: any[],
      info: { method?: string | null; weightSource?: string | null; basis?: any | null },
    ) => {
      if (!Array.isArray(trail) || !trail.length) return trail
      const copy = trail.slice()
      const last = copy[copy.length - 1] ?? {}
      const allocation = {
        ...(last.allocation ?? {}),
        method: info.method ?? (last.allocation?.method ?? null),
        weightSource: info.weightSource ?? (last.allocation?.weightSource ?? null),
        basis: info.basis ?? (last.allocation?.basis ?? null),
      }
      copy[copy.length - 1] = { ...last, allocation }
      return copy
    }

    const buildTrace = (inputTrace: {
      origin: 'split' | 'one-off'
      unit: { id: string; code: string }
      amount: number
      method?: string | null
      basis?: any
      weight?: number | null
      weightSource?: string | null
      unitMeasure?: number | null
      totalMeasure?: number | null
      splitId?: string | null
      splitNodeId?: string | null
      splitTrail?: any[]
      ruleId?: string | null
      ruleCode?: string | null
      allocationParams?: any
      allocationConfig?: any
    }) => {
      return {
        version: 1,
        generatedAt: new Date().toISOString(),
        origin: inputTrace.origin,
        expense: {
          id: sourceId,
          description: input.description,
          allocatableAmount: input.amount,
          currency: input.currency || 'RON',
          expenseTypeId: input.expenseTypeId ?? null,
          communityId,
          periodId: period.id,
        },
        unit: {
          id: inputTrace.unit.id,
          code: inputTrace.unit.code,
        },
        allocation: {
          amount: inputTrace.amount,
          method: inputTrace.method ?? null,
          basis: inputTrace.basis ?? null,
          weight: inputTrace.weight ?? null,
          weightSource: inputTrace.weightSource ?? null,
          unitMeasure: inputTrace.unitMeasure ?? null,
          totalMeasure: inputTrace.totalMeasure ?? null,
        },
        split: inputTrace.splitId
          ? {
              expenseSplitId: inputTrace.splitId,
              splitNodeId: inputTrace.splitNodeId ?? null,
              trail: inputTrace.splitTrail ?? [],
            }
          : null,
        rule: {
          id: inputTrace.ruleId ?? null,
          code: inputTrace.ruleCode ?? null,
        },
        inputs: {
          allocationParams: inputTrace.allocationParams ?? null,
          allocationConfig: inputTrace.allocationConfig ?? null,
        },
      }
    }

    const writeTrace = async (_payload: {
      allocationLineId: string
      unitId: string
      expenseSplitId?: string | null
      splitNodeId?: string | null
      trace: any
    }) => {
      return
    }

    let splitsToUse = input.splits
    if ((!splitsToUse || !splitsToUse.length) && input.expenseTypeId) {
      const et = await this.prisma.expenseType.findUnique({
        where: { id: input.expenseTypeId },
        select: { params: true, code: true },
      })
      if (et?.code) expenseTypeCode = et.code
      const tmpl: any = (et?.params as any)?.splitTemplate
      if (tmpl) splitsToUse = Array.isArray(tmpl) ? tmpl : tmpl.splits ?? []
    }

    const beMemberships = await this.prisma.billingEntityMember.findMany({
      where: {
        billingEntity: { communityId },
        startSeq: { lte: period.seq },
        OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
      },
      select: { unitId: true, billingEntityId: true },
    })
    const unitBe = new Map<string, string>()
    beMemberships.forEach((m) => unitBe.set(m.unitId, m.billingEntityId))

    const resolveFundId = async (expType?: string | null): Promise<string> => {
      if (!expType) throw new ForbiddenException('expenseTypeCode required to resolve fund')
      const exp = await this.prisma.expenseType.findUnique({
        where: { code_communityId: { code: expType, communityId } },
        select: { params: true },
      })
      const fundCode = (exp?.params as any)?.fundCode
      if (!fundCode) throw new ForbiddenException(`Expense type ${expType} missing fundCode`)
      const fund = await this.prisma.fund.findUnique({
        where: { communityId_code: { communityId, code: fundCode } },
        select: { id: true },
      })
      if (!fund?.id) throw new ForbiddenException(`Fund ${fundCode} not found`)
      return fund.id
    }

    const defaultFundId = await resolveFundId(expenseTypeCode)

    const linesByFund = new Map<string, Array<{ unitId: string; beId: string; amount: number; meta?: any }>>()
    const splitNodeIdsByFund = new Map<string, Set<string>>()

    if (splitsToUse && Array.isArray(splitsToUse) && splitsToUse.length) {
      const resolveShares = async (siblings: any[]) => {
        const explicit = siblings.filter((s) => typeof s.share === 'number')
        const remainder = siblings.filter((s) => s.derivedShare === 'remainder')
        let derivedSum = 0
        for (const s of siblings.filter((s) => s.derivedShare && s.derivedShare !== 'remainder')) {
          const d = s.derivedShare
          if (d.totalMeterId && d.partMeterId) {
            try {
              const total = await this.getMeterValue(d.totalMeterId, period.id, communityId)
              const part = await this.getMeterValue(d.partMeterId, period.id, communityId)
              if (total <= 0) throw new ForbiddenException(`Total meter ${d.totalMeterId} is zero`)
              s._resolvedShare = part / total
              s._derivedMeters = {
                totalMeterId: d.totalMeterId,
                partMeterId: d.partMeterId,
                totalValue: total,
                partValue: part,
                totalMeterLabel: meterLabels.get(d.totalMeterId) || null,
                partMeterLabel: meterLabels.get(d.partMeterId) || null,
              }
              derivedSum += s._resolvedShare
            } catch (err: any) {
              const msg = String(err?.message || '')
              if (msg.includes('Missing measure for meter')) {
                s._resolvedShare = 0
                s._derivedMeters = {
                  totalMeterId: d.totalMeterId,
                  partMeterId: d.partMeterId,
                  totalValue: 0,
                  partValue: 0,
                  totalMeterLabel: meterLabels.get(d.totalMeterId) || null,
                  partMeterLabel: meterLabels.get(d.partMeterId) || null,
                }
              } else {
                throw err
              }
            }
          } else {
            throw new ForbiddenException('Derived share missing meter definition')
          }
        }
        let sum = explicit.reduce((acc, s) => acc + Number(s.share || 0), 0) + derivedSum
        if (sum > 1 + 1e-6) {
          const scale = 1 / sum
          siblings.forEach((s: any) => {
            if (s._resolvedShare != null) s._resolvedShare = Number(s._resolvedShare) * scale
            else if (s.share != null) s._resolvedShare = Number(s.share) * scale
          })
          derivedSum = siblings.reduce((acc: number, s: any) => (s._resolvedShare ? acc + s._resolvedShare : acc), 0)
          sum = derivedSum
        }
        if (remainder.length > 1) throw new ForbiddenException('Only one remainder split allowed')
        const remaining = 1 - sum
        if (remaining < -1e-6) throw new ForbiddenException('No remaining share for remainder')
        if (remainder.length === 0 && remaining > 1e-6) {
          const explicitSum = explicit.reduce((acc, s) => acc + Number(s.share || 0), 0)
          if (derivedSum > 0) {
            const scale = (1 - explicitSum) / derivedSum
            siblings.forEach((s: any) => {
              if (s._resolvedShare != null) s._resolvedShare = Number(s._resolvedShare) * scale
            })
            derivedSum = siblings.reduce((acc: number, s: any) => (s._resolvedShare ? acc + s._resolvedShare : acc), 0)
          } else {
            const derivedTargets = siblings.filter((s: any) => s.derivedShare)
            const targetCount = derivedTargets.length
            if (targetCount === 0) {
              throw new ForbiddenException('No remainder and no derived shares to absorb remaining allocation')
            }
            const per = remaining / targetCount
            derivedTargets.forEach((s: any) => {
              s._resolvedShare = (Number(s._resolvedShare) || 0) + per
            })
            derivedSum = siblings.reduce((acc: number, s: any) => (s._resolvedShare ? acc + s._resolvedShare : acc), 0)
          }
          sum = explicitSum + derivedSum
        }
        explicit.forEach((s) => (s._resolvedShare = Number(s.share)))
        if (remainder.length === 1) remainder[0]._resolvedShare = remaining
      }

      const getUnitsForBasis = async (basis: any): Promise<Array<{ id: string; code: string }>> => {
        if (!basis || !basis.type || basis.type === 'COMMUNITY') {
          return await this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
        }
        if (basis.type === 'GROUP') {
          const g = await this.prisma.unitGroup.findUnique({
            where: { code_communityId: { code: basis.code, communityId } },
            select: { id: true },
          })
          if (!g) throw new NotFoundException(`Group ${basis.code} not found`)
          const members = await this.prisma.unitGroupMember.findMany({
            where: {
              groupId: g.id,
              startSeq: { lte: period.seq },
              OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
            },
            select: { unit: { select: { id: true, code: true } } },
          })
          return members.map((m) => m.unit)
        }
        if (basis.type === 'UNIT') {
          const u = await this.prisma.unit.findUnique({
            where: { code_communityId: { code: basis.code, communityId } },
            select: { id: true, code: true },
          })
          if (!u) throw new NotFoundException(`Unit ${basis.code} not found`)
          return [u]
        }
        return []
      }

      const allocateLeaf = async (leaf: any, amount: number, splitId: string, splitTrail: any[]) => {
        const alloc = { ...(leaf.allocation ?? {}) }
        if (alloc.ruleCode && !alloc.method) {
          let rule = await this.prisma.allocationRule.findUnique({ where: { id: String(alloc.ruleCode) } })
          if (!rule) {
            const where: any = { communityId, method: String(alloc.ruleCode) }
            if (alloc.params !== undefined && alloc.params !== null) {
              where.params = { equals: alloc.params }
            } else {
              where.OR = [{ params: { equals: Prisma.JsonNull } }, { params: { equals: {} } }]
            }
            rule = await this.prisma.allocationRule.findFirst({ where })
          }
          if (!rule) throw new ForbiddenException(`Allocation rule ${alloc.ruleCode} missing`)
          alloc.method = rule.method as any
          alloc.params = { ...(rule.params as any) }
        }
        if (!alloc?.method) throw new ForbiddenException('Allocation method required on split leaf')
        const method = alloc.method as AllocationMethod
        const basis = (leaf.allocation as any)?.basis
        const units = await getUnitsForBasis(basis)
        if (!units.length) throw new ForbiddenException('No units in basis for allocation')
        const perUnit: Record<string, { weight: number; amount: number }> = {}
        const weightsObj = alloc.weights || alloc.values
        if (weightsObj && typeof weightsObj === 'object') {
          const entries = Object.entries(weightsObj as Record<string, any>)
          const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0)
          if (total <= 0) throw new ForbiddenException('Weights total is zero')
          for (const [unitCode, raw] of entries) {
            const unit = units.find((u) => u.code === unitCode)
            if (!unit) continue
            const weight = (Number(raw) || 0) / total
            const amt = amount * weight
            perUnit[unitCode] = { weight, amount: amt }
            const beId = unitBe.get(unit.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: leaf?.id ?? null,
              allocation: { method, basis, weightSource: 'explicit', unitMeasure: Number(raw), totalMeasure: total, base: amount },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: unit.id, beId, amount: amt, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            if (leaf?.id) {
              const set = splitNodeIdsByFund.get(fundId) ?? new Set<string>()
              set.add(leaf.id)
              splitNodeIdsByFund.set(fundId, set)
            }
            const trailWithAlloc = attachAllocationInfo(splitTrail, {
              method,
              weightSource: 'explicit',
              basis,
            })
            const trace = buildTrace({
              origin: 'split',
              unit,
              amount: amt,
              method,
              basis,
              weight,
              weightSource: 'explicit',
              splitId,
              splitNodeId: leaf?.id ?? null,
              splitTrail: trailWithAlloc,
              ruleCode: alloc.ruleCode ?? null,
              allocationParams: alloc.params ?? null,
              allocationConfig: normalizeAllocationConfig(alloc),
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: unit.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating split leaf with explicit weights',
            {
              splitId,
              perUnit,
              totalAmount: amount,
            },
            input.description,
          )
          return
        }

        let typeCode: string | null = null
        const paramWeight = (alloc.params as any)?.weightSource
        if (method === 'BY_RESIDENTS') typeCode = 'RESIDENTS'
        else if (method === 'BY_SQM') typeCode = 'SQM'
        else if (method === 'BY_CONSUMPTION') typeCode = alloc.weightSource || paramWeight || 'CONSUMPTION'
        else if (method === 'EQUAL') typeCode = null
        else throw new ForbiddenException(`Unsupported allocation method ${method}`)

        if (method === 'EQUAL') {
          const per = amount / units.length
          for (const u of units) {
            perUnit[u.code] = { weight: 1 / units.length, amount: per }
            const beId = unitBe.get(u.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: leaf?.id ?? null,
              allocation: { method, basis, weightSource: 'equal', unitMeasure: 1, totalMeasure: units.length, base: amount },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: u.id, beId, amount: per, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            if (leaf?.id) {
              const set = splitNodeIdsByFund.get(fundId) ?? new Set<string>()
              set.add(leaf.id)
              splitNodeIdsByFund.set(fundId, set)
            }
            const trailWithAlloc = attachAllocationInfo(splitTrail, {
              method,
              weightSource: 'equal',
              basis,
            })
            const trace = buildTrace({
              origin: 'split',
              unit: { id: u.id, code: u.code },
              amount: per,
              method,
              basis,
              weight: 1 / units.length,
              weightSource: 'equal',
              splitId,
              splitNodeId: leaf?.id ?? null,
              splitTrail: trailWithAlloc,
              ruleCode: alloc.ruleCode ?? null,
              allocationParams: alloc.params ?? null,
              allocationConfig: normalizeAllocationConfig(alloc),
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: u.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating split leaf equally',
            {
              splitId,
              perUnit,
              totalAmount: amount,
            },
            input.description,
          )
          return
        }

        if (!typeCode) throw new ForbiddenException('Missing weight source for allocation')

        const measures = await this.unitMeasuresForWeight(communityId, typeCode, period)
        if (!measures.length) {
          const per = amount / units.length
          for (const u of units) {
            perUnit[u.code] = { weight: 1 / units.length, amount: per }
            const beId = unitBe.get(u.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: leaf?.id ?? null,
              allocation: { method, basis, weightSource: 'equal-fallback', unitMeasure: 1, totalMeasure: units.length, base: amount },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: u.id, beId, amount: per, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            if (leaf?.id) {
              const set = splitNodeIdsByFund.get(fundId) ?? new Set<string>()
              set.add(leaf.id)
              splitNodeIdsByFund.set(fundId, set)
            }
            const trailWithAlloc = attachAllocationInfo(splitTrail, {
              method,
              weightSource: 'equal-fallback',
              basis,
            })
            const trace = buildTrace({
              origin: 'split',
              unit: { id: u.id, code: u.code },
              amount: per,
              method,
              basis,
              weight: 1 / units.length,
              weightSource: 'equal-fallback',
              splitId,
              splitNodeId: leaf?.id ?? null,
              splitTrail: trailWithAlloc,
              ruleCode: alloc.ruleCode ?? null,
              allocationParams: alloc.params ?? null,
              allocationConfig: normalizeAllocationConfig(alloc),
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: u.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating split leaf equally (no measures)',
            {
              splitId,
              perUnit,
              totalAmount: amount,
            },
            input.description,
          )
          return
        }
        const byUnit = new Map<string, { value: number; meterId?: string | null }>()
        measures.forEach((m) => byUnit.set(m.scopeId, { value: Number(m.value), meterId: m.meterId }))
        let missingMeasure = false
        const total = units.reduce((s, u) => {
          const val = byUnit.get(u.id)?.value
          if (val === undefined || val === null) {
            missingMeasure = true
            return s
          }
          return s + val
        }, 0)
        if (missingMeasure) {
          const per = amount / units.length
          for (const u of units) {
            perUnit[u.code] = { weight: 1 / units.length, amount: per }
            const beId = unitBe.get(u.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: leaf?.id ?? null,
              allocation: { method, basis, weightSource: 'equal-fallback', unitMeasure: 1, totalMeasure: units.length, base: amount },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: u.id, beId, amount: per, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            if (leaf?.id) {
              const set = splitNodeIdsByFund.get(fundId) ?? new Set<string>()
              set.add(leaf.id)
              splitNodeIdsByFund.set(fundId, set)
            }
            const trailWithAlloc = attachAllocationInfo(splitTrail, {
              method,
              weightSource: 'equal-fallback',
              basis,
            })
            const trace = buildTrace({
              origin: 'split',
              unit: { id: u.id, code: u.code },
              amount: per,
              method,
              basis,
              weight: 1 / units.length,
              weightSource: 'equal-fallback',
              splitId,
              splitNodeId: leaf?.id ?? null,
              splitTrail: trailWithAlloc,
              ruleCode: alloc.ruleCode ?? null,
              allocationParams: alloc.params ?? null,
              allocationConfig: normalizeAllocationConfig(alloc),
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: u.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating split leaf equally (missing measures)',
            {
              splitId,
              perUnit,
              totalAmount: amount,
            },
            input.description,
          )
          return
        }
        if (total <= 0) throw new ForbiddenException(`Total ${typeCode} is zero for allocation`)

        for (const u of units) {
          const unitData = byUnit.get(u.id)!
          const val = unitData.value
          const meterId = unitData.meterId ?? null
          const meterLabel = meterId ? meterLabels.get(meterId) || null : null
          const weight = val / total
          const amt = amount * weight
          perUnit[u.code] = { weight, amount: amt }
          const beId = unitBe.get(u.id)
          if (!beId) continue
          const fundId = defaultFundId
          const lineMeta = {
            source: 'ALLOC',
            expenseType: expenseTypeCode,
            splitNodeId: leaf?.id ?? null,
            allocation: { method, basis, weightSource: typeCode, unitMeasure: val, totalMeasure: total, base: amount },
          }
          const fundLines = linesByFund.get(fundId) ?? []
          fundLines.push({ unitId: u.id, beId, amount: amt, meta: lineMeta })
          linesByFund.set(fundId, fundLines)
          if (leaf?.id) {
            const set = splitNodeIdsByFund.get(fundId) ?? new Set<string>()
            set.add(leaf.id)
            splitNodeIdsByFund.set(fundId, set)
          }
          const trailWithAlloc = attachAllocationInfo(splitTrail, {
            method,
            weightSource: typeCode,
            basis,
          })
          const trailWithMeasures = attachAllocationMeasures(trailWithAlloc, val, total, meterId, meterLabel)
          const trace = buildTrace({
            origin: 'split',
            unit: { id: u.id, code: u.code },
            amount: amt,
            method,
            basis,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            splitId,
            splitNodeId: leaf?.id ?? null,
            splitTrail: trailWithMeasures,
            ruleCode: alloc.ruleCode ?? null,
            allocationParams: alloc.params ?? null,
            allocationConfig: normalizeAllocationConfig(alloc),
          })
          await writeTrace({
            allocationLineId: 'n/a',
            unitId: u.id,
            expenseSplitId: splitId,
            splitNodeId: leaf?.id ?? null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          sourceId,
          `Allocating split leaf using ${typeCode}`,
          {
            splitId,
            typeCode,
            perUnit,
            totalAmount: amount,
          },
          input.description,
        )
      }

      const buildSplitTrailEntry = (
        node: any,
        splitId: string,
        splitAmount: number,
        share: number,
        basis: any,
        totalAmount: number,
      ) => {
        const alloc = normalizeAllocationConfig(node.allocation)
        const hasMethod = !!alloc?.method
        return {
          splitId,
          name: getSplitName(node),
          share,
          amount: splitAmount,
          totalAmount,
          derivedShare: node.derivedShare ?? null,
          derivedMeters: node._derivedMeters ?? null,
          allocation: alloc && hasMethod ? { ...alloc, basis: basis ?? null } : undefined,
        }
      }

      const processSplits = async (nodes: any[], amount: number, _parentId: string | null, trail: any[]) => {
        await resolveShares(nodes)
        for (const node of nodes) {
          const share = node._resolvedShare ?? node.share
          if (share == null) throw new ForbiddenException('Split share missing')
          const splitAmount = amount * Number(share)
          const basis = (node.allocation as any)?.basis ?? node.basis
          let splitId = node._existingSplitId
          if (!splitId) splitId = randomUUID()
          const trailEntry = buildSplitTrailEntry(node, splitId, splitAmount, Number(share), basis, amount)
          const nextTrail = trail.concat(trailEntry)
          if (node.children && node.children.length) {
            await processSplits(node.children, splitAmount, splitId, nextTrail)
          } else {
            await allocateLeaf(node, splitAmount, splitId, nextTrail)
          }
        }
      }

      await processSplits(splitsToUse, input.amount, null, [])
      const charges = await this.persistChargesFromLines(communityId, period.id, {
        sourceId,
        sourceType,
        sourceKey,
        fundId: input.fundId ?? null,
        currency: input.currency || 'RON',
        description: input.description,
        allocationStrategy: 'EXPENSE_SPLITS',
        expenseTypeCode,
        splitNodeIdsByFund,
        linesByFund,
      })
      return { ok: true, id: sourceId, charges }
    }

    if (!input.allocationMethod) {
      if (input.expenseTypeId) {
        throw new ForbiddenException('Expense type missing split template')
      }
      throw new ForbiddenException('Allocation method or split definition required')
    }

    if (input.allocationMethod) {
      const method = input.allocationMethod as AllocationMethod
      await this.logAllocation(communityId, period.id, sourceId, `One-off allocation method=${method}`, undefined, input.description)
      const precomputed = input.allocationParams?.perUnit || input.allocationParams?.allocations
      if (Array.isArray(precomputed) && precomputed.length) {
        const perUnit: Record<string, { weight: number; amount: number }> = {}
        let total = 0
        for (const entry of precomputed) total += Number(entry.amount) || 0
        if (total <= 0) throw new ForbiddenException('Precomputed allocations total is zero')
        for (const entry of precomputed) {
          const unitCode = entry.unitCode || entry.code
          if (!unitCode) continue
          const unit = await this.prisma.unit.findUnique({
            where: { code_communityId: { code: unitCode, communityId } },
            select: { id: true, code: true },
          })
          if (!unit) continue
          const amount = Number(entry.amount) || 0
          const weight = amount / total
          perUnit[unitCode] = { weight, amount }
          const beId = unitBe.get(unit.id)
          if (!beId) continue
          const fundId = defaultFundId
          const lineMeta = {
            source: 'ALLOC',
            expenseType: expenseTypeCode,
            splitNodeId: null,
            allocation: { method, weightSource: 'explicit' },
          }
          const fundLines = linesByFund.get(fundId) ?? []
          fundLines.push({ unitId: unit.id, beId, amount, meta: lineMeta })
          linesByFund.set(fundId, fundLines)
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: unit.id, code: unit.code },
            amount,
            method,
            weight,
            weightSource: 'explicit',
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: 'n/a',
            unitId: unit.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          sourceId,
          'Allocating using precomputed per-unit amounts',
          {
            totalAmount: input.amount,
            perUnit,
          },
          input.description,
        )
        const charges = await this.persistChargesFromLines(communityId, period.id, {
          sourceId,
          sourceType,
          sourceKey,
          fundId: input.fundId ?? null,
          currency: input.currency || 'RON',
          description: input.description,
          allocationStrategy: method,
          expenseTypeCode,
          splitNodeIdsByFund,
          linesByFund,
        })
        return { ok: true, id: sourceId, charges }
      }

      const weights = input.allocationParams?.weights || input.allocationParams?.values
      if (weights && typeof weights === 'object') {
        const entries = Object.entries(weights as Record<string, any>)
        const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0)
        if (total <= 0) throw new ForbiddenException('Weights total is zero')
        const perUnit: Record<string, { weight: number; amount: number }> = {}
        const normalized = new Map<string, number>()
        for (const [unitCode, raw] of entries) {
          normalized.set(unitCode, (Number(raw) || 0) / total)
        }
        for (const [unitCode, raw] of entries) {
          const unit = await this.prisma.unit.findUnique({
            where: { code_communityId: { code: unitCode, communityId } },
            select: { id: true, code: true },
          })
          if (!unit) continue
          const share = (Number(raw) || 0) / total
          const amount = Number(input.amount) * share
          perUnit[unitCode] = { weight: share, amount }
          const beId = unitBe.get(unit.id)
          if (!beId) continue
          const fundId = defaultFundId
          const lineMeta = {
            source: 'ALLOC',
            expenseType: expenseTypeCode,
            splitNodeId: null,
            allocation: { method, weightSource: 'explicit' },
          }
          const fundLines = linesByFund.get(fundId) ?? []
          fundLines.push({ unitId: unit.id, beId, amount, meta: lineMeta })
          linesByFund.set(fundId, fundLines)
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: unit.id, code: unit.code },
            amount,
            method,
            weight: share,
            weightSource: 'explicit',
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: 'n/a',
            unitId: unit.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          sourceId,
          'Allocating using provided weights',
          {
            totalWeight: total,
            units: entries.length,
            normalized: this.mapToObj(normalized),
            perUnit,
            totalAmount: input.amount,
          },
          input.description,
        )
      } else {
        let typeCode: string | null = null
        if (method === 'BY_RESIDENTS') typeCode = 'RESIDENTS'
        else if (method === 'BY_SQM') typeCode = 'SQM'
        else if (method === 'BY_CONSUMPTION') typeCode = 'CONSUMPTION'
        else throw new ForbiddenException(`Allocation method ${method} requires explicit weights`)

        const units = await this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
        const perUnit: Record<string, { weight: number; amount: number }> = {}
        const measures = await this.unitMeasuresForWeight(communityId, typeCode, period)
        if (!measures.length) {
          const per = Number(input.amount) / units.length
          for (const u of units) {
            const amount = per
            perUnit[u.code] = { weight: 1 / units.length, amount }
            const beId = unitBe.get(u.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: null,
              allocation: { method, weightSource: 'equal-fallback' },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: u.id, beId, amount, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            const trace = buildTrace({
              origin: 'one-off',
              unit: { id: u.id, code: u.code },
              amount,
              method,
              weight: 1 / units.length,
              weightSource: 'equal-fallback',
              allocationParams: input.allocationParams ?? null,
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: u.id,
              expenseSplitId: null,
              splitNodeId: null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating equally (no measures)',
            {
              units: units.length,
              perUnit,
              totalAmount: input.amount,
            },
            input.description,
          )
          return
        }
        const byUnit = new Map(measures.map((m) => [m.scopeId, Number(m.value)]))
        let missingMeasure = false
        const total = units.reduce((s, u) => {
          const val = byUnit.get(u.id)
          if (val === undefined || val === null) {
            missingMeasure = true
            return s
          }
          return s + val
        }, 0)
        if (missingMeasure) {
          const per = Number(input.amount) / units.length
          for (const u of units) {
            const amount = per
            perUnit[u.code] = { weight: 1 / units.length, amount }
            const beId = unitBe.get(u.id)
            if (!beId) continue
            const fundId = defaultFundId
            const lineMeta = {
              source: 'ALLOC',
              expenseType: expenseTypeCode,
              splitNodeId: null,
              allocation: { method, weightSource: 'equal-fallback' },
            }
            const fundLines = linesByFund.get(fundId) ?? []
            fundLines.push({ unitId: u.id, beId, amount, meta: lineMeta })
            linesByFund.set(fundId, fundLines)
            const trace = buildTrace({
              origin: 'one-off',
              unit: { id: u.id, code: u.code },
              amount,
              method,
              weight: 1 / units.length,
              weightSource: 'equal-fallback',
              allocationParams: input.allocationParams ?? null,
            })
            await writeTrace({
              allocationLineId: 'n/a',
              unitId: u.id,
              expenseSplitId: null,
              splitNodeId: null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            sourceId,
            'Allocating equally (missing measures)',
            {
              units: units.length,
              perUnit,
              totalAmount: input.amount,
            },
            input.description,
          )
          return
        }
        if (total <= 0) throw new ForbiddenException(`Total ${typeCode} is zero for allocation`)

        for (const u of units) {
          const val = byUnit.get(u.id)!
          const weight = val / total
          const amount = Number(input.amount) * weight
          perUnit[u.code] = { weight, amount }
          const beId = unitBe.get(u.id)
          if (!beId) continue
          const fundId = defaultFundId
          const lineMeta = {
            source: 'ALLOC',
            expenseType: expenseTypeCode,
            splitNodeId: null,
            allocation: { method, weightSource: typeCode, unitMeasure: val, totalMeasure: total },
          }
          const fundLines = linesByFund.get(fundId) ?? []
          fundLines.push({ unitId: u.id, beId, amount, meta: lineMeta })
          linesByFund.set(fundId, fundLines)
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: u.id, code: u.code },
            amount,
            method,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: 'n/a',
            unitId: u.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(communityId, period.id, sourceId, `Allocating using ${typeCode} measures`, {
          typeCode,
          totalMeasure: total,
          units: units.length,
          perUnit,
          totalAmount: input.amount,
        })
      }
    }
    const charges = await this.persistChargesFromLines(communityId, period.id, {
      sourceId,
      sourceType,
      sourceKey,
      fundId: input.fundId ?? null,
      currency: input.currency || 'RON',
      description: input.description,
      allocationStrategy: input.allocationMethod ?? 'UNKNOWN',
      expenseTypeCode,
      splitNodeIdsByFund,
      linesByFund,
    })
    return { ok: true, id: sourceId, charges }
  }

  private mapToObj(map: Map<string, number>) {
    const out: Record<string, number> = {}
    for (const [k, v] of map.entries()) out[k] = v
    return out
  }

  private async getMeterLabelMap(communityId: string, periodId: string) {
    const measures = await this.prisma.periodMeasure.findMany({
      where: { communityId, periodId },
      select: { meterId: true, provenance: true },
    })
    const map = new Map<string, string>()
    measures.forEach((m) => {
      if (!m.meterId) return
      const prov: any = m.provenance
      const label = prov?.itemLabel || prov?.templateName || prov?.templateCode
      if (label) map.set(m.meterId, label)
    })
    // Fallback to meter name/notes as a friendly label if provenance was not captured
    const meterRepo: any = (this.prisma as any).meter
    if (meterRepo?.findMany) {
      const meters = await meterRepo.findMany({
        select: { meterId: true, name: true, notes: true },
      })
      meters.forEach((m: any) => {
        if (!m?.meterId) return
        if (map.has(m.meterId)) return
        if (m.name) map.set(m.meterId, m.name)
        else if (m.notes) map.set(m.meterId, m.notes)
      })
    }
    return map
  }

  private async getMeterValue(meterId: string, periodId: string, communityId: string) {
    const meterRepo: any = (this.prisma as any).meter
    if (!meterRepo) throw new ForbiddenException('Meter model not available')
    const meter = await meterRepo.findUnique({ where: { meterId } })
    if (!meter) throw new NotFoundException(`Meter ${meterId} not found`)

    if (meter.scopeType === 'COMMUNITY') {
      const pm = await this.prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId,
            scopeType: 'COMMUNITY' as any,
            scopeId: communityId,
            typeCode: meter.typeCode,
          },
        },
      })
      if (!pm) throw new ForbiddenException(`Missing measure for meter ${meterId}`)
      return Number(pm.value)
    }

    if (meter.scopeType === 'GROUP') {
      const group = await this.prisma.unitGroup.findUnique({
        where: { code_communityId: { code: meter.scopeCode, communityId } },
        select: { id: true },
      })
      if (!group) throw new NotFoundException(`Group ${meter.scopeCode} not found for meter ${meterId}`)
      const pm = await this.prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId: meter.communityId ?? '',
            periodId,
            scopeType: 'GROUP',
            scopeId: group.id,
            typeCode: meter.typeCode,
          },
        },
      })
      if (!pm) throw new ForbiddenException(`Missing measure for meter ${meterId}`)
      return Number(pm.value)
    }

    if (meter.scopeType === 'UNIT') {
      const unit = await this.prisma.unit.findUnique({
        where: { code_communityId: { code: meter.scopeCode, communityId: meter.communityId ?? '' } },
        select: { id: true },
      })
      if (!unit) throw new NotFoundException(`Unit ${meter.scopeCode} not found for meter ${meterId}`)
      const pm = await this.prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId: meter.communityId ?? '',
            periodId,
            scopeType: 'UNIT',
            scopeId: unit.id,
            typeCode: meter.typeCode,
          },
        },
      })
      if (!pm) throw new ForbiddenException(`Missing measure for meter ${meterId}`)
      return Number(pm.value)
    }

    throw new ForbiddenException(`Unsupported meter scopeType ${meter.scopeType} for ${meterId}`)
  }

  private async logAllocation(
    _communityId: string,
    _periodId: string,
    _expenseId: string,
    _message: string,
    _details?: any,
    _expenseDesc?: string,
  ) {
    return
  }

  private async persistChargesFromLines(
    communityId: string,
    periodId: string,
    input: {
      sourceType?: ChargeSourceType
      sourceId: string
      sourceKey?: string | null
      fundId?: string | null
      currency: string
      description: string
      allocationStrategy: string
      expenseTypeCode?: string | null
      splitNodeIdsByFund: Map<string, Set<string>>
      linesByFund: Map<string, Array<{ unitId: string; beId: string; amount: number; meta?: any }>>
    },
  ) {
    const sourceType = input.sourceType ?? ChargeSourceType.EXPENSE
    const sourceKey = input.sourceKey ?? 'default'
    const results: Array<{ fundId: string; chargeId: string }> = []
    for (const [fundIdKey, lines] of input.linesByFund.entries()) {
      const amount = lines.reduce((s, l) => s + Number(l.amount || 0), 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const charge = await this.prisma.communityCharge.upsert({
        where: {
          communityId_periodId_sourceType_sourceId_sourceKey_fundId: {
            communityId,
            periodId,
            sourceType,
            sourceId: input.sourceId,
            sourceKey,
            fundId: fundIdKey,
          },
        },
        update: {
          amount,
          currency: input.currency || 'RON',
          allocationStrategy: input.allocationStrategy,
          allocationSnapshot: {
            expenseType: input.expenseTypeCode ?? null,
            splitNodeIds: Array.from(input.splitNodeIdsByFund.get(fundIdKey) ?? []),
          },
          status: 'ACTIVE',
          meta: { description: input.description },
          fundId: fundIdKey,
        },
        create: {
          communityId,
          periodId,
          fundId: fundIdKey,
          sourceType,
          sourceId: input.sourceId,
          sourceKey,
          amount,
          currency: input.currency || 'RON',
          allocationStrategy: input.allocationStrategy,
          allocationSnapshot: {
            expenseType: input.expenseTypeCode ?? null,
            splitNodeIds: Array.from(input.splitNodeIdsByFund.get(fundIdKey) ?? []),
          },
          status: 'ACTIVE',
          meta: { description: input.description },
        },
        select: { id: true },
      })
      await this.prisma.communityChargeLine.deleteMany({ where: { chargeId: charge.id } })
      await this.prisma.communityChargeLine.createMany({
        data: lines.map((line) => ({
          chargeId: charge.id,
          communityId,
          periodId,
          billingEntityId: line.beId,
          unitId: line.unitId,
          amount: line.amount,
          meta: line.meta,
        })),
        skipDuplicates: true,
      })
      results.push({ fundId: fundIdKey, chargeId: charge.id })
    }
    return results
  }
}
