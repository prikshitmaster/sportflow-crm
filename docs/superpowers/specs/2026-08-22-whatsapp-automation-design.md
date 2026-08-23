# WhatsApp Automation — Design Spec

**Date:** 2026-08-22
**Status:** Design approved, pending spec review
**Supersedes:** `2026-08-13-whatsapp-fee-reminders-design.md` (never implemented — see
"Relationship to the 2026-08-13 spec" below)

## Goal

An owner configures, in Settings, which WhatsApp messages the academy sends
automatically, what each one says, and who receives it. The messages then send
themselves — on a schedule and on events — with nobody in the app.

Today none of that exists. The Settings → WhatsApp tab is a visual mock: the
Connect button flips a `useState` boolean, the three template textareas are
`defaultValue` with no `onChange` and no persistence, and Save fires a toast on
a `setTimeout`. There are no `whatsapp*` tables in the database.

## Decisions (from brainstorming, 2026-08-22)

1. **Provider: Meta Cloud API direct.** No BSP platform fee; the inbox and
   template dashboard a BSP sells duplicate screens this CRM already has.
2. **All four automation families in v1** — money, trials & onboarding,
   attendance & schedule, community broadcast.
3. **Fixed catalogue, not a rule builder.** Code owns the list of automations
   and the variable allowlist for each. Settings exposes on/off, timing, the
   template, and an audience filter.
4. **Templates authored in the CRM and submitted to Meta over the API.** The
   owner never opens Business Manager to write a message.
5. **Automatic, with caps and a kill switch.** Trust comes from per-automation
   toggles, a hard daily cap, DB-level dedupe and a visible send log — not from
   making the owner tap.
6. **Event outbox + daily scan.** Every message goes through one queue. DB
   triggers enqueue in the same transaction as the event; a daily scan enqueues
   state-based cadences; one drain worker sends.

## The constraint that shapes everything

WhatsApp does not permit free-text business-initiated messages. Outside a
24-hour window opened by the parent messaging first, only a **Meta-approved
template** with positional variables (`{{1}}`, `{{2}}`) may be sent. A Settings
screen offering a free-text box that "sends automatically" cannot exist — which
is precisely what the current mock tab pretends to offer.

Template **category** is Meta's call, not ours. Utility templates cost roughly
₹0.115–0.145 + 18% GST (call it ₹0.15). Marketing is about 7× that and is
subject to a per-user frequency cap Meta enforces on its side. Wording that
reads promotional gets reclassified as marketing regardless of what we submit,
so the composer warns on promotional phrasing before submission.

## Prerequisites (owner, not code)

The rail is inert until these are done, and none can be automated:

1. A phone number **not currently active on WhatsApp** (consumer or Business
   app). An existing number must be deleted from WhatsApp first. Recommend a
   fresh SIM — see Open risks.
2. Meta Business account → WhatsApp Business Account (WABA) → add and verify
   that number.
3. A payment method in Meta Business Manager.
4. A System User with a **permanent** access token
   (`whatsapp_business_messaging`, `whatsapp_business_management`).
5. The app secret, for webhook signature verification.

Business verification is not a blocker: unverified WABAs send to roughly 250
unique recipients per 24 hours, comfortably above one academy's volume.

Because none of this is obvious, the Settings tab renders these as a **five-step
setup checklist** with per-step links and validation, not as a bare credentials
form (§3.1).

## Scope

**In:** credentials storage, in-CRM template composer + Meta submission +
approval sync, the automation catalogue and its Settings UI, the outbox and its
drain worker, DB-trigger enqueue, the daily scan, the delivery webhook, STOP
handling, community broadcast with audience targeting, send log, opt-out
management, spend guards.

**Out:** AI-drafted message copy, AI audience selection, AI send timing, a
conversational parent-facing bot beyond STOP, inbound message inbox. Long-arrears
chasing stays manual in the existing `WhatsAppBulkModal` (see §2.1, deliberate
gap).

## 0. Prerequisite: grace period becomes real configuration

