// Kralik: inject April 2026-04 at ledger level (real opening balances + charges + payments), then
// compute May 2026-05 on top so May carries real debt. April is injected like the history importer
// (per-BE/fund beStatement chain: dueStart=opening, charges, payment-plug, dueEnd=May opening); the
// May engine's computeStatements chains dueStart from April's beStatement.dueEnd automatically.
//
// Inputs: data/Kralik/ledger-2026-04.json (per-unit per-fund opening/charges/closing) +
//         data/Kralik/actuals-2026-05.json (May vendor bills + per-unit water/residents + branch).
// The payment-plug per (BE,fund) = dueStart+charges-dueEnd is balance-driven, so it reproduces the
// validated May opening and inherently handles the 6 special transactions (see payments-2026-05.json
// / memory kralik-debt-special-transactions).
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
// afisare = the vendor's posting/display date (Data-Config). The penalty engine accrues over the
// afisare-to-afisare window (May = 2026-06-11+1 .. 2026-07-13 = 32 days), reproducing the vendor total.
const APR = { code: '2026-04', start: '2026-04-01', end: '2026-04-30', due: '2026-05-15', afisare: '2026-06-11' }
const MAY = { code: '2026-05', start: '2026-05-01', end: '2026-05-31', due: '2026-06-15', afisare: '2026-07-13' }
const REF = 'APRIL_INJECT'

