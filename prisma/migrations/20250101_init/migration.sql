-- CreateEnum
CREATE TYPE "SeriesScope" AS ENUM ('UNIT', 'GROUP', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "SeriesOrigin" AS ENUM ('METER', 'DECLARATION', 'ADMIN', 'DERIVED');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('EQUAL', 'BY_SQM', 'BY_RESIDENTS', 'BY_CONSUMPTION', 'MIXED');

-- CreateEnum
CREATE TYPE "ExpenseTargetType" AS ENUM ('COMMUNITY', 'GROUP', 'EXPLICIT_SET', 'UNIT');

-- CreateEnum
CREATE TYPE "DocSource" AS ENUM ('MANUAL', 'OCR', 'IMPORT', 'API');

-- CreateEnum
CREATE TYPE "SplitMethod" AS ENUM ('EQUAL', 'DAYS', 'WEIGHTED_MANUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('COMMUNITY', 'PERIOD', 'UNIT', 'GROUP', 'BILLING_ENTITY', 'SERIES', 'EXPENSE', 'EXPENSE_TYPE', 'VENDOR', 'VENDOR_INVOICE', 'RULE', 'MEASURE_TYPE');

-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('COMMUNITY', 'GROUP', 'UNIT', 'SET');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('DRAFT', 'OPEN', 'PREPARED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'COMMUNITY_ADMIN', 'CENSOR', 'BILLING_ENTITY_USER');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('SYSTEM', 'COMMUNITY', 'BILLING_ENTITY');

-- CreateTable
CREATE TABLE "community" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',

    CONSTRAINT "community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "seq" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Bucharest',
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "prepared_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_group" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "unit_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_group_member" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "start_period_id" TEXT NOT NULL,
    "end_period_id" TEXT,
    "start_seq" INTEGER NOT NULL,
    "end_seq" INTEGER,

    CONSTRAINT "unit_group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_entity" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,

    CONSTRAINT "billing_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_entity_member" (
    "id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "start_period_id" TEXT NOT NULL,
    "end_period_id" TEXT,
    "start_seq" INTEGER NOT NULL,
    "end_seq" INTEGER,

    CONSTRAINT "billing_entity_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure_type" (
    "code" TEXT NOT NULL,
    "name" TEXT,
    "unit" TEXT NOT NULL,

    CONSTRAINT "measure_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "measure_series" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "scope" "SeriesScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "origin" "SeriesOrigin" NOT NULL,

    CONSTRAINT "measure_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure_sample" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "measure_sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measure_period_value" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "start_period_id" TEXT NOT NULL,
    "end_period_id" TEXT,
    "start_seq" INTEGER NOT NULL,
    "end_seq" INTEGER,
    "value" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "measure_period_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_measure" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "meter_id" TEXT NOT NULL,
    "scope_type" "SeriesScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "origin" "SeriesOrigin" NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "provenance" JSONB,

    CONSTRAINT "period_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rule" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "method" "AllocationMethod" NOT NULL,
    "name" TEXT,
    "params" JSONB,

    CONSTRAINT "allocation_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_vector" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "scope_type" "ExpenseTargetType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "expense_id" TEXT,

    CONSTRAINT "weight_vector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_item" (
    "id" TEXT NOT NULL,
    "vector_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "raw_value" DECIMAL(18,6) NOT NULL,
    "weight" DECIMAL(18,12) NOT NULL,

    CONSTRAINT "weight_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_type" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "params" JSONB,
    "currency" TEXT,

    CONSTRAINT "expense_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "allocatable_amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "target_type" "ExpenseTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "expense_type_id" TEXT,
    "invoice_id" TEXT,
    "invoice_line_key" TEXT,
    "weight_vector_id" TEXT,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_log" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_target_set" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "expense_target_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_target_member" (
    "id" TEXT NOT NULL,
    "set_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,

    CONSTRAINT "expense_target_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_line" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "expense_split_id" TEXT,
    "split_node_id" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "allocation_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "split_group" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER,

    CONSTRAINT "split_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "split_group_member" (
    "id" TEXT NOT NULL,
    "split_group_id" TEXT NOT NULL,
    "split_node_id" TEXT NOT NULL,

    CONSTRAINT "split_group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bucket_rule" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "program_code" TEXT,
    "expense_type_codes" JSONB,
    "split_group_codes" JSONB,
    "split_node_ids" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bucket_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "total_target" DECIMAL(18,2),
    "start_period_code" TEXT,
    "target_plan" JSONB,
    "targets" JSONB,
    "default_bucket" TEXT,
    "allocation" JSONB,

    CONSTRAINT "program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aggregation_rule" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "unit_types" JSONB NOT NULL,
    "residual_type" TEXT,
    "total_type" TEXT,

    CONSTRAINT "aggregation_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_meter_rule" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "scope_type" "SeriesScope" NOT NULL DEFAULT 'COMMUNITY',
    "source_type" TEXT NOT NULL,
    "subtract_types" JSONB NOT NULL,
    "target_type" TEXT NOT NULL,
    "origin" "SeriesOrigin" NOT NULL DEFAULT 'DERIVED',

    CONSTRAINT "derived_meter_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_split" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "parent_split_id" TEXT,
    "share" DECIMAL(18,6),
    "amount" DECIMAL(18,4) NOT NULL,
    "basis_type" TEXT,
    "basis_code" TEXT,
    "meta" JSONB,

    CONSTRAINT "expense_split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter" (
    "meter_id" TEXT NOT NULL,
    "name" TEXT,
    "scope_type" TEXT NOT NULL,
    "scope_code" TEXT NOT NULL,
    "type_code" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'METER',
    "installed_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "multiplier" DECIMAL(18,6),
    "notes" TEXT,

    CONSTRAINT "meter_pkey" PRIMARY KEY ("meter_id")
);

-- CreateTable
CREATE TABLE "bill" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "total_amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_line" (
    "id" TEXT NOT NULL,
    "bill_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "bill_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "iban" TEXT,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoice" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "number" TEXT,
    "issue_date" TIMESTAMP(3),
    "service_start_period_id" TEXT,
    "service_end_period_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "net" DECIMAL(18,4),
    "vat" DECIMAL(18,4),
    "gross" DECIMAL(18,4),
    "source" "DocSource" NOT NULL DEFAULT 'MANUAL',
    "hash" TEXT,
    "provenance" JSONB,

    CONSTRAINT "vendor_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_invoice_doc" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT,
    "bytes" INTEGER,
    "sha256" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "DocSource" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "vendor_invoice_doc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_split" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "method" "SplitMethod" NOT NULL,
    "share" DECIMAL(18,8) NOT NULL,
    "allocatable" DECIMAL(18,4) NOT NULL,
    "provenance" JSONB,

    CONSTRAINT "invoice_split_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_invoice" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "portion_key" TEXT,
    "amount" DECIMAL(18,4),
    "notes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_template" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER,
    "start_period_code" TEXT,
    "end_period_code" TEXT,
    "template" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_template_instance" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_template_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_entry_template" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER,
    "start_period_code" TEXT,
    "end_period_code" TEXT,
    "template" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meter_entry_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_entry_template_instance" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meter_entry_template_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_attachment" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "template_code" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT,
    "size" INTEGER,
    "data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_ref" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "source_system" TEXT NOT NULL,
    "legacy_id" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMP(3),

    CONSTRAINT "external_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "be_opening_balance" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "be_opening_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "be_ledger_entry_detail" (
    "id" TEXT NOT NULL,
    "ledger_entry_id" TEXT NOT NULL,
    "unit_id" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "be_ledger_entry_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "be_ledger_entry" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "running_due" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "bucket" TEXT NOT NULL DEFAULT 'ALLOCATED_EXPENSE',
    "ref_type" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "be_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "ref_id" TEXT,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_application" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "charge_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "be_statement" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "billing_entity_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "due_start" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "charges" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "payments" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "adjustments" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "due_end" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "be_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "user_id" TEXT,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" TEXT,
    "invited_by" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_token" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,

    CONSTRAINT "login_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_community_id_start_date_end_date_idx" ON "period"("community_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "period_community_id_code_key" ON "period"("community_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "period_community_id_seq_key" ON "period"("community_id", "seq");

-- CreateIndex
CREATE INDEX "unit_community_id_idx" ON "unit"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_code_community_id_key" ON "unit"("code", "community_id");

-- CreateIndex
CREATE INDEX "unit_group_community_id_idx" ON "unit_group"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_group_code_community_id_key" ON "unit_group"("code", "community_id");

-- CreateIndex
CREATE INDEX "unit_group_member_group_id_start_seq_end_seq_idx" ON "unit_group_member"("group_id", "start_seq", "end_seq");

-- CreateIndex
CREATE INDEX "unit_group_member_unit_id_start_seq_end_seq_idx" ON "unit_group_member"("unit_id", "start_seq", "end_seq");

-- CreateIndex
CREATE INDEX "billing_entity_community_id_idx" ON "billing_entity"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_entity_code_community_id_key" ON "billing_entity"("code", "community_id");

-- CreateIndex
CREATE INDEX "billing_entity_member_billing_entity_id_start_seq_end_seq_idx" ON "billing_entity_member"("billing_entity_id", "start_seq", "end_seq");

-- CreateIndex
CREATE INDEX "billing_entity_member_unit_id_start_seq_end_seq_idx" ON "billing_entity_member"("unit_id", "start_seq", "end_seq");

-- CreateIndex
CREATE INDEX "measure_series_community_id_scope_scope_id_type_code_idx" ON "measure_series"("community_id", "scope", "scope_id", "type_code");

-- CreateIndex
CREATE INDEX "measure_sample_series_id_ts_idx" ON "measure_sample"("series_id", "ts");

-- CreateIndex
CREATE INDEX "measure_period_value_series_id_start_seq_end_seq_idx" ON "measure_period_value"("series_id", "start_seq", "end_seq");

-- CreateIndex
CREATE INDEX "period_measure_meter_id_idx" ON "period_measure"("meter_id");

-- CreateIndex
CREATE INDEX "period_measure_period_id_type_code_idx" ON "period_measure"("period_id", "type_code");

-- CreateIndex
CREATE UNIQUE INDEX "period_measure_community_id_period_id_scope_type_scope_id_t_key" ON "period_measure"("community_id", "period_id", "scope_type", "scope_id", "type_code");

-- CreateIndex
CREATE UNIQUE INDEX "weight_vector_expense_id_key" ON "weight_vector"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "weight_vector_community_id_period_id_rule_id_scope_type_sco_key" ON "weight_vector"("community_id", "period_id", "rule_id", "scope_type", "scope_id", "expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "weight_item_vector_id_unit_id_key" ON "weight_item"("vector_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_type_code_community_id_key" ON "expense_type"("code", "community_id");

-- CreateIndex
CREATE INDEX "expense_community_id_period_id_idx" ON "expense"("community_id", "period_id");

-- CreateIndex
CREATE INDEX "expense_target_type_target_id_idx" ON "expense"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "allocation_log_expense_id_idx" ON "allocation_log"("expense_id");

-- CreateIndex
CREATE INDEX "expense_target_set_community_id_idx" ON "expense_target_set"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_target_member_set_id_unit_id_key" ON "expense_target_member"("set_id", "unit_id");

-- CreateIndex
CREATE INDEX "allocation_line_community_id_period_id_idx" ON "allocation_line"("community_id", "period_id");

-- CreateIndex
CREATE INDEX "allocation_line_expense_id_idx" ON "allocation_line"("expense_id");

-- CreateIndex
CREATE INDEX "allocation_line_unit_id_period_id_idx" ON "allocation_line"("unit_id", "period_id");

-- CreateIndex
CREATE INDEX "allocation_line_split_node_id_idx" ON "allocation_line"("split_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_line_expense_id_unit_id_expense_split_id_key" ON "allocation_line"("expense_id", "unit_id", "expense_split_id");

-- CreateIndex
CREATE INDEX "split_group_community_id_idx" ON "split_group"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "split_group_community_id_code_key" ON "split_group"("community_id", "code");

-- CreateIndex
CREATE INDEX "split_group_member_split_node_id_idx" ON "split_group_member"("split_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "split_group_member_split_group_id_split_node_id_key" ON "split_group_member"("split_group_id", "split_node_id");

-- CreateIndex
CREATE INDEX "bucket_rule_community_id_idx" ON "bucket_rule"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "bucket_rule_community_id_code_key" ON "bucket_rule"("community_id", "code");

-- CreateIndex
CREATE INDEX "program_community_id_idx" ON "program"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_community_id_code_key" ON "program"("community_id", "code");

-- CreateIndex
CREATE INDEX "aggregation_rule_community_id_idx" ON "aggregation_rule"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "aggregation_rule_community_id_target_type_key" ON "aggregation_rule"("community_id", "target_type");

-- CreateIndex
CREATE INDEX "derived_meter_rule_community_id_idx" ON "derived_meter_rule"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "derived_meter_rule_community_id_scope_type_source_type_targ_key" ON "derived_meter_rule"("community_id", "scope_type", "source_type", "target_type");

-- CreateIndex
CREATE INDEX "expense_split_expense_id_idx" ON "expense_split"("expense_id");

-- CreateIndex
CREATE INDEX "expense_split_parent_split_id_idx" ON "expense_split"("parent_split_id");

-- CreateIndex
CREATE INDEX "meter_scope_code_idx" ON "meter"("scope_code");

-- CreateIndex
CREATE INDEX "meter_type_code_idx" ON "meter"("type_code");

-- CreateIndex
CREATE UNIQUE INDEX "bill_community_id_period_id_billing_entity_id_key" ON "bill"("community_id", "period_id", "billing_entity_id");

-- CreateIndex
CREATE INDEX "bill_line_bill_id_idx" ON "bill_line"("bill_id");

-- CreateIndex
CREATE INDEX "bill_line_expense_id_idx" ON "bill_line"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_community_id_name_key" ON "vendor"("community_id", "name");

-- CreateIndex
CREATE INDEX "vendor_invoice_community_id_number_idx" ON "vendor_invoice"("community_id", "number");

-- CreateIndex
CREATE INDEX "invoice_split_period_id_idx" ON "invoice_split"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_split_invoice_id_period_id_key" ON "invoice_split"("invoice_id", "period_id");

-- CreateIndex
CREATE INDEX "program_invoice_invoice_id_idx" ON "program_invoice"("invoice_id");

-- CreateIndex
CREATE INDEX "program_invoice_program_id_idx" ON "program_invoice"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_invoice_program_id_invoice_id_portion_key_key" ON "program_invoice"("program_id", "invoice_id", "portion_key");

-- CreateIndex
CREATE INDEX "bill_template_community_id_idx" ON "bill_template"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_template_community_id_code_key" ON "bill_template"("community_id", "code");

-- CreateIndex
CREATE INDEX "bill_template_instance_period_id_idx" ON "bill_template_instance"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_template_instance_community_id_period_id_template_id_key" ON "bill_template_instance"("community_id", "period_id", "template_id");

-- CreateIndex
CREATE INDEX "meter_entry_template_community_id_idx" ON "meter_entry_template"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "meter_entry_template_community_id_code_key" ON "meter_entry_template"("community_id", "code");

-- CreateIndex
CREATE INDEX "meter_entry_template_instance_period_id_idx" ON "meter_entry_template_instance"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "meter_entry_template_instance_community_id_period_id_templa_key" ON "meter_entry_template_instance"("community_id", "period_id", "template_id");

-- CreateIndex
CREATE INDEX "template_attachment_community_id_period_id_template_type_te_idx" ON "template_attachment"("community_id", "period_id", "template_type", "template_code");

-- CreateIndex
CREATE INDEX "external_ref_entity_type_entity_id_idx" ON "external_ref"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_ref_community_id_source_system_legacy_id_key" ON "external_ref"("community_id", "source_system", "legacy_id");

-- CreateIndex
CREATE UNIQUE INDEX "be_opening_balance_community_id_period_id_billing_entity_id_key" ON "be_opening_balance"("community_id", "period_id", "billing_entity_id");

-- CreateIndex
CREATE INDEX "be_ledger_entry_detail_ledger_entry_id_idx" ON "be_ledger_entry_detail"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "be_ledger_entry_detail_unit_id_idx" ON "be_ledger_entry_detail"("unit_id");

-- CreateIndex
CREATE INDEX "be_ledger_entry_community_id_period_id_billing_entity_id_idx" ON "be_ledger_entry"("community_id", "period_id", "billing_entity_id");

-- CreateIndex
CREATE INDEX "be_ledger_entry_community_id_bucket_idx" ON "be_ledger_entry"("community_id", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "be_ledger_entry_community_id_period_id_billing_entity_id_re_key" ON "be_ledger_entry"("community_id", "period_id", "billing_entity_id", "ref_type", "ref_id", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "payment_ref_id_key" ON "payment"("ref_id");

-- CreateIndex
CREATE INDEX "payment_community_id_billing_entity_id_idx" ON "payment"("community_id", "billing_entity_id");

-- CreateIndex
CREATE INDEX "payment_application_charge_id_idx" ON "payment_application"("charge_id");

-- CreateIndex
CREATE INDEX "payment_application_payment_id_idx" ON "payment_application"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "be_statement_community_id_period_id_billing_entity_id_key" ON "be_statement"("community_id", "period_id", "billing_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignment_user_id_role_scope_type_scopeId_key" ON "role_assignment"("user_id", "role", "scope_type", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "invite_token_key" ON "invite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "login_token_token_key" ON "login_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_jti_key" ON "refresh_token"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_group" ADD CONSTRAINT "unit_group_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_group_member" ADD CONSTRAINT "unit_group_member_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "unit_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_group_member" ADD CONSTRAINT "unit_group_member_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_entity" ADD CONSTRAINT "billing_entity_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_entity_member" ADD CONSTRAINT "billing_entity_member_billing_entity_id_fkey" FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_entity_member" ADD CONSTRAINT "billing_entity_member_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_series" ADD CONSTRAINT "measure_series_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_series" ADD CONSTRAINT "measure_series_type_code_fkey" FOREIGN KEY ("type_code") REFERENCES "measure_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_sample" ADD CONSTRAINT "measure_sample_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "measure_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measure_period_value" ADD CONSTRAINT "measure_period_value_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "measure_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_measure" ADD CONSTRAINT "period_measure_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_measure" ADD CONSTRAINT "period_measure_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule" ADD CONSTRAINT "allocation_rule_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_vector" ADD CONSTRAINT "weight_vector_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_vector" ADD CONSTRAINT "weight_vector_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_vector" ADD CONSTRAINT "weight_vector_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_vector" ADD CONSTRAINT "weight_vector_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "allocation_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_item" ADD CONSTRAINT "weight_item_vector_id_fkey" FOREIGN KEY ("vector_id") REFERENCES "weight_vector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weight_item" ADD CONSTRAINT "weight_item_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_type" ADD CONSTRAINT "expense_type_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_type" ADD CONSTRAINT "expense_type_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "allocation_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_expense_type_id_fkey" FOREIGN KEY ("expense_type_id") REFERENCES "expense_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_log" ADD CONSTRAINT "allocation_log_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_log" ADD CONSTRAINT "allocation_log_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_log" ADD CONSTRAINT "allocation_log_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_target_set" ADD CONSTRAINT "expense_target_set_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_target_member" ADD CONSTRAINT "expense_target_member_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "expense_target_set"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_target_member" ADD CONSTRAINT "expense_target_member_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_line" ADD CONSTRAINT "allocation_line_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_line" ADD CONSTRAINT "allocation_line_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_line" ADD CONSTRAINT "allocation_line_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_line" ADD CONSTRAINT "allocation_line_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_line" ADD CONSTRAINT "allocation_line_expense_split_id_fkey" FOREIGN KEY ("expense_split_id") REFERENCES "expense_split"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_group" ADD CONSTRAINT "split_group_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "split_group_member" ADD CONSTRAINT "split_group_member_split_group_id_fkey" FOREIGN KEY ("split_group_id") REFERENCES "split_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bucket_rule" ADD CONSTRAINT "bucket_rule_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aggregation_rule" ADD CONSTRAINT "aggregation_rule_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derived_meter_rule" ADD CONSTRAINT "derived_meter_rule_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_split" ADD CONSTRAINT "expense_split_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_split" ADD CONSTRAINT "expense_split_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_split" ADD CONSTRAINT "expense_split_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_split" ADD CONSTRAINT "expense_split_parent_split_id_fkey" FOREIGN KEY ("parent_split_id") REFERENCES "expense_split"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill" ADD CONSTRAINT "bill_billing_entity_id_fkey" FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_line" ADD CONSTRAINT "bill_line_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice_doc" ADD CONSTRAINT "vendor_invoice_doc_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_split" ADD CONSTRAINT "invoice_split_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_split" ADD CONSTRAINT "invoice_split_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_invoice" ADD CONSTRAINT "program_invoice_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_invoice" ADD CONSTRAINT "program_invoice_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_template" ADD CONSTRAINT "bill_template_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_template_instance" ADD CONSTRAINT "bill_template_instance_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_template_instance" ADD CONSTRAINT "bill_template_instance_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_template_instance" ADD CONSTRAINT "bill_template_instance_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "bill_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_entry_template" ADD CONSTRAINT "meter_entry_template_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_entry_template_instance" ADD CONSTRAINT "meter_entry_template_instance_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_entry_template_instance" ADD CONSTRAINT "meter_entry_template_instance_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_entry_template_instance" ADD CONSTRAINT "meter_entry_template_instance_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "meter_entry_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_ref" ADD CONSTRAINT "external_ref_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "be_ledger_entry_detail" ADD CONSTRAINT "be_ledger_entry_detail_ledger_entry_id_fkey" FOREIGN KEY ("ledger_entry_id") REFERENCES "be_ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "be_ledger_entry_detail" ADD CONSTRAINT "be_ledger_entry_detail_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_billing_entity_id_fkey" FOREIGN KEY ("billing_entity_id") REFERENCES "billing_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_application" ADD CONSTRAINT "payment_application_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_application" ADD CONSTRAINT "payment_application_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "be_ledger_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite" ADD CONSTRAINT "invite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_token" ADD CONSTRAINT "login_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

