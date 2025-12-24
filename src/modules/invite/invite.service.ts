import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { randomBytes } from 'crypto'
import { MailService } from '../mail/mail.service'

@Injectable()
export class InviteService{
  private readonly logger = new Logger(InviteService.name)
  constructor(
    private readonly prisma:PrismaService,
    private readonly mail: MailService
  ){}
  async createInvite(email:string, role:'COMMUNITY_ADMIN'|'BILLING_ENTITY_USER'|'SYSTEM_ADMIN', scopeType:'SYSTEM'|'COMMUNITY'|'BILLING_ENTITY', scopeId?:string, invitedBy?:string){
    const token=randomBytes(24).toString('hex')
    const expiresAt=new Date(Date.now()+7*24*3600*1000)
    const normalizedEmail = email.trim()
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true },
    })
    const inv=await this.prisma.invite.create({
      data:{
        email: normalizedEmail,
        role,
        scopeType:scopeType,
        scopeId:scopeId??null,
        invitedBy:invitedBy??'',
        token,
        expiresAt:expiresAt
      }
    })
    const base=process.env.APP_PUBLIC_URL||'http://localhost:3000'
    const link=`${base}/invite?token=${token}`
    if (existingUser) {
      await this.claimInviteForUser(token, existingUser.id)
      await this.mail.send(
        normalizedEmail,
        'Access granted',
        `<p>You were granted <b>${role}</b> access. You can sign in at <a href="${base}">${base}</a>.</p>`
      )
      this.logger.log(`Invite auto-accepted for existing user ${existingUser.email} role=${role} scope=${scopeType}:${scopeId ?? '-'}`)
      return inv
    }
    await this.mail.send(normalizedEmail, 'You are invited', `<p>You were invited as <b>${role}</b>. Accept: <a href="${link}">${link}</a></p>`)
    this.logger.log(`Invite created for ${normalizedEmail} role=${role} scope=${scopeType}:${scopeId ?? '-'}`)
    return inv
  }
  async getInviteSummary(token: string){
    const inv = await this.prisma.invite.findUnique({ where:{ token } })
    if (!inv) throw new BadRequestException('Invalid/expired invite')
    if (inv.expiresAt < new Date()) throw new BadRequestException('Invalid/expired invite')
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      scopeType: inv.scopeType,
      scopeId: inv.scopeId,
      invitedBy: inv.invitedBy,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
    }
  }

  async claimInviteForUser(token: string, userId: string){
    const inv = await this.prisma.invite.findUnique({ where:{ token } })
    if (!inv || inv.expiresAt < new Date()) throw new BadRequestException('Invalid/expired invite')
    const user = await this.prisma.user.findUnique({ where:{ id: userId } })
    if (!user) throw new BadRequestException('User not found')
    if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
      throw new BadRequestException('Invite email does not match user')
    }

    const existing = await this.prisma.roleAssignment.findFirst({
      where: {
        userId: user.id,
        role: inv.role,
        scopeType: inv.scopeType,
        scopeId: inv.scopeId ?? null,
      },
    })
    if (!existing) {
      await this.prisma.roleAssignment.create({
        data: {
          userId: user.id,
          role: inv.role,
          scopeType: inv.scopeType,
          scopeId: inv.scopeId ?? null,
        },
      })
    }
    if (!inv.acceptedAt) {
      await this.prisma.invite.update({ where:{ id: inv.id }, data:{ acceptedAt: new Date() } })
    }
    this.logger.log(`Invite claimed by ${user.email} role=${inv.role} scope=${inv.scopeType}:${inv.scopeId ?? '-'}`)
    return { ok:true }
  }

  async requireValidInvite(token: string | undefined, email: string){
    if (!token) throw new BadRequestException('Invite required')
    const inv = await this.prisma.invite.findUnique({ where:{ token } })
    if (!inv || inv.expiresAt < new Date()) throw new BadRequestException('Invalid/expired invite')
    if (inv.acceptedAt) throw new BadRequestException('Invite already accepted')
    if (inv.email.toLowerCase() !== email.toLowerCase()) {
      throw new BadRequestException('Invite email does not match user')
    }
    return inv
  }

  async pendingForCommunity(communityId: string){
    const now = new Date()
    const invites = await this.prisma.invite.findMany({
      where:{
        scopeType:'COMMUNITY',
        scopeId: communityId,
        acceptedAt: null,
        expiresAt:{ gt: now },
      },
      select:{
        id:true,
        email:true,
        role:true,
        scopeType:true,
        scopeId:true,
        invitedBy:true,
        createdAt:true,
        expiresAt:true,
      },
      orderBy:{ createdAt:'desc' }
    })
    return invites
  }

  async deletePending(inviteId: string){
    const inv = await this.prisma.invite.findUnique({ where:{ id: inviteId } })
    if (!inv) throw new BadRequestException('Invite not found')
    if (inv.acceptedAt) throw new BadRequestException('Invite already accepted')
    await this.prisma.invite.delete({ where:{ id: inviteId } })
    return { ok:true }
  }

  async pendingForBe(beId: string){
    const now = new Date()
    return this.prisma.invite.findMany({
      where:{
        scopeType:'BILLING_ENTITY',
        scopeId: beId,
        acceptedAt: null,
        expiresAt:{ gt: now },
      },
      select:{
        id:true,
        email:true,
        role:true,
        scopeId:true,
        scopeType:true,
        invitedBy:true,
        createdAt:true,
        expiresAt:true
      },
      orderBy:{ createdAt:'desc' }
    })
  }
}
