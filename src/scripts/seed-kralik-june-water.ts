// Kralik: seed June's per-unit RESIDENTS + WATER_COLD measures and the branch reading, sourced ONLY
// from the "Consum (m³)" and "Pers. Prez." columns of
// Ap_Gheorghe_Lazar_Nr_4_Table_Cheltuieli_Bl_4_Sc_-_Iun_2026.pdf (per the scoping agreed earlier — no
// other figure from that file is used). Sets period.waterDifferenceMethod=APA_DIF (matches def.json's
// community-level setting) and then submits BILL_APA_RECE for real, since it's now unblocked.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-06'
const BRANCH_READING = 119.0 // COMMUNITY_WATER_COLD, index 1022→1141

// unit code (as used in def.json .structure[].code, i.e. "AP 1", "AP 2/1", "SAD 1", "SPAȚIU COMERCIAL")
// -> { residents, water } sourced from the Cheltuieli table's Pers. Prez. / Consum (m³) columns.
const DATA: Record<string, { residents: number; water: number | null }> = {
  'AP 1': { residents: 0, water: 0.0 },
  'AP 2/1': { residents: 1, water: 0.0 },
  'AP 2/2': { residents: 0, water: 0.25 },
  'AP 3': { residents: 1, water: 0.215 },
  'AP 1/B': { residents: 0, water: 0.0 },
  'AP 4 (I)': { residents: 1, water: 4.0 },
  'AP 4A': { residents: 2, water: 5.268 },
  'AP 5 (I-B)': { residents: 2, water: 5.2 },
  'AP 5 (I-A)': { residents: 1, water: 0.9 },
  'AP 6': { residents: 1, water: 3.0 },
  'AP 6A': { residents: 1, water: 4.184 },
  'AP 8': { residents: 1, water: 1.0 },
  'AP 9': { residents: 1, water: 3.047 },
  'AP 10A': { residents: 1, water: 2.34 },
  'AP 10B': { residents: 2, water: 0.675 },
  'AP 11': { residents: 1, water: 3.75 },
  'AP 11A': { residents: 3, water: 4.387 },
  'AP 11B': { residents: 1, water: 3.68 },
  'AP 12 (SAD 4/A)': { residents: 0, water: 0.0 },
  'AP 12 (SAD 4/B)': { residents: 0, water: 0.0 },
  'AP 12 (SAD 4/C)': { residents: 0, water: 0.0 },
  'AP 4 (III)': { residents: 1, water: 0.0 },
  'AP 5 (III)': { residents: 1, water: 1.674 },
  'AP 14A': { residents: 2, water: 4.0 },
  'AP 14B': { residents: 1, water: 0.655 },
  'SAD 2/2': { residents: 0, water: 3.0 },
  'SAD 1': { residents: 0, water: 2.0 },
  'SAD 2/1': { residents: 0, water: 0.0 },
  'AP 31': { residents: 0, water: 0.309 },
  'AP 32': { residents: 0, water: 0.0 },
  'SPAȚIU COMERCIAL': { residents: 0, water: null }, // excluded from the water/apă-meteo split in def.json
}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const prisma = app.get(PrismaService) as any

  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const waterMethod = def.waterDifferenceMethod || 'PROPORTIONAL'

  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: COMM, code: PERIOD_CODE } } })
  await prisma.period.update({ where: { id: period.id }, data: { waterDifferenceMethod: waterMethod } })
  console.log(`waterDifferenceMethod set to ${waterMethod}`)

  // def.json .structure[].name is the short display label ("AP 1", "SAD 1", ...); .structure[].code is
  // the long DB Unit.code ("400191-C1-U6-AP 1"). Map DATA's short labels through that, then to Unit.id.
  const longCodeByName = new Map<string, string>((def.structure || []).map((s: any) => [s.name, s.code]))
  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const unitById = new Map(units.map((u: any) => [u.code, u]))

  let nRes = 0, nWater = 0, missing: string[] = []
  for (const [name, { residents, water }] of Object.entries(DATA)) {
    const longCode = longCodeByName.get(name)
    const u = longCode ? (unitById.get(longCode) as any) : null
    if (!u) { missing.push(name); continue }
    await prisma.periodMeasure.upsert({
      where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'RESIDENTS' } },
      update: { value: residents, origin: 'DECLARATION', meterId: `RESIDENTS-${u.code}` },
      create: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'RESIDENTS', value: residents, origin: 'DECLARATION', meterId: `RESIDENTS-${u.code}` },
    })
    nRes++
    if (water != null) {
      await prisma.periodMeasure.upsert({
        where: { communityId_periodId_scopeType_scopeId_typeCode: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'WATER_COLD' } },
        update: { value: water, origin: 'ADMIN', meterId: `WATER_COLD-${u.code}` },
        create: { communityId: COMM, periodId: period.id, scopeType: 'UNIT', scopeId: u.id, typeCode: 'WATER_COLD', value: water, origin: 'ADMIN', meterId: `WATER_COLD-${u.code}` },
      })
      nWater++
    }
  }
  console.log(`measures: RESIDENTS=${nRes}, WATER_COLD=${nWater}`)
  if (missing.length) console.log(`  ⚠ no unit matched for: ${missing.join(', ')}`)

  await templates.upsertMeterReading(COMM, PERIOD_CODE, [], { meterId: 'COMMUNITY_WATER_COLD', value: BRANCH_READING })
  console.log(`branch reading COMMUNITY_WATER_COLD=${BRANCH_READING} m³`)

  // Now submit the real Apă Rece bill — this was blocked before; should succeed now.
  try {
    await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_RECE', [], {
      state: 'SUBMITTED',
      values: {
        apa_rece: 917.49,
        canal: 888.57,
        penalitati: 33.3,
        invoiceNumber: 'TMA10/1015558474',
        invoiceGross: 2038.02,
        serviceStartPeriod: PERIOD_CODE,
        serviceEndPeriod: PERIOD_CODE,
      },
    })
    console.log('✅ BILL_APA_RECE submitted successfully — real charge posted')
  } catch (e: any) {
    console.log('❌ BILL_APA_RECE still failed:', e?.message || e)
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
