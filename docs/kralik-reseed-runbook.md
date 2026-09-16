# Kralik reseed runbook

A single, linear checklist for wiping and rebuilding Kralik (def.json + May 2026-05 + June
2026-06) so the result matches what this repo's data currently produces. Written for an agent
with no prior context on this — follow it top to bottom. Background/rationale for each step
lives in [`docs/data-reseed.md`](./data-reseed.md); this file is the runnable checklist.

**Kralik is a real, live HOA (`data/Kralik/`) — private data, real money.** Take a DB backup
before touching anything (step 0). Never run any of this against prod without the user's
explicit go-ahead; this runbook assumes a local dev DB.

## 0. Backup first

```bash
mkdir -p backups
docker exec -e PGPASSWORD=postgres property-db pg_dump -h localhost -U postgres -d property_expenses -F c -f /tmp/kralik-backup.dump
docker cp property-db:/tmp/kralik-backup.dump backups/property_expenses_$(date +%Y%m%d-%H%M%S).dump
docker exec property-db rm /tmp/kralik-backup.dump
```

`backups/` is gitignored — dumps are never committed. To restore:
`docker exec -i property-db pg_restore -h localhost -U postgres -d property_expenses --clean --if-exists < backups/<file>.dump`

## 1. Full fresh reseed (def.json → April/May → June)

This is the path to use for a genuine from-scratch rebuild (e.g. mirroring prod before a
deploy). It wipes the **entire** Kralik community — periods, charges, payments, corrections,
everything — and rebuilds in order, because June's numbers chain from May's `dueEnd`, and
May chains from April's.

```bash
bash scripts/rebuild-kralik-nobridge.sh
```

This one script does all of the following (see the script itself for the exact commands):
wipe the community (incl. invoices/vendors) → import community structure + funds + bill
templates + meter templates from `data/Kralik/` (this is where `def.json`'s `accounts[]`,
`billingEntities[].displayNames[]`, and `structure[]` all get applied) → inject history
2021-11..2026-04 from the export → compute May 2026-05 from `actuals-2026-05.json` (engine,
chained on injected April) → import the historical cash register → register declared
corrections → prune stale meters → backfill the raw meter-reading layer.

At the end, May is **CLOSED**. April is CLOSED. Everything before is historical/injected.

### 1a. June, on top

Not yet folded into the script above — a separate, self-contained step:

```bash
npx ts-node --transpile-only src/scripts/seed-kralik-june-complete.ts
npm run backfill:meter-readings -- Kralik
```

Builds entirely from `data/Kralik/actuals-2026-06.json` + `data/Kralik/cash-2026-06.json`
(both self-sufficient). Requires May already CLOSED (checked internally, throws otherwise).
Submits all bill-template items, imports the full cash register (159 `CashTx` rows / 54
`Payment` rows as of this writing, across the `BANK`, `CASH`, and `BANK_LIBRA_EUR` accounts —
all three must exist, see the EUR-account gotcha below), backfills invoice dates, closes the
templates, calls `PeriodService.prepare()`. Leaves June **PREPARED**, not approved — matches
the current dev DB. The `backfill:meter-readings` re-run afterward is required (community-
wide, not period-scoped) because June adds new `PeriodMeasure` rows.

### 1b. Post-rebuild corrections (do not skip — neither is sourced from def.json/JSON)

```bash
npx ts-node --transpile-only src/scripts/fix-kralik-penalizari-mai.ts
npx ts-node --transpile-only src/scripts/add-kralik-fund-reattributions.ts
```

- `fix-kralik-penalizari-mai.ts` restores two May PENALIZARI charges dropped by the April
  historical injection (Matei Viorel 9.42 RON, Macri Nicodemo/Francesco/Antonio 3.70 RON) as
  real `community_charge` rows (so they show in Avizier's Curente column, not just as an
  invisible adjustment). Reopens May itself, posts the charge, re-prepares + approves May,
  then re-prepares June so `dueStart` chains from May's corrected `dueEnd`. Idempotent — safe
  to run even if already applied (it checks and skips).
- `add-kralik-fund-reattributions.ts` declares 6 `PAYMENT_REATTRIB` corrections (real
  double-entry fund-to-fund transfers) resolving credits stuck on the wrong fund for three
  billing entities: Fikl Emil (2×, → Reabilitare 3), Brînzeu Adina/SAD 2/2 (2×, → Reabilitare
  2 + Rulment), Macri Nicodemo/Francesco/Antonio (2×, → Reabilitare 2, mirroring two real
  Registru Bancă cont EUR entries, unit-tagged). See the script's own header comment for the
  reasoning behind each transfer. Idempotent — attaches to `currentPeriod()` (June, since it's
  the latest OPEN/PREPARED period at this point) and skips any transfer already ACTIVE.

