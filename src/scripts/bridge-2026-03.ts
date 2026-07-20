/**
 * Kralik: bridge period 2026-03, joining the injected history to the April/May dataset.
 *
 *   npx ts-node --transpile-only src/scripts/bridge-2026-03.ts
 *
 * The two datasets meet at March and disagree there:
 *   - `history:inject` covers 2021-11..2026-02 (the vendor export stops at February).
 *   - `seed-kralik-april-may` starts from the vendor's April opening, and treats 2026-03 as an
 *     empty closed anchor.
 *   - `seed-kralik-close` instead *computes* 2026-03, booking 115,153.08 of charges and no
 *     payments — which duplicates April's REABILITARE_3 billing and overshoots the vendor's
 *     April opening by 210,384.55.
 *
 * Neither is right. March's real activity is in no source we hold. So this script makes 2026-03 a
 * *bridge*: it chains from February's close and lands exactly on the vendor's April opening, with
 * the difference booked per (BE, fund) using the same balance-plug both importers already use
 * (inject-history.ts:231, seed-kralik-april-may.ts:126):
 *
 *     dueStart = 2026-02 due_end          (per BE, fund)
 *     dueEnd   = April opening            (data/Kralik/ledger-2026-04.json)
 *     plug     = dueStart − dueEnd
 *        plug > 0 → the balance fell  → book it as a PAYMENT
 *        plug < 0 → the balance rose  → book it as a CHARGE
 *
 * so `dueEnd = dueStart + charges − payments` holds exactly and the ledger runs unbroken from
 * 2021-11 to 2026-05.
 *
 * ⚠ The billed/paid split *within* March is inferred, not observed. March's own collection rate
 * is therefore not meaningful; every other period is exact. Entries are tagged refType
 * 'BRIDGE_2603' so they can be identified.
 *
 * Idempotent: re-running replaces its own artifacts.
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const COMM = process.env.COMM || 'Kralik'
const PREV = '2026-02'
const CODE = '2026-03'
const REF = 'BRIDGE_2603'

const loadJson = (f: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, f), 'utf8'))
const r2 = (n: number) => Number(n.toFixed(2))

async function main() {
  const prisma = new PrismaClient() as any

  const def = loadJson('def.json')
  const ledger = loadJson('ledger-2026-04.json')
  const beByCode: Record<string, string> = Object.fromEntries((def.structure || []).map((u: any) => [u.code, u.billingEntity]))

  const funds = new Map<string, string>((await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((f: any) => [f.code, f.id]))
  const beIds = new Map<string, string>((await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((b: any) => [b.code, b.id]))

  // ── target: the vendor's April opening, per (BE, fund) ──
  const target = new Map<string, number>()
  for (const [uc, rec] of Object.entries<any>(ledger.byUnit)) {
    const be = beByCode[uc]
    if (!be) { console.log(`  ⚠ no BE for unit ${uc}`); continue }
    for (const [fund, v] of Object.entries<any>(rec.opening || {})) {
      const k = `${be}::${fund}`
      target.set(k, (target.get(k) || 0) + Number(v))
    }
  }

  // ── source: February's closing balance, per (BE, fund) ──
  const prev = await prisma.period.findFirst({ where: { communityId: COMM, code: PREV }, select: { id: true } })
  if (!prev) throw new Error(`${PREV} not found — run the history injection first`)
  const prevRows: any[] = await prisma.$queryRawUnsafe(
    `select be.code as be_code, f.code as fund_code, sum(bs.due_end)::float8 as due_end
       from be_statement bs
       join billing_entity be on be.id = bs.billing_entity_id
       join fund f on f.id = bs.fund_id
      where bs.community_id = $1 and bs.period_id = $2
      group by be.code, f.code`,
    COMM, prev.id,
  )
  const source = new Map<string, number>()
  for (const r of prevRows) source.set(`${r.be_code}::${r.fund_code}`, Number(r.due_end))

  // ── the bridge period itself ──
  const [y, m] = CODE.split('-').map(Number)
  const period = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: CODE } },
    update: { status: 'CLOSED' },
    create: {
      communityId: COMM, code: CODE, seq: y * 12 + m, status: 'CLOSED',
      startDate: new Date('2026-03-01'), endDate: new Date('2026-03-31'),
      preparedAt: new Date('2026-03-31'), closedAt: new Date('2026-03-31'),
    },
  })

  // idempotency: drop what a previous run of *this* script created
  const priorLe = await prisma.beLedgerEntry.findMany({ where: { communityId: COMM, periodId: period.id, refType: REF }, select: { id: true } })
  if (priorLe.length) {
    await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: priorLe.map((x: any) => x.id) } } })
    await prisma.beLedgerEntry.deleteMany({ where: { id: { in: priorLe.map((x: any) => x.id) } } })
  }
  await prisma.beStatement.deleteMany({ where: { communityId: COMM, periodId: period.id } })

  // ── plug each (BE, fund) from February's close onto April's opening ──
  let sumStart = 0, sumChg = 0, sumPay = 0, sumEnd = 0, n = 0
  const perFund = new Map<string, { chg: number; pay: number }>()

  for (const k of new Set<string>([...source.keys(), ...target.keys()])) {
    const [beCode, fundCode] = k.split('::')
    const beId = beIds.get(beCode), fundId = funds.get(fundCode)
    if (!beId || !fundId) { console.log(`  ⚠ unknown ${k}`); continue }

    // Carry February's close at full precision — rounding it here would break the dueEnd→dueStart
    // chain by a cent and make `owed − paid == outstanding` fail for every later period.
    const dueStart = source.get(k) ?? 0
    const dueEnd = target.get(k) ?? 0
    const plug = dueStart - dueEnd
    // Balance fell ⇒ money came in. Balance rose ⇒ something was billed. Booking the rise as a
    // charge rather than a negative adjustment keeps March's row readable in the avizier.
    const payments = plug > 0 ? plug : 0
    const charges = plug < 0 ? -plug : 0
    if (dueStart === 0 && dueEnd === 0) continue

    if (charges > 0.005 || payments > 0.005) {
      const le = await prisma.beLedgerEntry.create({
        data: {
          communityId: COMM, periodId: period.id, billingEntityId: beId, fundId,
          kind: charges > 0 ? 'CHARGE' : 'PAYMENT', lane: charges > 0 ? 'ACCRUAL' : 'CASH',
          amount: charges > 0 ? charges : payments, currency: 'RON', refType: REF, refId: period.id,
        },
      })
      await prisma.beLedgerEntryDetail.create({
        data: {
          ledgerEntryId: le.id, communityId: COMM, periodId: period.id, billingEntityId: beId, fundId,
          kind: charges > 0 ? 'CHARGE' : 'PAYMENT', currency: 'RON', refType: REF, refId: period.id,
          unitId: null, amount: charges > 0 ? charges : payments,
          meta: { source: REF, note: 'bridge plug: Feb close → April opening; billed/paid split inferred' },
        },
      })
    }

    await prisma.beStatement.create({
      data: { communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, dueStart, charges, payments, adjustments: 0, dueEnd },
    })

    const pf = perFund.get(fundCode) || { chg: 0, pay: 0 }
    pf.chg += charges; pf.pay += payments; perFund.set(fundCode, pf)
    sumStart += dueStart; sumChg += charges; sumPay += payments; sumEnd += dueEnd; n++
  }

  console.log(`bridge ${CODE}: ${n} (BE,fund) statements`)
  console.log(`  dueStart (${PREV} close) = ${sumStart.toFixed(2)}`)
  console.log(`  charges  (inferred)     = ${sumChg.toFixed(2)}`)
  console.log(`  payments (inferred)     = ${sumPay.toFixed(2)}`)
  console.log(`  dueEnd   (April opening)= ${sumEnd.toFixed(2)}`)
  const resid = r2(sumStart + sumChg - sumPay - sumEnd)
  console.log(`  identity residual       = ${resid.toFixed(2)} ${Math.abs(resid) < 0.01 ? '✅' : '❌'}`)
  console.log('  per fund:')
  for (const [f, v] of [...perFund].sort()) console.log(`    ${f.padEnd(15)} charges=${v.chg.toFixed(2).padStart(12)} payments=${v.pay.toFixed(2).padStart(12)}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
