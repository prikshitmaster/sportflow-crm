import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { Save, ChevronLeft, ChevronRight, Download, MessageCircle, X, FileSpreadsheet } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import * as db from '../lib/db'
import * as XLSX from 'xlsx'

const STATUS_CYCLE = ['Present', 'Absent', 'Late', 'Leave']
const S = {
  Present: { icon: '✓', bg: 'bg-emerald-500', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  Absent:  { icon: '✗', bg: 'bg-red-500',     text: 'text-red-600',     dot: 'bg-red-500' },
  Late:    { icon: '⏱', bg: 'bg-amber-400',   text: 'text-amber-600',   dot: 'bg-amber-400' },
  Leave:   { icon: '○', bg: 'bg-gray-300',    text: 'text-gray-500',    dot: 'bg-gray-300' },
}

const pad  = n => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const dayName     = (y, m, d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y, m, d).getDay()]
const isSun       = (y, m, d) => new Date(y, m, d).getDay() === 0
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ── Excel export helper ────────────────────────────────────
async function exportToExcel({ students, fromDate, toDate, showToast }) {
  try {
    const from = new Date(fromDate)
    const to   = new Date(toDate)
    if (from > to) { showToast('From date must be before To date', 'error'); return }

    // Build date list between from and to
    const dateList = []
    const cur = new Date(from)
    while (cur <= to) {
      dateList.push(new Date(cur))
      cur.setDate(cur.getDate() + 1)
    }

    // Fetch attendance for each month in range
    const monthsNeeded = new Set()
    dateList.forEach(d => monthsNeeded.add(`${d.getFullYear()}-${d.getMonth()}`))

    const allData = {}
    for (const key of monthsNeeded) {
      const [y, m] = key.split('-').map(Number)
      const monthData = await db.fetchAttendanceForMonth(y, m)
      for (const [sid, days] of Object.entries(monthData)) {
        if (!allData[sid]) allData[sid] = {}
        for (const [day, status] of Object.entries(days)) {
          const dateKey = `${y}-${pad(m + 1)}-${pad(Number(day))}`
          allData[sid][dateKey] = status
        }
      }
    }

    // Build sheet rows
    const headers = ['#', 'Student Name', 'Sport', 'Batch',
      ...dateList.map(d => `${d.getDate()} ${dayName(d.getFullYear(), d.getMonth(), d.getDate())} ${pad(d.getMonth()+1)}/${d.getFullYear()}`),
      'Present', 'Absent', 'Late', 'Leave', 'Attendance %',
    ]

    const rows = students.map((s, idx) => {
      const statuses = dateList.map(d => {
        const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
        return allData[s.id]?.[key] || ''
      })
      const present = statuses.filter(x => x === 'Present').length
      const absent  = statuses.filter(x => x === 'Absent').length
      const late    = statuses.filter(x => x === 'Late').length
      const leave   = statuses.filter(x => x === 'Leave').length
      const total   = statuses.filter(x => x).length
      const pct     = total > 0 ? Math.round((present / total) * 100) : ''
      return [idx + 1, s.name, s.sport, s.batch, ...statuses, present, absent, late, leave, pct ? `${pct}%` : '']
    })

    const wsData = [headers, ...rows]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Column widths
    ws['!cols'] = [
      { wch: 4 }, { wch: 22 }, { wch: 14 }, { wch: 12 },
      ...dateList.map(() => ({ wch: 12 })),
      { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 12 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `Attendance_${fromDate}_to_${toDate}.xlsx`)
    showToast('Excel exported successfully')
  } catch (err) {
    console.error(err)
    showToast('Export failed', 'error')
  }
}

// ── Main component ─────────────────────────────────────────
export default function Attendance() {
  const { students, batches, showToast } = useApp()
  const now        = new Date()
  const todayDay   = now.getDate()
  const todayMonth = now.getMonth()
  const todayYear  = now.getFullYear()

  const [year,          setYear]         = useState(todayYear)
  const [month,         setMonth]        = useState(todayMonth)
  const [selectedBatch, setSelectedBatch]= useState(null) // null = All
  const [monthData,     setMonthData]    = useState({})
  const [saving,        setSaving]       = useState(false)
  const [loading,       setLoading]      = useState(false)
  const [showExport,    setShowExport]   = useState(false)
  const [exportFrom,    setExportFrom]   = useState(`${todayYear}-${pad(todayMonth+1)}-01`)
  const [exportTo,      setExportTo]     = useState(`${todayYear}-${pad(todayMonth+1)}-${pad(daysInMonth(todayYear, todayMonth))}`)
  const [exporting,     setExporting]    = useState(false)

  const totalDays      = daysInMonth(year, month)
  const days           = Array.from({ length: totalDays }, (_, i) => i + 1)
  const isCurrentMonth = year === todayYear && month === todayMonth

  const activeStudents = students.filter(s => s.status === 'Active')
  const displayed      = selectedBatch
    ? activeStudents.filter(s => s.batch === selectedBatch)
    : activeStudents

  // Load month data
  const loadMonth = useCallback(async () => {
    setLoading(true)
    try {
      setMonthData(await db.fetchAttendanceForMonth(year, month))
    } catch {
      showToast('Failed to load attendance', 'error')
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadMonth() }, [loadMonth])

  const getStatus = (sid, day) => monthData[sid]?.[day] || ''

  const handleCell = (sid, day) => {
    const cur  = getStatus(sid, day)
    const idx  = STATUS_CYCLE.indexOf(cur)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    setMonthData(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), [day]: next } }))
  }

  const markAll = (status) => {
    const day = isCurrentMonth ? todayDay : 1
    setMonthData(prev => {
      const next = { ...prev }
      displayed.forEach(s => { next[s.id] = { ...(next[s.id] || {}), [day]: status } })
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try { await db.saveAttendanceMonth(year, month, monthData); showToast('Attendance saved') }
    catch { showToast('Save failed', 'error') }
    finally { setSaving(false) }
  }

  const prevMonth = () => { if (month===0) { setYear(y=>y-1); setMonth(11) } else setMonth(m=>m-1) }
  const nextMonth = () => { if (month===11) { setYear(y=>y+1); setMonth(0) } else setMonth(m=>m+1) }

  const todayStats = useMemo(() => {
    const c = { Present:0, Absent:0, Late:0, Leave:0 }
    if (!isCurrentMonth) return c
    displayed.forEach(s => { const st = getStatus(s.id, todayDay); if (st) c[st] = (c[st]||0)+1 })
    return c
  }, [monthData, displayed, todayDay, isCurrentMonth])

  const absentToday = useMemo(() =>
    isCurrentMonth ? displayed.filter(s => getStatus(s.id, todayDay) === 'Absent') : []
  , [monthData, displayed, todayDay, isCurrentMonth])

  const monthlyStats = useMemo(() => {
    let present=0, absent=0, late=0, total=0
    displayed.forEach(s => {
      days.forEach(d => {
        const st = getStatus(s.id, d)
        if (st) { total++; if(st==='Present') present++; else if(st==='Absent') absent++; else if(st==='Late') late++ }
      })
    })
    return { present, absent, late, total, avg: total>0 ? Math.round((present/total)*100) : 0 }
  }, [monthData, displayed, days])

  const handleExcelExport = async () => {
    setExporting(true)
    await exportToExcel({ students: displayed, fromDate: exportFrom, toDate: exportTo, showToast })
    setExporting(false)
    setShowExport(false)
  }

  // Batch stats for cards
  const batchStats = useMemo(() => {
    return batches.map(b => {
      const bStudents = activeStudents.filter(s => s.batch === b.name)
      const presentCount = isCurrentMonth
        ? bStudents.filter(s => getStatus(s.id, todayDay) === 'Present').length
        : 0
      return { ...b, studentCount: bStudents.length, presentToday: presentCount }
    })
  }, [batches, activeStudents, monthData, todayDay, isCurrentMonth])

  return (
    <div className="space-y-4 max-w-[1400px]">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance</h2>
          <p className="text-xs text-gray-400">Dashboard › Attendance</p>
        </div>
        <button
          onClick={() => setShowExport(true)}
          className="btn-secondary text-xs"
        >
          <FileSpreadsheet size={14} /> Export Excel
        </button>
      </div>

      {/* ── Batch Cards ─────────────────────────────────────── */}
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        {/* All card */}
        <button
          onClick={() => setSelectedBatch(null)}
          className={`flex-shrink-0 rounded-2xl border-2 p-4 text-left transition min-w-[150px] ${
            !selectedBatch
              ? 'border-brand-600 bg-brand-50'
              : 'border-gray-100 bg-white hover:border-brand-200'
          }`}
        >
          <p className={`text-sm font-bold ${!selectedBatch ? 'text-brand-700' : 'text-gray-900'}`}>All Batches</p>
          <p className="text-xs text-gray-400 mt-0.5">All time slots</p>
          <p className={`text-xl font-black mt-2 ${!selectedBatch ? 'text-brand-600' : 'text-gray-700'}`}>{activeStudents.length}</p>
          <p className="text-[10px] text-gray-400">students</p>
        </button>

        {batchStats.map(b => {
          const isActive = selectedBatch === b.name
          const pct = b.studentCount > 0 ? Math.round((b.presentToday / b.studentCount) * 100) : 0
          return (
            <button
              key={b.id}
              onClick={() => setSelectedBatch(isActive ? null : b.name)}
              className={`flex-shrink-0 rounded-2xl border-2 p-4 text-left transition min-w-[180px] ${
                isActive
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-gray-100 bg-white hover:border-brand-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-bold leading-tight ${isActive ? 'text-brand-700' : 'text-gray-900'}`}>{b.name}</p>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                  b.enrolled >= b.capacity ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'
                }`}>
                  {b.enrolled}/{b.capacity}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-tight">{b.time}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(b.sports || []).slice(0, 2).map(sp => (
                  <span key={sp} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{sp}</span>
                ))}
              </div>
              <div className="flex items-end justify-between mt-2">
                <div>
                  <p className={`text-xs font-bold ${isActive ? 'text-brand-600' : 'text-gray-600'}`}>{b.coach}</p>
                  <p className="text-[10px] text-gray-400">Coach</p>
                </div>
                {isCurrentMonth && (
                  <div className="text-right">
                    <p className={`text-sm font-black ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</p>
                    <p className="text-[10px] text-gray-400">today</p>
                  </div>
                )}
              </div>
              {/* Capacity bar */}
              <div className="mt-2 w-full bg-gray-100 rounded-full h-1">
                <div
                  className={`h-1 rounded-full ${b.enrolled >= b.capacity ? 'bg-red-400' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min((b.enrolled / b.capacity) * 100, 100)}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="card p-3 md:p-4 flex flex-wrap gap-3 items-center">
        {/* Month nav */}
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={prevMonth} className="px-2.5 py-2 hover:bg-gray-50 transition">
            <ChevronLeft size={15} className="text-gray-600" />
          </button>
          <span className="px-3 text-sm font-semibold text-gray-700 whitespace-nowrap">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} className="px-2.5 py-2 hover:bg-gray-50 transition">
            <ChevronRight size={15} className="text-gray-600" />
          </button>
        </div>

        {selectedBatch && (
          <span className="badge badge-blue">{selectedBatch}</span>
        )}

        <div className="flex gap-2 ml-auto flex-wrap">
          <button
            onClick={() => markAll('Present')}
            className="px-3 py-2 text-xs font-semibold border-2 border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition"
          >
            ✓ All Present
          </button>
          <button
            onClick={() => markAll('Absent')}
            className="px-3 py-2 text-xs font-semibold border-2 border-red-400 text-red-600 rounded-lg hover:bg-red-50 transition"
          >
            ✗ All Absent
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
            {saving
              ? <span className="flex items-center gap-1"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Saving...</span>
              : <><Save size={13} /> Save</>
            }
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: todayStats.Present, ring: 'ring-emerald-200', bg: 'bg-emerald-100', text: 'text-emerald-700' },
          { label: 'Absent',  value: todayStats.Absent,  ring: 'ring-red-200',     bg: 'bg-red-100',     text: 'text-red-700' },
          { label: 'Late',    value: todayStats.Late,    ring: 'ring-amber-200',   bg: 'bg-amber-100',   text: 'text-amber-700' },
          { label: 'Total',   value: displayed.length,  ring: 'ring-brand-200',   bg: 'bg-brand-100',   text: 'text-brand-700' },
        ].map(s => (
          <div key={s.label} className="card p-3 md:p-4 flex items-center gap-3">
            <div className={`w-10 h-10 md:w-12 md:h-12 ${s.bg} ${s.text} rounded-full flex items-center justify-center text-lg md:text-xl font-black ring-2 ${s.ring} flex-shrink-0`}>
              {s.value}
            </div>
            <p className="text-xs md:text-sm font-semibold text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Monthly Calendar Grid */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2">
            <svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-sm text-gray-400">Loading...</span>
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="text-xs border-collapse" style={{ minWidth: `${totalDays * 36 + 220}px` }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="sticky left-0 bg-gray-50 z-20 text-center px-2 py-3 font-semibold text-gray-400 w-8 border-r border-gray-100">#</th>
                  <th className="sticky left-8 bg-gray-50 z-20 text-left px-3 py-3 font-semibold text-gray-500 w-32 md:w-40 border-r border-gray-100 whitespace-nowrap">Student</th>
                  {days.map(d => (
                    <th key={d} className={`py-2 w-9 text-center font-medium
                      ${isSun(year, month, d) ? 'text-red-400 bg-red-50/60' : 'text-gray-500'}
                      ${isCurrentMonth && d === todayDay ? 'bg-brand-50 text-brand-700' : ''}
                    `}>
                      <div className="font-bold">{d}</div>
                      <div className="text-[9px] opacity-70">{dayName(year, month, d)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.length === 0 && (
                  <tr><td colSpan={totalDays + 2} className="text-center py-12 text-gray-400 text-sm">No students in this batch</td></tr>
                )}
                {displayed.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 group transition">
                    <td className="sticky left-0 bg-white group-hover:bg-gray-50/50 z-10 text-center px-2 py-2.5 text-gray-400 border-r border-gray-100 font-medium">{idx+1}</td>
                    <td className="sticky left-8 bg-white group-hover:bg-gray-50/50 z-10 px-3 py-2.5 border-r border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center text-[10px] font-bold text-brand-700 flex-shrink-0">{s.name[0]}</div>
                        <span className="font-semibold text-gray-900 whitespace-nowrap">{s.name}</span>
                      </div>
                    </td>
                    {days.map(d => {
                      const st  = getStatus(s.id, d)
                      const cfg = st ? S[st] : null
                      return (
                        <td
                          key={d}
                          onClick={() => handleCell(s.id, d)}
                          className={`py-2 text-center cursor-pointer select-none transition
                            ${isCurrentMonth && d === todayDay ? 'bg-brand-50/60' : ''}
                            ${isSun(year, month, d) ? 'bg-red-50/30' : ''}
                          `}
                          title={`${s.name} — ${dayName(year,month,d)} ${d} — ${st||'Not marked'}`}
                        >
                          {cfg ? (
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white ${cfg.bg} hover:opacity-80 transition`}>
                              {cfg.icon}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-200 text-gray-300 hover:border-gray-300 transition">–</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-4 bg-gray-50/50">
          {Object.entries(S).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${v.bg}`}>{v.icon}</span>
              <span className="text-xs text-gray-500">{k}</span>
            </div>
          ))}
          <span className="text-xs text-gray-400 ml-auto italic hidden md:block">Click any cell to update</span>
        </div>
      </div>

      {/* Bottom 3 panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Today's Summary */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">
            Today's Summary ({now.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})})
          </h3>
          <div className="space-y-3">
            {[
              { label:'Present', value:todayStats.Present, color:'text-emerald-600', dot:'bg-emerald-500' },
              { label:'Absent',  value:todayStats.Absent,  color:'text-red-600',     dot:'bg-red-500' },
              { label:'Late',    value:todayStats.Late,    color:'text-amber-600',   dot:'bg-amber-400' },
              { label:'Leave',   value:todayStats.Leave||0,color:'text-gray-500',    dot:'bg-gray-300' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${r.dot}`}></div>
                  <span className="text-sm text-gray-600">{r.label}</span>
                </div>
                <span className={`text-sm font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Absent Students */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Absent Students Today</h3>
          {absentToday.length === 0 ? (
            <div className="text-center py-6"><p className="text-2xl mb-1">🎉</p><p className="text-xs text-gray-400">No absences today</p></div>
          ) : (
            <div className="space-y-2.5 mb-4 max-h-36 overflow-y-auto">
              {absentToday.map(s => (
                <div key={s.id} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">{s.name[0]}</div>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{s.name}</p>
                    <p className="text-[10px] text-gray-400">{s.sport} · {s.batch}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {absentToday.length > 0 && (
            <button className="w-full mt-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2">
              <MessageCircle size={13} /> Send WhatsApp Reminder
            </button>
          )}
        </div>

        {/* Monthly Overview */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Attendance Overview</h3>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={[{ value: monthlyStats.present||1 }, { value: Math.max(monthlyStats.absent+monthlyStats.late,0) }]}
                    cx="50%" cy="50%" innerRadius={30} outerRadius={46}
                    startAngle={90} endAngle={-270} dataKey="value" paddingAngle={2} stroke="none"
                  >
                    <Cell fill="#10b981" /><Cell fill="#f3f4f6" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-sm font-black text-gray-900">{monthlyStats.avg}%</p>
                  <p className="text-[9px] text-gray-400 leading-tight">Avg</p>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2.5">
              {[
                { label:'Present Days', value:monthlyStats.present, color:'text-emerald-600' },
                { label:'Absent Days',  value:monthlyStats.absent,  color:'text-red-600' },
                { label:'Late Days',    value:monthlyStats.late,    color:'text-amber-600' },
                { label:'Total Marked', value:monthlyStats.total,   color:'text-gray-700' },
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

      {/* ── Export Excel Modal ───────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowExport(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <FileSpreadsheet size={18} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm">Export Attendance</h3>
                  <p className="text-xs text-gray-400">Select date range</p>
                </div>
              </div>
              <button onClick={() => setShowExport(false)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">From Date</label>
                <input
                  type="date"
                  className="input"
                  value={exportFrom}
                  max={exportTo}
                  onChange={e => setExportFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label">To Date</label>
                <input
                  type="date"
                  className="input"
                  value={exportTo}
                  min={exportFrom}
                  onChange={e => setExportTo(e.target.value)}
                />
              </div>

              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">
                  Exports: <strong>{selectedBatch || 'All batches'}</strong> · {displayed.length} students
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  File will include Present / Absent / Late / Leave per day + summary
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setShowExport(false)}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1 justify-center bg-emerald-600 hover:bg-emerald-700"
                onClick={handleExcelExport}
                disabled={exporting}
              >
                {exporting
                  ? <span className="flex items-center gap-1.5"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Exporting...</span>
                  : <><FileSpreadsheet size={14} /> Export .xlsx</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
