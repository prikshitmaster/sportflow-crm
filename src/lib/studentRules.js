import { toLocalDateStr } from './dates'
// Pure domain rules for student financial status.
//
// Why this file exists:
//   The same "is this student overdue?" logic was duplicated across Students,
//   Payments, Reports, and Dashboard pages — with subtle differences (some
//   used today, some firstOfMonth; some included Suspended, some didn't).
//   When the rules drift, the ageing report disagrees with the Payments page
//   and customers lose trust. Centralise here, import everywhere.
//
// Conventions:
//   - All dates are ISO 'YYYY-MM-DD' strings (no Date objects in args).
//   - Functions are pure; pass `today` for testability.
//   - Two distinct flavours of "overdue":
//       isOverdue       — immediate (paidTill < today), Students badge usage
//       isOutstanding   — month-aligned (paidTill < firstOfMonth), Reports/AR
//     Keep them distinct; do not merge.
//   - Suspended (paused) students: isOutstanding/daysOverdue freeze their
//     comparison date at suspended_since instead of the live today/firstOfMonth,
//     via effectiveAnchor(). This stops "owed" figures from growing while a
//     student is paused — pre-existing back-dues from before the pause still
//     show, but no new dues accrue for the paused months themselves.

const MS_PER_DAY = 86_400_000

/**
 * Training type is stored with DIFFERENT casing on either side of the join:
 *   students.training_type   → 'Daily' / 'Alternate'   (capitalised)
 *   fee_plans.training_type  → 'daily' / 'alternate'   (lower-case)
 * Verified in production: 467 'Daily' + 80 'Alternate' students against
 * 2 'daily' + 4 'alternate' plans.
 *
 * A strict `plan.trainingType === student.trainingType` therefore never
 * matched, so fee-plan suggestions silently fell through — batches with one
 * plan offered it even when it was for the other training type (wrong rate),
 * and batches with two plans offered nothing. Always normalise before
 * comparing or labelling. Returns '' when unset.
 */
export function normTrainingType(v) {
  return (v || '').trim().toLowerCase()
}

/**
 * Human label for a training type, from either casing. Returns null when
 * unset so callers can omit the field rather than print a wrong default.
 */
export function trainingTypeLabel(v) {
  const n = normTrainingType(v)
  return n === 'alternate' ? 'Alternate Day' : n === 'daily' ? 'Daily' : null
}

/**
 * ISO date helper. Returns 'YYYY-MM-DD' for the given Date (default: now).
 */
export function todayIso(d = new Date()) {
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
}

/**
 * First-of-current-month ISO date.
 */
export function firstOfMonthIso(d = new Date()) {
  return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}

/**
 * Students-page "Overdue" badge rule.
 * Active student whose paidTill is strictly before today.
 */
export function isOverdue(s, today = todayIso()) {
  return s.status === 'Active' && !!s.paidTill && s.paidTill < today
}

/**
 * "No Payment" badge — Active student with a batch but never paid.
 * Distinct from overdue: a brand-new student should not be flagged Overdue
 * before their first invoice. They're surfaced separately so the operator
 * knows to collect the first fee.
 */
export function isNoPayment(s) {
  return s.status === 'Active' && !!s.batchId && !s.paidTill
}

/**
 * Comparison date to use for outstanding/overdue math. For a Suspended
 * student, freeze at suspended_since (first-of-that-month) so dues stop
 * accruing while paused — pre-existing back-dues from before the pause
 * still count, but the paused months themselves don't add new "owed" time.
 * Non-suspended students (or a Suspended row missing suspendedSince) just
 * use the live anchor unchanged.
 */
function effectiveAnchor(s, liveAnchor) {
  if (s.status === 'Suspended' && s.suspendedSince) {
    const susp = firstOfMonthIso(new Date(s.suspendedSince + 'T00:00:00'))
    return susp < liveAnchor ? susp : liveAnchor
  }
  return liveAnchor
}

