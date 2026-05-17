import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import {
  Save, ChevronLeft, ChevronRight, Download, MessageCircle,
  X, FileSpreadsheet, Calendar, List,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import * as db from '../lib/db'
import { fetchBatchEnrolments, fetchAllBatchEnrolments } from '../lib/db'
import * as XLSX from 'xlsx'

const STATUS_CYCLE = ['Present', 'Absent', 'Late', 'Leave']
const S = {
  Present: { icon: '✓', bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50 border-emerald-200', label: 'Present' },
  Absent:  { icon: '✗', bg: 'bg-red-500',     text: 'text-red-600',     light: 'bg-red-50 border-red-200',         label: 'Absent' },
  Late:    { icon: '⏱', bg: 'bg-amber-400',   text: 'text-amber-600',   light: 'bg-amber-50 border-amber-200',     label: 'Late' },
  Leave:   { icon: '○', bg: 'bg-gray-300',    text: 'text-gray-500',    light: 'bg-gray-50 border-gray-200',       label: 'Leave' },
}

const pad          = n  => String(n).padStart(2, '0')
const daysInMonth  = (y, m) => new Date(y, m + 1, 0).getDate()
const dayName      = (y, m, d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y, m, d).getDay()]
const isSun        = (y, m, d) => new Date(y, m, d).getDay() === 0
const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

async function exportToExcel({ students, fromDate, toDate, showToast }) {
  try {
    const from = new Date(fromDate), to = new Date(toDate)
    if (from > to) { showToast('From date must be before To date', 'error'); return }
    const dateList = []
    const cur = new Date(from)
    while (cur <= to) { dateList.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }

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
    const headers = ['#', 'Student', 'Sport', 'Batch',
      ...dateList.map(d => `${d.getDate()} ${dayName(d.getFullYear(),d.getMonth(),d.getDate())}`),
      'Present','Absent','Late','Leave','Att%']
    const rows = students.map((s, i) => {
      const statuses = dateList.map(d => allData[s.id]?.[`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`] || '')
      const pr = statuses.filter(x=>x==='Present').length
      const ab = statuses.filter(x=>x==='Absent').length
      const la = statuses.filter(x=>x==='Late').length
      const lv = statuses.filter(x=>x==='Leave').length
      const tot = statuses.filter(x=>x).length
      return [i+1, s.name, s.sport, s.batch, ...statuses, pr, ab, la, lv, tot>0?`${Math.round((pr/tot)*100)}%`:'']
    })
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{wch:4},{wch:22},{wch:14},{wch:12},...dateList.map(()=>({wch:8})),{wch:8},{wch:8},{wch:8},{wch:8},{wch:8}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance')
    XLSX.writeFile(wb, `Attendance_${fromDate}_to_${toDate}.xlsx`)
    showToast('Excel exported')
  } catch (err) { console.error(err); showToast('Export failed', 'error') }
}

export default function Attendance() {
  const { students, batches, showToast, selectedSport } = useApp()
  const now           = new Date()
  const todayDay      = now.getDate()
  const todayMonth    = now.getMonth()
  const todayYear     = now.getFullYear()
  const todayDayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]

  const [year,           setYear]           = useState(todayYear)
  const [month,          setMonth]          = useState(todayMonth)
  const [selectedBranch, setSelectedBranch] = useState('All')
  const [selectedBatch,  setSelectedBatch]  = useState(null)  // batch object
  const [mbStudentIds,   setMbStudentIds]   = useState(new Set())
  const [allEnrolments,  setAllEnrolments]  = useState({}) // { batchId: Set<studentId> }
  const [monthData,     setMonthData]     = useState({})
  // Dirty cells the current user has actually touched this session — keys are `${sid}-${day}`.
  // Save only sends these to the DB, so two tabs editing different days of the same batch
  // don't overwrite each other's untouched cells.
  const [dirty,         setDirty]         = useState(new Set())
  const [saving,        setSaving]        = useState(false)
  const [loading,       setLoading]       = useState(false)
  const [showExport,    setShowExport]    = useState(false)
  const [exportFrom,    setExportFrom]    = useState(`${todayYear}-${pad(todayMonth+1)}-01`)
  const [exportTo,      setExportTo]      = useState(`${todayYear}-${pad(todayMonth+1)}-${pad(daysInMonth(todayYear, todayMonth))}`)
  const [exporting,     setExporting]     = useState(false)
  // Mobile: which day is selected in day-view
  const [mobileDay,     setMobileDay]     = useState(todayDay)

  const totalDays      = daysInMonth(year, month)
  const days           = Array.from({ length: totalDays }, (_, i) => i + 1)
  const isCurrentMonth = year === todayYear && month === todayMonth
  const isFutureMonth  = year > todayYear || (year === todayYear && month > todayMonth)
  const isFuture       = (d) => isFutureMonth || (isCurrentMonth && d > todayDay)

  const activeStudents     = students.filter(s => s.status === 'Active')
  const displayed          = selectedBatch
    ? activeStudents.filter(s => s.batchId === selectedBatch.id || s.batch === selectedBatch.name || mbStudentIds.has(s.id))
    : activeStudents
  const suspendedDisplayed = selectedBatch
    ? students.filter(s => s.status === 'Suspended' && (s.batchId === selectedBatch.id || s.batch === selectedBatch.name || s.lastBatchName === selectedBatch.name))
    : students.filter(s => s.status === 'Suspended')

  const loadMonth = useCallback(async () => {
    setLoading(true)
    try {
      setMonthData(await db.fetchAttendanceForMonth(year, month, selectedBatch?.id ?? null))
      setDirty(new Set())  // fresh load = no pending changes
    }
    catch { showToast('Failed to load attendance', 'error') }
    finally { setLoading(false) }
  }, [year, month, selectedBatch?.id])

  useEffect(() => { loadMonth() }, [loadMonth])

  // Warn before tab close / refresh if there are unsaved attendance changes.
  useEffect(() => {
    if (dirty.size === 0) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty.size])

  useEffect(() => {
    fetchAllBatchEnrolments()
      .then(rows => {
        const map = {}
        rows.forEach(r => {
          if (!map[r.batch_id]) map[r.batch_id] = new Set()
          map[r.batch_id].add(r.student_id)
        })
        setAllEnrolments(map)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedBatch?.id) { setMbStudentIds(new Set()); return }
    fetchBatchEnrolments(selectedBatch.id)
      .then(rows => setMbStudentIds(new Set(rows.map(r => r.student_id))))
      .catch(() => setMbStudentIds(new Set()))
  }, [selectedBatch?.id])

  const getStatus = (sid, day) => monthData[sid]?.[day] || ''

  const cycle = (sid, day) => {
    if (isFuture(day)) return
    const student = students.find(s => s.id === sid)
    if (student && isOffDay(student, day)) return
    const cur  = getStatus(sid, day)
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length]
    setMonthData(prev => ({ ...prev, [sid]: { ...(prev[sid] || {}), [day]: next } }))
    setDirty(prev => new Set(prev).add(`${sid}-${day}`))
  }

  const markAll = (status, day) => {
    const d = day ?? (isCurrentMonth ? todayDay : 1)
    if (isFuture(d)) return
    setMonthData(prev => {
      const next = { ...prev }
      displayed.forEach(s => {
        if (isOffDay(s, d)) return
        next[s.id] = { ...(next[s.id] || {}), [d]: status }
      })
      return next
    })
    setDirty(prev => {
      const nextDirty = new Set(prev)
      displayed.forEach(s => { if (!isOffDay(s, d)) nextDirty.add(`${s.id}-${d}`) })
      return nextDirty
    })
  }

  const handleSave = async () => {
    if (dirty.size === 0) { showToast('No changes to save', 'info'); return }
    setSaving(true)
    try {
      // Build a partial monthData containing only cells the user actually touched.
      // Prevents two-tab edit destruction: untouched cells in this tab won't overwrite
      // whatever another tab saved for those same cells.
      const dirtyData = {}
      dirty.forEach(key => {
        const sepIdx = key.lastIndexOf('-')
        const sid    = key.slice(0, sepIdx)
        const day    = key.slice(sepIdx + 1)
        const status = monthData[sid]?.[day] ?? null
        if (!dirtyData[sid]) dirtyData[sid] = {}
        dirtyData[sid][day] = status  // null/empty means "clear this cell"
      })
      await db.saveAttendanceMonth(year, month, dirtyData, selectedBatch?.id ?? null)
      setDirty(new Set())
      showToast(`Attendance saved (${dirty.size} ${dirty.size === 1 ? 'change' : 'changes'})`)
    }
    catch { showToast('Save failed', 'error') }
    finally { setSaving(false) }
  }

  const prevMonth = () => { if (month===0){setYear(y=>y-1);setMonth(11)}else setMonth(m=>m-1) }
  const nextMonth = () => {
    if (year === todayYear && month === todayMonth) return  // already at current month
    if (month===11){setYear(y=>y+1);setMonth(0)}else setMonth(m=>m+1)
  }

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
    displayed.forEach(s => days.forEach(d => {
      const st = getStatus(s.id, d)
      if (st) { total++; if(st==='Present') present++; else if(st==='Absent') absent++; else if(st==='Late') late++ }
    }))
    return { present, absent, late, total, avg: total>0 ? Math.round((present/total)*100) : 0 }
  }, [monthData, displayed, days])

  // Student → primary batch lookup (for Alternate off-day cross-out)
  const batchByStudent = useMemo(() => {
    const byId   = Object.fromEntries(batches.map(b => [b.id, b]))
    const byName = Object.fromEntries(batches.map(b => [b.name, b]))
    const map = {}
    students.forEach(s => {
      const b = byId[s.batchId] || byName[s.batch]
      if (b) map[s.id] = b
    })
    return map
  }, [students, batches])

  // Is this date an off-day for this student? (Alternate students only, requires batch days)
  const isOffDay = (student, day) => {
    if (student.trainingType !== 'Alternate') return false
    const b = batchByStudent[student.id]
    if (!b?.days?.length) return false
    return !b.days.includes(dayName(year, month, day))
  }

  const batchStats = useMemo(() => batches.map(b => {
    const mbIds = allEnrolments[b.id] || new Set()
    const bs = activeStudents.filter(s => s.batchId === b.id || s.batch === b.name || mbIds.has(s.id))
    const trainsToday = b.days?.length > 0 ? b.days.includes(todayDayShort) : true
    return { ...b, studentCount: bs.length, presentToday: isCurrentMonth ? bs.filter(s => getStatus(s.id, todayDay)==='Present').length : 0, trainsToday }
  }), [batches, activeStudents, monthData, todayDay, isCurrentMonth, allEnrolments, todayDayShort])

  // Branch list derived from batches' sports arrays
  const branchList = useMemo(() => {
    const set = new Set()
    batches.forEach(b => (b.sports || []).forEach(sp => set.add(sp)))
    return ['All', ...Array.from(set).sort()]
  }, [batches])

  // Batches filtered by selected branch, today's training batches sorted first
  const visibleBatches = useMemo(() => {
    const filtered = selectedBranch === 'All'
      ? batchStats
      : batchStats.filter(b => (b.sports || []).includes(selectedBranch))
    return [...filtered].sort((a, b) => (b.trainsToday ? 1 : 0) - (a.trainsToday ? 1 : 0))
  }, [batchStats, selectedBranch])

  // Mobile day stats
  const mobileDayStats = useMemo(() => {
    const c = { Present:0, Absent:0, Late:0, Leave:0 }
    displayed.forEach(s => { const st = getStatus(s.id, mobileDay); if(st) c[st]=(c[st]||0)+1 })
    return c
  }, [monthData, displayed, mobileDay])

  return (
    <div className="space-y-4 max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance</h2>
          <p className="text-xs text-gray-400">{MONTH_NAMES[month]} {year}</p>
        </div>
        <button onClick={() => setShowExport(true)} className="btn-secondary text-xs">
          <FileSpreadsheet size={14} /> Export Excel
        </button>
      </div>

      {/* ── Branch pills (Level 1) — only shown in All Sports mode ── */}
      {selectedSport === 'All' && <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {branchList.map(br => (
          <button
            key={br}
            onClick={() => { setSelectedBranch(br); setSelectedBatch(null) }}
            className={`flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              selectedBranch === br
                ? 'bg-gray-900 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 active:bg-gray-200'
            }`}
          >
            {br === 'All' ? 'All Branches' : br}
          </button>
        ))}
      </div>}

      {/* ── Batch pills (Level 2) ────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {/* All pill */}
        <button
          onClick={() => setSelectedBatch(null)}
          className={`flex-shrink-0 flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-xl border transition ${
            !selectedBatch
              ? 'border-brand-500 bg-brand-50 text-brand-700'
              : 'border-gray-200 bg-white text-gray-600 active:bg-gray-50'
          }`}
        >
          <span className="text-xs font-bold whitespace-nowrap">
            All {selectedSport !== 'All' ? selectedSport : selectedBranch !== 'All' ? selectedBranch : 'Batches'}
          </span>
          <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-full ${
            !selectedBatch ? 'bg-brand-200 text-brand-800' : 'bg-gray-100 text-gray-600'
          }`}>
            {selectedBranch === 'All'
              ? activeStudents.length
              : activeStudents.filter(s => visibleBatches.some(b => b.name === s.batch)).length}
          </span>
        </button>

        {visibleBatches.map(b => {
          const isActive  = selectedBatch?.id === b.id
          const dimmed    = isCurrentMonth && !b.trainsToday
          const pct       = b.studentCount > 0 ? Math.round((b.presentToday / b.studentCount) * 100) : null
          const pctColor  = pct === null ? '' : pct >= 80 ? 'text-emerald-600 bg-emerald-50' : pct >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
          return (
            <button
              key={b.id}
              onClick={() => setSelectedBatch(isActive ? null : b)}
              className={`flex-shrink-0 flex items-center gap-2.5 pl-3 pr-3 py-2.5 rounded-xl border transition ${
                isActive
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
              } ${dimmed ? 'opacity-45' : ''}`}
            >
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold whitespace-nowrap leading-tight">{b.name}</p>
                  {isCurrentMonth && b.trainsToday && (
                    <span className="text-[9px] font-black px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 leading-none">Today</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400 whitespace-nowrap leading-tight">{b.time}</p>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-brand-200 text-brand-800' : 'bg-gray-100 text-gray-600'
                }`}>{b.studentCount}</span>
                {isCurrentMonth && pct !== null && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${pctColor}`}>{pct}%</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Warning: selected batch doesn't train today ── */}
      {isCurrentMonth && selectedBatch && !selectedBatch.trainsToday && (
        <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <span className="text-base">⚠</span>
          <span>
            <strong>{selectedBatch.name}</strong> doesn't train today ({todayDayShort})
            {selectedBatch.days?.length > 0 && <> — trains on {selectedBatch.days.join(', ')}</>}
          </span>
        </div>
      )}

      {/* ── Month nav + bulk actions ──────────────────── */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={prevMonth} className="px-2.5 py-2 hover:bg-gray-50 transition"><ChevronLeft size={15} className="text-gray-600"/></button>
          <span className="px-3 text-sm font-semibold text-gray-700 whitespace-nowrap">{MONTH_NAMES[month]} {year}</span>
          <button onClick={nextMonth} className="px-2.5 py-2 hover:bg-gray-50 transition"><ChevronRight size={15} className="text-gray-600"/></button>
        </div>
        {selectedBatch && <span className="badge badge-blue">{selectedBatch.name}</span>}
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={() => markAll('Present')} className="px-3 py-2 text-xs font-semibold border-2 border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition">✓ All Present</button>
          <button onClick={() => markAll('Absent')}  className="px-3 py-2 text-xs font-semibold border-2 border-red-400 text-red-600 rounded-lg hover:bg-red-50 transition">✗ All Absent</button>
          <button onClick={handleSave} disabled={saving || dirty.size === 0} className="btn-primary text-xs">
            {saving
              ? <span className="flex items-center gap-1"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Saving…</span>
              : <><Save size={13}/> Save{dirty.size > 0 ? ` (${dirty.size})` : ''}</>
            }
          </button>
        </div>
      </div>

      {/* ── Stats row ────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:'Present', value:todayStats.Present, bg:'bg-emerald-100', text:'text-emerald-700', ring:'ring-emerald-200' },
          { label:'Absent',  value:todayStats.Absent,  bg:'bg-red-100',     text:'text-red-700',     ring:'ring-red-200' },
          { label:'Late',    value:todayStats.Late,    bg:'bg-amber-100',   text:'text-amber-700',   ring:'ring-amber-200' },
          { label:'Total',   value:displayed.length,  bg:'bg-brand-100',   text:'text-brand-700',   ring:'ring-brand-200' },
        ].map(s => (
          <div key={s.label} className="card p-3 flex items-center gap-3">
            <div className={`w-10 h-10 ${s.bg} ${s.text} rounded-full flex items-center justify-center text-lg font-black ring-2 ${s.ring} flex-shrink-0`}>{s.value}</div>
            <p className="text-sm font-semibold text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── MOBILE: Day picker + student list ─────────── */}
      <div className="lg:hidden space-y-3">
        {/* Day picker strip */}
        <div className="card p-3">
          <p className="text-xs font-semibold text-gray-500 mb-2 px-1">Select Day</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x">
            {days.map(d => {
              const isToday  = isCurrentMonth && d === todayDay
              const isSunday = isSun(year, month, d)
              const marked   = displayed.filter(s => getStatus(s.id, d)).length
              return (
                <button
                  key={d}
                  onClick={() => !isFuture(d) && setMobileDay(d)}
                  disabled={isFuture(d)}
                  className={`flex-shrink-0 snap-start flex flex-col items-center w-12 py-2 rounded-xl transition font-semibold ${
                    isFuture(d)
                      ? 'text-gray-300 cursor-not-allowed opacity-40'
                      : mobileDay === d
                      ? 'bg-brand-600 text-white shadow-sm'
                      : isToday
                      ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-300'
                      : isSunday
                      ? 'text-red-400'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-[10px] font-normal opacity-70">{dayName(year,month,d)}</span>
                  <span className="text-base leading-tight">{d}</span>
                  {marked > 0 && (
                    <span className={`text-[9px] mt-0.5 font-bold ${mobileDay === d ? 'text-brand-200' : 'text-brand-500'}`}>{marked}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected day header */}
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="font-black text-gray-900">
              {dayName(year, month, mobileDay)}, {mobileDay} {SHORT_MONTHS[month]}
              {isCurrentMonth && mobileDay === todayDay && <span className="ml-2 badge badge-blue">Today</span>}
            </p>
            <p className="text-xs text-gray-400">{displayed.length} students · tap to cycle status</p>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => markAll('Present', mobileDay)} className="px-2.5 py-1.5 text-xs font-bold border-2 border-emerald-500 text-emerald-600 rounded-lg">✓ All</button>
            <button onClick={() => markAll('Absent', mobileDay)}  className="px-2.5 py-1.5 text-xs font-bold border-2 border-red-400 text-red-600 rounded-lg">✗ All</button>
          </div>
        </div>

        {/* Mobile stats for selected day */}
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(mobileDayStats).map(([k, v]) => (
            <div key={k} className="bg-white rounded-xl border border-gray-100 p-2 text-center">
              <p className={`text-lg font-black ${S[k].text}`}>{v}</p>
              <p className="text-[10px] text-gray-400">{k}</p>
            </div>
          ))}
        </div>

        {/* Student list for mobile day view */}
        {loading ? (
          <div className="card py-10 flex justify-center"><svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg></div>
        ) : (
          <div className="card divide-y divide-gray-50 overflow-hidden">
            {displayed.length === 0 && (
              <p className="text-center py-10 text-sm text-gray-400">No students in this batch</p>
            )}
            {displayed.map((s, idx) => {
              const st  = getStatus(s.id, mobileDay)
              const cfg = st ? S[st] : null
              const off = isOffDay(s, mobileDay)
              return (
                <button
                  key={s.id}
                  onClick={() => cycle(s.id, mobileDay)}
                  disabled={off}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 transition text-left ${off ? 'opacity-50 bg-gray-50/60' : 'active:bg-gray-50'}`}
                >
                  <span className="text-xs text-gray-400 w-5 flex-shrink-0 font-medium">{idx+1}</span>
                  <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center text-sm font-bold text-brand-700 flex-shrink-0">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{s.name}</p>
                    <p className="text-xs text-gray-400 truncate">{s.sport} · {s.batch}</p>
                  </div>
                  {off ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border border-gray-200 text-gray-400">
                      ✕ Off day
                    </span>
                  ) : cfg ? (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${cfg.light} ${cfg.text}`}>
                      <span>{cfg.icon}</span> {cfg.label}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-medium border border-gray-200 text-gray-400">
                      — Mark
                    </span>
                  )}
                </button>
              )
            })}
            {suspendedDisplayed.map(s => (
              <div key={`susp-${s.id}`} className="w-full flex items-center gap-3 px-4 py-3.5 bg-red-50/40 opacity-60">
                <span className="text-xs text-gray-300 w-5 flex-shrink-0">—</span>
                <div className="w-9 h-9 bg-red-100 rounded-full flex items-center justify-center text-sm font-bold text-red-400 flex-shrink-0">
                  {s.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-500 text-sm truncate">{s.name}</p>
                  <p className="text-xs text-gray-400 truncate">{s.sport} · {s.lastBatchName}</p>
                </div>
                <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold border border-red-200 text-red-500 bg-red-50">
                  Suspended
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── DESKTOP: Full monthly grid ────────────────── */}
      <div className="hidden lg:block card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2">
            <svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            <span className="text-sm text-gray-400">Loading…</span>
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
            <table className="text-xs border-collapse" style={{ minWidth: `${totalDays * 36 + 220}px` }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="sticky left-0 bg-gray-50 z-20 text-center px-2 py-3 font-semibold text-gray-400 w-8 border-r border-gray-100">#</th>
                  <th className="sticky left-8 bg-gray-50 z-20 text-left px-3 py-3 font-semibold text-gray-500 w-40 border-r border-gray-100 whitespace-nowrap">Student</th>
                  {days.map(d => (
                    <th key={d} className={`py-2 w-9 text-center font-medium
                      ${isSun(year,month,d) ? 'text-red-400 bg-red-50/60' : 'text-gray-500'}
                      ${isCurrentMonth && d===todayDay ? 'bg-brand-50 text-brand-700' : ''}`}>
                      <div className="font-bold">{d}</div>
                      <div className="text-[9px] opacity-70">{dayName(year,month,d)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.length === 0 && (
                  <tr><td colSpan={totalDays+2} className="text-center py-12 text-gray-400 text-sm">No students in this batch</td></tr>
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
                      const st      = getStatus(s.id, d)
                      const cfg     = st ? S[st] : null
                      const off     = isOffDay(s, d)
                      const future  = isFuture(d)
                      const locked  = future || off
                      return (
                        <td key={d}
                          onClick={() => cycle(s.id, d)}
                          className={`py-2 text-center select-none transition
                            ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}
                            ${future ? 'opacity-30' : ''}
                            ${off ? 'bg-gray-100/70' : ''}
                            ${isCurrentMonth && d===todayDay ? 'bg-brand-50/60' : ''}
                            ${isSun(year,month,d) ? 'bg-red-50/30' : ''}`}
                          title={
                            off    ? `${s.name} — off day (alternate, not in batch days)` :
                            future ? 'Future date — cannot mark' :
                                     `${s.name} — ${dayName(year,month,d)} ${d} — ${st||'Not marked'}`
                          }
                        >
                          {off ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-gray-300 text-[12px] font-bold">✕</span>
                          ) : cfg ? (
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white ${cfg.bg} ${!locked && 'hover:opacity-80'} transition`}>{cfg.icon}</span>
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
                    <td className="sticky left-0 bg-red-50/30 z-10 text-center px-2 py-2.5 text-gray-300 border-r border-gray-100">—</td>
                    <td className="sticky left-8 bg-red-50/30 z-10 px-3 py-2.5 border-r border-gray-100">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center text-[10px] font-bold text-red-400 flex-shrink-0">{s.name[0]}</div>
                        <div>
                          <span className="font-semibold text-gray-500 whitespace-nowrap text-xs">{s.name}</span>
                          <span className="ml-2 text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">Suspended</span>
                        </div>
                      </div>
                    </td>
                    {days.map(d => (
                      <td key={d} className="py-2 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-red-100 text-red-200 text-[10px]">✕</span>
                      </td>
                    ))}
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
          <span className="text-xs text-gray-400 ml-auto italic">Click any cell to cycle status</span>
        </div>
      </div>

      {/* ── Bottom 3 panels (desktop only for last 2) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Today Summary */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Today's Summary</h3>
          <div className="space-y-3">
            {[
              { label:'Present', value:todayStats.Present, color:'text-emerald-600', dot:'bg-emerald-500' },
              { label:'Absent',  value:todayStats.Absent,  color:'text-red-600',     dot:'bg-red-500' },
              { label:'Late',    value:todayStats.Late,    color:'text-amber-600',   dot:'bg-amber-400' },
              { label:'Leave',   value:todayStats.Leave||0,color:'text-gray-500',    dot:'bg-gray-300' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-2.5 h-2.5 rounded-full ${r.dot}`} />
                  <span className="text-sm text-gray-600">{r.label}</span>
                </div>
                <span className={`text-sm font-bold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Absent students */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Absent Today</h3>
          {absentToday.length === 0 ? (
            <div className="text-center py-6"><p className="text-2xl mb-1">🎉</p><p className="text-xs text-gray-400">No absences today</p></div>
          ) : (
            <div className="space-y-2.5 max-h-36 overflow-y-auto">
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
            <button className="w-full mt-3 bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2.5 rounded-xl transition flex items-center justify-center gap-2">
              <MessageCircle size={13}/> Send WhatsApp Reminder
            </button>
          )}
        </div>

        {/* Monthly Overview */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Monthly Overview</h3>
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={90} height={90}>
                <PieChart>
                  <Pie
                    data={[{value:monthlyStats.present||1},{value:Math.max(monthlyStats.absent+monthlyStats.late,0)}]}
                    cx="50%" cy="50%" innerRadius={25} outerRadius={42}
                    startAngle={90} endAngle={-270} dataKey="value" paddingAngle={2} stroke="none"
                  >
                    <Cell fill="#10b981"/><Cell fill="#f3f4f6"/>
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-sm font-black text-gray-900">{monthlyStats.avg}%</p>
                  <p className="text-[9px] text-gray-400">Avg</p>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {[
                {label:'Present',value:monthlyStats.present,color:'text-emerald-600'},
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

      {/* ── Export Modal ──────────────────────────────── */}
      {showExport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowExport(false)} />
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
                <X size={16} className="text-gray-500"/>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="label">From Date</label>
                <input type="date" className="input" value={exportFrom} max={exportTo} onChange={e => setExportFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To Date</label>
                <input type="date" className="input" value={exportTo} min={exportFrom} onChange={e => setExportTo(e.target.value)} />
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">Exports: <strong>{selectedBatch?.name || 'All batches'}</strong> · {displayed.length} students</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button className="btn-secondary flex-1 justify-center" onClick={() => setShowExport(false)}>Cancel</button>
              <button className="btn-primary flex-1 justify-center bg-emerald-600 hover:bg-emerald-700" onClick={async () => { setExporting(true); await exportToExcel({students:displayed,fromDate:exportFrom,toDate:exportTo,showToast}); setExporting(false); setShowExport(false) }} disabled={exporting}>
                {exporting
                  ? <span className="flex items-center gap-1.5"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Exporting…</span>
                  : <><FileSpreadsheet size={14}/> Export .xlsx</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
