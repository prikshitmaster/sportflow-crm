# WhatsApp Rail + Automatic Fee Reminders — Design Spec

**Date:** 2026-08-13
**Status:** Approved (pending spec review)

## Goal

Overdue parents get a WhatsApp fee reminder with a pay link, on a schedule, with
nobody in the app. Today that only happens if an owner opens Payments and taps
through `WhatsAppBulkModal` one parent at a time.

This spec covers the **sending rail** and the **one flow that pays for it**.
Everything else discussed (AI drafting, AI targeting, a parent-facing bot, AI
timing) plugs into the same rail and gets its own spec later.

## Decisions (from brainstorming)

- **Provider: Meta Cloud API direct**, not a BSP. ₹0 platform fee versus
  ₹1,500–3,200/month for AiSensy/Interakt/WATI, whose main value — an inbox and
  a template dashboard — duplicates screens this CRM already has. Someone writes
  the integration either way.
- **Per-academy credentials.** Parents see their own academy's number and name;
  each academy pays its own Meta bill. Only ARA gets configured now, but no
  schema change is needed for the second academy.
- **Automatic, with a kill switch.** Sends on schedule. Trust comes from a
  visible send log, per-kind toggles and a hard spend cap — not from making the
  owner tap.
- **Cadence tied to the grace period**, three messages per parent per month
  maximum, nothing after suspension.
- **Consent:** parents already give their number expecting academy contact, so
  existing parents are treated as contactable. A per-phone opt-out is still
  recorded and honoured — Meta requires it.

## Findings that shaped this

1. **Nothing is scheduled today.** `pg_cron` is not installed (`cron.job` does
   not exist), and the only GitHub Action cron is `db-backup.yml`. The
   `daily-overdue-check` edge function has no trigger and is effectively dead
   code. Auto-suspend actually runs **client-side** in `AppContext` when an owner
   opens the app, throttled once per hour per browser.
2. **Two conflicting definitions of overdue are live.** The client suspends at
   `paid_till + sf_suspend_days` (localStorage, default 3). The unused edge
   function suspends on day 8 of the month. Reminders must use one definition or
   they will contradict what the app shows.
3. **Cost is not a constraint.** Fee reminders are *utility* category:
   ~₹0.115–0.145 per message plus 18% GST, call it ₹0.15. A 300-student academy
   with 120 overdue parents at the full three-message cadence is ≈ ₹55/month.
   Marketing category is ~7× that; nothing in this spec sends marketing.
4. `pg_cron`, `pg_net` and `pgsodium` are available but not installed;
   `pgcrypto` is installed.

## Prerequisites (owner, not code)

Cannot be automated, and the rail is inert until they are done:

1. A phone number **not currently active on WhatsApp** (consumer app or WhatsApp
   Business app). An existing number must be deleted from WhatsApp first.
2. Meta Business account → WhatsApp Business Account (WABA) → add and verify that
   number.
3. A payment method in Meta Business Manager.
4. A System User with a **permanent** access token (`whatsapp_business_messaging`,
   `whatsapp_business_management`).
5. Three message templates submitted and approved (§4).

Business verification is **not** a blocker: unverified WABAs can send, capped at
roughly 250 unique recipients per 24 hours. That is more than one academy's
monthly reminder volume, so the feature can run live while verification is
pending.

## Scope

**In:** credentials storage, template mapping, send function, delivery-status
webhook, STOP handling, scheduler, the fee-reminder job, the Settings tab, spend
guards.

**Out:** AI drafting, AI audience targeting, the inbound bot beyond STOP, AI
send timing, event/announcement broadcasts. Long-arrears chasing stays manual on
the existing `WhatsAppBulkModal` (see §6, "deliberate gap").

## 1. Grace period becomes real configuration

`ALTER TABLE academies ADD COLUMN suspend_grace_days INT NOT NULL DEFAULT 3`.

`AppContext`'s auto-suspend reads it instead of `localStorage.sf_suspend_days`,
falling back to the stored value once on migration so nobody's setting silently
changes. The reminder job reads the same column.

This is the fix the feature forces: with grace living in one browser's
localStorage, a reminder promising "suspension tomorrow" cannot be trusted, and
two owners on two laptops can hold different values for the same academy.

## 2. Data model

### `whatsapp_accounts` — one row per academy

