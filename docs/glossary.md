# Glossary — RO ⇄ EN ⇄ code

The documents the association handles are Romanian; the code is English. This is the mapping.

| Romanian (as on documents / UI) | English | In the code |
|---|---|---|
| asociație de proprietari | homeowners' association | `Community` (tenant) |
| apartament / spațiu (SAD) | unit / commercial space | `Unit` (`code`, `name` = the printed label "AP 3", "SAD 4/A") |
| proprietar | owner (the billed party) | `BillingEntity` (BE); `BillingEntityMember` links units over time (`startSeq/endSeq`) |
| chiriaș / locatar | tenant / resident | `UnitTenant`, role `RESIDENT` |
| administrator | property manager (a person or a firm, e.g. RUSAVIT) | role `COMMUNITY_ADMIN`; the firm is also a `Vendor` |
| cenzor | auditor | role `CENSOR`, feature `cenzor`, `ensureCanSignOff` |
| comitet executiv | executive committee | role `EXECUTIVE_COMITEE_MEMBER`, `CommitteeDecision` |
| lună / perioadă | billing month | `Period` (`code` `YYYY-MM`, `seq`), statuses DRAFT / OPEN / PREPARED / CLOSED |
| listă de întreținere / tabel / avizier | the monthly per-owner grid posted at the entrance | *avizier* (`GET /communities/:id/finance/avizier`), `BeStatement` |
| afișare (data afișării) | posting date of the list | `Period.afisareDate` — penalties run afisare-to-afisare |
| scadență | due date | `Period.dueDate` + `Community.penaltyGraceDays` (per-period overrides in period settings) |
| cotă (parte) | ownership share | `Unit.surfaceMp` (m²) used by `BY_SQM` |
| persoane | residents count | `BY_RESIDENTS` |
| cheltuieli (de întreținere) | (maintenance) expenses | `ExpenseType`, `CommunityCharge` (+`Line`), fund `EXPENSES` |
| fond | fund (money bucket) | `Fund` (`code`: EXPENSES, RULMENT, REPARATII, REABILITARE_1/2/3, PENALIZARI, …) |
| fond de rulment | working fund (refundable on sale) | fund `RULMENT` |
| fond de reparații | repairs fund | fund `REPARATII` |
| reabilitare (termică) | (thermal) rehabilitation campaign | funds `REABILITARE_n` |
| penalizări / penalități | late-payment penalties | `PenaltyBucket*`, fund `PENALIZARI`, [architecture.md §7](./architecture.md) |
| restanță / restanțieri | arrears / debtors | `dueStart`, debtors panel, `BeOpeningBalance` for migrated arrears |
| sold | balance | `dueEnd` (owner), `CashAccount` balance (cash), `SOLD INITIAL/FINAL` on statements |
| sold inițial | opening balance | `OPENING_BALANCE` rows — [cutover.md](./cutover.md) |
| avans | prepayment / credit | advance line in `allocationSpec`, credited to a fund |
| încasare | receipt (money in from an owner) | `Payment` (+`PaymentApplication`), `CashTx IN` |
| plată (furnizor) | settlement (money out to a supplier) | `VendorPayment`, `CashTx OUT` |
| chitanță | receipt slip | *Plăți* prints one after a receipt |
| registru de casă | cash book / register | `CashTx` per `CashAccount` (BANK / PETTY) |
| casă / numerar | petty cash | `CashAccount.type PETTY` (`CASH_RON`) |
| extras de cont | bank statement | intake `BANK_LINE` records; `balanceAfter` |
| comision (bancar) | bank fee | `BILL_COMISION_BANCA`, `CashTx kind OTHER` |
| factură | supplier invoice | `VendorInvoice` (`number`, `gross/net/vat`, `source`) |
| șablon de factură | bill template (one per recurring supplier) | `BillTemplate` / `BillTemplateInstance` (`FILLED` → `SUBMITTED`) |
| e-Factura | Romanian e-invoicing XML (UBL) | parsed by the intake agent |
| CUI / CIF | tax id | `Vendor.taxId` |
| contor / index / consum | meter / reading / consumption | `Meter`, `MeterReading`, `PeriodMeasure`; modes INDEX vs CONSUMPTION — [meters.md](./meters.md) |
| apă rece / canal / apă meteo | cold water / sewage / storm water | Aquatim items `apa_rece`, `canal`, `apa_meteo` |
| salubritate | waste collection | Retim, `BILL_SALUBRITATE` |
| curent scară | stairwell electricity | PPC, `BILL_CURENT_SCARA` |
| curățenie | cleaning | `BILL_CURATENIE` |
| interfon | intercom | `BILL_INTERFON` |
| corecție / regularizare / redistribuire | correction / true-up / reshuffle | `Correction` (RESHUFFLE, RESHUFFLE_TRUEUP, CREDIT_TRANSFER, PENALTY_WRITEOFF, MANUAL_ADJUSTMENT) — [corrections.md](./corrections.md) |
| grad de colectare | collection rate | `reports/collection-rate.md` |
| risc de expunere | risk exposure | report |
| Legea 196/2018 | the HOA law (penalty caps, allocation rules) | `LEGAL_*` payment strategies, penalty rules |
| migrare / preluare | migration / handover | history injection, reseed, cutover |
