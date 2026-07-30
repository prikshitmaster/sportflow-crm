// Announcement audience matching — single source of truth.
//
// Three places must agree on "who is this announcement for": the notify()
// fan-out in AppContext, the student-facing list, and the staff-facing list.
// When those drifted apart before, people saw content that was never pushed to
// them (or got pinged about content they couldn't open). Keep them on these.
//
// Audience narrows WITHIN the announcement's sport/branch tag — it never widens
// across branches. Callers apply their existing scope check first, then this.
//
// audience_type:
//   all           → everyone in scope (default; pre-0114 rows)
//   students      → all students in scope
//   staff         → all staff in scope
//   batches       → students whose batch is in audience_ids
//   students_list → students whose id is in audience_ids
//   staff_members → staff whose id is in audience_ids

// JSONB round-trips can turn ids into strings/numbers inconsistently — compare loosely.
const has = (ids, v) => v != null && (ids || []).some(x => String(x) === String(v))

export function staffMatchesAudience(staffMember, ann) {
  const type = ann?.audienceType || ann?.audience_type || 'all'
  const ids  = ann?.audienceIds  || ann?.audience_ids  || []
  if (type === 'all' || type === 'staff') return true
  if (type === 'staff_members')           return has(ids, staffMember?.id)
  return false // students / batches / students_list → staff aren't the audience
}

export function studentMatchesAudience(student, ann) {
  const type = ann?.audienceType || ann?.audience_type || 'all'
  const ids  = ann?.audienceIds  || ann?.audience_ids  || []
  if (type === 'all' || type === 'students') return true
  if (type === 'batches')       return has(ids, student?.batchId ?? student?.batch_id)
  if (type === 'students_list') return has(ids, student?.id)
  return false // staff / staff_members → students aren't the audience
}