`ALTER TABLE academies ADD COLUMN suspend_grace_days INT NOT NULL DEFAULT 3`.

`AppContext`'s client-side auto-suspend reads it instead of
`localStorage.sf_suspend_days`, seeded once from the stored value so nobody's
setting silently changes.

This is the fix the feature forces. With grace living in one browser's
localStorage, a `fee_final` message promising "suspension tomorrow" cannot be
trusted, and two owners on two laptops hold different values for the same
academy.

## 1. Data model

Six tables. All writes go through `secure_*` RPCs, owner-only, following the
template in `security-v3/01_actor_branch_helper.sql`.

### 1.1 `whatsapp_accounts` — one row per academy

| column | notes |
|---|---|
| `academy_id` | PK, FK → `academies(id)` ON DELETE CASCADE |
| `phone_number_id` | Meta's id for the sending number |
| `waba_id` | WhatsApp Business Account id |
| `access_token` | System User token |
| `app_secret` | for `X-Hub-Signature-256` verification |
| `display_number` | pretty form, Settings UI only |
| `status` | `disconnected` \| `connected` \| `error` |
| `daily_cap` | INT, default 200 |
| `quiet_start`, `quiet_end` | TIME, default 09:00 / 20:00 IST |
| `paused` | BOOL, global kill switch |
| `last_error`, `created_at`, `updated_at` | |

**RLS: no SELECT policy for any client role.** The token and app secret never
reach a browser. Owners read connection state through
`secure_whatsapp_status(p_academy)`, which returns `display_number`, `status`,
`last_error`, `daily_cap`, quiet hours and `paused` — never the secrets. Writes
go through `secure_whatsapp_connect(...)`. Edge functions read the row with the
service-role key.

Encrypting the token at rest with `pgcrypto` is a documented hardening step,
deliberately **not** in v1: it defends against an attacker who can already read
arbitrary rows as service-role, which is the same access that reads the key.

### 1.2 `whatsapp_templates`

The composer's output. Standalone rather than embedded in the automation row,
because broadcasts need templates with no automation attached, and because a
Meta rejection must not wipe an automation's settings.

`id`, `academy_id`, `kind` (nullable — null for broadcast templates),
`template_name`, `language` (default `en`), `category`
(`utility` \| `marketing`), `body_text`, `header_text`, `footer_text`,
`buttons` (jsonb), `var_map` (jsonb), `meta_template_id`, `status`
(`draft` \| `pending` \| `approved` \| `rejected` \| `paused` \| `disabled`),
`rejection_reason`, `submitted_at`, `checked_at`.

`var_map` maps each positional slot to a variable token:
`{"1": "parent_name", "2": "student_name", "3": "amount", "4": "month"}`.

### 1.3 `whatsapp_automations`

`(academy_id, kind)` unique. `enabled` BOOL, `template_id` FK, `timing` jsonb
(per-kind knobs — `{hour: 9}`, `{offset_days: -1}`, `{min_consecutive: 2}`),
`audience_type`, `audience_ids`, `updated_at`, `updated_by`.

Audience on an **automation** is a narrowing filter, not a recipient list: the
recipient is always the parent of the student the event is about. Only
`batches` and `all` are meaningful here — "send absent alerts for these batches
only". The catalogue marks which kinds expose the filter at all; the rest
render no audience control. Broadcast is the one place audience picks the
recipients themselves (§4).

`audience_type` / `audience_ids` reuse the **exact vocabulary** of
`announcements` and `src/lib/announcementAudience.js` — `all`, `students`,
`staff`, `batches`, `students_list`, `staff_members`. That file exists because
three places once disagreed about who an announcement was for and people got
pinged about content they could not open. A second targeting vocabulary would
reintroduce that class of bug.

### 1.4 `whatsapp_outbox` — the queue *and* the log

