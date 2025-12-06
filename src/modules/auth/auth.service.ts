import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../user/prisma.service'
import { randomBytes, createHash } from 'crypto'
import { MailService } from '../mail/mail.service'

type RoleAssignment={ role:string; scopeType:string; scopeId?:string|null }

function sha256(raw: string){ return createHash('sha256').update(raw).digest('hex') }

@Injectable()
export class AuthService{
  constructor(private readonly prisma:PrismaService, private readonly jwt:JwtService, private readonly mail: MailService){}

  async requestMagicLink(email:string){
    const token=randomBytes(24).toString('hex')
    const expiresAt=new Date(Date.now()+15*60*1000)
    await this.prisma.loginToken.create({data:{email,token,expiresAt:expiresAt}})
    const urlBase=process.env.APP_PUBLIC_URL||'http://localhost:3000'
    const link=`${urlBase}/magic?token=${token}`
    await this.mail.send(email, 'Your sign-in link', `<p>Click to sign in: <a href="${link}">${link}</a></p>`)
    return {ok:true}
  }

  async consumeMagicToken(token:string, userAgent?:string, ip?:string){
    const rec=await this.prisma.loginToken.findUnique({where:{token}})
    if(!rec || rec.usedAt || rec.expiresAt == null || rec.expiresAt?.getTime() < Date.now()) throw new UnauthorizedException('Invalid/expired token')

    const user=await this.prisma.user.upsert({ where:{email:rec.email}, update:{}, create:{email:rec.email} })
    await this.prisma.loginToken.update({where:{id:rec.id}, data:{usedAt:new Date()} })

    const roles=await this.prisma.roleAssignment.findMany({ where:{userId:user.id} })
    const payload={ sub:user.id, email:user.email, roles:roles.map(r=>({role:r.role, scopeType:r.scopeType, scopeId:r.scopeId} as RoleAssignment)), token_version: user.tokenVersion   }
    const accessToken=await this.jwt.signAsync(payload)

    // issue refresh token (with jti)
    const jti = randomBytes(16).toString('hex')
    const refreshSecret=process.env.JWT_REFRESH_SECRET||'dev_refresh_secret'
    const refreshTtl=process.env.JWT_REFRESH_TTL||'30d'
    const refreshToken=await this.jwt.signAsync({ sub:user.id, typ:'refresh', jti }, { secret:refreshSecret, expiresIn:refreshTtl })

    // store hashed refresh token
    const decoded:any = await this.jwt.verifyAsync(refreshToken, { secret: refreshSecret })
    await this.prisma.refreshToken.create({
      data:{
        userId: user.id,
        jti,
        tokenHash: sha256(refreshToken),
        userAgent: userAgent || null,
        ip: ip || null,
        expiresAt: new Date(decoded.exp * 1000)
      }
    })

    return { accessToken, refreshToken, user:{id:user.id,email:user.email} }
  }

  async refresh(refreshToken:string){
    const secret=process.env.JWT_REFRESH_SECRET||'dev_refresh_secret'
    let decoded:any; try{ decoded=await this.jwt.verifyAsync(refreshToken,{secret}) }catch{ throw new UnauthorizedException('Invalid refresh token') }
    const rec = await this.prisma.refreshToken.findUnique({ where:{ jti: decoded.jti } })
    if (!rec || rec.expiresAt == null || rec.expiresAt?.getTime() < Date.now()) throw new UnauthorizedException('Refresh revoked/expired')
    if (!rec || rec.tokenHash !== sha256(refreshToken)) throw new UnauthorizedException('Token mismatch')

    const user = await this.prisma.user.findUnique({ where:{ id: decoded.sub } })
    if(!user) throw new UnauthorizedException('User not found')

    const roles=await this.prisma.roleAssignment.findMany({ where:{userId:user.id} })
    const payload={ sub:user.id, email:user.email, roles:roles.map(r=>({role:r.role, scopeType:r.scopeType, scopeId:r.scopeId})), token_version: user.tokenVersion }
    const accessToken=await this.jwt.signAsync(payload)
    return { accessToken }
  }

  async logout(currentRefreshToken?:string){
    if(!currentRefreshToken) return { ok:true }
    const secret=process.env.JWT_REFRESH_SECRET||'dev_refresh_secret'
    try {
      const decoded:any = await this.jwt.verifyAsync(currentRefreshToken,{secret})
      await this.prisma.refreshToken.update({ where:{ jti: decoded.jti }, data:{ revokedAt: new Date() } })
    } catch { /* ignore */ }
    return { ok:true }
  }

  async revokeAllSessions(userId:string){
    // bump token_version → invalidate all access tokens immediately
    await this.prisma.user.update({ where:{ id:userId }, data:{ tokenVersion: { increment: 1 } } })
    // revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({ where:{ userId: userId, revokedAt: null }, data:{ revokedAt: new Date() } })
    return { ok:true }
  }
}
