import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { FinanceModule } from '../modules/finance/finance.module'
import { FinanceService } from '../modules/finance/finance.service'
@Module({ imports: [FinanceModule] })
class M {}
async function main(){
  const app = await NestFactory.createApplicationContext(M,{logger:['error']})
  const f = app.get(FinanceService)
  const av:any = await f.avizier('PENTEST','2026-05')
  console.log('categories:', JSON.stringify(av.categories))
  console.log('groups:', av.groups.map((g:any)=>g.key).join(', '))
  console.log('penaltyFunds:', JSON.stringify(av.penaltyFunds))
  const u1 = av.rows.find((r:any)=>r.beCode==='OWNER-U1')
  console.log('U1 penaltyByFund:', JSON.stringify(u1.penaltyByFund))
  console.log('totals.penaltyByFund:', JSON.stringify(av.totals.penaltyByFund))
  await app.close()
}
main().catch(e=>{console.error(e);process.exit(1)})
