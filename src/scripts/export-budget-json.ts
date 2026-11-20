/**
 * Dump a budget version (rollup + every line with its months / entries / per-unit split) plus the
 * community's funds and their monthly collections to a JSON file. Feeds scripts/budget_to_xlsx.py.
 *
 *   npx ts-node --transpile-only src/scripts/export-budget-json.ts <COMM> <out.json> [versionCode]
 *
 * Read-only.
 */
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
import { BudgetService } from '../modules/budget/budget.service'

const prisma = new PrismaClient()

async function main() {
  const [comm, out, versionCode] = process.argv.slice(2)
  if (!comm || !out) {
    console.log('Usage: ts-node src/scripts/export-budget-json.ts <COMM> <out.json> [versionCode]')
    process.exit(1)
  }
  const c = await prisma.community.findFirst({ where: { OR: [{ id: comm }, { code: comm }] } })
  if (!c) throw new Error(`Community ${comm} not found`)
  const svc = new BudgetService(prisma as any)
  const budget: any = await svc.getBudget(c.id, versionCode)
  const lines = []
  for (const l of budget.lines) lines.push(await svc.getLine(c.id, l.id))
  const funds = await prisma.fund.findMany({ where: { communityId: c.id } })
  const collections: any[] = await prisma.$queryRawUnsafe(
    `select f.code as "fundCode", p.code as "periodCode", sum(fl.amount)::float8 as amount
       from fund_ledger_entry fl join fund f on f.id = fl.fund_id join period p on p.id = fl.period_id
      where fl.community_id = $1 and fl.kind = 'PAYMENT'
      group by f.code, p.code order by 1, 2`, c.id,
  )
  // full history for the per-year sheets: expenses by month × expense type, and what each fund billed
  const hist = await svc.expenseCharges(c.id, 'EXPENSES')
  const agg = new Map<string, number>()
  for (const h of hist) {
    if (h.periodStatus !== 'CLOSED') continue
    const k = `${h.periodCode}|${h.expenseType}`
    agg.set(k, (agg.get(k) ?? 0) + h.amount)
  }
  const expenseHistory = [...agg].map(([k, amount]) => { const [periodCode, expenseType] = k.split('|'); return { periodCode, expenseType, amount } })
  const fundCharges: any[] = await prisma.$queryRawUnsafe(
    `select f.code as "fundCode", p.code as "periodCode", p.status::text as "periodStatus", sum(cc.amount)::float8 as amount
       from community_charge cc join fund f on f.id = cc.fund_id join period p on p.id = cc.period_id
      where cc.community_id = $1 and cc.status = 'ACTIVE' and f.code <> 'EXPENSES'
      group by 1, 2, 3 order by 1, 2`, c.id,
  )
  const periods = await prisma.period.findMany({ where: { communityId: c.id }, select: { code: true, status: true }, orderBy: { seq: 'asc' } })
  fs.writeFileSync(out, JSON.stringify({ community: { id: c.id, code: c.code, name: c.name, features: c.features }, budget, lines, funds, collections, periods, expenseHistory, fundCharges }, null, 1))
  console.log(`Wrote ${out}: ${lines.length} lines`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
