# Wiping & reseeding a community

How to flush one community's data and rebuild it from its committed source under
`data/<COMM>/`. Other communities and all user accounts are left untouched.

> These scripts talk to whatever `DATABASE_URL` points at. Locally that's the Docker
> Postgres on :5540 (see [local-dev.md](./local-dev.md)). The backend does **not** need
> to be running for the direct (ts-node) flows below; it **does** for the API flow
> (`rebuild-api.sh`).

## Wiping

```bash
npm run wipe:community -- <COMM> --all
```

`wipe:community` deletes only that community's data (units, billing entities, groups,
periods, measures, ledgers, templates) inside one transaction. Flags:

- default: **keeps** vendor invoices and vendors (real financial records)
- `--drop-invoices` / `--drop-vendors`
- `--all` = `--drop-invoices --drop-vendors` (full flush)

`<COMM>` is the community id/code — for Kralik it is literally `Kralik` (from
`data/Kralik/def.json` → `"id": "Kralik"`).

## Kralik — the canonical rebuild (`rebuild-kralik-nobridge.sh`)

**This is the one to run.** It reproduces the association from 2021-11 to 2026-05 in one go:

```bash
bash scripts/rebuild-kralik-nobridge.sh
```

Steps, and why each exists:

| Step | Command | Note |
|------|---------|------|
| 1 | `wipe:community -- Kralik --all` | full flush incl. invoices/vendors |
| 2 | `import:community` / `import:funds` / `import:bill-templates` / `import:meter-templates` | topology, funds, entry templates from `data/Kralik/` |
| 3 | `HISTORY_CUTOVER=2026-05 history:inject -- ./data/Kralik` | history **2021-11 … 2026-04** straight from the export (`matrix.csv` carries Mar+Apr, so no bridge period is needed) |
| 4 | `KRALIK_SKIP_APRIL=1 seed-kralik-april-may.ts` | **2026-05 computed by the real close engine** from `actuals-2026-05.json`, chained on the injected April |
| 5 | `import:cash` | bank/casă book → `CashTx` + owner receipts → payments |
| 6 | `backfill-corrections.ts Kralik` | turns declared reshuffles/credit transfers in `history-mapping.json` into real `Correction` rows — the source of truth for the admin view ([corrections.md](./corrections.md)) |
| 7 | `prune-stale-meters.ts Kralik` | `Meter` has **no `communityId`**, so the wipe can't delete devices dropped from `def.json`; without this a 31-unit community accumulates duplicates |
| 8 | `backfill-meter-readings.ts Kralik` | the wipe doesn't know the `MeterReading` table; clean-rebuilds it from the per-unit measures so `Σ readings == PeriodMeasure` and billing is unchanged ([meters.md](./meters.md)) |

`KRALIK_SOURCE_PENALTIES=1` is exported by the script: `PENALIZARI` comes from the export's
figures rather than being recomputed.

Steps 6–8 are the ones that are easy to forget when reseeding by hand — they exist precisely
because `wipe:community` cannot reach those rows.

### Verifying the result

```bash
PGPASSWORD=postgres psql -h localhost -p 5540 -U postgres -d property_expenses -t -A -F' | ' \
  -c "select p.code, p.status, count(distinct s.billing_entity_id) bes, round(sum(s.due_end)::numeric,2) debt
      from period p left join be_statement s on s.period_id=p.id
      join community c on c.id=p.community_id
      where c.id='Kralik' group by p.code,p.status order by p.code desc limit 3;"
```

Sanity checks for 2026-05: 27 billing entities / 183 `be_statement` rows, all 10 expenses
allocated, `REABILITARE_1` Facturat = Datorat = 390 003.00, community DEBT ≈ 796 896.67,
31 unit water meters with 31 May readings, and `Σ MeterReading == PeriodMeasure` per unit.

### Kralik — June (2026-06), on top of the canonical rebuild

`rebuild-kralik-nobridge.sh` stops at 2026-05; June is a separate, self-contained step,
not yet folded into the script:

```bash
npx ts-node --transpile-only src/scripts/seed-kralik-june-complete.ts
npm run backfill:meter-readings -- Kralik
```

