import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type FundDef = {
  code: string
  name: string
  description?: string
  status?: string
  currency?: string
  totalTarget?: number
  startPeriodCode?: string
  targets?: Array<{ offset: number; amount: number }>
  targetPlan?: { periodCount: number; perPeriodAmount: number }
  allocation?: any
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import funds for a community.

Usage:
  npm run import:funds -- <funds.json|folder> [communityId]

Examples:
  npm run import:funds -- ./data/LOTUS-TM/funds.json LOTUS-TM
  npm run import:funds -- ./data/LOTUS-TM              # derives funds.json and communityId from folder
`)
  process.exit(msg ? 1 : 0)
}

function resolvePaths(argPath: string) {
  const stat = fs.statSync(argPath)
  if (stat.isDirectory()) {
    return {
      file: path.join(argPath, 'funds.json'),
      communityId: path.basename(argPath),
    }
  }
  return {
    file: argPath,
    communityId: path.basename(path.dirname(argPath)),
  }
}

async function main() {
  const [p, cid] = process.argv.slice(2)
  if (!p) usage('Missing funds path')
  const { file, communityId: derived } = resolvePaths(p)
  if (!fs.existsSync(file)) usage(`Funds file not found: ${file}`)
  const communityId = cid || derived
  if (!communityId) usage('Community id not provided and could not be derived')

  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FundDef[]
  if (!Array.isArray(raw)) usage('Funds file must be an array')
  let count = 0
  for (const proj of raw) {
    if (!proj.code || !proj.name) continue
    // Resolve targets: explicit offsets or an even target plan
    let targets: Array<{ offset: number; amount: number }> | undefined
    if (Array.isArray(proj.targets) && proj.targets.length) {
      targets = proj.targets
    } else if (proj.targetPlan) {
      const pc = proj.targetPlan.periodCount
      const ppa = proj.targetPlan.perPeriodAmount
      if (pc && ppa && pc > 0 && ppa > 0) {
        targets = Array.from({ length: pc }, (_, idx) => ({ offset: idx, amount: ppa }))
      }
    }

    // Validate totalTarget if provided
    if (proj.totalTarget != null && targets?.length) {
      const sum = targets.reduce((s, t) => s + Number(t.amount ?? 0), 0)
      const delta = Math.abs(sum - Number(proj.totalTarget))
      if (delta > 0.01) {
        throw new Error(`Fund ${proj.code}: sum of targets (${sum}) differs from totalTarget (${proj.totalTarget})`)
      }
    }

    await prisma.fund.upsert({
      where: { communityId_code: { communityId, code: proj.code } },
      update: {
        name: proj.name,
        description: proj.description ?? null,
        status: proj.status ?? 'PLANNED',
        currency: proj.currency ?? 'RON',
        totalTarget: proj.totalTarget ?? null,
        startPeriodCode: proj.startPeriodCode ?? null,
        targetPlan: proj.targetPlan ?? undefined,
        targets: targets ?? undefined,
        allocation: proj.allocation ?? null,
      },
      create: {
        communityId,
        code: proj.code,
        name: proj.name,
        description: proj.description ?? null,
        status: proj.status ?? 'PLANNED',
        currency: proj.currency ?? 'RON',
        totalTarget: proj.totalTarget ?? null,
        startPeriodCode: proj.startPeriodCode ?? null,
        targetPlan: proj.targetPlan ?? undefined,
        targets: targets ?? undefined,
        allocation: proj.allocation ?? null,
      },
    })
    count += 1
  }
  console.log(`✅ Imported ${count} funds into community=${communityId} from ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