`id`, `academy_id`, `kind`, `student_id` (nullable), `trial_id` (nullable),
`to_phone`, `template_id`, `variables` (jsonb), `dedupe_key` (text, UNIQUE),
`scheduled_for` (timestamptz), `status` (`queued` \| `sending` \| `sent` \|
`failed` \| `skipped`), `skip_reason`, `attempts`, `wa_message_id`,
`delivery_status` (`sent` \| `delivered` \| `read` \| `failed`), `error`,
`created_at`, `sent_at`.

One table telling one story, rather than a queue and a log that can disagree.

**Dedupe** is the unique index on `dedupe_key`, formatted
`{kind}:{subject_id}:{period}`, where `period` is:

| kind group | period |
|---|---|
| `fee_due`, `fee_grace`, `fee_final` | `YYYY-MM` |
| `payment_receipt` | payment id |
| `absent_alert` | `YYYY-MM-DD` |
| `trial_*` | trial id |
| `birthday` | `YYYY` |
| `broadcast` | broadcast id |

The 2026-08-13 spec needed an explicit `period` column because
`date_trunc('month', created_at)` is STABLE and Postgres rejects it in an index
expression. A single sender-written key sidesteps that and generalises to all
fourteen automations.

Enqueue is `INSERT ... ON CONFLICT (dedupe_key) DO NOTHING`, so a re-run,
a double-fired trigger and a retried scan are all harmless.

### 1.5 `whatsapp_opt_outs`

`(academy_id, phone)` unique, `opted_out_at`, `source`
(`stop_reply` \| `manual`). Keyed by **phone, not student**, so one STOP covers
every child in that family.

### 1.6 `whatsapp_broadcasts`

`id`, `academy_id`, `branch_id`, `sport`, `template_id`, `audience_type`,
`audience_ids`, `recipient_count`, `sent_count`, `status`, `created_by`,
`created_at`. One row per broadcast, holding the audience snapshot as sent.

## 2. The automation catalogue

Code owns this list, in `src/lib/whatsappCatalogue.js`, which is also the
single source of the per-kind variable allowlist. Settings renders a row per
entry; the owner cannot add, remove or reorder entries.

### 2.1 Money — UTILITY

Let `G = academies.suspend_grace_days` and `diff` = whole days between
`students.paid_till` and today (`diff = 1` on the first day after fees lapse).

| kind | fires | knobs |
|---|---|---|
| `fee_due` | scan, `diff = 1` | on/off, hour |
| `fee_grace` | scan, `diff = ceil(G/2)` | on/off |
| `fee_final` | scan, `diff = G - 1` ("suspension tomorrow") | on/off |
| `payment_receipt` | **event** — payment committed | on/off, attach PDF |
| `suspension_notice` | **event** — status → `Suspended` | on/off |

Suspension itself stays at `diff >= G`, unchanged. Collisions collapse to the
later kind: at `G = 3` the schedule is `fee_due` on day 1 and `fee_final` on
day 2; at `G <= 1` only `fee_due` fires.

Candidates are `status = 'Active'`, `paid_till IS NOT NULL`, not opted out, with
a parent phone. Null `paid_till` is skipped — those are legacy imports.

**Deliberate gap:** a parent whose `diff` has already passed `G` gets nothing
automatic. They are suspended, and the cadence is designed around the moment
fees lapse, not around chasing months-old arrears. That chase stays manual in
`WhatsAppBulkModal`, where a human can judge the situation.

`payment_receipt` replaces the Twilio spike currently firing from
`AppContext.addPayment` (`AppContext.jsx:1593`). That spike is fire-and-forget
from the browser and loses the message if the tab closes; the trigger-enqueued
version is queued in the same transaction as the payment.

### 2.2 Trials & onboarding — UTILITY

| kind | fires | knobs |
|---|---|---|
| `trial_booked` | **event** — `trials` insert | on/off |
| `trial_reminder` | scan — `trial_date` is tomorrow, stage not cancelled | on/off, offset days, hour |
| `trial_no_show` | scan — `trial_date` passed, `stage` still scheduled | on/off, delay days |
| `welcome` | **event** — `students` insert | on/off |

