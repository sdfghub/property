import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PenaltyReconciliationService } from '../modules/period/penalty-reconciliation.service'
import { PrismaService } from '../modules/user/prisma.service'

/**
 * Thin CLI wrapper around `PenaltyReconciliationService` — the general, fund-agnostic
 * newest→oldest/live-anchored reconstruction methodology that replaced this script's own
 * one-off copy of the same algorithm (see penalty-reconciliation.service.ts's own doc for the
 * full method). Kept as a standalone entry point for CLI/ops use; the same service also backs
 * `POST .../reports/reconcile-penalties` for admin use from the UI.
 *
 * Dry-run by default (reads `reconcileCommunity`, prints what WOULD be written) — pass --apply
 * to actually write via `applyReconciliation`.
 *
 *   npm run reconcile:penalties -- Kralik [--apply] [--fund=EXPENSES] [--unit=<code>]
 */
@Module({ imports: [FeaturesModule, PeriodModule] })
class ScriptModule {}

async function main() {
  const args = process.argv.slice(2)
  const communityCode = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')
  const fundArg = args.find((a) => a.startsWith('--fund='))
  const fundCode = fundArg ? fundArg.slice('--fund='.length) : undefined
  const unitArg = args.find((a) => a.startsWith('--unit='))
  if (!communityCode) throw new Error('usage: reconcile-penalties <COMMUNITY_CODE> [--apply] [--fund=EXPENSES] [--unit=<code>]')

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const svc = app.get(PenaltyReconciliationService)
  const prisma = app.get(PrismaService)

  const community = await prisma.community.findFirst({ where: { OR: [{ id: communityCode }, { code: communityCode }] }, select: { id: true } })
  if (!community) throw new Error(`community ${communityCode} not found`)
  const period = await prisma.period.findFirst({ where: { communityId: community.id }, orderBy: { seq: 'desc' }, select: { id: true, code: true } })
  if (!period) throw new Error('no periods')
  const unitId = unitArg
    ? (await prisma.unit.findFirst({ where: { communityId: community.id, code: unitArg.slice('--unit='.length) }, select: { id: true } }))?.id
    : undefined

  if (!apply) {
    const results = await svc.reconcileCommunity(community.id, period.id, { fundCode, unitId })
    const report = results.map((r) => ({
      unit: r.unitCode, fund: r.fundCode, liveTotal: r.liveTotal, anchorTrusted: r.anchorTrusted,
      slices: r.slices.length, seededPenalty: Math.round(r.slices.reduce((s, x) => s + x.penaltyProjected, 0) * 100) / 100,
    }))
    console.log(JSON.stringify(report, null, 2))
    console.log(`\nWould reconcile ${results.length} (unit, fund) pair(s) as of ${period.code}. Pass --apply to write.`)
  } else {
    const res = await svc.applyReconciliation(community.id, period.id, { fundCode, unitId })
    console.log(`Reconciled ${res.unitsReconciled} (unit, fund) pair(s), wrote/updated ${res.bucketsWritten} bucket(s), as of ${period.code}.`)
  }
  await app.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
