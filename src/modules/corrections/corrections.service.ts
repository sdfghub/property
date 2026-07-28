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

  /** Funds + billing entities + the current target period + all periods — everything the panel needs. */
  async context(communityRef: string) {
    const communityId = await this.resolveCommunityId(communityRef)
    const [funds, bes, period, periods] = await Promise.all([
      this.prisma.fund.findMany({ where: { communityId }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.billingEntity.findMany({ where: { communityId }, select: { id: true, code: true, name: true, displayName: true }, orderBy: { order: 'asc' } }),
      this.prisma.period.findFirst({ where: { communityId, status: { in: ['OPEN', 'PREPARED'] } }, orderBy: { seq: 'desc' }, select: { code: true, status: true } }),
      this.prisma.period.findMany({ where: { communityId }, select: { code: true, status: true }, orderBy: { seq: 'desc' } }),
    ])
    return {
      funds,
      billingEntities: bes.map((b) => ({ id: b.id, code: b.code, name: b.displayName || b.name })),
      period,
      periods, // all periods (incl. CLOSED) so the panel can filter the list by any past period
    }
  }

  /**
   * PRIMARY corrections view: the `Correction` declarations themselves (real DB rows — both seed/history-
   * created and admin-created). This is the source of truth. Pass `debug='ledger'` to instead see the
   * allocation RESULT (the derived ledger legs) — a debug view, per the model "the ledger is only for debug
   * after allocation".
   */
  async list(communityRef: string, periodCode?: string, debug?: string) {
    const communityId = await this.resolveCommunityId(communityRef)
    if (debug === 'ledger') return this.listFromLedger(communityId, periodCode)
    const rows = await this.prisma.correction.findMany({
      where: { communityId, ...(periodCode ? { periodCode } : {}) },
      orderBy: [{ periodCode: 'desc' }, { createdAt: 'desc' }],
    })
    const beIds = Array.from(new Set(rows.map((r) => r.billingEntityId).filter(Boolean))) as string[]
    const bes = beIds.length
      ? await this.prisma.billingEntity.findMany({ where: { id: { in: beIds } }, select: { id: true, code: true, name: true, displayName: true } })
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

  /** DEBUG view: the derived ledger legs (allocation result), grouped per (period, reason, refId). Read-only. */
  private async listFromLedger(communityId: string, periodCode?: string) {
    const legs: any[] = await this.prisma.$queryRawUnsafe(
      `select pr.code as period, pr.seq as seq, l.meta->>'reason' as reason, l.kind, l.ref_type as reftype,
              l.ref_id as refid, l.meta->>'correctionId' as cid, l.billing_entity_id as beid,
              be.name as bename, be.code as becode, fu.code as fund, round(l.amount::numeric,2)::float8 as amount
         from be_ledger_entry_detail l
         join period pr on pr.id = l.period_id
         left join billing_entity be on be.id = l.billing_entity_id
         left join fund fu on fu.id = l.fund_id
        where l.community_id = $1 and l.meta->>'reason' is not null
          ${periodCode ? 'and pr.code = $2' : ''}`,
      ...([communityId, ...(periodCode ? [periodCode] : [])] as any[]),
    )
    const groups = new Map<string, any>()
    for (const r of legs) {
      const key = `${r.period}|${r.reason}|${r.reftype}|${r.refid}`
      let g = groups.get(key)
      if (!g) g = groups.set(key, { key, period: r.period, seq: Number(r.seq), reason: r.reason, kind: r.kind, refType: r.reftype, correctionId: r.cid || null, amount: 0, legs: 0, bes: new Set<string>(), beName: null as string | null, funds: new Set<string>() }).get(key)
      g.amount += Number(r.amount || 0); g.legs++
      if (r.beid) { g.bes.add(r.beid); g.beName = r.bename || r.becode }
      if (r.fund) g.funds.add(r.fund)
    }
    const cids = Array.from(groups.values()).map((g) => g.correctionId).filter(Boolean) as string[]
    const corrs = cids.length ? await this.prisma.correction.findMany({ where: { id: { in: cids } }, select: { id: true, type: true, status: true, note: true } }) : []
    const corrById = new Map(corrs.map((c) => [c.id, c]))
    return Array.from(groups.values())
      .sort((a, b) => b.seq - a.seq || String(a.reason).localeCompare(b.reason))
      .map((g) => {
        const c = g.correctionId ? corrById.get(g.correctionId) : null
        return {
          key: g.key,
          period: g.period,
          reason: g.reason,
          kind: g.kind,
          amount: Math.round(g.amount * 100) / 100,
          legs: g.legs,
          scope: g.bes.size === 1 ? g.beName : g.bes.size > 1 ? `${g.bes.size} unități` : null,
          funds: Array.from(g.funds),
          source: g.refType === 'CORRECTION' ? 'admin' : 'historical',
          correctionId: g.correctionId,
          correctionType: c?.type ?? null,
          status: c?.status ?? null,
          note: c?.note ?? null,
        }
      })
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
