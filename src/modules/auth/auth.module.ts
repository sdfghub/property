import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { PrismaService } from '../../modules/user/prisma.service'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtStrategy } from './jwt.strategy'
import { jwtModuleOptions } from '../../config/jwt'
import { MailModule } from '../mail/mail.module'
import { InviteModule } from '../invite/invite.module'

@Module({
  imports:[PassportModule, JwtModule.registerAsync(jwtModuleOptions), MailModule, InviteModule],
  providers:[AuthService, JwtStrategy, PrismaService],
  controllers:[AuthController],
  exports:[AuthService]
})
export class AuthModule {}
