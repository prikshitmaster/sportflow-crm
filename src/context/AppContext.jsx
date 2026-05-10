// ============================================================
// AppContext — global state + auth for all 3 roles
//
// role: null | 'owner' | 'staff' | 'student'
//
// Owner / Staff → Supabase Auth (email + password)
//   Session is stored automatically by Supabase JS in localStorage
//   On reload: supabase.auth.getSession() restores it
//
// Student → custom auth (student_code + hashed password + DB token)
//   Session stored in localStorage under 'sf_student'
//
// features: { attendance: bool, payments: bool, … }
//   Owner can toggle these from Settings → Features
//   isFeatureOn(name) helper → returns true if flag is missing (default-on)
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import * as db from '../lib/db'
import {
  hashPassword, generateStudentCode, generateJoinCode,
  generateAcademyCode, generateToken,
  getStudentSession, setStudentSession, clearStudentSession,
} from '../lib/auth'
import { ALL_PERMISSIONS, ROLE_PRESETS } from '../lib/permissions'
import {
  students as mockStudents,
  payments  as mockPayments,
  trials    as mockTrials,
  batches   as mockBatches,
  staff     as mockStaff,
  attendance as mockAttendance,
  announcements as mockAnnouncements,
} from '../data/mockData'

// profiles.role is always 'owner' or 'staff'
// actual granular role lives in user_permissions.access_role
// ALL non-owner staff → mobile StaffLayout portal (coach or office)
function resolveContextRole(profileRole) {
  if (profileRole === 'owner') return 'owner'
  return 'staff'
}

const AppContext = createContext(null)

