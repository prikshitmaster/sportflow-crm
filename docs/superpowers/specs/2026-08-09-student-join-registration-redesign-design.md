# Student Join / Registration Funnel — Visual + Structural Redesign

**Date:** 2026-08-09
**Component:** `src/pages/TrialEnroll.jsx` (public `/join` funnel)
**Design reference:** "Ahmedabad Racquet Academy App" mock (mobile prototype)

## Goal

Replace the current plain, generic look of the public self-enrollment funnel with
the mock's rich, mobile-native green design, and adopt its screen structure
(branded login, a "Choose Your Sport" home, sport→branch order, floating bottom
nav), while **preserving the existing, deliberately-hardened backend** (OTP,
per-academy branding, dynamic branches/batches, document upload, anti-spam).

This is **one responsive React build** — web (PWA on Vercel), Android (Capacitor
loads the Vercel URL), and desktop (Electron) all render the same file. There is no
separate "mobile app" codebase.

## Approach

**Restyle `TrialEnroll.jsx` in place.** Keep:
- The permanent routes `/join` (slug hardcoded `ara`) and `/join/:academySlug`
  — the shipped APK has `/join` baked into `enroll-app/capacitor.config.ts`.
- Same default export + `academySlug` prop contract.
- All `db.js` calls: `fetchAcademyBranding`, `fetchPublicTrialBranches`,
  `fetchPublicTrialBatches`, `sendTrialOtp`, `verifyTrialOtp`,
  `uploadPublicTrialDocument`, `submitPublicTrial`.
- The multi-tenant branding model (branding fetched by slug at mount).

## Decisions (locked with user)

1. **Structure:** Full design + Home browse — branded login, Home "Choose Your
   Sport" grid + promo banner, sport→branch order, floating bottom nav shell
   (Home active; Batches/Profile stubbed).
2. **Auth:** Skip-to-browse, OTP at submit — browse without OTP; OTP gate appears
   at Submit if not already verified. Every lead stays phone-verified.
3. **Batch step:** Kept (branch → batch → form), with seats-left/waitlist chips and
   "let the academy pick".
4. **Form fields:** Keep existing backend fields (no schema change) — name,
   parent/guardian name, DOB, age, emergency contact name + phone, medical notes,
   ID document. Styled to the mock's card layout.

## Screen flow

State machine `step`: `login → home → branch → batch → form → confirm`
(plus an OTP-gate overlay reachable from `form`).

| Step | Contents |
|------|----------|
| `login` | Logo, academy name, tagline. `Login / Register` pill tabs (cosmetic; both → phone+OTP). `+91` mobile input → **Send OTP** → 4-digit OTP → **Verify & Continue**. **"Skip for now"** link → go to `home` unauthed. |
| `home` | Green gradient header (logo + short name + avatar glyph), "Choose Your Sport" + subtitle. Branded promo banner placeholder. "All Sports" grid of sport image tiles (dark gradient overlay, name + tag). Floating glass bottom nav: Home (active) · Batches · Profile. Tapping a sport → `branch`. |
| `branch` | White header + back-to-home. "{Sport} Branches". Branch cards: photo, name, location (map pin), "View & Register →". Only branches offering the chosen sport. Tapping → load batches → `batch`. |
| `batch` | White header + back. "{Sport} · {Branch}". Batch rows with days/time and seats-left/waitlist chip. "Not sure yet — let the academy pick" → batchId null. Tapping → `form`. |
| `form` | White header + back, "{Sport} • {Branch}" badge. Cards: **Student Details** (name, DOB, age), **Contact Details** (parent/guardian name, emergency name, emergency phone), **Health Details** (medical notes textarea), **Documents** (ID photo upload). Sticky **Submit Registration**. |
| `confirm` | Green check circle, "Registration Submitted!", "Our team will reach out about {Sport} at {Branch}…", **Back to Home**. |

**Bottom nav** appears **only on `home`** (matches the mock). Batches/Profile render
a lightweight "Coming soon" placeholder within the same frame with the nav still
visible; no real screens built.

## Auth: Skip-to-browse, OTP at submit

