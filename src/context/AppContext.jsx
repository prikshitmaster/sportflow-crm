import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as db from '../lib/db'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser]         = useState(null)
  const [loading, setLoading]   = useState(false)

  const [students,      setStudents]      = useState([])
  const [payments,      setPayments]      = useState([])
  const [trials,        setTrials]        = useState([])
  const [batches,       setBatches]       = useState([])
  const [staff,         setStaff]         = useState([])
  const [attendanceData,setAttendanceData]= useState({})
  const [announcements, setAnnouncements] = useState([])
  const [toast,         setToast]         = useState(null)

  // ── Load all data from Supabase after login ────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p, t, b, st, a] = await Promise.all([
        db.fetchStudents(),
        db.fetchPayments(),
        db.fetchTrials(),
        db.fetchBatches(),
        db.fetchStaff(),
        db.fetchAnnouncements(),
      ])
      setStudents(s)
      setPayments(p)
      setTrials(t)
      setBatches(b)
      setStaff(st)
      setAnnouncements(a)

      // Load today's attendance
      const today = new Date().toISOString().split('T')[0]
      const att = await db.fetchAttendanceForDate(today)
      setAttendanceData({ [today]: att })
    } catch (err) {
      console.error('Failed to load data:', err)
      showToast('Could not connect to database', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Auth ───────────────────────────────────────────────
  const login = async (email) => {
    setUser({ name: 'Vikram Mehta', email, academy: 'Champions Sports Academy', role: 'Admin' })
    setIsAuthenticated(true)
  }

  useEffect(() => {
    if (isAuthenticated) loadAll()
  }, [isAuthenticated, loadAll])

  const logout = () => {
    setIsAuthenticated(false)
    setUser(null)
    setStudents([])
    setPayments([])
  }

  // ── Toast ──────────────────────────────────────────────
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Students ───────────────────────────────────────────
  const addStudent = async (s) => {
    try {
      const created = await db.insertStudent(s)
      setStudents(prev => [...prev, created])
      showToast('Student added successfully')
    } catch (err) {
      showToast(err.message || 'Failed to add student', 'error')
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

  // ── Payments ───────────────────────────────────────────
  const addPayment = async (p) => {
    try {
      const invNum = String(payments.length + 1).padStart(3, '0')
      const invoiceId = `INV-2026-${invNum}`
      await db.insertPayment(p, invoiceId)
      setPayments(prev => [{
        ...p, id: invoiceId,
        date: new Date().toISOString().split('T')[0],
        status: 'Paid',
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
      const created = await db.insertBatch(b)
      setBatches(prev => [...prev, created])
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
    if (attendanceData[date]) return  // already loaded
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

  return (
    <AppContext.Provider value={{
      isAuthenticated, user, login, logout, loading,
      students, addStudent, updateStudentStatus,
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
    <div className={`fixed bottom-6 right-6 z-50 ${colors[type] || colors.success} text-white px-5 py-3 rounded-xl shadow-xl text-sm font-medium animate-slide-up flex items-center gap-2`}>
      <span>{icons[type] || icons.success}</span>
      {message}
    </div>
  )
}

export function useApp() {
  return useContext(AppContext)
}
