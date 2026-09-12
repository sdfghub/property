// Central display registry for the app's fixed system taxonomies (enum code → label + hints).
// The backend owns these labels so the frontend never hardcodes domain knowledge — it fetches
// them from `GET /communities/:communityId/metadata`. The enum *values* still live in
// prisma/schema.prisma / the owning services; this file only adds their human-facing metadata.
// Where a validation list already exists (e.g. impact tags, channels), it derives its codes from
// the matching *_META here so there is a single source of truth for the code set.

export type EnumMeta = { key: string; label: string; labelEn?: string; hint?: string; hintEn?: string; tone?: string }

// System/community roles — enum Role (prisma/schema.prisma). Labels mirror invite.service.roleLabel().
export const ROLE_META: EnumMeta[] = [
  { key: 'SYSTEM_ADMIN', label: 'Administrator sistem' },
  { key: 'COMMUNITY_ADMIN', label: 'Administrator asociație' },
  { key: 'CENSOR', label: 'Cenzor' },
  { key: 'EXECUTIVE_COMITEE_MEMBER', label: 'Comitet executiv' },
  { key: 'BILLING_ENTITY_USER', label: 'Proprietar / rezident' },
]

// Governance roles assignable to a community member via invites (subset of ROLE_META).
export const GOVERNANCE_ROLE_KEYS = ['COMMUNITY_ADMIN', 'CENSOR', 'EXECUTIVE_COMITEE_MEMBER']
export const GOVERNANCE_ROLE_META: EnumMeta[] = ROLE_META.filter((r) => GOVERNANCE_ROLE_KEYS.includes(r.key))

// Billing-entity roles — enum BillingEntityRole (prisma/schema.prisma).
export const BE_ROLE_META: EnumMeta[] = [
  { key: 'OWNER', label: 'Proprietar' },
  { key: 'RESIDENT', label: 'Rezident' },
  { key: 'EXPENSE_RESPONSIBLE', label: 'Responsabil cheltuieli' },
]

// Notification channels — enum NotificationChannel (prisma/schema.prisma).
export const NOTIFICATION_CHANNEL_META: EnumMeta[] = [
  { key: 'IN_APP', label: 'In-app' },
  { key: 'PUSH', label: 'Push' },
  { key: 'EMAIL', label: 'Email' },
]

// Committee decision statuses — enum CommitteeDecisionStatus. `tone` = the UI badge variant.
export const COMMITTEE_DECISION_STATUS_META: EnumMeta[] = [
  { key: 'OPEN', label: 'Deschis', tone: 'tertiary' },
  { key: 'APPROVED', label: 'Aprobat', tone: 'positive' },
  { key: 'REJECTED', label: 'Respins', tone: 'negative' },
  { key: 'CANCELLED', label: 'Anulat', tone: 'secondary' },
]

