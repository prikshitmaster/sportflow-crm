import { supabase } from './supabase'

// ── Students ──────────────────────────────────────────────
export async function fetchStudents() {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('name')
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:             row.id,
    name:           row.name,
    parent:         row.parent,
    phone:          row.phone,
    parentPhone:    row.parent_phone,
    age:            row.age,
    sport:          row.sport,
    batch:          row.batch,
    batchId:        row.batch_id,
    joinDate:       row.join_date,
    status:         row.status,
    accountStatus:  row.account_status,
    fees:           row.fees,
    paidTill:       row.paid_till,
    studentCode:    row.student_code,
    joinCode:       row.join_code,
    feeAmount:      row.fee_amount,
    feeDueDay:      row.fee_due_day,
    lastBatchId:    row.last_batch_id,
    lastBatchName:  row.last_batch_name,
    suspendedSince: row.suspended_since,
  }))
}

export async function insertStudent(s) {
  const { data, error } = await supabase
    .from('students')
    .insert({
      name:      s.name,
      parent:    s.parent,
      phone:     s.phone,
      age:       Number(s.age) || null,
      sport:     s.sport,
      batch:     s.batch,
      join_date: s.joinDate,
      status:    s.status,
      fees:      Number(s.fees),
      paid_till: s.paidTill || null,
    })
    .select()
    .single()
  if (error) throw error
  return { ...s, id: data.id }
}

export async function updateStudentStatus(id, status) {
  const { error } = await supabase
    .from('students')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

// ── Payments ──────────────────────────────────────────────
export async function fetchPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:            row.id,
    studentId:     row.student_id,
    student:       row.student,
    amount:        row.amount,
    month:         row.month,
    date:          row.date,
    status:        row.status,
    mode:          row.mode,
    paymentType:   row.payment_type   || 'monthly',
    discountPct:   row.discount_pct   || 0,
    monthsCovered: row.months_covered || 1,
  }))
}

export async function insertPayment(p, invoiceId) {
  const { error } = await supabase
    .from('payments')
    .insert({
      id:             invoiceId,
      student_id:     p.studentId    || null,
      student:        p.student,
      amount:         Number(p.amount),
      month:          p.month,
      date:           new Date().toISOString().split('T')[0],
      status:         'Paid',
      mode:           p.mode,
      payment_type:   p.paymentType  || 'monthly',
      discount_pct:   p.discountPct  || 0,
      months_covered: p.monthsCovered || 1,
    })
  if (error) throw error
}

export async function updateStudentPaidTill(id, paidTill, fees) {
  const updates = { paid_till: paidTill }
  if (fees) { updates.fees = fees; updates.fee_amount = fees }
  const { error } = await supabase.from('students').update(updates).eq('id', id)
  if (error) throw error
}

export async function activateStudentWithBatch(id, batchId, batchName, paidTill, fees) {
  const updates = {
    status:          'Active',
    batch_id:        batchId   || null,
    batch:           batchName || null,
    paid_till:       paidTill,
    suspended_since: null,
    last_batch_id:   null,
    last_batch_name: null,
  }
  if (fees) { updates.fees = fees; updates.fee_amount = fees }
  const { error } = await supabase.from('students').update(updates).eq('id', id)
  if (error) throw error
}

export async function updateBatchEnrolled(batchId, delta) {
  const { data, error } = await supabase
    .from('batches').select('enrolled').eq('id', batchId).single()
  if (error || !data) return
  await supabase.from('batches')
    .update({ enrolled: Math.max(0, data.enrolled + delta) })
    .eq('id', batchId)
}

export async function updatePaymentStatus(id, status, mode) {
  const { error } = await supabase
    .from('payments')
    .update({ status, mode, date: new Date().toISOString().split('T')[0] })
    .eq('id', id)
  if (error) throw error
}