- `isAuthed` = a completed phone-OTP Supabase Auth session exists.
- Two entry points to auth:
  - **Login screen:** verify up front → `isAuthed = true` → browse → Submit runs directly.
  - **Skip for now:** browse unauthed → on **Submit**, if `!isAuthed`, show an inline
    **OTP gate** (phone → send OTP → verify). On success `isAuthed = true`, then proceed.
- **Submit sequence:** `[OTP gate if needed] → uploadPublicTrialDocument(file) (if any)
  → submitPublicTrial(...)`. Document upload requires auth (`getUser`), which is
  guaranteed because it runs *after* the OTP gate.
- Server still derives the trial's `phone` from the verified session, never the form.

## Data mapping (sport-first reorder)

`fetchPublicTrialBranches(slug)` returns flat rows `{ id, sportName, branchName,
photoUrl }` — each row is one sport offered at one branch, with its own uuid `id`.

- **Home** lists unique `sportName` values across all rows.
- **Branch** lists rows where `sportName === chosenSport` (each carries its own `id`).
- The chosen row's `id` flows into `fetchPublicTrialBatches(slug, id)` and
  `submitPublicTrial({ branchId: id, ... })` — **exactly as today**. Only the
  grouping order (sport-first vs branch-first) changes. No data-model change.

Auto-skip note: Home and Branch screens are always shown (browse intent). If desired
later, a sport offered at exactly one branch could auto-advance; not included now.

## Backend change (one migration)

**Relax only the two READ RPCs** so browsing works before OTP:
`secure_public_trial_branches_v2` and `secure_public_trial_batches_v2` — remove the
`IF auth.uid() IS NULL THEN RAISE ...` guard. They already `GRANT EXECUTE ... TO anon`.
They expose only public info (sport names, branch names, batch seat counts). All
cross-tenant validation (academy/branch/batch ownership checks) stays intact.

**`secure_submit_public_trial_v2` is unchanged** — still requires `auth.uid()`,
still derives phone from the verified session, still enforces the 4/day anti-spam cap.

- New file: `supabase/migrations/0140_public_trial_reads_anon.sql`, idempotent
  (`CREATE OR REPLACE`), following 0139's style. Signature unchanged (behavior only
  becomes more permissive), so no mid-deploy signature break.
- `db.js` JS wrappers likely need no change (the RPC names/params are the same).

## Visual system

Derived from one per-academy `brand_color` via an extended `deriveShades(hex)`:
- `main` = brand color (ARA target `#1B7A3D`)
- `dark` = darkened main (gradient headers, e.g. `#0E4D26`)
- `light` (~`#E3F3E4`), `border` (`#DCEBDD`), `tint` (`#E7F5E9`) = blends toward white

Fixed near-neutral greens (not brand-derived, for cohesion): text `#12241A`,
page bg `#F5FAF4`, input bg `#F9FCF9`, muted text `#75897C`.

Component language: rounded 12–28px cards, white cards with `#DCEBDD` border, green
CTA (`font-weight:800`, soft shadow `0 8px 18px rgba(27,122,61,0.25)`), uppercase
section labels (`#75897C`, letter-spacing), image tiles with bottom dark gradient,
glassmorphism bottom nav.

**Data step:** set ARA's stored `academies.brand_color = #1B7A3D` (check current
value first) so ARA matches the mock exactly. Other academies keep their own color.

## Out of scope (YAGNI)

- No separate "student photo" field (mock had one — needs schema change; user chose
  keep-existing-fields). Document upload stays.
- Batches/Profile tabs are visual "Coming soon" stubs, not real screens.
- Promo banner is a branded placeholder (no new DB field).

## Files touched

- `src/pages/TrialEnroll.jsx` — full UI rewrite; same exports/props/routes/db calls.
- `supabase/migrations/0140_public_trial_reads_anon.sql` — new; relax the two read RPCs.
- `src/lib/db.js` — only if a wrapper needs adjustment (expected: none).
- Data: ARA `academies.brand_color`.

## Testing / verification

- Web dev (`npm run dev`) at `/join` (slug `ara`): full flow via **Skip** path →
  browse → form → OTP gate → submit → confirm; and via **login OTP-first** path.
- Verify anon can fetch branches/batches after the migration (no "authentication
  required"); verify submit still rejects when unauthenticated.
- Verify branding renders (logo/name/green) and an unknown slug shows "Link not found".
- Responsive check at ~402px width (mobile frame) and desktop.
