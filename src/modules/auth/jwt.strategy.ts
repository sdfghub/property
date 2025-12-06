import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy){
  constructor(private readonly prisma:PrismaService){
    super({ jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration:false, secretOrKey:process.env.JWT_ACCESS_SECRET||'dev_access_secret' })
  }
  async validate(payload:any){
    // Attach live token_version for instant revocation on user
    const user = await this.prisma.user.findUnique({ where:{ id: payload.sub }, select:{ tokenVersion:true } })
    if(!user) throw new UnauthorizedException('User not found')
    if (typeof payload.token_version === 'number' && payload.token_version !== user.tokenVersion) {
      throw new UnauthorizedException('Token version mismatch')
    }
    return { ...payload, token_version: user.tokenVersion }
  }
}