// ── Trials ────────────────────────────────────────────────
export async function fetchTrials() {
  const { data, error } = await supabase
    .from('trials')
    .select('*')
    .order('trial_date', { ascending: false })
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:        row.id,
    name:      row.name,
    parent:    row.parent,
    phone:     row.phone,
    sport:     row.sport,
    trialDate: row.trial_date,
    source:    row.source,
    status:    row.status,
    converted: row.converted,
    followUp:  row.follow_up,
  }))
}

export async function insertTrial(t) {
  const { data, error } = await supabase
    .from('trials')
    .insert({
      name:       t.name,
      parent:     t.parent,
      phone:      t.phone,
      sport:      t.sport,
      trial_date: t.trialDate,
      source:     t.source,
      status:     t.status || 'Scheduled',
      converted:  false,
      follow_up:  t.followUp || null,
    })
    .select()
    .single()
  if (error) throw error
  return { ...t, id: data.id, converted: false }
}

export async function updateTrial(id, updates) {
  const dbUpdates = {}
  if (updates.status    !== undefined) dbUpdates.status    = updates.status
  if (updates.converted !== undefined) dbUpdates.converted = updates.converted
  if (updates.followUp  !== undefined) dbUpdates.follow_up = updates.followUp
  const { error } = await supabase.from('trials').update(dbUpdates).eq('id', id)
  if (error) throw error
}

// ── Batches ───────────────────────────────────────────────
export async function fetchBatches() {
  const { data, error } = await supabase
    .from('batches')
    .select('*')
    .order('id')
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:        row.id,
    name:      row.name,
    time:      row.time,
    sports:    row.sports    || [],
    coach:     row.coach,
    capacity:  row.capacity,
    enrolled:  row.enrolled,
    waitlist:  row.waitlist,
    days:      row.days      || [],
    startTime: row.start_time,
    endTime:   row.end_time,
    ageMin:    row.age_min,
    ageMax:    row.age_max,
    ground:    row.ground    || null,
  }))
}

export async function insertBatch(b) {
  const { data, error } = await supabase
    .from('batches')
    .insert({
      name:     b.name,
      time:     b.time,
      sports:   b.sports || [],
      coach:    b.coach,
      capacity: Number(b.capacity),
      enrolled: 0,
      waitlist: 0,
    })
    .select()
    .single()
  if (error) throw error
  return { ...b, id: data.id, enrolled: 0, waitlist: 0 }
}

// ── Staff ─────────────────────────────────────────────────
export async function fetchStaff() {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .order('name')
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:         row.id,
    name:       row.name,
    role:       row.role,
    phone:      row.phone,
    sports:     row.sports || [],
    salary:     row.salary,
    joinDate:   row.join_date,
    status:     row.status,
    attendance: row.attendance,
    photoUrl:   row.photo_url || null,
  }))
}

export async function uploadStaffPhoto(file, staffName) {
  const ext  = file.name.split('.').pop()
  const path = `staff/${Date.now()}_${staffName.replace(/\s+/g, '_')}.${ext}`
  const { error } = await supabase.storage.from('staff-photos').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
  return data.publicUrl
}

export async function insertStaff(s) {
  const { data, error } = await supabase
    .from('staff')
    .insert({
      name:      s.name,
      role:      s.role,
      phone:     s.phone,
      sports:    s.sports || [],
      salary:    Number(s.salary),
      join_date: s.joinDate,
      status:    s.status || 'Active',
      attendance: 100,
      photo_url:  s.photoUrl || null,
    })
    .select()
    .single()
  if (error) throw error
  return { ...s, id: data.id, attendance: 100 }
}

// ── Attendance ────────────────────────────────────────────
export async function fetchAttendanceForDate(date) {
  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, present, status')
    .eq('date', date)
  if (error) {
    if (error.code === '42P01') return {}
    throw error
  }
  const record = {}
  data.forEach(row => {
    record[row.student_id] = row.status || (row.present ? 'Present' : 'Absent')
  })
  return record
}

export async function saveAttendanceForDate(date, records) {
  const rows = Object.entries(records).map(([student_id, status]) => ({
    date,
    student_id: Number(student_id),
    present: status === 'Present',
    status: status || 'Present',
  }))
  if (rows.length === 0) return
  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'date,student_id' })
  if (error) throw error
}

