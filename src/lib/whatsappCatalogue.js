// WhatsApp automation catalogue — the single source of truth for which
// automations exist and which variables each one may use.
//
// This lives in code, not the database, on purpose. The owner composes the
// message text in Settings and that text is stored, but the *variable
// allowlist* is not: a stored variable map that drifts from Meta's approved
// template is a silent wrong-message bug (a fee amount rendered into the
// student-name slot, sent to 120 parents before anyone notices). The composer
// only offers variables from the list below, and the sender re-validates
// var_map against this same list before calling Meta — an unknown or missing
// token refuses to send rather than substituting a blank.
//
// Design: docs/superpowers/specs/2026-08-22-whatsapp-automation-design.md

// ── Variables ────────────────────────────────────────────────
// `sample` is what the composer preview renders, so the owner sees a real
// message instead of {{1}}.
export const WA_VARIABLES = {
  parent_name:  { label: 'Parent name',    sample: 'Rakesh Sharma' },
  student_name: { label: 'Student name',   sample: 'Aarav Sharma' },
  academy_name: { label: 'Academy name',   sample: 'Elite Sports Academy' },
  amount:       { label: 'Amount',         sample: '2,500' },
  month:        { label: 'Month',          sample: 'August 2026' },
  paid_till:    { label: 'Paid till',      sample: '31 Aug 2026' },
  days_overdue: { label: 'Days overdue',   sample: '3' },
  batch_name:   { label: 'Batch',          sample: 'Under-14 Evening' },
  coach_name:   { label: 'Coach',          sample: 'Coach Vikram' },
  trial_date:   { label: 'Trial date',     sample: '24 Aug 2026' },
  trial_time:   { label: 'Trial time',     sample: '5:00 PM' },
  date:         { label: 'Date',           sample: '22 Aug 2026' },
  new_time:     { label: 'New timing',     sample: '6:00 PM' },
}

// ── Groups ───────────────────────────────────────────────────
export const WA_GROUPS = [
  { id: 'money',      label: 'Fees & Payments', desc: 'The flow that pays for the rail' },
  { id: 'trials',     label: 'Trials & Onboarding', desc: 'Catch leads before they go cold' },
  { id: 'attendance', label: 'Attendance & Schedule', desc: 'Highest volume — watch the cap' },
  { id: 'community',  label: 'Community', desc: 'Marketing category, roughly 7x the cost' },
]

// ── Knob types ───────────────────────────────────────────────
// 'time'   → HH:MM picker
// 'number' → bounded integer
// 'toggle' → boolean
//
// Every knob declares its own default. A missing timing key falls back to it,
// so adding a knob later cannot break existing rows.

