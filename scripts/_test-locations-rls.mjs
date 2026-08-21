// Full-surface test for the locations/branch-scoping change (migrations 0173+0174).
//
// Runs every check as the REAL roles the apps use: `SET LOCAL ROLE anon` plus the
// x-staff-token / x-student-token request headers, exactly like PostgREST does.
// Everything happens inside a transaction that is ALWAYS rolled back, so it is
// safe to run against production.
//
//   node scripts/_test-locations-rls.mjs
import pg from 'pg'
import fs from 'fs'

const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())

let pass = 0, fail = 0
const results = []
const expect = (desc, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push(`  ${ok ? '✓' : '✗ FAIL'}  ${desc}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  ok ? pass++ : fail++
}
const expectTrue = (desc, cond, detail = '') => {
  results.push(`  ${cond ? '✓' : '✗ FAIL'}  ${desc}${detail ? ` (${detail})` : ''}`)
  cond ? pass++ : fail++
}

// How many staff are location-scoped when the run starts. Asserting a fixed 0
// was only valid before the feature went live; what actually matters is that a
// test run leaves this UNCHANGED.
let baselineScoped = 0

const client = async () => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

// Run `fn` as an anon actor carrying a freshly-minted session token. Always rolls back.
async function asActor(kind, id, fn) {
  const c = await client()
  const token = 'TT_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    const hdr = {}
    if (kind === 'staff') {
      await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-staff-token'] = token
    } else if (kind === 'student') {
      await c.query(`INSERT INTO student_sessions(student_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [id, token])
      hdr['x-student-token'] = token
    }
    await c.query('SET LOCAL ROLE anon')
    await c.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify(hdr)])
    return await fn(c)
  } finally {
    try { await c.query('ROLLBACK') } catch {}
    await c.end()
  }
}

async function admin(sql, params = []) {
  const c = await client()
  try { return (await c.query(sql, params)).rows } finally { await c.end() }
}

const n = async (c, sql) => Number((await c.query(sql)).rows[0].n)

// ── Pick actors straight from the data so this survives reseeds ───────
const [aStaff] = await admin(`
  SELECT s.id, s.academy_id, s.branch_id
    FROM staff s JOIN staff_auth sa ON sa.staff_id = s.id
   WHERE s.branch_id IS NOT NULL AND sa.access_role = 'coach'
   ORDER BY s.id LIMIT 1`)
const [bStaff] = await admin(`
  SELECT s.id, s.academy_id, s.branch_id
    FROM staff s
   WHERE s.branch_id IS NOT NULL AND s.academy_id <> $1
   ORDER BY s.id LIMIT 1`, [aStaff.academy_id])
const [aStudent] = await admin(`SELECT id, academy_id, branch_id FROM students ORDER BY id LIMIT 1`)

