import XLSX from 'xlsx-js-style'
import { supabase } from './supabase'
import * as db from './db'

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

// ── Style helpers ────────────────────────────────────────────
const S = {
  headerFill:   { fgColor: { rgb: '1E3A5F' } },
  headerFont:   { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  headerAlign:  { horizontal: 'center', vertical: 'center' },
  headerBorder: { top: { style: 'thin', color: { rgb: 'CCCCCC' } }, bottom: { style: 'medium', color: { rgb: '2563EB' } }, left: { style: 'thin', color: { rgb: 'CCCCCC' } }, right: { style: 'thin', color: { rgb: 'CCCCCC' } } },
  cellFont:     { name: 'Calibri', sz: 10 },
  cellBorder:   { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
  altFill:      { fgColor: { rgb: 'F8FAFF' } },
  totalFill:    { fgColor: { rgb: 'EFF6FF' } },
  totalFont:    { name: 'Calibri', sz: 10, bold: true },
  currency:     { numFmt: '₹#,##0' },
  date:         { numFmt: 'DD-MMM-YYYY' },
  pct:          { numFmt: '0"%"' },
}

function applySheet(headers, rows, colWidths) {
  // Build AOA (array-of-arrays): header row + data rows
  const aoa = [headers, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  const nCols = headers.length
  const nRows = rows.length

  // Style each cell
  for (let R = 0; R < aoa.length; R++) {
    for (let C = 0; C < nCols; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      if (!ws[addr]) ws[addr] = { t: 'z', v: '' }
      if (R === 0) {
        ws[addr].s = { fill: S.headerFill, font: S.headerFont, alignment: S.headerAlign, border: S.headerBorder }
      } else {
        const isAlt = R % 2 === 0
        ws[addr].s = { fill: isAlt ? S.altFill : {}, font: S.cellFont, border: S.cellBorder, alignment: { vertical: 'center' } }
      }
    }
  }

  // Column widths
  ws['!cols'] = colWidths.map(w => ({ wpx: w }))
  // Row height for header
  ws['!rows'] = [{ hpx: 28 }]
  // Freeze top row
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' }
  // Auto-filter on header row
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: nRows, c: nCols - 1 } }) }

  return ws
}

function fmtDate(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d)) return val
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d)) return val
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function makeCoverSheet(meta) {
  const { academyName, exportedAt, filters, counts } = meta
  const ws = XLSX.utils.aoa_to_sheet([])

  const setCell = (addr, val, style) => {
    ws[addr] = { t: typeof val === 'number' ? 'n' : 's', v: val, s: style }
  }
  const TitleStyle  = { font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center' } }
  const SubStyle    = { font: { name: 'Calibri', sz: 11, color: { rgb: '6B7280' } }, alignment: { horizontal: 'center' } }
  const LabelStyle  = { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '374151' } } }
  const ValueStyle  = { font: { name: 'Calibri', sz: 11, color: { rgb: '111827' } } }
  const BigNumStyle = { font: { name: 'Calibri', sz: 24, bold: true, color: { rgb: '2563EB' } }, alignment: { horizontal: 'center' } }
  const SmallLabel  = { font: { name: 'Calibri', sz: 9, color: { rgb: '9CA3AF' } }, alignment: { horizontal: 'center' } }
  const SectionHdr  = { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'left' } }

  setCell('A1', 'SPORTFLOW CRM', TitleStyle)
  setCell('A2', 'Academy Data Export Report', SubStyle)
  setCell('A3', '─────────────────────────────────────────────────────────', SubStyle)
  setCell('A5', 'Academy', LabelStyle); setCell('B5', academyName || '—', ValueStyle)
  setCell('A6', 'Exported On', LabelStyle); setCell('B6', fmtTime(exportedAt), ValueStyle)
  if (filters.dateFrom || filters.dateTo) {
    setCell('A7', 'Date Range', LabelStyle)
    setCell('B7', `${filters.dateFrom || '—'} → ${filters.dateTo || '—'}`, ValueStyle)
  }
  if (filters.sport) {
    setCell('A8', 'Sport Filter', LabelStyle); setCell('B8', filters.sport, ValueStyle)
  }
  setCell('A10', 'EXPORT SUMMARY', SectionHdr)
  const statCols = [['A', 'Students'], ['C', 'Payments'], ['E', 'Attendance'], ['G', 'Trials'], ['I', 'Batches']]
  const statRow1 = 12, statRow2 = 13
  statCols.forEach(([col, label]) => {
    const count = counts[label.toLowerCase()] ?? 0
    setCell(`${col}${statRow1}`, count, BigNumStyle)
    setCell(`${col}${statRow2}`, label, SmallLabel)
  })

  ws['!cols'] = [{ wpx: 130 }, { wpx: 220 }, { wpx: 80 }, { wpx: 130 }, { wpx: 80 }, { wpx: 130 }, { wpx: 80 }, { wpx: 130 }, { wpx: 80 }]
  ws['!rows'] = [{ hpx: 36 }, { hpx: 20 }, { hpx: 16 }, { hpx: 10 }, { hpx: 22 }, { hpx: 22 }, { hpx: 22 }, { hpx: 22 }, { hpx: 14 }, { hpx: 24 }, { hpx: 12 }, { hpx: 32 }, { hpx: 20 }]
  ws['!ref'] = 'A1:I14'
  return ws
}

