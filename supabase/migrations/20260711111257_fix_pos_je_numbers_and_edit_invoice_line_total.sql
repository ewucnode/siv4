-- =============================================================================
-- FIX 1: POS number generation — reset pos_seq and fix LPAD truncation
-- The pos_seq was set to 58964991 (from Date.now() fallback), and LPAD to 6
-- chars truncates to '589649', so every call returns the same number.
-- Fix: Reset the sequence to the max POS number in the table (589649),
-- and increase LPAD to 8 digits to handle larger numbers.
-- =============================================================================

-- Reset pos_seq to the max POS number currently in the table
SELECT setval('pos_seq', 589649);

-- Recreate the function with 8-digit padding to avoid truncation
CREATE OR REPLACE FUNCTION generate_pos_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER AS $$
BEGIN
  RETURN 'POS-' || LPAD(nextval('pos_seq')::TEXT, 8, '0');
END $$;

GRANT EXECUTE ON FUNCTION generate_pos_number() TO anon, authenticated;


-- =============================================================================
-- FIX 2: Journal entry number generation — fix get_next_journal_number()
-- The SUBSTRING(entry_number FROM 'JE-(\\d+)') returns NULL because
-- PostgreSQL's SUBSTRING with a regex returns the whole match, not the
-- capture group. Use regexp_replace instead to extract the number.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_next_journal_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_num text;
  v_count integer;
BEGIN
  SELECT COALESCE(MAX(CAST(
    NULLIF(regexp_replace(entry_number, '[^0-9]', '', 'g'), '')
    AS integer
  )), 0) + 1
  INTO v_count
  FROM journal_entries
  WHERE entry_number LIKE 'JE-%';

  v_num := 'JE-' || LPAD(v_count::text, 6, '0');
  RETURN v_num;
END;
$$;

GRANT EXECUTE ON FUNCTION get_next_journal_number() TO anon, authenticated;


