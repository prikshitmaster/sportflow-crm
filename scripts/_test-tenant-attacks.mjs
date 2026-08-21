// Adversarial multi-tenancy probes: a legitimate staff member of academy A
// deliberately passes academy B's ids to the write RPCs. Everything runs inside
// rolled-back transactions, so it is safe against production.
//
//   node scripts/_test-tenant-attacks.mjs
import pg from 'pg'
import fs from 'fs'

const url = (process.env.SUPA_DB_URL || fs.readFileSync('.supabase-db-url', 'utf8').trim())
let pass = 0, fail = 0
const out = []
const check = (desc, blocked, detail = '') => {
  out.push(`  ${blocked ? '✓ BLOCKED' : '✗ ALLOWED — LEAK'}  ${desc}${detail ? `  (${detail})` : ''}`)
  blocked ? pass++ : fail++
}

const client = async () => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect(); return c
}
const admin = async (sql, p = []) => { const c = await client(); try { return (await c.query(sql, p)).rows } finally { await c.end() } }

// Run one RPC as `staffId`, always rolled back. Returns 'ALLOWED' or the SQLSTATE.
async function attack(staffId, sql, params) {
  const c = await client()
  const token = 'ATK_' + Math.random().toString(16).slice(2)
  try {
    await c.query('BEGIN')
    await c.query(`INSERT INTO staff_sessions(staff_id,token,expires_at) VALUES ($1,$2,now()+interval '1 hour')`, [staffId, token])
    await c.query(sql, params.map(p => p === '@TOKEN' ? token : p))
    return 'ALLOWED'
  } catch (e) { return e.code || e.message.slice(0, 60) }
  finally { try { await c.query('ROLLBACK') } catch {}; await c.end() }
}

// Attacker: a staff member WITH broad permissions, so a block proves tenant
// scoping rather than merely a missing permission.
const [atk] = await admin(`
  SELECT s.id, s.academy_id FROM staff s JOIN staff_auth sa ON sa.staff_id=s.id
   WHERE (sa.permissions::jsonb ? 'students.manage')
     AND (sa.permissions::jsonb ? 'payments.manage')
   ORDER BY s.id LIMIT 1`)
const [victimStu] = await admin(`SELECT id, academy_id, branch_id FROM students WHERE academy_id <> $1 LIMIT 1`, [atk.academy_id])
const [ownStu]    = await admin(`SELECT id FROM students WHERE academy_id = $1 LIMIT 1`, [atk.academy_id])
const [victimAcad]= await admin(`SELECT DISTINCT academy_id FROM students WHERE academy_id <> $1 LIMIT 1`, [atk.academy_id])

console.log(`\nAttacker: staff ${atk.id} of academy ${atk.academy_id.slice(0,8)}`)
console.log(`Victim  : student ${victimStu.id} of academy ${victimStu.academy_id.slice(0,8)}\n`)

console.log('=== Foreign RECORD id passed to write RPCs ===')
check('secure_update_student on a foreign student',
  await attack(atk.id, `SELECT secure_update_student($1,$2::jsonb,$3)`, [victimStu.id, JSON.stringify({ name: 'PWNED' }), '@TOKEN']) !== 'ALLOWED')
check('secure_delete_student on a foreign student',
  await attack(atk.id, `SELECT secure_delete_student($1,$2)`, [victimStu.id, '@TOKEN']) !== 'ALLOWED')
check('secure_insert_payment against a foreign student',
  await attack(atk.id, `SELECT secure_insert_payment($1::jsonb,$2)`,
    [JSON.stringify({ id: 'ATK-1', studentId: victimStu.id, amount: 1, month: 'Aug 2026', date: '2026-08-21', status: 'Paid', mode: 'Cash' }), '@TOKEN']) !== 'ALLOWED')
check('secure_update_staff_profile on a foreign staff row',
  await attack(atk.id, `SELECT secure_update_staff_profile((SELECT id FROM staff WHERE academy_id=$1 LIMIT 1),$2::jsonb,$3)`,
    [victimStu.academy_id, JSON.stringify({ name: 'PWNED' }), '@TOKEN']) !== 'ALLOWED')

console.log('=== Foreign TENANT id passed as an argument ===')
const r = await attack(atk.id,
  `SELECT create_student_with_payment('ATK','P','','',10,NULL,'Football','',NULL,CURRENT_DATE,0,0,1,NULL,'Daily','monthly','ATKCODE','ATKJOIN',$1,false,NULL,NULL,NULL,NULL,NULL,$2,NULL)`,
  [victimAcad.academy_id, '@TOKEN'])
check('create_student_with_payment with a foreign p_academy_id', r !== 'ALLOWED', `got ${r}`)

console.log('=== Sanity: the same calls on OWN academy must still work ===')
const own = await attack(atk.id, `SELECT secure_update_student($1,$2::jsonb,$3)`, [ownStu.id, JSON.stringify({ name: 'SelfTest' }), '@TOKEN'])
out.push(`  ${own === 'ALLOWED' ? '✓ ALLOWED (correct)' : '✗ BLOCKED — over-restrictive'}  secure_update_student on own student  (got ${own})`)
own === 'ALLOWED' ? pass++ : fail++

console.log('=== Cross-branch QR attendance ===')
const [qr] = await admin(`SELECT token, branch_id, academy_id FROM gate_qr LIMIT 1`)
if (qr) {
  const [foreignBranchStu] = await admin(
    `SELECT id FROM students WHERE academy_id=$1 AND branch_id IS DISTINCT FROM $2 LIMIT 1`, [qr.academy_id, qr.branch_id])
  if (foreignBranchStu) {
    const q = await attack(atk.id, `SELECT secure_mark_attendance_qr($1,$2,NULL,$3)`, [foreignBranchStu.id, qr.token, qr.academy_id])
    check('QR scan of a student from a DIFFERENT branch', q !== 'ALLOWED', `got ${q}`)
  } else out.push('  ⊘ SKIP  no student outside the QR branch')
} else out.push('  ⊘ SKIP  no gate_qr rows')

console.log('=== Residue check ===')
const left = await admin(`SELECT
  (SELECT count(*)::int FROM students WHERE name IN ('PWNED','ATK','SelfTest')) AS stu,
  (SELECT count(*)::int FROM staff    WHERE name = 'PWNED')                     AS stf,
  (SELECT count(*)::int FROM payments WHERE id   = 'ATK-1')                     AS pay,
  (SELECT count(*)::int FROM staff_sessions WHERE token LIKE 'ATK@_%' ESCAPE '@') AS sess`)
const clean = Object.values(left[0]).every(v => Number(v) === 0)
out.push(`  ${clean ? '✓' : '✗ FAIL'}  nothing persisted  (${JSON.stringify(left[0])})`)
clean ? pass++ : fail++

console.log(out.join('\n'))
console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`)
process.exit(fail ? 1 : 0)
