import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { FundService } from './fund.service'
import { FundController } from './fund.controller'

@Module({
  providers: [PrismaService, FundService],
  controllers: [FundController],
  exports: [FundService],
})
export class FundModule {}
