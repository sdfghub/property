import { Module } from '@nestjs/common'
import { FinanceController } from './finance.controller'
import { FinanceService } from './finance.service'
import { PrismaService } from '../user/prisma.service'
import { PeriodModule } from '../period/period.module'

@Module({
  imports: [PeriodModule],
  controllers: [FinanceController],
  providers: [FinanceService, PrismaService],
})
export class FinanceModule {}
