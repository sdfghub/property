import 'reflect-metadata'
import { parseExpenses } from '../importers/expense/parse'
import { applyExpensePlan } from '../importers/expense/apply'
import { BillingPeriodLookupService } from '../modules/billing/period-lookup.service'
import { AllocationService } from '../modules/billing/allocation.service'
import { ExpenseService } from '../modules/billing/expense.service'
import { PrismaService } from '../modules/user/prisma.service'

const [folder, periodCode] = process.argv.slice(2)
if (!folder || !periodCode) {
  console.log('Usage: npm run import:expense -- ./data/<COMMUNITY> 2025-09')
  process.exit(1)
}

const plan = parseExpenses(folder, periodCode)
applyExpensePlan(plan)
  .then(async () => {
    console.log('✅ expenses imported, triggering allocations via service...')
    const prisma = new PrismaService()
    try {
      const dbInfo = await prisma.$queryRawUnsafe<Array<{ db: string; usr: string; host: string | null }>>(
        `select current_database() as db, current_user as usr, inet_server_addr()::text as host`,
      )
      if (dbInfo[0]) {
        console.log(`ℹ️ DB connection: db=${dbInfo[0].db} user=${dbInfo[0].usr} host=${dbInfo[0].host}`)
      }
    } catch {
      // ignore logging errors
    }
    const periodLookup = new BillingPeriodLookupService(prisma as any)
    const allocator = new AllocationService(prisma as any)
    const expenseSvc = new ExpenseService(prisma as any, periodLookup, allocator)
    // Push each expense through the service to run allocation + logging.
    for (const item of plan.items) {
      await expenseSvc.createExpense(plan.communityId, plan.periodCode, [{ role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: plan.communityId }], {
        description: item.description,
        amount: item.amount,
        currency: item.currency,
        expenseTypeId: (await prisma.expenseType.findUnique({ where: { code_communityId: { code: item.expenseTypeCode, communityId: plan.communityId } }, select: { id: true } }))?.id,
        allocationMethod: item.weightSource === 'RESIDENTS' ? 'BY_RESIDENTS' : item.weightSource === 'SQM' ? 'BY_SQM' : item.weightSource === 'CONSUMPTION' ? 'BY_CONSUMPTION' : undefined,
        allocationParams: item.allocationParams,
        splits: item.splits,
      })
    }
    // Summaries per BE and per BE member (using a single active membership per unit for the target period)
    const beSummary = await prisma.$queryRawUnsafe<
      Array<{ be: string; total: number; unit_code: string; unit_total: number }>
    >(
      `
      WITH tp AS (
        SELECT id, seq FROM period WHERE community_id = $1 AND code = $2 LIMIT 1
      ),
      active_members AS (
        SELECT DISTINCT ON (bem.unit_id)
          bem.unit_id,
          bem.billing_entity_id
        FROM billing_entity_member bem
        JOIN tp ON bem.start_seq <= tp.seq AND (bem.end_seq IS NULL OR bem.end_seq >= tp.seq)
        ORDER BY bem.unit_id, bem.start_seq DESC
      )
      SELECT
        be.code AS be,
        SUM(al.amount)::numeric AS total,
        u.code AS unit_code,
        SUM(al.amount)::numeric AS unit_total
      FROM allocation_line al
      JOIN tp ON tp.id = al.period_id
      JOIN active_members am ON am.unit_id = al.unit_id
      JOIN unit u ON u.id = al.unit_id
      JOIN billing_entity be ON be.id = am.billing_entity_id
      WHERE al.community_id = $1
      GROUP BY be.code, u.code
      ORDER BY be.code, u.code;
    `,
      plan.communityId,
      plan.periodCode,
    )

    const beDetails = await prisma.$queryRawUnsafe<
      Array<{ be: string; unit_code: string; expense_desc: string; expense_type: string | null; amount: number }>
    >(
      `
      WITH tp AS (
        SELECT id, seq FROM period WHERE community_id = $1 AND code = $2 LIMIT 1
      ),
      active_members AS (
        SELECT DISTINCT ON (bem.unit_id)
          bem.unit_id,
          bem.billing_entity_id
        FROM billing_entity_member bem
        JOIN tp ON bem.start_seq <= tp.seq AND (bem.end_seq IS NULL OR bem.end_seq >= tp.seq)
        ORDER BY bem.unit_id, bem.start_seq DESC
      )
      SELECT
        be.code AS be,
        u.code AS unit_code,
        e.description AS expense_desc,
        et.code AS expense_type,
        SUM(al.amount)::numeric AS amount
      FROM allocation_line al
      JOIN tp ON tp.id = al.period_id
      JOIN active_members am ON am.unit_id = al.unit_id
      JOIN unit u ON u.id = al.unit_id
      JOIN expense e ON e.id = al.expense_id
      LEFT JOIN expense_type et ON et.id = e.expense_type_id
      JOIN billing_entity be ON be.id = am.billing_entity_id
      WHERE al.community_id = $1
      GROUP BY be.code, u.code, e.description, et.code
      ORDER BY be.code, u.code, expense_desc;
    `,
      plan.communityId,
      plan.periodCode,
    )

    const byBe = new Map<string, { total: number; units: Record<string, number> }>()
    beSummary.forEach((row) => {
      if (!byBe.has(row.be)) byBe.set(row.be, { total: 0, units: {} })
      const bucket = byBe.get(row.be)!
      bucket.total += Number(row.total ?? 0)
      bucket.units[row.unit_code] = Number(row.unit_total ?? 0)
    })
    const detailsByBe = new Map<string, Array<typeof beDetails[number]>>()
    beDetails.forEach((row) => {
      if (!detailsByBe.has(row.be)) detailsByBe.set(row.be, [])
      detailsByBe.get(row.be)!.push(row)
    })

    // Allocation details grouped by BE/unit/expense
    const detailLines = await prisma.$queryRawUnsafe<
      Array<{
        be: string
        unit: string
        expense: string
        expense_type: string | null
        split: string | null
        amount: number
        meta: any
      }>
    >(
      `
      WITH tp AS (
        SELECT id, seq FROM period WHERE community_id = $1 AND code = $2 LIMIT 1
      ),
      active_members AS (
        SELECT DISTINCT ON (bem.unit_id)
          bem.unit_id,
          bem.billing_entity_id
        FROM billing_entity_member bem
        JOIN tp ON bem.start_seq <= tp.seq AND (bem.end_seq IS NULL OR bem.end_seq >= tp.seq)
        ORDER BY bem.unit_id, bem.start_seq DESC
      )
      SELECT
        be.code AS be,
        u.code AS unit,
        e.description AS expense,
        et.code AS expense_type,
        al.expense_split_id AS split,
        al.amount::numeric AS amount,
        al.meta AS meta
      FROM allocation_line al
      JOIN tp ON tp.id = al.period_id
      JOIN active_members am ON am.unit_id = al.unit_id
      JOIN billing_entity be ON be.id = am.billing_entity_id
      JOIN unit u ON u.id = al.unit_id
      JOIN expense e ON e.id = al.expense_id
      LEFT JOIN expense_type et ON et.id = e.expense_type_id
      WHERE al.community_id = $1
      ORDER BY be.code, u.code, e.description, al.expense_split_id;
    `,
      plan.communityId,
      plan.periodCode,
    )
    const detailsByBeUnit = new Map<string, Array<typeof detailLines[number]>>()
    detailLines.forEach((row) => {
      const key = `${row.be}::${row.unit}`
      if (!detailsByBeUnit.has(key)) detailsByBeUnit.set(key, [])
      detailsByBeUnit.get(key)!.push(row)
    })

    console.log('🔎 Allocation summary per BE and member (with expense and split details):')
    byBe.forEach((v, be) => {
      console.log(`  BE ${be}: total=${v.total.toFixed(2)}`)
      Object.entries(v.units).forEach(([unit, amt]) => {
        console.log(`    unit ${unit}: ${amt.toFixed(2)}`)
        const rows = (detailsByBe.get(be) ?? []).filter((r) => r.unit_code === unit)
        const splitRows = detailsByBeUnit.get(`${be}::${unit}`) ?? []

        const byType = new Map<
          string,
          { desc: string; type: string; amount: number; splits: typeof splitRows }
        >()
        rows.forEach((row) => {
          const key = row.expense_type ?? 'custom'
          byType.set(key, {
            desc: row.expense_desc,
            type: key,
            amount: Number(row.amount ?? 0),
            splits: [],
          })
        })
        splitRows.forEach((row) => {
          const key = row.expense_type ?? 'custom'
          const bucket =
            byType.get(key) ??
            byType.set(key, { desc: row.expense, type: key, amount: 0, splits: [] }).get(key)!
          bucket.splits.push(row)
        })

        Array.from(byType.values()).forEach((entry) => {
          console.log(
            `      expense: ${entry.desc} [${entry.type}] = ${Number(entry.amount ?? 0).toFixed(2)}`,
          )
          entry.splits.forEach((row) =>
            console.log(
            `        split ${row.split ?? 'n/a'}: ${row.expense} [${row.expense_type ?? 'custom'}] = ${Number(row.amount ?? 0).toFixed(4)} meta=${JSON.stringify(row.meta ?? {})}`,
            ),
          )
        })
      })
    })

    // Simple checksum: total allocatable expense vs sum of allocation lines
    const expenseTotals = await prisma.expense.aggregate({
      _sum: { allocatableAmount: true },
      where: { communityId: plan.communityId, period: { code: plan.periodCode } },
    })
    const allocationTotals = await prisma.allocationLine.aggregate({
      _sum: { amount: true },
      where: { communityId: plan.communityId, period: { code: plan.periodCode } },
    })
    const expected = Number(expenseTotals._sum.allocatableAmount ?? 0)
    const actual = Number(allocationTotals._sum.amount ?? 0)
    console.log(
      `🔎 Allocation checksum: expenses=${expected.toFixed(2)} allocated=${actual.toFixed(2)} delta=${(expected - actual).toFixed(2)}`,
    )

    // Stats snapshot
    const counts = await prisma.$queryRawUnsafe<
      Array<{ expenses: number; alloc_lines: number; expense_types: number; be: number; units: number }>
    >(
      `
      SELECT
        (SELECT COUNT(*) FROM expense e JOIN period p ON p.id = e.period_id WHERE e.community_id = $1 AND p.code = $2) AS expenses,
        (SELECT COUNT(*) FROM allocation_line al JOIN period p ON p.id = al.period_id WHERE al.community_id = $1 AND p.code = $2) AS alloc_lines,
        (SELECT COUNT(*) FROM expense_type WHERE community_id = $1) AS expense_types,
        (SELECT COUNT(*) FROM billing_entity WHERE community_id = $1) AS be,
        (SELECT COUNT(*) FROM unit WHERE community_id = $1) AS units
      `,
      plan.communityId,
      plan.periodCode,
    )
    if (counts[0]) {
      const c = counts[0]
      console.log(
        `📊 Stats: expenses=${c.expenses} alloc_lines=${c.alloc_lines} expense_types=${c.expense_types} BE=${c.be} units=${c.units}`,
      )
    }

    // Rebuild expenses view from allocations by expense type to spot drift
    const byType = await prisma.$queryRawUnsafe<
      Array<{ expense_type: string; expected: number; allocated: number; delta: number }>
    >(
      `
      WITH exp AS (
        SELECT e.id, e.allocatable_amount, COALESCE(et.code, 'custom') AS expense_type
        FROM expense e
        JOIN period p ON p.id = e.period_id
        LEFT JOIN expense_type et ON et.id = e.expense_type_id
        WHERE e.community_id = $1 AND p.code = $2
      ),
      alloc AS (
        SELECT expense_id, SUM(amount)::numeric AS allocated
        FROM allocation_line al
        GROUP BY expense_id
      )
      SELECT
        exp.expense_type,
        SUM(exp.allocatable_amount)::numeric AS expected,
        SUM(COALESCE(alloc.allocated, 0))::numeric AS allocated,
        (SUM(exp.allocatable_amount) - SUM(COALESCE(alloc.allocated, 0)))::numeric AS delta
      FROM exp
      LEFT JOIN alloc ON alloc.expense_id = exp.id
      GROUP BY exp.expense_type
      ORDER BY exp.expense_type;
    `,
      plan.communityId,
      plan.periodCode,
    )
    console.log('📊 By expense type (expected vs allocated):')
    byType.forEach((row) => {
      console.log(
        `  ${row.expense_type}: expected=${Number(row.expected ?? 0).toFixed(2)} allocated=${Number(row.allocated ?? 0).toFixed(2)} delta=${Number(row.delta ?? 0).toFixed(2)}`,
      )
    })

    // Billing entity rollup: allocations per BE should sum to allocated total
    const byBeAlloc = await prisma.$queryRawUnsafe<
      Array<{ be: string; total: number }>
    >(
      `
      WITH tp AS (
        SELECT id, seq FROM period WHERE community_id = $1 AND code = $2 LIMIT 1
      ),
      active_members AS (
        SELECT DISTINCT ON (bem.unit_id)
          bem.unit_id,
          bem.billing_entity_id
        FROM billing_entity_member bem
        JOIN tp ON bem.start_seq <= tp.seq AND (bem.end_seq IS NULL OR bem.end_seq >= tp.seq)
        ORDER BY bem.unit_id, bem.start_seq DESC
      )
      SELECT
        be.code AS be,
        SUM(al.amount)::numeric AS total
      FROM allocation_line al
      JOIN tp ON tp.id = al.period_id
      JOIN active_members am ON am.unit_id = al.unit_id
      JOIN billing_entity be ON be.id = am.billing_entity_id
      WHERE al.community_id = $1
      GROUP BY be.code
      ORDER BY be.code;
    `,
      plan.communityId,
      plan.periodCode,
    )
    const beSum = byBeAlloc.reduce((s, r) => s + Number(r.total ?? 0), 0)
    console.log('📊 Allocations by BE:')
    byBeAlloc.forEach((row) => console.log(`  ${row.be}: ${Number(row.total ?? 0).toFixed(2)}`))
    console.log(`  ↳ BE total=${beSum.toFixed(2)} (should match allocated=${actual.toFixed(2)})`)
    await prisma.$disconnect()
    console.log('✅ allocation completed via service')
  })
  .catch(e=>{console.error(e);process.exit(1)})
