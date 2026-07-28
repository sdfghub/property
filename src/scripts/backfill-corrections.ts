/**
 * Backfill real `Correction` rows from a community's history declarations (history-mapping.json), so the
 * deliberate corrections we made during the history import become first-class Correction records — the
 * SOURCE OF TRUTH the admin "Corecții" view reads. The derived ledger legs already exist (booked by the
 * injector); this does NOT touch them — it only registers the declarations. Idempotent: re-running skips
 * corrections that already exist (matched on type + period + entity + fund).
 *
 * Covers the cleanly-declared corrections:
 *   - shareReallocations.reallocations[]  → RESHUFFLE       (reponderare-cote)
 *   - creditTransfers.entries[]           → CREDIT_TRANSFER (reatribuire-plata)
 * Computed seam adjustments (scutire-penalizari, ajustare-sold, reconciliere-numerar) are NOT declared as
 * clean entries — they remain visible in the ledger debug view (?debug=ledger), not as Correction rows.
 *
 * Usage: ts-node src/scripts/backfill-corrections.ts [CommunityCode=Kralik]
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

async function main() {
  const communityCode = process.argv[2] || 'Kralik'
  const community = await prisma.community.findFirst({ where: { OR: [{ id: communityCode }, { code: communityCode }] }, select: { id: true, code: true } })
  if (!community) throw new Error(`Community not found: ${communityCode}`)
  const communityId = community.id

  const mapPath = join(process.cwd(), 'data', community.code || communityCode, 'history-mapping.json')
  const mp = JSON.parse(readFileSync(mapPath, 'utf8'))

  const requireBe = async (code: string) => {
    const be = await prisma.billingEntity.findFirst({ where: { communityId, code }, select: { id: true } })
    if (!be) throw new Error(`BE not found: ${code}`)
    return be.id
  }
  // idempotency: does a Correction of this type already exist for (period, be?, fund?)
  const exists = async (type: string, periodCode: string, billingEntityId: string | null, fundCode: string | null) =>
    !!(await prisma.correction.findFirst({ where: { communityId, type: type as any, periodCode, billingEntityId, fundCode }, select: { id: true } }))

  let created = 0, skipped = 0

  // 1) RESHUFFLE (reponderare-cote) — from shareReallocations.reallocations[]
  for (const rc of (mp.shareReallocations?.reallocations ?? [])) {
    const periodCode: string = rc.bookPeriod
    const fundCode: string = rc.fund
    if (await exists('RESHUFFLE', periodCode, null, fundCode)) { skipped++; continue }
    await prisma.correction.create({
      data: {
        communityId, periodCode, type: 'RESHUFFLE' as any, reason: 'reponderare-cote',
        billingEntityId: null, fundCode,
        amount: rc.net != null ? rc.net : undefined,
        payload: { perBe: rc.perUnit ?? {}, net: rc.net, bookPeriod: rc.bookPeriod, sourcePeriod: rc.sourcePeriod } as any,
        note: rc._basis ?? null, status: 'ACTIVE' as any, createdBy: 'history-import',
      },
    })
    created++
  }

  // 2) CREDIT_TRANSFER (reatribuire-plata) — from creditTransfers.entries[]
  for (const t of (mp.creditTransfers?.entries ?? [])) {
    const periodCode: string = t.period
    const fundCode: string = t.fund
    const beId = await requireBe(t.be)
    if (await exists('CREDIT_TRANSFER', periodCode, beId, fundCode)) { skipped++; continue }
    if (t.amount == null) { console.warn(`  ! creditTransfer ${t.be}@${periodCode} has no amount — skipped`); skipped++; continue }
    await prisma.correction.create({
      data: {
        communityId, periodCode, type: 'CREDIT_TRANSFER' as any, reason: 'reatribuire-plata',
        billingEntityId: beId, fundCode, amount: t.amount,
        payload: undefined, note: t.note ?? null, status: 'ACTIVE' as any, createdBy: 'history-import',
      },
    })
    created++
  }

  console.log(`backfill-corrections [${community.code}]: created ${created}, skipped ${skipped} (already present)`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
