// Import the detailed Kralik cash book (data/Kralik/cash-2026-05.json) — every bank/casă line →
// a CashTx (per fund, IN/OUT), and each owner receipt → a Payment record (BE-level, tagged with
// providerMeta.cycleCode) that the avizier payment-log drilldown reads. Standalone + idempotent
// (clears its own CASH_REGISTER cash-tx + cash-register payments first).
//   npx ts-node --transpile-only src/scripts/import-kralik-cash.ts
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'

const COMM = 'Kralik'
const REF = 'CASH_REGISTER'

function norm(x: string) { return String(x).replace(/ /g, '').replace(/[\s./]/g, '').toUpperCase() }

async function main() {
  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const cash = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'cash-2026-05.json'), 'utf8'))
    const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'def.json'), 'utf8'))
    const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', COMM, 'history-mapping.json'), 'utf8'))
    const cycleCode: string = cash.cycleCode || '2026-04'

    // unit label -> {code, be}
    const prefix = mapping.unitLabelPrefix ?? ''
    const byNorm = new Map<string, { code: string; be: string }>()
    for (const u of def.structure || []) {
      const nm = String(u.name || '')
      const label = nm.startsWith(prefix) ? nm.slice(prefix.length) : (nm || u.code)
      byNorm.set(norm(label), { code: u.code, be: u.billingEntity })
    }
    const ov: Record<string, string> = mapping.unitOverrides || {}
    const ovNorm = new Map<string, string>(Object.entries(ov).map(([k, v]) => [norm(k), v]))
    const beOfCode = new Map<string, string>((def.structure || []).map((u: any) => [u.code, u.billingEntity]))
    const resolveBe = (label: string): string | null => {
      const n = norm(label)
      if (ovNorm.has(n)) return beOfCode.get(ovNorm.get(n)!) ?? null
      return byNorm.get(n)?.be ?? null
    }

    const accounts = new Map<string, string>((await prisma.cashAccount.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((a: any) => [a.code, a.id]))
    const funds = new Map<string, string>((await prisma.fund.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((f: any) => [f.code, f.id]))
    const beIds = new Map<string, string>((await prisma.billingEntity.findMany({ where: { communityId: COMM }, select: { id: true, code: true } })).map((b: any) => [b.code, b.id]))
    const acctId = (k: string) => accounts.get(cash.accounts?.[k] || k)

    // idempotency: clear prior imports
    await prisma.cashTx.deleteMany({ where: { communityId: COMM, refType: REF } })
    await prisma.payment.deleteMany({ where: { communityId: COMM, provider: 'cash-register' } })

    let nTx = 0, nPay = 0, missBe: string[] = []
    for (const t of cash.tx as any[]) {
      if (t.void) continue
      const account = acctId(t.acct)
      if (!account) { console.log(`  ⚠ no account ${t.acct}`); continue }
      const ts = new Date(t.date)
      const dir = t.dir === 'IN' ? 'IN' : 'OUT'
      const kind = ['PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'OTHER'].includes(t.kind) ? t.kind : 'OTHER'
      const fundsObj: Record<string, number> = t.funds || { [t.fund || 'EXPENSES']: t.amount }
      for (const [fc, amt] of Object.entries(fundsObj)) {
        const fundId = funds.get(fc)
        if (!fundId) { console.log(`  ⚠ no fund ${fc} (tx #${t.n})`); continue }
        await prisma.cashTx.create({
          data: {
            communityId: COMM, accountId: account, fundId, ts, amount: amt as number, currency: 'RON',
            direction: dir as any, kind: kind as any, status: 'POSTED',
            refType: REF, refId: `${t.n}:${t.ref}:${fc}`,
            memo: t.memo || t.payee || null,
            meta: { n: t.n, ref: t.ref, account: t.acct, counterparty: t.payee || t.unit || null, payer: t.payer || null, cycle: t.cycle || null, cycleCode },
          },
        })
        nTx++
      }
      // owner receipt → Payment (BE-level)
      if (t.unit && dir === 'IN' && kind === 'PAYMENT') {
        const be = resolveBe(t.unit)
        const beId = be ? beIds.get(be) : null
        if (!beId) { missBe.push(t.unit); continue }
        await prisma.payment.create({
          data: {
            communityId: COMM, billingEntityId: beId, accountId: account, amount: t.amount, currency: 'RON', ts,
            method: 'REGISTER', status: 'POSTED', provider: 'cash-register', providerRef: t.ref,
            refId: `cash:${cycleCode}:${t.n}`,
            providerMeta: { cycleCode, account: t.acct, unitLabel: t.unit, payer: t.payer || null, funds: fundsObj, cycle: t.cycle || null, memo: t.memo || null, ref: t.ref },
          },
        })
        nPay++
      }
    }
    console.log(`✅ cash imported: ${nTx} cash_tx, ${nPay} payments (cycle ${cycleCode})`)
    if (missBe.length) console.log(`  ⚠ unresolved units: ${[...new Set(missBe)].join(', ')}`)
  } finally { await prisma.$disconnect() }
}
main().catch((e) => { console.error(e); process.exit(1) })
