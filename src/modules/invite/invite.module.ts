import { Module } from '@nestjs/common'
import { InviteService } from './invite.service'
import { InviteController } from './invite.controller'
import { PrismaService } from '../user/prisma.service'
import { MailModule } from '../mail/mail.module'

@Module({ imports:[MailModule], controllers:[InviteController], providers:[InviteService,PrismaService], exports:[InviteService] })
export class InviteModule{}
