import * as XLSX from 'xlsx'
import { supabase } from './supabase'

// ── Export a single sport's data to JSON + Excel ──────────

export async function exportSportData(sportName) {
  // 1. Students for this sport
  const { data: students = [] } = await supabase
    .from('students').select('*').eq('sport', sportName)

  const studentIds = students.map(s => s.id)

  // 2. Payments for those students
  const { data: payments = [] } = studentIds.length
    ? await supabase.from('payments').select('*').in('student_id', studentIds)
    : { data: [] }

  // 3. Batches that include this sport
  const { data: batches = [] } = await supabase
    .from('batches').select('*').contains('sports', [sportName])

  // 4. Trials for this sport
  const { data: trials = [] } = await supabase
    .from('trials').select('*').eq('sport', sportName)

  // Build a student_id → student_code lookup for payment linking
  const idToCode = {}
  students.forEach(s => { idToCode[s.id] = s.student_code })

  const exportData = {
    version:     '1.0',
    sport:       sportName,
    exported_at: new Date().toISOString(),
    students: students.map(s => ({
      student_code:  s.student_code,
      name:          s.name,
      parent:        s.parent        || '',
      phone:         s.phone         || '',
      parent_phone:  s.parent_phone  || '',
      age:           s.age           || null,
      sport:         s.sport,
      batch:         s.batch         || '',
      join_date:     s.join_date,
      status:        s.status,
      fees:          s.fees          || 0,
      paid_till:     s.paid_till     || null,
      training_type: s.training_type || 'Daily',
      fee_plan:      s.fee_plan      || 'monthly',
    })),
    payments: payments.map(p => ({
      student_code:   idToCode[p.student_id] || null,
      student_name:   p.student,
      amount:         p.amount,
      month:          p.month,
      date:           p.date,
      status:         p.status,
      mode:           p.mode          || '',
      payment_type:   p.payment_type  || 'monthly',
      months_covered: p.months_covered || 1,
      discount_pct:   p.discount_pct  || 0,
    })),
    batches: batches.map(b => ({
      name:       b.name,
      code:       b.code       || '',
      sports:     b.sports     || [],
      coach:      b.coach      || '',
      capacity:   b.capacity   || 20,
      days:       b.days       || [],
      start_time: b.start_time || '',
      end_time:   b.end_time   || '',
      ground:     b.ground     || '',
      age_min:    b.age_min    ?? 0,
      age_max:    b.age_max    ?? 99,
    })),
    trials: trials.map(t => ({
      name:       t.name,
      parent:     t.parent     || '',
      phone:      t.phone      || '',
      sport:      t.sport,
      trial_date: t.trial_date,
      source:     t.source     || '',
      status:     t.status,
      converted:  t.converted  || false,
      follow_up:  t.follow_up  || null,
    })),
  }

  return exportData
}

// ── Download as JSON file ─────────────────────────────────

