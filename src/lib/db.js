import { supabase } from './supabase'

// Pulls the staff/student session token from localStorage for RPC validation.
// Returns null when the caller is an owner (JWT path) or unauthenticated —
// the SECURITY DEFINER function falls back to auth.uid() in that case.
function _sessionToken() {
  try {
    const raw = localStorage.getItem('sf_staff') || localStorage.getItem('sf_student')
    if (!raw) return null
    return JSON.parse(raw)?.token || null
  } catch { return null }
}

// ── Students ──────────────────────────────────────────────
export async function fetchStudents(academyId) {
  let query = supabase.from('students').select('*').order('name')
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
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
    dob:            row.dob || null,
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
    trainingType:   row.training_type || 'Daily',
    feePlan:        row.fee_plan || 'monthly',
    position:       row.position || null,
    photoUrl:       row.photo_url || null,
    fromTrial:      row.from_trial  || false,
    branchId:       row.branch_id || null,
    academy_id:     row.academy_id || null,
  }))
}

// Paginated variant. Use this for any page that doesn't need the full roster in
// memory — Students table, Reports lists, etc. Still server-side filtered for
// sport/branch/status so a 1000-student academy can serve a paginated view in
// ~200 rows per request instead of pulling the full payload through loadAll().
//
// Returns { students, total, page, pageSize, hasMore }. The mapping below is a
// 1-to-1 copy of fetchStudents so callers can swap freely without field drift.
export async function fetchStudentsPaginated(academyId, {
  page = 0,
  pageSize = 200,
  sport = null,
  branchId = null,
  status = null,
  search = null,
} = {}) {
  let query = supabase
    .from('students')
    .select('*', { count: 'exact' })
    .order('name')
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (academyId) query = query.eq('academy_id', academyId)
  if (sport)     query = query.eq('sport', sport)
  if (branchId)  query = query.eq('branch_id', branchId)
  if (status)    query = query.eq('status', status)
  if (search)    query = query.ilike('name', `%${search}%`)

  const { data, error, count } = await query
  if (error) {
    if (error.code === '42P01') return { students: [], total: 0, page, pageSize, hasMore: false }
    throw error
  }
  const students = (data || []).map(row => ({
    id:             row.id,
    name:           row.name,
    parent:         row.parent,
    phone:          row.phone,
    parentPhone:    row.parent_phone,
    age:            row.age,
    dob:            row.dob || null,
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
    trainingType:   row.training_type || 'Daily',
    feePlan:        row.fee_plan || 'monthly',
    position:       row.position || null,
    photoUrl:       row.photo_url || null,
    fromTrial:      row.from_trial  || false,
    branchId:       row.branch_id || null,
    academy_id:     row.academy_id || null,
  }))
  const total = count || 0
  return {
    students,
    total,
    page,
    pageSize,
    hasMore: (page + 1) * pageSize < total,
  }
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

export async function deleteStudent(id) {
  // Routed through secure_delete_student (migration 0033) — validates the
  // caller, enforces same-academy scope, and runs the payments/sessions/student
  // cascade atomically server-side.
  const { error } = await supabase.rpc('secure_delete_student', {
    p_student_id: id,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function suspendStudent(id) {
  // Routed through secure_update_student (migration 0039) — validates
  // caller via current_actor, requires students.manage perm, enforces
  // same-academy scope. Replaces raw .update() to block DevTools bypass.
  const today = new Date().toISOString().split('T')[0]
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    { status: 'Suspended', suspendedSince: today },
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function updateStudentStatus(id, status) {
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    { status },
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function updateStudent(id, s) {
  // Returns the updated student row (JSON) so AppContext can patch local state
  // using the authoritative DB values rather than the submitted payload.
  const { data, error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload: {
      name:         s.name,
      parent:       s.parent       || '',
      phone:        s.phone        || '',
      parentPhone:  s.parentPhone  || '',
      age:          s.age          ? Number(s.age) || null : null,
      dob:          s.dob          || null,
      sport:        s.sport        || '',
      batchName:    s.batchName    || '',
      batchId:      s.batchId      ? String(s.batchId) : null,
      fees:         String(Number(s.fees) || 0),
      paidTill:     s.paidTill     || null,
      joinDate:     s.joinDate     || null,
      trainingType: s.trainingType || 'Daily',
      feePlan:      s.feePlan      || 'monthly',
      position:     s.position     || null,
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data
}

// ── Payments ──────────────────────────────────────────────
export async function fetchPayments(academyId) {
  let query = supabase.from('payments').select('*').order('created_at', { ascending: false })
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:            row.id,
    studentId:     row.student_id,
    coverageStart: row.coverage_start || null,
    student:       row.student,
    amount:        row.amount,
    month:         row.month,
    date:          row.date,
    status:        row.status,
    mode:          row.mode,
    paymentType:   row.payment_type   || 'monthly',
    discountPct:   row.discount_pct   || 0,
    monthsCovered: row.months_covered || 1,
    notes:         row.notes          || '',
  }))
}

export async function insertPayment(p, invoiceId) {
  // Routed through secure_insert_payment (migration 0035) — validates
  // caller via current_actor, requires payments.manage perm, enforces
  // same-academy scope for both the payment and the referenced student.
  const { error } = await supabase.rpc('secure_insert_payment', {
    p_payload: {
      id:             invoiceId,
      studentId:      p.studentId,
      student:        p.student,
      amount:         Number(p.amount),
      month:          p.month,
      date:           p.date || new Date().toISOString().split('T')[0],
      status:         p.status || 'Paid',
      mode:           p.mode,
      paymentType:    p.paymentType || 'monthly',
      discountPct:    p.discountPct || 0,
      monthsCovered:  p.monthsCovered || 1,
      coverageStart:  p.coverageStart || null,
      academyId:      p.academyId    || null,
      notes:          p.notes        || null,
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
}

// Returns the most recent payment for (studentId, amount) within the given window, or null.
// Used by addPayment to refuse duplicates from double-click or simultaneous staff submissions.
export async function findRecentDuplicatePayment(studentId, amount, withinSeconds = 60) {
  if (!studentId || !amount) return null
  const sinceIso = new Date(Date.now() - withinSeconds * 1000).toISOString()
  const { data, error } = await supabase
    .from('payments')
    .select('id, student, amount, created_at, mode')
    .eq('student_id', studentId)
    .eq('amount', Number(amount))
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return null
  return data?.[0] || null
}

export async function updateStudentPosition(id, position) {
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    { position: position || null },
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function uploadStudentPhoto(file, studentId) {
  const { compressImage } = await import('./imageUtils.js')
  const compressed = await compressImage(file)
  // Fixed path — upsert overwrites old file automatically, no orphans.
  const path = `${studentId}.jpg`
  const { error } = await supabase.storage.from('student-photos').upload(path, compressed, {
    upsert: true,
    contentType: 'image/jpeg',
  })
  if (error) throw error
  const { data } = supabase.storage.from('student-photos').getPublicUrl(path)
  // Append version param to bust CDN cache after overwrite
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function updateStudentPhotoUrl(id, photoUrl) {
  // Routed through secure_update_student_photo (migration 0039).
  // Students may update their own photo; owners/staff may update any
  // student's photo within their academy.
  await supabase.rpc('secure_update_student_photo', {
    p_student_id: id,
    p_photo_url:  photoUrl,
    p_token:      _sessionToken(),
  })
}

export async function fetchBatchCoachInfo(batchId) {
  if (!batchId) return null
  const { data } = await supabase.from('batches').select('coach').eq('id', batchId).maybeSingle()
  if (!data?.coach) return null
  const { data: s } = await supabase.from('staff').select('name, photo_url').ilike('name', data.coach).maybeSingle()
  return { name: data.coach, photoUrl: s?.photo_url || null }
}

export async function fetchStudentAnyBatchId(studentId) {
  const { data } = await supabase
    .from('student_batches').select('batch_id').eq('student_id', studentId).limit(1).maybeSingle()
  return data?.batch_id || null
}

// Fetch ALL batchmates of a student across every batch they belong to (primary + multi-batch)
export async function fetchStudentBatchmatesForPitch(studentId) {
  // 1. Get all batch IDs this student is enrolled in
  const [primaryRow, sbRows] = await Promise.all([
    supabase.from('students').select('batch_id').eq('id', studentId).maybeSingle(),
    supabase.from('student_batches').select('batch_id').eq('student_id', studentId),
  ])
  const batchIds = new Set()
  if (primaryRow.data?.batch_id) batchIds.add(primaryRow.data.batch_id)
  for (const r of (sbRows.data || [])) if (r.batch_id) batchIds.add(r.batch_id)
  if (batchIds.size === 0) return []

  // 2. Get all student IDs in those batches
  const batchIdArr = [...batchIds]
  const [primStudents, sbStudents] = await Promise.all([
    supabase.from('students').select('id, name, position, photo_url, status')
      .in('batch_id', batchIdArr).neq('status', 'Deleted'),
    supabase.from('student_batches').select('student_id').in('batch_id', batchIdArr),
  ])

  const seen = new Set()
  const rows = []
  for (const s of (primStudents.data || [])) {
    seen.add(String(s.id))
    rows.push({ id: s.id, name: s.name, position: s.position || null, photoUrl: s.photo_url || null })
  }
  const extraIds = (sbStudents.data || []).map(r => r.student_id).filter(id => !seen.has(String(id)))
  if (extraIds.length > 0) {
    const { data: extra } = await supabase
      .from('students').select('id, name, position, photo_url, status')
      .in('id', extraIds).neq('status', 'Deleted')
    for (const s of (extra || [])) {
      if (!seen.has(String(s.id))) {
        seen.add(String(s.id))
        rows.push({ id: s.id, name: s.name, position: s.position || null, photoUrl: s.photo_url || null })
      }
    }
  }
  return rows
}

export async function fetchBatchStudentsForPitch(batchId) {
  // Two separate queries — avoids PostgREST join which requires FK relationship
  const [primary, sbRows] = await Promise.all([
    supabase.from('students').select('id, name, position, photo_url, status').eq('batch_id', batchId).neq('status', 'Deleted'),
    supabase.from('student_batches').select('student_id').eq('batch_id', batchId),
  ])
  const seen = new Set()
  const rows = []
  for (const row of (primary.data || [])) {
    seen.add(String(row.id))
    rows.push({ id: row.id, name: row.name, position: row.position || null, photoUrl: row.photo_url || null, status: row.status })
  }
  const secondaryIds = (sbRows.data || []).map(r => r.student_id).filter(id => !seen.has(String(id)))
  if (secondaryIds.length > 0) {
    const { data: secStudents } = await supabase
      .from('students').select('id, name, position, photo_url, status')
      .in('id', secondaryIds).neq('status', 'Deleted')
    for (const s of (secStudents || [])) {
      if (!seen.has(String(s.id))) {
        seen.add(String(s.id))
        rows.push({ id: s.id, name: s.name, position: s.position || null, photoUrl: s.photo_url || null, status: s.status })
      }
    }
  }
  return rows
}

export async function updateStudentPaidTill(id, paidTill, fees) {
  const payload = { paidTill }
  if (fees) payload.fees = String(fees)
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    payload,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function reactivateStudent(id) {
  // suspendedSince: null explicitly included so the CASE WHEN block
  // clears the suspended_since column (key present, value null → DB NULL).
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    { status: 'Active', suspendedSince: null },
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function activateStudentWithBatch(id, batchId, batchName, paidTill, fees) {
  const payload = {
    status:    'Active',
    batchId:   batchId   ? String(batchId) : null,
    batchName: batchName || null,
    paidTill,
  }
  if (fees) payload.fees = String(fees)
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: id,
    p_payload:    payload,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function updateBatchEnrolled(batchId, delta) {
  const { error } = await supabase.rpc('bump_batch_enrolled', { p_batch_id: batchId, p_delta: delta })
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      throw new Error('bump_batch_enrolled RPC not found. Apply migration 0014 or 0031 first.')
    }
    throw error
  }
}

export async function deletePayment(id) {
  // Routed through secure_delete_payment (migration 0033).
  const { error } = await supabase.rpc('secure_delete_payment', {
    p_payment_id: id,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function updatePaymentStatus(id, status, mode) {
  // Routed through secure_update_payment (migration 0037) — validates
  // caller via current_actor, requires payments.manage perm, enforces
  // same-academy scope so no cross-academy status flips are possible.
  const { error } = await supabase.rpc('secure_update_payment', {
    p_payment_id: id,
    p_payload: { status, mode, date: new Date().toISOString().split('T')[0] },
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function updatePaymentAmount(id, amount, monthsCovered) {
  const { error } = await supabase.rpc('secure_update_payment', {
    p_payment_id: id,
    p_payload: { amount, monthsCovered },
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function updatePaymentDate(id, date) {
  const { error } = await supabase.rpc('secure_update_payment', {
    p_payment_id: id,
    p_payload: { date },
    p_token: _sessionToken(),
  })
  if (error) throw error
}

// ── Trials ────────────────────────────────────────────────
export async function fetchTrials(academyId) {
  let query = supabase.from('trials').select('*').order('trial_date', { ascending: false })
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:             row.id,
    name:           row.name,
    parent:         row.parent,
    phone:          row.phone,
    age:            row.age            || null,
    sport:          row.sport,
    trialDate:      row.trial_date,
    source:         row.source,
    status:         row.status,
    stage:          row.stage          || 'scheduled',
    batchId:        row.batch_id       || null,
    trialSessions:  row.trial_sessions || 1,
    sessionsDone:   row.sessions_done  || 0,
    coachNote:      row.coach_note     || null,
    coachRec:       row.coach_rec      || null,
    notes:          row.notes          || null,
    quotedFee:      row.quoted_fee     || null,
    sessionStart:   row.session_start  || null,
    sessionEnd:     row.session_end    || null,
    dob:            row.dob            || null,
    ageGroup:       row.age_group      || null,
    programType:    row.program_type   || 'academy',
    trialFeePaid:   row.trial_fee_paid ?? 590,
    converted:      row.converted,
    followUp:       row.follow_up,
    createdAt:      row.created_at,
    branchId:       row.branch_id     || null,
  }))
}

export async function insertTrial(t) {
  const { data, error } = await supabase
    .from('trials')
    .insert({
      name:           t.name,
      parent:         t.parent         || '',
      phone:          t.phone,
      age:            t.age            || null,
      sport:          t.sport,
      trial_date:     t.trialDate,
      source:         t.source         || null,
      status:         'Scheduled',
      stage:          'scheduled',
      batch_id:       t.batchId        || null,
      trial_sessions: t.trialSessions  || 1,
      sessions_done:  0,
      converted:      false,
      follow_up:      t.followUp       || null,
      notes:          t.notes          || null,
      quoted_fee:     t.quotedFee      || null,
      session_start:  t.sessionStart   || null,
      session_end:    t.sessionEnd     || null,
      dob:            t.dob            || null,
      age_group:      t.ageGroup       || null,
      program_type:   t.programType    || 'academy',
      trial_fee_paid: t.trialFeePaid   ?? 590,
      academy_id:     t.academyId      || null,
      branch_id:      t.branchId       || null,
    })
    .select()
    .single()
  if (error) throw error
  return {
    ...t,
    id: data.id,
    stage: 'scheduled',
    converted: false,
    sessionsDone: 0,
  }
}

export async function updateTrial(id, updates) {
  const dbUpdates = {}
  if (updates.name          !== undefined) dbUpdates.name          = updates.name
  if (updates.phone         !== undefined) dbUpdates.phone         = updates.phone
  if (updates.parent        !== undefined) dbUpdates.parent        = updates.parent
  if (updates.age           !== undefined) dbUpdates.age           = updates.age
  if (updates.sport         !== undefined) dbUpdates.sport         = updates.sport
  if (updates.status        !== undefined) dbUpdates.status        = updates.status
  if (updates.stage         !== undefined) dbUpdates.stage         = updates.stage
  if (updates.converted     !== undefined) dbUpdates.converted     = updates.converted
  if (updates.followUp      !== undefined) dbUpdates.follow_up     = updates.followUp
  if (updates.batchId       !== undefined) dbUpdates.batch_id      = updates.batchId
  if (updates.trialDate     !== undefined) dbUpdates.trial_date    = updates.trialDate
  if (updates.trialSessions !== undefined) dbUpdates.trial_sessions= updates.trialSessions
  if (updates.sessionsDone  !== undefined) dbUpdates.sessions_done = updates.sessionsDone
  if (updates.coachNote     !== undefined) dbUpdates.coach_note    = updates.coachNote
  if (updates.coachRec      !== undefined) dbUpdates.coach_rec     = updates.coachRec
  if (updates.notes         !== undefined) dbUpdates.notes         = updates.notes
  if (updates.quotedFee     !== undefined) dbUpdates.quoted_fee    = updates.quotedFee
  if (updates.sessionStart  !== undefined) dbUpdates.session_start  = updates.sessionStart
  if (updates.sessionEnd    !== undefined) dbUpdates.session_end    = updates.sessionEnd
  if (updates.dob           !== undefined) dbUpdates.dob            = updates.dob
  if (updates.ageGroup      !== undefined) dbUpdates.age_group      = updates.ageGroup
  if (updates.programType   !== undefined) dbUpdates.program_type   = updates.programType
  if (updates.trialFeePaid  !== undefined) dbUpdates.trial_fee_paid = updates.trialFeePaid
  const { error } = await supabase.from('trials').update(dbUpdates).eq('id', id)
  if (error) throw error
}

// ── Trial sources (replaces hardcoded SOURCES list) ─────────

export async function fetchTrialSources(academyId) {
  const { data, error } = await supabase
    .from('trial_sources')
    .select('*')
    .eq('academy_id', academyId)
    .order('sort_order')
    .order('id')
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function insertTrialSource(academyId, label) {
  const { data, error } = await supabase
    .from('trial_sources')
    .insert({ academy_id: academyId, label: label.trim() })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTrial(id) {
  const { error } = await supabase.from('trials').delete().eq('id', id)
  if (error) throw error
}

export async function deleteTrialSource(id) {
  const { error } = await supabase.from('trial_sources').delete().eq('id', id)
  if (error) throw error
}

// ── Batches ───────────────────────────────────────────────
export async function fetchBatches(academyId) {
  let query = supabase.from('batches').select('*').order('id')
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:          row.id,
    name:        row.name,
    code:        row.code        || null,
    time:        row.time,
    sports:      row.sports      || [],
    coach:       row.coach,
    capacity:    row.capacity,
    enrolled:    row.enrolled,
    waitlist:    row.waitlist,
    days:        row.days        || [],
    startTime:   row.start_time,
    endTime:     row.end_time,
    ageMin:      row.age_min,
    ageMax:      row.age_max,
    ground:      row.ground      || null,
    defaultFee:  row.default_fee  || 0,
    defaultPlan: row.default_plan || 'monthly',
    branchId:    row.branch_id    || null,
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
export async function fetchStaff(academyId) {
  let query = supabase.from('staff')
    .select('*, staff_auth(staff_code, join_code, status, staff_type, access_role, permissions), staff_profiles(age, licence_url)')
    .order('name')
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => {
    const auth    = Array.isArray(row.staff_auth)     ? row.staff_auth[0]     : row.staff_auth
    const profile = Array.isArray(row.staff_profiles) ? row.staff_profiles[0] : row.staff_profiles
    return {
      id:            row.id,
      name:          row.name,
      role:          row.role,
      phone:         row.phone,
      sports:        row.sports || [],
      salary:        row.salary,
      joinDate:      row.join_date,
      status:        row.status,
      attendance:    row.attendance,
      photoUrl:      row.photo_url || null,
      userId:        row.user_id   || null,
      staffCode:     auth?.staff_code   || null,
      joinCode:      auth?.join_code    || null,
      staffType:     auth?.staff_type   || 'coach',
      accountStatus: auth?.status       || null,
      accessRole:    auth?.access_role  || 'coach',
      permissions:   auth?.permissions  || [],
      age:           profile?.age          || null,
      licenceUrl:    profile?.licence_url  || null,
      branchId:      row.branch_id || null,
    }
  })
}

export async function deleteStaff(id) {
  // Routed through secure_delete_staff (migration 0033) — owner-only.
  // Cascade for leave_requests + staff_attendance happens server-side.
  const { error } = await supabase.rpc('secure_delete_staff', {
    p_staff_id: id,
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function uploadStaffPhoto(file, staffId) {
  const { compressImage } = await import('./imageUtils.js')
  const compressed = await compressImage(file)
  // Fixed path keyed by staffId — upsert overwrites old file, no orphans.
  const path = `staff/${staffId}.jpg`
  const { error } = await supabase.storage.from('staff-photos').upload(path, compressed, {
    upsert: true,
    contentType: 'image/jpeg',
  })
  if (error) throw error
  const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function uploadAcademyLogo(file, academyId) {
  const ext  = file.name.split('.').pop()
  const path = `logos/${academyId}.${ext}`
  const { error } = await supabase.storage.from('staff-photos').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
  return data.publicUrl
}

export async function updateAcademyLogoUrl(academyId, logoUrl) {
  const { error } = await supabase.from('academies').update({ logo_url: logoUrl }).eq('id', academyId)
  if (error) throw error
}

export async function insertStaff(s) {
  const { data, error } = await supabase
    .from('staff')
    .insert({
      name:       s.name,
      role:       s.role,
      phone:      s.phone,
      sports:     s.sports || [],
      salary:     Number(s.salary) || 0,
      join_date:  s.joinDate,
      status:     s.status || 'Active',
      attendance: 100,
      photo_url:  s.photoUrl  || null,
      academy_id: s.academyId || null,
    })
    .select()
    .single()
  if (error) throw error

  if (s.staffCode) {
    const { error: authErr } = await supabase.from('staff_auth').insert({
      staff_id:   data.id,
      staff_code: s.staffCode,
      join_code:  s.joinCode,
      status:     'pending',
      staff_type: s.staffType || 'coach',
    })
    if (authErr) throw new Error('Failed to create activation record: ' + authErr.message)
  }

  return { ...s, id: data.id, attendance: 100 }
}

// ── Staff Auth (custom auth — staff_auth + staff_sessions) ─

export async function fetchNextStaffCode(type) {
  const prefix = type === 'office' ? 'OF' : 'FC'
  const { data } = await supabase
    .from('staff_auth')
    .select('staff_code')
    .like('staff_code', `${prefix}%`)
    .order('staff_code', { ascending: false })
    .limit(1)
    .maybeSingle()
  const num = data?.staff_code ? parseInt(data.staff_code.slice(prefix.length)) : 0
  return `${prefix}${String(num + 1).padStart(3, '0')}`
}

export async function verifyStaffCodes(staffCode, joinCode) {
  const { data } = await supabase
    .from('staff_auth')
    .select('staff_code, join_code, status')
    .eq('staff_code', staffCode.toUpperCase())
    .maybeSingle()
  if (!data) throw new Error('Staff ID not found')
  if (data.status === 'active') throw new Error('Account already activated — go to login.')
  if (data.join_code !== joinCode.toUpperCase()) throw new Error('Incorrect Join Code')
}

export async function activateStaffAccount(staffCode, joinCode, passwordHash, { email }) {
  // Routed through secure_activate_staff_account (migration 0041).
  // Validates join_code server-side; returns the staff row for audit logging.
  const { data, error } = await supabase.rpc('secure_activate_staff_account', {
    p_staff_code:    staffCode,
    p_join_code:     joinCode,
    p_password_hash: passwordHash,
    p_email:         email,
  })
  if (error) throw new Error(error.message)
  return data || {}
}

export async function loginStaffAccount(email, passwordHash) {
  const { data, error } = await supabase
    .from('staff_auth')
    .select('*, staff(*)')
    .eq('email', email.toLowerCase().trim())
    .eq('password_hash', passwordHash)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw new Error('Login error: ' + error.message)
  if (!data) throw new Error('Invalid email or password')
  const staff = Array.isArray(data.staff) ? data.staff[0] : data.staff
  if (!staff) throw new Error('Staff record not found')
  return {
    ...staff,
    staff_code:     data.staff_code,
    staff_type:     data.staff_type,
    account_status: data.status,
    access_role:    data.access_role  || 'coach',
    permissions:    data.permissions  || [],
  }
}

export async function createStaffSession(staffId, token) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('staff_sessions')
    .insert({ staff_id: staffId, token, expires_at: expiresAt })
  if (error) throw error
  return expiresAt
}

export async function validateStaffSession(token) {
  const { data, error } = await supabase
    .from('staff_sessions')
    .select('*, staff(*, staff_auth(staff_code, staff_type, status, access_role, permissions), staff_profiles(age, licence_url))')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !data?.staff) return null
  const auth    = Array.isArray(data.staff.staff_auth)     ? data.staff.staff_auth[0]     : data.staff.staff_auth
  const profile = Array.isArray(data.staff.staff_profiles) ? data.staff.staff_profiles[0] : data.staff.staff_profiles
  return {
    ...data.staff,
    staff_code:     auth?.staff_code     || null,
    staff_type:     auth?.staff_type     || 'coach',
    account_status: auth?.status         || null,
    access_role:    auth?.access_role    || 'coach',
    permissions:    auth?.permissions    || [],
    age:            profile?.age         || null,
    licence_url:    profile?.licence_url || null,
  }
}

export async function fetchStaffProfileExtra(staffId) {
  const { data } = await supabase
    .from('staff_profiles')
    .select('age, licence_url')
    .eq('staff_id', staffId)
    .maybeSingle()
  return data || {}
}

export async function deleteStaffSession(token) {
  await supabase.from('staff_sessions').delete().eq('token', token)
}

export async function updateStaffProfile(staffId, { name, phone, photoUrl }) {
  // Routed through secure_update_staff_profile (migration 0041).
  // Staff may update their own profile; owners may update any in their academy.
  const payload = {}
  if (name     !== undefined) payload.name     = name
  if (phone    !== undefined) payload.phone    = phone
  if (photoUrl !== undefined) payload.photoUrl = photoUrl
  if (!Object.keys(payload).length) return
  const { error } = await supabase.rpc('secure_update_staff_profile', {
    p_staff_id: staffId,
    p_payload:  payload,
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function upsertStaffProfileExtra(staffId, { age, licenceUrl }) {
  const payload = {}
  if (age        !== undefined) payload.age        = age        ?? null
  if (licenceUrl !== undefined) payload.licenceUrl = licenceUrl ?? null
  if (!Object.keys(payload).length) return
  const { error } = await supabase.rpc('secure_update_staff_profile', {
    p_staff_id: staffId,
    p_payload:  payload,
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function uploadStaffLicence(file, staffId) {
  const ext  = file.name.split('.').pop()
  const path = `licences/${staffId}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('staff-photos').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
  return data.publicUrl
}

export async function updateStaffPermissions(staffId, { accessRole, permissions }) {
  // Routed through secure_update_staff_permissions (migration 0041).
  // Owner-only — the RPC rejects any non-owner caller with 42501.
  const { error } = await supabase.rpc('secure_update_staff_permissions', {
    p_staff_id:    staffId,
    p_access_role: accessRole,
    p_permissions: permissions,
    p_token:       _sessionToken(),
  })
  if (error) throw error
}

export async function fetchAcademyName(academyId) {
  if (!academyId) return null
  const { data } = await supabase.from('academies').select('name').eq('id', academyId).maybeSingle()
  return data?.name || null
}

// ── Attendance ────────────────────────────────────────────

// Best-status wins when multiple batch records exist for same student+date
const _STATUS_PRI = { Present: 4, Late: 3, Leave: 2, Absent: 1 }
const _bestStatus = (a, b) => {
  if (!a) return b
  if (!b) return a
  return (_STATUS_PRI[a] || 0) >= (_STATUS_PRI[b] || 0) ? a : b
}

// batchId = null → fetch all batches (aggregate; used for dashboard counts)
// batchId = number → fetch only that batch's marks
export async function fetchAttendanceForDate(date, batchId = null) {
  let q = supabase.from('attendance').select('student_id, present, status').eq('date', date)
  if (batchId != null) q = q.eq('batch_id', batchId)
  const { data, error } = await q
  if (error) {
    if (error.code === '42P01') return {}
    throw error
  }
  const record = {}
  data.forEach(row => {
    const st = row.status || (row.present ? 'Present' : 'Absent')
    record[row.student_id] = _bestStatus(record[row.student_id], st)
  })
  return record
}

// batchId = null → save as legacy/admin mark (no batch context)
// batchId = number → save scoped to that batch
export async function saveAttendanceForDate(date, records, batchId = null) {
  const toDelete = []
  const toUpsert = []
  Object.entries(records).forEach(([student_id, status]) => {
    const sid = Number(student_id)
    if (!status) toDelete.push(sid)
    else toUpsert.push({ date, student_id: sid, batch_id: batchId, present: status === 'Present', status })
  })
  if (toDelete.length > 0) {
    let q = supabase.from('attendance').delete().eq('date', date).in('student_id', toDelete)
    q = batchId != null ? q.eq('batch_id', batchId) : q.is('batch_id', null)
    const { error } = await q
    if (error) throw error
  }
  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from('attendance')
      .upsert(toUpsert, { onConflict: 'date,student_id,batch_id' })
    if (error) throw error
  }
}

// Fetch all attendance records for a full month.
// batchId = null → all batches (aggregate); batchId = number → only that batch.
// Returns: { [studentId]: { [day]: 'Present'|'Absent'|'Late'|'Leave' } }
export async function fetchAttendanceForMonth(year, month, batchId = null) {
  const pad = n => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  const start = `${year}-${pad(month + 1)}-01`
  const end   = `${year}-${pad(month + 1)}-${pad(lastDay)}`
  let q = supabase.from('attendance').select('student_id, date, present, status').gte('date', start).lte('date', end)
  if (batchId != null) q = q.eq('batch_id', batchId)
  const { data, error } = await q
  if (error) throw error
  const result = {}
  data.forEach(row => {
    const day = parseInt(String(row.date).slice(8, 10), 10)
    if (!result[row.student_id]) result[row.student_id] = {}
    const st = row.status || (row.present ? 'Present' : 'Absent')
    result[row.student_id][day] = _bestStatus(result[row.student_id][day], st)
  })
  return result
}

// Save entire month's attendance in one upsert.
// batchId = null → legacy/admin mark; batchId = number → batch-scoped.
export async function saveAttendanceMonth(year, month, monthData, batchId = null) {
  const pad = n => String(n).padStart(2, '0')
  const rows = []
  for (const [studentId, days] of Object.entries(monthData)) {
    for (const [day, status] of Object.entries(days)) {
      if (!status) continue
      rows.push({
        date:       `${year}-${pad(month + 1)}-${pad(Number(day))}`,
        student_id: Number(studentId),
        batch_id:   batchId,
        present:    status === 'Present',
        status,
      })
    }
  }
  if (rows.length === 0) return
  // Both null-batch and with-batch rows now use the same composite conflict key.
  // The null-batch path is backed by partial unique index att_no_batch_idx (migration 0031)
  // since Postgres treats NULL != NULL in normal unique constraints.
  const nullBatch = rows.filter(r => r.batch_id == null)
  const withBatch = rows.filter(r => r.batch_id != null)
  const errs = await Promise.all([
    nullBatch.length ? supabase.from('attendance').upsert(nullBatch, { onConflict: 'date,student_id,batch_id' }).then(r => r.error) : null,
    withBatch.length ? supabase.from('attendance').upsert(withBatch, { onConflict: 'date,student_id,batch_id' }).then(r => r.error) : null,
  ])
  const err = errs.find(Boolean)
  if (err) throw err
}

// ── Student Auth & Onboarding ────────────────────────────

export async function fetchStudentCount() {
  const { count, error } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

export async function fetchNextStudentCode() {
  const { data, error } = await supabase.rpc('next_student_code')
  if (error) throw new Error('next_student_code RPC failed — ensure migration 0014 is applied: ' + error.message)
  return data
}

export async function fetchPaymentCount() {
  const { count, error } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

// Returns full 'INV-YYYY-NNN' string from the atomic RPC (migration 0014).
export async function fetchNextInvoiceId() {
  const { data, error } = await supabase.rpc('next_invoice_id')
  if (error) throw new Error('next_invoice_id RPC failed — ensure migration 0014 is applied: ' + error.message)
  return data
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
      dob:            s.dob || null,
      sport:          s.sport || '',
      batch:          s.batchName || '',
      batch_id:       s.batchId   || null,
      join_date:      s.joinDate || new Date().toISOString().split('T')[0],
      status:         'Active',
      fees:           Number(s.fees) || 0,
      student_code:   s.studentCode,
      join_code:      s.joinCode,
      account_status: 'pending',
      fee_amount:     Number(s.feeAmount) || Number(s.fees) || 0,
      fee_due_day:    Number(s.feeDueDay) || null,
      paid_till:      s.paidTill || null,
      training_type:  s.trainingType || 'Daily',
      fee_plan:       s.feePlan      || 'monthly',
      academy_id:     s.academyId    || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Atomic version: student INSERT + (optional) batch counter bump
// + (optional) initial payment INSERT, all in one transaction.
// Calls the 0005_transactional_rpcs.sql function.
// Returns the new student id (number).
export async function createStudentWithPayment(s) {
  const { data, error } = await supabase.rpc('create_student_with_payment', {
    p_name:           s.name,
    p_parent:         s.parent || '',
    p_phone:          s.phone || '',
    p_parent_phone:   s.parentPhone || '',
    p_age:            Number(s.age) || null,
    p_dob:            s.dob || null,
    p_sport:          s.sport || '',
    p_batch:          s.batchName || '',
    p_batch_id:       s.batchId || null,
    p_join_date:      s.joinDate || new Date().toISOString().split('T')[0],
    p_fees:           Number(s.fees) || 0,
    p_fee_amount:     Number(s.feeAmount) || Number(s.fees) || 0,
    p_fee_due_day:    Number(s.feeDueDay) || null,
    p_paid_till:      s.paidTill || null,
    p_training_type:  s.trainingType || 'Daily',
    p_fee_plan:       s.feePlan || 'monthly',
    p_student_code:   s.studentCode,
    p_join_code:      s.joinCode,
    p_academy_id:     s.academyId || null,
    p_suspend_now:    !!s.suspendNow,
    p_invoice_id:     s.payment?.invoiceId    || null,
    p_payment_amount: s.payment?.amount       ?? null,
    p_payment_month:  s.payment?.label        || null,
    p_payment_date:   s.payment?.startDate    || null,
    p_months_covered: s.payment?.monthsCovered ?? null,
  })
  if (error) throw error
  return data  // BIGINT student id
}

export async function activateStudentAccount(studentCode, joinCode, passwordHash) {
  // Routed through secure_activate_student_account (migration 0039).
  // The RPC validates join_code server-side and returns the updated student row.
  const { data, error } = await supabase.rpc('secure_activate_student_account', {
    p_student_code:  studentCode,
    p_join_code:     joinCode,
    p_password_hash: passwordHash,
  })
  if (error) throw new Error('Invalid Student ID or Join Code')
  return data
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
  const { error } = await supabase.rpc('secure_reset_student_password', {
    p_student_id: studentId,
    p_join_code:  newJoinCode,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function assignStudentBatch(studentId, batchId, batchName) {
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: studentId,
    p_payload:    { batchId: batchId ? String(batchId) : null, batchName: batchName || null },
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

// ── Gate QR ───────────────────────────────────────────────
// All three functions scope by academy_id (column added in migration 0031).
// academyName is kept for display labelling only; academyId drives isolation.

export async function getOrCreateGateQR(academyId, academyName) {
  if (!academyId) throw new Error('getOrCreateGateQR requires academyId')
  const { data: existing } = await supabase
    .from('gate_qr')
    .select('*')
    .eq('academy_id', academyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing) return existing

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const { data, error } = await supabase
    .from('gate_qr')
    .insert({ token, academy_name: academyName || 'Academy Gate', academy_id: academyId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function regenerateGateQR(academyId, academyName) {
  if (!academyId) throw new Error('regenerateGateQR requires academyId')
  // Only delete this academy's rows. Previous version used .neq('id', 0)
  // which wiped every academy's gate QR — cross-tenant data loss.
  await supabase.from('gate_qr').delete().eq('academy_id', academyId)
  return getOrCreateGateQR(academyId, academyName)
}

export async function validateGateToken(token, academyId) {
  if (!academyId) return false
  const { data } = await supabase
    .from('gate_qr')
    .select('id')
    .eq('token', token)
    .eq('academy_id', academyId)
    .maybeSingle()
  return !!data
}

// ── QR Attendance ─────────────────────────────────────────

export async function markAttendanceDirect(studentId, batchIdOverride = undefined) {
  const today = new Date().toISOString().split('T')[0]
  // batchIdOverride: when the student is in multiple batches, the caller passes
  // the specific batch that is active today so the attendance row is keyed correctly.
  let batchId = batchIdOverride !== undefined ? batchIdOverride : null
  if (batchIdOverride === undefined) {
    try {
      const { data } = await supabase
        .from('students').select('batch_id').eq('id', studentId).maybeSingle()
      batchId = data?.batch_id ?? null
    } catch { /* ignore — proceed with NULL batch */ }
  }

  if (batchId != null) {
    // Common path — student has a primary batch; UPSERT on the composite key.
    const { error } = await supabase
      .from('attendance')
      .upsert(
        { date: today, student_id: studentId, batch_id: batchId, present: true, status: 'Present' },
        { onConflict: 'date,student_id,batch_id' }
      )
    if (error) throw error
    return
  }

  // Rare path — student with no primary batch. Partial unique index from migration
  // 0015b prevents duplicates but PostgREST can't target it via onConflict (no WHERE
  // clause support). Use SELECT-then-INSERT — race-safe enough for the rare case.
  const { data: existing } = await supabase
    .from('attendance')
    .select('id, status')
    .eq('date', today).eq('student_id', studentId).is('batch_id', null)
    .maybeSingle()
  if (existing) {
    // Already marked today — only escalate from Absent/Leave to Present, never downgrade.
    if (existing.status === 'Present' || existing.status === 'Late') return
    const { error } = await supabase
      .from('attendance')
      .update({ present: true, status: 'Present' })
      .eq('id', existing.id)
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('attendance')
    .insert({ date: today, student_id: studentId, batch_id: null, present: true, status: 'Present' })
  if (error) throw error
}

export async function markAttendanceViaQR(studentId, gateToken, batchIdOverride = undefined, academyId = null) {
  const today = new Date().toISOString().split('T')[0]

  const isValid = await validateGateToken(gateToken, academyId)
  if (!isValid) throw new Error('Invalid gate QR code')

  // Resolve batch_id: use override (multi-batch) or fall back to student's primary batch
  let batchId = batchIdOverride !== undefined ? batchIdOverride : null
  if (batchIdOverride === undefined) {
    try {
      const { data } = await supabase.from('students').select('batch_id').eq('id', studentId).maybeSingle()
      batchId = data?.batch_id ?? null
    } catch { /* proceed with null */ }
  }

  const query = supabase.from('attendance').select('id').eq('date', today).eq('student_id', studentId)
  const { data: existing } = batchId != null
    ? await query.eq('batch_id', batchId).maybeSingle()
    : await query.is('batch_id', null).maybeSingle()
  if (existing) throw new Error('already marked')

  const { error } = await supabase
    .from('attendance')
    .insert({ date: today, student_id: studentId, batch_id: batchId, present: true, status: 'Present' })
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
      name:         b.name,
      code:         b.code || null,
      time:         b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : b.time,
      sports:       b.sports   || [],
      coach:        b.coach,
      capacity:     Number(b.capacity),
      enrolled:     0,
      waitlist:     0,
      days:         b.days     || [],
      start_time:   b.startTime || null,
      end_time:     b.endTime   || null,
      age_min:      Number(b.ageMin) || 0,
      age_max:      Number(b.ageMax) || 99,
      ground:       b.ground || null,
      default_fee:  Number(b.defaultFee)  || 0,
      default_plan: b.defaultPlan         || 'monthly',
      academy_id:   b.academyId  || null,
      branch_id:    b.branchId   || null,
    })
    .select()
  if (error) throw error
  return data?.[0] || b
}

// ── Announcements ─────────────────────────────────────────
export async function fetchAnnouncements(academyId) {
  let query = supabase.from('announcements').select('*').order('date', { ascending: false })
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
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
      title:      a.title,
      body:       a.body,
      type:       a.type,
      author:     a.author || 'Admin',
      date:       new Date().toISOString().split('T')[0],
      academy_id: a.academyId || null,
    })
    .select()
    .single()
  if (error) throw error
  return { ...a, id: data.id, date: data.date }
}

// ── Fee Plans ─────────────────────────────────────────────
export async function fetchFeePlans(academyId) {
  let query = supabase.from('fee_plans').select('*').order('batch_id').order('id')
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
  if (error) {
    if (error.code === '42P01') return []
    throw error
  }
  return data.map(row => ({
    id:           row.id,
    batchId:      row.batch_id,
    name:         row.name,
    trainingType: row.training_type,
    monthlyFee:   row.monthly_fee   || 0,
    quarterlyFee: row.quarterly_fee || 0,
    yearlyFee:    row.yearly_fee    || 0,
    academyId:    row.academy_id,
  }))
}

export async function insertFeePlan(p) {
  const { data, error } = await supabase
    .from('fee_plans')
    .insert({
      academy_id:    p.academyId    || null,
      batch_id:      p.batchId,
      name:          p.name,
      training_type: p.trainingType || 'daily',
      monthly_fee:   Number(p.monthlyFee)   || 0,
      quarterly_fee: Number(p.quarterlyFee) || 0,
      yearly_fee:    Number(p.yearlyFee)    || 0,
    })
    .select().single()
  if (error) throw error
  return { id: data.id, batchId: data.batch_id, name: data.name, trainingType: data.training_type,
    monthlyFee: data.monthly_fee || 0, quarterlyFee: data.quarterly_fee || 0, yearlyFee: data.yearly_fee || 0, academyId: data.academy_id }
}

export async function updateFeePlan(id, p) {
  const { error } = await supabase
    .from('fee_plans')
    .update({
      name:          p.name,
      training_type: p.trainingType || 'daily',
      monthly_fee:   Number(p.monthlyFee)   || 0,
      quarterly_fee: Number(p.quarterlyFee) || 0,
      yearly_fee:    Number(p.yearlyFee)    || 0,
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteFeePlan(id) {
  const { error } = await supabase.from('fee_plans').delete().eq('id', id)
  if (error) throw error
}

export async function updateBatchFee(batchId, defaultFee, defaultPlan) {
  const { error } = await supabase
    .from('batches')
    .update({ default_fee: Number(defaultFee) || 0, default_plan: defaultPlan || 'monthly' })
    .eq('id', batchId)
  if (error) throw error
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
      name:         b.name,
      code:         b.code || null,
      time:         b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : b.time,
      sports:       b.sports   || [],
      coach:        b.coach,
      capacity:     Number(b.capacity),
      days:         b.days     || [],
      start_time:   b.startTime || null,
      end_time:     b.endTime   || null,
      age_min:      Number(b.ageMin) || 0,
      age_max:      Number(b.ageMax) || 99,
      ground:       b.ground || null,
      default_fee:  Number(b.defaultFee)  || 0,
      default_plan: b.defaultPlan         || 'monthly',
    })
    .eq('id', batchId)
    .select()
  if (error) throw error
  return data?.[0] || b
}

export async function deleteBatch(id) {
  // Routed through secure_delete_batch (migration 0033).
  const { error } = await supabase.rpc('secure_delete_batch', {
    p_batch_id: id,
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function fetchEvents(academyId) {
  let query = supabase.from('events').select('*').order('date', { ascending: true })
  if (academyId) query = query.eq('academy_id', academyId)
  const { data, error } = await query
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
      title:         e.title,
      type:          e.type,
      sport:         e.sport || null,
      date:          e.date,
      end_date:      e.endDate || null,
      venue:         e.venue || null,
      description:   e.description || null,
      status:        e.status || 'Upcoming',
      academy_id:    e.academyId || null,
      audience_type: e.audienceType || 'all',
      audience_ids:  e.audienceIds  || [],
      flyer_url:     e.flyerUrl     || null,
      bracket_type:  e.bracketType  || null,
      participants:  e.participants  || [],
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateEvent(id, e) {
  const fields = {}
  if (e.title        !== undefined) fields.title         = e.title
  if (e.type         !== undefined) fields.type          = e.type
  if (e.sport        !== undefined) fields.sport         = e.sport || null
  if (e.date         !== undefined) fields.date          = e.date
  if (e.endDate      !== undefined) fields.end_date      = e.endDate || null
  if (e.venue        !== undefined) fields.venue         = e.venue || null
  if (e.description  !== undefined) fields.description   = e.description || null
  if (e.status       !== undefined) fields.status        = e.status
  if (e.audienceType !== undefined) fields.audience_type = e.audienceType
  if (e.audienceIds  !== undefined) fields.audience_ids  = e.audienceIds
  if (e.flyerUrl     !== undefined) fields.flyer_url     = e.flyerUrl || null
  if (e.bracketType  !== undefined) fields.bracket_type  = e.bracketType || null
  if (e.participants !== undefined) fields.participants  = e.participants
  const { error } = await supabase.from('events').update(fields).eq('id', id)
  if (error) throw error
}

export async function updateEventStatus(id, status) {
  const { error } = await supabase.from('events').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

export async function uploadEventFlyer(file, title) {
  const ext  = file.name.split('.').pop()
  const path = `flyers/${Date.now()}_${title.replace(/\s+/g, '_').slice(0, 30)}.${ext}`
  const { error } = await supabase.storage.from('staff-photos').upload(path, file, { upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
  return data.publicUrl
}

export async function fetchTournamentMatches(eventId) {
  const { data, error } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('event_id', eventId)
    .order('round')
    .order('match_number')
  if (error) throw error
  return data || []
}

export async function insertTournamentMatches(eventId, matches) {
  const rows = matches.map(m => ({
    event_id:     eventId,
    round:        m.round,
    match_number: m.matchNumber,
    player1_id:   m.player1Id   || null,
    player1_name: m.player1Name,
    player2_id:   m.player2Id   || null,
    player2_name: m.player2Name,
    is_bye:       m.isBye       || false,
    winner_id:    m.winnerId    || null,
    winner_name:  m.winnerName  || null,
  }))
  const { error } = await supabase.from('tournament_matches').insert(rows)
  if (error) throw error
}

export async function updateTournamentMatch(id, { winnerId, winnerName, score }) {
  const { error } = await supabase
    .from('tournament_matches')
    .update({ winner_id: winnerId || null, winner_name: winnerName || null,
              score: score || null, played_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEventMatches(eventId) {
  const { error } = await supabase.from('tournament_matches').delete().eq('event_id', eventId)
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

// ── Sport Branches (proper branches under a sport) ───────────
// Sourced from sport_branches table (created in migration 0016b/0017b).
// Resilient to the 0018 `address` column not yet existing — falls back to a
// reduced select so the rest of the branch picker still works.
export async function fetchSportBranches(academyId) {
  const baseColumns = 'id, sport_name, branch_name, created_at'
  // Try with address first; if the column doesn't exist (42703), retry without it
  let { data, error } = await supabase
    .from('sport_branches')
    .select(`${baseColumns}, address`)
    .eq('academy_id', academyId)
    .order('sport_name')
    .order('branch_name')
  if (error && error.code === '42703') {
    const retry = await supabase
      .from('sport_branches')
      .select(baseColumns)
      .eq('academy_id', academyId)
      .order('sport_name')
      .order('branch_name')
    data  = retry.data
    error = retry.error
  }
  if (error) {
    if (error.code === '42P01') return []   // table doesn't exist yet
    throw error
  }
  return (data || []).map(r => ({
    id:         r.id,
    sportName:  r.sport_name,
    branchName: r.branch_name,
    address:    r.address || '',
    createdAt:  r.created_at,
  }))
}

export async function insertSportBranch(academyId, sportName, branchName, address = '') {
  const payload = { academy_id: academyId, sport_name: sportName, branch_name: branchName }
  if (address) payload.address = address
  let { data, error } = await supabase.from('sport_branches').insert(payload).select().single()
  if (error && error.code === '42703' && payload.address !== undefined) {
    // address column doesn't exist yet — retry without it
    delete payload.address
    const retry = await supabase.from('sport_branches').insert(payload).select().single()
    data  = retry.data
    error = retry.error
  }
  if (error) throw error
  return {
    id:         data.id,
    sportName:  data.sport_name,
    branchName: data.branch_name,
    address:    data.address || '',
    createdAt:  data.created_at,
  }
}

export async function updateSportBranch(branchId, { branchName, address }) {
  const fields = {}
  if (branchName !== undefined) fields.branch_name = branchName
  if (address    !== undefined) fields.address     = address || null
  if (Object.keys(fields).length === 0) return
  let { error } = await supabase.from('sport_branches').update(fields).eq('id', branchId)
  if (error && error.code === '42703' && 'address' in fields) {
    // address column doesn't exist yet — retry without it
    delete fields.address
    if (Object.keys(fields).length === 0) return
    const retry = await supabase.from('sport_branches').update(fields).eq('id', branchId)
    error = retry.error
  }
  if (error) throw error
}

export async function deleteSportBranch(branchId) {
  const { error } = await supabase
    .from('sport_branches')
    .delete()
    .eq('id', branchId)
  if (error) throw error
}

// ── Leave Requests ────────────────────────────────────────

// Staff submits a leave request — academyId scopes to current tenant
export async function createLeaveRequest(staffId, staffName, startDate, endDate, reason, academyId = null) {
  const row = { staff_id: staffId, staff_name: staffName, start_date: startDate, end_date: endDate, reason, status: 'Pending' }
  if (academyId) row.academy_id = academyId
  const { data, error } = await supabase
    .from('leave_requests')
    .insert(row)
    .select()
  if (error) throw error
  return data?.[0] || row
}

// Owner fetches all leave requests for their academy — strict isolation.
// Migration 0031 backfills any NULL academy_id rows from staff.academy_id so
// legacy data is preserved before this stricter filter is applied.
export async function fetchLeaveRequests(academyId = null) {
  let q = supabase.from('leave_requests').select('*')
  if (academyId) q = q.eq('academy_id', academyId)
  const { data, error } = await q.order('created_at', { ascending: false })
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

// ── Performance / Skill Assessments ──────────────────────

export async function fetchAssessmentsByBatch(batchId, month) {
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('*')
    .eq('batch_id', batchId)
    .eq('assessed_month', month)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchAssessmentsByBatches(batchIds, month) {
  if (!batchIds || !batchIds.length) return []
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('*')
    .in('batch_id', batchIds)
    .eq('assessed_month', month)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchStudentAssessments(studentId) {
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('*')
    .eq('student_id', studentId)
    .order('assessed_month', { ascending: false })
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// Coach portal — includes academy_id so RLS can match the row
export async function fetchStudentAssessmentsForCoach(studentId, academyId) {
  let q = supabase
    .from('skill_assessments')
    .select('*')
    .eq('student_id', studentId)
    .order('assessed_month', { ascending: false })
  if (academyId) q = q.eq('academy_id', academyId)
  const { data, error } = await q
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchAllAssessments(academyId, month) {
  let q = supabase.from('skill_assessments').select('*')
  if (academyId) q = q.eq('academy_id', academyId)
  if (month) q = q.eq('assessed_month', month)
  const { data, error } = await q.order('assessed_month', { ascending: false })
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function upsertAssessment({ studentId, staffId, batchId, sport, month, scores, notes, academyId }) {
  const { data, error } = await supabase
    .from('skill_assessments')
    .upsert({
      student_id:     studentId,
      staff_id:       staffId,
      batch_id:       batchId,
      sport,
      assessed_month: month,
      scores,
      notes,
      academy_id:     academyId,
    }, { onConflict: 'student_id,assessed_month,sport' })
    .select()
  if (error) throw error
  return data?.[0]
}

// ── Multi-batch enrolment ─────────────────────────────────

export async function fetchStudentBatches(studentId) {
  const { data, error } = await supabase
    .from('student_batches')
    .select('*')
    .eq('student_id', studentId)
    .order('enrolled_at', { ascending: true })
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchBatchEnrolments(batchId) {
  const { data, error } = await supabase
    .from('student_batches')
    .select('*')
    .eq('batch_id', batchId)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchAllBatchEnrolments() {
  const { data, error } = await supabase
    .from('student_batches')
    .select('batch_id, student_id')
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function assignStudentToBatch(studentId, batchId, batchName, academyId) {
  const { error } = await supabase
    .from('student_batches')
    .upsert({ student_id: studentId, batch_id: batchId, batch_name: batchName, academy_id: academyId },
      { onConflict: 'student_id,batch_id' })
  if (error) throw error
}

export async function unassignStudentFromBatch(studentId, batchId) {
  const { error } = await supabase
    .from('student_batches')
    .delete()
    .eq('student_id', studentId)
    .eq('batch_id', batchId)
  if (error) throw error
}

export async function fetchAllStudentBatches(academyId) {
  let q = supabase.from('student_batches').select('*')
  if (academyId) q = q.eq('academy_id', academyId)
  const { data, error } = await q
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchAuditLogs(academyId, limit = 300, sport = null, branchId = null) {
  let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (academyId) q = q.eq('academy_id', academyId)
  // Branch filter is STRICT (no null bleed) — when a branch is selected, only its entries show.
  // Sport filter includes null-sport entries (old/untagged) so historical logs aren't lost.
  if (branchId) {
    q = q.eq('branch_id', branchId)
  } else if (sport) {
    q = q.or(`sport.eq.${sport},sport.is.null`)
  }
  const { data, error } = await q
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// ── Player Development: session feedback (pulse + spotlight) ─

// Coach fetches existing feedback rows for a batch on a given date —
// used to pre-fill the pulse picker so coach can edit, not duplicate.
export async function fetchSessionFeedback(date, batchId) {
  let q = supabase.from('session_feedback').select('*').eq('date', date)
  if (batchId) q = q.eq('batch_id', batchId)
  const { data, error } = await q
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// Coach saves pulse for a batch — one upsert per student-rating tuple.
// `records` shape: [{ studentId, effort, execution, focus }]
export async function saveSessionPulse({ date, batchId, academyId, staffId, records }) {
  if (!records?.length) return
  const rows = records.map(r => ({
    date,
    batch_id:   batchId ?? null,
    student_id: r.studentId,
    academy_id: academyId ?? null,
    staff_id:   staffId   ?? null,
    effort:     r.effort,
    execution:  r.execution,
    focus:      r.focus,
  }))
  const { error } = await supabase
    .from('session_feedback')
    .upsert(rows, { onConflict: 'date,student_id,batch_id' })
  if (error) throw error
}

// Coach adds detailed 4-corner spotlight + note for one student — overlays
// onto the same row as their pulse for that date/batch.
export async function upsertSpotlight({ date, batchId, academyId, staffId, studentId, technical, tactical, physical, mental, note }) {
  const { error } = await supabase
    .from('session_feedback')
    .upsert({
      date,
      batch_id:    batchId ?? null,
      student_id:  studentId,
      academy_id:  academyId ?? null,
      staff_id:    staffId   ?? null,
      technical, tactical, physical, mental,
      note:        note || null,
      spotlight_at: new Date().toISOString(),
    }, { onConflict: 'date,student_id,batch_id' })
  if (error) throw error
}

// Student saves their own post-session reflection. Lives on the same row;
// keyed by date + student + their current batch (or null when no batch).
export async function saveSelfReflection({ date, batchId, academyId, studentId, energy, performance, focus }) {
  const { error } = await supabase
    .from('session_feedback')
    .upsert({
      date,
      batch_id:         batchId ?? null,
      student_id:       studentId,
      academy_id:       academyId ?? null,
      self_energy:      energy,
      self_performance: performance,
      self_focus:       focus,
      self_at:          new Date().toISOString(),
    }, { onConflict: 'date,student_id,batch_id' })
  if (error) throw error
}

// Student progress page — fetch last N feedback rows for the student,
// newest first. Includes pulse, spotlight, and own self-reflection.
export async function fetchStudentFeedback(studentId, limit = 30) {
  const { data, error } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// Last spotlight (4-corner + note) entries the coach left for this student.
export async function fetchStudentSpotlights(studentId, limit = 5) {
  const { data, error } = await supabase
    .from('session_feedback')
    .select('*')
    .eq('student_id', studentId)
    .not('spotlight_at', 'is', null)
    .order('spotlight_at', { ascending: false })
    .limit(limit)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// ── Player Development: monthly focus goals ─────────────────

// Active goal for a student in a given month ('YYYY-MM'). Returns null if none.
export async function fetchPlayerGoal(studentId, month) {
  const { data, error } = await supabase
    .from('player_goals')
    .select('*')
    .eq('student_id', studentId)
    .eq('month', month)
    .maybeSingle()
  if (error) { if (error.code === '42P01') return null; throw error }
  return data
}

// Coach upserts a goal for a student in a month. Empty/blank text deletes the goal.
export async function upsertPlayerGoal({ studentId, month, goalText, academyId, staffId }) {
  const text = (goalText || '').trim()
  if (!text) {
    await supabase.from('player_goals').delete().eq('student_id', studentId).eq('month', month)
    return null
  }
  const { data, error } = await supabase
    .from('player_goals')
    .upsert({
      student_id: studentId,
      month,
      goal_text:  text,
      academy_id: academyId ?? null,
      staff_id:   staffId   ?? null,
    }, { onConflict: 'student_id,month' })
    .select()
  if (error) throw error
  return data?.[0]
}

// Coach side — all goals for students in a batch for a given month.
export async function fetchBatchGoals(studentIds, month) {
  if (!studentIds?.length) return []
  const { data, error } = await supabase
    .from('player_goals')
    .select('*')
    .in('student_id', studentIds)
    .eq('month', month)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// ── Activity session tracking (ops dashboard) ───────────────

export async function startActivitySession({ userType, userId, userName, academyId, academyName, device }) {
  const { data, error } = await supabase
    .from('activity_sessions')
    .insert({
      user_id:      userId       ? String(userId) : null,
      user_type:    userType,
      user_name:    userName,
      academy_id:   academyId   || null,
      academy_name: academyName || null,
      device:       device      || null,
    })
    .select('session_uuid')
    .single()
  if (error) throw error
  return data.session_uuid
}

export async function heartbeatActivitySession(sessionUuid) {
  await supabase
    .from('activity_sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('session_uuid', sessionUuid)
}

export async function endActivitySession(sessionUuid) {
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('activity_sessions')
    .select('started_at')
    .eq('session_uuid', sessionUuid)
    .single()
  const durationSeconds = data?.started_at
    ? Math.round((Date.now() - new Date(data.started_at).getTime()) / 1000)
    : null
  await supabase
    .from('activity_sessions')
    .update({ ended_at: now, last_active_at: now, duration_seconds: durationSeconds })
    .eq('session_uuid', sessionUuid)
}

export async function fetchActivitySessions(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data, error } = await supabase
    .from('activity_sessions')
    .select('*')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(500)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchAllAuditLogs(limit = 500) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

// ── Session Planner: Drill Library ───────────────────────────

export async function fetchDrills(academyId, sportName) {
  // Global drills filtered by sport (case-insensitive when sportName provided)
  let globalQ = supabase.from('drills').select('*').eq('is_global', true).order('name')
  if (sportName) globalQ = globalQ.ilike('sport_name', sportName)

  const promises = [globalQ]

  // Custom academy drills always included (sport scope is implicit by academy)
  if (academyId) {
    promises.push(
      supabase.from('drills').select('*')
        .eq('academy_id', academyId).eq('is_global', false).order('name')
    )
  }

  const results = await Promise.all(promises)
  for (const { error } of results) {
    if (error) { if (error.code === '42P01') return []; throw error }
  }

  const all = results.flatMap(r => r.data || [])
  const seen = new Set()
  return all.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true })
            .sort((a, b) => a.name.localeCompare(b.name))
}

export async function createDrill(drill) {
  const { data, error } = await supabase.from('drills').insert(drill).select().single()
  if (error) throw error
  return data
}

export async function updateDrill(id, updates) {
  const { data, error } = await supabase.from('drills').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteDrill(id) {
  const { error } = await supabase.from('drills').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDrillFavorites(staffId) {
  if (!staffId) return []
  const { data, error } = await supabase
    .from('drill_favorites').select('drill_id').eq('staff_id', staffId)
  if (error) { if (error.code === '42P01') return []; throw error }
  return (data || []).map(r => r.drill_id)
}

export async function toggleDrillFavorite(drillId, staffId, academyId) {
  const { data: existing } = await supabase
    .from('drill_favorites').select('id')
    .eq('drill_id', drillId).eq('staff_id', staffId).maybeSingle()
  if (existing) {
    const { error } = await supabase.from('drill_favorites').delete().eq('id', existing.id)
    if (error) throw error
    return false
  } else {
    const { error } = await supabase.from('drill_favorites').insert({ drill_id: drillId, staff_id: staffId, academy_id: academyId })
    if (error) throw error
    return true
  }
}

// ── DRILL IMAGE UPLOAD ────────────────────────────────────────────────────────

export async function uploadDrillDiagram(file, drillId) {
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${drillId}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('drill-diagrams')
    .upload(path, file, { upsert: true })
  if (upErr) throw upErr
  const { data: { publicUrl } } = supabase.storage
    .from('drill-diagrams')
    .getPublicUrl(path)
  return publicUrl
}

// ── SESSION PLANS ─────────────────────────────────────────────────────────────

export async function fetchSessionPlans({ academyId, batchId, coachId, status } = {}) {
  let q = supabase.from('session_plans')
    .select('*, session_phases(*)')
    .order('date', { ascending: false })
  if (academyId) q = q.eq('academy_id', academyId)
  if (batchId)   q = q.eq('batch_id', batchId)
  if (coachId)   q = q.eq('coach_id', coachId)
  if (status)    q = q.eq('status', status)
  const { data, error } = await q
  if (error) { if (error.code === '42P01') return []; throw error }
  return data || []
}

export async function fetchSessionPlan(id) {
  const { data, error } = await supabase.from('session_plans')
    .select('*, session_phases(*, drills(*))')
    .eq('id', id)
    .single()
  if (error) throw error
  if (data?.session_phases) {
    data.session_phases = data.session_phases.sort((a, b) => a.position - b.position)
  }
  return data
}

export async function createSessionPlan(plan) {
  const { data, error } = await supabase.from('session_plans')
    .insert(plan).select().single()
  if (error) throw error
  return data
}

export async function updateSessionPlan(id, updates) {
  const { data, error } = await supabase.from('session_plans')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteSessionPlan(id) {
  const { error } = await supabase.from('session_plans').delete().eq('id', id)
  if (error) throw error
}

export async function activateSessionPlan(id) {
  const { data, error } = await supabase.from('session_plans')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function completeSessionPlan(id) {
  const { data, error } = await supabase.from('session_plans')
    .update({ status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) throw error
  return data
}


export async function duplicateSessionPlan(id, newDate, newBatchId) {
  // Fetch original with phases
  const original = await fetchSessionPlan(id)
  // Create new plan
  const { id: _id, created_at, updated_at, completed_at, status, ...planData } = original
  const newPlan = await createSessionPlan({
    ...planData,
    date: newDate,
    batch_id: newBatchId || original.batch_id,
    status: 'draft',
  })
  // Clone phases
  const phases = (original.session_phases || []).map(({ id: _pid, session_id, created_at: _ca, drills: _d, ...p }) => ({
    ...p,
    session_id: newPlan.id,
  }))
  if (phases.length > 0) {
    const { error } = await supabase.from('session_phases').insert(phases)
    if (error) throw error
  }
  return newPlan
}

// ── SESSION PHASES ────────────────────────────────────────────────────────────

export async function createSessionPhase(phase) {
  const { data, error } = await supabase.from('session_phases')
    .insert(phase).select('*, drills(*)').single()
  if (error) throw error
  return data
}

export async function updateSessionPhase(id, updates) {
  const { data, error } = await supabase.from('session_phases')
    .update(updates).eq('id', id).select('*, drills(*)').single()
  if (error) throw error
  return data
}

export async function deleteSessionPhase(id) {
  const { error } = await supabase.from('session_phases').delete().eq('id', id)
  if (error) throw error
}

export async function reorderSessionPhases(updates) {
  // updates = [{id, position}]
  await Promise.all(
    updates.map(({ id, position }) =>
      supabase.from('session_phases').update({ position }).eq('id', id)
    )
  )
}

