import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { AllocationMethod } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'

type PeriodRef = { id: string; seq: number; code: string }

@Injectable()
export class AllocationService {
  private formatDisplay(meta: any, ctx?: { description?: string; amount?: number; meterLabels?: Map<string, string> }) {
    const subject = meta?.splitNode?.name || meta?.splitNode?.id || ctx?.description || meta?.allocationMethod || 'allocation'
    const method = meta?.allocation?.method || meta?.allocationMethod
    const basis = meta?.allocation?.basis || meta?.basis
    const weight = meta?.weightSource || meta?.allocation?.weightSource
    const unitMeasure = meta?.unitMeasure
    const totalMeasure = meta?.totalMeasure
    const derived = meta?.splitNode?.derivedShare
    const meterLookup = ctx?.meterLabels

    const totalMeterLabel =
      (derived?.totalMeterId && meterLookup?.get(derived.totalMeterId)) || derived?.totalMeterLabel || null
    const partMeterLabel =
      (derived?.partMeterId && meterLookup?.get(derived.partMeterId)) || derived?.partMeterLabel || null

    let displayKey = 'alloc.leaf.generic'
    if (weight === 'explicit') displayKey = 'alloc.leaf.explicit'
    else if (weight === 'equal') displayKey = 'alloc.leaf.equal'
    else if (typeof unitMeasure === 'number' && typeof totalMeasure === 'number') displayKey = 'alloc.leaf.measure'
    if (derived?.meterType) displayKey = 'alloc.leaf.derived'

    const displayParams: any = {
      subject,
      method,
      basisType: basis?.type,
      basisCode: basis?.code,
      weightSource: weight,
      unitMeasure,
      totalMeasure,
      meterType: derived?.meterType,
      totalMeterId: totalMeterLabel || derived?.totalMeterId,
      partMeterId: partMeterLabel || derived?.partMeterId,
      totalMeterLabel,
      partMeterLabel,
      amount: ctx?.amount,
      expenseDescription: ctx?.description,
    }

    const parts: string[] = []
    if (method && basis?.type) {
      parts.push(`${subject}: ${method} on ${basis.type}${basis.code ? `:${basis.code}` : ''}`)
    } else if (method) {
      parts.push(`${subject}: ${method}`)
    } else {
      parts.push(subject)
    }
    if (weight) parts.push(`weight source ${weight}`)
    if (typeof unitMeasure === 'number' && typeof totalMeasure === 'number') {
      parts.push(`measure ${unitMeasure}/${totalMeasure}`)
    }
    if (derived?.meterType) {
      const tot = derived.totalMeterId ? `/${totalMeterLabel || derived.totalMeterId}` : ''
      const part = derived.partMeterId ? ` part=${partMeterLabel || derived.partMeterId}` : ''
      parts.push(`derived from ${derived.meterType}${tot}${part}`)
    }
    if (typeof ctx?.amount === 'number') parts.push(`amount ${ctx.amount}`)

    return { display: parts.join('. '), displayKey, displayParams }
  }

  constructor(private readonly prisma: PrismaService) {}

