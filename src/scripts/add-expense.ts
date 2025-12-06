import fs from 'fs'
import path from 'path'
import { applyExpensePlan } from '../importers/expense/apply'
import type { ExpenseImportPlan } from '../importers/expense/types'

function usage(msg?: string) {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(
`add-expense usage:
  --file <path|->     Read JSON plan from file or stdin (-)
  --json '<json>'     Read JSON plan from inline string
  --dry-run           Validate and print, do not write

examples:
  npm run add:expense -- --file ./data/LOTUS-TM/expense-plan.json
  npm run add:expense -- --json '{"communityId":"LOTUS-TM","periodCode":"2025-09","items":[...]}' 
  cat plan.json | npm run add:expense -- --file -`
  )
  process.exit(msg ? 1 : 0)
}

type Cli = { file?: string; json?: string; dryRun?: boolean }
function parseCli(argv: string[]): Cli {
  const out: Cli = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--file') out.file = argv[++i]
    else if (a === '--json') out.json = argv[++i]
    else if (a === '--dry-run') out.dryRun = true
    else usage(`unknown arg ${a}`)
  }
  if (!out.file && !out.json) usage('missing --file or --json')
  return out
}

function readPlan(cli: Cli): ExpenseImportPlan {
  if (cli.json && cli.file) usage('use either --json OR --file, not both')
  if (cli.json) return JSON.parse(cli.json)
  if (cli.file === '-') return JSON.parse(fs.readFileSync(0, 'utf8'))
  return JSON.parse(fs.readFileSync(path.resolve(cli.file!), 'utf8'))
}

function validate(plan: ExpenseImportPlan) {
  if (!plan.communityId) usage('plan.communityId is required')
  if (!plan.periodCode) usage('plan.periodCode is required')
  if (!Array.isArray(plan.items) || plan.items.length === 0) usage('plan.items[] is required')
  for (const [i, it] of plan.items.entries()) {
    if (!it.description) usage(`items[${i}].description is required`)
    if (!it.expenseTypeCode) usage(`items[${i}].expenseTypeCode is required`)
    if (typeof it.amount !== 'number' || !isFinite(it.amount) || it.amount <= 0)
      usage(`items[${i}].amount must be a positive number`)
  }
}

async function main() {
  const cli = parseCli(process.argv)
  const plan = readPlan(cli)
  validate(plan)

  if (cli.dryRun) {
    console.log(JSON.stringify({ ok: true, plan }, null, 2))
    return
  }

  await applyExpensePlan(plan)
  console.log(`✅ add-expense OK: ${plan.items.length} item(s) → ${plan.communityId}/${plan.periodCode}`)
}

main().catch(e => { console.error(e); process.exit(1) })