### 2.3 Attendance & schedule — UTILITY, highest volume

| kind | fires | knobs |
|---|---|---|
| `absent_alert` | **event** — attendance marked absent | on/off, **min consecutive absences (default 2)**, send-after time (default 18:00) |
| `schedule_change` | **event** — batch timing changed | on/off |
| `holiday_notice` | **event** — `announcements` row of holiday type | on/off |

`absent_alert` defaults to **2 consecutive absences**, not 1. At 1, a
300-student academy with ordinary attendance sends hundreds of messages a week,
trains parents to ignore the number, and spends the daily cap on noise.

The **send-after time** exists because a coach may mark absent at the start of a
session and correct it when the child arrives late. The trigger enqueues with
`scheduled_for` at that evening time; if the attendance row flips to present
before the drain picks it up, the queued row is marked `skipped`. Without this,
every late arrival generates a wrong message that cannot be recalled.

### 2.4 Community — MARKETING

| kind | fires | knobs |
|---|---|---|
| `birthday` | scan — `students.dob` month-day is today | on/off, hour |
| `broadcast` | manual, own screen (§4) | audience picker |

Both are marketing category at roughly ₹1/message. The Settings row states the
category and estimated cost per send, because the 7× difference is invisible
otherwise.

## 3. Settings → WhatsApp tab

Replaces `WhatsAppTab` at `src/pages/Settings.jsx:764` entirely. Five sections.

### 3.1 Connection

When disconnected, a **five-step checklist** mirroring the Prerequisites, each
step with a link out and a short explanation of why it is needed. The
credentials form is step 5 and stays disabled until the owner ticks the earlier
steps. This is deliberate: a bare "paste your token" form on a screen whose
prerequisites take days to satisfy reads as broken.

When connected: the display number, `status`, Meta's quality rating, the daily
cap and quiet-hours knobs, the global pause switch, a **test send** to the
owner's own number, and Disconnect.

The token field never renders a stored value — `secure_whatsapp_status` cannot
return it. It shows "connected" or empty.

### 3.2 Automations list

Grouped by family. Each row: toggle, name, one-line description, a template
status chip (Draft / Pending / Approved / Rejected), the cost category, the
kind's knobs inline, and **Edit message** which opens the composer.

A row cannot be toggled on while its template is not `approved`. The toggle is
disabled with the reason shown, rather than silently accepting a setting that
cannot take effect.

### 3.3 Message composer (drawer)

- Body textarea with **variable chips** — clicking one inserts the next
  positional slot and records it in `var_map`. Only variables from the kind's
  allowlist are offered.
- Optional header and footer.
- Buttons: for fee kinds, a **dynamic URL button** with base
  `https://khelit.com/pay/` and `{{1}}` = the `payment_links.short_code`. This
  is the sanctioned way to give each parent a different link inside an approved
  template, and it reuses `secure_fetch_payment_link` and `/pay/:shortCode`.
- **Live preview** rendered with a real student's data from the academy, so the
  owner sees the actual message, not `{{1}}`.
- A promotional-phrasing warning before submission.
- **Submit to Meta** → `POST /{waba_id}/message_templates`, row goes `pending`,
  and the UI shows Pending / Approved / Rejected with Meta's rejection reason
  verbatim.

Editing an approved template creates a **new** submission — Meta does not allow
in-place edits of approved templates without re-review. The UI says so before
the owner starts typing.

### 3.4 Send log

Last 100 outbox rows: time, kind, student, phone (masked), status, delivery
status, error. Filter by kind and status. Retry on failed rows. This is the
evidence that replaces "trust me, it sent".

### 3.5 Opt-outs

The list, with manual add and remove, and the source of each.

## 4. Community broadcast

Lives on `Community.jsx`, not in Settings, because that is where announcements
and their audience picker already are. Composing an announcement gains a
**"Also send on WhatsApp"** option; there is also a standalone Broadcast
screen for sends that are not announcements.