| column | notes |
|---|---|
| `academy_id` | PK, FK → `academies(id)` ON DELETE CASCADE |
| `phone_number_id` | Meta's id for the sending number |
| `waba_id` | WhatsApp Business Account id |
| `access_token` | System User token |
| `display_number` | pretty form, for the Settings UI only |
| `status` | `disconnected` \| `connected` \| `error` |
| `last_error`, `created_at`, `updated_at` | |

**RLS: no SELECT policy for any client role.** The token is never sent to a
browser. Owners read connection state through
`secure_whatsapp_status(p_academy)`, which returns `display_number`, `status`,
`last_error` and never the token. Writes go through
`secure_whatsapp_connect(...)`, owner-only, following the `secure_*` template in
`security-v3/01_actor_branch_helper.sql`. Edge functions read the row with the
service-role key.

Encrypting the token at rest with `pgcrypto` and a key held in edge-function env
is a documented hardening step, deliberately **not** in v1: it protects against
an attacker who can already read arbitrary rows as service-role, which is the
same access that would read the key's plaintext usage anyway.

### `whatsapp_templates`

`(academy_id, kind)` unique. `kind` ∈ `fee_due` | `fee_grace` | `fee_final`.
Stores `template_name`, `language` (default `en`), `approved` boolean, and
`checked_at`. Variable order is fixed in code, not stored — a mismatch between
stored order and Meta's approved template is a silent wrong-message bug, and
code is the place that can be reviewed.

### `whatsapp_messages` — the audit trail

`id`, `academy_id`, `student_id` (nullable), `to_phone`, `kind`,
`template_name`, `wa_message_id`, `status` (`queued`|`sent`|`delivered`|`read`|
`failed`), `error`, `period` (`YYYY-MM`, written by the sender), `created_at`,
`updated_at`.

Three jobs: the Settings log, the delivery-status target for the webhook, and
the dedupe key. It replaces `wasSentToday`/`markSentToday` in `lib/whatsapp.js`,
which only know what *this browser* sent — a second laptop re-nags every parent.

Unique index on `(student_id, kind, period)` so a re-run cannot double-send.
The explicit `period` column exists because `date_trunc('month', created_at)` is
STABLE, not IMMUTABLE, and Postgres will not accept it in an index expression —
the constraint has to key off a value the sender writes.

### `whatsapp_opt_outs`

`(academy_id, phone)` unique, plus `opted_out_at`, `source`
(`stop_reply` | `manual`). Keyed by **phone, not student**, so one STOP covers
every child in that family.

## 3. Components

### `whatsapp-send` (edge function)

Input `{ academyId, studentId, kind, toPhone, variables[] }`. Resolves
credentials, refuses to send if the academy is disconnected / the kind is
toggled off / the phone is opted out / the monthly dedupe row exists / the daily
cap is hit, then POSTs to
`graph.facebook.com/v21.0/{phone_number_id}/messages` and writes
`whatsapp_messages`.

Two callers: the scheduled job, and an owner-initiated "send now" from the UI.
Every guard lives here, not in the callers, so a future caller cannot bypass them.

### `whatsapp-webhook` (edge function)

Verifies `X-Hub-Signature-256` against the app secret (a webhook that skips this
is an open relay for anyone who learns the URL). Handles:

- **status callbacks** → update `whatsapp_messages.status`.
- **inbound messages** → if the body trimmed and upper-cased is `STOP` or
  `UNSUBSCRIBE`, insert an opt-out and reply once to confirm (free: it is a
  service message inside the 24-hour window the parent just opened). Anything
  else is recorded and ignored; the bot is a later spec.

### `whatsapp-fee-reminders` (edge function)

Runs daily. Per academy with a connected account: find candidates (§4), send via
`whatsapp-send`, return counts. Never throws to the scheduler — logs per-academy
failures and continues, matching the pattern in the academy-backup design.

Supports `?dry_run=1`, which computes and logs the recipient list without
sending. This is how the first month gets verified without spending money or
messaging a real parent.

### Scheduler

`pg_cron` + `pg_net`, installed by migration, firing
`whatsapp-fee-reminders` daily at 09:30 IST (04:00 UTC). Chosen over a GitHub
Action because it lives next to the data and does not depend on the repo or
GitHub's queue for something that spends money. Morning-but-not-early is
deliberate: a fee reminder at 7am reads as harassment.

## 4. Who gets a message, and when

Let `G = academies.suspend_grace_days`, and `diff` = whole days between
`paid_till` and today (`diff = 1` on the first day after fees lapse).

