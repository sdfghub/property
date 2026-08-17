# Corrections (declaration → derived ledger)

Real associations correct themselves: cotele get reweighted, a payment lands on the wrong
fund, a committee forgives penalties, a balance needs a manual nudge. This is how those
facts are recorded.

## The rule

> **A `Correction` row is a domain declaration — the true fact. The ledger entries are
> *derived* from it. Nobody hand-writes ledger legs.**

Reading corrections *out of* the ledger is a **debug** view only (after allocation, to see
what the declaration produced). If a correction is not a `Correction` row, it does not
exist as far as the app is concerned.

## The five types

Each type fixes its own `meta.reason` on the derived legs (`REASON_BY_TYPE` in
`src/modules/corrections/corrections.service.ts`) — the reason is never free text:

| Type | `reason` | Derives |
|------|----------|---------|
| `RESHUFFLE` | `reponderare-cote` | one `CHARGE` leg per billing entity, from `payload.perBe` |
| `CREDIT_TRANSFER` | `reatribuire-plata` | negative `PAYMENT` on `(be, fund)` |
| `PAYMENT_REATTRIB` | `reatribuire-plata` | negative `PAYMENT` on `payload.fromFund` |
| `PENALTY_WRITEOFF` | `scutire-penalizari` | negative `ADJUSTMENT` on `PENALIZARI` |
| `MANUAL_ADJUSTMENT` | `ajustare-manuala` | `ADJUSTMENT` (±) on `(be, fund)` |

`ajustare-sold` is **not** a type — it is a history-injector artifact, tracked separately.

Storage: `model Correction` in `prisma/schema.prisma` — `communityId`, `periodCode`, `type`,
`reason`, `billingEntityId?`, `fundCode?`, `amount?`, `payload?` (type-specific), `note?`,
`status` (`ACTIVE` | `VOID`), `createdBy`, and void audit fields. Corrections are soft-voided,
never deleted.

## Derivation

`PeriodService.applyCorrections(tx, communityId, periodId)`
(`src/modules/period/period.service.ts`) is a **delete-and-rederive** step, modelled on the
older `applyChargeOverrides`:

1. delete every `be_ledger_entry` (+ detail) for the period with `refType='CORRECTION'`;
2. load the period's `ACTIVE` corrections;
3. per correction, derive its legs and write them with `refType='CORRECTION'`,
   `refId=<correction id>`, `lane = PAYMENT ? CASH : ACCRUAL`, and
   `meta = { reason, correctionId, type, note, actor }`.

Because it is idempotent, running it twice changes nothing — and because
`computeStatements` simply sums ledger legs into `be_statement`
(`CHARGE → charges`, `PAYMENT → payments`, `ADJUSTMENT → adjustments`,
`dueEnd = dueStart + charges − payments + adjustments`), corrections need no other wiring
to reach the avizier.

**Hooks:** `prepare` and `approve` both call `applyCorrections` inside their transaction;
`reapplyCorrectionsNow(communityId, periodCode)` runs
`applyCorrections + computeStatements + computeCommunityStatements` immediately after a
create/void so a `PREPARED` period's avizier updates at once. A `reopen`/`reject` leaves the
declarations alone (they are facts, not workflow state) and the legs get rebuilt on the next
`prepare`.

Corrections always target the **current non-closed period**; posting when every period is
closed is rejected with "No open period to post a correction to".

## API

`@Controller('communities/:communityId/corrections')`, JWT + scopes:

| Route | Roles | Purpose |
|-------|-------|---------|
| `GET /` (`?period=YYYY-MM`, `?debug=ledger`) | admin, censor, EC member | list from the `Correction` table; `debug=ledger` switches to the ledger-derived debug read |
| `GET /context` | admin, censor, EC member | form context (current period, billing entities, funds) |
| `GET /:id/ledger` | admin, censor, EC member | the legs this correction produced |
| `POST /` | `COMMUNITY_ADMIN` | create (per-type payload validation) |
| `POST /:id/void` | `COMMUNITY_ADMIN` | soft-void, then re-derive |

`GET /:id/ledger` returns `{ legs, byKind, total, linked }`. `linked: false` means the legs
were matched *heuristically* (period + reason + entity/fund) instead of by `refId` — the
case for historical corrections booked by the injector as `MIGRATED_*` rather than through
this feature.

UI: **`frontend/src/components/community-admin/CorrectionsPanel.tsx`** (the "Corecții" tab
under Bani) — type-driven create form, period filter for previous closed periods, and an
"Impact" modal per row backed by `GET /:id/ledger`.

## Seeded history

Kralik's historical corrections live in `data/Kralik/history-mapping.json`
(`shareReallocations.reallocations[]`, `creditTransfers.entries[]`) and are turned into real
`Correction` rows by:

```bash
npm run backfill:corrections -- Kralik
```

It is idempotent, stamps `createdBy: 'history-import'`, and runs as part of
`scripts/rebuild-kralik-nobridge.sh`. Penalty write-offs and cash-reconciliation cases are
**not** backfilled yet.

⚠️ `wipe:community --all` deletes `correction` rows, so live admin corrections on a
reseed-managed community (Kralik) do not survive a rebuild unless they are also declared in
the seed source. Keep that in mind before reseeding a community that is being operated.

## Auditing what a correction did

Check the **charges** through `community_charge` → `community_charge_line` (they equal
`be_statement` to the cent). Do *not* audit via `be_ledger_entry_detail` ALLOC legs — see
the warning in [architecture.md](./architecture.md#auditing-charges).
