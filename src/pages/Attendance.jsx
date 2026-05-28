import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import {
  Save, ChevronLeft, ChevronRight, X, FileSpreadsheet,
  MessageCircle, User, ChevronDown,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import * as db from '../lib/db'
import { fetchBatchEnrolments, fetchAllBatchEnrolments, fetchAttendanceForStudents } from '../lib/db'

// ── constants ──────────────────────────────────────────────────
const STATUS_CYCLE = ['Present', 'Absent', 'Late', 'Leave']
const S = {
  Present: { icon: '✓', bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50 border-emerald-200',  label: 'Present', hex: '22c55e' },
  Absent:  { icon: '✗', bg: 'bg-red-500',     text: 'text-red-600',     light: 'bg-red-50 border-red-200',          label: 'Absent',  hex: 'ef4444' },
  Late:    { icon: '⏱', bg: 'bg-amber-400',   text: 'text-amber-600',   light: 'bg-amber-50 border-amber-200',      label: 'Late',    hex: 'f59e0b' },
  Leave:   { icon: '○', bg: 'bg-gray-300',    text: 'text-gray-500',    light: 'bg-gray-50 border-gray-200',        label: 'Leave',   hex: '9ca3af' },
}
const pad          = n  => String(n).padStart(2, '0')
const daysInMonth  = (y, m) => new Date(y, m + 1, 0).getDate()
const dayName      = (y, m, d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y, m, d).getDay()]
const isSun        = (y, m, d) => new Date(y, m, d).getDay() === 0
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Professional Excel export (exceljs) ───────────────────────
async function exportToExcel({ students, batchName, fromDate, toDate, showToast }) {
  try {
    const ExcelJS = (await import('exceljs')).default
    const from = new Date(fromDate), to = new Date(toDate)
    if (from > to) { showToast('From date must be before To date', 'error'); return }

    const dateList = []
    const cur = new Date(from)
    while (cur <= to) { dateList.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }

    // Fetch all attendance data for the date range
    const monthsNeeded = new Set()
    dateList.forEach(d => monthsNeeded.add(`${d.getFullYear()}-${d.getMonth()}`))
    const allData = {}
    for (const key of monthsNeeded) {
      const [y, m] = key.split('-').map(Number)
      const md = await db.fetchAttendanceForMonth(y, m)
      for (const [sid, days] of Object.entries(md)) {
        if (!allData[sid]) allData[sid] = {}
        for (const [day, status] of Object.entries(days)) {
          allData[sid][`${y}-${pad(m+1)}-${pad(Number(day))}`] = status
        }
      }
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'SportFlow CRM'
    wb.created = new Date()

    // ── Sheet 1: Attendance Grid ─────────────────────────────
    const ws = wb.addWorksheet('Attendance', { views: [{ state: 'frozen', xSplit: 4, ySplit: 3 }] })

    const BRAND = '2563eb'
    const HEADER_BG = '1e3a5f'
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10, name: 'Calibri' }
    const subHeaderFont = { bold: true, color: { argb: 'FF374151' }, size: 9, name: 'Calibri' }
    const dataFont = { size: 9, name: 'Calibri' }
    const STATUS_FILLS = {
      Present: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFdcfce7' } },
      Absent:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfee2e2' } },
      Late:    { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } },
      Leave:   { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf3f4f6' } },
    }
    const LEGEND = { Present: 'P', Absent: 'A', Late: 'L', Leave: 'V' }

    // Row 1: Title
    ws.mergeCells(1, 1, 1, 4 + dateList.length + 5)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = `ATTENDANCE REPORT — ${batchName || 'All Batches'}`
    titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_BG}` } }
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(1).height = 22

    // Row 2: Meta info
    ws.mergeCells(2, 1, 2, 4)
    ws.getCell(2, 1).value = `Period: ${fromDate} → ${toDate}`
    ws.mergeCells(2, 5, 2, 4 + dateList.length + 5)
    ws.getCell(2, 5).value = `Total Students: ${students.length}   Exported: ${new Date().toLocaleDateString('en-IN')}`
    ;[ws.getCell(2,1), ws.getCell(2,5)].forEach(c => {
      c.font = { italic: true, size: 9, color: { argb: 'FF6b7280' }, name: 'Calibri' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf8fafc' } }
    })
    ws.getRow(2).height = 15

    // Row 3: Column headers
    const headerLabels = ['#', 'Student', 'Sport', 'Batch',
      ...dateList.map(d => `${d.getDate()}\n${dayName(d.getFullYear(), d.getMonth(), d.getDate())}`),
      'Present', 'Absent', 'Late', 'Leave', 'Att%']
    headerLabels.forEach((label, i) => {
      const cell = ws.getCell(3, i + 1)
      cell.value = label
      cell.font = headerFont
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND}` } }
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF93c5fd' } },
        left: { style: 'thin', color: { argb: 'FF93c5fd' } },
        bottom: { style: 'thin', color: { argb: 'FF93c5fd' } },
        right: { style: 'thin', color: { argb: 'FF93c5fd' } },
      }
    })
    ws.getRow(3).height = 28

    // Data rows
    students.forEach((s, i) => {
      const rowIdx = i + 4
      const statuses = dateList.map(d => {
        const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
        return allData[s.id]?.[key] || ''
      })
      const pr  = statuses.filter(x => x === 'Present').length
      const ab  = statuses.filter(x => x === 'Absent').length
      const la  = statuses.filter(x => x === 'Late').length
      const lv  = statuses.filter(x => x === 'Leave').length
      const tot = statuses.filter(x => x).length
      const pct = tot > 0 ? Math.round((pr / tot) * 100) : ''

      const rowBg = i % 2 === 0
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFffffff' } }
        : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFf9fafb' } }

      const baseVals = [i + 1, s.name, s.sport || '', s.batch || '']
      baseVals.forEach((v, ci) => {
        const cell = ws.getCell(rowIdx, ci + 1)
        cell.value = v
        cell.font = ci === 1 ? { ...dataFont, bold: true } : dataFont
        cell.fill = rowBg
        cell.alignment = ci === 0 ? { horizontal: 'center' } : { horizontal: 'left' }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe5e7eb' } } }
      })

      statuses.forEach((st, ci) => {
        const cell = ws.getCell(rowIdx, 5 + ci)
        cell.value = st ? LEGEND[st] || st[0] : ''
        if (st && STATUS_FILLS[st]) cell.fill = STATUS_FILLS[st]
        else cell.fill = rowBg
        cell.font = st ? { ...dataFont, bold: true } : dataFont
        cell.alignment = { horizontal: 'center' }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe5e7eb' } } }
      })

      const summaryVals = [pr, ab, la, lv, pct ? `${pct}%` : '']
      const summaryColors = ['FF166534', 'FF991b1b', 'FF92400e', 'FF374151', pct >= 80 ? 'FF166534' : pct >= 60 ? 'FF92400e' : 'FF991b1b']
      summaryVals.forEach((v, ci) => {
        const cell = ws.getCell(rowIdx, 5 + dateList.length + ci)
        cell.value = v
        cell.font = { ...dataFont, bold: true, color: { argb: summaryColors[ci] } }
        cell.fill = rowBg
        cell.alignment = { horizontal: 'center' }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFe5e7eb' } } }
      })

      ws.getRow(rowIdx).height = 16
    })

    // Summary footer row
    const footerRow = students.length + 4
    ws.getRow(footerRow).height = 18
    const footerCell = ws.getCell(footerRow, 1)
    ws.mergeCells(footerRow, 1, footerRow, 4)
    footerCell.value = 'TOTAL / AVERAGE'
    footerCell.font = { ...headerFont, color: { argb: 'FF000000' } }
    footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFe0f2fe' } }
    footerCell.alignment = { horizontal: 'center' }

    // Column widths
    ws.columns = [
      { width: 4 }, { width: 24 }, { width: 14 }, { width: 18 },
      ...dateList.map(() => ({ width: 5 })),
      { width: 8 }, { width: 8 }, { width: 6 }, { width: 6 }, { width: 7 },
    ]

    // ── Sheet 2: Summary by Student ──────────────────────────
    const ws2 = wb.addWorksheet('Summary')
    const sumHeaders = ['#', 'Student', 'Sport', 'Batch', 'Present', 'Absent', 'Late', 'Leave', 'Total Days', 'Att %']
    sumHeaders.forEach((h, i) => {
      const cell = ws2.getCell(1, i + 1)
      cell.value = h
      cell.font = headerFont
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BRAND}` } }
      cell.alignment = { horizontal: 'center' }
    })
    ws2.getRow(1).height = 22

    students.forEach((s, i) => {
      const statuses = dateList.map(d => allData[s.id]?.[`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`] || '')
      const pr = statuses.filter(x => x === 'Present').length
      const ab = statuses.filter(x => x === 'Absent').length
      const la = statuses.filter(x => x === 'Late').length
      const lv = statuses.filter(x => x === 'Leave').length
      const tot = pr + ab + la + lv
      const pct = tot > 0 ? Math.round((pr / tot) * 100) : 0

      const rowData = [i+1, s.name, s.sport||'', s.batch||'', pr, ab, la, lv, tot, pct ? `${pct}%` : '0%']
      const rowBg = i%2===0 ? 'FFffffff' : 'FFf9fafb'
      rowData.forEach((v, ci) => {
        const cell = ws2.getCell(i + 2, ci + 1)
        cell.value = v
        cell.font = ci === 1 ? { ...dataFont, bold: true } : dataFont
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } }
        cell.alignment = ci <= 3 ? { horizontal: 'left' } : { horizontal: 'center' }
        if (ci === 9 && pct > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pct >= 80 ? 'FFdcfce7' : pct >= 60 ? 'FFfef3c7' : 'FFfee2e2' } }
        }
      })
      ws2.getRow(i + 2).height = 16
    })
    ws2.columns = [{ width:4 },{ width:26 },{ width:14 },{ width:20 },{ width:9 },{ width:9 },{ width:7 },{ width:7 },{ width:10 },{ width:8 }]

    // Write file
    const filename = `Attendance_${batchName ? batchName.replace(/\s+/g,'_') + '_' : ''}${fromDate}_to_${toDate}.xlsx`
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    showToast('Excel exported successfully')
  } catch (err) { console.error(err); showToast('Export failed: ' + err.message, 'error') }
}

// ── Student Attendance Panel ───────────────────────────────────
function StudentAttendancePanel({ student, allMonthData, onClose, onCycle, showToast }) {
  const now = new Date()
  const [panelYear,  setPanelYear]  = useState(now.getFullYear())
  const [panelMonth, setPanelMonth] = useState(now.getMonth())
  const [panelData,  setPanelData]  = useState(allMonthData)
  const [loading,    setLoading]    = useState(false)
  const [exporting,  setExporting]  = useState(false)

  const totalDays = daysInMonth(panelYear, panelMonth)
  const days = Array.from({ length: totalDays }, (_, i) => i + 1)
  const isCurrentMonth = panelYear === now.getFullYear() && panelMonth === now.getMonth()

  const prevPanelMonth = () => {
    if (panelMonth === 0) { setPanelYear(y => y-1); setPanelMonth(11) }
    else setPanelMonth(m => m-1)
  }
  const nextPanelMonth = () => {
    if (isCurrentMonth) return
    if (panelMonth === 11) { setPanelYear(y => y+1); setPanelMonth(0) }
    else setPanelMonth(m => m+1)
  }

  useEffect(() => {
    if (isCurrentMonth) { setPanelData(allMonthData); return }
    setLoading(true)
    db.fetchAttendanceForMonth(panelYear, panelMonth)
      .then(data => setPanelData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [panelYear, panelMonth])

  useEffect(() => {
    if (isCurrentMonth) setPanelData(allMonthData)
  }, [allMonthData, isCurrentMonth])

  const stats = useMemo(() => {
    const c = { Present:0, Absent:0, Late:0, Leave:0 }
    days.forEach(d => {
      const st = panelData[student.id]?.[d] || ''
      if (st) c[st] = (c[st]||0)+1
    })
    const tot = c.Present + c.Absent + c.Late + c.Leave
    return { ...c, total: tot, pct: tot > 0 ? Math.round((c.Present/tot)*100) : 0 }
  }, [panelData, student.id, days])

  const handleExportStudent = async () => {
    setExporting(true)
    try {
      const from = `${panelYear}-${pad(panelMonth+1)}-01`
      const to   = `${panelYear}-${pad(panelMonth+1)}-${pad(totalDays)}`
      await exportToExcel({ students: [student], batchName: student.batch, fromDate: from, toDate: to, showToast })
    } finally { setExporting(false) }
  }

  // Build calendar weeks
  const firstDow = new Date(panelYear, panelMonth, 1).getDay()
  const calCells = [...Array(firstDow).fill(null), ...days]
  const weeks = []
  for (let i = 0; i < calCells.length; i += 7) weeks.push(calCells.slice(i, i+7))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-md shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-5 pt-5 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center text-lg font-black text-white">
                {student.name[0]}
              </div>
              <div>
                <h2 className="text-lg font-black text-white">{student.name}</h2>
                <p className="text-brand-200 text-xs">{student.sport} · {student.batch || 'No batch'}</p>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mt-1 inline-block ${student.trainingType === 'Alternate' ? 'bg-violet-500/80 text-white' : 'bg-white/20 text-white'}`}>
                  {student.trainingType === 'Alternate' ? 'ALT' : 'DAY'}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 transition">
              <X size={15} className="text-white" />
            </button>
          </div>
          {/* Quick stats */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[
              { label: 'Present', value: stats.Present, color: 'bg-emerald-500/80' },
              { label: 'Absent',  value: stats.Absent,  color: 'bg-red-500/80' },
              { label: 'Late',    value: stats.Late,     color: 'bg-amber-400/80' },
              { label: 'Att%',    value: `${stats.pct}%`,color: 'bg-white/20' },
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-xl p-2 text-center`}>
                <p className="text-base font-black text-white">{s.value}</p>
                <p className="text-[9px] text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white">
          <button onClick={prevPanelMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <ChevronLeft size={16} className="text-gray-600" />
          </button>
          <span className="text-sm font-bold text-gray-800">{MONTH_NAMES[panelMonth]} {panelYear}</span>
          <button onClick={nextPanelMonth} disabled={isCurrentMonth} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
            <ChevronRight size={16} className="text-gray-600" />
          </button>
        </div>

        {/* Calendar body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            </div>
          ) : (
            <>
              {/* Day of week headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                  <div key={d} className={`text-center text-[10px] font-bold py-1 ${d === 'Sun' ? 'text-red-400' : 'text-gray-400'}`}>{d}</div>
                ))}
              </div>
              {/* Calendar grid */}
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1 mb-1">
                  {week.map((d, di) => {
                    if (!d) return <div key={di} />
                    const isFutureDay = isCurrentMonth && d > now.getDate()
                    const st  = panelData[student.id]?.[d] || ''
                    const cfg = st ? S[st] : null
                    const isToday = isCurrentMonth && d === now.getDate()
                    return (
                      <button
                        key={d}
                        onClick={() => !isFutureDay && onCycle(student.id, d)}
                        disabled={isFutureDay}
                        className={`relative flex flex-col items-center justify-center h-10 rounded-xl text-xs font-bold transition
                          ${isFutureDay ? 'opacity-25 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-95'}
                          ${isToday ? 'ring-2 ring-brand-500 ring-offset-1' : ''}
                          ${cfg ? '' : 'border border-gray-100 bg-gray-50 text-gray-400'}
                        `}
                        style={cfg ? { background: cfg.bg.replace('bg-','').includes('emerald') ? '#dcfce7' : cfg.bg.includes('red') ? '#fee2e2' : cfg.bg.includes('amber') ? '#fef3c7' : '#f3f4f6', color: cfg.bg.includes('emerald') ? '#166534' : cfg.bg.includes('red') ? '#991b1b' : cfg.bg.includes('amber') ? '#92400e' : '#374151' } : {}}
                      >
                        <span className="text-[11px] font-black">{d}</span>
                        {cfg && <span className="text-[8px] font-bold">{cfg.label.slice(0,1)}</span>}
                      </button>
                    )
                  })}
                </div>
              ))}

              {/* Legend */}
              <div className="flex gap-2 flex-wrap mt-4 pt-4 border-t border-gray-100">
                {Object.entries(S).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-black text-white ${v.bg}`}>{v.icon}</span>
                    <span className="text-[10px] text-gray-500">{v.label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-gray-200 text-gray-300 text-[10px]">–</span>
                  <span className="text-[10px] text-gray-500">Not marked</span>
                </div>
              </div>

              {/* Monthly breakdown */}
              <div className="mt-4 bg-gray-50 rounded-2xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Monthly Summary</p>
                {[
                  { label: 'Present',  val: stats.Present, cls: 'text-emerald-600', bar: 'bg-emerald-500' },
                  { label: 'Absent',   val: stats.Absent,  cls: 'text-red-600',     bar: 'bg-red-500' },
                  { label: 'Late',     val: stats.Late,    cls: 'text-amber-600',   bar: 'bg-amber-400' },
                  { label: 'Leave',    val: stats.Leave,   cls: 'text-gray-500',    bar: 'bg-gray-300' },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-14">{row.label}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div className={`${row.bar} h-1.5 rounded-full transition-all`} style={{ width: stats.total > 0 ? `${Math.round(row.val/stats.total*100)}%` : '0%' }} />
                    </div>
                    <span className={`text-xs font-bold ${row.cls} w-5 text-right`}>{row.val}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Attendance Rate</span>
                  <span className={`text-sm font-black ${stats.pct >= 80 ? 'text-emerald-600' : stats.pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{stats.pct}%</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Export button */}
        <div className="px-5 py-4 border-t border-gray-100 bg-white">
          <button
            onClick={handleExportStudent}
            disabled={exporting}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition disabled:opacity-50"
          >
            <FileSpreadsheet size={15} />
            {exporting ? 'Exporting…' : `Export ${student.name.split(' ')[0]}'s Attendance`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────
export default function Attendance() {
  const { students, batches, showToast, selectedSport, selectedBranch: contextBranch } = useApp()
  const now           = new Date()
  const todayDay      = now.getDate()
  const todayMonth    = now.getMonth()
  const todayYear     = now.getFullYear()
  const todayDayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]

  const [year,           setYear]           = useState(todayYear)
  const [month,          setMonth]          = useState(todayMonth)
  const [selectedBranch, setSelectedBranch] = useState('All')
  const [selectedBatch,  setSelectedBatch]  = useState(null)
  const [mbStudentIds,   setMbStudentIds]   = useState(new Set())
  const [allEnrolments,  setAllEnrolments]  = useState({})
  const [monthData,      setMonthData]      = useState({})
  const [dirty,          setDirty]          = useState(new Set())
  const [saving,         setSaving]         = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [page,           setPage]           = useState(1)
  const [showExport,     setShowExport]     = useState(false)
  const [exportFrom,     setExportFrom]     = useState(`${todayYear}-${pad(todayMonth+1)}-01`)
  const [exportTo,       setExportTo]       = useState(`${todayYear}-${pad(todayMonth+1)}-${pad(daysInMonth(todayYear,todayMonth))}`)
  const [exporting,      setExporting]      = useState(false)
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [mobileDay,      setMobileDay]      = useState(todayDay)
  const batchTabsRef = useRef(null)

  const PAGE_SIZE      = 30
  const totalDays      = daysInMonth(year, month)
  const days           = useMemo(() => Array.from({ length: totalDays }, (_, i) => i + 1), [totalDays])
  const isCurrentMonth = year === todayYear && month === todayMonth
  const isFutureMonth  = year > todayYear || (year === todayYear && month > todayMonth)
  const isFuture       = useCallback((d) => isFutureMonth || (isCurrentMonth && d > todayDay), [isFutureMonth, isCurrentMonth, todayDay])

  // Memoized student lists to avoid recomputing on every render
  const activeStudents = useMemo(() => students.filter(s => s.status === 'Active'), [students])
  const studentsById   = useMemo(() => Object.fromEntries(students.map(s => [s.id, s])), [students])

  const displayed = useMemo(() => selectedBatch
    ? activeStudents.filter(s => s.batchId === selectedBatch.id || s.batch === selectedBatch.name || mbStudentIds.has(s.id))
    : activeStudents
  , [selectedBatch, activeStudents, mbStudentIds])

  const suspendedDisplayed = useMemo(() => selectedBatch
    ? students.filter(s => s.status === 'Suspended' && (s.batchId === selectedBatch.id || s.batch === selectedBatch.name || s.lastBatchName === selectedBatch.name))
    : students.filter(s => s.status === 'Suspended')
  , [selectedBatch, students])

  const totalPages        = Math.ceil(displayed.length / PAGE_SIZE)
  const paginatedStudents = useMemo(() => displayed.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE), [displayed, page])

  const loadMonth = useCallback(async () => {
    setLoading(true)
    try {
      let data
      if (selectedBatch) {
        const primaryIds = activeStudents
          .filter(s => s.batchId === selectedBatch.id || s.batch === selectedBatch.name)
          .map(s => s.id)
        const allIds = [...new Set([...primaryIds, ...Array.from(mbStudentIds)])]
        data = await fetchAttendanceForStudents(year, month, allIds)
      } else {
        data = await db.fetchAttendanceForMonth(year, month, null)
      }
      setMonthData(data)
      setDirty(new Set())
    } catch { showToast('Failed to load attendance', 'error') }
    finally { setLoading(false) }
  }, [year, month, selectedBatch?.id, mbStudentIds.size])

  useEffect(() => { loadMonth() }, [loadMonth])
  useEffect(() => { setSelectedBranch('All'); setSelectedBatch(null) }, [selectedSport, contextBranch])
  useEffect(() => { setPage(1) }, [selectedBatch?.id, selectedBranch, selectedSport])
  useEffect(() => {
    if (dirty.size === 0) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty.size])
  useEffect(() => {
    fetchAllBatchEnrolments().then(rows => {
      const map = {}
      rows.forEach(r => {
        if (!map[r.batch_id]) map[r.batch_id] = new Set()
        map[r.batch_id].add(r.student_id)
      })
      setAllEnrolments(map)
    }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!selectedBatch?.id) { setMbStudentIds(new Set()); return }
    fetchBatchEnrolments(selectedBatch.id)
      .then(rows => setMbStudentIds(new Set(rows.map(r => r.student_id))))
      .catch(() => setMbStudentIds(new Set()))
  }, [selectedBatch?.id])

  const getStatus = useCallback((sid, day) => monthData[sid]?.[day] || '', [monthData])

  const cycle = useCallback((sid, day) => {
    if (isFuture(day)) return
    const student = studentsById[sid]
    const isOffDay = isCurrentMonth && student?.trainingType === 'Alternate' && selectedBatch?.days?.length > 0 && !selectedBatch.days.includes(dayName(year, month, day))
    if (isOffDay && !monthData[sid]?.[day]) return
    const cur  = monthData[sid]?.[day] || ''
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length]
    setMonthData(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), [day]: next } }))
    setDirty(prev => new Set(prev).add(`${sid}-${day}`))
  }, [isFuture, studentsById, isCurrentMonth, selectedBatch, year, month, monthData])

  const markAll = useCallback((status, day) => {
    const d = day ?? (isCurrentMonth ? todayDay : 1)
    if (isFuture(d)) return
    const isOff = (s) => isCurrentMonth && s.trainingType === 'Alternate' && selectedBatch?.days?.length > 0 && !selectedBatch.days.includes(dayName(year, month, d))
    setMonthData(prev => {
      const next = { ...prev }
      displayed.forEach(s => {
        if (!isOff(s)) next[s.id] = { ...(next[s.id] || {}), [d]: status }
      })
      return next
    })
    setDirty(prev => {
      const nd = new Set(prev)
      displayed.forEach(s => { if (!isOff(s)) nd.add(`${s.id}-${d}`) })
      return nd
    })
  }, [isFuture, isCurrentMonth, todayDay, displayed, selectedBatch, year, month])

  const handleSave = async () => {
    if (dirty.size === 0) { showToast('No changes to save', 'info'); return }
    setSaving(true)
    try {
      const dirtyData = {}
      dirty.forEach(key => {
        const sepIdx = key.lastIndexOf('-')
        const sid = key.slice(0, sepIdx), day = key.slice(sepIdx+1)
        if (!dirtyData[sid]) dirtyData[sid] = {}
        dirtyData[sid][day] = monthData[sid]?.[day] ?? null
      })
      await db.saveAttendanceMonth(year, month, dirtyData, selectedBatch?.id ?? null)
      setDirty(new Set())
      showToast(`Attendance saved (${dirty.size} ${dirty.size===1?'change':'changes'})`)
    } catch (err) { showToast('Save failed: ' + (err?.message||'unknown error'), 'error') }
    finally { setSaving(false) }
  }

  const prevMonth = () => { if(month===0){setYear(y=>y-1);setMonth(11)}else setMonth(m=>m-1) }
  const nextMonth = () => {
    if (year===todayYear && month===todayMonth) return
    if(month===11){setYear(y=>y+1);setMonth(0)}else setMonth(m=>m+1)
  }

  const todayStats = useMemo(() => {
    const c = { Present:0, Absent:0, Late:0, Leave:0 }
    if (!isCurrentMonth) return c
    displayed.forEach(s => { const st = getStatus(s.id, todayDay); if(st) c[st]=(c[st]||0)+1 })
    return c
  }, [monthData, displayed, todayDay, isCurrentMonth, getStatus])

  const absentToday = useMemo(() =>
    isCurrentMonth ? displayed.filter(s => getStatus(s.id, todayDay) === 'Absent') : []
  , [monthData, displayed, todayDay, isCurrentMonth, getStatus])

  const monthlyStats = useMemo(() => {
    let present=0, absent=0, late=0, total=0
    displayed.forEach(s => days.forEach(d => {
      const st = getStatus(s.id, d)
      if(st){total++;if(st==='Present')present++;else if(st==='Absent')absent++;else if(st==='Late')late++}
    }))
    return { present, absent, late, total, avg: total>0?Math.round((present/total)*100):0 }
  }, [monthData, displayed, days, getStatus])

  const batchStats = useMemo(() => batches.map(b => {
    const mbIds = allEnrolments[b.id] || new Set()
    const allBs    = students.filter(s => s.batchId === b.id || s.batch === b.name || mbIds.has(s.id))
    const activeBs = allBs.filter(s => s.status === 'Active')
    const trainsToday = b.days?.length > 0 ? b.days.includes(todayDayShort) : true
    return { ...b, studentCount: allBs.length, activeCount: activeBs.length,
      presentToday: isCurrentMonth ? activeBs.filter(s => getStatus(s.id, todayDay)==='Present').length : 0, trainsToday }
  }), [batches, students, monthData, todayDay, isCurrentMonth, allEnrolments, todayDayShort, getStatus])

  const branchList = useMemo(() => {
    const set = new Set()
    batches.forEach(b => (b.sports||[]).forEach(sp => set.add(sp)))
    return ['All', ...Array.from(set).sort()]
  }, [batches])

  const visibleBatches = useMemo(() => {
    const filtered = selectedBranch === 'All' ? batchStats : batchStats.filter(b => (b.sports||[]).includes(selectedBranch))
    return [...filtered].sort((a,b) => (b.trainsToday?1:0) - (a.trainsToday?1:0))
  }, [batchStats, selectedBranch])

  const mobileDayStats = useMemo(() => {
    const c = { Present:0, Absent:0, Late:0, Leave:0 }
    displayed.forEach(s => { const st = getStatus(s.id, mobileDay); if(st) c[st]=(c[st]||0)+1 })
    return c
  }, [monthData, displayed, mobileDay, getStatus])

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance</h2>
          <p className="text-xs text-gray-400">{MONTH_NAMES[month]} {year}</p>
        </div>
        <button onClick={() => setShowExport(true)} className="btn-secondary text-xs whitespace-nowrap flex-shrink-0">
          <FileSpreadsheet size={14} /> Export Excel
        </button>
      </div>

      {/* ── Branch pills ─────────────────────────────────── */}
      {selectedSport === 'All' && (
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {branchList.map(br => (
            <button key={br} onClick={() => { setSelectedBranch(br); setSelectedBatch(null) }}
              className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                selectedBranch === br ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {br === 'All' ? 'All Branches' : br}
            </button>
          ))}
        </div>
      )}

      {/* ── Batch tabs (scrollable) ──────────────────────── */}
      <div className="relative">
        <div ref={batchTabsRef} className="flex gap-2 overflow-x-auto no-scrollbar pb-1" style={{ scrollBehavior: 'smooth' }}>
          {/* All pill */}
          <button onClick={() => setSelectedBatch(null)}
            className={`flex-shrink-0 flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-xl border transition ${
              !selectedBatch ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}>
            <span className="text-xs font-bold whitespace-nowrap">
              All {selectedSport !== 'All' ? selectedSport : selectedBranch !== 'All' ? selectedBranch : 'Batches'}
            </span>
            <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-full ${!selectedBatch ? 'bg-brand-200 text-brand-800' : 'bg-gray-100 text-gray-600'}`}>
              {selectedBranch === 'All' ? students.length : students.filter(s => visibleBatches.some(b => b.name === s.batch)).length}
            </span>
          </button>

          {visibleBatches.map(b => {
            const isActive = selectedBatch?.id === b.id
            const dimmed   = isCurrentMonth && !b.trainsToday
            const pct      = b.activeCount > 0 ? Math.round((b.presentToday/b.activeCount)*100) : null
            const pctColor = pct===null ? '' : pct>=80 ? 'text-emerald-600 bg-emerald-50' : pct>=60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
            return (
              <button key={b.id} onClick={() => setSelectedBatch(isActive ? null : b)}
                className={`flex-shrink-0 flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-xl border transition ${
                  isActive ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                } ${dimmed ? 'opacity-45' : ''}`}>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold whitespace-nowrap leading-tight">{b.name}</p>
                    {isCurrentMonth && b.trainsToday && <span className="text-[9px] font-black px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 leading-none">Today</span>}
                  </div>
                  <p className="text-[10px] text-gray-400 whitespace-nowrap leading-tight">{b.time}</p>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-full ${isActive ? 'bg-brand-200 text-brand-800' : 'bg-gray-100 text-gray-600'}`}>{b.studentCount}</span>
                  {isCurrentMonth && pct !== null && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pctColor}`}>{pct}%</span>}
                </div>
              </button>
            )
          })}
        </div>
        {/* Scroll hint arrows */}
        <button className="absolute right-0 top-0 h-full px-1.5 bg-gradient-to-l from-white via-white/90 to-transparent flex items-center"
          onClick={() => batchTabsRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}>
          <ChevronRight size={16} className="text-gray-400" />
        </button>
      </div>

      {/* ── No-train-today warning ────────────────────────── */}
      {isCurrentMonth && selectedBatch && !selectedBatch.trainsToday && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          <span>⚠</span>
          <span><strong>{selectedBatch.name}</strong> doesn't train today ({todayDayShort}){selectedBatch.days?.length > 0 && ` — trains on ${selectedBatch.days.join(', ')}`}</span>
        </div>
      )}

      {/* ── Month nav + bulk actions ──────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center bg-white border border-gray-100 rounded-xl px-3 py-2.5">
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={prevMonth} className="px-2.5 py-1.5 hover:bg-gray-50 transition"><ChevronLeft size={14} className="text-gray-600"/></button>
          <span className="px-3 text-sm font-bold text-gray-700 whitespace-nowrap">{MONTH_NAMES[month]} {year}</span>
          <button onClick={nextMonth} className="px-2.5 py-1.5 hover:bg-gray-50 transition"><ChevronRight size={14} className="text-gray-600"/></button>
        </div>
        {selectedBatch && <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2.5 py-1 rounded-lg border border-brand-200">{selectedBatch.name}</span>}
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={() => markAll('Present')} className="px-3 py-1.5 text-xs font-bold border-2 border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition">✓ All Present</button>
          <button onClick={() => markAll('Absent')}  className="px-3 py-1.5 text-xs font-bold border-2 border-red-400    text-red-600    rounded-lg hover:bg-red-50    transition">✗ All Absent</button>
          <button onClick={handleSave} disabled={saving || dirty.size===0} className="btn-primary text-xs py-1.5">
            {saving ? <span className="flex items-center gap-1"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Saving…</span>
                    : <><Save size={13}/> Save{dirty.size>0?` (${dirty.size})`:''}</>}
          </button>
        </div>
      </div>

      {/* ── Stats row ────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Present', value:todayStats.Present, bg:'bg-emerald-100', text:'text-emerald-700', ring:'ring-emerald-200' },
          { label:'Absent',  value:todayStats.Absent,  bg:'bg-red-100',     text:'text-red-700',     ring:'ring-red-200' },
          { label:'Late',    value:todayStats.Late,    bg:'bg-amber-100',   text:'text-amber-700',   ring:'ring-amber-200' },
          { label:'Total',   value:displayed.length + suspendedDisplayed.length, bg:'bg-brand-100', text:'text-brand-700', ring:'ring-brand-200' },
        ].map(s => (
          <div key={s.label} className="card p-3 flex items-center gap-3">
            <div className={`w-10 h-10 ${s.bg} ${s.text} rounded-full flex items-center justify-center text-lg font-black ring-2 ${s.ring} flex-shrink-0`}>{s.value}</div>
            <p className="text-sm font-semibold text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── MOBILE: Day picker + student list ─────────────── */}
      <div className="lg:hidden space-y-3">
        <div className="card p-3">
          <p className="text-xs font-semibold text-gray-500 mb-2 px-1">Select Day</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x">
            {days.map(d => {
              const isToday = isCurrentMonth && d === todayDay
              const isSunday = isSun(year, month, d)
              const marked = displayed.filter(s => getStatus(s.id, d)).length
              return (
                <button key={d} onClick={() => !isFuture(d) && setMobileDay(d)} disabled={isFuture(d)}
                  className={`flex-shrink-0 snap-start flex flex-col items-center w-12 py-2 rounded-xl transition font-semibold ${
                    isFuture(d) ? 'text-gray-300 cursor-not-allowed opacity-40'
                    : mobileDay===d ? 'bg-brand-600 text-white shadow-sm'
                    : isToday ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-300'
                    : isSunday ? 'text-red-400' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <span className="text-[10px] font-normal opacity-70">{dayName(year,month,d)}</span>
                  <span className="text-base leading-tight">{d}</span>
                  {marked > 0 && <span className={`text-[9px] mt-0.5 font-bold ${mobileDay===d?'text-brand-200':'text-brand-500'}`}>{marked}</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div className="card p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-800">{dayName(year,month,mobileDay)}, {mobileDay} {SHORT_MONTHS[month]}</p>
            {isCurrentMonth && mobileDay===todayDay && <span className="badge badge-blue text-[10px]">Today</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => markAll('Present', mobileDay)} className="px-2.5 py-1.5 text-xs font-bold border-2 border-emerald-500 text-emerald-600 rounded-lg">✓ All</button>
            <button onClick={() => markAll('Absent',  mobileDay)} className="px-2.5 py-1.5 text-xs font-bold border-2 border-red-400    text-red-600    rounded-lg">✗ All</button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {Object.entries(mobileDayStats).map(([k,v]) => (
            <div key={k} className="bg-white rounded-xl border border-gray-100 p-2 text-center">
              <p className={`text-lg font-black ${S[k]?.text}`}>{v}</p>
              <p className="text-[10px] text-gray-400">{k}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="card py-10 flex justify-center"><svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg></div>
        ) : (
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {displayed.length === 0 && <p className="text-center py-10 text-sm text-gray-400">No students in this batch</p>}
            {paginatedStudents.map((s, idx) => {
              const st = getStatus(s.id, mobileDay)
              const cfg = st ? S[st] : null
              const isOff = isCurrentMonth && s.trainingType==='Alternate' && selectedBatch?.days?.length>0 && !selectedBatch.days.includes(dayName(year,month,mobileDay))
              return (
                <button key={s.id} onClick={() => cycle(s.id, mobileDay)} disabled={isOff && !cfg}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 transition text-left ${isOff&&!cfg?'opacity-50 bg-gray-50/60':'active:bg-gray-50'}`}>
                  <span className="text-xs text-gray-400 w-5 flex-shrink-0 font-medium">{(page-1)*PAGE_SIZE+idx+1}</span>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedStudent(s) }} className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center text-sm font-bold text-brand-700 flex-shrink-0 hover:bg-brand-200 transition">{s.name[0]}</button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedStudent(s) }} className="font-semibold text-gray-900 text-sm truncate hover:text-brand-600 transition">{s.name}</button>
                      {s.trainingType==='Alternate' ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-600 leading-none flex-shrink-0">ALT</span>
                                                    : <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-brand-100 text-brand-600 leading-none flex-shrink-0">DAY</span>}
                    </div>
                    <p className="text-xs text-gray-400 truncate">{s.sport} · {s.batch}</p>
                  </div>
                  {isOff && !cfg ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-400">✕ Off day</span>
                  ) : cfg ? (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${cfg.light} ${cfg.text}`}><span>{cfg.icon}</span> {cfg.label}</span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 text-gray-400">— Mark</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {totalPages > 1 && <MobilePaginator page={page} totalPages={totalPages} onChange={setPage} displayed={displayed} pageSize={PAGE_SIZE} />}
      </div>

      {/* ── DESKTOP: Full monthly grid ────────────────────── */}
      <div className="hidden lg:block card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2">
            <svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            <span className="text-sm text-gray-400">Loading…</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
              <table className="text-xs border-collapse" style={{ minWidth: `${totalDays * 28 + 220}px` }}>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="sticky left-0 bg-gray-50 z-20 text-center px-2 py-3 font-semibold text-gray-400 w-8 border-r border-gray-100">#</th>
                    <th className="sticky left-8 bg-gray-50 z-20 text-left px-3 py-3 font-semibold text-gray-500 w-44 border-r border-gray-100 whitespace-nowrap">
                      Student <span className="text-gray-300 font-normal ml-1 text-[10px]">({displayed.length})</span>
                    </th>
                    {days.map(d => {
                      const dn = dayName(year, month, d)
                      const isBatchDay = !selectedBatch?.days?.length || selectedBatch.days.includes(dn)
                      return (
                        <th key={d} className={`py-2 w-7 text-center font-medium
                          ${isSun(year,month,d) ? 'text-red-400 bg-red-50/60' : isBatchDay ? 'text-gray-500' : 'text-gray-300 bg-gray-50/80'}
                          ${isCurrentMonth && d===todayDay ? '!bg-brand-50 !text-brand-700' : ''}`}>
                          <div className="font-bold">{d}</div>
                          <div className="text-[9px] opacity-70">{dn}</div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayed.length === 0 && (
                    <tr><td colSpan={totalDays+2} className="text-center py-12 text-gray-400 text-sm">No students in this batch</td></tr>
                  )}
                  {paginatedStudents.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-gray-50/50 group transition">
                      <td className="sticky left-0 bg-white group-hover:bg-gray-50/50 z-10 text-center px-2 py-2 text-gray-400 border-r border-gray-100 font-medium">{(page-1)*PAGE_SIZE+idx+1}</td>
                      <td className="sticky left-8 bg-white group-hover:bg-gray-50/50 z-10 px-3 py-2 border-r border-gray-100">
                        <button onClick={() => setSelectedStudent(s)} className="flex items-center gap-2 text-left hover:text-brand-600 transition group/name">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${s.trainingType==='Alternate'?'bg-violet-100 text-violet-700':'bg-brand-100 text-brand-700'}`}>{s.name[0]}</div>
                          <span className="font-semibold text-gray-900 whitespace-nowrap group-hover/name:text-brand-600">{s.name}</span>
                          {s.trainingType==='Alternate'
                            ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-600 leading-none flex-shrink-0">ALT</span>
                            : <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-brand-100 text-brand-600 leading-none flex-shrink-0">DAY</span>}
                          <User size={10} className="text-gray-300 group-hover/name:text-brand-400 flex-shrink-0" />
                        </button>
                      </td>
                      {days.map(d => {
                        const st     = getStatus(s.id, d)
                        const cfg    = st ? S[st] : null
                        const isOff  = isCurrentMonth && s.trainingType==='Alternate' && selectedBatch?.days?.length>0 && !selectedBatch.days.includes(dayName(year,month,d))
                        const future = isFuture(d)
                        const locked = future || (isOff && !cfg)
                        return (
                          <td key={d} onClick={() => cycle(s.id, d)}
                            className={`py-2 text-center select-none transition
                              ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}
                              ${future ? 'opacity-30' : ''}
                              ${isOff ? 'bg-gray-100/70' : ''}
                              ${isCurrentMonth && d===todayDay ? '!bg-brand-50/60' : ''}
                              ${isSun(year,month,d) ? 'bg-red-50/30' : ''}`}
                            title={isOff?`${s.name} — off day`:future?'Future date':`${s.name} — ${dayName(year,month,d)} ${d} — ${st||'Not marked'}`}
                          >
                            {isOff && !cfg ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-300 text-[12px] font-bold">✕</span>
                            ) : cfg ? (
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white ${cfg.bg} ${!locked&&'hover:opacity-80'} transition`}>{cfg.icon}</span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-200 text-gray-300 hover:border-gray-300 transition">–</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {suspendedDisplayed.map(s => (
                    <tr key={`susp-${s.id}`} className="bg-red-50/30 opacity-50">
                      <td className="sticky left-0 bg-red-50/30 z-10 text-center px-2 py-2 text-gray-300 border-r border-gray-100">—</td>
                      <td className="sticky left-8 bg-red-50/30 z-10 px-3 py-2 border-r border-gray-100">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center text-[10px] font-bold text-red-400 flex-shrink-0">{s.name[0]}</div>
                          <span className="font-semibold text-gray-500 whitespace-nowrap text-xs">{s.name}</span>
                          <span className="text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">Suspended</span>
                        </div>
                      </td>
                      {days.map(d => <td key={d} className="py-2 text-center text-gray-200 text-[10px]">—</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination bar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
              <span className="text-xs text-gray-400">
                {displayed.length === 0 ? 'No students' : `${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,displayed.length)} of ${displayed.length} students`}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={page===1}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition"><ChevronLeft size={13}/></button>
                  {Array.from({length:totalPages},(_,i)=>i+1).filter(n=>n===1||n===totalPages||Math.abs(n-page)<=1).map((n,i,arr)=> {
                    const prev = arr[i-1]
                    return [
                      prev && n-prev>1 ? <span key={`e${n}`} className="text-xs text-gray-400 px-1">…</span> : null,
                      <button key={n} onClick={() => setPage(n)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold transition ${n===page?'bg-brand-600 text-white':'border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>{n}</button>
                    ]
                  })}
                  <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition"><ChevronRight size={13}/></button>
                </div>
              )}
              {totalPages <= 1 && <span className="text-xs text-gray-400 italic">Click any cell to cycle · click name to view profile</span>}
            </div>
          </>
        )}
      </div>

      {/* ── Bottom panels ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Today's Summary</h3>
          <div className="space-y-3">
            {[{label:'Present',value:todayStats.Present,color:'text-emerald-600',dot:'bg-emerald-500'},
              {label:'Absent', value:todayStats.Absent, color:'text-red-600',     dot:'bg-red-500'},
              {label:'Late',   value:todayStats.Late,   color:'text-amber-600',   dot:'bg-amber-400'},
              {label:'Leave',  value:todayStats.Leave||0,color:'text-gray-500',   dot:'bg-gray-300'},
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5"><div className={`w-2.5 h-2.5 rounded-full ${r.dot}`}/><span className="text-sm text-gray-600">{r.label}</span></div>
                <span className={`text-sm font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Absent Today</h3>
          {absentToday.length === 0 ? (
            <div className="text-center py-6"><p className="text-2xl mb-1">🎉</p><p className="text-xs text-gray-400">No absences today</p></div>
          ) : (
            <div className="space-y-2.5 max-h-36 overflow-y-auto">
              {absentToday.map(s => (
                <button key={s.id} onClick={() => setSelectedStudent(s)} className="flex items-center gap-2.5 w-full text-left hover:bg-gray-50 rounded-lg px-1 py-0.5 transition">
                  <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">{s.name[0]}</div>
                  <div><p className="text-xs font-semibold text-gray-800">{s.name}</p><p className="text-[10px] text-gray-400">{s.sport} · {s.batch}</p></div>
                </button>
              ))}
            </div>
          )}
          {absentToday.length > 0 && (
            <button className="w-full mt-3 bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2">
              <MessageCircle size={13}/> Send WhatsApp Reminder
            </button>
          )}
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Monthly Overview</h3>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={90} height={90}>
                <PieChart>
                  <Pie data={[{value:monthlyStats.present||1},{value:Math.max(monthlyStats.absent+monthlyStats.late,0)}]}
                    cx="50%" cy="50%" innerRadius={25} outerRadius={42} startAngle={90} endAngle={-270} dataKey="value" paddingAngle={2} stroke="none">
                    <Cell fill="#10b981"/><Cell fill="#f3f4f6"/>
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center"><p className="text-sm font-black text-gray-900">{monthlyStats.avg}%</p><p className="text-[9px] text-gray-400">Avg</p></div>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {[{label:'Present',value:monthlyStats.present,color:'text-emerald-600'},
                {label:'Absent', value:monthlyStats.absent, color:'text-red-600'},
                {label:'Late',   value:monthlyStats.late,   color:'text-amber-600'},
                {label:'Total',  value:monthlyStats.total,  color:'text-gray-700'},
              ].map(r => (
                <div key={r.label} className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">{r.label}</span>
                  <span className={`text-xs font-bold ${r.color}`}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Export Modal ───────────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowExport(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center"><FileSpreadsheet size={18} className="text-emerald-600"/></div>
                <div><h3 className="font-bold text-gray-900 text-sm">Export Attendance</h3><p className="text-xs text-gray-400">Color-coded professional Excel</p></div>
              </div>
              <button onClick={() => setShowExport(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16} className="text-gray-500"/></button>
            </div>
            <div className="space-y-4">
              <div><label className="label">From Date</label><input type="date" className="input" value={exportFrom} max={exportTo} onChange={e => setExportFrom(e.target.value)}/></div>
              <div><label className="label">To Date</label><input type="date" className="input" value={exportTo} min={exportFrom} onChange={e => setExportTo(e.target.value)}/></div>
              <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                <p className="text-xs text-gray-500">Batch: <strong>{selectedBatch?.name || 'All batches'}</strong></p>
                <p className="text-xs text-gray-500">Students: <strong>{displayed.length}</strong></p>
                <p className="text-[10px] text-emerald-600 font-semibold">✓ Color-coded cells · 2 sheets · Frozen headers</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setShowExport(false)}>Cancel</button>
              <button className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition disabled:opacity-50"
                onClick={async () => { setExporting(true); await exportToExcel({students:displayed,batchName:selectedBatch?.name,fromDate:exportFrom,toDate:exportTo,showToast}); setExporting(false); setShowExport(false) }}
                disabled={exporting}>
                {exporting ? <span className="flex items-center gap-1.5"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Exporting…</span>
                           : <><FileSpreadsheet size={14}/> Export .xlsx</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Student Profile Panel ─────────────────────────── */}
      {selectedStudent && (
        <StudentAttendancePanel
          student={selectedStudent}
          allMonthData={monthData}
          onClose={() => setSelectedStudent(null)}
          onCycle={(sid, day) => {
            cycle(sid, day)
            if (!isCurrentMonth) return
            setMonthData(prev => ({ ...prev }))
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function MobilePaginator({ page, totalPages, onChange, displayed, pageSize }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 card">
      <span className="text-xs text-gray-400">{(page-1)*pageSize+1}–{Math.min(page*pageSize,displayed.length)} of {displayed.length}</span>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onChange(p=>Math.max(1,p-1))} disabled={page===1}
          className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 disabled:opacity-30"><ChevronLeft size={14}/></button>
        <span className="text-xs font-bold text-gray-700 px-2">{page}/{totalPages}</span>
        <button onClick={() => onChange(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
          className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 disabled:opacity-30"><ChevronRight size={14}/></button>
      </div>
    </div>
  )
}