/**
 * The date a student is "paid up to" for outstanding/ageing maths.
 *
 * A student who has NEVER paid has no paidTill at all. Treating that as
 * "nothing owed" made them invisible in every financial report — excluded
 * from Reports' Total Outstanding, from the Dashboard overdue figure and
 * from ageing — no matter how long they had been enrolled. Live example
 * before this fix: an Active student on ₹13,000/month, 79 days enrolled,
 * never paid a rupee, appearing in no financial total.
 *
 * So fall back to the day before they joined: they owe from their join
 * month onward. This keeps the documented intent that a brand-new student
 * isn't dunned before their first invoice is due — someone who joined this
 * month still isn't outstanding, because joinDate >= firstOfMonth.
 *
 * Returns null when there is nothing to compare against at all (no paidTill
 * AND no joinDate), so callers can keep treating that as "unknown".
 */
function paidUpTo(s) {
  if (s.paidTill) return s.paidTill
  return s.joinDate || null
}

/**
 * Reports / Payments / Dashboard "outstanding" rule.
 * A student (Active OR Suspended) owes money when paidTill is strictly
 * before their effective anchor date. Suspended students are included
 * because they still owe back-dues accrued before the pause — that's how
 * the AR side of the product works — but effectiveAnchor() stops the clock
 * at suspended_since so paused months themselves don't add new dues.
 */
export function isOutstanding(s, firstOfMonth = firstOfMonthIso()) {
  if (s.status !== 'Active' && s.status !== 'Suspended') return false
  const upTo = paidUpTo(s)
  return !!upTo && upTo < effectiveAnchor(s, firstOfMonth)
}

/**
 * Days since paidTill (0 if not overdue, null if no paidTill).
 * Uses calendar-day floor; matches the existing Reports.jsx formula
 * Math.floor((today - paidTill) / 86400000). For Suspended students, the
 * comparison date is frozen at suspended_since so the ageing count stops
 * climbing while the student is paused.
 */
export function daysOverdue(s, today = new Date()) {
  // Same fallback as isOutstanding — a never-paid student ages from their
  // join date, otherwise they were missing from the ageing report entirely.
  const upTo = paidUpTo(s)
  if (!upTo) return null
  const liveToday = today instanceof Date ? today : new Date(today)
  const anchorStr = effectiveAnchor(s, toLocalDateStr(liveToday))
  const anchor = anchorStr === toLocalDateStr(liveToday) ? liveToday : new Date(anchorStr + 'T00:00:00')
  const ms = anchor - new Date(upTo + 'T00:00:00')
  if (ms <= 0) return 0
  return Math.floor(ms / MS_PER_DAY)
}

/**
 * "Low attendance, fee unpaid" hint — an Active student who is outstanding
 * for the current month AND has fewer than `threshold` attended sessions
 * this month. Surfaced as a suggestion for staff to consider marking them
 * Suspended (skipped) instead of chasing a normal payment — low-attendance
 * unpaid students are often on an informal pause the academy hasn't
 * recorded yet. `sessionCount` is the number of Present/Late days this
 * month; pass null/undefined when attendance hasn't loaded yet (returns
 * false rather than guessing).
 */
export function isLowAttendanceUnpaid(s, sessionCount, firstOfMonth = firstOfMonthIso(), threshold = 4) {
  if (s.status !== 'Active') return false
  if (sessionCount == null) return false
  return sessionCount < threshold && isOutstanding(s, firstOfMonth)
}

/**
 * Ageing bucket label for a number of days overdue.
 * Matches Reports.jsx exactly: 1–30, 31–60, 61–90, 90+.
 */
export function ageingBucket(days) {
  if (days == null) return null
  if (days <= 30) return '1–30 days'
  if (days <= 60) return '31–60 days'
  if (days <= 90) return '61–90 days'
  return '90+ days'
}

/**
 * Ageing bucket sort order (smaller = newer). Used by Reports.jsx ageing table.
 */
export function ageingBucketOrder(days) {
  if (days == null) return 4
  if (days <= 30) return 0
  if (days <= 60) return 1
  if (days <= 90) return 2
  return 3
}
