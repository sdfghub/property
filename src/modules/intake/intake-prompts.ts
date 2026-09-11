// The prompt pack text. Lives in a .ts file (not .md) because the prod image ships dist/ only.
// Instructions are in English (agents follow them more reliably), the domain glossary is Romanian
// because that is what the documents say. Keep this deterministic: the pack is diffed between versions.
import type { IntakeCatalogue } from './intake-prompt.service'
import { CONTRACT_VERSION, PROMPT_VERSION, type ImportPayload } from './intake-contract'

export type PromptPackInput = { catalogue: IntakeCatalogue; schema: unknown; example: ImportPayload }

const money = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))

/** The part of the catalogue the agent needs (no internal ids except vendor ids, which it must echo). */
export function promptCatalogue(c: IntakeCatalogue) {
  return {
    community: { code: c.community.code, name: c.community.name },
    period: { code: c.period.code, startDate: c.period.startDate, endDate: c.period.endDate },
    currency: c.currency,
    templates: c.templates.map((t) => ({
      code: t.code,
      name: t.name,
      vendorName: t.vendorName,
      fundCode: t.fundCode,
      alreadySubmittedThisPeriod: t.instanceState === 'SUBMITTED' || t.instanceState === 'CLOSED',
      items: t.items.map((i) => ({ key: i.key, label: i.label, expenseTypeCode: i.expenseTypeCode })),
    })),
    expenseTypes: c.expenseTypes,
    funds: c.funds,
    vendors: c.vendors,
    unpaidInvoices: c.unpaidInvoices.map((i) => ({ number: i.number, vendorName: i.vendorName, gross: i.gross, dueDate: i.dueDate })),
    recentInvoices: c.recentInvoices.map((i) => ({ number: i.number, vendorName: i.vendorName, gross: i.gross, issueDate: i.issueDate })),
  }
}

