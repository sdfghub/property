import { Module } from '@nestjs/common'
import { CorrectionsController } from './corrections.controller'
import { CorrectionsService } from './corrections.service'
import { PrismaService } from '../user/prisma.service'
import { PeriodModule } from '../period/period.module'

@Module({
  imports: [PeriodModule], // for PeriodService.reapplyCorrectionsNow (derive corrections into the ledger)
  controllers: [CorrectionsController],
  providers: [CorrectionsService, PrismaService],
})
export class CorrectionsModule {}
