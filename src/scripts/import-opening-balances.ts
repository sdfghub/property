import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Row = {
  communityId: string
  periodCode: string
  beCode: string
  fundCode?: string
  unitCode?: string
  amount: number
  currency?: string
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import opening balances into be_opening_balance.

Usage:
  npm run import:opening -- <file>

File format (CSV): communityId,periodCode,beCode,amount,currency
File format (JSON): [{ communityId, periodCode, beCode, amount, currency, fundCode?, unitCode? }]
`)
  process.exit(msg ? 1 : 0)
}

function parseFile(file: string): Row[] {
  const ext = path.extname(file).toLowerCase()
  const content = fs.readFileSync(file, 'utf8')
  if (ext === '.json') {
    const data = JSON.parse(content)
    if (!Array.isArray(data)) usage('JSON must be an array of rows')
    return data as Row[]
  }
  // CSV
  const lines = content.split(/\r?\n/).filter(Boolean)
  const rows: Row[] = []
  for (const line of lines) {
    const [communityId, periodCode, beCode, amountStr, currency] = line.split(',').map((s) => s.trim())
    if (!communityId || !periodCode || !beCode || !amountStr) continue
    rows.push({
      communityId,
      periodCode,
      beCode,
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
  let count = 0
  for (const r of rows) {
    const period = await prisma.period.findUnique({
      where: { communityId_code: { communityId: r.communityId, code: r.periodCode } },
      select: { id: true },
    })
    if (!period) {
      console.warn(`Skipping: period ${r.periodCode} not found for ${r.communityId}`)
      continue
    }
    const be = await prisma.billingEntity.findUnique({
      where: { code_communityId: { code: r.beCode, communityId: r.communityId } },
      select: { id: true },
    })
    if (!be) {
      console.warn(`Skipping: BE ${r.beCode} not found for ${r.communityId}`)
      continue
    }
    let fundId: string | null = null
    if (r.fundCode) {
      const fund = await prisma.fund.findUnique({
        where: { code_communityId: { code: r.fundCode, communityId: r.communityId } },
        select: { id: true },
      })
      if (!fund) {
        console.warn(`Skipping: fund ${r.fundCode} not found for ${r.communityId}`)
        continue
      }
      fundId = fund.id
    }
    let unitId: string | null = null
    if (r.unitCode) {
      const unit = await prisma.unit.findUnique({
        where: { code_communityId: { code: r.unitCode, communityId: r.communityId } },
        select: { id: true },
      })
      if (!unit) {
        console.warn(`Skipping: unit ${r.unitCode} not found for ${r.communityId}`)
        continue
      }
      unitId = unit.id
    }
    if (fundId == null || unitId == null) {
      const existing = await prisma.beOpeningBalance.findFirst({
        where: {
          communityId: r.communityId,
          periodId: period.id,
          billingEntityId: be.id,
          fundId,
          unitId,
        },
        select: { id: true },
      })
      if (existing?.id) {
        await prisma.beOpeningBalance.update({
          where: { id: existing.id },
          data: { amount: r.amount, currency: r.currency ?? 'RON' },
        })
      } else {
        await prisma.beOpeningBalance.create({
          data: {
            communityId: r.communityId,
            periodId: period.id,
            billingEntityId: be.id,
            fundId,
            unitId,
            amount: r.amount,
            currency: r.currency ?? 'RON',
          },
        })
      }
    } else {
      await prisma.beOpeningBalance.upsert({
        where: {
          communityId_periodId_billingEntityId_fundId_unitId: {
            communityId: r.communityId,
            periodId: period.id,
            billingEntityId: be.id,
            fundId,
            unitId,
          },
        },
        update: {
          amount: r.amount,
          currency: r.currency ?? 'RON',
        },
        create: {
          communityId: r.communityId,
          periodId: period.id,
          billingEntityId: be.id,
          fundId,
          unitId,
          amount: r.amount,
          currency: r.currency ?? 'RON',
        },
      })
    }
    count += 1
  }
  console.log(`✅ Imported ${count} opening balances into be_opening_balance from ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
