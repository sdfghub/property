// Kralik: submit June's remaining vendor bills — Curent Scară (PPC) and Salubritate (Retim), now
// unblocked since RESIDENTS is seeded, plus Comisionbancă at the flat 12.00 RON placeholder (per the
// "keep 12 for June, correct via the separate Regularizare TODO correction" decision — NOT 136).
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

  const bills: Array<{ code: string; values: Record<string, any> }> = [
    {
      code: 'BILL_CURENT_SCARA',
      values: {
        curent_scara: 68.12,
        invoiceNumber: '26EI 12312610',
        invoiceGross: 68.12,
        serviceStartPeriod: PERIOD_CODE,
        serviceEndPeriod: PERIOD_CODE,
      },
    },
    {
      code: 'BILL_SALUBRITATE',
      values: {
        salubritate: 686.32,
        invoiceNumber: 'TM 19690906',
        invoiceGross: 686.32,
        serviceStartPeriod: PERIOD_CODE,
        serviceEndPeriod: PERIOD_CODE,
      },
    },
    {
      code: 'BILL_COMISION_BANCA',
      values: {
        comision_banca: 12.0,
        invoiceNumber: null,
        invoiceGross: 12.0,
        serviceStartPeriod: PERIOD_CODE,
        serviceEndPeriod: PERIOD_CODE,
      },
    },
  ]

  for (const b of bills) {
    try {
      await templates.saveBillTemplateState(COMM, PERIOD_CODE, b.code, [], { state: 'SUBMITTED', values: b.values })
      console.log(`✅ ${b.code} submitted:`, JSON.stringify(b.values))
    } catch (e: any) {
      console.log(`❌ ${b.code} failed:`, e?.message || e)
    }
  }

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
