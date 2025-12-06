import { Injectable } from '@nestjs/common'

// Lazy import Resend to keep deps optional
let ResendCtor: any
try { ResendCtor = require('resend').Resend } catch {}

@Injectable()
export class MailService {
  private readonly from = process.env.MAIL_FROM || 'no-reply@example.com'
  private readonly resendApiKey = process.env.RESEND_API_KEY

  async send(to: string, subject: string, html: string) {
    if (this.resendApiKey && ResendCtor) {
      const client = new ResendCtor(this.resendApiKey)
      await client.emails.send({ from: this.from, to, subject, html })
      return { ok: true, provider: 'resend' }
    }
    // fallback: log-only (or integrate nodemailer SMTP here if desired)
    // eslint-disable-next-line no-console
    console.log(`[mail:dev] to=${to} subject="${subject}" html=${JSON.stringify(html)}`)
    return { ok: true, provider: 'dev-log' }
  }
}
