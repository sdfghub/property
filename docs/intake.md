# AI intake — invoices in, expenses out (v1: manual loop)

Every month the admin receives a zip of supplier invoices (PDF, scanned or e-Factura XML) and bank
statements. Instead of keying them into bill templates by hand, the app hands out a **prompt pack**, an
external agent (Claude Code, claude.ai, …) reads the zip with it and produces a JSON file, the app
**imports** that JSON as proposals, the admin **reviews** each one, and **apply** creates the invoices
and expense lines — through exactly the same code path the month-close uses.

```
GET  /intake/prompt ──▶ prompt pack (instructions + this community's catalogue + JSON contract)
        │   admin gives it to an agent that has the zip
        ▼
agent ──▶ intake-import/v1 JSON ──▶ POST /intake/batches   (validate · dedupe · blockers)
        ▼
Intake tab: review / correct / approve each record ──▶ POST /intake/batches/:id/apply
        ▼
TemplateService.saveBillTemplateState({ state: 'SUBMITTED' })   →  VendorInvoice + CommunityCharge
VendorInvoiceService.createInvoice (no-template fallback)        →  VendorInvoice only
```

The app never calls an LLM itself in v1. There is no API key, no async job and no file storage:
the originals stay in the admin's zip; the app stores the agent's JSON verbatim (`intake_batch.raw`)
and links each created invoice back to it (`vendor_invoice.provenance`, `vendor_invoice_doc.url`).

**Where:** backend `src/modules/intake/`, UI `frontend/src/components/community-admin/intake/`,
tab **AI intake** in the "Închiderea lunii" group, admin-only, behind the per-community feature flag
`aiIntake` (off by default — enable it in Feature toggles).

## 1. Prompt pack

`GET /communities/:id/intake/prompt?periodCode=YYYY-MM` returns markdown (`&format=json` returns
`{promptVersion, contractVersion, prompt, schema, example, catalogue}` for programmatic use).
Rendered by `intake-prompts.ts` from `IntakePromptService.buildCatalogue()`:

| Section | Content |
|---|---|
| 1 Task | one JSON document, one record per invoice / per statement line, never invent codes, doubts → `warnings` |
| 2 Glossary | Romanian invoice/statement vocabulary (CUI, seria/nr, termen de plată, perioada de facturare, TVA, penalități, e-Factura UBL tags, debit/credit sign) |
| 3 Catalogue | bill templates + items (with expense type), expense types (flagging any without a fund), vendors with ids/CUI/IBAN, unpaid invoices, last-12-months invoices (dedupe), plus the same as fenced JSON |
| 4 Guidelines | gross RON amounts; one invoice may span templates (Aquatim → `BILL_APA_RECE` + `BILL_APA_METEO`); Σ allocations = gross; template by vendor first; `fallback` when nothing fits; `duplicateOf`; service period `YYYY-MM`; bank lines extracted only |
| 5 Contract | the JSON Schema (generated from the zod schemas with `z.toJSONSchema`) + a worked example built from this community's own templates |
| 6 Deliver | file name + "upload in the Intake tab" |

`PROMPT_VERSION` (`intake-contract.ts`) is stamped on every batch — bump it when the guidelines change.
Kralik's pack is ~44 KB.

## 2. The contract `intake-import/v1` (`intake-contract.ts`)

```jsonc
{
  "contractVersion": "intake-import/v1", "promptVersion": "2026-09-11.1",
  "community": "Kralik", "periodCode": "2026-07",
  "meta": { "agent": "claude-code / claude-opus-5", "generatedAt": null, "sourceArchive": "documente-2026-07.zip", "notes": null },
  "records": [
    { "kind": "INVOICE", "sourceFile": "aquatim.pdf", "sourceSha256": null, "confidence": 0.93, "rationale": "…", "warnings": [],
      "invoice": { "vendorName": "AQUATIM S.A.", "vendorTaxId": "3041480", "vendorIban": null, "number": "TM 26070001",
                   "issueDate": "2026-07-04", "dueDate": "2026-07-25", "servicePeriodStart": "2026-06", "servicePeriodEnd": "2026-06",
                   "currency": "RON", "net": 496.33, "vat": 44.67, "gross": 541.00, "lines": [ … ] },
      "mapping": { "vendor": { "match": "EXISTING", "vendorId": null, "name": "Aquatim", "taxId": "3041480", "iban": null },
                   "allocations": [ { "templateCode": "BILL_APA_RECE", "itemKey": "apa_rece", "amount": 412.30, "reason": "…" },
                                    { "templateCode": "BILL_APA_RECE", "itemKey": "canal",    "amount": 98.10,  "reason": "…" },
                                    { "templateCode": "BILL_APA_METEO", "itemKey": "apa_meteo", "amount": 30.60, "reason": "…" } ],
                   "fallback": null, "duplicateOf": null } },
    { "kind": "BANK_LINE", …, "bankLine": { "account": { "iban": "…", "bankName": "…" }, "date": "2026-07-03", "amount": 350, "reference": "FT26…", … }, "mapping": null },
    { "kind": "OTHER", …, "note": "Proces-verbal" }
  ]
}
```

