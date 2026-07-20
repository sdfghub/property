# Report — Collection rate ("Grad de colectare")

Of everything the association was owed cumulatively up to period P, how much has actually been
collected — broken down by fund domain, fund and billing entity.

- **API**: `GET communities/:communityId/reports/collection-rate?period=YYYY-MM&domain=strategic`
- **Code**: `src/modules/reports/`
- **UI**: `frontend/src/components/community-admin/CollectionRatePanel.tsx` (tab `?tab=collectionRate`)
- **Test**: `npx ts-node --transpile-only src/scripts/verify-collection-rate.ts`

Ported from an external specification (a Lovable app, route
`/rapoarte/grad-colectare?propertySlug=&domain=`). The spec was written to be stack-agnostic; this
document records what we implemented and, more importantly, **where we deliberately diverged**.

## The core identity

`computeStatements` maintains `dueEnd = dueStart + charges − payments + adjustments`, so for one
`(billing entity, fund)` over all periods `p ≤ P`:

```
owed        = dueStart(first period) + Σ charges + Σ adjustments
paid        = Σ payments
outstanding = dueEnd(P)                    ← read directly, never recomputed
rate%       = paid / owed × 100            ≡ (1 − outstanding/owed) × 100
```

`owed − paid == outstanding` therefore holds **exactly**. `owed` is derived independently (rather
than as `outstanding + paid`) precisely so the identity is a real check — the endpoint reports it as
`checks.identityOk` / `checks.residual`, and the verify script asserts it at every level.

Two subtleties:

- The opening `dueStart` must be included: it carries migrated arrears from before the first
  computed period (for Kralik, everything prior to the 2026-04 baseline).
- Adjustments belong in `owed` — a `scutire-penalizari` write-off genuinely reduces what is owed.

Aggregation is a plain sum at every level; the rate is always recomputed from summed owed/paid and
**never** averaged from child rates.

## Where our model made the spec simpler

Three parts of the source spec exist only to work around information their schema lacks:

| Spec | Us |
|---|---|
| §4.1/§4.3 — read `charges[u, P+1].restante` to get the "true" outstanding of a closed period | `BeStatement.dueEnd` *is* that number. No P+1 lookup — and we can render the **most recent** period, which the source explicitly cannot. |
| §4.4 — proportionally allocate "generic" payments across funds | `PaymentApplication.spec` + `BeLedgerEntryDetail(kind='PAYMENT', fundId, unitId)` attribute every payment exactly. No estimation. |
| §4.9 — reconstruct FIFO oldest-first allocation at display time | Allocation already happened at payment time under the community's strategy (`src/modules/billing/payment-allocation.ts`). The applications *are* the truth. |

## Fund domains

Read from **`Fund.allocation.type`** (see `data/<COMM>/funds.json`) — not a Prisma enum, not a
column. Matching is case-insensitive; a fund whose allocation carries no `type` falls into `other`
rather than disappearing from the report.

Labels and ordering live in `FUND_DOMAIN_META` (`src/common/enums-meta.ts`), served by
`GET /metadata` — the frontend never hardcodes them (see [frontend-conventions.md](../frontend-conventions.md)).

Kralik: `Operational` (EXPENSES, RULMENT, PENALIZARI) · `Tactic` (REPARATII) ·
`Strategic` (REABILITARE_1/2/3). Note the source spec called its third domain "Rehabilitation";
ours is **Tactic** plus Strategic.

## CPI

CPI (cotă-parte indiviză) is stored as a `PeriodMeasure` with `type_code='SQM'` — the BY_SQM rules
are "după cota-parte indiviză", so the SQM measure carries the cotă weight
(`src/importers/community/parse.ts`). Per-period overrides are native; that is the spec's
`unit_cpi_history`.

Two gotchas:

- **Measures are not written every period.** Kralik has SQM rows for 2026-03 and 2026-05 but not
  2026-04, so the report takes each unit's most recent value at or before P. That is also the
  correct "an override persists until changed" semantics.
- **CPI at fund/domain level is a union over distinct billing entities, never a sum of per-fund
  CPI** — a BE appears under several funds, and summing would multiply by the number of funds
  (spec §4.7). `totals.cpi` should be ≈ 100; the verify script asserts it.

⚠️ SQM and CPI share one measure type (`parse.ts` picks `cpi ?? sqm`), so a community that needs
both real square meters *and* a separate indiviză quota cannot express that today.

## Deliberate deviations

- **Grain is the billing entity, not the unit.** `BeStatement` is per `(period, BE, fund)` and its
  columns are exactly the report's metrics. A BE holding two units renders as one row. Per-unit
  detail is reachable (`community_charge_line`, `be_ledger_entry_detail`, `be_opening_balance`,
  `penalty_bucket` all carry `unit_id`) but requires re-aggregating four tables.
- **No group scope.** The spec's `unit_group` means staircases — a partition. Our `UnitGroup` is an
  overlapping tag system (a Kralik unit is in ~11: `ALL_BILLABLE`, `RESIDENTIAL`, `TYPE_APARTAMENT`,
  `SVC_*`…), so summing across groups would double-count.
- **`Boxa` exclusion not implemented.** Unit type is a `TYPE_*` group convention rather than a
  `Unit` column, and Kralik has no storage rooms.
- **No router.** The frontend has none (`?tab=` + `pushState`), so this is a tab, not
  `/rapoarte/grad-colectare`.
- **Deferred**: history chart (§5.5) and heatmap/treemap (§5.7) — both need a charting dependency
  the frontend does not have; the cumulative/Δ toggle (§4.6) — `history[]` already carries
  `deltaOwed`/`deltaPaid` so it is a pure client-side derivation; CPI slider and entity/fund filter
  popovers (§5.2).

## Rounding

Every aggregate is accumulated at full precision and rounded **only** for presentation.
`be_statement` stores unscaled `Decimal`s and allocation leaves sub-cent tails on some rows (115 of
them for Kralik), so rounded children can differ from their rounded parent by a cent or two.

This is deliberate. Snapping each row to the cent first would make columns add up perfectly but
would drift the headline outstanding away from the association's real debt — measured at **0.07 RON**
for Kralik 2026-05 — and that total is what people cross-check against the avizier. The verify
script therefore allows a half-cent-per-child tolerance on rollups while requiring the identity to
hold exactly.

## Verified numbers (local, 2026-07)

| Period | Status | Owed | Paid | Outstanding | Rate |
|---|---|---|---|---|---|
| 2026-04 | CLOSED | 858,747.48 | 179,211.15 | 679,536.33 | 20.87 % |
| 2026-05 | PREPARED | 976,120.94 | 179,211.15 | 796,909.79 | 18.36 % |

`outstanding` ties exactly to `Σ be_statement.due_end`. Note 2026-05 is PREPARED locally
(796,909.79); production has it CLOSED at 796,973.00 — approving the period moves the figure.
