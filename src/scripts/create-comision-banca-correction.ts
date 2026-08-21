// One-off: declare a TODO correction (unattached to any period) that reverses the unbacked flat
// "Comision Bancă" placeholder (12.00 lei/month, no invoice, carried forward every month) and
// replaces it with the real total sourced from Libra's bank statement (136.00 lei — 18 per-
// transaction fees for 01.07-19.08.2026, see ExtrasCont lei.pdf). Net effect +124.00, split by
// CPI same as the original charge. status=TODO / periodCode=null: it does NOT derive any ledger
// legs until an admin later re-declares it as ACTIVE against a specific period.
// Idempotent: voids any prior run's correction (by note-prefix match) before creating a fresh one.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { CorrectionsModule } from '../modules/corrections/corrections.module'
import { CorrectionsService } from '../modules/corrections/corrections.service'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, CorrectionsModule] })
class ScriptModule {}

const COMM = 'Kralik'
const OLD = 12.0
const REAL = 136.0
const NET = REAL - OLD
const MARK = 'STORNO comision bancă / COMISION BANCĂ STORNO'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const corrections = app.get(CorrectionsService)
  const prisma = app.get(PrismaService) as any

  const prior = await prisma.correction.findMany({ where: { communityId: COMM, status: 'TODO', note: { startsWith: MARK } }, select: { id: true } })
  for (const p of prior) await corrections.void(COMM, p.id, 'admin-script:comision-banca-correction')
  if (prior.length) console.log(`  voided ${prior.length} prior run(s)`)

  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const cpiByCode: Record<string, number> = Object.fromEntries(
    (def.structure || []).filter((u: any) => u.cpi != null).map((u: any) => [u.code, Number(u.cpi)]),
  )
  const beByCode: Record<string, string> = Object.fromEntries((def.structure || []).map((u: any) => [u.code, u.billingEntity]))
  const beIds = new Map<string, string>((await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((b: any) => [b.code, b.id]))

  const totalCpi = Object.values(cpiByCode).reduce((a, b) => a + b, 0)
  const perBe: Record<string, number> = {}
  for (const [unitCode, cpi] of Object.entries(cpiByCode)) {
    const be = beByCode[unitCode]
    const beId = be ? beIds.get(be) : null
    if (!beId) { console.log(`  ⚠ no BE for unit ${unitCode}`); continue }
    const share = Number(((cpi / totalCpi) * NET).toFixed(4))
    perBe[beId] = (perBe[beId] || 0) + share // Macri Nicodemo holds 2 units (11, 11A) → same BE, sum shares
  }
  const sumCheck = Object.values(perBe).reduce((a, b) => a + b, 0)
  console.log(`Σ CPI = ${totalCpi}, net = ${NET.toFixed(2)}, per-BE sum = ${sumCheck.toFixed(2)} (rounding drift ${(sumCheck - NET).toFixed(4)})`)

  const note =
    `${MARK} / COMISION BANCĂ STORNO — Iunie 2026\n\n` +
    `RO: Stornăm placeholderul fix de Comision Bancă (${OLD.toFixed(2)} lei/lună, 0,12 lei/cpi × 100 cpi) — nesusținut de nicio factură, nici în dosarul Iunie/2026-06, nici în extrasele de cont; aceeași cifră nesusținută a fost folosită și în Mai. Îl înlocuim cu ${REAL.toFixed(2)} lei — totalul real al celor 18 comisioane bancare Libra per-tranzacție din fereastra de decontare 01.07-19.08.2026 (16×6,00 + 2×20,00 lei), verificate linie cu linie în ExtrasCont lei.pdf. Ajustare netă +${NET.toFixed(2)} lei, împărțită pe cotă-parte (CPI), aceeași bază de alocare ca taxa inițială (SPLIT_COMISION_BANCA, BY_CPI). Declarată ca TODO / neatribuită — nu s-a decis încă pe ce perioadă (Iunie sau Iulie) se aplică; nu afectează niciun avizier până când un administrator o redeclară ca ACTIVĂ pe o perioadă anume.\n\n` +
    `EN: Reversing the flat Comision Bancă placeholder (${OLD.toFixed(2)} RON/month, 0.12 lei/cpi × 100 cpi) — unbacked by any invoice anywhere in the June/2026-06 source folder or the bank statements; the same unbacked figure was also used in May. Replacing it with ${REAL.toFixed(2)} RON — the real total of Libra's 18 per-transaction bank fees for the settlement window 01.07-19.08.2026 (16×6.00 + 2×20.00), verified line-by-line against ExtrasCont lei.pdf. Net adjustment +${NET.toFixed(2)} RON, split by CPI — same allocation basis as the original charge (SPLIT_COMISION_BANCA, BY_CPI). Declared as TODO / unattached — not yet decided which period (June vs July) this should land in; will not affect any avizier until an admin re-declares it as ACTIVE against a specific period.`

  const result = await corrections.create(COMM, 'admin-script:comision-banca-correction', {
    type: 'RESHUFFLE',
    fundCode: 'EXPENSES',
    expenseTypeCode: 'COMISION_BANCA',
    perBe,
    note,
    status: 'TODO',
  })
  console.log('✅ created TODO correction:', result)
  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
