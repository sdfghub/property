// Import the August 2026 cash book (data/Kralik/cash-2026-08.json: Registru Bancă + Registru Casă, window
// 10.09–09.10.2026, verified against the Libra statement) → CashTx per fund + owner Payment rows with an
// explicit allocationSpec. Supersedes the provisional 25.09 bank-only import (same refType/provider).
// Idempotent: clears its own prior import (refType CASH_REGISTER_2026_08 / provider cash-register-2026-08).
//   npx ts-node --transpile-only src/scripts/import-kralik-cash-august.ts
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'

const COMM = 'Kralik'
const REF = 'CASH_REGISTER_2026_08'
const PROVIDER = 'cash-register-2026-08'
const FILE = process.argv[2] || path.join(process.cwd(), 'data', COMM, 'cash-2026-08.json')
const r2 = (x: number) => Math.round(x * 100) / 100

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const cash = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const cycleCode: string = cash.cycleCode
    const funds = new Map<string, string>((await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((f: any) => [f.code, f.id]))
    const accounts = new Map<string, string>((await prisma.cashAccount.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((a: any) => [a.code, a.id]))
    const acctId = (k: string) => { const id = accounts.get(cash.accounts?.[k || 'BANK'] || k); if (!id) throw new Error(`no account ${k}`); return id }
    const fid = (c: string) => { const id = funds.get(c); if (!id) throw new Error(`no fund ${c}`); return id }

    await prisma.cashTx.deleteMany({ where: { communityId: COMM, refType: REF } })
    const old = await prisma.payment.findMany({ where: { communityId: COMM, provider: PROVIDER }, select: { id: true } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: old.map((o: any) => o.id) } } })
    await prisma.payment.deleteMany({ where: { communityId: COMM, provider: PROVIDER } })

    let nTx = 0, nPay = 0, sumIn = 0, sumOut = 0
    for (const p of cash.payments as any[]) {
      const ts = new Date(p.date + 'T12:00:00Z')
      const account = acctId(p.acct)
      const lines: Array<{ fund: string; amount: number; unitId?: string }> =
        p.lines || Object.entries(p.funds).map(([fund, amount]) => ({ fund, amount: amount as number, unitId: p.unitId }))
      const fixed = r2(lines.reduce((s, l) => s + l.amount, 0))
      const rest = r2(p.amount - fixed)
      if (rest < 0) throw new Error(`#${p.n}: lines ${fixed} exceed amount ${p.amount}`)
      const cashFunds: Record<string, number> = {}
      for (const l of lines) cashFunds[l.fund] = r2((cashFunds[l.fund] || 0) + l.amount)
      if (rest > 0) cashFunds[p.advance] = r2((cashFunds[p.advance] || 0) + rest)
      for (const [fc, a] of Object.entries(cashFunds)) {
        await prisma.cashTx.create({ data: {
          communityId: COMM, accountId: account, fundId: fid(fc), ts, amount: a, currency: 'RON',
          direction: 'IN' as any, kind: 'PAYMENT' as any, status: 'POSTED',
          refType: REF, refId: `${p.n}:${p.ref}:${fc}`, memo: p.memo,
          meta: { n: p.n, ref: p.ref, account: p.acct || 'BANK', register: p.register, counterparty: p.unit, payer: p.payer, cycleCode, mode: p.mode },
        } })
        nTx++
      }
      const advUnit = p.advanceUnitId || p.unitId
      const spec: any[] = lines.map((l) => ({ amount: l.amount, fundId: fid(l.fund), ...(l.unitId ? { unitId: l.unitId } : {}) }))
      spec.push({ fundId: fid(p.advance), advance: true, ...(advUnit ? { unitId: advUnit } : {}) })
      await prisma.payment.create({ data: {
        communityId: COMM, billingEntityId: p.be, accountId: account, amount: p.amount, currency: 'RON', ts,
        method: 'REGISTER', status: 'POSTED', provider: PROVIDER, providerRef: p.ref,
        refId: `cash:${cycleCode}:${p.n}`, allocationSpec: spec,
        providerMeta: { cycleCode, account: p.acct || 'BANK', register: p.register, unitLabel: p.unit, payer: p.payer, funds: cashFunds, cycle: null, memo: p.memo, ref: p.ref, mode: p.mode },
      } })
      nPay++; sumIn += p.amount
    }
    for (const o of cash.outflows as any[]) {
      await prisma.cashTx.create({ data: {
        communityId: COMM, accountId: acctId(o.acct), fundId: fid(o.fund), ts: new Date(o.date + 'T12:00:00Z'), amount: o.amount, currency: 'RON',
        direction: 'OUT' as any, kind: o.kind as any, status: 'POSTED',
        refType: REF, refId: `${o.n}:${o.ref}:${o.fund}${o.suffix ? ':' + o.suffix : ''}`, memo: o.memo,
        meta: { n: o.n, ref: o.ref, account: o.acct || 'BANK', cycleCode },
      } })
      nTx++; sumOut += o.amount
    }
    console.log(`✅ ${nTx} cash_tx, ${nPay} payments; in ${r2(sumIn)} out ${r2(sumOut)} (cycle ${cycleCode})`)
  } finally { await prisma.$disconnect() }
}
main().catch((e) => { console.error(e); process.exit(1) })
