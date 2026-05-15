import { supabase } from './supabase'

export const ACTIONS = {
  STUDENT_ADD:        'student.add',
  STUDENT_EDIT:       'student.edit',
  STUDENT_DELETE:     'student.delete',
  STUDENT_SUSPEND:    'student.suspend',
  STUDENT_REACTIVATE: 'student.reactivate',
  STUDENT_RESET:      'student.password_reset',
  PAYMENT_ADD:        'payment.add',
  PAYMENT_REMOVE:     'payment.remove',
  PAYMENT_PAID:       'payment.mark_paid',
  BATCH_ADD:          'batch.add',
  BATCH_EDIT:         'batch.edit',
  BATCH_DELETE:       'batch.delete',
  BATCH_COACH:        'batch.coach_assign',
  BATCH_ASSIGN:       'batch.student_assign',
  BATCH_UNASSIGN:     'batch.student_unassign',
}

export const ACTION_LABELS = {
  'student.add':          'Added student',
  'student.edit':         'Edited student',
  'student.delete':       'Deleted student',
  'student.suspend':      'Suspended student',
  'student.reactivate':   'Reactivated student',
  'student.password_reset': 'Reset password for student',
  'payment.add':          'Recorded payment',
  'payment.remove':       'Deleted payment',
  'payment.mark_paid':    'Marked payment paid',
  'batch.add':            'Created batch',
  'batch.edit':           'Edited batch',
  'batch.delete':         'Deleted batch',
  'batch.coach_assign':   'Changed coach for batch',
  'batch.student_assign': 'Assigned student to batch',
  'batch.student_unassign': 'Removed student from batch',
}

export const ENTITY_COLORS = {
  student: { bg: 'bg-blue-100',   text: 'text-blue-700'   },
  payment: { bg: 'bg-green-100',  text: 'text-green-700'  },
  batch:   { bg: 'bg-purple-100', text: 'text-purple-700' },
}

export const ROLE_COLORS = {
  Owner:  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  Coach:  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Admin:  { bg: 'bg-purple-100', text: 'text-purple-700' },
  Staff:  { bg: 'bg-gray-100',   text: 'text-gray-600'   },
}

// Compare two objects across specified fields, return only changed fields
export function diffObjects(oldObj, newObj, fields) {
  const changes = {}
  for (const { key, label, fmt } of fields) {
    const o = fmt ? fmt(oldObj?.[key]) : String(oldObj?.[key] ?? '')
    const n = fmt ? fmt(newObj?.[key]) : String(newObj?.[key] ?? '')
    if (o !== n) changes[label || key] = { old: o, new: n }
  }
  return changes
}

// Fire-and-forget — never throws, never blocks
export function logAudit({ actor, action, entityType, entityId, entityName, changes = {}, note, academyId }) {
  supabase.from('audit_logs').insert({
    academy_id:  academyId || null,
    actor_id:    actor?.id ? String(actor.id) : null,
    actor_name:  actor?.name || 'Unknown',
    actor_role:  actor?.role || 'Staff',
    action,
    entity_type: entityType,
    entity_id:   entityId != null ? String(entityId) : null,
    entity_name: entityName || null,
    changes:     Object.keys(changes).length > 0 ? changes : {},
    note:        note || null,
  }).then(() => {}).catch(() => {})
}
