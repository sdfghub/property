import { PrismaService } from '../modules/user/prisma.service'
import { PenaltyLedgerService } from '../modules/period/penalty-ledger.service'

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  const svc = new PenaltyLedgerService(prisma as any)
  const COMM = 'Kralik'

  const period = await prisma.period.findFirst({ where: { communityId: COMM, code: '2026-03' } })
  if (!period) throw new Error('period not found')
  console.log(`period ${period.code} id=${period.id} status=${period.status} due=${period.dueDate?.toISOString().slice(0,10)}`)

  // 1) seed buckets from openings
  const seedRes = await svc.seedFromOpenings(COMM, period.id)
  console.log('seedFromOpenings:', seedRes)
  const buckets = await prisma.penaltyBucket.findMany({ where: { communityId: COMM }, include: { periods: true } })
  const byFund = new Map<string, { n: number; principal: number; carried: number }>()
  for (const b of buckets) {
    const f = await prisma.fund.findUnique({ where: { id: b.fundId }, select: { code: true } })
    const k = f?.code ?? b.fundId
    const cur = byFund.get(k) ?? { n: 0, principal: 0, carried: 0 }
    cur.n++; cur.principal += Number(b.principalOriginal); cur.carried += Number((b as any).seedPenaltyAccrued ?? 0)
    byFund.set(k, cur)
  }
  console.log('buckets seeded per fund:')
  for (const [k, v] of byFund) console.log(`  ${k}: ${v.n} buckets, principal=${v.principal.toFixed(2)}, carriedPenalty=${v.carried.toFixed(2)}`)

  // 2) dry-run advance (commit:false) inside a rolled-back tx
  let computed: Array<{ fund: string; posted: number }> = []
  try {
    await prisma.$transaction(async (tx) => {
      await svc.advance(tx as any, COMM, period.id, { commit: false })
      const rows: any[] = await tx.$queryRawUnsafe(
        `SELECT f.code AS fund, SUM(pbp.penalty_posted)::numeric(14,4) AS posted
         FROM penalty_bucket_period pbp
         JOIN penalty_bucket pb ON pb.id = pbp.bucket_id
         JOIN fund f ON f.id = pb.fund_id
         WHERE pb.community_id = $1 AND pbp.period_id = $2
         GROUP BY f.code ORDER BY f.code`, COMM, period.id)
      computed = rows.map((r) => ({ fund: r.fund, posted: Number(r.posted) }))
      throw new Error('__ROLLBACK__')
    })
  } catch (e: any) {
    if (e.message !== '__ROLLBACK__') throw e
  }
  console.log('\nNEW-ENGINE computed penalty posted this period (rolled back):')
  let total = 0
  for (const c of computed) { console.log(`  ${c.fund}: ${c.posted.toFixed(2)}`); total += c.posted }
  console.log(`  TOTAL new = ${total.toFixed(2)}`)
  console.log('  OLD engine baseline (penalty:EXPENSES) = 155.26')

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
