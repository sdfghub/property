import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata, labelOf } from '../../hooks/useMetadata'
import { API_BASE } from '../../api/client'

// #12 "Informații Asociație" — legal identity, bank accounts, governance (AGA/CEX), and
// administrator, over GET/PATCH /communities/:id/association-info. The data lives under
// Community.features.associationInfo (a JSON blob, same convention as avizierConfig) — there's no
// dedicated schema for it, so every field here is optional and renders as "—" until an admin fills
// it in via the edit form.
type BankAccount = { bank: string; currency: string; iban: string }
type LegalRep = { name: string; title: string; phone: string; email: string }
type BoardMember = { name: string; role: string }
type Administrator = { company: string; rep: string; hours: string; phone: string; email: string; address: string }
type RoiTier = { key: string; label: string; tone: 'positive' | 'warning' | 'orange' | 'negative'; rangeLabel: string; actionTitle: string; actionDesc: string }
type RoiPolicy = { description: string | null; tiers: RoiTier[] }
// serviceCodes holds real ExpenseType.code values (from GET .../finance/expense-catalog), never
// stored labels — so the list can't drift from real billing — in the exact display order the
// admin chose; that order is what the avizier itself uses for its expense-type columns.
type ServiceDomain = { key: string; name: string; serviceCodes: string[] }
type ServiceConfig = { domains: ServiceDomain[] }
type SplitStep = { id: string; name: string; isDifference: boolean; formula: string }
type CatalogExpenseType = {
  code: string; name: string; ruleId: string; rule: { method: string; name: string | null }
  fundCode: string | null; fundName: string | null; fundDomain: string | null
  splitSteps: SplitStep[]
}
type MeterReading = { totalValue: number | null; meteredValue: number | null; residualValue: number | null; unit: string | null }
type CatalogSynthetic = { code: string; label: string; anchorCode: string; contributingCodes: string[]; formula: string; reading: MeterReading | null }
type ExpenseCatalog = { expenseTypes: CatalogExpenseType[]; synthetic: CatalogSynthetic[]; period: { code: string } | null }
const emptyCatalog: ExpenseCatalog = { expenseTypes: [], synthetic: [], period: null }
// GET /community-funds/:communityCode — the same public endpoint FundsTab uses, returning full
// Fund rows including the raw `allocation` JSON (see data/<COMM>/funds.json for the source shape).
type FundAllocation = {
  type?: string | null
  method?: string | null
  split?: string | null
  penaltyPerDayPct?: number | null
  penaltyFundCode?: string | null
  // Date-anchored schedule the penalty engine actually resolves each debt's rate from (see
  // PenaltyLedgerService#advance / penalty-rate.ts's rateForDate) — each entry's rate applies from
  // its own `from` date up to (not including) the next entry's, the last one open-ended. When
  // present this is the source of truth; `penaltyPerDayPct` above is just its current/fallback rate.
  penaltyRateHistory?: Array<{ from: string; ratePerDayPct: number }> | null
  altName?: string | null
  shortName?: string | null
  abbrev?: string | null
  eur?: { curs: number; amount: number } | null
}
type FundRow = {
  id: string; code: string; name?: string | null; description?: string | null; status?: string | null
  // totalTarget comes over the wire as a string (Prisma Decimal serialized via JSON).
  currency?: string | null; totalTarget?: string | number | null; startPeriodCode?: string | null
  targetPlan?: { periodCount: number; perPeriodAmount: number } | null
  allocation?: FundAllocation | null
}
// The admin's chosen display order for funds — real Fund.code values, same "declared order, not
// stored per-entity" convention as serviceConfig.domains' serviceCodes ordering.
type FundConfig = { order: string[] }
// GET /communities/:id/vendors — real Vendor rows (name/contract are editable there; invoiceCount
// is read-only context, computed server-side from VendorInvoice).
type VendorRow = { id: string; name: string; contract?: string | null; taxId?: string | null; iban?: string | null; invoiceCount: number }
// GET /communities/:id/billing-entities/detailed — owners (billing entities) with their linked
// units and each unit's CPI (cotă parte indiviză) share.
// `type` is the association's own "Unit Definitions" registry taxonomy (Apartament, SAD, Boxa,
// Cale Evacuare, Cale Acces, Estetice si structurale, Tehnice, Depozitare, Functionale) — a real
// stored string, not a fixed union, since it's read straight from that source.
type OwnerHistoryEntry = { name: string; startPeriodCode: string | null; endPeriodCode: string | null; current: boolean }
type TenantHistoryEntry = { name: string; source: 'MANUAL' | 'INFERRED'; confirmed: boolean }
type UnitRow = {
  code: string; label: string; type: string; cpiPct: number | null
  floorNumber?: number | null; floorName?: string | null; staircase?: string | null; location?: string | null
  surfaceMp?: number | null; cfCode?: string | null
  owner?: string | null; tenant?: string | null; propertyManager?: string | null; propertyManagerPhone?: string | null; propertyManagerEmail?: string | null
  mainContact?: string | null; billingEntityCode?: string | null
  ownerHistory?: OwnerHistoryEntry[]; tenantHistory?: TenantHistoryEntry[]
}
type UnitGroupRow = { id: string; code: string; name: string; units: UnitRow[]; totalCpiPct: number }
type UnitsSummary = {
  groups: UnitGroupRow[]; totalUnits: number; totalGroups: number; totalCpiPct: number
  totalBoxes?: number; totalCommonSpaces?: number
}
const emptyUnitsSummary: UnitsSummary = { groups: [], totalUnits: 0, totalGroups: 0, totalCpiPct: 0 }
// GET /communities/:id/tenants — a real, unconfirmed-until-reviewed tenant candidate for one
// specific unit (inferred from the cash register's payer names — see the backend's detectTenants
// for how, or entered manually). Owner comes straight from the unit's `owner`/`mainContact` fields
// (from BillingEntity.name/primaryOwnerName); property manager is the unit's own
// propertyManagerName/Phone/Email — neither needs a list here, only tenancy does.
type TenantRow = {
  id: string; name: string; phone?: string | null; email?: string | null
  unitId: string; unitCode: string; unitLabel: string
  source: 'MANUAL' | 'INFERRED'; confirmed: boolean
}
type AssociationInfo = {
  name: string
  address: string | null
  legalName: string | null
  statutStatus: string | null
  foundingDate: string | null
  actConstitutivNr: string | null
  acordAsociereNr: string | null
  acordAsociereDate: string | null
  cif: string | null
  bankAccounts: BankAccount[]
  legalRep: LegalRep | null
  aga: { lastMeeting: string | null; nextMeeting: string | null }
  boardMembers: BoardMember[]
  administrator: Administrator | null
  roiPolicy: RoiPolicy
  serviceConfig: ServiceConfig
  fundConfig: FundConfig
  vendorConfig: FundConfig
}
const emptyInfo = (name: string): AssociationInfo => ({
  name, address: null, legalName: null, statutStatus: null, foundingDate: null, actConstitutivNr: null,
  acordAsociereNr: null, acordAsociereDate: null, cif: null, bankAccounts: [], legalRep: null,
  aga: { lastMeeting: null, nextMeeting: null }, boardMembers: [], administrator: null,
  roiPolicy: { description: null, tiers: [] }, serviceConfig: { domains: [] }, fundConfig: { order: [] }, vendorConfig: { order: [] },
})
const RISK_DOT_COLOR: Record<RoiTier['tone'], string> = {
  positive: 'var(--accent-2, #34c759)', warning: '#e6b800', orange: '#e67e22', negative: 'var(--danger, #d32f2f)',
}

