import { supabase } from './supabase'

// ── Students ──────────────────────────────────────────────
export async function fetchStudents() {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .order('name')
  if (error) throw error
  return data.map(row => ({
    id:       row.id,
    name:     row.name,
    parent:   row.parent,
    phone:    row.phone,
    age:      row.age,
    sport:    row.sport,
    batch:    row.batch,
    joinDate: row.join_date,
    status:   row.status,
    fees:     row.fees,
    paidTill: row.paid_till,
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
  if (error) throw error
  return data.map(row => ({
    id:        row.id,
    studentId: row.student_id,
    student:   row.student,
    amount:    row.amount,
    month:     row.month,
    date:      row.date,
    status:    row.status,
    mode:      row.mode,
  }))
}

export async function insertPayment(p, invoiceId) {
  const { error } = await supabase
    .from('payments')
    .insert({
      id:         invoiceId,
      student_id: p.studentId || null,
      student:    p.student,
      amount:     Number(p.amount),
      month:      p.month,
      date:       new Date().toISOString().split('T')[0],
      status:     'Paid',
      mode:       p.mode,
    })
  if (error) throw error
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
  if (error) throw error
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
  if (error) throw error
  return data.map(row => ({
    id:       row.id,
    name:     row.name,
    time:     row.time,
    sports:   row.sports || [],
    coach:    row.coach,
    capacity: row.capacity,
    enrolled: row.enrolled,
    waitlist: row.waitlist,
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
  if (error) throw error
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
  }))
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
  if (error) throw error
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

// ── Announcements ─────────────────────────────────────────
export async function fetchAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('date', { ascending: false })
  if (error) throw error
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
