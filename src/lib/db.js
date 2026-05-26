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

// Move a student's PRIMARY batch only. Minimal payload so secure_update_student
// touches just batch_id + batch (its CASE WHEN p_payload ? 'key' leaves every
// other field untouched) — unlike updateStudent, which sends the full record.
export async function reassignStudentBatch(studentId, batchId, batchName) {
  const { error } = await supabase.rpc('secure_update_student', {
    p_student_id: studentId,
    p_payload: {
      batchId:   batchId != null ? String(batchId) : null,
      batchName: batchName || '',
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
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

// Student-only — update own football profile (height/weight/foot/wing)
export async function updateStudentSelfProfile(studentId, { heightCm, weightKg, preferredFoot, wing } = {}) {
  const payload = {}
  if (heightCm      !== undefined) payload.heightCm      = heightCm
  if (weightKg      !== undefined) payload.weightKg      = weightKg
  if (preferredFoot !== undefined) payload.preferredFoot = preferredFoot
  if (wing          !== undefined) payload.wing          = wing
  const { data, error } = await supabase.rpc('secure_update_student_self_profile', {
    p_student_id: studentId,
    p_payload:    payload,
    p_token:      _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
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

// Fetch ALL batchmates of a student across every batch they belong to (primary + multi-batch).
// Routed through secure_fetch_student_batchmates RPC (security-v3/11) —
// the RPC validates the caller's token and only returns safe display
// fields (id, name, position, photo_url, status). A student can only
// request their own batchmates; staff/owner can request any in their academy.
export async function fetchStudentBatchmatesForPitch(studentId) {
  const { data, error } = await supabase.rpc('secure_fetch_student_batchmates', {
    p_student_id: studentId,
    p_token:      _sessionToken(),
  })
  if (error) { if (error.code === '42P01') return []; throw error }
  return (data || []).map(s => ({
    id:       s.id,
    name:     s.name,
    position: s.position || null,
    photoUrl: s.photo_url || null,
    status:   s.status,
  }))
}

// Fetch all students in a specific batch. Routed through
// secure_fetch_batch_students RPC — caller's batch+academy membership
// validated server-side.
export async function fetchBatchStudentsForPitch(batchId) {
  const { data, error } = await supabase.rpc('secure_fetch_batch_students', {
    p_batch_id: batchId,
    p_token:    _sessionToken(),
  })
  if (error) { if (error.code === '42P01') return []; throw error }
  return (data || []).map(s => ({
    id:       s.id,
    name:     s.name,
    position: s.position || null,
    photoUrl: s.photo_url || null,
    status:   s.status,
  }))
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
  const { data, error } = await supabase.rpc('secure_insert_trial', {
    p_payload: {
      name:          t.name,
      parent:        t.parent        || '',
      phone:         t.phone,
      age:           t.age           != null ? String(t.age) : null,
      sport:         t.sport,
      trialDate:     t.trialDate,
      source:        t.source        || null,
      batchId:       t.batchId       != null ? String(t.batchId) : null,
      trialSessions: String(t.trialSessions || 1),
      followUp:      t.followUp      || null,
      notes:         t.notes         || null,
      quotedFee:     t.quotedFee     != null ? String(t.quotedFee) : null,
      sessionStart:  t.sessionStart  || null,
      sessionEnd:    t.sessionEnd    || null,
      dob:           t.dob           || null,
      ageGroup:      t.ageGroup      || null,
      programType:   t.programType   || 'academy',
      trialFeePaid:  String(t.trialFeePaid ?? 590),
      branchId:      t.branchId      || null,
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
  const row = typeof data === 'string' ? JSON.parse(data) : data
  return { ...t, id: row.id, stage: 'scheduled', converted: false, sessionsDone: 0 }
}

export async function updateTrial(id, updates) {
  // Build camelCase payload — RPC uses CASE WHEN p_payload ? 'key' per field
  const payload = {}
  const fields = ['name','phone','parent','age','sport','status','stage','converted',
    'followUp','batchId','trialDate','trialSessions','sessionsDone','coachNote',
    'coachRec','notes','quotedFee','sessionStart','sessionEnd','dob','ageGroup',
    'programType','trialFeePaid']
  fields.forEach(k => { if (updates[k] !== undefined) payload[k] = updates[k] })
  const { error } = await supabase.rpc('secure_update_trial', {
    p_trial_id: id,
    p_payload:  payload,
    p_token:    _sessionToken(),
  })
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

export async function insertTrialSource(_academyId, label) {
  const { data, error } = await supabase.rpc('secure_insert_trial_source', {
    p_label: label.trim(), p_token: _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

export async function deleteTrial(id) {
  const { error } = await supabase.rpc('secure_delete_trial', {
    p_trial_id: id, p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function deleteTrialSource(id) {
  const { error } = await supabase.rpc('secure_delete_trial_source', {
    p_id: id, p_token: _sessionToken(),
  })
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
  // Staff portal uses the anon key, which cannot read staff_auth (locked in
  // security-v3). Route through a scoped SECURITY DEFINER RPC so access_role,
  // permissions and staff_code are populated. Owners (JWT) keep the PostgREST
  // path, which already has an owner-scoped read policy on staff_auth.
  const token = _sessionToken()
  if (token) {
    const { data, error } = await supabase.rpc('secure_fetch_staff', { p_token: token })
    if (error) throw error
    return (data || []).map(row => ({
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
      staffCode:     row.staff_code   || null,
      joinCode:      row.join_code    || null,
      staffType:     row.staff_type   || 'coach',
      accountStatus: row.account_status || null,
      accessRole:    row.access_role  || 'coach',
      permissions:   row.permissions  || [],
      age:           row.age          || null,
      licenceUrl:    row.licence_url  || null,
      branchId:      row.branch_id || null,
    }))
  }
  let query = supabase.from('staff')
    .select('*, staff_auth(staff_code, join_code, status, staff_type, access_role, permissions, email), staff_profiles(age, licence_url)')
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
      email:         auth?.email        || null,
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
  const { data, error } = await supabase.rpc('secure_insert_staff', {
    p_token:      _sessionToken(),
    p_name:       s.name,
    p_role:       s.role,
    p_phone:      s.phone       || '',
    p_sports:     s.sports      || [],
    p_salary:     Number(s.salary) || 0,
    p_join_date:  s.joinDate    || null,
    p_status:     s.status      || 'Active',
    p_photo_url:  s.photoUrl    || null,
    p_staff_code: s.staffCode   || null,
    p_join_code:  s.joinCode    || null,
    p_staff_type: s.staffType   || 'coach',
    p_branch_id:  s.branchId    || null,
  })
  if (error) throw error
  return { ...s, id: data, attendance: 100 }
}

// ── Staff Auth (custom auth — staff_auth + staff_sessions) ─

export async function fetchNextStaffCode(type) {
  // Routed through secure_fetch_next_staff_code (security-v3/06).
  // Owner-only RPC; anon can no longer SELECT from staff_auth.
  const { data, error } = await supabase.rpc('secure_fetch_next_staff_code', {
    p_type:  type,
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function verifyStaffCodes(staffCode, joinCode) {
  // Routed through secure_verify_staff_codes (security-v3/04).
  // Validates staff_code + join_code server-side; raises if invalid/used.
  const { error } = await supabase.rpc('secure_verify_staff_codes', {
    p_staff_code: staffCode,
    p_join_code:  joinCode,
  })
  if (error) throw new Error(error.message)
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
  // Routed through secure_login_staff (security-v3/04). The RPC validates
  // credentials, creates the session row server-side, and returns a bundle
  // with token + expires_at + all staff fields. Caller reads .token /
  // .expires_at — no separate createStaffSession() call needed anymore.
  const { data, error } = await supabase.rpc('secure_login_staff', {
    p_email:         email,
    p_password_hash: passwordHash,
  })
  if (error) throw new Error(error.message || 'Invalid email or password')
  if (!data) throw new Error('Invalid email or password')
  return data
}

// Deprecated: secure_login_staff now creates the session row server-side.
// Kept as a no-op for backward compatibility — returns the expires_at from
// the prior login call (passed in as `token` here means the caller still
// wants the legacy 30-day timestamp shape).
export async function createStaffSession(_staffId, _token) {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

export async function validateStaffSession(token) {
  // Routed through secure_validate_staff_session (security-v3/04).
  // Returns the staff bundle (same shape as loginStaffAccount) or null
  // when the token is missing/expired.
  const { data, error } = await supabase.rpc('secure_validate_staff_session', {
    p_token: token,
  })
  if (error || !data) return null
  return data
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
  await supabase.rpc('secure_logout_staff', { p_token: token })
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
  // Routed through secure_update_staff_permissions. Owners may edit anyone;
  // branch managers may edit staff in their own branch (migrations 0081/0083),
  // capped to permissions the caller holds (no escalation). Enforced server-side.
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

// Same as fetchAttendanceForDate but also returns marked_by — used in Reports.
// Returns { [studentId]: { status, markedBy } }
export async function fetchAttendanceWithMarker(date, batchId = null) {
  let q = supabase.from('attendance').select('student_id, present, status, marked_by').eq('date', date)
  if (batchId != null) q = q.eq('batch_id', batchId)
  const { data, error } = await q
  if (error) {
    if (error.code === '42P01') return {}
    throw error
  }
  const record = {}
  data.forEach(row => {
    const st = row.status || (row.present ? 'Present' : 'Absent')
    const existing = record[row.student_id]
    if (!existing || _bestStatus(existing.status, st) === st) {
      record[row.student_id] = { status: st, markedBy: row.marked_by || null }
    }
  })
  return record
}

// batchId = null → save as legacy/admin mark (no batch context)
// batchId = number → save scoped to that batch
export async function saveAttendanceForDate(date, records, batchId = null) {
  const { error } = await supabase.rpc('secure_save_attendance_date', {
    p_date:     date,
    p_batch_id: batchId,
    p_records:  records,
    p_token:    _sessionToken(),
  })
  if (error) throw error
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

// Fetch attendance for a specific set of student IDs for a month.
// Used by the batch view so attendance is never lost when students transfer
// between batches — filters by student identity, not by which batch_id the
// record was tagged with at save time.
// Returns: { [studentId]: { [day]: 'Present'|'Absent'|'Late'|'Leave' } }
export async function fetchAttendanceForStudents(year, month, studentIds) {
  if (!studentIds || studentIds.length === 0) return {}
  const pad = n => String(n).padStart(2, '0')
  const lastDay = new Date(year, month + 1, 0).getDate()
  const start = `${year}-${pad(month + 1)}-01`
  const end   = `${year}-${pad(month + 1)}-${pad(lastDay)}`
  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, date, present, status')
    .gte('date', start)
    .lte('date', end)
    .in('student_id', studentIds)
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
  const { error } = await supabase.rpc('secure_upsert_attendance', {
    p_rows:  rows,
    p_token: _sessionToken(),
  })
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
    // Branch: owner passes the viewed branch; field staff are forced into their
    // own branch server-side (RPC overrides p_branch_id when staff has a branch).
    p_token:          _sessionToken(),
    p_branch_id:      s.branchId ?? null,
  })
  if (error) throw error
  return data  // BIGINT student id
}

// ── Backups (private 'backups' bucket; owner-only via storage RLS) ──
// Lists the academy's backup files newest-first.
export async function listBackups(academyId) {
  if (!academyId) return []
  const { data, error } = await supabase
    .storage.from('backups')
    .list(String(academyId), { limit: 100, sortBy: { column: 'name', order: 'desc' } })
  if (error) throw error
  return (data || [])
    .filter(f => f.name.endsWith('.xlsx'))
    .map(f => ({
      name: f.name,
      path: `${academyId}/${f.name}`,
      date: f.name.replace('.xlsx', ''),
      size: f.metadata?.size ?? null,
    }))
}

// Short-lived signed URL for one backup file.
export async function getBackupSignedUrl(path, ttlSeconds = 600) {
  const { data, error } = await supabase
    .storage.from('backups').createSignedUrl(path, ttlSeconds)
  if (error) throw error
  return data.signedUrl
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
  // Routed through secure_login_student (security-v3/04). The RPC validates
  // credentials, creates the session row server-side, and returns the student
  // bundle including .token + .expires_at. AppContext extracts those.
  const { data, error } = await supabase.rpc('secure_login_student', {
    p_student_code:  studentCode,
    p_password_hash: passwordHash,
  })
  if (error) throw new Error(error.message || 'Invalid Student ID or password')
  if (!data) throw new Error('Invalid Student ID or password')
  return data
}

// Deprecated: secure_login_student now creates the session row server-side.
// Kept as a no-op for backward compatibility.
export async function createStudentSession(_studentId, _token) {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

export async function validateStudentSession(token) {
  // Routed through secure_validate_student_session (security-v3/04).
  const { data, error } = await supabase.rpc('secure_validate_student_session', {
    p_token: token,
  })
  if (error || !data) return null
  return data
}

export async function deleteStudentSession(token) {
  await supabase.rpc('secure_logout_student', { p_token: token })
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

export async function getOrCreateGateQR(_academyId, academyName) {
  const { data, error } = await supabase.rpc('secure_get_or_create_gate_qr', {
    p_academy_name: academyName || 'Academy Gate',
    p_token:        _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function regenerateGateQR(_academyId, academyName) {
  const { data, error } = await supabase.rpc('secure_regenerate_gate_qr', {
    p_academy_name: academyName || 'Academy Gate',
    p_token:        _sessionToken(),
  })
  if (error) throw error
  return data
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
  // Resolve batch_id before calling RPC: use override (multi-batch) or student's primary batch.
  let batchId = batchIdOverride !== undefined ? batchIdOverride : null
  if (batchIdOverride === undefined) {
    try {
      const { data } = await supabase
        .from('students').select('batch_id').eq('id', studentId).maybeSingle()
      batchId = data?.batch_id ?? null
    } catch { /* proceed with null batch */ }
  }
  const { error } = await supabase.rpc('secure_mark_attendance', {
    p_student_id: studentId,
    p_batch_id:   batchId,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function markAttendanceViaQR(studentId, gateToken, batchIdOverride = undefined, academyId = null) {
  // Resolve batch_id: use override (multi-batch) or fall back to student's primary batch.
  // Gate token validation, student academy check, and already-marked guard are all in the RPC.
  let batchId = batchIdOverride !== undefined ? batchIdOverride : null
  if (batchIdOverride === undefined) {
    try {
      const { data } = await supabase.from('students').select('batch_id').eq('id', studentId).maybeSingle()
      batchId = data?.batch_id ?? null
    } catch { /* proceed with null */ }
  }
  const { error } = await supabase.rpc('secure_mark_attendance_qr', {
    p_student_id: studentId,
    p_gate_token: gateToken,
    p_batch_id:   batchId,
    p_academy_id: academyId,
  })
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
  const { data, error } = await supabase.rpc('secure_insert_batch', {
    p_token:       _sessionToken(),
    p_name:        b.name,
    p_time:        b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : (b.time || null),
    p_sports:      b.sports      || [],
    p_coach:       b.coach       || null,
    p_capacity:    Number(b.capacity) || 30,
    p_days:        b.days        || [],
    p_start_time:  b.startTime   || null,
    p_end_time:    b.endTime     || null,
    p_age_min:     Number(b.ageMin)  || 0,
    p_age_max:     Number(b.ageMax)  || 99,
    p_ground:      b.ground      || null,
    p_code:        b.code        || null,
    p_default_fee: Number(b.defaultFee) || 0,
    p_default_plan: b.defaultPlan || 'monthly',
    p_branch_id:   b.branchId    || null,
  })
  if (error) throw error
  return data || b
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
    id:       row.id,
    title:    row.title,
    body:     row.body,
    type:     row.type,
    author:   row.author,
    date:     row.date,
    sport:    row.sport    || null,
    branchId: row.branch_id || null,
  }))
}

export async function insertAnnouncement(a) {
  const { data, error } = await supabase.rpc('secure_insert_announcement', {
    p_title:     a.title,
    p_body:      a.body,
    p_type:      a.type,
    p_author:    a.author || 'Admin',
    p_token:     _sessionToken(),
    p_sport:     a.sport     || null,
    p_branch_id: a.branchId  || null,
  })
  if (error) throw error
  const row = typeof data === 'string' ? JSON.parse(data) : data
  return { ...a, id: row.id, date: row.date, sport: row.sport || null, branchId: row.branch_id || null }
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
  const { data, error } = await supabase.rpc('secure_insert_fee_plan', {
    p_batch_id:      p.batchId,
    p_name:          p.name,
    p_training_type: p.trainingType  || 'daily',
    p_monthly_fee:   Number(p.monthlyFee)   || 0,
    p_quarterly_fee: Number(p.quarterlyFee) || 0,
    p_yearly_fee:    Number(p.yearlyFee)    || 0,
    p_token:         _sessionToken(),
  })
  if (error) throw error
  const row = typeof data === 'string' ? JSON.parse(data) : data
  return { id: row.id, batchId: row.batch_id, name: row.name, trainingType: row.training_type,
    monthlyFee: row.monthly_fee || 0, quarterlyFee: row.quarterly_fee || 0, yearlyFee: row.yearly_fee || 0, academyId: row.academy_id }
}

export async function updateFeePlan(id, p) {
  const { error } = await supabase.rpc('secure_update_fee_plan', {
    p_id:            id,
    p_name:          p.name,
    p_training_type: p.trainingType  || 'daily',
    p_monthly_fee:   Number(p.monthlyFee)   || 0,
    p_quarterly_fee: Number(p.quarterlyFee) || 0,
    p_yearly_fee:    Number(p.yearlyFee)    || 0,
    p_token:         _sessionToken(),
  })
  if (error) throw error
}

export async function deleteFeePlan(id) {
  const { error } = await supabase.rpc('secure_delete_fee_plan', {
    p_id: id, p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function updateBatchFee(batchId, defaultFee, defaultPlan) {
  const { error } = await supabase.rpc('secure_update_batch', {
    p_batch_id: batchId,
    p_payload:  { defaultFee: Number(defaultFee) || 0, defaultPlan: defaultPlan || 'monthly' },
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function updateBatchCoach(batchId, coachName) {
  const { error } = await supabase.rpc('secure_update_batch', {
    p_batch_id: batchId,
    p_payload:  { coach: coachName },
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function updateBatch(batchId, b) {
  const { data, error } = await supabase.rpc('secure_update_batch', {
    p_batch_id: batchId,
    p_payload: {
      name:        b.name,
      code:        b.code        || null,
      time:        b.startTime && b.endTime ? `${b.startTime} – ${b.endTime}` : b.time,
      sports:      b.sports      || [],
      coach:       b.coach,
      capacity:    Number(b.capacity),
      days:        b.days        || [],
      startTime:   b.startTime   || null,
      endTime:     b.endTime     || null,
      ageMin:      Number(b.ageMin)  || 0,
      ageMax:      Number(b.ageMax)  || 99,
      ground:      b.ground      || null,
      defaultFee:  Number(b.defaultFee) || 0,
      defaultPlan: b.defaultPlan || 'monthly',
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data || b
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
  const { data, error } = await supabase.rpc('secure_insert_event', {
    p_payload: {
      title:        e.title,
      type:         e.type,
      sport:        e.sport        || '',
      date:         e.date,
      endDate:      e.endDate      || '',
      venue:        e.venue        || '',
      description:  e.description  || '',
      status:       e.status       || 'Upcoming',
      audienceType: e.audienceType || 'all',
      audienceIds:  e.audienceIds  || [],
      flyerUrl:     e.flyerUrl     || '',
      bracketType:  e.bracketType  || '',
      participants: e.participants  || [],
      branchId:     e.branchId      || '',
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function updateEvent(id, e) {
  const payload = {}
  if (e.title        !== undefined) payload.title        = e.title
  if (e.type         !== undefined) payload.type         = e.type
  if (e.sport        !== undefined) payload.sport        = e.sport || ''
  if (e.date         !== undefined) payload.date         = e.date
  if (e.endDate      !== undefined) payload.endDate      = e.endDate || ''
  if (e.venue        !== undefined) payload.venue        = e.venue || ''
  if (e.description  !== undefined) payload.description  = e.description || ''
  if (e.status       !== undefined) payload.status       = e.status
  if (e.audienceType !== undefined) payload.audienceType = e.audienceType
  if (e.audienceIds  !== undefined) payload.audienceIds  = e.audienceIds
  if (e.flyerUrl     !== undefined) payload.flyerUrl     = e.flyerUrl || ''
  if (e.bracketType  !== undefined) payload.bracketType  = e.bracketType || ''
  if (e.participants !== undefined) payload.participants  = e.participants
  const { error } = await supabase.rpc('secure_update_event', {
    p_event_id: id,
    p_payload:  payload,
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function updateEventStatus(id, status) {
  const { error } = await supabase.rpc('secure_update_event', {
    p_event_id: id,
    p_payload:  { status },
    p_token:    _sessionToken(),
  })
  if (error) throw error
}

export async function deleteEvent(id) {
  const { error } = await supabase.rpc('secure_delete_event', {
    p_event_id: id,
    p_token:    _sessionToken(),
  })
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
  const { error } = await supabase.rpc('secure_insert_tournament_matches', {
    p_rows:  rows,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function updateTournamentMatch(id, { winnerId, winnerName, score }) {
  const { error } = await supabase.rpc('secure_update_tournament_match', {
    p_match_id:    id,
    p_winner_id:   winnerId   || null,
    p_winner_name: winnerName || null,
    p_score:       score      || null,
    p_token:       _sessionToken(),
  })
  if (error) throw error
}

export async function deleteEventMatches(eventId) {
  const { error } = await supabase.rpc('secure_delete_event_matches', {
    p_event_id: eventId,
    p_token:    _sessionToken(),
  })
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

export async function insertBranch(_academyId, name) {
  const { error } = await supabase.rpc('secure_upsert_branch', {
    p_name:  name,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function deleteBranch(_academyId, name) {
  const { error } = await supabase.rpc('secure_delete_branch', {
    p_name:  name,
    p_token: _sessionToken(),
  })
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
    .select(`${baseColumns}, address, manager_id`)
    .eq('academy_id', academyId)
    .order('sport_name')
    .order('branch_name')
  if (error && error.code === '42703') {
    // Fallback: try without manager_id (pre-0065), then without address (pre-0018)
    const r2 = await supabase
      .from('sport_branches')
      .select(`${baseColumns}, address`)
      .eq('academy_id', academyId)
      .order('sport_name')
      .order('branch_name')
    if (!r2.error) { data = r2.data; error = null }
    else {
      const r3 = await supabase
        .from('sport_branches')
        .select(baseColumns)
        .eq('academy_id', academyId)
        .order('sport_name')
        .order('branch_name')
      data  = r3.data
      error = r3.error
    }
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
    managerId:  r.manager_id || null,
    createdAt:  r.created_at,
  }))
}

export async function insertSportBranch(_academyId, sportName, branchName, address = '') {
  const { data, error } = await supabase.rpc('secure_insert_sport_branch', {
    p_sport_name:  sportName,
    p_branch_name: branchName,
    p_address:     address || null,
    p_token:       _sessionToken(),
  })
  if (error) throw error
  return {
    id:         data.id,
    sportName:  data.sport_name,
    branchName: data.branch_name,
    address:    data.address || '',
    createdAt:  data.created_at,
  }
}

export async function updateSportBranch(branchId, { branchName, address, managerId }) {
  // Coerce managerId to integer — select option values are strings; staff.id is bigint
  let mid = null
  if (managerId !== undefined && managerId !== null && managerId !== '') {
    const n = Number(managerId)
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid manager id: ${managerId} (expected a number, got ${typeof managerId})`)
    }
    mid = n
  }
  const { error } = await supabase.rpc('secure_update_sport_branch', {
    p_branch_id:   branchId,
    p_branch_name: branchName !== undefined ? branchName : null,
    p_address:     address    !== undefined ? (address || null) : null,
    p_manager_id:  mid,
    p_token:       _sessionToken(),
  })
  if (error) throw error
}

export async function deleteSportBranch(branchId) {
  const { error } = await supabase
    .from('sport_branches')
    .delete()
    .eq('id', branchId)
  if (error) throw error
}

// Assign a staff as branch manager — atomically:
//   - sets sport_branches.manager_id
//   - locks staff.branch_id to this branch
//   - sets staff_auth.access_role='branch_manager' + grants all perms
export async function assignBranchManager(branchId, staffId) {
  const sid = Number(staffId)
  if (!Number.isFinite(sid)) throw new Error(`Invalid staff id: ${staffId}`)
  const { error } = await supabase.rpc('secure_assign_branch_manager', {
    p_branch_id: branchId,
    p_staff_id:  sid,
    p_token:     _sessionToken(),
  })
  if (error) throw error
}

// Reverse the above — clears manager link, demotes role back to 'coach', empties perms.
export async function unassignBranchManager(branchId) {
  const { error } = await supabase.rpc('secure_unassign_branch_manager', {
    p_branch_id: branchId,
    p_token:     _sessionToken(),
  })
  if (error) throw error
}

// ── Leave Requests ────────────────────────────────────────

// Staff submits a leave request — academy_id resolved from session token by RPC
export async function createLeaveRequest(staffId, staffName, startDate, endDate, reason, _academyId = null) {
  const { data, error } = await supabase.rpc('secure_create_leave_request', {
    p_staff_id:   staffId,
    p_staff_name: staffName,
    p_start_date: startDate,
    p_end_date:   endDate,
    p_reason:     reason,
    p_token:      _sessionToken(),
  })
  if (error) throw error
  return data
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
  const { error } = await supabase.rpc('secure_update_leave_status', {
    p_id:     id,
    p_status: status,
    p_token:  _sessionToken(),
  })
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

export async function saveUserPermissions(_userId, _academyId, _accessRole, _permissions, _name) {
  // Now a no-op — user_permissions is written inside secure_complete_invite_signup RPC.
  // Kept as an export to avoid breaking any callers during the transition.
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
  const { error } = await supabase.rpc('secure_update_user_permissions', {
    p_user_id:     userId,
    p_access_role: accessRole,
    p_permissions: permissions,
  })
  if (error) throw error
}

export async function revokeAccessUser(userId) {
  const { error } = await supabase.rpc('secure_revoke_user_permissions', {
    p_user_id: userId,
  })
  if (error) throw error
}

// ── Staff Invites ─────────────────────────────────────────

export async function createInvite(_academyId, academyName, name, accessRole, permissions) {
  const { data, error } = await supabase.rpc('secure_create_invite', {
    p_name:         name,
    p_access_role:  accessRole,
    p_permissions:  permissions || [],
    p_academy_name: academyName || '',
    p_token:        _sessionToken(),
  })
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

  // Create HR staff record and mark invite used — both handled inside the RPC.
  const roleLabel = { coach: 'Coach', receptionist: 'Receptionist', accountant: 'Accountant', admin: 'Admin', staff: 'Staff' }
  const { error: invErr } = await supabase.rpc('secure_complete_invite_signup', {
    p_invite_token: token,
    p_role_label:   roleLabel[invite.access_role] || invite.access_role,
  })
  if (invErr) throw invErr

  return { user: data.user, session: data.session, invite }
}

export async function deleteInvite(id) {
  const { error } = await supabase.rpc('secure_delete_invite', {
    p_id:    id,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

// ── Staff Attendance ──────────────────────────────────────

export async function logStaffAttendance(_academyId, profileId, staffName, date, checkInTime) {
  const { error } = await supabase.rpc('secure_log_staff_attendance', {
    p_profile_id:    profileId,
    p_staff_name:    staffName,
    p_date:          date,
    p_check_in_time: checkInTime,
    p_token:         _sessionToken(),
  })
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

export async function upsertAssessment({ studentId, staffId, batchId, sport, month, scores, notes, categoryNotes }) {
  const { data, error } = await supabase.rpc('secure_upsert_assessment', {
    p_payload: {
      studentId, staffId,
      batchId: batchId ?? null,
      sport, month, scores,
      notes:         notes ?? null,
      categoryNotes: categoryNotes ?? {},
    },
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data
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

export async function assignStudentToBatch(studentId, batchId, batchName, _academyId) {
  const { error } = await supabase.rpc('secure_assign_student_to_batch', {
    p_student_id: studentId,
    p_batch_id:   batchId,
    p_batch_name: batchName,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

export async function unassignStudentFromBatch(studentId, batchId) {
  const { error } = await supabase.rpc('secure_unassign_student_from_batch', {
    p_student_id: studentId,
    p_batch_id:   batchId,
    p_token:      _sessionToken(),
  })
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
  // STRICT branch isolation: when a branch is selected, show ONLY that branch's
  // entries — no null/other-branch bleed. New entries are reliably branch-tagged
  // at write time (see logAuditSport + the entity-scope resolver), so nothing
  // legitimate is hidden. When no branch is selected but a sport is, scope to
  // that sport (plus null-sport legacy rows so old history isn't lost).
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
export async function upsertPlayerGoal({ studentId, month, goalText, staffId }) {
  const { data, error } = await supabase.rpc('secure_upsert_player_goal', {
    p_student_id: studentId,
    p_month:      month,
    p_goal_text:  goalText ?? '',
    p_staff_id:   staffId  ?? null,
    p_token:      _sessionToken(),
  })
  if (error) throw error
  return data
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
  const { data, error } = await supabase.rpc('secure_start_activity_session', {
    p_user_type:    userType,
    p_user_id:      userId       ? String(userId) : null,
    p_user_name:    userName     || null,
    p_academy_id:   academyId   || null,
    p_academy_name: academyName || null,
    p_device:       device      || null,
  })
  if (error) throw error
  return data
}

export async function heartbeatActivitySession(sessionUuid) {
  await supabase.rpc('secure_heartbeat_activity_session', { p_session_uuid: sessionUuid })
}

export async function endActivitySession(sessionUuid) {
  await supabase.rpc('secure_end_activity_session', { p_session_uuid: sessionUuid })
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
  const { data, error } = await supabase.rpc('secure_create_drill', {
    p_payload: drill,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function updateDrill(id, updates) {
  const { data, error } = await supabase.rpc('secure_update_drill', {
    p_id:      id,
    p_payload: updates,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function deleteDrill(id) {
  const { error } = await supabase.rpc('secure_delete_drill', {
    p_id:    id,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function fetchDrillFavorites(staffId) {
  // staff_id is BIGINT — owner's user.id is a UUID, skip the query for them.
  if (!staffId || !Number.isFinite(Number(staffId))) return []
  const { data, error } = await supabase
    .from('drill_favorites').select('drill_id').eq('staff_id', staffId)
  if (error) { if (error.code === '42P01') return []; throw error }
  return (data || []).map(r => r.drill_id)
}

export async function toggleDrillFavorite(drillId, staffId, _academyId) {
  const { data, error } = await supabase.rpc('secure_toggle_drill_favorite', {
    p_drill_id: drillId,
    p_staff_id: staffId,
    p_token:    _sessionToken(),
  })
  if (error) throw error
  return data
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
  const { data, error } = await supabase.rpc('secure_create_session_plan', {
    p_payload: plan,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function updateSessionPlan(id, updates) {
  const { data, error } = await supabase.rpc('secure_update_session_plan', {
    p_id:      id,
    p_payload: updates,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function deleteSessionPlan(id) {
  const { error } = await supabase.rpc('secure_delete_session_plan', {
    p_id:    id,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function activateSessionPlan(id) {
  const { data, error } = await supabase.rpc('secure_update_session_plan', {
    p_id:      id,
    p_payload: { status: 'active' },
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function completeSessionPlan(id) {
  const { data, error } = await supabase.rpc('secure_update_session_plan', {
    p_id:      id,
    p_payload: { status: 'completed', completed_at: new Date().toISOString() },
    p_token:   _sessionToken(),
  })
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
    const { error } = await supabase.rpc('secure_insert_session_phases', {
      p_phases: phases,
      p_token:  _sessionToken(),
    })
    if (error) throw error
  }
  return newPlan
}

// ── SESSION PHASES ────────────────────────────────────────────────────────────

export async function createSessionPhase(phase) {
  const { data, error } = await supabase.rpc('secure_create_session_phase', {
    p_phase: phase,
    p_token: _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function updateSessionPhase(id, updates) {
  const { data, error } = await supabase.rpc('secure_update_session_phase', {
    p_id:      id,
    p_updates: updates,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return data
}

export async function deleteSessionPhase(id) {
  const { error } = await supabase.rpc('secure_delete_session_phase', {
    p_id:    id,
    p_token: _sessionToken(),
  })
  if (error) throw error
}

export async function reorderSessionPhases(updates) {
  const { error } = await supabase.rpc('secure_reorder_session_phases', {
    p_updates: updates,
    p_token:   _sessionToken(),
  })
  if (error) throw error
}

// ============================================================
// Parents (added migration 0057)
// ============================================================

// Owner — list parents in the academy
export async function fetchParents() {
  const { data, error } = await supabase.rpc('secure_list_parents', { p_token: _sessionToken() })
  if (error) throw error
  return data || []
}

// Owner/staff — parent detail with linked children + payment status
export async function fetchParentDetail(parentId) {
  const { data, error } = await supabase.rpc('secure_get_parent_detail', {
    p_parent_id: parentId,
    p_token:     _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// Owner — update parent name/phone/email
export async function updateParent(parentId, { name, phone, email } = {}) {
  const payload = {}
  if (name  !== undefined) payload.name  = name
  if (phone !== undefined) payload.phone = phone
  if (email !== undefined) payload.email = email
  const { data, error } = await supabase.rpc('secure_update_parent', {
    p_parent_id: parentId,
    p_payload:   payload,
    p_token:     _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// Owner — create/upsert a parent, optionally linked to a child
export async function createParent({ name, phone, email = null, studentId = null, relationship = null }) {
  const { data, error } = await supabase.rpc('secure_create_parent', {
    p_name:         name,
    p_phone:        phone,
    p_email:        email,
    p_student_id:   studentId,
    p_relationship: relationship,
    p_token:        _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

export async function linkStudentToParent(parentId, studentId, { relationship = null, isPrimary = false } = {}) {
  const { error } = await supabase.rpc('secure_link_student_to_parent', {
    p_parent_id:    parentId,
    p_student_id:   studentId,
    p_relationship: relationship,
    p_is_primary:   isPrimary,
    p_token:        _sessionToken(),
  })
  if (error) throw error
}

export async function unlinkStudentFromParent(parentId, studentId) {
  const { error } = await supabase.rpc('secure_unlink_student_from_parent', {
    p_parent_id:  parentId,
    p_student_id: studentId,
    p_token:      _sessionToken(),
  })
  if (error) throw error
}

// Parent — claim auth.uid() → parents row by phone (post phone-OTP signup)
// Phone is normalized to 10 digits since parents.phone is stored that way.
export async function claimParentAccount(phone) {
  const phone10 = String(phone || '').replace(/\D/g, '').slice(-10)
  const { data, error } = await supabase.rpc('secure_claim_parent_account', { p_phone: phone10 })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// DEV ONLY — bypass phone OTP. Calls parent-test-login edge function which
// returns synthetic { email, password }, then we sign in. The function is
// gated behind ENABLE_PARENT_TEST_LOGIN env var on the server side.
export async function parentTestLogin(phone) {
  const phone10 = String(phone || '').replace(/\D/g, '').slice(-10)
  const resp = await fetch(`${_functionsBase()}/parent-test-login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':       import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ phone: phone10 }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json?.error || 'Test login failed')
  const { error } = await supabase.auth.signInWithPassword({ email: json.email, password: json.password })
  if (error) throw error
  return claimParentAccount(phone10)
}

// Parent — dashboard payload (parent row + children with payment status)
export async function fetchParentDashboard() {
  const { data, error } = await supabase.rpc('secure_get_parent_dashboard')
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// Parent — update notification preferences
export async function updateParentPrefs(prefs) {
  const { data, error } = await supabase.rpc('secure_update_parent_prefs', { p_prefs: prefs })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// ============================================================
// Razorpay (added migration 0058 + edge function razorpay-create-order)
// ============================================================

const _functionsBase = () => {
  const url = import.meta.env.VITE_SUPABASE_URL || ''
  // Supabase Edge Functions URL pattern
  return url.replace('.supabase.co', '.functions.supabase.co')
}

// Frontend → razorpay-create-order edge function
// Returns { orderId, keyId, amount, currency, prefill, notes } for Razorpay Checkout.
export async function createRazorpayOrder({ studentId, amount, monthsCovered = 1, coverageStart = null, paymentLinkId = null }) {
  const sessionToken = _sessionToken()
  const { data: { session } } = await supabase.auth.getSession()
  const authHeader = session?.access_token
    ? `Bearer ${session.access_token}`
    : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`

  const resp = await fetch(`${_functionsBase()}/razorpay-create-order`, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'Authorization':    authHeader,
      'apikey':           import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
    },
    body: JSON.stringify({ studentId, amount, monthsCovered, coverageStart, paymentLinkId }),
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(json?.error || 'Could not create Razorpay order')
  return json
}

// Owner — read/save Razorpay config for the academy
export async function fetchPaymentConfig() {
  const { data, error } = await supabase.rpc('secure_get_payment_config', { p_token: _sessionToken() })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

export async function savePaymentConfig(payload) {
  const { data, error } = await supabase.rpc('secure_set_payment_config', {
    p_payload: payload,
    p_token:   _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// Owner — create a payment link for a parent to pay later
export async function createPaymentLink({ studentId, amount, description = null, monthsCovered = 1, coverageStart = null }) {
  const { data, error } = await supabase.rpc('secure_create_payment_link', {
    p_student_id:    studentId,
    p_amount:        amount,
    p_description:   description,
    p_months:        monthsCovered,
    p_coverage_start: coverageStart,
    p_token:         _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// Public — fetch a payment link by short_code (anon callable)
export async function fetchPaymentLink(shortCode) {
  const { data, error } = await supabase.rpc('secure_fetch_payment_link', { p_short_code: shortCode })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

// ── Staff Clock-In ─────────────────────────────────────────────────────────

export async function getTodayCheckin() {
  const token = _sessionToken()
  if (!token) return null
  const { data } = await supabase.rpc('secure_get_today_checkin', { p_token: token })
  return (typeof data === 'string' ? JSON.parse(data) : data) || null
}

export async function clockIn() {
  const { data, error } = await supabase.rpc('secure_clock_in', { p_token: _sessionToken() })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}

export async function clockOut(checkinId) {
  const { data, error } = await supabase.rpc('secure_clock_out', {
    p_checkin_id: checkinId,
    p_token:      _sessionToken(),
  })
  if (error) throw error
  return typeof data === 'string' ? JSON.parse(data) : data
}