### 1c. Per-unit statements (BeUnitStatement) — real payments/restanțe/penalties by unit

Avizier's "Unitatea"/"Grup Unități" modes show real per-unit figures (not just 0+🔗 badge) once
`BeUnitStatement` exists — see [`docs/architecture.md`](./architecture.md) if that doc gets a
section on it, otherwise `finance.service.ts`'s `avizier()` and `period.service.ts`'s
`computeUnitStatements()` are the source of truth. Two steps, both idempotent, run once after
May is CLOSED and once more after June's first prepare:

```bash
npx ts-node --transpile-only src/scripts/seed-kralik-april-unit-statements.ts
npx ts-node --transpile-only src/scripts/retag-kralik-eur-unit-payments.ts
```

- `seed-kralik-april-unit-statements.ts` bootstraps April 2026-04's real per-unit
  opening/charges/closing directly from `data/Kralik/ledger-2026-04.json`'s `byUnit` map — no
  estimation, this file already has a genuine per-unit split (confirmed for Macri, Brînzeu, and
  Primărie TM UAT's units individually). This becomes May's real per-unit `dueStart` once May is
  (re)prepared.
- `retag-kralik-eur-unit-payments.ts` tags the two Ap 11 / Ap 11A cash-register payments
  (n=83/85) with their real `unitId` — `seed-kralik-june-complete.ts`'s generic allocationSpec
  builder has no unit concept, so these land untagged otherwise.
- Run order matters: bootstrap April → reopen+prepare May → reopen+prepare June →
  `add-kralik-fund-reattributions.ts` (1b, now unit-tags Macri's two corrections too) →
  `retag-kralik-eur-unit-payments.ts` → reopen+prepare June once more so
  `computeUnitStatements()` picks up both tags in the same pass. `PeriodService.prepare()` calls
  `computeUnitStatements()` automatically as part of `computeStatements()` — no separate command
  needed once the ledger detail rows carry the right `unitId`s.
- Only a per-unit split verified to sum back exactly to the billing entity's own `BeStatement`
  total gets shown (`splitTrustedForBe` in `finance.service.ts`) — a partial/incomplete tagging
  effort falls back to 0+badge on every one of that entity's units rather than showing numbers
  that look real but understate what's actually been paid.
- `retag-kralik-brinzeu-unit-payments.ts`: Brînzeu Adina's (SAD 1 + SAD 2/2) 8 June-cycle cash-
  register payments already carry a real `providerMeta.unitLabel` in the source register — this
  tags each one's `allocationSpec` lines with the matching `unitId`, resolved from that label
  (no estimation). Run after `seed-kralik-june-complete.ts`. Also re-run
  `add-kralik-fund-reattributions.ts` afterward — Brînzeu's two `PAYMENT_REATTRIB` corrections
  there are unit-tagged too (SAD 2/2, confirmed against the real Registru Bancă reconciliation
  entry n=54/ref FT26219H7R2L, memo "SAD 2/2 reconciliere fonduri" — **not** SAD 1, even though
  SAD 1 is the unit that paid the source transaction; the register explicitly separates the two
  ADJUSTMENT reconciliation legs from the PAYMENT itself, same as it does for Macri's), but only
  take effect on a fresh `create()` call, so if they were declared before this script ran, void
  the two existing ones first (the script itself is idempotent and skips already-ACTIVE
  untagged ones otherwise).
- `retag-kralik-primarie-unit-payments.ts`: Primărie TM UAT's (Ap 12 SAD 4/A, 4/B, 4/C) one real
  June-cycle payment (52.00 RON, unitLabel "12 (SAD4/C)") also needs this — **without** the
  unitId tag, `applyPaymentWithSpec`'s charge matching isn't unit-restricted and silently
  settles whichever of the three units' open EXPENSES charge it finds first (observed: SAD 4/A's,
  not SAD 4/C's) — the fix is the same shape as the two scripts above.
- Note: `splitTrustedForBe`'s sum-check tolerance is `0.015`, and it accumulates the raw
  (unrounded) per-unit total before rounding once — a naive per-row `round2()` accumulation can
  land a genuinely-matching ~140k RON sum exactly on a `0.01` boundary and fail a strict `<`
  purely from floating-point noise (observed for Primărie's 3-unit, 6-fund total). Already fixed
  in `finance.service.ts`; noted here in case a similar-shaped BE trips it again.

### 1d. Ownership-transfer debt carryover (Ap 2/2: Gampe Francisc → Valean Mirela)

```bash
npx ts-node --transpile-only src/scripts/transfer-kralik-ap22-ownership.ts
```

Ap 2/2 changed billing entity in June (`def.json`'s versioned `structure[]` split). Without
this step, Gampe Francisc's real May closing balance sits frozen on his now-orphaned billing
entity forever (unpayable — no new charges post to it, nothing settles it), while Valean
Mirela's real payments toward that inherited debt (2026-08-05, refs CHHF370/CHHF371) show up as
a phantom credit on her own ledger instead. The script declares an `OWNERSHIP_TRANSFER`
correction (see `CorrectionType` in `prisma/schema.prisma`,
`PeriodService.deriveCorrectionLegs()`) settling Gampe's balance to 0 via a real PAYMENT leg,
plus a `BeOpeningBalance` row per fund for Valean's first period (June — her billing entity has
no prior period to chain `dueStart` from otherwise). Idempotent. Requires a June reopen→prepare
afterward (same as 1b/1c) for `computeStatements()` to pick up the new opening balance. Avizier
then shows Valean's row with a small "↩" badge/tooltip naming Gampe and the inherited amount
(`FinanceService.avizier()`'s `inheritedFrom` field) — Gampe's own row disappears from Avizier
entirely once his net restanța (due_start − payments) reads 0.

Requires `def.json`'s `BE_VALEAN_MIRELA` entry to have `"order": 4` (same slot as Gampe's,
since it's the same physical unit) — a stale higher `order` value makes Ap 2/2 sort to the
bottom of Avizier instead of its natural position next to Ap 2/1.

## 2. Verify

```bash
COMM=Kralik PERIODS=2026-05,2026-06 npx ts-node --transpile-only src/scripts/verify-def-consistency.ts
```

Read-only diagnostic comparing live DB (billing-entity-to-unit assignment, group membership,
what actually posted to `community_charge_line`) against `def.json`. Expect `ALL CHECKS
PASSED` with exactly 5 WARN lines (unit `400191-C1-U19-AP 2/2` carries service groups in the
DB that def.json doesn't list explicitly — known, harmless, pre-existing).

Known-good totals as of this writing (cross-check against these after a fresh reseed):

| Period | opening | charges | payments | due_end (debt) | be_statement rows |
|---|---|---|---|---|---|
| 2026-05 | 679,536.33 | 117,373.46 | 0.00 | 796,909.79 | 183 |
| 2026-06 | 796,909.79 | 117,295.60 | 140,292.88 | 773,912.51 | 187 |

```sql
select round(sum(due_end),2) debt, round(sum(due_start),2) opening, round(sum(charges),2) charges, round(sum(payments),2) payments, count(*) rows
from be_statement bs join period p on p.id=bs.period_id
where p.code='<2026-05 or 2026-06>' and bs.community_id='Kralik';
```

Also spot-check the 6 fund-reattribution targets land at due_end 0.00 on the "from" fund:

```sql
select be.name, f.code, bs.due_end from be_statement bs
join period p on p.id=bs.period_id join fund f on f.id=bs.fund_id join billing_entity be on be.id=bs.billing_entity_id
where p.code='2026-06'
  and be.name in ('Fikl Emil','Brînzeu Adina','Macri Nicodemo, Macri Francesco, Macri Antonio')
  and f.code in ('EXPENSES','RULMENT','REABILITARE_1','REABILITARE_2','REABILITARE_3')
order by be.name, f.code;
```

Fikl's EXPENSES/RULMENT and both Macri's/Brînzeu's REABILITARE_1 should read 0.00 (or a
few-cent rounding residual).

## Known gotchas (all already fixed in this repo — listed so a fresh checkout is understood, not re-broken)

- **`BANK_LIBRA_EUR` cash account** — `def.json`'s `accounts[]` must include it (currency
  EUR). Its absence silently drops 6 real transactions from `cash-2026-06.json` (Catargiu Ap
  4A, Macri Ap 11/11A ×2 reconciliations, Florea Ap 6) — `seed-kralik-june-complete.ts` logs a
  `⚠ no account BANK_EUR` warning and skips the whole tx (both the `CashTx` and the
  `Payment`) rather than erroring, so it is easy to miss in the script's output.
- **`ExpenseType.params.fundCode`** — both `seed-kralik-april-may.ts` and
  `seed-kralik-june-complete.ts` patch this (idempotently, `if (!p.fundCode) update(...)`) at
  their own start. If you ever extract just a piece of either script (e.g. to rebuild one
  period in isolation, see below), keep this patch — without it, `saveBillTemplateState` fails
  per-template with "Expense type X missing fundCode", silently zeroing that template's
  charges instead of erroring loudly.
- **`reopen()` and PAYMENT-kind ledger entries** — fixed in `period.service.ts` (commit
  `255b80b`). Before the fix, `reopen()` cleaned `CHARGE`/`PENALTY_*` ledger artifacts for a
  period but never `PAYMENT`-kind ones. `reapplyForPeriod()`'s own stale-entry sweep only
  catches a `Payment` row that still exists but lost cycleCode eligibility — if a `Payment`
  row is deleted and recreated with a new id (exactly what `seed-kralik-june-complete.ts` does
  on every run: `payment.deleteMany` + fresh `payment.create`), the old ledger entries become
  orphaned and double-count on the next `prepare()`. If you are running against a repo
  checkout from before that commit, either update first or manually verify
  `be_statement.payments` after any reopen+rebuild cycle (compare against the table in
  section 2 above — an exact 2× multiple of the expected total is this bug).
- **`seed-kralik-april-may.ts` is not safe to re-run in isolation** — it re-patches April's
  `beStatement` on every invocation (the `SKIP_APRIL` branch), and that patch is not
  idempotent for funds flagged in `history-mapping.json`'s `shareReallocations.funds`
  (`extraCharge` accumulates on top of the already-patched `charges` value on a second run).
  Only run it as part of the full pipeline (section 1), where April is touched exactly once.

## Rebuilding just May or just June (validation only, not a real reseed)

Useful for proving reproducibility (e.g. before a prod deploy) without wiping the whole
community. Real prod reseeds always go through section 1 in full — there is no supported
partial-community wipe.

**May only** — safe because `PeriodService.reopen()` on May does not require June to be
reopened first (its guard only blocks when a *later* period is CLOSED; June PREPARED is
fine):

1. Capture baseline totals (the SQL query in section 2) for comparison.
2. `npm run reopen:period -- Kralik 2026-05` — clears May's `be_statement`, `CHARGE`/
   `PAYMENT`-kind ledger entries, and the two penalty `community_charge` rows.
3. Re-run **only** the "compute May" logic (the code after the `SKIP_APRIL` branch in
   `seed-kralik-april-may.ts`, roughly lines 301-349: upsert the period's dates, upsert
   `PeriodMeasure` rows from `actuals-2026-05.json`, submit bill templates, close template
   instances, `prepare()` + `approve()`). Copy this into a throwaway script rather than
   re-running the whole file (see the gotcha above) — do **not** touch April.
4. `npx ts-node --transpile-only src/scripts/fix-kralik-penalizari-mai.ts` (idempotent; re-adds
   the 2 penalty charges reopen() just cleared).
5. Reject + re-prepare June so it re-chains from May's new `dueEnd`:
   `npm run reopen:period -- Kralik 2026-06 && npx ts-node --transpile-only src/scripts/add-kralik-fund-reattributions.ts`
   — the reopen re-derives June cleanly (charges/payments from what's already there); the
   reattributions script re-declares the 6 corrections (idempotent, skips if already ACTIVE)
   — but June's own charges/cash need re-deriving too, so really just do the full June
   rebuild (section 1a) again on top rather than a bare reopen.
6. Compare totals against the baseline from step 1; run `verify-def-consistency.ts`.

**June only:**

1. Capture baseline totals for June (and, if you want a full check, the per-fund due_end for
   Fikl/Brînzeu/Macri from section 2's second query).
2. `npm run reopen:period -- Kralik 2026-06`
3. `npx ts-node --transpile-only src/scripts/seed-kralik-june-complete.ts` (section 1a)
4. `npm run backfill:meter-readings -- Kralik`
5. `npx ts-node --transpile-only src/scripts/add-kralik-fund-reattributions.ts` (idempotent —
   the 6 corrections' underlying rows already exist from before; this just confirms and, if
   somehow missing, recreates them)
6. Compare totals against the baseline; run `verify-def-consistency.ts`.

Both of these were run end-to-end against this repo's dev DB and reproduced totals identical
to the pre-wipe baseline (see section 2's table) once the `reopen()` PAYMENT-entry fix was in
place.
