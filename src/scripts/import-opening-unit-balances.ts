import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Row = {
  communityId: string
  periodCode: string
  unitCode: string
  amount: number
  currency?: string
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import opening balances per unit, rolled up to be_opening_balance.

Usage:
  npm run import:opening:units -- <file>

File format (CSV): communityId,periodCode,unitCode,amount,currency
File format (JSON): [{ communityId, periodCode, unitCode, amount, currency }]
`)
  process.exit(msg ? 1 : 0)
}

function parseFile(file: string): Row[] {
  const ext = path.extname(file).toLowerCase()
  const content = fs.readFileSync(file, 'utf8')
  if (ext === '.json') {
    const data = JSON.parse(content)
    if (!Array.isArray(data)) usage('JSON must be an array')
    return data as Row[]
  }
  const lines = content.split(/\r?\n/).filter(Boolean)
  const rows: Row[] = []
  for (const line of lines) {
    const [communityId, periodCode, unitCode, amountStr, currency] = line.split(',').map((s) => s.trim())
    if (!communityId || !periodCode || !unitCode || !amountStr) continue
    rows.push({
      communityId,
      periodCode,
      unitCode,
      amount: Number(amountStr),
      currency,
    })
  }
  return rows
}

async function main() {
  const file = process.argv[2]
  if (!file) usage('Missing file')
  if (!fs.existsSync(file)) usage(`File not found: ${file}`)

  const rows = parseFile(file)
  const aggregates = new Map<
    string,
    {
      communityId: string
      periodId: string
      beId: string
      currency: string
      amount: number
    }
  >()

  for (const r of rows) {
    if (!Number.isFinite(r.amount)) continue
    const period = await prisma.period.findUnique({
      where: { communityId_code: { communityId: r.communityId, code: r.periodCode } },
      select: { id: true, seq: true },
    })
    if (!period) {
      console.warn(`Skipping: period ${r.periodCode} not found for ${r.communityId}`)
      continue
    }
    const unit = await prisma.unit.findUnique({
      where: { code_communityId: { code: r.unitCode, communityId: r.communityId } },
      select: { id: true },
    })
    if (!unit) {
      console.warn(`Skipping: unit ${r.unitCode} not found for ${r.communityId}`)
      continue
    }
    const bem = await prisma.billingEntityMember.findFirst({
      where: {
        unitId: unit.id,
        startSeq: { lte: period.seq },
        OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
      },
      select: { billingEntityId: true },
    })
    if (!bem) {
      console.warn(`Skipping: no BE membership for unit ${r.unitCode} at ${r.periodCode}`)
      continue
    }
    const key = `${r.communityId}::${period.id}::${bem.billingEntityId}`
    const entry =
      aggregates.get(key) ??
      {
        communityId: r.communityId,
        periodId: period.id,
        beId: bem.billingEntityId,
        currency: r.currency ?? 'RON',
        amount: 0,
      }
    entry.amount += r.amount
    aggregates.set(key, entry)
  }

  let count = 0
  for (const agg of aggregates.values()) {
    const existing = await prisma.beOpeningBalance.findFirst({
      where: {
        communityId: agg.communityId,
        periodId: agg.periodId,
        billingEntityId: agg.beId,
        fundId: null,
        unitId: null,
      },
      select: { id: true },
    })
    if (existing?.id) {
      await prisma.beOpeningBalance.update({
        where: { id: existing.id },
        data: { amount: agg.amount, currency: agg.currency },
      })
    } else {
      await prisma.beOpeningBalance.create({
        data: {
          communityId: agg.communityId,
          periodId: agg.periodId,
          billingEntityId: agg.beId,
          fundId: null,
          unitId: null,
          amount: agg.amount,
          currency: agg.currency,
        },
      })
    }
    count++
  }

  console.log(`✅ Imported ${count} opening balances into be_opening_balance from ${file} (unit-level, rolled to BE)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
