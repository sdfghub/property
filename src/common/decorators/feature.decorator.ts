import { SetMetadata } from '@nestjs/common'
import type { FeatureKey } from '../../modules/features/features.service'

export const FEATURE_KEY = 'feature_flag'
export type FeatureSpec = { feature: FeatureKey; scopeParam?: string }

/** Gate a route/controller behind a per-community feature flag (default param: communityId). */
export const Feature = (feature: FeatureKey, scopeParam = 'communityId') =>
  SetMetadata(FEATURE_KEY, { feature, scopeParam } as FeatureSpec)
