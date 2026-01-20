import { Module } from '@nestjs/common'
import { PeriodController, PeriodQueryController } from './period.controller'
import { PeriodService } from './period.service'
import { PrismaService } from '../user/prisma.service'
import { PaymentService } from '../billing/payment.service'
import { AllocationService } from '../billing/allocation.service'

@Module({
  imports: [],
  controllers: [PeriodController, PeriodQueryController],
  providers: [PeriodService, PrismaService, PaymentService, AllocationService],
  exports: [PeriodService],
})
export class PeriodModule {}
