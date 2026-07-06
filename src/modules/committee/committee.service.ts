import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

@Injectable()
export class CommitteeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Number of committee members (EXECUTIVE_COMITEE_MEMBER) assigned to the community. */
  private async memberCount(communityId: string) {
    return this.prisma.roleAssignment.count({
      where: { role: 'EXECUTIVE_COMITEE_MEMBER' as any, scopeType: 'COMMUNITY' as any, scopeId: communityId },
    })
  }

  async createDecision(communityId: string, userId: string, body: any) {
    const title = String(body?.title ?? '').trim()
    if (!title) throw new BadRequestException('title is required')
    const amount = body?.amount != null && body.amount !== '' ? Number(body.amount) : null
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new BadRequestException('amount must be >= 0')
    return this.prisma.committeeDecision.create({
      data: {
        communityId,
        title,
        description: body?.description ? String(body.description) : null,
        amount,
        currency: body?.currency || 'RON',
        createdBy: userId,
      },
    })
  }

  async listDecisions(communityId: string, userId: string) {
    const [decisions, members] = await Promise.all([
      this.prisma.committeeDecision.findMany({
        where: { communityId },
        orderBy: { createdAt: 'desc' },
        include: { votes: { select: { userId: true, vote: true, comment: true } } },
      }),
      this.memberCount(communityId),
    ])
    return {
      memberCount: members,
      majorityNeeded: Math.floor(members / 2) + 1,
      decisions: decisions.map((d) => {
        const approve = d.votes.filter((v) => v.vote === 'APPROVE').length
        const reject = d.votes.filter((v) => v.vote === 'REJECT').length
        const mine = d.votes.find((v) => v.userId === userId)
        return {
          id: d.id,
          title: d.title,
          description: d.description,
          amount: d.amount,
          currency: d.currency,
          status: d.status,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
          decidedAt: d.decidedAt,
          approveCount: approve,
          rejectCount: reject,
          myVote: mine?.vote ?? null,
        }
      }),
    }
  }

  async vote(communityId: string, decisionId: string, userId: string, value: 'APPROVE' | 'REJECT', comment?: string) {
    const v = String(value).toUpperCase()
    if (v !== 'APPROVE' && v !== 'REJECT') throw new BadRequestException('vote must be APPROVE or REJECT')
    const decision = await this.prisma.committeeDecision.findFirst({ where: { id: decisionId, communityId } })
    if (!decision) throw new NotFoundException('Decision not found')
    if (decision.status !== 'OPEN') throw new ForbiddenException('Decision is already closed')
    // Only actual committee members may vote (the guard's SYSTEM_ADMIN bypass is coarse).
    const isMember = await this.prisma.roleAssignment.findFirst({
      where: { userId, role: 'EXECUTIVE_COMITEE_MEMBER' as any, scopeType: 'COMMUNITY' as any, scopeId: communityId },
      select: { id: true },
    })
    if (!isMember) throw new ForbiddenException('Only committee members can vote')

    await this.prisma.committeeVote.upsert({
      where: { decisionId_userId: { decisionId, userId } },
      update: { vote: v as any, comment: comment ?? null },
      create: { decisionId, userId, vote: v as any, comment: comment ?? null },
    })

    // Recompute status against a majority of the current committee.
    const [approve, reject, members] = await Promise.all([
      this.prisma.committeeVote.count({ where: { decisionId, vote: 'APPROVE' as any } }),
      this.prisma.committeeVote.count({ where: { decisionId, vote: 'REJECT' as any } }),
      this.memberCount(communityId),
    ])
    let status: 'OPEN' | 'APPROVED' | 'REJECTED' = 'OPEN'
    if (members > 0 && approve * 2 > members) status = 'APPROVED'
    else if (members > 0 && reject * 2 > members) status = 'REJECTED'
    if (status !== 'OPEN') {
      await this.prisma.committeeDecision.update({
        where: { id: decisionId },
        data: { status: status as any, decidedAt: new Date() },
      })
    }
    return { decisionId, status, approveCount: approve, rejectCount: reject, memberCount: members }
  }

  async cancel(communityId: string, decisionId: string) {
    const decision = await this.prisma.committeeDecision.findFirst({ where: { id: decisionId, communityId } })
    if (!decision) throw new NotFoundException('Decision not found')
    if (decision.status !== 'OPEN') throw new ForbiddenException('Only open decisions can be cancelled')
    return this.prisma.committeeDecision.update({ where: { id: decisionId }, data: { status: 'CANCELLED' as any } })
  }
}