`seed-kralik-june-complete.ts` requires May already **CLOSED**, chains `dueStart` from
May's `beStatement.dueEnd` automatically, and builds entirely from
`data/Kralik/actuals-2026-06.json` + `data/Kralik/cash-2026-06.json` (both
self-sufficient as of the Aug 2026 regeneration — no other June script needs to run).
It submits all bill-template items, imports the full cash register, backfills invoice
dates, closes the templates, and calls `PeriodService.prepare()` — June is left
**PREPARED**, not approved. The `backfill:meter-readings` re-run is required
afterwards (community-wide, not period-scoped) because June adds new `PeriodMeasure`
rows.

All ten other `*june*` scripts under `src/scripts/` (`seed-kralik-june.ts`,
`seed-kralik-june-import.ts`, `seed-kralik-june-water.ts`,
`seed-kralik-june-remaining.ts`, `fix-kralik-june-vat.ts`, `import-kralik-cash-june.ts`,
`fix-kralik-june-payment-specs.ts`, `prepare-kralik-june.ts`,
`merge-kralik-june-apa-rece.ts`, `backfill-june-invoice-due-dates.ts`,
`backfill-june-invoice-issue-dates.ts`) are a superseded one-off chain, now folded into
`seed-kralik-june-complete.ts` and the two JSON packets above — do **not** run them as
part of a fresh reseed.

### Kralik — post-rebuild corrections (May penalty residuals + June fund reattributions)

Two more one-off, idempotent scripts must run after the steps above for the DB to fully
match the Aug 2026 reconciliation against Homefile / Registru Bancă — neither is sourced
from `def.json` or the JSON packets, so a fresh reseed silently drops them without this
step:

```bash
npx ts-node --transpile-only src/scripts/fix-kralik-penalizari-mai.ts       # after May, before/after June — reopens May itself
npx ts-node --transpile-only src/scripts/add-kralik-fund-reattributions.ts # after June is PREPARED (attaches to currentPeriod())
```

