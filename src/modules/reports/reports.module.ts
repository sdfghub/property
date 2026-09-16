import { Module } from '@nestjs/common'
import { ReportsController } from './reports.controller'
import { ReportsService } from './reports.service'
import { PrismaService } from '../user/prisma.service'
import { PeriodModule } from '../period/period.module'
import { FinanceModule } from '../finance/finance.module'

@Module({
  imports: [PeriodModule, FinanceModule],
  controllers: [ReportsController],
  providers: [ReportsService, PrismaService],
  exports: [ReportsService],
})
export class ReportsModule {}
