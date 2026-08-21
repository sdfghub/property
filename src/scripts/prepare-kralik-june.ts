// Close June's remaining bill templates (Interfon = 0, no invoice found), set the afișare date from
// the Cheltuieli table header (10.08.2026), and run PeriodService.prepare() — computes BeStatement
// (Restanțe/dueEnd) for real, applying the 62 imported payments. Does NOT approve/close the period.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-06'
const AFISARE = '2026-08-10'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: PERIOD_CODE } } })
  await prisma.period.update({ where: { id: period.id }, data: { afisareDate: new Date(AFISARE) } })
  console.log(`afisareDate set to ${AFISARE}`)

  for (const b of await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: period.id, templateId: b.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: period.id, templateId: b.id, state: 'CLOSED' },
    })
  }
  console.log('all bill templates closed (Interfon: no invoice, 0 charge)')

  await periods.prepare(COMM, PERIOD_CODE)
  console.log('✅ June 2026-06 prepared')

  const totals: any[] = await prisma.$queryRawUnsafe(
    `select round(sum(due_start),2)::float8 opening, round(sum(charges),2)::float8 charges,
            round(sum(payments),2)::float8 payments, round(sum(adjustments),2)::float8 adjustments,
            round(sum(due_end),2)::float8 debt
       from be_statement where community_id=$1 and period_id=$2`, COMM, period.id)
  console.log('June statement totals:', totals[0])

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