// Fetch all attendance records for a full month
// Returns: { [studentId]: { [day]: 'Present'|'Absent'|'Late'|'Leave' } }
export async function fetchAttendanceForMonth(year, month) {
  const pad = n => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  const start = `${year}-${pad(month + 1)}-01`
  const end   = `${year}-${pad(month + 1)}-${pad(lastDay)}`
  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, date, present, status')
    .gte('date', start)
    .lte('date', end)
  if (error) throw error
  const result = {}
  data.forEach(row => {
    const day = new Date(row.date).getDate()
    if (!result[row.student_id]) result[row.student_id] = {}
    result[row.student_id][day] = row.status || (row.present ? 'Present' : 'Absent')
  })
  return result
}

// Save entire month's attendance in one upsert
export async function saveAttendanceMonth(year, month, monthData) {
  const pad = n => String(n).padStart(2, '0')
  const rows = []
  for (const [studentId, days] of Object.entries(monthData)) {
    for (const [day, status] of Object.entries(days)) {
      if (!status) continue
      rows.push({
        date:       `${year}-${pad(month + 1)}-${pad(Number(day))}`,
        student_id: Number(studentId),
        present:    status === 'Present',
        status,
      })
    }
  }
  if (rows.length === 0) return
  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'date,student_id' })
  if (error) throw error
}

// ── Student Auth & Onboarding ────────────────────────────

