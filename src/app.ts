// src/app.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core'
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
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
import { PushModule } from './modules/push/push.module'
import { EngagementModule } from './modules/engagement/engagement.module'
import { TicketingModule } from './modules/ticketing/ticketing.module'
import { CommunicationsModule } from './modules/communications/communications.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { NotificationsJobsModule } from './modules/notifications-jobs/notifications-jobs.module'
import { InventoryModule } from './modules/inventory/inventory.module'

@Controller()
class HealthController {
  @Get('healthz')
  health() {
    const version = process.env.APP_VERSION
    if (version) {
      return { status: 'ok', version }
    }
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
    PushModule,
    EngagementModule,
    TicketingModule,
    CommunicationsModule,
    NotificationsModule,
    NotificationsJobsModule,
    InventoryModule,
  ],
  controllers: [HealthController],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  const rawOrigins =
    process.env.CORS_ORIGINS ||
    process.env.APP_ORIGIN ||
    process.env.FRONTEND_ORIGIN
  const corsOrigins = rawOrigins
    ? rawOrigins
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8081']

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        return callback(null, true)
      }
      return callback(new Error('CORS origin not allowed'), false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
  app.use(cookieParser())
  app.use((_: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    next()
  })
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Debug: log all requests with headers/body.
    console.log('[REQ]', {
      method: req.method,
      url: req.originalUrl || req.url,
      headers: req.headers,
      query: req.query,
      body: req.body,
    })
    const originalSend = res.send.bind(res)
    let responseBody: any = undefined
    res.send = (body?: any) => {
      responseBody = body
      return originalSend(body)
    }
    res.on('finish', () => {
      const serializeBody = (value: any) => {
        if (value == null) return value
        if (typeof value === 'string') return value
        if (Buffer.isBuffer(value)) return value.toString('utf8')
        try {
          return JSON.stringify(value)
        } catch {
          return '[unserializable]'
        }
      }
      console.log('[RES]', {
        method: req.method,
        url: req.originalUrl || req.url,
        status: res.statusCode,
        body: serializeBody(responseBody),
      })
    })
    next()
  })

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
