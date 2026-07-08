import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { TemplateService } from './template.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

/**
 * Resident self-service meter readings: a BILLING_ENTITY_USER may enter readings for meters that
 * belong to their OWN unit(s). Ownership chain: userId → BillingEntityUserRole → BillingEntityMember
 * (period-windowed) → Unit.code → Meter.scopeCode. Reuses TemplateService.upsertMeterReading, which
 * stamps enteredById + selfReported=true (the caller isn't a community admin).
 */
@Injectable()
export class MeMeterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplateService,
  ) {}

  /** Units the user is a member of in this community, active for the given period seq. */
  private async myUnits(userId: string, communityId: string, periodSeq: number): Promise<Array<{ id: string; code: string }>> {
    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { billingEntityId: true },
    })
    const beIds = beRoles.map((r) => r.billingEntityId)
    if (!beIds.length) return []
    const members = await this.prisma.billingEntityMember.findMany({
      where: {
        billingEntityId: { in: beIds },
        startSeq: { lte: periodSeq },
        OR: [{ endSeq: null }, { endSeq: { gte: periodSeq } }],
      },
      select: { unitId: true },
    })
    const unitIds = Array.from(new Set(members.map((m) => m.unitId)))
    if (!unitIds.length) return []
    return this.prisma.unit.findMany({ where: { id: { in: unitIds }, communityId }, select: { id: true, code: true } })
  }

  private async resolvePeriod(communityId: string, periodCode: string) {
    const p = await this.prisma.period.findFirst({
      where: { communityId, code: periodCode },
      select: { id: true, code: true, seq: true, status: true },
    })
    if (!p) throw new NotFoundException('Period not found')
    return p
  }

  /** The resident's own meters for a period, with current value/reading/mode/previous. */
  async listMyMeters(userId: string, communityId: string, periodCode: string) {
    const period = await this.resolvePeriod(communityId, periodCode)
    const editable = period.status !== 'CLOSED'
    const units = await this.myUnits(userId, communityId, period.seq)
    if (!units.length) return { period: { code: period.code, status: period.status, editable }, meters: [] }
    const codes = units.map((u) => u.code)
    const meters = await this.prisma.meter.findMany({
      where: { scopeType: 'UNIT', scopeCode: { in: codes } },
      select: { meterId: true, name: true, scopeCode: true, typeCode: true },
    })
    const out = []
    for (const m of meters) {
      const r: any = await this.templates.getMeterReading(communityId, periodCode, m.meterId, [])
      out.push({
        meterId: m.meterId,
        name: m.name,
        unitCode: m.scopeCode,
        typeCode: m.typeCode,
        value: r?.value ?? null,
        reading: r?.reading ?? null,
        mode: r?.mode,
        previousReading: r?.previousReading ?? null,
        selfReported: !!r?.selfReported,
      })
    }
    return { period: { code: period.code, status: period.status, editable }, meters: out }
  }

  /** Submit a reading for one of the resident's own meters. */
  async submitMyReading(
    userId: string,
    roles: RoleAssignment[],
    communityId: string,
    periodCode: string,
    meterId: string,
    value: number,
  ) {
    if (!meterId) throw new NotFoundException('meterId is required')
    const period = await this.resolvePeriod(communityId, periodCode)
    if (period.status === 'CLOSED') throw new ForbiddenException('Perioada este închisă')
    const meter = await this.prisma.meter.findUnique({
      where: { meterId },
      select: { meterId: true, scopeType: true, scopeCode: true },
    })
    if (!meter || meter.scopeType !== 'UNIT') throw new ForbiddenException('Nu aveți acces la acest contor')
    const units = await this.myUnits(userId, communityId, period.seq)
    if (!units.some((u) => u.code === meter.scopeCode)) throw new ForbiddenException('Nu aveți acces la acest contor')
    // Reuse the standard write path — it stamps enteredById + selfReported (true for a non-admin caller).
    return this.templates.upsertMeterReading(communityId, periodCode, roles, { meterId, value: Number(value) }, userId)
  }
}
