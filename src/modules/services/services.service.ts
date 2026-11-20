import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ServiceOperationalStatus, ServicePriority, ServiceTier, ServiceWorkStatus } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { OPEN_TICKET_STATUSES } from '../../common/enums-meta'

/** ServiceItem.equipmentDefs, normalised: [{ name, variants[] }]. */
export type EquipmentDef = { name: string; variants: string[] }
export const equipmentDefsOf = (raw: any): EquipmentDef[] =>
  (Array.isArray(raw) ? raw : []).filter((d: any) => d && typeof d.name === 'string').map((d: any) => ({
    name: d.name, variants: Array.isArray(d.variants) ? d.variants.map(String) : [],
  }))

// General evaluation scale — the source of truth for level names/definitions. The frontend
// renders whatever this returns; `level: null` is N/A (not assessed / not applicable).
export const SERVICE_SCALE: Array<{ level: number | null; label: string; definition: string; labelEn: string; definitionEn: string }> = [
  { level: 0, label: 'Inexistent / Nefuncțional', definition: 'Serviciul lipsește sau infrastructura există, dar nu își poate îndeplini funcția. Pentru Clădire, nivelul 0 poate însemna o situație critică/nesigură care necesită punere în siguranță.', labelEn: 'Non-existent / Not functional', definitionEn: 'The service is missing, or the infrastructure exists but cannot perform its function. For the Building, level 0 can mean a critical/unsafe situation that needs to be made safe.' },
  { level: 1, label: 'Nesatisfăcător', definition: 'Serviciul există, dar are deficiențe majore și nu își îndeplinește corespunzător funcția.', labelEn: 'Unsatisfactory', definitionEn: 'The service exists but has major deficiencies and does not properly perform its function.' },
  { level: 2, label: 'Slab / Parțial', definition: 'Serviciul funcționează doar parțial sau lipsesc componente importante; sunt necesare îmbunătățiri semnificative.', labelEn: 'Poor / Partial', definitionEn: 'The service works only partially or important components are missing; significant improvements are needed.' },
  { level: 3, label: 'Acceptabil', definition: 'Funcția de bază este asigurată, dar există deficiențe sau componente relevante care trebuie îmbunătățite.', labelEn: 'Acceptable', definitionEn: 'The basic function is provided, but there are deficiencies or relevant components that need improvement.' },
  { level: 4, label: 'Bun', definition: 'Serviciul este complet și bine gestionat; mai sunt necesare doar îmbunătățiri minore.', labelEn: 'Good', definitionEn: 'The service is complete and well managed; only minor improvements are still needed.' },
  { level: 5, label: 'Excelent / Nivel țintă', definition: 'Serviciul este complet, modern, eficient și gestionat preventiv, conform standardului țintă al imobilului.', labelEn: 'Excellent / Target level', definitionEn: 'The service is complete, modern, efficient and preventively managed, to the building\'s target standard.' },
  { level: null, label: 'Nu se evaluează / De evaluat', definition: 'Serviciul nu este aplicabil sau nu există suficiente informații pentru o evaluare responsabilă.', labelEn: 'Not assessed / To be assessed', definitionEn: 'The service is not applicable or there is not enough information for a responsible assessment.' },
]

export const SERVICE_WORK_STATUSES: Array<{ code: ServiceWorkStatus; label: string; labelEn: string }> = [
  { code: 'NOT_STARTED', label: 'Neînceput', labelEn: 'Not started' },
  { code: 'IN_DESIGN', label: 'În proiectare', labelEn: 'In design' },
  { code: 'CONTRACTED', label: 'Contractat', labelEn: 'Contracted' },
  { code: 'IN_EXECUTION', label: 'În execuție', labelEn: 'In progress' },
  { code: 'OPERATIONAL', label: 'Funcțional', labelEn: 'Operational' },
]

