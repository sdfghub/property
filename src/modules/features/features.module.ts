import { Global, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { FeaturesController } from './features.controller'
import { FeaturesService } from './features.service'
import { FeatureGuard } from '../../common/guards/feature.guard'
import { PrismaService } from '../user/prisma.service'

// Global so FeatureGuard (registered app-wide) can inject FeaturesService.
// FeatureGuard only acts on routes carrying @Feature metadata; all others pass through.
@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeaturesService, PrismaService, { provide: APP_GUARD, useClass: FeatureGuard }],
  exports: [FeaturesService],
})
export class FeaturesModule {}
