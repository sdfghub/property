import { Module } from '@nestjs/common';
import { BillingBeController } from './billing-be.controller';
import { BillingPeriodLookupService } from './period-lookup.service';
import { PrismaService } from '../user/prisma.service';
import { TemplateService } from './template.service';
import { AllocationService } from './allocation.service';
import { BeQueryService } from './be-query.service';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { TemplateController } from './template.controller';
import { CommunityBillingEntityController } from './community-be.controller';

@Module({
  controllers: [BillingBeController, CommunityBillingEntityController, ExpenseController, TemplateController],
  providers: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService, ExpenseService, PrismaService],
  exports: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService, ExpenseService],
})
export class BillingModule {}
