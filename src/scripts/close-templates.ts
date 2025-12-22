import { PrismaClient } from '@prisma/client'

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Close bill/meter template instances for a community/period

Usage:
  npm run close:templates -- <communityId> <periodCode>
`)
  process.exit(msg ? 1 : 0)
}

async function main() {
  const [communityId, periodCode] = process.argv.slice(2)
  if (!communityId || !periodCode) usage('Missing communityId or periodCode')

  const prisma = new PrismaClient()
  await prisma.$connect()
  const period = await prisma.period.findFirst({
    where: { communityId, code: periodCode },
    select: { id: true },
  })
  if (!period) {
    throw new Error(`Period ${periodCode} not found for community ${communityId}`)
  }

  const bills = await prisma.billTemplate.findMany({ where: { communityId }, select: { id: true, code: true } })
  const meters = await prisma.meterEntryTemplate.findMany({ where: { communityId }, select: { id: true, code: true } })

  let billClosed = 0
  for (const b of bills) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: b.id } },
      update: { state: 'CLOSED' },
      create: {
        communityId,
        periodId: period.id,
        templateId: b.id,
        state: 'CLOSED',
      },
    })
    billClosed++
  }

  let meterClosed = 0
  for (const m of meters) {
    await prisma.meterEntryTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: m.id } },
      update: { state: 'CLOSED' },
      create: {
        communityId,
        periodId: period.id,
        templateId: m.id,
        state: 'CLOSED',
      },
    })
    meterClosed++
  }

  console.log(
    `🔒 Closed template instances for ${communityId} ${periodCode}: bills=${billClosed} meters=${meterClosed}`,
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
