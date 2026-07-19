# Architecture — the domain model

The money model of the app: how a vendor bill becomes per-owner debt, how payments and
penalties move it, and which tables are the source of truth vs recomputed views. File
references are `prisma/schema.prisma` unless noted.

## Modules

Registered in `src/app.ts`. The money core is **BillingModule** (`src/modules/billing/*`),
**PeriodModule** (`src/modules/period/*`), **FundModule**, and **FinanceModule** (read-side
dashboards / avizier). `PrismaService` lives in `src/modules/user/prisma.service.ts`.

**Schema is push-style.** There is no `prisma/migrations/` folder — the schema drives the
DB via `prisma db push` (the deploy container runs it on start). ⚠️ `package.json` still
has stale `migrate` references (`prestart: prisma migrate deploy`, `dev:db: prisma migrate
dev`) — don't use those; use `npx prisma db push` (see [local-dev.md](./local-dev.md)).

## 1. Topology (who owes)

`Community` (tenant, holds config JSON: `features`, `paymentAllocation`, `measureModes`,
`penaltyGraceDays`) → `Unit` (apartment) → `BillingEntity` (the billed party; `displayName`
falls back to unit+owner).

Units map to billing entities and to unit groups through **temporal memberships**:
`BillingEntityMember` / `UnitGroupMember` carry a `[startSeq, endSeq]` period range (open
when `endPeriodId` is null). So ownership history is preserved and a BE can hold several
units. `BillingEntityUserRole` links a `User` to a BE with `OWNER` / `RESIDENT` /
`EXPENSE_RESPONSIBLE`.

Topology is imported from `data/<COMM>/def.json`: `src/importers/community/parse.ts`
(`parseCommunity`) → `apply.ts` (`applyCommunityPlan` upserts community, periods, groups,
rules, expense types, units, memberships). Entry: `npm run import:community`.

## 2. Periods (the monthly cycle)

`Period` with status `DRAFT → OPEN → PREPARED → CLOSED` (`PeriodService`,
`src/modules/period/period.service.ts`):

- **`createNext()`** — opens the next OPEN period.
- **`prepare()`** OPEN→PREPARED — in one transaction: reapply payments, run allocations,
  penalty `advance`, `applyChargeOverrides`, `computeStatements`. Guards: period must have
  ended and templates/meters/bills be closed.
- **`approve()`** PREPARED→CLOSED — re-derives overrides, commits penalty buckets.
- **`reject()`** PREPARED→OPEN; **`reopen()`** CLOSED→OPEN (blocked if a *later* period is
  CLOSED; undoes the `CLOSE_*` ledger legs and reverts the penalty-bucket advance).

Two per-period fields matter for Kralik (see [kralik.md](./kralik.md)):
- **`afisareDate`** — the vendor posting/display date. Penalties accrue over the
  **afisare-to-afisare window** (`prev.afisareDate+1 .. afisareDate`), not the calendar
  month; falls back to start/end dates when null.
- **`waterDifferenceMethod`** — `PROPORTIONAL` (default) or `APA_DIF`; how the cold-water
  building/sub-meter difference is split.

## 3. Funds (money buckets)