export async function fetchStudentCount() {
  const { count, error } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

export async function createStudentAccount(s) {
  const { data, error } = await supabase
    .from('students')
    .insert({
      name:           s.name,
      parent:         s.parent || '',
      phone:          s.phone || '',
      parent_phone:   s.parentPhone || '',
      age:            Number(s.age) || null,
      sport:          s.sport || '',
      batch:          s.batchName || '',
      batch_id:       s.batchId   || null,
      join_date:      new Date().toISOString().split('T')[0],
      status:         'Active',
      fees:           Number(s.fees) || 0,
      student_code:   s.studentCode,
      join_code:      s.joinCode,
      account_status: 'pending',
      fee_amount:     Number(s.feeAmount) || Number(s.fees) || 0,
      fee_due_day:    Number(s.feeDueDay) || 5,
      paid_till:      s.paidTill || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function activateStudentAccount(studentCode, joinCode, passwordHash) {
  const { data: student, error: fetchErr } = await supabase
    .from('students')
    .select('*')
    .eq('student_code', studentCode.toUpperCase())
    .eq('join_code',    joinCode.toUpperCase())
    .eq('account_status', 'pending')
    .single()
  if (fetchErr || !student) throw new Error('Invalid Student ID or Join Code')

  const { error: updateErr } = await supabase
    .from('students')
    .update({ password_hash: passwordHash, account_status: 'active', join_code: null })
    .eq('id', student.id)
  if (updateErr) throw updateErr
  return student
}

export async function loginStudentAccount(studentCode, passwordHash) {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('student_code',   studentCode.toUpperCase())
    .eq('password_hash',  passwordHash)
    .eq('account_status', 'active')
    .single()
  if (error || !data) throw new Error('Invalid Student ID or password')
  return data
}

export async function createStudentSession(studentId, token) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('student_sessions')
    .insert({ student_id: studentId, token, expires_at: expiresAt })
  if (error) throw error
  return expiresAt
}

export async function validateStudentSession(token) {
  const { data, error } = await supabase
    .from('student_sessions')
    .select('*, students(*)')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single()
  if (error || !data) return null
  return data.students
}

export async function deleteStudentSession(token) {
  await supabase.from('student_sessions').delete().eq('token', token)
}

export async function resetStudentPassword(studentId, newJoinCode) {
  const { error } = await supabase
    .from('students')
    .update({ password_hash: null, join_code: newJoinCode, account_status: 'pending' })
    .eq('id', studentId)
  if (error) throw error
}

export async function assignStudentBatch(studentId, batchId, batchName) {
  const { error } = await supabase
    .from('students')
    .update({ batch_id: batchId, batch: batchName })
    .eq('id', studentId)
  if (error) throw error
}

// ── Gate QR ───────────────────────────────────────────────

export async function getOrCreateGateQR(academyName) {
  const { data: existing } = await supabase
    .from('gate_qr')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return existing

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const { data, error } = await supabase
    .from('gate_qr')
    .insert({ token, academy_name: academyName || 'Academy Gate' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function regenerateGateQR(academyName) {
  await supabase.from('gate_qr').delete().neq('id', 0)
  return getOrCreateGateQR(academyName)
}

export async function validateGateToken(token) {
  const { data } = await supabase
    .from('gate_qr')
    .select('id')
    .eq('token', token)
    .maybeSingle()
  return !!data
}

// ── QR Attendance ─────────────────────────────────────────

export async function markAttendanceDirect(studentId) {
  const today = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('attendance')
    .upsert(
      { date: today, student_id: studentId, present: true, status: 'Present' },
      { onConflict: 'date,student_id' }
    )
  if (error) throw error
}

export async function markAttendanceViaQR(studentId, gateToken) {
  const today = new Date().toISOString().split('T')[0]

  const isValid = await validateGateToken(gateToken)
  if (!isValid) throw new Error('Invalid gate QR code')

  const { data: existing } = await supabase
    .from('attendance')
    .select('id')
    .eq('date', today)
    .eq('student_id', studentId)
    .maybeSingle()
  if (existing) throw new Error('already marked')

  const { error } = await supabase
    .from('attendance')
    .insert({ date: today, student_id: studentId, present: true, status: 'Present' })
  if (error) throw error
}

export async function fetchStudentOwnAttendance(studentId, year, month) {
  const pad = n => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  const start = `${year}-${pad(month + 1)}-01`
  const end   = `${year}-${pad(month + 1)}-${pad(lastDay)}`
  const { data, error } = await supabase
    .from('attendance')
    .select('date, present, status')
    .eq('student_id', studentId)
    .gte('date', start)
    .lte('date', end)
    .order('date')
  if (error) throw error
  return data
}

export async function fetchStudentOwnPayments(studentId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

// ── Batches (extended) ────────────────────────────────────

export async function insertBatchV2(b) {
  const { data, error } = await supabase
    .from('batches')
    .insert({
      name:       b.name,
      time:       b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : b.time,
      sports:     b.sports   || [],
      coach:      b.coach,
      capacity:   Number(b.capacity),
      enrolled:   0,
      waitlist:   0,
      days:       b.days     || [],
      start_time: b.startTime || null,
      end_time:   b.endTime   || null,
      age_min:    Number(b.ageMin) || 0,
      age_max:    Number(b.ageMax) || 99,
      ground:     b.ground || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── Announcements ─────────────────────────────────────────
export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('date', { ascending: false })
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:     row.id,
    title:  row.title,
    body:   row.body,
    type:   row.type,
    author: row.author,
    date:   row.date,
  }))
}

export async function insertAnnouncement(a) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      title:  a.title,
      body:   a.body,
      type:   a.type,
      author: a.author || 'Admin',
      date:   new Date().toISOString().split('T')[0],
    })
    .select()
    .single()
  if (error) throw error
  return { ...a, id: data.id, date: data.date }
}

export async function updateBatchCoach(batchId, coachName) {
  const { error } = await supabase
    .from('batches')
    .update({ coach: coachName })
    .eq('id', batchId)
  if (error) throw error
}

export async function updateBatch(batchId, b) {
  const { data, error } = await supabase
    .from('batches')
    .update({
      name:       b.name,
      time:       b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : b.time,
      sports:     b.sports   || [],
      coach:      b.coach,
      capacity:   Number(b.capacity),
      days:       b.days     || [],
      start_time: b.startTime || null,
      end_time:   b.endTime   || null,
      age_min:    Number(b.ageMin) || 0,
      age_max:    Number(b.ageMax) || 99,
      ground:     b.ground || null,
    })
    .eq('id', batchId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true })
  if (error) {
    if (error.code === '42P01') return []  // table doesn't exist yet
    throw error
  }
  return data
}

export async function insertEvent(e) {
  const { data, error } = await supabase
    .from('events')
    .insert({
      title:       e.title,
      type:        e.type,
      sport:       e.sport || null,
      date:        e.date,
      end_date:    e.endDate || null,
      venue:       e.venue || null,
      description: e.description || null,
      status:      e.status || 'Upcoming',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEventStatus(id, status) {
  const { error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEvent(id) {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Academies ─────────────────────────────────────────────

export async function createAcademy(ownerId, name, joinCode) {
  const { data, error } = await supabase
    .from('academies')
    .insert({ name, owner_id: ownerId, join_code: joinCode })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchAcademy(academyId) {
  const { data, error } = await supabase
    .from('academies')
    .select('*')
    .eq('id', academyId)
    .single()
  if (error) throw error
  return data
}

// Find academy by the 6-char join code (staff use this to sign up)
export async function findAcademyByCode(code) {
  const { data } = await supabase
    .from('academies')
    .select('*')
    .eq('join_code', code.trim().toUpperCase())
    .single()
  return data || null
}

// ── Profiles ──────────────────────────────────────────────

export async function fetchProfile(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data || null
}

export async function createProfile(userId, role, academyId, name) {
  const { error } = await supabase
    .from('profiles')
    .insert({ id: userId, role, academy_id: academyId, name })
  if (error) throw error
}

// ── Feature Flags ─────────────────────────────────────────

// All features that can be toggled on/off
export const ALL_FEATURES = [
  'attendance', 'payments', 'trials', 'batches',
  'staff', 'reports', 'community', 'events', 'gate_qr',
]

// Insert default flags (all ON) when a new academy is created
export async function initDefaultFlags(academyId) {
  const rows = ALL_FEATURES.map(f => ({ academy_id: academyId, feature: f, enabled: true }))
  const { error } = await supabase.from('feature_flags').upsert(rows)
  if (error) throw error
}

// Returns object like { attendance: true, payments: false, … }
export async function fetchFeatureFlags(academyId) {
  const { data } = await supabase
    .from('feature_flags')
    .select('feature, enabled')
    .eq('academy_id', academyId)
  if (!data || data.length === 0) {
    // No flags found → treat all as enabled
    return Object.fromEntries(ALL_FEATURES.map(f => [f, true]))
  }
  return Object.fromEntries(data.map(r => [r.feature, r.enabled]))
}

// Toggle a single feature on/off
export async function upsertFeatureFlag(academyId, feature, enabled) {
  const { error } = await supabase
    .from('feature_flags')
    .upsert({ academy_id: academyId, feature, enabled })
  if (error) throw error
}

// ── Branches ──────────────────────────────────────────────
export async function fetchBranches(academyId) {
  const { data, error } = await supabase
    .from('academy_branches')
    .select('name')
    .eq('academy_id', academyId)
    .order('name')
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(r => r.name)
}

export async function insertBranch(academyId, name) {
  const { error } = await supabase
    .from('academy_branches')
    .upsert({ academy_id: academyId, name })
  if (error) throw error
}

export async function deleteBranch(academyId, name) {
  const { error } = await supabase
    .from('academy_branches')
    .delete()
    .eq('academy_id', academyId)
    .eq('name', name)
  if (error) throw error
}

// ── Leave Requests ────────────────────────────────────────

// Staff submits a leave request
export async function createLeaveRequest(staffId, staffName, startDate, endDate, reason) {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert({ staff_id: staffId, staff_name: staffName, start_date: startDate, end_date: endDate, reason, status: 'Pending' })
    .select()
    .single()
  if (error) throw error
  return data
}

// Owner fetches all leave requests (all staff)
export async function fetchLeaveRequests() {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return []
  return data
}

// Staff fetches only their own requests
export async function fetchMyLeaveRequests(staffId) {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
  if (error) return []
  return data
}

// Owner approves or rejects
export async function updateLeaveStatus(id, status) {
  const { error } = await supabase
    .from('leave_requests')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

// ── User Permissions ──────────────────────────────────────

export async function fetchUserPermissions(userId) {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('permissions, access_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (error.code === '42P01') return null
    throw error
  }
  return data
}

export async function saveUserPermissions(userId, academyId, accessRole, permissions, name) {
  const { error } = await supabase
    .from('user_permissions')
    .upsert(
      { user_id: userId, academy_id: academyId, access_role: accessRole, permissions, name, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) throw error
}

export async function fetchAccessUsers(academyId) {
  const { data, error } = await supabase
    .from('user_permissions')
    .select('*')
    .eq('academy_id', academyId)
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    userId:      row.user_id,
    name:        row.name || 'Unknown',
    accessRole:  row.access_role,
    permissions: row.permissions || [],
  }))
}

export async function updateAccessUser(userId, accessRole, permissions) {
  const { error } = await supabase
    .from('user_permissions')
    .update({ access_role: accessRole, permissions, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw error
}

export async function revokeAccessUser(userId) {
  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('user_id', userId)
  if (error) throw error
}

// ── Staff Invites ─────────────────────────────────────────

export async function createInvite(academyId, academyName, name, accessRole, permissions) {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('staff_invites')
    .insert({ token, academy_id: academyId, academy_name: academyName, name, access_role: accessRole, permissions, expires_at: expiresAt, used: false })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchPendingInvites(academyId) {
  const { data, error } = await supabase
    .from('staff_invites')
    .select('*')
    .eq('academy_id', academyId)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:          row.id,
    token:       row.token,
    name:        row.name,
    accessRole:  row.access_role,
    permissions: row.permissions || [],
    expiresAt:   row.expires_at,
  }))
}

export async function fetchInviteByToken(token) {
  const { data, error } = await supabase
    .from('staff_invites')
    .select('*')
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    if (error.code === '42P01') return null
    throw error
  }
  return data
}

export async function acceptInvite(token, email, password) {
  const invite = await fetchInviteByToken(token)
  if (!invite) throw new Error('Invite link is invalid or has expired.')

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error

  // profiles table only allows 'owner' | 'staff' — actual access role lives in user_permissions
  await createProfile(data.user.id, 'staff', invite.academy_id, invite.name)
  await saveUserPermissions(data.user.id, invite.academy_id, invite.access_role, invite.permissions, invite.name)

  // Create HR staff record so they appear in the Staff & Coaches tab
  const roleLabel = { coach: 'Coach', receptionist: 'Receptionist', accountant: 'Accountant', admin: 'Admin', staff: 'Staff' }
  await supabase.from('staff').insert({
    name:       invite.name,
    role:       roleLabel[invite.access_role] || invite.access_role,
    phone:      '',
    sports:     [],
    salary:     0,
    join_date:  new Date().toISOString().split('T')[0],
    status:     'Active',
    attendance: 100,
  })

  await supabase.from('staff_invites').update({ used: true }).eq('token', token)

  return { user: data.user, session: data.session, invite }
}

export async function deleteInvite(id) {
  const { error } = await supabase
    .from('staff_invites')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── Staff Attendance ──────────────────────────────────────

export async function logStaffAttendance(academyId, profileId, staffName, date, checkInTime) {
  const { error } = await supabase
    .from('staff_attendance')
    .upsert(
      { academy_id: academyId, profile_id: profileId, staff_name: staffName, check_in_date: date, check_in_time: checkInTime },
      { onConflict: 'academy_id,profile_id,check_in_date' }
    )
  if (error) throw error
}

export async function fetchStaffAttendanceForDate(academyId, date) {
  const { data, error } = await supabase
    .from('staff_attendance')
    .select('*')
    .eq('academy_id', academyId)
    .eq('check_in_date', date)
    .order('check_in_time', { ascending: true })
  if (error) throw error
  return data || []
}
