import { Injectable, Logger } from '@nestjs/common'

// Lazy imports so the deps stay optional (repo runs transpile-only).
let ResendCtor: any
try { ResendCtor = require('resend').Resend } catch {}
let nodemailer: any
try { nodemailer = require('nodemailer') } catch {}

/**
 * Delivery priority:
 *   1. SMTP relay  — used when SMTP_HOST is set (self-hosted deploys can't send
 *      direct mail from a residential IP, so a relay is the intended path).
 *   2. Resend API  — used when RESEND_API_KEY is set.
 *   3. dev-log     — no provider configured: log the mail to the console.
 * A transient SMTP failure falls through to the next available provider.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name)
  private readonly from = process.env.MAIL_FROM || 'no-reply@example.com'
  private readonly resendApiKey = process.env.RESEND_API_KEY
  private smtpTransport: any
  private smtpInitFailed = false

  private getSmtp() {
    if (this.smtpTransport || this.smtpInitFailed) return this.smtpTransport
    const host = process.env.SMTP_HOST
    if (!host || !nodemailer) return undefined
    const port = Number(process.env.SMTP_PORT || 587)
    const secure = (process.env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true'
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    try {
      this.smtpTransport = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      })
      this.logger.log(`SMTP transport ready host=${host} port=${port} secure=${secure} auth=${user ? 'yes' : 'no'}`)
    } catch (e: any) {
      this.smtpInitFailed = true
      this.logger.error(`SMTP transport init failed: ${e?.message ?? e}`)
    }
    return this.smtpTransport
  }

  async send(to: string, subject: string, html: string) {
    const smtp = this.getSmtp()
    if (smtp) {
      try {
        await smtp.sendMail({ from: this.from, to, subject, html })
        return { ok: true, provider: 'smtp' }
      } catch (e: any) {
        this.logger.error(`SMTP send to ${to} failed: ${e?.message ?? e}`)
        // fall through to the next provider
      }
    }
    if (this.resendApiKey && ResendCtor) {
      const client = new ResendCtor(this.resendApiKey)
      await client.emails.send({ from: this.from, to, subject, html })
      return { ok: true, provider: 'resend' }
    }
    // eslint-disable-next-line no-console
    console.log(`[mail:dev] to=${to} subject="${subject}" html=${JSON.stringify(html)}`)
    return { ok: true, provider: 'dev-log' }
  }
}