`Fund` = a per-community money pot (`EXPENSES`, the `PENALIZARI` penalty earmark, reserve /
repair funds). Allocation config lives in the **`Fund.allocation` JSON** (no dedicated
columns): a `method` (`EQUAL`, `BY_SQM`, `BY_RESIDENTS`, `BY_CONSUMPTION`, plus app-level
rule codes like `BY_CPI` that aren't Prisma enum members) plus, for penalty sources,
`penaltyPerDayPct` (daily rate; presence marks the fund as penalizable, rate may be 0) and
`penaltyFundCode` (where accrued penalty posts, default `PENALIZARI`). `FundService`.

## 4. Charges & allocation (splitting a bill)

`AllocationService` (`src/modules/billing/allocation.service.ts`, entry `createExpense()`)
takes a vendor/expense amount + a `splits[]` tree (or `ExpenseType.params.splitTemplate`),
resolves the target fund, and recursively allocates leaves. Each leaf's method maps to a
per-unit measure over the period (`BY_RESIDENTS→RESIDENTS`, `BY_SQM→SQM`,
`BY_CONSUMPTION→`meter reading); explicit weights are supported.

It writes one **`CommunityCharge`** (period-level, with `fundId`, `amount`,
`allocationStrategy`, `allocationSnapshot`) + N **`CommunityChargeLine`** rows (the
per-`(BE, Unit)` split). Each line's `allocationSnapshot` records `{ method, expenseType,
splitNodeId, base, unitMeasure, totalMeasure, ... }`.

`allocationSnapshot.expenseType` is the **column key the avizier groups by** — it's stamped
at allocation time and survives later rule/expense-type edits. (This is why the apa-dif
difference needs a separate `splitNodeId`-based column — see [kralik.md](./kralik.md).)

`ExpenseType` (named category → `AllocationRule`), `AllocationRule` (reusable method+params),
and `SplitGroup`/`SplitGroupMember` (named node sets as split bases) round out the config.

## 5. Statements & ledger (the money truth)

Two tiers: an **append-only ledger** (truth) and **recomputed statement snapshots** (views).

**Ledger (durable):**
- `BeLedgerEntry` (+ `BeLedgerEntryDetail` per `(unit, fund)`) — per-BE rows, `kind`
  CHARGE/PAYMENT/ADJUSTMENT, `lane` ACCRUAL/CASH, `refType` (e.g. `CLOSE_PREP`,
  `CLOSE_FINAL`, the `CHG_OVR_*` override legs).
- `CommunityLedgerEntry` / `FundLedgerEntry` (+ details) — community-wide and per-fund.
- `BeOpeningBalance` — migrated/opening arrears per `(period, BE, fund, unit, kind,
  originKey)`, `kind` PRINCIPAL vs penalty.

**Statements (recomputed each prepare/approve):**
- `BeStatement` — per `(BE, period, fund)`: `dueStart, charges, payments, adjustments,
  dueEnd`. `CommunityStatement` is the community rollup.

**The dueEnd → dueStart chain** (`computeStatements`):
```
dueStart = previousClosedPeriod.dueEnd  ?? openingAmount ?? 0
dueEnd   = dueStart + charges − payments + adjustments
```
"Previous" is read live as the most recent **CLOSED** period's `dueEnd`, so reopening/
recomputing an earlier period reflows forward.

**Durable vs recomputed** — important when debugging: `BeLedgerEntry`/detail, `Payment`/
`PaymentApplication`, `PenaltyBucket*`, `ChargeOverride`, `CommunityCharge*` are **durable
truth**. `BeStatement`, `CommunityStatement`, and `runningDue` are **deleted and re-derived
every prepare/approve** — never edit a statement directly; change the ledger and recompute.

## 6. Payments

`Payment` (a received payment from a BE) → `PaymentApplication` (links it to specific
`BeLedgerEntry` charges). When there's no explicit `allocationSpec`, `PaymentService`
spreads it across open charges using a per-community strategy
(`src/modules/billing/payment-allocation.ts`, stored in `Community.paymentAllocation`):

- **`FIFO`** — oldest charge first (default).
- **`LEGAL_PER_PERIOD`** — oldest period first; penalties before principal within a period
  (Cod civil art. 1509).
- **`LEGAL_PENALTIES_FIRST`** — all penalties (oldest-first) before any principal.
- **`FUND_PRIORITY`** — a configured `fundOrder[]`, oldest-first within a fund.

`CashTx` is the **cash book** (per `(account, fund)` movements, IN/OUT), separate from the
accrual ledger; `CashAccount` types BANK/PETTY. `CashService`.

## 7. Penalty aging

`PenaltyBucket` (one durable bucket per penalizable due — a period charge or a migrated
PRINCIPAL opening; per-unit, source `fundId` → `targetFundId` earmark) + `PenaltyBucketPeriod`
(one frozen/committed row per period the bucket is advanced). `PenaltyLedgerService`
(`src/modules/period/penalty-ledger.service.ts`).

Aging is a **path-dependent accrual** — each period advances a bucket from its last
committed state, never re-derived from aggregates. Key fields: `principalOriginal` (cap —
penalty ≤ principal), `seedPenaltyAccrued` (penalty carried at cutover; accrual baseline),
`ratePerDayPct` (rate stamped at creation, else the fund's current rate), `firstPenalDay`
(`dueDate + graceDays + 1`).

Flow: `ensureBuckets()` (create/update for the period's charges) → `advance()` (accrue over
the period's day window, post penalty `CommunityCharge`s, write PROVISIONAL
`PenaltyBucketPeriod`) → `commitPeriod()` at approve (→ COMMITTED) / `revertPeriod()` at
reopen. `seedFromOpenings()` migrates legacy arrears into buckets with a COMMITTED cutover
row.

## 8. Charge overrides

`ChargeOverride` — append-only audit log of an admin overriding a computed fund charge for
a `(community, period, BE, fund)`; latest row wins, `overrideAmount = null` clears it.
Built for penalties but generic. Realized as **two ADJUSTMENT `BeLedgerEntry` legs**
(−computed, +override) so the net survives statement recompute, and **re-derived on every
prepare/approve** (`period.service.applyChargeOverrides`) so it's durable across re-prepare.
Never edit the statement — write/adjust the override. Entry point: `overrideCharge()`
(blocked on CLOSED periods).

## 9. The avizier (the per-owner grid)

`finance.service.ts avizier()` (FinanceModule) builds the period's billing grid. Returns
`{ period, categories, categoryLabels, groups, penaltyFunds, rows, totals }`:

- **categories/columns** — distinct expense categories from `CommunityCharge` (via
  `allocationSnapshot.expenseType` / `source_key`), ordered services → funds → penalties.
- **categoryLabels** — code→label built from the community's `ExpenseType.name` + `Fund.name`
  (plus the display-only `APA_DIF` label). The frontend renders these; it does **not**
  hardcode column labels (see [frontend-conventions.md](./frontend-conventions.md)).
- **groups** — categories mapped to their owning fund group (services→EXPENSES,
  contributions→own fund, penalties→PENALIZARI).
- **penalties** — from the aging ledger per `(BE, source fund)`: this-period (month) and
  cumulative (total). Manual penalty overrides (§8) are folded **into** the penalty figure
  and **out of** the adjustments column so they aren't double-counted.
- **sold/debt** — `soldPrecedent` = `BeStatement.dueStart`; `dueEnd` = closing debt.

Drilldown endpoints (finance controller): `avizier/explain` (per-cell formula),
`explain-sold`, `payments`, `adjustments`, `explain-penalty` (per-bucket), and the override
UI (`POST`/`GET avizier/charge-override`).
