// Correction: the April historical injection dropped the PENALIZARI closing/carry-forward for two
// units (ledger-2026-04.json's `closing` omits the PENALIZARI key for both, even though `opening`
// has real values) — a full write-off adjustment zeroed both to 0 instead of leaving the small
// residual the official record (Homefile — Tabel cheltuieli 2026-05) shows: Matei Viorel (1B) 9.42,
// Macri Nicodemo/Francesco/Antonio (11) 3.70.
//
// A first attempt posted these as a MANUAL_ADJUSTMENT correction (an ADJUSTMENT ledger leg). The
// admin rejected that: it only moves due_end/Restanțe, it never shows up in Avizier's "Curente"
// column, which only reads real `community_charge`→`community_charge_line` rows (see CLAUDE.md rule
// #9 and finance.service.ts's avizier()). This version instead mirrors PenaltyLedgerService.advance()'s
// own posting shape directly: a real `community_charge` (sourceType FUND, sourceKey penalty:EXPENSES)
// + per-BE `community_charge_line` + `be_ledger_entry`(+detail), kind CHARGE — exactly what a genuine
// penalty accrual would produce, just posted by hand since Kralik's penalty rate has been 0% since
// mid-2023 (no live PenaltyBucket would ever generate it on its own).
//
// Idempotent: skips if a community_charge with this sourceKey already carries lines for both BEs in
// May.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PeriodService } from '../modules/period/period.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const MAY_CODE = '2026-05'
const JUNE_CODE = '2026-06'
const SOURCE_KEY = 'penalty:EXPENSES'

const targets = [
  { beName: 'Matei Viorel', unitCode: '400191-C1-U28-AP 1/B', amount: 9.42, note: 'Homefile Mai 2026 — Matei Viorel (1B)' },
  { beName: 'Macri Nicodemo', unitCode: '400191-C1-U32-AP 11', amount: 3.70, note: 'Homefile Mai 2026 — Macri (11)' },
]

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const periods = app.get(PeriodService)
  const prisma = app.get(PrismaService) as any

  const may = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: MAY_CODE } } })
  if (!may) throw new Error(`${MAY_CODE} not found — run the canonical rebuild through May first`)

  const already = await prisma.communityChargeLine.findMany({
    where: { communityId: COMM, periodId: may.id, charge: { sourceKey: SOURCE_KEY } },
    select: { billingEntityId: true },
  })
  const alreadySet = new Set(already.map((r: any) => r.billingEntityId))
  const penFund = await prisma.fund.findFirst({ where: { communityId: COMM, code: 'PENALIZARI' }, select: { id: true } })
  if (!penFund) throw new Error('PENALIZARI fund not found')

  const resolved: { beId: string; unitId: string; amount: number; note: string }[] = []
  for (const t of targets) {
    const be = await prisma.billingEntity.findFirst({ where: { communityId: COMM, name: { contains: t.beName } }, select: { id: true } })
    const unit = await prisma.unit.findFirst({ where: { communityId: COMM, code: t.unitCode }, select: { id: true } })
    if (!be) { console.log(`  ⚠ BE not found: ${t.beName}`); continue }
    if (!unit) { console.log(`  ⚠ unit not found: ${t.unitCode}`); continue }
    if (alreadySet.has(be.id)) { console.log(`  = already posted for ${t.beName}, skipping`); continue }
    resolved.push({ beId: be.id, unitId: unit.id, amount: t.amount, note: t.note })
  }
  if (!resolved.length) { console.log('Nothing to do — all targets already posted.'); await app.close(); return }

  console.log(`Reopening ${MAY_CODE}...`)
  await periods.reopen(COMM, MAY_CODE)

  const total = resolved.reduce((s, r) => s + r.amount, 0)
  const charge = await prisma.communityCharge.create({
    data: {
      communityId: COMM, periodId: may.id, fundId: penFund.id,
      sourceType: 'FUND', sourceId: penFund.id, sourceKey: SOURCE_KEY,
      amount: total, status: 'ACTIVE', allocationStrategy: 'PENALTY',
      meta: { source: 'PENALTY', sourceFund: 'EXPENSES', note: 'manual: Homefile Mai 2026, confirmat admin' },
    },
  })
  for (const r of resolved) {
    await prisma.communityChargeLine.create({
      data: {
        chargeId: charge.id, communityId: COMM, periodId: may.id, billingEntityId: r.beId, unitId: r.unitId,
        amount: r.amount, meta: { source: 'PENALTY', sourceFund: 'EXPENSES', allocation: { method: 'MANUAL', note: r.note } },
      },
    })
    const entry = await prisma.beLedgerEntry.create({
      data: {
        communityId: COMM, periodId: may.id, billingEntityId: r.beId, fundId: penFund.id,
        kind: 'CHARGE', amount: r.amount, refType: 'PENALTY_CLOSE_PREP', refId: may.id,
      },
    })
    await prisma.beLedgerEntryDetail.create({
      data: {
        ledgerEntryId: entry.id, communityId: COMM, periodId: may.id, billingEntityId: r.beId,
        kind: 'CHARGE', fundId: penFund.id, refType: 'PENALTY_CLOSE_PREP', refId: may.id, unitId: r.unitId,
        amount: r.amount, meta: { source: 'PENALTY', note: `manual: ${r.note}` },
      },
    })
    console.log(`  posted +${r.amount} RON (${r.note})`)
  }

  console.log(`Preparing + approving ${MAY_CODE} (recomputes be_statement from the new charge)...`)
  await periods.prepare(COMM, MAY_CODE)
  await periods.approve(COMM, MAY_CODE)

  const june = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: JUNE_CODE } } })
  if (june && june.status !== 'OPEN') {
    console.log(`Rejecting + re-preparing ${JUNE_CODE} (picks up May's corrected dueEnd)...`)
    await periods.reject(COMM, JUNE_CODE)
    await periods.prepare(COMM, JUNE_CODE)
  }

  console.log('✅ done')
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
