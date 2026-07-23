
-- Fix Issue 3: Manual receivable JE-803886 posted to Sales Revenue (4000) instead of
-- Service Revenue (4100). Move the credit line from account 4000 to account 4100.

UPDATE journal_lines
SET account_id = (SELECT id FROM accounts WHERE code = '4100')
WHERE journal_entry_id = (
  SELECT id FROM journal_entries WHERE entry_number = 'JE-803886'
)
AND account_id = (SELECT id FROM accounts WHERE code = '4000')
AND credit > 0;

-- Adjust balances: Sales Revenue (4000) decreases by 31323, Service Revenue (4100) increases by 31323
UPDATE accounts SET balance = balance - 31323 WHERE code = '4000';
UPDATE accounts SET balance = balance + 31323 WHERE code = '4100';
