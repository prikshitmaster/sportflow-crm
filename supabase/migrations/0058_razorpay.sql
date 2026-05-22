-- ============================================================
-- 0058 — Razorpay payment gateway integration (additive)
-- ============================================================
-- ADDITIVE ONLY. Does NOT modify the existing manual payment flow.
--
-- Adds:
--   - Nullable gateway columns on payments
--   - academy_payment_configs   (one row per academy: razorpay creds, GST info)
--   - payment_links             (parent-facing pay-later links)
--   - razorpay_events           (webhook event log for idempotency + audit)
--   - secure_record_gateway_payment() RPC (called from webhook with service role)
--   - secure_get_payment_config() / secure_set_payment_config() RPCs
--   - secure_create_payment_link() RPC
--
-- IDEMPOTENT — safe to re-run.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. Gateway columns on payments (all nullable — manual rows = NULL)
-- ════════════════════════════════════════════════════════════

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gateway             TEXT,           -- 'razorpay' | NULL (manual)
  ADD COLUMN IF NOT EXISTS gateway_payment_id  TEXT,           -- e.g. pay_XXXX
  ADD COLUMN IF NOT EXISTS gateway_order_id    TEXT,           -- e.g. order_XXXX
  ADD COLUMN IF NOT EXISTS gateway_signature   TEXT,
  ADD COLUMN IF NOT EXISTS gst_invoice_no      TEXT,
  ADD COLUMN IF NOT EXISTS gst_amount          NUMERIC(10,2);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_gateway_payment_id
  ON payments(gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_gateway_order_id
  ON payments(gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- 2. academy_payment_configs
-- ════════════════════════════════════════════════════════════
-- One row per academy. Stores Razorpay public key + (optionally) Connect
-- account ID. The SECRET KEY is NEVER stored here — it lives in Supabase
-- platform env (RAZORPAY_KEY_SECRET) and is only accessible inside the
-- edge function. Per-academy secrets can be added later via Razorpay Route
-- using sub-merchant linked accounts.

CREATE TABLE IF NOT EXISTS academy_payment_configs (
  academy_id              UUID    PRIMARY KEY REFERENCES academies(id) ON DELETE CASCADE,
  razorpay_key_id         TEXT,                       -- e.g. rzp_live_XXXX (public)
  razorpay_account_id     TEXT,                       -- e.g. acc_XXXX (Razorpay Connect linked account)
  gst_number              TEXT,
  pan                     TEXT,
  invoice_prefix          TEXT    DEFAULT 'INV',
  next_invoice_seq        INT     DEFAULT 1,
  enabled                 BOOLEAN DEFAULT FALSE,      -- owner toggles on after KYC
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- 3. payment_links
-- ════════════════════════════════════════════════════════════
-- Owner generates a link → SMS/WhatsApp to parent → parent opens, pays via
-- Razorpay Checkout → webhook fires → linked payments row created.

CREATE TABLE IF NOT EXISTS payment_links (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  academy_id          UUID         NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  student_id          BIGINT       NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount              NUMERIC(10,2) NOT NULL,
  description         TEXT,
  months_covered      INT          DEFAULT 1,
  coverage_start      DATE,
  short_code          TEXT         UNIQUE,           -- short url-safe code for share link
  razorpay_order_id   TEXT,                          -- created lazily when parent opens link
  status              TEXT         DEFAULT 'pending', -- 'pending' | 'paid' | 'cancelled' | 'expired'
  expires_at          TIMESTAMPTZ  DEFAULT (NOW() + INTERVAL '7 days'),
  paid_at             TIMESTAMPTZ,
  payment_id          TEXT         REFERENCES payments(id) ON DELETE SET NULL,
  created_by          TEXT,
  created_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_academy_status
  ON payment_links(academy_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_links_student
  ON payment_links(student_id);


-- ════════════════════════════════════════════════════════════
-- 4. razorpay_events (webhook idempotency)
-- ════════════════════════════════════════════════════════════
-- Razorpay retries failed webhooks. We dedupe by event id so the same
-- payment is never recorded twice.

CREATE TABLE IF NOT EXISTS razorpay_events (
  event_id     TEXT       PRIMARY KEY,             -- evt_XXXX from Razorpay
  event_type   TEXT       NOT NULL,                -- 'payment.captured', etc.
  payload      JSONB,
  received_at  TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status       TEXT       DEFAULT 'received'       -- 'received' | 'processed' | 'failed' | 'skipped'
);

CREATE INDEX IF NOT EXISTS idx_razorpay_events_type ON razorpay_events(event_type, received_at DESC);


-- ════════════════════════════════════════════════════════════
-- 5. RLS — read-only for owner + parent self-service
-- ════════════════════════════════════════════════════════════

ALTER TABLE academy_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_events         ENABLE ROW LEVEL SECURITY;

-- Owner reads own config
DROP POLICY IF EXISTS academy_payment_configs_select ON academy_payment_configs;
CREATE POLICY academy_payment_configs_select ON academy_payment_configs
FOR SELECT TO authenticated
USING (academy_id = current_user_academy_id());

-- Anon read: the public link landing page needs to fetch a payment_link row by short_code
-- (no auth — anyone with the code can see the amount). That's by design — the link IS the bearer.
DROP POLICY IF EXISTS payment_links_select_anon ON payment_links;
CREATE POLICY payment_links_select_anon ON payment_links
FOR SELECT TO anon, authenticated
USING (TRUE);  -- public, intentional. Sensitive fields are not in this table.

-- razorpay_events — only readable by service role (no policy = denied by default)


-- ════════════════════════════════════════════════════════════
-- 6. RPC — owner sets/gets payment config
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_get_payment_config(
  p_token TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a    RECORD;
  v_row academy_payment_configs%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM academy_payment_configs WHERE academy_id = a.academy_id;
  IF v_row.academy_id IS NULL THEN
    -- Lazy-init empty config so the frontend gets a row to render
    INSERT INTO academy_payment_configs (academy_id, enabled)
    VALUES (a.academy_id, FALSE)
    RETURNING * INTO v_row;
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_get_payment_config(TEXT) TO anon, authenticated;


CREATE OR REPLACE FUNCTION secure_set_payment_config(
  p_payload JSONB,
  p_token   TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a    RECORD;
  v_row academy_payment_configs%ROWTYPE;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.actor_kind IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO academy_payment_configs (
    academy_id, razorpay_key_id, razorpay_account_id,
    gst_number, pan, invoice_prefix, enabled
  ) VALUES (
    a.academy_id,
    NULLIF(p_payload->>'razorpayKeyId', ''),
    NULLIF(p_payload->>'razorpayAccountId', ''),
    NULLIF(p_payload->>'gstNumber', ''),
    NULLIF(p_payload->>'pan', ''),
    COALESCE(NULLIF(p_payload->>'invoicePrefix', ''), 'INV'),
    COALESCE((p_payload->>'enabled')::BOOLEAN, FALSE)
  )
  ON CONFLICT (academy_id) DO UPDATE SET
    razorpay_key_id     = COALESCE(NULLIF(EXCLUDED.razorpay_key_id, ''),     academy_payment_configs.razorpay_key_id),
    razorpay_account_id = COALESCE(NULLIF(EXCLUDED.razorpay_account_id, ''), academy_payment_configs.razorpay_account_id),
    gst_number          = COALESCE(NULLIF(EXCLUDED.gst_number, ''),          academy_payment_configs.gst_number),
    pan                 = COALESCE(NULLIF(EXCLUDED.pan, ''),                 academy_payment_configs.pan),
    invoice_prefix      = COALESCE(NULLIF(EXCLUDED.invoice_prefix, ''),      academy_payment_configs.invoice_prefix),
    enabled             = EXCLUDED.enabled,
    updated_at          = NOW()
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_set_payment_config(JSONB, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 7. RPC — create a payment link (owner/staff)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_create_payment_link(
  p_student_id    BIGINT,
  p_amount        NUMERIC,
  p_description   TEXT     DEFAULT NULL,
  p_months        INT      DEFAULT 1,
  p_coverage_start DATE    DEFAULT NULL,
  p_token         TEXT     DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a       RECORD;
  v_stud  RECORD;
  v_row   payment_links%ROWTYPE;
  v_code  TEXT;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  PERFORM _require_perm(a.actor_kind, a.perms, 'payments.manage');

  SELECT id, academy_id INTO v_stud FROM students WHERE id = p_student_id;
  IF v_stud.academy_id IS DISTINCT FROM a.academy_id THEN
    RAISE EXCEPTION 'student not found in this academy' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive' USING ERRCODE = '22023';
  END IF;

  -- 10-char url-safe short code
  v_code := encode(gen_random_bytes(6), 'base64');
  v_code := translate(v_code, '+/=', 'AB_');  -- url-safe

  INSERT INTO payment_links (
    academy_id, student_id, amount, description,
    months_covered, coverage_start, short_code, created_by
  ) VALUES (
    a.academy_id, p_student_id, p_amount, p_description,
    COALESCE(p_months, 1), p_coverage_start, v_code,
    COALESCE((SELECT name FROM profiles WHERE id = auth.uid()), 'Staff')
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION secure_create_payment_link(BIGINT, NUMERIC, TEXT, INT, DATE, TEXT) TO anon, authenticated;


-- ════════════════════════════════════════════════════════════
-- 8. RPC — record a captured gateway payment
-- ════════════════════════════════════════════════════════════
-- Called from the razorpay-webhook edge function ONLY.
-- We don't gate by current_actor because the webhook runs unauthenticated
-- from Razorpay's servers. Instead the edge function verifies HMAC and
-- passes a service-role-only secret as p_webhook_secret. The function
-- compares against vault.razorpay_webhook_secret_v1 (or a hardcoded check
-- if you prefer env-only).
--
-- For simplicity here: this RPC is only callable from service_role.
-- Edge function must use the service-role key, not anon.

CREATE OR REPLACE FUNCTION secure_record_gateway_payment(
  p_event_id          TEXT,
  p_event_type        TEXT,
  p_payload           JSONB,
  p_gateway_payment_id TEXT,
  p_gateway_order_id  TEXT,
  p_amount            NUMERIC,
  p_academy_id        UUID,
  p_student_id        BIGINT,
  p_months_covered    INT      DEFAULT 1,
  p_coverage_start    DATE     DEFAULT NULL,
  p_payment_link_id   UUID     DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id TEXT;
  v_invoice_id TEXT;
  v_invoice_seq INT;
  v_invoice_prefix TEXT;
  v_student_name TEXT;
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

  SELECT name INTO v_student_name FROM students WHERE id = p_student_id;

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
    to_char(COALESCE(p_coverage_start, CURRENT_DATE), 'Mon YYYY'),
    CURRENT_DATE,
    'Paid',
    'Razorpay',
    CASE WHEN COALESCE(p_months_covered, 1) >= 12 THEN 'yearly'
         WHEN COALESCE(p_months_covered, 1) >= 3  THEN 'quarterly'
         ELSE 'monthly' END,
    0,
    COALESCE(p_months_covered, 1),
    COALESCE(p_coverage_start, CURRENT_DATE),
    p_academy_id,
    'Razorpay payment ' || p_gateway_payment_id,
    'razorpay',
    p_gateway_payment_id,
    p_gateway_order_id
  );

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
           COALESCE(paid_till, CURRENT_DATE - INTERVAL '1 day'),
           COALESCE(p_coverage_start, CURRENT_DATE) + (COALESCE(p_months_covered, 1) * INTERVAL '1 month') - INTERVAL '1 day'
         )::DATE,
         status = CASE WHEN status = 'Suspended' THEN 'Suspended' ELSE status END
   WHERE id = p_student_id;

  UPDATE razorpay_events
     SET status = 'processed', processed_at = NOW()
   WHERE event_id = p_event_id;

  RETURN json_build_object('ok', true, 'payment_id', v_payment_id);
END;
$$;

-- Only callable with service_role (edge function). NOT granted to anon/authenticated.
REVOKE ALL ON FUNCTION secure_record_gateway_payment(TEXT, TEXT, JSONB, TEXT, TEXT, NUMERIC, UUID, BIGINT, INT, DATE, UUID) FROM PUBLIC;


-- ════════════════════════════════════════════════════════════
-- 9. RPC — parent fetches a payment link by short_code (public)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION secure_fetch_payment_link(
  p_short_code TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    payment_links%ROWTYPE;
  v_stud    RECORD;
  v_cfg     RECORD;
  v_academy RECORD;
BEGIN
  SELECT * INTO v_link FROM payment_links
   WHERE short_code = p_short_code
     AND status = 'pending'
     AND expires_at > NOW();

  IF v_link.id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found_or_expired');
  END IF;

  SELECT id, name, sport, photo_url INTO v_stud  FROM students WHERE id = v_link.student_id;
  SELECT id, name, logo_url         INTO v_academy FROM academies WHERE id = v_link.academy_id;
  SELECT razorpay_key_id            INTO v_cfg   FROM academy_payment_configs WHERE academy_id = v_link.academy_id;

  RETURN json_build_object(
    'ok', true,
    'link', json_build_object(
       'id',             v_link.id,
       'short_code',     v_link.short_code,
       'amount',         v_link.amount,
       'description',    v_link.description,
       'months_covered', v_link.months_covered,
       'coverage_start', v_link.coverage_start,
       'expires_at',     v_link.expires_at
    ),
    'student', json_build_object(
       'id',        v_stud.id,
       'name',      v_stud.name,
       'sport',     v_stud.sport,
       'photo_url', v_stud.photo_url
    ),
    'academy', json_build_object(
       'id',        v_academy.id,
       'name',      v_academy.name,
       'logo_url',  v_academy.logo_url
    ),
    'razorpay_key_id', v_cfg.razorpay_key_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION secure_fetch_payment_link(TEXT) TO anon, authenticated;