export function renderPromptPack({ catalogue: c, schema, example }: PromptPackInput): string {
  const pc = promptCatalogue(c)
  const templateProse = c.templates
    .map((t) => {
      const items = t.items.map((i) => `\`${i.key}\` = ${i.label}${i.expenseTypeCode ? ` (${i.expenseTypeCode})` : ''}`).join('; ')
      const flag = pc.templates.find((x) => x.code === t.code)?.alreadySubmittedThisPeriod ? ' — **already submitted this period, do not map to it**' : ''
      return `- \`${t.code}\` — ${t.name}${t.vendorName ? `, vendor **${t.vendorName}**` : ''}${t.fundCode ? `, fund ${t.fundCode}` : ''}: ${items || '(no items)'}${flag}`
    })
    .join('\n')
  const missingFund = c.expenseTypes.filter((e) => !e.fundCode).map((e) => `\`${e.code}\``)
  const vendorsTable = c.vendors.length
    ? c.vendors.map((v) => `| \`${v.id}\` | ${v.name} | ${v.taxId ?? ''} | ${v.iban ?? ''} |`).join('\n')
    : '| — | (no vendors yet) | | |'
  const unpaidTable = c.unpaidInvoices.length
    ? c.unpaidInvoices.map((i) => `| ${i.number ?? ''} | ${i.vendorName ?? ''} | ${money(i.gross)} | ${i.dueDate ?? ''} |`).join('\n')
    : '| — | (none) | | |'
  const recentTable = c.recentInvoices.length
    ? c.recentInvoices.slice(0, 60).map((i) => `| ${i.number ?? ''} | ${i.vendorName ?? ''} | ${money(i.gross)} | ${i.issueDate ?? ''} |`).join('\n')
    : '| — | (none) | | |'

  return `# Intake prompt — ${c.community.name} (\`${c.community.code}\`), period ${c.period.code}

prompt-version: ${PROMPT_VERSION} · contract: ${CONTRACT_VERSION}

## 1. Your task

You are given an archive (zip) of documents received by a Romanian homeowners' association
("asociație de proprietari") for the billing period **${c.period.code}** (${c.period.startDate} → ${c.period.endDate}).
The archive contains supplier invoices (PDF, scanned or native; possibly e-Factura UBL XML) and bank
statements (PDF, CSV, XLS or MT940).

Read **every** file. Produce **exactly one JSON document** that conforms to the contract in section 5 —
nothing else, no prose around it. One record per invoice (a PDF may contain several invoices → several
records) and one record per bank statement line. Anything you cannot classify becomes a \`kind: "OTHER"\`
record with a note. If a file cannot be read at all, still emit an \`OTHER\` record for it.

Do not invent template codes, item keys, vendor ids, fund codes or expense-type codes: use only what
the catalogue in section 3 lists. When unsure, say so in \`warnings\` and lower \`confidence\` instead
of guessing. The association's administrator reviews every record before anything is written.

## 2. Domain glossary (what the documents say)

- **CUI / CIF / Cod fiscal** — the supplier's tax id; emit digits only (drop the "RO" prefix).
- **Factura seria … nr. …** — invoice series + number; emit as printed, e.g. "TM 12345678".
- **Data emiterii / Data facturii** — issue date. **Termen de plată / Scadență** — due date.
- **Perioada de facturare / Perioada de consum / Luna** — the billed service period; emit as
  \`YYYY-MM\` (start and end; equal for a one-month bill).
- **Total de plată / Total factură** — gross (with VAT). **Baza / Valoare fără TVA** — net. **TVA** — VAT.
  VAT rates seen on utilities: 9%, 19%, 21%. Gross-only invoices are fine: leave net/vat \`null\`.
- **Penalități / Majorări de întârziere** — late-payment penalties, usually a separate line; map them
  to a penalty item when the template has one.
- **Apă rece / potabilă**, **Canalizare / Canal**, **Apă meteo / pluvială**, **Curent scară / Energie
  electrică**, **Salubritate / Gunoi**, **Curățenie**, **Administrare**, **Comision bancar**, **Interfon**.
- e-Factura UBL XML: supplier under \`cac:AccountingSupplierParty\`, number \`cbc:ID\`, dates
  \`cbc:IssueDate\` / \`cbc:DueDate\`, totals under \`cac:LegalMonetaryTotal\` (\`cbc:PayableAmount\` = gross,
  \`cbc:TaxExclusiveAmount\` = net), invoice period under \`cac:InvoicePeriod\`.
- Bank statements: **Debit / Plăți** = money out (negative amount), **Credit / Încasări** = money in
  (positive). Keep the bank's own **referință / referinta tranzactiei** verbatim in \`reference\`.

## 3. Catalogue for ${c.community.code} / ${c.period.code}

### Bill templates (one supplier invoice each; map invoice lines onto these items)

${templateProse || '- (no templates configured)'}

### Expense types

Every item above points at an expense type; each expense type belongs to a fund. ${
    missingFund.length
      ? `⚠️ These expense types have **no fund configured** and cannot be applied until the admin fixes them: ${missingFund.join(', ')}.`
      : 'All expense types have a fund configured.'
  }

### Known vendors (echo the \`vendorId\` when you match one)

| vendorId | name | CUI | IBAN |
|---|---|---|---|
${vendorsTable}

### Invoices already recorded and still unpaid (do not re-import; flag as \`duplicateOf\`)

| number | vendor | gross | due |
|---|---|---|---|
${unpaidTable}

### Invoices recorded in the last 12 months (dedupe hints)

| number | vendor | gross | issued |
|---|---|---|---|
${recentTable}

### Machine-readable catalogue

\`\`\`json
${JSON.stringify(pc, null, 2)}
\`\`\`

## 4. Mapping guidelines

1. **One invoice → one \`INVOICE\` record.** Fill \`invoice\` with what the document says; fill \`mapping\`
   with how it lands in the association's books.
2. **Allocations are gross amounts in RON**, dot decimals, no thousands separators. Their sum should equal
   \`invoice.gross\`; if the document's own lines do not add up, explain in \`rationale\`.
3. **An invoice may span several templates.** A water bill from the same supplier may carry potable
   water + sewerage on one template and rain water on another — emit one allocation per item, across
   templates, on the same record.
4. **Pick the template by vendor first** (normalise "S.A.", "S.R.L.", diacritics), then by the items'
   labels. Never map to a template marked "already submitted this period".
5. **Vendor mapping**: \`match: "EXISTING"\` + \`vendorId\` from the catalogue when the name/CUI matches;
   \`"NEW"\` with name/CUI/IBAN when it is clearly a new supplier; \`"UNKNOWN"\` when you cannot tell.
6. **No fitting template** → leave \`allocations\` empty and set \`fallback\` with the best fund code and
   expense-type code from the catalogue. The invoice will be recorded without expense lines and the
   admin will decide.
7. **Duplicates**: if the number + vendor (or amount + date) matches an invoice in the tables above,
   still emit the record but set \`duplicateOf\` and lower confidence.
8. **Service period**: \`servicePeriodStart\`/\`End\` as \`YYYY-MM\`. Utilities are usually billed for the
   previous month; that is expected — do not "fix" it to ${c.period.code}.
9. **Bank statements** → one \`BANK_LINE\` record per line with \`mapping: null\` (this contract version
   only extracts them; the admin settles them separately). Signed amounts: money in positive, money
   out negative. Include opening/closing balance lines only if they are actual transactions.
10. **Confidence** is your honest estimate (0–1) that the record is complete and correctly mapped;
    add a one-sentence \`rationale\` and put every doubt into \`warnings\`.
11. Dates as \`YYYY-MM-DD\`. Currency as an ISO code. Use \`null\` for anything the document does not state.

## 5. Output contract (\`${CONTRACT_VERSION}\`)

Set \`contractVersion\` to \`"${CONTRACT_VERSION}"\`, \`promptVersion\` to \`"${PROMPT_VERSION}"\`,
\`community\` to \`"${c.community.code}"\`, \`periodCode\` to \`"${c.period.code}"\`. JSON Schema:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

### Worked example (shapes only — amounts are illustrative)

\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`

## 6. Deliver

Save the JSON as \`intake-${c.community.code}-${c.period.code}.json\` and upload it in the association's
**Intake** tab. The administrator will review, correct and approve each record there.
`
}

