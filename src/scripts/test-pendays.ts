import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { FinanceModule } from '../modules/finance/finance.module'
import { FinanceService } from '../modules/finance/finance.service'
@Module({ imports:[FinanceModule] }) class M {}
async function main(){
  const app = await NestFactory.createApplicationContext(M,{logger:['error']})
  const f = app.get(FinanceService)
  const ex:any = await f.explainPenalty('PENTEST','2026-05','OWNER-U1','EXPENSES')
  for (const b of ex.buckets){
    console.log(`${b.label} — totalDays=${b.totalDays}`)
    for (const h of b.history) console.log(`   ${h.periodCode}: days=${h.days} daysToDate=${h.daysToDate} posted=${h.penaltyPosted}`)
  }
  await app.close()
}
main().catch(e=>{console.error(e);process.exit(1)})
