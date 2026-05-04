import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import {
  QrCode, CalendarCheck, CreditCard, Megaphone, CheckCircle2, XCircle,
  Clock, ChevronRight, Trophy,
} from 'lucide-react'

export default function StudentDashboard() {
  const { studentUser, announcements } = useApp()
  const [todayStatus,   setTodayStatus]   = useState(null)   // null | 'Present' | 'Absent'
  const [monthStats,    setMonthStats]    = useState(null)   // { present, total }
  const [payments,      setPayments]      = useState([])
  const [loadingData,   setLoadingData]   = useState(true)

  useEffect(() => {
    if (!studentUser?.id) return
    loadData()
  }, [studentUser])

  // Load announcements if not already loaded
  useEffect(() => {
    if (announcements.length === 0) {
      db.fetchAnnouncements().then(() => {}).catch(() => {})
    }
  }, [])

  const loadData = async () => {
    try {
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      const year  = today.getFullYear()
      const month = today.getMonth()

      const [monthAtt, pays] = await Promise.all([
        db.fetchStudentOwnAttendance(studentUser.id, year, month),
        db.fetchStudentOwnPayments(studentUser.id),
      ])

      // Today status
      const todayRow = monthAtt.find(r => r.date === todayStr)
      setTodayStatus(todayRow ? (todayRow.status || (todayRow.present ? 'Present' : 'Absent')) : null)

      // Month stats — count only working days up to today
      const present = monthAtt.filter(r => r.present || r.status === 'Present').length
      setMonthStats({ present, total: monthAtt.length })

      setPayments(pays)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingData(false)
    }
  }

  const latestPayment = payments[0]
  const announceList  = (announcements?.length ? announcements : []).slice(0, 3)

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
        <p className="text-brand-200 text-sm mb-1">{greeting()},</p>
        <h1 className="text-2xl font-black mb-0.5">{studentUser?.name?.split(' ')[0]}</h1>
        <p className="text-brand-200 text-xs font-mono">{studentUser?.student_code} · {studentUser?.sport || 'Student'}</p>
        {studentUser?.batch && (
          <p className="text-brand-100 text-xs mt-1">{studentUser.batch} batch</p>
        )}
      </div>

      {/* Today's Scan button */}
      <Link
        to="/student/scan"
        className="block w-full bg-gray-900 hover:bg-gray-800 transition rounded-2xl p-5 text-white group"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-brand-600 rounded-xl flex items-center justify-center">
              <QrCode size={24} />
            </div>
            <div>
              <p className="font-black text-lg leading-tight">Scan Gate QR</p>
              <p className="text-gray-400 text-xs mt-0.5">
                {todayStatus === 'Present'
                  ? '✓ Already marked present today'
                  : 'Mark your attendance at the gate'}
              </p>
            </div>
          </div>
          <ChevronRight size={20} className="text-gray-500 group-hover:text-white transition" />
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
            {todayStatus === 'Present'
              ? <CheckCircle2 size={16} className="text-emerald-500" />
              : todayStatus === null
              ? <Clock size={16} className="text-amber-500" />
              : <XCircle size={16} className="text-red-500" />
            }
            <span className="text-xs font-semibold text-gray-500">Today</span>
          </div>
          <p className={`text-xl font-black ${
            todayStatus === 'Present' ? 'text-emerald-600'
            : todayStatus === null ? 'text-amber-500'
            : 'text-red-500'
          }`}>
            {todayStatus ?? 'Not Marked'}
          </p>
        </div>
      </div>

      {/* Fee status */}
      {latestPayment && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CreditCard size={16} className="text-brand-600" />
              <span className="text-sm font-bold text-gray-900">Latest Payment</span>
            </div>
            <Link to="/student/payments" className="text-xs text-brand-600 font-semibold hover:underline">View all</Link>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{latestPayment.month}</p>
              <p className="text-xs text-gray-400">₹{latestPayment.amount?.toLocaleString('en-IN')}</p>
            </div>
            <span className={`badge ${
              latestPayment.status === 'Paid' ? 'badge-green'
              : latestPayment.status === 'Overdue' ? 'badge-red'
              : 'badge-yellow'
            }`}>{latestPayment.status}</span>
          </div>
        </div>
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
