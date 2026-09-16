import { Module } from '@nestjs/common'
import { PrismaService } from '../user/prisma.service'
import { BillingModule } from '../billing/billing.module'
import { FinanceModule } from '../finance/finance.module'
import { FeaturesModule } from '../features/features.module'
import { IntakeController } from './intake.controller'
import { IntakePromptService } from './intake-prompt.service'
import { IntakeImportService } from './intake-import.service'
import { IntakeApplyService } from './intake-apply.service'
import { IntakeService } from './intake.service'

// AI intake: prompt pack out → external agent → JSON in → review → apply through BillingModule's
// TemplateService / VendorInvoiceService. See docs/intake.md.
@Module({
  imports: [BillingModule, FinanceModule, FeaturesModule],
  controllers: [IntakeController],
  providers: [PrismaService, IntakePromptService, IntakeImportService, IntakeApplyService, IntakeService],
  exports: [IntakePromptService, IntakeImportService],
})
export class IntakeModule {}