export const SERVICE_PRIORITIES: Array<{ code: ServicePriority; label: string; labelEn: string }> = [
  { code: 'CRITICAL', label: 'Critică', labelEn: 'Critical' },
  { code: 'HIGH', label: 'Ridicată', labelEn: 'High' },
  { code: 'MEDIUM', label: 'Medie', labelEn: 'Medium' },
  { code: 'LOW', label: 'Scăzută', labelEn: 'Low' },
]

// Operational state on the services dashboard. `value` 0–3 enters the domain average; a negative
// value (the service does not exist now / is stopped on purpose) is shown but never averaged.
// `tone` is the colour family the UI paints it with.
export const SERVICE_STATUSES: Array<{ code: ServiceOperationalStatus; label: string; value: number; tone: 'red' | 'orange' | 'yellow' | 'green' | 'grey' | 'black'; definition: string; labelEn: string; definitionEn: string }> = [
  // Listed by value, highest first — the legend, the definitions and the status picker use this order.
  { code: 'FUNCTIONAL', label: 'Funcțional', value: 3, tone: 'green', definition: 'Serviciul funcționează normal.', labelEn: 'Functional', definitionEn: 'The service works normally.' },
  { code: 'PARTIAL', label: 'Parțial funcțional', value: 2, tone: 'yellow', definition: 'Serviciul funcționează, dar nu complet sau nu în toate zonele.', labelEn: 'Partially functional', definitionEn: 'The service works, but not fully or not in all areas.' },
  { code: 'PARTIAL_HIGH_RISK', label: 'Risc mare', value: 1, tone: 'orange', definition: 'Parțial funcțional, cu risc mare: poate ceda sau poate pune în pericol oameni ori bunuri; necesită intervenție prioritară.', labelEn: 'High risk', definitionEn: 'Partially functional with high risk: it may fail or endanger people or property; needs priority intervention.' },
  { code: 'NOT_FUNCTIONAL', label: 'Nefuncțional', value: 0, tone: 'red', definition: 'Serviciul există, dar nu funcționează din cauza unor factori externi sau neprevăzuți (avarie, defecțiune).', labelEn: 'Not functional', definitionEn: 'The service exists but does not work because of external or unforeseen factors (breakdown, fault).' },
  { code: 'STOPPED', label: 'Oprit', value: -1, tone: 'black', definition: 'Serviciul este oprit deliberat. Nu intră în medie.', labelEn: 'Stopped', definitionEn: 'The service is deliberately stopped. Not included in the average.' },
  { code: 'UNAVAILABLE', label: 'Indisponibil', value: -2, tone: 'grey', definition: 'Serviciul nu există momentan în clădire; nu are evaluare. Nu intră în medie.', labelEn: 'Unavailable', definitionEn: 'The service does not currently exist in the building; it has no assessment. Not included in the average.' },
]
// Services provided by someone other than the association (shown in italic with an asterisk).
export const SERVICE_PROVIDERS: Array<{ code: string; label: string; note: string; labelEn: string; noteEn: string }> = [
  { code: 'MUNICIPALITY', label: 'Primărie', note: 'Serviciu oferit de primărie, nu de asociație; asociația îl urmărește, dar nu îl contractează și nu îl plătește.',
    labelEn: 'City hall', noteEn: 'Service provided by the city hall, not by the association; the association tracks it but does not contract or pay for it.' },
]

