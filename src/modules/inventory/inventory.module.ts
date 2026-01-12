import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { TicketingModule } from '../ticketing/ticketing.module'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'

@Module({
  imports: [TicketingModule],
  controllers: [InventoryController],
  providers: [InventoryService, PrismaService],
  exports: [InventoryService],
})
export class InventoryModule {}
