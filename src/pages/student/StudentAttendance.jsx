import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

const statusColor = {
  Present: 'bg-emerald-500 text-white',
  Absent:  'bg-red-400 text-white',
  Late:    'bg-amber-400 text-white',
  Leave:   'bg-blue-400 text-white',
}

export default function StudentAttendance() {
  const { studentUser } = useApp()
  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [attMap,  setAttMap]  = useState({})   // { 'YYYY-MM-DD': status }
  const [loading, setLoading] = useState(true)
  const [batchDays, setBatchDays] = useState(null)  // null = unknown, [] = no days, ['Mon','Wed','Fri'] etc.

  const isAlternate = (studentUser?.training_type || studentUser?.trainingType) === 'Alternate'

  useEffect(() => {
    loadMonth()
  }, [year, month, studentUser])

  // Fetch the student's batch days once (for off-day cross-out on Alternate students)
  useEffect(() => {
    if (!studentUser?.id || !isAlternate) return
    const batchId = studentUser.batch_id || studentUser.batchId
    if (!batchId) return
    supabase.from('batches').select('days').eq('id', batchId).maybeSingle()
      .then(({ data }) => setBatchDays(data?.days || []))
      .catch(() => setBatchDays([]))
  }, [studentUser, isAlternate])

  // Priority: Present > Late > Leave > Absent (best status wins when multiple batch records exist)
  const STATUS_PRI = { Present: 4, Late: 3, Leave: 2, Absent: 1 }
  const bestStatus = (a, b) => {
    if (!a) return b
    if (!b) return a
    return (STATUS_PRI[a] || 0) >= (STATUS_PRI[b] || 0) ? a : b
  }

  const loadMonth = async () => {
    if (!studentUser?.id) return
    setLoading(true)
    try {
      const rows = await db.fetchStudentOwnAttendance(studentUser.id, year, month)
      const map = {}
      // Deduplicate across batches: same date may appear twice if student is in MWF + TTS
      rows.forEach(r => {
        const st = r.status || (r.present ? 'Present' : 'Absent')
        map[r.date] = bestStatus(map[r.date], st)
      })
      setAttMap(map)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
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

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const pad = n => String(n).padStart(2, '0')
  // LOCAL today (not UTC) — toISOString returns UTC, gives wrong day in early-morning IST
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`

  // Off-day = Alternate student + date's day name is NOT in their batch's training days
  const isOffDay = (day) => {
    if (!isAlternate || !batchDays || batchDays.length === 0) return false
    return !batchDays.includes(DAYS[new Date(year, month, day).getDay()])
  }

  const present = Object.values(attMap).filter(v => v === 'Present').length
  const absent  = Object.values(attMap).filter(v => v === 'Absent').length
  const total   = Object.keys(attMap).length

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900">Attendance</h1>
        <p className="text-sm text-gray-500">Your monthly attendance record</p>
      </div>

      {/* Month navigator */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 transition">
            <ChevronLeft size={18} className="text-gray-500" />
          </button>
          <span className="font-black text-gray-900">{MONTHS[month]} {year}</span>
          <button
            onClick={nextMonth}
            disabled={year === now.getFullYear() && month === now.getMonth()}
            className="p-2 rounded-xl hover:bg-gray-100 transition disabled:opacity-30"
          >
            <ChevronRight size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-2">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="h-40 flex items-center justify-center">
            <svg className="animate-spin h-6 w-6 text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} />
              const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`
              const status  = attMap[dateStr]
              const isToday = dateStr === today
              const off     = isOffDay(day)
              // Off-day takes precedence — alternate students shouldn't see "Absent" on days they don't train
              if (off) {
                return (
                  <div
                    key={idx}
                    className="aspect-square flex flex-col items-center justify-center rounded-lg text-[10px] font-bold bg-red-50 text-red-400 relative"
                    title="Off day — not your training day"
                  >
                    <span className="text-[10px] leading-none">{day}</span>
                    <span className="text-sm leading-none mt-0.5">✕</span>
                  </div>
                )
              }
              return (
                <div
                  key={idx}
                  className={`aspect-square flex items-center justify-center rounded-lg text-xs font-bold transition ${
                    status
                      ? statusColor[status] || 'bg-gray-100 text-gray-600'
                      : isToday
                      ? 'ring-2 ring-brand-400 text-brand-600'
                      : 'text-gray-400'
                  }`}
                  title={status || 'No record'}
                >
                  {day}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(statusColor).map(([label, cls]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-sm ${cls.split(' ')[0]}`} />
            <span className="text-xs text-gray-600">{label}</span>
          </div>
        ))}
        {isAlternate && batchDays && batchDays.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-50 flex items-center justify-center text-red-400 text-[8px] font-black">✕</div>
            <span className="text-xs text-gray-600">Off Day</span>
          </div>
        )}
      </div>

      {/* Monthly summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-2xl font-black text-emerald-600">{present}</p>
          <p className="text-[10px] text-gray-400 font-semibold">PRESENT</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-2xl font-black text-red-500">{absent}</p>
          <p className="text-[10px] text-gray-400 font-semibold">ABSENT</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-3 text-center">
          <p className="text-2xl font-black text-gray-900">
            {total > 0 ? Math.round((present / total) * 100) : 0}%
          </p>
          <p className="text-[10px] text-gray-400 font-semibold">RATE</p>
        </div>
      </div>
    </div>
  )
}
