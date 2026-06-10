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
