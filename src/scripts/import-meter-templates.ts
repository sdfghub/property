import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type MeterTemplateDto = {
  code: string
  name: string
  order?: number
  startPeriodCode?: string | null
  endPeriodCode?: string | null
  template: any
}

async function main() {
  const [communityDir] = process.argv.slice(2)
  if (!communityDir) {
    console.log('Usage: npm run import:meter-templates -- <communityDir>')
    process.exit(1)
  }
  const communityCode = path.basename(communityDir)
  const defPath = path.join(communityDir, 'meter-entry-templates.json')
  if (!fs.existsSync(defPath)) {
    console.log(`No meter-entry-templates.json found at ${defPath}, skipping.`)
    return
  }
  const raw = JSON.parse(fs.readFileSync(defPath, 'utf8'))
  const templates: MeterTemplateDto[] = Array.isArray(raw)
    ? raw
    : Object.entries(raw).map(([code, tpl]: any) => ({
        code,
        name: (tpl as any).title || (tpl as any).name || code,
        order: (tpl as any).order ?? null,
        startPeriodCode: (tpl as any).startPeriodCode ?? null,
        endPeriodCode: (tpl as any).endPeriodCode ?? null,
        template: tpl,
      }))

  const community = await prisma.community.findFirst({
    where: { OR: [{ id: communityCode }, { code: communityCode }] },
    select: { id: true },
  })
  if (!community) throw new Error(`Community ${communityCode} not found`)

  console.log(`📥 Importing ${templates.length} meter templates for ${communityCode}`)
  for (const tpl of templates) {
    await (prisma as any).meterEntryTemplate.upsert({
      where: { communityId_code: { communityId: community.id, code: tpl.code } },
      update: {
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
      create: {
        communityId: community.id,
        code: tpl.code,
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
    })
    console.log(`  ✅ ${tpl.code} (${tpl.name})`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => prisma.$disconnect())
