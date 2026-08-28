// Kralik: seed June 2026-06 from a COMPLETE, gross-only actuals-2026-06.json + cash-2026-06.json,
// on top of May (already CLOSED). This consolidates what was originally built through a chain of
// one-off scripts (seed-kralik-june.ts partial submit → seed-kralik-june-water.ts → seed-kralik-
// june-remaining.ts → fix-kralik-june-vat.ts → import-kralik-cash-june.ts → fix-kralik-duplicate-
// payments.ts → fix-kralik-reattribute-payments.ts → fix-kralik-register-gap-payments.ts →
// fix-kralik-june-payment-specs.ts → prepare-kralik-june.ts) into a single pass, now that the real
// figures (water/residents readings, VAT-inclusive gross amounts, cash-register corrections) are
// all known and folded directly into the two source JSON files. Chains dueStart from May's
// beStatement.dueEnd automatically (architecture.md §2/§5); does not inject any ledger.
//
// Known gap vs. the original hand-built dev DB (documented in actuals-2026-06.json's own _note):
// comision_banca stays at the flat 12.00 RON placeholder — the real 136.00 RON correction exists
// only as a manually-edited VendorInvoice + an unapplied TODO Correction in dev, neither of which
// this script reproduces. Also not reproduced: the 3 register-gap entries' informational TODO
// Correction rows (zero ledger effect) and one payment's memo-only correction (n=100).
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
const JUNE = { code: '2026-06', start: '2026-06-01', end: '2026-06-30', due: '2026-09-09' }

