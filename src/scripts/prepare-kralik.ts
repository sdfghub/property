import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PeriodModule } from '../modules/period/period.module'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [PeriodModule] })
class ScriptModule {}

const PERIODS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService)

  for (const code of PERIODS) {
    try {
      await periods.prepare('Kralik', code)
      console.log(`  ✅ prepared ${code}`)
    } catch (e: any) {
      console.log(`  ❌ ${code}: ${e?.message || e}`)
    }
  }

  const rows: any[] = await (prisma as any).$queryRawUnsafe(
    `select p.code period,
            coalesce(cc.allocation_snapshot->>'sourceFund', f.code) as fund,
            round(sum(ccl.amount),2)::float8 penalty
       from community_charge cc
       join period p on p.id = cc.period_id
       join fund f on f.id = cc.fund_id
       join community_charge_line ccl on ccl.charge_id = cc.id
      where cc.community_id='Kralik' and f.code='PENALIZARI'
      group by p.code, coalesce(cc.allocation_snapshot->>'sourceFund', f.code)
      order by p.code, fund`,
  )
  console.log('\n=== penalties posted per period / source fund ===')
  for (const r of rows) console.log(`  ${r.period}  ${r.fund}: ${r.penalty}`)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
