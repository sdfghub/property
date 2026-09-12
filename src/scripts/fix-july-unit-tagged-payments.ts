// Fix: BE_BRINZEU_ADINA and BE_PRIMARIE_TM_UAT each span multiple physical units (SAD 1 + SAD 2/2;
// SAD 4/A + 4/B + 4/C). Their July-cycle payments already record which unit each one is for
// (providerMeta.unitLabel, straight from the Registru Bancă text), but fix-kralik-*-payment-specs.ts
// only ever set {fundId, amount} lines — no unitId — so PaymentService.applyPaymentWithSpec can't
// attribute the settlement (or its leftover advance) to the right physical unit. That's why
// BeUnitStatement's per-unit sum doesn't reconcile to the BE total and the avizier's Unitate view
// falls back to 0+badge for these units, even though Proprietar view (BE-scoped, no split needed)
// is fine.
//
// This only touches payments tagged cycle=2026-07 (this period's own prepare pass) — June's and
// April's already-closed BeUnitStatement rows are untouched and keep chaining forward via
// PeriodService.computeUnitStatements' own carry-forward logic, exactly as they do today.
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import fs from 'fs'
import path from 'path'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'
function norm(x: string) { return String(x).replace(/[\s./]/g, '').toUpperCase() }

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
  const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'history-mapping.json'), 'utf8'))
  const prefix = mapping.unitLabelPrefix ?? ''
  const longCodeByNormLabel = new Map<string, string>()
  for (const u of def.structure || []) {
    const nm = String(u.name || '')
    const label = nm.startsWith(prefix) ? nm.slice(prefix.length) : (nm || u.code)
    longCodeByNormLabel.set(norm(label), u.code)
  }
  const ov: Record<string, string> = mapping.unitOverrides || {}
  const ovNorm = new Map<string, string>(Object.entries(ov).map(([k, v]) => [norm(k), v]))

  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const unitIdByCode = new Map(units.map((u: any) => [u.code, u.id]))
  const funds = await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })
  const fundId = new Map(funds.map((f: any) => [f.code, f.id]))

  const resolveUnitId = (label: string): string | null => {
    const n = norm(label)
    const longCode = ovNorm.get(n) ?? longCodeByNormLabel.get(n)
    return longCode ? (unitIdByCode.get(longCode) as string | undefined) ?? null : null
  }

  const payments = await prisma.payment.findMany({
    where: {
      communityId: COMM,
      billing: { code: { in: ['BE_BRINZEU_ADINA', 'BE_PRIMARIE_TM_UAT'] } },
      providerMeta: { path: ['cycleCode'], equals: '2026-07' },
    },
    select: { id: true, providerMeta: true, billing: { select: { code: true } } },
  })

  let updated = 0
  for (const p of payments) {
    const meta = p.providerMeta as any
    const unitLabel: string | undefined = meta?.unitLabel
    const fundsMap: Record<string, number> = meta?.funds || {}
    if (!unitLabel) { console.log(`  ⚠ no unitLabel on payment ${p.id} (${p.billing.code})`); continue }
    const uId = resolveUnitId(unitLabel)
    if (!uId) { console.log(`  ⚠ could not resolve unit "${unitLabel}" for payment ${p.id}`); continue }
    const entries = Object.entries(fundsMap).filter(([, amt]) => Number.isFinite(Number(amt)) && Math.abs(Number(amt)) >= 0.005)
    if (!entries.length) { console.log(`  ⚠ no usable fund lines on payment ${p.id}`); continue }
    let dominantCode: string | null = null, dominantAbs = -1
    for (const [code, amt] of entries) { const v = Math.abs(Number(amt)); if (v > dominantAbs) { dominantAbs = v; dominantCode = code } }
    const lines = entries.map(([code, amt]) => ({ fundId: fundId.get(code), unitId: uId, amount: Number(Number(amt).toFixed(4)) }))
    lines.push({ advance: true as any, fundId: fundId.get(dominantCode!), unitId: uId } as any)
    await prisma.payment.update({ where: { id: p.id }, data: { allocationSpec: lines } })
    console.log(`  ✓ ${p.billing.code} payment ${p.id} -> unit ${unitLabel} (${uId})`)
    updated++
  }
  console.log(`✅ allocationSpec set with unitId on ${updated} of ${payments.length} July-cycle payments`)

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
