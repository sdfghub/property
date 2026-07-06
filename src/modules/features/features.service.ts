import { Injectable } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'

/** Per-community feature flags. Unset flags fall back to these defaults. */
export const FEATURE_DEFAULTS = {
  cenzor: true,
  committee: false,
  funds: true,
  penalties: true,
  meters: true,
  announcements: true,
  polls: true,
  events: true,
  inventory: true,
  notifications: true,
  tickets: true,
} as const

export type FeatureKey = keyof typeof FEATURE_DEFAULTS
export const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS) as FeatureKey[]

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolved flags for a community (stored values merged over defaults). communityId = id or code. */
  async getFeatures(communityId: string): Promise<Record<FeatureKey, boolean>> {
    const c = await this.prisma.community.findFirst({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      select: { features: true },
    })
    const stored = (c?.features as Record<string, boolean>) || {}
    const out = { ...FEATURE_DEFAULTS } as Record<FeatureKey, boolean>
    for (const k of FEATURE_KEYS) if (typeof stored[k] === 'boolean') out[k] = stored[k]
    return out
  }

  async isEnabled(communityId: string, key: FeatureKey): Promise<boolean> {
    const f = await this.getFeatures(communityId)
    return f[key] !== false
  }

  /** Set flags (system admin). Only known keys with boolean values are accepted. */
  async setFeatures(communityId: string, patch: Record<string, any>): Promise<Record<FeatureKey, boolean>> {
    const current = await this.getFeatures(communityId)
    const next = { ...current }
    for (const k of FEATURE_KEYS) if (typeof patch?.[k] === 'boolean') next[k] = patch[k]
    await this.prisma.community.updateMany({
      where: { OR: [{ id: communityId }, { code: communityId }] },
      data: { features: next as any },
    })
    return next
  }
}