// Correction types — enum CorrectionType. `hint` is the plain-language definition shown to admins
// (locked wording — see docs/corrections.md if this drifts from the derivation logic).
//
// RESHUFFLE_TRUEUP is NOT a real CorrectionType — it's a display-only pseudo-key. RESHUFFLE covers two
// real-world situations that share one mechanism (one charge amount per unit): a true redistribution of
// an already-existing total (net ≈ 0, small differences are rounding) vs. a true-up of an estimated
// amount against the real one (net is a genuine new sum, e.g. correcting a 12 lei estimate to a real
// 136 lei fee). The frontend picks RESHUFFLE vs RESHUFFLE_TRUEUP for display based on the net amount's
// size — `type` sent to the backend is always RESHUFFLE either way.
export const CORRECTION_TYPE_META: EnumMeta[] = [
  { key: 'RESHUFFLE', label: 'Redistribuire', labelEn: 'Redistribution',
    hint: 'O sumă deja existentă e împărțită din nou între unități — de exemplu când se recalculează cotele-parte. Suma totală rămâne aproape aceeași; diferențele mici (de obicei câțiva lei) vin din rotunjiri, nu sunt bani în plus.',
    hintEn: 'An existing amount gets split across units again — e.g. when ownership shares are recalculated. The total stays about the same; small differences (usually a few lei) come from rounding, not real extra charges.' },
  { key: 'RESHUFFLE_TRUEUP', label: 'Regularizare', labelEn: 'True-up',
    hint: 'Corectează o sumă estimată cu suma reală, odată ce aceasta e cunoscută — de exemplu un comision bancar estimat la 12 lei, dar suma reală a fost 136 lei; diferența se regularizează, împărțită pe unități după cotă-parte.',
    hintEn: 'Corrects an estimated amount once the real one is known — e.g. a bank fee estimated at 12 lei but really 136 lei; the difference is billed, split across units by ownership share.' },
  { key: 'CREDIT_TRANSFER', label: 'Transfer de credit', labelEn: 'Credit transfer',
    hint: 'O unitate are bani în plus (credit) într-un fond, folosit să-i scadă din ce mai are de plătit.',
    hintEn: "A unit has a credit surplus in a fund, used to reduce what it still owes there." },
  { key: 'PAYMENT_REATTRIB', label: 'Reatribuire plată', labelEn: 'Payment reattribution',
    hint: 'O plată a fost înregistrată din greșeală la alt fond. Corecția o scoate de acolo.',
    hintEn: 'A payment was recorded against the wrong fund by mistake. The correction removes it from there.' },
  { key: 'PENALTY_WRITEOFF', label: 'Scutire penalizări', labelEn: 'Penalty write-off',
    hint: 'Se anulează (se iartă) penalizările de întârziere ale unei unități.',
    hintEn: "Cancels (forgives) a unit's late-payment penalties." },
  { key: 'MANUAL_ADJUSTMENT', label: 'Ajustare manuală sold', labelEn: 'Manual balance adjustment',
    hint: 'O corecție simplă, la o singură unitate și un singur fond.',
    hintEn: 'A simple correction to one unit, on one fund.' },
  { key: 'OWNERSHIP_TRANSFER', label: 'Transfer proprietate', labelEn: 'Ownership transfer',
    hint: 'Restanța unei unități trece de la fostul proprietar la noul proprietar, la schimbarea proprietarului.',
    hintEn: "A unit's outstanding balance moves from the old owner to the new owner, at an ownership change." },
]

// Correction statuses — enum CorrectionStatus.
export const CORRECTION_STATUS_META: EnumMeta[] = [
  { key: 'ACTIVE', label: 'Activă', labelEn: 'Active', tone: 'positive' },
  { key: 'VOID', label: 'Anulată', labelEn: 'Voided', tone: 'secondary' },
  { key: 'TODO', label: 'De atribuit', labelEn: 'To be attached', tone: 'warning', hint: 'Declarată, dar neatribuită încă unei perioade — nu afectează niciun avizier', hintEn: 'Declared but not yet attached to a period — does not affect any avizier' },
]

// Announcement impact tags — enum AnnouncementImpactTag.
export const IMPACT_TAG_META: EnumMeta[] = [
  { key: 'WATER', label: 'Apă' },
  { key: 'HEAT', label: 'Căldură' },
  { key: 'ELEVATOR', label: 'Lift' },
  { key: 'ELECTRICITY', label: 'Electricitate' },
  { key: 'ACCESS', label: 'Acces' },
  { key: 'OTHER', label: 'Altele' },
]

// Solicitări (Ticket.type = 'REQUEST') classification — who/what the request concerns.
// Enum TicketImpact.
export const TICKET_IMPACT_META: EnumMeta[] = [
  { key: 'NUMAR_PERSOANE', label: 'Număr persoane', labelEn: 'Number of people' },
  { key: 'PROPRIETAR', label: 'Proprietar', labelEn: 'Owner' },
  { key: 'CHIRIAS', label: 'Chiriaș', labelEn: 'Tenant' },
  { key: 'SERVICII', label: 'Servicii', labelEn: 'Services' },
  { key: 'INFORMATII', label: 'Informații', labelEn: 'Information' },
  { key: 'ADEVERINTA', label: 'Adeverință', labelEn: 'Certificate' },
  { key: 'LUCRARI_TEHNICE', label: 'Lucrări tehnice', labelEn: 'Technical works' },
]

