import { Body, Controller, Post, Req, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ScopesGuard } from '../../common/guards/scopes.guard'
import { PrismaService } from '../user/prisma.service'
import { PaymentService } from './payment.service'

@Controller('me/payments')
@UseGuards(JwtAuthGuard, ScopesGuard)
export class MePaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  @Post()
  async checkout(@Req() req: any, @Body() body: any) {
    const userId: string = req.user?.id ?? req.user?.sub
    type PaymentLine = { billingEntityId?: string; amount?: number; bucket?: string; unitId?: string }
    type AllocationSpec = { amount: number; bucket?: string; unitId?: string; billingEntityId?: string }

    const lines: PaymentLine[] | null = Array.isArray(body?.lines) ? body.lines : null
    if (!lines?.length) {
      throw new BadRequestException('lines are required')
    }

    const beIds = Array.from(
      new Set(lines.map((line) => line?.billingEntityId).filter((id): id is string => typeof id === 'string' && id.length > 0)),
    )
    if (!beIds.length) {
      throw new BadRequestException('billingEntityId is required for each line')
    }

    const beRoles = await this.prisma.billingEntityUserRole.findMany({
      where: { userId, billingEntityId: { in: beIds } },
      select: { billingEntityId: true, billingEntity: { select: { communityId: true } } },
    })
    const beMap = new Map(beRoles.map((role) => [role.billingEntityId, role.billingEntity?.communityId]))
    if (beMap.size !== beIds.length) {
      throw new ForbiddenException('User is not allowed to pay for one or more billing entities')
    }

    const byBe = new Map<string, { communityId: string; amount: number; allocationSpec: AllocationSpec[] }>()

    lines.forEach((line, idx: number) => {
      const billingEntityId = line?.billingEntityId
      const amount = Number(line?.amount ?? 0)
      if (!billingEntityId) {
        throw new BadRequestException(`lines[${idx}].billingEntityId is required`)
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(`lines[${idx}].amount must be positive`)
      }
      const communityId = beMap.get(billingEntityId)
      if (!communityId) {
        throw new ForbiddenException('User is not allowed to pay for one or more billing entities')
      }
      const entry = byBe.get(billingEntityId) ?? { communityId, amount: 0, allocationSpec: [] as AllocationSpec[] }
      entry.amount += amount
      entry.allocationSpec.push({
        amount,
        bucket: line?.bucket ?? undefined,
        unitId: line?.unitId ?? undefined,
        billingEntityId,
      })
      byBe.set(billingEntityId, entry)
    })

    const results = []
    for (const [billingEntityId, entry] of byBe.entries()) {
      const payload = {
        billingEntityId,
        amount: entry.amount,
        currency: body?.currency ?? 'RON',
        method: body?.method ?? null,
        applyMode: body?.applyMode,
        allocationSpec: entry.allocationSpec,
      }
      results.push(await this.payments.createOrApply(entry.communityId, payload))
    }

    return { payments: results }
  }
}
