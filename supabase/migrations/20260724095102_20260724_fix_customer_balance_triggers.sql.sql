
-- ============================================================
-- Fix 1: update_customer_outstanding_balance trigger
-- NOW includes manual receivable outstanding (journal_entries with reference_type='receivable'
-- minus payments collected against them)
-- ============================================================
CREATE OR REPLACE FUNCTION update_customer_outstanding_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id uuid;
  v_invoice_balance numeric;
  v_manual_balance numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_customer_id := OLD.customer_id;
  ELSE
    v_customer_id := NEW.customer_id;
  END IF;

  IF v_customer_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Invoice outstanding: sum of unpaid invoice balances
  SELECT COALESCE(SUM(balance_due), 0) INTO v_invoice_balance
  FROM invoices
  WHERE customer_id = v_customer_id
  AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue');

  -- Manual receivable outstanding: total debits minus payments + bad debt collected
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

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- Fix 2: sync_customer_total_purchases trigger
-- NOW includes manual receivable amounts (journal_entries with reference_type='receivable')
-- ============================================================
CREATE OR REPLACE FUNCTION sync_customer_total_purchases()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_customer_id uuid;
  v_invoice_total numeric;
  v_manual_total numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_customer_id := OLD.customer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
      SELECT COALESCE(SUM(total_amount), 0) INTO v_invoice_total
      FROM invoices WHERE customer_id = OLD.customer_id AND status <> 'cancelled';
      SELECT COALESCE(SUM(total_debit), 0) INTO v_manual_total
      FROM journal_entries WHERE customer_id = OLD.customer_id AND reference_type = 'receivable' AND is_posted = true;
      UPDATE customers SET total_purchases = GREATEST(0, v_invoice_total + v_manual_total), updated_at = now()
      WHERE id = OLD.customer_id;
    END IF;
    v_customer_id := NEW.customer_id;
  ELSE
    v_customer_id := NEW.customer_id;
  END IF;

  IF v_customer_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_invoice_total
  FROM invoices WHERE customer_id = v_customer_id AND status <> 'cancelled';
  SELECT COALESCE(SUM(total_debit), 0) INTO v_manual_total
  FROM journal_entries WHERE customer_id = v_customer_id AND reference_type = 'receivable' AND is_posted = true;

  UPDATE customers
  SET total_purchases = GREATEST(0, v_invoice_total + v_manual_total), updated_at = now()
  WHERE id = v_customer_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ============================================================
-- Fix 3: Correct account balances that the broken RPC failed to update
-- Account 1300 (Manual Receivable): should be 31333 (31323 old + 10 new entry)
-- Account 3900 (Opening Balance Equity): should be -10 (credit of 10)
-- ============================================================
UPDATE accounts SET balance = 31333 WHERE code = '1300';
UPDATE accounts SET balance = -10 WHERE code = '3900';

-- ============================================================
-- Fix 4: Recalculate ALL customer outstanding_balance and total_purchases
-- using the new formulas (invoice + manual receivable)
-- ============================================================
UPDATE customers c
SET outstanding_balance = GREATEST(0, COALESCE(inv.outstanding, 0) + COALESCE(man.manual_out, 0)),
    total_purchases = GREATEST(0, COALESCE(inv.total, 0) + COALESCE(man.total, 0)),
    updated_at = now()
FROM (
  SELECT customer_id, COALESCE(SUM(balance_due), 0) as outstanding, COALESCE(SUM(total_amount), 0) as total
  FROM invoices WHERE status <> 'cancelled' AND customer_id IS NOT NULL
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
    ), 0) as manual_out,
    COALESCE(SUM(je.total_debit), 0) as total
  FROM journal_entries je
  WHERE je.reference_type = 'receivable' AND je.is_posted = true AND je.customer_id IS NOT NULL
  GROUP BY je.customer_id
) man ON inv.customer_id = man.customer_id
WHERE c.id = COALESCE(inv.customer_id, man.customer_id);

-- Also update customers with no invoices and no manual receivables (set to 0)
UPDATE customers SET outstanding_balance = 0, updated_at = now()
WHERE id NOT IN (
  SELECT customer_id FROM invoices WHERE customer_id IS NOT NULL AND status <> 'cancelled'
  UNION
  SELECT customer_id FROM journal_entries WHERE customer_id IS NOT NULL AND reference_type = 'receivable' AND is_posted = true
);
