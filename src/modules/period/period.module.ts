import { Module } from '@nestjs/common'
import { PeriodController, PeriodQueryController } from './period.controller'
import { PeriodService } from './period.service'
import { PrismaService } from '../user/prisma.service'
import { BillingModule } from '../billing/billing.module'

@Module({
  imports: [BillingModule],
  controllers: [PeriodController, PeriodQueryController],
  providers: [PeriodService, PrismaService],
  exports: [PeriodService],
})
export class PeriodModule {}
