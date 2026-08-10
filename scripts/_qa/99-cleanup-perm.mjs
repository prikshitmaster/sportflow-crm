import fs from 'fs'
import { pgQuery } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { academyId, ownerId } = state
console.log(`Cleaning up permission-matrix academy ${academyId} (owner ${ownerId})`)

const steps = [
  ['payments',       `delete from payments where academy_id = $1`],
  ['trials',         `delete from trials where academy_id = $1`],
  ['player_goals',   `delete from player_goals where student_id in (select id from students where academy_id = $1)`],
  ['student_documents', `delete from student_documents where student_id in (select id from students where academy_id = $1)`],
  ['attendance',     `delete from attendance where student_id in (select id from students where academy_id = $1)`],
  ['student_sessions', `delete from student_sessions where student_id in (select id from students where academy_id = $1)`],
  ['students',       `delete from students where academy_id = $1`],
  ['fee_plans',      `delete from fee_plans where academy_id = $1`],
  ['batches',        `delete from batches where academy_id = $1`],
  ['events',         `delete from events where academy_id = $1`],
  ['staff_sessions', `delete from staff_sessions where staff_id in (select id from staff where academy_id = $1)`],
  ['staff_auth',     `delete from staff_auth where staff_id in (select id from staff where academy_id = $1)`],
  ['staff_profiles', `delete from staff_profiles where staff_id in (select id from staff where academy_id = $1)`],
  ['staff',          `delete from staff where academy_id = $1`],
  ['announcements',  `delete from announcements where academy_id = $1`],
  ['sport_branches', `delete from sport_branches where academy_id = $1`],
  ['feature_flags',  `delete from feature_flags where academy_id = $1`],
  ['academy_branches', `delete from academy_branches where academy_id = $1`],
]
for (const [label, sql] of steps) {
  try {
    const r = await pgQuery(sql, [academyId])
    console.log(`  ${label}: ${r.rowCount} deleted`)
  } catch (e) {
    console.log(`  ${label}: SKIPPED (${e.message.split('\n')[0]})`)
  }
}
const profR = await pgQuery(`delete from profiles where id = $1`, [ownerId])
console.log(`  profiles: ${profR.rowCount} deleted`)
const acadR = await pgQuery(`delete from academies where id = $1`, [academyId])
console.log(`  academies: ${acadR.rowCount} deleted`)
const userR = await pgQuery(`delete from auth.users where id = $1`, [ownerId])
console.log(`  auth.users: ${userR.rowCount} deleted`)
console.log('\nCleanup complete.')
