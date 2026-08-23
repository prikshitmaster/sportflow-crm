// Shared ground capacity across batches that occupy the same slot.
//
// THE single source of truth on the client for "how many seats are left",
// the same role studentRules.js plays for "is this student overdue". Every
// screen that shows a seat count must derive it from here, or two screens
// end up quoting different numbers for the same ground.
//
// This file MIRRORS the SQL in supabase/migrations/0184_batch_slots.sql and
// 0185_auto_ground_capacity.sql (_slot_days / _slot_seats / slot_day_load /
// _slot_day_ceiling / _require_batch_capacity). The database is the
// enforcer; this is the preview. If you change the rule in one place,
// change it in the other or the UI will promise seats the server then
// refuses.
//
// ── The rule ────────────────────────────────────────────────────────────
// A slot is a physical ground at a time. There is no manually-typed "ground
// holds X" number (0185 removed it — it was an unknowable guess layered on
// top of numbers that already meant something). Instead, each calendar day
// the slot runs gets an automatic ceiling: the SMALLEST `capacity` among
// every batch in the slot that trains that day. A batch that trains every
// day the slot runs (e.g. a generic "Football" batch, Mon–Sat) is always
// part of that minimum on every day, so it alone can never let the ground
// be double-booked beyond whichever batch is tightest.
//
// Seat-days come from the STUDENT, not the batch:
//
//     Alternate → their batch's days       (an MWF kid → Mon/Wed/Fri)
//     Daily     → every day the slot runs  (all six)
//
// That asymmetry is not a quirk — it is what Attendance.jsx:546 already
// does, granting an "off day" only to Alternate students. A Daily student
// in an MWF batch is expected on Tue/Thu/Sat too, and takes a seat there.
//
// Consequence worth understanding before touching this file: one daily
// student costs SIX seat-days, one alternate student costs three. So a
// batch has two different answers to "how many seats are left" depending
// on who is asking. Both are returned; the UI shows both.

export const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const isAlternate = (s) =>
  String(s?.trainingType ?? 'Daily').trim().toLowerCase() === 'alternate'

const byWeek = (a, b) => WEEK.indexOf(a) - WEEK.indexOf(b)

/** Every day any batch in the slot runs, ordered Mon→Sun. */
export function slotDays(slotBatches) {
  const set = new Set()
  ;(slotBatches || []).forEach(b => (b.days || []).forEach(d => set.add(d)))
  return [...set].sort(byWeek)
}

/**
 * Is this a "Daily" batch — one that trains every day, not just some
 * pattern like MWF/TTS? Reads the explicit `batch.scheduleType` (migration
 * 0186) first, set once by the owner instead of guessed. Falls back to
 * comparing the batch's own days against the GROUP's full day-span only
 * when scheduleType is missing (shouldn't happen post-backfill, but a
 * batch created before 0186's default kicked in is defensive to cover) —
 * that inference is what the fallback used to be the ONLY mechanism, and
 * was fragile: a group of only two MWF batches has no "full week" at all,
 * and adding a new batch to a group could silently change another batch's
 * label depending on the group's day-span, not the batch's own schedule.
 */
export function isFullWeekBatch(batch, groupDays) {
  if (batch?.scheduleType) return batch.scheduleType === 'daily'
  const days = batch?.days || []
  return (groupDays || []).length > 0
    && days.length === groupDays.length
    && groupDays.every(d => days.includes(d))
}

/**
 * Headcount standing on the ground each day.
 *
 * `rosterOf(batch)` must return that batch's ACTIVE students — pass the
 * already-scoped list. Students are de-duplicated per day, because a daily
 * student legitimately sitting in two batches of the same slot is still one
 * body on the ground.
 */
export function computeSlotLoad(slotBatches, rosterOf) {
  const days  = slotDays(slotBatches)
  const seats = new Map(days.map(d => [d, new Set()]))

  ;(slotBatches || []).forEach(batch => {
    ;(rosterOf(batch) || []).forEach(student => {
      const occupies = isAlternate(student) ? (batch.days || []) : days
      occupies.forEach(d => seats.get(d)?.add(student.id))
    })
  })

  const load = {}
  days.forEach(d => { load[d] = seats.get(d).size })
  return { days, load }
}

/**
 * The auto-derived ceiling for each day: the smallest `capacity` among
 * every batch in the slot that trains that day. Mirrors SQL
 * `_slot_day_ceiling`. No batch capacity on that day → Infinity (never
 * blocks — matches the ungrouped/legacy behaviour for a stray day).
 */
export function computeDayCeilings(slotBatches, days) {
  const ceilings = {}
  ;(days || []).forEach(d => {
    const caps = (slotBatches || [])
      .filter(b => (b.days || []).includes(d) && Number.isFinite(b.capacity))
      .map(b => b.capacity)
    ceilings[d] = caps.length ? Math.min(...caps) : Infinity
  })
  return ceilings
}

/**
 * Seats left in one batch — the whole point of this module.
 *
 * Returns BOTH answers, because they genuinely differ:
 *   altFree   — room for an alternate-day student (checks only this batch's days)
 *   dailyFree — room for a daily student (checks every day the slot runs)
 *
 * An MWF batch can be wide open for alternates and completely shut for
 * dailies at the same time, which is exactly the case that made the old
 * per-batch number wrong.
 *
 * `slotBatches` may be empty/absent — an ungrouped batch falls back to its
 * own capacity alone, which is precisely the legacy behaviour.
 */
