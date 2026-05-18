import { supabase } from './supabase'

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

export async function deleteStudent(id) {
  await supabase.from('payments').delete().eq('student_id', id)
  await supabase.from('student_sessions').delete().eq('student_id', id)
  const { error } = await supabase.from('students').delete().eq('id', id)
  if (error) throw error
}

export async function suspendStudent(id) {
  const today = new Date().toISOString().split('T')[0]
  // Try with suspended_since; fall back if column doesn't exist yet
  const { error } = await supabase.from('students').update({ status: 'Suspended', suspended_since: today }).eq('id', id)
  if (error) {
    const { error: e2 } = await supabase.from('students').update({ status: 'Suspended' }).eq('id', id)
    if (e2) throw e2
  }
}

export async function updateStudentStatus(id, status) {
  const { error } = await supabase
    .from('students')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function updateStudent(id, s) {
  const fields = {
    name:         s.name,
    parent:       s.parent       || '',
    phone:        s.phone        || '',
    parent_phone: s.parentPhone  || '',
    age:          Number(s.age)  || null,
    dob:          s.dob          || null,
    sport:        s.sport        || '',
    batch:        s.batchName    || '',
    batch_id:     s.batchId      || null,
    fees:          Number(s.fees) || 0,
    fee_amount:    Number(s.fees) || 0,
    paid_till:     s.paidTill     || null,
    join_date:     s.joinDate     || null,
    training_type: s.trainingType || 'Daily',
    fee_plan:      s.feePlan      || 'monthly',
    position:      s.position     || null,
  }
  const { data, error } = await supabase
    .from('students')
    .update(fields)
    .eq('id', id)
    .select()
  if (error) throw error
  return data?.[0] || fields
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
  const { error } = await supabase
    .from('payments')
    .insert({
      id:             invoiceId,
      student_id:     p.studentId    || null,
      student:        p.student,
      amount:         Number(p.amount),
      month:          p.month,
      date:           p.date || new Date().toISOString().split('T')[0],
      status:         'Paid',
      mode:           p.mode,
      payment_type:   p.paymentType  || 'monthly',
      discount_pct:   p.discountPct  || 0,
      months_covered:  p.monthsCovered  || 1,
      coverage_start:  p.coverageStart  || null,
      academy_id:      p.academyId     || null,
      notes:           p.notes         || null,
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
  const { error } = await supabase.from('students').update({ position }).eq('id', id)
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
  // Students use custom auth (anon key) — RLS may block; photo still shows in session
  await supabase.from('students').update({ photo_url: photoUrl }).eq('id', id)
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
  const updates = { paid_till: paidTill }
  if (fees) { updates.fees = fees; updates.fee_amount = fees }
  const { error } = await supabase.from('students').update(updates).eq('id', id)
  if (error) throw error
}

export async function reactivateStudent(id) {
  const { error } = await supabase.from('students').update({ status: 'Active', suspended_since: null }).eq('id', id)
  if (error) {
    const { error: e2 } = await supabase.from('students').update({ status: 'Active' }).eq('id', id)
    if (e2) throw e2
  }
}

export async function activateStudentWithBatch(id, batchId, batchName, paidTill, fees) {
  const updates = {
    status:    'Active',
    batch_id:  batchId   || null,
    batch:     batchName || null,
    paid_till: paidTill,
  }
  if (fees) { updates.fees = fees; updates.fee_amount = fees }
  const { error } = await supabase.from('students').update(updates).eq('id', id)
  if (error) throw error
}

export async function updateBatchEnrolled(batchId, delta) {
  // Prefer the atomic RPC from migration 0014 — no read-modify-write race.
  // Falls back to the legacy SELECT-then-UPDATE if the RPC isn't deployed yet.
  const { error: rpcErr } = await supabase.rpc('bump_batch_enrolled', { p_batch_id: batchId, p_delta: delta })
  if (!rpcErr) return
  // 42883 = function does not exist (migration 0014 not applied)
  if (rpcErr.code !== '42883' && rpcErr.code !== 'PGRST202') throw rpcErr
  // Legacy fallback — still race-prone but keeps the app working until migration runs
  const { data, error } = await supabase
    .from('batches').select('enrolled').eq('id', batchId).maybeSingle()
  if (error || !data) return
  await supabase.from('batches')
    .update({ enrolled: Math.max(0, data.enrolled + delta) })
    .eq('id', batchId)
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) throw error
}

export async function updatePaymentStatus(id, status, mode) {
  const { error } = await supabase
    .from('payments')
    .update({ status, mode, date: new Date().toISOString().split('T')[0] })
    .eq('id', id)
  if (error) throw error
}

export async function updatePaymentAmount(id, amount, monthsCovered) {
  const { error } = await supabase
    .from('payments')
    .update({ amount, months_covered: monthsCovered })
    .eq('id', id)
  if (error) throw error
}

export async function updatePaymentDate(id, date) {
  const { error } = await supabase
    .from('payments')
    .update({ date })
    .eq('id', id)
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
  // Clear related records first (cascade handles staff_auth + staff_sessions)
  await supabase.from('leave_requests').delete().eq('staff_id', id).throwOnError()
  await supabase.from('staff_attendance').delete().eq('profile_id', id)
  const { error } = await supabase.from('staff').delete().eq('id', id)
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
  const { data: auth, error } = await supabase
    .from('staff_auth')
    .select('id, staff_id, join_code, status, staff(*)')
    .eq('staff_code', staffCode.toUpperCase())
    .maybeSingle()
  if (error || !auth) throw new Error('Staff ID not found')
  if (auth.status === 'active') throw new Error('Account already activated')
  if (auth.join_code !== joinCode.toUpperCase()) throw new Error('Incorrect Join Code')

  const { error: authErr } = await supabase.from('staff_auth')
    .update({ password_hash: passwordHash, status: 'active', join_code: null, email: email.toLowerCase().trim() })
    .eq('id', auth.id)
  if (authErr) throw new Error('Activation failed: ' + authErr.message)

  const staffRow = Array.isArray(auth.staff) ? auth.staff[0] : auth.staff
  return staffRow || {}
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
  const fields = {}
  if (name     !== undefined) fields.name      = name
  if (phone    !== undefined) fields.phone     = phone
  if (photoUrl !== undefined) fields.photo_url = photoUrl
  const { error } = await supabase.from('staff').update(fields).eq('id', staffId)
  if (error) throw error
}

export async function upsertStaffProfileExtra(staffId, { age, licenceUrl }) {
  const fields = { staff_id: staffId, updated_at: new Date().toISOString() }
  if (age        !== undefined) fields.age         = age        || null
  if (licenceUrl !== undefined) fields.licence_url = licenceUrl || null
  const { error } = await supabase.from('staff_profiles').upsert(fields, { onConflict: 'staff_id' })
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
  const { error } = await supabase.from('staff_auth')
    .update({ access_role: accessRole, permissions })
    .eq('staff_id', staffId)
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
  if (batchId != null) q = q.or(`batch_id.eq.${batchId},batch_id.is.null`)
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
  const { error } = await supabase
    .from('attendance')
    .upsert(rows, { onConflict: 'date,student_id,batch_id' })
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
  // Prefer the atomic sequence-backed RPC from migration 0014 — no race window.
  const { data: rpcData, error: rpcErr } = await supabase.rpc('next_student_code')
  if (!rpcErr && rpcData) return rpcData
  if (rpcErr && rpcErr.code !== '42883' && rpcErr.code !== 'PGRST202') throw rpcErr
  // Legacy fallback — race-prone (two concurrent creates can collide on the same SA code)
  // but keeps the app working until migration 0014 is applied.
  const { data } = await supabase
    .from('students')
    .select('student_code')
    .like('student_code', 'SA%')
    .order('student_code', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.student_code) return 'SA001'
  const num = parseInt(data.student_code.slice(2), 10) || 0
  return 'SA' + String(num + 1).padStart(3, '0')
}

export async function fetchPaymentCount() {
  const { count, error } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

// Returns full 'INV-YYYY-NNN' string from the atomic RPC (migration 0014).
// Falls back to the legacy regex-max-client pattern if the RPC isn't deployed.
// Returning a full string lets callers skip the year/padding logic and removes the race window entirely.
export async function fetchNextInvoiceId() {
  const { data, error } = await supabase.rpc('next_invoice_id')
  if (!error && data) return data
  if (error && error.code !== '42883' && error.code !== 'PGRST202') throw error
  // Fallback: build the string from the legacy num + current year, race-prone.
  const num = await fetchNextInvoiceNum()
  return `INV-${new Date().getFullYear()}-${String(num).padStart(3, '0')}`
}

// Legacy number-only helper — kept for back-compat with existing callers.
// New code should call fetchNextInvoiceId() above.
export async function fetchNextInvoiceNum() {
  const { data } = await supabase.from('payments').select('id')
  if (!data || data.length === 0) return 1
  let maxNum = 0
  for (const row of data) {
    const match = row.id?.match(/INV-\d{4}-(\d+)/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > maxNum) maxNum = n
    }
  }
  return maxNum + 1
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
  // QA_AUDIT C1 fix: resolve student's primary batch_id so the row aligns with
  // the same composite (date, student_id, batch_id) unique key the coach/admin
  // paths use. Without this, QR (NULL batch_id) and coach (real batch_id) both
  // wrote rows for the same student/day and the UNIQUE constraint didn't catch it.
  let batchId = null
  try {
    const { data } = await supabase
      .from('students').select('batch_id').eq('id', studentId).maybeSingle()
    batchId = data?.batch_id ?? null
  } catch { /* ignore — proceed with NULL batch */ }

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
  const { error, count } = await supabase.from('batches').delete({ count: 'exact' }).eq('id', id)
  if (error) throw error
  if (count === 0) throw new Error('Delete blocked by database policy — check RLS permissions')
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

// Owner fetches all leave requests (all staff) — scoped to academy when academyId is provided.
// Legacy rows with NULL academy_id are included so pre-migration data stays visible;
// once backfilled (UPDATE leave_requests SET academy_id = ... WHERE academy_id IS NULL),
// the .or() clause becomes inert and isolation tightens automatically.
export async function fetchLeaveRequests(academyId = null) {
  let q = supabase.from('leave_requests').select('*')
  if (academyId) q = q.or(`academy_id.eq.${academyId},academy_id.is.null`)
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

export async function fetchAuditLogs(academyId, limit = 300, sport = null) {
  let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (academyId) q = q.eq('academy_id', academyId)
  // Include un-tagged (NULL) entries in every sport view — they are historical
  // pre-branch entries. Going forward, every new action is tagged so branch
  // views will naturally isolate themselves over time.
  if (sport) q = q.or(`sport.eq.${sport},sport.is.null`)
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

