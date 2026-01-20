import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from './period-lookup.service'
import { EngagementService } from '../engagement/engagement.service'
import { ProgramService } from '../program/program.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

@Injectable()
export class BeQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periodLookup: BillingPeriodLookupService,
    private readonly engagement: EngagementService,
    private readonly programs: ProgramService,
  ) {}

  private async getBeById(beId: string) {
    const be = await this.prisma.billingEntity.findUnique({
      where: { id: beId },
      select: { id: true, code: true, name: true, communityId: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    return be
  }

  // TEMP: relaxed access control
  private async ensureAccess(beId: string, communityId: string, roles: RoleAssignment[], userId?: string) {
    if (this.canCommunityAdmin(roles, communityId)) return
    if (!userId) throw new ForbiddenException('Insufficient permissions for billing entity')
    const match = await this.prisma.billingEntityUserRole.findFirst({
      where: { userId, billingEntityId: beId },
      select: { id: true },
    })
    if (!match) throw new ForbiddenException('Insufficient permissions for billing entity')
  }
  private canCommunityAdmin(_roles: RoleAssignment[], _communityId: string) {
    return _roles.some(
      (r) => r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId === _communityId,
    )
  }
  private ensureCommunityAdmin(_roles: RoleAssignment[], _communityId: string) {
    if (this.canCommunityAdmin(_roles, _communityId)) return
    throw new ForbiddenException('Admin permissions required')
  }

  private async listAccessibleBeIds(communityId: string, roles: RoleAssignment[], userId?: string) {
    if (this.canCommunityAdmin(roles, communityId)) {
      const all = await this.prisma.billingEntity.findMany({
        where: { communityId },
        select: { id: true },
      })
      return all.map((r) => r.id)
    }
    if (!userId) throw new ForbiddenException('Insufficient permissions for community')
    const rows = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntity: { communityId } },
      select: { billingEntityId: true },
    })
    return rows.map((r) => r.billingEntityId)
  }

  async getCurrentDue(
    communityRef: string,
    filters: { beId?: string; bucket?: string; unitId?: string },
    roles: RoleAssignment[],
    userId?: string,
  ) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const hasFilters = !!(filters.bucket || filters.unitId)
    const accessibleBeIds = await this.listAccessibleBeIds(communityId, roles, userId)
    if (!accessibleBeIds.length) {
      throw new ForbiddenException('No billing entities for this user in community')
    }
    if (filters.beId && !accessibleBeIds.includes(filters.beId)) {
      throw new ForbiddenException('Insufficient permissions for billing entity')
    }
    const beIds = filters.beId ? [filters.beId] : accessibleBeIds

    const activePeriod = await this.prisma.period.findFirst({
      where: { communityId, status: { in: ['OPEN', 'PREPARED'] } },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
    const period =
      activePeriod ||
      (await this.prisma.period.findFirst({
        where: { communityId, status: 'CLOSED' },
        orderBy: { seq: 'desc' },
        select: { id: true, code: true, seq: true, status: true },
      }))
    if (!period) {
      return { period: null, items: [] }
    }

    if (period.status === 'CLOSED' && !hasFilters) {
      const statements = await this.prisma.beStatement.findMany({
        where: { communityId, periodId: period.id, billingEntityId: { in: beIds } },
        select: { billingEntityId: true, dueStart: true, charges: true, payments: true, adjustments: true, dueEnd: true },
      })
      const byBe = new Map(statements.map((s) => [s.billingEntityId, s]))
      const items = beIds.map((beId) => {
        const s = byBe.get(beId)
        return {
          billingEntityId: beId,
          dueStart: Number(s?.dueStart ?? 0),
          charges: Number(s?.charges ?? 0),
          payments: Number(s?.payments ?? 0),
          adjustments: Number(s?.adjustments ?? 0),
          dueEnd: Number(s?.dueEnd ?? 0),
          filtered: false,
        }
      })
      return { period, items }
    }

    const items = await this.buildLedgerDue(communityId, period, beIds, filters)
    return { period, items }
  }

  async getLedgerDueForPeriod(
    communityId: string,
    periodId: string,
    beIds: string[],
    filters: { bucket?: string; unitId?: string },
  ) {
    const period = await this.prisma.period.findUnique({
      where: { id: periodId },
      select: { id: true, code: true, seq: true, status: true },
    })
    if (!period) {
      return { period: null, items: [] }
    }
    const items = await this.buildLedgerDue(communityId, period, beIds, filters)
    return { period, items }
  }

  private async buildLedgerDue(
    communityId: string,
    period: { id: string; seq: number },
    beIds: string[],
    filters: { bucket?: string; unitId?: string },
  ) {
    const hasFilters = !!(filters.bucket || filters.unitId)
    const sums: Array<{ billing_entity_id: string; kind: string; total: any }> = await this.prisma.$queryRawUnsafe(
      `
      SELECT billing_entity_id, kind, SUM(amount)::numeric AS total
      FROM be_ledger_entry_detail
      WHERE community_id = $1
        AND period_id = $2
        AND billing_entity_id = ANY($3)
        ${filters.bucket ? 'AND bucket = $4' : ''}
        ${filters.unitId ? `AND unit_id = ${filters.bucket ? '$5' : '$4'}` : ''}
      GROUP BY billing_entity_id, kind
    `,
      communityId,
      period.id,
      beIds,
      ...(filters.bucket ? [filters.bucket] : []),
      ...(filters.unitId ? [filters.unitId] : []),
    )

    const byBeKind = new Map<string, Map<string, number>>()
    for (const row of sums) {
      const beId = row.billing_entity_id
      const kind = row.kind
      const total = Number(row.total ?? 0)
      if (!byBeKind.has(beId)) byBeKind.set(beId, new Map())
      byBeKind.get(beId)!.set(kind, total)
    }

    let dueStartByBe = new Map<string, number>()
    if (!hasFilters) {
      const previousPeriod = await this.prisma.period.findFirst({
        where: { communityId, seq: { lt: period.seq } },
        orderBy: { seq: 'desc' },
        select: { id: true },
      })
      if (previousPeriod) {
        const prevStatements = await this.prisma.beStatement.findMany({
          where: { communityId, periodId: previousPeriod.id, billingEntityId: { in: beIds } },
          select: { billingEntityId: true, dueEnd: true },
        })
        dueStartByBe = new Map(prevStatements.map((s) => [s.billingEntityId, Number(s.dueEnd ?? 0)]))
      } else {
        const openings = await this.prisma.beOpeningBalance.findMany({
          where: { communityId, periodId: period.id, billingEntityId: { in: beIds } },
          select: { billingEntityId: true, amount: true },
        })
        dueStartByBe = new Map(openings.map((o) => [o.billingEntityId, Number(o.amount ?? 0)]))
      }
    }

    return beIds.map((beId) => {
      const kinds = byBeKind.get(beId) ?? new Map<string, number>()
      const charges = kinds.get('CHARGE') ?? 0
      const payments = kinds.get('PAYMENT') ?? 0
      const adjustments = kinds.get('ADJUSTMENT') ?? 0
      const dueStart = hasFilters ? 0 : dueStartByBe.get(beId) ?? 0
      const dueEnd = dueStart + charges - payments + adjustments
      return {
        billingEntityId: beId,
        dueStart,
        charges,
        payments,
        adjustments,
        dueEnd,
        filtered: hasFilters,
      }
    })
  }

  async listBillingEntities(communityRef: string, periodCode: string, roles: RoleAssignment[], userId?: string) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const isCommunityAdmin = this.canCommunityAdmin(roles, communityId)
    let beRoles: string[] = []
    if (!isCommunityAdmin) {
      if (!userId) throw new ForbiddenException('Insufficient permissions for community')
      const rows = await this.prisma.billingEntityUserRole.findMany({
        where: { userId, billingEntity: { communityId } },
        select: { billingEntityId: true },
      })
      beRoles = rows.map((r) => r.billingEntityId)
    }
    if (!isCommunityAdmin && beRoles.length === 0) {
      throw new ForbiddenException('Insufficient permissions for community')
    }
    const period = await this.periodLookup.getPeriod(communityId, periodCode);
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      WITH p AS (SELECT $1::text AS community_id, $2::int AS seq, $3::text AS period_id)
      SELECT
        be.id,
        be.code,
        be.name,
        COALESCE(SUM(al.amount), 0)::numeric AS total_amount
      FROM billing_entity be
      JOIN p ON TRUE
      LEFT JOIN billing_entity_member bem
        ON bem.billing_entity_id = be.id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      LEFT JOIN allocation_line al
        ON al.unit_id = bem.unit_id
       AND al.period_id = p.period_id
      WHERE be.community_id = p.community_id
      GROUP BY be.id, be.code, be.name
      ORDER BY be.code
    `, communityId, period.seq, period.id);

    const filtered = isCommunityAdmin ? rows : rows.filter(r => beRoles.includes(r.id))
    if (!isCommunityAdmin && filtered.length === 0) {
      throw new ForbiddenException('No billing entities for this user in community')
    }

    return { period, items: filtered };
  }

  async getBillingEntityMembers(communityRef: string, periodCode: string, beCode: string, roles: RoleAssignment[], userId?: string) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const period = await this.periodLookup.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

    await this.ensureAccess(be.id, communityId, roles, userId)

    const members = await this.prisma.$queryRawUnsafe<any[]>(`
      WITH p AS (SELECT $1::text AS community_id, $2::int AS seq, $3::text AS period_id, $4::text AS be_id)
      SELECT
        u.id AS unit_id,
        u.code AS unit_code,
        COALESCE(SUM(al.amount), 0)::numeric AS unit_amount
      FROM billing_entity_member bem
      JOIN p ON TRUE
      JOIN unit u ON u.id = bem.unit_id
      LEFT JOIN allocation_line al
        ON al.unit_id = bem.unit_id
       AND al.period_id = p.period_id
      WHERE bem.billing_entity_id = p.be_id
        AND bem.start_seq <= p.seq
        AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      GROUP BY u.id, u.code
      ORDER BY u.code
    `, communityId, period.seq, period.id, be.id);

    return { period, be, members };
  }

  async getBillingEntityAllocations(communityRef: string, periodCode: string, beCode: string, roles: RoleAssignment[], userId?: string) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const period = await this.periodLookup.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

    await this.ensureAccess(be.id, communityId, roles, userId)

    const lines = await this.prisma.$queryRawUnsafe<any[]>(`
      WITH p AS (SELECT $1::text AS community_id, $2::int AS seq, $3::text AS period_id, $4::text AS be_id)
      SELECT
        al.id AS allocation_id,
        al.amount,
        u.id AS unit_id,
        u.code AS unit_code,
        e.id AS expense_id,
        e.description AS expense_description,
        et.code AS expense_type_code,
        e.currency,
        e.allocatable_amount
      FROM billing_entity_member bem
      JOIN p ON TRUE
      JOIN unit u ON u.id = bem.unit_id
      JOIN allocation_line al
        ON al.unit_id = bem.unit_id
       AND al.period_id = p.period_id
      JOIN expense e ON e.id = al.expense_id
      JOIN expense_type et ON et.id = e.expense_type_id
      WHERE bem.billing_entity_id = p.be_id
        AND bem.start_seq <= p.seq
        AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      ORDER BY u.code, e.description
    `, communityId, period.seq, period.id, be.id);

    return { period, be, lines };
  }

  async getBillingEntityMemberAllocations(
    communityRef: string, periodCode: string, beCode: string, unitCode: string, roles: RoleAssignment[], userId?: string
  ) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const period = await this.periodLookup.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

    await this.ensureAccess(be.id, communityId, roles, userId)

    const unit = await this.prisma.unit.findUnique({
      where: { code_communityId: { code: unitCode, communityId } },
      select: { id: true, code: true },
    });
    if (!unit) throw new NotFoundException(`Unit ${unitCode} not found`)

    const lines = await this.prisma.$queryRawUnsafe<any[]>(`
      WITH p AS (SELECT $1::text AS community_id, $2::int AS seq, $3::text AS period_id, $4::text AS be_id, $5::text AS unit_id)
      SELECT
        al.id               AS allocation_id,
        al.amount,
        e.id                AS expense_id,
        e.description       AS expense_description,
        et.code             AS expense_type_code,
        e.currency,
        e.allocatable_amount
      FROM allocation_line al
      JOIN expense e       ON e.id = al.expense_id
      JOIN expense_type et ON et.id = e.expense_type_id
      WHERE al.period_id = $1 AND al.unit_id = $5
      ORDER BY e.description
    `, period.id, unit.id);

    const total = lines.reduce((s,l)=> s + Number(l.amount), 0);

    return { period, be, unit, total, lines };
  }

  async getAllocationsByBeId(beId: string, periodCode: string, roles: RoleAssignment[], userId?: string) {
    const be = await this.getBeById(beId)
    await this.ensureAccess(be.id, be.communityId, roles, userId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode);

    const lines = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT
        al.id AS allocation_id,
        al.amount,
        u.id AS unit_id,
        u.code AS unit_code,
        e.id AS expense_id,
        e.description AS expense_description,
        et.code AS expense_type_code,
        e.currency,
        e.allocatable_amount
      FROM allocation_line al
      JOIN unit u ON u.id = al.unit_id
      JOIN expense e ON e.id = al.expense_id
      JOIN expense_type et ON et.id = e.expense_type_id
      WHERE al.period_id = $1
        AND al.community_id = $2
        AND EXISTS (
          SELECT 1 FROM billing_entity_member bem
           WHERE bem.billing_entity_id = $3
             AND bem.unit_id = al.unit_id
             AND bem.start_seq <= $4
             AND (bem.end_seq IS NULL OR bem.end_seq >= $4)
        )
      ORDER BY u.code, e.description
    `, period.id, be.communityId, be.id, period.seq);

    return { period, be, lines }
  }

  async getFinancials(beId: string, periodCode: string, roles: RoleAssignment[], userId?: string) {
    const be = await this.getBeById(beId)
    await this.ensureAccess(be.id, be.communityId, roles, userId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)

    const [statement, ledgerEntries, allocationsRaw, splitGroups, splitGroupMembers, expenseTypes] = await Promise.all([
      this.prisma.beStatement.findUnique({
        where: {
          communityId_periodId_billingEntityId: {
            communityId: be.communityId,
            periodId: period.id,
            billingEntityId: be.id,
          },
        },
      }),
      this.prisma.beLedgerEntry.findMany({
        where: { communityId: be.communityId, periodId: period.id, billingEntityId: be.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          details: {
            include: { unit: { select: { code: true } } },
          },
        },
      }),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT
          al.id AS allocation_id,
          al.amount,
          u.id AS unit_id,
          u.code AS unit_code,
          e.id AS expense_id,
          e.description AS expense_description,
          et.code AS expense_type_code,
          e.currency,
          e.allocatable_amount,
          al.split_node_id,
          at.trace AS allocation_trace,
          sg.id AS split_group_id,
          sg.name AS split_group_name
        FROM allocation_line al
        JOIN unit u ON u.id = al.unit_id
        JOIN expense e ON e.id = al.expense_id
        JOIN expense_type et ON et.id = e.expense_type_id
        LEFT JOIN allocation_trace at ON at.allocation_line_id = al.id
        LEFT JOIN split_group_member sgm ON sgm.split_node_id = al.split_node_id
        LEFT JOIN split_group sg ON sg.id = sgm.split_group_id
        WHERE al.period_id = $1
          AND al.community_id = $2
          AND EXISTS (
            SELECT 1 FROM billing_entity_member bem
             WHERE bem.billing_entity_id = $3
               AND bem.unit_id = al.unit_id
               AND bem.start_seq <= $4
               AND (bem.end_seq IS NULL OR bem.end_seq >= $4)
          )
        ORDER BY u.code, e.description
      `, period.id, be.communityId, be.id, period.seq),
      this.prisma.splitGroup.findMany({ where: { communityId: be.communityId }, orderBy: [{ order: 'asc' }, { code: 'asc' }] }),
      this.prisma.splitGroupMember.findMany({
        where: { splitGroup: { communityId: be.communityId } },
        select: { splitGroupId: true, splitNodeId: true },
      }),
      this.prisma.expenseType.findMany({
        where: { communityId: be.communityId },
        select: { params: true },
      }),
    ])

    // Resolve split node display names from any available params (group or expense type templates)
    const splitNodeNames: Record<string, string | null> = {}
    const collectNodes = (params: any) => {
      if (!params) return
      const nodes =
        params.nodesById ||
        params?.splitTemplate?.nodesById ||
        null
      if (!nodes) return
      Object.entries(nodes).forEach(([nodeId, node]: any) => {
        const name = node?.name ?? null
        if (name) splitNodeNames[nodeId] = name
      })
    }
    splitGroups.forEach((g: any) => collectNodes(g.params as any))
    expenseTypes.forEach((et: any) => collectNodes(et.params as any))

    const allocations = (allocationsRaw || []).map((a: any) => {
      const trail = (a.allocation_trace as any)?.split?.trail ?? null
      const last = Array.isArray(trail) && trail.length ? trail[trail.length - 1] : null
      const traceName = last?.name || last?.id || null
      return {
        ...a,
        split_name: traceName ?? (a.split_node_id ? splitNodeNames[a.split_node_id] || null : null),
        split_group_id: a.split_group_id,
        split_group_name: a.split_group_name,
      }
    })

    return { be, period, statement, ledgerEntries, allocations, splitGroups, splitGroupMembers, splitNodeNames }
  }

  async getBeSummary(beId: string, roles: RoleAssignment[], userId?: string) {
    const be = await this.getBeById(beId)
    await this.ensureAccess(be.id, be.communityId, roles, userId)
    return { id: be.id, code: be.code, name: be.name, communityId: be.communityId }
  }

  async getBeDashboard(beId: string, roles: RoleAssignment[], userId?: string) {
    const be = await this.getBeById(beId)
    await this.ensureAccess(be.id, be.communityId, roles, userId)

    const community = await this.prisma.community.findUnique({
      where: { id: be.communityId },
      select: { id: true, name: true },
    })
    const activePeriod = await this.prisma.period.findFirst({
      where: { communityId: be.communityId, status: { in: ['OPEN', 'PREPARED'] } },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
    const latestClosed = await this.prisma.period.findFirst({
      where: { communityId: be.communityId, status: 'CLOSED' },
      orderBy: { seq: 'desc' },
      select: { id: true, code: true, seq: true, status: true },
    })
    const livePeriod = activePeriod ?? latestClosed
    let liveTotals: any = null
    if (livePeriod) {
      const liveItems = await this.buildLedgerDue(
        be.communityId,
        { id: livePeriod.id, seq: livePeriod.seq },
        [be.id],
        {},
      )
      const liveItem = liveItems.find((item) => item.billingEntityId === be.id)
      liveTotals = liveItem ?? {
        billingEntityId: be.id,
        dueStart: 0,
        charges: 0,
        payments: 0,
        adjustments: 0,
        dueEnd: 0,
        filtered: false,
      }
    }
    const closed = await this.periodLookup.listClosedForBe(beId)
    const lastClosed = closed[0] ?? null
    const previousClosed = closed.length > 1 ? closed[1] : null

    let statement: any = null
    let ledgerEntries: any[] = []
    let period: any = null
    let previousClosedStatement: any = null
    if (lastClosed) {
      period = await this.periodLookup.getPeriod(be.communityId, lastClosed.code)
      statement = await this.prisma.beStatement.findUnique({
        where: {
          communityId_periodId_billingEntityId: {
            communityId: be.communityId,
            periodId: period.id,
            billingEntityId: be.id,
          },
        },
      })
      ledgerEntries = await this.prisma.beLedgerEntry.findMany({
        where: { communityId: be.communityId, periodId: period.id, billingEntityId: be.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          details: {
            include: { unit: { select: { code: true } } },
          },
        },
      })
    }
    if (previousClosed) {
      const prevPeriod = await this.periodLookup.getPeriod(be.communityId, previousClosed.code)
      previousClosedStatement = await this.prisma.beStatement.findUnique({
        where: {
          communityId_periodId_billingEntityId: {
            communityId: be.communityId,
            periodId: prevPeriod.id,
            billingEntityId: be.id,
          },
        },
      })
    }

    const [events, polls, programs] = await Promise.all([
      this.engagement.listEvents(be.communityId, userId ?? '', roles),
      this.engagement.listPolls(be.communityId, userId ?? '', roles),
      this.programs.listBalances(be.communityId),
    ])

    const now = Date.now()
    const upcomingEvents = (events || [])
      .filter((event: any) => new Date(event.endAt).getTime() >= now)
      .sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

    const ongoingPolls = (polls || [])
      .filter((poll: any) => {
        const startAt = new Date(poll.startAt).getTime()
        const endAt = new Date(poll.endAt).getTime()
        return poll.status === 'APPROVED' && !poll.closedAt && now >= startAt && now <= endAt
      })
      .slice(0, 3)

    const programBuckets = (programs || []).reduce<Record<string, { id: string; code: string; name: string }>>(
      (acc, prog: any) => {
        if (prog?.bucket) acc[prog.bucket] = { id: prog.id, code: prog.code, name: prog.name }
        return acc
      },
      {},
    )

    return {
      be: {
        id: be.id,
        code: be.code,
        name: be.name,
        communityId: be.communityId,
        communityName: community?.name ?? null,
      },
      live: livePeriod
        ? { period: { code: livePeriod.code, status: livePeriod.status }, totals: liveTotals }
        : { period: null, totals: null },
      period: period ? { code: period.code, status: period.status } : null,
      previousPeriod: previousClosed ? { code: previousClosed.code, status: previousClosed.status } : null,
      previousClosedStatement,
      statement,
      ledgerEntries,
      events: upcomingEvents,
      polls: ongoingPolls,
      programs,
      programBuckets,
    }
  }

}
