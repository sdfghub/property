import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  private async getPeriod(communityId: string, periodCode: string) {
    const period = await this.prisma.period.findUnique({
      where: { communityId_code: { communityId, code: periodCode } },
      select: { id: true, seq: true, code: true },
    });
    if (!period) throw new NotFoundException(`Period ${periodCode} not found for ${communityId}`);
    return period;
  }

  async listBillingEntities(communityId: string, periodCode: string) {
    const period = await this.getPeriod(communityId, periodCode);
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
    return { period, items: rows };
  }

  async getBillingEntityMembers(communityId: string, periodCode: string, beCode: string) {
    const period = await this.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

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

  async getBillingEntityAllocations(communityId: string, periodCode: string, beCode: string) {
    const period = await this.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

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

    // billing.service.ts
  async getBillingEntityMemberAllocations(
    communityId: string, periodCode: string, beCode: string, unitCode: string
  ) {
    const period = await this.getPeriod(communityId, periodCode);

    const be = await this.prisma.billingEntity.findUnique({
      where: { code_communityId: { code: beCode, communityId } },
      select: { id: true, code: true, name: true },
    });
    if (!be) throw new NotFoundException(`Billing entity ${beCode} not found`);

    const unit = await this.prisma.unit.findUnique({
      where: { code_communityId: { code: unitCode, communityId } },
      select: { id: true, code: true },
    });
    if (!unit) throw new NotFoundException(`Unit ${unitCode} not found`);

    // Ensure unit is a member for this period
    const membership = await this.prisma.billingEntityMember.findFirst({
      where: {
        billingEntityId: be.id,
        unitId: unit.id,
        startSeq: { lte: period.seq },
        OR: [{ endSeq: null }, { endSeq: { gte: period.seq } }],
      },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException(`Unit ${unitCode} not a member of ${beCode} in ${period.code}`);

    // Allocations for this unit in the period
    const lines = await this.prisma.$queryRawUnsafe<any[]>(`
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
      WHERE al.period_id = $1 AND al.unit_id = $2
      ORDER BY e.description
    `, period.id, unit.id);

    const total = lines.reduce((s,l)=> s + Number(l.amount), 0);

    return { period, be, unit, total, lines };
  }

}
