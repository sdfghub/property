import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { FinanceService } from '../finance/finance.service'
import { CONTRACT_VERSION, PROMPT_VERSION, contractJsonSchema } from './intake-contract'
import { renderPromptPack, buildExamplePayload } from './intake-prompts'

// Everything an external agent (or, later, an in-app extractor) needs to know about one community for
// one period, in a deterministic shape: stable ordering, no timestamps, nothing per-request. The same
// object feeds the prompt pack, the review UI's selects (`GET intake/context`) and the blocker checks.
export type IntakeCatalogue = {
  community: { id: string; code: string; name: string }
  /** association-specific guidance kept on the community (Community.intakeHints), appended to the pack */
  hints: string[]
  period: { id: string; code: string; status: string; startDate: string; endDate: string }
  currency: string
  templates: Array<{
    id: string
    code: string
    name: string
    mode: string
    fundCode: string | null
    vendorName: string | null
    instanceState: string | null
    instanceId: string | null
    /** current instance values (internal: VALUE_CONFLICT detection + merge preview); never sent to the agent */
    instanceValues: Record<string, unknown> | null
    invoiceKeys: Record<string, string | undefined>
    items: Array<{ key: string; label: string; kind: string; expenseTypeCode: string | null; fundCode: string | null }>
  }>
  expenseTypes: Array<{ code: string; name: string; fundCode: string | null }>
  funds: Array<{ id: string; code: string; name: string }>
  vendors: Array<{ id: string; name: string; taxId: string | null; iban: string | null }>
  cashAccounts: Array<{ id: string; code: string; name: string; type: string; currency: string }>
  /** units with their owner as of the target period — bank-line receipts resolve to a billing entity through these */
  units: Array<{ id: string; code: string; label: string; billingEntityId: string | null; billingEntityName: string | null; billingEntityCode: string | null }>
  /** where an owner's overpayment is credited when the line names no fund (EXPENSES when it exists) */
  defaultAdvanceFundCode: string | null
  unpaidInvoices: Array<{ id: string; number: string | null; vendorName: string | null; gross: number; outstanding: number; dueDate: string | null; templateInstanceId: string | null; intakeRecordId: string | null }>
  recentInvoices: Array<{ id: string; number: string | null; vendorName: string | null; vendorId: string | null; gross: number | null; issueDate: string | null; templateInstanceId: string | null; intakeRecordId: string | null }>
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null)
const byCode = <T extends { code: string }>(a: T, b: T) => a.code.localeCompare(b.code)

@Injectable()
export class IntakePromptService {
  constructor(private readonly prisma: PrismaService, private readonly finance: FinanceService) {}

