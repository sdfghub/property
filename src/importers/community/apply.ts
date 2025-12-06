import { PrismaClient, SeriesOrigin, SeriesScope } from '@prisma/client'
import { CommunityImportPlan } from './types'
const prisma = new PrismaClient()
const INT4_MAX = 2147483647

export async function applyCommunityPlan(plan: CommunityImportPlan) {
  const { communityId } = plan

  // community + period
  // FIXME handle code
  await prisma.community.upsert({ where: { id: communityId }, update: { code: plan.communityName, name: plan.communityName }, create: { id: communityId, code: plan.communityName, name: plan.communityName } })
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
  for (const g of plan.groups)
    await prisma.unitGroup.upsert({
      where: { code_communityId: { code: g.code, communityId } },
      update: { name: g.name ?? g.code, kind: (g.kind ?? 'LOGICAL') as any },
      create: { communityId, code: g.code, name: g.name ?? g.code, kind: (g.kind ?? 'LOGICAL') as any }
    })

  // rules
  for (const r of plan.rules)
    await prisma.allocationRule.upsert({
      where: { id: `${r.code}-${communityId}` },
      update: { params: r.params ?? {} },
      create: { id: `${r.code}-${communityId}`, communityId, method: r.method as any, params: r.params ?? {} }
    })

  // expense types (with preset inside params)
  for (const t of plan.expenseTypes) {
    const rule = await prisma.allocationRule.findUnique({ where: { id: `${t.ruleCode}-${communityId}` } })
    if (!rule) throw new Error(`Rule ${t.ruleCode} missing`)
    await prisma.expenseType.upsert({
      where: { code_communityId: { code: t.code, communityId } },
      update: { name: t.name, ruleId: rule.id, currency: t.currency, params: t.params },
      create: { communityId, code: t.code, name: t.name, ruleId: rule.id, currency: t.currency, params: t.params }
    })
  }

  // units
  const unitId = new Map<string,string>()
  for (const u of plan.units) {
    const up = await prisma.unit.upsert({
      where: { code_communityId: { code: u.code, communityId } },
      update: {},
      create: { communityId, code: u.code }
    })
    unitId.set(u.code, up.id)
  }

  // pre-fetch referenced periods by code for membership ranges
  const periodByCode = new Map<string,{id:string,seq:number}>()
  async function getPeriod(code?: string){ if(!code) return undefined; if(periodByCode.has(code)) return periodByCode.get(code)!;
    const p = await prisma.period.findUnique({ where: { communityId_code: { communityId, code } } }); if(!p) throw new Error(`Period ${code} missing`)
    const v={id:p.id,seq:p.seq}; periodByCode.set(code,v); return v;
  }

  // memberships
  for (const m of plan.memberships) {
    const u = unitId.get(m.unitCode)!; const s = (await getPeriod(m.startPeriod)) ?? { id: period.id, seq: period.seq }; const e = await getPeriod(m.endPeriod)
    if (m.groupCode) {
      const g = await prisma.unitGroup.findUnique({ where: { code_communityId: { code: m.groupCode, communityId } } }); if (!g) throw new Error(`Group ${m.groupCode} missing`)
      const overlap = await prisma.unitGroupMember.findFirst({ where: { groupId: g.id, unitId: u, startSeq: { lte: e?.seq ?? INT4_MAX }, OR: [{ endSeq: null }, { endSeq: { gte: s.seq } }] }, select: { id: true } })
      if (!overlap) await prisma.unitGroupMember.create({ data: { groupId: g.id, unitId: u, startPeriodId: s.id, startSeq: s.seq, endPeriodId: e?.id ?? null, endSeq: e?.seq ?? null } })
    }
    if (m.billingEntityCode) {
      const be = await prisma.billingEntity.upsert({ where: { code_communityId: { code: m.billingEntityCode, communityId } }, update: {}, create: { communityId, code: m.billingEntityCode, name: m.billingEntityCode } })
      const overlap = await prisma.billingEntityMember.findFirst({ where: { billingEntityId: be.id, unitId: u, startSeq: { lte: e?.seq ?? INT4_MAX }, OR: [{ endSeq: null }, { endSeq: { gte: s.seq } }] }, select: { id:true } })
      if (!overlap) await prisma.billingEntityMember.create({ data: { billingEntityId: be.id, unitId: u, startPeriodId: s.id, startSeq: s.seq, endPeriodId: e?.id ?? null, endSeq: e?.seq ?? null } })
    }
  }

  // period measures (RESIDENTS as DECLARATION; SQM as ADMIN)
  for (const pm of plan.periodMeasures) {
    const u = unitId.get(pm.unitCode)!;
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId, periodId: period.id, scopeType: SeriesScope.UNIT, scopeId: u, typeCode: pm.typeCode } },
      update: { value: pm.value, origin: pm.typeCode === 'RESIDENTS' ? SeriesOrigin.DECLARATION : SeriesOrigin.ADMIN },
      create: { communityId, periodId: period.id, scopeType: SeriesScope.UNIT, scopeId: u, typeCode: pm.typeCode, origin: pm.typeCode === 'RESIDENTS' ? SeriesOrigin.DECLARATION : SeriesOrigin.ADMIN, value: pm.value }
    })
  }
}
