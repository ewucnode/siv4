
-- Fix Issue 1: Manual journal entries JE-804222, JE-804223, JE-804227 were incorrectly
-- posted to COGS (5000) instead of Inventory Asset (1200).
-- These are purchase payments ("all heram payment", "product buy"), NOT cost of goods sold.
-- Move the debit lines from account 5000 to account 1200 (Inventory Asset).

UPDATE journal_lines
SET account_id = (SELECT id FROM accounts WHERE code = '1200'),
    description = description || ' [reclassified from COGS to Inventory]'
WHERE journal_entry_id IN (
  SELECT id FROM journal_entries WHERE entry_number IN ('JE-804222', 'JE-804223', 'JE-804227')
)
AND account_id = (SELECT id FROM accounts WHERE code = '5000')
AND debit > 0;

-- Recalculate account balances manually
-- COGS (5000) should decrease by 92700 (74000 + 16000 + 2700)
UPDATE accounts SET balance = balance - 92700 WHERE code = '5000';

-- Inventory Asset (1200) should increase by 92700
UPDATE accounts SET balance = balance + 92700 WHERE code = '1200';