/** A realistic example built from the community's own catalogue, so the shapes match what it will see. */
export function buildExamplePayload(c: IntakeCatalogue): ImportPayload {
  const t0 = c.templates[0]
  const t1 = c.templates.find((t) => t.vendorName && t0 && t.vendorName === t0.vendorName && t.code !== t0.code)
  const v0 = c.vendors.find((v) => t0?.vendorName && v.name.toLowerCase().includes(t0.vendorName.toLowerCase())) ?? c.vendors[0]
  const items0 = t0?.items ?? []
  const allocations = [
    ...(items0[0] ? [{ templateCode: t0.code, itemKey: items0[0].key, amount: 412.3, reason: `${items0[0].label} line on the invoice` }] : []),
    ...(items0[1] ? [{ templateCode: t0.code, itemKey: items0[1].key, amount: 98.1, reason: `${items0[1].label} line` }] : []),
    ...(t1?.items[0] ? [{ templateCode: t1.code, itemKey: t1.items[0].key, amount: 30.6, reason: `${t1.items[0].label} is billed on the same invoice` }] : []),
  ]
  const gross = Number(allocations.reduce((s, a) => s + a.amount, 0).toFixed(2)) || 541
  const prev = prevPeriod(c.period.code)
  return {
    contractVersion: CONTRACT_VERSION,
    promptVersion: PROMPT_VERSION,
    community: c.community.code,
    periodCode: c.period.code,
    meta: { agent: 'claude-code / claude-opus-5', generatedAt: `${c.period.endDate}T10:00:00Z`, sourceArchive: `documente-${c.period.code}.zip`, notes: null },
    records: [
      {
        kind: 'INVOICE',
        sourceFile: 'factura-apa.pdf',
        sourceSha256: null,
        confidence: 0.92,
        rationale: `Vendor matches ${t0?.vendorName ?? 'the water template'}; lines map one-to-one onto template items.`,
        warnings: [],
        invoice: {
          vendorName: v0?.name ?? t0?.vendorName ?? 'Furnizor SA',
          vendorTaxId: v0?.taxId ?? '12345678',
          vendorIban: v0?.iban ?? null,
          number: 'TM 20260701234',
          issueDate: `${c.period.code}-05`,
          dueDate: `${c.period.code}-25`,
          servicePeriodStart: prev,
          servicePeriodEnd: prev,
          currency: 'RON',
          net: Number((gross / 1.09).toFixed(2)),
          vat: Number((gross - gross / 1.09).toFixed(2)),
          gross,
          lines: allocations.map((a) => ({ description: a.reason, quantity: null, unitPrice: null, net: null, vat: null, gross: a.amount })),
        },
        mapping: {
          vendor: { match: v0 ? 'EXISTING' : 'NEW', vendorId: v0?.id ?? null, name: v0?.name ?? t0?.vendorName ?? null, taxId: v0?.taxId ?? null, iban: null },
          allocations,
          fallback: null,
          duplicateOf: null,
        },
      },
      {
        kind: 'BANK_LINE',
        sourceFile: 'extras-cont.pdf',
        sourceSha256: null,
        confidence: 0.98,
        rationale: 'Clear credit line with a unit reference in the description.',
        warnings: [],
        bankLine: {
          account: { iban: 'RO49AAAA1B31007593840000', bankName: 'Banca Exemplu' },
          date: `${c.period.code}-03`,
          valueDate: `${c.period.code}-03`,
          amount: 350,
          currency: 'RON',
          counterpartyName: 'Popescu Ion',
          counterpartyIban: 'RO12BBBB0000000000000001',
          description: 'Intretinere ap 7 luna anterioara',
          reference: 'FT26183ABCDE',
          balanceAfter: 12850.4,
        },
        mapping: null,
      },
      {
        kind: 'OTHER',
        sourceFile: 'proces-verbal.pdf',
        sourceSha256: null,
        confidence: 0.7,
        rationale: 'Meeting minutes, not a financial document.',
        warnings: ['Skipped: not an invoice or a statement'],
        note: 'Proces-verbal adunare generală',
      },
    ],
  }
}

function prevPeriod(code: string) {
  const [y, m] = code.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
