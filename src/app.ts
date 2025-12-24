// src/app.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core'
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { BillingModule } from './modules/billing/billing.module'
import { PrismaService } from './modules/user/prisma.service'
import { UserModule } from './modules/user/user.module'
import { InviteModule } from './modules/invite/invite.module'
import { AuthModule } from './modules/auth/auth.module'
import { MailModule } from './modules/mail/mail.module'
import { CommunityModule } from './modules/community/community.module'
import { PeriodModule } from './modules/period/period.module'
import { BeFinancialsModule } from './modules/be-financials/be-financials.module'
import { ProgramModule } from './modules/program/program.module'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    return { status: 'ok' }
  }
}

@Module({
  imports: [
    BillingModule, 
    UserModule,
    InviteModule,
    AuthModule,
    MailModule,
    CommunityModule,
    PeriodModule,
    BeFinancialsModule,
    ProgramModule,
  ],
  controllers: [HealthController],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  console.log(process.env.APP_ORIGIN?.split(',').map(s => s.trim()) || '*')

  app.enableCors({
    origin: process.env.APP_ORIGIN?.split(',').map(s => s.trim()) || '*',
    credentials: true,
  })
  app.use(cookieParser())

  // Global config
  app.setGlobalPrefix('api')
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  // Proper shutdown for Prisma
  const prisma = app.get(PrismaService)

  const port = Number(process.env.PORT) || 3000
  await app.listen(port)
  const url = await app.getUrl()
  // eslint-disable-next-line no-console
  console.log(`✅ API up at ${url}/api`)
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
