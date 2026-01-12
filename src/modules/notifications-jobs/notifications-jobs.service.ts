import { Injectable } from '@nestjs/common'
import { MailService } from '../mail/mail.service'
import { PushService } from '../push/push.service'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class NotificationsJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly push: PushService,
  ) {}

  private buildEmailHtml(title: string, body: string) {
    return `<h2>${title}</h2><p>${body}</p>`
  }

  async processPendingDeliveries(limit = 100) {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
      include: {
        notification: {
          include: { user: { select: { id: true, email: true } } },
        },
      },
    })

    for (const delivery of deliveries) {
      const { notification } = delivery
      try {
        if (delivery.channel === 'IN_APP') {
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SENT', sentAt: new Date() },
          })
          continue
        }

        if (delivery.channel === 'EMAIL') {
          const email = notification.user?.email
          if (!email) throw new Error('Missing user email')
          await this.mail.send(email, notification.title, this.buildEmailHtml(notification.title, notification.body))
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SENT', sentAt: new Date() },
          })
          continue
        }

        if (delivery.channel === 'PUSH') {
          const tokens = await this.prisma.pushToken.findMany({
            where: { userId: notification.userId, revokedAt: null },
            select: { token: true },
          })
          if (!tokens.length) throw new Error('No active push tokens')
          const data = notification.data
          const dataObj =
            data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, any>) : null
          await this.push.sendToTokens(tokens.map((t) => t.token), {
            title: notification.title,
            body: notification.body,
            url: dataObj?.url,
          })
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SENT', sentAt: new Date() },
          })
          continue
        }

        throw new Error(`Unsupported channel ${delivery.channel}`)
      } catch (err: any) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', error: String(err?.message || err) },
        })
      }
    }

    return { processed: deliveries.length }
  }
}
