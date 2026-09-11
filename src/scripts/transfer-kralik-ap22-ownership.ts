// Ap 2/2 changed billing entity in June (BE_GAMPE_FRANCISC → BE_VALEAN_MIRELA, per def.json's
// versioned structure[] split). Gampe's real May closing balance (be_statement, confirmed by
// direct query — not estimated) sat frozen on his now-orphaned BE with no way to be paid off,
// while a real payment from Valean Mirela (2026-08-05, refs CHHF370/CHHF371) that was actually
// settling this inherited debt landed as a phantom credit on her own ledger instead, since the
// open balance lived on Gampe's BE. This declares the real transfer of that balance to Valean,
// per fund, as an OWNERSHIP_TRANSFER correction (see CorrectionsService/PeriodService) — Gampe's
// balance goes to 0 (not owed by him anymore), Valean's includes it, and Avizier flags it as
// "inherited from Gampe" (FinanceService.avizier()'s inheritedFrom field) rather than silently
// merging it into her own activity.
//
// Idempotent: skips if an ACTIVE OWNERSHIP_TRANSFER from Gampe to Valean already exists.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'
const FROM_BE = 'BE_GAMPE_FRANCISC'
const TO_BE = 'BE_VALEAN_MIRELA'
// Gampe's real May 2026-05 be_statement closing balances (due_end), confirmed by direct query —
// transcribed, not rounded or estimated.
const perFund = {
  EXPENSES: 46.1058,
  REABILITARE_2: 22009.09,
  REABILITARE_3: 6643.02265,
  REPARATII: 20.24,
  RULMENT: 14.516129032258,
}

const JUNE_CODE = '2026-06' // Valean's first period — where her BeOpeningBalance must land

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const corrections = app.get(CorrectionsService)
  const prisma = app.get(PrismaService) as any

  const fromBe = await prisma.billingEntity.findFirst({ where: { communityId: COMM, code: FROM_BE }, select: { id: true } })
  const toBe = await prisma.billingEntity.findFirst({ where: { communityId: COMM, code: TO_BE }, select: { id: true } })
  if (!fromBe || !toBe) { console.log(`  ⚠ BE not found (from=${!!fromBe}, to=${!!toBe})`); await app.close(); return }
  const june = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: JUNE_CODE } }, select: { id: true } })
  if (!june) throw new Error(`${JUNE_CODE} not found`)
  const funds = await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const fundIdByCode = new Map(funds.map((f: any) => [f.code, f.id]))

  let correctionId: string
  const existing = await prisma.correction.findFirst({
    where: { communityId: COMM, type: 'OWNERSHIP_TRANSFER', status: 'ACTIVE', billingEntityId: fromBe.id, payload: { path: ['toBillingEntityId'], equals: toBe.id } },
    select: { id: true },
  })
  if (existing) {
    console.log(`  = correction already active: ${existing.id}`)
    correctionId = existing.id
  } else {
    const r = await corrections.create(COMM, 'script:transfer-kralik-ap22-ownership', {
      type: 'OWNERSHIP_TRANSFER', billingEntityId: fromBe.id, toBillingEntityId: toBe.id, perFund,
      note: 'Transfer restanță Ap 2/2 de la Gampe Francisc (fost proprietar, până în Mai 2026) la Valean Mirela (proprietar nou, din Iunie 2026) — soldul de închidere real al lui Gampe pe Mai, pe fiecare fond. Plata reală din 5 Aug 2026 (Valean Mirela, CHHF370+CHHF371) achita exact această restanță moștenită, dar fusese înregistrată ca supraplată fantomă pe Valean înainte de acest transfer.',
    })
    console.log('  created correction:', r)
    correctionId = r.id
  }

  // Valean's side: a BeOpeningBalance per fund for June (her first period, nothing to chain
  // dueStart from) — tagged via originKey so it's identifiably tied to this correction.
  const originKey = `ownership-transfer:${correctionId}`
  for (const [fundCode, amount] of Object.entries(perFund)) {
    const fundId = fundIdByCode.get(fundCode)
    if (!fundId) { console.log(`  ⚠ fund not found: ${fundCode}`); continue }
    const already = await prisma.beOpeningBalance.findFirst({ where: { communityId: COMM, periodId: june.id, billingEntityId: toBe.id, fundId, originKey } })
    if (already) { console.log(`  = opening balance already set: ${fundCode}`); continue }
    await prisma.beOpeningBalance.create({
      data: { communityId: COMM, periodId: june.id, billingEntityId: toBe.id, fundId, amount, currency: 'RON', kind: 'PRINCIPAL', originKey },
    })
    console.log(`  set opening balance: ${fundCode} = ${amount}`)
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
