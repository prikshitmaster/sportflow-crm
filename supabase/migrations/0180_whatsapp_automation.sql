-- 0180 — WhatsApp automation foundation
--
-- Six tables + the grace-period column, plus the owner-only secure_* RPCs the
-- Settings → WhatsApp tab reads and writes. This migration is the storage and
-- access layer only: nothing here sends a message. The send rail (outbox drain,
-- daily scan, Meta webhook) lands separately.
--
-- Design: docs/superpowers/specs/2026-08-22-whatsapp-automation-design.md
--
-- SECURITY MODEL — read this before adding a policy.
-- All six tables have RLS enabled and *deliberately no policies at all*, so no
-- client role (anon, authenticated, staff-token, student-token) can read or
-- write them by any route. whatsapp_accounts holds a permanent Meta access
-- token and the app secret; a single over-broad policy here leaks the ability
-- to message every parent in the academy from the academy's own number.
-- Access is exclusively through the SECURITY DEFINER functions below, which
-- never return the token or the app secret, and through the service-role key
-- used by edge functions.
--
-- IDEMPOTENT — safe to re-run.

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 0. Grace period becomes real configuration
--
-- Auto-suspend currently reads localStorage.sf_suspend_days, so two owners on
-- two laptops hold different values for the same academy and the database knows
-- none of them. A fee_final message promising "suspension tomorrow" cannot be
-- trusted until this lives server-side. AppContext is switched over separately;
-- the default of 3 matches the current client-side default.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.academies
  ADD COLUMN IF NOT EXISTS suspend_grace_days INT NOT NULL DEFAULT 3;

-- ════════════════════════════════════════════════════════════════
-- 1. whatsapp_accounts — one row per academy
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_accounts (
  academy_id      UUID PRIMARY KEY REFERENCES public.academies(id) ON DELETE CASCADE,
  phone_number_id TEXT,
  waba_id         TEXT,
  access_token    TEXT,          -- never returned to a client
  app_secret      TEXT,          -- never returned to a client
  display_number  TEXT,
  status          TEXT NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('disconnected','connected','error')),
  daily_cap       INT  NOT NULL DEFAULT 200 CHECK (daily_cap > 0 AND daily_cap <= 5000),
  -- Quiet hours are wall-clock IST; the sender interprets them in Asia/Kolkata.
  quiet_start     TIME NOT NULL DEFAULT '09:00',
  quiet_end       TIME NOT NULL DEFAULT '20:00',
  paused          BOOLEAN NOT NULL DEFAULT FALSE,   -- global kill switch
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- 2. whatsapp_templates — the composer's output
--
-- Standalone rather than folded into the automation row: broadcasts need
-- templates with no automation attached, and a Meta rejection must not wipe an
-- automation's timing and audience settings.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id               BIGSERIAL PRIMARY KEY,
  academy_id       UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  kind             TEXT,          -- NULL for broadcast-only templates
  template_name    TEXT NOT NULL,
  language         TEXT NOT NULL DEFAULT 'en',
  category         TEXT NOT NULL DEFAULT 'utility'
                     CHECK (category IN ('utility','marketing')),
  body_text        TEXT NOT NULL DEFAULT '',
  header_text      TEXT,
  footer_text      TEXT,
  buttons          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- slot -> variable token, e.g. {"1":"parent_name","2":"student_name"}.
  -- Validated at send time against the code-owned allowlist in
  -- src/lib/whatsappCatalogue.js; an unknown token refuses to send.
  var_map          JSONB NOT NULL DEFAULT '{}'::jsonb,
  meta_template_id TEXT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','pending','approved','rejected','paused','disabled')),
  rejection_reason TEXT,
  submitted_at     TIMESTAMPTZ,
  checked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One template per automation kind per academy. Broadcast templates (kind NULL)
-- are unconstrained — an academy can have many.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_academy_kind_uq
  ON public.whatsapp_templates (academy_id, kind) WHERE kind IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 3. whatsapp_automations — the knobs
--
-- audience_type / audience_ids reuse the exact vocabulary of announcements and
-- src/lib/announcementAudience.js. That file exists because three places once
-- disagreed about who an announcement was for; a second targeting vocabulary
-- would reintroduce the same class of bug.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_automations (
  id            BIGSERIAL PRIMARY KEY,
  academy_id    UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  template_id   BIGINT REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  -- per-kind knobs: {"hour":9} | {"offset_days":-1} | {"min_consecutive":2,"send_after":"18:00"}
  timing        JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience_type TEXT  NOT NULL DEFAULT 'all'
                  CHECK (audience_type IN ('all','students','staff','batches','students_list','staff_members')),
  audience_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT,
  UNIQUE (academy_id, kind)
);

