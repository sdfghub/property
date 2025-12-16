import fs from 'fs'
import path from 'path'
import { parse as parseCsv } from 'csv-parse/sync'
import { PrismaClient, EntityType } from '@prisma/client'

type Row = { meterId: string; ts: string; value: number; estimated?: boolean }

const prisma = new PrismaClient()

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Usage:
  npm run import:meters -- --file readings.csv [--replace]
  npm run import:meters -- --file readings.json [--replace]

CSV columns: meterId,ts,value[,estimated]
JSON shape: [{ "meterId": "...", "ts": "2024-01-01T00:00:00Z", "value": 123.45, "estimated": false }]

Options:
  --file <path>   Required. CSV or JSON.
  --replace       If set, overwrite existing sample at same (seriesId, ts).
`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv: string[]) {
  let file: string | undefined
  let replace = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') file = argv[++i]
    else if (a === '--replace') replace = true
    else usage(`Unknown arg: ${a}`)
  }
  if (!file) usage('Missing --file')
  return { file: path.resolve(file), replace }
}

function parseFile(file: string): Row[] {
  const ext = path.extname(file).toLowerCase()
  const raw = fs.readFileSync(file, 'utf8')
  if (ext === '.json') {
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) usage('JSON must be an array')
    return rows.map((r: any) => ({
      meterId: String(r.meterId ?? '').trim(),
      ts: String(r.ts ?? '').trim(),
      value: Number(r.value),
      estimated: r.estimated === true
    }))
  }
  if (ext === '.csv') {
    const rows = parseCsv(raw, { columns: true, skip_empty_lines: true })
    return rows.map((r: any) => ({
      meterId: String(r.meterId ?? r.meter_id ?? '').trim(),
      ts: String(r.ts ?? r.time ?? '').trim(),
      value: Number(String(r.value ?? '').replace(',', '.')),
      estimated: String(r.estimated ?? '').toLowerCase() === 'true'
    }))
  }
  usage('Unsupported file extension; use .csv or .json')
}

async function resolveSeriesId(meterId: string): Promise<string> {
  const ref = await prisma.externalRef.findFirst({
    where: { legacyId: meterId, entityType: EntityType.SERIES },
    select: { entityId: true }
  })
  if (!ref) throw new Error(`Meter ${meterId}: SERIES ExternalRef not found`)
  return ref.entityId
}

async function main() {
  const { file, replace } = parseArgs(process.argv)
  const rows = parseFile(file)
  if (!rows.length) usage('No rows found in file')

  for (const [i, row] of rows.entries()) {
    if (!row.meterId) throw new Error(`Row ${i}: meterId required`)
    if (!row.ts) throw new Error(`Row ${i}: ts required`)
    if (!Number.isFinite(row.value)) throw new Error(`Row ${i}: value must be a number`)
  }

  for (const row of rows) {
    const seriesId = await resolveSeriesId(row.meterId)
    if (replace) {
      await prisma.measureSample.deleteMany({ where: { seriesId, ts: new Date(row.ts) } })
    }
    await prisma.measureSample.create({
      data: {
        seriesId,
        ts: new Date(row.ts),
        value: row.value,
        estimated: row.estimated ?? false
      }
    })
  }

  console.log(`✅ imported ${rows.length} readings from ${file}${replace ? ' (replace mode)' : ''}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
