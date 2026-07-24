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
 * March's CHARGES are REAL — read from the export (matrix.csv, via parse-export), which does
 * contain March: the full REABILITARE_3 monthly billing (111,273.50), plus întreținere, rulment,
 * reparații, etc. The period still lands exactly on the vendor's April opening
 * (data/Kralik/ledger-2026-04.json) per (BE, fund); PAYMENTS are the residual plug:
 *
 *     dueStart = 2026-02 due_end                (per BE, fund)
 *     dueEnd   = April opening                  (data/Kralik/ledger-2026-04.json)
 *     charges  = March's real billing           (from the export)
 *     net      = dueStart + charges − dueEnd
 *        net > 0 → PAYMENT (net)                net < 0 → ADJUSTMENT (−net)
 *
 * so `dueEnd = dueStart + charges − payments + adjustments` holds exactly and the ledger runs
 * unbroken 2021-11 → 2026-05.
 *
 * Why still a "bridge" and not plain history injection: the export's April arrears are incomplete
 * for REABILITARE_3 (that fund started 2026-03), and the injector COMPUTES penalties while the seed
 * READS them from the ledger — so only anchoring March's close to the ledger opening keeps the
 * chain exact. What's inferred here is now just March's PAYMENTS (no March cash exists); its
 * CHARGES are real. Entries tagged refType 'BRIDGE_2603'.
 *
 * Idempotent: re-running replaces its own artifacts.
 */
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import { parseExport } from './history/parse-export'

const COMM = process.env.COMM || 'Kralik'
const PREV = '2026-02'
const CODE = '2026-03'
const REF = 'BRIDGE_2603'
// BeLedgerEntry is unique on (community, period, BE, ref_type, ref_id, fund), so the charge and
// payment legs of the same (BE, fund) must use distinct ref_types.
const REF_PAY = 'BRIDGE_2603P'

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

  // ── March's REAL charges per (BE, fund), from the export (matrix.csv contains March) ──
  //    EXPENSES = Σ of the month's service charges; each fund = its monthly contribution.
  const marchCharge = new Map<string, number>()
  const parsed = parseExport(path.join(process.cwd(), 'data', COMM))
  const march = parsed.months.find((mm: any) => mm.code === CODE)
  if (march) {
    for (const [uc, u] of Object.entries<any>(march.units)) {
      const be = beByCode[uc]; if (!be) continue
      const exp = Object.values((u.charges || {}) as Record<string, number>).reduce((a, b) => a + Number(b), 0)
      if (exp) marchCharge.set(`${be}::EXPENSES`, (marchCharge.get(`${be}::EXPENSES`) || 0) + exp)
      for (const [fund, v] of Object.entries<any>(u.funds || {})) {
        const k = `${be}::${fund}`; marchCharge.set(k, (marchCharge.get(k) || 0) + Number(v))
      }
    }
  } else {
    console.log('  ⚠ no March (2026-03) in the parsed export — charges will be 0 (falls back to plug)')
  }

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
  const priorLe = await prisma.beLedgerEntry.findMany({ where: { communityId: COMM, periodId: period.id, refType: { startsWith: REF } }, select: { id: true } })
  if (priorLe.length) {
    await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: priorLe.map((x: any) => x.id) } } })
    await prisma.beLedgerEntry.deleteMany({ where: { id: { in: priorLe.map((x: any) => x.id) } } })
  }
  await prisma.beStatement.deleteMany({ where: { communityId: COMM, periodId: period.id } })

  // ── each (BE, fund): real March charges, close anchored to April's opening, payments = plug ──
  let sumStart = 0, sumChg = 0, sumPay = 0, sumAdj = 0, sumEnd = 0, n = 0
  const perFund = new Map<string, { chg: number; pay: number }>()

  for (const k of new Set<string>([...source.keys(), ...target.keys(), ...marchCharge.keys()])) {
    const [beCode, fundCode] = k.split('::')
    const beId = beIds.get(beCode), fundId = funds.get(fundCode)
    if (!beId || !fundId) { console.log(`  ⚠ unknown ${k}`); continue }

    // Carry February's close at full precision — rounding it here would break the dueEnd→dueStart
    // chain by a cent and make `owed − paid == outstanding` fail for every later period.
    const dueStart = source.get(k) ?? 0
    const dueEnd = target.get(k) ?? 0
    // PENALIZARI is computed elsewhere (not billed here), so it carries no real "charge" — it plugs.
    const charges = fundCode === 'PENALIZARI' ? 0 : (marchCharge.get(k) ?? 0)
    // net = dueStart + charges − dueEnd; the residual is a payment (net>0) or an adjustment (net<0),
    // so `dueEnd = dueStart + charges − payments + adjustments` holds exactly.
    const net = dueStart + charges - dueEnd
    const payments = net > 0 ? net : 0
    const adjustments = net < 0 ? -net : 0
    if (dueStart === 0 && dueEnd === 0 && charges === 0) continue

    if (charges > 0.005) {
      const le = await prisma.beLedgerEntry.create({
        data: { communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, kind: 'CHARGE', lane: 'ACCRUAL', amount: charges, currency: 'RON', refType: REF, refId: period.id },
      })
      await prisma.beLedgerEntryDetail.create({
        data: { ledgerEntryId: le.id, communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, kind: 'CHARGE', currency: 'RON', refType: REF, refId: period.id, unitId: null, amount: charges, meta: { source: REF, note: 'real March billing (from export)' } },
      })
    }
    if (payments > 0.005) {
      const le = await prisma.beLedgerEntry.create({
        data: { communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, kind: 'PAYMENT', lane: 'CASH', amount: payments, currency: 'RON', refType: REF_PAY, refId: period.id },
      })
      await prisma.beLedgerEntryDetail.create({
        data: { ledgerEntryId: le.id, communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, kind: 'PAYMENT', currency: 'RON', refType: REF_PAY, refId: period.id, unitId: null, amount: payments, meta: { source: REF, note: 'plug payment: March close anchored to April opening (March cash not itemized)' } },
      })
    }

    await prisma.beStatement.create({
      data: { communityId: COMM, periodId: period.id, billingEntityId: beId, fundId, dueStart, charges, payments, adjustments, dueEnd },
    })

    const pf = perFund.get(fundCode) || { chg: 0, pay: 0 }
    pf.chg += charges; pf.pay += payments; perFund.set(fundCode, pf)
    sumStart += dueStart; sumChg += charges; sumPay += payments; sumAdj += adjustments; sumEnd += dueEnd; n++
  }

  console.log(`bridge ${CODE}: ${n} (BE,fund) statements`)
  console.log(`  dueStart (${PREV} close) = ${sumStart.toFixed(2)}`)
  console.log(`  charges  (real, export)  = ${sumChg.toFixed(2)}`)
  console.log(`  payments (plug)          = ${sumPay.toFixed(2)}`)
  console.log(`  adjustments (plug)       = ${sumAdj.toFixed(2)}`)
  console.log(`  dueEnd   (April opening) = ${sumEnd.toFixed(2)}`)
  const resid = r2(sumStart + sumChg - sumPay + sumAdj - sumEnd)
  console.log(`  identity residual       = ${resid.toFixed(2)} ${Math.abs(resid) < 0.01 ? '✅' : '❌'}`)
  console.log('  per fund:')
  for (const [f, v] of [...perFund].sort()) console.log(`    ${f.padEnd(15)} charges=${v.chg.toFixed(2).padStart(12)} payments=${v.pay.toFixed(2).padStart(12)}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
