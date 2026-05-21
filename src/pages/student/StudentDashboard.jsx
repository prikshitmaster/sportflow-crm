import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { supabase } from '../../lib/supabase'
import {
  QrCode, CalendarCheck, CreditCard, Megaphone, CheckCircle2, XCircle,
  Clock, ChevronRight, Trophy, Camera, Ban, Target,
} from 'lucide-react'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function StudentDashboard() {
  const { studentUser, updateStudentPhoto } = useApp()
  const [todayStatus,   setTodayStatus]   = useState(null)
  const [monthStats,    setMonthStats]    = useState(null)
  const [payments,      setPayments]      = useState([])
  const [notices,       setNotices]       = useState([])
  const [loadingData,   setLoadingData]   = useState(true)
  const [uploading,     setUploading]     = useState(false)
  const [batchInfo,     setBatchInfo]     = useState(null) // { trainsToday, startTime }
  const [monthGoal,     setMonthGoal]     = useState(null) // coach-set focus for the month
  const fileRef = useRef(null)

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await updateStudentPhoto(file)
    } catch (err) {
      console.error('Photo upload error:', err)
      const detail = err?.message || err?.error?.message || err?.statusCode || JSON.stringify(err)
      alert(`Photo upload failed:\n${detail}\n\n(Open DevTools console for full error)`)
    }
    setUploading(false)
    e.target.value = ''
  }

  useEffect(() => {
    if (!studentUser?.id) return
    loadData()
    if (studentUser.academy_id) {
      db.fetchAnnouncements(studentUser.academy_id)
        .then(data => setNotices(data.slice(0, 3)))
        .catch(() => {})
    }
    // Fetch this month's focus goal — drives the focus banner
    const n = new Date()
    const monthStr = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
    db.fetchPlayerGoal(studentUser.id, monthStr)
      .then(setMonthGoal)
      .catch(() => {})
  }, [])

  const loadData = async () => {
    try {
      const now   = new Date()
      const pad   = n => String(n).padStart(2, '0')
      const todayStr     = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      const todayDayName = DAYS[now.getDay()]
      const year  = now.getFullYear()
      const month = now.getMonth()

      const batchId = studentUser?.batch_id || studentUser?.batchId
      const [monthAtt, pays, batchRes] = await Promise.all([
        db.fetchStudentOwnAttendance(studentUser.id, year, month),
        db.fetchStudentOwnPayments(studentUser.id),
        batchId
          ? supabase.from('batches').select('days, start_time').eq('id', batchId).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      const batchDays  = batchRes?.data?.days || []
      const trainsToday = batchDays.length === 0 || batchDays.includes(todayDayName)
      setBatchInfo({ trainsToday, startTime: batchRes?.data?.start_time || null })

      // Deduplicate per date (best-status wins) — Daily students have MWF + TTS batch records
      const STATUS_PRI = { Present: 4, Late: 3, Leave: 2, Absent: 1 }
      const byDate = {}
      monthAtt.forEach(r => {
        const st = r.status || (r.present ? 'Present' : 'Absent')
        const cur = byDate[r.date]
        if (!cur || (STATUS_PRI[st] || 0) > (STATUS_PRI[cur] || 0)) byDate[r.date] = st
      })

      setTodayStatus(byDate[todayStr] || null)
      const presentDays = Object.values(byDate).filter(s => s === 'Present').length
      setMonthStats({ present: presentDays, total: Object.keys(byDate).length })
      setPayments(pays)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingData(false)
    }
  }

  const latestPayment = payments[0]
  const announceList  = notices

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      {/* Welcome */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-brand-200 text-sm mb-1">{greeting()},</p>
            <h1 className="text-2xl font-black mb-0.5">{studentUser?.name?.split(' ')[0]}</h1>
            <p className="text-brand-200 text-xs font-mono">{studentUser?.student_code} · {studentUser?.sport || 'Student'}</p>
            {studentUser?.batch && (
              <p className="text-brand-100 text-xs mt-1">{studentUser.batch} batch</p>
            )}
          </div>
          {/* Avatar + camera upload */}
          <div className="relative flex-shrink-0">
            {studentUser?.photo_url ? (
              <img src={studentUser.photo_url} alt="profile"
                className="w-16 h-16 rounded-2xl object-cover border-2 border-white/30" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl font-black text-white border-2 border-white/30">
                {studentUser?.name?.[0]?.toUpperCase()}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center border border-gray-100"
            >
              {uploading
                ? <span className="w-3.5 h-3.5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                : <Camera size={13} className="text-brand-600" />
              }
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </div>
        </div>
      </div>

      {/* This month's focus goal — taps through to full progress view */}
      {monthGoal && (
        <Link
          to="/student/progress"
          className="block bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-4 text-white shadow-md active:opacity-90 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Target size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-90">This month's focus</p>
              <p className="text-sm font-black leading-snug mt-0.5">{monthGoal.goal_text}</p>
            </div>
            <ChevronRight size={16} className="text-white/60 flex-shrink-0 mt-1" />
          </div>
        </Link>
      )}

      {/* Today's Scan button */}
      <Link
        to="/student/scan"
        className={`block w-full transition rounded-2xl p-5 text-white group ${
          batchInfo?.trainsToday === false
            ? 'bg-gray-400 cursor-default pointer-events-none'
            : 'bg-gray-900 hover:bg-gray-800'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              batchInfo?.trainsToday === false ? 'bg-gray-300' : 'bg-brand-600'
            }`}>
              {batchInfo?.trainsToday === false ? <Ban size={24} /> : <QrCode size={24} />}
            </div>
            <div>
              <p className="font-black text-lg leading-tight">Scan Gate QR</p>
              <p className="text-white/60 text-xs mt-0.5">
                {batchInfo?.trainsToday === false
                  ? 'No training today'
                  : todayStatus === 'Present'
                  ? '✓ Already marked present today'
                  : 'Mark your attendance at the gate'}
              </p>
            </div>
          </div>
          <ChevronRight size={20} className="text-white/30 group-hover:text-white transition" />
        </div>
      </Link>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarCheck size={16} className="text-brand-600" />
            <span className="text-xs font-semibold text-gray-500">This Month</span>
          </div>
          {loadingData ? (
            <div className="h-8 bg-gray-100 rounded animate-pulse" />
          ) : (
            <>
              <p className="text-3xl font-black text-gray-900">{monthStats?.present ?? 0}</p>
              <p className="text-xs text-gray-400">of {monthStats?.total ?? 0} days present</p>
            </>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            {batchInfo?.trainsToday === false
              ? <Ban size={16} className="text-gray-400" />
              : todayStatus === 'Present'
              ? <CheckCircle2 size={16} className="text-emerald-500" />
              : todayStatus === null
              ? <Clock size={16} className="text-amber-500" />
              : <XCircle size={16} className="text-red-500" />
            }
            <span className="text-xs font-semibold text-gray-500">Today</span>
          </div>
          <p className={`text-xl font-black ${
            batchInfo?.trainsToday === false ? 'text-gray-400'
            : todayStatus === 'Present' ? 'text-emerald-600'
            : todayStatus === null ? 'text-amber-500'
            : 'text-red-500'
          }`}>
            {batchInfo?.trainsToday === false ? 'No Training' : (todayStatus ?? 'Not Marked')}
          </p>
        </div>
      </div>

      {/* Fee alert — only shown when overdue or suspended */}
      {(studentUser?.status === 'Suspended' || (latestPayment && latestPayment.status !== 'Paid')) && (
        <Link to="/student/payments"
          className="flex items-center gap-4 bg-red-50 border border-red-200 rounded-2xl p-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <CreditCard size={18} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-red-700">Fees Overdue</p>
            <p className="text-xs text-red-400 mt-0.5">
              {latestPayment?.month
                ? `${latestPayment.month} — ₹${latestPayment.amount?.toLocaleString('en-IN')} unpaid`
                : 'Please clear your dues to continue'}
            </p>
          </div>
          <ChevronRight size={16} className="text-red-400 flex-shrink-0" />
        </Link>
      )}

      {/* Announcements */}
      {announceList.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-brand-600" />
              <span className="text-sm font-bold text-gray-900">Notices</span>
            </div>
            <Link to="/student/announcements" className="text-xs text-brand-600 font-semibold hover:underline">All</Link>
          </div>
          <div className="space-y-3">
            {announceList.map(a => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-2 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{a.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievement placeholder */}
      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center gap-3">
        <Trophy size={24} className="text-amber-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-bold text-amber-800">Keep it up!</p>
          <p className="text-xs text-amber-600">Scan QR daily to maintain perfect attendance</p>
        </div>
      </div>
    </div>
  )
}
