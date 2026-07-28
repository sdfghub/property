import { ForbiddenException, Injectable } from '@nestjs/common'
import { BillingEntityRole } from '@prisma/client'
import { MemberAccessService } from './member-access.service'
import { BillingPeriodLookupService } from './period-lookup.service'
import { FinanceService } from '../finance/finance.service'
import { ReportsService } from '../reports/reports.service'
import { FundService } from '../fund/fund.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

// Association-level reports (avizier, invoices, funds, collection) are visible to OWNER and
// EXPENSE_RESPONSIBLE only — a RESIDENT-only user is limited to their own BE (meters, ledger).
const REPORT_ROLES: BillingEntityRole[] = ['OWNER', 'EXPENSE_RESPONSIBLE']

/**
 * Resident-facing, read-only reports scoped to a community the caller belongs to. Delegates to the
 * exact same services the admin controllers use, but gated by billing-entity sub-role instead of a
 * governance role, and restricted to CLOSED periods (residents never see an in-progress month).
 */
@Injectable()
export class MeReportsService {
  constructor(
    private readonly access: MemberAccessService,
    private readonly periods: BillingPeriodLookupService,
    private readonly finance: FinanceService,
    private readonly reports: ReportsService,
    private readonly fundSvc: FundService,
  ) {}

  /** Which resident capabilities the caller has in this community — drives the UI tab set. */
  async capabilities(userId: string | undefined, communityId: string, roles: RoleAssignment[]) {
    const held = await this.access.getCommunityRoles(userId, communityId)
    const isAdmin = this.access.isCommunityAdmin(roles, communityId)
    const isMember = isAdmin || held.length > 0
    const canReports = isAdmin || held.some((r) => REPORT_ROLES.includes(r))
    return {
      roles: held,
      can: {
        meters: isMember,
        ledger: isMember,
        avizier: canReports,
        invoices: canReports,
        funds: canReports,
        collectionRate: canReports,
      },
    }
  }

  /**
   * Resolve the requested period to a CLOSED one. No code → latest closed. A code that isn't a closed
   * period is rejected (residents must not reach OPEN/PREPARED data). Returns null when the community
   * has no closed period yet.
   */
  private async resolveClosed(communityId: string, periodCode?: string) {
    const closed = await this.periods.listClosed(communityId)
    if (!closed.length) return null
    if (!periodCode) return closed[0]
    const match = closed.find((p) => p.code === periodCode)
    if (!match) throw new ForbiddenException('Only closed periods are available')
    return match
  }

  async avizier(userId: string | undefined, communityId: string, roles: RoleAssignment[], periodCode?: string) {
    await this.access.assertCommunityMemberRole(userId, communityId, REPORT_ROLES, roles)
    const period = await this.resolveClosed(communityId, periodCode)
    if (!period) return { period: null, categories: [], rows: [], totals: null }
    return this.finance.avizier(communityId, period.code)
  }

  async collectionRate(
    userId: string | undefined,
    communityId: string,
    roles: RoleAssignment[],
    periodCode?: string,
    domain?: string,
  ) {
    await this.access.assertCommunityMemberRole(userId, communityId, REPORT_ROLES, roles)
    const period = await this.resolveClosed(communityId, periodCode)
    if (!period) return this.reports.collectionRate(communityId, undefined, domain)
    return this.reports.collectionRate(communityId, period.code, domain)
  }

  async unpaidVendorInvoices(userId: string | undefined, communityId: string, roles: RoleAssignment[]) {
    await this.access.assertCommunityMemberRole(userId, communityId, REPORT_ROLES, roles)
    return this.finance.unpaidVendorInvoices(communityId)
  }

  async funds(userId: string | undefined, communityId: string, roles: RoleAssignment[]) {
    await this.access.assertCommunityMemberRole(userId, communityId, REPORT_ROLES, roles)
    const [status, balances] = await Promise.all([
      this.finance.fundsStatus(communityId),
      this.fundSvc.listBalances(communityId),
    ])
    return { status, balances }
  }

  async fundLedger(userId: string | undefined, communityId: string, roles: RoleAssignment[], fundId: string) {
    await this.access.assertCommunityMemberRole(userId, communityId, REPORT_ROLES, roles)
    return this.fundSvc.ledgerEntries(communityId, fundId)
  }
}
