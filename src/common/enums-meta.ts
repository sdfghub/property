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
export const COMMUNITY_METADATA = {
  roles: ROLE_META,
  governanceRoles: GOVERNANCE_ROLE_META,
  beRoles: BE_ROLE_META,
  notificationChannels: NOTIFICATION_CHANNEL_META,
  committeeDecisionStatuses: COMMITTEE_DECISION_STATUS_META,
  correctionTypes: CORRECTION_TYPE_META,
  correctionStatuses: CORRECTION_STATUS_META,
  impactTags: IMPACT_TAG_META,
  audienceTypes: AUDIENCE_TYPE_META,
  meterModes: MEASURE_MODE_META,
  waterMethods: WATER_METHOD_META,
  fundDomains: FUND_DOMAIN_META,
  avizierFundGroups: AVIZIER_FUND_GROUP_META,
  riskTiers: RISK_TIER_META,
}

/** Helper for the validation Sets that used to hardcode their own code lists. */
export const metaKeys = (meta: EnumMeta[]): string[] => meta.map((m) => m.key)
