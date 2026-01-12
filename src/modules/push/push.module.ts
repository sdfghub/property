import { Module } from '@nestjs/common'
import { PushController } from './push.controller'
import { PushService } from './push.service'
import { PrismaService } from '../user/prisma.service'

@Module({
  controllers: [PushController],
  providers: [PushService, PrismaService],
  exports: [PushService],
})
export class PushModule {}
