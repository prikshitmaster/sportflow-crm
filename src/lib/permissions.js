export const ALL_PERMISSIONS = [
  'dashboard.view',
  'students.view',
  'students.manage',
  'attendance.manage',
  'payments.view',
  'payments.manage',
  'trials.manage',
  'batches.view',
  'batches.manage',
  'training.manage',
  'reports.view',
  'staff.manage',
  'settings.manage',
  'community.manage',
  'events.manage',
]

export const ROLE_PRESETS = {
  coach:          ['attendance.manage', 'students.view', 'batches.view', 'training.manage'],
  receptionist:   ['students.view', 'students.manage', 'trials.manage'],
  accountant:     ['payments.view', 'payments.manage', 'reports.view'],
  admin:          [...ALL_PERMISSIONS],
  staff:          ['attendance.manage', 'students.view'],
  branch_manager: [...ALL_PERMISSIONS],
}

export const PERMISSION_GROUPS = {
  Dashboard:  ['dashboard.view'],
  Students:   ['students.view', 'students.manage'],
  Attendance: ['attendance.manage'],
  Payments:   ['payments.view', 'payments.manage'],
  Trials:     ['trials.manage'],
  Batches:    ['batches.view', 'batches.manage'],
  Training:   ['training.manage'],
  Reports:    ['reports.view'],
  Staff:      ['staff.manage'],
  Settings:   ['settings.manage'],
  Community:  ['community.manage'],
  Events:     ['events.manage'],
}

export const PERM_LABEL = {
  'dashboard.view':    'View Dashboard',
  'students.view':     'View Students',
  'students.manage':   'Manage Students',
  'attendance.manage': 'Mark Attendance',
  'payments.view':     'View Payments',
  'payments.manage':   'Manage Payments',
  'trials.manage':     'Manage Trials',
  'batches.view':      'View Batches',
  'batches.manage':    'Manage Batches',
  'training.manage':   'Session & Drill Plans',
  'reports.view':      'View Reports',
  'staff.manage':      'Manage Staff',
  'settings.manage':   'Manage Settings',
  'community.manage':  'Post Announcements',
  'events.manage':     'Manage Events',
}

export const ACCESS_ROLES = ['coach', 'receptionist', 'accountant', 'admin', 'staff', 'branch_manager']

export const ACCESS_ROLE_LABEL = {
  coach:          'Coach',
  receptionist:   'Receptionist',
  accountant:     'Accountant',
  admin:          'Admin',
  staff:          'Staff',
  branch_manager: 'Branch Manager',
}

export const ACCESS_ROLE_COLOR = {
  coach:          'bg-blue-100 text-blue-700',
  receptionist:   'bg-purple-100 text-purple-700',
  accountant:     'bg-emerald-100 text-emerald-700',
  admin:          'bg-red-100 text-red-700',
  staff:          'bg-gray-100 text-gray-700',
  branch_manager: 'bg-indigo-100 text-indigo-700',
}
