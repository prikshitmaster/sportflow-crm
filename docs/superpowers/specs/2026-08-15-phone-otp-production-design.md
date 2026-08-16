# Production Phone OTP — Twilio SMS Delivery — Design Spec

**Date:** 2026-08-15
**Status:** Approved — rollout started 2026-08-17. GST/PAN/incorporation
documents confirmed available (owner, 2026-08-17), so the DLT hard-stop in
"Rollout sequence" step 1 is cleared. DLT registration (step 2, the long
pole) has not yet been started.

> **2026-08-17 credential note:** whether the leaked Trial Auth Token from
> 2026-08-15 (see "Credential hygiene" below) was actually rotated is
> unconfirmed as of this update. Treat it as still-leaked until someone
> explicitly verifies the rotation in the Twilio Console — do not assume it
> was handled.

## Goal

A prospect enters their mobile on `/join`, receives a real SMS, types the code,
and is registered. A parent does the same on `/parent-login`. Today neither
delivers anything, because Supabase Auth has no SMS provider configured — the
OTP is generated and stored server-side and then goes nowhere.

This spec covers **delivery only**. It changes no OTP logic, and — by decision
on 2026-08-15 — no application code at all. It is entirely configuration.

## Decisions (from brainstorming)

- **Provider: Twilio Programmable Messaging**, native Supabase integration.
  MSG91 is ~2.5× cheaper (₹0.12–0.15 vs ₹0.30+) but needs a Send SMS Hook edge
  function; Twilio is pure config. Chosen for time-to-ship, accepting the
  running cost. Revisit if monthly volume clears ~5,000 OTPs.
- **Not Twilio Verify.** ₹0.45/check, and it grants no India DLT exemption, so
  it buys convenience that Indian regulation cancels out. It also breaks
  Supabase's free test-OTP numbers.
- **CAPTCHA deferred** (revised 2026-08-15; it was briefly in scope). Ships
  later as its own piece of work. Rate limits and spend caps carry the abuse
  risk alone in the meantime — see *Deferred: CAPTCHA* below for what that
  leaves exposed.
- **Test OTP stays through development** and is removed at launch.

## Findings that shaped this

1. **The app is already built.** `/join` and `/parent-login` both call
   `signInWithOtp` → `verifyOtp`. Supabase generates, stores, and verifies the
   code. Only the delivery leg is missing, and it is configuration, not code.
2. **Login and Register are correctly the same operation.**
   `TrialEnroll.jsx:431` marks the tabs cosmetic; both call `sendCode`.
   `signInWithOtp` creates the user when the number is new. This is right for
   phone auth and should not be "fixed".
3. **India DLT is mandatory and is the critical path.** It applies to OTP SMS,
   not just marketing. Unregistered traffic is dropped silently at the carrier —
   no error, no delivery. Twilio requires the customer to register and then
   submit to Twilio's onboarding queue.
4. **Alphanumeric Sender IDs require a paid Twilio account.** The current
   account is Trial. Upgrading is a prerequisite, not an optimisation.
5. **`captchaToken` is supported on the phone OTP path.** Verified against the
   installed `@supabase/auth-js` 2.105.1 —
   `SignInWithPasswordlessCredentials` (types.d.ts:557-568) accepts
   `options.captchaToken` for `phone`. The public docs only demonstrate
   `signUp`, so this was checked rather than assumed.
6. **There are four OTP send sites, not one.** Missing any leaves an
   unprotected endpoint that still spends money.

## Non-goals

- No change to OTP generation, verification, or session handling.
- No migration to MSG91. Evaluated and deferred; the decision is recorded above.
- Staff and student token auth (`src/lib/auth.js`) are a different system and
  are untouched.
- WhatsApp as an OTP channel. Twilio supports it; out of scope here.

---

## Critical path: DLT registration (external, blocks launch)

Everything else in this spec is hours of work. This is **weeks of calendar
time**, so it starts first.

| Step | Duration |
|---|---|
| Principal Entity registration | 3–7 working days |
| Sender ID / header approval (6 chars) | 2–3 working days |
| Template approval | 3–5 working days *per template* |
| Twilio onboarding submission | 3–7 working days, with back-and-forth |

Cost: ~₹5,900 + GST one-time.

**Documents required:** GST certificate, PAN, certificate of incorporation.

> **Open question — this may be the real blocker.** If the academy is not a
> registered business entity with GST and incorporation documents, DLT
> registration cannot proceed, and *no* provider can legally deliver SMS to
> Indian numbers on the domestic route. Confirm document availability before
> spending anything on Twilio. If they don't exist, the options narrow to
> obtaining them, or shipping without SMS OTP.

**Template correspondence.** The DLT-approved template and Supabase's SMS
message must match exactly. DLT marks variables as `{#var#}`; Supabase emits
`{{ .Code }}`. Register something like:

```
{#var#} is your verification code for Khelit. Do not share it with anyone.
```

and set the Supabase SMS message to the same sentence with `{{ .Code }}` in
that position. A mismatch is silently dropped — this is the single most common
cause of "the code never arrives" once DLT is otherwise complete.

**Consequence to accept:** changing this SMS wording later costs another 3–5
day template approval. Word it once, deliberately.

---

## Part A — Twilio account

1. **Upgrade off Trial.** Required for Alphanumeric Sender ID, and it lifts the
   verified-numbers-only restriction that makes the funnel untestable with real
   prospects.
2. Complete DLT registration, then submit PE ID, header, and templates to
   Twilio onboarding.
3. Enable Alphanumeric Sender ID in the account's SMS settings.
4. **Create a Messaging Service** and add the DLT-approved sender to its pool.
   Copy the `MG…` SID.
5. Collect **Account SID** (`AC…`) and **Auth Token**.

