// Bootstrap BeUnitStatement for Kralik's April 2026-04 (already CLOSED) directly from
// data/Kralik/ledger-2026-04.json's `byUnit` map — real per-unit opening/charges/closing per
// fund, the same source seed-kralik-april-may.ts already reads and aggregates up to per-BE
// totals (discarding the unit split in the process). Nothing here is computed or estimated:
// dueStart/charges/dueEnd are transcribed straight from the JSON's own opening/charges/closing
// keys. This becomes May's real per-unit dueStart once PeriodService.prepare() runs May and
// computeUnitStatements() chains off April's dueEnd.
//
// Idempotent: upserts by (communityId, periodId, unitId, fundId).
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const COMM = 'Kralik'
const APRIL_CODE = '2026-04'

function loadJson(f: string) { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, f), 'utf8')) }

async function main() {
  const def = loadJson('def.json')
  const ledger = loadJson('ledger-2026-04.json')

  const april = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: APRIL_CODE } } })
  if (!april) throw new Error(`${APRIL_CODE} not found`)

  // Period-scoped code→BE resolution (a unit can have multiple structure[] rows over time, one
  // per ownership span — same pattern as seed-kralik-june-complete.ts's beOfCode, just anchored
  // to April's own seq instead of June's).
  const seqOf = (code: string) => { const [y, m] = code.split('-').map(Number); return y * 12 + m }
  const aprilSeq = seqOf(APRIL_CODE)
  const beCodeOf = new Map<string, string>()
  for (const u of def.structure || []) {
    if (!u.billingEntity) continue
    const start = u.startPeriod ? seqOf(u.startPeriod) : -Infinity
    const end = u.endPeriod ? seqOf(u.endPeriod) : Infinity
    if (aprilSeq >= start && aprilSeq <= end) beCodeOf.set(u.code, u.billingEntity)
  }

  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const unitIdByCode = new Map(units.map((u: any) => [u.code, u.id]))
  const bes = await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const beIdByCode = new Map(bes.map((b: any) => [b.code, b.id]))
  const funds = await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const fundIdByCode = new Map(funds.map((f: any) => [f.code, f.id]))

  let nUnits = 0, nRows = 0, missing: string[] = []
  for (const [unitCode, rec] of Object.entries<any>(ledger.byUnit || {})) {
    const unitId = unitIdByCode.get(unitCode)
    const beCode = beCodeOf.get(unitCode)
    const billingEntityId = beCode ? beIdByCode.get(beCode) : undefined
    if (!unitId || !billingEntityId) { missing.push(unitCode); continue }
    const funds3 = new Set([...Object.keys(rec.opening || {}), ...Object.keys(rec.charges || {}), ...Object.keys(rec.closing || {})])
    for (const fundCode of funds3) {
      const fundId = fundIdByCode.get(fundCode)
      if (!fundId) { console.log(`  ⚠ no fund ${fundCode}`); continue }
      const dueStart = Number(rec.opening?.[fundCode] ?? 0)
      const charges = Number(rec.charges?.[fundCode] ?? 0)
      const dueEnd = Number(rec.closing?.[fundCode] ?? 0)
      // payments/adjustments aren't separately known per unit in this source (only the net
      // opening→closing move is) — the balance-driven plug goes to `adjustments` (mirrors
      // seed-kralik-april-may.ts's own BE-level plug logic: payments = real register cash,
      // whatever isn't backed by that becomes an adjustment). No unit-level cash-register
      // detail exists for April, so the whole plug is booked as adjustment here, payments 0.
      const adjustments = Number((dueEnd - dueStart - charges).toFixed(4))
      await prisma.beUnitStatement.upsert({
        where: { communityId_periodId_unitId_fundId: { communityId: COMM, periodId: april.id, unitId, fundId } },
        update: { billingEntityId, dueStart, charges, payments: 0, adjustments, dueEnd },
        create: { communityId: COMM, periodId: april.id, unitId, billingEntityId, fundId, dueStart, charges, payments: 0, adjustments, dueEnd },
      })
      nRows++
    }
    nUnits++
  }
  console.log(`✅ seeded ${nRows} BeUnitStatement rows across ${nUnits} units for ${APRIL_CODE}`)
  if (missing.length) console.log(`  ⚠ skipped (no unit/BE resolved): ${missing.join(', ')}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