Audience uses `audience_type` / `audience_ids` and `announcementAudience.js`,
narrowed by the active branch/sport exactly as announcements are — audience
narrows *within* scope and never widens across branches.

**Recipients are deduplicated by normalised phone**, so a family with three
enrolled children receives one broadcast, not three. This differs from the
per-student automations, where the message is about a specific child and
per-student is correct.

Before sending, the screen shows the resolved recipient count, the category, and
the **estimated cost**. Broadcast is capped at one per phone per week by
default, on top of Meta's own marketing frequency cap.

## 5. Components

### 5.1 `_wa_enqueue(...)` — the enqueue function

A `SECURITY DEFINER` SQL function called by every DB trigger. It no-ops when the
academy is disconnected or paused, the automation is disabled, the template is
not approved, the phone is opted out, or the dedupe key exists. It computes
`scheduled_for`, pushing into the next allowed quiet-hours window.

**It must never fail its calling transaction.** The whole body is wrapped in an
exception handler that logs and returns — a WhatsApp problem must never roll
back a recorded payment or a marked attendance.

### 5.2 Triggers

On `payments` (insert → `payment_receipt`), `trials` (insert → `trial_booked`),
`students` (insert → `welcome`; status → `Suspended` → `suspension_notice`),
`attendance` (insert/update absent → `absent_alert`, gated on the consecutive
count), `batches` (timing change → `schedule_change`), `announcements` (holiday
type → `holiday_notice`).

### 5.3 `whatsapp-scan` (edge function, daily)

Per academy with a connected account: enqueue the state-based kinds —
`fee_due`, `fee_grace`, `fee_final`, `trial_reminder`, `trial_no_show`,
`birthday`. Never throws to the scheduler; logs per-academy failures and
continues.

Supports `?dry_run=1`, which computes and logs the recipient list without
enqueuing. This is how the first cycle gets verified without spending money.

### 5.4 `whatsapp-drain` (edge function, every 2 minutes)

Claims due rows with `FOR UPDATE SKIP LOCKED`, re-checks every guard, POSTs to
`graph.facebook.com/v21.0/{phone_number_id}/messages`, writes back the result.

Every guard is re-evaluated here, not only at enqueue, so a kill switch thrown
after enqueue still stops the message.

### 5.5 `whatsapp-webhook` (edge function)

Verifies `X-Hub-Signature-256` against the app secret — a webhook skipping this
is an open relay for anyone who learns the URL. Handles:

- **status callbacks** → update `whatsapp_outbox.delivery_status`.
- **`message_template_status_update`** → update `whatsapp_templates.status` and
  `rejection_reason`, so approval lands in the UI without polling.
- **inbound messages** → body trimmed and upper-cased equal to `STOP` or
  `UNSUBSCRIBE` inserts an opt-out and replies once to confirm (free: a service
  message inside the 24-hour window the parent just opened). Anything else is
  recorded and ignored.

### 5.6 Scheduler

`pg_cron` + `pg_net`, installed by migration — both are available in this
project but **not currently installed**. Two jobs: `whatsapp-scan` daily at
09:30 IST (04:00 UTC), `whatsapp-drain` every 2 minutes.

Chosen over a GitHub Action because it lives next to the data and does not
depend on the repo or GitHub's queue for something that spends money.
09:30 is deliberate — a fee reminder at 07:00 reads as harassment.

## 6. Guards

| guard | where |
|---|---|
| Per-automation kill switch | `_wa_enqueue` and re-checked in `whatsapp-drain` |
| Global pause | same |
| Daily cap per academy (200) | `whatsapp-drain`, counted from outbox |
| Quiet hours (09:00–20:00 IST) | `scheduled_for` at enqueue |
| Dedupe | unique index on `dedupe_key` |
| Opt-outs | excluded in the enqueue query, not filtered in the UI |
| Template must be `approved` | enqueue and drain both refuse otherwise |
| `var_map` validated against the code allowlist | drain — unknown or missing token **refuses to send** rather than substituting blank |
| Broadcast frequency (1/phone/week) | broadcast composer |
| Dry run | `whatsapp-scan?dry_run=1` |

