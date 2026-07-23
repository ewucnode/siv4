/*
# Fix Bad Debt Accounting: Generated Column + Trigger Enhancement

## Problem
1. `invoices.balance_due` is a generated column `(total_amount - amount_paid)` — it does NOT
   subtract `bad_debt_amount`. When an invoice with ৳8 total has ৳7 paid + ৳1 bad debt, the
   balance_due still shows ৳1 instead of ৳0, causing the outstanding balance to appear wrong
   in multiple places (customer profile, CRM list, accounting receivables).

2. The `payment_accounting_trigger` only creates a Cash→AR journal entry for the payment
   amount. It does NOT create the Bad Debt Expense → AR journal entry when a payment has
   `bad_debt_amount > 0`. This means bad debt write-offs were never posted to the ledger.

## Changes

### 1. Fix balance_due generated column
Drop and recreate the generated column to subtract bad_debt_amount:
`(total_amount - amount_paid - bad_debt_amount)`

This is safe because the column is generated (computed), not stored user data. Dropping and
recreating it simply changes the formula — no data is lost.

### 2. Update payment_accounting_trigger
Add logic after the existing Cash→AR journal entry: if `NEW.bad_debt_amount > 0`, post an
additional journal entry: Dr. Bad Debt Expense (5600) / Cr. Accounts Receivable (1100).
This ensures every payment with bad debt automatically gets proper double-entry accounting.

### 3. Recalculate customer outstanding balances
After fixing the generated column, recalculate all customers' outstanding_balance from
their invoices' corrected balance_due values, since some customers may have stale balances
from the old formula.

## Security
No new tables or columns. No RLS policy changes.
*/

-- 1. Fix the balance_due generated column to subtract bad_debt_amount
ALTER TABLE invoices DROP COLUMN IF EXISTS balance_due;
ALTER TABLE invoices ADD COLUMN balance_due numeric GENERATED ALWAYS AS (total_amount - amount_paid - bad_debt_amount) STORED;

-- 2. Update payment_accounting_trigger to handle bad debt
CREATE OR REPLACE FUNCTION public.payment_accounting_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_ar_account uuid;
  v_cash_account uuid;
  v_payment_account uuid;
  v_bad_debt_account uuid;
  v_invoice_record RECORD;
  v_amount numeric;
  v_bad_debt numeric;
BEGIN
  -- Only process received payments (customer payments)
  IF NEW.payment_type != 'received' THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_bad_debt := COALESCE(NEW.bad_debt_amount, 0);

  -- If neither amount nor bad_debt, skip
  IF v_amount <= 0 AND v_bad_debt <= 0 THEN
    RETURN NEW;
  END IF;

  -- Get AR account
  SELECT id INTO v_ar_account FROM accounts WHERE code = '1100' LIMIT 1;
  IF v_ar_account IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get Bad Debt Expense account
  SELECT id INTO v_bad_debt_account FROM accounts WHERE code = '5600' LIMIT 1;

  -- Determine which cash/bank account to debit
  SELECT pm.account_id INTO v_payment_account
  FROM payment_methods pm
  WHERE pm.code = NEW.payment_method AND pm.is_active = true
  LIMIT 1;

  IF v_payment_account IS NULL THEN
    SELECT id INTO v_cash_account FROM accounts WHERE code = '1001' LIMIT 1;
  ELSE
    v_cash_account := v_payment_account;
  END IF;

  -- Get invoice info for reference
  IF NEW.reference_type = 'invoice' AND NEW.reference_id IS NOT NULL THEN
    SELECT * INTO v_invoice_record FROM invoices WHERE id = NEW.reference_id;
  END IF;

  -- Post payment: Debit Cash/Bank, Credit AR
  IF v_amount > 0 THEN
    IF v_cash_account IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM post_journal_entry(
      'Payment Received - ' || COALESCE(NEW.payment_number, NEW.reference_type || ' payment'),
      COALESCE(NEW.payment_date, CURRENT_DATE),
      'payment',
      NEW.id,
      json_build_array(
        json_build_object('account_id', v_cash_account, 'debit', v_amount, 'credit', 0, 'description', 'Cash received for ' || COALESCE(v_invoice_record.invoice_number, NEW.reference_type)),
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_amount, 'description', 'AR cleared for ' || COALESCE(v_invoice_record.invoice_number, NEW.reference_type))
      )::json,
      v_invoice_record.customer_id
    );
  END IF;

  -- Post bad debt: Debit Bad Debt Expense, Credit AR
  IF v_bad_debt > 0 AND v_bad_debt_account IS NOT NULL THEN
    PERFORM post_journal_entry(
      'Bad Debt Write-off - ' || COALESCE(NEW.payment_number, NEW.reference_type || ' payment'),
      COALESCE(NEW.payment_date, CURRENT_DATE),
      'payment',
      NEW.id,
      json_build_array(
        json_build_object('account_id', v_bad_debt_account, 'debit', v_bad_debt, 'credit', 0, 'description', 'Bad debt write-off for ' || COALESCE(v_invoice_record.invoice_number, NEW.reference_type)),
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_bad_debt, 'description', 'AR cleared (bad debt) for ' || COALESCE(v_invoice_record.invoice_number, NEW.reference_type))
      )::json,
      v_invoice_record.customer_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Recalculate all customer outstanding balances from corrected balance_due
UPDATE customers c
SET outstanding_balance = subq.total_outstanding,
    updated_at = now()
FROM (
  SELECT customer_id, COALESCE(SUM(balance_due), 0) AS total_outstanding
  FROM invoices
  WHERE status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
  GROUP BY customer_id
) subq
WHERE c.id = subq.customer_id;

-- Also reset outstanding_balance to 0 for customers with no unpaid invoices
UPDATE customers c
SET outstanding_balance = 0, updated_at = now()
WHERE c.id NOT IN (
  SELECT DISTINCT customer_id FROM invoices
  WHERE status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
  AND customer_id IS NOT NULL
);