// Service classes by how critical the function is. Every catalogue item carries one (`tier`); the
// dashboard groups by them, and the definitions are shown next to the groups.
export const SERVICE_TIERS: Array<{ code: ServiceTier; label: string; definition: string; examples: string; labelEn: string; definitionEn: string; examplesEn: string }> = [
  { code: 'VITAL', label: 'Vitale',
    definition: 'Mențin clădirea sigură și locuibilă. Pierderea funcției poate pune oamenii în pericol sau poate face imposibilă utilizarea normală a imobilului la un nivel minim.',
    examples: 'Siguranță structurală, protecție la incendiu și evacuare, apă potabilă, canalizare, încălzire minimă în sezonul rece.',
    labelEn: 'Vital',
    definitionEn: 'Keep the building safe and habitable. Losing the function can put people in danger or make normal use of the building impossible, even at a minimum level.',
    examplesEn: 'Structural safety, fire protection and evacuation, drinking water, sewerage, minimum heating in the cold season.' },
  { code: 'ESSENTIAL', label: 'Esențiale',
    definition: 'Mențin clădirea funcțională, igienică și protejată de degradare. O întrerupere limitată poate fi tolerată, dar lipsa prelungită afectează locuirea sau starea proprietății.',
    examples: 'Curățenie, salubritate, iluminat obișnuit, controlul accesului, evacuarea apelor pluviale în condiții obișnuite, administrare.',
    labelEn: 'Essential',
    definitionEn: 'Keep the building functional, hygienic and protected from deterioration. A limited interruption can be tolerated, but a prolonged absence affects living conditions or the state of the property.',
    examplesEn: 'Cleaning, waste collection, regular lighting, access control, rainwater drainage under normal conditions, administration.' },
  { code: 'SUPPLEMENTARY', label: 'Suplimentare',
    definition: 'Îmbunătățesc confortul, aspectul sau experiența de utilizare, după ce funcțiile de bază sunt asigurate.',
    examples: '',
    labelEn: 'Supplementary',
    definitionEn: 'Improve comfort, appearance or the user experience, once the basic functions are in place.',
    examplesEn: '' },
]

export type ServiceLang = 'ro' | 'en'
/** A vocabulary entry in the requested language: `label`/`definition`/`note`/`examples` take the
 *  English text when lang=en (the `*En` fields are dropped from the payload either way). */
function localize<T extends Record<string, any>>(x: T, lang: ServiceLang) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(x)) if (!k.endsWith('En')) out[k] = lang === 'en' && x[`${k}En`] != null ? x[`${k}En`] : v
  return out as T
}

const STATUS_VALUE = new Map(SERVICE_STATUSES.map((s) => [s.code as string, s.value]))

/** A service that does not exist now (Indisponibil) has no evaluation: its satisfaction is null. */
export function satisfactionOf(item: { status: string | null; level: number | null }) {
  return item.status === 'UNAVAILABLE' ? null : item.level
}

/**
 * Domain (and overall) aggregate: status = mean of the 0–3 values (negative states and unset
 * statuses are left out); satisfaction = mean of the 0–5 levels of the evaluated services
 * (level null = not evaluated, left out). Each mean comes with how many services it counts.
 */
export function aggregateServices(items: Array<{ domain: string; tier?: string | null; status: string | null; level: number | null }>) {
  const agg = (list: typeof items) => {
    const st = list.map((i) => (i.status ? STATUS_VALUE.get(i.status) : undefined)).filter((v): v is number => v != null && v >= 0)
    const lv = list.map(satisfactionOf).filter((v): v is number => v != null)
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null) // one decimal
    // A group with no service available takes that state itself: all Indisponibil → Indisponibil;
    // only Indisponibil/Oprit with at least one Oprit → Oprit. Otherwise its state is the average.
    const all = (code: string) => list.length > 0 && list.every((i) => i.status === code)
    const allNegative = list.length > 0 && list.every((i) => i.status != null && (STATUS_VALUE.get(i.status) ?? 0) < 0)
    const statusCode = all('UNAVAILABLE') ? 'UNAVAILABLE' : allNegative ? 'STOPPED' : null
    return { status: mean(st), statusCount: st.length, statusCode, satisfaction: mean(lv), satisfactionCount: lv.length, total: list.length }
  }
  const domains = [...new Set(items.map((i) => i.domain))].map((domain) => ({ domain, ...agg(items.filter((i) => i.domain === domain)) }))
  // One entry per class, in SERVICE_TIERS order (classes with no service are left out).
  const tiers = SERVICE_TIERS.filter((tr) => items.some((i) => i.tier === tr.code)).map((tr) => ({ tier: tr.code as string, ...agg(items.filter((i) => i.tier === tr.code)) }))
  return { domains, tiers, overall: agg(items) }
}
const STATUS_CODES = new Set<string>(SERVICE_STATUSES.map((s) => s.code))