`fix-kralik-penalizari-mai.ts` restores two May PENALIZARI charges dropped by the April
historical injection (Matei Viorel 9.42, Macri Nicodemo/Francesco/Antonio 3.70) as real
`community_charge`/`community_charge_line`/`be_ledger_entry` rows — not a
`MANUAL_ADJUSTMENT` correction, which doesn't show up in Avizier's Curente column (see
the script's own header for why). It reopens May, posts the charge, re-prepares +
approves May, then re-preprares June so `dueStart` chains from May's corrected
`dueEnd`.

`add-kralik-fund-reattributions.ts` declares 6 `PAYMENT_REATTRIB` corrections (real
double-entry fund-to-fund transfers, not manual ledger edits) resolving credits stuck on
the wrong fund for three billing entities — Fikl Emil, Brînzeu Adina, and Macri
Nicodemo/Francesco/Antonio. See the script's own header for the source/reasoning behind
each transfer (a restricted `allocationSpec` line, an overshot June payment, and two
real Registru Bancă cont EUR reconciliation entries, respectively).

### Checking the result against def.json

```bash
COMM=Kralik PERIODS=2026-05,2026-06 npx ts-node --transpile-only src/scripts/verify-def-consistency.ts
```

Read-only diagnostic — compares live DB state (billing-entity-to-unit assignment,
group membership, and what was actually posted to `community_charge_line`) against
`data/Kralik/def.json` for the given periods. Non-zero exit on any real mismatch; see
the script's own header comment for two important caveats before acting on a finding
(recomputeAllocations() staleness, and why re-running `import:community` is not a safe
auto-fix for a mismatch).

## Kralik — the older April/May-only baseline

A narrower recipe kept for debugging: **only** April + May, no pre-2026 history. April
2026-04 is injected at ledger level (real opening balances from
`data/Kralik/ledger-2026-04.json`), then May 2026-05 is computed on top, with vendor penalty
buckets and the apa-dif water split. Note it does **not** run steps 6–8 above, so
corrections and raw meter readings will be missing. Run each step from the backend root:

```bash
# 1) flush
npm run wipe:community -- Kralik --all

# 2) import structure (community + funds + bill/meter templates)
npm run import:community      -- ./data/Kralik
npm run import:funds          -- ./data/Kralik/funds.json Kralik
npm run import:bill-templates -- ./data/Kralik
npm run import:meter-templates -- ./data/Kralik

# 3) inject April + compute May (penalty buckets, afisare-window accrual, apa-dif)
npx ts-node --transpile-only src/scripts/seed-kralik-april-may.ts

# 4) import the cash book (bank/casă → CashTx + owner receipts → Payments)
npm run import:cash
```

### Expected output

Step 3 prints the authoritative totals:

```
injected April: 149 (BE,fund) statements; Σ dueEnd (=May opening) = 679536.33
  seeded 37 penalty buckets across 2 units
  ✅ 2026-05 prepared + approved (chained from injected April)
May statement totals: opening=679536.33 charges=117436.67 payments=0 → DEBT(dueEnd)=796973
```

Step 4 prints `cash imported: 112 cash_tx, 37 payments (cycle 2026-04)`.

### Verify in the DB

```bash
PGPASSWORD=postgres psql -h localhost -p 5540 -U postgres -d property_expenses -t -A -F' | ' \
  -c "select p.code, p.status, count(distinct s.billing_entity_id) bes, round(sum(s.due_end)::numeric,2) debt
      from period p left join be_statement s on s.period_id=p.id
      join community c on c.id=p.community_id
      where c.id='Kralik' group by p.code,p.status order by p.code;"
```

Expected: `2026-04 | CLOSED | 27 | 679536.33` and `2026-05 | CLOSED | 27 | 796973.00`.
May is left **approved (CLOSED)**; reopen it from the UI (or the home-screen CTA) to keep
operating it.

## Kralik — the bridge-based historical flow (`rebuild-kralik.sh`)

Superseded by `rebuild-kralik-nobridge.sh` above. It loads the historical ledger (Feb-2022 .. Feb-2026)
straight from the exported history via the migration injector, then computes 2026-03 on
top as the live open period. Use this when you want the full pre-cutover history rather
than the April/May slice.

```bash
bash scripts/rebuild-kralik.sh
```

It runs: wipe → import community/funds/templates → `npm run history:inject -- ./data/Kralik`
(creates the pre-cutover CLOSED periods with per-unit charges, balance chain and penalty
buckets) → `seed-kralik-close.ts` (computes 2026-03).

## Any community, through the API (`rebuild-api.sh`)

Rebuilds an association **over HTTP** against a running backend — flush, import, then
submit each period's actuals and close→prepare→approve via the API. Used for the PENTEST
fixture and cross-tenant testing.

```bash
# backend must already be running (npm run dev)
API_EMAIL=bogdan.boji@gmail.com API_PASSWORD=123456 \
  bash scripts/rebuild-api.sh ./data/PENTEST
```

`BASE_URL` defaults to `http://localhost:3100`; `API_EMAIL`/`API_PASSWORD` must be a
system-admin login (seed one with `npm run seed`).

## Related scripts

| Command | Purpose |
|---------|---------|
| `npm run wipe:community -- <COMM> [--all]` | Delete one community's data. |
| `npm run import:community -- ./data/<COMM>` | Import topology + expense config from `def.json`. |
| `npm run import:funds -- ./data/<COMM>/funds.json <COMM>` | Import fund definitions. |
| `npm run import:bill-templates -- ./data/<COMM>` | Import bill entry templates. |
| `npm run import:meter-templates -- ./data/<COMM>` | Import meter entry templates. |
| `npm run import:cash` | Import the Kralik cash book (`data/Kralik/cash-2026-05.json`). |
| `npm run history:inject -- ./data/<COMM>` | Inject full pre-cutover history at ledger level. |
| `npm run backfill:corrections -- <COMM>` | Declared reshuffles/credit transfers → real `Correction` rows (idempotent). |
| `npm run prune:meters -- <COMM>` | Delete `Meter` rows no longer in `def.json` (+ their readings). |
| `npm run backfill:meter-readings -- <COMM>` | Clean-rebuild the raw `MeterReading` layer from measures. |
| `npm run reopen:period -- <COMM> <YYYY-MM>` | Reopen a period through `PeriodService.reopen`. |
| `npm run prepare:period -- <COMM> <YYYY-MM>` | Re-run allocation + statements for a period. |
| `npx ts-node --transpile-only src/scripts/verify-def-consistency.ts` | Read-only: diff live DB (billing-entity assignment, group membership, posted charge lines) against `def.json` for given periods. |
| `npm run db:flush` | Flush the **entire** DB (all communities) — destructive. |

> Running any of these **against prod** needs the one-off-container recipe in
> [deployment.md](./deployment.md#running-scripts-on-the-prod-host) — the plain
> `docker compose run` invocation crashes on decorators.
