// Correction: the April historical injection dropped the PENALIZARI closing/carry-forward for two
// units (ledger-2026-04.json's `closing` omits the PENALIZARI key for both, even though `opening`
// has real values) — a full write-off adjustment zeroed both to 0 instead of leaving the small
// residual the official record shows. Per user confirmation: Matei Viorel (1B) should carry 9.42 into
// May (1.39 of which gets collected in June, per the existing be_statement payment), Macri Nicodemo
// (11) should carry 3.70. Fixed by reopening May only, posting a MANUAL_ADJUSTMENT correction against
// May specifically (bypasses corrections.create()'s currentPeriod() resolution, which would otherwise
// always pick June since it's the later non-CLOSED period), re-preparing and re-closing May, then
// re-preparing June so its dueStart correctly chains from May's corrected dueEnd.
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

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  console.log('Reopening May...')
  await periods.reopen(COMM, '2026-05')

  const targets = [
    { name: 'Matei Viorel', amount: 9.42, note: 'RO: Penalizări reziduale la închiderea lunii mai (9,42 lei) omise din injecția istorică aprilie — restaurate conform Table Cheltuieli. EN: Residual May-closing penalty balance (9.42 RON) dropped from the historical April injection — restored per the official Table Cheltuieli figure.' },
    { name: 'Macri Nicodemo', amount: 3.70, note: 'RO: Penalizări reziduale la închiderea lunii mai (3,70 lei) omise din injecția istorică aprilie — restaurate conform Table Cheltuieli. EN: Residual May-closing penalty balance (3.70 RON) dropped from the historical April injection — restored per the official Table Cheltuieli figure.' },
  ]

  for (const t of targets) {
    const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, name: { contains: t.name } }, select: { id: true, name: true } })
    if (!be) { console.log(`  ⚠ BE not found: ${t.name}`); continue }
    const created = await prisma.correction.create({
      data: {
        communityId: COMM,
        periodCode: '2026-05',
        type: 'MANUAL_ADJUSTMENT',
        reason: 'ajustare-manuala',
        billingEntityId: be.id,
        fundCode: 'PENALIZARI',
        amount: t.amount,
        note: t.note,
        status: 'ACTIVE',
        createdBy: 'system:penalizari-mai-restore',
      },
    })
    console.log(`  correction created for ${be.name}: +${t.amount} RON (${created.id})`)
  }

  console.log('Preparing May (applies the correction)...')
  await periods.prepare(COMM, '2026-05')
  console.log('Approving/closing May again...')
  await periods.approve(COMM, '2026-05')

  console.log('Rejecting + re-preparing June (picks up May\'s corrected dueEnd)...')
  await periods.reject(COMM, '2026-06')
  await periods.prepare(COMM, '2026-06')
  console.log('✅ done')

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: '2026-06' } } })
  for (const t of targets) {
    const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, name: { contains: t.name } }, select: { id: true, name: true } })
    const row: any[] = await prisma.$queryRawUnsafe(
      `select bs.due_start::float8 ds, bs.payments::float8 pay, bs.due_end::float8 de
         from be_statement bs left join fund f on f.id=bs.fund_id
        where bs.community_id=$1 and bs.period_id=$2 and bs.billing_entity_id=$3 and f.code='PENALIZARI'`,
      COMM, period.id, be.id,
    )
    console.log(be.name, 'June PENALIZARI:', row[0])
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
