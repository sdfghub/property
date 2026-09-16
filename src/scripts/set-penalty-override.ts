/**
 * Manual PENALIZARI override for a (community, period, billing entity) — thin wrapper around
 * PeriodService.overrideCharge, same lightweight Nest bootstrap as reopen-period.ts.
 *
 * Usage: ts-node src/scripts/set-penalty-override.ts <communityId> <periodCode> <beCode> <amount> <comment>
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PeriodService } from '../modules/period/period.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

async function main() {
  const [communityId, periodCode, beCode, amountStr, ...commentParts] = process.argv.slice(2)
  if (!communityId || !periodCode || !beCode || !amountStr || !commentParts.length) {
    console.error('Usage: ts-node src/scripts/set-penalty-override.ts <communityId> <periodCode> <beCode> <amount> <comment...>')
    process.exit(1)
  }
  const amount = Number(amountStr)
  const comment = commentParts.join(' ')
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const res = await periods.overrideCharge(communityId, periodCode, { be: beCode, fund: 'PENALIZARI', amount, comment }, 'script:set-penalty-override')
  console.log(`overrode ${communityId} ${periodCode} ${beCode} PENALIZARI:`, JSON.stringify(res))
  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
