import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const tables = [
  'bill_line',
  'bill',
  'invoice_split',
  'vendor_payment',
  'vendor_payment_application',
  'fund_invoice',
  'bill_template_instance',
  'bill_template',
  'template_attachment',
  'meter_entry_template_instance',
  'meter_entry_template',
  'bill_template',
  'vendor_invoice_doc',
  'vendor_invoice',
  'aggregation_rule',
  'derived_meter_rule',
  'split_group_member',
  'split_group',
  'fund',
  'expense_type',
  'allocation_rule',
  'community_charge_line',
  'community_charge',
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
  'fund_ledger_entry',
  'fund_ledger_entry_detail',
  'community_statement',
  'community_ledger_entry',
  'community_ledger_entry_detail',
  'be_statement',
  'be_ledger_entry',
  'be_ledger_entry_detail',
  'payment_application',
  'payment',
  'be_opening_balance',
  'community_opening_balance',
  'cash_tx',
  'cash_account',
  'external_ref',
  'refresh_token',
  'invite',
  'role_assignment',
  '"user"',
  'community'
]

const userTables = ['role_assignment', 'invite', 'refresh_token', '"user"', 'community']

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Flush all DB tables (destructive!)

Usage:
  npm run db:flush -- --yes [--preserve-users]

Options:
  --yes    Required. Confirm you want to truncate all tables (CASCADE).
  --preserve-users  Keep user/auth/community tables.
`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv: string[]) {
  let yes = false
  let preserveUsers = false
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes') yes = true
    else if (a === '--preserve-users') preserveUsers = true
    else usage(`Unknown arg: ${a}`)
  }
  if (!yes) usage('Missing --yes confirmation')
  return { preserveUsers }
}

async function main() {
  const { preserveUsers } = parseArgs(process.argv)
  const existing = (await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  `).map((r) => r.tablename)
  let toTruncate = tables.filter((t) => existing.includes(t))
  if (preserveUsers) {
    toTruncate = toTruncate.filter((t) => !userTables.includes(t))
  }
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
