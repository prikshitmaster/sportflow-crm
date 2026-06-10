import XLSX from 'xlsx-js-style'
import { todayStr, toLocalDateStr } from './dates'
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
  const date = toLocalDateStr()
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

  const date = toLocalDateStr()
  XLSX.writeFile(wb, `${data.sport}_backup_${date}.xlsx`)
}

// ── Shared helpers ────────────────────────────────────────────
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
function bar(pct, w = 18) {
  const filled = Math.min(w, Math.round(Math.max(0, pct) / 100 * w))
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}
function revFmt(n) {
  if (!n) return '₹0'
  return n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${n.toLocaleString('en-IN')}`
}

// ── Professional data-sheet builder ──────────────────────────
function applySheet(headers, rows, colWidths) {
  const aoa = [headers, ...rows]
  const ws  = XLSX.utils.aoa_to_sheet(aoa)
  const nC  = headers.length
  const nR  = rows.length
  const bd  = { top:{style:'thin',color:{rgb:'E2E8F0'}}, bottom:{style:'thin',color:{rgb:'E2E8F0'}}, left:{style:'thin',color:{rgb:'E2E8F0'}}, right:{style:'thin',color:{rgb:'E2E8F0'}} }
  for (let R = 0; R < aoa.length; R++) {
    for (let C = 0; C < nC; C++) {
      const a = XLSX.utils.encode_cell({ r:R, c:C })
      if (!ws[a]) ws[a] = { t:'s', v:'' }
      ws[a].s = R === 0
        ? { fill:{fgColor:{rgb:'1E3A5F'}}, font:{name:'Calibri',sz:10,bold:true,color:{rgb:'FFFFFF'}}, alignment:{horizontal:'center',vertical:'center'}, border:{...bd,bottom:{style:'medium',color:{rgb:'2563EB'}}} }
        : { fill:{fgColor:{rgb: R%2===0 ? 'F0F6FF' : 'FFFFFF'}}, font:{name:'Calibri',sz:10,color:{rgb:'374151'}}, alignment:{vertical:'center'}, border:bd }
    }
  }
  ws['!cols']       = colWidths.map(w => ({ wpx:w }))
  ws['!rows']       = [{ hpx:26 }]
  ws['!freeze']     = { xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft' }
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:nR,c:nC-1} }) }
  return ws
}

// ── Corporate dashboard Summary sheet ────────────────────────
function makeCoverSheet({ academyName, exportedAt, filters, students, payments, attendance, trials, batches }) {
  // ─── Metrics ─────────────────────────────────────────────
  const totalStu   = students.length
  const active     = students.filter(s => (s.status||'').toLowerCase() === 'active').length
  const suspended  = students.filter(s => (s.status||'').toLowerCase() === 'suspended').length
  const inactive   = totalStu - active - suspended

  const paid       = payments.filter(p => (p.status||'').toLowerCase() === 'paid')
  const unpaid     = payments.filter(p => (p.status||'').toLowerCase() !== 'paid')
  const totalRev   = paid.reduce((s, p) => s + (p.amount || 0), 0)
  const pendingRev = unpaid.reduce((s, p) => s + (p.amount || 0), 0)
  const paidShare  = payments.length ? Math.round(paid.length / payments.length * 100) : 0

  const attTotal   = attendance.length || 1
  const presentCt  = attendance.filter(a => a.status === 'Present' || a.present).length
  const absentCt   = attendance.filter(a => a.status === 'Absent'  || (!a.status && !a.present)).length
  const lateCt     = attendance.filter(a => a.status === 'Late').length
  const leaveCt    = attendance.filter(a => a.status === 'Leave').length
  const attRate    = Math.round(presentCt / attTotal * 100)

  const converted  = trials.filter(t => t.converted).length
  const convRate   = trials.length ? Math.round(converted / trials.length * 100) : 0

  // ─── Cell factory ─────────────────────────────────────────
  const ws     = {}
  const merges = []
  const enc    = (r, c) => XLSX.utils.encode_cell({ r, c })
  const COLS   = 10  // columns A–J (0-indexed 0–9)

  const setC = (r, c, val, s, z) => {
    const a = enc(r, c)
    ws[a] = { t: typeof val === 'number' ? 'n' : 's', v: val ?? '' }
    if (s) ws[a].s = s
    if (z) ws[a].z = z
  }
  const fill = (r, c1, c2, s) => { for (let c = c1; c <= c2; c++) setC(r, c, '', s) }
  const mg   = (r1,c1,r2,c2) => merges.push({ s:{r:r1,c:c1}, e:{r:r2,c:c2} })

  // ─── Style primitives ─────────────────────────────────────
  const f   = rgb => ({ fgColor: { rgb } })
  const fnt = (sz, bold, rgb) => ({ name:'Calibri', sz, bold:!!bold, color:{ rgb } })
  const al  = (h, v='center') => ({ horizontal:h, vertical:v })
  const bdr = (rgb, w='thin') => ({ top:{style:w,color:{rgb}}, bottom:{style:w,color:{rgb}}, left:{style:w,color:{rgb}}, right:{style:w,color:{rgb}} })
  const bdrB = (rgb) => ({ bottom:{style:'medium',color:{rgb}} })

  // Named styles
  const TH  = { fill:f('1E3A5F'), font:fnt(9,true,'FFFFFF'),  alignment:al('center'), border:bdr('334155') }
  const TC  = alt => ({ fill:f(alt?'F0F6FF':'FFFFFF'), font:fnt(9,false,'374151'), alignment:al('center'), border:bdr('E2E8F0') })
  const TL  = alt => ({ fill:f(alt?'F0F6FF':'FFFFFF'), font:fnt(9,false,'374151'), alignment:{horizontal:'left',vertical:'center'}, border:bdr('E2E8F0') })
  const TT  = { fill:f('DBEAFE'), font:fnt(9,true,'1E3A5F'),  alignment:al('center'), border:bdr('93C5FD','medium') }
  const TTL = { fill:f('DBEAFE'), font:fnt(9,true,'1E3A5F'),  alignment:{horizontal:'left',vertical:'center'}, border:bdr('93C5FD','medium') }

  // ─── Row 0: Title banner ──────────────────────────────────
  fill(0, 0, COLS-1, { fill:f('0F172A') })
  setC(0, 0, '  SPORTFLOW CRM  —  ACADEMY PERFORMANCE REPORT', {
    fill:f('0F172A'), font:fnt(15,true,'FFFFFF'), alignment:al('left','center'),
  })
  mg(0, 0, 0, COLS-1)

  // ─── Row 1: Subtitle ──────────────────────────────────────
  const periodStr = filters.dateFrom
    ? `${filters.dateFrom} → ${filters.dateTo || 'today'}`
    : 'All time'
  const subParts = [
    academyName || 'Academy',
    `Exported: ${fmtDate(exportedAt)}`,
    `Period: ${periodStr}`,
    filters.sport ? `Sport: ${filters.sport}` : 'All sports',
  ]
  fill(1, 0, COLS-1, { fill:f('1E40AF') })
  setC(1, 0, `  ${subParts.join('     ·     ')}`, {
    fill:f('1E40AF'), font:fnt(9,false,'BFDBFE'), alignment:al('left','center'),
  })
  mg(1, 0, 1, COLS-1)

  // ─── Row 2: spacer ────────────────────────────────────────

  // ─── Row 3: "KEY PERFORMANCE INDICATORS" header ───────────
  fill(3, 0, COLS-1, { fill:f('1E3A5F') })
  setC(3, 0, '   KEY PERFORMANCE INDICATORS', {
    fill:f('1E3A5F'), font:fnt(9,true,'94A3B8'), alignment:al('left','center'),
  })
  mg(3, 0, 3, COLS-1)

  // ─── Rows 4-6: KPI cards (5 × 2 columns) ─────────────────
  const kpis = [
    { label:'STUDENTS',          val: String(totalStu),         sub:`${active} active  ·  ${suspended} susp.`, accent:'1D4ED8', dark:'1E3A5F' },
    { label:'TOTAL REVENUE',     val: revFmt(totalRev),         sub:`${revFmt(pendingRev)} pending`,            accent:'047857', dark:'064E3B' },
    { label:'ATTENDANCE RATE',   val: `${attRate}%`,            sub:`${presentCt} / ${attTotal} sessions`,      accent:'1D4ED8', dark:'1E3A5F' },
    { label:'TRIAL CONVERSION',  val: `${convRate}%`,           sub:`${converted} of ${trials.length} leads`,   accent:'B45309', dark:'78350F' },
    { label:'ACTIVE BATCHES',    val: String(batches.length),   sub:`${totalStu} total enrolled`,               accent:'6D28D9', dark:'4C1D95' },
  ]
  kpis.forEach(({ label, val, sub, accent, dark }, i) => {
    const col = i * 2
    // label row
    fill(4, col, col+1, { fill:f(accent) })
    setC(4, col, `  ${label}`, { fill:f(accent), font:fnt(8,true,'DBEAFE'), alignment:al('left','center') })
    mg(4, col, 4, col+1)
    // value row
    fill(5, col, col+1, { fill:f(dark) })
    setC(5, col, val, { fill:f(dark), font:fnt(20,true,'FFFFFF'), alignment:al('center','center') })
    mg(5, col, 5, col+1)
    // sub row
    fill(6, col, col+1, { fill:f(dark) })
    setC(6, col, sub, { fill:f(dark), font:fnt(8,false,'93C5FD'), alignment:al('center','center') })
    mg(6, col, 6, col+1)
  })

  // ─── Row 7: spacer ────────────────────────────────────────

  // ─── Row 8: two-section header ────────────────────────────
  fill(8, 0, 4,      { fill:f('1E3A5F') })
  fill(8, 5, COLS-1, { fill:f('1E3A5F') })
  setC(8, 0, '   PAYMENT BREAKDOWN', { fill:f('1E3A5F'), font:fnt(9,true,'94A3B8'), alignment:al('left','center') })
  setC(8, 5, '   STUDENT STATUS',    { fill:f('1E3A5F'), font:fnt(9,true,'94A3B8'), alignment:al('left','center') })
  mg(8, 0, 8, 4); mg(8, 5, 8, COLS-1)

  // ─── Row 9: table headers ─────────────────────────────────
  ;['Status','Records','Revenue','Avg. Fee','Collection %'].forEach((h,i) => setC(9, i, h, TH))
  ;['Status','Count','% Share','Bar Chart (18 units)',''].forEach((h,i) => setC(9, 5+i, i<4?h:'', i<4?TH:{ fill:f('1E3A5F'), border:bdr('334155') }))
  mg(9, 8, 9, 9)

  // ─── Rows 10-11: Payment rows ─────────────────────────────
  const payRows = [
    ['Paid',   paid.length,   totalRev,   paid.length   ? Math.round(totalRev/paid.length)   : 0, `${bar(paidShare)} ${paidShare}%`,    true],
    ['Unpaid', unpaid.length, pendingRev, unpaid.length ? Math.round(pendingRev/unpaid.length): 0, `${bar(100-paidShare)} ${100-paidShare}%`, false],
  ]
  payRows.forEach(([st,n,amt,avg,barStr], ri) => {
    const alt = ri%2===0
    const barStyle = { ...TC(alt), font:{name:'Courier New',sz:8,color:{rgb:ri===0?'059669':'DC2626'}} }
    setC(10+ri,0,st,TL(alt)); setC(10+ri,1,n,TC(alt)); setC(10+ri,2,amt,{...TC(alt),z:'₹#,##0'})
    setC(10+ri,3,avg,{...TC(alt),z:'₹#,##0'}); setC(10+ri,4,barStr,barStyle)
  })
  // ─── Row 12: Payment total ────────────────────────────────
  setC(12,0,'TOTAL',TTL); setC(12,1,payments.length,TT); setC(12,2,totalRev+pendingRev,{...TT,z:'₹#,##0'})
  setC(12,3,payments.length?Math.round((totalRev+pendingRev)/payments.length):0,{...TT,z:'₹#,##0'})
  setC(12,4,`${bar(100)} 100%`,{ ...TT, font:{name:'Courier New',sz:8,color:{rgb:'1E3A5F'}} })

  // ─── Rows 10-12: Student status rows ─────────────────────
  const stuT = totalStu || 1
  const stuPct = n => Math.round(n/stuT*100)
  const stuRows = [
    ['Active',    active,    stuPct(active),    '059669'],
    ['Suspended', suspended, stuPct(suspended), 'DC2626'],
    ['Inactive',  inactive,  stuPct(inactive),  '6B7280'],
  ]
  stuRows.forEach(([st,n,pct,barClr], ri) => {
    const alt = ri%2===0
    setC(10+ri,5,st,TL(alt)); setC(10+ri,6,n,TC(alt)); setC(10+ri,7,`${pct}%`,TC(alt))
    setC(10+ri,8,`${bar(pct)} ${pct}%`,{ ...TC(alt), font:{name:'Courier New',sz:8,color:{rgb:barClr}} })
    setC(10+ri,9,'',TC(alt))
  })
  // ─── Row 13: Student total ────────────────────────────────
  setC(13,5,'TOTAL',TTL); setC(13,6,totalStu,TT); setC(13,7,'100%',TT)
  setC(13,8,`${bar(100)} 100%`,{ ...TT, font:{name:'Courier New',sz:8,color:{rgb:'1E3A5F'}} }); setC(13,9,'',TT)
  // fill empty payment cols on row 13
  for (let c = 0; c < 5; c++) setC(13,c,'',{ fill:f('FFFFFF'), border:bdr('E2E8F0') })

  // ─── Row 14: spacer ───────────────────────────────────────

  // ─── Row 15: Attendance header ────────────────────────────
  fill(15, 0, COLS-1, { fill:f('1E3A5F') })
  setC(15, 0, '   ATTENDANCE OVERVIEW', { fill:f('1E3A5F'), font:fnt(9,true,'94A3B8'), alignment:al('left','center') })
  mg(15, 0, 15, COLS-1)

  // ─── Row 16: Attendance table headers ────────────────────
  ;['Status','Sessions','% Share','Bar Chart (20 units)','','Rate Indicator'].forEach((h,i) => {
    if (i===3)      { setC(16,3,h,TH); mg(16,3,16,5) }
    else if (i < 3) setC(16,i,h,TH)
  })
  setC(16,6,'Rate Indicator',TH); mg(16,6,16,COLS-1)

  // ─── Rows 17-20: Attendance data ─────────────────────────
  const attRows = [
    ['Present', presentCt, attRate,                     '059669'],
    ['Absent',  absentCt,  Math.round(absentCt/attTotal*100), 'DC2626'],
    ['Late',    lateCt,    Math.round(lateCt/attTotal*100),   'D97706'],
    ['Leave',   leaveCt,   Math.round(leaveCt/attTotal*100),  '2563EB'],
  ]
  attRows.forEach(([st,n,pct,barClr], ri) => {
    const alt = ri%2===0
    setC(17+ri,0,st,TL(alt)); setC(17+ri,1,n,TC(alt)); setC(17+ri,2,`${pct}%`,TC(alt))
    setC(17+ri,3,`${bar(pct,20)} ${pct}%`,{ ...TC(alt), font:{name:'Courier New',sz:8,color:{rgb:barClr}} })
    setC(17+ri,4,'',TC(alt)); setC(17+ri,5,'',TC(alt))
    mg(17+ri,3,17+ri,5)
    const rateLbl = ri===0 ? (pct>=80?'Excellent':pct>=60?'Good':'Below Target') : ''
    const rateClr = pct>=80?'059669':pct>=60?'D97706':'DC2626'
    setC(17+ri,6, ri===0 ? rateLbl : '', ri===0
      ? { fill:f(pct>=80?'D1FAE5':pct>=60?'FEF3C7':'FEE2E2'), font:fnt(9,true,rateClr), alignment:al('center') }
      : TC(alt))
    mg(17+ri,6,17+ri,COLS-1)
  })
  // ─── Row 21: Attendance total ─────────────────────────────
  setC(21,0,'TOTAL',TTL); setC(21,1,attendance.length,TT); setC(21,2,'100%',TT)
  setC(21,3,`${bar(attRate,20)} ${attRate}%`,{ ...TT, font:{name:'Courier New',sz:8,color:{rgb:'1E3A5F'}} })
  setC(21,4,'',TT); setC(21,5,'',TT); mg(21,3,21,5)
  const totalRateLbl = attRate>=80?'Excellent':attRate>=60?'Good':'Below Target'
  const totalRateClr = attRate>=80?'059669':attRate>=60?'D97706':'DC2626'
  setC(21,6,totalRateLbl,{ fill:f(attRate>=80?'D1FAE5':attRate>=60?'FEF3C7':'FEE2E2'), font:fnt(9,true,totalRateClr), alignment:al('center'), border:bdr('93C5FD','medium') })
  mg(21,6,21,COLS-1)

  // ─── Sheet config ─────────────────────────────────────────
  ws['!merges'] = merges
  ws['!ref']    = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:21,c:COLS-1} })
  ws['!cols']   = [130,110,100,130,120,110,80,110,90,80].map(w => ({ wpx:w }))
  ws['!rows']   = [
    {hpx:32},{hpx:22},{hpx:8}, {hpx:22},{hpx:20},{hpx:38},{hpx:18},{hpx:8},
    {hpx:22},{hpx:22},{hpx:20},{hpx:20},{hpx:20},{hpx:20},{hpx:8},
    {hpx:22},{hpx:22},{hpx:20},{hpx:20},{hpx:20},{hpx:20},{hpx:20},
  ]
  return ws
}

// ── Student Summary sheet: one row per student with aggregated metrics ──
function buildStudentSummary(students, payments, attendance) {
  const ws    = {}
  const enc   = (r,c) => XLSX.utils.encode_cell({r,c})
  const setC  = (r,c,val,s,z) => { const a=enc(r,c); ws[a]={t:typeof val==='number'?'n':'s',v:val??''}; if(s)ws[a].s=s; if(z)ws[a].z=z }

  const f   = rgb => ({fgColor:{rgb}})
  const fnt = (sz,bold,rgb) => ({name:'Calibri',sz,bold:!!bold,color:{rgb}})
  const al  = (h,v='center') => ({horizontal:h,vertical:v})
  const bdr = (rgb='E2E8F0') => ({top:{style:'thin',color:{rgb}},bottom:{style:'thin',color:{rgb}},left:{style:'thin',color:{rgb}},right:{style:'thin',color:{rgb}}})

  // Payment & attendance lookup by student id
  const payByStu = {}
  payments.forEach(p => { if(!payByStu[p.student_id]) payByStu[p.student_id]=[]; payByStu[p.student_id].push(p) })
  const attByStu = {}
  attendance.forEach(a => { if(!attByStu[a.student_id]) attByStu[a.student_id]=[]; attByStu[a.student_id].push(a) })

  const hdrs = ['Student Name','Code','Sport','Batch','Status','Join Date','Monthly Fee','Total Paid','Pending','Last Payment','Paid Till','Sessions','Present','Absent','Att. %']
  const colW  = [150,80,80,120,85,100,100,110,100,110,100,70,70,70,70]

  // Header row
  const TH = {fill:f('1E3A5F'),font:fnt(9,true,'FFFFFF'),alignment:al('center'),border:bdr('334155')}
  hdrs.forEach((h,c) => setC(0,c,h,TH))

  // Data rows
  students.forEach((s,ri) => {
    const r = ri + 1
    const alt = ri % 2 === 0
    const base = {fill:f(alt?'F0F6FF':'FFFFFF'),font:fnt(9,false,'374151'),border:bdr()}
    const ctr  = {...base,alignment:al('center')}
    const lft  = {...base,alignment:{horizontal:'left',vertical:'center'}}

    const sp = payByStu[s.id] || []
    const sa = attByStu[s.id] || []
    const paid    = sp.filter(p => (p.status||'').toLowerCase() === 'paid')
    const unpaid  = sp.filter(p => (p.status||'').toLowerCase() !== 'paid')
    const totPaid = paid.reduce((x,p) => x+(p.amount||0), 0)
    const totPend = unpaid.reduce((x,p) => x+(p.amount||0), 0)
    const lastPay = paid.length ? paid.sort((a,b)=>new Date(b.date)-new Date(a.date))[0].date : null
    const presCt  = sa.filter(a => a.status==='Present' || a.present).length
    const absCt   = sa.filter(a => a.status==='Absent'  || (!a.status && !a.present)).length
    const attRate = sa.length ? Math.round((presCt / sa.length) * 100) : 0
    const rateClr = attRate>=80?'065F46':attRate>=60?'92400E':'991B1B'
    const rateBg  = attRate>=80?'D1FAE5':attRate>=60?'FEF3C7':'FEE2E2'
    const statusClr = (s.status||'').toLowerCase()==='active'?'065F46':(s.status||'').toLowerCase()==='suspended'?'991B1B':'6B7280'
    const statusBg  = (s.status||'').toLowerCase()==='active'?'D1FAE5':(s.status||'').toLowerCase()==='suspended'?'FEE2E2':'F3F4F6'

    setC(r,0,  s.name||'',          lft)
    setC(r,1,  s.student_code||'',  ctr)
    setC(r,2,  s.sport||'',         ctr)
    setC(r,3,  s.batch||'',         ctr)
    setC(r,4,  s.status||'',        {...ctr,fill:f(statusBg),font:fnt(9,true,statusClr)})
    setC(r,5,  fmtDate(s.join_date),ctr)
    setC(r,6,  s.fees??0,           {...ctr,z:'₹#,##0'})
    setC(r,7,  totPaid,             {...ctr,z:'₹#,##0',font:fnt(9,true,'065F46')})
    setC(r,8,  totPend,             {...ctr,z:'₹#,##0',font:fnt(9,true,totPend>0?'DC2626':'374151')})
    setC(r,9,  fmtDate(lastPay),    ctr)
    setC(r,10, fmtDate(s.paid_till),ctr)
    setC(r,11, sa.length,           ctr)
    setC(r,12, presCt,              {...ctr,font:fnt(9,true,'065F46')})
    setC(r,13, absCt,               {...ctr,font:fnt(9,true,absCt>0?'DC2626':'374151')})
    setC(r,14, sa.length?`${attRate}%`:'—', {...ctr,fill:f(rateBg),font:fnt(9,true,rateClr)})
  })

  ws['!cols']       = colW.map(w=>({wpx:w}))
  ws['!rows']       = [{hpx:26},...Array(students.length).fill({hpx:18})]
  ws['!freeze']     = {xSplit:0,ySplit:1,topLeftCell:'A2',activePane:'bottomLeft'}
  ws['!autofilter'] = {ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:students.length,c:hdrs.length-1}})}
  ws['!ref']        = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:students.length,c:hdrs.length-1}})
  return ws
}

// ── Attendance Matrix: student × date pivot with colored cells ──
function buildAttMatrix(students, attendance) {
  const ws    = {}
  const enc   = (r,c) => XLSX.utils.encode_cell({r,c})
  const setC  = (r,c,val,s) => { const a=enc(r,c); ws[a]={t:typeof val==='number'?'n':'s',v:val??''}; if(s)ws[a].s=s }

  const f   = rgb => ({fgColor:{rgb}})
  const fnt = (sz,bold,rgb,name='Calibri') => ({name,sz,bold:!!bold,color:{rgb}})
  const al  = (h,v='center') => ({horizontal:h,vertical:v})
  const bdr = (rgb='E2E8F0') => ({top:{style:'thin',color:{rgb}},bottom:{style:'thin',color:{rgb}},left:{style:'thin',color:{rgb}},right:{style:'thin',color:{rgb}}})

  // Status display config
  const ST = {
    Present: { abbr:'P', fill:'D1FAE5', font:'065F46', border:'A7F3D0' },
    Absent:  { abbr:'A', fill:'FEE2E2', font:'991B1B', border:'FECACA' },
    Late:    { abbr:'L', fill:'FEF3C7', font:'92400E', border:'FDE68A' },
    Leave:   { abbr:'V', fill:'DBEAFE', font:'1E40AF', border:'BFDBFE' },
    '':      { abbr:'',  fill:'F9FAFB', font:'D1D5DB', border:'F3F4F6' },
  }
  const stCell = (key, alt) => {
    const s = ST[key] || ST['']
    return { fill:f(alt && !key ? 'F0F6FF' : s.fill), font:fnt(9,!!key,s.font), alignment:al('center'), border:bdr(s.border) }
  }

  // Build pivot: studentId → date → best status
  const PRI  = {Present:4,Late:3,Leave:2,Absent:1}
  const pivot = {}
  attendance.forEach(a => {
    const st = a.status || (a.present ? 'Present' : 'Absent')
    if (!pivot[a.student_id]) pivot[a.student_id] = {}
    const cur = pivot[a.student_id][a.date]
    if (!cur || (PRI[st]||0) > (PRI[cur]||0)) pivot[a.student_id][a.date] = st
  })

  // Dates: sorted, max 90 most recent
  const dates = [...new Set(attendance.map(a=>a.date))].sort().slice(-90)
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const FIXED = 3   // Name, Code, Batch
  const TAIL  = 5   // Present, Absent, Late, Leave, Rate
  const TOTAL = FIXED + dates.length + TAIL

  // Sort students by name
  const sorted = [...students].sort((a,b)=>(a.name||'').localeCompare(b.name||''))

  // ── Row 0: Column headers ──────────────────────────────
  const HDR  = {fill:f('1E3A5F'),font:fnt(9,true,'FFFFFF'),alignment:al('center'),border:bdr('334155')}
  const DHDR = {fill:f('0F172A'),font:fnt(8,true,'94A3B8'),alignment:{horizontal:'center',vertical:'center',wrapText:true},border:bdr('1E293B')}
  setC(0,0,'Student Name',HDR); setC(0,1,'Code',HDR); setC(0,2,'Batch',HDR)
  dates.forEach((d,i) => {
    const dt = new Date(d)
    setC(0, FIXED+i, `${String(dt.getDate()).padStart(2,'0')}\n${MONTHS[dt.getMonth()]}`, DHDR)
  })
  const tailHdrs = ['Present','Absent','Late','Leave','Rate %']
  const tailClrs = ['065F46','991B1B','92400E','1E40AF','1E3A5F']
  tailHdrs.forEach((h,i) => setC(0, FIXED+dates.length+i, h, {...HDR, font:fnt(9,true,tailClrs[i])}))

  // ── Data rows ─────────────────────────────────────────
  sorted.forEach((s,ri) => {
    const r   = ri + 1
    const alt = ri % 2 === 0
    const base = {fill:f(alt?'F0F6FF':'FFFFFF'),font:fnt(9,false,'374151'),border:bdr()}

    setC(r,0, s.name||'',         {...base,alignment:{horizontal:'left',vertical:'center'}})
    setC(r,1, s.student_code||'', {...base,alignment:al('center')})
    setC(r,2, s.batch||'',        {...base,alignment:al('center')})

    let pCt=0, aCt=0, lCt=0, lvCt=0
    dates.forEach((d,di) => {
      const st = pivot[s.id]?.[d] ?? ''
      setC(r, FIXED+di, (ST[st]||ST['']).abbr, stCell(st, alt))
      if (st==='Present') pCt++
      else if (st==='Absent')  aCt++
      else if (st==='Late')    lCt++
      else if (st==='Leave')   lvCt++
    })

    const total   = pCt + aCt + lCt + lvCt
    const attRate = total ? Math.round((pCt + lCt) / total * 100) : 0
    const rClr    = attRate>=80?'065F46':attRate>=60?'92400E':'991B1B'
    const rBg     = attRate>=80?'D1FAE5':attRate>=60?'FEF3C7':'FEE2E2'

    const base2 = {...base,alignment:al('center')}
    setC(r, FIXED+dates.length+0, pCt,  {...base2,font:fnt(9,true,'065F46'),fill:f(alt?'F0FDF4':'FFFFFF')})
    setC(r, FIXED+dates.length+1, aCt,  {...base2,font:fnt(9,true,aCt?'991B1B':'374151'),fill:f(alt?'FFF5F5':'FFFFFF')})
    setC(r, FIXED+dates.length+2, lCt,  {...base2,font:fnt(9,true,lCt?'92400E':'374151'),fill:f(alt?'FFFBEB':'FFFFFF')})
    setC(r, FIXED+dates.length+3, lvCt, {...base2,font:fnt(9,true,lvCt?'1E40AF':'374151'),fill:f(alt?'EFF6FF':'FFFFFF')})
    setC(r, FIXED+dates.length+4, total?`${attRate}%`:'—', {fill:f(rBg),font:fnt(9,true,rClr),alignment:al('center'),border:bdr()})
  })

  ws['!cols'] = [
    {wpx:150},{wpx:75},{wpx:110},
    ...Array(dates.length).fill({wpx:26}),
    {wpx:65},{wpx:60},{wpx:55},{wpx:55},{wpx:65},
  ]
  ws['!rows']   = [{hpx:32},...Array(sorted.length).fill({hpx:18})]
  ws['!freeze'] = {xSplit:3,ySplit:1,topLeftCell:enc(1,3),activePane:'bottomRight'}
  ws['!ref']    = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:sorted.length,c:TOTAL-1}})
  return ws
}

// ── Full-academy backup: professional multi-sheet Excel ──────
// Filters: { dateFrom, dateTo, sport, sheets, download, academyName }
export async function exportAcademyData(academyId, { download = true, dateFrom, dateTo, sport, sheets, academyName } = {}) {
  const enabledSheets = sheets || ['students', 'student_summary', 'payments', 'att_matrix', 'attendance', 'trials', 'batches']

  // Build Supabase queries with optional date/sport filters
  const [studRes, payRes, batRes, triRes] = await Promise.all([
    (() => {
      let q = supabase.from('students').select('id,name,student_code,parent,phone,parent_phone,age,sport,batch,join_date,status,fees,paid_till,training_type,fee_plan,notes').eq('academy_id', academyId)
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

  const stamp = todayStr()
  const wb = XLSX.utils.book_new()

  // ── Cover Sheet ──
  XLSX.utils.book_append_sheet(wb, makeCoverSheet({
    academyName: academyName || 'Academy',
    exportedAt:  new Date().toISOString(),
    filters:     { dateFrom, dateTo, sport },
    students, payments, attendance, trials, batches,
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

  // ── Student Summary sheet (aggregated per-student metrics) ──
  if (enabledSheets.includes('student_summary') && students.length) {
    XLSX.utils.book_append_sheet(wb, buildStudentSummary(students, payments, attendance), 'Student Summary')
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

  // ── Attendance Matrix (pivot: student × date with colored cells) ──
  if (enabledSheets.includes('att_matrix') && attendance.length && students.length) {
    XLSX.utils.book_append_sheet(wb, buildAttMatrix(students, attendance), 'Att. Matrix')
  }

  // ── Attendance raw records sheet ──
  if (enabledSheets.includes('attendance') && attendance.length) {
    const hdrs = ['Student Name', 'Code', 'Date', 'Status', 'Batch']
    const idToCode2 = {}; students.forEach(s => { idToCode2[s.id] = s.student_code })
    const rows = attendance.map(a => [
      idToName[a.student_id] || '', idToCode2[a.student_id] || '', fmtDate(a.date),
      a.status || (a.present ? 'Present' : 'Absent'), a.batch_id || '',
    ])
    XLSX.utils.book_append_sheet(wb, applySheet(hdrs, rows, [160, 90, 110, 90, 90]), 'Att. Records')
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
        join_date:     s.join_date     || toLocalDateStr(),
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
