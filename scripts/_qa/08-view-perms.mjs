// "View" permissions: students.view, payments.view, batches.view,
// reports.view, dashboard.view have NO server-side enforcement anywhere
// (confirmed by reading every RLS policy + RPC in the DB) — the zero-perm
// staff should still be able to read all of them directly. documents.view
// is the one exception — it IS wired into student_documents' RLS policy via
// current_staff_has_perm(). Confirm both halves live.
import fs from 'fs'
import { restGet, rpc, assert } from './lib.mjs'

const state = JSON.parse(fs.readFileSync(new URL('./perm-state.json', import.meta.url), 'utf8'))
const { academyId, zeroStaff, singlePermStaff, studentId } = state

console.log('\n=== Zero-permission staff reading tables gated ONLY by a "view" permission that has no server check ===')
for (const table of ['students', 'payments', 'batches']) {
  const r = await restGet(table, `?select=id&academy_id=eq.${academyId}&limit=5`, { staffToken: zeroStaff.token })
  const gotRows = Array.isArray(r.body) && r.body.length > 0
  console.log(`  zero-perm staff GET ${table}: ${gotRows ? `${r.body.length} row(s) readable` : 'blocked/empty'} — status ${r.status}`)
}

console.log('\n=== documents.view: the one "view" permission that IS actually enforced ===')
// Insert a document as owner (students.manage staff also works — the RPC only checks students.manage on insert)
const docR = await rpc('secure_add_student_document', {
  p_student_id: studentId, p_doc_type: 'id_proof', p_title: 'QA Test Doc', p_file_path: 'qa/fake-path.pdf',
  p_file_name: 'fake.pdf', p_mime_type: 'application/pdf', p_size_bytes: 100,
  p_token: singlePermStaff['students.manage'].token,
}, {})
assert(docR.ok, 'document metadata row inserted (via students.manage holder)', docR.body)

const readNoPerm = await restGet('student_documents', `?select=id&student_id=eq.${studentId}`, { staffToken: zeroStaff.token })
assert(Array.isArray(readNoPerm.body) && readNoPerm.body.length === 0, 'zero-perm staff CANNOT read student_documents', readNoPerm.body)

// Grant documents.view to the zero-perm staff and re-check
const grantR = await rpc('secure_update_staff_permissions', { p_staff_id: zeroStaff.id, p_permissions: ['documents.view'], p_access_role: 'coach', p_token: null }, { ownerJwt: state.ownerJwt })
assert(grantR.ok, 'granted documents.view to previously zero-perm staff', grantR.body)
const readWithPerm = await restGet('student_documents', `?select=id&student_id=eq.${studentId}`, { staffToken: zeroStaff.token })
assert(Array.isArray(readWithPerm.body) && readWithPerm.body.length > 0, 'same staff CAN now read student_documents after being granted documents.view', readWithPerm.body)
