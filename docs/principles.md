# Principles — the general approach

The rules the code is built around, with the reason for each. `CLAUDE.md` lists the same rules
tersely for agents; this is the "why". When a change fights one of these, the change is probably
wrong.

## 1. Declarations in, derived ledger out

The administrator declares facts — a bill, a reading, a receipt, a correction, an opening balance.
The engine derives everything else: expense lines, per-owner charges, statements, penalties, the
avizier. Derived rows (`BeStatement`, `CommunityStatement`, `runningDue`, `CLOSE_*` legs,
correction legs, penalty buckets) are **deleted and recomputed** on every `prepare`/`approve` and
are never edited by hand. If a number is wrong, fix the declaration and recompute.

*Why:* a month can be reopened, corrected and re-prepared any number of times and always lands on
the same result; audits read the declarations, not a pile of manual adjustments.

## 2. The ledger is append-only truth; statements are views

`BeLedgerEntry` (+ details per unit/fund), `Payment`/`PaymentApplication`, `VendorInvoice`/
`VendorPayment`, `CashTx`, `PenaltyBucket`, `ChargeOverride`, `Correction` are durable.
`dueEnd` of the last CLOSED month is the next month's `dueStart` — read live, so reflowing an
earlier month propagates forward. Nobody writes ledger rows directly: not scripts, not intake, not
the UI — only the services that own them ([architecture.md §5](./architecture.md)).

## 3. One choke point per money movement

- Charges: `AllocationService` inside `prepare`.
- Owner receipts: `PaymentService.createOrApply` → `applyPayment` (the **community strategy**
  decides which charges a receipt settles; callers may pin funds/charges but never compute
  applications themselves).
- Supplier bills: `TemplateService.saveBillTemplateState({state:'SUBMITTED'})` for templated bills,
  `VendorInvoiceService.createInvoice` otherwise; settlements: `createVendorPayment`.
- Cash: `CashService.createTx` for what is neither a receipt nor a settlement.

Imports, reseeds, intake and the UI all call these. A new feature that needs to "book" something
gets a new *caller*, not a new writer.

## 4. Period state is a service operation

`DRAFT → OPEN → PREPARED → CLOSED` moves only through `PeriodService` (`prepare`, `approve`,
`reject`, `reopen`) because each transition writes or unwinds ledger legs and penalty buckets.
Templates submit only into OPEN months (submitting reopens the month); payments and cash rows may
land in PREPARED months because `prepare` re-applies them. Never `UPDATE period SET status`.

## 5. Idempotent by external key

Anything that mirrors an outside fact carries a key and is upserted by it: `Payment.refId`
(`cash:<cycle>:<n>`, `bank:<reference>/<amount>`), `VendorPayment.refId`, `CashTx (refType, refId)`,
`BeOpeningBalance.originKey`, corrections by their declaration id, intake batches by record, opening rows by
`(account, fund)`. Re-running an import, a reseed or an apply is safe; duplicates are detected
against the key, not guessed from amounts and dates.

## 6. Provenance on everything imported

Rows that did not originate in the UI say where they came from: `provider/providerRef/providerMeta`
on payments, `provenance` on invoices and documents (`intake://batch/record/file`), `meta` on cash
rows. The question "why is this here?" must be answerable from the row.

## 7. Migration state is explicit, never guessed

The books start on a cutover date. What straddles it — owner arrears, penalty aging, meter
baselines, cash balances, supplier payables, invoices paid before the books — gets an **opening**
row of its own kind (`OPENING_BALANCE` ledger rows, `source: 'OPENING'` invoices, `method: 'OPENING'`
payments, `refType OPENING_BALANCE` cash rows). Nothing pre-cutover is faked as a normal expense or
cash movement ([cutover.md](./cutover.md)).

## 8. The reference is the committed source, not the database

Every community can be rebuilt from `data/<COMM>/` + scripts; the reseed runbook's totals are the
truth to compare against. When prod and the runbook disagree, prod is what gets fixed
([data-reseed.md](./data-reseed.md), [kralik-reseed-runbook.md](./kralik-reseed-runbook.md)).

## 9. Hard errors over silent guesses

Allocation with a missing meter reading throws and blocks the month; a payment beyond open charges
without an advance fund is refused; an expense type without a fund blocks; intake will not apply a
record with an unresolved unit, fund or account. The alternative — splitting equally, picking a
default fund, inventing a code — produces wrong money that nobody notices.

## 10. Humans approve; machines propose

The AI intake exports a prompt pack and imports the agent's JSON; the app itself never calls an
LLM. Every proposal is re-checked deterministically (blockers), the administrator reviews and
approves, and apply goes through the choke points above. Association-specific knowledge lives as
*hints* on the community, not in code ([intake.md](./intake.md)).

## 11. The frontend knows no domain codes

Statuses, kinds, blockers, tones, labels and hints come from the metadata registry
(`enums-meta.ts` → `GET /metadata` → `useMetadata()`); UI chrome is in `lang.ts` with EN and RO at
parity. Adding an enum value means adding its metadata, not a string in a component
([frontend-conventions.md](./frontend-conventions.md)).

## 12. Per-community configuration, not forks

Behaviour that differs between associations is configuration on the `Community`/`Period` rows:
feature flags, payment allocation strategy, meter reading modes, water difference method, afisare
window, penalty rate/grace, intake hints. The code path is the same for every tenant.

## 13. Tests are scripts against a real database

There is no unit-test harness; correctness is checked by runnable `ts-node` scripts
(`test:payment-allocation`, `api:smoke`, `intake:validate`, the reseed runbook's totals) and by
Playwright walkthroughs when the UI changes. Typecheck baselines are tracked, not zeroed: judge
new errors in files you touch ([local-dev.md](./local-dev.md)).

## 14. Schema by push, small and additive

`prisma db push` on every start; no migrations. Schema changes are additive (new enum value, new
nullable column) so the deploy container can push them without data steps; anything that needs a
data step ships as a script and a runbook entry.
