import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { TemplateService } from '../modules/billing/template.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [BillingModule] })
class ScriptModule {}

const COMMUNITY = 'Kralik'
const PERIOD = '2026-03'

async function main() {
  const actualsPath = path.join(process.cwd(), 'data', COMMUNITY, `actuals-${PERIOD}.json`)
  const actuals = JSON.parse(fs.readFileSync(actualsPath, 'utf8'))
  const items: any[] = actuals.items || []

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error', 'warn'] })
  const templates = app.get(TemplateService)
  const prisma = app.get(PrismaService)

  const period = await prisma.period.findFirst({ where: { communityId: COMMUNITY, code: PERIOD }, select: { id: true } })
  if (!period) throw new Error('period not found')

  // wipe any prior charges/lines/vendor invoices for this period (removes earlier dummy run)
  await (prisma as any).$executeRawUnsafe(
    `delete from community_charge_line where community_id=$1 and period_id=$2`, COMMUNITY, period.id)
  await (prisma as any).$executeRawUnsafe(
    `delete from fund_invoice where invoice_id in (
        select id from vendor_invoice where template_instance_id in (
          select id from bill_template_instance where community_id=$1 and period_id=$2))`,
    COMMUNITY, period.id)
  await (prisma as any).$executeRawUnsafe(
    `delete from vendor_invoice where template_instance_id in (select id from bill_template_instance where community_id=$1 and period_id=$2)`,
    COMMUNITY, period.id)
  await (prisma as any).$executeRawUnsafe(
    `delete from community_charge where community_id=$1 and period_id=$2`, COMMUNITY, period.id)
  console.log('cleared prior charges/lines/vendor invoices for', PERIOD)

  for (const it of items) {
    const amount = Number(it.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      console.log(`  – skip ${it.templateCode} (amount ${it.amount})`)
      continue
    }
    try {
      await templates.saveBillTemplateState(COMMUNITY, PERIOD, it.templateCode, [], {
        state: 'SUBMITTED',
        values: {
          [it.detailKey]: amount,
          invoiceNumber: it.invoiceNumber,
          invoiceGross: it.invoiceGross ?? amount,
          serviceStartPeriod: it.serviceStartPeriod ?? PERIOD,
          serviceEndPeriod: it.serviceEndPeriod ?? PERIOD,
        },
      })
      console.log(`  ✅ ${it.templateCode} = ${amount} RON`)
    } catch (e: any) {
      console.log(`  ❌ ${it.templateCode}: ${e?.message || e}`)
    }
  }

  console.log('\n=== community_charge summary (period 2026-03) ===')
  const charges: any[] = await (prisma as any).$queryRawUnsafe(
    `select coalesce(cc.allocation_snapshot->>'expenseType', cc.source_key) as expense,
            cc.amount::float8 as amount, cc.allocation_strategy as strat,
            count(ccl.id)::int as lines,
            count(distinct round(ccl.amount,2))::int as distinct_amts,
            coalesce(sum(ccl.amount),0)::float8 as allocated
       from community_charge cc
       left join community_charge_line ccl on ccl.charge_id = cc.id
      where cc.community_id = $1 and cc.period_id = $2
      group by 1, cc.amount, cc.allocation_strategy
      order by cc.amount desc`,
    COMMUNITY, period.id)
  let total = 0
  for (const c of charges) {
    total += Number(c.amount)
    console.log(`  ${c.expense}: ${c.amount} RON -> ${c.lines} lines, ${c.distinct_amts} distinct, allocated=${Number(c.allocated).toFixed(2)}`)
  }
  console.log(`  TOTAL expenses allocated: ${total.toFixed(2)} RON`)

  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
