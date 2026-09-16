/**
 * Compares live DB state to data/<COMM>/def.json — read-only, no writes, no --fix.
 *
 *   npx ts-node --transpile-only src/scripts/verify-def-consistency.ts        # COMM=Kralik, PERIODS=2026-05,2026-06
 *   COMM=X PERIODS=2026-01,2026-02 npx ts-node --transpile-only src/scripts/verify-def-consistency.ts
 *
 * This repo has no jest setup, so this script is the test — see verify-collection-rate.ts
 * for the same house style. Exits non-zero if any check fails.
 *
 * Two cautions, learned the hard way earlier in the session this script came out of:
 *
 * 1. `PeriodService.recomputeAllocations()` (src/modules/period/period.service.ts) is a
 *    no-op stub for EXPENSE charge lines whenever CommunityCharge rows already exist for
 *    the period — only the FUND-contribution branch inside postChargesForStage() does a
 *    fresh, period-seq-scoped billing-entity lookup on every prepare(). So a CHARGE_LINES_*
 *    finding below can be "real" drift that a subsequent prepare() won't fix on its own.
 *
 * 2. Do NOT "fix" a BE_MISMATCH by just re-running `npm run import:community`. The
 *    importer's own overlap-detection (src/importers/community/apply.ts) only checks for
 *    overlap among rows belonging to the SAME billing entity — never whether a DIFFERENT
 *    entity already holds an open-ended row for the same unit. Re-importing can create a
 *    second, overlapping row on top of the stale one instead of closing the stale one out.
 */
import fs from 'fs'
import path from 'path'
import { PrismaService } from '../modules/user/prisma.service'

const COMM = process.env.COMM || 'Kralik'
const PERIODS = (process.env.PERIODS || '2026-05,2026-06').split(',').map((s) => s.trim()).filter(Boolean)

const seqOf = (code: string): number => {
  const [y, m] = code.split('-').map(Number)
  return y * 12 + m
}

type BeRow = { beCode: string; startSeq: number; endSeq: number | null }

