import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { ChargeSourceType, SeriesOrigin, SeriesScope } from '@prisma/client'
type UploadedFile = { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }
import { PrismaService } from '../user/prisma.service'
import { AllocationService } from './allocation.service'
import { VendorInvoiceService } from './vendor-invoice.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }
type TemplateKind = 'BILL' | 'METER'
type BillTemplateDto = {
  code: string
  name: string
  order?: number
  startPeriodCode?: string | null
  endPeriodCode?: string | null
  template: { title?: string; items?: any[]; output?: any }
}
type MeterTemplateDto = {
  code: string
  name: string
  order?: number
  startPeriodCode?: string | null
  endPeriodCode?: string | null
  template: any
}

@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocator: AllocationService,
    private readonly vendorInvoices: VendorInvoiceService,
  ) {}

  private async ensureCommunityId(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  private ensureAdmin(_roles: RoleAssignment[], _communityId: string) {
    return
  }

  private normalizeBillTemplates(raw: any): BillTemplateDto[] {
    const templates: BillTemplateDto[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([code, tpl]: any) => ({
          code,
          name: (tpl as any).title || code,
          order: (tpl as any).order ?? null,
          startPeriodCode: (tpl as any).startPeriodCode ?? null,
          endPeriodCode: (tpl as any).endPeriodCode ?? null,
          template: tpl,
        }))
      : []
    if (!templates.length) throw new ForbiddenException('Bill templates payload must be a non-empty array or object')
    return templates.map((tpl) => {
      const code = String(tpl.code || '').trim()
      const templateName = (tpl as any)?.template?.title
      const name = String(tpl.name || templateName || code || '').trim()
      return { ...tpl, code, name }
    })
  }

  private normalizeMeterTemplates(raw: any): MeterTemplateDto[] {
    const templates: MeterTemplateDto[] = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
      ? Object.entries(raw).map(([code, tpl]: any) => ({
          code,
          name: (tpl as any).title || (tpl as any).name || code,
          order: (tpl as any).order ?? null,
          startPeriodCode: (tpl as any).startPeriodCode ?? null,
          endPeriodCode: (tpl as any).endPeriodCode ?? null,
          template: tpl,
        }))
      : []
    if (!templates.length) throw new ForbiddenException('Meter templates payload must be a non-empty array or object')
    return templates.map((tpl) => {
      const code = String(tpl.code || '').trim()
      const templateName = (tpl as any)?.template?.title || (tpl as any)?.template?.name
      const name = String(tpl.name || templateName || code || '').trim()
      return { ...tpl, code, name }
    })
  }

  private ensureTemplateCodes(templates: Array<{ code: string; name: string }>, kind: string) {
    const seen = new Set<string>()
    for (const tpl of templates) {
      if (!tpl.code || !tpl.name) throw new ForbiddenException(`${kind} templates require code and name`)
      if (seen.has(tpl.code)) throw new ForbiddenException(`Duplicate ${kind} template code: ${tpl.code}`)
      seen.add(tpl.code)
    }
  }

  private validateBillTemplateItems(tpl: BillTemplateDto) {
    const items: any[] = Array.isArray(tpl?.template?.items) ? tpl.template.items : []
    const seen = new Set<string>()
    for (const it of items) {
      const key = String(it?.key || '').trim()
      if (!key) throw new ForbiddenException(`Bill template ${tpl.code} has an item without key`)
      if (seen.has(key)) throw new ForbiddenException(`Bill template ${tpl.code} has duplicate item key: ${key}`)
      seen.add(key)
    }
  }

  async importBillTemplates(communityRef: string, roles: RoleAssignment[], body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const templates = this.normalizeBillTemplates(body)
    this.ensureTemplateCodes(templates, 'bill')
    const repo: any = (this.prisma as any).billTemplate
    if (!repo) throw new NotFoundException('Bill templates not supported')
    await this.prisma.$transaction(async (tx) => {
      for (const tpl of templates) {
        if (!tpl.template || typeof tpl.template !== 'object') {
          throw new ForbiddenException(`Bill template ${tpl.code} must include a template object`)
        }
        this.validateBillTemplateItems(tpl)
        await (tx as any).billTemplate.upsert({
          where: { communityId_code: { communityId, code: tpl.code } },
          update: {
            name: tpl.name,
            order: tpl.order ?? null,
            startPeriodCode: tpl.startPeriodCode ?? null,
            endPeriodCode: tpl.endPeriodCode ?? null,
            template: tpl.template,
          },
          create: {
            communityId,
            code: tpl.code,
            name: tpl.name,
            order: tpl.order ?? null,
            startPeriodCode: tpl.startPeriodCode ?? null,
            endPeriodCode: tpl.endPeriodCode ?? null,
            template: tpl.template,
          },
        })
      }
    })
    return { count: templates.length, codes: templates.map((t) => t.code) }
  }

  async importMeterTemplates(communityRef: string, roles: RoleAssignment[], body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const templates = this.normalizeMeterTemplates(body)
    this.ensureTemplateCodes(templates, 'meter')
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) throw new NotFoundException('Meter templates not supported')
    await this.prisma.$transaction(async (tx) => {
      for (const tpl of templates) {
        if (!tpl.template || typeof tpl.template !== 'object') {
          throw new ForbiddenException(`Meter template ${tpl.code} must include a template object`)
        }
        await (tx as any).meterEntryTemplate.upsert({
          where: { communityId_code: { communityId, code: tpl.code } },
          update: {
            name: tpl.name,
            order: tpl.order ?? null,
            startPeriodCode: tpl.startPeriodCode ?? null,
            endPeriodCode: tpl.endPeriodCode ?? null,
            template: tpl.template,
          },
          create: {
            communityId,
            code: tpl.code,
            name: tpl.name,
            order: tpl.order ?? null,
            startPeriodCode: tpl.startPeriodCode ?? null,
            endPeriodCode: tpl.endPeriodCode ?? null,
            template: tpl.template,
          },
        })
      }
    })
    return { count: templates.length, codes: templates.map((t) => t.code) }
  }

  async upsertBillTemplate(communityRef: string, roles: RoleAssignment[], body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const [tpl] = this.normalizeBillTemplates([body])
    this.ensureTemplateCodes([tpl], 'bill')
    if (!tpl.template || typeof tpl.template !== 'object') {
      throw new ForbiddenException(`Bill template ${tpl.code} must include a template object`)
    }
    const repo: any = (this.prisma as any).billTemplate
    if (!repo) throw new NotFoundException('Bill templates not supported')
    this.validateBillTemplateItems(tpl)
    const saved = await repo.upsert({
      where: { communityId_code: { communityId, code: tpl.code } },
      update: {
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
      create: {
        communityId,
        code: tpl.code,
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
    })
    return { ok: true, template: saved }
  }

  async upsertMeterTemplate(communityRef: string, roles: RoleAssignment[], body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const [tpl] = this.normalizeMeterTemplates([body])
    this.ensureTemplateCodes([tpl], 'meter')
    if (!tpl.template || typeof tpl.template !== 'object') {
      throw new ForbiddenException(`Meter template ${tpl.code} must include a template object`)
    }
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) throw new NotFoundException('Meter templates not supported')
    const saved = await repo.upsert({
      where: { communityId_code: { communityId, code: tpl.code } },
      update: {
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
      create: {
        communityId,
        code: tpl.code,
        name: tpl.name,
        order: tpl.order ?? null,
        startPeriodCode: tpl.startPeriodCode ?? null,
        endPeriodCode: tpl.endPeriodCode ?? null,
        template: tpl.template,
      },
    })
    return { ok: true, template: saved }
  }

  // ----- Bill templates -----
  async listBillTemplates(communityRef: string, periodCode: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const repo: any = (this.prisma as any).billTemplate
    if (!repo) return []
    const templates = await repo.findMany({
      where: {
        communityId,
        OR: [
          { startPeriodCode: null, endPeriodCode: null },
          { startPeriodCode: null, endPeriodCode: periodCode },
          { startPeriodCode: periodCode, endPeriodCode: null },
          { startPeriodCode: { lte: periodCode }, endPeriodCode: { gte: periodCode } },
          { startPeriodCode: null, endPeriodCode: { gte: periodCode } },
          { startPeriodCode: { lte: periodCode }, endPeriodCode: null },
        ],
      },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    const instRepo: any = (this.prisma as any).billTemplateInstance
    const instances: any[] = instRepo
      ? await instRepo.findMany({
          where: { communityId, periodId: period?.id, templateId: { in: templates.map((t: any) => t.id) } },
        })
      : []
    const chargeRepo: any = (this.prisma as any).communityCharge
    const pmRepo: any = (this.prisma as any).periodMeasure
    const invoiceRepo: any = (this.prisma as any).vendorInvoice
    const instIds = instances.map((i: any) => i.id)
    const invoices = invoiceRepo && instIds.length
      ? await invoiceRepo.findMany({
          where: { communityId, templateInstanceId: { in: instIds } },
          select: { id: true, templateInstanceId: true },
        })
      : []
    const invoiceByInstanceId = new Map<string, string>()
    for (const inv of invoices) {
      if (inv.templateInstanceId) invoiceByInstanceId.set(inv.templateInstanceId, inv.id)
    }
    const sourcePairs = instances.map((inst: any) => {
      const invoiceId = invoiceByInstanceId.get(inst.id)
      if (invoiceId) return { sourceType: 'VENDOR_INVOICE', sourceId: invoiceId }
      return { sourceType: 'TEMPLATE', sourceId: inst.id }
    })
    const templateCharges = chargeRepo && sourcePairs.length
      ? await chargeRepo.findMany({
          where: {
            communityId,
            periodId: period?.id,
            OR: sourcePairs.map((s) => ({ sourceType: s.sourceType, sourceId: s.sourceId })),
          },
          select: { amount: true, sourceType: true, sourceId: true, sourceKey: true },
        })
      : []
    const chargeTotals = new Map<string, number>()
    for (const charge of templateCharges) {
      const key = `${charge.sourceType}:${charge.sourceId}:${charge.sourceKey ?? 'default'}`
      chargeTotals.set(key, (chargeTotals.get(key) ?? 0) + Number(charge.amount))
    }
    const expenseCharges = chargeRepo
      ? await chargeRepo.findMany({
          where: { communityId, periodId: period?.id, sourceType: 'EXPENSE' },
          select: { amount: true, allocationSnapshot: true },
        })
      : []
    const expenseTotals = new Map<string, number>()
    for (const charge of expenseCharges) {
      const expType = (charge.allocationSnapshot as any)?.expenseType
      if (!expType) continue
      expenseTotals.set(expType, (expenseTotals.get(expType) ?? 0) + Number(charge.amount))
    }
    const meters = pmRepo
      ? await pmRepo.findMany({
          where: { communityId, periodId: period?.id, scopeType: 'COMMUNITY' },
          select: { meterId: true, value: true },
        })
      : []
    return templates.map((tpl: any) => {
      const body: any = tpl.template
      const items: any[] = Array.isArray(body?.items) ? body.items : []
      const inst = instances.find((i: any) => i.templateId === tpl.id)
      const values: Record<string, any> = { ...(inst?.values ?? {}) }
      items.forEach((it) => {
        if (it.kind === 'charge') {
          const invoiceId = inst ? invoiceByInstanceId.get(inst.id) : null
          const sourceType = invoiceId ? 'VENDOR_INVOICE' : 'TEMPLATE'
          const sourceId = invoiceId ?? inst?.id
          if (sourceId) {
            const key = `${sourceType}:${sourceId}:${it.key ?? 'default'}`
            const total = chargeTotals.get(key)
            if (total != null && values[it.key] == null) values[it.key] = total
          }
        } else if (it.kind === 'expense') {
          const total = expenseTotals.get(it.expenseTypeCode)
          if (total != null) values[it.key] = total
        } else if (it.kind === 'meter') {
          const m = meters.find((mx: any) => mx.meterId === it.meterId)
          if (m?.value != null) values[it.key] = Number(m.value)
        }
      })
      return { ...tpl, state: inst?.state ?? 'NEW', template: { ...body, items, values } }
    })
  }

  async saveBillTemplateState(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    payload: { state?: string; values?: Record<string, any> },
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).billTemplate
    const tpl = await repo.findUnique({
      where: { communityId_code: { communityId, code: templateCode } },
      select: { id: true, code: true, name: true, template: true },
    })
    if (!tpl) throw new NotFoundException('Bill template not found')
    const instRepo: any = (this.prisma as any).billTemplateInstance
    if (!instRepo) throw new NotFoundException('Bill template instances not supported')
    const nextState = payload.state || 'FILLED'
    const res = await instRepo.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: tpl.id } },
      update: { state: nextState, values: payload.values ?? null },
      create: { communityId, periodId: period.id, templateId: tpl.id, state: nextState, values: payload.values ?? null },
    })

    if (nextState === 'SUBMITTED') {
      await this.applyBillTemplateSubmission(communityId, period.id, periodCode, tpl as any, res as any, (res as any)?.values ?? {})
    }

    // Reopening any template moves the period back to OPEN (idempotent)
    await this.prisma.period.update({
      where: { id: period.id },
      data: { status: 'OPEN', preparedAt: null, closedAt: null },
    })
    return res
  }

  private async applyBillTemplateSubmission(
    communityId: string,
    periodId: string,
    _periodCode: string,
    template: { id: string; code: string; name: string; template: any },
    instance: { id: string; values?: any },
    values: Record<string, any>,
  ) {
    const body: any = template.template || {}
    const items: any[] = Array.isArray(body?.items) ? body.items : []
    const output: any = body?.output || {}
    const mode = (output?.mode || 'CHARGES_ONLY') as string
    const vendorCfg: any = output?.vendor || {}
    const invoiceCfg: any = output?.invoice || {}

    const valueFor = (key?: string | null) => (key ? (values as any)?.[key] : undefined)

    const chargeItems = items.filter((it) => it.kind === 'charge' || it.kind === 'expense')
    const totalAmount = chargeItems.reduce((sum, it) => {
      const key = it.amountKey || it.key
      const val = Number(valueFor(key))
      return Number.isFinite(val) ? sum + val : sum
    }, 0)

    let sourceType: ChargeSourceType = ChargeSourceType.TEMPLATE
    let sourceId = instance.id

    const chargeDrafts: Array<{
      itemKey: string
      amount: number
      fundId: string
      expenseTypeCode?: string | null
      description: string
      currency: string
    }> = []

    const fundTotals = new Map<string, number>()
    for (const item of chargeItems) {
      const chargeCfg = item.kind === 'charge' ? item.charge ?? item : item
      const key = item.amountKey || item.key
      const rawVal = valueFor(key)
      const amount = Number(rawVal)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const fundCode = chargeCfg.fundCode ?? output.fundCode ?? null
      if (!fundCode) {
        throw new ForbiddenException(`Missing fundCode for template ${template.code} item ${item.key}`)
      }
      const fundId = await this.resolveFundId(communityId, fundCode)
      if (!fundId) {
        throw new ForbiddenException(`Unknown fundCode ${fundCode} for template ${template.code} item ${item.key}`)
      }
      const expenseTypeCode = chargeCfg.expenseTypeCode ?? item.expenseTypeCode ?? null
      const description = chargeCfg.description ?? item.label ?? item.name ?? item.key ?? template.name
      const currency = chargeCfg.currency ?? valueFor(chargeCfg.currencyKey) ?? output.currency ?? 'RON'
      chargeDrafts.push({ itemKey: item.key, amount, fundId, expenseTypeCode, description, currency })
      fundTotals.set(fundId, (fundTotals.get(fundId) ?? 0) + amount)
    }

    if (mode === 'VENDOR_INVOICE') {
      const vendorId = await this.resolveVendorId(communityId, vendorCfg, values)
      const issueDateVal = valueFor(invoiceCfg.issueDateKey) ?? invoiceCfg.issueDate ?? null
      const issueDate = issueDateVal ? new Date(issueDateVal) : null
      // Due date (scadența facturii): from the configured key, defaulting to 'invoiceDueDate'.
      const dueDateVal = valueFor(invoiceCfg.dueDateKey || 'invoiceDueDate') ?? invoiceCfg.dueDate ?? null
      const dueDate = dueDateVal ? new Date(dueDateVal) : null
      const serviceStartPeriodId = await this.resolvePeriodIdFromValue(communityId, valueFor(invoiceCfg.serviceStartPeriodKey))
      const serviceEndPeriodId = await this.resolvePeriodIdFromValue(communityId, valueFor(invoiceCfg.serviceEndPeriodKey))
      const currency = valueFor(invoiceCfg.currencyKey) ?? invoiceCfg.currency ?? output.currency ?? 'RON'
      const net = valueFor(invoiceCfg.netKey) ?? invoiceCfg.net ?? null
      const vat = valueFor(invoiceCfg.vatKey) ?? invoiceCfg.vat ?? null
      const gross = valueFor(invoiceCfg.grossKey) ?? invoiceCfg.gross ?? totalAmount ?? null
      const invoice = await this.prisma.vendorInvoice.upsert({
        where: { templateInstanceId: instance.id },
        update: {
          vendorId,
          number: valueFor(invoiceCfg.numberKey) ?? invoiceCfg.number ?? null,
          issueDate,
          dueDate,
          serviceStartPeriodId,
          serviceEndPeriodId,
          currency,
          net,
          vat,
          gross,
          source: 'INTERNAL',
          provenance: { templateCode: template.code, templateName: template.name },
        },
        create: {
          communityId,
          vendorId,
          templateInstanceId: instance.id,
          number: valueFor(invoiceCfg.numberKey) ?? invoiceCfg.number ?? null,
          issueDate,
          dueDate,
          serviceStartPeriodId,
          serviceEndPeriodId,
          currency,
          net,
          vat,
          gross,
          source: 'INTERNAL',
          provenance: { templateCode: template.code, templateName: template.name },
        },
      })
      sourceType = ChargeSourceType.VENDOR_INVOICE
      sourceId = invoice.id

      for (const [fundId, amount] of fundTotals.entries()) {
        await this.vendorInvoices.linkFund(communityId, invoice.id, { fundId, amount })
      }
    }

    const period = await this.prisma.period.findUnique({
      where: { id: periodId },
      select: { id: true, seq: true, code: true },
    })
    if (!period) throw new NotFoundException('Period not found')

    for (const d of chargeDrafts) {
      await this.allocator.createExpense(communityId, period, {
        description: d.description,
        amount: d.amount,
        currency: d.currency,
        expenseTypeCode: d.expenseTypeCode ?? undefined,
        sourceType,
        sourceId,
        sourceKey: d.itemKey,
        fundId: d.fundId ?? undefined,
      })
    }
  }

  private async resolveVendorId(communityId: string, vendorCfg: any, values: Record<string, any>) {
    if (vendorCfg?.vendorId) {
      const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorCfg.vendorId, communityId } })
      if (!vendor) throw new NotFoundException('Vendor not found')
      return vendor.id
    }
    const name = (vendorCfg?.nameKey ? values?.[vendorCfg.nameKey] : vendorCfg?.name) ?? null
    if (!name) return null
    const existing = await this.prisma.vendor.findFirst({
      where: { communityId, name },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await this.prisma.vendor.create({
      data: {
        communityId,
        name,
        taxId: (vendorCfg?.taxIdKey ? values?.[vendorCfg.taxIdKey] : vendorCfg?.taxId) ?? null,
        iban: (vendorCfg?.ibanKey ? values?.[vendorCfg.ibanKey] : vendorCfg?.iban) ?? null,
      },
      select: { id: true },
    })
    return created.id
  }

  private async resolvePeriodIdFromValue(communityId: string, value: any) {
    if (!value) return null
    if (typeof value !== 'string') return null
    const byCode = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: value } },
      select: { id: true },
    })
    if (byCode) return byCode.id
    const byId = await this.prisma.period.findFirst({
      where: { id: value, communityId },
      select: { id: true },
    })
    return byId?.id ?? null
  }

  private async resolveFundId(communityId: string, fundCode: string) {
    const fund = await this.prisma.fund.findUnique({
      where: { communityId_code: { communityId, code: fundCode } },
      select: { id: true },
    })
    if (!fund) throw new NotFoundException(`Fund ${fundCode} not found`)
    return fund.id
  }

  async listBillTemplateAttachments(communityRef: string, periodCode: string, templateCode: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    await this.ensureBillTemplate(communityId, templateCode)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).templateAttachment
    if (!repo) return []
    return repo.findMany({
      where: { communityId, periodId: period.id, templateType: 'BILL', templateCode },
      select: { id: true, fileName: true, contentType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async uploadBillTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    file: UploadedFile,
  ) {
    return this.uploadAttachment('BILL', communityRef, periodCode, templateCode, roles, file)
  }

  async deleteBillTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    return this.deleteAttachment('BILL', communityRef, periodCode, templateCode, roles, attachmentId)
  }

  async downloadBillTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    return this.downloadAttachment('BILL', communityRef, periodCode, templateCode, roles, attachmentId)
  }

  // ----- Meter templates / readings -----
  async listMeterTemplates(communityRef: string, periodCode: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) return []
    const templates = await repo.findMany({
      where: {
        communityId,
        OR: [
          { startPeriodCode: null, endPeriodCode: null },
          { startPeriodCode: null, endPeriodCode: periodCode },
          { startPeriodCode: periodCode, endPeriodCode: null },
          { startPeriodCode: { lte: periodCode }, endPeriodCode: { gte: periodCode } },
          { startPeriodCode: null, endPeriodCode: { gte: periodCode } },
          { startPeriodCode: { lte: periodCode }, endPeriodCode: null },
        ],
      },
      orderBy: [{ order: 'asc' }, { code: 'asc' }],
    })
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    const instRepo: any = (this.prisma as any).meterEntryTemplateInstance
    const instances: any[] = instRepo
      ? await instRepo.findMany({
          where: { communityId, periodId: period?.id, templateId: { in: templates.map((t: any) => t.id) } },
        })
      : []
    const meterRepo: any = (this.prisma as any).meter
    const pmRepo: any = (this.prisma as any).periodMeasure
    const unitCodes = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true, id: true } })
    const scopeUnitCodes = unitCodes.map((u) => u.code)
    const unitIdByCode = new Map(unitCodes.map((u) => [u.code, u.id]))
    const meters = meterRepo
      ? await meterRepo.findMany({
          where: {
            origin: { not: 'DERIVED' },
            OR: [
              { scopeType: 'COMMUNITY', scopeCode: communityId },
              { scopeType: 'UNIT', scopeCode: { in: scopeUnitCodes } },
            ],
          },
        })
      : []
    const enriched = []
    for (const tpl of templates) {
      const body: any = tpl.template
      const rawItems: any[] = Array.isArray(body?.items) ? body.items : []
      const values: Record<string, any> = {}
      const items: any[] = []
      for (const item of rawItems) {
        if (item.kind === 'meter' && item.typeCode && !item.meterId) {
          const matches = meters.filter((mx: any) => mx.typeCode === item.typeCode)
          for (const m of matches) {
            const clone = {
              ...item,
              meterId: m.meterId,
              label: item.label || m.meterId,
              key: `${item.key}:${m.meterId}`,
              unitCode: m.scopeType === 'UNIT' ? m.scopeCode : null,
            }
            items.push(clone)
            const scopeType = m.scopeType as any
            const scopeId = scopeType === 'COMMUNITY' ? communityId : unitIdByCode.get(m.scopeCode) ?? m.scopeCode
            const pm = pmRepo
              ? await pmRepo.findFirst({
                  where: {
                    communityId,
                    periodId: period?.id,
                    meterId: m.meterId,
                    scopeType,
                    scopeId,
                    typeCode: m.typeCode,
                  },
                })
              : null
            if (pm?.value != null) {
              const valNum = Number(pm.value)
              values[clone.key] = valNum
              clone.value = valNum
            }
          }
        } else if (item.kind === 'meter') {
          const m = meters.find((mx: any) => mx.meterId === item.meterId)
          items.push({ ...item, unitCode: m?.scopeType === 'UNIT' ? m.scopeCode : null })
          if (!m) continue
          const scopeType = m.scopeType as any
          const scopeId = scopeType === 'COMMUNITY' ? communityId : unitIdByCode.get(m.scopeCode) ?? m.scopeCode
          const pm = pmRepo
            ? await pmRepo.findFirst({
                where: { communityId, periodId: period?.id, meterId: m.meterId, scopeType, scopeId, typeCode: m.typeCode },
              })
            : null
          if (pm?.value != null) {
            const valNum = Number(pm.value)
            values[item.key] = valNum
            ;(item as any).value = valNum
          }
        } else {
          items.push(item)
        }
      }
      const inst = instances.find((i: any) => i.templateId === tpl.id)
      enriched.push({ ...tpl, state: inst?.state ?? 'NEW', template: { ...body, items, values } })
    }
    return enriched
  }

  async saveMeterTemplateState(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    payload: { state?: string; values?: Record<string, any> },
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) throw new NotFoundException('Meter templates not supported')
    const tpl = await repo.findUnique({ where: { communityId_code: { communityId, code: templateCode } }, select: { id: true, template: true } })
    if (!tpl) throw new NotFoundException('Meter template not found')
    const instRepo: any = (this.prisma as any).meterEntryTemplateInstance
    if (!instRepo) throw new NotFoundException('Meter template instances not supported')
    const nextState = payload.state || 'FILLED'
    if (payload.values) {
      const meterRepo: any = (this.prisma as any).meter
      const pmRepo: any = (this.prisma as any).periodMeasure
      const unitCodes = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true, id: true } })
      const unitIdByCode = new Map(unitCodes.map((u) => [u.code, u.id]))
      const rawItems: any[] = Array.isArray((tpl as any).template?.items) ? (tpl as any).template.items : []
      const meters = meterRepo ? await meterRepo.findMany() : []
      const meterKeyMap = new Map<string, string>()
      const meterItemLabel = new Map<string, string>()
      for (const item of rawItems) {
        if (item.kind === 'meter' && item.typeCode && !item.meterId) {
          meters
            .filter((mx: any) => mx.typeCode === item.typeCode)
            .forEach((m: any) => {
              meterKeyMap.set(`${item.key}:${m.meterId}`, m.meterId)
              meterItemLabel.set(`${item.key}:${m.meterId}`, item.label || item.name || item.title || item.key)
            })
        } else if (item.kind === 'meter' && item.meterId) {
          meterKeyMap.set(item.key, item.meterId)
          meterItemLabel.set(item.key, item.label || item.name || item.title || item.key)
        }
      }
      for (const [key, val] of Object.entries(payload.values)) {
        if (val === undefined || val === null || (val as any) === '') continue
        const entered = Number(val)
        if (Number.isNaN(entered)) continue
        const meterId = meterKeyMap.get(key)
        if (!meterId || !meterRepo || !pmRepo) continue
        const meter = await meterRepo.findUnique({ where: { meterId } })
        if (!meter) continue
        const scopeType = meter.scopeType as any
        const scopeId = scopeType === 'COMMUNITY' ? communityId : unitIdByCode.get(meter.scopeCode) ?? meter.scopeCode
        const provenance = {
          templateCode,
          templateName: (tpl as any)?.template?.name ?? templateCode,
          itemKey: key,
          itemLabel: meterItemLabel.get(key) ?? key,
        }
        const mode = await this.resolveMeasureMode(communityId, meter.typeCode)
        const prior = mode === 'INDEX'
          ? await this.priorReadingValue(communityId, scopeType, scopeId, meter.typeCode, (period as any).seq)
          : null
        const openingIndex = meter.openingIndex != null ? Number(meter.openingIndex) : null
        const { reading, value: valueNum } = this.deriveMeasureValues(mode, entered, prior, openingIndex)
        await pmRepo.upsert({
          where: {
            communityId_periodId_scopeType_scopeId_typeCode: {
              communityId,
              periodId: period.id,
              scopeType,
              scopeId,
              typeCode: meter.typeCode,
            },
          },
          update: { value: valueNum, reading, origin: 'METER', estimated: false, meterId, provenance },
          create: {
            communityId,
            periodId: period.id,
            scopeType,
            scopeId,
            typeCode: meter.typeCode,
            origin: 'METER',
            value: valueNum,
            reading,
            estimated: false,
            meterId,
            provenance,
          },
        })
        if (mode === 'INDEX') {
          await this.recomputeNextConsumption(communityId, scopeType, scopeId, meter.typeCode, (period as any).seq, entered)
        }
      }
    }
    const res = await instRepo.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: tpl.id } },
      update: { state: nextState, values: payload.values ?? null },
      create: { communityId, periodId: period.id, templateId: tpl.id, state: nextState, values: payload.values ?? null },
    })

    // Reopening any template moves the period back to OPEN (idempotent)
    await this.prisma.period.update({
      where: { id: period.id },
      data: { status: 'OPEN', preparedAt: null, closedAt: null },
    })
    return res
  }

  async listMeterTemplateAttachments(communityRef: string, periodCode: string, templateCode: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    await this.ensureMeterTemplate(communityId, templateCode)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).templateAttachment
    if (!repo) return []
    return repo.findMany({
      where: { communityId, periodId: period.id, templateType: 'METER', templateCode },
      select: { id: true, fileName: true, contentType: true, size: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async uploadMeterTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    file: UploadedFile,
  ) {
    return this.uploadAttachment('METER', communityRef, periodCode, templateCode, roles, file)
  }

  async deleteMeterTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    return this.deleteAttachment('METER', communityRef, periodCode, templateCode, roles, attachmentId)
  }

  async downloadMeterTemplateAttachment(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    return this.downloadAttachment('METER', communityRef, periodCode, templateCode, roles, attachmentId)
  }

  async exportMeterTemplateCsv(communityRef: string, periodCode: string, templateCode: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.getPeriod(communityId, periodCode)
    const { items } = await this.resolveMeterTemplateItems(communityId, periodCode, templateCode)
    const meterIds = items.map((it) => it.meterId).filter(Boolean) as string[]
    const pmRepo: any = (this.prisma as any).periodMeasure
    const currentMap = new Map<string, number>()
    const prevMap = new Map<string, number>()
    if (pmRepo && meterIds.length) {
      const current = await pmRepo.findMany({
        where: { communityId, periodId: period.id, meterId: { in: meterIds } },
        select: { meterId: true, value: true },
      })
      current.forEach((row: any) => currentMap.set(row.meterId, Number(row.value)))
      if (period.seq > 0) {
        const prev = await this.prisma.period.findUnique({
          where: { communityId_seq: { communityId, seq: period.seq - 1 } },
          select: { id: true },
        })
        if (prev?.id) {
          const prevRows = await pmRepo.findMany({
            where: { communityId, periodId: prev.id, meterId: { in: meterIds } },
            select: { meterId: true, value: true },
          })
          prevRows.forEach((row: any) => prevMap.set(row.meterId, Number(row.value)))
        }
      }
    }
    const header = ['meterId', 'value', 'previousValue', 'label', 'unitCode', 'typeCode']
    const lines = [header.join(',')]
    items.forEach((it) => {
      const row = [
        it.meterId,
        currentMap.has(it.meterId) ? String(currentMap.get(it.meterId)) : '',
        prevMap.has(it.meterId) ? String(prevMap.get(it.meterId)) : '',
        it.label || '',
        it.unitCode || '',
        it.typeCode || '',
      ].map(this.escapeCsv)
      lines.push(row.join(','))
    })
    const csv = lines.join('\n')
    const dataBase64 = Buffer.from(csv, 'utf8').toString('base64')
    return {
      fileName: `meters-${templateCode}-${periodCode}.csv`,
      contentType: 'text/csv',
      size: csv.length,
      data: dataBase64,
    }
  }

  async importMeterTemplateCsv(
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    file: UploadedFile,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Missing CSV file')
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.getPeriod(communityId, periodCode)
    const { template, items, meterById, keyByMeterId, itemLabelByKey } = await this.resolveMeterTemplateItems(
      communityId,
      periodCode,
      templateCode,
    )
    const csv = file.buffer.toString('utf8')
    const rows = this.parseCsv(csv)
    if (!rows.length) throw new BadRequestException('Empty CSV')
    const header = rows[0].map((h) => h.trim().toLowerCase())
    const meterIdIdx = header.findIndex((h) => h === 'meterid' || h === 'meter_id' || h === 'meter id')
    const valueIdx = header.findIndex((h) => h === 'value')
    if (meterIdIdx < 0 || valueIdx < 0) throw new BadRequestException('CSV must include meterId and value columns')
    const expectedMeterIds = new Set(items.map((it) => it.meterId))
    const valuesByMeterId = new Map<string, number>()
    const ignored: Array<{ meterId: string; reason: string }> = []
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i]
      if (!row || !row.length) continue
      const meterId = String(row[meterIdIdx] ?? '').trim()
      if (!meterId) continue
      if (!expectedMeterIds.has(meterId)) {
        ignored.push({ meterId, reason: 'Unknown meterId for template' })
        continue
      }
      const rawValue = String(row[valueIdx] ?? '').trim()
      if (!rawValue) continue
      const valueNum = Number(rawValue)
      if (Number.isNaN(valueNum)) {
        ignored.push({ meterId, reason: 'Invalid numeric value' })
        continue
      }
      valuesByMeterId.set(meterId, valueNum)
    }
    if (!valuesByMeterId.size) throw new BadRequestException('No valid meter values found in CSV')
    const pmRepo: any = (this.prisma as any).periodMeasure
    if (!pmRepo) throw new NotFoundException('Meter readings not supported')
    let imported = 0
    for (const [meterId, valueNum] of valuesByMeterId.entries()) {
      const meter = meterById.get(meterId)
      if (!meter) {
        ignored.push({ meterId, reason: 'Meter not found' })
        continue
      }
      const scopeType = meter.scopeType as any
      const scopeId = scopeType === 'COMMUNITY' ? communityId : meter.scopeCode
      const key = keyByMeterId.get(meterId)
      const provenance = {
        templateCode,
        templateName: (template as any)?.template?.name ?? templateCode,
        itemKey: key || meterId,
        itemLabel: (key ? itemLabelByKey.get(key) : null) ?? meterId,
      }
      const mode = await this.resolveMeasureMode(communityId, meter.typeCode)
      const prior = mode === 'INDEX'
        ? await this.priorReadingValue(communityId, scopeType, scopeId, meter.typeCode, (period as any).seq)
        : null
      const openingIndex = meter.openingIndex != null ? Number(meter.openingIndex) : null
      const { reading, value: derivedValue } = this.deriveMeasureValues(mode, valueNum, prior, openingIndex)
      await pmRepo.upsert({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId: period.id,
            scopeType,
            scopeId,
            typeCode: meter.typeCode,
          },
        },
        update: { value: derivedValue, reading, origin: 'METER', estimated: false, meterId, provenance },
        create: {
          communityId,
          periodId: period.id,
          scopeType,
          scopeId,
          typeCode: meter.typeCode,
          origin: 'METER',
          value: derivedValue,
          reading,
          estimated: false,
          meterId,
          provenance,
        },
      })
      if (mode === 'INDEX') {
        await this.recomputeNextConsumption(communityId, scopeType, scopeId, meter.typeCode, (period as any).seq, valueNum)
      }
      imported += 1
    }
    const valuesByKey: Record<string, number> = {}
    for (const [meterId, valueNum] of valuesByMeterId.entries()) {
      const key = keyByMeterId.get(meterId)
      if (!key) continue
      valuesByKey[key] = valueNum
    }
    const allHaveValues = items.every((it) => valuesByMeterId.has(it.meterId))
    const nextState: 'NEW' | 'FILLED' | 'CLOSED' = allHaveValues ? 'FILLED' : 'NEW'
    const instRepo: any = (this.prisma as any).meterEntryTemplateInstance
    if (!instRepo) throw new NotFoundException('Meter template instances not supported')
    await instRepo.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: template.id } },
      update: { state: nextState, values: valuesByKey },
      create: { communityId, periodId: period.id, templateId: template.id, state: nextState, values: valuesByKey },
    })
    await this.prisma.period.update({
      where: { id: period.id },
      data: { status: 'OPEN', preparedAt: null, closedAt: null },
    })
    return {
      ok: true,
      imported,
      ignored,
      expected: items.length,
      state: nextState,
    }
  }

  // Meter list + readings
  async listMeters(communityRef: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const unitCodes = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true, id: true } })
    const scopeUnitCodes = unitCodes.map((u) => u.code)
    const unitIdByCode = new Map(unitCodes.map((u) => [u.code, u.id]))
    const meters = await this.prisma.meter.findMany({
      where: {
        origin: { not: 'DERIVED' },
        OR: [
          { scopeType: 'COMMUNITY', scopeCode: communityId },
          { scopeType: 'UNIT', scopeCode: { in: scopeUnitCodes } },
        ],
      },
      select: { meterId: true, typeCode: true, scopeType: true, scopeCode: true, origin: true },
    })

    const pmRepo: any = (this.prisma as any).periodMeasure
    if (!pmRepo) return meters

    const withValues = await Promise.all(
      meters.map(async (m) => {
        const pm = await pmRepo.findFirst({
          where: {
            communityId,
            scopeType: m.scopeType,
            scopeId: m.scopeType === 'UNIT' ? unitIdByCode.get(m.scopeCode) ?? m.scopeCode : m.scopeCode,
            typeCode: m.typeCode,
          },
          orderBy: { periodId: 'desc' },
        })
        return { ...m, currentValue: pm?.value ?? null, unitCode: m.scopeType === 'UNIT' ? m.scopeCode : null }
      }),
    )
    return withValues
  }

  async getMeterReading(communityRef: string, periodCode: string, meterId: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } } })
    if (!period) throw new NotFoundException('Period not found')
    const meter: any = await (this.prisma as any).meter.findUnique({ where: { meterId } })
    if (!meter) throw new NotFoundException('Meter not found')
    const pm = await this.prisma.periodMeasure.findFirst({
      where: {
        communityId,
        periodId: period.id,
        meterId,
      },
    })
    const mode = await this.resolveMeasureMode(communityId, meter.typeCode)
    const previousReading = await this.priorReadingByMeter(communityId, meterId, (period as any).seq)
    return { ...(pm ?? {}), meterId, typeCode: meter.typeCode, mode, previousReading }
  }

  /** Prior period's reading for a meter (by meterId), for display. */
  private async priorReadingByMeter(communityId: string, meterId: string, currentSeq: number): Promise<number | null> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pm.reading::float8 as reading
         from period_measure pm join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.meter_id = $2 and pm.reading is not null and p.seq < $3
        order by p.seq desc limit 1`,
      communityId, meterId, currentSeq,
    )
    return rows.length ? Number(rows[0].reading) : null
  }

  /** Recent reading history for a meter (period, reading index, consumption), newest first. */
  async getMeterHistory(communityRef: string, meterId: string, roles: RoleAssignment[]) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const meter: any = await (this.prisma as any).meter.findUnique({ where: { meterId } })
    if (!meter) throw new NotFoundException('Meter not found')
    const mode = await this.resolveMeasureMode(communityId, meter.typeCode)
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pr.code as "periodCode", pr.seq as seq,
              pm.reading::float8 as reading, pm.value::float8 as consumption, pm.estimated
         from period_measure pm join period pr on pr.id = pm.period_id
        where pm.community_id = $1 and pm.meter_id = $2
        order by pr.seq desc limit 24`,
      communityId, meterId,
    )
    return { meterId, typeCode: meter.typeCode, mode, history: rows }
  }

  // ── Meter reading mode (INDEX vs CONSUMPTION) ──────────────────────────────
  // Per community per measure-type. INDEX: entered value is a cumulative meter reading and the
  // period consumption = thisReading − previousReading (or − meter.openingIndex for the first one).
  // CONSUMPTION (default): the entered value IS the consumption (historical behavior).

  /** Resolve the reading mode for a measure type in a community. Default CONSUMPTION. */
  private async resolveMeasureMode(communityId: string, typeCode: string): Promise<'INDEX' | 'CONSUMPTION'> {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { measureModes: true },
    })
    const modes = (c?.measureModes as Record<string, string>) || {}
    return modes[typeCode] === 'INDEX' ? 'INDEX' : 'CONSUMPTION'
  }

  /** Most recent prior period's raw reading for this series (seq < currentSeq), or null. */
  private async priorReadingValue(
    communityId: string, scopeType: any, scopeId: string, typeCode: string, currentSeq: number,
  ): Promise<number | null> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pm.reading::float8 as reading
         from period_measure pm join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.scope_type::text = $2 and pm.scope_id = $3 and pm.type_code = $4
          and pm.reading is not null and p.seq < $5
        order by p.seq desc limit 1`,
      communityId, String(scopeType), scopeId, typeCode, currentSeq,
    )
    return rows.length ? Number(rows[0].reading) : null
  }

  /** Compute {reading, value(consumption)} to store for the given mode. Negative diffs clamp to 0. */
  private deriveMeasureValues(
    mode: 'INDEX' | 'CONSUMPTION', entered: number, prior: number | null, openingIndex: number | null,
  ): { reading: number | null; value: number } {
    if (mode !== 'INDEX') return { reading: null, value: entered }
    const base = prior ?? openingIndex ?? null
    const value = base == null ? 0 : Math.max(0, entered - base)
    return { reading: entered, value }
  }

  /**
   * A reading in period P also determines the NEXT period's consumption (nextReading − P.reading).
   * After writing P's reading, recompute the immediately-following period that has a reading.
   */
  private async recomputeNextConsumption(
    communityId: string, scopeType: any, scopeId: string, typeCode: string, currentSeq: number, currentReading: number,
  ): Promise<void> {
    const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
      `select pm.id, pm.period_id as "periodId", pm.reading::float8 as reading
         from period_measure pm join period p on p.id = pm.period_id
        where pm.community_id = $1 and pm.scope_type::text = $2 and pm.scope_id = $3 and pm.type_code = $4
          and pm.reading is not null and p.seq > $5
        order by p.seq asc limit 1`,
      communityId, String(scopeType), scopeId, typeCode, currentSeq,
    )
    if (!rows.length) return
    const next = rows[0]
    const value = Math.max(0, Number(next.reading) - currentReading)
    await this.prisma.periodMeasure.update({ where: { id: next.id }, data: { value } })
    await this.recomputeAggregationsAndDerived(communityId, next.periodId)
  }

  async upsertMeterReading(
    communityRef: string,
    periodCode: string,
    roles: RoleAssignment[],
    input: { meterId: string; value: number; origin?: string; estimated?: boolean },
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    const period = await this.getPeriod(communityId, periodCode)
    const meter: any = await (this.prisma as any).meter.findUnique({ where: { meterId: input.meterId } })
    if (!meter) throw new NotFoundException('Meter not found')
    const scopeType = meter.scopeType as any
    let scopeId = meter.scopeCode
    if (scopeType === 'COMMUNITY') {
      scopeId = communityId
    } else if (scopeType === 'UNIT') {
      const unitIdMap = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true, id: true } })
      scopeId = unitIdMap.find((u) => u.code === meter.scopeCode)?.id ?? meter.scopeCode
    }
    const origin = (input.origin as any) ?? 'METER'
    const entered = Number(input.value)
    if (input.value === undefined || input.value === null || (input.value as any) === '' || Number.isNaN(entered)) {
      throw new ForbiddenException('Invalid meter value')
    }
    const mode = await this.resolveMeasureMode(communityId, meter.typeCode)
    const prior = mode === 'INDEX'
      ? await this.priorReadingValue(communityId, scopeType, scopeId, meter.typeCode, period.seq)
      : null
    const openingIndex = meter.openingIndex != null ? Number(meter.openingIndex) : null
    const { reading, value: valueNum } = this.deriveMeasureValues(mode, entered, prior, openingIndex)
    const pm = await (this.prisma as any).periodMeasure.upsert({
      where: {
        communityId_periodId_scopeType_scopeId_typeCode: {
          communityId,
          periodId: period.id,
          scopeType,
          scopeId,
          typeCode: meter.typeCode,
        },
      },
      update: {
        value: valueNum,
        reading,
        origin,
        estimated: !!input.estimated,
        meterId: meter.meterId,
      },
      create: {
        communityId,
        periodId: period.id,
        scopeType,
        scopeId,
        typeCode: meter.typeCode,
        origin,
        value: valueNum,
        reading,
        estimated: !!input.estimated,
        meterId: meter.meterId,
      },
    })
    await this.recomputeAggregationsAndDerived(communityId, period.id)
    if (mode === 'INDEX') {
      await this.recomputeNextConsumption(communityId, scopeType, scopeId, meter.typeCode, period.seq, entered)
    }
    return pm
  }

  private async upsertPeriodMeasure(
    communityId: string,
    periodId: string,
    scopeType: SeriesScope,
    scopeId: string,
    typeCode: string,
    origin: SeriesOrigin,
    value: number,
    meterId?: string,
  ) {
    const resolvedMeterId = meterId ?? `${typeCode}-${scopeId}`
    await this.prisma.periodMeasure.upsert({
      where: {
        communityId_periodId_scopeType_scopeId_typeCode: {
          communityId,
          periodId,
          scopeType,
          scopeId,
          typeCode,
        },
      },
      update: { value, origin, meterId: resolvedMeterId },
      create: {
        communityId,
        periodId,
        scopeType,
        scopeId,
        typeCode,
        origin,
        value,
        meterId: resolvedMeterId,
      },
    })
  }

  private async recomputeAggregationsAndDerived(communityId: string, periodId: string) {
    const aggRules = await (this.prisma as any).aggregationRule.findMany({
      where: { communityId },
      select: { targetType: true, unitTypes: true, residualType: true },
    })
    for (const agg of aggRules || []) {
      const unitMeasures = await this.prisma.periodMeasure.findMany({
        where: {
          communityId,
          periodId,
          scopeType: SeriesScope.UNIT,
          typeCode: { in: agg.unitTypes || [] },
        },
        select: { scopeId: true, value: true, typeCode: true },
      })
      if (!unitMeasures.length) continue
      const communityTotal = await this.prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId,
            scopeType: SeriesScope.COMMUNITY,
            scopeId: communityId,
            typeCode: agg.targetType,
          },
        },
      })
      if (!communityTotal) continue
      const byUnit = new Map<string, number>()
      const basisByUnit = new Map<string, number>()
      const byTypeCommunity = new Map<string, number>()
      unitMeasures.forEach((m) => {
        const val = Number(m.value)
        byUnit.set(m.scopeId, (byUnit.get(m.scopeId) ?? 0) + val)
        if (m.typeCode === agg.targetType) {
          basisByUnit.set(m.scopeId, (basisByUnit.get(m.scopeId) ?? 0) + val)
        }
        byTypeCommunity.set(m.typeCode, (byTypeCommunity.get(m.typeCode) ?? 0) + val)
      })
      const sumUnits = Array.from(byUnit.values()).reduce((s, v) => s + v, 0)
      if (sumUnits <= 0) continue
      const sumBasis = Array.from(basisByUnit.values()).reduce((s, v) => s + v, 0)
      const totalCommunity = Number(communityTotal.value)
      const residual = totalCommunity - sumUnits
      const basisMap = sumBasis > 0 ? basisByUnit : byUnit
      const basisTotal = sumBasis > 0 ? sumBasis : sumUnits
      for (const [unitId] of byUnit.entries()) {
        const basisVal = basisMap.get(unitId) ?? 0
        const share = basisVal / basisTotal
        const adj = residual * share
        if (agg.residualType) {
          await this.upsertPeriodMeasure(
            communityId,
            periodId,
            SeriesScope.UNIT,
            unitId,
            agg.residualType,
            SeriesOrigin.DERIVED,
            adj,
            `${agg.residualType}-${unitId}`,
          )
        }
      }
      if (agg.residualType) {
        await this.upsertPeriodMeasure(
          communityId,
          periodId,
          SeriesScope.COMMUNITY,
          communityId,
          agg.residualType,
          SeriesOrigin.DERIVED,
          residual,
          `${agg.residualType}-${communityId}`,
        )
      }
      for (const [type, sum] of byTypeCommunity.entries()) {
        if (type === agg.targetType) continue
        await this.upsertPeriodMeasure(
          communityId,
          periodId,
          SeriesScope.COMMUNITY,
          communityId,
          type,
          SeriesOrigin.DERIVED,
          sum,
          `${type}-${communityId}`,
        )
      }
    }

    const derivedRules = await (this.prisma as any).derivedMeterRule.findMany({
      where: { communityId },
      select: { scopeType: true, sourceType: true, subtractTypes: true, targetType: true, origin: true },
    })
    for (const r of derivedRules || []) {
      const scopeType = (r.scopeType as SeriesScope) ?? SeriesScope.COMMUNITY
      const scopeId = scopeType === SeriesScope.COMMUNITY ? communityId : communityId
      const source = await this.prisma.periodMeasure.findUnique({
        where: {
          communityId_periodId_scopeType_scopeId_typeCode: {
            communityId,
            periodId,
            scopeType,
            scopeId,
            typeCode: r.sourceType,
          },
        },
      })
      if (!source) continue
      let remainder = Number(source.value)
      const subtractTypes = Array.isArray(r.subtractTypes) ? r.subtractTypes : []
      if (subtractTypes.length) {
        const subs = await this.prisma.periodMeasure.findMany({
          where: {
            communityId,
            periodId,
            scopeType,
            scopeId,
            typeCode: { in: subtractTypes as string[] },
          },
          select: { value: true },
        })
        remainder -= subs.reduce((s, m) => s + Number(m.value), 0)
      }
      await this.upsertPeriodMeasure(
        communityId,
        periodId,
        scopeType,
        scopeId,
        r.targetType,
        (r.origin as SeriesOrigin) ?? SeriesOrigin.DERIVED,
        remainder,
        `${r.targetType}-${scopeId}`,
      )
    }
  }

  private async getPeriod(communityRef: string, periodCode: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    const period = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: periodCode } },
      select: { id: true, seq: true, code: true },
    })
    if (!period) throw new NotFoundException(`Period ${periodCode} not found for ${communityId}`)
    return period
  }

  private async ensureBillTemplate(communityId: string, code: string) {
    const repo: any = (this.prisma as any).billTemplate
    if (!repo) throw new NotFoundException('Bill templates not supported')
    const tpl = await repo.findUnique({ where: { communityId_code: { communityId, code } }, select: { id: true } })
    if (!tpl) throw new NotFoundException('Bill template not found')
    return tpl
  }

  private async ensureMeterTemplate(communityId: string, code: string) {
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) throw new NotFoundException('Meter templates not supported')
    const tpl = await repo.findUnique({ where: { communityId_code: { communityId, code } }, select: { id: true } })
    if (!tpl) throw new NotFoundException('Meter template not found')
    return tpl
  }

  private async uploadAttachment(
    templateType: TemplateKind,
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    file: UploadedFile,
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    if (templateType === 'BILL') await this.ensureBillTemplate(communityId, templateCode)
    else await this.ensureMeterTemplate(communityId, templateCode)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } }, select: { id: true } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).templateAttachment
    if (!repo) throw new NotFoundException('Attachments not supported')
    return repo.create({
      data: {
        communityId,
        periodId: period.id,
        templateType,
        templateCode,
        fileName: file?.originalname || 'upload',
        contentType: file?.mimetype || 'application/octet-stream',
        size: file?.size || null,
        data: file?.buffer || null,
      },
      select: { id: true, fileName: true, contentType: true, size: true, createdAt: true },
    })
  }

  private async deleteAttachment(
    templateType: TemplateKind,
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    if (templateType === 'BILL') await this.ensureBillTemplate(communityId, templateCode)
    else await this.ensureMeterTemplate(communityId, templateCode)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } }, select: { id: true } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).templateAttachment
    if (!repo) throw new NotFoundException('Attachments not supported')
    const existing = await repo.findUnique({ where: { id: attachmentId } })
    if (
      !existing ||
      existing.communityId !== communityId ||
      existing.periodId !== period.id ||
      existing.templateCode !== templateCode ||
      existing.templateType !== templateType
    ) {
      throw new NotFoundException('Attachment not found')
    }
    await repo.delete({ where: { id: attachmentId } })
    return { ok: true }
  }

  private async downloadAttachment(
    templateType: TemplateKind,
    communityRef: string,
    periodCode: string,
    templateCode: string,
    roles: RoleAssignment[],
    attachmentId: string,
  ) {
    const communityId = await this.ensureCommunityId(communityRef)
    this.ensureAdmin(roles, communityId)
    if (templateType === 'BILL') await this.ensureBillTemplate(communityId, templateCode)
    else await this.ensureMeterTemplate(communityId, templateCode)
    const period = await this.prisma.period.findUnique({ where: { communityId_code: { communityId, code: periodCode } }, select: { id: true } })
    if (!period) throw new NotFoundException('Period not found')
    const repo: any = (this.prisma as any).templateAttachment
    if (!repo) throw new NotFoundException('Attachments not supported')
    const existing = await repo.findUnique({
      where: { id: attachmentId },
      select: { id: true, communityId: true, periodId: true, templateCode: true, templateType: true, fileName: true, contentType: true, size: true, data: true },
    })
    if (
      !existing ||
      existing.communityId !== communityId ||
      existing.periodId !== period.id ||
      existing.templateCode !== templateCode ||
      existing.templateType !== templateType
    ) {
      throw new NotFoundException('Attachment not found')
    }
    const dataBase64 = existing.data ? Buffer.from(existing.data).toString('base64') : ''
    return {
      id: existing.id,
      fileName: existing.fileName,
      contentType: existing.contentType ?? 'application/octet-stream',
      size: existing.size ?? undefined,
      data: dataBase64,
    }
  }

  private escapeCsv(value: string) {
    const needsQuote = /[",\n\r]/.test(value)
    if (!needsQuote) return value
    return `"${value.replace(/"/g, '""')}"`
  }

  private parseCsv(text: string) {
    const rows: string[][] = []
    let row: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"'
            i += 1
          } else {
            inQuotes = false
          }
        } else {
          field += ch
        }
        continue
      }
      if (ch === '"') {
        inQuotes = true
        continue
      }
      if (ch === ',') {
        row.push(field)
        field = ''
        continue
      }
      if (ch === '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        continue
      }
      if (ch === '\r') {
        if (text[i + 1] === '\n') i += 1
        row.push(field)
        rows.push(row)
        row = []
        field = ''
        continue
      }
      field += ch
    }
    if (field.length || row.length) {
      row.push(field)
      rows.push(row)
    }
    return rows
  }

  private async resolveMeterTemplateItems(communityId: string, _periodCode: string, templateCode: string) {
    const repo: any = (this.prisma as any).meterEntryTemplate
    if (!repo) throw new NotFoundException('Meter templates not supported')
    const template = await repo.findUnique({
      where: { communityId_code: { communityId, code: templateCode } },
    })
    if (!template) throw new NotFoundException('Meter template not found')
    const rawItems: any[] = Array.isArray((template as any)?.template?.items) ? (template as any).template.items : []
    const meterRepo: any = (this.prisma as any).meter
    if (!meterRepo) throw new NotFoundException('Meter model not available')
    const unitCodes = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true } })
    const scopeUnitCodes = unitCodes.map((u) => u.code)
    const meters = await meterRepo.findMany({
      where: {
        origin: { not: 'DERIVED' },
        OR: [
          { scopeType: 'COMMUNITY', scopeCode: communityId },
          { scopeType: 'UNIT', scopeCode: { in: scopeUnitCodes } },
        ],
      },
    })
    const meterById = new Map<string, any>()
    meters.forEach((m: any) => meterById.set(m.meterId, m))
    const items: Array<{ key: string; meterId: string; label?: string; unitCode?: string | null; typeCode?: string | null }> = []
    const keyByMeterId = new Map<string, string>()
    const itemLabelByKey = new Map<string, string>()
    rawItems.forEach((item: any) => {
      if (item.kind !== 'meter') return
      if (item.typeCode && !item.meterId) {
        meters
          .filter((mx: any) => mx.typeCode === item.typeCode)
          .forEach((m: any) => {
            const key = `${item.key}:${m.meterId}`
            const label = item.label || m.notes || m.meterId
            items.push({
              key,
              meterId: m.meterId,
              label,
              unitCode: m.scopeType === 'UNIT' ? m.scopeCode : null,
              typeCode: m.typeCode,
            })
            keyByMeterId.set(m.meterId, key)
            itemLabelByKey.set(key, label)
          })
        return
      }
      const meterId = item.meterId
      if (!meterId) return
      const meter = meterById.get(meterId)
      const label = item.label || meter?.notes || meterId
      items.push({
        key: item.key,
        meterId,
        label,
        unitCode: meter?.scopeType === 'UNIT' ? meter.scopeCode : null,
        typeCode: meter?.typeCode ?? item.typeCode ?? null,
      })
      keyByMeterId.set(meterId, item.key)
      itemLabelByKey.set(item.key, label)
    })
    return { template, items, meterById, keyByMeterId, itemLabelByKey }
  }
}
