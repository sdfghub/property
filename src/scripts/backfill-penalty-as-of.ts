// Penalties now run up to the day BEFORE the afișare date (penaltyBoundary in
// penalty-reconciliation.service.ts). Periods CLOSED under the earlier rule were computed through the
// afișare day itself; stamp that on them (penaltyAsOfDate = afisareDate) so their windows — and the
// start of the period after them — stay exactly as billed. Idempotent; only touches CLOSED periods
// with an afișare date and no penaltyAsOfDate.
//   npm run backfill:penalty-as-of            (all communities)
//   npm run backfill:penalty-as-of -- Kralik
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const communityId = process.argv[2]
  const rows = await prisma.period.findMany({
    where: { status: 'CLOSED', afisareDate: { not: null }, penaltyAsOfDate: null, ...(communityId ? { communityId } : {}) },
    select: { id: true, communityId: true, code: true, afisareDate: true },
    orderBy: [{ communityId: 'asc' }, { seq: 'asc' }],
  })
  for (const r of rows) {
    await prisma.period.update({ where: { id: r.id }, data: { penaltyAsOfDate: r.afisareDate } })
    console.log(`${r.communityId} ${r.code}: penaltyAsOfDate = ${r.afisareDate!.toISOString().slice(0, 10)}`)
  }
  console.log(`${rows.length} period(s) stamped`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