function loadJson(f: string) { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, f), 'utf8')) }

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const def = loadJson('def.json')
  const packet = loadJson('actuals-2026-06.json')
  const cash = loadJson('cash-2026-06.json')
  const cpiByCode: Record<string, number> = Object.fromEntries(
    (def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, Number(u.cpi)]),
  )

  // ── config patches (idempotent, same as the April/May seed) ──
  const cpiRule = (def.allocationRules || []).find((r: any) => r.code === 'BY_CPI')
  const cpiWeights = cpiRule?.params?.weights || cpiByCode
  for (const f of await prisma.fund.findMany({ where: { communityId: COMM } })) {
    const a = (f.allocation as any) || {}
    if (a.method === 'BY_CPI') await prisma.fund.update({ where: { id: f.id }, data: { allocation: { ...a, method: 'EXPLICIT', weights: cpiWeights } } })
  }
  for (const et of await prisma.expenseType.findMany({ where: { communityId: COMM } })) {
    const p = (et.params as any) || {}
    if (!p.fundCode) await prisma.expenseType.update({ where: { id: et.id }, data: { params: { ...p, fundCode: def.expenseFundCode || 'EXPENSES' } } })
  }

  // ── period: June must chain from May's dueEnd — May must already be CLOSED ──
  const may = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: '2026-05' } } })
  if (!may || may.status !== 'CLOSED') throw new Error('May (2026-05) must be CLOSED before computing June')

  const waterMethod = (def.waterDifferenceMethod as 'PROPORTIONAL' | 'APA_DIF') || 'PROPORTIONAL'
  const [jy, jm] = JUNE.code.split('-').map(Number)
  const junePeriod = await prisma.period.upsert({
    where: { communityId_code: { communityId: COMM, code: JUNE.code } },
    update: { startDate: new Date(JUNE.start), endDate: new Date(JUNE.end), dueDate: new Date(JUNE.due), waterDifferenceMethod: waterMethod, status: 'OPEN', preparedAt: null, closedAt: null },
    create: { communityId: COMM, code: JUNE.code, seq: jy * 12 + jm, status: 'OPEN', startDate: new Date(JUNE.start), endDate: new Date(JUNE.end), dueDate: new Date(JUNE.due), waterDifferenceMethod: waterMethod },
  })
  console.log(`waterDifferenceMethod=${waterMethod}`)

  // ── per-unit SQM (CPI, static) + RESIDENTS/WATER_COLD from the packet (needed before BILL_APA_RECE) ──
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const unitById = new Map(units.map((u: any) => [u.code, u]))
  let nSqm = 0, nRes = 0, nWater = 0
  const up = async (unitId: string, typeCode: string, value: number, origin: string, meterSuffix: string) => {
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: junePeriod.id, scopeType: 'UNIT', scopeId: unitId, typeCode } },
      update: { value, origin, meterId: `${typeCode}-${meterSuffix}` },
      create: { communityId: COMM, periodId: junePeriod.id, scopeType: 'UNIT', scopeId: unitId, typeCode, value, origin, meterId: `${typeCode}-${meterSuffix}` },
    })
  }
  for (const u of units) {
    if (cpiByCode[u.code] != null) { await up(u.id, 'SQM', cpiByCode[u.code], 'ADMIN', u.code); nSqm++ }
    const um = (packet.unitMeasures?.byUnit || {})[u.code]
    if (um) {
      await up(u.id, 'RESIDENTS', Number(um.residents) || 0, 'DECLARATION', u.code); nRes++
      if (um.water_cold != null) { await up(u.id, 'WATER_COLD', Number(um.water_cold), 'ADMIN', u.code); nWater++ }
    }
  }
  console.log(`unit measures: SQM=${nSqm}, RESIDENTS=${nRes}, WATER_COLD=${nWater}`)

  const branch = Number(packet.meters?.community?.COMMUNITY_WATER_COLD)
  if (branch > 0) {
    await templates.upsertMeterReading(COMM, JUNE.code, [], { meterId: 'COMMUNITY_WATER_COLD', value: branch })
    console.log(`branch reading COMMUNITY_WATER_COLD=${branch} m³`)
  }

  // ── submit every item (grouped by template — a multi-detailKey template like BILL_APA_RECE
  //    naturally combines its items into one saveBillTemplateState call and one community_charge) ──
  const groups = new Map<string, { values: Record<string, any>; meta: any }>()
  for (const it of (packet.items || [])) {
    const g = groups.get(it.templateCode) || { values: {}, meta: {} }
    if (Number(it.amount) > 0) g.values[it.detailKey] = Number(it.amount)
    g.meta.invoiceNumber = g.meta.invoiceNumber ?? it.invoiceNumber
    g.meta.invoiceGross = g.meta.invoiceGross ?? it.invoiceGross
    g.meta.serviceStartPeriod = JUNE.code
    g.meta.serviceEndPeriod = JUNE.code
    groups.set(it.templateCode, g)
  }
  for (const [templateCode, g] of groups) {
    if (!Object.keys(g.values).length) continue
    await templates.saveBillTemplateState(COMM, JUNE.code, templateCode, [], { state: 'SUBMITTED', values: { ...g.values, ...g.meta } })
    console.log(`  posted ${templateCode}: ${JSON.stringify(g.values)}`)
  }

  // ── afișare date (real posting date, from the source Cheltuieli table header) ──
  if (packet.afisareDate) {
    await prisma.period.update({ where: { id: junePeriod.id }, data: { afisareDate: new Date(packet.afisareDate) } })
    console.log(`afisareDate=${packet.afisareDate}`)
  }

  // ── close every bill/meter template instance (prepare() requires all closed; unsubmitted ones
  //    post zero charge — e.g. Interfon, no June invoice) ──
  for (const b of await prisma.billTemplate.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })) {
    await prisma.billTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: junePeriod.id, templateId: b.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: junePeriod.id, templateId: b.id, state: 'CLOSED' },
    })
  }
  for (const mt of await prisma.meterEntryTemplate.findMany({ where: { communityId: COMM }, select: { id: true } })) {
    await prisma.meterEntryTemplateInstance.upsert({
      where: { communityId_periodId_templateId: { communityId: COMM, periodId: junePeriod.id, templateId: mt.id } },
      update: { state: 'CLOSED' }, create: { communityId: COMM, periodId: junePeriod.id, templateId: mt.id, state: 'CLOSED' },
    })
  }

  // ── backfill invoice issue/due dates onto the VendorInvoice rows just created (metadata only) ──
  for (const [number, dates] of Object.entries<any>(packet.invoiceDates || {})) {
    if (number === '_note') continue
    const data: any = {}
    if (dates.issueDate) data.issueDate = new Date(dates.issueDate)
    if (dates.dueDate) data.dueDate = new Date(dates.dueDate)
    if (Object.keys(data).length) {
      const res = await prisma.vendorInvoice.updateMany({ where: { communityId: COMM, number }, data })
      if (res.count) console.log(`  invoice ${number}: dates set (${res.count} row)`)
    }
  }

  // ── import the cash register: CashTx for every real transaction; Payment for owner receipts,
  //    skipping ones already counted in April's cycle (skipPayment); allocationSpec computed inline
  //    (dominant-fund advance fallback, folding in what fix-kralik-june-payment-specs.ts did after
  //    the fact) so prepare() doesn't need a follow-up pass; providerMeta.cycleCode honors a per-tx
  //    `cycle` override (the 15 entries outside June's own collection window) ──
  function norm(x: string) { return String(x).replace(/ /g, '').replace(/[\s./]/g, '').toUpperCase() }
  const mapping = loadJson('history-mapping.json')
  const prefix = mapping.unitLabelPrefix ?? ''
  const byNorm = new Map<string, { code: string; be: string }>()
  for (const u of def.structure || []) {
    const nm = String(u.name || '')
    const label = nm.startsWith(prefix) ? nm.slice(prefix.length) : (nm || u.code)
    byNorm.set(norm(label), { code: u.code, be: u.billingEntity })
  }
  const ov: Record<string, string> = mapping.unitOverrides || {}
  const ovNorm = new Map<string, string>(Object.entries(ov).map(([k, v]) => [norm(k), v as string]))
  const beOfCode = new Map<string, string>((def.structure || []).map((u: any) => [u.code, u.billingEntity]))
  const resolveBe = (label: string): string | null => {
    const n = norm(label)
    if (ovNorm.has(n)) return beOfCode.get(ovNorm.get(n)!) ?? null
    return byNorm.get(n)?.be ?? null
  }
  const accounts = new Map<string, string>((await prisma.cashAccount.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((a: any) => [a.code, a.id]))
  const fundsById = new Map<string, string>((await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((f: any) => [f.code, f.id]))
  const beIds = new Map<string, string>((await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((b: any) => [b.code, b.id]))
  const acctId = (k: string) => accounts.get(cash.accounts?.[k] || k)
  const cycleCode: string = cash.cycleCode || JUNE.code

  await prisma.cashTx.deleteMany({ where: { communityId: COMM, refType: 'CASH_REGISTER_2026_06' } })
  await prisma.payment.deleteMany({ where: { communityId: COMM, provider: 'cash-register-2026-06' } })

  let nTx = 0, nPay = 0, missBe: string[] = []
  for (const t of cash.tx as any[]) {
    if (t.void) continue
    const account = acctId(t.acct)
    if (!account) { console.log(`  ⚠ no account ${t.acct}`); continue }
    const ts = new Date(t.date)
    const dir = t.dir === 'IN' ? 'IN' : 'OUT'
    const kind = ['PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'OTHER'].includes(t.kind) ? t.kind : 'OTHER'
    const fundsObj: Record<string, number> = t.funds || { [t.fund || 'EXPENSES']: t.amount }
    // cashFunds overrides the real per-fund cash movement (e.g. the EUR-account entries, whose
    // `funds`/`amount` intentionally stay as dev's RON-mislabeled figures — see cash-2026-06.json's
    // own _note) — CashTx should reflect the real amount even where the Payment below doesn't.
    const cashFundsObj: Record<string, number> = t.cashFunds || fundsObj
    for (const [fc, amt] of Object.entries(cashFundsObj)) {
      const fundId = fundsById.get(fc)
      if (!fundId) { console.log(`  ⚠ no fund ${fc} (tx #${t.n})`); continue }
      await prisma.cashTx.create({
        data: {
          communityId: COMM, accountId: account, fundId, ts, amount: amt as number, currency: t.acct === 'BANK_EUR' ? 'EUR' : 'RON',
          direction: dir as any, kind: kind as any, status: 'POSTED',
          refType: 'CASH_REGISTER_2026_06', refId: `${t.n}:${t.ref}:${fc}`,
          memo: t.memo || t.payee || null,
          meta: { n: t.n, ref: t.ref, account: t.acct, counterparty: t.payee || t.unit || null, payer: t.payer || null, cycle: t.cycle || null, cycleCode },
        },
      })
      nTx++
    }
    if (t.unit && dir === 'IN' && kind === 'PAYMENT' && t.amount > 0 && !t.skipPayment) {
      const be = resolveBe(t.unit)
      const beId = be ? beIds.get(be) : null
      if (!beId) { missBe.push(t.unit); continue }

      // dominant-fund advance-fallback allocationSpec (fix-kralik-june-payment-specs.ts's logic,
      // applied at creation time instead of as a follow-up pass)
      const entries = Object.entries(fundsObj).filter(([, amt]) => Number.isFinite(Number(amt)) && Math.abs(Number(amt)) >= 0.005)
      let allocationSpec: any = null
      if (entries.length) {
        const hasNegative = entries.some(([, amt]) => Number(amt) < 0)
        let dominantCode: string | null = null, dominantAbs = -1
        for (const [code, amt] of entries) { const v = Math.abs(Number(amt)); if (v > dominantAbs) { dominantAbs = v; dominantCode = code } }
        const dominantFundId = dominantCode ? fundsById.get(dominantCode) : null
        if (dominantFundId) {
          const lines: any[] = []
          if (!hasNegative) for (const [code, amt] of entries) { const fid = fundsById.get(code); if (fid) lines.push({ fundId: fid, amount: Number(Number(amt).toFixed(4)) }) }
          lines.push({ advance: true, fundId: dominantFundId })
          allocationSpec = lines
        }
      }

      await prisma.payment.create({
        data: {
          communityId: COMM, billingEntityId: beId, accountId: account, amount: t.amount, currency: t.acct === 'BANK_EUR' ? 'EUR' : 'RON', ts,
          method: 'REGISTER', status: 'POSTED', provider: 'cash-register-2026-06', providerRef: t.ref,
          refId: `cash:${cycleCode}:${t.n}`,
          allocationSpec,
          providerMeta: { cycleCode: t.cycle || cycleCode, account: t.acct, unitLabel: t.unit, payer: t.payer || null, funds: fundsObj, cycle: t.cycle || null, memo: t.memo || null, ref: t.ref },
        },
      })
      nPay++
    }
  }
  console.log(`✅ cash imported: ${nTx} cash_tx, ${nPay} payments (cycle ${cycleCode})`)
  if (missBe.length) console.log(`  ⚠ unresolved units: ${[...new Set(missBe)].join(', ')}`)

  await periods.prepare(COMM, JUNE.code)
  console.log(`  ✅ ${JUNE.code} prepared (chained from May's dueEnd) — not approved, matching dev's current PREPARED status`)

  const juneDebt: any[] = await prisma.$queryRawUnsafe(
    `select round(sum(due_end),2)::float8 debt, round(sum(due_start),2)::float8 opening, round(sum(charges),2)::float8 charges, round(sum(payments),2)::float8 payments
       from be_statement where community_id=$1 and period_id=$2`, COMM, junePeriod.id)
  console.log(`June statement totals: opening=${juneDebt[0]?.opening} charges=${juneDebt[0]?.charges} payments=${juneDebt[0]?.payments} → DEBT(dueEnd)=${juneDebt[0]?.debt}`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
