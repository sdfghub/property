import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Row = {
  communityId: string
  periodCode: string
  beCode: string
  bucket: string
  amount: number
  currency?: string
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import opening balances into be_opening_balance.

Usage:
  npm run import:opening -- <file>

File format (CSV): communityId,periodCode,beCode,bucket,amount,currency
File format (JSON): [{ communityId, periodCode, beCode, bucket, amount, currency }]
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
    const [communityId, periodCode, beCode, bucket, amountStr, currency] = line.split(',').map((s) => s.trim())
    if (!communityId || !periodCode || !beCode || !bucket || !amountStr) continue
    rows.push({
      communityId,
      periodCode,
      beCode,
      bucket,
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
    await prisma.beOpeningBalance.upsert({
      where: {
        communityId_periodId_billingEntityId: {
          communityId: r.communityId,
          periodId: period.id,
          billingEntityId: be.id,
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
        amount: r.amount,
        currency: r.currency ?? 'RON',
      },
    })
    count += 1
  }
  console.log(`✅ Imported ${count} opening balances into be_opening_balance from ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
