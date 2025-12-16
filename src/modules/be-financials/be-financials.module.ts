import { Module } from '@nestjs/common'
import { BeFinancialsController } from './be-financials.controller'
import { BeFinancialsService } from './be-financials.service'
import { PrismaService } from '../user/prisma.service'
import { BillingPeriodLookupService } from '../billing/period-lookup.service'

@Module({
  controllers: [BeFinancialsController],
  providers: [BeFinancialsService, PrismaService, BillingPeriodLookupService],
  exports: [BeFinancialsService],
})
export class BeFinancialsModule {}

