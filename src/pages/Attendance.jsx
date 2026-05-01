import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { BATCH_NAMES } from '../data/mockData'
import { CalendarCheck, CheckCircle, XCircle, Users, Save, ChevronLeft, ChevronRight } from 'lucide-react'

export default function Attendance() {
  const { students, attendanceData, saveAttendance, loadAttendanceForDate } = useApp()
  const todayStr = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [batchFilter, setBatchFilter] = useState('All')
  const [localRecords, setLocalRecords] = useState(() => attendanceData[todayStr] || {})

  const activeStudents = students.filter(s => s.status === 'Active')
  const displayed = batchFilter === 'All' ? activeStudents : activeStudents.filter(s => s.batch === batchFilter)

  const handleDateChange = async (d) => {
    setSelectedDate(d)
    await loadAttendanceForDate(d)
    setLocalRecords(attendanceData[d] || {})
  }

  const toggle = (id) => setLocalRecords(r => ({ ...r, [id]: !r[id] }))
  const markAll = (val) => {
    const rec = {}
    displayed.forEach(s => { rec[s.id] = val })
    setLocalRecords(r => ({ ...r, ...rec }))
  }
  const handleSave = () => saveAttendance(selectedDate, localRecords)

  const presentCount = displayed.filter(s => localRecords[s.id]).length
  const absentCount = displayed.length - presentCount

  const prevDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() - 1)
    handleDateChange(d.toISOString().split('T')[0])
  }
  const nextDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + 1)
    const next = d.toISOString().split('T')[0]
    if (next <= todayStr) handleDateChange(next)
  }

  return (
    <div className="space-y-5 max-w-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Attendance</h2>
          <p className="text-sm text-gray-500">Mark who showed up for the session</p>
        </div>
        <button className="btn-primary" onClick={handleSave}>
          <Save size={15} /> Save Attendance
        </button>
      </div>

      {/* Controls */}
      <div className="card p-4 flex flex-wrap gap-4 items-center">
        {/* Date nav */}
        <div className="flex items-center gap-2">
          <button className="p-2 rounded-lg hover:bg-gray-100 transition" onClick={prevDate}>
            <ChevronLeft size={16} className="text-gray-600" />
          </button>
          <input
            type="date"
            className="input w-auto"
            value={selectedDate}
            max={todayStr}
            onChange={e => handleDateChange(e.target.value)}
          />
          <button className="p-2 rounded-lg hover:bg-gray-100 transition" onClick={nextDate} disabled={selectedDate >= todayStr}>
            <ChevronRight size={16} className={selectedDate >= todayStr ? 'text-gray-300' : 'text-gray-600'} />
          </button>
        </div>

        <select className="input w-auto" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
          <option value="All">All Batches</option>
          {BATCH_NAMES.map(b => <option key={b}>{b}</option>)}
        </select>

        <div className="flex gap-2 ml-auto">
          <button className="btn-secondary text-xs" onClick={() => markAll(true)}>
            <CheckCircle size={13} /> Mark All Present
          </button>
          <button className="btn-secondary text-xs" onClick={() => markAll(false)}>
            <XCircle size={13} /> Clear All
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-emerald-600">{presentCount}</p>
          <p className="text-xs text-gray-500 font-medium mt-1">Present</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-red-500">{absentCount}</p>
          <p className="text-xs text-gray-500 font-medium mt-1">Absent</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-black text-brand-600">
            {displayed.length > 0 ? Math.round((presentCount / displayed.length) * 100) : 0}%
          </p>
          <p className="text-xs text-gray-500 font-medium mt-1">Attendance Rate</p>
        </div>
      </div>

      {/* Student list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 text-sm">{batchFilter === 'All' ? 'All Students' : batchFilter}</h3>
          <span className="text-xs text-gray-400">{displayed.length} students</span>
        </div>
        <div className="divide-y divide-gray-50">
          {displayed.map(s => {
            const present = !!localRecords[s.id]
            return (
              <div
                key={s.id}
                className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition hover:bg-gray-50/60 ${present ? 'bg-emerald-50/40' : ''}`}
                onClick={() => toggle(s.id)}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 transition ${
                  present ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                }`}>
                  {present ? '✓' : s.name[0]}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{s.name}</p>
                  <p className="text-xs text-gray-400">{s.sport} · {s.batch}</p>
                </div>
                <div className={`px-3 py-1 rounded-full text-xs font-bold transition ${
                  present ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {present ? 'Present' : 'Absent'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Absent list */}
      {absentCount > 0 && (
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <XCircle size={16} className="text-red-500" /> Absent Today ({absentCount})
          </h3>
          <div className="flex flex-wrap gap-2">
            {displayed.filter(s => !localRecords[s.id]).map(s => (
              <span key={s.id} className="badge badge-red">{s.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
