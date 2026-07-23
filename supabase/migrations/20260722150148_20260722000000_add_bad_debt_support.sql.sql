/*
# Add Bad Debt Support for Payment Collection

## Purpose
When a customer pays less than their outstanding balance and refuses to pay the remainder,
the unpaid portion is written off as "bad debt". This migration adds the columns needed
to track bad debt amounts on payments and invoices.

## Changes

### 1. payments table — new column
- `bad_debt_amount` (numeric, default 0): The portion of an outstanding balance that was
  written off as bad debt at the time of this payment. For example, if a customer owed
  ৳100 and paid ৳90, the bad_debt_amount would be ৳10. After processing, the invoice's
  outstanding balance becomes ৳0.

### 2. invoices table — new column
- `bad_debt_amount` (numeric, default 0): The cumulative bad debt written off against this
  invoice. This lets reports show how much of an invoice's balance was uncollectible.

### 3. Bad Debt Expense account
The account with code `5600` ("Bad Debt Expense") already exists in the chart of accounts
as an expense-type account. No new account needs to be created — the frontend will look up
this account by code `5600` when posting bad-debt journal entries.

## Security
No new tables are created. Existing RLS policies on `payments` and `invoices` remain
unchanged and continue to govern access to the new columns.
*/

-- Add bad_debt_amount to payments table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'bad_debt_amount'
  ) THEN
    ALTER TABLE payments ADD COLUMN bad_debt_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Add bad_debt_amount to invoices table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'bad_debt_amount'
  ) THEN
    ALTER TABLE invoices ADD COLUMN bad_debt_amount numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
