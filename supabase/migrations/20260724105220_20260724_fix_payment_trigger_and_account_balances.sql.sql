
-- ============================================================
-- Fix 1: update_customer_balance_after_payment trigger
-- Same bug as the invoice trigger: only counted invoices, wiping manual receivables
-- when a payment is received. Now includes manual receivable outstanding.
-- ============================================================
CREATE OR REPLACE FUNCTION update_customer_balance_after_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id uuid;
  v_invoice_balance numeric;
  v_manual_balance numeric;
BEGIN
  IF NEW.payment_type != 'received' OR NEW.reference_type != 'invoice' THEN
    RETURN NEW;
  END IF;

  SELECT customer_id INTO v_customer_id FROM invoices WHERE id = NEW.reference_id;
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Invoice outstanding
  SELECT COALESCE(SUM(balance_due), 0) INTO v_invoice_balance
  FROM invoices
  WHERE customer_id = v_customer_id
  AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue');

  -- Manual receivable outstanding (total debits minus payments + bad debt collected)
  SELECT COALESCE(SUM(je.total_debit), 0) - COALESCE((
    SELECT SUM(p.amount + COALESCE(p.bad_debt_amount, 0))
    FROM payments p
    WHERE p.reference_type = 'receivable'
    AND COALESCE(p.is_reversed, false) = false
    AND p.reference_id IN (
      SELECT id FROM journal_entries
      WHERE customer_id = v_customer_id
      AND reference_type = 'receivable'
      AND is_posted = true
    )
  ), 0) INTO v_manual_balance
  FROM journal_entries je
  WHERE je.customer_id = v_customer_id
  AND je.reference_type = 'receivable'
  AND je.is_posted = true;

  UPDATE customers
  SET outstanding_balance = GREATEST(0, v_invoice_balance + v_manual_balance),
      updated_at = now()
  WHERE id = v_customer_id;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Fix 2: Recalculate 1200 (Inventory) and 5000 (COGS) from journal lines
-- The DB balances are off by 666,296.94 due to historical double-posting
-- during migration fixes. Journal lines are the source of truth.
-- ============================================================
UPDATE accounts SET balance = (
  SELECT COALESCE(SUM(jl.debit - jl.credit), 0)
  FROM journal_lines jl WHERE jl.account_id = accounts.id
)
WHERE code IN ('1200', '5000');

-- ============================================================
-- Fix 3: Correct bank account flags
-- 1024 Cheque Receivable is an asset but NOT a bank account
-- ============================================================
UPDATE accounts SET is_bank = false WHERE code = '1024';

-- ============================================================
-- Fix 4: Recalculate ALL customer outstanding_balance again
-- (the old payment trigger may have wiped manual receivables for customers with payments)
-- ============================================================
UPDATE customers c
SET outstanding_balance = GREATEST(0, COALESCE(inv.outstanding, 0) + COALESCE(man.manual_out, 0)),
    updated_at = now()
FROM (
  SELECT customer_id, COALESCE(SUM(balance_due), 0) as outstanding
  FROM invoices WHERE status IN ('sent', 'partially_paid', 'unpaid', 'overdue') AND customer_id IS NOT NULL
  GROUP BY customer_id
) inv
FULL OUTER JOIN (
  SELECT je.customer_id,
    COALESCE(SUM(je.total_debit), 0) - COALESCE((
      SELECT SUM(p.amount + COALESCE(p.bad_debt_amount, 0))
      FROM payments p
      WHERE p.reference_type = 'receivable'
      AND COALESCE(p.is_reversed, false) = false
      AND p.reference_id IN (SELECT id FROM journal_entries je2 WHERE je2.customer_id = je.customer_id AND je2.reference_type = 'receivable' AND je2.is_posted = true)
    ), 0) as manual_out
  FROM journal_entries je
  WHERE je.reference_type = 'receivable' AND je.is_posted = true AND je.customer_id IS NOT NULL
  GROUP BY je.customer_id
) man ON inv.customer_id = man.customer_id
WHERE c.id = COALESCE(inv.customer_id, man.customer_id);

UPDATE customers SET outstanding_balance = 0, updated_at = now()
WHERE id NOT IN (
  SELECT customer_id FROM invoices WHERE customer_id IS NOT NULL AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
  UNION
  SELECT customer_id FROM journal_entries WHERE customer_id IS NOT NULL AND reference_type = 'receivable' AND is_posted = true
);
