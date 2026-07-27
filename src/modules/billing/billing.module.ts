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
import { MeasureModeService } from './measure-mode.service';
import { MeasureModeController } from './measure-mode.controller';
import { MeMeterService } from './me-meter.service';
import { MeMeterController } from './me-meter.controller';
import { CommunityDueController } from './community-due.controller';
import { UserDashboardController } from './user-dashboard.controller';
import { MePaymentController } from './me-payment.controller';
import { MemberAccessService } from './member-access.service';
import { MeReportsService } from './me-reports.service';
import { MeReportsController } from './me-reports.controller';
import { FinanceModule } from '../finance/finance.module';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [EngagementModule, FundModule, CommunityModule, FinanceModule, ReportsModule],
  controllers: [
    BillingBeController,
    CommunityBillingEntityController,
    TemplateController,
    ExpenseTypeController,
    VendorInvoiceController,
    PaymentController,
    PaymentAllocationController,
    MeasureModeController,
    MeMeterController,
    CommunityDueController,
    UserDashboardController,
    MePaymentController,
    MeReportsController,
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
    MeasureModeService,
    MeMeterService,
    MemberAccessService,
    MeReportsService,
    CashService,
    PrismaService,
  ],
  exports: [TemplateService, BillingPeriodLookupService, AllocationService, BeQueryService, MemberAccessService],
})
export class BillingModule {}