// Solicitări (Ticket.type = 'REQUEST') classification — the kind of request. Enum TicketRequestKind.
export const TICKET_REQUEST_KIND_META: EnumMeta[] = [
  { key: 'SCHIMBARE', label: 'Schimbare', labelEn: 'Change' },
  { key: 'DEFECTIUNE', label: 'Defecțiune', labelEn: 'Malfunction' },
  { key: 'ACORD', label: 'Acord', labelEn: 'Agreement' },
  { key: 'ALTELE', label: 'Altele', labelEn: 'Other' },
]

// Announcement audience types — enum AnnouncementAudienceType.
export const AUDIENCE_TYPE_META: EnumMeta[] = [
  { key: 'COMMUNITY', label: 'Toată asociația' },
  { key: 'UNIT_GROUP', label: 'Grup de unități' },
]

// Meter measurement modes (billing/template.service.resolveMeasureMode).
export const MEASURE_MODE_META: EnumMeta[] = [
  { key: 'CONSUMPTION', label: 'Consum' },
  { key: 'INDEX', label: 'Index' },
]

// Water-difference allocation methods (period.waterDifferenceMethod). `hint` is the longer
// description used in the close-period picker.
export const WATER_METHOD_META: EnumMeta[] = [
  { key: 'PROPORTIONAL', label: 'Proporțional', hint: 'Proporțional cu consumul (o linie)' },
  { key: 'APA_DIF', label: 'Apă - diferență', hint: 'Contorizat + diferență separată (apa-dif)' },
]

// Expense allocation methods (AllocationRule.method) — how a service's cost is split across
// billing entities. The rule's own `name` (community-specific, e.g. "După consumul de apă rece")
// is the precise description shown to admins; this is only the generic fallback/category label.
export const ALLOCATION_METHOD_META: EnumMeta[] = [
  { key: 'EQUAL', label: 'În mod egal', hint: 'Împărțit egal între toate unitățile' },
  { key: 'BY_SQM', label: 'După cota-parte / suprafață', hint: 'Proporțional cu suprafața sau cota-parte indiviză' },
  { key: 'BY_RESIDENTS', label: 'După numărul de persoane', hint: 'Proporțional cu numărul de persoane din unitate' },
  { key: 'BY_CONSUMPTION', label: 'După consum', hint: 'Proporțional cu consumul măsurat (contor)' },
  { key: 'MIXED', label: 'Metodă mixtă', hint: 'Combinație a mai multor criterii' },
]

// Fund domains — the strategic grouping a fund belongs to, read from `Fund.allocation.type`
// (see data/<COMM>/funds.json). Not a Prisma enum: the value lives in the allocation JSON, so
// `key` here is the lowercased form and matching is case-insensitive. Funds whose allocation
// carries no `type` fall back to `other` rather than being dropped from reports.
// `sortOrder` drives the display order (operational money first, long-horizon funds last).
export const FUND_DOMAIN_META: (EnumMeta & { sortOrder: number })[] = [
  { key: 'operational', label: 'Operațional', hint: 'Cheltuieli curente și fond de rulment', sortOrder: 0 },
  { key: 'tactic', label: 'Tactic', hint: 'Fonduri pe termen mediu (reparații)', sortOrder: 1 },
  { key: 'strategic', label: 'Strategic', hint: 'Fonduri de investiții pe termen lung (reabilitare)', sortOrder: 2 },
  { key: 'other', label: 'Altele', hint: 'Fonduri fără domeniu configurat', sortOrder: 9 },
]

// Avizier fund grouping — the coarse buckets the avizier groups its fund columns under, distinct
// from the report's FUND_DOMAIN_META (which is a 4-way strategic taxonomy). Here services
// (Întreținere) and penalties stand apart, and the remaining contribution funds collapse into just
// two buckets the way owners read the notice: operating funds vs. rehabilitation funds. Note the
// intended mapping puts REPARATII (a Tactic fund in FUND_DOMAIN_META) under `operational`, so this
// is deliberately its own taxonomy. Membership is derived (not per-code hardcoded): a contribution
// fund whose domain is `strategic` → `reabilitare`, otherwise → `operational`; the services fund and
// the penalties fund get their own buckets.
export const AVIZIER_FUND_GROUP_META: (EnumMeta & { sortOrder: number })[] = [
  { key: 'intretinere', label: 'Întreținere', hint: 'Servicii curente (cheltuieli lunare)', sortOrder: 0 },
  { key: 'operational', label: 'Fond Operațional', hint: 'Rulment, reparații', sortOrder: 1 },
  { key: 'reabilitare', label: 'Fond Reabilitare', hint: 'Proiectare + reabilitare, pod + fațadă, reabilitare 3', sortOrder: 2 },
  { key: 'penalizari', label: 'Penalizări', hint: 'Penalizări de întârziere, pe fond', sortOrder: 9 },
]