// ── The catalogue ────────────────────────────────────────────
// trigger: 'scan'  = the daily job computes who qualifies
//          'event' = a DB trigger enqueues the moment it happens
export const WA_CATALOGUE = [
  // ── Fees & Payments ────────────────────────────────────────
  {
    kind: 'fee_due', group: 'money', trigger: 'scan', category: 'utility',
    label: 'Fee due',
    desc: 'The day after fees lapse',
    defaultName: 'fee_due_reminder',
    vars: ['parent_name', 'student_name', 'amount', 'month'],
    payButton: true,
    knobs: [{ key: 'hour', type: 'time', label: 'Send at', default: '09:30' }],
    defaultBody:
      'Hi {{1}}, this is a reminder that the monthly fee of Rs {{3}} for {{2}} is now due for {{4}}. ' +
      'You can pay using the button below. If you have already paid, please ignore this message.',
  },
  {
    kind: 'fee_grace', group: 'money', trigger: 'scan', category: 'utility',
    label: 'Fee still unpaid',
    desc: 'Midway through the grace period',
    defaultName: 'fee_grace_reminder',
    vars: ['parent_name', 'student_name', 'amount', 'month', 'days_overdue'],
    payButton: true,
    knobs: [],
    defaultBody:
      'Hi {{1}}, the fee of Rs {{3}} for {{2}} for {{4}} is still showing as unpaid. ' +
      'Please clear it at your convenience to keep the enrolment active.',
  },
  {
    kind: 'fee_final', group: 'money', trigger: 'scan', category: 'utility',
    label: 'Final notice',
    desc: 'The day before suspension',
    defaultName: 'fee_final_notice',
    vars: ['parent_name', 'student_name', 'amount', 'month'],
    payButton: true,
    knobs: [],
    defaultBody:
      "Hi {{1}}, {{2}}'s enrolment will be suspended tomorrow as the fee of Rs {{3}} for {{4}} is unpaid. " +
      'Please pay today to avoid interruption.',
  },
  {
    kind: 'payment_receipt', group: 'money', trigger: 'event', category: 'utility',
    label: 'Payment receipt',
    desc: 'The moment a payment is recorded',
    defaultName: 'payment_receipt',
    vars: ['parent_name', 'student_name', 'amount', 'month', 'paid_till'],
    knobs: [{ key: 'attach_pdf', type: 'toggle', label: 'Attach PDF receipt', default: true }],
    defaultBody:
      'Hi {{1}}, we have received Rs {{3}} for {{2}} for {{4}}. Fees are now paid till {{5}}. Thank you.',
  },
  {
    kind: 'suspension_notice', group: 'money', trigger: 'event', category: 'utility',
    label: 'Suspension notice',
    desc: 'When a student is suspended for non-payment',
    defaultName: 'suspension_notice',
    vars: ['parent_name', 'student_name', 'amount'],
    knobs: [],
    defaultBody:
      "Hi {{1}}, {{2}}'s enrolment has been suspended due to unpaid fees of Rs {{3}}. " +
      'Please contact the academy to reactivate.',
  },

  // ── Trials & Onboarding ────────────────────────────────────
  {
    kind: 'trial_booked', group: 'trials', trigger: 'event', category: 'utility',
    label: 'Trial confirmed',
    desc: 'As soon as a trial is booked',
    defaultName: 'trial_confirmation',
    vars: ['parent_name', 'student_name', 'trial_date', 'trial_time', 'academy_name'],
    knobs: [],
    defaultBody:
      "Hi {{1}}, {{2}}'s trial session is confirmed for {{3}} at {{4}}. " +
      'Please arrive 10 minutes early. See you at {{5}}.',
  },
  {
    kind: 'trial_reminder', group: 'trials', trigger: 'scan', category: 'utility',
    label: 'Trial reminder',
    desc: 'Before the trial session',
    defaultName: 'trial_reminder',
    vars: ['parent_name', 'student_name', 'trial_date', 'trial_time'],
    knobs: [
      { key: 'offset_days', type: 'number', label: 'Days before', default: 1, min: 0, max: 7 },
      { key: 'hour',        type: 'time',   label: 'Send at',     default: '09:30' },
    ],
    defaultBody:
      "Hi {{1}}, a reminder that {{2}}'s trial session is on {{3}} at {{4}}. " +
      'Please arrive 10 minutes early.',
  },
  {
    kind: 'trial_no_show', group: 'trials', trigger: 'scan', category: 'utility',
    label: 'Missed trial follow-up',
    desc: 'When a booked trial was not attended',
    defaultName: 'trial_no_show',
    vars: ['parent_name', 'student_name', 'trial_date'],
    knobs: [{ key: 'delay_days', type: 'number', label: 'Days after', default: 1, min: 0, max: 14 }],
    defaultBody:
      'Hi {{1}}, we missed {{2}} at the trial session on {{3}}. ' +
      'Reply to this message if you would like to reschedule.',
  },
  {
    kind: 'welcome', group: 'trials', trigger: 'event', category: 'utility',
    label: 'Welcome message',
    desc: 'When a new student is enrolled',
    defaultName: 'student_welcome',
    vars: ['parent_name', 'student_name', 'batch_name', 'academy_name'],
    knobs: [],
    defaultBody:
      'Hi {{1}}, welcome to {{4}}. {{2}} has been enrolled in {{3}}. ' +
      'We look forward to seeing them at training.',
  },

  // ── Attendance & Schedule ──────────────────────────────────
  {
    kind: 'absent_alert', group: 'attendance', trigger: 'event', category: 'utility',
    label: 'Absence alert',
    desc: 'When a student misses training',
    defaultName: 'absence_alert',
    vars: ['parent_name', 'student_name', 'date', 'batch_name'],
    audienceFilter: true,
    knobs: [
      // Defaults to 2, not 1. At 1 a 300-student academy sends hundreds of
      // messages a week, trains parents to ignore the number, and spends the
      // daily cap on noise.
      { key: 'min_consecutive', type: 'number', label: 'After N absences in a row', default: 2, min: 1, max: 10 },
      // A coach marks absent at session start and corrects it when the child
      // walks in late. Holding until evening means the correction lands first.
      { key: 'send_after',      type: 'time',   label: 'Hold until', default: '18:00' },
    ],
    defaultBody:
      'Hi {{1}}, {{2}} was marked absent from training on {{3}}. ' +
      'Please let us know if anything is needed.',
  },
  {
    kind: 'schedule_change', group: 'attendance', trigger: 'event', category: 'utility',
    label: 'Schedule change',
    desc: 'When a batch timing changes',
    defaultName: 'schedule_change',
    vars: ['parent_name', 'student_name', 'batch_name', 'new_time'],
    knobs: [],
    defaultBody:
      "Hi {{1}}, the timing for {{3}} has changed. {{2}}'s next session is at {{4}}.",
  },
  {
    kind: 'holiday_notice', group: 'attendance', trigger: 'event', category: 'utility',
    label: 'Holiday notice',
    desc: 'When a holiday is announced',
    defaultName: 'holiday_notice',
    vars: ['parent_name', 'student_name', 'date'],
    audienceFilter: true,
    knobs: [],
    defaultBody:
      'Hi {{1}}, there will be no training on {{3}}. Regular sessions resume the next scheduled day.',
  },

  // ── Community ──────────────────────────────────────────────
  {
    kind: 'birthday', group: 'community', trigger: 'scan', category: 'marketing',
    label: 'Birthday wish',
    desc: "On the student's birthday",
    defaultName: 'birthday_wish',
    vars: ['parent_name', 'student_name', 'academy_name'],
    audienceFilter: true,
    knobs: [{ key: 'hour', type: 'time', label: 'Send at', default: '09:00' }],
    defaultBody:
      'Happy birthday {{2}}! Wishing you a wonderful year ahead from everyone at {{3}}.',
  },
]

