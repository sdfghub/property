/**
 * Verification harness for the collection-rate report ("grad de colectare").
 *
 *   npx ts-node --transpile-only src/scripts/verify-collection-rate.ts      # COMM=Kralik default
 *   COMM=OtherCommunity npx ts-node --transpile-only src/scripts/verify-collection-rate.ts
 *
 * Checks the report against the raw be_statement rows and against the pre-existing
 * finance.collection() endpoint. This repo has no jest setup, so this script is the test.
 * Exits non-zero if any check fails.
 */
import { PrismaService } from '../modules/user/prisma.service'
import { ReportsService } from '../modules/reports/reports.service'
import { FinanceService } from '../modules/finance/finance.service'

const COMM = process.env.COMM || 'Kralik'
const money = (n: any) => (n === null || n === undefined ? 'null' : Number(n).toFixed(2))

async function main() {
  const prisma = new PrismaService()
  const reports = new ReportsService(prisma as any)
  const finance = new FinanceService(prisma as any)

  const periods: any[] = await (prisma as any).$queryRawUnsafe(
    `select p.code, p.status, round(sum(bs.due_end),2)::float8 as due_end,
            round(sum(bs.payments),2)::float8 as payments, round(sum(bs.charges),2)::float8 as charges
       from period p join be_statement bs on bs.period_id = p.id
      where p.community_id = $1 group by p.code, p.status, p.seq order by p.seq`,
    COMM,
  )
  console.log('DB truth (be_statement sums per period):')
  for (const p of periods) {
    console.log(`  ${p.code} ${p.status.padEnd(9)} dueEnd=${money(p.due_end)} charges=${money(p.charges)} payments=${money(p.payments)}`)
  }

  let failures = 0
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
    if (!ok) failures++
  }

  for (const p of periods) {
    const r: any = await reports.collectionRate(COMM, p.code)
    console.log(`\n=== ${p.code} (${r.period.status}) ===`)
    console.log(`  totals: owed=${money(r.totals.owed)} paid=${money(r.totals.paid)} outstanding=${money(r.totals.outstanding)} rate=${r.totals.ratePct}% cpi=${r.totals.cpi}`)

    // 1. Outstanding ties to the raw DB sum of due_end.
    check('outstanding == Σ be_statement.due_end', Math.abs(r.totals.outstanding - p.due_end) < 0.01,
      `report=${money(r.totals.outstanding)} db=${money(p.due_end)}`)

    // 2. The accounting identity, at every level.
    check('identity owed − paid == outstanding (root)', r.checks.identityOk, `residual=${money(r.checks.residual)}`)
    // Each level is rounded independently, so a leaf can sit one rounding unit (0.01) off while
    // the chain is exact at full precision — the root residual above is the real check.
    const EPS = 0.015
    const badDomain = r.domains.filter((d: any) => Math.abs(d.owed - d.paid - d.outstanding) >= EPS)
    check('identity holds for every domain', badDomain.length === 0, `${badDomain.length} bad`)
    const badFund = r.domains.flatMap((d: any) => d.funds).filter((f: any) => Math.abs(f.owed - f.paid - f.outstanding) >= EPS)
    check('identity holds for every fund', badFund.length === 0, `${badFund.length} bad`)
    const badBe = r.rows.filter((x: any) => Math.abs(x.owed - x.paid - x.outstanding) >= EPS)
    check('identity holds for every billing entity', badBe.length === 0, `${badBe.length} bad`)

    // 3. Rollups sum to the totals.
    // Children are rounded independently of their parent, so allow the maximum rounding spread
    // (half a cent per child). Anything beyond that is a real aggregation bug, not presentation.
    const sum = (a: any[], k: string) => Math.round(a.reduce((s, x) => s + x[k], 0) * 100) / 100
    const tol = (n: number) => 0.005 * n + 0.011
    check('Σ domains.owed == totals.owed', Math.abs(sum(r.domains, 'owed') - r.totals.owed) < tol(r.domains.length),
      `${money(sum(r.domains, 'owed'))} vs ${money(r.totals.owed)}`)
    check('Σ rows.owed == totals.owed', Math.abs(sum(r.rows, 'owed') - r.totals.owed) < tol(r.rows.length),
      `${money(sum(r.rows, 'owed'))} vs ${money(r.totals.owed)} (${r.rows.length} rows)`)
    check('Σ rows.outstanding == totals.outstanding',
      Math.abs(sum(r.rows, 'outstanding') - r.totals.outstanding) < tol(r.rows.length))

    // 4. Cross-check the pre-existing single-period endpoint.
    const c: any = await finance.collection(COMM, p.code)
    const hist = r.history.find((h: any) => h.periodCode === p.code)
    check('history includes this period (last period renders)', !!hist)
    check('history deltaPaid == finance.collection().collected', hist && Math.abs(hist.deltaPaid - c.collected) < 0.01,
      `delta=${money(hist?.deltaPaid)} collection=${money(c.collected)}`)

    // 6. CPI sanity — cotă-parte indiviză sums to the whole building.
    check('totals.cpi ≈ 100', Math.abs(r.totals.cpi - 100) < 0.5, `cpi=${r.totals.cpi}`)
    const cpiOver = r.domains.filter((d: any) => d.cpi > r.totals.cpi + 0.01)
    check('no domain CPI exceeds total (no double-count)', cpiOver.length === 0, `${cpiOver.length} over`)

    console.log('  domains: ' + r.domains.map((d: any) => `${d.key}=${money(d.owed)}/${d.ratePct}%[cpi ${d.cpi}]`).join(' '))
  }

  // 5. Domain filter.
  const P = periods[periods.length - 1].code
  console.log(`\n=== domain filter @ ${P} ===`)
  const all: any = await reports.collectionRate(COMM, P)
  let domainOwedSum = 0
  for (const d of ['operational', 'tactic', 'strategic', 'other']) {
    const r: any = await reports.collectionRate(COMM, P, d)
    const codes = r.domains.flatMap((x: any) => x.funds.map((f: any) => f.code))
    domainOwedSum += r.totals.owed
    console.log(`  ${d.padEnd(12)} owed=${money(r.totals.owed).padStart(12)} outstanding=${money(r.totals.outstanding).padStart(12)} funds=[${codes.join(',')}]`)
    check(`  ${d}: only its own funds`, r.domains.every((x: any) => x.key === d))
    check(`  ${d}: identity holds`, r.checks.identityOk, `residual=${money(r.checks.residual)}`)
  }
  check('Σ per-domain owed == unfiltered total', Math.abs(domainOwedSum - all.totals.owed) < 0.01,
    `${money(domainOwedSum)} vs ${money(all.totals.owed)}`)
  check('case-insensitive domain match', (await reports.collectionRate(COMM, P, 'STRATEGIC') as any).totals.owed ===
    (await reports.collectionRate(COMM, P, 'strategic') as any).totals.owed)

  // 8. Other communities unaffected.
  const others: any[] = await (prisma as any).$queryRawUnsafe(
    `select id from community where id <> $1 and exists (select 1 from be_statement bs where bs.community_id = community.id) limit 1`, COMM)
  if (others.length) {
    const o: any = await reports.collectionRate(others[0].id)
    console.log(`\n=== other community ${others[0].id} ===`)
    check('other community returns a coherent report', o.checks.identityOk && o.domains.length > 0,
      `domains=${o.domains.map((d: any) => d.key).join(',')} residual=${money(o.checks.residual)}`)
  } else {
    console.log('\n(no other community with statements — skipping cross-community check)')
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`)
  await (prisma as any).$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
