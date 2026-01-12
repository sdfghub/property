import { Injectable, UnauthorizedException, Logger, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../user/prisma.service'
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { InviteService } from '../invite/invite.service'

type RoleAssignment={ role:string; scopeType:string; scopeId?:string|null }

const scryptAsync = promisify(scrypt)

function sha256(raw: string){ return createHash('sha256').update(raw).digest('hex') }
function normalizeEmail(email: string){ return email.trim().toLowerCase() }

async function hashPassword(password: string){
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

async function verifyPassword(password: string, stored: string){
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const expected = Buffer.from(parts[2], 'hex')
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer
  return timingSafeEqual(expected, derived)
}

@Injectable()
export class AuthService{
  private readonly logger = new Logger(AuthService.name)
  constructor(
    private readonly prisma:PrismaService,
    private readonly jwt:JwtService,
    private readonly invites: InviteService,
  ){}

  async registerWithPassword(email: string, password: string, name?: string, inviteToken?: string){
    const normalized = normalizeEmail(email)
    const existing = await this.prisma.user.findUnique({ where:{ email: normalized } })
    if (existing?.passwordHash) throw new BadRequestException('Account already exists')
    const passwordHash = await hashPassword(password)
    if (existing) {
      return this.prisma.user.update({
        where:{ id: existing.id },
        data:{ passwordHash, name: name ?? existing.name },
      })
    }
    await this.invites.requireValidInvite(inviteToken, normalized)
    return this.prisma.user.create({ data:{ email: normalized, name: name ?? null, passwordHash } })
  }

  async loginWithPassword(email: string, password: string){
    const normalized = normalizeEmail(email)
    const user = await this.prisma.user.findUnique({ where:{ email: normalized } })
    if (!user?.passwordHash) {
      this.logger.warn(`loginWithPassword missing hash email=${normalized} user=${user?.id ?? 'none'}`)
      throw new UnauthorizedException('Invalid credentials')
    }
    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) {
      this.logger.warn(`loginWithPassword invalid password email=${normalized} user=${user.id}`)
      throw new UnauthorizedException('Invalid credentials')
    }
    this.logger.log(`loginWithPassword success email=${normalized} user=${user.id}`)
    return user
  }

  async loginWithOAuth(provider: 'GOOGLE'|'APPLE'|'FACEBOOK'|'MICROSOFT', providerUserId: string, email?: string, name?: string, inviteToken?: string){
    const existing = await this.prisma.userOAuthAccount.findUnique({
      where:{ provider_providerUserId:{ provider, providerUserId } },
      include:{ user:true },
    })
    if (existing?.user) return existing.user

    const normalized = email ? normalizeEmail(email) : undefined
    const user = normalized
      ? await this.prisma.user.findUnique({ where:{ email: normalized } })
      : null

    if (!user) {
      if (!normalized) throw new BadRequestException('Invite required')
      await this.invites.requireValidInvite(inviteToken, normalized)
    }

    const ensured = user ?? await this.prisma.user.create({
      data:{ email: normalized ?? `${providerUserId}@${provider.toLowerCase()}.local`, name: name ?? null },
    })

    await this.prisma.userOAuthAccount.create({
      data:{
        userId: ensured.id,
        provider,
        providerUserId,
        email: normalized ?? null,
      },
    })
    return ensured
  }

  async refresh(refreshToken:string){
    const secret=process.env.JWT_REFRESH_SECRET||'dev_refresh_secret'
    let decoded:any; try{ decoded=await this.jwt.verifyAsync(refreshToken,{secret}) }catch{ throw new UnauthorizedException('Invalid refresh token') }
    const rec = await this.prisma.refreshToken.findUnique({ where:{ jti: decoded.jti } })
    if (!rec || rec.expiresAt == null || rec.expiresAt?.getTime() < Date.now()) throw new UnauthorizedException('Refresh revoked/expired')
    if (!rec || rec.tokenHash !== sha256(refreshToken)) throw new UnauthorizedException('Token mismatch')

    const user = await this.prisma.user.findUnique({ where:{ id: decoded.sub } })
    if(!user) throw new UnauthorizedException('User not found')

    const roles = await this.prisma.roleAssignment.findMany({
      where: { userId: user.id, role: { in: ['SYSTEM_ADMIN', 'COMMUNITY_ADMIN'] } },
    })
    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId: user.id },
      select: { billingEntityId: true },
    })
    const beRoleIds = Array.from(new Set(beRoles.map((r) => r.billingEntityId)))
    const mergedRoles = [
      ...roles.map((r) => ({ role: r.role, scopeType: r.scopeType, scopeId: r.scopeId })),
      ...beRoleIds.map((id) => ({ role: 'BILLING_ENTITY_USER', scopeType: 'BILLING_ENTITY', scopeId: id })),
    ]
    const payload = {
      sub: user.id,
      email: user.email,
      roles: mergedRoles,
      token_version: user.tokenVersion,
    }
    const accessToken=await this.jwt.signAsync(payload)
    this.logger.log(`Access token refreshed for user ${user.id}`)
    return { accessToken }
  }

  async logout(currentRefreshToken?:string){
    if(!currentRefreshToken) return { ok:true }
    const secret=process.env.JWT_REFRESH_SECRET||'dev_refresh_secret'
    try {
      const decoded:any = await this.jwt.verifyAsync(currentRefreshToken,{secret})
      await this.prisma.refreshToken.update({ where:{ jti: decoded.jti }, data:{ revokedAt: new Date() } })
      this.logger.log(`Refresh token revoked jti=${decoded.jti}`)
    } catch { /* ignore */ }
    return { ok:true }
  }

  async revokeAllSessions(userId:string){
    // bump token_version → invalidate all access tokens immediately
    await this.prisma.user.update({ where:{ id:userId }, data:{ tokenVersion: { increment: 1 } } })
    // revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({ where:{ userId: userId, revokedAt: null }, data:{ revokedAt: new Date() } })
    this.logger.warn(`All sessions revoked for user ${userId}`)
    return { ok:true }
  }

  async issueTokensForUser(user: { id: string; email: string; tokenVersion?: number }, userAgent?: string, ip?: string) {
    const roles = await this.prisma.roleAssignment.findMany({
      where: { userId: user.id, role: { in: ['SYSTEM_ADMIN', 'COMMUNITY_ADMIN'] } },
    })
    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId: user.id },
      select: { billingEntityId: true },
    })
    const beRoleIds = Array.from(new Set(beRoles.map((r) => r.billingEntityId)))
    const mergedRoles = [
      ...roles.map((r) => ({ role: r.role, scopeType: r.scopeType, scopeId: r.scopeId })),
      ...beRoleIds.map((id) => ({ role: 'BILLING_ENTITY_USER', scopeType: 'BILLING_ENTITY', scopeId: id })),
    ]
    const payload = {
      sub: user.id,
      email: user.email,
      roles: mergedRoles.map((r) => r as RoleAssignment),
      token_version: user.tokenVersion,
    }
    const accessToken = await this.jwt.signAsync(payload)

    const jti = randomBytes(16).toString('hex')
    const refreshSecret = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret'
    const refreshTtl = process.env.JWT_REFRESH_TTL || '30d'
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'refresh', jti },
      { secret: refreshSecret, expiresIn: refreshTtl },
    )

    const decoded: any = await this.jwt.verifyAsync(refreshToken, { secret: refreshSecret })
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        jti,
      tokenHash: sha256(refreshToken),
      userAgent: userAgent || null,
      ip: ip || null,
      expiresAt: new Date(decoded.exp * 1000),
    },
    })

    this.logger.log(`Tokens issued for ${user.email} roles=${roles.map(r=>`${r.role}@${r.scopeType}:${r.scopeId??'-'}`).join(',')}`)
    return { accessToken, refreshToken, user: { id: user.id, email: user.email } }
  }
}
