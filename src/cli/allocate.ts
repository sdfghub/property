import { allocateExpenseWithRule } from '../lib/allocation.js'
const id = process.argv[2]
if (!id) { console.error('Usage: npm run allocate -- <expenseId>'); process.exit(1) }
allocateExpenseWithRule(id).then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0) }).catch(e => { console.error(e); process.exit(1) })
