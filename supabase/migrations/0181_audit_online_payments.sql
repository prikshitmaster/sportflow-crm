-- 0181 — Online payments write an audit row
--
-- Razorpay payments were invisible in the audit log: no edge function writes
-- audit_logs, so a parent paying through /pay/:shortCode produced a payments
-- row and nothing else. Any "who collected what" report built on audit_logs
-- would therefore under-count real collections, silently.
--
-- The write goes inside secure_record_gateway_payment rather than the webhook
-- edge function so it is atomic with the payment insert and cannot be skipped
-- by a future caller. It sits after the payments INSERT and before the event is
-- marked processed, so the duplicate/idempotency guards above it already
-- protect against double-logging.
--
-- Body is the live definition with the audit INSERT and its two lookups added;
-- nothing else changed. IDEMPOTENT.

BEGIN;

CREATE OR REPLACE FUNCTION public.secure_record_gateway_payment(
  p_event_id text, p_event_type text, p_payload jsonb,
  p_gateway_payment_id text, p_gateway_order_id text, p_amount numeric,
  p_academy_id uuid, p_student_id bigint, p_months_covered integer DEFAULT 1,
  p_coverage_start date DEFAULT NULL::date, p_payment_link_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id TEXT;
  v_invoice_id TEXT;
  v_invoice_seq INT;
  v_invoice_prefix TEXT;
  v_student_name TEXT;
  v_student_sport TEXT;
  v_student_branch UUID;
BEGIN
  -- Idempotency: short-circuit if we've already seen this event
  INSERT INTO razorpay_events (event_id, event_type, payload, status)
  VALUES (p_event_id, p_event_type, p_payload, 'received')
  ON CONFLICT (event_id) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM razorpay_events
     WHERE event_id = p_event_id AND status IN ('processed','skipped')
  ) THEN
    RETURN json_build_object('ok', true, 'duplicate', true, 'event_id', p_event_id);
  END IF;

  -- Already have a payments row for this gateway_payment_id? Mark event processed and return it.
  IF EXISTS (SELECT 1 FROM payments WHERE gateway_payment_id = p_gateway_payment_id) THEN
    UPDATE razorpay_events SET status = 'skipped', processed_at = NOW() WHERE event_id = p_event_id;
    RETURN json_build_object('ok', true, 'duplicate', true, 'reason', 'gateway_payment_id_exists');
  END IF;

  -- Generate a payment id (use invoice prefix)
  SELECT COALESCE(invoice_prefix, 'INV'), COALESCE(next_invoice_seq, 1)
    INTO v_invoice_prefix, v_invoice_seq
    FROM academy_payment_configs WHERE academy_id = p_academy_id;

  IF v_invoice_seq IS NULL THEN
    v_invoice_prefix := 'INV';
    v_invoice_seq := 1;
  END IF;

  v_invoice_id := v_invoice_prefix || '-' || lpad(v_invoice_seq::TEXT, 5, '0');
  v_payment_id := v_invoice_id;

  -- Bump sequence
  INSERT INTO academy_payment_configs (academy_id, invoice_prefix, next_invoice_seq, enabled)
  VALUES (p_academy_id, v_invoice_prefix, v_invoice_seq + 1, TRUE)
  ON CONFLICT (academy_id) DO UPDATE
    SET next_invoice_seq = academy_payment_configs.next_invoice_seq + 1,
        updated_at = NOW();

  -- sport/branch come along so the audit row lands in the same scope the rest
  -- of the log uses; without them an online payment would show up unscoped and
  -- leak across the branch filter on the Reports page.
  SELECT name, sport, branch_id
    INTO v_student_name, v_student_sport, v_student_branch
    FROM students WHERE id = p_student_id;

  INSERT INTO payments (
    id, student_id, student, amount, month, date, status, mode,
    payment_type, discount_pct, months_covered, coverage_start,
    academy_id, notes,
    gateway, gateway_payment_id, gateway_order_id
  ) VALUES (
    v_payment_id,
    p_student_id,
    v_student_name,
    p_amount,
    to_char(COALESCE(p_coverage_start, public.ist_today()), 'Mon YYYY'),
    public.ist_today(),
    'Paid',
    'Razorpay',
    CASE WHEN COALESCE(p_months_covered, 1) >= 12 THEN 'yearly'
         WHEN COALESCE(p_months_covered, 1) >= 3  THEN 'quarterly'
         ELSE 'monthly' END,
    0,
    COALESCE(p_months_covered, 1),
    COALESCE(p_coverage_start, public.ist_today()),
    p_academy_id,
    'Razorpay payment ' || p_gateway_payment_id,
    'razorpay',
    p_gateway_payment_id,
    p_gateway_order_id
  );

  -- ── The audit row this migration adds ──────────────────────
  -- actor_role 'System' keeps it out of the staff/owner "who collected"
  -- breakdown while still counting toward collected totals. Wrapped so an
  -- audit failure can never roll back a payment that Razorpay has already
  -- taken money for.
  BEGIN
    INSERT INTO audit_logs (
      academy_id, actor_id, actor_name, actor_role, action,
      entity_type, entity_id, entity_name, changes, note, sport, branch_id
    ) VALUES (
      p_academy_id, NULL, 'Online payment', 'System', 'payment.online',
      'payment', v_payment_id, v_student_name,
      jsonb_build_object(
        'amount', p_amount::TEXT,
        'months', COALESCE(p_months_covered, 1)::TEXT,
        'mode',   'Razorpay'
      ),
      'Paid online by parent · ' || p_gateway_payment_id,
      v_student_sport, v_student_branch
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_logs insert failed for gateway payment %: %', v_payment_id, SQLERRM;
  END;

  -- If linked to a payment_link, mark it paid
  IF p_payment_link_id IS NOT NULL THEN
    UPDATE payment_links
       SET status     = 'paid',
           paid_at    = NOW(),
           payment_id = v_payment_id
     WHERE id = p_payment_link_id;
  END IF;

  -- Bump student.paid_till if this payment extends coverage
  UPDATE students
     SET paid_till = GREATEST(
           COALESCE(paid_till, public.ist_today() - INTERVAL '1 day'),
           COALESCE(p_coverage_start, public.ist_today()) + (COALESCE(p_months_covered, 1) * INTERVAL '1 month') - INTERVAL '1 day'
         )::DATE,
         status = CASE WHEN status = 'Suspended' THEN 'Suspended' ELSE status END
   WHERE id = p_student_id;

  UPDATE razorpay_events
     SET status = 'processed', processed_at = NOW()
   WHERE event_id = p_event_id;

  RETURN json_build_object('ok', true, 'payment_id', v_payment_id);
END;
$function$;

COMMIT;
