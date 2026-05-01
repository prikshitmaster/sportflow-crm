import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { BATCH_NAMES } from '../data/mockData'
import { Save, ChevronLeft, ChevronRight, Download, MessageCircle } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import * as db from '../lib/db'

const STATUS_CYCLE = ['Present', 'Absent', 'Late', 'Leave']

const S = {
  Present: { icon: '✓', bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50', dot: 'bg-emerald-500' },
  Absent:  { icon: '✗', bg: 'bg-red-500',     text: 'text-red-600',     light: 'bg-red-50',     dot: 'bg-red-500' },
  Late:    { icon: '⏱', bg: 'bg-amber-400',   text: 'text-amber-600',   light: 'bg-amber-50',   dot: 'bg-amber-400' },
  Leave:   { icon: '○', bg: 'bg-gray-300',    text: 'text-gray-500',    light: 'bg-gray-50',    dot: 'bg-gray-300' },
}

const pad = n => String(n).padStart(2, '0')
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const dayName = (y, m, d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(y, m, d).getDay()]
const isSun = (y, m, d) => new Date(y, m, d).getDay() === 0

export default function Attendance() {
  const { students, showToast } = useApp()
  const now = new Date()
  const todayDay   = now.getDate()
  const todayMonth = now.getMonth()
  const todayYear  = now.getFullYear()

  const [year,        setYear]        = useState(todayYear)
  const [month,       setMonth]       = useState(todayMonth)
  const [batchFilter, setBatchFilter] = useState('All')
  const [monthData,   setMonthData]   = useState({})
  const [saving,      setSaving]      = useState(false)
  const [loading,     setLoading]     = useState(false)

  const totalDays      = daysInMonth(year, month)
  const days           = Array.from({ length: totalDays }, (_, i) => i + 1)
  const isCurrentMonth = year === todayYear && month === todayMonth

  const activeStudents = students.filter(s => s.status === 'Active')
  const displayed      = batchFilter === 'All'
    ? activeStudents
    : activeStudents.filter(s => s.batch === batchFilter)

  // ── Load month from Supabase ──────────────────────────────
  const loadMonth = useCallback(async () => {
    setLoading(true)
    try {
      const data = await db.fetchAttendanceForMonth(year, month)
      setMonthData(data)
    } catch {
      showToast('Failed to load attendance', 'error')
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { loadMonth() }, [loadMonth])

  // ── Helpers ───────────────────────────────────────────────
  const getStatus = (sid, day) => monthData[sid]?.[day] || ''

  const handleCell = (sid, day) => {
    const cur = getStatus(sid, day)
    const idx = STATUS_CYCLE.indexOf(cur)
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length]
    setMonthData(prev => ({
      ...prev,
      [sid]: { ...(prev[sid] || {}), [day]: next },
    }))
  }

  const markAll = (status) => {
    const day = isCurrentMonth ? todayDay : 1
    setMonthData(prev => {
      const next = { ...prev }
      displayed.forEach(s => {
        next[s.id] = { ...(next[s.id] || {}), [day]: status }
      })
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await db.saveAttendanceMonth(year, month, monthData)
      showToast('Attendance saved')
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // ── Derived stats ─────────────────────────────────────────
  const todayStats = useMemo(() => {
    const counts = { Present: 0, Absent: 0, Late: 0, Leave: 0 }
    if (!isCurrentMonth) return counts
    displayed.forEach(s => {
      const st = getStatus(s.id, todayDay)
      if (st) counts[st] = (counts[st] || 0) + 1
    })
    return counts
  }, [monthData, displayed, todayDay, isCurrentMonth])

  const absentToday = useMemo(() =>
    isCurrentMonth ? displayed.filter(s => getStatus(s.id, todayDay) === 'Absent') : []
  , [monthData, displayed, todayDay, isCurrentMonth])

  const monthlyStats = useMemo(() => {
    let present = 0, absent = 0, late = 0, total = 0
    displayed.forEach(s => {
      days.forEach(d => {
        const st = getStatus(s.id, d)
        if (st) {
          total++
          if (st === 'Present') present++
          else if (st === 'Absent') absent++
          else if (st === 'Late') late++
        }
      })
    })
    const avg = total > 0 ? Math.round((present / total) * 100) : 0
    return { present, absent, late, total, avg }
  }, [monthData, displayed, days])

  const monthLabel = new Date(year, month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-4 max-w-[1400px]">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance</h2>
          <p className="text-xs text-gray-400">Dashboard › Attendance</p>
        </div>
        <button className="btn-secondary text-xs">
          <Download size={13} /> Export Monthly Report
        </button>
      </div>

      {/* Controls */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <select
          className="input w-44"
          value={batchFilter}
          onChange={e => setBatchFilter(e.target.value)}
        >
          <option value="All">All Batches</option>
          {BATCH_NAMES.map(b => <option key={b}>{b}</option>)}
        </select>

        {/* Month navigator */}
        <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={prevMonth} className="px-2.5 py-2 hover:bg-gray-50 transition">
            <ChevronLeft size={15} className="text-gray-600" />
          </button>
          <span className="px-4 text-sm font-semibold text-gray-700 whitespace-nowrap">{monthLabel}</span>
          <button onClick={nextMonth} className="px-2.5 py-2 hover:bg-gray-50 transition">
            <ChevronRight size={15} className="text-gray-600" />
          </button>
        </div>

        <div className="flex gap-2 ml-auto flex-wrap">
          <button
            onClick={() => markAll('Present')}
            className="px-4 py-2 text-xs font-semibold border-2 border-emerald-500 text-emerald-600 rounded-lg hover:bg-emerald-50 transition"
          >
            ✓ Mark All Present
          </button>
          <button
            onClick={() => markAll('Absent')}
            className="px-4 py-2 text-xs font-semibold border-2 border-red-400 text-red-600 rounded-lg hover:bg-red-50 transition"
          >
            ✗ Mark All Absent
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
            {saving
              ? <span className="flex items-center gap-1.5"><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Saving...</span>
              : <><Save size={13} /> Save Attendance</>
            }
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Present', value: todayStats.Present, ring: 'ring-emerald-200', bg: 'bg-emerald-100', text: 'text-emerald-700' },
          { label: 'Absent',  value: todayStats.Absent,  ring: 'ring-red-200',     bg: 'bg-red-100',     text: 'text-red-700' },
          { label: 'Late',    value: todayStats.Late,    ring: 'ring-amber-200',   bg: 'bg-amber-100',   text: 'text-amber-700' },
          { label: 'Total',   value: displayed.length,  ring: 'ring-brand-200',   bg: 'bg-brand-100',   text: 'text-brand-700' },
        ].map(s => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-12 h-12 ${s.bg} ${s.text} rounded-full flex items-center justify-center text-xl font-black ring-2 ${s.ring} flex-shrink-0`}>
              {s.value}
            </div>
            <p className="text-sm font-semibold text-gray-600">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Monthly Calendar Grid */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="ml-2 text-sm text-gray-400">Loading...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse" style={{ minWidth: `${totalDays * 36 + 240}px`, width: '100%' }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {/* # */}
                  <th className="sticky left-0 bg-gray-50 z-20 text-center px-3 py-3 font-semibold text-gray-400 w-8 border-r border-gray-100">#</th>
                  {/* Name */}
                  <th className="sticky left-8 bg-gray-50 z-20 text-left px-3 py-3 font-semibold text-gray-500 w-36 border-r border-gray-100 whitespace-nowrap">Student Name</th>
                  {/* Day columns */}
                  {days.map(d => (
                    <th
                      key={d}
                      className={`py-2 w-9 font-medium text-center
                        ${isSun(year, month, d) ? 'text-red-400 bg-red-50/60' : 'text-gray-500'}
                        ${isCurrentMonth && d === todayDay ? 'bg-brand-50 text-brand-600' : ''}
                      `}
                    >
                      <div className="font-bold">{d}</div>
                      <div className="text-[9px] font-normal opacity-70">{dayName(year, month, d)}</div>
                    </th>
                  ))}
                  <th className="px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={totalDays + 3} className="text-center py-12 text-gray-400 text-sm">
                      No students found for this batch
                    </td>
                  </tr>
                )}
                {displayed.map((s, idx) => (
                  <tr key={s.id} className="hover:bg-gray-50/50 group transition">
                    {/* # */}
                    <td className="sticky left-0 bg-white group-hover:bg-gray-50/50 z-10 text-center px-3 py-2.5 text-gray-400 border-r border-gray-100 font-medium">
                      {idx + 1}
                    </td>
                    {/* Name */}
                    <td className="sticky left-8 bg-white group-hover:bg-gray-50/50 z-10 px-3 py-2.5 border-r border-gray-100 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center text-[10px] font-bold text-brand-700 flex-shrink-0">
                          {s.name[0]}
                        </div>
                        <span className="font-semibold text-gray-900 text-xs">{s.name}</span>
                      </div>
                    </td>
                    {/* Status cells */}
                    {days.map(d => {
                      const st = getStatus(s.id, d)
                      const cfg = st ? S[st] : null
                      const isToday = isCurrentMonth && d === todayDay
                      const isSunday = isSun(year, month, d)
                      return (
                        <td
                          key={d}
                          onClick={() => handleCell(s.id, d)}
                          title={`${s.name} — ${dayName(year, month, d)} ${d} ${monthLabel} — ${st || 'Not marked'}`}
                          className={`py-2 text-center cursor-pointer select-none transition
                            ${isToday ? 'bg-brand-50/60' : ''}
                            ${isSunday && !isToday ? 'bg-red-50/30' : ''}
                          `}
                        >
                          {cfg ? (
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold text-white ${cfg.bg} hover:opacity-80 transition`}>
                              {cfg.icon}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-gray-200 text-gray-300 hover:border-gray-300 transition">
                              –
                            </span>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-2.5">
                      <button className="opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-gray-100 text-gray-400">···</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-5 flex-wrap bg-gray-50/50">
          {Object.entries(S).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white ${v.bg}`}>
                {v.icon}
              </span>
              <span className="text-xs text-gray-500">{k}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-gray-200 text-gray-300 text-[10px]">–</span>
            <span className="text-xs text-gray-500">Leave / Holiday</span>
          </div>
          <span className="text-xs text-gray-400 ml-auto italic">Click on any cell to update</span>
        </div>
      </div>

      {/* Bottom 3 panels */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* Today's Summary */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">
            Today's Summary ({now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Present', value: todayStats.Present, color: 'text-emerald-600', dot: 'bg-emerald-500' },
              { label: 'Absent',  value: todayStats.Absent,  color: 'text-red-600',     dot: 'bg-red-500' },
              { label: 'Late',    value: todayStats.Late,    color: 'text-amber-600',   dot: 'bg-amber-400' },
              { label: 'Leave',   value: todayStats.Leave || 0,   color: 'text-gray-500',   dot: 'bg-gray-300' },
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

        {/* Absent Students Today */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Absent Students Today</h3>
          {absentToday.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-2xl mb-1">🎉</p>
              <p className="text-xs text-gray-400">No absences today</p>
            </div>
          ) : (
            <div className="space-y-2.5 mb-4 max-h-40 overflow-y-auto">
              {absentToday.map(s => (
                <div key={s.id} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 bg-red-100 rounded-full flex items-center justify-center text-xs font-bold text-red-600 flex-shrink-0">
                    {s.name[0]}
                  </div>
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
              <MessageCircle size={13} /> Send WhatsApp Reminder
            </button>
          )}
        </div>

        {/* Monthly Overview */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-4">Attendance Overview (This Month)</h3>
          <div className="flex items-center gap-4">
            {/* Donut */}
            <div className="relative flex-shrink-0">
              <ResponsiveContainer width={100} height={100}>
                <PieChart>
                  <Pie
                    data={[
                      { value: monthlyStats.present || 1 },
                      { value: Math.max(monthlyStats.absent + monthlyStats.late, 0) },
                    ]}
                    cx="50%" cy="50%"
                    innerRadius={30} outerRadius={46}
                    startAngle={90} endAngle={-270}
                    dataKey="value"
                    paddingAngle={2}
                    stroke="none"
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#f3f4f6" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-sm font-black text-gray-900">{monthlyStats.avg}%</p>
                  <p className="text-[9px] text-gray-400 leading-tight">Average<br/>Attendance</p>
                </div>
              </div>
            </div>

            {/* Stats list */}
            <div className="flex-1 space-y-2.5">
              {[
                { label: 'Present Days', value: monthlyStats.present, color: 'text-emerald-600' },
                { label: 'Absent Days',  value: monthlyStats.absent,  color: 'text-red-600' },
                { label: 'Late Days',    value: monthlyStats.late,    color: 'text-amber-600' },
                { label: 'Total Days',   value: monthlyStats.total,   color: 'text-gray-700' },
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
    </div>
  )
}
