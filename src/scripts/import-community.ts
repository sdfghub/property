import { parseCommunity } from '../importers/community/parse'
import { applyCommunityPlan } from '../importers/community/apply'

const folder = process.argv[2]
if (!folder) throw new Error('Usage: npm run import:community -- ./data/<COMM>')

const plan = parseCommunity(folder)
applyCommunityPlan(plan)
  .then(() => console.log('✅ community imported'))
  .catch(e => { console.error(e); process.exit(1) })
