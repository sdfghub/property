import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PeriodModule } from '../modules/period/period.module'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [PeriodModule] })
class ScriptModule {}

const COMMUNITY = 'Kralik'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService)

  const rows = await prisma.period.findMany({
    where: { communityId: COMMUNITY },
    orderBy: { seq: 'asc' },
    select: { code: true },
  })
  console.log(`posting fund charges for ${rows.length} periods...`)
  let ok = 0
  for (const r of rows) {
    try {
      const p = await prisma.period.findFirst({ where: { communityId: COMMUNITY, code: r.code }, select: { id: true } })
      // call the real charge-posting engine directly (prisma client acts as the tx)
      await (periods as any).postChargesForStage(prisma, COMMUNITY, p!.id, 'CLOSE_PREP')
      ok++
    } catch (e: any) {
      console.log(`  ❌ ${r.code}: ${e?.message || e}`)
    }
  }
  console.log(`posted ${ok}/${rows.length}`)

  // Fund contributions per period (source_type FUND)
  const contrib: any[] = await (prisma as any).$queryRawUnsafe(
    `select p.code as period, f.code as fund,
            cc.amount::float8 as total,
            count(ccl.id)::int as unit_lines
       from community_charge cc
       join period p on p.id = cc.period_id
       join fund f on f.id = cc.fund_id
       left join community_charge_line ccl on ccl.charge_id = cc.id
      where cc.community_id = $1 and cc.source_type = 'FUND'
      group by p.code, f.code, cc.amount
      order by p.code, f.code`,
    COMMUNITY,
  )
  console.log('\n=== fund contributions per period ===')
  let grand = 0
  const byFund: Record<string, { months: number; total: number }> = {}
  for (const c of contrib) {
    grand += Number(c.total)
    byFund[c.fund] = byFund[c.fund] || { months: 0, total: 0 }
    byFund[c.fund].months++
    byFund[c.fund].total += Number(c.total)
  }
  console.log(`  rows: ${contrib.length}  grand total: ${grand.toFixed(2)} RON`)
  console.log('\n=== per-fund rollup (across all months) ===')
  for (const [fund, v] of Object.entries(byFund)) {
    console.log(`  ${fund}: ${v.months} months, total ${v.total.toFixed(2)} RON`)
  }

  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
