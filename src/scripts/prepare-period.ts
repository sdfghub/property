/**
 * Prepare a period via the real PeriodService.prepare (recomputes allocation + statements → avizier).
 * Same lightweight Nest bootstrap as the seed / reopen scripts.
 *
 * Usage: ts-node src/scripts/prepare-period.ts [CommunityCode=Kralik] [periodCode=2026-05]
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
  const res = await periods.prepare(community, code)
  console.log(`prepared ${community} ${code}:`, JSON.stringify(res))
  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