-- ════════════════════════════════════════════════════════════════
-- 4. whatsapp_outbox — the queue AND the send log
--
-- One table telling one story, rather than a queue and a log that can disagree.
-- Enqueue is INSERT ... ON CONFLICT (dedupe_key) DO NOTHING, so a re-run, a
-- double-fired trigger and a retried scan are all harmless.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_outbox (
  id              BIGSERIAL PRIMARY KEY,
  academy_id      UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  student_id      BIGINT,        -- intentionally not FK: the log outlives the student
  trial_id        BIGINT,
  to_phone        TEXT NOT NULL,
  template_id     BIGINT REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  variables       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- {kind}:{subject_id}:{period} — see the spec for the period per kind
  dedupe_key      TEXT NOT NULL UNIQUE,
  scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sending','sent','failed','skipped')),
  skip_reason     TEXT,
  attempts        INT  NOT NULL DEFAULT 0,
  wa_message_id   TEXT,
  delivery_status TEXT CHECK (delivery_status IN ('sent','delivered','read','failed')),
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

-- Drain worker: claim due rows.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_due_idx
  ON public.whatsapp_outbox (academy_id, status, scheduled_for)
  WHERE status = 'queued';

-- Settings send log: newest first.
CREATE INDEX IF NOT EXISTS whatsapp_outbox_log_idx
  ON public.whatsapp_outbox (academy_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- 5. whatsapp_opt_outs — keyed by phone, not student
--
-- One STOP from a parent covers every child in that family.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_opt_outs (
  academy_id   UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('stop_reply','manual')),
  PRIMARY KEY (academy_id, phone)
);

-- ════════════════════════════════════════════════════════════════
-- 6. whatsapp_broadcasts — one row per manual send
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
  id              BIGSERIAL PRIMARY KEY,
  academy_id      UUID NOT NULL REFERENCES public.academies(id) ON DELETE CASCADE,
  branch_id       UUID,
  sport           TEXT,
  template_id     BIGINT REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  audience_type   TEXT NOT NULL DEFAULT 'all',
  audience_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_count      INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','queued','sending','sent','failed')),
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════
-- 7. RLS — enabled, with NO policies, on purpose
--
-- See the header. Do not add a policy here without reading it. In particular do
-- not add an untargeted `FOR ALL USING (true)` — that pattern defaulting to
-- PUBLIC caused a real shipped regression on notifications/push_subscriptions
-- (security-v3/12, fixed in 13).
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.whatsapp_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_outbox     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_opt_outs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the table grants the anon/authenticated roles get by
-- default, so even a future accidental policy cannot expose the token.
REVOKE ALL ON public.whatsapp_accounts   FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_templates  FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_automations FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_outbox     FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_opt_outs   FROM anon, authenticated;
REVOKE ALL ON public.whatsapp_broadcasts FROM anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 8. Owner-only guard shared by every RPC below
--
-- WhatsApp settings spend the academy's money and speak in its name, so this is
-- owner-only rather than permission-gated. Deliberately not using _require_perm:
-- there is no existing permission key for it, and inventing one would silently
-- widen access the first time someone grants it broadly.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._wa_require_owner(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM current_actor(p_token) LIMIT 1;
  IF a.academy_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF a.actor_kind <> 'owner' THEN
    RAISE EXCEPTION 'forbidden: WhatsApp settings are owner-only' USING ERRCODE = '42501';
  END IF;
  RETURN a.academy_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 9. Connection state — never returns access_token or app_secret
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_whatsapp_status(p_token TEXT DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID; v_out json;
BEGIN
  v_academy := _wa_require_owner(p_token);

  SELECT row_to_json(t) INTO v_out FROM (
    SELECT
      w.display_number,
      w.status,
      w.daily_cap,
      w.quiet_start,
      w.quiet_end,
      w.paused,
      w.last_error,
      w.updated_at,
      -- presence flags, so the UI can show "configured" without the value
      (w.access_token IS NOT NULL AND w.access_token <> '') AS has_token,
      (w.app_secret   IS NOT NULL AND w.app_secret   <> '') AS has_app_secret,
      w.phone_number_id,
      w.waba_id,
      (SELECT a.suspend_grace_days FROM academies a WHERE a.id = v_academy) AS suspend_grace_days,
      (SELECT count(*) FROM whatsapp_outbox o
        WHERE o.academy_id = v_academy AND o.status = 'sent'
          AND o.sent_at >= date_trunc('day', now())) AS sent_today
    FROM whatsapp_accounts w
    WHERE w.academy_id = v_academy
  ) t;

  -- No row yet → a well-formed "disconnected" shape, so the UI has one code path.
  RETURN COALESCE(v_out, json_build_object(
    'status', 'disconnected',
    'daily_cap', 200,
    'quiet_start', '09:00:00',
    'quiet_end', '20:00:00',
    'paused', false,
    'has_token', false,
    'has_app_secret', false,
    'suspend_grace_days', (SELECT a.suspend_grace_days FROM academies a WHERE a.id = v_academy),
    'sent_today', 0
  ));
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 10. Connect / disconnect / settings
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_whatsapp_connect(
  p_token           TEXT,
  p_phone_number_id TEXT,
  p_waba_id         TEXT,
  p_access_token    TEXT,
  p_app_secret      TEXT DEFAULT NULL,
  p_display_number  TEXT DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);

  IF COALESCE(p_phone_number_id,'') = '' OR COALESCE(p_waba_id,'') = ''
     OR COALESCE(p_access_token,'') = '' THEN
    RAISE EXCEPTION 'phone number id, WABA id and access token are all required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO whatsapp_accounts (
    academy_id, phone_number_id, waba_id, access_token, app_secret,
    display_number, status, last_error, updated_at
  ) VALUES (
    v_academy, p_phone_number_id, p_waba_id, p_access_token, p_app_secret,
    p_display_number, 'connected', NULL, now()
  )
  ON CONFLICT (academy_id) DO UPDATE SET
    phone_number_id = EXCLUDED.phone_number_id,
    waba_id         = EXCLUDED.waba_id,
    access_token    = EXCLUDED.access_token,
    -- keep the stored secret when the form submits blank (it is never rendered back)
    app_secret      = COALESCE(NULLIF(EXCLUDED.app_secret, ''), whatsapp_accounts.app_secret),
    display_number  = EXCLUDED.display_number,
    status          = 'connected',
    last_error      = NULL,
    updated_at      = now();

  RETURN secure_whatsapp_status(p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_whatsapp_disconnect(p_token TEXT DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);

  -- Clear the secrets rather than deleting the row: the send log, templates and
  -- automation settings survive a disconnect/reconnect cycle.
  UPDATE whatsapp_accounts SET
    access_token = NULL, app_secret = NULL,
    status = 'disconnected', last_error = NULL, updated_at = now()
  WHERE academy_id = v_academy;

  RETURN secure_whatsapp_status(p_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_whatsapp_save_settings(
  p_token       TEXT,
  p_daily_cap   INT  DEFAULT NULL,
  p_quiet_start TIME DEFAULT NULL,
  p_quiet_end   TIME DEFAULT NULL,
  p_paused      BOOLEAN DEFAULT NULL,
  p_grace_days  INT  DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);

  INSERT INTO whatsapp_accounts (academy_id) VALUES (v_academy)
  ON CONFLICT (academy_id) DO NOTHING;

  UPDATE whatsapp_accounts SET
    daily_cap   = COALESCE(p_daily_cap,   daily_cap),
    quiet_start = COALESCE(p_quiet_start, quiet_start),
    quiet_end   = COALESCE(p_quiet_end,   quiet_end),
    paused      = COALESCE(p_paused,      paused),
    updated_at  = now()
  WHERE academy_id = v_academy;

  IF p_grace_days IS NOT NULL THEN
    IF p_grace_days < 0 OR p_grace_days > 60 THEN
      RAISE EXCEPTION 'grace days must be between 0 and 60' USING ERRCODE = '22023';
    END IF;
    UPDATE academies SET suspend_grace_days = p_grace_days WHERE id = v_academy;
  END IF;

  RETURN secure_whatsapp_status(p_token);
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 11. Automations — list and save
--
-- The list returns only rows that exist; the UI merges them over the code-owned
-- catalogue in src/lib/whatsappCatalogue.js. Code stays the source of truth for
-- which automations exist and which variables each may use.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_whatsapp_automations(p_token TEXT DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);

  RETURN QUERY
  SELECT row_to_json(t) FROM (
    SELECT
      au.kind, au.enabled, au.timing, au.audience_type, au.audience_ids,
      au.updated_at,
      t.id               AS template_id,
      t.template_name,
      t.language,
      t.category,
      t.body_text,
      t.header_text,
      t.footer_text,
      t.buttons,
      t.var_map,
      t.status           AS template_status,
      t.rejection_reason,
      t.submitted_at
    FROM whatsapp_automations au
    LEFT JOIN whatsapp_templates t ON t.id = au.template_id
    WHERE au.academy_id = v_academy
    ORDER BY au.kind
  ) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_whatsapp_save_automation(
  p_token         TEXT,
  p_kind          TEXT,
  p_enabled       BOOLEAN DEFAULT NULL,
  p_timing        JSONB   DEFAULT NULL,
  p_audience_type TEXT    DEFAULT NULL,
  p_audience_ids  JSONB   DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID; v_tpl_status TEXT; v_out json;
BEGIN
  v_academy := _wa_require_owner(p_token);
  IF COALESCE(p_kind,'') = '' THEN
    RAISE EXCEPTION 'kind is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO whatsapp_automations (academy_id, kind) VALUES (v_academy, p_kind)
  ON CONFLICT (academy_id, kind) DO NOTHING;

  -- Refuse to enable an automation whose template Meta has not approved. The UI
  -- disables the toggle too, but the rule belongs here: a caller that skips the
  -- UI must not be able to arm an automation that can only ever fail at send.
  IF p_enabled IS TRUE THEN
    SELECT t.status INTO v_tpl_status
    FROM whatsapp_automations au
    LEFT JOIN whatsapp_templates t ON t.id = au.template_id
    WHERE au.academy_id = v_academy AND au.kind = p_kind;

    IF v_tpl_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'cannot enable %: its message template is % (needs Meta approval)',
        p_kind, COALESCE(v_tpl_status, 'not written yet') USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE whatsapp_automations SET
    enabled       = COALESCE(p_enabled,       enabled),
    timing        = COALESCE(p_timing,        timing),
    audience_type = COALESCE(p_audience_type, audience_type),
    audience_ids  = COALESCE(p_audience_ids,  audience_ids),
    updated_at    = now(),
    updated_by    = 'owner'
  WHERE academy_id = v_academy AND kind = p_kind;

  SELECT row_to_json(t) INTO v_out FROM (
    SELECT au.kind, au.enabled, au.timing, au.audience_type, au.audience_ids
    FROM whatsapp_automations au
    WHERE au.academy_id = v_academy AND au.kind = p_kind
  ) t;
  RETURN v_out;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 12. Templates — save a draft
--
-- Saving always lands the row in 'draft'. Meta does not allow editing an
-- approved template in place, so an edit means a fresh submission; letting the
-- row keep 'approved' after an edit would mean Settings shows text that is not
-- what actually goes out.
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_whatsapp_save_template(
  p_token         TEXT,
  p_kind          TEXT,
  p_template_name TEXT,
  p_body_text     TEXT,
  p_category      TEXT  DEFAULT 'utility',
  p_header_text   TEXT  DEFAULT NULL,
  p_footer_text   TEXT  DEFAULT NULL,
  p_buttons       JSONB DEFAULT '[]'::jsonb,
  p_var_map       JSONB DEFAULT '{}'::jsonb,
  p_language      TEXT  DEFAULT 'en'
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID; v_id BIGINT; v_out json;
BEGIN
  v_academy := _wa_require_owner(p_token);

  IF COALESCE(p_template_name,'') = '' THEN
    RAISE EXCEPTION 'template name is required' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_body_text,'') = '' THEN
    RAISE EXCEPTION 'message body is required' USING ERRCODE = '22023';
  END IF;
  -- Meta's own constraint; catching it here beats a rejection days later.
  IF p_template_name !~ '^[a-z0-9_]{1,512}$' THEN
    RAISE EXCEPTION 'template name must be lowercase letters, numbers and underscores only'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO whatsapp_templates (
    academy_id, kind, template_name, language, category,
    body_text, header_text, footer_text, buttons, var_map, status, updated_at
  ) VALUES (
    v_academy, p_kind, p_template_name, p_language, p_category,
    p_body_text, p_header_text, p_footer_text,
    COALESCE(p_buttons,'[]'::jsonb), COALESCE(p_var_map,'{}'::jsonb), 'draft', now()
  )
  ON CONFLICT (academy_id, kind) WHERE kind IS NOT NULL DO UPDATE SET
    template_name    = EXCLUDED.template_name,
    language         = EXCLUDED.language,
    category         = EXCLUDED.category,
    body_text        = EXCLUDED.body_text,
    header_text      = EXCLUDED.header_text,
    footer_text      = EXCLUDED.footer_text,
    buttons          = EXCLUDED.buttons,
    var_map          = EXCLUDED.var_map,
    status           = 'draft',
    meta_template_id = NULL,
    rejection_reason = NULL,
    submitted_at     = NULL,
    updated_at       = now()
  RETURNING id INTO v_id;

  -- Editing a template disarms its automation: the approved text it was armed
  -- against no longer exists.
  IF p_kind IS NOT NULL THEN
    INSERT INTO whatsapp_automations (academy_id, kind, template_id)
    VALUES (v_academy, p_kind, v_id)
    ON CONFLICT (academy_id, kind) DO UPDATE SET
      template_id = v_id, enabled = FALSE, updated_at = now();
  END IF;

  SELECT row_to_json(t) INTO v_out FROM (
    SELECT id AS template_id, kind, template_name, language, category, body_text,
           header_text, footer_text, buttons, var_map, status AS template_status
    FROM whatsapp_templates WHERE id = v_id
  ) t;
  RETURN v_out;
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 13. Send log and opt-outs
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.secure_whatsapp_log(
  p_token TEXT DEFAULT NULL,
  p_limit INT  DEFAULT 100
) RETURNS SETOF json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);

  RETURN QUERY
  SELECT row_to_json(t) FROM (
    SELECT o.id, o.kind, o.to_phone, o.status, o.skip_reason, o.delivery_status,
           o.error, o.attempts, o.scheduled_for, o.created_at, o.sent_at,
           s.name AS student_name
    FROM whatsapp_outbox o
    LEFT JOIN students s ON s.id = o.student_id
    WHERE o.academy_id = v_academy
    ORDER BY o.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit,100), 1), 500)
  ) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_whatsapp_opt_outs(p_token TEXT DEFAULT NULL)
RETURNS SETOF json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID;
BEGIN
  v_academy := _wa_require_owner(p_token);
  RETURN QUERY
  SELECT row_to_json(t) FROM (
    SELECT phone, opted_out_at, source
    FROM whatsapp_opt_outs WHERE academy_id = v_academy
    ORDER BY opted_out_at DESC
  ) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.secure_whatsapp_opt_out_set(
  p_token TEXT,
  p_phone TEXT,
  p_opted_out BOOLEAN
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_academy UUID; v_digits TEXT;
BEGIN
  v_academy := _wa_require_owner(p_token);

  -- Store digits only, matching normalizePhoneForWhatsApp() on the client.
  -- A stored '+91 98765 43210' would never match an inbound STOP from Meta.
  v_digits := regexp_replace(COALESCE(p_phone,''), '\D', '', 'g');
  IF length(v_digits) < 10 THEN
    RAISE EXCEPTION 'a valid phone number is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_digits) = 10 THEN v_digits := '91' || v_digits; END IF;

  IF p_opted_out THEN
    INSERT INTO whatsapp_opt_outs (academy_id, phone, source)
    VALUES (v_academy, v_digits, 'manual')
    ON CONFLICT (academy_id, phone) DO NOTHING;
  ELSE
    DELETE FROM whatsapp_opt_outs WHERE academy_id = v_academy AND phone = v_digits;
  END IF;

  RETURN json_build_object('phone', v_digits, 'opted_out', p_opted_out);
END;
$$;

-- ════════════════════════════════════════════════════════════════
-- 14. Grants — execute only; the tables themselves stay unreachable
-- ════════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_status(TEXT)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_connect(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_disconnect(TEXT)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_save_settings(TEXT,INT,TIME,TIME,BOOLEAN,INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_automations(TEXT)                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_save_automation(TEXT,TEXT,BOOLEAN,JSONB,TEXT,JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_save_template(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_log(TEXT,INT)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_opt_outs(TEXT)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secure_whatsapp_opt_out_set(TEXT,TEXT,BOOLEAN)      TO anon, authenticated;

-- _wa_require_owner is an internal helper; no client needs to call it directly.
REVOKE ALL ON FUNCTION public._wa_require_owner(TEXT) FROM anon, authenticated;

COMMIT;
