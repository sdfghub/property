import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { NotificationChannel } from '@prisma/client'
import { PrismaService } from '../user/prisma.service'

const CHANNELS: NotificationChannel[] = ['IN_APP', 'PUSH', 'EMAIL']
const IN_APP_CHANNEL: NotificationChannel = 'IN_APP'

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async isInAppEnabled(userId: string) {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_channel: { userId, channel: IN_APP_CHANNEL } },
      select: { enabled: true },
    })
    return pref ? pref.enabled : true
  }

  private buildPreferenceMap(userIds: string[]) {
    return this.prisma.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, channel: true, enabled: true },
    })
  }

  async listNotifications(userId: string, opts: { limit?: number; unreadOnly?: boolean }) {
    const inAppEnabled = await this.isInAppEnabled(userId)
    if (!inAppEnabled) return []
    const take = opts.limit && Number.isFinite(opts.limit) ? Math.min(opts.limit, 100) : 50
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(opts.unreadOnly ? { readAt: null } : null),
      },
      orderBy: { createdAt: 'desc' },
      take,
    })
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId },
      select: { id: true, userId: true, readAt: true },
    })
    if (!existing) throw new ForbiddenException('Notification not found')
    if (existing.userId !== userId) throw new ForbiddenException('Notification access denied')
    if (existing.readAt) return existing

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    })
  }

  async createNotificationsForUsers(input: {
    userIds: string[]
    source: 'TICKET' | 'COMMUNICATION'
    sourceId?: string | null
    title: string
    body: string
    data?: any
  }) {
    const uniqueIds = Array.from(new Set(input.userIds.filter(Boolean)))
    if (!uniqueIds.length) return { created: 0 }

    const prefs = await this.buildPreferenceMap(uniqueIds)
    const prefMap = new Map<string, Map<NotificationChannel, boolean>>()
    for (const pref of prefs) {
      if (!prefMap.has(pref.userId)) prefMap.set(pref.userId, new Map())
      prefMap.get(pref.userId)?.set(pref.channel, pref.enabled)
    }

    let created = 0
    for (const userId of uniqueIds) {
      const channelPrefs = prefMap.get(userId)
      const enabledChannels = CHANNELS.filter((channel) => {
        if (!channelPrefs) return true
        return channelPrefs.has(channel) ? channelPrefs.get(channel) : true
      })
      if (!enabledChannels.length) continue

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          source: input.source,
          sourceId: input.sourceId ?? null,
          title: input.title,
          body: input.body,
          data: input.data ?? undefined,
        },
      })

      await this.prisma.notificationDelivery.createMany({
        data: enabledChannels.map((channel) => ({
          notificationId: notification.id,
          channel,
        })),
      })
      created += 1
    }

    return { created }
  }

  async listPreferences(userId: string) {
    const existing = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { channel: true, enabled: true },
    })
    const byChannel = new Map(existing.map((pref) => [pref.channel, pref.enabled]))
    return CHANNELS.map((channel) => ({
      channel,
      enabled: byChannel.has(channel) ? byChannel.get(channel) : true,
    }))
  }

  async updatePreferences(userId: string, input: any) {
    const updates = Array.isArray(input?.preferences) ? input.preferences : [input]
    const payload = updates
      .map((entry: any) => ({
        channel: String(entry?.channel ?? '').toUpperCase() as NotificationChannel,
        enabled: entry?.enabled,
      }))
      .filter((entry: { channel: NotificationChannel; enabled: any }) =>
        CHANNELS.includes(entry.channel) && typeof entry.enabled === 'boolean',
      )

    if (!payload.length) {
      throw new BadRequestException('No valid preferences provided')
    }

    await this.prisma.$transaction(
      payload.map((pref: { channel: NotificationChannel; enabled: boolean }) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_channel: { userId, channel: pref.channel } },
          update: { enabled: pref.enabled },
          create: { userId, channel: pref.channel, enabled: pref.enabled },
        }),
      ),
    )

    return this.listPreferences(userId)
  }
}
