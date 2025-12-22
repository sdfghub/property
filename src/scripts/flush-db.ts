import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const tables = [
  'bill_line',
  'bill',
  'invoice_split',
  'program_invoice',
  'bill_template_instance',
  'bill_template',
  'template_attachment',
  'meter_entry_template_instance',
  'meter_entry_template',
  'bill_template',
  'vendor_invoice_doc',
  'vendor_invoice',
  'allocation_line',
  'aggregation_rule',
  'derived_meter_rule',
  'allocation_log',
  'expense_split',
  'split_group_member',
  'split_group',
  'bucket_rule',
  'program',
  'weight_item',
  'weight_vector',
  'expense',
  'expense_type',
  'allocation_rule',
  'expense_target_member',
  'expense_target_set',
  'period_measure',
  'measure_period_value',
  'measure_sample',
  'measure_series',
  'measure_type',
  'meter',
  'unit_group_member',
  'billing_entity_member',
  'unit_group',
  'billing_entity',
  'unit',
  'period',
  'be_statement',
  'be_ledger_entry',
  'be_ledger_entry_detail',
  'payment_application',
  'payment',
  'be_opening_balance',
  'external_ref',
  'refresh_token',
  'login_token',
  'invite',
  'role_assignment',
  '"user"',
  'community'
]

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Flush all DB tables (destructive!)

Usage:
  npm run db:flush -- --yes

Options:
  --yes    Required. Confirm you want to truncate all tables (CASCADE).
`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv: string[]) {
  let yes = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes') yes = true
    else usage(`Unknown arg: ${a}`)
  }
  if (!yes) usage('Missing --yes confirmation')
}

async function main() {
  parseArgs(process.argv)
  const existing = (await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  `).map((r) => r.tablename)
  const toTruncate = tables.filter((t) => existing.includes(t))
  if (!toTruncate.length) {
    console.log('No known tables found to truncate.')
    return
  }
  const sql = `TRUNCATE TABLE ${toTruncate.join(', ')} CASCADE`
  await prisma.$executeRawUnsafe(sql)
  // eslint-disable-next-line no-console
  console.log(`✅ database flushed (truncated: ${toTruncate.join(', ')})`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
