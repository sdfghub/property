import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ServicesController } from './services.controller'
import { ServicesService } from './services.service'

@Module({
  controllers: [ServicesController],
  providers: [ServicesService, PrismaService],
  exports: [ServicesService],
})
export class ServicesModule {}
