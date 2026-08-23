// Verifies src/lib/batchCapacity.js against the numbers the SQL in
// supabase/migrations/0184_batch_slots.sql + 0185_auto_ground_capacity.sql
// produces for the same data.
//
// WHY THIS EXISTS
//   The seat rule is written twice — once in SQL (the enforcer, via triggers)
//   and once in JS (the preview, on the Batches page). If they drift, the UI
//   offers a seat the server then refuses, which reads as a random failure to
//   the owner. This pins them together.
//
//   0185 removed the manually-typed "ground holds X" number entirely. Each
//   day's ceiling is now auto-derived: the smallest `capacity` among every
//   batch in the slot that trains that day. The fixtures below are the two
//   worked examples the design was built from in conversation.
//
// Run:  node scripts/test-batch-capacity.mjs

import {
  slotDays, computeSlotLoad, computeDayCeilings, isFullWeekBatch,
  batchSeatInfo, slotSummary, groupRowsByPattern, dailyBatchRows,
} from '../src/lib/batchCapacity.js'

let failures = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n         got  ${g}\n         want ${w}`}`)
}

// ── Worked example 1: the "4 is the Daily limit" conversation ────────────
// TTS cap 10, enrolled 5 → 5 free. MWF cap 10, enrolled 6 → 4 free. A kid
// who trains every day can only get as many spots as the tighter allows.
console.log('\nworked example: TTS(10)/5 + MWF(10)/6 → Daily limit 4')
{
  const tts = { id: 1, name: 'TTS', days: ['Tue', 'Thu', 'Sat'], capacity: 10 }
  const mwf = { id: 2, name: 'MWF', days: ['Mon', 'Wed', 'Fri'], capacity: 10 }
  const roster = {
    1: Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, trainingType: 'Alternate' })),
    2: Array.from({ length: 6 }, (_, i) => ({ id: 200 + i, trainingType: 'Alternate' })),
  }
  const members  = [tts, mwf]
  const rosterOf = (b) => roster[b.id] || []
  const countOf  = (b) => rosterOf(b).length

  const { days, load } = computeSlotLoad(members, rosterOf)
  const ceilings = computeDayCeilings(members, days)
  eq('no manual number: ceiling = smallest capacity active that day', ceilings,
     { Mon: 10, Tue: 10, Wed: 10, Thu: 10, Fri: 10, Sat: 10 })

  const ttsSeat = batchSeatInfo({ batch: tts, slotBatches: members, days, load, ceilings, enrolled: countOf(tts) })
  const mwfSeat = batchSeatInfo({ batch: mwf, slotBatches: members, days, load, ceilings, enrolled: countOf(mwf) })
  eq('TTS free (own days only)', ttsSeat.altFree, 5)
  eq('MWF free (own days only)', mwfSeat.altFree, 4)
  // Neither batch alone spans every day, so there is no "Daily" batch here —
  // dailyFree on either pattern batch is bounded by the OTHER pattern's days
  // too, since a Daily student would stand on both.
  eq('a Daily-type enrolment is capped by the tighter pattern', Math.min(ttsSeat.dailyFree, mwfSeat.dailyFree), 4)
}

// ── Worked example 2: "Weekend Special" — the general case ───────────────
// A batch training only Sat+Sun, capacity 15, added to a group that
// otherwise runs Mon–Sat. Saturday already has TTS(32) + Football(20); the
// new batch's 15 should become Saturday's ceiling automatically.
console.log('\nworked example: a random 2-day batch tightens only the days it shares')
{
  const tts      = { id: 1, name: 'TTS',            days: ['Tue', 'Thu', 'Sat'],               capacity: 32 }
  const mwf      = { id: 2, name: 'MWF',            days: ['Mon', 'Wed', 'Fri'],               capacity: 20 }
  const football = { id: 3, name: 'Football',       days: ['Mon','Tue','Wed','Thu','Fri','Sat'], capacity: 20 }
  const weekend  = { id: 4, name: 'Weekend Special', days: ['Sat', 'Sun'],                       capacity: 15 }
  const noRoster = () => []
  const members  = [tts, mwf, football, weekend]

  const groupDays = slotDays(members)
  eq('group now spans all 7 days', groupDays, ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])

  const ceilings = computeDayCeilings(members, groupDays)
  eq('Saturday ceiling drops to 15 (Weekend Special is smallest there)', ceilings.Sat, 15)
  eq('Sunday ceiling is 15 (only Weekend Special runs that day)',        ceilings.Sun, 15)
  eq('Monday ceiling stays 20 (MWF/Football, untouched by the new batch)', ceilings.Mon, 20)
  eq('Tuesday ceiling stays 20 (TTS/Football, untouched)',                 ceilings.Tue, 20)

  // Adding Weekend Special stretches the group to 7 days — Football (Mon–Sat)
  // no longer covers EVERY group day, so it stops being auto-detected as
  // "Daily" the moment a 7th day enters the picture. Confirm that against
  // the tighter 6-day group (no Sunday) where Football genuinely is full-week.
  const sixDayGroup = slotDays([tts, mwf, football])
  eq('Football IS Daily in a plain 6-day group', isFullWeekBatch(football, sixDayGroup), true)
  eq('...but NOT once a 7th day (Sunday) joins the group', isFullWeekBatch(football, groupDays), false)
  eq('Weekend Special does NOT span every day → not Daily',  isFullWeekBatch(weekend, groupDays), false)
  eq('TTS does not span every day → not Daily',               isFullWeekBatch(tts, groupDays), false)

  // Pattern tiles are built from ALL non-full-week batches (here, that's
  // everyone — nothing spans all 7 days). Saturday now differs from
  // Tue/Thu structurally (Weekend Special also trains Saturday), so it
  // correctly splits off into its own tile instead of merging into "TTS" —
  // merging them would hide that Saturday has a tighter real ceiling.
  const { load } = computeSlotLoad(members, noRoster)
  const rows = groupDays.map(d => ({ day: d, occupied: load[d], free: ceilings[d] - load[d], full: false, over: false }))
  const patternRows = groupRowsByPattern(rows, members, groupDays, ceilings)
  eq('Saturday splits off from Tue/Thu — it is not really the same pattern anymore',
     patternRows.map(r => r.label).sort(), ['MWF', 'Sat', 'Sun', 'Tue/Thu'])
  const satRow   = patternRows.find(r => r.label === 'Sat')
  const tueRow   = patternRows.find(r => r.label === 'Tue/Thu')
  eq('Saturday\'s real ceiling (15) differs from Tue/Thu\'s (20) — proof they must not merge',
     [satRow.cap, tueRow.cap], [15, 20])
}

