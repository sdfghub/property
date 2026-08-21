// Fix: the Aquatim-sourced June charges (apă rece, canal, apă meteo) were submitted using the
// invoice's net "Valoare" column instead of the VAT-inclusive total that's actually owed. Aquatim's
// rate is 11% (per the invoice). Penalități carry no VAT (Romanian law exempts late-payment
// penalties), so that figure (33.30) is unchanged.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { TemplateService } from '../modules/billing/template.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
const PERIOD_CODE = '2026-06'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)

  await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_RECE', [], {
    state: 'SUBMITTED',
    values: {
      apa_rece: 1018.41, // was 917.49 (net) — now 917.49 × 1.11
      canal: 986.31, // was 888.57 (net) — now 888.57 × 1.11
      penalitati: 33.3, // unchanged — no VAT on penalties
      invoiceNumber: 'TMA10/1015558474',
      invoiceGross: 2038.02,
      serviceStartPeriod: PERIOD_CODE,
      serviceEndPeriod: PERIOD_CODE,
    },
  })
  console.log('✅ BILL_APA_RECE corrected: apa_rece=1018.41, canal=986.31, penalitati=33.30')

  await templates.saveBillTemplateState(COMM, PERIOD_CODE, 'BILL_APA_METEO', [], {
    state: 'SUBMITTED',
    values: {
      apa_meteo: 127.64, // was 114.99 (net) — now 114.99 × 1.11
      invoiceNumber: 'TMA10/1015558474',
      invoiceGross: 127.64,
      serviceStartPeriod: PERIOD_CODE,
      serviceEndPeriod: PERIOD_CODE,
    },
  })
  console.log('✅ BILL_APA_METEO corrected: apa_meteo=127.64')

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
