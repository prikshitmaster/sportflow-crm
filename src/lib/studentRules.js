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
 * Reports / Payments / Dashboard "outstanding" rule.
 * A student (Active OR Suspended) owes money when paidTill is strictly
 * before their effective anchor date. Suspended students are included
 * because they still owe back-dues accrued before the pause — that's how
 * the AR side of the product works — but effectiveAnchor() stops the clock
 * at suspended_since so paused months themselves don't add new dues.
 */
export function isOutstanding(s, firstOfMonth = firstOfMonthIso()) {
  if (s.status !== 'Active' && s.status !== 'Suspended') return false
  return !!s.paidTill && s.paidTill < effectiveAnchor(s, firstOfMonth)
}

/**
 * Days since paidTill (0 if not overdue, null if no paidTill).
 * Uses calendar-day floor; matches the existing Reports.jsx formula
 * Math.floor((today - paidTill) / 86400000). For Suspended students, the
 * comparison date is frozen at suspended_since so the ageing count stops
 * climbing while the student is paused.
 */
export function daysOverdue(s, today = new Date()) {
  if (!s.paidTill) return null
  const liveToday = today instanceof Date ? today : new Date(today)
  const anchorStr = effectiveAnchor(s, toLocalDateStr(liveToday))
  const anchor = anchorStr === toLocalDateStr(liveToday) ? liveToday : new Date(anchorStr + 'T00:00:00')
  const ms = anchor - new Date(s.paidTill + 'T00:00:00')
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