const WORK_STATUS_CODES = new Set<string>(SERVICE_WORK_STATUSES.map((s) => s.code))
const PRIORITY_CODES = new Set<string>(SERVICE_PRIORITIES.map((p) => p.code))

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCommunityId(communityId: string) {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { id: true },
    })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  private parseLevel(raw: any): number | null {
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0 || n > 5) throw new BadRequestException('level must be an integer 0–5 or null')
    return n
  }

  private parseCode<T extends string>(raw: any, allowed: Set<string>, field: string): T | null {
    if (raw === null || raw === undefined || raw === '') return null
    const v = String(raw).toUpperCase()
    if (!allowed.has(v)) throw new BadRequestException(`${field} is invalid`)
    return v as T
  }

  private text(raw: any): string | null {
    const v = String(raw ?? '').trim()
    return v ? v : null
  }

  /** Catalog + the scale/status/priority vocabularies the UI needs to render it. */
  async getCatalog(communityId: string, lang: ServiceLang = 'ro') {
    const id = await this.resolveCommunityId(communityId)
    const items = await this.prisma.serviceItem.findMany({
      where: { communityId: id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    // Trend: today's satisfaction vs the state at the end of last month (the latest history row
    // before the 1st of this month). A service with no history before then has no trend.
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
    const before = await this.prisma.serviceAssessment.findMany({
      where: { serviceItem: { communityId: id }, createdAt: { lt: monthStart } },
      orderBy: { createdAt: 'desc' }, select: { serviceItemId: true, level: true, status: true },
    })
    const prevOf = new Map<string, { level: number | null; status: string | null }>()
    for (const b of before) if (!prevOf.has(b.serviceItemId)) prevOf.set(b.serviceItemId, b)
    const aggNow = aggregateServices(items)
    // Open incidents per service (ticketing, type INCIDENT) — shown as counters on the dashboard.
    const incidentRows = await this.prisma.ticket.groupBy({
      by: ['serviceItemId'],
      where: { communityId: id, type: 'INCIDENT', status: { in: OPEN_TICKET_STATUSES as any } },
      _count: { _all: true },
    })
    const incidentsOf = new Map(incidentRows.map((r) => [r.serviceItemId, r._count._all]))
    const openIncidents = incidentRows.reduce((a, r) => a + r._count._all, 0)
    const trendOf = (from: number | null | undefined, to: number | null) => (from == null || to == null ? null : { from, to, delta: Math.round((to - from) * 10) / 10 })
    // Last month's satisfaction of a service; a status not recorded then is taken as today's (statuses
    // are newer than most evaluations), so a service unavailable today has no evaluation then either.
    const prevSat = (i: (typeof items)[number]) => {
      const p = prevOf.get(i.id)
      return p ? satisfactionOf({ status: p.status ?? i.status, level: p.level }) : null
    }
    // A group's trend compares like with like: only services evaluated both last month and now.
    const groupTrend = (list: typeof items) => {
      const both = list.map((i) => [prevSat(i), satisfactionOf(i)] as const).filter((x): x is readonly [number, number] => x[0] != null && x[1] != null)
      if (!both.length) return null
      const mean = (k: 0 | 1) => Math.round((both.reduce((a, x) => a + x[k], 0) / both.length) * 10) / 10
      return { ...trendOf(mean(0), mean(1))!, count: both.length }
    }
    // lang=en: names, domains, level definitions and vocabularies in English (falling back to the
    // Romanian text where no translation is stored). `domain` stays the grouping key either way —
    // it is the domain's display name in the requested language, and `domainKey` the stored one.
    const en = lang === 'en'
    const domainName = new Map(items.map((i) => [i.domain, (en && i.domainEn) || i.domain]))
    const loc = <T extends Record<string, any>>(list: T[]) => list.map((x) => localize(x, lang))
    return {
      lang,
      scale: loc(SERVICE_SCALE),
      statuses: loc(SERVICE_STATUSES),
      providers: loc(SERVICE_PROVIDERS),
      tiers: loc(SERVICE_TIERS),
      trendSince: prevMonth,
      openIncidents,
      aggregates: {
        domains: aggNow.domains.map((d) => ({ ...d, domain: domainName.get(d.domain) ?? d.domain, trend: groupTrend(items.filter((i) => i.domain === d.domain)) })),
        tiers: aggNow.tiers.map((g) => ({ ...g, trend: groupTrend(items.filter((i) => i.tier === g.tier)) })),
        overall: { ...aggNow.overall, trend: groupTrend(items) },
      },
      workStatuses: loc(SERVICE_WORK_STATUSES),
      priorities: loc(SERVICE_PRIORITIES),
      items: items.map((full) => {
        const { nameEn, domainEn, levelDefsEn, ...i } = full
        return {
        ...i,
        domainKey: i.domain,
        domain: domainName.get(i.domain) ?? i.domain,
        name: (en && nameEn) || i.name,
        levelDefs: (en && levelDefsEn) || i.levelDefs,
        satisfaction: satisfactionOf(i),
        trend: trendOf(prevSat(full), satisfactionOf(i)),
        openIncidents: incidentsOf.get(i.id) ?? 0,
        }
      }),
    }
  }

  async getHistory(communityId: string, itemId: string) {
    const id = await this.resolveCommunityId(communityId)
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, communityId: id }, select: { id: true } })
    if (!item) throw new NotFoundException('Service not found')
    return this.prisma.serviceAssessment.findMany({
      where: { serviceItemId: itemId },
      orderBy: { createdAt: 'desc' },
      include: { assessedBy: { select: { id: true, name: true, email: true } } },
    })
  }

  /**
   * A service's equipment inside the units: its kinds (`equipmentDefs`) and, for every unit, the
   * variant it has of each kind (null = not recorded).
   */
  async getEquipment(communityId: string, itemId: string) {
    const id = await this.resolveCommunityId(communityId)
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, communityId: id }, select: { id: true, equipmentDefs: true } })
    if (!item) throw new NotFoundException('Service not found')
    const [units, rows] = await Promise.all([
      this.prisma.unit.findMany({ where: { communityId: id }, orderBy: { order: 'asc' }, select: { id: true, code: true, name: true } }),
      this.prisma.unitEquipment.findMany({ where: { serviceItemId: itemId } }),
    ])
    return {
      defs: equipmentDefsOf(item.equipmentDefs),
      units: units.map((u) => ({
        id: u.id,
        label: u.name || u.code.split('-').slice(3).join('-') || u.code,
        equipment: Object.fromEntries(rows.filter((r) => r.unitId === u.id).map((r) => [r.name, r.variant ?? ''])),
      })),
    }
  }

  /** Set (or with `variant: null` and `remove: true`, remove) one unit's piece of equipment. */
  async setEquipment(communityId: string, itemId: string, body: any) {
    const id = await this.resolveCommunityId(communityId)
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, communityId: id }, select: { equipmentDefs: true } })
    if (!item) throw new NotFoundException('Service not found')
    const unitId = this.text(body?.unitId)
    const name = this.text(body?.name)
    const variant = this.text(body?.variant)
    const unit = unitId ? await this.prisma.unit.findFirst({ where: { id: unitId, communityId: id }, select: { id: true } }) : null
    if (!unit) throw new BadRequestException('Unknown unit')
    const def = equipmentDefsOf(item.equipmentDefs).find((d) => d.name === name)
    if (!def) throw new BadRequestException('Unknown equipment for this service')
    if (variant && def.variants?.length && !def.variants.includes(variant)) throw new BadRequestException('Unknown equipment variant')
    const key = { unitId_serviceItemId_name: { unitId: unit.id, serviceItemId: itemId, name: def.name } }
    if (body?.remove) {
      await this.prisma.unitEquipment.deleteMany({ where: { unitId: unit.id, serviceItemId: itemId, name: def.name } })
      return { removed: true }
    }
    return this.prisma.unitEquipment.upsert({
      where: key,
      create: { communityId: id, unitId: unit.id, serviceItemId: itemId, name: def.name, variant },
      update: { variant },
    })
  }

  /** Save a new evaluation: updates the item's current values and appends a history row. */
  async assess(communityId: string, itemId: string, userId: string | null, body: any) {
    const id = await this.resolveCommunityId(communityId)
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, communityId: id } })
    if (!item) throw new NotFoundException('Service not found')

    // The evaluation may also set the operational status (omit `status` to keep the current one).
    // A service that does not exist now (Indisponibil) has no evaluation: its level is saved empty.
    const status = body && 'status' in body ? this.parseCode<ServiceOperationalStatus>(body.status, STATUS_CODES, 'status') : item.status
    const data = {
      status,
      level: status === 'UNAVAILABLE' ? null : this.parseLevel(body?.level),
      comment: this.text(body?.comment),
      actions: this.text(body?.actions),
      workStatus: this.parseCode<ServiceWorkStatus>(body?.workStatus, WORK_STATUS_CODES, 'workStatus'),
      priority: this.parseCode<ServicePriority>(body?.priority, PRIORITY_CODES, 'priority'),
    }
    const now = new Date()
    const [updated] = await this.prisma.$transaction([
      this.prisma.serviceItem.update({ where: { id: itemId }, data: { ...data, assessedAt: now } }),
      this.prisma.serviceAssessment.create({
        data: { ...data, serviceItemId: itemId, assessedById: userId, createdAt: now },
      }),
    ])
    return updated
  }

  /** Change only the operational status; the history row keeps the other current values. */
  async setStatus(communityId: string, itemId: string, userId: string | null, raw: any) {
    const id = await this.resolveCommunityId(communityId)
    const item = await this.prisma.serviceItem.findFirst({ where: { id: itemId, communityId: id } })
    if (!item) throw new NotFoundException('Service not found')
    const status = this.parseCode<ServiceOperationalStatus>(raw, STATUS_CODES, 'status')
    const [updated] = await this.prisma.$transaction([
      this.prisma.serviceItem.update({ where: { id: itemId }, data: { status } }),
      this.prisma.serviceAssessment.create({
        data: { serviceItemId: itemId, assessedById: userId, level: item.level, comment: item.comment, actions: item.actions, workStatus: item.workStatus, priority: item.priority, status },
      }),
    ])
    return updated
  }

  /**
   * Save the order of the whole catalogue (all item ids, in display order; a domain's position is
   * its first service's). The same order is then written to the avizier's service configuration,
   * and the budget reads it from the catalogue directly.
   */
  async saveOrder(communityId: string, ids: string[]) {
    const id = await this.resolveCommunityId(communityId)
    const items = await this.prisma.serviceItem.findMany({ where: { communityId: id }, select: { id: true, domain: true } })
    if (!Array.isArray(ids) || new Set(ids).size !== items.length || !items.every((i) => ids.includes(i.id))) {
      throw new BadRequestException('ids must list every service of the community exactly once')
    }
    // Keep each domain contiguous, in the order its first service appears.
    const domOf = new Map(items.map((i) => [i.id, i.domain]))
    const doms = [...new Set(ids.map((x) => domOf.get(x)!))]
    const ordered = doms.flatMap((d) => ids.filter((x) => domOf.get(x) === d))
    await this.prisma.$transaction(ordered.map((itemId, i) => this.prisma.serviceItem.update({ where: { id: itemId }, data: { sortOrder: i } })))
    const avizier = await this.syncAvizierOrder(id)
    return { order: ordered, avizier }
  }

  /**
   * Avizier order = catalogue order. An avizier expense type belongs to the catalogue service its
   * budget lines are booked on (budget line `actualSource.codes` → budget service → evaluated
   * service). Expense types with no such link keep their place right after the code they followed.
   * Domains are rebuilt with the catalogue's domain names; the flat `default` list (which sets the
   * report's column order) is rewritten with the same sequence.
   */
  async syncAvizierOrder(communityId: string) {
    const c = await this.prisma.community.findUnique({ where: { id: communityId }, select: { features: true } })
    const features = ((c?.features as any) ?? {})
    const info = features.associationInfo ?? {}
    const cfgDomains: any[] = Array.isArray(info.serviceConfig?.domains) ? info.serviceConfig.domains : []
    const named = cfgDomains.filter((d) => d.key !== 'default')
    const def = cfgDomains.find((d) => d.key === 'default')
    const oldFlat = [...new Set([...(def?.serviceCodes ?? []), ...named.flatMap((d) => d.serviceCodes ?? [])])] as string[]
    if (!oldFlat.length) return null

    const [items, defs, version] = await Promise.all([
      this.prisma.serviceItem.findMany({ where: { communityId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, domain: true } }),
      this.prisma.budgetServiceDef.findMany({ where: { communityId }, select: { code: true, serviceItemId: true } }),
      this.prisma.budgetVersion.findFirst({ where: { communityId }, orderBy: { fiscalYear: 'desc' }, select: { id: true } }),
    ])
    const lines = version ? await this.prisma.budgetLine.findMany({ where: { versionId: version.id }, select: { serviceCode: true, actualSource: true } }) : []
    const itemOfDef = new Map(defs.map((d) => [d.code, d.serviceItemId]))
    const itemOfCode = new Map<string, string>()
    for (const l of lines) {
      const it = l.serviceCode ? itemOfDef.get(l.serviceCode) : null
      for (const code of ((l.actualSource as any)?.codes ?? []) as string[]) if (it && !itemOfCode.has(code)) itemOfCode.set(code, it)
    }
    const rank = new Map(items.map((i, ix) => [i.id, ix]))
    const domainOfItem = new Map(items.map((i) => [i.id, i.domain]))
    const mapped = oldFlat.filter((code) => itemOfCode.has(code))
      .sort((a, b) => rank.get(itemOfCode.get(a)!)! - rank.get(itemOfCode.get(b)!)! || oldFlat.indexOf(a) - oldFlat.indexOf(b))
    const flat = [...mapped]
    const domainOf = new Map(mapped.map((code) => [code, domainOfItem.get(itemOfCode.get(code)!)!]))
    for (const code of oldFlat) {
      if (itemOfCode.has(code)) continue
      const prev = oldFlat.slice(0, oldFlat.indexOf(code)).reverse().find((x) => flat.includes(x))
      const at = prev ? flat.indexOf(prev) + 1 : flat.length
      flat.splice(at, 0, code)
      const oldDom = named.find((d) => (d.serviceCodes ?? []).includes(code))?.name
      domainOf.set(code, (prev && domainOf.get(prev)) || oldDom || 'Alte servicii')
    }
    const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const domNames = [...new Set(flat.map((code) => domainOf.get(code)!))]
    const domains = domNames.map((name, i) => {
      const old = named.find((d) => norm(String(d.name ?? '')) === norm(name))
      return { key: old?.key ?? `domeniu-${i + 1}-${norm(name).replace(/[^a-z0-9]+/g, '-')}`, name, serviceCodes: flat.filter((code) => domainOf.get(code) === name) }
    })
    const next = [...domains, ...(def ? [{ ...def, serviceCodes: flat }] : [])]
    await this.prisma.community.update({ where: { id: communityId }, data: { features: { ...features, associationInfo: { ...info, serviceConfig: { ...(info.serviceConfig ?? {}), domains: next } } } } })
    return { order: flat, domains: domains.map((d) => ({ name: d.name, serviceCodes: d.serviceCodes })) }
  }
}
