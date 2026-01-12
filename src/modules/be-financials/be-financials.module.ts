import { Module } from '@nestjs/common'
import { BeFinancialsController, CommunityAllocationsController } from './be-financials.controller'
import { BeFinancialsService } from './be-financials.service'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from '../billing/period-lookup.service'
import { AllocationTraceService } from '../billing/allocation-trace.service'

@Module({
  controllers: [BeFinancialsController, CommunityAllocationsController],
  providers: [BeFinancialsService, PrismaService, BillingPeriodLookupService, AllocationTraceService],
  exports: [BeFinancialsService],
})
export class BeFinancialsModule {}
