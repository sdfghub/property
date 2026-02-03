import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from '../billing/period-lookup.service'

@Injectable()
export class BeFinancialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periodLookup: BillingPeriodLookupService,
  ) {}

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
        SUM(ccl.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN community_charge_line ccl
        ON ccl.unit_id = bem.unit_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN unit u ON u.id = ccl.unit_id
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
        SUM(ccl.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN community_charge_line ccl
        ON ccl.unit_id = bem.unit_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = (ccl.meta->>'splitNodeId')
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
        SUM(ccl.amount)::numeric AS amount
      FROM p
      JOIN billing_entity_member bem
        ON bem.billing_entity_id = p.be_id
       AND bem.unit_id = p.unit_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN community_charge_line ccl
        ON ccl.unit_id = p.unit_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = (ccl.meta->>'splitNodeId')
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
        SUM(ccl.amount)::numeric AS amount
      FROM p
      JOIN split_group_member sgm
        ON sgm.split_group_id = p.split_group_id
      JOIN community_charge_line ccl
        ON (ccl.meta->>'splitNodeId') = sgm.split_node_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN billing_entity_member bem
        ON bem.unit_id = ccl.unit_id
       AND bem.billing_entity_id = p.be_id
       AND bem.start_seq <= p.seq
       AND (bem.end_seq IS NULL OR bem.end_seq >= p.seq)
      JOIN unit u ON u.id = ccl.unit_id
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
        ccl.id AS "allocationId",
        ccl.amount,
        ccl.meta->>'splitNodeId' AS "splitNodeId",
        NULL::text AS "expenseSplitId",
        NULL::text AS "parentSplitId",
        NULL::json AS "allocationTrace",
        CASE WHEN cc.source_type = 'EXPENSE' THEN cc.source_id ELSE NULL END AS "expenseId",
        cc.meta->>'description' AS "expenseDescription",
        cc.amount AS "expenseAmount",
        ccl.meta->>'expenseType' AS "expenseTypeCode",
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
      JOIN community_charge_line ccl
        ON ccl.unit_id = p.unit_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN community_charge cc ON cc.id = ccl.charge_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = (ccl.meta->>'splitNodeId')
       AND sgm.split_group_id = p.split_group_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      JOIN unit u ON u.id = ccl.unit_id
      ORDER BY expenseDescription, expenseTypeCode, ccl.id;
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

    return {
      be,
      period: { id: period.id, code: period.code },
      unit: unitPayload,
      splitGroup: sgPayload,
      rows,
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
        ccl.id AS "allocationId",
        ccl.amount,
        ccl.meta->>'splitNodeId' AS "splitNodeId",
        NULL::text AS "expenseSplitId",
        NULL::text AS "parentSplitId",
        NULL::json AS "allocationTrace",
        CASE WHEN cc.source_type = 'EXPENSE' THEN cc.source_id ELSE NULL END AS "expenseId",
        cc.meta->>'description' AS "expenseDescription",
        cc.amount AS "expenseAmount",
        ccl.meta->>'expenseType' AS "expenseTypeCode",
        u.id AS "unitId",
        u.code AS "unitCode",
        u.code AS "unitName",
        sg.id AS "splitGroupId",
        sg.code AS "splitGroupCode",
        sg.name AS "splitGroupName"
      FROM p
      JOIN community_charge_line ccl
        ON ccl.unit_id = p.unit_id
       AND ccl.period_id = p.period_id
       AND ccl.community_id = p.community_id
      JOIN community_charge cc ON cc.id = ccl.charge_id
      JOIN split_group_member sgm
        ON sgm.split_node_id = (ccl.meta->>'splitNodeId')
       AND sgm.split_group_id = p.split_group_id
      JOIN split_group sg
        ON sg.id = sgm.split_group_id
       AND sg.community_id = p.community_id
      JOIN unit u ON u.id = ccl.unit_id
      ORDER BY expenseDescription, expenseTypeCode, ccl.id;
      `,
      communityId,
      period.id,
      period.seq,
      unitId,
      splitGroupId,
    )

    return {
      communityId,
      period: { id: period.id, code: period.code },
      unit: unit || { id: unitId },
      splitGroup: splitGroup || { id: splitGroupId },
      rows,
    }
  }
}
