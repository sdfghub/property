import { Module } from '@nestjs/common';
import { BillingBeController } from './billing-be.controller';
import { EngagementModule } from '../engagement/engagement.module';
import { FundModule } from '../fund/fund.module';
import { CommunityModule } from '../community/community.module';
import { BillingPeriodLookupService } from './period-lookup.service';
import { PrismaService } from '../user/prisma.service';
import { TemplateService } from './template.service';
import { AllocationService } from './allocation.service';
import { BeQueryService } from './be-query.service';
import { TemplateController } from './template.controller';
import { ExpenseTypeController } from './expense-type.controller';
import { ExpenseTypeService } from './expense-type.service';
import { CommunityBillingEntityController } from './community-be.controller';
import { VendorInvoiceService } from './vendor-invoice.service';
import { VendorInvoiceController } from './vendor-invoice.controller';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentAllocationService } from './payment-allocation.service';
import { PaymentAllocationController } from './payment-allocation.controller';
import { CommunityDueController } from './community-due.controller';
import { UserDashboardController } from './user-dashboard.controller';
import { MePaymentController } from './me-payment.controller';

@Module({
  imports: [EngagementModule, FundModule, CommunityModule],
  controllers: [
    BillingBeController,
    CommunityBillingEntityController,
    TemplateController,
    ExpenseTypeController,
    VendorInvoiceController,
    PaymentController,
    PaymentAllocationController,
    CommunityDueController,
    UserDashboardController,
    MePaymentController,
    CashController,
  ],
  providers: [
    TemplateService,
    ExpenseTypeService,
    BillingPeriodLookupService,
    AllocationService,
    BeQueryService,
    VendorInvoiceService,
    PaymentService,
    PaymentAllocationService,
    CashService,
    PrismaService,
  ],
  exports: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService],
})
export class BillingModule {}
