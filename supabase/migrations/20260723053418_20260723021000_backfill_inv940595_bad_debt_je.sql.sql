/*
# Backfill Missing Bad Debt Journal Entry for PAY-996790

## Context
Payment PAY-996790 (INV-940595) had bad_debt_amount = 1 but was inserted BEFORE the
payment_accounting_trigger was updated to handle bad debt. The trigger created the
Cash→AR entry (JE-959811) but NOT the Bad Debt Expense→AR entry.

## Action
Manually post the missing bad debt journal entry:
- Dr. Bad Debt Expense (5600) — ৳1
- Cr. Accounts Receivable (1100) — ৳1

Then update account balances to reflect this entry.
*/

DO $$
DECLARE
  v_bad_debt_account uuid;
  v_ar_account uuid;
  v_entry_id uuid;
  v_amount numeric := 1;
BEGIN
  SELECT id INTO v_bad_debt_account FROM accounts WHERE code = '5600' LIMIT 1;
  SELECT id INTO v_ar_account FROM accounts WHERE code = '1100' LIMIT 1;

  IF v_bad_debt_account IS NULL OR v_ar_account IS NULL THEN
    RAISE NOTICE 'Required accounts not found';
    RETURN;
  END IF;

  -- Check if a bad debt JE already exists for this payment
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.reference_id = 'd6df8546-3572-4430-a706-b145e2736b27'
    AND jl.account_id = v_bad_debt_account
  ) THEN
    -- Post the missing journal entry using the existing function
    PERFORM post_journal_entry(
      'Bad Debt Write-off - PAY-996790 (backfill)',
      '2026-07-22'::date,
      'payment',
      'd6df8546-3572-4430-a706-b145e2736b27'::uuid,
      json_build_array(
        json_build_object('account_id', v_bad_debt_account, 'debit', v_amount, 'credit', 0, 'description', 'Bad debt write-off for INV-940595 (backfill)'),
        json_build_object('account_id', v_ar_account, 'debit', 0, 'credit', v_amount, 'description', 'AR cleared (bad debt) for INV-940595 (backfill)')
      )::json,
      '5fafd19a-ef04-4ccd-a0d9-210982387455'::uuid
    );
    RAISE NOTICE 'Bad debt journal entry backfilled successfully';
  ELSE
    RAISE NOTICE 'Bad debt journal entry already exists, skipping';
  END IF;
END $$;
