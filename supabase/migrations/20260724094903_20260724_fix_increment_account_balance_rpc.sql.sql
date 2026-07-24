
-- Fix: increment_account_balance referenced updated_at column which doesn't exist on accounts table
-- This caused the RPC to fail silently, so no account balances were ever updated
CREATE OR REPLACE FUNCTION increment_account_balance(p_account_id uuid, p_delta numeric)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE accounts
  SET balance = balance + p_delta
  WHERE id = p_account_id;
END;
$$;
