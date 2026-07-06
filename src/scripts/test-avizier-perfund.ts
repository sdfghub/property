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

  const av: any = await finance.avizier(COMM, PERIOD)
  console.log('=== categories ===', JSON.stringify(av.categories))
  console.log('=== groups ===')
  for (const g of av.groups) console.log(`  [${g.key}] "${g.label}" → ${JSON.stringify(g.categories)}`)
  console.log('=== per-BE penalty categories (U1) ===')
  const u1 = av.rows.find((r: any) => r.beCode === 'OWNER-U1')
  console.log('  charges:', JSON.stringify(Object.fromEntries(Object.entries(u1.charges).filter(([k]) => k.startsWith('PEN:')))))

  console.log('\n=== explainPenalty filtered by fund (U1) ===')
  for (const fund of ['EXPENSES', 'REPARATII']) {
    const ex: any = await finance.explainPenalty(COMM, PERIOD, 'OWNER-U1', fund)
    console.log(`  ${fund}: month=${ex.monthTotal} total=${ex.grandTotal} buckets=${ex.buckets.length} (sourceFund=${ex.sourceFund})`)
  }
  const all: any = await finance.explainPenalty(COMM, PERIOD, 'OWNER-U1')
  console.log(`  ALL: month=${all.monthTotal} total=${all.grandTotal} buckets=${all.buckets.length}`)
  await app.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
