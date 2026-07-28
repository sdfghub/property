import { Module } from '@nestjs/common'
import { BeFinancialsController, CommunityAllocationsController } from './be-financials.controller'
import { BeFinancialsService } from './be-financials.service'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from '../billing/period-lookup.service'
import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [BillingModule], // for BeQueryService.assertBeAccess (per-BE ownership guard)
  controllers: [BeFinancialsController, CommunityAllocationsController],
  providers: [BeFinancialsService, PrismaService, BillingPeriodLookupService],
  exports: [BeFinancialsService],
})
export class BeFinancialsModule {}
