import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

type RoleAssignment = { role: string; scopeType: string; scopeId?: string | null }

type PollVoterScope = 'BE_RESPONSIBLES' | 'ALL_COMMUNITY_USERS'

type PollOptionInput = { text: string }

@Injectable()
export class EngagementService {
  constructor(private prisma: PrismaService) {}

  private buildDeepLink(path: string) {
    const base =
      process.env.APP_PUBLIC_URL ||
      process.env.FRONTEND_ORIGIN ||
      process.env.APP_ORIGIN ||
      process.env.APP_PUBLIC_BASE_URL
    if (!base) return path
    return `${base.replace(/\/$/, '')}${path}`
  }

  private isSystemAdmin(roles: RoleAssignment[]) {
    return roles.some((r) => r.role === 'SYSTEM_ADMIN' && r.scopeType === 'SYSTEM')
  }

  private isCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    return roles.some(
      (r) => r.role === 'COMMUNITY_ADMIN' && r.scopeType === 'COMMUNITY' && r.scopeId === communityId,
    )
  }

  private async isCommunityMember(userId: string, communityId: string) {
    const match = await this.prisma.billingEntityUserRole.findFirst({
      where: { userId, billingEntity: { communityId } },
      select: { id: true },
    })
    return !!match
  }

  private async ensureCommunityMember(userId: string, roles: RoleAssignment[], communityId: string) {
    if (this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)) return
    if (await this.isCommunityMember(userId, communityId)) return
    throw new ForbiddenException('Not a community member')
  }

  private async ensureCommunityAdmin(roles: RoleAssignment[], communityId: string) {
    if (this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)) return
    throw new ForbiddenException('Admin permissions required')
  }

  private parseDate(raw: any, field: string) {
    if (!raw) throw new BadRequestException(`${field} is required`)
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) throw new BadRequestException(`${field} must be a valid date`)
    return dt
  }

  private parseOptionalDate(raw: any, field: string) {
    if (raw == null) return undefined
    const dt = new Date(raw)
    if (Number.isNaN(dt.getTime())) throw new BadRequestException(`${field} must be a valid date`)
    return dt
  }

  private normalizeTitle(raw: any, field = 'title') {
    const value = String(raw ?? '').trim()
    if (!value) throw new BadRequestException(`${field} is required`)
    return value
  }

  private async listCommunityUserIds(communityId: string) {
    const [systemAdmins, communityAdmins, beUsers] = await Promise.all([
      this.prisma.roleAssignment.findMany({
        where: { role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM' },
        select: { userId: true },
      }),
      this.prisma.roleAssignment.findMany({
        where: { role: 'COMMUNITY_ADMIN', scopeType: 'COMMUNITY', scopeId: communityId },
        select: { userId: true },
      }),
      this.prisma.billingEntityUserRole.findMany({
        where: { billingEntity: { communityId } },
        select: { userId: true },
      }),
    ])

    const all = new Set<string>()
    systemAdmins.forEach((r) => all.add(r.userId))
    communityAdmins.forEach((r) => all.add(r.userId))
    beUsers.forEach((r) => all.add(r.userId))

    return {
      systemAdmins: systemAdmins.map((r) => r.userId),
      communityAdmins: communityAdmins.map((r) => r.userId),
      beUsers: beUsers.map((r) => r.userId),
      all: Array.from(all),
    }
  }

  private async resolvePollVoterIds(
    communityId: string,
    voterUserIds?: string[],
    voterScope?: PollVoterScope,
  ) {
    const communityUsers = await this.listCommunityUserIds(communityId)
    if (Array.isArray(voterUserIds) && voterUserIds.length > 0) {
      const requested = Array.from(new Set(voterUserIds.filter(Boolean)))
      const allowed = new Set(communityUsers.all)
      const invalid = requested.filter((id) => !allowed.has(id))
      if (invalid.length) {
        throw new BadRequestException(`Invalid voter ids: ${invalid.join(', ')}`)
      }
      return requested
    }

    if (voterScope === 'ALL_COMMUNITY_USERS') return communityUsers.all
    return communityUsers.beUsers
  }

  private buildEventResponse(communityId: string, event: any, rsvpStatus?: string | null) {
    return {
      ...event,
      rsvpStatus: rsvpStatus ?? null,
      deepLink: this.buildDeepLink(`/communities/${communityId}/events/${event.id}`),
    }
  }

  private buildPollResponse(communityId: string, poll: any, options: any[]) {
    return {
      ...poll,
      options,
      deepLink: this.buildDeepLink(`/communities/${communityId}/polls/${poll.id}`),
      resultsPublished: !!poll.publishedResultsAt,
    }
  }

  async listEvents(communityId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const events = await this.prisma.event.findMany({
      where: { communityId },
      orderBy: { startAt: 'asc' },
    })
    if (!events.length) return []
    const rsvps = await this.prisma.eventRsvp.findMany({
      where: { eventId: { in: events.map((e) => e.id) }, userId },
      select: { eventId: true, status: true },
    })
    const rsvpByEvent = new Map(rsvps.map((r) => [r.eventId, r.status]))
    return events.map((event) => this.buildEventResponse(communityId, event, rsvpByEvent.get(event.id) ?? null))
  }

  async getEvent(communityId: string, eventId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const event = await this.prisma.event.findFirst({ where: { id: eventId, communityId } })
    if (!event) throw new NotFoundException('Event not found')
    const rsvp = await this.prisma.eventRsvp.findUnique({
      where: { eventId_userId: { eventId: event.id, userId } },
      select: { status: true },
    })
    return this.buildEventResponse(communityId, event, rsvp?.status ?? null)
  }

  async setEventRsvp(communityId: string, eventId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const event = await this.prisma.event.findFirst({ where: { id: eventId, communityId } })
    if (!event) throw new NotFoundException('Event not found')
    const status = input?.status ? String(input.status).toUpperCase() : null
    if (!status) {
      await this.prisma.eventRsvp.deleteMany({ where: { eventId: event.id, userId } })
      return { ok: true }
    }
    if (status !== 'GOING' && status !== 'NOT_GOING') {
      throw new BadRequestException('Invalid RSVP status')
    }
    await this.prisma.eventRsvp.upsert({
      where: { eventId_userId: { eventId: event.id, userId } },
      create: { eventId: event.id, userId, status },
      update: { status },
    })
    return { ok: true }
  }

  async createEvent(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const title = this.normalizeTitle(input?.title)
    const description = input?.description ? String(input.description) : null
    const startAt = this.parseDate(input?.startAt, 'startAt')
    const endAt = this.parseDate(input?.endAt, 'endAt')
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt')

    const event = await this.prisma.event.create({
      data: {
        communityId,
        title,
        description,
        startAt,
        endAt,
        location: input?.location ? String(input.location) : null,
        attachments: input?.attachments ?? null,
        visibility: input?.visibility ? String(input.visibility) : 'COMMUNITY',
        createdByUserId: userId,
      },
    })
    return this.buildEventResponse(communityId, event)
  }

  async updateEvent(communityId: string, eventId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const event = await this.prisma.event.findFirst({ where: { id: eventId, communityId } })
    if (!event) throw new NotFoundException('Event not found')

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && event.createdByUserId !== userId) {
      throw new ForbiddenException('Not allowed to update this event')
    }

    const nextStartAt = this.parseOptionalDate(input?.startAt, 'startAt') ?? event.startAt
    const nextEndAt = this.parseOptionalDate(input?.endAt, 'endAt') ?? event.endAt
    if (nextEndAt <= nextStartAt) throw new BadRequestException('endAt must be after startAt')

    const updated = await this.prisma.event.update({
      where: { id: event.id },
      data: {
        title: input?.title ? this.normalizeTitle(input.title) : undefined,
        description: input?.description ? String(input.description) : undefined,
        startAt: nextStartAt,
        endAt: nextEndAt,
        location: input?.location ? String(input.location) : undefined,
        attachments: input?.attachments ?? undefined,
        visibility: input?.visibility ? String(input.visibility) : undefined,
      },
    })

    return this.buildEventResponse(communityId, updated)
  }

  async deleteEvent(communityId: string, eventId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const event = await this.prisma.event.findFirst({ where: { id: eventId, communityId } })
    if (!event) throw new NotFoundException('Event not found')

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && event.createdByUserId !== userId) {
      throw new ForbiddenException('Not allowed to delete this event')
    }

    await this.prisma.event.delete({ where: { id: event.id } })
    return { ok: true }
  }

  async listPolls(communityId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const polls = await this.prisma.poll.findMany({
      where: { communityId },
      include: { options: { orderBy: { order: 'asc' } } },
      orderBy: [{ status: 'asc' }, { startAt: 'asc' }],
    })

    if (!polls.length) return []

    const voted = await this.prisma.pollVote.findMany({
      where: { pollId: { in: polls.map((p) => p.id) }, userId },
      select: { pollId: true, pollOptionId: true },
    })
    const votesByPoll = new Map<string, string[]>()
    voted.forEach((v) => {
      const list = votesByPoll.get(v.pollId) ?? []
      list.push(v.pollOptionId)
      votesByPoll.set(v.pollId, list)
    })

    return polls.map((poll) => ({
      ...this.buildPollResponse(
        communityId,
        poll,
        poll.options.map((o: any) => ({ id: o.id, text: o.text, order: o.order })),
      ),
      userVoteOptionIds: votesByPoll.get(poll.id) ?? [],
      userVoted: (votesByPoll.get(poll.id) ?? []).length > 0,
    }))
  }

  async getPoll(communityId: string, pollId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, communityId },
      include: { options: { orderBy: { order: 'asc' } } },
    })
    if (!poll) throw new NotFoundException('Poll not found')

    const userVotes = await this.prisma.pollVote.findMany({
      where: { pollId: poll.id, userId },
      select: { pollOptionId: true },
    })
    const userVoteOptionIds = userVotes.map((v) => v.pollOptionId)

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    const includeResults = isAdmin || !!poll.publishedResultsAt

    if (!includeResults) {
      return {
        ...this.buildPollResponse(
          communityId,
          poll,
          poll.options.map((o: any) => ({ id: o.id, text: o.text, order: o.order })),
        ),
        userVoteOptionIds,
        userVoted: userVoteOptionIds.length > 0,
      }
    }

    const counts = await this.prisma.pollVote.groupBy({
      by: ['pollOptionId'],
      where: { pollId: poll.id },
      _count: { _all: true },
    })
    const countsByOption = new Map<string, number>()
    counts.forEach((c: any) => countsByOption.set(c.pollOptionId, c._count._all))

    const options = poll.options.map((o: any) => ({
      id: o.id,
      text: o.text,
      order: o.order,
      votes: countsByOption.get(o.id) ?? 0,
    }))

    return {
      ...this.buildPollResponse(communityId, poll, options),
      userVoteOptionIds,
      userVoted: userVoteOptionIds.length > 0,
    }
  }

  async createPoll(communityId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const title = this.normalizeTitle(input?.title)
    const description = input?.description ? String(input.description) : null
    const startAt = this.parseDate(input?.startAt, 'startAt')
    const endAt = this.parseDate(input?.endAt, 'endAt')
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt')

    const rawOptions = Array.isArray(input?.options) ? input.options : []
    if (rawOptions.length < 2) throw new BadRequestException('options must include at least 2 entries')

    const options: PollOptionInput[] = rawOptions.map((opt: any) => ({ text: String(opt?.text ?? opt).trim() }))
    const deduped = new Set(options.map((o) => o.text))
    if (deduped.size !== options.length) throw new BadRequestException('options must be unique')

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    const desiredStatus = isAdmin && input?.status === 'DRAFT' ? 'DRAFT' : isAdmin ? 'APPROVED' : 'PROPOSED'

    const voterUserIds = await this.resolvePollVoterIds(
      communityId,
      Array.isArray(input?.voterUserIds) ? input.voterUserIds : undefined,
      input?.voterScope === 'ALL_COMMUNITY_USERS' ? 'ALL_COMMUNITY_USERS' : 'BE_RESPONSIBLES',
    )
    if (voterUserIds.length === 0) throw new BadRequestException('No eligible voters found')

    const poll = await this.prisma.$transaction(async (tx) => {
      const created = await tx.poll.create({
        data: {
          communityId,
          title,
          description,
          status: desiredStatus,
          allowsMultiple: !!input?.allowsMultiple,
          anonymized: !!input?.anonymized,
          startAt,
          endAt,
          createdByUserId: userId,
          approvedByUserId: desiredStatus === 'APPROVED' ? userId : null,
          approvedAt: desiredStatus === 'APPROVED' ? new Date() : null,
        },
      })

      await tx.pollOption.createMany({
        data: options.map((o, idx) => ({ pollId: created.id, text: o.text, order: idx })),
      })

      await tx.pollVoter.createMany({
        data: voterUserIds.map((voterId) => ({ pollId: created.id, userId: voterId })),
        skipDuplicates: true,
      })

      return created
    })

    return this.getPoll(communityId, poll.id, userId, roles)
  }

  async updatePoll(communityId: string, pollId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, communityId },
      include: { options: { orderBy: { order: 'asc' } } },
    })
    if (!poll) throw new NotFoundException('Poll not found')

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    if (!isAdmin && poll.createdByUserId !== userId) {
      throw new ForbiddenException('Not allowed to update this poll')
    }

    if (poll.status === 'APPROVED' || poll.status === 'CLOSED') {
      throw new BadRequestException('Cannot update an approved or closed poll')
    }

    const nextStartAt = this.parseOptionalDate(input?.startAt, 'startAt') ?? poll.startAt
    const nextEndAt = this.parseOptionalDate(input?.endAt, 'endAt') ?? poll.endAt
    if (nextEndAt <= nextStartAt) throw new BadRequestException('endAt must be after startAt')

    const updates: any = {
      title: input?.title ? this.normalizeTitle(input.title) : undefined,
      description: input?.description ? String(input.description) : undefined,
      allowsMultiple: typeof input?.allowsMultiple === 'boolean' ? input.allowsMultiple : undefined,
      anonymized: typeof input?.anonymized === 'boolean' ? input.anonymized : undefined,
      startAt: nextStartAt,
      endAt: nextEndAt,
    }

    const optionsInput = Array.isArray(input?.options) ? input.options : null
    const voterUserIdsInput = Array.isArray(input?.voterUserIds) ? input.voterUserIds : null
    const voterScopeInput = input?.voterScope === 'ALL_COMMUNITY_USERS' ? 'ALL_COMMUNITY_USERS' : undefined

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedPoll = await tx.poll.update({ where: { id: poll.id }, data: updates })

      if (optionsInput) {
        if (optionsInput.length < 2) throw new BadRequestException('options must include at least 2 entries')
        const options = optionsInput.map((opt: any) => ({ text: String(opt?.text ?? opt).trim() }))
        const deduped = new Set(options.map((o: any) => o.text))
        if (deduped.size !== options.length) throw new BadRequestException('options must be unique')

        await tx.pollOption.deleteMany({ where: { pollId: poll.id } })
        await tx.pollOption.createMany({
          data: options.map((o: any, idx: number) => ({ pollId: poll.id, text: o.text, order: idx })),
        })
      }

      if (isAdmin && (voterUserIdsInput || voterScopeInput)) {
        const voterIds = await this.resolvePollVoterIds(communityId, voterUserIdsInput ?? undefined, voterScopeInput)
        if (voterIds.length === 0) throw new BadRequestException('No eligible voters found')
        await tx.pollVoter.deleteMany({ where: { pollId: poll.id } })
        await tx.pollVoter.createMany({
          data: voterIds.map((voterId) => ({ pollId: poll.id, userId: voterId })),
          skipDuplicates: true,
        })
      }

      return updatedPoll
    })

    return this.getPoll(communityId, updated.id, userId, roles)
  }

  async approvePoll(communityId: string, pollId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityAdmin(roles, communityId)
    const poll = await this.prisma.poll.findFirst({ where: { id: pollId, communityId } })
    if (!poll) throw new NotFoundException('Poll not found')
    if (poll.status !== 'PROPOSED' && poll.status !== 'DRAFT') {
      throw new BadRequestException('Poll is not awaiting approval')
    }

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: {
        status: 'APPROVED',
        approvedByUserId: userId,
        approvedAt: new Date(),
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionReason: null,
      },
    })

    return this.getPoll(communityId, poll.id, userId, roles)
  }

  async rejectPoll(
    communityId: string,
    pollId: string,
    userId: string,
    roles: RoleAssignment[],
    input: any,
  ) {
    await this.ensureCommunityAdmin(roles, communityId)
    const poll = await this.prisma.poll.findFirst({ where: { id: pollId, communityId } })
    if (!poll) throw new NotFoundException('Poll not found')
    if (poll.status !== 'PROPOSED') throw new BadRequestException('Poll is not awaiting approval')
    const reason = String(input?.reason ?? '').trim()
    if (!reason) throw new BadRequestException('reason is required')

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: {
        status: 'REJECTED',
        rejectedByUserId: userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    })

    return this.getPoll(communityId, poll.id, userId, roles)
  }

  async closePoll(communityId: string, pollId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityAdmin(roles, communityId)
    const poll = await this.prisma.poll.findFirst({ where: { id: pollId, communityId } })
    if (!poll) throw new NotFoundException('Poll not found')
    if (poll.status !== 'APPROVED') throw new BadRequestException('Poll is not active')

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    })

    return this.getPoll(communityId, poll.id, userId, roles)
  }

  async publishPollResults(communityId: string, pollId: string, userId: string, roles: RoleAssignment[]) {
    await this.ensureCommunityAdmin(roles, communityId)
    const poll = await this.prisma.poll.findFirst({ where: { id: pollId, communityId } })
    if (!poll) throw new NotFoundException('Poll not found')

    if (poll.status !== 'CLOSED' && poll.endAt.getTime() > Date.now()) {
      throw new BadRequestException('Poll must be closed or ended before publishing results')
    }

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: { publishedResultsAt: new Date() },
    })

    return this.getPoll(communityId, poll.id, userId, roles)
  }

  async votePoll(communityId: string, pollId: string, userId: string, roles: RoleAssignment[], input: any) {
    await this.ensureCommunityMember(userId, roles, communityId)
    const poll = await this.prisma.poll.findFirst({
      where: { id: pollId, communityId },
      include: { options: { orderBy: { order: 'asc' } } },
    })
    if (!poll) throw new NotFoundException('Poll not found')

    if (poll.status !== 'APPROVED') throw new BadRequestException('Poll is not open for voting')
    const now = Date.now()
    if (poll.startAt.getTime() > now || poll.endAt.getTime() < now) {
      throw new BadRequestException('Poll is not currently open for voting')
    }

    const isAdmin = this.isSystemAdmin(roles) || this.isCommunityAdmin(roles, communityId)
    if (!isAdmin) {
      const voter = await this.prisma.pollVoter.findUnique({
        where: { pollId_userId: { pollId: poll.id, userId } },
        select: { id: true },
      })
      if (!voter) throw new ForbiddenException('You are not eligible to vote in this poll')
    }

    const optionIds = Array.isArray(input?.optionIds)
      ? input.optionIds
      : input?.optionId
        ? [input.optionId]
        : []
    const uniqueOptionIds: string[] = Array.from(
      new Set(
        optionIds
          .map((id: any) => (typeof id === 'string' ? id : String(id ?? '').trim()))
          .filter((id: string) => id.length > 0),
      ),
    )
    if (uniqueOptionIds.length === 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.pollVote.deleteMany({ where: { pollId: poll.id, userId } })
      })
      return { ok: true }
    }
    if (!poll.allowsMultiple && uniqueOptionIds.length !== 1) {
      throw new BadRequestException('Poll allows a single selection')
    }

    const allowedOptionIds = new Set(poll.options.map((o: any) => o.id))
    const invalid = uniqueOptionIds.filter((id) => !allowedOptionIds.has(id))
    if (invalid.length) throw new BadRequestException(`Invalid optionIds: ${invalid.join(', ')}`)

    await this.prisma.$transaction(async (tx) => {
      await tx.pollVote.deleteMany({ where: { pollId: poll.id, userId } })
      await tx.pollVote.createMany({
        data: uniqueOptionIds.map((optionId) => ({ pollId: poll.id, pollOptionId: optionId, userId })),
      })
    })

    return { ok: true }
  }
}