// Read-only "how it's computed" detail for a real service — its AllocationRule (the community-
// specific name, e.g. "După consumul de apă rece", plus the generic method category from
// /metadata's allocationMethods) and which fund it settles into. Purely descriptive, no editing.
function ServiceComputationDetail({ e, meta, t }: { e: CatalogExpenseType; meta: ReturnType<typeof useMetadata>; t: (k: string, d?: string) => string }) {
  const generic = labelOf(meta?.allocationMethods, e.rule.method)
  const specific = e.rule.name && e.rule.name !== generic ? e.rule.name : null
  return (
    <div className="stack" style={{ gap: 3, padding: '2px 16px 12px 16px', fontSize: 12.5 }}>
      <div>
        <span className="muted">{t('assocInfo.serviceMethod', 'Metodă de calcul')}: </span>
        {specific ?? generic}
        {specific && <span className="muted"> ({generic})</span>}
      </div>
      {e.fundName && (
        <div><span className="muted">{t('assocInfo.serviceFund', 'Se încasează în fondul')}: </span>{e.fundName}</div>
      )}
      {e.splitSteps.length > 0 && (
        <div className="stack" style={{ gap: 6, marginTop: 2 }}>
          <span className="muted">{t('assocInfo.serviceSplitSteps', 'Suma se împarte în')}:</span>
          {e.splitSteps.map((s) => (
            <div key={s.id} style={{ paddingLeft: 10, borderLeft: '2px solid var(--border)' }}>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              {s.formula && <div className="muted" style={{ fontSize: 12 }}>{s.formula}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Read-only detail for the synthetic Apă-diferență column — which real services' difference
// portions it actually sums, and the exact formula (both backend-computed — see
// finance.service.ts's expenseCatalog: contributingCodes / syntheticFormula).
function SyntheticComputationDetail({ s, catalog, t, lang }: { s: CatalogSynthetic; catalog: ExpenseCatalog; t: (k: string, d?: string) => string; lang: string }) {
  const names = s.contributingCodes.map((c) => catalog.expenseTypes.find((e) => e.code === c)?.name).filter(Boolean)
  const fmt = (v: number | null) => v == null ? '—' : v.toLocaleString(lang === 'ro' ? 'ro-RO' : 'en-US', { maximumFractionDigits: 3 })
  const r = s.reading
  return (
    <div className="stack" style={{ gap: 3, padding: '2px 16px 12px 16px', fontSize: 12.5 }}>
      <div>{s.formula || t('assocInfo.serviceDiffExplain', 'Diferența dintre contorul general al asociației și suma contoarelor individuale, redistribuită proporțional cu consumul propriu al fiecărei unități.')}</div>
      {names.length > 0 && (
        <div><span className="muted">{t('assocInfo.serviceDiffContributors', 'Include diferența de la')}: </span>{names.join(', ')}</div>
      )}
      {r && (r.totalValue != null || r.meteredValue != null) && (
        <div style={{ marginTop: 2 }}>
          <span className="muted">
            {t('assocInfo.serviceDiffValues', 'Valori curente')}{catalog.period ? ` (${catalog.period.code})` : ''}:{' '}
          </span>
          {fmt(r.totalValue)} {r.unit} − {fmt(r.meteredValue)} {r.unit} = <strong>{fmt(r.residualValue)} {r.unit}</strong>
        </div>
      )}
    </div>
  )
}

// Read-only detail for a fund's configuration — target, allocation method/split, penalty rate,
// and (for funds with a EUR-denominated target, e.g. the reabilitare funds) the RON conversion
// rate used. Every field is optional since `allocation` is a free-form JSON blob per fund.
function FundConfigDetail({ f, funds, currency, t }: { f: FundRow; funds: FundRow[]; currency: string; t: (k: string, d?: string) => string }) {
  const a = f.allocation ?? {}
  const planSummary = f.targetPlan && f.targetPlan.periodCount && f.targetPlan.perPeriodAmount
    ? `${f.targetPlan.periodCount} × ${f.targetPlan.perPeriodAmount} ${currency}`
    : null
  const penaltyFund = a.penaltyFundCode ? funds.find((x) => x.code === a.penaltyFundCode) : null
  const totalTarget = f.totalTarget != null ? Number(f.totalTarget) : null
  const fmtRateDate = (iso: string) => new Date(iso).toLocaleDateString('ro-RO')
  const fmtPct = (pct: number) => pct.toLocaleString('ro-RO', { maximumFractionDigits: 2 }) + '%'
  // One row per era: each entry's rate runs from its own date up to (not including) the next
  // entry's — the same schedule PenaltyLedgerService#advance resolves every unit's penalty from
  // (see penalty-rate.ts's rateForDate), so this is never out of sync with what's actually charged.
  const rateHistory = (a.penaltyRateHistory ?? [])
    .slice()
    .sort((x, y) => x.from.localeCompare(y.from))
    .map((entry, i, arr) => {
      const next = arr[i + 1]
      const until = next ? new Date(new Date(next.from).getTime() - 24 * 60 * 60 * 1000) : null
      return { from: entry.from, rate: entry.ratePerDayPct, until }
    })
  return (
    <div className="stack" style={{ gap: 3, padding: '2px 16px 12px 16px', fontSize: 12.5 }}>
      {f.description && <div>{f.description}</div>}
      {totalTarget != null && (
        <div><span className="muted">{t('assocInfo.fundTarget', 'Țintă')}: </span>{totalTarget.toLocaleString()} {currency}</div>
      )}
      {planSummary && <div><span className="muted">{t('assocInfo.fundPlan', 'Plan')}: </span>{planSummary}</div>}
      {f.startPeriodCode && <div><span className="muted">{t('assocInfo.fundStart', 'Perioadă de start')}: </span>{f.startPeriodCode}</div>}
      {a.method && (
        <div>
          <span className="muted">{t('assocInfo.fundMethod', 'Metodă de alocare')}: </span>
          {t(`alloc.${a.method}`, a.method)}
          {a.split && <span className="muted"> ({t('assocInfo.fundSplit', 'Împărțit pe')}: {a.split})</span>}
        </div>
      )}
      {!!a.penaltyPerDayPct && (
        <div>
          <span className="muted">{t('assocInfo.fundPenaltyRate', 'Penalizare întârziere')}: </span>
          {/* penaltyPerDayPct is already a percent value (0.2 means "0.2%/day" — see
              PenaltyLedgerService#penalFunds, which divides this same field by 100 to get the
              fraction it actually multiplies into the accrual math), not a fraction — multiplying
              by 100 here was a display-only bug showing 0.2%/day as a wildly wrong 20%/day. */}
          {t('assocInfo.fundPenaltyPerDay', '{pct}/zi întârziere').replace('{pct}', `${a.penaltyPerDayPct.toLocaleString()}%`)}
          {penaltyFund && <span className="muted"> · {t('assocInfo.fundPenaltyFund', 'se încasează în')} {penaltyFund.name || penaltyFund.code}</span>}
        </div>
      )}
      {rateHistory.length > 0 && (
        <div>
          <span className="muted">{t('assocInfo.fundPenaltyHistory', 'Istoric rată penalizare')}: </span>
          <span className="muted" style={{ fontSize: 11.5 }}>{t('assocInfo.fundPenaltyHistoryHint', '(se aplică la fel pentru toate unitățile)')}</span>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {rateHistory.map((r, i) => (
              <li key={i}>
                {r.until
                  ? `${fmtRateDate(r.from)} – ${fmtRateDate(r.until.toISOString())}`
                  : `${t('assocInfo.fundPenaltyHistoryFrom', 'de la')} ${fmtRateDate(r.from)}${i === rateHistory.length - 1 ? ` (${t('assocInfo.fundPenaltyHistoryCurrent', 'curent')})` : ''}`
                }
                {': '}<strong>{fmtPct(r.rate)}</strong>{t('assocInfo.fundPenaltyHistoryPerDay', '/zi')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {a.eur && (
        <div>
          <span className="muted">{t('assocInfo.fundEurTarget', 'Echivalent EUR')}: </span>
          {a.eur.amount.toLocaleString()} EUR
          <span className="muted"> ({t('assocInfo.fundEurRate', 'la curs {curs} RON/EUR').replace('{curs}', String(a.eur.curs))})</span>
        </div>
      )}
    </div>
  )
}

// Minimal line icons, Lucide-style (stroke, rounded caps) — matched to the reference design's look
// rather than any specific icon set, since the frontend has no icon library dependency.
const ip = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const IconBuilding = () => (<svg {...ip}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" /><path d="M10 21v-4h4v4" /></svg>)
const IconScale = () => (<svg {...ip}><path d="M12 3v18M8 21h8M5 7h14" /><path d="M5 7l-2.5 5a2.5 2.5 0 0 0 5 0L5 7Z" /><path d="M19 7l-2.5 5a2.5 2.5 0 0 0 5 0L19 7Z" /></svg>)
const IconFile = () => (<svg {...ip}><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5" /><path d="M9 13h6M9 17h6" /></svg>)
const IconBook = () => (<svg {...ip}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z" /></svg>)
const IconAlert = () => (<svg {...ip}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>)
const IconWrench = () => (<svg {...ip}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L2 19l3 3 7.3-7.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2Z" /></svg>)
const IconWallet = () => (<svg {...ip}><path d="M20 7H5a2 2 0 0 1 0-4h13v4" /><path d="M20 7v13H5a2 2 0 0 1-2-2V7" /><path d="M16 14h.01" /></svg>)
const IconStore = () => (<svg {...ip}><path d="M3 9l1.5-5h15L21 9" /><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></svg>)
const IconHome = () => (<svg {...ip}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>)
const IconIdCard = () => (<svg {...ip}><rect x="2" y="4" width="20" height="16" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M6 16.5c.5-1.5 1.8-2.5 2-2.5s1.5 1 2 2.5" /><path d="M14 9h5M14 13h5" /></svg>)
const IconAward = () => (<svg {...ip}><circle cx="12" cy="8" r="5" /><path d="M9 12.5 7 22l5-3 5 3-2-9.5" /></svg>)
const IconLandmark = () => (<svg {...ip}><path d="M3 21h18M4 21V10M20 21V10M2 10l10-6 10 6M6 10v7M10 10v7M14 10v7M18 10v7" /></svg>)
const IconCard = () => (<svg {...ip}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>)
const IconUserCheck = () => (<svg {...ip}><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 4.5 2" /><path d="m16 14 2 2 4-4" /></svg>)
const IconUsers = () => (<svg {...ip}><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" /><path d="M17 8a3 3 0 1 0 0-6" /><path d="M22 21v-1a5 5 0 0 0-4-4.9" /></svg>)
const IconPin = ({ size = 14 }: { size?: number }) => (<svg {...ip} width={size} height={size}><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>)
const IconPencil = () => (<svg {...ip} width={14} height={14}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const IconPlus = () => (<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>)
const IconTrash = () => (<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" /></svg>)

const badgeSquare: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 11, background: 'var(--accent-soft)', color: 'var(--accent)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const fieldCard: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', background: 'var(--panel)',
}
const rowLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 14.5 }

export function AssociationInfoPanel({ communityId, communityCode, readOnly = false }: { communityId: string; communityCode?: string; readOnly?: boolean }) {
  const { api } = useAuth()
  const { t: rawT, lang } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const meta = useMetadata()

  const [info, setInfo] = React.useState<AssociationInfo | null>(null)
  const [catalog, setCatalog] = React.useState<ExpenseCatalog>(emptyCatalog)
  const [loading, setLoading] = React.useState(true)
  const [sectionOpen, setSectionOpen] = React.useState(true)
  const [editOpen, setEditOpen] = React.useState(false)
  const [roiOpen, setRoiOpen] = React.useState(false)
  const [roiEditOpen, setRoiEditOpen] = React.useState(false)
  const [servicesOpen, setServicesOpen] = React.useState(false)
  const [servicesEditOpen, setServicesEditOpen] = React.useState(false)
  const [openDomains, setOpenDomains] = React.useState<Set<number>>(new Set())
  const toggleDomain = (i: number) => setOpenDomains((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const [expandedServices, setExpandedServices] = React.useState<Set<string>>(new Set())
  const toggleService = (code: string) => setExpandedServices((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n })

  const [funds, setFunds] = React.useState<FundRow[]>([])
  const [fundsError, setFundsError] = React.useState<string | null>(null)
  const [fundsOpen, setFundsOpen] = React.useState(false)
  const [fundOrderEditOpen, setFundOrderEditOpen] = React.useState(false)
  const [openFundDomains, setOpenFundDomains] = React.useState<Set<string>>(new Set())
  const toggleFundDomain = (key: string) => setOpenFundDomains((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  const [expandedFunds, setExpandedFunds] = React.useState<Set<string>>(new Set())
  const toggleFund = (code: string) => setExpandedFunds((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n })

  React.useEffect(() => {
    if (!communityCode) return
    fetch(`${API_BASE}/community-funds/${communityCode}`)
      .then(async (res) => { if (!res.ok) throw new Error(await res.text()); return res.json() })
      .then((rows) => setFunds(Array.isArray(rows) ? rows : []))
      .catch(() => setFundsError('load-error'))
  }, [communityCode])

  // Domain grouping mirrors FUND_DOMAIN_META's own contract (backend, enums-meta.ts): the key is
  // `allocation.type` lowercased, case-insensitively matched, and a fund with no type falls into
  // `other` rather than being dropped. Group order follows the metadata's sortOrder.
  const fundOrder = info?.fundConfig?.order ?? []
  const fundGroups = React.useMemo(() => {
    // Within each domain, funds follow the admin's chosen display order (fundConfig.order, a flat
    // list of Fund.code across all domains) — funds not in that list keep the API's own order and
    // sort after the ones that are.
    const rank = new Map(fundOrder.map((code, i) => [code, i]))
    const byKey = new Map<string, FundRow[]>()
    for (const f of funds) {
      const key = String(f.allocation?.type || 'other').toLowerCase()
      const arr = byKey.get(key) ?? []
      arr.push(f)
      byKey.set(key, arr)
    }
    for (const arr of byKey.values()) {
      arr.sort((a, b) => {
        const ra = rank.has(a.code) ? rank.get(a.code)! : Infinity
        const rb = rank.has(b.code) ? rank.get(b.code)! : Infinity
        return ra - rb
      })
    }
    const ordered = (meta?.fundDomains ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
    const known = ordered.filter((dm) => byKey.has(dm.key)).map((dm) => ({ key: dm.key, label: dm.label, funds: byKey.get(dm.key)! }))
    const knownKeys = new Set(known.map((g) => g.key))
    const extra = Array.from(byKey.keys()).filter((k) => !knownKeys.has(k)).map((k) => ({ key: k, label: k, funds: byKey.get(k)! }))
    return [...known, ...extra]
  }, [funds, meta, fundOrder])

  const [vendors, setVendors] = React.useState<VendorRow[]>([])
  const [vendorsError, setVendorsError] = React.useState<string | null>(null)
  const [vendorsOpen, setVendorsOpen] = React.useState(false)
  const [vendorOrderEditOpen, setVendorOrderEditOpen] = React.useState(false)
  const [editingVendor, setEditingVendor] = React.useState<VendorRow | null>(null)
  const [addingVendor, setAddingVendor] = React.useState(false)

  const loadVendors = React.useCallback(() => {
    if (!communityId) return
    api.get<VendorRow[]>(`/communities/${communityId}/vendors`)
      .then((rows: VendorRow[]) => setVendors(Array.isArray(rows) ? rows : []))
      .catch(() => setVendorsError('load-error'))
  }, [api, communityId])
  React.useEffect(() => { loadVendors() }, [loadVendors])

  // Same "declared order, not stored per-entity" convention as fundOrder — vendors not in the
  // list (e.g. a vendor added after the order was last saved) keep the API's own order (name asc)
  // and sort after the ones that are.
  const vendorOrder = info?.vendorConfig?.order ?? []
  const orderedVendors = React.useMemo(() => {
    const rank = new Map(vendorOrder.map((id, i) => [id, i]))
    return vendors.slice().sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Infinity
      const rb = rank.has(b.id) ? rank.get(b.id)! : Infinity
      return ra - rb
    })
  }, [vendors, vendorOrder])

  const [units, setUnits] = React.useState<UnitsSummary>(emptyUnitsSummary)
  const [physicalGroups, setPhysicalGroups] = React.useState<UnitsSummary>(emptyUnitsSummary)
  const [physicalGroupsError, setPhysicalGroupsError] = React.useState<string | null>(null)
  const [unitsView, setUnitsView] = React.useState<'unit' | 'physical'>('unit')
  const [unitsOpen, setUnitsOpen] = React.useState(false)
  const [openUnitGroups, setOpenUnitGroups] = React.useState<Set<string>>(new Set())
  const toggleUnitGroup = (id: string) => setOpenUnitGroups((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const loadUnitsData = React.useCallback(() => {
    if (!communityId) return
    api.get<UnitsSummary>(`/communities/${communityId}/billing-entities/detailed`)
      .then((d: UnitsSummary) => setUnits(d))
      .catch(() => {})
    api.get<UnitsSummary>(`/communities/${communityId}/unit-groups/detailed`)
      .then((d: UnitsSummary) => { setPhysicalGroups(d); setPhysicalGroupsError(null) })
      .catch(() => setPhysicalGroupsError('load-error'))
  }, [api, communityId])
  React.useEffect(() => { loadUnitsData() }, [loadUnitsData])

  const [tenants, setTenants] = React.useState<TenantRow[]>([])
  const [tenantsError, setTenantsError] = React.useState<string | null>(null)
  const [tenantsOpen, setTenantsOpen] = React.useState(false)
  const [editingTenant, setEditingTenant] = React.useState<TenantRow | null>(null)
  const [addingTenant, setAddingTenant] = React.useState(false)
  const [detecting, setDetecting] = React.useState(false)

  const loadTenants = React.useCallback(() => {
    if (!communityId) return
    api.get<TenantRow[]>(`/communities/${communityId}/tenants`)
      .then((rows: TenantRow[]) => setTenants(Array.isArray(rows) ? rows : []))
      .catch(() => setTenantsError('load-error'))
  }, [api, communityId])
  React.useEffect(() => { loadTenants() }, [loadTenants])

  // Real unit ids/codes for the tenant add/edit modal's unit picker — flattened from the same
  // physical-groups data the Units section already loads, no extra fetch.
  const tenantUnitOptions = React.useMemo(
    () => physicalGroups.groups.flatMap((g) => g.units.map((u) => ({ code: u.code, label: u.label, groupName: g.name }))),
    [physicalGroups],
  )

  const detectTenants = async () => {
    if (!communityId) return
    setDetecting(true)
    try {
      await api.post(`/communities/${communityId}/tenants/detect`, {})
      loadTenants()
    } catch { /* surfaced via tenantsError on next load if it persists */ }
    finally { setDetecting(false) }
  }

  const [editingPropertyManager, setEditingPropertyManager] = React.useState<UnitRow | null>(null)
  const [editingPrimaryOwner, setEditingPrimaryOwner] = React.useState<UnitRow | null>(null)

  const load = React.useCallback(() => {
    if (!communityId) return
    setLoading(true)
    api.get<AssociationInfo>(`/communities/${communityId}/association-info`)
      .then((d: AssociationInfo) => setInfo(d))
      .catch(() => setInfo(null))
      .finally(() => setLoading(false))
    api.get<ExpenseCatalog>(`/communities/${communityId}/finance/expense-catalog`)
      .then((d: ExpenseCatalog) => setCatalog(d))
      .catch(() => setCatalog(emptyCatalog))
  }, [api, communityId])
  React.useEffect(() => { load() }, [load])

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US')
  }
  const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—')

  if (loading && !info) return <div className="empty">{t('common.loading', 'Loading…')}</div>
  const d = info ?? emptyInfo('')

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
      <div className="stack" style={{ gap: 6, alignItems: 'center', textAlign: 'center', padding: '8px 0 4px' }}>
        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ transform: 'scale(1.5)' }}><IconBuilding /></span>
        </div>
        <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700 }}>{d.name}</h2>
        {d.address && (
          <div className="muted row" style={{ gap: 5, alignItems: 'center', fontSize: 13.5 }}>
            <IconPin /> {d.address}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setSectionOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconScale /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section1', '1. Asociația')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{t('assocInfo.section1Hint', 'Date juridice și organizare')}</div>
          </div>
          <IconChevron open={sectionOpen} />
        </button>
      </div>

      {sectionOpen && (
        <div className="stack" style={{ gap: 12 }}>
          {!readOnly && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary small" onClick={() => setEditOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPencil /> {t('assocInfo.edit', 'Editează')}
              </button>
            </div>
          )}

          <div style={fieldCard}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={rowLabel}><IconFile /> {t('assocInfo.legalName', 'Nume oficial')}</div>
              <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.beneficiary', 'BENEFICIAR')}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 15, fontWeight: 600 }}>{dash(d.legalName)}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t('assocInfo.legalNameHint', 'Se folosește ca beneficiar în documente și plăți.')}</div>
          </div>

          <div style={fieldCard}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={rowLabel}><IconFile /> {t('assocInfo.statut', 'Statut')}</div>
              <span className="badge positive" style={{ fontSize: 10 }}>{dash(d.statutStatus)}</span>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.foundingDate', 'Data înființare')}</span>
                <span style={{ fontSize: 13 }}>{fmtDate(d.foundingDate)}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.actConstitutiv', 'Nr. Act Constitutiv')}</span>
                <span style={{ fontSize: 13 }}>{dash(d.actConstitutivNr)}</span>
              </div>
            </div>
          </div>

          <div style={fieldCard}>
            <div style={rowLabel}><IconAward /> {t('assocInfo.acordAsociere', 'Acord de Asociere')}</div>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.number', 'Număr')}</span>
                <span style={{ fontSize: 13 }}>{dash(d.acordAsociereNr)}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.registrationDate', 'Data înregistrare')}</span>
                <span style={{ fontSize: 13 }}>{fmtDate(d.acordAsociereDate)}</span>
              </div>
            </div>
          </div>

          <div style={{ ...fieldCard, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={rowLabel}><IconLandmark /> {t('assocInfo.cif', 'Cod Fiscal')}</div>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{dash(d.cif)}</span>
          </div>

          <div style={fieldCard}>
            <div style={rowLabel}><IconCard /> {t('assocInfo.bankAccounts', 'Conturi Bancare')}</div>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {d.bankAccounts.length === 0 && <span className="muted" style={{ fontSize: 13 }}>—</span>}
              {d.bankAccounts.map((ba, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', background: 'var(--muted-bg, #f5f5f7)', borderRadius: 10, padding: '10px 12px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ba.bank}</div>
                    <div className="muted" style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{ba.iban}</div>
                  </div>
                  <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.account', 'Cont')} {ba.currency}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={fieldCard}>
            <div style={rowLabel}><IconUserCheck /> {t('assocInfo.legalRep', 'Reprezentant Legal')}</div>
            {d.legalRep ? (
              <div className="stack" style={{ gap: 3, marginTop: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.legalRep.name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{d.legalRep.title}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>{d.legalRep.phone}</div>
                <div style={{ fontSize: 13 }}>{d.legalRep.email}</div>
              </div>
            ) : <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>—</div>}
          </div>

          <div style={fieldCard}>
            <div style={rowLabel}><IconUsers /> {t('assocInfo.governance', 'Organe de Conducere')}</div>
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              <div style={{ background: 'var(--muted-bg, #f5f5f7)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('assocInfo.aga', 'Adunare Generală (AGA)')}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{t('assocInfo.lastMeeting', 'Ultima ședință')}: {fmtDate(d.aga.lastMeeting)}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{t('assocInfo.nextMeeting', 'Următoarea')}: {fmtDate(d.aga.nextMeeting)}</div>
              </div>
              <div>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t('assocInfo.cex', 'Comitet Executiv (CEX)')}</span>
                  <span className="badge secondary" style={{ fontSize: 10 }}>{d.boardMembers.length} {t('assocInfo.members', 'membri')}</span>
                </div>
                <div className="stack" style={{ gap: 0, marginTop: 6 }}>
                  {d.boardMembers.length === 0 && <span className="muted" style={{ fontSize: 13 }}>—</span>}
                  {d.boardMembers.map((m, i) => (
                    <div key={i} className="row" style={{ justifyContent: 'space-between', padding: '6px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                      <span style={{ fontSize: 13.5 }}>{m.name}</span>
                      <span className="muted" style={{ fontSize: 12.5 }}>{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={fieldCard}>
            <div style={rowLabel}><IconBuilding /> {t('assocInfo.administrator', 'Administrator')}</div>
            {d.administrator ? (
              <div className="stack" style={{ gap: 3, marginTop: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.administrator.company}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{t('assocInfo.rep', 'Reprezentant')}: {d.administrator.rep}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{d.administrator.hours}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>{d.administrator.phone}</div>
                <div style={{ fontSize: 13 }}>{d.administrator.email}</div>
                {d.administrator.address && (
                  <div className="row" style={{ gap: 5, alignItems: 'center', fontSize: 13 }}><IconPin /> {d.administrator.address}</div>
                )}
              </div>
            ) : <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>—</div>}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setRoiOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconBook /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section2', '2. Regulament Ordine Interioară (ROI)')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>{t('assocInfo.section2Hint', '{n} niveluri risc · {n} acțiuni').replace(/\{n\}/g, String(d.roiPolicy.tiers.length))}</div>
          </div>
          <IconChevron open={roiOpen} />
        </button>
      </div>

      {roiOpen && (
        <div className="stack" style={{ gap: 12 }}>
          {!readOnly && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary small" onClick={() => setRoiEditOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPencil /> {t('assocInfo.edit', 'Editează')}
              </button>
            </div>
          )}
          <div style={fieldCard}>
            <div style={rowLabel}><IconFile /> {t('assocInfo.roiDescription', 'Descriere generală')}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{dash(d.roiPolicy.description)}</div>
          </div>
          <div style={fieldCard}>
            <div style={rowLabel}><IconAlert /> {t('assocInfo.roiRisk', 'Risc Expunere (zile de la scadență)')}</div>
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              {d.roiPolicy.tiers.map((tier, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13.5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: RISK_DOT_COLOR[tier.tone] }} />
                      {tier.label}
                    </span>
                    <span className="badge secondary" style={{ fontSize: 10 }}>{tier.rangeLabel}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{tier.actionTitle}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{tier.actionDesc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setFundsOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconWallet /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section3', '3. Fonduri')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {t('assocInfo.section3Hint', '{n} fonduri · {domains} domenii')
                .replace('{n}', String(funds.length))
                .replace('{domains}', String(fundGroups.length))}
            </div>
          </div>
          <IconChevron open={fundsOpen} />
        </button>
      </div>

      {fundsOpen && (
        <div className="stack" style={{ gap: 10 }}>
          {!readOnly && funds.length > 0 && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary small" onClick={() => setFundOrderEditOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPencil /> {t('assocInfo.fundOrderEdit', 'Editează ordinea')}
              </button>
            </div>
          )}
          {fundsError && funds.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.fundsLoadError', 'Fondurile nu au putut fi încărcate.')}</div>}
          {!fundsError && funds.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.fundsEmpty', 'Niciun fond configurat pentru această asociație.')}</div>}
          {fundGroups.map((group) => {
            const open = openFundDomains.has(group.key)
            return (
              <div key={group.key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <button type="button" onClick={() => toggleFundDomain(group.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{group.label} <span className="muted" style={{ fontWeight: 400 }}>({group.funds.length})</span></span>
                  <IconChevron open={open} />
                </button>
                {open && (
                  <div>
                    {group.funds.map((f) => {
                      const displayName = f.allocation?.shortName || f.name || f.code
                      return (
                        <div key={f.code} style={{ borderTop: '1px solid var(--border)' }}>
                          <button type="button" onClick={() => toggleFund(f.code)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                            <span style={{ flex: 1, fontSize: 13.5 }}>
                              {displayName}
                              {f.allocation?.altName && f.allocation.altName !== displayName && (
                                <span className="muted"> · {f.allocation.altName}</span>
                              )}
                            </span>
                            {f.allocation?.abbrev && <span className="badge secondary" style={{ fontSize: 10, fontFamily: 'monospace' }}>{f.allocation.abbrev}</span>}
                            {f.status && <span className="badge secondary" style={{ fontSize: 10 }}>{t(`funds.status.${f.status}`, f.status)}</span>}
                            <IconChevron open={expandedFunds.has(f.code)} />
                          </button>
                          {expandedFunds.has(f.code) && <FundConfigDetail f={f} funds={funds} currency={f.currency || 'RON'} t={t} />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setServicesOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconWrench /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section4', '4. Configurare Servicii')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {t('assocInfo.section4Hint', '{domains} domenii · {assigned}/{total} servicii asignate')
                .replace('{domains}', String(d.serviceConfig.domains.length))
                .replace('{assigned}', String(new Set(d.serviceConfig.domains.flatMap((dom) => dom.serviceCodes)).size))
                .replace('{total}', String(catalog.expenseTypes.length))}
            </div>
          </div>
          <IconChevron open={servicesOpen} />
        </button>
      </div>

      {servicesOpen && (
        <div className="stack" style={{ gap: 10 }}>
          {!readOnly && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary small" onClick={() => setServicesEditOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPencil /> {t('assocInfo.edit', 'Editează')}
              </button>
            </div>
          )}
          {(() => {
            const assignedCodes = new Set(d.serviceConfig.domains.flatMap((dom) => dom.serviceCodes))
            const unassigned = catalog.expenseTypes.filter((e) => !assignedCodes.has(e.code))
            return unassigned.length > 0 ? (
              <div className="card" style={{ padding: '10px 14px', borderColor: 'var(--danger, #d32f2f)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--danger, #d32f2f)' }}>
                  {t('assocInfo.serviceUnassigned', 'Servicii neasignate')} ({unassigned.length})
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t('assocInfo.serviceUnassignedHint', 'Există în facturarea reală dar nu apar în niciun domeniu.')}</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>{unassigned.map((e) => e.name).join(', ')}</div>
              </div>
            ) : null
          })()}
          {d.serviceConfig.domains.length === 0 && <div className="muted" style={{ fontSize: 13 }}>—</div>}
          {d.serviceConfig.domains.map((dom, i) => {
            const open = openDomains.has(i)
            // Ordered rows: each real service in the domain's chosen order, with any synthetic
            // (e.g. Apă-diferență) inserted right after the code it's computed from — the exact
            // sequence the avizier itself uses for these columns.
            const rows: Array<{ kind: 'real'; e: CatalogExpenseType } | { kind: 'synthetic'; s: CatalogSynthetic }> = []
            for (const code of dom.serviceCodes) {
              const e = catalog.expenseTypes.find((x) => x.code === code)
              if (e) rows.push({ kind: 'real', e })
              for (const s of catalog.synthetic) if (s.anchorCode === code) rows.push({ kind: 'synthetic', s })
            }
            return (
              <div key={dom.key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <button type="button" onClick={() => toggleDomain(i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <span className="muted" style={{ fontSize: 13 }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{dom.name} <span className="muted" style={{ fontWeight: 400 }}>({rows.length})</span></span>
                  <IconChevron open={open} />
                </button>
                {open && (
                  <div>
                    {rows.map((r) => r.kind === 'real' ? (
                      <div key={r.e.code} style={{ borderTop: '1px solid var(--border)' }}>
                        <button type="button" onClick={() => toggleService(r.e.code)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ flex: 1, fontSize: 13.5 }}>{r.e.name}</span>
                          <IconChevron open={expandedServices.has(r.e.code)} />
                        </button>
                        {expandedServices.has(r.e.code) && <ServiceComputationDetail e={r.e} meta={meta} t={t} />}
                      </div>
                    ) : (
                      <div key={r.s.code} style={{ borderTop: '1px solid var(--border)' }}>
                        <button type="button" onClick={() => toggleService(r.s.code)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                          <span className="muted" style={{ flex: 1, fontSize: 13.5 }}>{r.s.label}</span>
                          <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.serviceAutoComputed', 'calculat automat')}</span>
                          <IconChevron open={expandedServices.has(r.s.code)} />
                        </button>
                        {expandedServices.has(r.s.code) && <SyntheticComputationDetail s={r.s} catalog={catalog} t={t} lang={lang} />}
                      </div>
                    ))}
                    {rows.length === 0 && <div className="muted" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 13 }}>—</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setVendorsOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconStore /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section5', '5. Furnizori')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {t('assocInfo.section5Hint', '{n} furnizori').replace('{n}', String(vendors.length))}
            </div>
          </div>
          <IconChevron open={vendorsOpen} />
        </button>
      </div>

      {vendorsOpen && (
        <div className="stack" style={{ gap: 10 }}>
          {!readOnly && (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn secondary small" onClick={() => setAddingVendor(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPlus /> {t('assocInfo.vendorAdd', 'Adaugă furnizor')}
              </button>
              {vendors.length > 0 && (
                <button type="button" className="btn secondary small" onClick={() => setVendorOrderEditOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <IconPencil /> {t('assocInfo.vendorOrderEdit', 'Editează ordinea')}
                </button>
              )}
            </div>
          )}
          {vendorsError && vendors.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.vendorsLoadError', 'Furnizorii nu au putut fi încărcați.')}</div>}
          {!vendorsError && vendors.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.vendorsEmpty', 'Niciun furnizor înregistrat pentru această asociație.')}</div>}
          {orderedVendors.map((v) => (
            <div key={v.id} style={fieldCard}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{v.name}</div>
                  <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.vendorContract', 'Contract')}</span>
                      <span style={{ fontSize: 13 }}>{dash(v.contract)}</span>
                    </div>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="muted" style={{ fontSize: 13 }}>{t('assocInfo.vendorInvoices', 'Facturi')}</span>
                      <span style={{ fontSize: 13 }}>{v.invoiceCount}</span>
                    </div>
                  </div>
                </div>
                {!readOnly && (
                  <button type="button" className="btn ghost small" onClick={() => setEditingVendor(v)} title={t('assocInfo.edit', 'Editează')}>
                    <IconPencil />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setUnitsOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconHome /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section6', '6. Unități')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {[
                t('assocInfo.section6Hint', '{units} unități · {groups} grupuri · CPI {cpi}%')
                  .replace('{units}', String(physicalGroups.totalUnits))
                  .replace('{groups}', String(units.totalGroups))
                  .replace('{cpi}', units.totalCpiPct.toLocaleString()),
                physicalGroups.totalBoxes ? t('assocInfo.boxCount', '{n} boxe').replace('{n}', String(physicalGroups.totalBoxes)) : null,
                physicalGroups.totalCommonSpaces ? t('assocInfo.commonSpaceCount', '{n} spații comune').replace('{n}', String(physicalGroups.totalCommonSpaces)) : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          <IconChevron open={unitsOpen} />
        </button>
      </div>

      {unitsOpen && (() => {
        // Both views ("Pe unitate" / "Grup unități") read the SAME complete real-unit inventory —
        // physicalGroups is the only endpoint that includes every unit (billable, boxes, and the
        // building's own common/technical spaces); billing-entities/detailed only covers units
        // linked to an owner, so it can't stand in for the "Comune" bucket. "unit" view flattens
        // across physical-group boundaries; "physical" view keeps them.
        const activeData = physicalGroups
        const activeError = physicalGroupsError
        // Sort for a per-unit browse (unlike the physical-group source data, which has no
        // meaningful unit-to-unit order across groups): by floor, then staircase, then label.
        const flatUnits = [...activeData.groups.flatMap((g) => g.units)].sort((a, b) => {
          const fa = a.floorNumber ?? Number.MAX_SAFE_INTEGER
          const fb = b.floorNumber ?? Number.MAX_SAFE_INTEGER
          if (fa !== fb) return fa - fb
          const sa = a.staircase ?? ''
          const sb = b.staircase ?? ''
          if (sa !== sb) return sa.localeCompare(sb, 'ro', { numeric: true })
          return a.label.localeCompare(b.label, 'ro', { numeric: true })
        })
        // One shared unit row, used both as a top-level entry ("Pe unitate") and nested inside a
        // physical group ("Grup unități") — clicking it reveals the FULL owner/tenant history
        // (not just who's current), consistently in either view.
        const renderUnit = (u: UnitRow, keyPrefix: string, asCard: boolean) => {
          const openKey = `${keyPrefix}:${u.code}`
          const open = openUnitGroups.has(openKey)
          return (
            <div key={u.code} className={asCard ? 'card' : undefined}
              style={asCard ? { padding: 0, overflow: 'hidden' } : { borderTop: '1px solid var(--border)' }}>
              <button type="button" onClick={() => toggleUnitGroup(openKey)}
                style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.label}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {[u.type, u.floorName, u.staircase ? `Sc. ${u.staircase}` : null, u.location].filter(Boolean).join(' · ')}
                  </div>
                  {(u.owner || u.tenant || u.propertyManager || u.mainContact) && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                      {[
                        u.owner ? `${t('assocInfo.personRoleOwner', 'Proprietar')}: ${u.owner}` : null,
                        u.tenant ? `${t('assocInfo.personRoleTenant', 'Chiriaș')}: ${u.tenant}` : null,
                        u.propertyManager ? `${t('assocInfo.personRolePropertyManager', 'Administrator proprietate')}: ${u.propertyManager}` : null,
                        u.mainContact ? `${t('assocInfo.personRoleMainContact', 'Contact principal')}: ${u.mainContact}` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {u.cfCode && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
                      {t('assocInfo.cfCode', 'CF')}: {u.cfCode}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{u.cpiPct != null ? `${u.cpiPct.toLocaleString()}%` : 'N/A'}</div>
                  {u.surfaceMp != null && <div className="muted" style={{ fontSize: 11 }}>{u.surfaceMp.toLocaleString()} mp</div>}
                </div>
                <IconChevron open={open} />
              </button>
              {open && (
                <div style={{ padding: '0 16px 12px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{t('assocInfo.ownerHistory', 'Istoric proprietari')}</div>
                  {u.ownerHistory && u.ownerHistory.length > 0 ? (
                    <div className="stack" style={{ gap: 3, marginTop: 3 }}>
                      {u.ownerHistory.map((h, i) => (
                        <div key={i} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                          <span>
                            {h.name}
                            {h.current && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>{t('assocInfo.current', 'curent')}</span>}
                          </span>
                          <span className="muted" style={{ flexShrink: 0 }}>
                            {(h.startPeriodCode ?? '—')} – {h.endPeriodCode ?? t('assocInfo.present', 'prezent')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>—</div>}
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10 }}>{t('assocInfo.tenantHistory', 'Istoric chiriași')}</div>
                  {u.tenantHistory && u.tenantHistory.length > 0 ? (
                    <div className="stack" style={{ gap: 3, marginTop: 3 }}>
                      {u.tenantHistory.map((h, i) => (
                        <div key={i} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 12 }}>
                          <span>{h.name}</span>
                          {h.source === 'INFERRED' && !h.confirmed && (
                            <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.personInferred', 'dedus')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>—</div>}
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{t('assocInfo.propertyManager', 'Administrator proprietate')}</div>
                    {!readOnly && (
                      <button type="button" className="btn ghost small" onClick={(e) => { e.stopPropagation(); setEditingPropertyManager(u) }} title={t('assocInfo.edit', 'Editează')}>
                        <IconPencil />
                      </button>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>
                    {[u.propertyManager, u.propertyManagerPhone, u.propertyManagerEmail].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {u.owner && u.owner.includes(',') && (
                    <>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t('assocInfo.primaryOwnerOverride', 'Contact principal (dintre proprietari)')}</div>
                        {!readOnly && (
                          <button type="button" className="btn ghost small" onClick={(e) => { e.stopPropagation(); setEditingPrimaryOwner(u) }} title={t('assocInfo.edit', 'Editează')}>
                            <IconPencil />
                          </button>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>{u.mainContact || '—'}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        }
        // Real, individually-owned property (apartments, SAD, comercial, boxes) vs the building's
        // own common/technical spaces (Cale Evacuare, Tehnice, …) — the same billable/non-billable
        // split already used for the section header's box/common-space counts.
        const BILLABLE_TYPES = new Set(['apartament', 'sad', 'comercial'])
        const isPrivateType = (type: string) => { const t2 = type.toLowerCase(); return BILLABLE_TYPES.has(t2) || t2 === 'boxa' }
        const privateUnits = flatUnits.filter((u) => isPrivateType(u.type))
        const comuneUnits = flatUnits.filter((u) => !isPrivateType(u.type))
        const isGroupComune = (g: UnitGroupRow) => g.units.length > 0 && g.units.every((u) => !isPrivateType(u.type))
        const privateGroups = activeData.groups.filter((g) => !isGroupComune(g))
        const comuneGroups = activeData.groups.filter(isGroupComune)
        const renderGroup = (g: UnitGroupRow) => {
          const open = openUnitGroups.has(`${unitsView}:${g.id}`)
          return (
            <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button type="button" onClick={() => toggleUnitGroup(`${unitsView}:${g.id}`)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5 }}>{g.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {(() => {
                    const isBoxa = (u: UnitRow) => u.type.toLowerCase() === 'boxa'
                    const nonBoxCount = g.units.filter((u) => !isBoxa(u)).length
                    const boxCount = g.units.filter(isBoxa).length
                    return [
                      t('assocInfo.unitCount', '{n} unități').replace('{n}', String(nonBoxCount)),
                      boxCount > 0 ? t('assocInfo.boxCount', '{n} boxe').replace('{n}', String(boxCount)) : null,
                      `CPI ${g.totalCpiPct.toLocaleString()}%`,
                    ].filter(Boolean).join(' · ')
                  })()}
                </span>
                <IconChevron open={open} />
              </button>
              {open && (
                <div>
                  {g.units.map((u) => renderUnit(u, `physical-unit:${g.id}`, false))}
                  {g.units.length === 0 && <div className="muted" style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', fontSize: 13 }}>—</div>}
                </div>
              )}
            </div>
          )
        }
        // Within "Pe unitate", further split each bucket by the unit's own registry type
        // (Apartament/SAD/Boxa under Private; Cale Evacuare/Tehnice/… under Comune) — collapsed
        // by default, same as the Private/Comune buckets themselves.
        const TYPE_ORDER = ['Apartament', 'SAD', 'Comercial', 'Boxa']
        const groupByType = (list: UnitRow[]) => {
          const map = new Map<string, UnitRow[]>()
          for (const u of list) {
            const arr = map.get(u.type) ?? []
            arr.push(u)
            map.set(u.type, arr)
          }
          return [...map.entries()].sort(([ta], [tb]) => {
            const ia = TYPE_ORDER.indexOf(ta), ib = TYPE_ORDER.indexOf(tb)
            if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
            return ta.localeCompare(tb, 'ro')
          })
        }
        const renderTypeGroup = (bucketKind: 'private' | 'comune', type: string, list: UnitRow[]) => {
          const openKey = `type:${bucketKind}:${type}`
          const open = openUnitGroups.has(openKey)
          return (
            <div key={type} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button type="button" onClick={() => toggleUnitGroup(openKey)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{type}</span>
                <span className="muted" style={{ fontSize: 12 }}>{t('assocInfo.unitCount', '{n} unități').replace('{n}', String(list.length))}</span>
                <IconChevron open={open} />
              </button>
              {open && <div className="stack" style={{ gap: 8, padding: '0 10px 10px 10px' }}>{list.map((u) => renderUnit(u, 'unit', true))}</div>}
            </div>
          )
        }
        // Top-level "Private" / "Comune" split — same shape in both views, collapsed by default.
        const renderSuperGroup = (kind: 'private' | 'comune', count: number, content: React.ReactNode) => {
          const openKey = `super:${unitsView}:${kind}`
          const open = openUnitGroups.has(openKey)
          const countLabel = unitsView === 'unit'
            ? t('assocInfo.unitCount', '{n} unități').replace('{n}', String(count))
            : t('assocInfo.groupCount', '{n} grupuri').replace('{n}', String(count))
          return (
            <div key={kind} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button type="button" onClick={() => toggleUnitGroup(openKey)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>
                  {kind === 'private' ? t('assocInfo.groupPrivate', 'Private') : t('assocInfo.groupCommon', 'Comune')}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{countLabel}</span>
                <IconChevron open={open} />
              </button>
              {open && <div className="stack" style={{ gap: 10, padding: '0 12px 12px 12px' }}>{content}</div>}
            </div>
          )
        }
        return (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={unitsView === 'unit' ? 'btn primary small' : 'btn secondary small'} onClick={() => setUnitsView('unit')}>
              {t('assocInfo.unitsViewUnit', 'Pe unitate')}
            </button>
            <button type="button" className={unitsView === 'physical' ? 'btn primary small' : 'btn secondary small'} onClick={() => setUnitsView('physical')}>
              {t('assocInfo.unitsViewPhysical', 'Grup unități')}
            </button>
          </div>
          {activeError && activeData.groups.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.unitsLoadError', 'Unitățile nu au putut fi încărcate.')}</div>}
          {!activeError && activeData.groups.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.unitsEmpty', 'Nicio unitate înregistrată pentru această asociație.')}</div>}
          {unitsView === 'unit' ? (
            <>
              {renderSuperGroup('private', privateUnits.length, groupByType(privateUnits).map(([type, list]) => renderTypeGroup('private', type, list)))}
              {renderSuperGroup('comune', comuneUnits.length, groupByType(comuneUnits).map(([type, list]) => renderTypeGroup('comune', type, list)))}
            </>
          ) : (
            <>
              {renderSuperGroup('private', privateGroups.length, privateGroups.map(renderGroup))}
              {renderSuperGroup('comune', comuneGroups.length, comuneGroups.map(renderGroup))}
            </>
          )}
        </div>
        )
      })()}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button type="button" onClick={() => setTenantsOpen((v) => !v)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div style={badgeSquare}><IconIdCard /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{t('assocInfo.section7', '7. Chiriași')}</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {t('assocInfo.section7Hint', '{n} chiriași').replace('{n}', String(tenants.length))}
            </div>
          </div>
          <IconChevron open={tenantsOpen} />
        </button>
      </div>

      {tenantsOpen && (
        <div className="stack" style={{ gap: 10 }}>
          {!readOnly && (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn secondary small" onClick={() => setAddingTenant(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconPlus /> {t('assocInfo.personAdd', 'Adaugă chiriaș')}
              </button>
              <button type="button" className="btn secondary small" disabled={detecting} onClick={detectTenants}>
                {detecting ? t('common.loading', '…') : t('assocInfo.personDetect', 'Detectează chiriași')}
              </button>
            </div>
          )}
          {tenantsError && tenants.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.peopleLoadError', 'Chiriașii nu au putut fi încărcați.')}</div>}
          {!tenantsError && tenants.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.peopleEmpty', 'Niciun chiriaș înregistrat pentru această asociație.')}</div>}
          {tenants.map((tRow) => (
            <div key={tRow.id} style={fieldCard}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{tRow.name}</span>
                    {tRow.source === 'INFERRED' && !tRow.confirmed && (
                      <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.personInferred', 'dedus')}</span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {[tRow.unitLabel, tRow.phone, tRow.email].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {!readOnly && (
                  <div className="row" style={{ gap: 4 }}>
                    {tRow.source === 'INFERRED' && !tRow.confirmed && (
                      <>
                        <button type="button" className="btn ghost small" title={t('assocInfo.personConfirm', 'Confirmă')}
                          onClick={async () => { await api.patch(`/communities/${communityId}/tenants/${tRow.id}`, { confirmed: true }); loadTenants() }}>✓</button>
                        <button type="button" className="btn ghost small" title={t('assocInfo.personDismiss', 'Elimină')}
                          onClick={async () => { await api.del(`/communities/${communityId}/tenants/${tRow.id}`); loadTenants() }}>✕</button>
                      </>
                    )}
                    <button type="button" className="btn ghost small" onClick={() => setEditingTenant(tRow)} title={t('assocInfo.edit', 'Editează')}>
                      <IconPencil />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editOpen && (
        <AssociationInfoEditModal communityId={communityId} info={d} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); load() }} />
      )}
      {roiEditOpen && (
        <RoiPolicyEditModal communityId={communityId} policy={d.roiPolicy} onClose={() => setRoiEditOpen(false)} onSaved={() => { setRoiEditOpen(false); load() }} />
      )}
      {servicesEditOpen && (
        <ServiceConfigEditModal communityId={communityId} config={d.serviceConfig} catalog={catalog} onClose={() => setServicesEditOpen(false)} onSaved={() => { setServicesEditOpen(false); load() }} />
      )}
      {fundOrderEditOpen && (
        <FundOrderEditModal communityId={communityId} funds={funds} order={d.fundConfig.order} onClose={() => setFundOrderEditOpen(false)} onSaved={() => { setFundOrderEditOpen(false); load() }} />
      )}
      {vendorOrderEditOpen && (
        <VendorOrderEditModal communityId={communityId} vendors={vendors} order={d.vendorConfig.order} onClose={() => setVendorOrderEditOpen(false)} onSaved={() => { setVendorOrderEditOpen(false); load() }} />
      )}
      {editingVendor && (
        <VendorEditModal communityId={communityId} vendor={editingVendor} onClose={() => setEditingVendor(null)} onSaved={() => { setEditingVendor(null); loadVendors() }} />
      )}
      {addingVendor && (
        <VendorEditModal communityId={communityId} onClose={() => setAddingVendor(false)} onSaved={() => { setAddingVendor(false); loadVendors() }} />
      )}
      {editingTenant && (
        <TenantEditModal communityId={communityId} tenant={editingTenant} units={tenantUnitOptions} onClose={() => setEditingTenant(null)} onSaved={() => { setEditingTenant(null); loadTenants() }} />
      )}
      {addingTenant && (
        <TenantEditModal communityId={communityId} units={tenantUnitOptions} onClose={() => setAddingTenant(false)} onSaved={() => { setAddingTenant(false); loadTenants() }} />
      )}
      {editingPropertyManager && (
        <PropertyManagerEditModal communityId={communityId} unit={editingPropertyManager} onClose={() => setEditingPropertyManager(null)} onSaved={() => { setEditingPropertyManager(null); loadUnitsData() }} />
      )}
      {editingPrimaryOwner && (
        <PrimaryOwnerEditModal communityId={communityId} unit={editingPrimaryOwner} onClose={() => setEditingPrimaryOwner(null)} onSaved={() => { setEditingPrimaryOwner(null); loadUnitsData() }} />
      )}
    </div>
  )
}

function FundOrderEditModal({ communityId, funds, order, onClose, onSaved }: { communityId: string; funds: FundRow[]; order: string[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  // Start from every known fund code, in the saved order first, then any fund not yet placed
  // (e.g. a fund created after the order was last saved) appended at the end.
  const initial = React.useMemo(() => {
    const rank = new Map(order.map((code, i) => [code, i]))
    return funds.slice().sort((a, b) => {
      const ra = rank.has(a.code) ? rank.get(a.code)! : Infinity
      const rb = rank.has(b.code) ? rank.get(b.code)! : Infinity
      return ra - rb
    })
  }, [funds, order])
  const [rows, setRows] = React.useState<FundRow[]>(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const move = (i: number, dir: -1 | 1) => setRows((arr) => moveItem(arr, i, dir))

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/association-info`, {
        fundConfig: { order: rows.map((f) => f.code) },
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: '100%', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.fundOrderEditTitle', 'Editează ordinea de afișare')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('assocInfo.fundOrderHint', 'Ordinea de mai jos este ordinea în care fondurile apar în fiecare domeniu.')}</div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 6 }}>
          {rows.map((f, i) => {
            const displayName = f.allocation?.shortName || f.name || f.code
            return (
              <div key={f.code} className="row" style={{ gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
                <div className="stack" style={{ gap: 2 }}>
                  <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} title={t('assocInfo.moveUp', 'Mută sus')} style={{ padding: '0 6px', lineHeight: 1 }}>↑</button>
                  <button type="button" className="btn ghost small" disabled={i === rows.length - 1} onClick={() => move(i, 1)} title={t('assocInfo.moveDown', 'Mută jos')} style={{ padding: '0 6px', lineHeight: 1 }}>↓</button>
                </div>
                <span style={{ flex: 1, fontSize: 13.5 }}>{displayName}</span>
                {f.allocation?.abbrev && <span className="badge secondary" style={{ fontSize: 10, fontFamily: 'monospace' }}>{f.allocation.abbrev}</span>}
              </div>
            )
          })}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
        </div>
      </div>
    </div>
  )
}

function VendorOrderEditModal({ communityId, vendors, order, onClose, onSaved }: { communityId: string; vendors: VendorRow[]; order: string[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const initial = React.useMemo(() => {
    const rank = new Map(order.map((id, i) => [id, i]))
    return vendors.slice().sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Infinity
      const rb = rank.has(b.id) ? rank.get(b.id)! : Infinity
      return ra - rb
    })
  }, [vendors, order])
  const [rows, setRows] = React.useState<VendorRow[]>(initial)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const move = (i: number, dir: -1 | 1) => setRows((arr) => moveItem(arr, i, dir))

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/association-info`, {
        vendorConfig: { order: rows.map((v) => v.id) },
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, width: '100%', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.vendorOrderEditTitle', 'Editează ordinea de afișare')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('assocInfo.vendorOrderHint', 'Ordinea de mai jos este ordinea în care furnizorii apar în listă.')}</div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 6 }}>
          {rows.map((v, i) => (
            <div key={v.id} className="row" style={{ gap: 6, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              <div className="stack" style={{ gap: 2 }}>
                <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => move(i, -1)} title={t('assocInfo.moveUp', 'Mută sus')} style={{ padding: '0 6px', lineHeight: 1 }}>↑</button>
                <button type="button" className="btn ghost small" disabled={i === rows.length - 1} onClick={() => move(i, 1)} title={t('assocInfo.moveDown', 'Mută jos')} style={{ padding: '0 6px', lineHeight: 1 }}>↓</button>
              </div>
              <span style={{ flex: 1, fontSize: 13.5 }}>{v.name}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
        </div>
      </div>
    </div>
  )
}

function VendorEditModal({ communityId, vendor, onClose, onSaved }: { communityId: string; vendor?: VendorRow; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [name, setName] = React.useState(vendor?.name ?? '')
  const [contract, setContract] = React.useState(vendor?.contract ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) { setError(t('assocInfo.vendorNameRequired', 'Numele este obligatoriu')); return }
    setBusy(true); setError(null)
    try {
      const body = { name: name.trim(), contract: contract.trim() || null }
      if (vendor) await api.patch(`/communities/${communityId}/vendors/${vendor.id}`, body)
      else await api.post(`/communities/${communityId}/vendors`, body)
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '100%', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{vendor ? t('assocInfo.vendorEditTitle', 'Editează furnizorul') : t('assocInfo.vendorAddTitle', 'Adaugă furnizor')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.vendorName', 'Nume')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.vendorContract', 'Contract')}</label>
            <input className="input" value={contract} onChange={(e) => setContract(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TenantEditModal({ communityId, tenant, units, onClose, onSaved }: {
  communityId: string; tenant?: TenantRow
  units: Array<{ code: string; label: string; groupName: string }>
  onClose: () => void; onSaved: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [name, setName] = React.useState(tenant?.name ?? '')
  const [unitCode, setUnitCode] = React.useState(tenant?.unitCode ?? '')
  const [phone, setPhone] = React.useState(tenant?.phone ?? '')
  const [email, setEmail] = React.useState(tenant?.email ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    if (!name.trim()) { setError(t('assocInfo.personNameRequired', 'Numele este obligatoriu')); return }
    if (!tenant && !unitCode) { setError(t('assocInfo.personUnitRequired', 'Unitatea este obligatorie')); return }
    setBusy(true); setError(null)
    try {
      const body: any = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null }
      if (tenant) await api.patch(`/communities/${communityId}/tenants/${tenant.id}`, body)
      else await api.post(`/communities/${communityId}/tenants`, { ...body, unitCode })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '100%', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{tenant ? t('assocInfo.personEditTitle', 'Editează chiriașul') : t('assocInfo.personAddTitle', 'Adaugă chiriaș')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personName', 'Nume')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {!tenant && (
            <div className="stack" style={{ gap: 3 }}>
              <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personUnit', 'Unitate')}</label>
              <select className="input" value={unitCode} onChange={(e) => setUnitCode(e.target.value)}>
                <option value="">{t('assocInfo.personUnitNone', '— alege unitatea —')}</option>
                {units.map((u) => <option key={u.code} value={u.code}>{u.label} ({u.groupName})</option>)}
              </select>
            </div>
          )}
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personPhone', 'Telefon')}</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personEmail', 'Email')}</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PropertyManagerEditModal({ communityId, unit, onClose, onSaved }: {
  communityId: string; unit: UnitRow; onClose: () => void; onSaved: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [name, setName] = React.useState(unit.propertyManager ?? '')
  const [phone, setPhone] = React.useState(unit.propertyManagerPhone ?? '')
  const [email, setEmail] = React.useState(unit.propertyManagerEmail ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/units/${unit.code}/property-manager`, {
        name: name.trim() || null, phone: phone.trim() || null, email: email.trim() || null,
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '100%', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.propertyManagerEditTitle', 'Administrator proprietate')} — {unit.label}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personName', 'Nume')}</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('assocInfo.propertyManagerNoneHint', '— fără administrator —')} />
          </div>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personPhone', 'Telefon')}</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.personEmail', 'Email')}</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PrimaryOwnerEditModal({ communityId, unit, onClose, onSaved }: {
  communityId: string; unit: UnitRow; onClose: () => void; onSaved: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const ownerNames = (unit.owner ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const [name, setName] = React.useState(unit.mainContact ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/billing-entities/${unit.billingEntityCode}/primary-owner`, { name: name.trim() || null })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, width: '100%', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.primaryOwnerEditTitle', 'Contact principal')} — {unit.label}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.primaryOwnerSelect', 'Proprietar')}</label>
            <select className="input" value={name} onChange={(e) => setName(e.target.value)}>
              {ownerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RoiPolicyEditModal({ communityId, policy, onClose, onSaved }: { communityId: string; policy: RoiPolicy; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [description, setDescription] = React.useState(policy.description ?? '')
  const [tiers, setTiers] = React.useState<RoiTier[]>(policy.tiers)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/association-info`, {
        roiPolicy: { description: description.trim() || null, tiers },
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: '100%', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.roiEditTitle', 'Editează regulamentul (ROI)')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 3 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.roiDescription', 'Descriere generală')}</label>
            <textarea className="input" rows={3} style={{ width: '100%', resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.roiRisk', 'Risc Expunere (zile de la scadență)')}</label>
            {tiers.map((tier, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }} className="stack">
                <div className="row" style={{ gap: 10 }}>
                  <div style={{ flex: 1 }} className="stack">
                    <label className="label" style={{ fontSize: 11 }}>{t('assocInfo.roiLevel', 'Nivel')}</label>
                    <input className="input" value={tier.label} onChange={(e) => setTiers((arr) => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  </div>
                  <div style={{ width: 120 }} className="stack">
                    <label className="label" style={{ fontSize: 11 }}>{t('assocInfo.roiRange', 'Interval')}</label>
                    <input className="input" value={tier.rangeLabel} onChange={(e) => setTiers((arr) => arr.map((x, j) => j === i ? { ...x, rangeLabel: e.target.value } : x))} />
                  </div>
                </div>
                <div className="stack" style={{ gap: 3 }}>
                  <label className="label" style={{ fontSize: 11 }}>{t('assocInfo.roiActionTitle', 'Acțiune')}</label>
                  <input className="input" value={tier.actionTitle} onChange={(e) => setTiers((arr) => arr.map((x, j) => j === i ? { ...x, actionTitle: e.target.value } : x))} />
                </div>
                <div className="stack" style={{ gap: 3 }}>
                  <label className="label" style={{ fontSize: 11 }}>{t('assocInfo.roiActionDesc', 'Descriere acțiune')}</label>
                  <textarea className="input" rows={2} style={{ width: '100%', resize: 'vertical' }} value={tier.actionDesc}
                    onChange={(e) => setTiers((arr) => arr.map((x, j) => j === i ? { ...x, actionDesc: e.target.value } : x))} />
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssociationInfoEditModal({ communityId, info, onClose, onSaved }: { communityId: string; info: AssociationInfo; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [address, setAddress] = React.useState(info.address ?? '')
  const [legalName, setLegalName] = React.useState(info.legalName ?? '')
  const [statutStatus, setStatutStatus] = React.useState(info.statutStatus ?? '')
  const [foundingDate, setFoundingDate] = React.useState(info.foundingDate ?? '')
  const [actConstitutivNr, setActConstitutivNr] = React.useState(info.actConstitutivNr ?? '')
  const [acordAsociereNr, setAcordAsociereNr] = React.useState(info.acordAsociereNr ?? '')
  const [acordAsociereDate, setAcordAsociereDate] = React.useState(info.acordAsociereDate ?? '')
  const [cif, setCif] = React.useState(info.cif ?? '')
  const [bankAccounts, setBankAccounts] = React.useState<BankAccount[]>(info.bankAccounts.length ? info.bankAccounts : [])
  const [legalRepName, setLegalRepName] = React.useState(info.legalRep?.name ?? '')
  const [legalRepTitle, setLegalRepTitle] = React.useState(info.legalRep?.title ?? '')
  const [legalRepPhone, setLegalRepPhone] = React.useState(info.legalRep?.phone ?? '')
  const [legalRepEmail, setLegalRepEmail] = React.useState(info.legalRep?.email ?? '')
  const [agaLast, setAgaLast] = React.useState(info.aga.lastMeeting ?? '')
  const [agaNext, setAgaNext] = React.useState(info.aga.nextMeeting ?? '')
  const [boardMembers, setBoardMembers] = React.useState<BoardMember[]>(info.boardMembers.length ? info.boardMembers : [])
  const [adminCompany, setAdminCompany] = React.useState(info.administrator?.company ?? '')
  const [adminRep, setAdminRep] = React.useState(info.administrator?.rep ?? '')
  const [adminHours, setAdminHours] = React.useState(info.administrator?.hours ?? '')
  const [adminPhone, setAdminPhone] = React.useState(info.administrator?.phone ?? '')
  const [adminEmail, setAdminEmail] = React.useState(info.administrator?.email ?? '')
  const [adminAddress, setAdminAddress] = React.useState(info.administrator?.address ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const inputStyle: React.CSSProperties = { width: '100%' }
  const field = (label: string, node: React.ReactNode) => (
    <div className="stack" style={{ gap: 3 }}>
      <label className="label" style={{ fontSize: 12 }}>{label}</label>
      {node}
    </div>
  )

  const save = async () => {
    setBusy(true); setError(null)
    try {
      await api.patch(`/communities/${communityId}/association-info`, {
        address: address.trim() || null,
        legalName: legalName.trim() || null,
        statutStatus: statutStatus.trim() || null,
        foundingDate: foundingDate || null,
        actConstitutivNr: actConstitutivNr.trim() || null,
        acordAsociereNr: acordAsociereNr.trim() || null,
        acordAsociereDate: acordAsociereDate || null,
        cif: cif.trim() || null,
        bankAccounts: bankAccounts.filter((b) => b.bank.trim() || b.iban.trim()),
        legalRep: (legalRepName.trim() || legalRepPhone.trim() || legalRepEmail.trim())
          ? { name: legalRepName.trim(), title: legalRepTitle.trim(), phone: legalRepPhone.trim(), email: legalRepEmail.trim() } : null,
        aga: { lastMeeting: agaLast || null, nextMeeting: agaNext || null },
        boardMembers: boardMembers.filter((m) => m.name.trim()),
        administrator: (adminCompany.trim() || adminRep.trim())
          ? { company: adminCompany.trim(), rep: adminRep.trim(), hours: adminHours.trim(), phone: adminPhone.trim(), email: adminEmail.trim(), address: adminAddress.trim() } : null,
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, width: '100%', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.editTitle', 'Editează informații asociație')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 16 }}>
          <div className="stack" style={{ gap: 10 }}>
            {field(t('assocInfo.address', 'Adresă'), <input className="input" style={inputStyle} value={address} onChange={(e) => setAddress(e.target.value)} />)}
            {field(t('assocInfo.legalName', 'Nume oficial'), <input className="input" style={inputStyle} value={legalName} onChange={(e) => setLegalName(e.target.value)} />)}
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.statut', 'Statut'), <input className="input" style={inputStyle} value={statutStatus} onChange={(e) => setStatutStatus(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.foundingDate', 'Data înființare'), <input className="input" type="date" style={inputStyle} value={foundingDate} onChange={(e) => setFoundingDate(e.target.value)} />)}</div>
            </div>
            {field(t('assocInfo.actConstitutiv', 'Nr. Act Constitutiv'), <input className="input" style={inputStyle} value={actConstitutivNr} onChange={(e) => setActConstitutivNr(e.target.value)} />)}
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(`${t('assocInfo.acordAsociere', 'Acord de Asociere')} — ${t('assocInfo.number', 'Număr')}`, <input className="input" style={inputStyle} value={acordAsociereNr} onChange={(e) => setAcordAsociereNr(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.registrationDate', 'Data înregistrare'), <input className="input" type="date" style={inputStyle} value={acordAsociereDate} onChange={(e) => setAcordAsociereDate(e.target.value)} />)}</div>
            </div>
            {field(t('assocInfo.cif', 'Cod Fiscal'), <input className="input" style={inputStyle} value={cif} onChange={(e) => setCif(e.target.value)} />)}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.bankAccounts', 'Conturi Bancare')}</label>
            {bankAccounts.map((ba, i) => (
              <div key={i} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input className="input" placeholder={t('assocInfo.bankName', 'Bancă')} style={{ width: 110 }} value={ba.bank}
                  onChange={(e) => setBankAccounts((arr) => arr.map((x, j) => j === i ? { ...x, bank: e.target.value } : x))} />
                <input className="input" placeholder="IBAN" style={{ flex: 1 }} value={ba.iban}
                  onChange={(e) => setBankAccounts((arr) => arr.map((x, j) => j === i ? { ...x, iban: e.target.value } : x))} />
                <input className="input" placeholder={t('assocInfo.currency', 'Valută')} style={{ width: 70 }} value={ba.currency}
                  onChange={(e) => setBankAccounts((arr) => arr.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))} />
                <button type="button" className="btn ghost small" onClick={() => setBankAccounts((arr) => arr.filter((_, j) => j !== i))} title={t('common.remove', 'Șterge')}><IconTrash /></button>
              </div>
            ))}
            <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setBankAccounts((arr) => [...arr, { bank: '', currency: 'RON', iban: '' }])}>
              <IconPlus /> {t('assocInfo.addBankAccount', 'Adaugă cont')}
            </button>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.legalRep', 'Reprezentant Legal')}</label>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.fullName', 'Nume'), <input className="input" style={inputStyle} value={legalRepName} onChange={(e) => setLegalRepName(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.title', 'Funcție'), <input className="input" style={inputStyle} value={legalRepTitle} onChange={(e) => setLegalRepTitle(e.target.value)} />)}</div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.phone', 'Telefon'), <input className="input" style={inputStyle} value={legalRepPhone} onChange={(e) => setLegalRepPhone(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.email', 'Email'), <input className="input" style={inputStyle} value={legalRepEmail} onChange={(e) => setLegalRepEmail(e.target.value)} />)}</div>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.aga', 'Adunare Generală (AGA)')}</label>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.lastMeeting', 'Ultima ședință'), <input className="input" type="date" style={inputStyle} value={agaLast} onChange={(e) => setAgaLast(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.nextMeeting', 'Următoarea'), <input className="input" type="date" style={inputStyle} value={agaNext} onChange={(e) => setAgaNext(e.target.value)} />)}</div>
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.cex', 'Comitet Executiv (CEX)')}</label>
            {boardMembers.map((m, i) => (
              <div key={i} className="row" style={{ gap: 6, alignItems: 'center' }}>
                <input className="input" placeholder={t('assocInfo.fullName', 'Nume')} style={{ flex: 1 }} value={m.name}
                  onChange={(e) => setBoardMembers((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input className="input" placeholder={t('assocInfo.title', 'Funcție')} style={{ width: 150 }} value={m.role}
                  onChange={(e) => setBoardMembers((arr) => arr.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} />
                <button type="button" className="btn ghost small" onClick={() => setBoardMembers((arr) => arr.filter((_, j) => j !== i))} title={t('common.remove', 'Șterge')}><IconTrash /></button>
              </div>
            ))}
            <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setBoardMembers((arr) => [...arr, { name: '', role: '' }])}>
              <IconPlus /> {t('assocInfo.addMember', 'Adaugă membru')}
            </button>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <label className="label" style={{ fontSize: 12 }}>{t('assocInfo.administrator', 'Administrator')}</label>
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.company', 'Companie'), <input className="input" style={inputStyle} value={adminCompany} onChange={(e) => setAdminCompany(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.rep', 'Reprezentant'), <input className="input" style={inputStyle} value={adminRep} onChange={(e) => setAdminRep(e.target.value)} />)}</div>
            </div>
            {field(t('assocInfo.hours', 'Program'), <input className="input" style={inputStyle} value={adminHours} onChange={(e) => setAdminHours(e.target.value)} />)}
            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>{field(t('assocInfo.phone', 'Telefon'), <input className="input" style={inputStyle} value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />)}</div>
              <div style={{ flex: 1 }}>{field(t('assocInfo.email', 'Email'), <input className="input" style={inputStyle} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />)}</div>
            </div>
            {field(t('assocInfo.physicalAddress', 'Adresă fizică'), <input className="input" style={inputStyle} value={adminAddress} onChange={(e) => setAdminAddress(e.target.value)} />)}
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')
const slugifyDomainKey = (name: string) =>
  `${name.trim().toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'domeniu'}-${Date.now().toString(36)}`

const moveItem = <T,>(arr: T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const next = arr.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function ServiceConfigEditModal({ communityId, config, catalog, onClose, onSaved }: { communityId: string; config: ServiceConfig; catalog: ExpenseCatalog; onClose: () => void; onSaved: () => void }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [domains, setDomains] = React.useState<ServiceDomain[]>(config.domains.map((d) => ({ ...d, serviceCodes: [...d.serviceCodes] })))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const setDomainName = (i: number, name: string) => setDomains((arr) => arr.map((x, j) => j === i ? { ...x, name } : x))
  const addDomain = () => setDomains((arr) => [...arr, { key: slugifyDomainKey(''), name: '', serviceCodes: [] }])
  const removeDomain = (i: number) => setDomains((arr) => arr.filter((_, j) => j !== i))
  const moveDomain = (i: number, dir: -1 | 1) => setDomains((arr) => moveItem(arr, i, dir))
  const moveServiceInDomain = (domIdx: number, codeIdx: number, dir: -1 | 1) =>
    setDomains((arr) => arr.map((x, j) => j === domIdx ? { ...x, serviceCodes: moveItem(x.serviceCodes, codeIdx, dir) } : x))
  const unassignFromDomain = (domIdx: number, code: string) =>
    setDomains((arr) => arr.map((x, j) => j === domIdx ? { ...x, serviceCodes: x.serviceCodes.filter((c) => c !== code) } : x))
  const assignToDomain = (code: string, domainKey: string) =>
    setDomains((arr) => arr.map((x) => x.key === domainKey ? { ...x, serviceCodes: [...x.serviceCodes.filter((c) => c !== code), code] } : { ...x, serviceCodes: x.serviceCodes.filter((c) => c !== code) }))

  const assignedCodes = new Set(domains.flatMap((dom) => dom.serviceCodes))
  const unassigned = catalog.expenseTypes.filter((e) => !assignedCodes.has(e.code))

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const realCodes = new Set(catalog.expenseTypes.map((e) => e.code))
      const kept = domains.filter((dom) => dom.name.trim())
      await api.patch(`/communities/${communityId}/association-info`, {
        serviceConfig: {
          domains: kept.map((dom) => ({ key: dom.key, name: dom.name.trim(), serviceCodes: dom.serviceCodes.filter((c) => realCodes.has(c)) })),
        },
      })
      onSaved()
    } catch (e: any) { setError(e?.message || t('common.error', 'Eroare')) } finally { setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, width: '100%', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h4 style={{ margin: 0 }}>{t('assocInfo.servicesEditTitle', 'Editează configurarea serviciilor')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('assocInfo.serviceOrderHint', 'Ordinea de mai jos este ordinea în care aceste servicii apar ca și coloane în avizier.')}</div>
        {error && <div className="badge negative" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="stack" style={{ gap: 14 }}>
          {domains.map((dom, i) => {
            const rows: Array<{ kind: 'real'; e: CatalogExpenseType } | { kind: 'synthetic'; s: CatalogSynthetic }> = []
            for (const code of dom.serviceCodes) {
              const e = catalog.expenseTypes.find((x) => x.code === code)
              if (e) rows.push({ kind: 'real', e })
              for (const s of catalog.synthetic) if (s.anchorCode === code) rows.push({ kind: 'synthetic', s })
            }
            return (
              <div key={dom.key} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }} className="stack">
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <div className="stack" style={{ gap: 2 }}>
                    <button type="button" className="btn ghost small" disabled={i === 0} onClick={() => moveDomain(i, -1)} title={t('assocInfo.moveUp', 'Mută sus')} style={{ padding: '0 6px', lineHeight: 1 }}>↑</button>
                    <button type="button" className="btn ghost small" disabled={i === domains.length - 1} onClick={() => moveDomain(i, 1)} title={t('assocInfo.moveDown', 'Mută jos')} style={{ padding: '0 6px', lineHeight: 1 }}>↓</button>
                  </div>
                  <input className="input" style={{ flex: 1 }} placeholder={t('assocInfo.domainName', 'Domeniu')} value={dom.name} onChange={(e) => setDomainName(i, e.target.value)} />
                  <button type="button" className="btn ghost small" onClick={() => removeDomain(i)} title={t('common.remove', 'Șterge')}><IconTrash /></button>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  {rows.map((r, k) => r.kind === 'real' ? (
                    <div key={r.e.code} className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <div className="stack" style={{ gap: 1 }}>
                        <button type="button" className="btn ghost small" disabled={dom.serviceCodes.indexOf(r.e.code) === 0} onClick={() => moveServiceInDomain(i, dom.serviceCodes.indexOf(r.e.code), -1)} title={t('assocInfo.moveUp', 'Mută sus')} style={{ padding: '0 5px', fontSize: 11, lineHeight: 1.4 }}>↑</button>
                        <button type="button" className="btn ghost small" disabled={dom.serviceCodes.indexOf(r.e.code) === dom.serviceCodes.length - 1} onClick={() => moveServiceInDomain(i, dom.serviceCodes.indexOf(r.e.code), 1)} title={t('assocInfo.moveDown', 'Mută jos')} style={{ padding: '0 5px', fontSize: 11, lineHeight: 1.4 }}>↓</button>
                      </div>
                      <span style={{ flex: 1, fontSize: 13.5 }}>{r.e.name}</span>
                      <button type="button" className="btn ghost small" onClick={() => unassignFromDomain(i, r.e.code)} title={t('assocInfo.unassign', 'Elimină din domeniu')}><IconTrash /></button>
                    </div>
                  ) : (
                    <div key={r.s.code} className="row" style={{ gap: 6, alignItems: 'center', opacity: 0.7, paddingLeft: 24 }}>
                      <span style={{ flex: 1, fontSize: 13.5 }}>{r.s.label}</span>
                      <span className="badge secondary" style={{ fontSize: 10 }}>{t('assocInfo.serviceAutoComputed', 'calculat automat')}</span>
                    </div>
                  ))}
                  {rows.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>—</div>}
                </div>
              </div>
            )
          })}
          <button type="button" className="btn ghost small" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={addDomain}>
            <IconPlus /> {t('assocInfo.addDomain', 'Adaugă domeniu')}
          </button>

          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t('assocInfo.serviceUnassigned', 'Servicii neasignate')}</div>
              {catalog.expenseTypes.length > 0 && (
                <span className={unassigned.length > 0 ? 'badge negative' : 'badge secondary'} style={{ fontSize: 11 }}>
                  {t('assocInfo.serviceUnassignedCount', '{n} neasignate').replace('{n}', String(unassigned.length))}
                </span>
              )}
            </div>
            {catalog.expenseTypes.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{t('assocInfo.serviceCatalogEmpty', 'Niciun serviciu real definit pentru această asociație.')}</div>}
            {unassigned.length === 0 && catalog.expenseTypes.length > 0 && <div className="muted" style={{ fontSize: 13 }}>—</div>}
            {unassigned.map((e) => (
              <div key={e.code} className="row" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, fontSize: 13.5 }}>{e.name}</span>
                <select className="input" style={{ width: 200 }} value="" onChange={(ev) => ev.target.value && assignToDomain(e.code, ev.target.value)}>
                  <option value="">{t('assocInfo.domainSelectPlaceholder', '— neasignat —')}</option>
                  {domains.filter((dom) => dom.name.trim()).map((dom) => <option key={dom.key} value={dom.key}>{dom.name}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel', 'Anulează')}</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? t('common.loading', '…') : t('common.save', 'Salvează')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
