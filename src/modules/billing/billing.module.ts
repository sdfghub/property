import { Module } from '@nestjs/common';
import { BillingBeController } from './billing-be.controller';
import { EngagementModule } from '../engagement/engagement.module';
import { ProgramModule } from '../program/program.module';
import { CommunityModule } from '../community/community.module';
import { BillingPeriodLookupService } from './period-lookup.service';
import { PrismaService } from '../user/prisma.service';
import { TemplateService } from './template.service';
import { AllocationService } from './allocation.service';
import { BeQueryService } from './be-query.service';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { TemplateController } from './template.controller';
import { CommunityBillingEntityController } from './community-be.controller';
import { VendorInvoiceService } from './vendor-invoice.service';
import { VendorInvoiceController } from './vendor-invoice.controller';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { CommunityDueController } from './community-due.controller';
import { UserDashboardController } from './user-dashboard.controller';
import { MePaymentController } from './me-payment.controller';

@Module({
  imports: [EngagementModule, ProgramModule, CommunityModule],
  controllers: [BillingBeController, CommunityBillingEntityController, ExpenseController, TemplateController, VendorInvoiceController, PaymentController, CommunityDueController, UserDashboardController, MePaymentController],
  providers: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService, ExpenseService, VendorInvoiceService, PaymentService, PrismaService],
  exports: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService, ExpenseService],
})
export class BillingModule {}
