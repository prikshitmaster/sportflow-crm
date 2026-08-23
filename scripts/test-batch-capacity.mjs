// Verifies src/lib/batchCapacity.js against the numbers the SQL in
// supabase/migrations/0184_batch_slots.sql produces for the same data.
//
// WHY THIS EXISTS
//   The seat rule is written twice — once in SQL (the enforcer, via triggers)
//   and once in JS (the preview, on the Batches page). If they drift, the UI
//   offers a seat the server then refuses, which reads as a random failure to
//   the owner. This pins them together.
//
//   The fixture is real: it is the live "Full Ground" slot (Evening Under 20
//   Advance MWF + Development TTF), whose per-day load was confirmed against
//   the database as Mon 4, Tue 2, Wed 4, Thu 2, Fri 4, Sat 2.
//
// Run:  node scripts/test-batch-capacity.mjs

import { slotDays, computeSlotLoad, batchSeatInfo, slotSummary } from '../src/lib/batchCapacity.js'

let failures = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${ok ? '' : `\n         got  ${g}\n         want ${w}`}`)
}

// ── Fixture: the live Full Ground slot ────────────────────────────────────
const mwf = { id: 1, name: 'Evening Under 20 Advance MWF',     days: ['Mon', 'Wed', 'Fri'], capacity: 30 }
const ttf = { id: 2, name: 'Evening Under 20 Development TTF', days: ['Tue', 'Thu', 'Sat'], capacity: 30 }

const roster = {
  1: [ { id: 101, trainingType: 'Alternate' },
       { id: 102, trainingType: 'Alternate' },
       { id: 103, trainingType: 'Alternate' } ],
  // The daily student is in the TTF batch but stands on all six days.
  2: [ { id: 201, trainingType: 'Alternate' },
       { id: 202, trainingType: 'Daily'     } ],
}
const members  = [mwf, ttf]
const rosterOf = (b) => roster[b.id] || []
const countOf  = (b) => rosterOf(b).length

console.log('\nslot days')
eq('ordered Mon→Sun, not alphabetically',
   slotDays(members), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])

console.log('\nper-day load (must match the SQL slot_day_load exactly)')
const { days, load } = computeSlotLoad(members, rosterOf)
eq('Full Ground day load', load, { Mon: 4, Tue: 2, Wed: 4, Thu: 2, Fri: 4, Sat: 2 })

console.log('\nthe daily student is the whole point')
eq('daily kid counted on Mon, a day his TTF batch does not run',
   load.Mon, 3 /* MWF alternates */ + 1 /* the daily kid */)
eq('daily kid also counted on his own Tue', load.Tue, 1 + 1)

console.log('\nseats left at cap 4/day — mirrors the 6 SQL guard tests')
const slot = { capPerDay: 4 }
const mwfSeat = batchSeatInfo({ batch: mwf, slot, days, load, enrolled: countOf(mwf) })
const ttfSeat = batchSeatInfo({ batch: ttf, slot, days, load, enrolled: countOf(ttf) })

// SQL test 1: alternate into MWF was BLOCKED (Mon 4/4).
eq('MWF: no room for an alternate (Mon/Wed/Fri all 4/4)', mwfSeat.altFree, 0)
// SQL test 2: alternate into TTF was ALLOWED (Tue 2/4).
eq('TTF: room for an alternate (Tue/Thu/Sat at 2/4)',     ttfSeat.altFree, 2)
// SQL test 3: daily into TTF was BLOCKED by Mon.
eq('TTF: no room for a daily (blocked by Mon 4/4)',       ttfSeat.dailyFree, 0)
eq('and it names Mon/Wed/Fri as the full days',           ttfSeat.fullDays, ['Mon', 'Wed', 'Fri'])
eq('TTF is limited by the ground, not its own capacity',  ttfSeat.limitedBy, null)
eq('MWF is limited by the ground, not its own capacity',  mwfSeat.limitedBy, 'ground')

console.log('\nthe bug this replaces')
// The old tile did: sum of (capacity - enrolled) per batch.
const oldNumber = members.reduce((n, b) => n + (b.capacity - countOf(b)), 0)
eq('old per-batch sum claimed this many free seats', oldNumber, 27 + 28)
eq('tightest real day can take this many more people',
   Math.min(...days.map(d => slot.capPerDay - load[d])), 0)

console.log('\nungrouped batches must behave exactly as before')
const solo = batchSeatInfo({ batch: mwf, slot: null, days, load, enrolled: 3 })
eq('no slot → plain capacity minus enrolled', solo.altFree, 27)
eq('no slot → daily and alternate agree',     solo.dailyFree, 27)
eq('no slot → no day is ever "full"',         solo.fullDays, [])

console.log('\nslotSummary headcount')
const summary = slotSummary({ slot, slotBatches: members, rosterOf, countOf })
eq('counts PEOPLE once, not seat-days', summary.headcount, 5)
eq('flags that some day is full',       summary.anyFull, true)
eq('nothing is over the limit yet',     summary.anyOver, false)

console.log(failures === 0
  ? '\nAll checks passed — JS preview agrees with the SQL enforcer.\n'
  : `\n${failures} check(s) FAILED — the JS mirror has drifted from the SQL.\n`)
process.exit(failures === 0 ? 0 : 1)
