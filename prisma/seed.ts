import { PrismaClient, GroupKind, SeriesOrigin, SeriesScope, AllocationMethod } from '@prisma/client'
const prisma = new PrismaClient()
const id = () => crypto.randomUUID()

async function main() {
  const community = await prisma.community.upsert({
    where: { id: 'COMM-1' },
    update: {},
    create: { id: 'COMM-1', name: 'Sample Community' }
  })

  const p10 = await prisma.period.upsert({
    where: { id: '2025-10' },
    update: {},
    create: { id:'2025-10', communityId: community.id, startDate:new Date('2025-10-01'), endDate:new Date('2025-11-01'), seq:1 }
  })
  const p11 = await prisma.period.upsert({
    where: { id: '2025-11' },
    update: {},
    create: { id:'2025-11', communityId: community.id, startDate:new Date('2025-11-01'), endDate:new Date('2025-12-01'), seq:2 }
  })

  const uA12  = await prisma.unit.upsert({ where:{ code_communityId: { code:'A12', communityId: community.id }}, update:{}, create: { id:id(), communityId: community.id, code:'A12' }})
  const uA12P = await prisma.unit.upsert({ where:{ code_communityId: { code:'A12P', communityId: community.id }}, update:{}, create: { id:id(), communityId: community.id, code:'A12P' }})

  const be12 = await prisma.billingEntity.upsert({
    where: { code_communityId: { code:'BE-12', communityId: community.id } },
    update: {},
    create: { id:id(), communityId: community.id, code:'BE-12', name:'Apt 12 + Parking' }
  })
  await prisma.billingEntityMember.createMany({
    data: [
      { id:id(), billingEntityId: be12.id, unitId: uA12.id,  startPeriodId: p10.id, startSeq: p10.seq },
      { id:id(), billingEntityId: be12.id, unitId: uA12P.id, startPeriodId: p10.id, startSeq: p10.seq },
    ],
    skipDuplicates: true
  })

  const gA = await prisma.unitGroup.upsert({
    where: { code_communityId: { code:'G-STAIR-A', communityId: community.id } },
    update: {},
    create: { id:id(), communityId: community.id, code:'G-STAIR-A', name:'Staircase A', kind: GroupKind.PHYSICAL }
  })
  await prisma.unitGroupMember.createMany({
    data: [
      { id:id(), groupId: gA.id, unitId: uA12.id,  startPeriodId: p10.id, startSeq: p10.seq },
      { id:id(), groupId: gA.id, unitId: uA12P.id, startPeriodId: p10.id, startSeq: p10.seq },
    ],
    skipDuplicates: true
  })

  await prisma.measureType.createMany({
    data: [
      { code:'SQM', unit:'m2' },
      { code:'RESIDENTS', unit:'persons' },
      { code:'WATER_M3', unit:'m3' }
    ],
    skipDuplicates: true
  })

  const sA12sqm = await prisma.measureSeries.upsert({
    where: { id:'SER-A12-SQM' },
    update: {},
    create: { id:'SER-A12-SQM', communityId: community.id, scope: SeriesScope.UNIT, scopeId: uA12.id, typeCode:'SQM', origin: SeriesOrigin.ADMIN }
  })
  const sA12res = await prisma.measureSeries.upsert({
    where: { id:'SER-A12-RES' },
    update: {},
    create: { id:'SER-A12-RES', communityId: community.id, scope: SeriesScope.UNIT, scopeId: uA12.id, typeCode:'RESIDENTS', origin: SeriesOrigin.DECLARATION }
  })
  const sPsqm = await prisma.measureSeries.upsert({
    where: { id:'SER-A12P-SQM' },
    update: {},
    create: { id:'SER-A12P-SQM', communityId: community.id, scope: SeriesScope.UNIT, scopeId: uA12P.id, typeCode:'SQM', origin: SeriesOrigin.ADMIN }
  })
  const sPres = await prisma.measureSeries.upsert({
    where: { id:'SER-A12P-RES' },
    update: {},
    create: { id:'SER-A12P-RES', communityId: community.id, scope: SeriesScope.UNIT, scopeId: uA12P.id, typeCode:'RESIDENTS', origin: SeriesOrigin.DECLARATION }
  })

  await prisma.measurePeriodValue.createMany({
    data: [
      { id:id(), seriesId: sA12sqm.id, startPeriodId:p10.id, startSeq:p10.seq, value:'72'  },
      { id:id(), seriesId: sA12res.id, startPeriodId:p10.id, startSeq:p10.seq, value:'3'   },
      { id:id(), seriesId: sPsqm.id,   startPeriodId:p10.id, startSeq:p10.seq, value:'12'  },
      { id:id(), seriesId: sPres.id,   startPeriodId:p10.id, startSeq:p10.seq, value:'0'   },
    ],
    skipDuplicates: true
  })

  await prisma.periodMeasure.createMany({
    data: [
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12.id,  typeCode:'SQM',       origin:'ADMIN',       value:'72' },
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12P.id, typeCode:'SQM',       origin:'ADMIN',       value:'12' },
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12.id,  typeCode:'RESIDENTS', origin:'DECLARATION', value:'3'  },
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12P.id, typeCode:'RESIDENTS', origin:'DECLARATION', value:'0'  },
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12.id,  typeCode:'WATER_M3',  origin:'METER',       value:'8.4' },
      { id:id(), communityId: community.id, periodId: p11.id, scopeType:'UNIT', scopeId: uA12P.id, typeCode:'WATER_M3',  origin:'METER',       value:'0'   }
    ],
    skipDuplicates: true
  })

  const ruleSqm = await prisma.allocationRule.upsert({
    where: { id:'RULE-SQM' },
    update: {},
    create: { id:'RULE-SQM', communityId: community.id, method: AllocationMethod.BY_SQM, params:{} }
  })
  const ruleWater = await prisma.allocationRule.upsert({
    where: { id:'RULE-WATER' },
    update: {},
    create: { id:'RULE-WATER', communityId: community.id, method: AllocationMethod.BY_CONSUMPTION, params:{ single:{ typeCode:'WATER_M3' } } as any }
  })

  const tCleaning = await prisma.expenseType.upsert({
    where: { code_communityId: { code:'CLEANING', communityId: community.id } },
    update: {},
    create: { id:id(), communityId: community.id, code:'CLEANING', name:'Stair cleaning', ruleId: ruleSqm.id, currency:'RON' }
  })
  const tWater = await prisma.expenseType.upsert({
    where: { code_communityId: { code:'WATER', communityId: community.id } },
    update: {},
    create: { id:id(), communityId: community.id, code:'WATER', name:'Water', ruleId: ruleWater.id, currency:'RON' }
  })

  await prisma.expense.create({
    data: {
      id:id(), communityId: community.id, periodId: p11.id,
      description:'Cleaning Nov', allocatableAmount:'600', currency:'RON',
      targetType: 'GROUP', targetId: gA.id, expenseTypeId: tCleaning.id
    }
  })
  await prisma.expense.create({
    data: {
      id:id(), communityId: community.id, periodId: p11.id,
      description:'Water Nov', allocatableAmount:'240', currency:'RON',
      targetType: 'COMMUNITY', targetId: community.id, expenseTypeId: tWater.id
    }
  })

  console.log('Seeded OK', { community: community.id, period: p11.id })
}

main().then(()=>prisma.$disconnect()).catch(e=>{ console.error(e); prisma.$disconnect(); process.exit(1) })
