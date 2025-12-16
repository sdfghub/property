import fs from 'fs'
import path from 'path'
import { parse as parseCsv } from 'csv-parse/sync'
import { ExpenseImportPlan, ExpenseCsvRow } from './types'

export function parseExpenses(folder: string, periodCode: string): ExpenseImportPlan {
  const jsonPath = path.join(folder, 'expenses.json')
  const defPath = path.join(folder, 'def.json')
  let defSplits: Record<string, any> = {}
  if (fs.existsSync(defPath)) {
    try {
      const def = JSON.parse(fs.readFileSync(defPath, 'utf8'))
      if (Array.isArray(def.expenseSplits)) {
        defSplits = Object.fromEntries(
          def.expenseSplits
            .filter((s: any) => s && s.expenseTypeCode)
            .map((s: any) => [String(s.expenseTypeCode), s]),
        )
      }
    } catch {
      // ignore def parse errors here; importer will throw later if needed
    }
  }
  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      communityId: parsed.communityId ?? path.basename(folder),
      periodCode: parsed.periodCode ?? periodCode,
      items: (parsed.items ?? []).map((r: any) => ({
        description: String(r.description).trim(),
        expenseTypeCode: String(r.expenseTypeCode).trim(),
        amount: Number(r.amount),
        currency: (r.currency ?? 'RON').trim(),
        targetType: r.targetType,
        targetCode: r.targetCode?.trim(),
        weightSource: r.weightSource,
        splits: r.splits ?? defSplits[String(r.expenseTypeCode)]?.splits ?? null,
        allocationParams: r.allocationParams,
      })),
    }
  }

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
