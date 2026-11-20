/**
 * Load (or rebuild) a budget version from data/<COMM>/budget-<year>.json, generated from the
 * budget workbook by data/<COMM>/gen-budget.py (docs/budget.md).
 *
 *   npm run import:budget -- <COMM> [year]          e.g. npm run import:budget -- Kralik 2026
 *
 * Idempotent: the version is deleted (lines + entries cascade) and recreated; the service
 * catalogue, programs and projects are upserted by code and the ones no longer in the file are
 * removed. Every line stores how its budget was obtained (`basis`), shown verbatim in the UI:
 *  - OPERATIONAL / TACTIC: the fiscal year's column of the workbook's Portofoliu, phased evenly
 *    over 12 months; actuals read live from the avizier when the line names expense types;
 *  - STRATEGIC: one line per contract / vendor of Contract-Factura (estimates, commitments,
 *    payments); the project budget and its yearly tranches come from Portofoliu.
 * Never writes ledger, charge or invoice rows.
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { BudgetService } from '../modules/budget/budget.service'

const prisma = new PrismaClient()
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const primary = (split: Array<{ code: string; weight: number }>) => [...split].sort((a, b) => b.weight - a.weight)[0]?.code ?? null

async function main() {
  const [comm, yearArg] = process.argv.slice(2)
  if (!comm) {
    console.log('Usage: npm run import:budget -- <COMM> [year]')
    process.exit(1)
  }
  const year = Number(yearArg ?? new Date().getFullYear())
  const dir = path.join(process.cwd(), 'data', comm)
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, `budget-${year}.json`), 'utf8'))
  const community = await prisma.community.findFirst({ where: { OR: [{ id: comm }, { code: comm }] } })
  if (!community) throw new Error(`Community ${comm} not found`)
  const communityId = community.id
  const svc = new BudgetService(prisma as any)
  const baselineYear: number = cfg.version.baselineYear ?? year - 1
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const source = cfg.source as string

  // ---- service catalogue ----
  const items = await prisma.serviceItem.findMany({ where: { communityId }, select: { id: true, domain: true, name: true, sortOrder: true } })
  for (const s of cfg.services) {
    let item = s.serviceItem ? items.find((i) => i.domain === s.serviceItem.domain && i.name === s.serviceItem.name) : null
    if (s.serviceItem && !item) {
      // Catalogue service missing: create it right after the last service of its domain (new
      // domains go at the end), then renumber so the order stays 0..n-1.
      const sameDomain = items.filter((i) => i.domain === s.serviceItem.domain)
      const after = sameDomain.length ? Math.max(...sameDomain.map((i) => i.sortOrder)) : Math.max(-1, ...items.map((i) => i.sortOrder))
      await prisma.serviceItem.updateMany({ where: { communityId, sortOrder: { gt: after } }, data: { sortOrder: { increment: 1 } } })
      item = await prisma.serviceItem.create({ data: { communityId, domain: s.serviceItem.domain, name: s.serviceItem.name, sortOrder: after + 1 }, select: { id: true, domain: true, name: true, sortOrder: true } }) as any
      for (const i of items) if (i.sortOrder > after) i.sortOrder++
      items.push(item as any)
      console.log(`  + catalogue service: ${s.serviceItem.domain} / ${s.serviceItem.name}`)
    }
    const data = { name: s.name, category: s.category, domain: s.domain, specCode: s.specCode ?? null, serviceItemId: item?.id ?? null, sortOrder: s.sortOrder }
    await prisma.budgetServiceDef.upsert({ where: { communityId_code: { communityId, code: s.code } }, update: data, create: { communityId, code: s.code, ...data } })
  }
  await prisma.budgetServiceDef.deleteMany({ where: { communityId, code: { notIn: cfg.services.map((s: any) => s.code) } } })

  // ---- version (rebuild) ----
  // Rates edited in the app (`manual`) survive a re-import.
  const prev = await prisma.budgetVersion.findFirst({ where: { communityId, code: cfg.version.code }, select: { fxRates: true } })
  const manual = Object.fromEntries(Object.entries((prev?.fxRates ?? {}) as Record<string, any>).filter(([, v]) => v?.manual))
  if (cfg.fxRates || Object.keys(manual).length) cfg.fxRates = { ...(cfg.fxRates ?? {}), ...manual }
  await prisma.budgetVersion.deleteMany({ where: { communityId, code: cfg.version.code } })
  const version = await prisma.budgetVersion.create({
    data: {
      communityId, code: cfg.version.code, name: cfg.version.name, fiscalYear: year, status: cfg.version.status ?? 'DRAFT',
      notes: cfg.version.notes ?? null, referenceDate: new Date(), fundPlan: cfg.funds, fxRates: cfg.fxRates ?? null,
    },
  })

  // ---- programs & projects ----
  const programId = new Map<string, string>()
  for (const p of cfg.programs) {
    const data = { name: p.name, dimension: p.dimension, sortOrder: p.sortOrder, objective: p.objective ?? null }
    const row = await prisma.budgetProgram.upsert({ where: { communityId_code: { communityId, code: p.code } }, update: data, create: { communityId, code: p.code, ...data } })
    programId.set(p.code, row.id)
  }
  const projectId = new Map<string, string>()
  for (const [i, p] of cfg.projects.entries()) {
    const data = {
      name: p.name, programId: programId.get(p.programCode) ?? null, sortOrder: i, scope: p.scope, fundCode: p.fundCode,
      voteYear: p.voteYear, durationYears: p.durationYears, budgetAmount: p.budgetAmount, budgetEur: p.budgetEur,
      yearPlan: p.yearPlan, serviceSplit: p.serviceSplit,
      source: { file: source, sheet: 'Portofoliu', row: p.sourceRow, fundLabel: p.fundLabel, serviceSplitNote: p.serviceSplitNote },
    }
    const row = await prisma.budgetProject.upsert({ where: { communityId_code: { communityId, code: p.code } }, update: data, create: { communityId, code: p.code, ...data } })
    projectId.set(p.code, row.id)
  }
  // Projects / programs no longer in the workbook (only if no other version still uses them).
  const stale = await prisma.budgetProject.findMany({ where: { communityId, code: { notIn: cfg.projects.map((p: any) => p.code) } }, select: { id: true, _count: { select: { lines: true } } } })
  await prisma.budgetProject.deleteMany({ where: { id: { in: stale.filter((p) => !p._count.lines).map((p) => p.id) } } })
  const staleProg = await prisma.budgetProgram.findMany({ where: { communityId, code: { notIn: cfg.programs.map((p: any) => p.code) } }, select: { id: true, _count: { select: { projects: true } } } })
  await prisma.budgetProgram.deleteMany({ where: { id: { in: staleProg.filter((p) => !p._count.projects).map((p) => p.id) } } })

  // ---- OPERATIONAL / TACTIC ----
  const charges = await svc.expenseCharges(communityId, 'EXPENSES')
  const programName = new Map<string, string>(cfg.programs.map((p: any) => [p.code, p.name]))
  let sort = 0
  for (const l of cfg.lines) {
    // Fund lines (e.g. Fond de rulment) are budgeted at the fund's own target in the app.
    const fund = l.budgetFromFundTarget ? await prisma.fund.findFirst({ where: { communityId, code: l.fundCode }, select: { name: true, totalTarget: true } }) : null
    if (l.budgetFromFundTarget) { l.annual = Number(fund?.totalTarget ?? 0); l.years = { [String(year)]: l.annual } }
    const annual = r2(l.annual ?? 0)
    const perMonth = r2(annual / 12)
    const phasing: Record<string, number> = {}
    months.forEach((m, i) => { phasing[m] = i < 11 ? perMonth : r2(annual - perMonth * 11) })
    const live = !!l.expenseTypes?.length || !!l.actualFund
    const srcCharges = l.actualFund ? await svc.expenseCharges(communityId, l.actualFund) : charges
    const baseline = live
      ? r2(srcCharges.filter((c) => (!l.expenseTypes?.length || l.expenseTypes.includes(c.expenseType)) && c.periodCode.startsWith(`${baselineYear}-`) && c.periodStatus === 'CLOSED').reduce((s, c) => s + c.amount, 0))
      : null
    const forecastMethod = l.forecastMethod ?? (live ? 'RUN_RATE' : 'BUDGET')
    const yearsTxt = Object.entries(l.years ?? {}).map(([y, v]) => `${y}: ${v}`).join(', ')
    await prisma.budgetLine.create({
      data: {
        versionId: version.id, communityId, code: l.code, dimension: l.dimension, maintenanceKind: l.maintenanceKind ?? null,
        serviceCode: primary(l.serviceSplit), serviceSplit: l.serviceSplit, area: programName.get(l.programCode) ?? l.program ?? null,
        name: l.name, fundCode: l.fundCode ?? null, costType: l.costType ?? null, quantity: 12, unitOfMeasure: 'lună', unitRate: perMonth,
        budgetAmount: annual, estimateAmount: annual, phasing, yearPlan: l.years ?? {},
        basis: {
          method: l.budgetFromFundTarget ? 'FUND_TARGET' : l.appOnly ? 'APP_ONLY' : 'PORTFOLIO_YEAR',
          formula: l.budgetFromFundTarget
            ? `Buget ${year} = ținta anuală a fondului „${fund?.name ?? l.fundCode}” din aplicație = ${annual} lei. Pe luni: ${annual} ÷ 12 = ${perMonth} lei/lună.`
            : l.appOnly
            ? `Linie fără buget în registru: păstrată pentru costul real facturat prin avizier (${l.expenseTypes.join(', ')}).`
            : `Buget ${year} = ${annual} lei (Portofoliu, coloana ${year}). Pe luni: ${annual} ÷ 12 = ${perMonth} lei/lună.`,
          inputs: [
            ...(l.scope ? [{ label: 'Scop', value: l.scope }] : []),
            ...(l.fundLabel ? [{ label: 'Fond (registru)', value: l.fundLabel }] : []),
            ...(yearsTxt ? [{ label: 'Portofoliu pe ani', value: yearsTxt }] : []),
            ...(baseline != null ? [{ label: `Cost real ${baselineYear} (avizier)`, value: baseline }] : []),
            ...(l.serviceSplitRaw ? [{ label: 'Proiect - Serviciu', value: Object.entries(l.serviceSplitRaw).map(([k, v]) => `${k} ${v}`).join(', ') }] : []),
          ],
          total: annual,
          forecastMethod,
          forecastFormula: forecastMethod === 'RUN_RATE'
            ? 'Forecast = Actual (luni închise) + luna în pregătire (ciornă) + lunile rămase × media ultimelor 3 luni închise.'
            : forecastMethod === 'NONE' ? 'Forecast = Actual (cost punctual, nu se repetă).' : 'Forecast = Actual + bugetul lunilor rămase.',
          source: l.sourceRow ? `${source}, foaia Portofoliu, rândul ${l.sourceRow}` : l.budgetFromFundTarget ? `Aplicație: fondul ${l.fundCode} (țintă), avizier: toate taxele pe fondul ${l.fundCode}` : null,
        },
        actualSource: live ? { type: 'EXPENSE_TYPES', fundCode: l.actualFund ?? 'EXPENSES', codes: l.expenseTypes ?? null } : undefined,
        status: annual > 0 || l.appOnly ? 'PROPOSED' : 'TO_CONFIRM',
        assumption: l.assumption ?? (annual > 0 ? null : `Fără sumă în Portofoliu pentru ${year} – de confirmat.`),
        sortOrder: sort++,
      },
    })
  }

  // ---- STRATEGIC: evidence lines from Contract-Factura ----
  for (const l of cfg.strategic) {
    const est = l.entries.filter((e: any) => e.kind === 'ESTIMATE')
    const budget = r2(est.filter((e: any) => e.inBaseline).reduce((s: number, e: any) => s + e.amount, 0))
    const estimate = r2(est.reduce((s: number, e: any) => s + e.amount, 0))
    const hasPay = l.entries.some((e: any) => e.kind === 'PAYMENT')
    const hasCom = l.entries.some((e: any) => e.kind === 'COMMITMENT')
    const outside = est.filter((e: any) => !e.inBaseline).map((e: any) => `${e.amount} (inclus în buget: ${e.baselineFlag ?? '—'})`)
    const inferred = l.entries.some((e: any) => e.fundInferred)
    await prisma.budgetLine.create({
      data: {
        versionId: version.id, communityId, code: l.code, dimension: 'STRATEGIC', serviceCode: primary(l.serviceSplit), serviceSplit: l.serviceSplit,
        area: l.area, name: l.name, projectId: projectId.get(l.projectCode) ?? null, fundCode: l.fundCode ?? null,
        vendorName: l.vendor, documentRef: l.document, budgetAmount: budget, estimateAmount: estimate,
        basis: {
          method: 'CONTRACT_REGISTER',
          formula: 'Buget = Σ „Bugetat” cu „Bugetat – inclus” = da / NA / personal. Estimare = Σ „Bugetat” (toate). Angajat = Σ „Datorat”. Actual = Σ „Plătit”. Forecast = max(Actual, Angajat, Estimare).',
          inputs: [
            { label: 'Categorie', value: l.category ?? '—' },
            { label: 'Buget (inclus)', value: budget },
            { label: 'Estimare totală', value: estimate },
            ...(outside.length ? [{ label: 'Estimări în afara bugetului', value: outside.join('; ') }] : []),
          ],
          source: `${source}, foaia Contract-Factura, rândurile ${[...new Set(l.entries.map((e: any) => e.sourceRow))].join(', ')}`,
        },
        status: hasPay ? 'IN_EXECUTION' : hasCom ? 'CONTRACTED' : budget > 0 ? 'APPROVED' : 'PROPOSED',
        assumption: inferred ? 'Unele plăți nu au fond în registru; s-a folosit fondul proiectului (Portofoliu).' : null,
        sortOrder: sort++,
        entries: {
          create: l.entries.map((e: any) => ({
            kind: e.kind, amount: e.amount, date: e.date ? new Date(e.date) : null, fundCode: e.fundCode ?? null,
            documentRef: e.documentRef ?? null, description: e.description ?? null,
            note: [e.note, e.fundInferred ? 'Fond preluat din proiect (lipsă în registru).' : null].filter(Boolean).join(' ') || null,
            inBaseline: e.kind === 'ESTIMATE' ? !!e.inBaseline : null, source: 'BUDGET_XLSX', sourceRow: e.sourceRow ?? null,
          })),
        },
      },
    })
  }

  const res: any = await svc.getBudget(communityId, cfg.version.code)
  console.log(`Version ${version.code}: ${res.lines.length} lines, ${cfg.services.length} services, ${cfg.projects.length} projects`)
  const a = res.annual
  console.log(`  ${year} (annual)  budget ${a.totals.budget}  actual ${a.totals.actual}  forecast ${a.totals.forecast}`)
  console.log(`  by service ${a.check.byService}  by fund ${a.check.byFund}  by purpose ${a.check.byPurpose}  by project ${a.check.byProject}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
