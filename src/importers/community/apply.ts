import { PrismaClient, SeriesOrigin, SeriesScope } from '@prisma/client'
import { CommunityImportPlan } from './types'
const prisma = new PrismaClient()
const INT4_MAX = 2147483647

export async function applyCommunityPlan(plan: CommunityImportPlan) {
  const { communityId } = plan
  const stats = {
    groups: 0,
    rules: 0,
    expenseTypes: 0,
    expenseSplits: 0,
    units: 0,
    billingEntities: 0,
    unitGroupMemberships: 0,
    billingEntityMemberships: 0,
    periodMeasures: 0,
    meters: 0,
    measureTypes: 0,
  }

  // community + period (use id and code from plan)
  await prisma.community.upsert({
    where: { id: communityId },
    update: { code: communityId, name: plan.communityName },
    create: { id: communityId, code: communityId, name: plan.communityName },
  })
  const period = await prisma.period.upsert({
    where: { communityId_code: { communityId, code: plan.periodCode } },
    update: {},
    create: {
      communityId, code: plan.periodCode,
      startDate: new Date(plan.periodStart ?? `${plan.periodCode}-01`),
      endDate: new Date(plan.periodEnd ?? `${plan.periodCode}-28`),
      seq: (() => { const [y,m]=plan.periodCode.split('-').map(Number); return y*12+m })()
    }
  })

  // groups
  for (const g of plan.groups) {
    await prisma.unitGroup.upsert({
      where: { code_communityId: { code: g.code, communityId } },
      update: { name: g.name ?? g.code },
      create: { communityId, code: g.code, name: g.name ?? g.code }
    })
    stats.groups += 1
  }

  // rules
  for (const r of plan.rules) {
    await (prisma as any).allocationRule.upsert({
      where: { id: `${r.code}-${communityId}` },
      update: { params: r.params ?? {}, name: r.name ?? r.method } as any,
      create: {
        id: `${r.code}-${communityId}`,
        communityId,
        method: r.method as any,
        name: r.name ?? r.method,
        params: r.params ?? {},
      } as any,
    })
    stats.rules += 1
  }

  // expense splits defined in plan (store as JSON on expense types for now)
  // expense types (with preset inside params)
  const splitMap = new Map<string, any>()
  if (Array.isArray(plan.expenseSplits)) {
    for (const s of plan.expenseSplits) {
      if (s && s.expenseTypeCode) splitMap.set(s.expenseTypeCode, s.splits ?? s)
    }
  }

  for (const t of plan.expenseTypes) {
    const rule = await prisma.allocationRule.findUnique({ where: { id: `${t.ruleCode}-${communityId}` } })
    if (!rule) throw new Error(`Rule ${t.ruleCode} missing`)
    const template = t.splitTemplate ?? splitMap.get(t.code) ?? {
      expenseTypeCode: t.code,
      splits: [{ id: `${t.code}-default`, share: 1, allocation: { ruleCode: t.ruleCode } }],
    }
    const params = { ...(t.params as any), splitTemplate: template.splits ?? template }
    await prisma.expenseType.upsert({
      where: { code_communityId: { code: t.code, communityId } },
      update: { name: t.name, ruleId: rule.id, currency: t.currency, params },
      create: { communityId, code: t.code, name: t.name, ruleId: rule.id, currency: t.currency, params }
    })
    stats.expenseTypes += 1
    stats.expenseSplits += 1
  }

  // units
  const unitId = new Map<string,string>()
  let unitOrderSeq = 0
  for (const u of plan.units) {
    const ord = u.order ?? unitOrderSeq++
    const up = await prisma.unit.upsert({
      where: { code_communityId: { code: u.code, communityId } },
      update: { order: ord } as any,
      create: { communityId, code: u.code, order: ord } as any,
    })
    stats.units += 1
    unitId.set(u.code, up.id)
  }

  // measure types
  if (Array.isArray(plan.measureTypes)) {
    stats.measureTypes += plan.measureTypes.length
    for (const mt of plan.measureTypes) {
      await prisma.measureType.upsert({
        where: { code: mt.code },
        update: { unit: mt.unit, name: mt.name ?? null } as any,
        create: { code: mt.code, unit: mt.unit, name: mt.name ?? null } as any,
      })
    }
  }

  // meters
  if (Array.isArray(plan.meters)) {
    const meterRepo = (prisma as any).meter
    if (meterRepo && typeof meterRepo.upsert === 'function') {
      for (const m of plan.meters) {
        await meterRepo.upsert({
          where: { meterId: m.meterId },
          update: {
            name: (m as any).name ?? null,
            scopeCode: m.scopeCode,
            scopeType: m.scopeType as any,
            typeCode: m.typeCode,
            origin: (m.origin as any) ?? 'METER',
            notes: (m as any).notes ?? null,
          },
          create: {
            meterId: m.meterId,
            name: (m as any).name ?? null,
            scopeType: m.scopeType as any,
            scopeCode: m.scopeCode,
            typeCode: m.typeCode,
            origin: (m.origin as any) ?? 'METER',
            notes: (m as any).notes ?? null,
          },
        })
        stats.meters += 1
      }
    } else {
      // meter model not present; skip but keep stats at zero
      console.warn('Meter model not available in Prisma client; skipping meter import')
    }
  }

  // aggregations
  if (Array.isArray(plan.aggregations)) {
    const aggRepo: any = (prisma as any).aggregationRule
    if (aggRepo?.upsert) {
      for (const a of plan.aggregations) {
        await aggRepo.upsert({
          where: { communityId_targetType: { communityId, targetType: a.targetType } },
          update: { unitTypes: a.unitTypes ?? [], residualType: a.residualType ?? null, totalType: null },
          create: {
            communityId,
            targetType: a.targetType,
            unitTypes: a.unitTypes ?? [],
            residualType: a.residualType ?? null,
            totalType: null,
          },
        })
      }
      stats.measureTypes += 0
    }
  }

  // derived meters
  if (Array.isArray(plan.derivedMeters)) {
    const repo: any = (prisma as any).derivedMeterRule
    if (repo?.upsert) {
      for (const d of plan.derivedMeters) {
        await repo.upsert({
          where: {
            communityId_scopeType_sourceType_targetType: {
              communityId,
              scopeType: (d.scopeType as any) ?? 'COMMUNITY',
              sourceType: d.sourceType,
              targetType: d.targetType,
            },
          },
          update: { subtractTypes: d.subtractTypes ?? [], origin: (d.origin as any) ?? 'DERIVED' },
          create: {
            communityId,
            scopeType: (d.scopeType as any) ?? 'COMMUNITY',
            sourceType: d.sourceType,
            subtractTypes: d.subtractTypes ?? [],
            targetType: d.targetType,
            origin: (d.origin as any) ?? 'DERIVED',
          },
        })
      }
    }
  }

  // split groups (reporting buckets for split node ids)
  if (Array.isArray(plan.splitGroups)) {
    const groupRepo: any = (prisma as any).splitGroup
    const memberRepo: any = (prisma as any).splitGroupMember
    if (groupRepo?.upsert && memberRepo?.deleteMany && memberRepo?.createMany) {
      plan.splitGroups.forEach((g, idx) => (g.order = g.order ?? idx + 1))
      for (const g of plan.splitGroups) {
        const sg = await groupRepo.upsert({
          where: { communityId_code: { communityId, code: g.code } },
          update: { name: g.name ?? g.code, order: g.order ?? null },
          create: { communityId, code: g.code, name: g.name ?? g.code, order: g.order ?? null },
        })
        await memberRepo.deleteMany({ where: { splitGroupId: sg.id } })
        const ids = Array.isArray(g.splitIds) ? g.splitIds.filter(Boolean) : []
        if (ids.length) {
          await memberRepo.createMany({
            data: ids.map((sid: string) => ({ splitGroupId: sg.id, splitNodeId: sid })),
            skipDuplicates: true,
          })
        }
      }
    }
  }

  // buckets (ledger/reporting)
 if (Array.isArray(plan.buckets)) {
   const repo: any = (prisma as any).bucketRule
   if (repo?.upsert) {
     for (const b of plan.buckets) {
       await repo.upsert({
          where: { communityId_code: { communityId, code: b.code } },
          update: {
            name: b.name ?? b.code,
            programCode: b.programCode ?? null,
            expenseTypeCodes: b.expenseTypeCodes ?? [],
            splitGroupCodes: b.splitGroupCodes ?? [],
            splitNodeIds: b.splitNodeIds ?? [],
            priority: b.priority ?? 1,
          },
          create: {
            communityId,
            code: b.code,
            name: b.name ?? b.code,
            programCode: b.programCode ?? null,
            expenseTypeCodes: b.expenseTypeCodes ?? [],
            splitGroupCodes: b.splitGroupCodes ?? [],
            splitNodeIds: b.splitNodeIds ?? [],
            priority: b.priority ?? 1,
          },
        })
      }
    }
  }

  // pre-fetch referenced periods by code for membership ranges
  const periodByCode = new Map<string,{id:string,seq:number}>()
  async function getPeriod(code?: string){ if(!code) return undefined; if(periodByCode.has(code)) return periodByCode.get(code)!;
    const p = await prisma.period.findUnique({ where: { communityId_code: { communityId, code } } }); if(!p) throw new Error(`Period ${code} missing`)
    const v={id:p.id,seq:p.seq}; periodByCode.set(code,v); return v;
  }

  // memberships
  const beOrder = new Map<string, number>()
  if (plan.beOrders) {
    for (const [code, ord] of Object.entries(plan.beOrders)) {
      if (typeof ord === 'number') beOrder.set(code, ord)
    }
  }
  let beSeq = beOrder.size ? Math.max(...Array.from(beOrder.values())) + 1 : 0
  for (const m of plan.memberships) {
    const u = unitId.get(m.unitCode)!; const s = (await getPeriod(m.startPeriod)) ?? { id: period.id, seq: period.seq }; const e = await getPeriod(m.endPeriod)
    if (m.groupCode) {
      const g = await prisma.unitGroup.findUnique({ where: { code_communityId: { code: m.groupCode, communityId } } }); if (!g) throw new Error(`Group ${m.groupCode} missing`)
      const overlap = await prisma.unitGroupMember.findFirst({ where: { groupId: g.id, unitId: u, startSeq: { lte: e?.seq ?? INT4_MAX }, OR: [{ endSeq: null }, { endSeq: { gte: s.seq } }] }, select: { id: true } })
      if (!overlap) {
        await prisma.unitGroupMember.create({ data: { groupId: g.id, unitId: u, startPeriodId: s.id, startSeq: s.seq, endPeriodId: e?.id ?? null, endSeq: e?.seq ?? null } })
        stats.unitGroupMemberships += 1
      }
    }
    if (m.billingEntityCode) {
      const ord = (() => {
        if (beOrder.has(m.billingEntityCode)) return beOrder.get(m.billingEntityCode)!
        const next = beSeq++
        beOrder.set(m.billingEntityCode, next)
        return next
      })()
      const be = await prisma.billingEntity.upsert({
        where: { code_communityId: { code: m.billingEntityCode, communityId } },
        update: { order: ord } as any,
        create: { communityId, code: m.billingEntityCode, name: m.billingEntityCode, order: ord } as any
      })
      stats.billingEntities += 1 // counts upserts; duplicates are minimal
      const overlap = await prisma.billingEntityMember.findFirst({ where: { billingEntityId: be.id, unitId: u, startSeq: { lte: e?.seq ?? INT4_MAX }, OR: [{ endSeq: null }, { endSeq: { gte: s.seq } }] }, select: { id:true } })
      if (!overlap) {
        await prisma.billingEntityMember.create({ data: { billingEntityId: be.id, unitId: u, startPeriodId: s.id, startSeq: s.seq, endPeriodId: e?.id ?? null, endSeq: e?.seq ?? null } })
        stats.billingEntityMemberships += 1
      }
    }
  }

  // period measures (RESIDENTS as DECLARATION; SQM as ADMIN)
  for (const pm of plan.periodMeasures) {
    const u = unitId.get(pm.unitCode)!;
    const meterId = (pm as any).meterId ?? `${pm.typeCode}-${pm.unitCode}`
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId, periodId: period.id, scopeType: SeriesScope.UNIT, scopeId: u, typeCode: pm.typeCode } },
      update: { value: pm.value, origin: pm.typeCode === 'RESIDENTS' ? SeriesOrigin.DECLARATION : SeriesOrigin.ADMIN, meterId },
      create: { communityId, periodId: period.id, scopeType: SeriesScope.UNIT, scopeId: u, typeCode: pm.typeCode, origin: pm.typeCode === 'RESIDENTS' ? SeriesOrigin.DECLARATION : SeriesOrigin.ADMIN, value: pm.value, meterId }
    })
    stats.periodMeasures += 1
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    ok: true,
    communityId,
    periodId: period.id,
    stats
  }, null, 2))
}
