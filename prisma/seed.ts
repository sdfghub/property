import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function ensurePeriod(communityId: string, code: string, start: string, end: string, seq: number) {
  const existing = await prisma.period.findUnique({ where: { communityId_code: { communityId, code } } })
  if (existing) return existing
  return prisma.period.create({ data: { communityId, code, startDate: new Date(start), endDate: new Date(end), seq } })
}

async function main() {
  const community = await prisma.community.upsert({
    where: { id: 'COMM-1' },
    update: {},
    create: { id: 'COMM-1', name: 'Sample Community' }
  })

  const p11 = await ensurePeriod(community.id, '2025-11', '2025-11-01', '2025-12-01', 2)
  console.log('Seed OK. Period:', p11.code, 'id:', p11.id)
}
main().finally(()=>prisma.$disconnect())