The zod schemas are pure (they render into the pack). Before validation, `normalizePayload` forgives
the near-misses agents produce: numbers as strings (`"1.234,56"`), `01.07.2026` dates, `2026-07-01`
where `2026-07` is expected, missing optional keys. Validation errors point at the record:
`records[3].mapping.allocations[0].amount — expected number`.

Full worked example for any community: `data/Kralik/intake-sample-2026-07.json` (synthetic).

## 3. Import, checks, blockers (`intake-import.service.ts`, `intake-blockers.ts`)

`POST /communities/:id/intake/batches` (multipart `file` or JSON `{ periodCode?, payload }`) creates an
`IntakeBatch` + one `IntakeRecord` per element and runs the **deterministic checks** against the live
catalogue. The same checks run on every review save, on `POST …/recheck`, in `npm run intake:validate`,
and once more right before apply. They never call an LLM.

| Blocker | Hard? | Meaning |
|---|---|---|
| `NO_ALLOCATION` | hard | invoice with no template lines and no fallback |
| `UNKNOWN_TEMPLATE` / `UNKNOWN_ITEM` | hard | code not in this community |
| `EXPENSE_TYPE_NO_FUND` | hard | item's expense type has no `params.fundCode` (allocation would throw) |
| `UNKNOWN_FUND` / `UNKNOWN_EXPENSE_TYPE` | hard | fallback target does not exist |
| `PERIOD_NOT_OPEN` | hard | intake only applies into OPEN periods (see §4) |
| `TEMPLATE_ALREADY_SUBMITTED` | hard | another submission exists for that template this period |
| `PHASE2_UNSUPPORTED` | hard | `BANK_LINE` / `OTHER` — stored, can only be skipped in v1 |
| `VENDOR_UNKNOWN` | ack | no vendor matched by id / CUI / normalised name; fallback path creates it |
| `VENDOR_MISMATCH` | ack | template is configured for a different vendor (template vendor wins) |
| `AMOUNT_MISMATCH` | ack | net + VAT ≠ gross |
| `ALLOCATION_SUM_MISMATCH` | ack | Σ allocations ≠ gross |
| `PERIOD_MISMATCH` | ack | service period is not the target month or the one before |
| `VALUE_CONFLICT` | ack | the template instance already holds a different hand-entered amount for that item |
| `DUPLICATE_IN_BATCH` / `DUPLICATE_INVOICE` | ack | same number + vendor (or sha256) already present |
| `LOW_CONFIDENCE` | ack | agent confidence < 0.6, or the agent left a warning |

Hard blockers must be fixed — in the record's mapping (drawer) or in the community setup (e.g. give
the expense type a fund, then **Re-check**). Acknowledgeable ones are ticked on approve and stored in
`review.overrides`. Statuses: `PROPOSED` (clean) → `NEEDS_REVIEW` (has checks) → `APPROVED` → `APPLIED`;
`SKIPPED`; `FAILED` (apply threw — retryable, see §4).

Vendor matching order: `vendorId` → CUI (digits, `RO` stripped) → normalised name ("AQUATIM S.A." ≡
"Aquatim"; SC/SRL/SA/diacritics/punctuation removed, substring either way).

## 4. Apply (`intake-apply.service.ts`)

`POST /communities/:id/intake/batches/:id/apply` takes every `APPROVED` (and `FAILED`) invoice record,
re-runs the checks, and per record:

1. **Period must be OPEN.** `saveBillTemplateState` unconditionally resets the period to OPEN
   (`template.service.ts` "Reopening any template moves the period back to OPEN"), so applying into a
   PREPARED/CLOSED month would silently undo a close. Enforced at apply, not only at import.
2. Allocations grouped by template. For each template: load the instance's current `values`,
   **merge — never clobber** (conflicts were `VALUE_CONFLICT` blockers), set the item amounts and the
   header keys from `template.output.invoice` (`numberKey`, `issueDateKey`, `dueDateKey`,
   `serviceStart/EndPeriodKey`, `netKey`/`vatKey`/`grossKey`, with the conventional defaults). For an
   invoice spanning templates, gross per template = that group's sum and net/VAT are pro-rated — so the
   two `VendorInvoice` rows add up to the real invoice (the invoice list merges them by number).
