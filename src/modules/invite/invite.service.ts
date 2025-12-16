import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { randomBytes } from 'crypto'
import { MailService } from '../mail/mail.service'
import { AuthService } from '../auth/auth.service'

@Injectable()
export class InviteService{
  private readonly logger = new Logger(InviteService.name)
  constructor(
    private readonly prisma:PrismaService,
    private readonly mail: MailService,
    private readonly auth: AuthService
  ){}
  async createInvite(email:string, role:'COMMUNITY_ADMIN'|'BILLING_ENTITY_USER'|'SYSTEM_ADMIN', scopeType:'SYSTEM'|'COMMUNITY'|'BILLING_ENTITY', scopeId?:string, invitedBy?:string){
    const token=randomBytes(24).toString('hex')
    const expiresAt=new Date(Date.now()+7*24*3600*1000)
    const inv=await this.prisma.invite.create({ data:{ email, role, scopeType:scopeType, scopeId:scopeId??null, invitedBy:invitedBy??'', token, expiresAt:expiresAt } })
    const base=process.env.APP_PUBLIC_URL||'http://localhost:3000'
    const link=`${base}/invite?token=${token}`
    await this.mail.send(email, 'You are invited', `<p>You were invited as <b>${role}</b>. Accept: <a href="${link}">${link}</a></p>`)
    this.logger.log(`Invite created for ${email} role=${role} scope=${scopeType}:${scopeId ?? '-'}`)
    return inv
  }
  async acceptInvite(token:string, name?:string, userAgent?:string, ip?:string){
    const inv=await this.prisma.invite.findUnique({ where:{token} })
    if(!inv||inv.acceptedAt||inv.expiresAt<new Date()) throw new BadRequestException('Invalid/expired invite')
    const user=await this.prisma.user.upsert({ where:{email:inv.email}, update:{ name:name??undefined }, create:{ email:inv.email, name } })

  // find existing assignment (null-safe)
  const existing = await this.prisma.roleAssignment.findFirst({
    where: {
      userId: user.id,
      role: inv.role,
      scopeType: inv.scopeType,
      scopeId: inv.scopeId ?? null, // works with nullable fields
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
    await this.prisma.invite.update({ where:{id:inv.id}, data:{acceptedAt:new Date()} })

    const tokens = await this.auth.issueTokensForUser(user, userAgent, ip)
    this.logger.log(`Invite accepted for ${user.email} role=${inv.role} scope=${inv.scopeType}:${inv.scopeId ?? '-'}`)
    return { ok:true, userId:user.id, ...tokens }
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
