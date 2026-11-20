// August 2026 cross-fund reattributions, recorded as PAYMENT_REATTRIB corrections (see
// add-kralik-fund-reattributions.ts), never as ledger rows:
//
// - Semenescu Maria (SAD 2/1): Registru Casă chitanța CHHF 381 (13.10.2026, valoare totală 0.00)
//   redistributes her Reabilitare 1 credit (-13,482.00) onto her open funds: Cheltuieli comune 110.65
//   (Dec 2025 … Iul 2026), Fond rulment 72.60, Fond reparații 37.50, Fond reabilitare 3 13,261.25.
// - AP 12 (Primăria, SAD4/B): HomeFile's August list carries the Primăria units' Fond Proiect+Reabilitare
//   at -270.00 (A) / 0 (B) / -33.37 (C) and the matching amount on Fond reabilitare 3. Ours had
//   7,958.57 owed on Reabilitare 1 for SAD4/B; after the 13.10 payment's 290.72 (cash-2026-08.json) the
//   remaining 7,667.85 is moved onto Reabilitare 3 so Reabilitare 1 reads 0, per the association.
//   Then the Reabilitare 1 credits of SAD4/A (270.00) and SAD4/C (33.37) are used on their own
//   Reabilitare 3 restanță; cash-2026-08.json splits the 13.10 payment's Reabilitare 3 part across
//   the three units so their Reabilitare 3 restanță is equal (5010.04 / 5010.04 / 5010.05).
//   Revised 2026-10-16 to HomeFile's August list: no equalization — each unit keeps its own credit
//   (Reabilitare 3: A 4841.90, B 5111.90 (+1.02 here), C 5075.31; split lives in cash-2026-08.json).
// - Jarda Gheorghe (5(III)): his Fond Pod și Fațadă credit (-2,128.35) is used on Fond reabilitare 3,
//   as in HomeFile's August 2026 list (Pod și Fațadă 0, Reabilitare 3 13,783.75).
//
// Idempotent: skips a (BE, fromFund, toFund, amount) already ACTIVE for 2026-08.
//   npx ts-node --transpile-only src/scripts/add-kralik-august-reattributions.ts
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-08' // must be the community's currentPeriod() (latest OPEN/PREPARED) when this runs

const SEMENESCU = { beId: 'cmticfnig00nf1tgymdt5fsmu', unitCode: '400191-C1-U16-SAD 2/1' }
const SEMENESCU_NOTE = 'Registru Casă CHHF 381 / 13.10.2026, Semenescu Maria (SAD 2/1), valoare totală 0.00 — FOND PROIECT+REABILITARE -13482.00 redistribuit'
const AP12 = { beId: 'cmticfnh000j91tgyv2kblh3i', unitCode: '400191-C1-U34-AP 12 (SAD 4/B)' }
const AP12A = { beId: AP12.beId, unitCode: '400191-C1-U34-AP 12 (SAD 4/A)' }
const AP12C = { beId: AP12.beId, unitCode: '400191-C1-U34-AP 12 (SAD 4/C)' }
const JARDA_GH = { beId: 'cmticfnfx00gd1tgyi5o00bwk', unitCode: '400191-C1-U31-AP 5 (III)' }

const transfers: Array<{ beId: string; unitCode: string; fromFund: string; toFund: string; amount: number; note: string }> = [
  { ...SEMENESCU, fromFund: 'REABILITARE_1', toFund: 'EXPENSES', amount: 110.65, note: `${SEMENESCU_NOTE} → Cheltuieli comune Dec 2025–Iul 2026 110.65` },
  { ...SEMENESCU, fromFund: 'REABILITARE_1', toFund: 'RULMENT', amount: 72.6, note: `${SEMENESCU_NOTE} → Fond rulment 72.60` },
  { ...SEMENESCU, fromFund: 'REABILITARE_1', toFund: 'REPARATII', amount: 37.5, note: `${SEMENESCU_NOTE} → Fond de reparații 37.50` },
  { ...SEMENESCU, fromFund: 'REABILITARE_1', toFund: 'REABILITARE_3', amount: 13261.25, note: `${SEMENESCU_NOTE} → Fond reabilitare 3 13261.25` },
  { ...AP12, fromFund: 'REABILITARE_3', toFund: 'REABILITARE_1', amount: 7667.85,
    note: 'AP 12 (SAD4/B, Primăria): datoria rămasă pe Fond Proiect+Reabilitare (7958.57 − 290.72 încasat 13.10.2026) mutată pe Fond reabilitare 3, ca în lista HomeFile August 2026 (Proiect+Reabilitare: A −270.00, B 0, C −33.37).' },
  { ...AP12A, fromFund: 'REABILITARE_1', toFund: 'REABILITARE_3', amount: 270.0,
    note: 'AP 12 (SAD4/A, Primăria): creditul de pe Fond Proiect+Reabilitare (−270.00) folosit pe Fond reabilitare 3 — restanțe egale pe reabilitare 3 la cele 3 unități.' },
  { ...AP12C, fromFund: 'REABILITARE_1', toFund: 'REABILITARE_3', amount: 33.37,
    note: 'AP 12 (SAD4/C, Primăria): creditul de pe Fond Proiect+Reabilitare (−33.37) folosit pe Fond reabilitare 3 — restanțe egale pe reabilitare 3 la cele 3 unități.' },
  { ...JARDA_GH, fromFund: 'REABILITARE_2', toFund: 'REABILITARE_3', amount: 2128.35,
    note: 'Ap 5(III) Jarda Gheorghe: creditul de pe Fond Pod și Fațadă (−2128.35) folosit pe Fond reabilitare 3, ca în lista HomeFile August 2026 (16.10.2026).' },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const corrections = app.get(CorrectionsService)
  const prisma = app.get(PrismaService) as any
  try {
    const existing = await prisma.correction.findMany({
      where: { communityId: COMM, type: 'PAYMENT_REATTRIB', status: 'ACTIVE', periodCode: PERIOD_CODE },
      select: { billingEntityId: true, payload: true, amount: true },
    })
    const key = (be: string, from: string, to: string, amt: number) => `${be}::${from}::${to}::${amt.toFixed(2)}`
    const done = new Set(existing.map((c: any) => key(c.billingEntityId, c.payload?.fromFund, c.payload?.toFund, Number(c.amount))))
    for (const t of transfers) {
      if (done.has(key(t.beId, t.fromFund, t.toFund, t.amount))) { console.log(`  = already active: ${t.unitCode} ${t.fromFund} → ${t.toFund} ${t.amount}`); continue }
      const unit = await prisma.unit.findFirst({ where: { communityId: COMM, code: t.unitCode }, select: { id: true } })
      if (!unit) throw new Error(`unit not found: ${t.unitCode}`)
      const r = await corrections.create(COMM, 'script:add-kralik-august-reattributions', {
        type: 'PAYMENT_REATTRIB', billingEntityId: t.beId, fromFund: t.fromFund, toFund: t.toFund, amount: t.amount, unitId: unit.id, note: t.note,
      })
      if (r.periodCode !== PERIOD_CODE) throw new Error(`correction landed on ${r.periodCode}, expected ${PERIOD_CODE}`)
      console.log(`  created: ${t.unitCode} ${t.fromFund} → ${t.toFund} ${t.amount} (${r.id})`)
    }
  } finally {
    await app.close()
  }
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
