
-- Create new accounts for manual receivable system:
-- 1. Manual Receivable (1300) — asset, for tracking manual receivables separately from invoice AR
-- 2. Opening Balance Equity (3900) — equity, offset for opening balance entries
-- 3. Other Income (4300) — revenue, offset for other income entries

INSERT INTO accounts (code, name, account_type, is_active, balance)
SELECT '1300', 'Manual Receivable', 'asset', true, 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '1300');

INSERT INTO accounts (code, name, account_type, is_active, balance)
SELECT '3900', 'Opening Balance Equity', 'equity', true, 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '3900');

INSERT INTO accounts (code, name, account_type, is_active, balance)
SELECT '4300', 'Other Income', 'revenue', true, 0
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code = '4300');

-- Migrate existing manual receivable JE-803886: move debit from AR (1100) to Manual Receivable (1300)
UPDATE journal_lines
SET account_id = (SELECT id FROM accounts WHERE code = '1300')
WHERE journal_entry_id = (
  SELECT id FROM journal_entries WHERE entry_number = 'JE-803886'
)
AND account_id = (SELECT id FROM accounts WHERE code = '1100')
AND debit > 0;

-- Adjust balances: AR (1100) decreases by 31323, Manual Receivable (1300) increases by 31323
UPDATE accounts SET balance = balance - 31323 WHERE code = '1100';
UPDATE accounts SET balance = balance + 31323 WHERE code = '1300';