  async resolveCommunity(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true, code: true, name: true, intakeHints: true } })
    if (!c) throw new NotFoundException('Community not found')
    const { intakeHints, ...rest } = c
    return { ...rest, hints: Array.isArray(intakeHints) ? (intakeHints as unknown[]).map(String) : [] }
  }

  async buildCatalogue(communityRef: string, periodCode: string): Promise<IntakeCatalogue> {
    const community = await this.resolveCommunity(communityRef)
    const communityId = community.id
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException(`Period ${periodCode} not found`)

    const [templates, instances, expenseTypes, funds, vendors, cashAccounts, unpaid, recent, unitRows, members] = await Promise.all([
      this.prisma.billTemplate.findMany({ where: { communityId }, select: { id: true, code: true, name: true, template: true, order: true } }),
      this.prisma.billTemplateInstance.findMany({ where: { communityId, periodId: period.id }, select: { id: true, templateId: true, state: true, values: true } }),
      this.prisma.expenseType.findMany({ where: { communityId }, select: { code: true, name: true, params: true } }),
      this.prisma.fund.findMany({ where: { communityId }, select: { id: true, code: true, name: true } }),
      this.prisma.vendor.findMany({ where: { communityId }, select: { id: true, name: true, taxId: true, iban: true } }),
      this.prisma.cashAccount.findMany({ where: { communityId, status: 'ACTIVE' }, select: { id: true, code: true, name: true, type: true, currency: true } }),
      this.finance.unpaidVendorInvoices(communityId),
      this.prisma.vendorInvoice.findMany({
        where: { communityId, issueDate: { gte: new Date(Date.now() - 366 * 86400_000) } },
        select: { id: true, number: true, vendorId: true, gross: true, issueDate: true, templateInstanceId: true, provenance: true, vendor: { select: { name: true } } },
        orderBy: [{ issueDate: 'desc' }],
        take: 300,
      }),
      this.prisma.unit.findMany({ where: { communityId }, select: { id: true, code: true, name: true, order: true } }),
      this.prisma.billingEntityMember.findMany({
        where: { unit: { communityId }, startSeq: { lte: period.seq }, OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }] },
        select: { unitId: true, billingEntity: { select: { id: true, code: true, name: true } } },
      }),
    ])
    const ownerByUnit = new Map(members.map((m) => [m.unitId, m.billingEntity]))
    const stateByTemplate = new Map(instances.map((i) => [i.templateId, i.state]))
    const idByTemplate = new Map(instances.map((i) => [i.templateId, i.id]))
    // unpaid rows come from raw SQL; fetch the two provenance fields the self-dedupe needs
    const unpaidIds = (unpaid.invoices as any[]).map((r) => r.id)
    const unpaidExtra = unpaidIds.length ? await this.prisma.vendorInvoice.findMany({ where: { id: { in: unpaidIds } }, select: { id: true, templateInstanceId: true, provenance: true } }) : []
    const extraById = new Map(unpaidExtra.map((x) => [x.id, x]))
    const valuesByTemplate = new Map(instances.map((i) => [i.templateId, (i.values as Record<string, unknown> | null) ?? null]))

    const { hints, ...communityRow } = community
    return {
      community: communityRow,
      hints,
      period: { id: period.id, code: period.code, status: period.status, startDate: iso(period.startDate)!, endDate: iso(period.endDate)! },
      currency: 'RON',
      templates: templates
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byCode(a, b))
        .map((t) => {
          const body: any = t.template || {}
          const output: any = body.output || {}
          const items: any[] = Array.isArray(body.items) ? body.items : []
          return {
            id: t.id,
            code: t.code,
            name: t.name,
            mode: String(output.mode || 'CHARGES_ONLY'),
            fundCode: output.fundCode ?? null,
            vendorName: output.vendor?.name ?? null,
            instanceState: stateByTemplate.get(t.id) ?? null,
            instanceId: idByTemplate.get(t.id) ?? null,
            instanceValues: valuesByTemplate.get(t.id) ?? null,
            invoiceKeys: output.invoice ?? {},
            items: items
              .filter((it) => it && it.key && it.kind !== 'meter')
              .map((it) => ({
                key: String(it.key),
                label: String(it.label ?? it.key),
                kind: String(it.kind ?? 'charge'),
                expenseTypeCode: it.expenseTypeCode ?? null,
                fundCode: it.fundCode ?? output.fundCode ?? null,
              })),
          }
        }),
      expenseTypes: expenseTypes
        .map((e) => ({ code: e.code, name: e.name, fundCode: ((e.params as any)?.fundCode as string) ?? null }))
        .sort(byCode),
      funds: funds.sort(byCode),
      vendors: vendors.sort((a, b) => a.name.localeCompare(b.name)),
      cashAccounts: cashAccounts.sort(byCode),
      units: unitRows
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || byCode(a, b))
        .map((u) => {
          const be = ownerByUnit.get(u.id) ?? null
          return { id: u.id, code: u.code, label: u.name ?? u.code.replace(/^.*?-(?=[A-Z]{2,}\s)/, ''), billingEntityId: be?.id ?? null, billingEntityName: be?.name ?? null, billingEntityCode: be?.code ?? null }
        }),
      defaultAdvanceFundCode: funds.some((f) => f.code === 'EXPENSES') ? 'EXPENSES' : funds[0]?.code ?? null,
      unpaidInvoices: (unpaid.invoices as any[]).map((r) => ({
        id: r.id,
        number: r.number ?? null,
        vendorName: r.vendor ?? null,
        gross: Number(r.gross ?? 0),
        outstanding: Number(r.outstanding ?? 0),
        dueDate: iso(r.dueDate),
        templateInstanceId: extraById.get(r.id)?.templateInstanceId ?? null,
        intakeRecordId: ((extraById.get(r.id)?.provenance as any)?.intakeRecordId as string) ?? null,
      })),
      recentInvoices: recent.map((r) => ({
        id: r.id,
        number: r.number,
        vendorName: r.vendor?.name ?? null,
        vendorId: r.vendorId,
        gross: r.gross == null ? null : Number(r.gross),
        issueDate: iso(r.issueDate),
        templateInstanceId: r.templateInstanceId ?? null,
        intakeRecordId: ((r.provenance as any)?.intakeRecordId as string) ?? null,
      })),
    }
  }

  async getHints(communityRef: string) {
    const c = await this.resolveCommunity(communityRef)
    return { hints: c.hints }
  }

  /** Replace the association's hints (one string per hint; blank lines dropped, trimmed, capped). */
  async setHints(communityRef: string, hints: unknown) {
    const c = await this.resolveCommunity(communityRef)
    const list = (Array.isArray(hints) ? hints : typeof hints === 'string' ? hints.split(/\r?\n/) : [])
      .map((h) => String(h).trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((h) => h.slice(0, 1000))
    await this.prisma.community.update({ where: { id: c.id }, data: { intakeHints: list } })
    return { hints: list }
  }

  async buildPack(communityRef: string, periodCode: string) {
    const catalogue = await this.buildCatalogue(communityRef, periodCode)
    const schema = contractJsonSchema()
    const example = buildExamplePayload(catalogue)
    const prompt = renderPromptPack({ catalogue, schema, example })
    return { promptVersion: PROMPT_VERSION, contractVersion: CONTRACT_VERSION, prompt, schema, example, catalogue }
  }
}