// ── Full-academy backup: professional multi-sheet Excel ──────
// Filters: { dateFrom, dateTo, sport, sheets, download }
export async function exportAcademyData(academyId, { download = true, dateFrom, dateTo, sport, sheets } = {}) {
  const enabledSheets = sheets || ['students', 'payments', 'attendance', 'trials', 'batches']

  // Build Supabase queries with optional date/sport filters
  const [studRes, payRes, batRes, triRes] = await Promise.all([
    (() => {
      let q = supabase.from('students').select('name,student_code,parent,phone,parent_phone,age,sport,batch,join_date,status,fees,paid_till,training_type,fee_plan,notes').eq('academy_id', academyId)
      if (sport) q = q.eq('sport', sport)
      return q
    })(),
    (() => {
      let q = supabase.from('payments').select('student_id,student,amount,month,date,status,mode,payment_type,months_covered,discount_pct,created_at').eq('academy_id', academyId)
      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo)   q = q.lte('date', dateTo)
      return q
    })(),
    (() => {
      let q = supabase.from('batches').select('name,code,sports,coach,capacity,enrolled,days,start_time,end_time,ground,age_min,age_max').eq('academy_id', academyId)
      return q
    })(),
    (() => {
      let q = supabase.from('trials').select('name,parent,phone,sport,trial_date,source,status,converted,follow_up,created_at').eq('academy_id', academyId)
      if (dateFrom) q = q.gte('trial_date', dateFrom)
      if (dateTo)   q = q.lte('trial_date', dateTo)
      if (sport)    q = q.eq('sport', sport)
      return q
    })(),
  ])

  // Attendance — scoped to this academy's students by RLS
  let attQuery = supabase.from('attendance').select('student_id,date,present,status,batch_id')
  if (dateFrom) attQuery = attQuery.gte('date', dateFrom)
  if (dateTo)   attQuery = attQuery.lte('date', dateTo)
  const attRes = await attQuery

  const students   = studRes.data   || []
  const payments   = payRes.data    || []
  const batches    = batRes.data    || []
  const trials     = triRes.data    || []
  const attendance = attRes.data    || []

  // student_id → name lookup for attendance
  const idToName = {}
  const idToCode = {}
  students.forEach(s => { idToName[s.id] = s.name; idToCode[s.id] = s.student_code })

  const stamp = new Date().toISOString().slice(0, 10)
  const wb = XLSX.utils.book_new()
  const academyName = undefined // passed from caller if needed

  // ── Cover Sheet ──
  XLSX.utils.book_append_sheet(wb, makeCoverSheet({
    academyName: academyName || 'Academy',
    exportedAt: new Date().toISOString(),
    filters: { dateFrom, dateTo, sport },
    counts: {
      students:   enabledSheets.includes('students')   ? students.length   : '—',
      payments:   enabledSheets.includes('payments')   ? payments.length   : '—',
      attendance: enabledSheets.includes('attendance') ? attendance.length : '—',
      trials:     enabledSheets.includes('trials')     ? trials.length     : '—',
      batches:    enabledSheets.includes('batches')    ? batches.length    : '—',
    },
  }), 'Summary')

  // ── Students sheet ──
  if (enabledSheets.includes('students') && students.length) {
    const hdrs = ['Student Code', 'Full Name', 'Parent / Guardian', 'Student Phone', 'Parent Phone', 'Age', 'Sport', 'Batch', 'Join Date', 'Status', 'Monthly Fee (₹)', 'Paid Till', 'Training Type', 'Fee Plan', 'Notes']
    const rows = students.map(s => [
      s.student_code || '', s.name || '', s.parent || '', s.phone || '', s.parent_phone || '',
      s.age ?? '', s.sport || '', s.batch || '', fmtDate(s.join_date),
      s.status || '', s.fees ?? 0, fmtDate(s.paid_till), s.training_type || 'Daily', s.fee_plan || 'Monthly', s.notes || '',
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [110, 150, 150, 120, 120, 45, 90, 130, 105, 75, 120, 105, 110, 90, 180]), 'Students')
  }

  // ── Payments sheet ──
  if (enabledSheets.includes('payments') && payments.length) {
    const hdrs = ['Student Name', 'Amount (₹)', 'Month', 'Payment Date', 'Status', 'Mode', 'Type', 'Months Covered', 'Discount %', 'Recorded On']
    const rows = payments.map(p => [
      p.student || '', p.amount ?? 0, p.month || '', fmtDate(p.date),
      p.status || '', p.mode || '', p.payment_type || 'Monthly',
      p.months_covered ?? 1, p.discount_pct ?? 0, fmtDate(p.created_at),
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [160, 110, 90, 115, 80, 90, 90, 120, 95, 115]), 'Payments')
  }

  // ── Attendance sheet ──
  if (enabledSheets.includes('attendance') && attendance.length) {
    const hdrs = ['Student Name', 'Date', 'Status', 'Present']
    const rows = attendance.map(a => [
      idToName[a.student_id] || a.student_id || '', fmtDate(a.date),
      a.status || (a.present ? 'Present' : 'Absent'), a.present ? 'Yes' : 'No',
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [160, 110, 90, 65]), 'Attendance')
  }

  // ── Trials sheet ──
  if (enabledSheets.includes('trials') && trials.length) {
    const hdrs = ['Student Name', 'Parent', 'Phone', 'Sport', 'Trial Date', 'Source', 'Status', 'Converted', 'Follow Up', 'Enquiry Date']
    const rows = trials.map(t => [
      t.name || '', t.parent || '', t.phone || '', t.sport || '', fmtDate(t.trial_date),
      t.source || '', t.status || '', t.converted ? 'Yes' : 'No', fmtDate(t.follow_up), fmtDate(t.created_at),
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [150, 130, 110, 80, 100, 100, 90, 80, 105, 115]), 'Trials')
  }

  // ── Batches sheet ──
  if (enabledSheets.includes('batches') && batches.length) {
    const hdrs = ['Batch Name', 'Code', 'Sport(s)', 'Coach', 'Capacity', 'Enrolled', 'Training Days', 'Start Time', 'End Time', 'Ground', 'Min Age', 'Max Age']
    const rows = batches.map(b => [
      b.name || '', b.code || '', (b.sports || []).join(', '), b.coach || '',
      b.capacity ?? 20, b.enrolled ?? 0, (b.days || []).join(', '),
      b.start_time || '', b.end_time || '', b.ground || '', b.age_min ?? 0, b.age_max ?? 99,
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [150, 80, 130, 140, 80, 80, 150, 90, 85, 130, 80, 80]), 'Batches')
  }

  const filename = `SportFlow-Export-${stamp}${sport ? '-' + sport : ''}.xlsx`
  if (download) {
    XLSX.writeFile(wb, filename)
    return { filename }
  }
  return { filename, buffer: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) }
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

      // Routed through secure_insert_payment (migration 0035) so import
      // respects the same caller/academy validation as the in-app add path.
      // status preserved from import — could be "Paid" or "Unpaid".
      await db.insertPayment({
        studentId:     newStudentId,
        student:       p.student_name,
        amount:        p.amount,
        month:         p.month,
        date:          p.date || null,
        status:        p.status,
        mode:          p.mode || null,
        paymentType:   p.payment_type || 'monthly',
        monthsCovered: p.months_covered || 1,
        discountPct:   p.discount_pct || 0,
        academyId:     academyId || null,
      }, invoiceId)
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
