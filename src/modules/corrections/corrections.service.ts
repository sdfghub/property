import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CorrectionType } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'
import { PeriodService } from '../period/period.service'

// A Correction is a domain declaration; the ledger entries are derived from it (PeriodService.
// applyCorrections). Each type carries a fixed ledger `reason`. Corrections target the community's
// current non-CLOSED period.
const REASON_BY_TYPE: Record<string, string> = {
  RESHUFFLE: 'reponderare-cote',
  CREDIT_TRANSFER: 'reatribuire-plata',
  PAYMENT_REATTRIB: 'reatribuire-plata',
  PENALTY_WRITEOFF: 'scutire-penalizari',
  MANUAL_ADJUSTMENT: 'ajustare-manuala',
}

@Injectable()
export class CorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: PeriodService,
  ) {}

  private async resolveCommunityId(ref: string): Promise<string> {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  /** The single period a live correction can target: the current OPEN/PREPARED period (latest). */
  private async currentPeriod(communityId: string) {
    const p = await this.prisma.period.findFirst({
      where: { communityId, status: { in: ['OPEN', 'PREPARED'] } },
      orderBy: { seq: 'desc' },
      select: { code: true, status: true },
    })
    if (!p) throw new BadRequestException('No open period to post a correction to (all periods are closed).')
    return p
  }

  /** Funds + billing entities + the current target period — everything the create form needs. */
  async context(communityRef: string) {
    const communityId = await this.resolveCommunityId(communityRef)
    const [funds, bes, period] = await Promise.all([
      this.prisma.fund.findMany({ where: { communityId }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true, name: true, displayName: true }, orderBy: { order: 'asc' } }),
      this.prisma.period.findFirst({ where: { communityId, status: { in: ['OPEN', 'PREPARED'] } }, orderBy: { seq: 'desc' }, select: { code: true, status: true } }),
    ])
    return {
      funds,
      billingEntities: bes.map((b) => ({ id: b.id, code: b.code, name: b.displayName || b.name })),
      period,
    }
  }

  async list(communityRef: string, periodCode?: string) {
    const communityId = await this.resolveCommunityId(communityRef)
    const rows = await this.prisma.correction.findMany({
      where: { communityId, ...(periodCode ? { periodCode } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    // resolve BE code/name for display
    const beIds = Array.from(new Set(rows.map((r) => r.billingEntityId).filter(Boolean))) as string[]
    const bes = beIds.length
      ? await this.prisma.billingEntity.findMany({ where: { id: { in: beIds } }, select: { id: true, code: true, name: true } })
      : []
    const beById = new Map(bes.map((b) => [b.id, b]))
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      reason: r.reason,
      periodCode: r.periodCode,
      billingEntity: r.billingEntityId ? (beById.get(r.billingEntityId) ?? { id: r.billingEntityId }) : null,
      fundCode: r.fundCode,
      amount: r.amount != null ? Number(r.amount) : null,
      payload: r.payload,
      note: r.note,
      status: r.status,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }))
  }

  async create(communityRef: string, actor: string, body: any) {
    const communityId = await this.resolveCommunityId(communityRef)
    const type = String(body?.type || '') as CorrectionType
    if (!REASON_BY_TYPE[type]) throw new BadRequestException(`Unknown correction type "${type}"`)
    const period = await this.currentPeriod(communityId)

    const note = body?.note != null ? String(body.note).trim() || null : null
    const amount = body?.amount != null && body.amount !== '' ? Number(body.amount) : null
    if (amount != null && !Number.isFinite(amount)) throw new BadRequestException('Amount must be a number')

    let billingEntityId: string | null = null
    let fundCode: string | null = null
    let payload: any = null

    const requireBe = async (id: any) => {
      const be = await this.prisma.billingEntity.findFirst({ where: { communityId, id: String(id || '') }, select: { id: true } })
      if (!be) throw new BadRequestException('Billing entity not found in this community')
      return be.id
    }
    const requireFund = async (code: any) => {
      const f = await this.prisma.fund.findFirst({ where: { communityId, code: String(code || '') }, select: { code: true } })
      if (!f) throw new BadRequestException(`Fund "${code}" not found`)
      return f.code
    }

    switch (type) {
      case 'MANUAL_ADJUSTMENT':
      case 'CREDIT_TRANSFER':
        if (amount == null || (type === 'CREDIT_TRANSFER' && amount === 0)) throw new BadRequestException('Amount is required')
        billingEntityId = await requireBe(body.billingEntityId)
        fundCode = await requireFund(body.fundCode)
        break
      case 'PENALTY_WRITEOFF':
        if (amount == null || amount === 0) throw new BadRequestException('Amount is required')
        billingEntityId = await requireBe(body.billingEntityId)
        fundCode = await requireFund('PENALIZARI')
        break
      case 'PAYMENT_REATTRIB':
        if (amount == null || amount === 0) throw new BadRequestException('Amount is required')
        billingEntityId = await requireBe(body.billingEntityId)
        payload = { fromFund: await requireFund(body.fromFund), toFund: await requireFund(body.toFund) }
        break
      case 'RESHUFFLE': {
        fundCode = await requireFund(body.fundCode)
        const perBeIn = body?.perBe && typeof body.perBe === 'object' ? body.perBe : {}
        const perBe: Record<string, number> = {}
        for (const [beId, a] of Object.entries(perBeIn)) {
          const v = Number(a)
          if (!Number.isFinite(v) || Math.abs(v) < 0.005) continue
          perBe[await requireBe(beId)] = v
        }
        if (!Object.keys(perBe).length) throw new BadRequestException('Provide at least one per-entity amount')
        payload = { perBe }
        break
      }
    }

    const created = await this.prisma.correction.create({
      data: {
        communityId,
        periodCode: period.code,
        type,
        reason: REASON_BY_TYPE[type],
        billingEntityId,
        fundCode,
        amount: amount ?? undefined,
        payload: payload ?? undefined,
        note,
        createdBy: actor,
      },
    })
    // derive immediately if the period is already PREPARED; otherwise it derives at prepare
    await this.periods.reapplyCorrectionsNow(communityId, period.code)
    return { ok: true, id: created.id, periodCode: period.code }
  }

  async void(communityRef: string, id: string, actor: string) {
    const communityId = await this.resolveCommunityId(communityRef)
    const c = await this.prisma.correction.findFirst({ where: { id, communityId }, select: { id: true, periodCode: true, status: true } })
    if (!c) throw new NotFoundException('Correction not found')
    if (c.status === 'VOID') return { ok: true }
    await this.prisma.correction.update({ where: { id }, data: { status: 'VOID', voidedBy: actor, voidedAt: new Date() } })
    await this.periods.reapplyCorrectionsNow(communityId, c.periodCode)
    return { ok: true }
  }
}
