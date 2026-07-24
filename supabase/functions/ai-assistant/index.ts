// ============================================================
// ai-assistant
// ============================================================
// Owner/office-staff-only chat assistant over student/payment/attendance
// data. Frontend POSTs { question } with the caller's session token in
// x-session-token (empty for owners — their Supabase JWT travels via the
// anon key and current_actor() falls back to auth.uid()).
//
// We:
//   1. Validate the caller (owner or staff) via current_actor, same pattern
//      as razorpay-create-order — never trust a client-supplied academyId.
//   2. Run a Groq (OpenAI-compatible) function-calling loop where every tool
//      query is manually scoped to actor.academy_id (service-role key
//      bypasses RLS, so this scoping is load-bearing, not a convenience).
//   3. Return the final text answer.
//
// Using Groq instead of Gemini: Gemini keys created outside AI Studio's
// wizard need a linked billing account before free-tier quota activates;
// Groq's free tier works with no card required.
//
// Env vars (Supabase Functions secrets):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   GROQ_API_KEY — free key from console.groq.com/keys
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// gpt-oss-120b: Llama 3.3 70b's tool-calling on Groq is unreliable (emits a
// malformed pseudo-XML format instead of JSON on some prompts — verified via
// direct testing); gpt-oss-120b calls tools correctly and extracts cleaner
// arguments (e.g. "aaryan patel" rather than "patel aaryan due fee").
const GROQ_MODEL = 'openai/gpt-oss-120b'
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

