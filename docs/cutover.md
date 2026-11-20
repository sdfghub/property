# Migration cutover — opening balances

When an association is migrated, the books start on a cutover date (Kralik: 2026-06-01, after the
reseeded May). Everything *before* that date is history (injected ledgers, owner arrears), and
everything *after* it is recorded by the app. Some state straddles the line and needs an explicit
opening value or the derived figures are wrong:

| State | Where the opening lives | How it gets there |
|---|---|---|
| Owner arrears / credits (per BE, fund, unit; principal vs penalty) | `be_opening_balance` → `OPENING_BALANCE` ledger rows | `import-opening-balances.ts` / history injection |
| Penalty aging buckets | `penalty_bucket` | history injection |
| Meter baselines | `meter.opening_index` | community import |
| **Vendor payables** — invoices issued before the cutover and paid after it | `vendor_invoice` with `source: 'OPENING'` | **lazily, when the payment shows up** (see below) |
| **Vendor invoices seeded but already paid before the cutover** | `vendor_payment` with `method: 'OPENING'` | *Plăți → Plătită înainte de migrare* |
| **Cash accounts** (bank RON/EUR, petty cash) | `cash_tx` `kind: ADJUSTMENT`, `refType: OPENING_BALANCE`, one per (account, fund) | *Registru → account → Sold inițial (migrare)* |

Not modelled (decide per association): loans / financing of a campaign, deposits and guarantees held
for others, receivables from invoices the association issues outside the charge model.

## Vendor payables: "paying an opening"

There is no handover list of unpaid supplier invoices. Instead, a payment for an invoice the app has
never seen creates the payable at that moment — a **virtual OPENING invoice** for exactly the amount
paid, settled by that payment. Amount = payment, so partial and lump settlements are right by
construction; the vendor's account and the unpaid list are correct from the cutover on.

- `VendorInvoiceService.createOpeningInvoice` / `payOpening`: `source: 'OPENING'`, real number when
  quoted on the statement (`TMA10/1015495562`) else `OPENING-<VENDOR>-<date>`, `fund_invoice` link,
  **no template, no `community_charge`, no accrual** (`upsertFundSpendLedger` returns early) — the
  expense is already in the injected history, so expense reports (built from `community_charge`) never
  see it. The settlement posts the ordinary `PAYMENT_OUT` cash-lane legs and `CashTx OUT`.
  Idempotent on `provenance.openingKey` (intake uses the bank line key).
- Entry points: intake (bank line → `VENDOR_SETTLEMENT` with `INVOICE_NOT_FOUND` acknowledged and
  `mapping.openingInvoice: true`, drawer checkbox *Plătește o factură dinainte de începerea evidenței*),
  *Plăți → + Plată furnizor → "Factură dinainte de migrare"*, `POST /communities/:id/invoices/opening-payments`.
- The mirror case — a seeded invoice the register already paid before the cutover — is closed by
  `settleAtCutover`: a `vendor_payment` `method: 'OPENING'`, `refId opening:<invoiceId>`, amount =
  outstanding, **no cash row, no ledger legs**. *Plăți* row action *Plătită înainte de migrare*,
  `POST /communities/:id/invoices/:id/settle-at-cutover`. Idempotent per invoice.

## Cash accounts: "Sold inițial"

`getBalances` is Σ `cash_tx`, so an account starts at zero on the first imported movement. Set the
balance on the cutover date per fund (bank money belongs to funds): *Registru → pick the account →
Sold inițial (migrare)* or `POST /communities/:id/cash-accounts/:accountId/opening { fundId|fundCode,
amount, date }`. One row per (account, fund), replaced on every call, `amount: 0` removes it.
`GET /cash-accounts/openings` lists them.

**Statement check.** Every intake batch with bank lines compares the statement's opening (first line's
`balanceAfter − amount`) and closing (`balanceAfter` of the last line) with Σ `cash_tx` of that account
before / through those dates, per account (`intake_batch.stats.balanceCheck`, shown above the review
table). A constant difference across opening and closing = a missing/incorrect opening balance; a
difference that changes between the two = movements inside the window the book lacks or has twice.

## Kralik status (2026-09-12)

- Pre-cutover payables surfaced by the July statement: Aquatim `1015495562` 1831.01, PPC
  `26EI…0643` 68.88 (likely a typo of unpaid `26EI09370543` 72.83 — settle that one instead), and the
  three contractor payments with no invoice (PROFI VENT, SM LARISUK, ADAMS CONSTRUCT → REABILITARE_3).
- Seeded-but-paid rows to close with *Plătită înainte de migrare*: `RUSAVIT-2026-05`, `SCHMIDT-2026-05`,
  `LIBRA-2026-05` and the numberless Libra 12.00.
- Cash openings still to set: BANK_LIBRA_RON ≈ 161,389.38 on 2026-05-31 *if* the June register import
  is complete (statement 01.07 opening 267,704.78 − June movements in the app 106,315.40), BANK_LIBRA_EUR
  9,960.31, CASH_RON from the register's *sold casă*. The July–August window still shows a 30,807.68
  discrepancy between the register import and the statement — reconcile that before trusting the opening.
