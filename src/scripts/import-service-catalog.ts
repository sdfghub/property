import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type CatalogItem = {
  domain: string
  name: string
  level?: number | null
  comment?: string | null
  actions?: string | null
  workStatus?: string | null
  priority?: string | null
  levelDefs?: Record<string, string>
  /** English display names / level meanings (shown when the UI is in English). */
  nameEn?: string | null
  domainEn?: string | null
  levelDefsEn?: Record<string, string>
  /** VITAL | ESSENTIAL | SUPPLEMENTARY (SERVICE_TIERS in services.service.ts). */
  tier?: string | null
  /** Earlier names of this item in the same domain: the existing row is renamed, keeping its history. */
  previousNames?: string[]
  /** e.g. MUNICIPALITY: a service the city hall provides (SERVICE_PROVIDERS). */
  providedBy?: string | null
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import the service catalog & evaluation for a community.

Usage:
  npm run import:service-catalog -- <service-catalog.json|folder> [communityId] [--meta-only]

Examples:
  npm run import:service-catalog -- ./data/Kralik       # derives service-catalog.json and communityId from folder

Upserts by (domain, name). An item whose current evaluation differs from the file gets its
values replaced and a new history row; re-running with the same file changes nothing.
--meta-only: for existing items update only names, English labels, class, level definitions and
order — never the evaluation (keeps what was assessed in the app). New items are still created.
`)
  process.exit(msg ? 1 : 0)
}

function resolvePaths(argPath: string) {
  const stat = fs.statSync(argPath)
  if (stat.isDirectory()) {
    return { file: path.join(argPath, 'service-catalog.json'), communityId: path.basename(argPath) }
  }
  return { file: argPath, communityId: path.basename(path.dirname(argPath)) }
}

async function main() {
  const args = process.argv.slice(2)
  const metaOnly = args.includes('--meta-only')
  const [p, cid] = args.filter((a) => !a.startsWith('--'))
  if (!p) usage('Missing catalog path')
  const resolved = resolvePaths(p)
  const communityKey = cid || resolved.communityId
  const community = await prisma.community.findFirst({
    where: { OR: [{ id: communityKey }, { code: communityKey }] },
    select: { id: true },
  })
  if (!community) usage(`Community not found: ${communityKey}`)

  const doc = JSON.parse(fs.readFileSync(resolved.file, 'utf8')) as { assessedAt?: string; items: CatalogItem[] }
  const assessedAt = doc.assessedAt ? new Date(doc.assessedAt) : new Date()
  let created = 0
  let assessed = 0
  let renamed = 0

  for (const [i, it] of doc.items.entries()) {
    const evaluation = {
      level: it.level ?? null,
      comment: it.comment ?? null,
      actions: it.actions ?? null,
      workStatus: (it.workStatus ?? null) as any,
      priority: (it.priority ?? null) as any,
    }
    const key = { communityId_domain_name: { communityId: community.id, domain: it.domain, name: it.name } }
    let existing = await prisma.serviceItem.findUnique({ where: key })
    if (!existing && it.previousNames?.length) {
      const old = await prisma.serviceItem.findFirst({ where: { communityId: community.id, domain: it.domain, name: { in: it.previousNames } } })
      if (old) {
        existing = await prisma.serviceItem.update({ where: { id: old.id }, data: { name: it.name } })
        renamed++
      }
    }
    const changed =
      !existing ||
      (!metaOnly && (Object.keys(evaluation) as Array<keyof typeof evaluation>).some((k) => (existing as any)[k] !== evaluation[k]))
    const meta = {
      nameEn: it.nameEn ?? null,
      domainEn: it.domainEn ?? null,
      tier: (it.tier ?? null) as any,
      levelDefs: it.levelDefs,
      levelDefsEn: it.levelDefsEn,
      providedBy: it.providedBy ?? null,
    }
    // Full import: the file sets the order. Meta-only keeps the order set in the app (Servicii →
    // Editează ordinea) and slots a new item right after the last service of its domain.
    let sortOrder = i
    if (metaOnly && !existing) {
      const all = await prisma.serviceItem.findMany({ where: { communityId: community.id }, select: { domain: true, sortOrder: true } })
      const same = all.filter((x) => x.domain === it.domain)
      const after = same.length ? Math.max(...same.map((x) => x.sortOrder)) : Math.max(-1, ...all.map((x) => x.sortOrder))
      await prisma.serviceItem.updateMany({ where: { communityId: community.id, sortOrder: { gt: after } }, data: { sortOrder: { increment: 1 } } })
      sortOrder = after + 1
    }

    const item = await prisma.serviceItem.upsert({
      where: key,
      create: { communityId: community.id, domain: it.domain, name: it.name, sortOrder, ...meta, ...evaluation, assessedAt },
      update: { ...meta, ...(metaOnly ? {} : { sortOrder }), ...(changed ? { ...evaluation, assessedAt } : {}) },
    })
    if (!existing) created++
    if (changed) {
      await prisma.serviceAssessment.create({ data: { serviceItemId: item.id, ...evaluation, createdAt: assessedAt } })
      assessed++
    }
  }
  console.log(`service catalog ${communityKey}: ${doc.items.length} items, ${created} created, ${renamed} renamed, ${assessed} evaluations recorded${metaOnly ? ' (meta-only)' : ''}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
