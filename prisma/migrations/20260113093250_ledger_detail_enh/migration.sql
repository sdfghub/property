DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'i'
      AND c.relname = 'be_ledger_entry_detail_community_id_period_id_billing_entity_id'
  ) THEN
    ALTER INDEX "be_ledger_entry_detail_community_id_period_id_billing_entity_id"
      RENAME TO "be_ledger_entry_detail_community_id_period_id_billing_entit_idx";
  END IF;
END $$;
