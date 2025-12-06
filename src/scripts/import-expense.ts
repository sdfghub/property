import { parseExpenses } from '../importers/expense/parse'
import { applyExpensePlan } from '../importers/expense/apply'

const [folder, periodCode] = process.argv.slice(2)
if (!folder || !periodCode) {
  console.log('Usage: npm run import:expense -- ./data/<COMMUNITY> 2025-09')
  process.exit(1)
}

const plan = parseExpenses(folder, periodCode)
applyExpensePlan(plan)
  .then(()=>console.log('✅ expenses imported'))
  .catch(e=>{console.error(e);process.exit(1)})
