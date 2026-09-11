// One-off backfill for Kralik 2026-06: bills that were Confirmed (CLOSED) through the UI never
// materialized into real ledger charges, because saveBillTemplateState only triggered
// applyBillTemplateSubmission on the literal state 'SUBMITTED' (only ever sent by seed scripts),
// not on 'CLOSED' (what Confirm actually sends). Now that the service also submits on 'CLOSED',
// this re-runs the same save for every already-CLOSED instance so their charges get created.
// Safe to re-run: persistChargesFromLines upserts on (source, key, fund), so this never duplicates.
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

// Aquatim's two templates were closed before the "Data emiterii" field existed in the UI, so
// their stored values lack invoiceDate — VendorInvoice creation needs it (or a service period)
// to resolve which period a FUND-linked spend belongs to. Backfilling with the real date printed
// on the actual invoice (read earlier this session): "Data emiterii: 06.07.2026".
const MISSING_ISSUE_DATE: Record<string, string> = {
  BILL_APA_RECE: '2026-07-06',
  BILL_APA_METEO: '2026-07-06',
}

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const templates = app.get(TemplateService)
  const prisma = app.get(PrismaService) as any

  const community = await prisma.community.findUnique({ where: { id: COMM } })
  const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: community.id, code: PERIOD_CODE } } })
  if (!period) throw new Error('period not found')

  const instances = await prisma.billTemplateInstance.findMany({
    where: { communityId: community.id, periodId: period.id, state: 'CLOSED' },
    include: { template: { select: { code: true, name: true } } },
  })

  console.log(`Found ${instances.length} CLOSED bill template instances for ${COMM} ${PERIOD_CODE}`)
  const results: Array<{ code: string; ok: boolean; error?: string }> = []
  for (const inst of instances) {
    const values = { ...(inst.values ?? {}) }
    const missingDate = MISSING_ISSUE_DATE[inst.template.code]
    if (missingDate && !values.invoiceDate) values.invoiceDate = missingDate
    try {
      await templates.saveBillTemplateState(COMM, PERIOD_CODE, inst.template.code, [], { state: 'CLOSED', values })
      console.log(`  ✅ ${inst.template.code} (${inst.template.name})`)
      results.push({ code: inst.template.code, ok: true })
    } catch (err: any) {
      console.log(`  ❌ ${inst.template.code} (${inst.template.name}): ${err?.message || err}`)
      results.push({ code: inst.template.code, ok: false, error: err?.message || String(err) })
    }
  }
  console.log('\nSummary:', JSON.stringify(results, null, 2))
  await app.close()
}

main().catch((err) => { console.error(err); process.exit(1) })