// ── Same "freeze at suspension" outstanding rule as src/lib/studentRules.js —
// keep these in sync; this is the accuracy-critical piece for money questions. ──
function firstOfMonthIso(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function effectiveAnchor(status: string, suspendedSince: string | null, liveAnchor: string) {
  if (status === 'Suspended' && suspendedSince) {
    const susp = firstOfMonthIso(new Date(suspendedSince + 'T00:00:00'))
    return susp < liveAnchor ? susp : liveAnchor
  }
  return liveAnchor
}
function isOutstanding(s: { status: string; paidTill: string | null; suspendedSince: string | null }, firstOfMonth: string) {
  if (s.status !== 'Active' && s.status !== 'Suspended') return false
  return !!s.paidTill && s.paidTill < effectiveAnchor(s.status, s.suspendedSince, firstOfMonth)
}
// Whole calendar months between paidTill's month and the anchor month (both YYYY-MM-DD, anchor is always firstOfMonth-aligned).
function monthsOwed(paidTill: string, anchor: string) {
  const [py, pm] = paidTill.split('-').map(Number)
  const [ay, am] = anchor.split('-').map(Number)
  // paidTill covers through the end of its month, so the first owed month is the one after it.
  const paidThroughMonths = py * 12 + (pm - 1)
  const anchorMonths = ay * 12 + (am - 1)
  return Math.max(0, anchorMonths - paidThroughMonths)
}

// ── Tool implementations — every query is scoped to academyId, and to
// branchId when the caller is viewing (or is locked to) a specific branch.
// payments/skill_assessments have no branch_id column, so branch scoping for
// academy-wide queries on those goes through getBranchStudentIds() instead. ──

// Returns the student IDs in this branch, or null when no branch filter
// applies (branchId is falsy — academy-wide). Distinguish from an empty
// array, which correctly means "this branch has zero students."
async function getBranchStudentIds(academyId: string, branchId: string | null): Promise<number[] | null> {
  if (!branchId) return null
  const { data, error } = await supabase.from('students').select('id').eq('academy_id', academyId).eq('branch_id', branchId)
  if (error) throw error
  return data.map((s: any) => s.id)
}

async function findStudents(academyId: string, query: string, branchId: string | null) {
  // Match by name OR student_code (their CRM login ID, e.g. "SA098") — the
  // comma-separated .or() filter is PostgREST's syntax for OR across columns.
  const safeQuery = query.replace(/[,()]/g, '')
  let q = supabase
    .from('students')
    .select('id, name, student_code, status, fees, paid_till, batch, suspended_since')
    .eq('academy_id', academyId)
    .or(`name.ilike.%${safeQuery}%,student_code.ilike.%${safeQuery}%`)
    .limit(10)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  return data
}

async function getStudentDetails(academyId: string, studentId: number, branchId: string | null) {
  let q = supabase
    .from('students')
    .select('id, name, student_code, status, fees, paid_till, batch, training_type, fee_plan, join_date, suspended_since, phone, parent, parent_phone')
    .eq('academy_id', academyId)
    .eq('id', studentId)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  if (!data) return { error: 'student not found in this academy' }
  const firstOfMonth = firstOfMonthIso(new Date())
  const outstanding = isOutstanding({ status: data.status, paidTill: data.paid_till, suspendedSince: data.suspended_since }, firstOfMonth)
  let owedMonths = 0
  let owedAmount = 0
  if (outstanding && data.paid_till) {
    const anchor = effectiveAnchor(data.status, data.suspended_since, firstOfMonth)
    owedMonths = monthsOwed(data.paid_till, anchor)
    owedAmount = owedMonths * Number(data.fees || 0)
  }
  return {
    ...data,
    isOutstanding: outstanding,
    owedMonths,
    owedAmount,
  }
}

async function getStudentPayments(academyId: string, studentId: number, limit = 10) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount, date, month, status, mode, months_covered, coverage_start')
    .eq('academy_id', academyId)
    .eq('student_id', studentId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

async function getStudentAttendance(academyId: string, studentId: number, year: number, month: number, branchId: string | null) {
  // month is 1-12 from the model; DB stores full dates.
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-${pad(lastDay)}`
  let sq = supabase.from('students').select('id').eq('academy_id', academyId).eq('id', studentId)
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data: studentRow } = await sq.maybeSingle()
  if (!studentRow) return { error: 'student not found in this academy' }
  const { data, error } = await supabase
    .from('attendance')
    .select('date, status, present')
    .eq('student_id', studentId)
    .gte('date', start)
    .lte('date', end)
  if (error) throw error
  const counts: Record<string, number> = { Present: 0, Absent: 0, Late: 0, Leave: 0 }
  for (const row of data) {
    const st = row.status || (row.present ? 'Present' : 'Absent')
    counts[st] = (counts[st] || 0) + 1
  }
  return { year, month, totalMarked: data.length, counts }
}

async function getAcademyOverview(academyId: string, branchId: string | null) {
  let sq = supabase.from('students').select('id, status, fees, paid_till, suspended_since').eq('academy_id', academyId)
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data, error } = await sq
  if (error) throw error
  const firstOfMonth = firstOfMonthIso(new Date())
  let active = 0, suspended = 0, outstandingCount = 0, outstandingAmount = 0
  for (const s of data) {
    if (s.status === 'Active') active++
    if (s.status === 'Suspended') suspended++
    if (isOutstanding({ status: s.status, paidTill: s.paid_till, suspendedSince: s.suspended_since }, firstOfMonth)) {
      outstandingCount++
      outstandingAmount += Number(s.fees || 0)
    }
  }
  const monthStart = firstOfMonth
  let pq = supabase.from('payments').select('amount').eq('academy_id', academyId).eq('status', 'Paid').gte('date', monthStart)
  // payments has no branch_id — scope to this branch's student IDs instead.
  if (branchId) pq = pq.in('student_id', data.map((s: any) => s.id))
  const { data: paymentsThisMonth, error: payErr } = await pq
  if (payErr) throw payErr
  const collectedThisMonth = (paymentsThisMonth || []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0)
  return {
    totalStudents: data.length,
    active,
    suspended,
    outstandingCount,
    outstandingAmountApprox: outstandingAmount,
    collectedThisMonth,
  }
}

async function getAttendanceLeaderboard(academyId: string, year: number, month: number, order: string, limit: number, branchId: string | null) {
  let sq = supabase.from('students').select('id, name').eq('academy_id', academyId)
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data: students, error: sErr } = await sq
  if (sErr) throw sErr
  const ids = students.map((s: any) => s.id)
  if (!ids.length) return []
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-${pad(lastDay)}`
  const { data: rows, error } = await supabase
    .from('attendance').select('student_id, status, present')
    .in('student_id', ids).gte('date', start).lte('date', end)
  if (error) throw error
  const byStudent: Record<number, { present: number; total: number }> = {}
  for (const r of rows) {
    const st = r.status || (r.present ? 'Present' : 'Absent')
    const rec = byStudent[r.student_id] || { present: 0, total: 0 }
    rec.total++
    if (st === 'Present' || st === 'Late') rec.present++
    byStudent[r.student_id] = rec
  }
  const nameMap: Record<number, string> = Object.fromEntries(students.map((s: any) => [s.id, s.name]))
  let list = Object.entries(byStudent).map(([id, v]) => ({
    studentId: Number(id),
    name: nameMap[Number(id)],
    sessionsMarked: v.total,
    sessionsAttended: v.present,
    attendancePct: v.total ? Math.round((v.present / v.total) * 100) : 0,
  }))
  list.sort((a, b) => order === 'worst' ? a.attendancePct - b.attendancePct : b.attendancePct - a.attendancePct)
  return list.slice(0, limit)
}

// "On time" heuristic: payment date falls in the same or an earlier calendar
// month than the month it covers (coverage_start). This is an approximation,
// not a contractual due-date comparison — the system prompt is told to say so.
async function getPaymentReliability(academyId: string, studentId: number | null, branchId: string | null) {
  let q = supabase.from('payments')
    .select('student_id, student, date, coverage_start, status, amount')
    .eq('academy_id', academyId).eq('status', 'Paid')
  if (studentId != null) {
    q = q.eq('student_id', studentId)
  } else {
    // payments has no branch_id — scope the academy-wide ranking through this branch's student IDs.
    const branchIds = await getBranchStudentIds(academyId, branchId)
    if (branchIds) q = q.in('student_id', branchIds)
  }
  const { data, error } = await q.order('date', { ascending: false }).limit(studentId != null ? 50 : 1000)
  if (error) throw error
  const withFlag = data.map((p: any) => {
    let onTime: boolean | null = null
    if (p.coverage_start && p.date) onTime = p.date.slice(0, 7) <= p.coverage_start.slice(0, 7)
    return { ...p, onTime }
  })
  if (studentId != null) {
    return {
      recentPayments: withFlag.map((p: any) => ({ date: p.date, amount: p.amount, onTime: p.onTime })),
      onTimeCount: withFlag.filter((p: any) => p.onTime === true).length,
      lateCount: withFlag.filter((p: any) => p.onTime === false).length,
    }
  }
  const byStudent: Record<number, { name: string; onTime: number; late: number }> = {}
  for (const p of withFlag) {
    const rec = byStudent[p.student_id] || { name: p.student, onTime: 0, late: 0 }
    if (p.onTime === true) rec.onTime++
    else if (p.onTime === false) rec.late++
    byStudent[p.student_id] = rec
  }
  const list = Object.entries(byStudent).map(([id, v]) => ({
    studentId: Number(id), name: v.name, onTimePayments: v.onTime, latePayments: v.late,
  }))
  list.sort((a, b) => (b.onTimePayments - b.latePayments) - (a.onTimePayments - a.latePayments))
  return { mostReliable: list.slice(0, 10), leastReliable: [...list].reverse().slice(0, 10) }
}

async function getStudentPerformance(academyId: string, studentId: number) {
  const { data, error } = await supabase
    .from('skill_assessments')
    .select('assessed_month, scores, notes, sport')
    .eq('academy_id', academyId).eq('student_id', studentId)
    .order('assessed_month', { ascending: false }).limit(1)
  if (error) throw error
  if (!data.length) return { error: 'no skill assessment on record for this student' }
  const latest = data[0]
  const values = Object.values(latest.scores || {}).map(Number)
  const averageScore = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null
  return { assessedMonth: latest.assessed_month, sport: latest.sport, averageScore, skillScores: latest.scores, notes: latest.notes }
}

async function getTopPerformers(academyId: string, sport: string | null, limit: number, branchId: string | null) {
  let q = supabase.from('skill_assessments').select('student_id, assessed_month, scores, sport').eq('academy_id', academyId)
  if (sport) q = q.eq('sport', sport)
  const { data, error } = await q
  if (error) throw error
  // Keep only each student's most recent assessment.
  const latestByStudent: Record<number, any> = {}
  for (const a of data) {
    const cur = latestByStudent[a.student_id]
    if (!cur || a.assessed_month > cur.assessed_month) latestByStudent[a.student_id] = a
  }
  // skill_assessments has no branch_id — intersect with this branch's student IDs.
  const branchIds = await getBranchStudentIds(academyId, branchId)
  let ids = Object.keys(latestByStudent).map(Number)
  if (branchIds) {
    const allowed = new Set(branchIds)
    ids = ids.filter((id) => allowed.has(id))
  }
  const { data: students } = ids.length ? await supabase.from('students').select('id, name').in('id', ids) : { data: [] }
  const nameMap: Record<number, string> = Object.fromEntries((students || []).map((s: any) => [s.id, s.name]))
  const list = ids.map((id) => {
    const a = latestByStudent[id]
    const values = Object.values(a.scores || {}).map(Number)
    const averageScore = values.length ? Math.round(values.reduce((x, y) => x + y, 0) / values.length) : 0
    return { studentId: a.student_id, name: nameMap[a.student_id], averageScore, assessedMonth: a.assessed_month }
  })
  list.sort((a, b) => b.averageScore - a.averageScore)
  return list.slice(0, limit)
}

async function getBatchesOverview(academyId: string, branchId: string | null) {
  let q = supabase.from('batches').select('id, name, sports, coach, capacity, enrolled, time, days').eq('academy_id', academyId)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  return data
}

async function getStaffList(academyId: string, branchId: string | null) {
  let q = supabase.from('staff').select('id, name, role, phone, sports, status, join_date').eq('academy_id', academyId)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  return data
}

async function findStaff(academyId: string, query: string, branchId: string | null) {
  const safeQuery = query.replace(/[,()%]/g, '')
  let q = supabase
    .from('staff')
    .select('id, name, role, phone, sports, status, join_date')
    .eq('academy_id', academyId)
    .or(`name.ilike.%${safeQuery}%,role.ilike.%${safeQuery}%`)
    .limit(10)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  return data
}

// Resolve one staff row scoped to this academy/branch — shared guard for the
// per-coach tools below so a staffId from another academy always dead-ends.
async function getStaffRow(academyId: string, staffId: number, branchId: string | null) {
  let q = supabase
    .from('staff')
    .select('id, name, role, phone, sports, salary, join_date, status')
    .eq('academy_id', academyId)
    .eq('id', staffId)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q.maybeSingle()
  if (error) throw error
  return data
}

async function getStaffDetails(academyId: string, staffId: number, branchId: string | null) {
  const staffRow = await getStaffRow(academyId, staffId, branchId)
  if (!staffRow) return { error: 'staff member not found in this academy' }

  // Batches this coach runs — batches.coach is a denormalized name string.
  let bq = supabase
    .from('batches')
    .select('id, name, sports, time, days, capacity, enrolled')
    .eq('academy_id', academyId)
    .ilike('coach', staffRow.name)
  if (branchId) bq = bq.eq('branch_id', branchId)
  const { data: batches } = await bq

  // This month's check-in count from staff_checkins.
  const now = new Date()
  const monthStart = firstOfMonthIso(now)
  const { data: checkins } = await supabase
    .from('staff_checkins')
    .select('date')
    .eq('academy_id', academyId)
    .eq('staff_id', staffId)
    .gte('date', monthStart)
  const daysPresent = new Set((checkins || []).map((c: any) => c.date)).size

  // Leave requests — leave_requests.staff_id is the auth profile UUID, not
  // staff.id, so match on the denormalized staff_name instead.
  const { data: leaves } = await supabase
    .from('leave_requests')
    .select('start_date, end_date, reason, status')
    .eq('academy_id', academyId)
    .ilike('staff_name', staffRow.name)
    .order('start_date', { ascending: false })
    .limit(5)

  return {
    ...staffRow,
    batchesCoached: batches || [],
    checkInDaysThisMonth: daysPresent,
    recentLeaveRequests: leaves || [],
  }
}

async function getStaffAttendance(academyId: string, staffId: number, year: number, month: number, branchId: string | null) {
  const staffRow = await getStaffRow(academyId, staffId, branchId)
  if (!staffRow) return { error: 'staff member not found in this academy' }
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, month, 0).getDate()
  const start = `${year}-${pad(month)}-01`
  const end = `${year}-${pad(month)}-${pad(lastDay)}`
  const { data, error } = await supabase
    .from('staff_checkins')
    .select('date, clock_in, clock_out')
    .eq('academy_id', academyId)
    .eq('staff_id', staffId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })
  if (error) throw error
  const { data: leaves } = await supabase
    .from('leave_requests')
    .select('start_date, end_date, status, reason')
    .eq('academy_id', academyId)
    .ilike('staff_name', staffRow.name)
    .lte('start_date', end)
    .gte('end_date', start)
  const uniqueDays = new Set((data || []).map((c: any) => c.date)).size
  return {
    staffName: staffRow.name,
    year,
    month,
    daysCheckedIn: uniqueDays,
    checkIns: (data || []).map((c: any) => ({ date: c.date, clockIn: c.clock_in, clockOut: c.clock_out })),
    leavesInMonth: leaves || [],
  }
}