  async createExpense(
    communityId: string,
    period: PeriodRef,
    input: {
      description: string
      amount: number
      currency?: string
      expenseTypeId?: string
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
    if (input.expenseTypeId) {
      const type = await this.prisma.expenseType.findFirst({ where: { id: input.expenseTypeId, communityId } })
      if (!type) throw new NotFoundException('Expense type not found for community')
    }

    const existing = input.expenseTypeId
      ? await this.prisma.expense.findFirst({
          where: { periodId: period.id, communityId, expenseTypeId: input.expenseTypeId },
          select: { id: true },
        })
      : null

    let expId: string
    if (existing) {
      expId = existing.id
      // previously logged; no console logging now
      const vectors = await this.prisma.weightVector.findMany({ where: { expenseId: expId }, select: { id: true } })
      if (vectors.length) {
        await this.prisma.weightItem.deleteMany({ where: { vectorId: { in: vectors.map((v) => v.id) } } })
        await this.prisma.weightVector.deleteMany({ where: { id: { in: vectors.map((v) => v.id) } } })
      }
      await this.prisma.allocationLine.deleteMany({ where: { expenseId: expId } })
      const detailRepo: any = (this.prisma as any).allocationLineDetail
      if (detailRepo?.deleteMany) {
        await detailRepo.deleteMany({ where: { expenseId: expId } })
      }
      await this.prisma.expense.update({
        where: { id: expId },
        data: {
          description: input.description,
          allocatableAmount: input.amount,
          currency: input.currency || 'RON',
        },
      })
    } else {
      const created = await this.prisma.expense.create({
        data: {
          communityId,
          periodId: period.id,
          description: input.description,
          allocatableAmount: input.amount,
          currency: input.currency || 'RON',
          targetType: 'COMMUNITY',
          targetId: communityId,
          expenseTypeId: input.expenseTypeId ?? null,
        },
        select: { id: true },
      })
      expId = created.id
    }

    const meterLabels = await this.getMeterLabelMap(communityId, period.id)
    const traceRepo: any = (this.prisma as any).allocationTrace

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
          id: expId,
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

    const writeTrace = async (payload: {
      allocationLineId: string
      unitId: string
      expenseSplitId?: string | null
      splitNodeId?: string | null
      trace: any
    }) => {
      if (!traceRepo?.upsert) return
      await traceRepo.upsert({
        where: { allocationLineId: payload.allocationLineId },
        update: {
          trace: payload.trace,
          expenseSplitId: payload.expenseSplitId ?? null,
          splitNodeId: payload.splitNodeId ?? null,
        },
        create: {
          allocationLineId: payload.allocationLineId,
          communityId,
          periodId: period.id,
          expenseId: expId,
          unitId: payload.unitId,
          expenseSplitId: payload.expenseSplitId ?? null,
          splitNodeId: payload.splitNodeId ?? null,
          trace: payload.trace,
        },
      })
    }

    let splitsToUse = input.splits
    const splitRepo = (this.prisma as any).expenseSplit
    if ((!splitsToUse || !splitsToUse.length) && splitRepo?.findMany) {
      const existingSplits = await splitRepo.findMany({
        where: { expenseId: expId },
        select: {
          id: true,
          parentSplitId: true,
          share: true,
          amount: true,
          basisType: true,
          basisCode: true,
          meta: true,
        },
      })
      if (existingSplits.length) {
        const byId = new Map<string, any>()
        for (const s of existingSplits) {
          const meta = (s.meta as any) ?? {}
          const basis =
            meta.basis ??
            meta?.allocation?.basis ??
            (s.basisType || s.basisCode ? { type: s.basisType, code: s.basisCode } : undefined)
          const derivedShare = meta.derivedShare ?? meta.derived_share
          const node: any = {
            ...meta,
            share: meta.share ?? (derivedShare == null && s.share != null ? Number(s.share) : undefined),
            derivedShare,
            allocation: meta.allocation ?? meta.alloc,
            basis,
            _existingSplitId: s.id,
            _parentSplitId: s.parentSplitId ?? null,
            _storedMeta: meta,
          }
          delete node.children
          byId.set(s.id, node)
        }
        const roots: any[] = []
        for (const node of byId.values()) {
          const parentId = node._parentSplitId
          if (parentId && byId.has(parentId)) {
            const parent = byId.get(parentId)
            if (!parent.children) parent.children = []
            parent.children.push(node)
          } else {
            roots.push(node)
          }
        }
        splitsToUse = roots
      }
    }
    if ((!splitsToUse || !splitsToUse.length) && input.expenseTypeId) {
      const et = await this.prisma.expenseType.findUnique({ where: { id: input.expenseTypeId }, select: { params: true } })
      const tmpl: any = (et?.params as any)?.splitTemplate
      if (tmpl) splitsToUse = Array.isArray(tmpl) ? tmpl : tmpl.splits ?? []
    }

    if (splitsToUse && Array.isArray(splitsToUse) && splitsToUse.length) {
      const allocationLineRepo: any = (this.prisma as any).allocationLine

      const resolveShares = async (siblings: any[]) => {
        const explicit = siblings.filter((s) => typeof s.share === 'number')
        const remainder = siblings.filter((s) => s.derivedShare === 'remainder')
        let derivedSum = 0
        for (const s of siblings.filter((s) => s.derivedShare && s.derivedShare !== 'remainder')) {
          const d = s.derivedShare
          if (d.totalMeterId && d.partMeterId) {
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
          const rule = await this.prisma.allocationRule.findUnique({ where: { id: `${alloc.ruleCode}-${communityId}` } })
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
        const allocationLineRepo: any = (this.prisma as any).allocationLine
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
            const display = this.formatDisplay(
              { allocationMethod: method, basis, weight, weightSource: 'explicit', splitNode: leaf },
              { description: input.description, amount: amt, meterLabels },
            )
            const meta = {
              allocationMethod: method,
              basis: basis ?? null,
              weight,
              weightSource: 'explicit',
              splitNode: leaf,
              display: display.display,
              displayKey: display.displayKey,
              displayParams: display.displayParams,
            }
            const line = await allocationLineRepo.upsert({
              where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: unit.id, expenseSplitId: splitId } },
              update: { amount: { increment: amt }, meta, splitNodeId: leaf?.id ?? null },
              create: {
                communityId,
                periodId: period.id,
                expenseId: expId,
                unitId: unit.id,
                expenseSplitId: splitId,
                amount: amt,
                splitNodeId: leaf?.id ?? null,
                meta,
              },
              select: { id: true },
            })
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
              allocationLineId: line.id,
              unitId: unit.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            expId,
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
            const display = this.formatDisplay(
              { allocationMethod: method, basis, weight: 1 / units.length, weightSource: 'equal', splitNode: leaf },
              { description: input.description, amount: per, meterLabels },
            )
          const meta = {
            allocationMethod: method,
            basis: basis ?? null,
            weight: 1 / units.length,
            weightSource: 'equal',
            splitNode: leaf,
            display: display.display,
            displayKey: display.displayKey,
            displayParams: display.displayParams,
          }
            const line = await allocationLineRepo.upsert({
              where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: u.id, expenseSplitId: splitId } },
              update: { amount: { increment: per }, meta, splitNodeId: leaf?.id ?? null },
              create: {
                communityId,
                periodId: period.id,
                expenseId: expId,
                unitId: u.id,
                expenseSplitId: splitId,
                amount: per,
                splitNodeId: leaf?.id ?? null,
                meta,
              },
              select: { id: true },
            })
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
              allocationLineId: line.id,
              unitId: u.id,
              expenseSplitId: splitId,
              splitNodeId: leaf?.id ?? null,
              trace,
            })
          }
          await this.logAllocation(
            communityId,
            period.id,
            expId,
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

        const measures = await this.prisma.periodMeasure.findMany({
          where: { communityId, periodId: period.id, scopeType: 'UNIT', typeCode },
          select: { scopeId: true, value: true, meterId: true },
        })
        const byUnit = new Map<string, { value: number; meterId?: string | null }>()
        measures.forEach((m) => byUnit.set(m.scopeId, { value: Number(m.value), meterId: m.meterId }))
        const total = units.reduce((s, u) => {
          const val = byUnit.get(u.id)?.value
          if (val === undefined || val === null) throw new ForbiddenException(`Missing measure ${typeCode} for unit ${u.code}`)
          return s + val
        }, 0)
        if (total <= 0) throw new ForbiddenException(`Total ${typeCode} is zero for allocation`)

        for (const u of units) {
          const unitData = byUnit.get(u.id)!
          const val = unitData.value
          const meterId = unitData.meterId ?? null
          const meterLabel = meterId ? meterLabels.get(meterId) || null : null
          const weight = val / total
          const amt = amount * weight
          perUnit[u.code] = { weight, amount: amt }
          const display = this.formatDisplay(
            {
              allocationMethod: method,
              basis,
              weight,
              weightSource: typeCode,
              unitMeasure: val,
              totalMeasure: total,
              splitNode: leaf,
            },
            { description: input.description, amount: amt, meterLabels },
          )
          const meta = {
            allocationMethod: method,
            basis: basis ?? null,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            splitNode: leaf,
            display: display.display,
            displayKey: display.displayKey,
            displayParams: display.displayParams,
          }
          const line = await allocationLineRepo.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: u.id, expenseSplitId: splitId } },
            update: { amount: { increment: amt }, meta, splitNodeId: leaf?.id ?? null },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: u.id,
              expenseSplitId: splitId,
              amount: amt,
              splitNodeId: leaf?.id ?? null,
              meta,
            },
            select: { id: true },
          })
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
            allocationLineId: line.id,
            unitId: u.id,
            expenseSplitId: splitId,
            splitNodeId: leaf?.id ?? null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          expId,
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

      const buildSplitMeta = (node: any, splitAmount: number) => {
        const base: any = { ...(node._storedMeta ?? node) }
        delete base._storedMeta
        delete base._existingSplitId
        delete base._parentSplitId
        delete base._resolvedShare
        const display = this.formatDisplay(
          {
            allocationMethod: (node.allocation as any)?.method,
            basis: (node.allocation as any)?.basis ?? node.basis,
            splitNode: node,
          },
          { description: input.description, amount: splitAmount, meterLabels },
        )
        return { ...base, display }
      }

      const processSplits = async (nodes: any[], amount: number, parentId: string | null, trail: any[]) => {
        await resolveShares(nodes)
        for (const node of nodes) {
          const share = node._resolvedShare ?? node.share
          if (share == null) throw new ForbiddenException('Split share missing')
          const splitAmount = amount * Number(share)
          const basis = (node.allocation as any)?.basis ?? node.basis
          const meta = buildSplitMeta(node, splitAmount)
          let splitId = node._existingSplitId
          if (splitId) {
            await splitRepo.update({
              where: { id: splitId },
              data: {
                parentSplitId: parentId,
                share: share,
                amount: splitAmount,
                basisType: basis?.type ?? null,
                basisCode: basis?.code ?? null,
                meta,
              },
            })
          } else {
            const split = await splitRepo.create({
              data: {
                communityId,
                periodId: period.id,
                expenseId: expId,
                parentSplitId: parentId,
                share: share,
                amount: splitAmount,
                basisType: basis?.type ?? null,
                basisCode: basis?.code ?? null,
                meta,
              },
            })
            splitId = split.id
          }
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
      return { ok: true, id: expId }
    }

    if (!input.allocationMethod) {
      if (input.expenseTypeId) {
        throw new ForbiddenException('Expense type missing split template')
      }
      throw new ForbiddenException('Allocation method or split definition required')
    }

    if (input.allocationMethod) {
      const method = input.allocationMethod as AllocationMethod
      await this.logAllocation(communityId, period.id, expId, `One-off allocation method=${method}`, undefined, input.description)
      const rule = await this.prisma.allocationRule.create({
        data: {
          communityId,
          method,
          params: input.allocationParams ?? null,
        },
        select: { id: true },
      })
      await this.prisma.weightVector.create({
        data: {
          communityId,
          periodId: period.id,
          ruleId: rule.id,
          scopeType: 'COMMUNITY',
          scopeId: communityId,
          expenseId: expId,
        },
      })
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
          const display = this.formatDisplay(
            { allocationMethod: method, weight, weightSource: 'explicit' },
            { description: input.description, amount, meterLabels },
          )
          const meta = {
            allocationMethod: method,
            weight,
            weightSource: 'explicit',
            display: display.display,
            displayKey: display.displayKey,
            displayParams: display.displayParams,
          }
          const line = await this.prisma.allocationLine.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: unit.id, expenseSplitId: null as any } },
            update: { amount, meta },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: unit.id,
              expenseSplitId: null,
              amount,
              meta,
            },
            select: { id: true },
          })
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: unit.id, code: unit.code },
            amount,
            method,
            weight,
            weightSource: 'explicit',
            ruleId: rule.id,
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: line.id,
            unitId: unit.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          expId,
          'Allocating using precomputed per-unit amounts',
          {
            totalAmount: input.amount,
            perUnit,
          },
          input.description,
        )
        return { ok: true, id: expId }
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
          const display = this.formatDisplay(
            { allocationMethod: method, weight: share, weightSource: 'explicit' },
            { description: input.description, amount, meterLabels },
          )
          const meta = {
            allocationMethod: method,
            weight: share,
            weightSource: 'explicit',
            display: display.display,
            displayKey: display.displayKey,
            displayParams: display.displayParams,
          }
          const line = await this.prisma.allocationLine.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: unit.id, expenseSplitId: null as any } },
            update: { amount, meta },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: unit.id,
              expenseSplitId: null,
              amount,
              meta,
            },
            select: { id: true },
          })
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: unit.id, code: unit.code },
            amount,
            method,
            weight: share,
            weightSource: 'explicit',
            ruleId: rule.id,
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: line.id,
            unitId: unit.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(
          communityId,
          period.id,
          expId,
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
        const measures = await this.prisma.periodMeasure.findMany({
          where: { communityId, periodId: period.id, scopeType: 'UNIT', typeCode },
          select: { scopeId: true, value: true },
        })
        const byUnit = new Map(measures.map((m) => [m.scopeId, Number(m.value)]))
        const perUnit: Record<string, { weight: number; amount: number }> = {}
        const total = units.reduce((s, u) => {
          const val = byUnit.get(u.id)
          if (val === undefined || val === null) throw new ForbiddenException(`Missing measure ${typeCode} for unit ${u.code}`)
          return s + val
        }, 0)
        if (total <= 0) throw new ForbiddenException(`Total ${typeCode} is zero for allocation`)

        for (const u of units) {
          const val = byUnit.get(u.id)!
          const weight = val / total
          const amount = Number(input.amount) * weight
          perUnit[u.code] = { weight, amount }
          const meta = {
            allocationMethod: method,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            display: this.formatDisplay(
              { allocationMethod: method, weight, weightSource: typeCode, unitMeasure: val, totalMeasure: total },
              { description: input.description, amount, meterLabels },
            ),
          }
          const line = await this.prisma.allocationLine.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: u.id, expenseSplitId: null as any } },
            update: { amount, meta },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: u.id,
              expenseSplitId: null,
              amount,
              meta,
            },
            select: { id: true },
          })
          const trace = buildTrace({
            origin: 'one-off',
            unit: { id: u.id, code: u.code },
            amount,
            method,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            ruleId: rule.id,
            allocationParams: input.allocationParams ?? null,
          })
          await writeTrace({
            allocationLineId: line.id,
            unitId: u.id,
            expenseSplitId: null,
            splitNodeId: null,
            trace,
          })
        }
        await this.logAllocation(communityId, period.id, expId, `Allocating using ${typeCode} measures`, {
          typeCode,
          totalMeasure: total,
          units: units.length,
          perUnit,
          totalAmount: input.amount,
        })
      }
    }
    return { ok: true, id: expId }
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
    communityId: string,
    periodId: string,
    expenseId: string,
    message: string,
    details?: any,
    expenseDesc?: string,
  ) {
    let name = expenseDesc
    if (!name) {
      const exp = await this.prisma.expense.findUnique({ where: { id: expenseId }, select: { description: true } })
      name = exp?.description
    }
    const label = name ? `${name} (id=${expenseId})` : expenseId
    try {
      await (this.prisma as any).allocationLog.create({
        data: {
          communityId,
          periodId,
          expenseId,
          message,
          details: details ?? null,
        },
      })
    } catch (err) {
      // swallow logging issues
    }
  }
}
