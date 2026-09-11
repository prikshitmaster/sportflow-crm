// Local-timezone calendar dates ("YYYY-MM-DD").
//
// `new Date().toISOString().slice(0, 10)` returns the UTC day. India is
// UTC+5:30, so until 05:30 IST that string is still *yesterday* — early
// morning sessions got stamped on the wrong day, and month-boundary math
// via toISOString() was off by one day. Always use these helpers when a
// calendar date is meant. The DB side mirrors this via ist_today()
// (migration 0097). Full story: docs/08_JUNE_2026_AUDIT.md

const pad = n => String(n).padStart(2, '0')

export function toLocalDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const todayStr = () => toLocalDateStr()

// "YYYY-MM" for the local calendar month.
export function toLocalMonthStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// ── Indian financial year quarters (Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar) ──
// These are the same 3-month buckets as plain calendar quarters (Jan–Mar,
// Apr–Jun, Jul–Sep, Oct–Dec) — only the numbering/labeling differs (Apr–Jun
// is "Q1" of the FY, not calendar Q2). So date-range math needs no special
// April-relative offsetting; only fyQuarterLabel() needs the FY-specific
// quarter number and "YYYY-YY" year.

// Last calendar day of the FY quarter containing `d`.
export function fyQuarterEnd(d) {
  const endMonth = d.getMonth() - (d.getMonth() % 3) + 2
  return new Date(d.getFullYear(), endMonth + 1, 0)
}

// First calendar day of the FY quarter containing `d`.
export function fyQuarterStart(d) {
  const startMonth = d.getMonth() - (d.getMonth() % 3)
  return new Date(d.getFullYear(), startMonth, 1)
}

// How many whole months from `d`'s month through the end of its FY quarter,
// inclusive — 1, 2, or 3. `d` should be the 1st of a month (a coverage start).
export function fyQuarterMonthsRemaining(d) {
  return fyQuarterEnd(d).getMonth() - d.getMonth() + 1
}

// "Q1 FY 2026-27" style label for the FY quarter containing `d`.
export function fyQuarterLabel(d) {
  const m = d.getMonth(), y = d.getFullYear()
  const [q, fyStartYear] =
      m >= 3 && m <= 5  ? [1, y]     // Apr–Jun
    : m >= 6 && m <= 8  ? [2, y]     // Jul–Sep
    : m >= 9 && m <= 11 ? [3, y]     // Oct–Dec
    :                     [4, y - 1] // Jan–Mar
  return `Q${q} FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, '0')}`
}
