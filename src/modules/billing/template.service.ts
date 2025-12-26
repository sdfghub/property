import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
type UploadedFile = { originalname?: string; mimetype?: string; size?: number; buffer?: Buffer }
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }
type TemplateKind = 'BILL' | 'METER'
type BillTemplateDto = {
  code: string
  name: string
  order?: number
  startPeriodCode?: string | null
  endPeriodCode?: string | null
  template: { title?: string; items?: any[] }
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
  constructor(private readonly prisma: PrismaService) {}

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
    const expenseRepo: any = (this.prisma as any).expense
    const pmRepo: any = (this.prisma as any).periodMeasure
    const expenses = expenseRepo
      ? await expenseRepo.findMany({
          where: { communityId, periodId: period?.id },
          select: { allocatableAmount: true, expenseType: { select: { code: true } }, description: true },
        })
      : []
    const meters = pmRepo
      ? await pmRepo.findMany({
          where: { communityId, periodId: period?.id, scopeType: 'COMMUNITY' },
          select: { meterId: true, value: true },
        })
      : []
    return templates.map((tpl: any) => {
      const body: any = tpl.template
      const items: any[] = Array.isArray(body?.items) ? body.items : []
      const values: Record<string, any> = {}
      items.forEach((it) => {
        if (it.kind === 'expense') {
          const e = expenses.find((ex: any) => ex.expenseType?.code === it.expenseTypeCode)
          if (e?.allocatableAmount != null) values[it.key] = Number(e.allocatableAmount)
        } else if (it.kind === 'meter') {
          const m = meters.find((mx: any) => mx.meterId === it.meterId)
          if (m?.value != null) values[it.key] = Number(m.value)
        }
      })
      const inst = instances.find((i: any) => i.templateId === tpl.id)
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
    const tpl = await repo.findUnique({ where: { communityId_code: { communityId, code: templateCode } }, select: { id: true } })
    if (!tpl) throw new NotFoundException('Bill template not found')
    const instRepo: any = (this.prisma as any).billTemplateInstance
    if (!instRepo) throw new NotFoundException('Bill template instances not supported')
    const nextState = payload.state || 'FILLED'
    const res = await instRepo.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: tpl.id } },
      update: { state: nextState, values: payload.values ?? null },
      create: { communityId, periodId: period.id, templateId: tpl.id, state: nextState, values: payload.values ?? null },
    })

    // Reopening any template moves the period back to OPEN (idempotent)
    if (nextState !== 'CLOSED') {
      await this.prisma.period.update({
        where: { id: period.id },
        data: { status: 'OPEN', preparedAt: null, closedAt: null },
      })
    }
    return res
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
        const valueNum = val as any
        if (valueNum === undefined || valueNum === null || valueNum === '') continue
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
          update: { value: valueNum, origin: 'METER', estimated: false, meterId, provenance },
          create: {
            communityId,
            periodId: period.id,
            scopeType,
            scopeId,
            typeCode: meter.typeCode,
            origin: 'METER',
            value: valueNum,
            estimated: false,
            meterId,
            provenance,
          },
        })
      }
    }
    const res = await instRepo.upsert({
      where: { communityId_periodId_templateId: { communityId, periodId: period.id, templateId: tpl.id } },
      update: { state: nextState, values: payload.values ?? null },
      create: { communityId, periodId: period.id, templateId: tpl.id, state: nextState, values: payload.values ?? null },
    })

    // Reopening any template moves the period back to OPEN (idempotent)
    if (nextState !== 'CLOSED') {
      await this.prisma.period.update({
        where: { id: period.id },
        data: { status: 'OPEN', preparedAt: null, closedAt: null },
      })
    }
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
    const scopeType = meter.scopeType as any
    const unitIdMap = await this.prisma.unit.findMany({ where: { communityId }, select: { code: true, id: true } })
    const scopeId = scopeType === 'COMMUNITY' ? communityId : unitIdMap.find((u) => u.code === meter.scopeCode)?.id ?? meter.scopeCode
    const pm = await this.prisma.periodMeasure.findFirst({
      where: {
        communityId,
        periodId: period.id,
        meterId,
      },
    })
    return pm
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
    const scopeId = scopeType === 'COMMUNITY' ? communityId : meter.scopeCode
    const origin = (input.origin as any) ?? 'METER'
    const valueNum = input.value as any
    if (valueNum === undefined || valueNum === null || valueNum === '') throw new ForbiddenException('Invalid meter value')
    return (this.prisma as any).periodMeasure.upsert({
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
        estimated: !!input.estimated,
        meterId: meter.meterId,
      },
    })
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
}
