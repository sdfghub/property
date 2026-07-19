// Central display registry for the app's fixed system taxonomies (enum code → label + hints).
// The backend owns these labels so the frontend never hardcodes domain knowledge — it fetches
// them from `GET /communities/:communityId/metadata`. The enum *values* still live in
// prisma/schema.prisma / the owning services; this file only adds their human-facing metadata.
// Where a validation list already exists (e.g. impact tags, channels), it derives its codes from
// the matching *_META here so there is a single source of truth for the code set.

export type EnumMeta = { key: string; label: string; hint?: string; tone?: string }

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

// Water-difference allocation methods (period.waterDifferenceMethod).
export const WATER_METHOD_META: EnumMeta[] = [
  { key: 'PROPORTIONAL', label: 'Proporțional' },
  { key: 'APA_DIF', label: 'Apă - diferență' },
]

/** Everything the frontend needs to render these taxonomies, served in one payload. */
export const COMMUNITY_METADATA = {
  roles: ROLE_META,
  governanceRoles: GOVERNANCE_ROLE_META,
  beRoles: BE_ROLE_META,
  notificationChannels: NOTIFICATION_CHANNEL_META,
  committeeDecisionStatuses: COMMITTEE_DECISION_STATUS_META,
  impactTags: IMPACT_TAG_META,
  audienceTypes: AUDIENCE_TYPE_META,
  meterModes: MEASURE_MODE_META,
  waterMethods: WATER_METHOD_META,
}

/** Helper for the validation Sets that used to hardcode their own code lists. */
export const metaKeys = (meta: EnumMeta[]): string[] => meta.map((m) => m.key)
