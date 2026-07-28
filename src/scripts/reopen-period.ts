/**
 * Reopen a period via the real PeriodService.reopen (cleans up the close-stage ledger / statements /
 * penalty buckets — not just a status flip). Uses the same lightweight Nest bootstrap as the seed scripts.
 *
 * Usage: ts-node src/scripts/reopen-period.ts [CommunityCode=Kralik] [periodCode=2026-05]
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
  const community = process.argv[2] || 'Kralik'
  const code = process.argv[3] || '2026-05'
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const res = await periods.reopen(community, code)
  console.log(`reopened ${community} ${code}:`, JSON.stringify(res))
  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
