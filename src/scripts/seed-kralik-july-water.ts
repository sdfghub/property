// Kralik: import July's per-unit WATER_COLD measures from
// data/Kralik/Consum_apa_Iulie_2026.csv (Unitate,Consum apa [m3]), sourced from the association's own
// reading sheet. Only WATER_COLD — residents/invoices/bill submission are separate steps.
//
// AP 4A is deliberately SKIPPED: the sheet reports -13.342 m³, which is physically impossible (a
// negative consumption means the new index read lower than the old one) and would corrupt the
// building-wide water split if imported as-is. Re-run once the correct reading is confirmed.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-07'
const CSV_PATH = path.join(
  process.env.HOME || '',
  'Documents/_Vicusia/Kralik/2026-07 - Kralik - Cheltuieli lunare/Consum_apa_Iulie_2026.csv',
)
const SKIP_UNITS = new Set(['4A']) // negative reading, see header comment

// CSV "Unitate" label -> def.json .structure[].name (the short display label def.json itself uses)
const NAME_MAP: Record<string, string> = {
  '1': 'AP 1',
  '2/1': 'AP 2/1',
  '2/2': 'AP 2/2',
  '3': 'AP 3',
  '1B': 'AP 1/B',
  '4(I)': 'AP 4 (I)',
  '4A': 'AP 4A',
  '5(I-B)': 'AP 5 (I-B)',
  '5(I-A)': 'AP 5 (I-A)',
  '6': 'AP 6',
  '6A': 'AP 6A',
  '8': 'AP 8',
  '9': 'AP 9',
  '10A': 'AP 10A',
  '10B': 'AP 10B',
  '11': 'AP 11',
  '11A': 'AP 11A',
  '11B': 'AP 11B',
  '12 (SAD4/A)': 'AP 12 (SAD 4/A)',
  '12 (SAD4/B)': 'AP 12 (SAD 4/B)',
  '12 (SAD4/C)': 'AP 12 (SAD 4/C)',
  '4(III)': 'AP 4 (III)',
  '5(III)': 'AP 5 (III)',
  '14A': 'AP 14A',
  '14B': 'AP 14B',
  'SAD 2/2': 'SAD 2/2',
  'SAD 1': 'SAD 1',
  'SAD 2/1': 'SAD 2/1',
  '31': 'AP 31',
  '32': 'AP 32',
  'SP. COM': 'SPAȚIU COMERCIAL',
}

function parseCsv(filePath: string): Array<{ label: string; value: number | null }> {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  const lines = raw.split(/\r?\n/)
  const rows: Array<{ label: string; value: number | null }> = []
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const [label, valueRaw] = line.split(',').map((s) => s.trim())
    if (!label) continue
    rows.push({ label, value: valueRaw === '' || valueRaw === undefined ? null : Number(valueRaw) })
  }
  return rows
}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const longCodeByName = new Map<string, string>((def.structure || []).map((s: any) => [s.name, s.code]))
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const unitByCode = new Map(units.map((u: any) => [u.code, u]))

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: PERIOD_CODE } } })
  if (!period) throw new Error(`Period ${PERIOD_CODE} not found for ${COMM}`)

  const rows = parseCsv(CSV_PATH)
  let nOk = 0
  const skipped: string[] = []
  const missing: string[] = []
  const negative: string[] = []

  for (const { label, value } of rows) {
    if (SKIP_UNITS.has(label)) { negative.push(`${label} (${value} m³)`); continue }
    if (value == null) { skipped.push(label); continue }
    if (value < 0) { negative.push(`${label} (${value} m³)`); continue }
    const name = NAME_MAP[label]
    const longCode = name ? longCodeByName.get(name) : undefined
    const u = longCode ? (unitByCode.get(longCode) as any) : null
    if (!u) { missing.push(label); continue }
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'WATER_COLD' } },
      update: { value, origin: 'ADMIN', meterId: `WATER_COLD-${u.code}` },
      create: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'WATER_COLD', value, origin: 'ADMIN', meterId: `WATER_COLD-${u.code}` },
    })
    nOk++
  }

  console.log(`✅ imported WATER_COLD for ${nOk} units (period ${PERIOD_CODE})`)
  if (skipped.length) console.log(`  ⏭️  no reading in CSV (blank), left untouched: ${skipped.join(', ')}`)
  if (negative.length) console.log(`  ⚠️  SKIPPED — negative/invalid reading, needs manual check: ${negative.join(', ')}`)
  if (missing.length) console.log(`  ⚠️  no matching unit found for: ${missing.join(', ')}`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
