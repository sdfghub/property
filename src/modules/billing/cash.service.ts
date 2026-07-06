import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureCommunityId(ref: string) {
    const c = await this.prisma.community.findFirst({ where: { OR: [{ id: ref }, { code: ref }] }, select: { id: true } })
    if (!c) throw new NotFoundException('Community not found')
    return c.id
  }

  async listAccounts(communityRef: string) {
    const communityId = await this.ensureCommunityId(communityRef)
    return this.prisma.cashAccount.findMany({
      where: { communityId },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    })
  }

  async createAccount(communityRef: string, body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    if (!body.code || !body.name) throw new BadRequestException('code and name are required')
    const type = body.type || 'BANK'
    return this.prisma.cashAccount.create({
      data: {
        communityId,
        code: body.code,
        name: body.name,
        type,
        currency: body.currency || 'RON',
        status: body.status || 'ACTIVE',
        notes: body.notes ?? null,
      },
    })
  }

  async listTx(communityRef: string, query: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    const where: any = { communityId }
    if (query?.accountId) where.accountId = query.accountId
    if (query?.fundId) where.fundId = query.fundId
    if (query?.from || query?.to) {
      where.ts = {}
      if (query.from) where.ts.gte = new Date(query.from)
      if (query.to) where.ts.lte = new Date(query.to)
    }
    return this.prisma.cashTx.findMany({
      where,
      orderBy: { ts: 'desc' },
    })
  }

  async createTx(communityRef: string, body: any) {
    const communityId = await this.ensureCommunityId(communityRef)
    if (!body.accountId) throw new BadRequestException('accountId is required')
    const account = await this.prisma.cashAccount.findFirst({ where: { id: body.accountId, communityId } })
    if (!account) throw new NotFoundException('Cash account not found')
    if (!body.fundId) throw new BadRequestException('fundId is required')
    const fund = await this.prisma.fund.findFirst({ where: { id: body.fundId, communityId }, select: { id: true } })
    if (!fund) throw new NotFoundException('Fund not found')
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be positive')
    if (!body.direction) throw new BadRequestException('direction is required')
    const kind = body.kind || 'OTHER'
    return this.prisma.cashTx.create({
      data: {
        communityId,
        accountId: body.accountId,
        fundId: fund.id,
        ts: body.ts ? new Date(body.ts) : undefined,
        amount,
        currency: body.currency || account.currency || 'RON',
        direction: body.direction,
        kind,
        status: body.status || 'POSTED',
        refType: body.refType ?? null,
        refId: body.refId ?? null,
        memo: body.memo ?? null,
        meta: body.meta ?? null,
      },
    })
  }
}