// Risk-exposure tiers (#13) — the escalation an arrears reaches by age, measured in days overdue
// from the scadență (due date). `maxDays` is the inclusive upper bound of the tier (null = open-ended);
// `action` names the legal step the tier warrants. `tone` maps to the UI severity colours.
export const RISK_TIER_META: (EnumMeta & { sortOrder: number; maxDays: number | null; action: string })[] = [
  { key: 'none', label: 'Fără risc', hint: '0–30 zile — în termen', sortOrder: 0, maxDays: 30, action: 'Fără acțiune', tone: 'success' },
  { key: 'penalty', label: 'Penalități', hint: '31–59 zile — se acumulează penalizări', sortOrder: 1, maxDays: 59, action: 'Penalități', tone: 'warning' },
  { key: 'cf', label: 'Sarcină în CF', hint: '60–119 zile — înscriere în Cartea Funciară', sortOrder: 2, maxDays: 119, action: 'Înscriere sarcină în Cartea Funciară', tone: 'orange' },
  { key: 'court', label: 'Acțiune în instanță', hint: '≥120 zile', sortOrder: 3, maxDays: null, action: 'Acționare în instanță', tone: 'destructive' },
]

/** Everything the frontend needs to render these taxonomies, served in one payload. */
// AI intake — enum IntakeBatchStatus / IntakeRecordKind / IntakeRecordStatus (prisma/schema.prisma) and
// the blocker codes computed by src/modules/intake/intake-import.service.ts. `overridable` blockers can
// be acknowledged by the admin on approve; hard ones must be fixed (in the JSON or in the community
// setup) before a record can be applied. See docs/intake.md.
export const INTAKE_BATCH_STATUS_META: EnumMeta[] = [
  { key: 'REVIEW', label: 'În revizuire', labelEn: 'In review', tone: 'warning' },
  { key: 'APPLYING', label: 'Se aplică', labelEn: 'Applying', tone: 'warning' },
  { key: 'APPLIED', label: 'Aplicat', labelEn: 'Applied', tone: 'positive' },
  { key: 'FAILED', label: 'Eșuat', labelEn: 'Failed', tone: 'negative' },
]

export const INTAKE_RECORD_KIND_META: EnumMeta[] = [
  { key: 'INVOICE', label: 'Factură', labelEn: 'Invoice' },
  { key: 'BANK_LINE', label: 'Linie extras bancar', labelEn: 'Bank statement line' },
  { key: 'OTHER', label: 'Alt document', labelEn: 'Other document' },
]

export const INTAKE_BANK_TARGET_META: EnumMeta[] = [
  { key: 'OWNER_PAYMENT', label: 'Încasare proprietar', labelEn: 'Owner receipt', hint: 'Plată de la un proprietar; se repartizează pe debitele deschise după regula asociației.', hintEn: 'Payment from an owner; spread over open charges by the community rule.' },
  { key: 'VENDOR_SETTLEMENT', label: 'Plată factură', labelEn: 'Vendor settlement', hint: 'Achită una sau mai multe facturi de furnizor.', hintEn: 'Settles one or more vendor invoices.' },
  { key: 'CASH_TX', label: 'Tranzacție de casă', labelEn: 'Cash transaction', hint: 'Comisioane, transferuri, ajustări — pe un fond, fără factură.', hintEn: 'Fees, transfers, adjustments — on a fund, without an invoice.' },
  { key: 'IGNORE', label: 'Ignoră', labelEn: 'Ignore', hint: 'Linia nu se contabilizează (ex. transfer între conturile proprii).', hintEn: 'The line is not booked (e.g. a transfer between own accounts).' },
]

