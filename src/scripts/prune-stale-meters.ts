/**
 * Delete Meter rows that are no longer in def.json. The reseed's `wipe:community` can't remove them —
 * `Meter` has no communityId — so redefining meters (e.g. collapsing a unit's two water meters into one)
 * would otherwise leave the old devices behind. We scope by the community's unit codes (+ its own code)
 * so other communities' meters are never touched.
 *
 * Usage: ts-node src/scripts/prune-stale-meters.ts [CommunityCode=Kralik]
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()

async function main() {
  const ref = process.argv[2] || 'Kralik'
  const community = await prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true, code: true } })
  if (!community) throw new Error(`Community not found: ${ref}`)

  const def = JSON.parse(readFileSync(join(process.cwd(), 'data', community.code || ref, 'def.json'), 'utf8'))
  const defIds = new Set<string>((def.meters || []).map((m: any) => m.meterId))

  const units = await prisma.unit.findMany({ where: { communityId: community.id }, select: { code: true } })
  const scopeCodes = new Set<string>([...units.map((u) => u.code), community.code || ref, community.id])

  const meters = await prisma.meter.findMany({ select: { meterId: true, scopeCode: true } })
  const stale = meters.filter((m) => scopeCodes.has(m.scopeCode) && !defIds.has(m.meterId)).map((m) => m.meterId)
  if (stale.length) {
    // drop any raw readings hanging off the removed devices too, so the rollup can't double-count
    await (prisma as any).meterReading.deleteMany({ where: { meterId: { in: stale } } })
    await prisma.meter.deleteMany({ where: { meterId: { in: stale } } })
  }
  console.log(`prune-stale-meters [${community.code}]: removed ${stale.length} meter(s) not in def.json`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