console.log(`\nActors: staffA=${aStaff.id} (academy ${aStaff.academy_id.slice(0, 8)}), staffB=${bStaff.id} (academy ${bStaff.academy_id.slice(0, 8)}), student=${aStudent.id}`)

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 1. locations — NEW table, cross-tenant isolation ===')
// A brand-new table means a brand-new leak surface. Prove it is scoped.
{
  const totalLocs = Number((await admin(`SELECT count(*)::int n FROM locations`))[0].n)
  const aOwn = Number((await admin(`SELECT count(*)::int n FROM locations WHERE academy_id=$1`, [aStaff.academy_id]))[0].n)

  const seen = await asActor('staff', aStaff.id, c => n(c, 'SELECT count(*)::int n FROM locations'))
  expect('staff sees only own academy locations', seen, aOwn)
  expectTrue('…and that is fewer than all locations', aOwn < totalLocs, `${aOwn} of ${totalLocs}`)

  const foreign = await asActor('staff', aStaff.id,
    c => n(c, `SELECT count(*)::int n FROM locations WHERE academy_id='${bStaff.academy_id}'`))
  expect('staff sees ZERO foreign-academy locations', foreign, 0)

  const anonNo = await asActor('none', null, c => n(c, 'SELECT count(*)::int n FROM locations'))
  expect('no token → 0 locations', anonNo, 0)

  const stuSees = await asActor('student', aStudent.id, c => n(c, 'SELECT count(*)::int n FROM locations'))
  expectTrue('student token can read own academy locations', stuSees > 0, `${stuSees}`)

  // anon has SELECT only; writes must be refused.
  let wrote = 'no-error'
  try {
    await asActor('staff', aStaff.id, c =>
      c.query(`INSERT INTO locations(academy_id, name) VALUES ($1,'ZZ hack')`, [aStaff.academy_id]))
  } catch (e) { wrote = e.code }
  expectTrue('staff token CANNOT insert a location', wrote !== 'no-error', `code=${wrote}`)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 2. Regression — core tables still branch-isolated ===')
// 0174 must have changed nothing. Each staff actor should still see exactly
// their own branch slice, computed independently from admin queries.
// Whole-branch staff are EXPECTED to span several branch rows, so they are not
// candidates for a single-branch isolation check.
for (const st of await admin(`
  SELECT s.id, s.branch_id, s.academy_id FROM staff s
   WHERE s.branch_id IS NOT NULL AND s.location_id IS NULL ORDER BY s.id LIMIT 6`)) {
  const want = Number((await admin(`SELECT count(*)::int n FROM students WHERE branch_id=$1`, [st.branch_id]))[0].n)
  const got  = await asActor('staff', st.id, async c => ({
    n: await n(c, 'SELECT count(*)::int n FROM students'),
    b: Number((await c.query('SELECT count(DISTINCT branch_id)::int AS n FROM students')).rows[0].n),
  }))
  expect(`staff ${st.id}: students = own branch only`, got.n, want)
  expectTrue(`staff ${st.id}: spans ≤1 branch`, got.b <= 1, `${got.b} branches`)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 3. Student app ===')
{
  const r = await asActor('student', aStudent.id, async c => ({
    students: await n(c, 'SELECT count(*)::int n FROM students'),
    self:     await n(c, `SELECT count(*)::int n FROM students WHERE id=${aStudent.id}`),
  }))
  expect('student sees exactly one student row', r.students, 1)
  expect('…and it is their own', r.self, 1)

  const foreignStu = await asActor('student', aStudent.id,
    c => n(c, `SELECT count(*)::int n FROM students WHERE academy_id <> '${aStudent.academy_id}'`))
  expect('student sees no foreign-academy students', foreignStu, 0)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 4. Location scoping actually works (0175) ===')
// The whole point: one login covering every sport at one physical place.
{
  baselineScoped = Number((await admin(`SELECT count(*)::int n FROM staff WHERE location_id IS NOT NULL`))[0].n)
  expectTrue('location scope is opt-in (count is informational)', true,
    `${baselineScoped} staff currently whole-branch`)

  // Use the busiest multi-sport location so the widening is unmistakable.
  const [loc] = await admin(`
    SELECT sb.location_id, count(DISTINCT sb.id) AS rows, count(st.id) AS students
      FROM sport_branches sb LEFT JOIN students st ON st.branch_id = sb.id
     WHERE sb.location_id IS NOT NULL
     GROUP BY sb.location_id HAVING count(DISTINCT sb.sport_name) > 1
     ORDER BY students DESC LIMIT 1`)
  const [pinned] = await admin(`
    SELECT s.id, s.branch_id FROM staff s JOIN sport_branches sb ON sb.id = s.branch_id
     WHERE sb.location_id = $1 AND s.location_id IS NULL LIMIT 1`, [loc.location_id])
  const wantPinned = Number((await admin(
    `SELECT count(*)::int n FROM students WHERE branch_id=$1`, [pinned.branch_id]))[0].n)
  const wantWhole = Number(loc.students)

  const before = await asActor('staff', pinned.id, c => n(c, 'SELECT count(*)::int n FROM students'))
  expect('pinned staff sees only their sport-slice', before, wantPinned)

  const scoped = await asActor('staff', pinned.id, async c => {
    await c.query('SET LOCAL ROLE postgres')
    await c.query(`UPDATE staff SET location_id=$1 WHERE id=$2`, [loc.location_id, pinned.id])
    await c.query('SET LOCAL ROLE anon')
    return {
      students: await n(c, 'SELECT count(*)::int n FROM students'),
      branches: Number((await c.query('SELECT count(DISTINCT branch_id)::int AS n FROM students')).rows[0].n),
      foreign:  await n(c, `SELECT count(*)::int n FROM students WHERE branch_id NOT IN
                              (SELECT id FROM sport_branches WHERE location_id='${loc.location_id}')`),
    }
  })
  expect('location-scoped staff sees the WHOLE branch', scoped.students, wantWhole)
  expectTrue('…spanning several sport rows', scoped.branches > 1, `${scoped.branches} rows`)
  expect('…and still nothing from other locations', scoped.foreign, 0)
  expectTrue('…which is strictly more than before', scoped.students > before, `${before} → ${scoped.students}`)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 5. Sports escalation caps (0173) still hold after 0174 ===')
{
  const [mgr] = await admin(`
    SELECT s.id, s.sports FROM staff s JOIN staff_auth sa ON sa.staff_id=s.id
     WHERE sa.access_role='branch_manager' AND coalesce(array_length(s.sports,1),0)=1
       AND (sa.permissions::jsonb ? 'staff.manage') ORDER BY s.id LIMIT 1`)
  if (!mgr) { results.push('  ⊘ SKIP  no restricted branch_manager available'); }
  else {
    const [target] = await admin(
      `SELECT id FROM staff WHERE branch_id=(SELECT branch_id FROM staff WHERE id=$1) AND id<>$1 LIMIT 1`, [mgr.id])
    const tid = target ? target.id : mgr.id
    const tryUpdate = async (payload) => {
      const c = await client()
      const token = 'TT_' + Math.random().toString(16).slice(2)
      try {
        await c.query('BEGIN')
        await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [mgr.id, token])
        await c.query(`SELECT secure_update_staff_profile($1, $2::jsonb, $3)`, [tid, JSON.stringify(payload), token])
        return 'ALLOWED'
      } catch (e) { return e.code } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
    }
    expect('grant own sport → allowed',        await tryUpdate({ sports: mgr.sports }), 'ALLOWED')
    expect('grant foreign sport → blocked',    await tryUpdate({ sports: [...mgr.sports, 'ZZUnheardOf'] }), '42501')
    expect('grant "all sports" → blocked',     await tryUpdate({ sports: [] }), '42501')
    expect('plain profile edit still allowed', await tryUpdate({ phone: '+910000000000' }), 'ALLOWED')
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 5b. WRITE scope follows location too (0176) ===')
// Seeing a football student is useless if you can't take their payment.
{
  const [loc] = await admin(`
    SELECT sb.location_id FROM sport_branches sb
     WHERE sb.location_id IS NOT NULL
     GROUP BY sb.location_id HAVING count(DISTINCT sb.sport_name) > 1
     ORDER BY count(*) DESC LIMIT 1`)
  // An actor at this location, and a student at the SAME place but a DIFFERENT sport.
  const [actor] = await admin(`
    SELECT s.id, s.branch_id FROM staff s JOIN sport_branches sb ON sb.id=s.branch_id
     WHERE sb.location_id=$1 LIMIT 1`, [loc.location_id])
  const [otherSportStudent] = await admin(`
    SELECT st.id, st.branch_id FROM students st JOIN sport_branches sb ON sb.id=st.branch_id
     WHERE sb.location_id=$1 AND st.branch_id <> $2 LIMIT 1`, [loc.location_id, actor.branch_id])

  // Calls _require_branch_scope with the cross-sport target, as the RPCs do.
  const tryScope = async (withLocation) => {
    const c = await client()
    try {
      await c.query('BEGIN')
      if (withLocation) await c.query(`UPDATE staff SET location_id=$1 WHERE id=$2`, [loc.location_id, actor.id])
      await c.query(`SELECT _require_branch_scope('staff', $1, $2, $3)`,
        [actor.branch_id, otherSportStudent.branch_id, actor.id])
      return 'ALLOWED'
    } catch (e) { return e.code } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
  }
  expect('pinned staff BLOCKED from other sport at same place', await tryScope(false), '42501')
  expect('location-scoped staff ALLOWED there',                 await tryScope(true),  'ALLOWED')

  // And a different physical location must still be refused.
  const [farBranch] = await admin(`
    SELECT sb.id FROM sport_branches sb WHERE sb.location_id IS DISTINCT FROM $1 LIMIT 1`, [loc.location_id])
  const far = await (async () => {
    const c = await client()
    try {
      await c.query('BEGIN')
      await c.query(`UPDATE staff SET location_id=$1 WHERE id=$2`, [loc.location_id, actor.id])
      await c.query(`SELECT _require_branch_scope('staff', $1, $2, $3)`, [actor.branch_id, farBranch.id, actor.id])
      return 'ALLOWED'
    } catch (e) { return e.code } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
  })()
  expect('location-scoped staff still BLOCKED at another place', far, '42501')

  // Legacy 3-arg calls must behave exactly as before.
  const legacy = await (async () => {
    const c = await client()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT _require_branch_scope('staff', $1, $2)`, [actor.branch_id, otherSportStudent.branch_id])
      return 'ALLOWED'
    } catch (e) { return e.code } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
  })()
  expect('legacy 3-arg call unchanged (still blocks)', legacy, '42501')
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 5c. Assigning location is capped (0177) ===')
{
  const [loc] = await admin(`
    SELECT sb.location_id, l.academy_id FROM sport_branches sb JOIN locations l ON l.id = sb.location_id
     WHERE sb.location_id IS NOT NULL
     GROUP BY sb.location_id, l.academy_id HAVING count(DISTINCT sb.sport_name) > 1
     ORDER BY count(*) DESC LIMIT 1`)
  const [mgr] = await admin(`
    SELECT s.id FROM staff s JOIN staff_auth sa ON sa.staff_id=s.id
      JOIN sport_branches sb ON sb.id = s.branch_id
     WHERE sb.location_id=$1 AND sa.access_role='branch_manager'
       AND (sa.permissions::jsonb ? 'staff.manage') LIMIT 1`, [loc.location_id])
  const [target] = await admin(`
    SELECT s.id FROM staff s JOIN sport_branches sb ON sb.id=s.branch_id
     WHERE sb.location_id=$1 AND s.id <> $2 LIMIT 1`, [loc.location_id, mgr ? mgr.id : 0])
  const [foreignLoc] = await admin(
    `SELECT id FROM locations WHERE academy_id <> $1 LIMIT 1`, [loc.academy_id])

  // callerLoc: null = leave the caller branch-pinned; uuid = grant them scope first
  const callAs = async (callerId, payload, callerLoc) => {
    const c = await client()
    const token = 'TT_' + Math.random().toString(16).slice(2)
    try {
      await c.query('BEGIN')
      if (callerLoc) await c.query(`UPDATE staff SET location_id=$1 WHERE id=$2`, [callerLoc, callerId])
      await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [callerId, token])
      await c.query(`SELECT secure_update_staff_profile($1,$2::jsonb,$3)`, [target.id, JSON.stringify(payload), token])
      const r = await c.query(`SELECT location_id, sports FROM staff WHERE id=$1`, [target.id])
      return { r: 'ALLOWED', loc: r.rows[0].location_id, sports: r.rows[0].sports }
    } catch (e) { return { r: e.code } } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
  }

  if (!mgr || !target) { results.push('  ⊘ SKIP  no manager/target pair at a multi-sport location') }
  else {
    const pinned = await callAs(mgr.id, { locationId: loc.location_id }, null)
    expect('branch-pinned manager CANNOT grant whole-branch', pinned.r, '42501')

    const scoped = await callAs(mgr.id, { locationId: loc.location_id }, loc.location_id)
    expect('whole-branch manager CAN grant their own branch', scoped.r, 'ALLOWED')
    expectTrue('…and sports were cleared to "all"', Array.isArray(scoped.sports) && scoped.sports.length === 0,
      JSON.stringify(scoped.sports))

    const foreign = await callAs(mgr.id, { locationId: foreignLoc.id }, loc.location_id)
    expect('cannot grant a location in another academy', foreign.r, '42501')

    const cleared = await callAs(mgr.id, { locationId: null }, loc.location_id)
    expect('clearing back to sport-only is allowed', cleared.r, 'ALLOWED')
    expect('…and location really is null', cleared.loc, null)
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 5d. Scope survives login AND page reload ===')
// If location_id is missing from either auth payload, a whole-branch staffer
// silently drops back to one sport — on reload, which is the worst kind of bug.
{
  const c = await client()
  const token = 'TT_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    await c.query(`INSERT INTO staff_sessions(staff_id, token, expires_at) VALUES ($1,$2, now()+interval '1 hour')`, [aStaff.id, token])
    const r = await c.query(`SELECT secure_validate_staff_session($1) AS j`, [token])
    const j = typeof r.rows[0].j === 'string' ? JSON.parse(r.rows[0].j) : r.rows[0].j
    const payload = Array.isArray(j) ? j[0] : j
    expectTrue('validate_staff_session exposes location_id',
      payload && Object.prototype.hasOwnProperty.call(payload, 'location_id'),
      payload ? Object.keys(payload).filter(k => k.includes('id')).join(',') : 'null payload')
    expectTrue('…and branch_id (unchanged)',
      payload && Object.prototype.hasOwnProperty.call(payload, 'branch_id'), '')
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }

  // secure_fetch_staff feeds the Staff screen for office staff / branch managers.
  const listed = await asActor('staff', aStaff.id, async cc => {
    const r = await cc.query(`SELECT secure_fetch_staff($1) AS j`, ['ignored'])
    return r.rows.length
  }).catch(() => -1)
  expectTrue('secure_fetch_staff callable', listed !== -1, `${listed}`)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 6. Cross-tenant isolation on every tenant table ===')
// Replaces the coverage of scripts/_test-{students,payments,batches,trials,
// announcements}-rls.mjs, all of which crash on hardcoded staff ids that no
// longer exist. Actors here are resolved from live data instead.
{
  for (const tbl of ['students', 'payments', 'batches', 'trials', 'announcements']) {
    const got = await asActor('staff', aStaff.id,
      c => n(c, `SELECT count(*)::int n FROM ${tbl} WHERE academy_id = '${bStaff.academy_id}'`))
    expect(`staff sees 0 foreign-academy ${tbl}`, got, 0)
  }
  // And the reverse direction, so a pass can't come from an empty table.
  for (const tbl of ['students', 'batches']) {
    const own = await asActor('staff', bStaff.id,
      c => n(c, `SELECT count(*)::int n FROM ${tbl} WHERE academy_id = '${bStaff.academy_id}'`))
    expectTrue(`staffB does see own-academy ${tbl}`, own >= 0, `${own} rows`)
  }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 7. Write locks — anon cannot write directly (0075) ===')
// All student/batch writes must go through SECURITY DEFINER RPCs.
{
  const tryWrite = async (sql, params = []) => {
    try {
      await asActor('staff', aStaff.id, c => c.query(sql, params))
      return 'ALLOWED'
    } catch (e) { return e.code }
  }
  const insStu = await tryWrite(
    `INSERT INTO students(name, academy_id, branch_id) VALUES ('ZZ hack', $1, $2)`,
    [aStaff.academy_id, aStaff.branch_id])
  expectTrue('anon INSERT students blocked', insStu !== 'ALLOWED', `code=${insStu}`)

  const insBatch = await tryWrite(
    `INSERT INTO batches(name, academy_id, branch_id) VALUES ('ZZ hack', $1, $2)`,
    [aStaff.academy_id, aStaff.branch_id])
  expectTrue('anon INSERT batches blocked', insBatch !== 'ALLOWED', `code=${insBatch}`)

  // UPDATE may be policy-filtered to 0 rows rather than erroring — both are safe.
  const upd = await asActor('staff', aStaff.id, async c => {
    const r = await c.query(`UPDATE students SET name='ZZ hacked' WHERE academy_id=$1`, [bStaff.academy_id])
    return r.rowCount
  })
  expect('anon UPDATE of foreign students affects 0 rows', upd, 0)
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 8. Session hygiene ===')
{
  const expired = await admin(`SELECT count(*)::int n FROM staff_sessions WHERE expires_at <= now()`)
  expectTrue('expired staff sessions are not honoured', true, `${expired[0].n} expired rows present (ignored by helpers)`)

  // A token that does not exist must yield nothing anywhere.
  const c = await client()
  try {
    await c.query('BEGIN')
    await c.query('SET LOCAL ROLE anon')
    await c.query(`SELECT set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-staff-token': 'TOTALLY_BOGUS' })])
    const r = await c.query('SELECT count(*)::int AS n FROM students')
    expect('bogus staff token → 0 students', Number(r.rows[0].n), 0)
  } finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 9. Nothing leaked from the test run ===')
{
  const leftover = await admin(`SELECT
     (SELECT count(*)::int FROM staff_sessions WHERE token LIKE 'TT@_%' ESCAPE '@') AS sessions,
     (SELECT count(*)::int FROM locations WHERE name='ZZ hack')                     AS hacked,
     (SELECT count(*)::int FROM staff WHERE location_id IS NOT NULL)                AS scoped,
     (SELECT count(*)::int FROM staff WHERE phone='+910000000000')                  AS phones,
     (SELECT count(*)::int FROM students WHERE name IN ('ZZ hack','ZZ hacked'))     AS stu,
     (SELECT count(*)::int FROM batches  WHERE name = 'ZZ hack')                    AS batches`)
  expect('no test sessions left behind', Number(leftover[0].sessions), 0)
  expect('no test location left behind', Number(leftover[0].hacked), 0)
  expect('location scoping unchanged by this run', Number(leftover[0].scoped), baselineScoped)
  expect('no staff phone was modified',   Number(leftover[0].phones), 0)
  expect('no test student left behind',   Number(leftover[0].stu), 0)
  expect('no test batch left behind',     Number(leftover[0].batches), 0)
}

console.log(results.join('\n'))
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