export const INTAKE_RECORD_STATUS_META: EnumMeta[] = [
  { key: 'PROPOSED', label: 'Propus', labelEn: 'Proposed', hint: 'Fără probleme detectate; poate fi aprobat.', hintEn: 'No issues detected; can be approved.' },
  { key: 'NEEDS_REVIEW', label: 'De verificat', labelEn: 'Needs review', tone: 'warning', hint: 'Are blocaje sau avertismente de rezolvat.', hintEn: 'Has blockers or warnings to resolve.' },
  { key: 'APPROVED', label: 'Aprobat', labelEn: 'Approved', tone: 'positive' },
  { key: 'STAGED', label: 'În așteptare citiri', labelEn: 'Waiting for readings', tone: 'warning', hint: 'Sumele sunt puse pe template (FILLED), dar factura și cheltuielile se creează abia după introducerea citirilor de contoare — apăsați din nou Aplică atunci.', hintEn: 'Amounts are on the template (FILLED); the invoice and expense lines are created once the meter readings exist — press Apply again then.' },
  { key: 'APPLIED', label: 'Aplicat', labelEn: 'Applied', tone: 'positive', hint: 'Factura și cheltuielile au fost create.', hintEn: 'Invoice and expenses were created.' },
  { key: 'SKIPPED', label: 'Omis', labelEn: 'Skipped' },
  { key: 'FAILED', label: 'Eșuat', labelEn: 'Failed', tone: 'negative' },
]