export function AppProvider({ children }) {
  // ── Core auth state ───────────────────────────────────
  const [role,        setRole]        = useState(null)   // 'owner' | 'staff' | 'student' | null
  const [user,        setUser]        = useState(null)   // { name, email, academy, academyId, role, accessRole }
  const [studentUser, setStudentUser] = useState(null)   // student DB row
  const [features,    setFeatures]    = useState({})     // { attendance: true, payments: false, … }
  const [permissions, setPermissions] = useState([])     // string[] — for admin/staff portal access
  const [loading,     setLoading]     = useState(true)   // true while session is being restored
  const [demoMode,    setDemoMode]    = useState(false)  // true = skip all Supabase fetches

  // ── Admin data (owner + staff) ─────────────────────────
  const [students,       setStudents]       = useState([])
  const [payments,       setPayments]       = useState([])
  const [trials,         setTrials]         = useState([])
  const [batches,        setBatches]        = useState([])
  const [staff,          setStaff]          = useState([])
  const [attendanceData, setAttendanceData] = useState({})
  const [announcements,  setAnnouncements]  = useState([])
  const [events,         setEvents]         = useState([])
  const [leaveRequests,  setLeaveRequests]  = useState([])   // owner: all; staff: their own
  const [branches,       setBranches]       = useState([])   // owner-managed branch/sport list
  const [toast,          setToast]          = useState(null)
  const [dataLoading,    setDataLoading]    = useState(false)

  // ── Toast helper ──────────────────────────────────────
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Check if a feature module is enabled ──────────────
  // Returns true when no flag exists (treat as on by default)
  const isFeatureOn = useCallback((name) => features[name] !== false, [features])

  // ── Permission check (owner always passes; admin/staff check their array) ──
  const hasPermission = useCallback((perm) => {
    if (role === 'owner') return true
    return permissions.includes(perm)
  }, [role, permissions])

  // ── Load all admin / owner data ───────────────────────
  const loadAll = useCallback(async () => {
    setDataLoading(true)
    try {
      const [s, p, t, b, st, a, ev] = await Promise.all([
        db.fetchStudents(),
        db.fetchPayments(),
        db.fetchTrials(),
        db.fetchBatches(),
        db.fetchStaff(),
        db.fetchAnnouncements(),
        db.fetchEvents(),
      ])
      setStudents(s); setPayments(p); setTrials(t)
      setBatches(b);  setStaff(st);   setAnnouncements(a)
      setEvents(ev)
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

  // ── Restore session on app open ───────────────────────
  useEffect(() => {
    async function restore() {
      try {
        // 1. Check Supabase session (owner / staff / admin)
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const profile = await db.fetchProfile(session.user.id)
          if (profile) {
            const academy = await db.fetchAcademy(profile.academy_id)
            const flags   = await db.fetchFeatureFlags(profile.academy_id)
            let permsData = null
            if (profile.role !== 'owner') {
              permsData = await db.fetchUserPermissions(session.user.id)
            }
            const ctxRole = resolveContextRole(profile.role)
            setUser({
              id:         profile.id,
              name:       profile.name,
              email:      session.user.email,
              academy:    academy.name,
              academyId:  academy.id,
              joinCode:   academy.join_code,
              role:       profile.role,
              accessRole: permsData?.access_role || 'staff',
            })
            setFeatures(flags)
            setPermissions(permsData?.permissions || ROLE_PRESETS[permsData?.access_role] || [])
            setRole(ctxRole)
            setLoading(false)
            return
          }
        }

        // 2. Check student session (custom localStorage token)
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
      } catch (err) {
        // Session restore failed — clear any stale state and go to login
        console.error('Session restore failed:', err)
      }
      setLoading(false)
    }
    restore()
  }, [])

  // Load data whenever owner/admin/staff logs in — skip in demo mode
  useEffect(() => {
    if ((role === 'owner' || role === 'staff') && !demoMode) loadAll()
  }, [role, loadAll, demoMode])

  // Load branches when academy is known
  useEffect(() => {
    if (!user?.academyId || demoMode) return
    db.fetchBranches(user.academyId).then(list => {
      if (list.length > 0) setBranches(list)
    }).catch(() => {})
  }, [user?.academyId, demoMode])

  // ── Owner Auth ────────────────────────────────────────

  const signupOwner = async (email, password, name, academyName) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error

    // Generate a short code that staff will use to join this academy
    const joinCode = generateAcademyCode()
    const academy  = await db.createAcademy(data.user.id, academyName, joinCode)
    await db.createProfile(data.user.id, 'owner', academy.id, name)
    await db.initDefaultFlags(academy.id)

    // If Supabase auto-confirms the email (no email verification), log in right away
    if (data.session) {
      const flags = await db.fetchFeatureFlags(academy.id)
      setUser({ id: data.user.id, name, email, academy: academyName, academyId: academy.id, joinCode, role: 'owner' })
      setFeatures(flags)
      setRole('owner')
      return { needsEmailConfirmation: false }
    }

    // Otherwise the user must verify their email first
    return { needsEmailConfirmation: true }
  }

  const loginOwner = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const profile = await db.fetchProfile(data.user.id)
    if (!profile) throw new Error('Account setup incomplete. Please contact support.')
    if (profile.role !== 'owner') throw new Error('This account is not an owner account. Use Staff login.')

    const academy = await db.fetchAcademy(profile.academy_id)
    const flags   = await db.fetchFeatureFlags(profile.academy_id)

    setUser({ id: profile.id, name: profile.name, email, academy: academy.name, academyId: academy.id, joinCode: academy.join_code, role: 'owner' })
    setFeatures(flags)
    setRole('owner')
  }

  const logoutOwner = async () => {
    await supabase.auth.signOut().catch(() => {})
    setRole(null); setUser(null); setFeatures({}); setPermissions([]); setDemoMode(false)
    setStudents([]); setPayments([]); setTrials([])
    setBatches([]);  setStaff([]);   setAnnouncements([])
    setAttendanceData({}); setEvents([]); setLeaveRequests([])
  }

  // Alias so older components that call logoutAdmin still work
  const logoutAdmin = logoutOwner

  // ── Staff Auth ────────────────────────────────────────

  const signupStaff = async (email, password, name, academyCode) => {
    // Verify the academy code first
    const academy = await db.findAcademyByCode(academyCode)
    if (!academy) throw new Error('Academy code not found. Ask your owner for the correct code.')

    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error

    await db.createProfile(data.user.id, 'staff', academy.id, name)

    if (data.session) {
      const flags = await db.fetchFeatureFlags(academy.id)
      setUser({ id: data.user.id, name, email, academy: academy.name, academyId: academy.id, role: 'staff' })
      setFeatures(flags)
      setRole('staff')
      return { needsEmailConfirmation: false }
    }
    return { needsEmailConfirmation: true }
  }

  const loginStaff = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    const profile = await db.fetchProfile(data.user.id)
    if (!profile) throw new Error('Staff profile not found. Please sign up first.')
    if (profile.role === 'owner') throw new Error('This is an owner account. Use Owner login.')

    const academy   = await db.fetchAcademy(profile.academy_id)
    const flags     = await db.fetchFeatureFlags(profile.academy_id)
    const permsData = await db.fetchUserPermissions(data.user.id)
    const perms     = permsData?.permissions || ROLE_PRESETS[permsData?.access_role] || []
    const ctxRole   = resolveContextRole(profile.role)

    setUser({ id: profile.id, name: profile.name, email, academy: academy.name, academyId: academy.id, role: profile.role, accessRole: permsData?.access_role || 'staff' })
    setFeatures(flags)
    setPermissions(perms)
    setRole(ctxRole)
  }

  const logoutStaff = async () => {
    await supabase.auth.signOut().catch(() => {})
    setRole(null); setUser(null); setFeatures({}); setPermissions([]); setDemoMode(false)
    setStudents([]); setPayments([]); setTrials([])
    setBatches([]);  setStaff([]);    setAnnouncements([])
    setAttendanceData({}); setEvents([]); setLeaveRequests([])
  }

  // ── Student Auth ──────────────────────────────────────

  const loginStudent = async (studentCode, password) => {
    const hash    = await hashPassword(password)
    const student = await db.loginStudentAccount(studentCode, hash)
    const token   = generateToken()
    const expiry  = await db.createStudentSession(student.id, token)
    setStudentSession(token, expiry, {
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
    return db.activateStudentAccount(studentCode, joinCode, hash)
  }

  // ── Feature flag toggle (owner only) ─────────────────
  const toggleFeature = async (feature, enabled) => {
    if (!user?.academyId) return
    try {
      await db.upsertFeatureFlag(user.academyId, feature, enabled)
      setFeatures(prev => ({ ...prev, [feature]: enabled }))
      showToast(`${feature} ${enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Students (owner / staff) ──────────────────────────

  const addStudent = async (s) => {
    try {
      const count       = await db.fetchStudentCount()
      const studentCode = generateStudentCode(count)
      const joinCode    = generateJoinCode()
      const created     = await db.createStudentAccount({ ...s, studentCode, joinCode })
      const mapped = {
        id:            created.id,
        name:          created.name,
        parent:        created.parent,
        phone:         created.phone,
        parentPhone:   created.parent_phone,
        age:           created.age,
        sport:         created.sport,
        batch:         created.batch,
        batchId:       created.batch_id,
        joinDate:      created.join_date,
        status:        created.status,
        accountStatus: created.account_status,
        fees:          created.fees,
        paidTill:      created.paid_till,
        studentCode:   created.student_code,
        joinCode:      created.join_code,
        feeAmount:     created.fee_amount,
        feeDueDay:     created.fee_due_day,
      }
      setStudents(prev => [...prev, mapped])
      showToast(`Student created — Code: ${studentCode} · Join: ${joinCode}`, 'success')
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
      const newJoin = generateJoinCode()
      await db.resetStudentPassword(id, newJoin)
      setStudents(prev => prev.map(s =>
        s.id === id ? { ...s, accountStatus: 'pending', joinCode: newJoin } : s
      ))
      showToast(`Reset done — New Join Code: ${newJoin}`, 'info')
      return newJoin
    } catch (err) {
      showToast(err.message || 'Reset failed', 'error')
      throw err
    }
  }

  const refreshStudents = async () => {
    try { const s = await db.fetchStudents(); setStudents(s) } catch { /* silent */ }
  }

  // ── Payments ──────────────────────────────────────────

  const addPayment = async (p) => {
    try {
      const invNum   = String(payments.length + 1).padStart(3, '0')
      const invoiceId = `INV-2026-${invNum}`
      await db.insertPayment(p, invoiceId)
      setPayments(prev => [{ ...p, id: invoiceId, date: new Date().toISOString().split('T')[0], status: 'Paid' }, ...prev])
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

  // ── Trials ────────────────────────────────────────────

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

  // ── Batches ───────────────────────────────────────────

  const addBatch = async (b) => {
    try {
      const created = await db.insertBatchV2(b)
      setBatches(prev => [...prev, {
        id: created.id, name: created.name, time: created.time,
        sports: created.sports || [], coach: created.coach,
        capacity: created.capacity, enrolled: created.enrolled, waitlist: created.waitlist,
        days: created.days || [], startTime: created.start_time,
        endTime: created.end_time, ageMin: created.age_min, ageMax: created.age_max,
        ground: created.ground || null,
      }])
      showToast('Batch created')
    } catch (err) {
      showToast(err.message || 'Failed to create batch', 'error')
    }
  }

  const updateBatchCoach = async (batchId, coachName) => {
    try {
      await db.updateBatchCoach(batchId, coachName)
      setBatches(prev => prev.map(b => b.id === batchId ? { ...b, coach: coachName } : b))
      showToast('Coach assigned')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  const updateBatch = async (batchId, b) => {
    try {
      const updated = await db.updateBatch(batchId, b)
      setBatches(prev => prev.map(existing => existing.id === batchId ? {
        ...existing,
        name: updated.name, time: updated.time,
        sports: updated.sports || [], coach: updated.coach,
        capacity: updated.capacity,
        days: updated.days || [], startTime: updated.start_time,
        endTime: updated.end_time, ageMin: updated.age_min, ageMax: updated.age_max,
        ground: updated.ground || null,
      } : existing))
      showToast('Batch updated')
      return updated
    } catch (err) {
      showToast(err.message || 'Failed to update batch', 'error')
    }
  }

  // ── Events ────────────────────────────────────────────

  const addEvent = async (e) => {
    try {
      const created = await db.insertEvent(e)
      setEvents(prev => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
      showToast('Event added')
      return created
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
      throw err
    }
  }

  const updateEventStatus = async (id, status) => {
    try {
      await db.updateEventStatus(id, status)
      setEvents(prev => prev.map(e => e.id === id ? { ...e, status } : e))
      showToast('Event updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  const removeEvent = async (id) => {
    try {
      await db.deleteEvent(id)
      setEvents(prev => prev.filter(e => e.id !== id))
      showToast('Event deleted')
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Staff (HR) ────────────────────────────────────────

  const addStaffMember = async (s) => {
    if (demoMode) {
      const newMember = { ...s, id: Date.now(), attendance: 100, userId: null, accessRole: null, permissions: [] }
      setStaff(prev => [...prev, newMember])
      showToast('Staff member added (demo)')
      return newMember
    }
    try {
      const created = await db.insertStaff(s)
      setStaff(prev => [...prev, { ...created, photoUrl: created.photoUrl || null, userId: null, accessRole: null, permissions: [] }])
      showToast('Staff member added')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  // ── Branches ──────────────────────────────────────────
  const addBranch = async (name) => {
    const trimmed = name.trim()
    if (!trimmed || branches.includes(trimmed)) return
    setBranches(prev => [...prev, trimmed].sort())
    if (!demoMode && user?.academyId) {
      try { await db.insertBranch(user.academyId, trimmed) } catch (err) {
        showToast(err.message || 'Failed to save branch', 'error')
        setBranches(prev => prev.filter(b => b !== trimmed))
      }
    }
  }

  const removeBranch = async (name) => {
    setBranches(prev => prev.filter(b => b !== name))
    if (!demoMode && user?.academyId) {
      try { await db.deleteBranch(user.academyId, name) } catch (err) {
        showToast(err.message || 'Failed to remove branch', 'error')
        setBranches(prev => [...prev, name].sort())
      }
    }
  }


  // ── Staff Access / Invite ─────────────────────────────

  const inviteStaff = async (name, accessRole, permissions) => {
    if (demoMode) {
      const fakeToken = 'demo-' + Math.random().toString(36).slice(2, 10)
      return `${window.location.origin}/invite/${fakeToken}`
    }
    try {
      const invite = await db.createInvite(user.academyId, user.academy, name, accessRole, permissions)
      return `${window.location.origin}/invite/${invite.token}`
    } catch (err) {
      showToast(err.message || 'Failed to create invite', 'error')
      throw err
    }
  }

  const updateStaffAccess = async (userId, accessRole, permissions) => {
    if (demoMode) {
      setStaff(prev => prev.map(s => s.userId === userId ? { ...s, accessRole, permissions } : s))
      showToast('Permissions updated')
      return
    }
    try {
      await db.updateAccessUser(userId, accessRole, permissions)
      showToast('Permissions updated')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
      throw err
    }
  }

  const revokeStaffAccess = async (userId) => {
    if (demoMode) {
      setStaff(prev => prev.map(s => s.userId === userId ? { ...s, userId: null, accessRole: null, permissions: [] } : s))
      showToast('Access revoked')
      return
    }
    try {
      await db.revokeAccessUser(userId)
      showToast('Access revoked')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
      throw err
    }
  }

  // ── Attendance ────────────────────────────────────────

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

  // ── Leave Requests ────────────────────────────────────

  // Staff: submit a new leave request
  const submitLeave = async (startDate, endDate, reason) => {
    if (!user?.id) return
    try {
      const created = await db.createLeaveRequest(user.id, user.name, startDate, endDate, reason)
      setLeaveRequests(prev => [created, ...prev])
      showToast('Leave request submitted')
      return created
    } catch (err) {
      showToast(err.message || 'Failed to submit leave', 'error')
      throw err
    }
  }

  // Load leave requests (owner: all staff; staff: their own)
  const loadLeaveRequests = async () => {
    if (!user?.id || demoMode) return
    try {
      const data = role === 'owner'
        ? await db.fetchLeaveRequests()
        : await db.fetchMyLeaveRequests(user.id)
      setLeaveRequests(data)
    } catch { /* silent */ }
  }

  // Owner: approve or reject
  const updateLeave = async (id, status) => {
    try {
      await db.updateLeaveStatus(id, status)
      setLeaveRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
      showToast(`Leave ${status.toLowerCase()}`)
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  // ── Announcements ─────────────────────────────────────

  const addAnnouncement = async (a) => {
    try {
      const ann     = { ...a, author: user?.name || 'Owner' }
      const created = await db.insertAnnouncement(ann)
      setAnnouncements(prev => [created, ...prev])
      showToast('Announcement posted')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  // ── Demo Login (no Supabase — uses mock data) ────────────
  const loginDemo = (demoRole) => {
    setDemoMode(true)
    const DEMO_BATCHES = [
      { id: 1, name: 'Morning A', time: '6:00 AM – 7:30 AM', sports: ['Football','Cricket'],     coach: 'Suresh Yadav',  capacity: 25, enrolled: 18, waitlist: 2, days: ['Monday','Wednesday','Friday'],  startTime: '6:00 AM',  endTime: '7:30 AM'  },
      { id: 2, name: 'Morning B', time: '7:30 AM – 9:00 AM', sports: ['Cricket','Martial Arts'],  coach: 'Pradeep Kumar', capacity: 20, enrolled: 16, waitlist: 0, days: ['Tuesday','Thursday','Saturday'], startTime: '7:30 AM',  endTime: '9:00 AM'  },
      { id: 3, name: 'Evening A', time: '4:00 PM – 5:30 PM', sports: ['Dance','Badminton'],       coach: 'Anita Singh',   capacity: 25, enrolled: 22, waitlist: 3, days: ['Monday','Wednesday','Friday'],  startTime: '4:00 PM',  endTime: '5:30 PM'  },
      { id: 4, name: 'Evening B', time: '5:30 PM – 7:00 PM', sports: ['Football','Dance'],        coach: 'Ravi Shankar',  capacity: 20, enrolled: 14, waitlist: 0, days: ['Tuesday','Thursday','Saturday'], startTime: '5:30 PM',  endTime: '7:00 PM'  },
      { id: 5, name: 'Weekend',   time: 'Sat–Sun 8:00–10:00 AM', sports: ['Tennis','Badminton'], coach: 'Monica Nair',   capacity: 15, enrolled: 12, waitlist: 1, days: ['Saturday','Sunday'],           startTime: '8:00 AM',  endTime: '10:00 AM' },
    ]
    const ALL_FEATURES = { attendance: true, payments: true, trials: true, batches: true, staff: true, reports: true, community: true, events: true }

    if (demoRole === 'owner') {
      setUser({ id: 'demo-owner', name: 'Demo Owner', email: 'owner@demo.sportflow', academy: 'SportFlow Academy', academyId: 'demo-acad', joinCode: 'DEMO01', role: 'owner' })
      setFeatures(ALL_FEATURES)
      setPermissions(ALL_PERMISSIONS)
      setRole('owner')
      setStudents(mockStudents)
      setPayments(mockPayments)
      setTrials(mockTrials)
      setBatches(DEMO_BATCHES)
      setStaff(mockStaff)
      setAnnouncements(mockAnnouncements)
      setAttendanceData(mockAttendance)
      setEvents([])
      setLeaveRequests([
        { id: 'dlr1', staff_id: 'demo-s2', staff_name: 'Pradeep Kumar', start_date: '2026-05-10', end_date: '2026-05-12', reason: 'Family function',      status: 'Pending',  created_at: '2026-05-08T10:00:00Z' },
        { id: 'dlr2', staff_id: 'demo-s3', staff_name: 'Anita Singh',    start_date: '2026-04-28', end_date: '2026-04-28', reason: 'Medical appointment', status: 'Approved', created_at: '2026-04-25T09:00:00Z' },
        { id: 'dlr3', staff_id: 'demo-s4', staff_name: 'Ravi Shankar',   start_date: '2026-04-15', end_date: '2026-04-15', reason: 'Personal work',       status: 'Rejected', created_at: '2026-04-12T11:00:00Z' },
      ])
      setBranches(['Badminton', 'Basketball', 'Cricket', 'Dance', 'Football', 'Martial Arts', 'Tennis'])
    } else if (demoRole === 'staff') {
      // Logs in as Suresh Yadav — Head Coach of Morning A
      setUser({ id: 'demo-staff', name: 'Suresh Yadav', email: 'coach@demo.sportflow', academy: 'SportFlow Academy', academyId: 'demo-acad', joinCode: 'DEMO01', role: 'staff', accessRole: 'coach' })
      setFeatures(ALL_FEATURES)
      setPermissions(ROLE_PRESETS.coach)
      setRole('staff')
      setStudents(mockStudents)
      setBatches(DEMO_BATCHES)
      setStaff(mockStaff)
      setAnnouncements(mockAnnouncements)
      setAttendanceData(mockAttendance)
      setEvents([])
      setLeaveRequests([
        { id: 'dlr4', staff_id: 'demo-staff', staff_name: 'Suresh Yadav', start_date: '2026-05-15', end_date: '2026-05-16', reason: 'Annual leave', status: 'Pending', created_at: '2026-05-07T14:00:00Z' },
      ])
    } else if (demoRole === 'student') {
      const s = mockStudents[0]  // Arjun Sharma — Morning A, Football
      setStudentUser({
        id: 'demo-stu1', name: s.name, parent_name: s.parent, phone: s.phone,
        sport: s.sport, batch: s.batch, age: s.age, join_date: s.joinDate,
        student_code: 'DEMO01', status: 'Active',
        fees_monthly: s.fees, paid_till: s.paidTill,
      })
      setRole('student')
    }
  }

  const isAuthenticated = role !== null

  return (
    <AppContext.Provider value={{
      // auth + session
      isAuthenticated, role, user, studentUser, loading, dataLoading, demoMode,
      features, isFeatureOn, toggleFeature,
      permissions, hasPermission,

      // owner
      signupOwner, loginOwner, logoutOwner, logoutAdmin,
      // staff
      signupStaff, loginStaff, logoutStaff,
      // student
      loginStudent, logoutStudent, activateStudent,
      // demo (no Supabase — instant mock login)
      loginDemo,

      // leave
      leaveRequests, submitLeave, loadLeaveRequests, updateLeave,
      // data
      students, addStudent, updateStudentStatus, resetStudentPasswordAdmin, refreshStudents,
      payments, addPayment, markPaymentPaid,
      trials, addTrial, updateTrialStatus,
      batches, setBatches, addBatch, updateBatchCoach, updateBatch,
      events, addEvent, updateEventStatus, removeEvent,
      staff, addStaffMember,
      branches, addBranch, removeBranch,
      attendanceData, loadAttendanceForDate, saveAttendance,
      announcements, addAnnouncement,
      // staff access / invite
      inviteStaff, updateStaffAccess, revokeStaffAccess,
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