export function downloadJSON(data) {
  const date = new Date().toISOString().split('T')[0]
  const filename = `${data.sport}_backup_${date}.json`
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Download as Excel (multi-sheet) ──────────────────────

export function downloadExcel(data) {
  const wb = XLSX.utils.book_new()

  // Students sheet
  if (data.students.length) {
    const rows = data.students.map(s => ({
      'Code':          s.student_code,
      'Name':          s.name,
      'Parent':        s.parent,
      'Phone':         s.phone,
      'Parent Phone':  s.parent_phone,
      'Age':           s.age,
      'Sport':         s.sport,
      'Batch':         s.batch,
      'Join Date':     s.join_date,
      'Status':        s.status,
      'Fees (₹)':      s.fees,
      'Paid Till':     s.paid_till,
      'Training Type': s.training_type,
      'Fee Plan':      s.fee_plan,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Students')
  }

  // Payments sheet
  if (data.payments.length) {
    const rows = data.payments.map(p => ({
      'Student Code':   p.student_code,
      'Student Name':   p.student_name,
      'Amount (₹)':     p.amount,
      'Month':          p.month,
      'Date':           p.date,
      'Status':         p.status,
      'Mode':           p.mode,
      'Payment Type':   p.payment_type,
      'Months Covered': p.months_covered,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Payments')
  }

  // Batches sheet
  if (data.batches.length) {
    const rows = data.batches.map(b => ({
      'Name':       b.name,
      'Code':       b.code,
      'Sports':     (b.sports || []).join(', '),
      'Coach':      b.coach,
      'Capacity':   b.capacity,
      'Days':       (b.days  || []).join(', '),
      'Start Time': b.start_time,
      'End Time':   b.end_time,
      'Ground':     b.ground,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Batches')
  }

  // Trials sheet
  if (data.trials.length) {
    const rows = data.trials.map(t => ({
      'Name':       t.name,
      'Parent':     t.parent,
      'Phone':      t.phone,
      'Sport':      t.sport,
      'Trial Date': t.trial_date,
      'Source':     t.source,
      'Status':     t.status,
      'Converted':  t.converted ? 'Yes' : 'No',
      'Follow Up':  t.follow_up,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Trials')
  }

  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${data.sport}_backup_${date}.xlsx`)
}

// ── Parse & validate an imported JSON file ────────────────

export function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.version || !data.sport || !Array.isArray(data.students)) {
          reject(new Error('Invalid backup file format'))
          return
        }
        resolve(data)
      } catch {
        reject(new Error('File is not valid JSON'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

// ── Import sport data into Supabase ──────────────────────
// Returns { created, skipped, errors }

export async function importSportData(data, academyId, existingStudentCodes) {
  const results = { created: 0, skipped: 0, errors: [], details: [] }

  // Build map: original student_code → new student id (for payment linking)
  const codeToNewId = {}

  // 1. Import students
  for (const s of data.students) {
    if (existingStudentCodes.has(s.student_code)) {
      results.skipped++
      results.details.push({ name: s.name, action: 'skipped', reason: 'Code already exists' })
      continue
    }
    try {
      const insert = {
        name:          s.name,
        parent:        s.parent        || '',
        phone:         s.phone         || '',
        parent_phone:  s.parent_phone  || '',
        age:           s.age           || null,
        sport:         s.sport,
        batch:         s.batch         || '',
        join_date:     s.join_date     || new Date().toISOString().split('T')[0],
        status:        s.status        || 'Active',
        fees:          s.fees          || 0,
        paid_till:     s.paid_till     || null,
        training_type: s.training_type || 'Daily',
        fee_plan:      s.fee_plan      || 'monthly',
        student_code:  s.student_code,
        account_status:'pending',
      }
      if (academyId) insert.academy_id = academyId

      const { data: created, error } = await supabase
        .from('students').insert(insert).select('id').single()
      if (error) throw error

      codeToNewId[s.student_code] = created.id
      results.created++
      results.details.push({ name: s.name, action: 'created' })
    } catch (err) {
      if (err.message?.includes('students_student_code_key') || err.code === '23505') {
        results.skipped++
        results.details.push({ name: s.name, action: 'skipped', reason: 'Code already exists' })
      } else {
        results.errors.push(`${s.name}: ${err.message}`)
      }
    }
  }

  // 2. Import payments (only for newly created students)
  let payNextNum = null
  for (const p of data.payments) {
    const newStudentId = codeToNewId[p.student_code]
    if (!newStudentId) continue // student was skipped or missing

    try {
      // Generate invoice ID
      if (payNextNum === null) {
        const { data: existing } = await supabase.from('payments').select('id')
        const nums = (existing || []).map(r => {
          const m = r.id.match(/INV-\d+-(\d+)/)
          return m ? parseInt(m[1]) : 0
        })
        payNextNum = (nums.length ? Math.max(...nums) : 0) + 1
      }
      const invoiceId = `INV-${new Date().getFullYear()}-${String(payNextNum).padStart(3, '0')}`
      payNextNum++

      const insert = {
        id:             invoiceId,
        student_id:     newStudentId,
        student:        p.student_name,
        amount:         p.amount,
        month:          p.month,
        date:           p.date         || null,
        status:         p.status,
        mode:           p.mode         || null,
        payment_type:   p.payment_type || 'monthly',
        months_covered: p.months_covered || 1,
        discount_pct:   p.discount_pct   || 0,
      }
      if (academyId) insert.academy_id = academyId

      const { error } = await supabase.from('payments').insert(insert)
      if (error) throw error
    } catch (err) {
      results.errors.push(`Payment for ${p.student_name}: ${err.message}`)
    }
  }

  // 3. Import batches (skip if name already exists)
  for (const b of data.batches) {
    try {
      const insert = {
        name:       b.name,
        code:       b.code       || null,
        sports:     b.sports     || [],
        coach:      b.coach      || '',
        capacity:   b.capacity   || 20,
        enrolled:   0,
        days:       b.days       || [],
        start_time: b.start_time || '',
        end_time:   b.end_time   || '',
        ground:     b.ground     || '',
        age_min:    b.age_min    ?? 0,
        age_max:    b.age_max    ?? 99,
      }
      if (academyId) insert.academy_id = academyId

      // upsert on name — skip if already exists
      const { error } = await supabase
        .from('batches').upsert(insert, { onConflict: 'name', ignoreDuplicates: true })
      if (error) throw error
    } catch (err) {
      results.errors.push(`Batch ${b.name}: ${err.message}`)
    }
  }

  // 4. Import trials
  for (const t of data.trials) {
    try {
      const insert = {
        name:       t.name,
        parent:     t.parent     || '',
        phone:      t.phone      || '',
        sport:      t.sport,
        trial_date: t.trial_date,
        source:     t.source     || '',
        status:     t.status     || 'Scheduled',
        converted:  t.converted  || false,
        follow_up:  t.follow_up  || null,
      }
      if (academyId) insert.academy_id = academyId

      const { error } = await supabase.from('trials').insert(insert)
      if (error) throw error
    } catch (err) {
      results.errors.push(`Trial ${t.name}: ${err.message}`)
    }
  }

  return results
}