async function getStaffActivity(academyId: string, staffId: number, limit: number, branchId: string | null) {
  const staffRow = await getStaffRow(academyId, staffId, branchId)
  if (!staffRow) return { error: 'staff member not found in this academy' }
  // audit_logs.actor_id is the auth UID, not staff.id — match on actor_name.
  const { data, error } = await supabase
    .from('audit_logs')
    .select('action, entity_type, entity_name, note, created_at')
    .eq('academy_id', academyId)
    .ilike('actor_name', staffRow.name)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    // Table may not exist on older installs (42P01) — report plainly.
    if ((error as any).code === '42P01') return { staffName: staffRow.name, activities: [], note: 'no activity log table on this install' }
    throw error
  }
  return { staffName: staffRow.name, activities: data || [] }
}

async function getBatchFeeStructure(academyId: string, batchQuery: string | null, branchId: string | null) {
  let bq = supabase.from('batches').select('id, name, coach, sports, time, days, capacity, enrolled').eq('academy_id', academyId)
  if (branchId) bq = bq.eq('branch_id', branchId)
  const { data: allBatches, error: bErr } = await bq
  if (bErr) throw bErr
  // Token match, not substring — users say "u15 MWF advance" for a batch named
  // "Under 15 advance MWF", so require every query word (with u15 → "under 15"
  // style prefixes normalized) to appear somewhere in the name, in any order.
  let batches = allBatches || []
  if (batchQuery) {
    const tokens = batchQuery.toLowerCase().split(/\s+/).filter(Boolean)
      .flatMap((t) => {
        const m = t.match(/^u(\d+)$/)
        return m ? [m[1]] : [t]   // "u15" matches both "U15" and "Under 15" via the digits
      })
    batches = batches.filter((b: any) => {
      const name = (b.name || '').toLowerCase()
      return tokens.every((t) => name.includes(t))
    })
  }
  if (!batches.length) return { error: batchQuery ? `no batch matching "${batchQuery}" in this academy — try get_batches_overview to list batch names` : 'no batches in this academy' }

  // Official published rates: fee_plans rows keyed by batch_id, each with a
  // Daily/Alternate training type and monthly/quarterly/yearly prices.
  const batchIds = batches.map((b: any) => b.id)
  const { data: plans, error: pErr } = await supabase
    .from('fee_plans')
    .select('batch_id, name, training_type, monthly_fee, quarterly_fee, yearly_fee')
    .eq('academy_id', academyId)
    .in('batch_id', batchIds)
  // Older installs may not have the fee_plans table (42P01) — fall through with none.
  if (pErr && (pErr as any).code !== '42P01') throw pErr
  const plansByBatch: Record<number, any[]> = {}
  for (const p of plans || []) {
    ;(plansByBatch[p.batch_id] ||= []).push({
      plan: p.name,
      trainingType: p.training_type,
      monthlyFee: p.monthly_fee || 0,
      quarterlyFee: p.quarterly_fee || 0,
      yearlyFee: p.yearly_fee || 0,
    })
  }

  // What students actually pay today (students.fees), aggregated per batch name.
  let sq = supabase.from('students').select('batch, fees, status').eq('academy_id', academyId)
  if (branchId) sq = sq.eq('branch_id', branchId)
  const { data: students, error: sErr } = await sq
  if (sErr) throw sErr
  const byBatch: Record<string, { count: number; fees: number[]; total: number }> = {}
  for (const s of students || []) {
    if (s.status !== 'Active' || !s.batch) continue
    const rec = byBatch[s.batch] || { count: 0, fees: [], total: 0 }
    rec.count++
    rec.fees.push(Number(s.fees || 0))
    rec.total += Number(s.fees || 0)
    byBatch[s.batch] = rec
  }
  return batches.map((b: any) => {
    const rec = byBatch[b.name]
    return {
      batchId: b.id,
      batch: b.name,
      coach: b.coach,
      sports: b.sports,
      schedule: { time: b.time, days: b.days },
      capacity: b.capacity,
      enrolled: b.enrolled,
      feePlans: plansByBatch[b.id] || [],
      activeStudents: rec?.count || 0,
      actualFeeMin: rec ? Math.min(...rec.fees) : null,
      actualFeeMax: rec ? Math.max(...rec.fees) : null,
      expectedMonthlyTotal: rec?.total || 0,
    }
  })
}

