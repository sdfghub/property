import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { ProgramService } from './program.service'
import { ProgramController } from './program.controller'

@Module({
  providers: [PrismaService, ProgramService],
  controllers: [ProgramController],
  exports: [ProgramService],
})
export class ProgramModule {}
