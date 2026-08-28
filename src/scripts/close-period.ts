import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PeriodService } from '../modules/period/period.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

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

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periodSvc = app.get(PeriodService)

  if (approve) {
    await periodSvc.approve(communityId, periodCode)
    console.log(`✅ Approved period ${periodCode} for ${communityId}`)
  } else {
    await periodSvc.prepare(communityId, periodCode)
    console.log(`✅ Prepared period ${periodCode} for ${communityId}`)
  }

  await app.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
