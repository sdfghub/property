// Kralik: submit the real July Apă Rece bill (Aquatim, TMA10/1015589981, index 1141->1214),
// analogous to seed-kralik-june-water.ts's BILL_APA_RECE submission for June. Consumption readings
// for July were already imported separately (seed-kralik-july-water.ts) — this step submits the
// actual invoice, which BY_WATER_COLD needs to split apa_rece/canal across units by that consumption.
//
// Breakdown sourced from "Aquatim - Apa - Iulie 2026.pdf" (Documents/_Vicusia/Kralik/2026-07/):
//   APA POTABILA (preț nou + vechi), cu TVA: 534.88 + 187.42 = 722.30
//   CANAL (preț nou + vechi), cu TVA:        514.65 + 181.47 = 696.12
//   Penalități:                                                29.53
//   -> Total factură curentă:                                1,594.58  (matches printed total)
// Canal apă meteorică (146.63) is NOT included here — it was already submitted separately as its
// own BILL_APA_METEO charge (community_charge sourceKey='apa_meteo', confirmed present for 2026-07).
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-07'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)

  try {
    await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_RECE', [], {
      state: 'SUBMITTED',
      values: {
        apa_rece: 722.30,
        canal: 696.12,
        penalitati: 29.53,
        invoiceNumber: 'TMA10/1015589981',
        invoiceDate: '2026-08-06',
        invoiceDueDate: '2026-08-20',
        invoiceNet: 1409.96,
        invoiceVat: 155.09,
        invoiceGross: 1594.58,
        serviceStartPeriod: PERIOD_CODE,
        serviceEndPeriod: PERIOD_CODE,
      },
    })
    console.log('✅ BILL_APA_RECE submitted for 2026-07')
  } catch (e: any) {
    console.log('❌ BILL_APA_RECE failed:', e?.message || e)
    process.exitCode = 1
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