The `var_map` guard deserves its own note. The 2026-08-13 spec deliberately kept
variable order in code and refused to store it, because a stored order drifting
from Meta's approved template is a silent wrong-message bug — a fee amount
rendered into the student-name slot. Storing `var_map` is unavoidable once the
owner composes templates in the CRM, so the risk is contained instead: the
composer only offers allowlisted variables, and the sender re-validates against
that same code-owned allowlist and refuses rather than guessing.

## 7. Error handling

- Meta 4xx → mark `failed`, store the error, never retry. Auth failures set
  account `status = 'error'` so Settings surfaces it.
- Meta 5xx / network → retry with backoff up to `attempts = 3`, then `failed`.
- Template not approved or unknown → refuse before calling Meta.
- Enqueue failure → swallowed and logged; never rolls back the caller.

## 8. Testing

There is no automated test infrastructure in this repo — `package.json` has
`test` scripts and `playwright.config.ts` points at `./tests`, but that
directory does not exist. So:

- `whatsapp-scan?dry_run=1` output reviewed against the Payments overdue list
  and the Trials list for one full cycle before anything goes live.
- Test-send to the owner's own number for every template.
- `scripts/_test-whatsapp-rls.mjs`, in the style of the existing RLS probes,
  asserting that anon, staff and student roles cannot read
  `whatsapp_accounts.access_token` or `app_secret` by any route.
- `scripts/_test-whatsapp-enqueue.mjs` asserting: dedupe holds under a double
  insert, a disabled automation enqueues nothing, an opted-out phone enqueues
  nothing, and quiet hours push `scheduled_for` correctly.
- Manual: STOP from a real phone; verify the opt-out row and that the next scan
  skips that whole family.

## 9. Rollout order

1. `suspend_grace_days` migration + `AppContext` switch. Independent, shippable
   alone.
2. Tables, RLS, `secure_*` RPCs, RLS probe.
3. `whatsapp-drain` + Connection section + test send. **Proves the rail before
   any parent is involved.**
4. Composer + Meta submission + `message_template_status_update` webhook.
   Templates submitted; wait for approval.
5. Automations list UI + `_wa_enqueue` + triggers, everything toggled off.
6. `whatsapp-scan` in dry-run only; `pg_cron` installed.
7. Money family live. Watch the log for one cycle.
8. Trials, then attendance, then broadcast — one family at a time.
9. Delete `whatsapp-send-test` and the spike call in `AppContext.addPayment`.

## 10. Relationship to the 2026-08-13 spec

That spec covered the sending rail plus fee reminders only, chose Meta Cloud
API, and was approved but never implemented — no `whatsapp*` tables exist and
`pg_cron` is still uninstalled, verified against the live database on
2026-08-22. This spec keeps its provider choice, per-academy credentials,
consent model, fee cadence, deliberate gap and pay-link button, and extends it
to four families, an in-CRM composer and an outbox. It should be treated as
superseded.

## 11. Open risks

- **Number choice is close to irreversible.** A number registered to a WABA
  cannot be used in the normal WhatsApp app. If the academy's main number is
  used, staff lose it as a personal chat line. Recommend a fresh SIM.
- **Template rejection is Meta's call.** Phrasing that sounds promotional gets
  classified as marketing at 7× cost, or rejected outright. The composer warns,
  but cannot guarantee.
- **Fourteen templates is real owner work.** Each needs submitting and
  approving. The rollout order exists so the feature delivers value after the
  first three rather than after all fourteen.
- **Marketing frequency caps are enforced by Meta**, invisibly to us. A
  broadcast may be silently dropped for some recipients; the send log will show
  it as sent. `birthday` and `broadcast` are the only affected kinds.
- **`daily-overdue-check` stays dead** after this work. Deleting it or wiring it
  up is a separate decision; leaving an unscheduled suspension function next to
  a scheduled scan invites someone to assume it runs.
