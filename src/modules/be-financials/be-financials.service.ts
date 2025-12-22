import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from '../billing/period-lookup.service'

@Injectable()
export class BeFinancialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periodLookup: BillingPeriodLookupService,
  ) {}

  private async buildSplitTrail(splitId: string, cache: Map<string, any[]>): Promise<any[]> {
    if (!splitId) return []
    if (cache.has(splitId)) return cache.get(splitId)!
    const trail: any[] = []
    let current: string | null = splitId
    while (current) {
      const es = (await this.prisma.expenseSplit.findUnique({
        where: { id: current },
        select: {
          id: true,
          parentSplitId: true,
          meta: true,
          expense: { select: { id: true, description: true } },
        },
      })) as {
        id: string
        parentSplitId: string | null
        meta: unknown
        expense?: { id: string; description: string | null }
      } | null
      if (!es) break
      const name =
        // prefer explicit name in meta if present
        (es.meta as any)?.name ||
        (es.meta as any)?.splitNode?.name ||
        (es.meta as any)?.split_node?.name ||
        es.id
      trail.push({
        id: es.id,
        name,
        meta: es.meta,
        expenseId: es.expense?.id,
        expenseDescription: es.expense?.description || undefined,
      })
      current = es.parentSplitId
    }
    cache.set(splitId, trail)
    return trail
  }

  private async getBe(beId: string) {
    const be = await this.prisma.billingEntity.findUnique({
      where: { id: beId },
      select: { id: true, code: true, name: true, communityId: true },
    })
    if (!be) throw new NotFoundException('Billing entity not found')
    return be
  }

  async aggregateByMember(beId: string, periodCode: string) {
    const be = await this.getBe(beId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS be_id
      )
      SELECT
        u.id   AS "unitId",
        u.code AS "unitCode",
        u.code AS "unitName",
        SUM(al.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN allocation_line al
        ON al.unit_id = bem.unit_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN unit u ON u.id = al.unit_id
      GROUP BY u.id, u.code
      ORDER BY u.code
      `,
      be.communityId,
      period.id,
      period.seq,
      be.id,
    )

    return { be, period: { id: period.id, code: period.code }, groupBy: 'MEMBER', rows }
  }

  async aggregateBySplitGroup(beId: string, periodCode: string) {
    const be = await this.getBe(beId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS be_id
      )
      SELECT
        sg.id   AS "splitGroupId",
        sg.code AS "splitGroupCode",
        sg.name AS "splitGroupName",
        sg."order" AS "splitGroupOrder",
        SUM(al.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN allocation_line al
        ON al.unit_id = bem.unit_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = al.split_node_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      GROUP BY sg.id, sg.code, sg.name, sg."order"
      ORDER BY sg."order" ASC, sg.code ASC
      `,
      be.communityId,
      period.id,
      period.seq,
      be.id,
    )

    return { be, period: { id: period.id, code: period.code }, groupBy: 'SPLIT_GROUP', rows }
  }

  async drillUnitToSplitGroup(beId: string, periodCode: string, unitId: string) {
    const be = await this.getBe(beId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, code: true },
    })

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS be_id,
               $5::text AS unit_id
      )
      SELECT
        sg.id   AS "splitGroupId",
        sg.code AS "splitGroupCode",
        sg.name AS "splitGroupName",
        sg."order" AS "splitGroupOrder",
        SUM(al.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.unit_id = p.unit_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN allocation_line al
        ON al.unit_id = p.unit_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = al.split_node_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      GROUP BY sg.id, sg.code, sg.name, sg."order"
      ORDER BY sg."order" ASC, sg.code ASC;
      `,
      be.communityId,
      period.id,
      period.seq,
      be.id,
      unitId,
    )

    return { be, period: { id: period.id, code: period.code }, unit: unit || { id: unitId }, groupBy: 'SPLIT_GROUP', rows }
  }

  async drillSplitGroupToUnit(beId: string, periodCode: string, splitGroupId: string) {
    const be = await this.getBe(beId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS be_id,
               $5::text AS split_group_id
      )
      SELECT
        u.id   AS "unitId",
        u.code AS "unitCode",
        u.code AS "unitName",
        SUM(al.amount)::numeric AS amount
      FROM p
      JOIN split_group_member sgm
        ON sgm.split_group_id = p.split_group_id
      JOIN allocation_line al
        ON al.split_node_id = sgm.split_node_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN billing_entity_member bem
        ON bem.unit_id = al.unit_id
       AND bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN unit u ON u.id = al.unit_id
      GROUP BY u.id, u.code
      ORDER BY u.code;
      `,
      be.communityId,
      period.id,
      period.seq,
      be.id,
      splitGroupId,
    )

    return { be, period: { id: period.id, code: period.code }, splitGroupId, groupBy: 'UNIT', rows }
  }

  async drillAllocations(beId: string, periodCode: string, unitId: string, splitGroupId: string) {
    const be = await this.getBe(beId)
    const period = await this.periodLookup.getPeriod(be.communityId, periodCode)
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { id: true, code: true },
    })
    const splitGroup = await this.prisma.splitGroup.findUnique({
      where: { id: splitGroupId },
      select: { id: true, code: true, name: true },
    })

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS be_id,
               $5::text AS unit_id,
               $6::text AS split_group_id
      )
      SELECT
        al.id AS "allocationId",
        al.amount,
        al.split_node_id AS "splitNodeId",
        (al.meta -> 'splitNode' ->> 'name') AS "splitNodeName",
        es.id AS "expenseSplitId",
        es.parent_split_id AS "parentSplitId",
        es.meta AS "expenseSplitMeta",
        al.meta,
        e.id AS "expenseId",
        e.description AS "expenseDescription",
        et.code AS "expenseTypeCode",
        u.id AS "unitId",
        u.code AS "unitCode",
        u.code AS "unitName",
        sg.id AS "splitGroupId",
        sg.code AS "splitGroupCode",
        sg.name AS "splitGroupName"
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.unit_id = p.unit_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN allocation_line al
        ON al.unit_id = p.unit_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = al.split_node_id
       AND sgm.split_group_id = p.split_group_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      JOIN unit u ON u.id = al.unit_id
      JOIN expense e ON e.id = al.expense_id
      JOIN expense_type et ON et.id = e.expense_type_id
      LEFT JOIN expense_split es ON es.id = al.expense_split_id
      ORDER BY e.description, et.code, al.id;
      `,
      be.communityId,
      period.id,
      period.seq,
      be.id,
      unitId,
      splitGroupId,
    )

    const unitPayload: { id: string; code?: string } = unit ? { id: unit.id, code: unit.code } : { id: unitId }
    const sgPayload: { id: string; code?: string; name?: string } = splitGroup
      ? { id: splitGroup.id, code: splitGroup.code, name: splitGroup.name }
      : { id: splitGroupId }

    const trailCache = new Map<string, any[]>()
    const rowsWithTrail = await Promise.all(
      rows.map(async (row) => {
        const splitId = row.expenseSplitId || row.splitNodeId
        if (!splitId) return row
        const trail = await this.buildSplitTrail(splitId, trailCache)
        return { ...row, splitTrail: trail }
      }),
    )

    return {
      be,
      period: { id: period.id, code: period.code },
      unit: unitPayload,
      splitGroup: sgPayload,
      rows: rowsWithTrail,
    }
  }

  async drillAllocationsByCommunity(communityRef: string, periodCode: string, unitId: string, splitGroupId: string) {
    const communityId = await this.periodLookup.resolveCommunityId(communityRef)
    const period = await this.periodLookup.getPeriod(communityId, periodCode)
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId }, select: { id: true, code: true } })
    const splitGroup = await this.prisma.splitGroup.findUnique({
      where: { id: splitGroupId },
      select: { id: true, code: true, name: true },
    })

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      WITH p AS (
        SELECT $1::text AS community_id,
               $2::text AS period_id,
               $3::int  AS seq,
               $4::text AS unit_id,
               $5::text AS split_group_id
      )
      SELECT
        al.id AS "allocationId",
        al.amount,
        al.split_node_id AS "splitNodeId",
        (al.meta -> 'splitNode' ->> 'name') AS "splitNodeName",
        es.id AS "expenseSplitId",
        es.parent_split_id AS "parentSplitId",
        es.meta AS "expenseSplitMeta",
        al.meta,
        e.id AS "expenseId",
        e.description AS "expenseDescription",
        et.code AS "expenseTypeCode",
        u.id AS "unitId",
        u.code AS "unitCode",
        u.code AS "unitName",
        sg.id AS "splitGroupId",
        sg.code AS "splitGroupCode",
        sg.name AS "splitGroupName"
      FROM p
      JOIN allocation_line al
        ON al.unit_id = p.unit_id
       AND al.period_id = p.period_id
       AND al.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = al.split_node_id
       AND sgm.split_group_id = p.split_group_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      JOIN unit u ON u.id = al.unit_id
      JOIN expense e ON e.id = al.expense_id
      JOIN expense_type et ON et.id = e.expense_type_id
      LEFT JOIN expense_split es ON es.id = al.expense_split_id
      ORDER BY e.description, et.code, al.id;
      `,
      communityId,
      period.id,
      period.seq,
      unitId,
      splitGroupId,
    )

    const trailCache = new Map<string, any[]>()
    const rowsWithTrail = await Promise.all(
      rows.map(async (row) => {
        const splitId = row.expenseSplitId || row.splitNodeId
        if (!splitId) return row
        const trail = await this.buildSplitTrail(splitId, trailCache)
        return { ...row, splitTrail: trail }
      }),
    )

    return {
      communityId,
      period: { id: period.id, code: period.code },
      unit: unit || { id: unitId },
      splitGroup: splitGroup || { id: splitGroupId },
      rows: rowsWithTrail,
    }
  }
}
