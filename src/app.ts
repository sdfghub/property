// src/app.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core'
import { Module, ValidationPipe } from '@nestjs/common'
import { BillingModule } from './modules/billing/billing.module'
import { PrismaService } from './modules/billing/prisma.service'
import { UserModule } from './modules/user/user.module';
import { InviteModule } from './modules/invite/invite.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [
    BillingModule, 
    UserModule,
    InviteModule,
    AuthModule,
    MailModule
  ]
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })

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
