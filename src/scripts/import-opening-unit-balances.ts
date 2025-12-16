import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Row = {
  communityId: string
  periodCode: string
  unitCode: string
  bucket: string
  amount: number
  currency?: string
}

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Import opening balances per unit, rolled up to BE bucketed charges (OPENING).

Usage:
  npm run import:opening:units -- <file>

File format (CSV): communityId,periodCode,unitCode,bucket,amount,currency
File format (JSON): [{ communityId, periodCode, unitCode, bucket, amount, currency }]
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
    const [communityId, periodCode, unitCode, bucket, amountStr, currency] = line.split(',').map((s) => s.trim())
    if (!communityId || !periodCode || !unitCode || !bucket || !amountStr) continue
    rows.push({
      communityId,
      periodCode,
      unitCode,
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
  const aggregates = new Map<
    string,
    {
      communityId: string
      periodId: string
      beId: string
      bucket: string
      currency: string
      amount: number
      details: Array<{ unitId: string; amount: number }>
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
    const key = `${r.communityId}::${period.id}::${bem.billingEntityId}::${r.bucket}`
    const entry =
      aggregates.get(key) ??
      {
        communityId: r.communityId,
        periodId: period.id,
        beId: bem.billingEntityId,
        bucket: r.bucket,
        currency: r.currency ?? 'RON',
        amount: 0,
        details: [],
      }
    entry.amount += r.amount
    entry.details.push({ unitId: unit.id, amount: r.amount })
    aggregates.set(key, entry)
  }

  let count = 0
  for (const agg of aggregates.values()) {
    const le = await prisma.beLedgerEntry.upsert({
      where: {
        communityId_periodId_billingEntityId_refType_refId_bucket: {
          communityId: agg.communityId,
          periodId: agg.periodId,
          billingEntityId: agg.beId,
          refType: 'OPENING',
          refId: agg.periodId,
          bucket: agg.bucket,
        },
      },
      update: { amount: agg.amount, currency: agg.currency, kind: 'CHARGE' },
      create: {
        communityId: agg.communityId,
        periodId: agg.periodId,
        billingEntityId: agg.beId,
        kind: 'CHARGE',
        amount: agg.amount,
        currency: agg.currency,
        refType: 'OPENING',
        refId: agg.periodId,
        bucket: agg.bucket,
      },
    })
    // replace details for idempotency
    await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: le.id } })
    if (agg.details.length) {
      await prisma.beLedgerEntryDetail.createMany({
        data: agg.details.map((d) => ({
          ledgerEntryId: le.id,
          unitId: d.unitId,
          amount: d.amount,
          meta: { source: 'OPENING_UNIT' },
        })),
        skipDuplicates: true,
      })
    }
    count++
  }

  console.log(`✅ Imported ${count} opening balances from ${file} (unit-level, rolled to BE)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
