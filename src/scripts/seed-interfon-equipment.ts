// Interfon: equipment per apartment + the "video intercoms don't work" incident. Idempotent.
//   npm run seed:interfon -- Kralik
// 1. Service "Interfon" gets one equipment kind, "Interfon (interior)", variants Audio / Video.
// 2. Every apartment (unit label "AP …") gets that equipment: Video for the units in VIDEO, Audio otherwise
//    (an existing variant is overwritten; SAD / commercial units are left alone).
// 3. An INCIDENT on Interfon, action PARTIAL, scoped to Interfon (interior) – Video, is created once;
//    the service's status drops to PARTIAL if it was better (with a history row), as the API does.
import { PrismaClient } from '@prisma/client'

const EQUIPMENT = 'Interfon (interior)'
const VARIANTS = ['Audio', 'Video']
// Apartments with a video intercom (labels as in the unit code, e.g. "AP 4 (I)").
const VIDEO = ['AP 2/1', 'AP 2/2', 'AP 4 (I)', 'AP 6', 'AP 6A', 'AP 8', 'AP 9', 'AP 10A', 'AP 31', 'AP 32', 'AP 4 (III)', 'AP 14B']
const INCIDENT_TITLE = 'Interfonul nu funcționează pentru interfoanele video'

const prisma = new PrismaClient()
const short = (code: string) => code.split('-').slice(3).join('-') || code

async function main() {
  const commArg = process.argv[2]
  if (!commArg) throw new Error('usage: seed:interfon -- <COMMUNITY>')
  const community = await prisma.community.findFirst({ where: { OR: [{ id: commArg }, { code: commArg }] } })
  if (!community) throw new Error(`community ${commArg} not found`)
  const item = await prisma.serviceItem.findFirst({ where: { communityId: community.id, name: 'Interfon' } })
  if (!item) throw new Error('service "Interfon" not found')

  await prisma.serviceItem.update({ where: { id: item.id }, data: { equipmentDefs: [{ name: EQUIPMENT, variants: VARIANTS }] } })

  const units = await prisma.unit.findMany({ where: { communityId: community.id }, orderBy: { order: 'asc' } })
  const apartments = units.filter((u) => (u.name || short(u.code)).startsWith('AP '))
  const missing = VIDEO.filter((v) => !apartments.some((u) => (u.name || short(u.code)) === v))
  if (missing.length) throw new Error(`video units not found: ${missing.join(', ')}`)
  for (const u of apartments) {
    const variant = VIDEO.includes(u.name || short(u.code)) ? 'Video' : 'Audio'
    await prisma.unitEquipment.upsert({
      where: { unitId_serviceItemId_name: { unitId: u.id, serviceItemId: item.id, name: EQUIPMENT } },
      create: { communityId: community.id, unitId: u.id, serviceItemId: item.id, name: EQUIPMENT, variant },
      update: { variant },
    })
  }
  console.log(`equipment: ${apartments.length} apartments (${VIDEO.length} Video, ${apartments.length - VIDEO.length} Audio)`)

  const existing = await prisma.ticket.findFirst({ where: { communityId: community.id, type: 'INCIDENT', title: INCIDENT_TITLE } })
  if (existing) {
    console.log(`incident already exists: ${existing.id} (${existing.status})`)
    return
  }
  const admin = await prisma.roleAssignment.findFirst({ where: { role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: community.id }, select: { userId: true } })
  if (!admin) throw new Error('no community admin to record as creator')
  const ticket = await prisma.ticket.create({
    data: {
      communityId: community.id, type: 'INCIDENT', priority: 'MEDIUM', title: INCIDENT_TITLE,
      serviceItemId: item.id, serviceStatus: 'PARTIAL', equipmentName: EQUIPMENT, equipmentVariant: 'Video',
      createdById: admin.userId,
    },
  })
  console.log(`incident created: ${ticket.id}`)
  if (item.status === 'FUNCTIONAL' || item.status == null) {
    await prisma.$transaction([
      prisma.serviceItem.update({ where: { id: item.id }, data: { status: 'PARTIAL' } }),
      prisma.serviceAssessment.create({
        data: { serviceItemId: item.id, assessedById: admin.userId, level: item.level, comment: item.comment, actions: item.actions, workStatus: item.workStatus, priority: item.priority, status: 'PARTIAL' },
      }),
    ])
    console.log(`Interfon status: ${item.status ?? '—'} → PARTIAL`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
