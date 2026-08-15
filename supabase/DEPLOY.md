# Deployment Runbook — Phase 1 (Parents + Razorpay + Backups)

What this rolls out:
- Backup automation (GitHub Actions)
- Parent role (new tables + auth + portal)
- Razorpay payment collection (additive — manual flow unchanged)
- Tenant-isolation helper for new tables (does **not** touch existing anon SELECT)

Nothing in here breaks an existing flow. Order matters only because the
edge functions depend on the migrations.

---

## 1. Run database migrations

In **Supabase Dashboard → SQL Editor**, run in order:

1. `supabase/migrations/0057_parents.sql`
2. `supabase/migrations/0058_razorpay.sql`

Both are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`).
Safe to re-run.

**Verify after each:**
```sql
-- After 0057
SELECT count(*) FROM parents;                 -- should be 0
SELECT current_user_academy_id();             -- NULL if not authenticated, ok

-- After 0058
SELECT column_name FROM information_schema.columns
WHERE table_name = 'payments' AND column_name LIKE 'gateway%';
-- → gateway, gateway_payment_id, gateway_order_id, gateway_signature
```

**Rollback** (if something breaks — none of this is referenced by existing UI yet):
```sql
-- 0058
DROP TABLE IF EXISTS razorpay_events CASCADE;
DROP TABLE IF EXISTS payment_links CASCADE;
DROP TABLE IF EXISTS academy_payment_configs CASCADE;
ALTER TABLE payments
  DROP COLUMN IF EXISTS gateway,
  DROP COLUMN IF EXISTS gateway_payment_id,
  DROP COLUMN IF EXISTS gateway_order_id,
  DROP COLUMN IF EXISTS gateway_signature,
  DROP COLUMN IF EXISTS gst_invoice_no,
  DROP COLUMN IF EXISTS gst_amount;

-- 0057
DROP TABLE IF EXISTS parent_students CASCADE;
DROP TABLE IF EXISTS parents CASCADE;
ALTER TABLE students DROP COLUMN IF EXISTS parent_id;
DROP FUNCTION IF EXISTS current_user_academy_id();
```

---

## 2. Configure Supabase Auth for phone OTP

One setting covers **both** phone-OTP surfaces — parent login (`/parent-login`)
and the public student registration funnel (`/join`). They call the same
primitive: `supabase.auth.signInWithOtp` / `verifyOtp` in `src/lib/db.js`.
Supabase generates, stores, and verifies the code itself; the SMS provider
only carries the message. There is no app code to change when the provider
changes.

In **Supabase Dashboard → Authentication → Providers → Phone**: enable it.

### 2a. Testing — no SMS provider, no cost (current setup)

Map fixed codes to fixed numbers in the **Test OTP** field. When a number
matches, the provider call is skipped entirely — nothing is sent, nothing is
billed, and no Twilio/MSG91 account is needed:

```
9999999999:123456
9888888888:654321
```

Enter `9999999999` on `/join` or `/parent-login`, type `123456`, you're in.

This is enforced server-side and works in production builds, which is why the
old client-side "⚡ Skip OTP (dev only)" buttons were removed — they were a
bypass shipped in the bundle, this isn't.

Set **`SMS_TEST_OTP_VALID_UNTIL`** (ISO 8601) so the test numbers expire on
their own instead of quietly outliving the testing window.

> Test numbers are reported to misbehave under **Twilio Verify** specifically,
> since Verify owns the code lifecycle rather than Supabase. Another reason to
> prefer plain Messaging over Verify — see 2b.

### 2b. Going live — picking a provider

Deferred on purpose: DLT registration is provider-specific, so committing
early locks in the paperwork.

Supabase natively supports **Twilio, Twilio Verify, MessageBird, Vonage,
TextLocal** — and *not* MSG91. Indian providers require the
[Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook):
Supabase still generates and verifies the OTP, but hands it to an edge function
that forwards it to the provider.

| Provider | ~Cost/SMS | Integration | India DLT |
|---|---|---|---|
| **MSG91** | ₹0.12–0.15 | Send SMS Hook (edge function) | MSG91 walks Indian businesses through it |
| Twilio Messaging | ₹0.30+ | Native, config only | You register entity/header/template, submit to Twilio onboarding |
| Twilio Verify | ₹0.45 | Native, config only | Same as above — Verify grants no exemption |

**India DLT is mandatory for all commercial SMS including OTP** — roughly
₹5,900 + GST one-time and 3–7 working days. Unregistered SMS is dropped at the
operator level, so budget that lead time before any real-user launch.

For Twilio Messaging, the registered DLT template must match the Supabase SMS
message body **exactly**, or carriers silently drop the message.

### 2c. Before real users: rate limits + CAPTCHA

`/join` is public and unauthenticated, so "Send OTP" is an open SMS-pumping
target once a paid provider is live. Not urgent while on test OTP (no send =
no spend), but required at launch: tighten **Auth → Rate Limits** and enable
CAPTCHA, which needs a `captchaToken` passed into `signInWithOtp` from
`TrialEnroll.jsx` and `ParentLogin.jsx`.

---

## 3. Deploy edge functions

Required CLI: `npm i -g supabase` (or use the Dashboard upload).

```bash
# From repo root
supabase login
supabase link --project-ref <your-project-ref>

