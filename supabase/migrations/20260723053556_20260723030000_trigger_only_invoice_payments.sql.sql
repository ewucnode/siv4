/*
# Update payment_accounting_trigger: Only Handle Invoice Payments

## Reason
The trigger currently fires for ALL received payments, including manual receivable
payments (reference_type = 'receivable'). The accounting page's receivable payment
modal already creates JE entries manually with a user-selected cash/bank account.
The trigger creating a second JE causes duplicate entries.

## Change
Add a guard: only process payments where reference_type = 'invoice'. Manual
receivable/payable payments are handled by the frontend code which lets the user
choose which specific cash/bank account to debit.
*/

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
  -- Only process received payments for invoices
  -- Manual receivable/payable payments are handled by frontend code with account selection
  IF NEW.payment_type != 'received' OR NEW.reference_type != 'invoice' THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_bad_debt := COALESCE(NEW.bad_debt_amount, 0);

  IF v_amount <= 0 AND v_bad_debt <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_ar_account FROM accounts WHERE code = '1100' LIMIT 1;
  IF v_ar_account IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_bad_debt_account FROM accounts WHERE code = '5600' LIMIT 1;

  SELECT pm.account_id INTO v_payment_account
  FROM payment_methods pm
  WHERE pm.code = NEW.payment_method AND pm.is_active = true
  LIMIT 1;

  IF v_payment_account IS NULL THEN
    SELECT id INTO v_cash_account FROM accounts WHERE code = '1001' LIMIT 1;
  ELSE
    v_cash_account := v_payment_account;
  END IF;

  SELECT * INTO v_invoice_record FROM invoices WHERE id = NEW.reference_id;

  -- Post payment: Debit Cash/Bank, Credit AR
  IF v_amount > 0 THEN
    IF v_cash_account IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM post_journal_entry(
      'Payment Received - ' || COALESCE(NEW.payment_number, 'invoice payment'),
      COALESCE(NEW.payment_date, CURRENT_DATE),
      'payment',
      NEW.id,
      json_build_array(
        json_build_object('account_id', v_cash_account, 'debit', v_amount, 'credit', 0, 'description', 'Cash received for ' || COALESCE(v_invoice_record.invoice_number, 'invoice')),
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_amount, 'description', 'AR cleared for ' || COALESCE(v_invoice_record.invoice_number, 'invoice'))
      )::json,
      v_invoice_record.customer_id
    );
  END IF;

  -- Post bad debt: Debit Bad Debt Expense, Credit AR
  IF v_bad_debt > 0 AND v_bad_debt_account IS NOT NULL THEN
    PERFORM post_journal_entry(
      'Bad Debt Write-off - ' || COALESCE(NEW.payment_number, 'invoice payment'),
      COALESCE(NEW.payment_date, CURRENT_DATE),
      'payment',
      NEW.id,
      json_build_array(
        json_build_object('account_id', v_bad_debt_account, 'debit', v_bad_debt, 'credit', 0, 'description', 'Bad debt write-off for ' || COALESCE(v_invoice_record.invoice_number, 'invoice')),
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_bad_debt, 'description', 'AR cleared (bad debt) for ' || COALESCE(v_invoice_record.invoice_number, 'invoice'))
      )::json,
      v_invoice_record.customer_id
    );
  END IF;

  RETURN NEW;
END;
$function$;
