import fs from 'fs'
import path from 'path'
import { parse as parseCsv } from 'csv-parse/sync'
import { ExpenseImportPlan, ExpenseCsvRow } from './types'

export function parseExpenses(folder: string, periodCode: string): ExpenseImportPlan {
  const csvPath = path.join(folder, `expenses-${periodCode}.csv`)
  const raw = fs.readFileSync(csvPath, 'utf8')
  const rows: ExpenseCsvRow[] = parseCsv(raw, { columns: true, skip_empty_lines: true })

  const items = rows.map(r => ({
    description: String(r.description).trim(),
    expenseTypeCode: String(r.expenseTypeCode).trim(),
    amount: Number(String(r.allocatableAmount).replace(',', '.')),
    currency: (r.currency ?? 'RON').trim(),
    targetType: r.targetType as any,
    targetCode: r.targetCode?.trim(),
    weightSource: (r.weightSource as any) ?? undefined
  }))

  const communityId = path.basename(folder)
  return { communityId, periodCode, items }
}