# Set secrets (these are server-only, never expose to the browser)
supabase secrets set RAZORPAY_KEY_SECRET=<your_test_or_live_secret>
supabase secrets set RAZORPAY_WEBHOOK_SECRET=<random_string_min_32_chars>

# Deploy
supabase functions deploy razorpay-create-order
supabase functions deploy razorpay-webhook --no-verify-jwt
```

Note: `razorpay-webhook` is called by Razorpay's servers, not your users — it
must skip JWT verification (`--no-verify-jwt`). It still verifies the HMAC
signature using `RAZORPAY_WEBHOOK_SECRET`.

**Webhook URL** (give this to Razorpay):
```
https://<project-ref>.functions.supabase.co/razorpay-webhook
```

---

## 4. Configure Razorpay

1. Sign up at https://razorpay.com (or use test mode)
2. Dashboard → Settings → API Keys → Generate (note: `key_id` and `key_secret`)
3. Dashboard → Settings → Webhooks → Add new webhook:
   - **URL:** `https://<project-ref>.functions.supabase.co/razorpay-webhook`
   - **Secret:** the same `RAZORPAY_WEBHOOK_SECRET` you set above
   - **Active events:** `payment.captured`, `payment.failed`, `order.paid`

4. In the SportFlow app, sign in as owner → Settings → Payments (UI not yet built; for now insert via SQL):
   ```sql
   SELECT secure_set_payment_config(
     '{"razorpayKeyId":"rzp_test_XXXX","enabled":true,"invoicePrefix":"INV"}'::jsonb,
     NULL  -- owners use auth.uid(), no token needed
   );
   ```
   *Owner Settings UI for this is a Phase 2 polish item.*

---

## 5. Configure backups

In **GitHub repo → Settings → Secrets and variables → Actions**, add:

- `SUPABASE_DB_URL` — go to Supabase → Settings → Database → Connection string (URI format). It looks like:
  ```
  postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres
  ```

The workflow `.github/workflows/db-backup.yml` runs nightly at 02:00 UTC.
Trigger a test run manually: **Actions → DB Backup → Run workflow**.

Backups appear as workflow artifacts (30-day retention by default).

For longer retention or off-GitHub storage, uncomment the S3 block in
`db-backup.yml` and add `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_S3_BUCKET` secrets.

Restore runbook: `supabase/backup/restore.md`

---

## 6. Smoke tests (do these before announcing to users)

### Existing flows must still work
- [ ] Owner logs in, sees Dashboard normally
- [ ] Owner adds a student, marks attendance, records a manual payment
- [ ] Staff/Coach logs in with existing credentials, sees their portal
- [ ] Student logs in with existing credentials, sees their portal

If any of the above breaks → roll back the migration. Nothing here should
have affected these paths, but verify.

### New parent flow
- [ ] Owner runs in the SQL editor:
  ```sql
  SELECT secure_create_parent('Test Parent', '+919999999999', 'test@example.com', <a_real_student_id>, 'father', NULL);
  ```
- [ ] Visit `/parent-login` → enter `9999999999` → enter the Test OTP code
      configured in step 2a (no SMS is sent)
- [ ] Verify OTP → land on `/parent/home` → see the test student card

### Student registration flow (`/join`)
- [ ] Visit `/join/<academy-slug>` → enter `9999999999` → Send OTP
- [ ] Enter the Test OTP code → funnel proceeds without an SMS provider
- [ ] Confirm no "Skip OTP" button appears in any build

### New Razorpay flow (test mode)
- [ ] On `/payments` page, click "Send Pay Link"
- [ ] Pick a student, set amount → generate link
- [ ] Open the link in incognito → `/pay/<shortCode>` renders the amount
- [ ] Click Pay → Razorpay Checkout opens
- [ ] Use Razorpay test card `4111 1111 1111 1111`, any future expiry, any CVV
- [ ] Within ~5s, the webhook fires → check `razorpay_events` table → `status = 'processed'`
- [ ] Check `payments` table → new row with `gateway = 'razorpay'` and the correct amount
- [ ] Refresh Payments page → the new payment appears

### Backup
- [ ] Trigger the GitHub Action manually → check it succeeds → download the artifact

---

## 7. Known not-yet-built (Phase 2)

These are intentionally out of scope for this rollout:

- **Owner UI** for managing parents (linking, viewing claimed status). Owner must use SQL or wait for the Phase 2 UI in Students.jsx.
- **Owner UI** for setting Razorpay key (currently SQL only — see step 4).
- **Parent multi-academy support** (one phone at multiple academies). Schema supports it; UI assumes one academy per parent for now.
- **GST invoice PDF generation.** Schema is ready (`gst_invoice_no`, `gst_amount`), generation is Phase 2.
- **Razorpay Route / Connect** for per-academy payouts. Currently all payments go to the platform Razorpay account (you). Adding `razorpay_account_id` in `academy_payment_configs` enables Route — wired in `razorpay-create-order` but disabled by default.

---

## 8. Rollback ordering (if you need to fully revert)

If a smoke test fails and you want to fully undo:

1. **Disable** the Razorpay webhook in Razorpay Dashboard (so retries stop)
2. Drop the edge functions: `supabase functions delete razorpay-create-order razorpay-webhook`
3. Run the rollback SQL from §1
4. Remove the new frontend code (git revert the commit)
5. Re-deploy the frontend

Existing data is untouched by any of this.
