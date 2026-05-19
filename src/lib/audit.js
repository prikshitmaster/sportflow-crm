import { supabase } from './supabase'

export const ACTIONS = {
  // Students
  STUDENT_ADD:        'student.add',
  STUDENT_EDIT:       'student.edit',
  STUDENT_DELETE:     'student.delete',
  STUDENT_SUSPEND:    'student.suspend',
  STUDENT_REACTIVATE: 'student.reactivate',
  STUDENT_RESET:      'student.password_reset',
  // Payments
  PAYMENT_ADD:        'payment.add',
  PAYMENT_REMOVE:     'payment.remove',
  PAYMENT_PAID:       'payment.mark_paid',
  // Batches
  BATCH_ADD:          'batch.add',
  BATCH_EDIT:         'batch.edit',
  BATCH_DELETE:       'batch.delete',
  BATCH_COACH:        'batch.coach_assign',
  BATCH_ASSIGN:       'batch.student_assign',
  BATCH_UNASSIGN:     'batch.student_unassign',
  // Trials
  TRIAL_ADD:          'trial.add',
  TRIAL_UPDATE:       'trial.update',
  TRIAL_CONVERT:      'trial.convert',
  TRIAL_DELETE:       'trial.delete',
  // Events
  EVENT_ADD:          'event.add',
  EVENT_UPDATE:       'event.update',
  EVENT_DELETE:       'event.delete',
  // Staff
  STAFF_ADD:          'staff.add',
  STAFF_REMOVE:       'staff.remove',
  STAFF_INVITE:       'staff.invite',
  // Announcements
  ANNOUNCEMENT_ADD:   'announcement.add',
  // Assessments
  ASSESSMENT_ADD:     'assessment.add',
  ASSESSMENT_UPDATE:  'assessment.update',
  // Auth & attendance (audit trail for accountability — see AUDIT.md M6)
  AUTH_STAFF_LOGIN:      'auth.staff_login',
  AUTH_STAFF_LOGOUT:     'auth.staff_logout',
  AUTH_STAFF_ACTIVATE:   'auth.staff_activate',
  AUTH_STUDENT_LOGIN:    'auth.student_login',
  AUTH_STUDENT_LOGOUT:   'auth.student_logout',
  AUTH_STUDENT_ACTIVATE: 'auth.student_activate',
  ATTENDANCE_QR_SCAN:    'attendance.qr_scan',
  ATTENDANCE_MANUAL:     'attendance.manual',
}

export const ACTION_LABELS = {
  // Students
  'student.add':            'Added student',
  'student.edit':           'Edited student',
  'student.delete':         'Deleted student',
  'student.suspend':        'Suspended student',
  'student.reactivate':     'Reactivated student',
  'student.password_reset': 'Reset password for student',
  // Payments
  'payment.add':            'Recorded payment',
  'payment.remove':         'Deleted payment',
  'payment.mark_paid':      'Marked payment paid',
  // Batches
  'batch.add':              'Created batch',
  'batch.edit':             'Edited batch',
  'batch.delete':           'Deleted batch',
  'batch.coach_assign':     'Changed coach for batch',
  'batch.student_assign':   'Assigned student to batch',
  'batch.student_unassign': 'Removed student from batch',
  // Trials
  'trial.add':              'Added trial lead',
  'trial.update':           'Updated trial',
  'trial.convert':          'Converted trial to student',
  'trial.delete':           'Deleted trial lead',
  // Events
  'event.add':              'Created event',
  'event.update':           'Updated event',
  'event.delete':           'Deleted event',
  // Staff
  'staff.add':              'Added staff member',
  'staff.remove':           'Removed staff member',
  'staff.invite':           'Invited staff to portal',
  // Announcements
  'announcement.add':       'Posted announcement',
  // Assessments
  'assessment.add':         'Submitted player assessment',
  'assessment.update':      'Updated player assessment',
  // Auth & attendance
  'auth.staff_login':       'Staff signed in',
  'auth.staff_logout':      'Staff signed out',
  'auth.staff_activate':    'Staff account activated',
  'auth.student_login':     'Student signed in',
  'auth.student_logout':    'Student signed out',
  'auth.student_activate':  'Student account activated',
  'attendance.qr_scan':     'Marked attendance via gate QR',
  'attendance.manual':      'Marked attendance manually (phone)',
}

export const ENTITY_COLORS = {
  student:      { bg: 'bg-blue-100',    text: 'text-blue-700'    },
  payment:      { bg: 'bg-green-100',   text: 'text-green-700'   },
  batch:        { bg: 'bg-purple-100',  text: 'text-purple-700'  },
  trial:        { bg: 'bg-orange-100',  text: 'text-orange-700'  },
  event:        { bg: 'bg-pink-100',    text: 'text-pink-700'    },
  staff:        { bg: 'bg-indigo-100',  text: 'text-indigo-700'  },
  announcement: { bg: 'bg-yellow-100',  text: 'text-yellow-700'  },
  assessment:   { bg: 'bg-teal-100',    text: 'text-teal-700'    },
  auth:         { bg: 'bg-slate-100',   text: 'text-slate-700'   },
  attendance:   { bg: 'bg-cyan-100',    text: 'text-cyan-700'    },
}

export const ROLE_COLORS = {
  Owner:  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  Coach:  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  Admin:  { bg: 'bg-purple-100', text: 'text-purple-700' },
  Staff:  { bg: 'bg-gray-100',   text: 'text-gray-600'   },
}

// Action category map — used for "type" filter in Audit tab
export const ACTION_CATEGORY = {
  'student.add':            'add',
  'student.edit':           'edit',
  'student.delete':         'delete',
  'student.suspend':        'edit',
  'student.reactivate':     'edit',
  'student.password_reset': 'edit',
  'payment.add':            'add',
  'payment.remove':         'delete',
  'payment.mark_paid':      'edit',
  'batch.add':              'add',
  'batch.edit':             'edit',
  'batch.delete':           'delete',
  'batch.coach_assign':     'edit',
  'batch.student_assign':   'add',
  'batch.student_unassign': 'delete',
  'trial.add':              'add',
  'trial.update':           'edit',
  'trial.convert':          'add',
  'trial.delete':           'delete',
  'event.add':              'add',
  'event.update':           'edit',
  'event.delete':           'delete',
  'staff.add':              'add',
  'staff.remove':           'delete',
  'staff.invite':           'add',
  'announcement.add':       'add',
  'assessment.add':         'add',
  'assessment.update':      'edit',
  'auth.staff_login':       'edit',
  'auth.staff_logout':      'edit',
  'auth.staff_activate':    'add',
  'auth.student_login':     'edit',
  'auth.student_logout':    'edit',
  'auth.student_activate':  'add',
  'attendance.qr_scan':     'add',
  'attendance.manual':      'add',
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
export function logAudit({ actor, action, entityType, entityId, entityName, changes = {}, note, academyId, sport, branchId }) {
  supabase.from('audit_logs').insert({
    academy_id:  academyId || null,
    actor_id:    actor?.id ? String(actor.id) : null,
    actor_name:  actor?.name || 'Unknown',
    actor_role:  actor?.role || actor?.accessRole || 'Staff',
    action,
    entity_type: entityType,
    entity_id:   entityId != null ? String(entityId) : null,
    entity_name: entityName || null,
    changes:     Object.keys(changes).length > 0 ? changes : {},
    note:        note || null,
    sport:       sport || null,
    branch_id:   branchId || null,
  }).then(() => {}).catch(() => {})
}