export const INTAKE_BLOCKER_META: (EnumMeta & { overridable: boolean })[] = [
  // hard — apply always refuses
  { key: 'NO_ALLOCATION', overridable: false, tone: 'negative', label: 'Fără alocare', labelEn: 'No allocation', hint: 'Factura nu are nicio linie de template și nici fond/tip de cheltuială de rezervă.', hintEn: 'The invoice has no template allocation and no fallback fund/expense type.' },
  { key: 'UNKNOWN_TEMPLATE', overridable: false, tone: 'negative', label: 'Template necunoscut', labelEn: 'Unknown template', hint: 'Codul de template nu există în această asociație.', hintEn: 'The template code does not exist in this community.' },
  { key: 'UNKNOWN_ITEM', overridable: false, tone: 'negative', label: 'Linie de template necunoscută', labelEn: 'Unknown template item', hint: 'Cheia liniei nu există în template.', hintEn: 'The item key does not exist on that template.' },
  { key: 'EXPENSE_TYPE_NO_FUND', overridable: false, tone: 'negative', label: 'Tip de cheltuială fără fond', labelEn: 'Expense type without fund', hint: 'Tipul de cheltuială nu are fundCode configurat — configurați-l înainte de aplicare.', hintEn: 'The expense type has no fundCode configured — set it up before applying.' },
  { key: 'UNKNOWN_FUND', overridable: false, tone: 'negative', label: 'Fond necunoscut', labelEn: 'Unknown fund' },
  { key: 'UNKNOWN_EXPENSE_TYPE', overridable: false, tone: 'negative', label: 'Tip de cheltuială necunoscut', labelEn: 'Unknown expense type' },
  { key: 'PERIOD_NOT_OPEN', overridable: false, tone: 'negative', label: 'Perioada nu este deschisă', labelEn: 'Period not open', hint: 'Importul se aplică doar într-o perioadă OPEN.', hintEn: 'Intake applies only into an OPEN period.' },
  { key: 'TEMPLATE_ALREADY_SUBMITTED', overridable: false, tone: 'negative', label: 'Template deja trimis', labelEn: 'Template already submitted', hint: 'Există deja o factură creată din acest template în perioada aleasă.', hintEn: 'An invoice was already created from this template in the chosen period.' },
  { key: 'PHASE2_UNSUPPORTED', overridable: false, label: 'Neacceptat', labelEn: 'Not supported', hint: 'Acest tip de document se poate doar omite.', hintEn: 'This kind of document can only be skipped.' },
  // bank lines — hard
  { key: 'NO_PROPOSAL', overridable: false, tone: 'negative', label: 'Fără propunere', labelEn: 'No proposal', hint: 'Agentul nu a spus cum se contabilizează linia — completați în panou.', hintEn: 'The agent gave no mapping for this line — fill it in the drawer.' },
  { key: 'ACCOUNT_UNKNOWN', overridable: false, tone: 'negative', label: 'Cont bancar nerezolvat', labelEn: 'Cash account unresolved', hint: 'Niciun cont (sau mai multe) cu moneda extrasului — alegeți contul.', hintEn: 'No cash account (or several) for the statement currency — pick the account.' },
  { key: 'UNIT_UNKNOWN', overridable: false, tone: 'negative', label: 'Apartament necunoscut', labelEn: 'Unknown unit', hint: 'Codul de apartament nu există în asociație.', hintEn: 'The unit code does not exist in this community.' },
  { key: 'UNIT_UNSPECIFIED', overridable: false, tone: 'negative', label: 'Apartament nespecificat', labelEn: 'Unit not identified', hint: 'Linia nu spune ce apartament plătește și niciun proprietar nu se potrivește cu plătitorul — alegeți apartamentul.', hintEn: 'The line does not say which unit pays and no owner matches the payer — pick the unit.' },
  { key: 'OWNER_UNKNOWN', overridable: false, tone: 'negative', label: 'Fără proprietar în perioadă', labelEn: 'No owner in period', hint: 'Apartamentul nu are entitate de facturare în perioada țintă.', hintEn: 'The unit has no billing entity as of the target period.' },
  { key: 'FUND_UNKNOWN', overridable: false, tone: 'negative', label: 'Fond necunoscut', labelEn: 'Unknown fund' },
  { key: 'FUNDS_EXCEED_AMOUNT', overridable: false, tone: 'negative', label: 'Fondurile depășesc suma', labelEn: 'Named funds exceed the amount' },
  { key: 'AMOUNT_SIGN', overridable: false, tone: 'negative', label: 'Semn greșit', labelEn: 'Wrong sign', hint: 'Încasările de la proprietari sunt intrări; plățile către furnizori sunt ieșiri.', hintEn: 'Owner receipts are money in; supplier settlements are money out.' },
  { key: 'DUPLICATE_PAYMENT', overridable: false, tone: 'negative', label: 'Încasare deja înregistrată', labelEn: 'Payment already booked', hint: 'O încasare cu această referință bancară există deja (ex. importată din registrul de casă).', hintEn: 'A payment with this bank reference already exists (e.g. imported from the cash register).' },
  { key: 'DUPLICATE_SETTLEMENT', overridable: false, tone: 'negative', label: 'Plată furnizor deja înregistrată', labelEn: 'Settlement already booked' },
  { key: 'DUPLICATE_CASH_TX', overridable: false, tone: 'negative', label: 'Tranzacție deja înregistrată', labelEn: 'Cash transaction already booked' },
  { key: 'INVOICE_AMBIGUOUS', overridable: false, tone: 'negative', label: 'Factură ambiguă', labelEn: 'Ambiguous invoice', hint: 'Numărul citat se potrivește cu facturi ale mai multor furnizori — alegeți factura.', hintEn: 'The quoted number matches invoices of several vendors — pick the invoice.' },
  // bank lines — acknowledgeable
  { key: 'UNIT_SUGGESTED', overridable: true, tone: 'warning', label: 'Apartament dedus din plătitor', labelEn: 'Unit inferred from payer', hint: 'Linia nu numește apartamentul; a fost dedus din numele plătitorului — confirmați.', hintEn: 'The line names no unit; it was inferred from the payer name — confirm.' },
  { key: 'CYCLE_MISMATCH', overridable: true, tone: 'warning', label: 'Luna încasării diferă', labelEn: 'Cycle month differs', hint: 'Luna numită în descriere nu este perioada țintă sau una recentă.', hintEn: 'The month named in the description is not the target period or a recent one.' },
  { key: 'INVOICE_NOT_FOUND', overridable: true, tone: 'warning', label: 'Factura nu e în evidență', labelEn: 'Invoice not in the books', hint: 'Numărul citat nu e printre facturile neplătite — la confirmare se înregistrează ca plată din fond, fără factură.', hintEn: 'The quoted number is not among unpaid invoices — on ack it is booked as a fund payment without an invoice.' },
  { key: 'SETTLEMENT_EXCEEDS_OUTSTANDING', overridable: true, tone: 'warning', label: 'Plata depășește restul de plată', labelEn: 'Settlement exceeds outstanding' },
  // overridable — admin can acknowledge on approve
  { key: 'VENDOR_UNKNOWN', overridable: true, tone: 'warning', label: 'Furnizor necunoscut', labelEn: 'Unknown vendor', hint: 'Furnizorul va fi creat la aplicare.', hintEn: 'The vendor will be created on apply.' },
  { key: 'VENDOR_MISMATCH', overridable: true, tone: 'warning', label: 'Furnizor diferit de template', labelEn: 'Vendor differs from template', hint: 'Template-ul are alt furnizor configurat; factura se creează pe furnizorul template-ului.', hintEn: 'The template is configured for another vendor; the invoice is created on the template vendor.' },
  { key: 'AMOUNT_MISMATCH', overridable: true, tone: 'warning', label: 'Net + TVA ≠ brut', labelEn: 'Net + VAT ≠ gross' },
  { key: 'ALLOCATION_SUM_MISMATCH', overridable: true, tone: 'warning', label: 'Suma alocărilor ≠ brut', labelEn: 'Allocations ≠ gross' },
  { key: 'PERIOD_MISMATCH', overridable: true, tone: 'warning', label: 'Perioada de serviciu diferă', labelEn: 'Service period differs', hint: 'Perioada facturată nu coincide cu perioada țintă.', hintEn: 'The billed service period does not match the target period.' },
  { key: 'VALUE_CONFLICT', overridable: true, tone: 'warning', label: 'Valoare deja completată', labelEn: 'Value already filled', hint: 'Template-ul are deja o altă valoare introdusă manual pentru această linie.', hintEn: 'The template already holds a different hand-entered value for this line.' },
  { key: 'DUPLICATE_IN_BATCH', overridable: true, tone: 'warning', label: 'Duplicat în lot', labelEn: 'Duplicate in batch' },
  { key: 'DUPLICATE_INVOICE', overridable: true, tone: 'warning', label: 'Factură existentă', labelEn: 'Existing invoice', hint: 'O factură cu același număr și furnizor există deja.', hintEn: 'An invoice with the same number and vendor already exists.' },
  { key: 'LOW_CONFIDENCE', overridable: true, tone: 'warning', label: 'Încredere scăzută', labelEn: 'Low confidence' },
]

