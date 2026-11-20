// Statement balances → CashAccount.notes.balanceCheckpoints (anchors the account balances; see
// src/modules/billing/cash-balance.util.ts). Source: data/<COMM>/cash-balances.json. Idempotent:
// replaces the checkpoint list (and `fxRates`, the dated RON rate of non-RON accounts) of every
// account named in the file, keeps other notes keys.
//   npm run seed:cash-balances -- Kralik
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

async function main() {
  const comm = process.argv[2]
  if (!comm) throw new Error('usage: seed:cash-balances -- <COMMUNITY>')
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', comm, 'cash-balances.json'), 'utf8'))
  const prisma = new PrismaClient()
  try {
    const community = await prisma.community.findFirst({ where: { OR: [{ id: comm }, { code: comm }] } })
    if (!community) throw new Error(`community ${comm} not found`)
    for (const [code, checkpoints] of Object.entries<any[]>(data.accounts)) {
      const acc = await prisma.cashAccount.findUnique({ where: { communityId_code: { communityId: community.id, code } } })
      if (!acc) throw new Error(`cash account ${code} not found`)
      const notes = acc.notes && typeof acc.notes === 'object' && !Array.isArray(acc.notes) ? (acc.notes as any) : {}
      await prisma.cashAccount.update({ where: { id: acc.id }, data: { notes: { ...notes, balanceCheckpoints: checkpoints } } })
      const last = checkpoints[checkpoints.length - 1]
      console.log(`✅ ${code}: ${checkpoints.length} checkpoints, anchor ${last.date} = ${last.balance}`)
    }
    // exchange rates of non-RON accounts (RON per 1 unit, dated)
    for (const [code, rates] of Object.entries<any[]>(data.fxRates ?? {})) {
      const acc = await prisma.cashAccount.findUnique({ where: { communityId_code: { communityId: community.id, code } } })
      if (!acc) throw new Error(`cash account ${code} not found`)
      const notes = acc.notes && typeof acc.notes === 'object' && !Array.isArray(acc.notes) ? (acc.notes as any) : {}
      await prisma.cashAccount.update({ where: { id: acc.id }, data: { notes: { ...notes, fxRates: rates } } })
      console.log(`✅ ${code}: ${rates.length} fx rate(s), latest ${rates[rates.length - 1].date} = buy ${rates[rates.length - 1].buy ?? rates[rates.length - 1].rate} / sell ${rates[rates.length - 1].sell ?? "–"}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