export const CATALOGUE_BY_KIND = Object.fromEntries(WA_CATALOGUE.map(a => [a.kind, a]))

// ── Helpers ──────────────────────────────────────────────────

// Merge the code catalogue with whatever rows the DB has. Code decides what
// exists; the DB only supplies saved state. An automation removed from the
// catalogue disappears from the UI even if its row lingers.
export function mergeAutomations(rows = []) {
  const byKind = Object.fromEntries((rows || []).map(r => [r.kind, r]))
  return WA_CATALOGUE.map(entry => {
    const row = byKind[entry.kind] || {}
    const timing = { ...defaultTiming(entry), ...(row.timing || {}) }
    return {
      ...entry,
      timing,
      enabled:        row.enabled ?? false,
      templateId:     row.template_id ?? null,
      templateName:   row.template_name ?? entry.defaultName,
      templateStatus: row.template_status ?? 'none',
      bodyText:       row.body_text ?? '',
      varMap:         row.var_map ?? {},
      headerText:     row.header_text ?? '',
      footerText:     row.footer_text ?? '',
      rejectionReason: row.rejection_reason ?? null,
      audienceType:   row.audience_type ?? 'all',
      audienceIds:    row.audience_ids ?? [],
    }
  })
}

export function defaultTiming(entry) {
  return Object.fromEntries((entry.knobs || []).map(k => [k.key, k.default]))
}

// Build the var_map a fresh draft needs: slot N maps to the Nth declared
// variable, matching the {{1}}..{{n}} order in defaultBody.
export function defaultVarMap(entry) {
  return Object.fromEntries((entry.vars || []).map((v, i) => [String(i + 1), v]))
}

// Render {{n}} against var_map using each variable's sample value.
export function renderPreview(bodyText, varMap, overrides = {}) {
  return String(bodyText || '').replace(/\{\{(\d+)\}\}/g, (whole, slot) => {
    const token = varMap?.[slot]
    if (!token) return whole
    if (overrides[token] != null) return String(overrides[token])
    return WA_VARIABLES[token]?.sample ?? whole
  })
}

// Which slots does the body actually use, and does var_map cover them?
// This is the check that stops a template going to Meta with a slot nothing
// fills — Meta would approve it and every send would then fail or, worse,
// render an empty line where the amount should be.
export function validateTemplate(entry, bodyText, varMap) {
  const errors = []
  const slots = [...String(bodyText || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
  const unique = [...new Set(slots)].sort((a, b) => a - b)

  if (!String(bodyText || '').trim()) errors.push('Message body is empty.')

  // Meta requires slots to start at 1 and run consecutively.
  unique.forEach((n, i) => {
    if (n !== i + 1) errors.push(`Variables must be numbered 1, 2, 3… — found {{${n}}} out of order.`)
  })

  unique.forEach(n => {
    const token = varMap?.[String(n)]
    if (!token) errors.push(`{{${n}}} is not mapped to any variable.`)
    else if (!WA_VARIABLES[token]) errors.push(`{{${n}}} maps to an unknown variable "${token}".`)
    else if (entry && !entry.vars.includes(token)) {
      errors.push(`"${WA_VARIABLES[token].label}" is not available for ${entry.label}.`)
    }
  })

  // Meta rejects a body that is only variables, and one that opens with one.
  const stripped = String(bodyText || '').replace(/\{\{\d+\}\}/g, '').trim()
  if (unique.length && !stripped) errors.push('The message cannot be only variables.')

  if (String(bodyText || '').length > 1024) errors.push('Body must be 1024 characters or fewer.')

  return errors
}

// Phrases that get a UTILITY template reclassified as MARKETING (about 7x the
// cost) or rejected outright. Advisory only — Meta's classifier is the real
// judge, and it is not published.
const PROMO_HINTS = [
  'offer', 'discount', 'free', 'sale', 'limited time', 'hurry', 'deal',
  'special price', 'off!', 'book now', 'join now', 'best', 'exclusive',
]

export function promoWarnings(bodyText, category) {
  if (category === 'marketing') return []
  const lower = String(bodyText || '').toLowerCase()
  const hits = PROMO_HINTS.filter(p => lower.includes(p))
  if (!hits.length) return []
  return [
    `The words ${hits.map(h => `"${h}"`).join(', ')} read as promotional. ` +
    'Meta may reclassify this as a marketing template, which costs roughly 7x more per message.',
  ]
}

// Cost per message in INR, inclusive of GST, for the estimate shown in Settings.
export const WA_COST = { utility: 0.15, marketing: 1.0 }
