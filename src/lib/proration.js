const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Prices a custom [startDate, endDate] date range by the day, instead of
 * leaving it for a human to guess: every calendar month the range touches
 * contributes (days covered ÷ days in that month, or a fixed 30 on the
 * '30day' basis) of one month's fee. A whole calendar month always costs
 * exactly one month regardless of basis — otherwise a 30-day basis would
 * bill February 28/30 and a 31-day month 31/30 even when the student
 * trained the entire month.
 *
 * Single source of truth for this math — originally lived only inside
 * Payments.jsx's custom-coverage-dates flow; Trials.jsx's Convert-to-
 * Student "Custom" fee duration needs the identical calculation, not a
 * second hand-written copy that can drift out of sync with this one.
 *
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate   'YYYY-MM-DD'
 * @param {number} perMonthRate  price of ONE full calendar month
 * @param {'calendar'|'30day'} basis
 * @returns {{segments: Array, fractionalMonths: number, amount: number, totalDays: number, perDayRate: number} | {tooLong: true, monthsSpan: number} | null}
 *   null when the inputs can't be priced (missing dates, reversed range, no rate).
 */
export function computeDateRangeProration(startDate, endDate, perMonthRate, basis = 'calendar') {
  if (!startDate || !endDate || endDate < startDate) return null
  if (!(perMonthRate > 0)) return null

  const start = new Date(startDate + 'T00:00:00')
  const end   = new Date(endDate   + 'T00:00:00')
  const segments = []
  let cur = new Date(start.getFullYear(), start.getMonth(), 1)

  // Hard stop so a fat-fingered year can't spin the loop. Anything past 36
  // months is rejected below rather than priced.
  while (cur <= end && segments.length < 600) {
    const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
    const monthEnd    = new Date(cur.getFullYear(), cur.getMonth(), daysInMonth)
    const from = start > cur      ? start : cur
    const to   = end   < monthEnd ? end   : monthEnd
    const days = Math.round((to - from) / 86400000) + 1
    const basisDays = basis === '30day' ? 30 : daysInMonth
    segments.push({
      label: `${MO[cur.getMonth()]} ${cur.getFullYear()}`,
      days, daysInMonth,
      fraction: days >= daysInMonth ? 1 : Math.min(days / basisDays, 1),
      full: days >= daysInMonth,
      amount: 0,
    })
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }

  // Refuse rather than silently under-charge. Capping the loop at 36 months
  // would price a mistyped 5-year range as 36 months while still handing
  // over the full 60 months of coverage — two free years, no warning.
  if (segments.length > 36) return { tooLong: true, monthsSpan: segments.length }

  const fractionalMonths = segments.reduce((s, x) => s + x.fraction, 0)
  const amount = Math.max(0, Math.round(perMonthRate * fractionalMonths))
  // Per-month rupees are for display only, so the last one absorbs the
  // rounding — otherwise a range covering exactly one quarter shows three
  // ₹4,333 lines against a ₹13,000 total and looks like a bug.
  let acc = 0
  segments.forEach((s, i) => {
    s.amount = i === segments.length - 1 ? amount - acc : Math.round(perMonthRate * s.fraction)
    acc += s.amount
  })
  const firstBasis = basis === '30day' ? 30 : (segments[0]?.daysInMonth || 30)
  return {
    segments, fractionalMonths, amount,
    totalDays:  segments.reduce((s, x) => s + x.days, 0),
    perDayRate: Math.round(perMonthRate / firstBasis),
  }
}