async function getTrialsOverview(academyId: string, branchId: string | null) {
  let q = supabase.from('trials').select('stage, converted, sport').eq('academy_id', academyId)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw error
  const byStage: Record<string, number> = {}
  let converted = 0
  for (const t of data) {
    byStage[t.stage] = (byStage[t.stage] || 0) + 1
    if (t.converted) converted++
  }
  return { total: data.length, byStage, converted }
}

// ── Groq / OpenAI-compatible function-calling loop ──
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'find_students',
      description: 'Search for students by (partial) name OR by their student code/ID (e.g. "SA098") within this academy. Use this first whenever the user names or IDs a student, to resolve their database student ID.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Full/partial student name, or their student code/ID' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_details',
      description: 'Get full profile, fee, and outstanding-balance status for one student by ID.',
      parameters: {
        type: 'object',
        properties: { studentId: { type: 'number', description: 'Student ID from find_students' } },
        required: ['studentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_payments',
      description: 'Get recent payment history for one student by ID.',
      parameters: {
        type: 'object',
        properties: {
          studentId: { type: 'number' },
          limit: { type: 'number', description: 'Max payments to return, default 10' },
        },
        required: ['studentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_attendance',
      description: 'Get attendance counts (Present/Absent/Late/Leave) for one student for a given month.',
      parameters: {
        type: 'object',
        properties: {
          studentId: { type: 'number' },
          year: { type: 'number' },
          month: { type: 'number', description: '1-12' },
        },
        required: ['studentId', 'year', 'month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_academy_overview',
      description: 'Get academy-wide stats: total/active/suspended students, students with outstanding fees, and fees collected this month.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attendance_leaderboard',
      description: 'Rank all students by attendance percentage for a given month. Use for "best/worst attendance", "who attends the most/least".',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'number' },
          month: { type: 'number', description: '1-12' },
          order: { type: 'string', enum: ['best', 'worst'], description: 'best = highest attendance % first (default), worst = lowest first' },
          limit: { type: 'number', description: 'Max students to return, default 10' },
        },
        required: ['year', 'month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_reliability',
      description: 'Approximate on-time vs late payment history. Pass studentId for one student\'s history, or omit it for an academy-wide most/least reliable ranking. "On time" is approximate (paid in the same or an earlier calendar month than the month it covers), not a contractual due-date check.',
      parameters: {
        type: 'object',
        properties: { studentId: { type: 'number', description: 'Omit for an academy-wide ranking instead of one student' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_student_performance',
      description: 'Get one student\'s latest skill/performance assessment (coach-rated scores by category) by student ID.',
      parameters: {
        type: 'object',
        properties: { studentId: { type: 'number' } },
        required: ['studentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_performers',
      description: 'Rank students by average skill-assessment score. Use for "best performing student", "who has the highest skill scores".',
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'Optional — filter to one sport' },
          limit: { type: 'number', description: 'Max students to return, default 5' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_batches_overview',
      description: 'List all batches in this academy with coach, capacity, enrolled count, and schedule.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_staff_list',
      description: 'List all staff/coaches in this academy with role, phone, sports, and status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_staff',
      description: 'Search for staff/coaches by (partial) name or role within this academy. Use this first whenever the user names a coach or staff member, to resolve their staff ID.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Full/partial staff name or role (e.g. "coach")' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_staff_details',
      description: 'Get one staff member/coach\'s full profile by staff ID: role, phone, sports, salary, join date, status, the batches they coach, days checked in this month, and recent leave requests.',
      parameters: {
        type: 'object',
        properties: { staffId: { type: 'number', description: 'Staff ID from find_staff' } },
        required: ['staffId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_staff_attendance',
      description: 'Get one staff member/coach\'s attendance for a given month: days checked in, each check-in with clock-in/clock-out time, and any leave requests overlapping that month.',
      parameters: {
        type: 'object',
        properties: {
          staffId: { type: 'number' },
          year: { type: 'number' },
          month: { type: 'number', description: '1-12' },
        },
        required: ['staffId', 'year', 'month'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_staff_activity',
      description: 'Get one staff member/coach\'s recent activity in the CRM (from the audit log): actions like marking attendance, adding payments, editing students, with timestamps.',
      parameters: {
        type: 'object',
        properties: {
          staffId: { type: 'number' },
          limit: { type: 'number', description: 'Max activities to return, default 20' },
        },
        required: ['staffId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_batch_fee_structure',
      description: 'Get the fee structure for batches: each batch\'s official fee plans (Daily/Alternate training with monthly, quarterly, and yearly rates), plus coach, schedule, active student count, what enrolled students actually pay (min/max), and expected monthly fee total. Use for "fee structure of batch X", "fees by batch", "how much does each batch bring in". Pass batchQuery to look at one batch, omit it for all batches.',
      parameters: {
        type: 'object',
        properties: { batchQuery: { type: 'string', description: 'Optional — full/partial batch name to filter to one batch (e.g. "U15 MWF advance")' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trials_overview',
      description: 'Get trial pipeline stats: total trials, count by stage (new/scheduled/attended/converted/rejected), and conversion count.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

async function runTool(academyId: string, branchId: string | null, name: string, args: any) {
  switch (name) {
    case 'find_students':              return await findStudents(academyId, args.query, branchId)
    case 'get_student_details':        return await getStudentDetails(academyId, args.studentId, branchId)
    case 'get_student_payments':       return await getStudentPayments(academyId, args.studentId, args.limit || 10)
    case 'get_attendance_leaderboard': return await getAttendanceLeaderboard(academyId, args.year, args.month, args.order || 'best', args.limit || 10, branchId)
    case 'get_payment_reliability':    return await getPaymentReliability(academyId, args.studentId ?? null, branchId)
    case 'get_student_performance':    return await getStudentPerformance(academyId, args.studentId)
    case 'get_top_performers':         return await getTopPerformers(academyId, args.sport || null, args.limit || 5, branchId)
    case 'get_batches_overview':       return await getBatchesOverview(academyId, branchId)
    case 'get_staff_list':             return await getStaffList(academyId, branchId)
    case 'find_staff':                 return await findStaff(academyId, args.query, branchId)
    case 'get_staff_details':          return await getStaffDetails(academyId, args.staffId, branchId)
    case 'get_staff_attendance':       return await getStaffAttendance(academyId, args.staffId, args.year, args.month, branchId)
    case 'get_staff_activity':         return await getStaffActivity(academyId, args.staffId, args.limit || 20, branchId)
    case 'get_batch_fee_structure':    return await getBatchFeeStructure(academyId, args.batchQuery || null, branchId)
    case 'get_trials_overview':        return await getTrialsOverview(academyId, branchId)
    case 'get_student_attendance': return await getStudentAttendance(academyId, args.studentId, args.year, args.month, branchId)
    case 'get_academy_overview':   return await getAcademyOverview(academyId, branchId)
    default: return { error: `unknown tool ${name}` }
  }
}

const SYSTEM_INSTRUCTION = `You are a helpful assistant embedded in a sports academy CRM. You answer questions about students, payments, attendance, performance/skill assessments, batches, staff, and trials using only the provided tools — never guess or make up numbers. Always look up a student by name via find_students before answering about them. Likewise, always look up a coach/staff member by name via find_staff first, then use get_staff_details (profile, salary, batches coached), get_staff_attendance (check-ins for a month), or get_staff_activity (their recent actions in the CRM) — the same disambiguation rule applies: if find_staff returns more than one match, list them and ask which one. Staff check-in attendance only exists if the academy uses QR clock-in — if a month has zero check-ins, say no check-ins were recorded rather than assuming the coach was absent. For batch fee questions use get_batch_fee_structure (pass batchQuery when the user names a batch): each batch may have official fee plans (Daily/Alternate training with monthly/quarterly/yearly rates) — present those as the fee structure when they exist; the actual min–max of what enrolled students pay is separate context, since individual students can be on older or discounted rates. If a batch has no fee plans, say so and fall back to the actual student-fee range. Money amounts are in INR (₹). Keep answers short and direct. Use the conversation so far to resolve follow-up questions ("how much", "and attendance?") against whatever student or topic was just discussed — don't ask the user to repeat the name. Fee totals from get_student_details are calendar-month approximations (unpaid months × monthly fee), not a penny-exact ledger — say "approximately ₹X" rather than stating it as exact. get_payment_reliability's "on time" flag is also approximate (paid within the covered month), not a contractual due-date check — say so if asked. get_top_performers / get_student_performance reflect coach-entered skill assessments only, if any exist for that student/academy — if a tool returns no assessment on record, say plainly that no assessment has been recorded rather than guessing. If a tool returns an error or no match, say so plainly instead of inventing an answer. If a question has no matching tool at all (something truly outside students/payments/attendance/performance/batches/staff/trials), say plainly that you don't have data for that rather than guessing.

Confirming which student before answering: if find_students returns more than one match, do NOT guess which one the user meant and do NOT call any other tool yet. Instead list every match as a "- " bullet, each showing full name, student code, batch, and status (e.g. "- **Aaryan Patel** (SA045) — Under 15 Advance, Active"), then ask the user to confirm which one by name or code. Only proceed to get_student_details/payments/attendance/performance for a specific student once exactly one match is confirmed — either find_students returned exactly one result, or the user has just picked one from a list you showed them.

Formatting: write plain text with light markdown, not a wall of prose.
- Bold the key figures and names with **double asterisks** — e.g. **Aaryan Patel** owes **₹12,500**.
- Format money with thousands separators and the ₹ symbol: ₹1,25,000, not 125000.
- When answering about more than one item (multiple students, multiple months), use a "- " bullet list, one line per item, not a run-on sentence.
- Keep each answer to what was asked — don't pad with unrequested extra context.`

// ── Entity harvesting — every record a tool touched becomes a candidate
// "chip" the frontend can render as a deep link (/detail/:type/:id). We
// collect from structured tool results rather than asking the model to emit
// links, which it would mangle. The final filter keeps only entities the
// answer actually mentions, so listing tools don't flood the UI. ──
type Entity = { type: 'student' | 'coach' | 'batch' | 'payment'; id: string | number; label: string }

function harvestEntities(map: Map<string, Entity>, toolName: string, args: any, result: any) {
  const add = (type: Entity['type'], id: string | number | null | undefined, label: string | null | undefined) => {
    if (id == null || !label) return
    const key = `${type}:${id}`
    if (!map.has(key)) map.set(key, { type, id, label })
  }
  if (!result || typeof result !== 'object' || (result as any).error) return
  const rows = Array.isArray(result) ? result : []
  switch (toolName) {
    case 'find_students':
      for (const s of rows) add('student', s.id, s.name)
      break
    case 'get_student_details':
      add('student', (result as any).id, (result as any).name)
      break
    case 'get_student_payments':
      for (const p of rows) add('payment', p.id, String(p.id))
      break
    case 'get_attendance_leaderboard':
    case 'get_top_performers':
      for (const s of rows) add('student', s.studentId, s.name)
      break
    case 'get_payment_reliability':
      for (const s of [...((result as any).mostReliable || []), ...((result as any).leastReliable || [])]) {
        add('student', s.studentId, s.name)
      }
      break
    case 'get_batches_overview':
      for (const b of rows) add('batch', b.id, b.name)
      break
    case 'get_batch_fee_structure':
      for (const b of rows) add('batch', b.batchId, b.batch)
      break
    case 'find_staff':
    case 'get_staff_list':
      for (const s of rows) add('coach', s.id, s.name)
      break
    case 'get_staff_details':
      add('coach', (result as any).id, (result as any).name)
      break
    case 'get_staff_attendance':
    case 'get_staff_activity':
      add('coach', args?.staffId, (result as any).staffName)
      break
  }
}

// Keep only entities the answer text actually references — full label match,
// or (for people) their first name — capped so the chip row stays scannable.
function relevantEntities(map: Map<string, Entity>, answer: string): Entity[] {
  const lc = answer.toLowerCase()
  return [...map.values()]
    .filter((e) => {
      if (e.type === 'payment') return lc.includes(String(e.id).toLowerCase())
      const label = e.label.toLowerCase()
      if (lc.includes(label)) return true
      const first = label.split(/\s+/)[0]
      return first.length >= 3 && lc.includes(first)
    })
    .slice(0, 8)
}

// Only user/assistant turns with string content are trusted from the client —
// never let client-supplied history inject a fake tool_calls/tool turn.
function sanitizeHistory(history: any): Array<{ role: string; content: string }> {
  if (!Array.isArray(history)) return []
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)
  if (!GROQ_API_KEY)            return json({ error: 'AI assistant not configured (missing GROQ_API_KEY)' }, 500)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const question = (body?.question || '').trim()
  if (!question) return json({ error: 'question required' }, 400)
  const history = sanitizeHistory(body?.history)

  const sessionToken = req.headers.get('x-session-token')

  // current_actor() falls back to auth.uid() for owners — that only resolves
  // when the RPC runs under the caller's own JWT, not the service-role key.
  // Use a client that forwards the incoming Authorization header for this one
  // check; the service-role `supabase` client (module scope) still does all
  // the actual data queries below, manually scoped to actor.academy_id.
  const authHeader = req.headers.get('Authorization') || ''
  const supabaseAsCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: actorRow, error: actorErr } = await supabaseAsCaller
    .rpc('current_actor', { p_token: sessionToken })
    .maybeSingle()
  // The RPC has no generated types in this standalone function, so PostgREST
  // infers {} — assert the shape current_actor actually returns.
  const actor = actorRow as { actor_kind?: string; academy_id?: string; branch_id?: string | null } | null
  if (actorErr || !actor || !actor.actor_kind || !actor.academy_id) return json({ error: 'unauthorized' }, 401)
  if (actor.actor_kind !== 'owner' && actor.actor_kind !== 'staff') return json({ error: 'forbidden' }, 403)

  const academyId = actor.academy_id
  // Branch-scoped staff are locked to their own branch server-side (actor.branch_id
  // wins, can't be overridden by the client). Owners have no branch_id on their
  // actor row, so we trust the client-supplied branchId — whatever branch they're
  // currently viewing in the UI — falling back to academy-wide if none selected.
  const effectiveBranchId: string | null = actor.branch_id || (typeof body?.branchId === 'string' && body.branchId ? body.branchId : null)
  const messages: any[] = [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    ...history,
    { role: 'user', content: question },
  ]

  const endpoint = 'https://api.groq.com/openai/v1/chat/completions'
  const entityMap = new Map<string, Entity>()

  // Cap iterations so a confused model can't loop forever.
  for (let i = 0; i < 6; i++) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: TOOLS,
      }),
    })
    const respJson = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return json({ error: 'AI provider error', details: respJson }, 502)
    }

    const message = respJson?.choices?.[0]?.message
    const toolCalls = message?.tool_calls || []

    if (toolCalls.length === 0) {
      const answer = (message?.content || '').trim()
      return json({
        answer: answer || "I couldn't find an answer to that.",
        entities: relevantEntities(entityMap, answer),
      })
    }

    // Echo the model's turn, then run every requested tool and reply in one turn.
    messages.push(message)
    for (const tc of toolCalls) {
      const name = tc.function?.name
      let args: any = {}
      try { args = JSON.parse(tc.function?.arguments || '{}') } catch { /* leave {} */ }
      let result
      try {
        result = await runTool(academyId, effectiveBranchId, name, args)
        harvestEntities(entityMap, name, args, result)
      } catch (e: any) {
        result = { error: e?.message || 'tool failed' }
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) })
    }
  }

  return json({ answer: "I wasn't able to finish looking that up — try rephrasing or asking about one thing at a time." })
})
