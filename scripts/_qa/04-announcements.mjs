import fs from 'fs'
import { rpc, restGet, assert } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'))
const { staff, branches } = state

console.log('\n=== secure_insert_announcement: permission + branch enforcement ===')
console.log(`  cricketB1Coach permissions were granted WITHOUT community.manage (setup used FULL_PERMS which omits it)`)

const r = await rpc('secure_insert_announcement', {
  p_title: 'QA UNAUTHORIZED BROADCAST', p_body: 'posted despite no community.manage perm',
  p_type: 'General', p_author: 'QA Cricket B1 Coach', p_token: staff.cricketB1Coach.token,
  p_sport: null, p_branch_id: branches.cricketB2, // deliberately claim a DIFFERENT branch than their own
  p_audience_type: 'all', p_audience_ids: [],
}, {})
assert(!r.ok, 'Coach WITHOUT community.manage permission is BLOCKED from posting an announcement', r.body)
if (r.ok) {
  console.log(`  -> announcement id/body: ${JSON.stringify(r.body)}`)
  const posted = typeof r.body === 'string' ? JSON.parse(r.body) : r.body
  assert(posted.branch_id === branches.cricketB1, 'if allowed, branch_id should be forced to actor\'s own branch (cricketB1), not the spoofed cricketB2', posted)
}
