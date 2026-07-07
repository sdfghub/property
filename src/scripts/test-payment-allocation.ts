/**
 * End-to-end integration test for per-community payment allocation strategies.
 *
 * Unlike the PENTEST seed (which inserts Payment rows directly), this drives the REAL
 * PaymentService.createOrApply → applyPayment path against a throwaway community, then
 * asserts how a partial payment is distributed across open charges for each strategy.
 *
 * Run:  npm run test:payment-allocation
 * Exits non-zero on any failed assertion. Cleans up its fixture on the way in and out.
 */
import { PrismaService } from '../modules/user/prisma.service'
import { PaymentService } from './../modules/billing/payment.service'

const COMM = 'ALLOC_TEST'
const BE = 'be-alloc-1'
const F_INTRET = 'fund-alloc-intret'
const F_PEN = 'fund-alloc-pen'

// Four open charges of 100 each: 2 periods × {principal (INTRET), penalty (PENALIZARI)}.
// createdAt ordered A<B<C<D so FIFO is deterministic.
const CHARGES = [
  { id: 'le-A', label: 'A', periodId: 'per-1', fundId: F_INTRET, createdAt: new Date('2026-01-10T00:00:00Z') },
  { id: 'le-B', label: 'B', periodId: 'per-1', fundId: F_PEN, createdAt: new Date('2026-01-11T00:00:00Z') },
  { id: 'le-C', label: 'C', periodId: 'per-2', fundId: F_INTRET, createdAt: new Date('2026-02-10T00:00:00Z') },
  { id: 'le-D', label: 'D', periodId: 'per-2', fundId: F_PEN, createdAt: new Date('2026-02-11T00:00:00Z') },
]
const AMT = 100

async function cleanup(prisma: any) {
  const pays = await prisma.payment.findMany({ where: { communityId: COMM }, select: { id: true } })
  const payIds = pays.map((p: any) => p.id)
  if (payIds.length) await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: payIds } } })
  for (const t of ['beLedgerEntryDetail', 'communityLedgerEntryDetail', 'fundLedgerEntryDetail',
    'beLedgerEntry', 'communityLedgerEntry', 'fundLedgerEntry', 'payment', 'fund', 'billingEntity', 'period']) {
    await (prisma as any)[t].deleteMany({ where: { communityId: COMM } }).catch(() => {})
  }
  await prisma.community.deleteMany({ where: { id: COMM } }).catch(() => {})
}

async function seed(prisma: any) {
  await prisma.community.create({ data: { id: COMM, code: COMM, name: 'Allocation Test' } })
  await prisma.period.createMany({ data: [
    { id: 'per-1', communityId: COMM, code: '2026-01', seq: 1, startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'), dueDate: new Date('2026-02-01') },
    { id: 'per-2', communityId: COMM, code: '2026-02', seq: 2, startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28'), dueDate: new Date('2026-03-01') },
  ] })
  await prisma.billingEntity.create({ data: { id: BE, communityId: COMM, code: 'AP1', name: 'Ap. 1' } })
  await prisma.fund.createMany({ data: [
    { id: F_INTRET, communityId: COMM, code: 'INTRET', name: 'Intretinere' },
    { id: F_PEN, communityId: COMM, code: 'PENALIZARI', name: 'Penalizari' },
  ] })
  for (const c of CHARGES) {
    await prisma.beLedgerEntry.create({ data: {
      id: c.id, communityId: COMM, periodId: c.periodId, billingEntityId: BE,
      kind: 'CHARGE', lane: 'ACCRUAL', amount: AMT, currency: 'RON', fundId: c.fundId, createdAt: c.createdAt,
    } })
    await prisma.beLedgerEntryDetail.create({ data: {
      ledgerEntryId: c.id, communityId: COMM, periodId: c.periodId, billingEntityId: BE,
      kind: 'CHARGE', fundId: c.fundId, currency: 'RON', amount: AMT,
    } })
  }
}

async function resetPayments(prisma: any) {
  const pays = await prisma.payment.findMany({ where: { communityId: COMM }, select: { id: true } })
  const ids = pays.map((p: any) => p.id)
  if (ids.length) await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: ids } } })
  await prisma.beLedgerEntryDetail.deleteMany({ where: { communityId: COMM, kind: 'PAYMENT' } })
  await prisma.beLedgerEntry.deleteMany({ where: { communityId: COMM, kind: 'PAYMENT' } })
  await prisma.payment.deleteMany({ where: { communityId: COMM } })
}

/** paid amount per charge label after a run */
async function paidByLabel(prisma: any): Promise<Record<string, number>> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT pa.charge_id AS id, SUM(pa.amount)::float8 AS paid
     FROM payment_application pa
     JOIN be_ledger_entry le ON le.id = pa.charge_id
     WHERE le.community_id = $1
     GROUP BY pa.charge_id`, COMM)
  const byId = new Map(rows.map((r) => [r.id, Number(r.paid)]))
  const out: Record<string, number> = {}
  for (const c of CHARGES) { const v = byId.get(c.id) || 0; if (v) out[c.label] = Number(v.toFixed(2)) }
  return out
}

type Case = { name: string; config: any; amount: number; expected: Record<string, number> }
const CASES: Case[] = [
  // Pay 150 (1.5 charges). Each strategy fills its own order → a distinct distribution.
  { name: 'FIFO', config: { strategy: 'FIFO' }, amount: 150, expected: { A: 100, B: 50 } },
  { name: 'LEGAL_PER_PERIOD', config: { strategy: 'LEGAL_PER_PERIOD' }, amount: 150, expected: { B: 100, A: 50 } },
  { name: 'LEGAL_PENALTIES_FIRST', config: { strategy: 'LEGAL_PENALTIES_FIRST' }, amount: 150, expected: { B: 100, D: 50 } },
  { name: 'FUND_PRIORITY[INTRET,PEN]', config: { strategy: 'FUND_PRIORITY', fundOrder: ['INTRET', 'PENALIZARI'] }, amount: 150, expected: { A: 100, C: 50 } },
]

function eq(a: Record<string, number>, b: Record<string, number>) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort()
  if (ka.join() !== kb.join()) return false
  return ka.every((k) => Math.abs(a[k] - b[k]) < 0.001)
}

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  const svc = new PaymentService(prisma as any)
  let failed = 0
  try {
    await cleanup(prisma)
    await seed(prisma)
    for (let i = 0; i < CASES.length; i++) {
      const c = CASES[i]
      await prisma.community.update({ where: { id: COMM }, data: { paymentAllocation: c.config } })
      await resetPayments(prisma)
      await svc.createOrApply(COMM, { billingEntityId: BE, amount: c.amount, refId: `alloc-test-${i}` })
      const got = await paidByLabel(prisma)
      const ok = eq(got, c.expected)
      if (!ok) failed++
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(26)} paid=${JSON.stringify(got)}  expected=${JSON.stringify(c.expected)}`)
    }
  } finally {
    await cleanup(prisma)
    await prisma.$disconnect()
  }
  if (failed) { console.error(`\n${failed} case(s) failed`); process.exit(1) }
  console.log('\nAll payment-allocation cases passed ✅')
}

main().catch((e) => { console.error(e); process.exit(1) })
