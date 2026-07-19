/* Add cart_discount_percent to quotations to match invoices. */
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS cart_discount_percent numeric NOT NULL DEFAULT 0;
