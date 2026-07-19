# Kralik — domain notes

Kralik (`data/Kralik/`, community id `Kralik`, name "AP Gh Lazar 4" = Asociația Gh Lazar 4)
is the primary real association the app is operated from. This captures the non-obvious,
Kralik-specific modelling decisions. For how to wipe/rebuild it, see
[data-reseed.md](./data-reseed.md).

## Periods & the afisare window

The working baseline is **2026-04** (injected CLOSED) → **2026-05** (computed). Real May
debt = 796,973.00; April Σ dueEnd = 679,536.33 (= May opening).

`Period.afisareDate` is the vendor's posting/display date (from the xlsx `Data-Config`
`Data Afisare`). Penalties accrue over the **afisare-to-afisare window**, not the calendar
month:

- April afisare `2026-06-11`, May afisare `2026-07-13` → May window = 32 days.
- `PenaltyLedgerService.advance()` uses `[prevAfisare+1 .. thisAfisare]`; it falls back to
  calendar bounds when `afisareDate` is null, so other communities are unaffected.

## Penalty buckets & the back-penalty forgiveness

Kralik's old software (**HomeFile**) computed penalties incorrectly (it stopped aging some
old arrears buckets). The fix, for the two affected units — **AP 1/B (MATEI)** and
**AP 11 (MACRI)**:

1. **Import the vendor's per-bucket table verbatim** as the starting state
   (`data/Kralik/penalty-buckets-2026-05.json`, keyed by unit; only buckets with rate > 0).
   Seeded as `PenaltyBucket` rows by `seed-kralik-april-may.ts` (no `PenaltyBucketPeriod`
   rows — `advance()` uses the `seedPenaltyAccrued` fallback).
2. **Compute May forward by our engine** over the afisare window → May penalties
   **72.62 (AP 1/B)** / **3.72 (AP 11)**.
3. **Keep the accumulated back-penalty forgiven**: April carries the accumulated
   (4,119.79 / 155.57) as opening debt **and** an offsetting `scutire-penalizari`
   write-off, so net history = 0 but **both legs stay visible**. May-forward penalties are
   billed normally (land on a 0 opening).

The grand-total gap vs the vendor's Data-MAI sheet (63.08) is the intended penalty
correction (our 76.34 vs HomeFile's 13.12), not a bug.

## Cold-water allocation: apa-dif

Kralik splits cold water two ways ("apă - diferență"): a **metered** part (per-unit
consumption) plus a **difference** part (the branch-meter residual, split proportionally).
This originally came from the `lotus-tm` community definition.

- Driven from **bare data**: `def.json` has a top-level `"waterDifferenceMethod": "APA_DIF"`.
  The seed reads it and sets the **existing per-period switch** `Period.waterDifferenceMethod`
  before the water bill is allocated. **Do not** add a DB column or core-code branch for
  the method — the per-period switch is the mechanism. (`PROPORTIONAL` is the default for
  everyone else.)
- `def.json` `expenseSplits` for `SPLIT_APA_RECE`, `SPLIT_CANAL`, `SPLIT_PENALITATI_APA`
  each carry mode-tagged leaves: a `PROPORTIONAL` leaf (share 1) and two `APA_DIF` leaves
  (metered via `COMMUNITY_WATER_COLD_CALC`, difference via `COMMUNITY_WATER_RESIDUAL`).
  `allocation.service` runs only the leaves whose `mode` matches the period switch (untagged
  leaves always run).
- Derived meters: `COMMUNITY_WATER_COLD` (total, from the Aquatim branch meter),
  `COMMUNITY_WATER_COLD_CALC` (metered sum), `COMMUNITY_WATER_RESIDUAL` (the difference).
- May result: metered 707.37 + difference 1112.42, reconciling to Data-MAI's "Val"/"Val Dif"
  (0/27 unit mismatches). The Aquatim invoice is split 3 ways: apa_rece / canal / penalitati.

### Avizier "Apă - diferență" column

The avizier groups columns by expense type, so the apa-dif difference (a line-level
`splitNodeId`, same expense type as the metered part) would collapse into the water column.
`finance.service.avizier()` keys a separate `APA_DIF` column off
`ccl.meta->>'splitNodeId' like '%DIFERENTA'` and maps it into the water fund group.

## Charge overrides (generic, admin)

A community admin can override a computed fund charge (built for penalties, but generic).
Realized as **two ADJUSTMENT `be_ledger_entry` legs**: `−computed` and `+admin value`,
with a comment + audit trail (`ChargeOverride` model). They are **re-derived on every
prepare/approve** (`period.service.applyChargeOverrides`) so they survive re-prepare — the
`be_statement` is recomputed each time and must never be edited directly.

## Known data caveats (tech/business debt)

- **`reconciliere-numerar`** transactions overload three distinct cases (fund transfers,
  uncaptured casă payments, true residuals). Totals reconcile, so it's not a parsing bug —
  but the label is ambiguous. See memory `property-cash-reconciliation-debt`.
- **6 units** need special handling in the debt calc (prior-cycle bookings, penalty
  write-offs). See memory `kralik-debt-special-transactions`; April→May reconciliation is
  25/31 exact by construction (the plug absorbs the rest).
- **`BillingEntity.displayName`** carries a friendly label ("Ap 1/B · Matei Viorel"); cool
  defaults live in `def.json` `billingEntities[]`.

## Data sources

Everything derives from the committed `data/Kralik/`: `def.json` (topology + splits +
funds config), `ledger-2026-04.json` (April opening/charges/closing per unit-fund),
`actuals-2026-05.json` (May vendor bills + per-unit water/residents + branch meter),
`penalty-buckets-2026-05.json`, `cash-2026-05.json`. Cross-check against the source xlsx
(`DATA-MAI` sheet for per-unit values, `Data-Config` for afisare dates).
