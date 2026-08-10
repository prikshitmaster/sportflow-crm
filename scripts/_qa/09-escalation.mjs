// Permission-escalation guards on secure_update_staff_permissions:
//   - a staff.manage holder cannot grant a permission they don't hold themselves
//   - self-escalation (granting yourself more) must be blocked the same way
//   - editing an EXISTING staff's access is owner/branch_manager only
//   - setting perms on a BRAND NEW staff (no existing access) is fine for any
//     staff.manage holder, within their own subset
//   - a promoted branch_manager (full perms) CAN edit an existing staff's access
import fs from 'fs'
import { rpc, assert, rid } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { ownerJwt, branchId, singlePermStaff, zeroStaff, bmStaff } = state
const staffMgrToken = singlePermStaff['staff.manage'].token
const staffMgrId = singlePermStaff['staff.manage'].id

console.log('\n=== A non staff.manage holder cannot call this RPC at all ===')
const r0 = await rpc('secure_update_staff_permissions', { p_staff_id: zeroStaff.id, p_access_role: 'coach', p_permissions: ['students.manage'], p_token: singlePermStaff['students.manage'].token }, {})
assert(!r0.ok, 'students.manage-only staff (lacking staff.manage) DENIED from editing permissions at all', r0.body)

console.log('\n=== Escalation guard: cannot grant a permission you do not hold ===')
const r1 = await rpc('secure_update_staff_permissions', { p_staff_id: zeroStaff.id, p_access_role: 'coach', p_permissions: ['payments.manage'], p_token: staffMgrToken }, {})
assert(!r1.ok, 'staff.manage holder (no payments.manage) DENIED from granting payments.manage to someone else', r1.body)

console.log('\n=== Self-escalation guard: cannot grant yourself more than you hold ===')
const r2 = await rpc('secure_update_staff_permissions', { p_staff_id: staffMgrId, p_access_role: 'coach', p_permissions: ['staff.manage', 'payments.manage'], p_token: staffMgrToken }, {})
assert(!r2.ok, 'staff.manage holder DENIED from self-granting payments.manage', r2.body)

console.log('\n=== Setting perms on a BRAND NEW staff (no existing access) is allowed within your own subset ===')
async function makeFreshStaff(label) {
  const codeR = await rpc('secure_fetch_next_staff_code', { p_type: 'coach', p_token: null }, { ownerJwt })
  const staffCode = codeR.body
  const jc = rid('SC').slice(0,6).toUpperCase()
  const insR = await rpc('secure_insert_staff', {
    p_token: null, p_name: `QA ${label}`, p_role: 'Coach', p_phone: '9' + String(Math.floor(Math.random()*1e9)).padStart(9,'0'),
    p_sports: ['Cricket'], p_salary: 10000, p_join_date: null, p_status: 'Active', p_photo_url: null,
    p_staff_code: staffCode, p_join_code: jc, p_staff_type: 'coach', p_branch_id: branchId,
  }, { ownerJwt })
  return insR.body // staff id — deliberately NEVER call secure_update_staff_permissions on it (stays "no existing access")
}
const freshId = await makeFreshStaff('fresh-target')
const r3 = await rpc('secure_update_staff_permissions', { p_staff_id: freshId, p_access_role: 'coach', p_permissions: ['staff.manage'], p_token: staffMgrToken }, {})
assert(r3.ok, 'staff.manage holder ALLOWED to set initial perms (subset of their own) on a brand-new staff', r3.body)

console.log('\n=== Editing an EXISTING staff\'s access is owner/branch_manager only ===')
const targetExisting = singlePermStaff['payments.manage'].id // already has permissions set from setup
const r4 = await rpc('secure_update_staff_permissions', { p_staff_id: targetExisting, p_access_role: 'coach', p_permissions: ['staff.manage'], p_token: staffMgrToken }, {})
assert(!r4.ok, 'plain staff.manage holder (access_role=coach) DENIED from editing an EXISTING staff\'s access', r4.body)

console.log('\n=== Promoting bm-candidate to branch_manager, then re-testing the same edit ===')
const promoteR = await rpc('secure_assign_branch_manager', { p_branch_id: branchId, p_staff_id: bmStaff.id, p_token: null }, { ownerJwt })
assert(promoteR.ok, 'owner promotes bm-candidate to branch_manager', promoteR.body)
// bmStaff's token was minted before promotion but staff_sessions row is unaffected by the promotion — token stays valid.
const r5 = await rpc('secure_update_staff_permissions', { p_staff_id: targetExisting, p_access_role: 'coach', p_permissions: ['staff.manage'], p_token: bmStaff.token }, {})
assert(r5.ok, 'branch_manager ALLOWED to edit an EXISTING staff\'s access', r5.body)
