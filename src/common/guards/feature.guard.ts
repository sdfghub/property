import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { FEATURE_KEY, FeatureSpec } from '../decorators/feature.decorator'
import { FeaturesService } from '../../modules/features/features.service'

/**
 * Denies a route when its @Feature flag is disabled for the community in the route params.
 * Routes without @Feature metadata are allowed.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly features: FeaturesService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<FeatureSpec | undefined>(FEATURE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!spec) return true
    const req = ctx.switchToHttp().getRequest()
    const communityId = req?.params?.[spec.scopeParam ?? 'communityId']
    if (!communityId) return true // can't resolve scope → don't block
    const enabled = await this.features.isEnabled(communityId, spec.feature)
    if (!enabled) throw new ForbiddenException(`Feature disabled: ${spec.feature}`)
    return true
  }
}
