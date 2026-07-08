/**
 * Generic historical-ledger injector — writes an association's past periods directly from the
 * normalized export (see parse-export.ts), WITHOUT running the allocation/close engine.
 * Reusable: no association-specific logic (all mapping lives in history-mapping.json).
 *
 * LAYER 1 (this file, so far): periods (CLOSED) + per-unit CHARGES → BeLedgerEntry/Detail +
 *   CommunityCharge/Line. LAYER 2 (next): BeStatement balance chain + payments + penalty aging.
 *
 * Run:  npm run history:inject -- ./data/Kralik     (HISTORY_CUTOVER=2026-03 → inject months < cutover)
 * Idempotent: clears its own MIGRATED artifacts for the injected periods first.
 */
import { PrismaService } from '../../modules/user/prisma.service'
import { parseExport } from './parse-export'

const REF = 'MIGRATED'

async function main() {
  const dir = process.argv[2] || './data/Kralik'
  const cutover = process.env.HISTORY_CUTOVER || '2026-03'
  const prisma = new PrismaService()
  await prisma.$connect()
  try {
    const parsed = parseExport(dir)
    const communityId = parsed.community
    const months = parsed.months.filter((m) => m.code < cutover && Object.keys(m.units).length)
    console.log(`community=${communityId}  injecting ${months.length} periods (< ${cutover}): ${months[0]?.code}..${months[months.length - 1]?.code}`)

    const funds = await prisma.fund.findMany({ where: { communityId }, select: { id: true, code: true } })
    const fundId = new Map(funds.map((f) => [f.code, f.id]))
    const bes = await prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true } })
    const beId = new Map(bes.map((b) => [b.code, b.id]))
    const units = await prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true } })
    const unitId = new Map(units.map((u) => [u.code, u.id]))
    const unitBe = new Map(parsed.units.map((u) => [u.code, u.be]))
    const miss = new Set<string>()
    const fid = (c: string) => { const v = fundId.get(c); if (!v) miss.add('fund:' + c); return v }
    const bid = (c: string) => { const v = beId.get(c); if (!v) miss.add('be:' + c); return v }
    const uid = (c: string) => { const v = unitId.get(c); if (!v) miss.add('unit:' + c); return v }

    const running = new Map<string, number>() // be::fund -> running dueEnd (chained across periods)
    const noArrears = new Set<string>()        // (be,fund) months carried with no source arrears figure
    const penBucket = new Map<string, string>() // be -> penalty bucket id
    const penAccrued = new Map<string, number>() // be -> cumulative penalty posted

    // idempotency for the migrated penalty aging (buckets are per-BE, not per-period)
    await prisma.penaltyBucketPeriod.deleteMany({ where: { bucket: { communityId, originKey: 'migrated' } } })
    await prisma.penaltyBucket.deleteMany({ where: { communityId, originKey: 'migrated' } })

    // Per-month source arrears. The export's "Restanțe" (arrearsByFund / penArrears) is each month's
    // OPENING balance, so a period CLOSES at the NEXT source month's opening — verified on the export:
    // Restanțe(N+1) = Restanțe(N) + charges(N) − payments(N). Using this month's Restanțe as dueEnd
    // (the old behaviour) lagged every balance by one month, understating "total de plată" by ~a month
    // of charges. We look ahead across ALL parsed months (incl. the cutover month), so the last injected
    // period closes at the computed period's opening.
    const seqOf = (code: string) => { const [yy, mm] = code.split('-').map(Number); return yy * 12 + mm }
    const ordered = [...parsed.months].sort((a, b) => seqOf(a.code) - seqOf(b.code))
    const nextCode = new Map<string, string>()
    for (let i = 0; i < ordered.length - 1; i++) nextCode.set(ordered[i].code, ordered[i + 1].code)
    const arrearsOf = (mm: any) => {
      const a = new Map<string, number>()
      const addA = (be: string, fund: string, v: number) => { if (v == null) return; const k = `${be}::${fund}`; a.set(k, (a.get(k) || 0) + v) }
      for (const [unitCode, u] of Object.entries<any>(mm.units)) {
        const be = unitBe.get(unitCode); if (!be) continue
        for (const [fund, v] of Object.entries<any>(u.arrearsByFund)) addA(be, fund, v as number)
        if (u.penArrears) addA(be, 'PENALIZARI', u.penArrears)
      }
      return a
    }
    const arrearsByCode = new Map<string, Map<string, number>>(ordered.map((mm) => [mm.code, arrearsOf(mm)]))

    for (const m of months) {
      const [y, mo] = m.code.split('-').map(Number)
      const seq = y * 12 + mo
      const period = await prisma.period.upsert({
        where: { communityId_code: { communityId, code: m.code } },
        update: { status: 'CLOSED', seq, dueDate: m.dueDate ? new Date(m.dueDate) : null, startDate: new Date(Date.UTC(y, mo - 1, 1)), endDate: new Date(Date.UTC(y, mo, 0)) },
        create: { communityId, code: m.code, seq, status: 'CLOSED', closedAt: new Date(Date.UTC(y, mo, 0)), preparedAt: new Date(Date.UTC(y, mo, 0)), startDate: new Date(Date.UTC(y, mo - 1, 1)), endDate: new Date(Date.UTC(y, mo, 0)), dueDate: m.dueDate ? new Date(m.dueDate) : null },
      })
      const periodId = period.id

      // Idempotency: drop our prior artifacts for this period.
      const prior = await prisma.beLedgerEntry.findMany({ where: { communityId, periodId, refType: { in: [REF, REF + '_PAY'] } }, select: { id: true } })
      if (prior.length) {
        await prisma.beLedgerEntryDetail.deleteMany({ where: { ledgerEntryId: { in: prior.map((x) => x.id) } } })
        await prisma.beLedgerEntry.deleteMany({ where: { id: { in: prior.map((x) => x.id) } } })
      }
      await prisma.beStatement.deleteMany({ where: { communityId, periodId } })
      const priorCC = await prisma.communityCharge.findMany({ where: { communityId, periodId, allocationStrategy: REF }, select: { id: true } })
      if (priorCC.length) {
        await prisma.communityChargeLine.deleteMany({ where: { chargeId: { in: priorCC.map((x) => x.id) } } })
        await prisma.communityCharge.deleteMany({ where: { id: { in: priorCC.map((x) => x.id) } } })
      }

      // Aggregate: per (be,fund) charge total + per-unit detail; and per (fund,service) lines for CommunityCharge.
      const beFundTotal = new Map<string, number>()             // be::fund -> amount
      const beFundUnit = new Map<string, Map<string, number>>() // be::fund -> unit -> amount
      const svc = new Map<string, { fund: string; lines: Array<{ be: string; unit: string; amount: number }> }>() // fund::service
      const add = (be: string, fund: string, unit: string, service: string, amt: number) => {
        if (!amt) return
        const k = `${be}::${fund}`
        beFundTotal.set(k, (beFundTotal.get(k) || 0) + amt)
        let mu = beFundUnit.get(k); if (!mu) { mu = new Map(); beFundUnit.set(k, mu) }
        mu.set(unit, (mu.get(unit) || 0) + amt)
        const sk = `${fund}::${service}`
        let s = svc.get(sk); if (!s) { s = { fund, lines: [] }; svc.set(sk, s) }
        s.lines.push({ be, unit, amount: amt })
      }
      for (const [unitCode, u] of Object.entries(m.units)) {
        const be = unitBe.get(unitCode); if (!be) continue
        for (const [service, amt] of Object.entries(u.charges)) add(be, 'EXPENSES', unitCode, service, amt)
        for (const [fund, amt] of Object.entries(u.funds)) add(be, fund, unitCode, 'CONTRIB', amt)
        if (u.penPosted) add(be, 'PENALIZARI', unitCode, 'penalty:EXPENSES', u.penPosted) // penalty charge (avizier PEN: column)
      }

      // CommunityCharge + lines (avizier reads these). Tag each charge the way the avizier's column
      // logic expects (finance.service.ts): fund contributions as sourceType FUND (→ own fund column,
      // e.g. "Fond Rulment"/"Reabilitare"), service charges with allocationSnapshot.expenseType (→ own
      // per-service column under Cheltuieli), penalties via their 'penalty:%' sourceKey. Without this
      // every injected charge falls through to the 'ALTELE' label and collapses into a single column.
      for (const [sk, s] of svc.entries()) {
        const [fund, service] = sk.split('::')
        const total = s.lines.reduce((a, l) => a + l.amount, 0)
        const isPenalty = service.startsWith('penalty:')
        const isFund = !isPenalty && service === 'CONTRIB'
        const sourceType = isFund ? 'FUND' : 'EXPENSE'
        const sourceId = isFund ? fund : service
        const sourceKey = isFund ? 'offset:0' : service
        const allocationSnapshot = (!isPenalty && !isFund) ? { expenseType: service } : undefined
        const cc = await prisma.communityCharge.upsert({
          where: { communityId_periodId_sourceType_sourceId_sourceKey_fundId: { communityId, periodId, sourceType, sourceId, sourceKey, fundId: fid(fund) as string } },
          update: { amount: total, allocationStrategy: REF, status: 'ACTIVE', allocationSnapshot },
          create: { communityId, periodId, fundId: fid(fund), sourceType, sourceId, sourceKey, amount: total, currency: 'RON', allocationStrategy: REF, status: 'ACTIVE', allocationSnapshot, meta: { source: REF, service } },
        })
        await prisma.communityChargeLine.deleteMany({ where: { chargeId: cc.id } })
        await prisma.communityChargeLine.createMany({
          data: s.lines.map((l) => ({ chargeId: cc.id, communityId, periodId, billingEntityId: bid(l.be) as string, unitId: uid(l.unit) as string, amount: l.amount, meta: { source: REF, service, fund } })),
        })
      }

      // BeLedgerEntry CHARGE + Detail per (be,fund).
      for (const [k, total] of beFundTotal.entries()) {
        const [be, fund] = k.split('::')
        const le = await prisma.beLedgerEntry.create({
          data: { communityId, periodId, billingEntityId: bid(be) as string, kind: 'CHARGE', lane: 'ACCRUAL', amount: total, currency: 'RON', refType: REF, refId: periodId, fundId: fid(fund) },
        })
        const mu = beFundUnit.get(k)!
        await prisma.beLedgerEntryDetail.createMany({
          data: Array.from(mu.entries()).map(([u, amt]) => ({ ledgerEntryId: le.id, communityId, periodId, billingEntityId: bid(be) as string, kind: 'CHARGE', fundId: fid(fund), currency: 'RON', refType: REF, refId: periodId, unitId: uid(u) as string, amount: amt, meta: { source: REF } })),
        })
      }

      // ── Layer 2: balance chain + payment plug + statement ──────────────────
      // dueEnd = the export's arrears for (BE,fund); payment (or adjustment) is the plug that satisfies
      // dueEnd = dueStart + charges − payments + adjustments. No arrears figure ⇒ carry (flagged).
      const arrears = new Map<string, number>() // be::fund -> source arrears (dueEnd target)
      const addArr = (be: string, fund: string, v: number) => { if (v == null) return; const k = `${be}::${fund}`; arrears.set(k, (arrears.get(k) || 0) + v) }
      for (const [unitCode, u] of Object.entries(m.units)) {
        const be = unitBe.get(unitCode); if (!be) continue
        for (const [fund, v] of Object.entries(u.arrearsByFund)) addArr(be, fund, v)
        if (u.penArrears) addArr(be, 'PENALIZARI', u.penArrears)
      }
      const closing = arrearsByCode.get(nextCode.get(m.code) || '') // dueEnd = NEXT month's opening arrears
      const keys = new Set<string>([...beFundTotal.keys(), ...arrears.keys(), ...running.keys(), ...(closing ? closing.keys() : [])])
      for (const k of keys) {
        const [be, fund] = k.split('::')
        // Opening: chain from the prior period's close; on a key's FIRST appearance (the first injected
        // period, or a unit that shows up mid-history with pre-existing debt) seed it from the source's
        // own opening arrears for this month, so it lands in "Sold precedent" instead of a hidden
        // adjustment and the avizier row adds up (sold + charges − payments = total due).
        const dueStart = running.has(k) ? (running.get(k) as number) : (arrears.get(k) ?? 0)
        const charges = beFundTotal.get(k) || 0
        // Close at next month's opening balance; a key absent there was paid down to zero. Fall back to
        // carrying (dueStart+charges) only when there is no successor month (shouldn't happen for injected periods).
        const dueEnd = closing ? (closing.get(k) ?? 0) : (arrears.has(k) ? (arrears.get(k) as number) : (dueStart + charges))
        if (!closing && !arrears.has(k) && (charges || dueStart)) noArrears.add(fund)
        const plug = Number((dueStart + charges - dueEnd).toFixed(4))
        const payments = plug >= 0 ? plug : 0
        const adjustments = plug < 0 ? -plug : 0
        if (payments > 0.005) {
          const le = await prisma.beLedgerEntry.create({ data: { communityId, periodId, billingEntityId: bid(be) as string, kind: 'PAYMENT', lane: 'CASH', amount: payments, currency: 'RON', refType: REF + '_PAY', refId: periodId, fundId: fid(fund) } })
          await prisma.beLedgerEntryDetail.create({ data: { ledgerEntryId: le.id, communityId, periodId, billingEntityId: bid(be) as string, kind: 'PAYMENT', fundId: fid(fund), currency: 'RON', refType: REF + '_PAY', refId: periodId, unitId: null, amount: payments, meta: { source: REF } } })
        }
        await prisma.beStatement.create({ data: { communityId, periodId, billingEntityId: bid(be) as string, fundId: fid(fund) as string, dueStart, charges, payments, adjustments, dueEnd } })
        running.set(k, dueEnd)
      }

      // ── Layer 2b: penalty aging (avizier month/total penalty columns read penalty_bucket_period) ──
      for (const [k, posted] of beFundTotal.entries()) {
        const [be, fund] = k.split('::')
        if (fund !== 'PENALIZARI' || !posted) continue
        let bucketId = penBucket.get(be)
        if (!bucketId) {
          const b = await prisma.penaltyBucket.create({
            data: { communityId, billingEntityId: bid(be) as string, fundId: fid('EXPENSES') as string, targetFundId: fid('PENALIZARI') as string, originKey: 'migrated', dueDate: m.dueDate ? new Date(m.dueDate) : null, firstPenalDay: m.dueDate ? new Date(m.dueDate) : new Date(Date.UTC(y, mo - 1, 1)), principalOriginal: 1e9, status: 'OPEN' },
          })
          bucketId = b.id; penBucket.set(be, bucketId)
        }
        const acc = (penAccrued.get(be) || 0) + posted; penAccrued.set(be, acc)
        await prisma.penaltyBucketPeriod.create({
          data: { bucketId, periodId, periodSeq: seq, penaltyPosted: posted, penaltyAccrued: acc, principalRemaining: arrears.get(`${be}::EXPENSES`) ?? 0, status: 'COMMITTED' },
        })
      }
    }

    if (noArrears.size) console.log(`ℹ funds carried without a source arrears figure (balance = accrual): ${[...noArrears].join(', ')}`)

    if (miss.size) console.log(`\n⚠ unresolved refs: ${[...miss].join(', ')}`)
    console.log('✅ layer-1 charge injection complete')
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
