import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class AllocationTraceService {
  constructor(private readonly prisma: PrismaService) {}

  private async buildTrailContext(communityId: string | undefined, trail: any[]) {
    if (!communityId) return { unitGroups: {} as Record<string, any> }
    const groupCodes = new Set<string>()
    trail.forEach((t) => {
      const basis = t?.allocation?.basis
      if (basis?.type === 'GROUP' && basis?.code) groupCodes.add(basis.code)
    })
    if (groupCodes.size === 0) return { unitGroups: {} as Record<string, any> }
    const codes = Array.from(groupCodes)
    const groups = await this.prisma.unitGroup.findMany({
      where: { communityId, code: { in: codes } },
      select: { id: true, code: true, name: true },
    })
    if (!groups.length) return { unitGroups: {} as Record<string, any> }
    const members = await this.prisma.unitGroupMember.findMany({
      where: { groupId: { in: groups.map((g) => g.id) } },
      select: { groupId: true, unit: { select: { id: true, code: true } } },
    })
    const byId = new Map<string, { id: string; code: string; name?: string | null; units: Array<{ id: string; code: string }> }>()
    groups.forEach((g) => byId.set(g.id, { id: g.id, code: g.code, name: g.name, units: [] }))
    members.forEach((m) => {
      const entry = byId.get(m.groupId)
      if (!entry || !m.unit) return
      entry.units.push({ id: m.unit.id, code: m.unit.code })
    })
    const byCode: Record<string, any> = {}
    byId.forEach((g) => {
      byCode[g.code] = g
    })
    return { unitGroups: byCode }
  }

  serializeTrail(trail: any[], context?: { unitGroups?: Record<string, any>; expenseName?: string | null; expenseAmount?: number | null }) {

    const fmtPercent = new Intl.NumberFormat('ro-RO', { style: 'percent', maximumFractionDigits: 2 })
    const fmtCurrency = new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'RON', maximumFractionDigits: 2 })
    const fmtMeterValue = new Intl.NumberFormat('ro-RO', { style: 'decimal', maximumFractionDigits: 3 })

    if (!Array.isArray(trail) || trail.length === 0) {
      return { label: '', path: [] as string[], context: context ?? {}, phrases: [] as string[] }
    }

    const phrases: string[] = []
    const leaf = trail[trail.length - 1]
    const leafName =
      (trail.length === 1 ? context?.expenseName : null) || leaf?.name || leaf?.id || 'split'
    const leafAmount = typeof leaf?.amount === 'number' ? fmtCurrency.format(leaf.amount) : null
    const leafAllocation = leaf?.allocation
    const firstParts: string[] = []
    if (leafAmount) firstParts.push(`${leafName} ${leafAmount}`)
    else firstParts.push(leafName)
    const methodLabel = leafAllocation?.method || 'n/a'
    firstParts.push(`alocare prin ${methodLabel}`)
    const basis = leafAllocation?.basis
    if (basis?.type === 'COMMUNITY') {
      firstParts.push('bazat pe toata comunitatea')
    } else if (basis?.type === 'GROUP') {
      const group = context?.unitGroups?.[basis.code]
      const label = group?.name || group?.code || basis.code || 'n/a'
      firstParts.push(`bazat pe grupul ${label}`)
    } else if (basis?.type === 'UNIT') {
      firstParts.push(`bazat pe unitatea ${basis.code || 'n/a'}`)
    } else {
      firstParts.push('bazat pe n/a')
    }
    if (typeof leafAllocation?.unitMeasure === 'number' && typeof leafAllocation?.totalMeasure === 'number') {
      firstParts.push(
        `folosind ${fmtMeterValue.format(leafAllocation.unitMeasure)} din ${fmtMeterValue.format(leafAllocation.totalMeasure)}`,
      )
    } else {
      firstParts.push('folosind n/a')
    }
    const weightSourceLabel = leafAllocation?.weightSource || 'n/a'
    firstParts.push(`sursa ponderilor ${weightSourceLabel}`)
    phrases.push(firstParts.join(', '))

    const rootAmount = leafAmount
    const current = trail[trail.length - 1]
    const levelLabel = current
      ? (() => {
          const share =
            typeof current?.share === 'number' && Math.abs(current.share - 1) > 1e-6
              ? fmtPercent.format(current.share)
              : null
          const name = current?.name || current?.id || 'split'
          return share ? `${share} ${name}` : name
        })()
      : ''
    if (rootAmount && Math.abs((current?.share ?? 0) - 1) > 1e-6) {
      const splitLabel = levelLabel ? `: ${levelLabel}` : ''
      let meterLabel = ''
      if (current?.derivedMeters) {
        const partLabel = current.derivedMeters.partMeterLabel || current.derivedMeters.partMeterId || 'contor'
        const totalLabel = current.derivedMeters.totalMeterLabel || current.derivedMeters.totalMeterId || 'total'
        const partVal = fmtMeterValue.format(current.derivedMeters.partValue)
        const totalVal = fmtMeterValue.format(current.derivedMeters.totalValue)
        meterLabel = ` (din ${partLabel} ${partVal} / ${totalLabel} ${totalVal})`
      }
      phrases.push(`Suma alocata ${rootAmount} se justifica prin impartirea pe splitul urmator${splitLabel}${meterLabel}`)
    }

    for (let i = trail.length - 2; i >= 0; i--) {
      const node = trail[i]
      const parts: string[] = []
      const name = node?.name || node?.id || 'split'
      const amount = typeof node?.amount === 'number' ? fmtCurrency.format(node.amount) : null
      if (amount) parts.push(`${name} ${amount}`)
      else parts.push(name)
      if (typeof node?.share === 'number' && Math.abs(node.share - 1) > 1e-6) {
        const total = typeof node?.totalAmount === 'number' ? fmtCurrency.format(node.totalAmount) : null
        const suffix = total ? ` din ${total}` : ''
        parts.push(`cotă ${fmtPercent.format(node.share)}${suffix}`)
      }
      if (node?.derivedMeters) {
        const partLabel = node.derivedMeters.partMeterLabel || node.derivedMeters.partMeterId || 'contor'
        const totalLabel = node.derivedMeters.totalMeterLabel || node.derivedMeters.totalMeterId || 'total'
        const partVal = fmtMeterValue.format(node.derivedMeters.partValue)
        const totalVal = fmtMeterValue.format(node.derivedMeters.totalValue)
        parts.push(`din ${partLabel} ${partVal} / ${totalLabel} ${totalVal}`)
      }
      phrases.push(parts.join(', '))
    }

    const root = trail[0]
    const rootName = context?.expenseName || root?.name || root?.id || 'cheltuiala'
    const rootValue = typeof context?.expenseAmount === 'number'
      ? fmtCurrency.format(context.expenseAmount)
      : typeof root?.amount === 'number'
        ? fmtCurrency.format(root.amount)
        : null
    if (rootValue) {
      phrases.push(`Suma totala a cheltuielii ${rootName} este ${rootValue}`)
    }

    const path = trail.map((t) => t?.name || t?.id).filter(Boolean)
    let result = { label: path.join(' > '), path, context: context ?? {}, phrases }
    return result
  }

  async withSplitTrail(rows: any[], opts?: { communityId?: string }): Promise<any[]> {
    return Promise.all(
      rows.map(async (row) => {
        const trace = row.allocationTrace as any
        if (trace?.split?.trail?.length) {
          const last = trace.split.trail[trace.split.trail.length - 1]
          const splitNodeName = row.splitNodeName || last?.name || last?.id || null
          const context = await this.buildTrailContext(opts?.communityId, trace.split.trail)
          const serialized = this.serializeTrail(trace.split.trail, {
            ...context,
            expenseName: row.expenseDescription || null,
            expenseAmount: row.expenseAmount != null ? Number(row.expenseAmount) : null,
          })
          return {
            ...row,
            splitTrail: trace.split.trail,
            splitTrailLabel: serialized.label,
            splitTrailContext: serialized.context,
            splitTrailPhrases: serialized.phrases,
            allocationTrace: trace,
            splitNodeName,
          }
        }
        if (trace?.allocation) {
          const parts: string[] = []
          const amount = typeof trace.allocation.amount === 'number' ? trace.allocation.amount : null
          if (amount != null) parts.push(`Suma alocata ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'RON', maximumFractionDigits: 2 }).format(amount)}`)
          if (trace.allocation.method) parts.push(`alocare prin ${trace.allocation.method}`)
          if (trace.allocation.basis?.type) {
            if (trace.allocation.basis.type === 'COMMUNITY') parts.push('bazat pe toata comunitatea')
            else if (trace.allocation.basis.type === 'GROUP') parts.push(`bazat pe grupul ${trace.allocation.basis.code}`)
            else if (trace.allocation.basis.type === 'UNIT') parts.push(`bazat pe unitatea ${trace.allocation.basis.code}`)
          }
          if (typeof trace.allocation.unitMeasure === 'number' && typeof trace.allocation.totalMeasure === 'number') {
            parts.push(`folosind ${trace.allocation.unitMeasure} din ${trace.allocation.totalMeasure}`)
          }
          if (trace.allocation.weightSource) parts.push(`sursa ponderilor ${trace.allocation.weightSource}`)
          return {
            ...row,
            splitTrailPhrases: [parts.join(', ')],
            allocationTrace: trace,
          }
        }
        return row
      }),
    )
  }
}
