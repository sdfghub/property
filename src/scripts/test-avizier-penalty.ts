import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { FinanceModule } from '../modules/finance/finance.module'
import { FinanceService } from '../modules/finance/finance.service'

@Module({ imports: [FinanceModule] })
class ScriptModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const finance = app.get(FinanceService)
  const COMM = 'PENTEST', PERIOD = '2026-05'

  const av = await finance.avizier(COMM, PERIOD)
  console.log('=== avizier rows (penaltyMonth / penaltyTotal) ===')
  for (const r of av.rows) console.log(`  ${r.beCode}: month=${r.penaltyMonth} total=${r.penaltyTotal} totalDue=${r.totalDue}`)
  console.log(`  TOTALS: month=${av.totals.penaltyMonth} total=${av.totals.penaltyTotal}`)

  console.log('\n=== explainPenalty OWNER-U1 @ 2026-05 ===')
  const ex = await finance.explainPenalty(COMM, PERIOD, 'OWNER-U1')
  console.log(`monthTotal=${ex.monthTotal} grandTotal=${ex.grandTotal}`)
  for (const b of ex.buckets) {
    console.log(`  • ${b.label}: principal=${b.principalOriginal} remaining=${b.principalRemaining} rate=${b.ratePerDayPct}%/zi thisPeriod=${b.penaltyThisPeriod} toDate=${b.penaltyToDate} cap=${b.capReached}`)
    for (const h of b.history) console.log(`      ${h.periodCode}: rem=${h.principalRemaining} ${h.days}d posted=${h.penaltyPosted} accrued=${h.penaltyAccrued}${h.current ? ' *' : ''}`)
  }
  await app.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