async function main() {
  const prisma = new PrismaService()
  let failures = 0
  let warnings = 0
  const fail = (period: string, unit: string, kind: string, detail: Record<string, any>) => {
    console.log(`FAIL  ${kind.padEnd(28)} ${period.padEnd(9)} ${unit}  ${JSON.stringify(detail)}`)
    failures++
  }
  const warn = (msg: string) => {
    console.log(`WARN  ${msg}`)
    warnings++
  }
  const pass = (msg: string) => console.log(`PASS  ${msg}`)

  console.log(`=== verify-def-consistency: ${COMM} ===`)

  const defPath = path.join(process.cwd(), 'data', COMM, 'def.json')
  if (!fs.existsSync(defPath)) throw new Error(`def.json not found at ${defPath}`)
  const def: any = JSON.parse(fs.readFileSync(defPath, 'utf8'))
  const structure: any[] = def.structure ?? []
  const defGroups: Set<string> = new Set((def.groups ?? []).map((g: any) => g.code))
  if (!structure.length) throw new Error('def.json structure[] is empty — nothing to check')
  console.log(`def.json period snapshot: ${def.period?.code ?? '?'} (${structure.length} structure rows)`)

  // Precondition checks (once, informational — WARN not FAIL)
  for (const row of structure) {
    if (!row.billingEntity) warn(`structure[${row.code}] has no billingEntity`)
    for (const g of row.groupCodes ?? []) {
      if (!defGroups.has(g)) warn(`structure[${row.code}] references unknown group code "${g}"`)
    }
  }

  const community = await prisma.community.findUnique({ where: { id: COMM } })
  if (!community) throw new Error(`community ${COMM} not found in DB`)

  const periodRows = await prisma.period.findMany({
    where: { communityId: COMM, code: { in: PERIODS } },
    select: { code: true, id: true, seq: true },
  })
  for (const code of PERIODS) {
    const p = periodRows.find((p) => p.code === code)
    if (!p) { warn(`period ${code} not found in DB — skipping`); continue }
    if (seqOf(code) !== p.seq) warn(`seqOf(${code})=${seqOf(code)} but DB Period.seq=${p.seq} — the seq formula may have drifted from apply.ts`)
  }

  const units = await prisma.unit.findMany({ where: { communityId: COMM }, select: { code: true } })
  const dbCodes = new Set(units.map((u) => u.code))
  const defCodes = new Set(structure.map((r) => r.code))

  console.log('\n--- unit existence (WARN only) ---')
  const dbOnly = [...dbCodes].filter((c) => !defCodes.has(c))
  const defOnly = [...defCodes].filter((c) => !dbCodes.has(c))
  if (dbOnly.length) warn(`${dbOnly.length} units in DB have no def.json entry: ${dbOnly.join(', ')}`)
  else pass('no DB units missing from def.json')
  if (defOnly.length) warn(`${defOnly.length} def.json units missing from DB: ${defOnly.join(', ')}`)
  else pass('no def.json units missing from DB')

  const beMembers = await prisma.billingEntityMember.findMany({
    where: { billingEntity: { communityId: COMM } },
    select: { startSeq: true, endSeq: true, unit: { select: { code: true } }, billingEntity: { select: { code: true } } },
  })
  const groupMembers = await prisma.unitGroupMember.findMany({
    where: { group: { communityId: COMM } },
    select: { startSeq: true, endSeq: true, unit: { select: { code: true } }, group: { select: { code: true } } },
  })

  const resolveBE = (unitCode: string, seq: number): BeRow[] =>
    beMembers
      .filter((m) => m.unit.code === unitCode && m.startSeq <= seq && (m.endSeq === null || m.endSeq >= seq))
      .map((m) => ({ beCode: m.billingEntity.code, startSeq: m.startSeq, endSeq: m.endSeq }))

  const resolveGroups = (unitCode: string, seq: number): string[] =>
    groupMembers
      .filter((m) => m.unit.code === unitCode && m.startSeq <= seq && (m.endSeq === null || m.endSeq >= seq))
      .map((m) => m.group.code)

  const defBEForPeriod = (row: any, seq: number): string | null => {
    const start = row.startPeriod ? seqOf(row.startPeriod) : -Infinity
    const end = row.endPeriod ? seqOf(row.endPeriod) : Infinity
    return seq >= start && seq <= end ? row.billingEntity ?? null : null
  }

  for (const code of PERIODS) {
    const p = periodRows.find((p) => p.code === code)
    if (!p) continue
    const seq = p.seq
    console.log(`\n--- ${code} (seq ${seq}) ---`)

    const chargeLines = await prisma.communityChargeLine.findMany({
      where: { communityId: COMM, periodId: p.id },
      select: { unit: { select: { code: true } }, billingEntity: { select: { code: true } } },
    })

    let beFails = 0
    let chargeFails = 0
    let groupFails = 0

    for (const row of structure) {
      const defBE = defBEForPeriod(row, seq)
      if (defBE !== null) {
        const dbMatches = resolveBE(row.code, seq)
        if (dbMatches.length === 0) {
          fail(code, row.code, 'NO_DB_MEMBERSHIP', { def: defBE })
          beFails++
        } else if (dbMatches.length > 1) {
          fail(code, row.code, 'MULTIPLE_DB_MEMBERSHIPS', { def: defBE, db: dbMatches })
          beFails++
        } else if (dbMatches[0].beCode !== defBE) {
          fail(code, row.code, 'BE_MISMATCH', { def: defBE, db: dbMatches[0].beCode, dbRange: [dbMatches[0].startSeq, dbMatches[0].endSeq] })
          beFails++
        }

        // Materialized-charge cross-check: what was actually posted vs. what
        // billing_entity_member resolves to for this unit+period, independent of def.json.
        const linesForUnit = chargeLines.filter((l) => l.unit.code === row.code)
        const beCodesSeen = new Set(linesForUnit.map((l) => l.billingEntity.code))
        if (beCodesSeen.size > 1) {
          fail(code, row.code, 'CHARGE_LINES_SPLIT_ACROSS_BE', { beCodesSeen: [...beCodesSeen] })
          chargeFails++
        } else if (beCodesSeen.size === 1 && dbMatches.length === 1 && [...beCodesSeen][0] !== dbMatches[0].beCode) {
          fail(code, row.code, 'CHARGE_LINES_DISAGREE_WITH_BEM', { chargeLineBE: [...beCodesSeen][0], bemBE: dbMatches[0].beCode })
          chargeFails++
        }
      }

      const defGroupCodes = new Set<string>(row.groupCodes ?? [])
      const dbGroupCodes = new Set(resolveGroups(row.code, seq))
      const missingInDb = [...defGroupCodes].filter((g) => !dbGroupCodes.has(g))
      // "extra in DB" is WARN, not FAIL: e.g. Kralik's DB carries ad-hoc PHYS_GR_* groups
      // (one per unit) that appear nowhere in def.json's own groups[] vocabulary at all —
      // not authored by def.json, so not something def.json can be "out of sync" about.
      const extraInDb = [...dbGroupCodes].filter((g) => !defGroupCodes.has(g))
      if (missingInDb.length) {
        fail(code, row.code, 'GROUP_MISMATCH', { missingInDb })
        groupFails++
      }
      if (extraInDb.length) warn(`${code} ${row.code}: DB has group(s) not in def.json: ${extraInDb.join(', ')}`)
    }

    if (beFails === 0) pass('billing-entity assignment matches def.json for all units')
    if (chargeFails === 0) pass('charge-line billing-entity matches billing_entity_member for all units')
    if (groupFails === 0) pass('group membership matches def.json for all units')
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}${warnings ? ` (${warnings} WARN — informational, not counted)` : ''}`)
  await (prisma as any).$disconnect()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
