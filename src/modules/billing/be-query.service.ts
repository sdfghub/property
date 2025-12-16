import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from './period-lookup.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

@Injectable()
export class BeQueryService {
  constructor(private readonly prisma: PrismaService, private readonly periodLookup: BillingPeriodLookupService) {}

  private async getBeById(beId: string) {
    const be = await this.prisma.billingEntity.findUnique({
      where: { id: beId },
      select: { id: true, code: true, name: true, communityId: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    return be
  }

  // TEMP: relaxed access control
  private ensureAccess(_beId: string, _communityId: string, _roles: RoleAssignment[]) {
    return
  }
  private canCommunityAdmin(_roles: RoleAssignment[], _communityId: string) {
    return true
  }
  private ensureCommunityAdmin(_roles: RoleAssignment[], _communityId: string) {
    return
  }

  async listBillingEntities(communityRef: string, periodCode: string, roles: RoleAssignment[], userId?: string) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const beRoles = roles
      .filter(r => r.role === 'BILLING_ENTITY_USER' && r.scopeType === 'BILLING_ENTITY')
      .map(r => r.scopeId)
      .filter((id): id is string => !!id)

    const isCommunityAdmin = this.canCommunityAdmin(roles, communityId)
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

    this.ensureAccess(be.id, communityId, roles)

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

    this.ensureAccess(be.id, communityId, roles)

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

    this.ensureAccess(be.id, communityId, roles)

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

  async getAllocationsByBeId(beId: string, periodCode: string, roles: RoleAssignment[]) {
    const be = await this.getBeById(beId)
    this.ensureAccess(be.id, be.communityId, roles)
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

  async getFinancials(beId: string, periodCode: string, roles: RoleAssignment[]) {
    const be = await this.getBeById(beId)
    this.ensureAccess(be.id, be.communityId, roles)
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
        orderBy: [{ kind: 'asc' }, { bucket: 'asc' }],
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
          al.meta,
          sg.id AS split_group_id,
          sg.name AS split_group_name
        FROM allocation_line al
        JOIN unit u ON u.id = al.unit_id
        JOIN expense e ON e.id = al.expense_id
        JOIN expense_type et ON et.id = e.expense_type_id
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
      const metaName = (a.meta as any)?.splitNode?.name ?? null
      return {
        ...a,
        split_name: metaName ?? (a.split_node_id ? splitNodeNames[a.split_node_id] || null : null),
        split_group_id: a.split_group_id,
        split_group_name: a.split_group_name,
      }
    })

    return { be, period, statement, ledgerEntries, allocations, splitGroups, splitGroupMembers, splitNodeNames }
  }

}
