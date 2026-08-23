// Deletes every row created by global-setup.ts, scoped tightly to that run's
// academyId/ownerId — mirrors scripts/_qa/99-cleanup.mjs, plus the batch
// table that harness never touched. Never runs against anything outside this
// test run's own disposable academy.
import fs from 'fs'
import { pgQuery, readState, STATE_PATH } from './support/db'

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_PATH)) return
  const { academyId, ownerId } = readState()
  console.log(`\n[QA teardown] cleaning up academy ${academyId}`)

  const steps: [string, string][] = [
    ['payments', `delete from payments where academy_id = $1`],
    ['attendance', `delete from attendance where student_id in (select id from students where academy_id = $1)`],
    ['student_sessions', `delete from student_sessions where student_id in (select id from students where academy_id = $1)`],
    ['students', `delete from students where academy_id = $1`],
    ['batches', `delete from batches where academy_id = $1`],
    ['staff_sessions', `delete from staff_sessions where staff_id in (select id from staff where academy_id = $1)`],
    ['staff_auth', `delete from staff_auth where staff_id in (select id from staff where academy_id = $1)`],
    ['staff_profiles', `delete from staff_profiles where staff_id in (select id from staff where academy_id = $1)`],
    ['staff', `delete from staff where academy_id = $1`],
    ['sport_branches', `delete from sport_branches where academy_id = $1`],
    ['feature_flags', `delete from feature_flags where academy_id = $1`],
    ['academy_branches', `delete from academy_branches where academy_id = $1`],
  ]
  for (const [label, sql] of steps) {
    try {
      const r = await pgQuery(sql, [academyId])
      console.log(`  ${label}: ${r.rowCount} deleted`)
    } catch (e: any) {
      console.log(`  ${label}: SKIPPED (${e.message.split('\n')[0]})`)
    }
  }
  await pgQuery(`delete from profiles where id = $1`, [ownerId])
  await pgQuery(`delete from academies where id = $1`, [academyId])
  await pgQuery(`delete from auth.users where id = $1`, [ownerId])
  fs.unlinkSync(STATE_PATH)
  console.log('[QA teardown] complete.')
}
