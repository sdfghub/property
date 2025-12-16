import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common'
import { AllocationMethod } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'

type PeriodRef = { id: string; seq: number; code: string }

@Injectable()
export class AllocationService {
  private readonly logger = new Logger('AllocationService')

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
      await this.logAllocation(communityId, period.id, expId, 'Reusing existing expense; clearing previous allocations', undefined, input.description)
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

    let splitsToUse = input.splits
    if ((!splitsToUse || !splitsToUse.length) && input.expenseTypeId) {
      const et = await this.prisma.expenseType.findUnique({ where: { id: input.expenseTypeId }, select: { params: true } })
      const tmpl: any = (et?.params as any)?.splitTemplate
      if (tmpl) splitsToUse = Array.isArray(tmpl) ? tmpl : tmpl.splits ?? []
    }

    if (splitsToUse && Array.isArray(splitsToUse) && splitsToUse.length) {
      await this.logAllocation(communityId, period.id, expId, 'Processing split tree', undefined, input.description)
      const splitRepo = (this.prisma as any).expenseSplit
      const allocationLineRepo: any = (this.prisma as any).allocationLine

      const resolveShares = async (siblings: any[]) => {
        const explicit = siblings.filter((s) => typeof s.share === 'number')
        const remainder = siblings.filter((s) => s.derivedShare === 'remainder')
        let derivedSum = 0
        for (const s of siblings.filter((s) => s.derivedShare && s.derivedShare !== 'remainder')) {
          const d = s.derivedShare
          if (d.totalMeterId && d.partMeterId) {
            this.logger.log(`[SPLIT] resolving derived share for node=${s.id || 'n/a'} total=${d.totalMeterId} part=${d.partMeterId}`)
            const total = await this.getMeterValue(d.totalMeterId, period.id, communityId)
            const part = await this.getMeterValue(d.partMeterId, period.id, communityId)
            if (total <= 0) throw new ForbiddenException(`Total meter ${d.totalMeterId} is zero`)
            s._resolvedShare = part / total
            derivedSum += s._resolvedShare
            this.logger.log(`[SPLIT] derived share=${s._resolvedShare} from part=${part} / total=${total}`)
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
          this.logger.warn(`[SPLIT] shares exceeded 1; normalized with scale=${scale.toFixed(4)}`)
        }
        if (remainder.length > 1) throw new ForbiddenException('Only one remainder split allowed')
        const remaining = 1 - sum
        if (remaining < -1e-6) throw new ForbiddenException('No remaining share for remainder')
        explicit.forEach((s) => (s._resolvedShare = Number(s.share)))
        if (remainder.length === 1) remainder[0]._resolvedShare = remaining
        this.logger.log(
          `[SPLIT] resolved shares: explicit=${explicit.length} derived=${derivedSum.toFixed(
            4,
          )} remainder=${remaining.toFixed(4)} total=${sum.toFixed(4)}`,
        )
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

      const allocateLeaf = async (leaf: any, amount: number, splitId: string) => {
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
        this.logger.log(
          `[SPLIT] allocating leaf=${leaf.id || 'n/a'} method=${method} units=${units.length} amount=${amount}`,
        )

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
            this.logger.log(`[SPLIT] explicit weight unit=${unitCode} weight=${weight.toFixed(6)} amount=${amt}`)
            const meta = {
              allocationMethod: method,
              basis: basis ?? null,
              weight,
              weightSource: 'explicit',
              splitNode: leaf,
            }
            await allocationLineRepo.upsert({
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
            this.logger.log(`[SPLIT] equal weight unit=${u.code} weight=${(1 / units.length).toFixed(6)} amount=${per}`)
            const meta = {
              allocationMethod: method,
              basis: basis ?? null,
              weight: 1 / units.length,
              weightSource: 'equal',
              splitNode: leaf,
            }
            await allocationLineRepo.upsert({
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
          select: { scopeId: true, value: true },
        })
        const byUnit = new Map<string, number>()
        measures.forEach((m) => byUnit.set(m.scopeId, Number(m.value)))
        const total = units.reduce((s, u) => {
          const val = byUnit.get(u.id)
          if (val === undefined || val === null) throw new ForbiddenException(`Missing measure ${typeCode} for unit ${u.code}`)
          return s + val
        }, 0)
        if (total <= 0) {
          this.logger.warn(`Total ${typeCode} is zero for allocation at split ${leaf.id || 'n/a'}; skipping branch`)
          return
        }
        this.logger.log(`[SPLIT] measure-based allocation type=${typeCode} total=${total}`)

        for (const u of units) {
          const val = byUnit.get(u.id)!
          const weight = val / total
          const amt = amount * weight
          perUnit[u.code] = { weight, amount: amt }
          this.logger.log(`[SPLIT] measure weight unit=${u.code} val=${val} weight=${weight.toFixed(6)} amount=${amt}`)
          const meta = {
            allocationMethod: method,
            basis: basis ?? null,
            weight,
            weightSource: typeCode,
            unitMeasure: val,
            totalMeasure: total,
            splitNode: leaf,
          }
          await allocationLineRepo.upsert({
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

      const processSplits = async (nodes: any[], amount: number, parentId: string | null) => {
        await resolveShares(nodes)
        for (const node of nodes) {
          const share = node._resolvedShare ?? node.share
          if (share == null) throw new ForbiddenException('Split share missing')
          const splitAmount = amount * Number(share)
          const split = await splitRepo.create({
            data: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              parentSplitId: parentId,
              share: share,
              amount: splitAmount,
              basisType: ((node.allocation as any)?.basis ?? node.basis)?.type ?? null,
              basisCode: ((node.allocation as any)?.basis ?? node.basis)?.code ?? null,
              meta: node,
            },
          })
          if (node.children && node.children.length) {
            await processSplits(node.children, splitAmount, split.id)
          } else {
            await allocateLeaf(node, splitAmount, split.id)
          }
        }
      }

      await processSplits(splitsToUse, input.amount, null)
      return { ok: true, id: expId }
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
            select: { id: true },
          })
          if (!unit) continue
          const amount = Number(entry.amount) || 0
          const weight = amount / total
          perUnit[unitCode] = { weight, amount }
          await this.prisma.allocationLine.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: unit.id, expenseSplitId: null as any } },
            update: { amount },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: unit.id,
              expenseSplitId: null,
              amount,
            },
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
        if (total > 0) {
          const perUnit: Record<string, { weight: number; amount: number }> = {}
          const normalized = new Map<string, number>()
          for (const [unitCode, raw] of entries) {
            normalized.set(unitCode, (Number(raw) || 0) / total)
          }
          for (const [unitCode, raw] of entries) {
            const unit = await this.prisma.unit.findUnique({
              where: { code_communityId: { code: unitCode, communityId } },
              select: { id: true },
            })
            if (!unit) continue
            const share = (Number(raw) || 0) / total
            const amount = Number(input.amount) * share
            perUnit[unitCode] = { weight: share, amount }
            await this.prisma.allocationLine.upsert({
              where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: unit.id, expenseSplitId: null as any } },
              update: { amount },
              create: {
                communityId,
                periodId: period.id,
                expenseId: expId,
                unitId: unit.id,
                expenseSplitId: null,
                amount,
              },
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
        }
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
          await this.prisma.allocationLine.upsert({
            where: { expenseId_unitId_expenseSplitId: { expenseId: expId, unitId: u.id, expenseSplitId: null as any } },
            update: { amount },
            create: {
              communityId,
              periodId: period.id,
              expenseId: expId,
              unitId: u.id,
              expenseSplitId: null,
              amount,
            },
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
    this.logger.log(`[ALLOC] expense=${label} community=${communityId} period=${periodId} :: ${message} ${details ? JSON.stringify(details) : ''}`)
    if (details?.perUnit && typeof details.perUnit === 'object') {
      Object.entries(details.perUnit as Record<string, any>).forEach(([unitCode, vals]) => {
        const label = expenseDesc ? `${expenseDesc} (id=${expenseId})` : expenseId
        this.logger.log(
          `[ALLOC-DETAIL] expense=${label} unit=${unitCode} amount=${vals?.amount ?? ''} weight=${vals?.weight ?? ''} meta=${JSON.stringify(
            vals?.meta ?? {},
          )}`,
        )
      })
    }
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
      this.logger.warn(`Failed to persist allocation log: ${message} ${err}`)
    }
  }
}