export function batchSeatInfo({ batch, slotBatches, days, load, ceilings, enrolled }) {
  const cap       = Number.isFinite(batch?.capacity) ? batch.capacity : Infinity
  const batchFree = Math.max(0, cap - (enrolled || 0))

  if (!slotBatches || slotBatches.length === 0) {
    return {
      batchFree,
      altFree:   batchFree,
      dailyFree: batchFree,
      fullDays:  [],
      limitedBy: batchFree === 0 ? 'batch' : null,
    }
  }

  const freeOn = (d) => Math.max(0, (ceilings?.[d] ?? Infinity) - (load?.[d] ?? 0))
  const min    = (list) => list.length ? Math.min(...list.map(freeOn)) : Infinity

  const batchDays = (batch.days || []).filter(d => (days || []).includes(d))
  const altSlot   = min(batchDays)
  const dailySlot = min(days || [])

  const altFree   = Math.min(batchFree, altSlot)
  const dailyFree = Math.min(batchFree, dailySlot)

  return {
    batchFree,
    altFree:   Number.isFinite(altFree)   ? altFree   : batchFree,
    dailyFree: Number.isFinite(dailyFree) ? dailyFree : batchFree,
    // Days at or over the ground's limit — what turns red in the UI and what
    // the server's error message will name.
    fullDays:  (days || []).filter(d => freeOn(d) === 0),
    limitedBy: altFree === 0 ? (batchFree === 0 ? 'batch' : 'ground') : null,
  }
}

// ── Day-pattern labels (display only) ──────────────────────────────────
// Coaches already name these schedules MWF / TTS on the batch cards
// themselves — showing the ground's per-day load as raw weekday names
// ("Mon", "Tue", …) instead just makes the owner re-derive a pattern they
// already picked when they created the batch. Two calendar days collapse
// into one tile whenever the exact same set of (non-full-week) batches
// meets on both — which is also exactly when their headcounts are
// guaranteed identical, so merging them loses no information, only the
// repetition.
const KNOWN_PATTERNS = { 'Mon,Wed,Fri': 'MWF', 'Tue,Thu,Sat': 'TTS' }

function patternLabel(patternDays) {
  return KNOWN_PATTERNS[patternDays.join(',')]
    || patternDays.map(d => d.slice(0, 3)).join('/')
}

/**
 * Collapses per-day rows (one per weekday) into one row per distinct
 * batch-day pattern found in `slotBatches` — an MWF batch sharing a ground
 * with a TTS batch renders as two tiles ("MWF", "TTS"), not six.
 *
 * Pass only the NON-full-week batches here — a batch that runs every day
 * the group spans gets its own explicit "Daily" tile instead (see
 * `isFullWeekBatch`), rather than being silently merged into every pattern.
 */
export function groupRowsByPattern(rows, slotBatches, days, ceilings) {
  const groups = new Map()
  ;(days || []).forEach(d => {
    const activeIds = (slotBatches || [])
      .filter(b => (b.days || []).includes(d))
      .map(b => b.id).sort().join(',')
    if (!groups.has(activeIds)) groups.set(activeIds, [])
    groups.get(activeIds).push(d)
  })
  const rowByDay = new Map((rows || []).map(r => [r.day, r]))
  return [...groups.values()].map(patternDays => {
    const first = rowByDay.get(patternDays[0]) || {}
    return {
      label:    patternLabel(patternDays),
      days:     patternDays,
      occupied: first.occupied, free: first.free, full: first.full, over: first.over,
      cap:      ceilings?.[patternDays[0]],
    }
  })
}

/**
 * One tile per full-week batch — its own enrolled/capacity, with `free`
 * already folding in the ground's tightest day (batchSeatInfo.dailyFree).
 */
export function dailyBatchRows(slotBatchInfos, days) {
  return (slotBatchInfos || [])
    .filter(r => isFullWeekBatch(r.batch, days))
    .map(r => ({
      label:    'Daily',
      batchName: r.batch.name,
      days,
      occupied: r.enrolled,
      free:     r.dailyFree,
      full:     r.dailyFree === 0,
      over:     r.enrolled > r.batch.capacity,
      cap:      r.batch.capacity,
    }))
}

/**
 * Everything the Batches page needs for one slot, in one call.
 *
 * `slotBatches` is every batch pointing at this slot; `rosterOf` and
 * `countOf` supply live enrolment so the preview matches what the server
 * will decide.
 */
export function slotSummary({ slotBatches, rosterOf, countOf }) {
  const { days, load } = computeSlotLoad(slotBatches, rosterOf)
  const ceilings = computeDayCeilings(slotBatches, days)
  const rows = days.map(d => ({
    day:      d,
    occupied: load[d],
    free:     Math.max(0, (ceilings[d] ?? Infinity) - load[d]),
    full:     load[d] >= (ceilings[d] ?? Infinity),
    over:     load[d] > (ceilings[d] ?? Infinity),
  }))

  return {
    days,
    load,
    ceilings,
    rows,
    // Unique bodies across the whole slot — NOT the sum of the day rows, which
    // would count a daily student six times.
    headcount: new Set(
      (slotBatches || []).flatMap(b => (rosterOf(b) || []).map(s => s.id))
    ).size,
    anyFull: rows.some(r => r.full),
    anyOver: rows.some(r => r.over),
    batches: (slotBatches || []).map(b => ({
      batch: b,
      enrolled: countOf(b),
      ...batchSeatInfo({
        batch: b, slotBatches, days, load, ceilings, enrolled: countOf(b),
      }),
    })),
  }
}