**Credential hygiene:** the Auth Token from the trial account was pasted into a
chat transcript on 2026-08-15 and must be rotated. Production credentials go
into the Supabase dashboard directly and are never committed, logged, or pasted
into chat. Supabase stores the token server-side; the browser never sees it.

## Part B — Supabase configuration

**Dashboard → Authentication → Providers → Phone**

| Field | Value |
|---|---|
| Enable phone provider | on |
| SMS provider | **Twilio** (not Twilio Verify) |
| Account SID | `AC…` |
| Auth Token | rotated token |
| Message Service SID | `MG…` |
| SMS message | Must equal the DLT-approved template, with `{{ .Code }}` |

No application code changes in this part. `db.js:3337` and
`AppContext.jsx:921` keep calling `signInWithOtp` exactly as they do now.

## Part C — Rate limits and hygiene

With CAPTCHA deferred, this section **is** the abuse protection. It is
mandatory, not best-practice.

- **Auth → Rate Limits** — lower SMS-sent-per-hour from the default to
  something matched to real signup volume. This is the ceiling on a bad day.
- **Remove test OTP numbers at launch**, or set `SMS_TEST_OTP_VALID_UNTIL` so
  they expire on their own. A shipped test number is an unauthenticated
  login bypass.
- **Twilio spend alerts** at a threshold well under the payment method's limit.
- Keep the 60-second per-number resend interval.

---

## Deferred: CAPTCHA

**Not in this spec.** Recorded here so the work is specified when it comes back
around, and so the gap is explicit rather than forgotten.

**What deferring costs.** `/join` is a public, unauthenticated endpoint where
each press of "Send OTP" bills a real SMS. With no CAPTCHA, the only things
between a script and your Twilio balance are the Supabase rate limits and spend
alerts in Part C. Those cap the damage per hour; they do not prevent it. Watch
Twilio spend in the first weeks after launch.

The mitigating factor is DLT: an unregistered sender cannot deliver to Indian
numbers at all, so the exposure is real but bounded to your own registered
route, and it begins only when Part A completes.

**When it ships**, the design below is already settled.

**Provider: Cloudflare Turnstile.** Free with no volume ceiling, and its
managed mode is usually invisible — it does not tax a registration funnel the
way an image grid does. hCaptcha is the supported alternative if Turnstile is
unavailable.

**Setup**
- Cloudflare dashboard → Turnstile → create widget → site key + secret key
- Supabase → Settings → Authentication → Bot and Abuse Protection → Enable
  CAPTCHA protection → provider Turnstile → paste **secret key**
- Site key is public and goes in `.env` as `VITE_TURNSTILE_SITE_KEY`
- `npm i @marsidev/react-turnstile`

**Code changes**

| File | Change |
|---|---|
| `src/lib/db.js:3337` | `sendTrialOtp(phoneE164, captchaToken)` → pass `options: { captchaToken }` |
| `src/context/AppContext.jsx:921` | `sendParentOtp(phoneE164, captchaToken)` → same |
| `src/pages/TrialEnroll.jsx:618` | `sendCode` — widget + token |
| `src/pages/TrialEnroll.jsx:647` | `profileSendOtp` — widget + token |
| `src/pages/TrialEnroll.jsx:848` | `gateSend` — widget + token |
| `src/pages/ParentLogin.jsx:29` | `sendCode` — widget + token |

All four send sites need it. `verifyOtp` does **not** take a captchaToken —
only the leg that spends money is protected.

**Token lifecycle — the thing that will cause bugs.** Turnstile tokens are
single-use and expire after ~300 seconds. After every send attempt, success or
failure, the widget must be reset and the stored token cleared. Without this,
"Resend OTP" fails with an opaque captcha error on the second press. A shared
`<OtpCaptcha>` wrapper owning the widget ref, the token state, and the reset is
preferable to repeating the dance at four call sites.

**Failure surface:** if Turnstile cannot load (blocked, offline), the send
button must present a clear error rather than silently posting without a token
and surfacing a raw Supabase error.

---

## Rollout sequence

1. ~~Confirm GST / PAN / incorporation documents exist~~ — **done 2026-08-17,
   confirmed available. Gate cleared.**
2. Begin DLT registration (long pole — start before anything else) — **not
   started yet, this is the next action**
3. Upgrade Twilio off trial
4. DLT approved → Messaging Service + sender configured
5. Supabase provider fields populated
6. End-to-end test on a real handset
7. Remove test OTP numbers, tighten rate limits, enable spend alerts
8. Update `supabase/DEPLOY.md` §2 to record the live configuration

Nothing here touches application code, so there is no build or deploy step.
Steps 1–2 are the only ones with a calendar cost; the rest is an afternoon.

## Verification

This repo has **no automated test coverage** for auth flows (`tests/` does not
exist despite the `package.json` scripts). Verification is manual:

- [ ] Test OTP number logs in on `/join` — free path still works
- [ ] Test OTP number logs in on `/parent-login`
- [ ] Real handset receives SMS, sender shows the DLT header, code verifies
- [ ] Twilio console → Monitor → Logs → Messaging shows `delivered`
- [ ] New number registers; existing number logs in — same button
- [ ] Rate limit trips as configured
- [ ] After launch cleanup: test OTP number no longer logs in

## Risks

| Risk | Mitigation |
|---|---|
| No business documents for DLT | Confirm before spending. Hard gate. |
| Template mismatch → silent drops | Register and configure the wording in one sitting; verify byte-for-byte |
| SMS pumping on `/join` | **Accepted risk** — CAPTCHA deferred by decision. Rate limits + spend alerts (Part C) cap the damage but do not prevent it |
| Copy changes later cost 3–5 days | Finalise SMS wording before registering |
| Trial credentials leaked to chat | Rotate before production use |
