import { Module } from '@nestjs/common'
import { CommitteeController } from './committee.controller'
import { CommitteeService } from './committee.service'
import { PrismaService } from '../user/prisma.service'

@Module({
  controllers: [CommitteeController],
  providers: [CommitteeService, PrismaService],
})
export class CommitteeModule {}
