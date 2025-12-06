import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
@Injectable()
export class UserService{
  constructor(private readonly prisma:PrismaService){}
  getByEmail(email:string){ return this.prisma.user.findUnique({ where:{email} }) }
}