3. `attemptedTemplates` is written to `appliedRefs` **before** the call, then
   `TemplateService.saveBillTemplateState(…, { state: 'SUBMITTED', values })` — the same primitive the
   month-close uses — creates/updates the `VendorInvoice` (keyed by template instance, idempotent),
   links the fund and creates the `CommunityCharge` lines via the allocation engine.
4. That call hard-sets `source: 'INTERNAL'`, so intake then stamps `source: 'IMPORT'`, `hash`
   (= `sourceSha256` if the agent gave one), net/VAT/dates, and
   `provenance { intakeBatchId, intakeRecordId, agentLabel, promptVersion, contractVersion, sourceFile, templateCode }`,
   and adds a `VendorInvoiceDoc` (`url = intake://<batch>/<record>/<file>`; no bytes).
5. No template → `VendorInvoiceService.createInvoice` with the fallback fund (`source: 'IMPORT'`) —
   invoice only, no expense lines; guarded by hash / provenance so a retry cannot create it twice.
6. `appliedRefs` are persisted progressively; the record becomes `APPLIED`; the batch becomes `APPLIED`
   when every invoice record is applied or skipped.

**Templates are left `SUBMITTED`, not `CLOSED`.** Closing is the month-end checklist's step
(`PeriodService.prepare` insists on it), so the admin keeps the existing "review each bill, then close"
pass and can still edit values before preparing.

**Partial failures are normal and retryable.** The allocation engine never falls back (CLAUDE.md #7):
a water invoice applied before the month's `WATER_COLD` readings are entered fails with *"No WATER_COLD
readings for this period — enter them before allocating"*. The record is marked `FAILED` with that
message; enter the readings, press **Apply** again. Its own earlier partial output is recognised
(`attemptedTemplates`, provenance) so it is not reported as `TEMPLATE_ALREADY_SUBMITTED` or
`DUPLICATE_INVOICE`. Re-applying an applied batch is a no-op; a batch with applied records cannot be
deleted.

## 5. Checking an agent's output without importing

```bash
npm run intake:validate -- <file.json> Kralik [--period 2026-07] [--json]
npm run intake:validate -- --prompt Kralik 2026-07 > prompt.md      # print the pack
```

Parses + normalises the file, builds the live catalogue, prints every record with its mapping and
blockers, exits 1 on contract errors or hard blockers. Writes nothing. This is the loop for improving
the prompt: edit `intake-prompts.ts`, regenerate, run the agent again, validate.

Expected on the sample against a fresh OPEN 2026-07:
`npm run intake:validate -- data/Kralik/intake-sample-2026-07.json Kralik` → #0 #1 clean,
#2 `AMOUNT_MISMATCH`, #3 `VENDOR_UNKNOWN`, #4 #5 `PHASE2_UNSUPPORTED`. Once that batch has been applied,
the same file reports `TEMPLATE_ALREADY_SUBMITTED` + `DUPLICATE_INVOICE` on #0–#3 — re-importing what
is already in the books is caught at both levels.

## 6. Phase 2 and full automation

- **Bank statements.** v1 already accepts and stores `BANK_LINE` records (account IBAN, date, signed
  amount, counterparty, reference) and the catalogue already carries cash accounts and unpaid invoices.
  Phase 2 adds a `mapping` block for bank lines (`target: OWNER_PAYMENT | VENDOR_SETTLEMENT | CASH_TX |
  IGNORE`) and an apply branch through `PaymentService.createOrApply` (`refId` = bank reference →
  idempotent), `VendorInvoiceService.createVendorPayment` against unpaid invoices, and
  `CashService.createTx`. Contract bumps to v2; v1 files stay importable. No schema change.
- **Automation.** An in-app extractor can call the Claude API with the very same pack
  (`format=json` gives prompt + schema + catalogue), send each PDF as a document block, and POST the
  result to the same import endpoint. Everything downstream (checks, review, apply) is shared.

## Gotchas

- Water/metered invoices need the month's meter readings entered first (see §4).
- The target period must be OPEN; create the next period before importing its invoices.
- One real invoice across two templates becomes two `VendorInvoice` rows with the same number — by
  design; the invoices list merges them.
- Agent `warnings` become a `LOW_CONFIDENCE` check the admin must acknowledge — they are read from
  `intake_batch.raw` on every recheck, so they never disappear.