-- =============================================================================
-- FIX 3: edit_invoice — compute line total from quantity * unit_price
-- when 'total' or 'subtotal' fields are not present in the JSON items.
-- The frontend doesn't send 'total'/'subtotal' fields, so the function
-- was computing v_new_total = 0.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.edit_invoice(p_invoice_id uuid, p_new_data json, p_reason text DEFAULT NULL, p_edited_by text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_invoice          RECORD;
  v_new_customer     uuid;
  v_new_date         date;
  v_new_due_date     date;
  v_new_notes        text;
  v_new_items        json;
  v_new_subtotal     numeric := 0;
  v_new_total        numeric := 0;
  v_item             json;
  v_old_item         RECORD;
  v_qty              numeric;
  v_cost             numeric;
  v_line_total       numeric;
  v_ar_account       uuid;
  v_revenue_account  uuid;
  v_cogs_account     uuid;
  v_inventory_account uuid;
  v_default_wh       uuid;
  v_old_snapshot     json;
  v_new_snapshot     json;
  v_payment          RECORD;
  v_has_deliveries   boolean;
  v_has_returns      boolean;
  v_new_status       text;
  v_pay_num          text;
  v_je_id            uuid;
BEGIN
  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Invoice not found');
  END IF;
  IF v_invoice.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit a cancelled invoice');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM deliveries WHERE invoice_id = p_invoice_id AND status = 'delivered'
  ) INTO v_has_deliveries;
  IF v_has_deliveries THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit invoice with completed deliveries');
  END IF;

  SELECT EXISTS(SELECT 1 FROM sales_returns WHERE invoice_id = p_invoice_id)
  INTO v_has_returns;
  IF v_has_returns THEN
    RETURN json_build_object('success', false, 'error', 'Cannot edit invoice with linked sales returns');
  END IF;

  v_new_customer   := (p_new_data->>'customer_id')::uuid;
  v_new_date       := (p_new_data->>'invoice_date')::date;
  v_new_due_date   := NULLIF(p_new_data->>'due_date', '')::date;
  v_new_notes      := p_new_data->>'notes';
  v_new_items      := p_new_data->'items';

  IF v_new_items IS NULL OR json_array_length(v_new_items) = 0 THEN
    RETURN json_build_object('success', false, 'error', 'Invoice must have at least one item');
  END IF;

  -- Calculate new totals — compute from quantity * unit_price if total/subtotal not provided
  FOR v_item IN SELECT * FROM json_array_elements(v_new_items) LOOP
    v_line_total := COALESCE(
      (v_item->>'total')::numeric,
      (v_item->>'subtotal')::numeric,
      ((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric),
      0
    );
    v_new_subtotal := v_new_subtotal + v_line_total;
  END LOOP;
  v_new_total := v_new_subtotal;

  SELECT id INTO v_ar_account        FROM accounts WHERE code = '1100' LIMIT 1;
  SELECT id INTO v_revenue_account   FROM accounts WHERE code = '4000' LIMIT 1;
  SELECT id INTO v_cogs_account      FROM accounts WHERE code = '5000' LIMIT 1;
  SELECT id INTO v_inventory_account FROM accounts WHERE code = '1200' LIMIT 1;

  SELECT id INTO v_default_wh FROM warehouses WHERE is_default = true AND is_active = true LIMIT 1;
  IF v_default_wh IS NULL THEN
    SELECT id INTO v_default_wh FROM warehouses WHERE is_active = true LIMIT 1;
  END IF;

  SELECT json_build_object(
    'customer_id', v_invoice.customer_id,
    'invoice_date', v_invoice.invoice_date,
    'due_date',     v_invoice.due_date,
    'notes',        v_invoice.notes,
    'total_amount', v_invoice.total_amount,
    'amount_paid',  v_invoice.amount_paid,
    'status',       v_invoice.status,
    'items', (SELECT json_agg(row_to_json(ii)) FROM invoice_items ii WHERE ii.invoice_id = p_invoice_id)
  ) INTO v_old_snapshot;

  -- STEP 1: REVERSE OLD EFFECTS

  -- 1a. Restore stock for each old item
  FOR v_old_item IN SELECT * FROM invoice_items WHERE invoice_id = p_invoice_id LOOP
    v_qty := COALESCE(v_old_item.base_quantity, v_old_item.quantity);
    IF v_default_wh IS NOT NULL AND v_qty > 0 THEN
      UPDATE inventory_items
      SET quantity_on_hand = quantity_on_hand + v_qty, updated_at = now()
      WHERE product_id = v_old_item.product_id AND warehouse_id = v_default_wh;

      IF NOT FOUND THEN
        INSERT INTO inventory_items (product_id, warehouse_id, quantity_on_hand, quantity_reserved, quantity_incoming)
        VALUES (v_old_item.product_id, v_default_wh, v_qty, 0, 0);
      END IF;

      INSERT INTO stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, reference_number, notes
      ) VALUES (
        v_old_item.product_id, v_default_wh, 'return_in', v_qty, COALESCE(v_old_item.cost_price, 0),
        'invoice_edit', p_invoice_id, v_invoice.invoice_number,
        'Stock restore - invoice edit'
      );
    END IF;
  END LOOP;

  -- 1d. Reverse original payments (insert refund records for audit trail)
  FOR v_payment IN
    SELECT * FROM payments WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
  LOOP
    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, customer_id, notes
    ) VALUES (
      'REV-' || COALESCE(v_payment.payment_number, 'PAY'),
      CASE WHEN v_payment.payment_type = 'received' THEN 'refund' ELSE 'payment' END,
      v_payment.payment_method,
      v_payment.amount,
      CURRENT_DATE,
      'invoice_edit', p_invoice_id,
      v_invoice.invoice_number,
      v_invoice.customer_id,
      'Reversal payment - invoice edit ' || v_invoice.invoice_number
    );
  END LOOP;

  -- Delete original 'invoice' JEs with balance rollback (this IS the reversal)
  FOR v_je_id IN
    SELECT id FROM journal_entries
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
  LOOP
    UPDATE accounts a
    SET balance = balance - (
      CASE
        WHEN a.account_type IN ('asset', 'expense')
          THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
        ELSE
          COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
      END
    )
    FROM journal_lines jl
    WHERE jl.journal_entry_id = v_je_id
      AND a.id = jl.account_id;

    DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- Delete original payment JEs with balance rollback
  FOR v_je_id IN
    SELECT je.id FROM journal_entries je
    WHERE je.reference_type = 'payment'
      AND je.reference_id IN (
        SELECT id FROM payments
        WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
      )
  LOOP
    UPDATE accounts a
    SET balance = balance - (
      CASE
        WHEN a.account_type IN ('asset', 'expense')
          THEN COALESCE(jl.debit, 0) - COALESCE(jl.credit, 0)
        ELSE
          COALESCE(jl.credit, 0) - COALESCE(jl.debit, 0)
      END
    )
    FROM journal_lines jl
    WHERE jl.journal_entry_id = v_je_id
      AND a.id = jl.account_id;

    DELETE FROM journal_lines  WHERE journal_entry_id = v_je_id;
    DELETE FROM journal_entries WHERE id = v_je_id;
  END LOOP;

  -- STEP 2: UPDATE INVOICE HEADER
  UPDATE invoices
  SET customer_id  = v_new_customer,
      invoice_date = COALESCE(v_new_date, invoice_date),
      due_date     = v_new_due_date,
      notes        = v_new_notes,
      subtotal     = v_new_subtotal,
      total_amount = v_new_total,
      amount_paid  = 0,
      discount_amount = 0,
      status       = 'draft',
      edit_count   = COALESCE(edit_count, 0) + 1,
      updated_at   = now()
  WHERE id = p_invoice_id;

  -- STEP 3: DELETE OLD ITEMS, INSERT NEW ONES
  DELETE FROM invoice_items WHERE invoice_id = p_invoice_id;

  FOR v_item IN SELECT * FROM json_array_elements(v_new_items) LOOP
    v_line_total := COALESCE(
      (v_item->>'total')::numeric,
      (v_item->>'subtotal')::numeric,
      ((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric),
      0
    );

    INSERT INTO invoice_items (
      invoice_id, product_id, quantity, unit_price, cost_price,
      discount_percent, tax_rate, subtotal, unit_name,
      unit_conversion_factor, base_quantity
    ) VALUES (
      p_invoice_id,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'discount_percent')::numeric, 0),
      0,
      v_line_total,
      NULLIF(v_item->>'unit_name', ''),
      NULLIF(v_item->>'unit_conversion_factor', '')::numeric,
      NULLIF(v_item->>'base_quantity', '')::numeric
    );
  END LOOP;

  -- STEP 4: RESTORE STATUS
  IF v_invoice.status = 'paid' THEN
    v_new_status := 'paid';
  ELSIF v_invoice.status = 'partially_paid' THEN
    v_new_status := 'sent';
  ELSE
    v_new_status := v_invoice.status;
  END IF;

  UPDATE invoices
  SET status = v_new_status, updated_at = now()
  WHERE id = p_invoice_id;

  IF v_invoice.status = 'paid' THEN
    v_pay_num := 'EDIT-PAY-' || substring(p_invoice_id::text, 1, 8);

    INSERT INTO payments (
      payment_number, payment_type, payment_method, amount, payment_date,
      reference_type, reference_id, reference_number, customer_id, notes
    ) VALUES (
      v_pay_num, 'received', 'cash',
      v_new_total, COALESCE(v_new_date, CURRENT_DATE),
      'invoice', p_invoice_id, v_invoice.invoice_number,
      COALESCE(v_new_customer, v_invoice.customer_id),
      'Auto-payment for edited paid invoice'
    );

    UPDATE invoices
    SET amount_paid = v_new_total, status = 'paid', updated_at = now()
    WHERE id = p_invoice_id;
  END IF;

  -- STEP 5: RECORD EDIT HISTORY
  SELECT json_build_object(
    'customer_id', v_new_customer,
    'invoice_date', v_new_date,
    'total_amount', v_new_total,
    'amount_paid',  CASE WHEN v_invoice.status = 'paid' THEN v_new_total ELSE 0 END,
    'status',       v_new_status,
    'items',        v_new_items
  ) INTO v_new_snapshot;

  INSERT INTO invoice_edit_history (
    invoice_id, invoice_number, edited_by_name, change_type, reason,
    snapshot_before, snapshot_after
  ) VALUES (
    p_invoice_id, v_invoice.invoice_number, p_edited_by,
    CASE
      WHEN v_invoice.customer_id <> v_new_customer THEN 'header_edit,full_edit'
      ELSE 'full_edit'
    END,
    p_reason, v_old_snapshot, v_new_snapshot
  );

  -- STEP 6: UPDATE CUSTOMER outstanding_balance ONLY
  -- total_purchases is maintained by trg_invoice_sync_total_purchases trigger
  IF v_invoice.customer_id IS NOT NULL AND v_invoice.customer_id <> COALESCE(v_new_customer, v_invoice.customer_id) THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_invoice.customer_id
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    updated_at = now()
    WHERE id = v_invoice.customer_id;
  END IF;

  IF v_new_customer IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = (
      SELECT COALESCE(SUM(balance_due), 0)
      FROM invoices
      WHERE customer_id = v_new_customer
        AND status IN ('sent', 'partially_paid', 'unpaid', 'overdue')
    ),
    updated_at = now()
    WHERE id = v_new_customer;
  END IF;

  RETURN json_build_object(
    'success',       true,
    'message',       'Invoice updated successfully',
    'invoice_number', v_invoice.invoice_number,
    'old_total',     v_invoice.total_amount,
    'new_total',     v_new_total
  );
END;
$function$;