| kind | fires at | template |
|---|---|---|
| `fee_due` | `diff = 1` | "fees are due" |
| `fee_grace` | `diff = ceil(G/2)` | "still unpaid" |
| `fee_final` | `diff = G - 1` | "suspension tomorrow" |

Suspension itself stays at `diff >= G`, unchanged.

Collisions collapse to the later kind: at `G = 3` the schedule is `fee_due` on
day 1 and `fee_final` on day 2; at `G <= 1` only `fee_due` fires, on the same
day suspension happens.

Candidates are `status = 'Active'`, `paid_till IS NOT NULL`, not opted out, with
a parent phone. Null `paid_till` is skipped — those are legacy imports, the same
exclusion `daily-overdue-check` already makes.

**Deliberate gap:** a parent whose `diff` has already passed `G` gets nothing.
They are suspended, and the cadence is designed around the moment fees lapse,
not around chasing months-old arrears. That chase stays manual through the
existing bulk modal, where a human can judge the situation.

### Templates (submitted to Meta by the owner)

Body variables in fixed order: `{{1}}` parent name, `{{2}}` student name,
`{{3}}` amount, `{{4}}` month. The pay link rides as a **dynamic URL button** —
base `https://khelit.com/pay/`, suffix `{{1}}` = the payment link short code —
which is the sanctioned way to give each parent a different link inside an
approved template. Reuses `secure_fetch_payment_link` and the existing
`/pay/:shortCode` page.

If a student has no active payment link, one is created before sending; a
reminder without a way to pay wastes the message.

## 5. Guards

- **Kill switch** per kind, per academy, in Settings.
- **Daily cap** per academy (default 200), enforced inside `whatsapp-send`. A
  loop bug costs at most ₹30 before it stops.
- **Dedupe** on `(student, kind, month)` at the database level.
- **Opt-outs excluded in the query**, not filtered in the UI.
- **Dry run** for verification without sending.

## 6. Settings → WhatsApp tab

Connect form (phone number id, WABA id, token — write-only), a test-send to the
owner's own number, the three template names with approval state, the three
toggles, the last 50 sends with delivery status, and the opt-out list with a
manual add/remove.

Token field never renders a stored value; it shows "connected" or empty, because
`secure_whatsapp_status` cannot return it.

## 7. Error handling

- Meta 4xx → mark `failed`, store the error, set account `status = 'error'` on
  auth failures so Settings shows it. Never retry a 4xx.
- Meta 5xx / network → mark `failed`; the next day's run picks the parent up
  again only if their `diff` still matches a cadence day. No retry queue in v1 —
  a missed reminder is not worth the complexity of one.
- Unknown template / not approved → refuse before calling Meta.

## 8. Testing

There is no automated test infrastructure in this repo, so:

- `dry_run` output reviewed against the Payments page overdue list for one full
  cycle before enabling.
- Test-send to the owner's own number for each of the three templates.
- A `scripts/_test-whatsapp-rls.mjs` probe in the style of the existing RLS
  probes, asserting that anon and authenticated roles cannot read
  `whatsapp_accounts.access_token` by any route.
- Manual: STOP from a real phone, verify the opt-out row and that the next run
  skips that family.

## 9. Rollout order

1. `suspend_grace_days` migration + `AppContext` switch (independent, shippable
   alone).
2. Tables, RLS, `secure_*` RPCs, RLS probe.
3. `whatsapp-send` + Settings connect form + test-send.
4. Templates submitted to Meta; wait for approval.
5. `whatsapp-webhook` + STOP.
6. `whatsapp-fee-reminders` with `dry_run` only.
7. `pg_cron` schedule, still dry-run, for one cycle.
8. Live.

Steps 1–3 are useful on their own: a connected number and a test-send prove the
rail before any parent is involved.

## 10. Open risks

- **Number choice is irreversible-ish.** A number registered to a WABA cannot be
  used in the normal WhatsApp app. If the academy's main number is used, staff
  lose it as a personal chat line. Recommend a fresh SIM.
- **Template rejection** is Meta's call, not ours, and phrasing that sounds
  promotional gets classified as marketing (7× cost). Templates must read as
  transactional.
- **`daily-overdue-check` stays dead** after this work. Deleting it or wiring it
  up is a separate decision; leaving an unscheduled suspension function next to a
  scheduled reminder function invites someone to assume it runs.
