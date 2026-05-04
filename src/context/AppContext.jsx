import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as db from '../lib/db'
import {
  hashPassword, generateStudentCode, generateJoinCode, generateToken,
  getAdminSession, setAdminSession, clearAdminSession,
  getStudentSession, setStudentSession, clearStudentSession,
} from '../lib/auth'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  // role: null | 'admin' | 'student'
  const [role,        setRole]        = useState(null)
  const [user,        setUser]        = useState(null)   // admin user object
  const [studentUser, setStudentUser] = useState(null)   // student row from DB
  const [loading,     setLoading]     = useState(true)   // true on initial session restore

  const [students,       setStudents]       = useState([])
  const [payments,       setPayments]       = useState([])
  const [trials,         setTrials]         = useState([])
  const [batches,        setBatches]        = useState([])
  const [staff,          setStaff]          = useState([])
  const [attendanceData, setAttendanceData] = useState({})
  const [announcements,  setAnnouncements]  = useState([])
  const [toast,          setToast]          = useState(null)
  const [dataLoading,    setDataLoading]    = useState(false)   // true while loadAll() is running

  // ── Toast ──────────────────────────────────────────────
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Load admin data ────────────────────────────────────
  const loadAll = useCallback(async () => {
    setDataLoading(true)
    try {
      const [s, p, t, b, st, a] = await Promise.all([
        db.fetchStudents(),
        db.fetchPayments(),
        db.fetchTrials(),
        db.fetchBatches(),
        db.fetchStaff(),
        db.fetchAnnouncements(),
      ])
      setStudents(s); setPayments(p); setTrials(t)
      setBatches(b);  setStaff(st);   setAnnouncements(a)
      const today = new Date().toISOString().split('T')[0]
      const att = await db.fetchAttendanceForDate(today)
      setAttendanceData({ [today]: att })
    } catch (err) {
      console.error('Data load failed:', err)
      showToast('Could not connect to database', 'error')
    } finally {
      setDataLoading(false)
    }
  }, [])

  // ── Restore session on app open ────────────────────────
  useEffect(() => {
    async function restore() {
      // 1. Check admin session
      const adminSess = getAdminSession()
      if (adminSess) {
        setUser(adminSess)
        setRole('admin')
        setLoading(false)
        return
      }
      // 2. Check student session
      const stuSess = getStudentSession()
      if (stuSess?.token) {
        const student = await db.validateStudentSession(stuSess.token)
        if (student) {
          setStudentUser(student)
          setRole('student')
          setLoading(false)
          return
        }
        clearStudentSession()
      }
      setLoading(false)
    }
    restore()
  }, [])

  // Load admin data when admin logs in
  useEffect(() => {
    if (role === 'admin') loadAll()
  }, [role, loadAll])

  // ── Admin Auth ─────────────────────────────────────────
  const loginAdmin = (email) => {
    const userData = {
      name:    'Vikram Mehta',
      email,
      academy: 'Champions Sports Academy',
      role:    'Admin',
    }
    setAdminSession(userData)
    setUser(userData)
    setRole('admin')
  }

  const logoutAdmin = () => {
    clearAdminSession()
    setRole(null)
    setUser(null)
    setStudents([]); setPayments([])
    setTrials([]);   setBatches([])
    setStaff([]);    setAnnouncements([])
    setAttendanceData({})
  }

  // ── Student Auth ───────────────────────────────────────
  const loginStudent = async (studentCode, password) => {
    const hash = await hashPassword(password)
    const student = await db.loginStudentAccount(studentCode, hash)
    const token = generateToken()
    const expiresAt = await db.createStudentSession(student.id, token)
    setStudentSession(token, expiresAt, {
      id: student.id, studentCode: student.student_code, name: student.name,
    })
    setStudentUser(student)
    setRole('student')
    return student
  }

  const logoutStudent = async () => {
    const sess = getStudentSession()
    if (sess?.token) await db.deleteStudentSession(sess.token)
    clearStudentSession()
    setRole(null)
    setStudentUser(null)
  }

  const activateStudent = async (studentCode, joinCode, password) => {
    const hash = await hashPassword(password)
    const student = await db.activateStudentAccount(studentCode, joinCode, hash)
    return student
  }

  // ── Students (admin) ───────────────────────────────────
  const addStudent = async (s) => {
    try {
      const count = await db.fetchStudentCount()
      const studentCode = generateStudentCode(count)
      const joinCode    = generateJoinCode()
      const created = await db.createStudentAccount({ ...s, studentCode, joinCode })
      const mapped = {
        id:          created.id,
        name:        created.name,
        parent:      created.parent,
        phone:       created.phone,
        parentPhone: created.parent_phone,
        age:         created.age,
        sport:       created.sport,
        batch:       created.batch,
        batchId:     created.batch_id,
        joinDate:    created.join_date,
        status:      created.status,
        accountStatus: created.account_status,
        fees:        created.fees,
        paidTill:    created.paid_till,
        studentCode: created.student_code,
        joinCode:    created.join_code,
        feeAmount:   created.fee_amount,
        feeDueDay:   created.fee_due_day,
      }
      setStudents(prev => [...prev, mapped])
      showToast(`Student created — Code: ${studentCode} · Join Code: ${joinCode}`, 'success')
      return mapped
    } catch (err) {
      showToast(err.message || 'Failed to add student', 'error')
      throw err
    }
  }

  const updateStudentStatus = async (id, status) => {
    try {
      await db.updateStudentStatus(id, status)
      setStudents(prev => prev.map(s => s.id === id ? { ...s, status } : s))
      showToast(`Student marked as ${status}`)
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  const resetStudentPasswordAdmin = async (id) => {
    try {
      const newJoinCode = generateJoinCode()
      await db.resetStudentPassword(id, newJoinCode)
      setStudents(prev => prev.map(s =>
        s.id === id ? { ...s, accountStatus: 'pending', joinCode: newJoinCode } : s
      ))
      showToast(`Reset done — New Join Code: ${newJoinCode}`, 'info')
      return newJoinCode
    } catch (err) {
      showToast(err.message || 'Reset failed', 'error')
      throw err
    }
  }

  // Re-fetch students (so admin sees updated account_status)
  const refreshStudents = async () => {
    try {
      const s = await db.fetchStudents()
      setStudents(s)
    } catch { /* silent */ }
  }

  // ── Payments ───────────────────────────────────────────
  const addPayment = async (p) => {
    try {
      const invNum = String(payments.length + 1).padStart(3, '0')
      const invoiceId = `INV-2026-${invNum}`
      await db.insertPayment(p, invoiceId)
      setPayments(prev => [{
        ...p, id: invoiceId,
        date: new Date().toISOString().split('T')[0], status: 'Paid',
      }, ...prev])
      showToast('Payment recorded')
    } catch (err) {
      showToast(err.message || 'Payment failed', 'error')
    }
  }

  const markPaymentPaid = async (id, mode = 'UPI') => {
    try {
      await db.updatePaymentStatus(id, 'Paid', mode)
      setPayments(prev => prev.map(p =>
        p.id === id ? { ...p, status: 'Paid', mode, date: new Date().toISOString().split('T')[0] } : p
      ))
      showToast('Payment marked as paid')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Trials ─────────────────────────────────────────────
  const addTrial = async (t) => {
    try {
      const created = await db.insertTrial(t)
      setTrials(prev => [created, ...prev])
      showToast('Trial lead added')
    } catch (err) {
      showToast(err.message || 'Failed to add trial', 'error')
    }
  }

  const updateTrialStatus = async (id, updates) => {
    try {
      await db.updateTrial(id, updates)
      setTrials(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
      showToast('Trial updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Batches ────────────────────────────────────────────
  const addBatch = async (b) => {
    try {
      const created = await db.insertBatchV2(b)
      setBatches(prev => [...prev, {
        id:       created.id,
        name:     created.name,
        time:     created.time,
        sports:   created.sports || [],
        coach:    created.coach,
        capacity: created.capacity,
        enrolled: created.enrolled,
        waitlist: created.waitlist,
        days:     created.days || [],
        startTime: created.start_time,
        endTime:   created.end_time,
        ageMin:    created.age_min,
        ageMax:    created.age_max,
      }])
      showToast('Batch created')
    } catch (err) {
      showToast(err.message || 'Failed to create batch', 'error')
    }
  }

  // ── Staff ──────────────────────────────────────────────
  const addStaffMember = async (s) => {
    try {
      const created = await db.insertStaff(s)
      setStaff(prev => [...prev, created])
      showToast('Staff member added')
    } catch (err) {
      showToast(err.message || 'Failed to add staff', 'error')
    }
  }

  // ── Attendance ─────────────────────────────────────────
  const loadAttendanceForDate = async (date) => {
    if (attendanceData[date]) return
    try {
      const rec = await db.fetchAttendanceForDate(date)
      setAttendanceData(prev => ({ ...prev, [date]: rec }))
    } catch (err) {
      console.error('Attendance load failed:', err)
    }
  }

  const saveAttendance = async (date, records) => {
    try {
      await db.saveAttendanceForDate(date, records)
      setAttendanceData(prev => ({ ...prev, [date]: records }))
      showToast('Attendance saved')
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    }
  }

  // ── Announcements ──────────────────────────────────────
  const addAnnouncement = async (a) => {
    try {
      const ann = { ...a, author: user?.name || 'Admin' }
      const created = await db.insertAnnouncement(ann)
      setAnnouncements(prev => [created, ...prev])
      showToast('Announcement posted')
    } catch (err) {
      showToast(err.message || 'Failed to post', 'error')
    }
  }

  const isAuthenticated = role !== null

  return (
    <AppContext.Provider value={{
      // auth
      isAuthenticated, role, user, studentUser,
      loginAdmin, logoutAdmin,
      loginStudent, logoutStudent, activateStudent,
      loading, dataLoading,
      // admin data
      students, addStudent, updateStudentStatus, resetStudentPasswordAdmin, refreshStudents,
      payments, addPayment, markPaymentPaid,
      trials, addTrial, updateTrialStatus,
      batches, setBatches, addBatch,
      staff, addStaffMember,
      attendanceData, loadAttendanceForDate, saveAttendance,
      announcements, addAnnouncement,
      toast, showToast,
    }}>
      {children}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </AppContext.Provider>
  )
}

function Toast({ message, type }) {
  const colors = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-brand-600' }
  const icons  = { success: '✓', error: '✕', info: 'ℹ' }
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${colors[type] || colors.success} text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium animate-slide-up flex items-center gap-2 max-w-sm`}>
      <span>{icons[type] || icons.success}</span>
      {message}
    </div>
  )
}

export function useApp() {
  return useContext(AppContext)
}