export const COMMUNITY_METADATA = {
  roles: ROLE_META,
  governanceRoles: GOVERNANCE_ROLE_META,
  beRoles: BE_ROLE_META,
  notificationChannels: NOTIFICATION_CHANNEL_META,
  committeeDecisionStatuses: COMMITTEE_DECISION_STATUS_META,
  correctionTypes: CORRECTION_TYPE_META,
  correctionStatuses: CORRECTION_STATUS_META,
  impactTags: IMPACT_TAG_META,
  requestImpacts: TICKET_IMPACT_META,
  requestKinds: TICKET_REQUEST_KIND_META,
  audienceTypes: AUDIENCE_TYPE_META,
  meterModes: MEASURE_MODE_META,
  waterMethods: WATER_METHOD_META,
  allocationMethods: ALLOCATION_METHOD_META,
  fundDomains: FUND_DOMAIN_META,
  avizierFundGroups: AVIZIER_FUND_GROUP_META,
  riskTiers: RISK_TIER_META,
  intakeBatchStatuses: INTAKE_BATCH_STATUS_META,
  intakeRecordKinds: INTAKE_RECORD_KIND_META,
  intakeRecordStatuses: INTAKE_RECORD_STATUS_META,
  intakeBlockers: INTAKE_BLOCKER_META,
  intakeBankTargets: INTAKE_BANK_TARGET_META,
}

/** Helper for the validation Sets that used to hardcode their own code lists. */
export const metaKeys = (meta: EnumMeta[]): string[] => meta.map((m) => m.key)
