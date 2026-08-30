// Cross-tenant isolation probe for the PUBLIC /join funnel.
//
// Calls the funnel's RPCs exactly as an anonymous browser does — anon key,
// no session — and asserts that every one of them refuses to cross an
// academy or branch boundary. Read-only: the two write paths are probed
// only for their auth rejection, never with a valid session, so nothing is
// ever inserted.
//
//   node scripts/_test-join-isolation.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const URL = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
if (!URL || !ANON) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY'); process.exit(1) }

const OWN_SLUG    = 'ara'
const OWN_BRANCH  = 'b32308fc-3bf7-463f-a456-59a13a67cd17' // ara / Football / SG Highway
const FOREIGN     = '75d92eaf-7ed7-445c-a4fe-54d8db5b06dd' // ara-test-2 / Football

const rpc = async (fn, args) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  let body = null
  try { body = await r.json() } catch {}
  return { status: r.status, body }
}

let pass = 0, fail = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`)
  ok ? pass++ : fail++
}

const run = async () => {
  // 1. Own branch's batches are readable (control — proves the probe works).
  {
    const { status, body } = await rpc('secure_public_trial_batches_v2', { p_slug: OWN_SLUG, p_branch_id: OWN_BRANCH })
    check('own branch batches readable', status === 200 && Array.isArray(body), `status=${status} body=${JSON.stringify(body).slice(0, 120)}`)
  }

  // 2. THE CROSS-TENANT ATTACK: this academy's slug + another academy's branch.
  {
    const { status, body } = await rpc('secure_public_trial_batches_v2', { p_slug: OWN_SLUG, p_branch_id: FOREIGN })
    const refused = status >= 400 && /invalid branch/i.test(JSON.stringify(body))
    check('foreign branch batches REFUSED', refused, `status=${status} body=${JSON.stringify(body).slice(0, 200)}`)
  }

  // 3. Branch list never leaks another academy's rows.
  {
    const { status, body } = await rpc('secure_public_trial_branches_v2', { p_slug: OWN_SLUG })
    const rows = Array.isArray(body) ? body : []
    const leaked = rows.some(r => r.id === FOREIGN)
    check('branch list contains no foreign branch', status === 200 && rows.length > 0 && !leaked,
      `status=${status} rows=${rows.length} leaked=${leaked}`)
  }

  // 4. Unknown slug fails closed (empty), never "all academies".
  {
    const { status, body } = await rpc('secure_public_trial_branches_v2', { p_slug: 'no-such-academy-zzz' })
    const rows = Array.isArray(body) ? body : []
    check('unknown slug returns nothing', status === 200 && rows.length === 0, `status=${status} rows=${rows.length}`)
  }

  // 5. Reading someone's registrations requires a verified session.
  {
    const { status, body } = await rpc('secure_my_trials_v1', { p_slug: OWN_SLUG })
    const refused = status >= 400 && /authentication required|no verified phone/i.test(JSON.stringify(body))
    check('my_trials REFUSED without a session', refused, `status=${status} body=${JSON.stringify(body).slice(0, 200)}`)
  }

  // 6. Submitting a trial requires a verified session (no row is created).
  {
    const { status, body } = await rpc('secure_submit_public_trial_v2', {
      p_slug: OWN_SLUG, p_branch_id: OWN_BRANCH, p_batch_id: null,
      p_name: 'ISOLATION PROBE — SHOULD NEVER INSERT', p_parent_name: 'probe',
      p_emergency_contact_name: null, p_emergency_contact_phone: null,
      p_dob: null, p_age: null, p_medical_notes: null, p_document_path: null,
      p_trial_fee_mode: 'Not collected', p_trial_fee_amount: 0,
      p_relationship: null, p_sibling_of_trial_id: null, p_mother_name: null,
      p_address: null, p_gender: null, p_occupation: null,
      p_alternate_contact_phone: null, p_email: null, p_preferred_days: null,
    })
    const refused = status >= 400 && /authentication required|no verified phone/i.test(JSON.stringify(body))
    check('submit REFUSED without a session', refused, `status=${status} body=${JSON.stringify(body).slice(0, 200)}`)
  }

  // 7. Branding is scoped to the slug and never echoes another academy.
  {
    const own = await rpc('secure_public_academy_branding', { p_slug: OWN_SLUG })
    const other = await rpc('secure_public_academy_branding', { p_slug: 'ara-test-2' })
    const distinct = JSON.stringify(own.body) !== JSON.stringify(other.body)
    check('branding differs per slug (no bleed)', own.status === 200 && distinct,
      `own=${JSON.stringify(own.body).slice(0, 90)} other=${JSON.stringify(other.body).slice(0, 90)}`)
  }

  // 8. Direct table reads must not be a way around the RPCs.
  {
    const r = await fetch(`${URL}/rest/v1/trials?select=id,name,phone&limit=5`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    })
    let body = null; try { body = await r.json() } catch {}
    const rows = Array.isArray(body) ? body : []
    check('trials table not readable anonymously', r.status >= 400 || rows.length === 0,
      `status=${r.status} rows=${rows.length} body=${JSON.stringify(body).slice(0, 150)}`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
run()
