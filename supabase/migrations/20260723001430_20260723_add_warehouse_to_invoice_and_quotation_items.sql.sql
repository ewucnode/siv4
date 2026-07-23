/*
# Add warehouse_id to invoice_items and quotation_items

1. Purpose
   When selling through invoices, POS, or quotations, users need to select
   which warehouse a product is sold from. This migration adds a nullable
   `warehouse_id` column to both `invoice_items` and `quotation_items` so
   each line item can record its source warehouse.

2. Changes
   - `invoice_items`: add column `warehouse_id` (uuid, nullable, references warehouses)
   - `quotation_items`: add column `warehouse_id` (uuid, nullable, references warehouses)

3. Security
   - No RLS policy changes needed; existing policies on parent tables still apply.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_items' AND column_name = 'warehouse_id'
  ) THEN
    ALTER TABLE invoice_items ADD COLUMN warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quotation_items' AND column_name = 'warehouse_id'
  ) THEN
    ALTER TABLE quotation_items ADD COLUMN warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;
  END IF;
END $$;