function loadJson(f: string) { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, f), 'utf8')) }

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const def = loadJson('def.json')
  const ledger = loadJson('ledger-2026-04.json')
  const packet = loadJson('actuals-2026-05.json')
  const cpiByCode: Record<string, number> = Object.fromEntries((def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, Number(u.cpi)]))
  const beByCode: Record<string, string> = Object.fromEntries((def.structure || []).map((u: any) => [u.code, u.billingEntity]))

  // Actual register cash per (BE, fund) for the April cycle — EXCLUDING cycle:"prior" receipts (those
  // settle a pre-April balance already baked into the April opening). Owner payments come from the
  // register; whatever balance reduction isn't backed by this cash becomes an adjustment below.
  const cash = loadJson('cash-2026-05.json')
  const mp = loadJson('history-mapping.json')
  const prefixL = mp.unitLabelPrefix ?? ''
  const normLbl = (x: string) => String(x).replace(/ /g, '').replace(/[\s./]/g, '').toUpperCase()
  const byNormLbl = new Map<string, string>()
  for (const u of def.structure || []) { const nm = String(u.name || ''); const lab = nm.startsWith(prefixL) ? nm.slice(prefixL.length) : (nm || u.code); byNormLbl.set(normLbl(lab), u.code) }
  const ovNormLbl = new Map<string, string>(Object.entries(mp.unitOverrides || {}).map(([k, v]: any) => [normLbl(k), v as string]))
  const resolveCode = (lab: string) => { const n = normLbl(lab); return ovNormLbl.get(n) ?? byNormLbl.get(n) ?? null }
  const cashByBeFund = new Map<string, number>()
  for (const t of (cash.tx || [])) {
    if (t.void || t.dir !== 'IN' || t.kind !== 'PAYMENT' || t.cycle === 'prior' || !t.unit) continue
    const code = resolveCode(t.unit); const be = code ? beByCode[code] : null
    if (!be) continue
    const fundsObj: Record<string, number> = t.funds || { [t.fund || 'EXPENSES']: t.amount }
    for (const [fc, amt] of Object.entries(fundsObj)) { const kk = `${be}::${fc}`; cashByBeFund.set(kk, (cashByBeFund.get(kk) || 0) + Number(amt)) }
  }

  // ── config patches (same as seed-kralik-may) ──
  await prisma.community.update({ where: { id: COMM }, data: { penaltyGraceDays: 30 } })
  // ensure the penalty engine runs on prepare/approve (default is on; set explicitly for safety)
  const commFeat = await prisma.community.findUnique({ where: { id: COMM }, select: { features: true } })
  await prisma.community.update({ where: { id: COMM }, data: { features: { ...((commFeat?.features as any) || {}), penalties: true } } })
  const cpiRule = (def.allocationRules || []).find((r: any) => r.code === 'BY_CPI')
  const cpiWeights = cpiRule?.params?.weights || cpiByCode
  for (const f of await prisma.fund.findMany({ where: { communityId: COMM } })) {
    const a = (f.allocation as any) || {}
    if (a.method === 'BY_CPI') await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...a, method: 'EXPLICIT', weights: cpiWeights } } })
    if (a.penaltyPerDayPct != null && Number(a.penaltyPerDayPct) !== 0) await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...((await prisma.fund.findUnique({ where: { id: f.id } })).allocation as any), penaltyPerDayPct: 0 } } })
  }
  for (const et of await prisma.expenseType.findMany({ where: { communityId: COMM } })) {
    const p = (et.params as any) || {}
    if (!p.fundCode) await prisma.expenseType.update({ where: { id: et.id }, data: { params: { ...p, fundCode: def.expenseFundCode || 'EXPENSES' } } })
  }
  // close the 2026-03 anchor (empty) so getEditable resolves to the working period, keep it for fund offset
  await prisma.period.updateMany({ where: { communityId: COMM, code: '2026-03', status: { not: 'CLOSED' } }, data: { status: 'CLOSED' } })

  // id maps
  const funds = new Map<string, string>((await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((f: any) => [f.code, f.id]))
  const beIds = new Map<string, string>((await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((b: any) => [b.code, b.id]))
  const unitIds = new Map<string, string>((await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((u: any) => [u.code, u.id]))

  // ── 1) inject April 2026-04 ──
  const [ay, am] = APR.code.split('-').map(Number)
  const aprPeriod = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: APR.code } },
    update: { status: 'CLOSED', seq: ay * 12 + am, startDate: new Date(APR.start), endDate: new Date(APR.end), dueDate: new Date(APR.due), afisareDate: new Date(APR.afisare) },
    create: { communityId: COMM, code: APR.code, seq: ay * 12 + am, status: 'CLOSED', preparedAt: new Date(APR.end), closedAt: new Date(APR.end), startDate: new Date(APR.start), endDate: new Date(APR.end), dueDate: new Date(APR.due), afisareDate: new Date(APR.afisare) },
  })
  // clear prior injection artifacts (idempotent)
  const priorLe = await prisma.beLedgerEntry.findMany({ where: { communityId: COMM, periodId: aprPeriod.id, refType: { in: [REF, REF + '_PAY', REF + '_ADJ'] } }, select: { id: true } })
  if (priorLe.length) { await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: priorLe.map((x: any) => x.id) } } }); await prisma.beLedgerEntry.deleteMany({ where: { id: { in: priorLe.map((x: any) => x.id) } } }) }
  await prisma.beStatement.deleteMany({ where: { communityId: COMM, periodId: aprPeriod.id } })

  // aggregate per (BE, fund): opening, charges, closing + per-unit charge detail
  type Agg = { open: number; chg: number; close: number; units: Map<string, number> }
  const bf = new Map<string, Agg>()
  const key = (be: string, fund: string) => `${be}::${fund}`
  const get = (be: string, fund: string) => { const k = key(be, fund); let a = bf.get(k); if (!a) { a = { open: 0, chg: 0, close: 0, units: new Map() }; bf.set(k, a) } return a }
  for (const [uc, rec] of Object.entries<any>(ledger.byUnit)) {
    const be = beByCode[uc]; if (!be) { console.log(`  ⚠ no BE for unit ${uc}`); continue }
    for (const [fund, v] of Object.entries<any>(rec.opening || {})) get(be, fund).open += Number(v)
    for (const [fund, v] of Object.entries<any>(rec.charges || {})) { const a = get(be, fund); a.chg += Number(v); a.units.set(uc, (a.units.get(uc) || 0) + Number(v)) }
    for (const [fund, v] of Object.entries<any>(rec.closing || {})) get(be, fund).close += Number(v)
  }

  let aprCloseTotal = 0
  for (const [k, a] of bf) {
    const [be, fund] = k.split('::')
    const beId = beIds.get(be), fundId = funds.get(fund)
    if (!beId || !fundId) { console.log(`  ⚠ missing be/fund ${be}/${fund}`); continue }
    // CHARGE ledger + per-unit detail
    if (Math.abs(a.chg) > 0.005) {
      const le = await prisma.beLedgerEntry.create({ data: { communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'CHARGE', lane: 'ACCRUAL', amount: a.chg, currency: 'RON', refType: REF, refId: aprPeriod.id, fundId } })
      await prisma.beLedgerEntryDetail.createMany({ data: Array.from(a.units.entries()).map(([u, amt]) => ({ ledgerEntryId: le.id, communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'CHARGE', fundId, currency: 'RON', refType: REF, refId: aprPeriod.id, unitId: unitIds.get(u)!, amount: amt, meta: { source: REF } })) })
    }
    // balance chain: payments = real register cash; adjustments absorb the rest so dueEnd lands on
    // a.close. plug = dueStart + charges - dueEnd is the total reduction the balance needs.
    const plug = Number((a.open + a.chg - a.close).toFixed(4))
    const payments = Number((cashByBeFund.get(k) ?? 0).toFixed(4))
    const adjustments = Number((payments - plug).toFixed(4)) // negative ⇒ forgiveness/credit; 0 when cash==plug
    if (payments > 0.005) {
      const le = await prisma.beLedgerEntry.create({ data: { communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'PAYMENT', lane: 'CASH', amount: payments, currency: 'RON', refType: REF + '_PAY', refId: aprPeriod.id, fundId } })
      await prisma.beLedgerEntryDetail.create({ data: { ledgerEntryId: le.id, communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'PAYMENT', fundId, currency: 'RON', refType: REF + '_PAY', refId: aprPeriod.id, unitId: null, amount: payments, meta: { source: REF } } })
    }
    if (Math.abs(adjustments) > 0.005) {
      const reason = fund === 'PENALIZARI' ? 'scutire-penalizari' : 'reconciliere-numerar'
      const le = await prisma.beLedgerEntry.create({ data: { communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'ADJUSTMENT', lane: 'ACCRUAL', amount: adjustments, currency: 'RON', refType: REF + '_ADJ', refId: aprPeriod.id, fundId } })
      await prisma.beLedgerEntryDetail.create({ data: { ledgerEntryId: le.id, communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, kind: 'ADJUSTMENT', fundId, currency: 'RON', refType: REF + '_ADJ', refId: aprPeriod.id, unitId: null, amount: adjustments, meta: { source: REF, reason } } })
    }
    await prisma.beStatement.create({ data: { communityId: COMM, periodId: aprPeriod.id, billingEntityId: beId, fundId, dueStart: a.open, charges: a.chg, payments, adjustments, dueEnd: a.close } })
    aprCloseTotal += a.close
  }
  console.log(`injected April: ${bf.size} (BE,fund) statements; Σ dueEnd (=May opening) = ${aprCloseTotal.toFixed(2)}`)

  // April community_statement = rollup of its per-BE statements (same definition the engine now uses),
  // so April is a complete closed period.
  const aprAgg = await prisma.beStatement.aggregate({ where: { communityId: COMM, periodId: aprPeriod.id }, _sum: { dueStart: true, charges: true, payments: true, adjustments: true, dueEnd: true } })
  const cs = { dueStart: Number(aprAgg._sum.dueStart ?? 0), charges: Number(aprAgg._sum.charges ?? 0), payments: Number(aprAgg._sum.payments ?? 0), adjustments: Number(aprAgg._sum.adjustments ?? 0), dueEnd: Number(aprAgg._sum.dueEnd ?? 0), currency: 'RON' }
  await prisma.communityStatement.upsert({
    where: { communityId_periodId: { communityId: COMM, periodId: aprPeriod.id } },
    update: cs, create: { communityId: COMM, periodId: aprPeriod.id, ...cs },
  })

  // community_charge/lines so the April avizier shows charge columns (per-fund; EXPENSES lumped as
  // INTRETINERE since the sheet's April maintenance is carried as one bucket here).
  const priorCC = await prisma.communityCharge.findMany({ where: { communityId: COMM, periodId: aprPeriod.id, allocationStrategy: REF }, select: { id: true } })
  if (priorCC.length) { await prisma.communityChargeLine.deleteMany({ where: { chargeId: { in: priorCC.map((x: any) => x.id) } } }); await prisma.communityCharge.deleteMany({ where: { id: { in: priorCC.map((x: any) => x.id) } } }) }
  const svc = new Map<string, { fund: string; service: string; lines: Array<{ be: string; unit: string; amount: number }> }>()
  for (const [uc, rec] of Object.entries<any>(ledger.byUnit)) {
    const be = beByCode[uc]; if (!be) continue
    for (const [fund, v] of Object.entries<any>(rec.charges || {})) {
      if (!(Math.abs(Number(v)) > 0.005)) continue
      const service = fund === 'EXPENSES' ? 'INTRETINERE' : fund === 'PENALIZARI' ? 'penalty:EXPENSES' : 'CONTRIB'
      const sk = `${fund}::${service}`
      let s = svc.get(sk); if (!s) { s = { fund, service, lines: [] }; svc.set(sk, s) }
      s.lines.push({ be, unit: uc, amount: Number(v) })
    }
  }
  for (const [, s] of svc) {
    const total = s.lines.reduce((a, l) => a + l.amount, 0)
    const isPenalty = s.service.startsWith('penalty:')
    const isFund = !isPenalty && s.service === 'CONTRIB'
    const sourceType = isFund ? 'FUND' : 'EXPENSE'
    const sourceId = isFund ? s.fund : s.service
    const sourceKey = isFund ? 'offset:0' : s.service
    const allocationSnapshot = (!isPenalty && !isFund) ? { expenseType: s.service } : undefined
    const cc = await prisma.communityCharge.upsert({
      where: { communityId_periodId_sourceType_sourceId_sourceKey_fundId: { communityId: COMM, periodId: aprPeriod.id, sourceType, sourceId, sourceKey, fundId: funds.get(s.fund)! } },
      update: { amount: total, allocationStrategy: REF, status: 'ACTIVE', allocationSnapshot },
      create: { communityId: COMM, periodId: aprPeriod.id, fundId: funds.get(s.fund)!, sourceType, sourceId, sourceKey, amount: total, currency: 'RON', allocationStrategy: REF, status: 'ACTIVE', allocationSnapshot, meta: { source: REF, service: s.service } },
    })
    await prisma.communityChargeLine.deleteMany({ where: { chargeId: cc.id } })
    await prisma.communityChargeLine.createMany({ data: s.lines.map((l) => ({ chargeId: cc.id, communityId: COMM, periodId: aprPeriod.id, billingEntityId: beIds.get(l.be)!, unitId: unitIds.get(l.unit)!, amount: l.amount, meta: { source: REF, service: s.service, fund: s.fund } })) })
  }

  // ── 1b) import penalty buckets from the vendor's per-bucket list (rate>0 only) ──
  // These carry the historical accrued penalty (seedPenaltyAccrued) that April forgives above, and drive
  // May-forward penalties via the engine: advance() ages each bucket over the afisare window. No
  // PenaltyBucketPeriod rows — advance()'s no-prior-period fallback starts from principalOriginal +
  // seedPenaltyAccrued (penalty-ledger.service.ts). The May charge = restanta·rate·32 (=72.62 / 3.72).
  const penBuckets = loadJson('penalty-buckets-2026-05.json')
  await prisma.penaltyBucket.deleteMany({ where: { communityId: COMM, originKey: { startsWith: 'migrated-debt:' } } })
  const expFundId = funds.get('EXPENSES')!, penFundId = funds.get('PENALIZARI')!
  let seededBuckets = 0
  for (const [uc, rec] of Object.entries<any>(penBuckets)) {
    const be = beByCode[uc]; const beId = be ? beIds.get(be) : null; const unitId = unitIds.get(uc)
    if (!beId || !unitId) { console.log(`  ⚠ penalty bucket: no be/unit for ${uc}`); continue }
    for (const b of rec.buckets || []) {
      const scad = new Date(b.scadenta) // buckets are years past-due; firstPenalDay only needs to precede May
      await prisma.penaltyBucket.create({ data: {
        communityId: COMM, billingEntityId: beId, unitId, fundId: expFundId, targetFundId: penFundId,
        originKey: `migrated-debt:${uc}:${b.originMonth}`, dueDate: scad, firstPenalDay: scad,
        principalOriginal: b.restanta, seedPenaltyAccrued: b.seedAccrued, ratePerDayPct: b.rate * 100, status: 'OPEN',
      } })
      seededBuckets++
    }
  }
  console.log(`  seeded ${seededBuckets} penalty buckets across ${Object.keys(penBuckets).length} units`)

  // ── 2) compute May 2026-05 (chains from April beStatement.dueEnd) ──
  const [my, mm] = MAY.code.split('-').map(Number)
  const mayPeriod = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: MAY.code } },
    update: { startDate: new Date(MAY.start), endDate: new Date(MAY.end), dueDate: new Date(MAY.due), afisareDate: new Date(MAY.afisare), status: 'OPEN', preparedAt: null, closedAt: null },
    create: { communityId: COMM, code: MAY.code, seq: my * 12 + mm, status: 'OPEN', startDate: new Date(MAY.start), endDate: new Date(MAY.end), dueDate: new Date(MAY.due), afisareDate: new Date(MAY.afisare) },
  })
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const byUnit = packet.unitMeasures?.byUnit || {}
  for (const u of units) {
    const up = async (typeCode: string, value: number, origin: string) => prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: mayPeriod.id, scopeType: 'UNIT', scopeId: u.id, typeCode } },
      update: { value, origin, meterId: `${typeCode}-${u.code}` },
      create: { communityId: COMM, periodId: mayPeriod.id, scopeType: 'UNIT', scopeId: u.id, typeCode, value, origin, meterId: `${typeCode}-${u.code}` },
    })
    if (cpiByCode[u.code] != null) await up('SQM', cpiByCode[u.code], 'ADMIN')
    const um = byUnit[u.code]
    if (um) { await up('RESIDENTS', Number(um.residents) || 0, 'DECLARATION'); await up('WATER_COLD', Number(um.water_cold) || 0, 'ADMIN') }
  }
  const branch = Number(packet.meters?.community?.COMMUNITY_WATER_COLD)
  if (branch > 0) await templates.upsertMeterReading(COMM, MAY.code, [], { meterId: 'COMMUNITY_WATER_COLD', value: branch })

  // group May actuals per template (3-line water bill → one submission)
  const groups = new Map<string, { values: Record<string, any>; meta: any }>()
  for (const it of (packet.items || [])) {
    const g = groups.get(it.templateCode) || { values: {}, meta: {} }
    if (Number(it.amount) > 0) g.values[it.detailKey] = Number(it.amount)
    g.meta.invoiceNumber = g.meta.invoiceNumber ?? it.invoiceNumber
    g.meta.invoiceGross = g.meta.invoiceGross ?? it.invoiceGross
    g.meta.serviceStartPeriod = MAY.code; g.meta.serviceEndPeriod = MAY.code
    groups.set(it.templateCode, g)
  }
  for (const [tc, g] of groups) {
    if (!Object.keys(g.values).length) continue
    try { await templates.saveBillTemplateState(COMM, MAY.code, tc, [], { state: 'SUBMITTED', values: { ...g.values, ...g.meta } }) }
    catch (e: any) { console.log(`  actuals ${tc}: ${e?.message || e}`) }
  }
  for (const b of await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true } }))
    await prisma.billTemplateInstance.upsert({ where: { communityId_periodId_templateId: { communityId: COMM, periodId: mayPeriod.id, templateId: b.id } }, update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: mayPeriod.id, templateId: b.id, state: 'CLOSED' } })
  for (const mt of await prisma.meterEntryTemplate.findMany({ where: { communityId: COMM }, select: { id: true } }))
    await prisma.meterEntryTemplateInstance.upsert({ where: { communityId_periodId_templateId: { communityId: COMM, periodId: mayPeriod.id, templateId: mt.id } }, update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: mayPeriod.id, templateId: mt.id, state: 'CLOSED' } })

  await periods.prepare(COMM, MAY.code)
  await periods.approve(COMM, MAY.code)
  console.log(`  ✅ ${MAY.code} prepared + approved (chained from injected April)`)

  // ── 3) report ──
  const mayDebt: any[] = await prisma.$queryRawUnsafe(
    `select round(sum(due_end),2)::float8 debt, round(sum(due_start),2)::float8 opening, round(sum(charges),2)::float8 charges, round(sum(payments),2)::float8 payments
       from be_statement where community_id=$1 and period_id=$2`, COMM, mayPeriod.id)
  console.log(`May statement totals: opening=${mayDebt[0]?.opening} charges=${mayDebt[0]?.charges} payments=${mayDebt[0]?.payments} → DEBT(dueEnd)=${mayDebt[0]?.debt}`)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
