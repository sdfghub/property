import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'
import { AllocationService } from '../modules/billing/allocation.service'
import { PaymentService } from '../modules/billing/payment.service'

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Close (prepare or approve) a period.

Usage:
  npm run close:period -- <communityId> <periodCode> [--approve]

Examples:
  npm run close:period -- LOTUS-TM 2025-09          # prepare
  npm run close:period -- LOTUS-TM 2025-09 --approve # approve
`)
  process.exit(msg ? 1 : 0)
}

async function main() {
  const args = process.argv.slice(2)
  const [communityId, periodCode, ...rest] = args
  if (!communityId || !periodCode) usage('Missing communityId or periodCode')
  const approve = rest.includes('--approve')

  console.log(`ℹ️ closing period ${periodCode} for ${communityId} (approve=${approve})`)

  const prismaSvc = new PrismaService()
  await prismaSvc.$connect()
  const allocSvc = new AllocationService(prismaSvc as any)
  const paySvc = new PaymentService(prismaSvc as any)
  const periodSvc = new PeriodService(prismaSvc as any, allocSvc as any, paySvc as any)

  if (approve) {
    await periodSvc.approve(communityId, periodCode)
    console.log(`✅ Approved period ${periodCode} for ${communityId}`)
  } else {
    await periodSvc.prepare(communityId, periodCode)
    console.log(`✅ Prepared period ${periodCode} for ${communityId}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