console.log('\nungrouped batches must behave exactly as before')
{
  const solo = batchSeatInfo({ batch: { capacity: 30 }, slotBatches: [], days: [], load: {}, ceilings: {}, enrolled: 3 })
  eq('no slot → plain capacity minus enrolled', solo.altFree, 27)
  eq('no slot → daily and alternate agree',     solo.dailyFree, 27)
  eq('no slot → no day is ever "full"',         solo.fullDays, [])
}

console.log('\nslotSummary / dailyBatchRows — the live "evening" shape')
{
  const tts      = { id: 5,   name: 'Evening Under 20 Development TTF', days: ['Tue','Thu','Sat'], capacity: 32 }
  const mwf      = { id: 6,   name: 'Under 15 advance MWF',             days: ['Mon','Wed','Fri'], capacity: 20 }
  const football = { id: 157, name: 'Football',                        days: ['Mon','Tue','Wed','Thu','Fri','Sat'], capacity: 20 }
  const roster = {
    5:   [{ id: 1, trainingType: 'Alternate' }, { id: 2, trainingType: 'Alternate' }],
    6:   [{ id: 3, trainingType: 'Alternate' }],
    157: [],
  }
  const members  = [tts, mwf, football]
  const rosterOf = (b) => roster[b.id] || []
  const countOf  = (b) => rosterOf(b).length

  const summary = slotSummary({ slotBatches: members, rosterOf, countOf })
  eq('counts PEOPLE once, not seat-days', summary.headcount, 3)
  eq('every day ceiling is 20 (Football is always the smallest)',
     summary.days.every(d => summary.ceilings[d] === 20), true)

  const daily = dailyBatchRows(summary.batches, summary.days)
  eq('exactly one Daily tile (Football)', daily.length, 1)
  eq('Daily tile carries the batch name', daily[0].batchName, 'Football')
  // Football itself has 0 enrolled, but it shares every day with TTS/MWF's
  // ALREADY-enrolled kids (2 on Tue/Thu/Sat, 1 on Mon/Wed/Fri) — a NEW daily
  // enrolment is bounded by the tightest of those days (20 - 2 = 18), not by
  // Football's own empty roster. This is the whole point of the feature.
  eq('Football\'s free seats are bounded by the busiest shared day (18), not its own empty roster',
     daily[0].free, 18)
}

// ── scheduleType (0186) is authoritative — the old day-count inference is
// only a fallback for batches somehow missing it. Both fixtures below
// deliberately CONTRADICT what day-count would infer, to prove the explicit
// flag wins, not the guess.
console.log('\nscheduleType (0186) overrides the old day-count guess')
{
  const declaredDaily = { name: 'New Batch', scheduleType: 'daily', days: ['Mon', 'Wed', 'Fri'] }
  eq('3-day batch explicitly marked Daily → still Daily (owner said so)',
     isFullWeekBatch(declaredDaily, ['Mon', 'Wed', 'Fri']), true)

  const declaredAlternate = { name: 'Old Batch', scheduleType: 'alternate', days: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] }
  eq('7-day batch explicitly marked Alternate → NOT Daily (owner said so)',
     isFullWeekBatch(declaredAlternate, ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']), false)

  const noFlag = { name: 'Pre-0186 stray row', days: ['Mon','Tue','Wed','Thu','Fri','Sat'] }
  eq('missing scheduleType still falls back to the day-count guess',
     isFullWeekBatch(noFlag, ['Mon','Tue','Wed','Thu','Fri','Sat']), true)
}

console.log(failures === 0
  ? '\nAll checks passed — JS preview agrees with the SQL enforcer.\n'
  : `\n${failures} check(s) FAILED — the JS mirror has drifted from the SQL.\n`)
process.exit(failures === 0 ? 0 : 1)
