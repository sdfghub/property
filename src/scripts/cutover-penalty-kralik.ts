import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PeriodModule } from '../modules/period/period.module'
import { PeriodService } from '../modules/period/period.service'
import { PenaltyLedgerService } from '../modules/period/penalty-ledger.service'
import { PrismaService } from '../modules/user/prisma.service'
import { FeaturesModule } from '../modules/features/features.module'

@Module({ imports: [FeaturesModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const CODE = '2026-03'

async function penaltyTotal(prisma: any): Promise<number> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(sum(ccl.amount),0)::float8 total
       from community_charge cc
       join period p on p.id = cc.period_id
       join community_charge_line ccl on ccl.charge_id = cc.id
      where cc.community_id=$1 and p.code=$2 and cc.source_key like 'penalty:%'`,
    COMM, CODE,
  )
  return Number(rows[0]?.total ?? 0)
}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const ledger = app.get(PenaltyLedgerService)
  const prisma = app.get(PrismaService) as any

  const period = await prisma.period.findFirst({ where: { communityId: COMM, code: CODE } })
  if (!period) throw new Error('period not found')

  console.log(`period ${CODE} status=${period.status} due=${period.dueDate?.toISOString().slice(0, 10)}`)
  console.log(`penalty BEFORE (old engine) = ${(await penaltyTotal(prisma)).toFixed(2)}`)

  // 1) cutover seed: opening arrears -> penalty buckets (idempotent, originKey='opening')
  const seed = await ledger.seedFromOpenings(COMM, period.id)
  console.log(`seedFromOpenings: ${JSON.stringify(seed)}`)

  // 2) reopen -> prepare -> approve through the real service flow
  await periods.reopen(COMM, CODE)
  console.log('reopened')
  await periods.prepare(COMM, CODE)
  console.log('prepared')
  await periods.approve(COMM, CODE)
  console.log('approved')

  // 3) verify
  const after = await prisma.period.findFirst({ where: { communityId: COMM, code: CODE } })
  const total = await penaltyTotal(prisma)
  console.log(`\nperiod status AFTER = ${after.status}`)
  console.log(`penalty AFTER (new engine) = ${total.toFixed(2)}   (target 153.37, old 155.26)`)

  const perFund: any[] = await prisma.$queryRawUnsafe(
    `select coalesce(cc.allocation_snapshot->>'sourceFund', 'PENALIZARI') fund,
            round(sum(ccl.amount),2)::float8 amt
       from community_charge cc
       join period p on p.id = cc.period_id
       join community_charge_line ccl on ccl.charge_id = cc.id
      where cc.community_id=$1 and p.code=$2 and cc.source_key like 'penalty:%'
      group by 1 order by 1`, COMM, CODE)
  console.log('per source fund:')
  for (const r of perFund) console.log(`  ${r.fund}: ${r.amt}`)

  const buckets = await prisma.penaltyBucket.groupBy({ by: ['status'], where: { communityId: COMM }, _count: true })
  console.log('buckets:', JSON.stringify(buckets))
  const bp = await prisma.penaltyBucketPeriod.groupBy({ by: ['status'], where: { periodId: period.id }, _count: true })
  console.log('bucket-periods this period:', JSON.stringify(bp))

  // ledger vs community_charge consistency for penalty rows
  const led: any[] = await prisma.$queryRawUnsafe(
    `select ref_type, round(sum(amount),2)::float8 amt, count(*) n
       from be_ledger_entry where community_id=$1 and period_id=$2 and ref_type like 'PENALTY%'
      group by ref_type`, COMM, period.id)
  console.log('penalty be_ledger rows:', JSON.stringify(led))

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
