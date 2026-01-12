-- CreateTable
CREATE TABLE "allocation_trace" (
    "id" TEXT NOT NULL,
    "allocation_line_id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "expense_split_id" TEXT,
    "split_node_id" TEXT,
    "trace" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_trace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allocation_trace_allocation_line_id_key" ON "allocation_trace"("allocation_line_id");

-- CreateIndex
CREATE INDEX "allocation_trace_community_id_period_id_idx" ON "allocation_trace"("community_id", "period_id");

-- CreateIndex
CREATE INDEX "allocation_trace_expense_id_idx" ON "allocation_trace"("expense_id");

-- CreateIndex
CREATE INDEX "allocation_trace_unit_id_period_id_idx" ON "allocation_trace"("unit_id", "period_id");

-- CreateIndex
CREATE INDEX "allocation_trace_split_node_id_idx" ON "allocation_trace"("split_node_id");

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_allocation_line_id_fkey" FOREIGN KEY ("allocation_line_id") REFERENCES "allocation_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_trace" ADD CONSTRAINT "allocation_trace_expense_split_id_fkey" FOREIGN KEY ("expense_split_id") REFERENCES "expense_split"("id") ON DELETE SET NULL ON UPDATE CASCADE;
