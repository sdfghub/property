import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import admin from 'firebase-admin'
import fs from 'fs'
import https from 'https'

type PushPayload = { title?: string; body?: string; url?: string; token?: string }
type PushSendPayload = { title?: string; body?: string; url?: string }
const DEFAULT_DEV_FCM_PATH = `${process.env.HOME || ''}/.config/property/fcm-service-account.json`
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureFirebase() {
    if (admin.apps.length) return admin.app()
    const json = process.env.FCM_SERVICE_ACCOUNT_JSON
    const path = process.env.FCM_SERVICE_ACCOUNT_PATH
    let creds: any = null
    if (json) {
      creds = JSON.parse(json)
    } else if (path) {
      creds = JSON.parse(fs.readFileSync(path, 'utf8'))
    } else if (process.env.NODE_ENV !== 'production' && DEFAULT_DEV_FCM_PATH) {
      if (fs.existsSync(DEFAULT_DEV_FCM_PATH)) {
        creds = JSON.parse(fs.readFileSync(DEFAULT_DEV_FCM_PATH, 'utf8'))
      }
    }
    if (!creds) {
      throw new ForbiddenException('FCM service account not configured')
    }
    return admin.initializeApp({
      credential: admin.credential.cert(creds),
    })
  }

  private isExpoToken(token: string) {
    return token.startsWith('ExpoPushToken') || token.startsWith('ExponentPushToken')
  }

  private postJson(url: string, payload: any): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url)
      const req = https.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            const status = res.statusCode || 0
            try {
              const body = data ? JSON.parse(data) : null
              resolve({ status, body })
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.on('error', reject)
      req.write(JSON.stringify(payload))
      req.end()
    })
  }

  private async sendExpoMessages(messages: Array<{ to: string; title?: string; body?: string; data?: any }>) {
    const { status, body } = await this.postJson(EXPO_PUSH_URL, messages)
    if (status < 200 || status >= 300) {
      throw new Error(body?.errors?.[0]?.message || `Expo push failed (${status})`)
    }
    const results = Array.isArray(body?.data) ? body.data : []
    let failed = 0
    for (const res of results) {
      if (!res || res.status !== 'ok') failed += 1
    }
    return { ok: failed === 0, sent: results.length, failed }
  }

  async listTokens(userId: string) {
    if (!userId) throw new ForbiddenException('User required')
    return this.prisma.pushToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, token: true, platform: true, createdAt: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'desc' },
    })
  }

  async registerToken(
    userId: string,
    input: { token?: string; platform?: string; deviceInfo?: any },
  ) {
    if (!userId) throw new ForbiddenException('User required')
    if (!input.token || typeof input.token !== 'string') throw new ForbiddenException('Token required')
    const platform = typeof input.platform === 'string' && input.platform ? input.platform : 'WEB'
    const deviceInfo = input.deviceInfo && typeof input.deviceInfo === 'object' ? input.deviceInfo : null
    return this.prisma.pushToken.upsert({
      where: { token: input.token },
      update: {
        userId,
        platform,
        deviceInfo,
        revokedAt: null,
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        token: input.token,
        platform,
        deviceInfo,
        lastSeenAt: new Date(),
      },
      select: { id: true, token: true, platform: true, createdAt: true, lastSeenAt: true },
    })
  }

  async revokeToken(userId: string, id: string) {
    if (!userId) throw new ForbiddenException('User required')
    const existing = await this.prisma.pushToken.findFirst({ where: { id, userId } })
    if (!existing) throw new ForbiddenException('Token not found')
    await this.prisma.pushToken.update({ where: { id }, data: { revokedAt: new Date() } })
    return { ok: true }
  }

  async sendTest(userId: string, input: PushPayload) {
    if (!userId) throw new ForbiddenException('User required')
    const token =
      input.token ||
      (await this.prisma.pushToken.findFirst({
        where: { userId, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        select: { token: true },
      }))?.token
    if (!token) throw new ForbiddenException('No push token available')

    const title = input.title || 'Test notification'
    const body = input.body || 'Push test from API'
    const url = input.url || undefined

    if (this.isExpoToken(token)) {
      await this.sendExpoMessages([{ to: token, title, body, data: url ? { url } : undefined }])
      return { ok: true }
    }

    const app = this.ensureFirebase()
    const messageId = await app.messaging().send({
      token,
      notification: { title, body },
      data: url ? { url } : undefined,
      webpush: url ? { fcmOptions: { link: url } } : undefined,
    })
    return { ok: true, messageId }
  }

  async sendTestToUser(targetUserId: string, input: PushPayload) {
    if (!targetUserId) throw new ForbiddenException('User required')
    const token =
      input.token ||
      (await this.prisma.pushToken.findFirst({
        where: { userId: targetUserId, revokedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        select: { token: true },
      }))?.token
    if (!token) throw new ForbiddenException('No push token available')

    const title = input.title || 'Test notification'
    const body = input.body || 'Push test from API'
    const url = input.url || undefined

    if (this.isExpoToken(token)) {
      await this.sendExpoMessages([{ to: token, title, body, data: url ? { url } : undefined }])
      return { ok: true }
    }

    const app = this.ensureFirebase()
    const messageId = await app.messaging().send({
      token,
      notification: { title, body },
      data: url ? { url } : undefined,
      webpush: url ? { fcmOptions: { link: url } } : undefined,
    })
    return { ok: true, messageId }
  }

  async sendToTokens(tokens: string[], input: PushSendPayload) {
    const title = input.title || 'Notification'
    const body = input.body || ''
    const url = input.url || undefined
    const expoTokens = tokens.filter((token) => this.isExpoToken(token))
    const fcmTokens = tokens.filter((token) => !this.isExpoToken(token))
    let sent = 0
    let failed = 0

    if (expoTokens.length) {
      const expoRes = await this.sendExpoMessages(
        expoTokens.map((token) => ({ to: token, title, body, data: url ? { url } : undefined })),
      )
      sent += expoRes.sent
      failed += expoRes.failed
    }

    if (!fcmTokens.length) {
      return { ok: failed === 0, sent, failed }
    }

    const app = this.ensureFirebase()
    const results = await Promise.allSettled(
      fcmTokens.map((token) =>
        app.messaging().send({
          token,
          notification: { title, body },
          data: url ? { url } : undefined,
          webpush: url ? { fcmOptions: { link: url } } : undefined,
        }),
      ),
    )

    const errors = results.filter((r) => r.status === 'rejected')
    sent += results.length
    failed += errors.length
    return { ok: failed === 0, sent, failed }
  }
}
