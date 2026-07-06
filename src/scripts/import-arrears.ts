import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Import opening balances / arrears (restanțe) for a community, with aging support.
 *
 * File: <folder>/opening-balances.json  (or pass the .json path directly)
 *   { "periodCode": "2026-03", "currency": "RON",
 *     "items": [ { unitCode, fundCode, kind?, amount, dueDate?, originKey?, sourceFund?, currency? } ] }
 *
 * - kind: 'PRINCIPAL' (default) | 'PENALTY'
 * - dueDate: ISO YYYY-MM-DD scadență for this bucket; omit => treated as already past-due
 * - originKey: unique bucket id per (unit,fund,kind); defaults 'TOTAL' (principal) / 'PEN:<sourceFund>' (penalty)
 * - sourceFund: required for kind='PENALTY' (which fund's arrears produced the penalty)
 * - amount: RON, negative = credit
 *
 * Replace semantics: all opening balances for (community, periodCode) are deleted and re-inserted,
 * so the file is the source of truth.
 *
 * Usage: npm run import:arrears -- ./data/<COMM>            (derives file + community from folder)
 *        npm run import:arrears -- ./data/<COMM>/opening-balances.json <COMM>
 */
function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log('Usage: npm run import:arrears -- <folder|opening-balances.json> [communityId]')
  process.exit(msg ? 1 : 0)
}

function resolve(argPath: string) {
  const stat = fs.statSync(argPath)
  if (stat.isDirectory()) return { file: path.join(argPath, 'opening-balances.json'), communityId: path.basename(argPath) }
  return { file: argPath, communityId: path.basename(path.dirname(argPath)) }
}

async function main() {
  const [p, cid] = process.argv.slice(2)
  if (!p) usage('Missing path')
  const { file, communityId: derived } = resolve(p)
  if (!fs.existsSync(file)) usage(`File not found: ${file}`)
  const communityId = cid || derived

  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const periodCode: string = data.periodCode
  const defaultCurrency: string = data.currency ?? 'RON'
  const items: any[] = Array.isArray(data.items) ? data.items : []
  if (!periodCode) usage('periodCode is required')

  const period = await prisma.period.findUnique({
    where: { communityId_code: { communityId, code: periodCode } },
    select: { id: true, seq: true },
  })
  if (!period) throw new Error(`Period ${periodCode} not found for ${communityId}`)

  const units = await prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
  const unitByCode = new Map(units.map((u) => [u.code, u.id]))
  const funds = await prisma.fund.findMany({ where: { communityId }, select: { id: true, code: true } })
  const fundByCode = new Map(funds.map((f) => [f.code, f.id]))
  const members = await prisma.billingEntityMember.findMany({
    where: {
      billingEntity: { communityId },
      startSeq: { lte: period.seq },
      OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
    },
    select: { unitId: true, billingEntityId: true },
  })
  const beByUnit = new Map(members.map((m) => [m.unitId, m.billingEntityId]))

  // replace: file is source of truth for this (community, period)
  await prisma.beOpeningBalance.deleteMany({ where: { communityId, periodId: period.id } })

  let n = 0
  let noDue = 0
  for (const it of items) {
    const unitId = unitByCode.get(it.unitCode)
    if (!unitId) throw new Error(`Unknown unit: ${it.unitCode}`)
    const fundId = fundByCode.get(it.fundCode)
    if (!fundId) throw new Error(`Unknown fund: ${it.fundCode} (unit ${it.unitCode})`)
    const billingEntityId = beByUnit.get(unitId)
    if (!billingEntityId) throw new Error(`No billing entity for unit ${it.unitCode} at ${periodCode}`)
    const kind = it.kind ?? 'PRINCIPAL'
    if (kind === 'PENALTY' && !it.sourceFund && !it.originKey) {
      throw new Error(`PENALTY row for ${it.unitCode} needs sourceFund (or explicit originKey)`)
    }
    const originKey = it.originKey ?? (kind === 'PENALTY' ? `PEN:${it.sourceFund}` : 'TOTAL')
    const dueDate = it.dueDate ? new Date(it.dueDate) : null
    if (kind === 'PRINCIPAL' && !dueDate && Number(it.amount) > 0) noDue++
    await prisma.beOpeningBalance.create({
      data: {
        communityId,
        periodId: period.id,
        billingEntityId,
        fundId,
        unitId,
        amount: it.amount,
        currency: it.currency ?? defaultCurrency,
        kind,
        originKey,
        dueDate,
      },
    })
    n++
  }

  console.log(`✅ Imported ${n} opening-balance rows for ${communityId} ${periodCode}`)
  if (noDue) {
    console.log(
      `⚠️  ${noDue} PRINCIPAL rows have no dueDate -> treated as already past-due at cutover. ` +
      `Recent arrears may be over-penalized; supply dueDate + originKey per originating month for exact aging.`,
    )
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
