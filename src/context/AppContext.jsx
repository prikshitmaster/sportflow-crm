// ============================================================
// AppContext — owner-only production auth & global state
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import * as db from '../lib/db'
import {
  generateJoinCode, generateAcademyCode,
  hashPassword, generateToken,
  getStudentSession, setStudentSession, clearStudentSession,
  getStaffSession, setStaffSession, clearStaffSession,
} from '../lib/auth'
import { ALL_PERMISSIONS, ROLE_PRESETS } from '../lib/permissions'
import { logAudit, ACTIONS, diffObjects } from '../lib/audit'

const SPORT_KEY   = 'sf_selected_sport'
const SUSPEND_KEY = 'sf_suspend_days'
const getSuspendDays = () => Number(localStorage.getItem(SUSPEND_KEY) || 3)

const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// For non-monthly plans, fees IS the flat rate — no multiplication
function calcHistoricalPayment(joinDate, paidTill, fees, feePlan = 'monthly') {
  const start  = new Date((joinDate || paidTill) + 'T00:00:00')
  const end    = new Date(paidTill + 'T00:00:00')
  const months = Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1)
  const label  = months === 1
    ? `${MO[end.getMonth()]} ${end.getFullYear()}`
    : `${MO[start.getMonth()]}${start.getFullYear() !== end.getFullYear() ? ` ${start.getFullYear()}` : ''}–${MO[end.getMonth()]} ${end.getFullYear()}`
  const amount    = feePlan === 'monthly' ? fees * months : fees
  const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`
  return { monthsCovered: months, label, amount, startDate }
}

function resolveContextRole(profileRole) {
  if (profileRole === 'owner') return 'owner'
  return 'staff'
}

const AppContext = createContext(null)

export function AppProvider({ children }) {
  // ── Core auth state ───────────────────────────────────
  const [role,        setRole]        = useState(null)
  const [user,        setUser]        = useState(null)
  const [features,    setFeatures]    = useState({})
  const [permissions, setPermissions] = useState([])
  const [loading,     setLoading]     = useState(true)

  // ── Student portal state (custom auth) ───────────────
  const [studentUser,   setStudentUser]   = useState(null)
  const [academyLogo,   setAcademyLogo]   = useState(null)

  // ── Sport scoping (owner only) ────────────────────────
  const [selectedSport, setSelectedSportState] = useState(() => {
    try { return localStorage.getItem(SPORT_KEY) || null } catch { return null }
  })
  const setSelectedSport = useCallback((sport) => {
    setSelectedSportState(sport)
    try {
      if (sport) localStorage.setItem(SPORT_KEY, sport)
      else       localStorage.removeItem(SPORT_KEY)
    } catch {}
  }, [])

  const [suspendAfterDays, setSuspendAfterDaysState] = useState(getSuspendDays)
  const updateSuspendAfterDays = useCallback((n) => {
    localStorage.setItem(SUSPEND_KEY, String(n))
    setSuspendAfterDaysState(n)
  }, [])

  // ── Data state ─────────────────────────────────────────
  const [students,       setStudents]       = useState([])
  const [payments,       setPayments]       = useState([])
  const [trials,         setTrials]         = useState([])
  const [batches,        setBatches]        = useState([])
  const [staff,          setStaff]          = useState([])
  const [attendanceData, setAttendanceData] = useState({})
  const [announcements,  setAnnouncements]  = useState([])
  const [events,         setEvents]         = useState([])
  const [feePlans,       setFeePlans]       = useState([])
  const [branches,       setBranches]       = useState([])
  const [leaveRequests,  setLeaveRequests]  = useState([])
  const [toast,          setToast]          = useState(null)
  const [dataLoading,    setDataLoading]    = useState(false)

  // ── Toast ─────────────────────────────────────────────
  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const isFeatureOn = useCallback((name) => features[name] !== false, [features])

  const hasPermission = useCallback((perm) => {
    if (role === 'owner') return true
    return permissions.includes(perm)
  }, [role, permissions])

  // ── Load all academy-scoped data ──────────────────────
  const loadAll = useCallback(async () => {
    const academyId = user?.academyId
    if (!academyId) return
    setDataLoading(true)
    try {
      const [s, p, t, b, st, a, ev, fp] = await Promise.all([
        db.fetchStudents(academyId),
        db.fetchPayments(academyId),
        db.fetchTrials(academyId),
        db.fetchBatches(academyId),
        db.fetchStaff(academyId),
        db.fetchAnnouncements(academyId),
        db.fetchEvents(academyId),
        db.fetchFeePlans(academyId),
      ])
      setStudents(s); setPayments(p); setTrials(t)
      setBatches(b);  setStaff(st);   setAnnouncements(a)
      setEvents(ev);  setFeePlans(fp)

      // Auto-suspend overdue students after configurable grace period
      const now = new Date()
      try {
        const graceDays = getSuspendDays()
        const todayStr  = now.toISOString().split('T')[0]
        const toSuspend = s.filter(x => {
          if (x.status !== 'Active' || !x.paidTill) return false
          const diffMs   = now - new Date(x.paidTill + 'T00:00:00')
          const diffDays = Math.floor(diffMs / 86400000)
          return diffDays >= graceDays
        })
        if (toSuspend.length > 0) {
          await Promise.all(toSuspend.map(async (student) => {
            await db.suspendStudent(student.id)
            if (student.batchId) await db.updateBatchEnrolled(student.batchId, -1)
          }))
          setStudents(prev => prev.map(x => {
            if (!toSuspend.find(sus => sus.id === x.id)) return x
            return { ...x, status: 'Suspended', suspendedSince: todayStr }
          }))
          setBatches(prev => prev.map(batch => {
            const count = toSuspend.filter(x => x.batchId === batch.id).length
            return count > 0 ? { ...batch, enrolled: Math.max(0, (batch.enrolled || 0) - count) } : batch
          }))
          showToast(`${toSuspend.length} student${toSuspend.length > 1 ? 's' : ''} auto-suspended for overdue fees`, 'info')
        }
      } catch (suspendErr) {
        console.error('Auto-suspend failed:', suspendErr)
        showToast(`Auto-suspend error: ${suspendErr.message}`, 'error')
      }

      const today = now.toISOString().split('T')[0]
      const att = await db.fetchAttendanceForDate(today)
      setAttendanceData({ [today]: att })
    } catch (err) {
      console.error('Data load failed:', err)
      showToast('Could not connect to database', 'error')
    } finally {
      setDataLoading(false)
    }
  }, [user?.academyId])

  // ── Restore Supabase session on app open ──────────────
  useEffect(() => {
    async function restore() {
      try {
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
              id:          profile.id,
              name:        profile.name,
              email:       session.user.email,
              academy:     academy.name,
              academyId:   academy.id,
              joinCode:    academy.join_code,
              academyLogo: academy.logo_url || null,
              role:        profile.role,
              accessRole:  permsData?.access_role || 'staff',
            })
            setFeatures(flags)
            setPermissions(permsData?.permissions || ROLE_PRESETS[permsData?.access_role] || [])
            setRole(ctxRole)
            setLoading(false)
            return
          }
        }
        // 2. Check staff session (custom localStorage token)
        const stfSess = getStaffSession()
        if (stfSess?.token) {
          const member = await db.validateStaffSession(stfSess.token)
          if (member) {
            const academyId   = member.academy_id
            const [flags, academyData2] = await Promise.all([
              db.fetchFeatureFlags(academyId),
              academyId ? db.fetchAcademy(academyId).catch(() => null) : Promise.resolve(null),
            ])
            const academyName = academyData2?.name || ''
            const perms       = member.permissions?.length ? member.permissions : (ROLE_PRESETS[member.access_role] || ROLE_PRESETS['coach'])
            setUser({
              id:          member.id,
              name:        member.name,
              staffCode:   member.staff_code,
              staffType:   member.staff_type,
              photoUrl:    member.photo_url    || null,
              phone:       member.phone        || '',
              age:         member.age          || null,
              licenceUrl:  member.licence_url  || null,
              academy:     academyName,
              academyId,
              academyLogo: academyData2?.logo_url || null,
              role:        'staff',
              accessRole:  member.access_role  || 'coach',
            })
            setFeatures(flags)
            setPermissions(perms)
            setSelectedSport(null)
            setRole('staff')
            setLoading(false)
            return
          }
          clearStaffSession()
        }

        // 3. Check student session (custom localStorage token)
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
        console.error('Session restore failed:', err)
      }
      setLoading(false)
    }
    restore()
  }, [])

  // Load data whenever owner/staff logs in
  useEffect(() => {
    if (role === 'owner' || role === 'staff') loadAll()
  }, [role, loadAll])

  // Load branches when academy is known
  useEffect(() => {
    if (!user?.academyId) return
    db.fetchBranches(user.academyId).then(list => {
      if (list.length > 0) setBranches(list)
    }).catch(() => {})
  }, [user?.academyId])

  // ── Owner Auth ────────────────────────────────────────

  const signupOwner = async (email, password, name, academyName) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    const joinCode = generateAcademyCode()
    const academy  = await db.createAcademy(data.user.id, academyName, joinCode)
    await db.createProfile(data.user.id, 'owner', academy.id, name)
    await db.initDefaultFlags(academy.id)
    if (data.session) {
      const flags = await db.fetchFeatureFlags(academy.id)
      setUser({ id: data.user.id, name, email, academy: academyName, academyId: academy.id, joinCode, role: 'owner' })
      setFeatures(flags)
      setSelectedSport(null)
      setRole('owner')
      return { needsEmailConfirmation: false }
    }
    return { needsEmailConfirmation: true }
  }

  const loginOwner = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const profile = await db.fetchProfile(data.user.id)
    if (!profile) throw new Error('Account setup incomplete. Please contact support.')
    if (profile.role !== 'owner') throw new Error('This account is not an owner account.')
    const academy = await db.fetchAcademy(profile.academy_id)
    const flags   = await db.fetchFeatureFlags(profile.academy_id)
    setUser({ id: profile.id, name: profile.name, email, academy: academy.name, academyId: academy.id, joinCode: academy.join_code, academyLogo: academy.logo_url || null, role: 'owner' })
    setFeatures(flags)
    setSelectedSport(null)
    setRole('owner')
  }

  const logoutOwner = async () => {
    await supabase.auth.signOut().catch(() => {})
    setRole(null); setUser(null); setFeatures({}); setPermissions([])
    setStudents([]); setPayments([]); setTrials([])
    setBatches([]);  setStaff([]);   setAnnouncements([])
    setAttendanceData({}); setEvents([]); setLeaveRequests([])
    setSelectedSport(null)
  }

  const logoutAdmin = logoutOwner

  // ── Staff Auth ────────────────────────────────────────

  const loginStaff = async (email, password) => {
    const hash        = await hashPassword(password)
    const member      = await db.loginStaffAccount(email, hash)
    const token       = generateToken()
    const expiry      = await db.createStaffSession(member.id, token)
    const academyId   = member.academy_id
    const [flags, academyData, extra] = await Promise.all([
      db.fetchFeatureFlags(academyId),
      academyId ? db.fetchAcademy(academyId).catch(() => null) : Promise.resolve(null),
      db.fetchStaffProfileExtra(member.id),
    ])
    const academyName = academyData?.name || ''
    const perms = member.permissions?.length ? member.permissions : (ROLE_PRESETS[member.access_role] || ROLE_PRESETS['coach'])
    setStaffSession(token, expiry, { id: member.id, staffCode: member.staff_code, name: member.name })
    setUser({
      id:         member.id,
      name:       member.name,
      staffCode:  member.staff_code,
      staffType:  member.staff_type,
      photoUrl:   member.photo_url    || null,
      phone:      member.phone        || '',
      age:        extra.age           || null,
      licenceUrl: extra.licence_url   || null,
      academy:     academyName,
      academyId,
      academyLogo: academyData?.logo_url || null,
      role:        'staff',
      accessRole:  member.access_role  || 'coach',
    })
    setFeatures(flags)
    setPermissions(perms)
    setSelectedSport(null)
    setRole('staff')
  }

  const logoutStaff = async () => {
    const sess = getStaffSession()
    if (sess?.token) await db.deleteStaffSession(sess.token).catch(() => {})
    clearStaffSession()
    setRole(null); setUser(null); setFeatures({}); setPermissions([])
    setStudents([]); setPayments([]); setTrials([])
    setBatches([]);  setStaff([]);   setAnnouncements([])
    setAttendanceData({}); setEvents([]); setLeaveRequests([])
  }

  const activateStaff = async (staffCode, joinCode, password, profileData) => {
    const hash   = await hashPassword(password)
    const member = await db.activateStaffAccount(staffCode, joinCode, hash, profileData)
    return member
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
    if (sess?.token) await db.deleteStudentSession(sess.token).catch(() => {})
    clearStudentSession()
    setRole(null)
    setStudentUser(null)
  }

  const activateStudent = async (studentCode, joinCode, password) => {
    const hash = await hashPassword(password)
    return db.activateStudentAccount(studentCode, joinCode, hash)
  }

  // ── Feature flag toggle ───────────────────────────────
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

  // ── Students ──────────────────────────────────────────

  const addStudent = async (s) => {
    try {
      const studentCode = await db.fetchNextStudentCode()
      const joinCode    = generateJoinCode()
      let paidTill = s.paidTill || null
      if (paidTill && paidTill.length === 7) {
        const [yr, mo] = paidTill.split('-').map(Number)
        paidTill = new Date(yr, mo, 0).toISOString().split('T')[0]
      }
      const created = await db.createStudentAccount({ ...s, studentCode, joinCode, paidTill, academyId: user?.academyId })
      if (s.batchId) {
        await db.updateBatchEnrolled(s.batchId, 1)
        setBatches(prev => prev.map(b => b.id === s.batchId ? { ...b, enrolled: (b.enrolled || 0) + 1 } : b))
      }
      const mapped = {
        id:             created.id,
        name:           created.name,
        parent:         created.parent,
        phone:          created.phone,
        parentPhone:    created.parent_phone,
        age:            created.age,
        sport:          created.sport,
        batch:          created.batch,
        batchId:        created.batch_id,
        joinDate:       created.join_date,
        status:         created.status,
        accountStatus:  created.account_status,
        fees:           created.fees,
        paidTill:       created.paid_till || paidTill,
        studentCode:    created.student_code,
        joinCode:       created.join_code,
        feeAmount:      created.fee_amount,
        feeDueDay:      created.fee_due_day,
        lastBatchId:    null,
        lastBatchName:  null,
        suspendedSince: null,
        trainingType:   created.training_type || 'Daily',
        feePlan:        created.fee_plan || 'monthly',
      }
      // Immediately suspend if paidTill is already past the grace period
      const addNow  = new Date()
      const addDiff = paidTill ? Math.floor((addNow - new Date(paidTill + 'T00:00:00')) / 86400000) : 0
      if (addDiff >= getSuspendDays()) {
        try {
          await db.suspendStudent(created.id)
          mapped.status = 'Suspended'
          mapped.suspendedSince = addNow.toISOString().split('T')[0]
          if (s.batchId) {
            await db.updateBatchEnrolled(s.batchId, -1)
            setBatches(prev => prev.map(b => b.id === s.batchId
              ? { ...b, enrolled: Math.max(0, (b.enrolled || 0) - 1) } : b))
          }
        } catch (suspErr) {
          console.warn('Immediate auto-suspend on add failed:', suspErr)
        }
      }
      setStudents(prev => [...prev, mapped])

      // Auto-create historical payment if paidTill + fees are set
      if (paidTill && created.fees > 0) {
        const joinDateStr = s.joinDate || created.join_date || new Date().toISOString().split('T')[0]
        const { monthsCovered, label, amount, startDate } = calcHistoricalPayment(joinDateStr, paidTill, created.fees, s.feePlan || 'monthly')
        const pt = new Date(paidTill + 'T00:00:00')
        const invNum = await db.fetchNextInvoiceNum()
        const invoiceId = `INV-${pt.getFullYear()}-${String(invNum).padStart(3, '0')}`
        const payRow = {
          studentId: created.id, student: created.name,
          amount, month: label, date: startDate,
          status: 'Paid', mode: 'Cash', monthsCovered,
          academyId: user?.academyId,
        }
        await db.insertPayment(payRow, invoiceId)
        setPayments(prev => [{ ...payRow, id: invoiceId, paymentType: 'monthly', discountPct: 0 }, ...prev])
      }

      showToast(`Student created — Code: ${studentCode} · Join: ${joinCode}`, 'success')
      logAudit({ actor: user, action: ACTIONS.STUDENT_ADD, entityType: 'student', entityId: mapped.id, entityName: mapped.name, changes: { batch: mapped.batch || '—', sport: mapped.sport, fees: String(mapped.fees) }, academyId: user?.academyId })
      return mapped
    } catch (err) {
      showToast(err.message || 'Failed to add student', 'error')
      throw err
    }
  }

  const updateStudent = async (id, s) => {
    try {
      let paidTill = s.paidTill || null
      if (paidTill && paidTill.length === 7) {
        const [yr, mo] = paidTill.split('-').map(Number)
        paidTill = new Date(yr, mo, 0).toISOString().split('T')[0]
      }
      const oldStudent = students.find(x => x.id === id)
      const oldBatchId = oldStudent?.batchId ? Number(oldStudent.batchId) : null
      const newBatchId = s.batchId          ? Number(s.batchId)          : null
      const updated = await db.updateStudent(id, { ...s, paidTill })
      setStudents(prev => prev.map(x => x.id === id ? {
        ...x,
        name:         updated.name,
        parent:       updated.parent,
        phone:        updated.phone,
        parentPhone:  updated.parent_phone,
        age:          updated.age,
        sport:        updated.sport,
        batch:        updated.batch,
        batchId:      updated.batch_id,
        fees:         updated.fees,
        feeAmount:    updated.fee_amount,
        paidTill:     updated.paid_till,
        joinDate:     updated.join_date,
        trainingType: updated.training_type || 'Daily',
        feePlan:      updated.fee_plan || 'monthly',
      } : x))

      if (oldBatchId !== newBatchId) {
        if (oldBatchId) await db.updateBatchEnrolled(oldBatchId, -1)
        if (newBatchId) await db.updateBatchEnrolled(newBatchId,  1)
        setBatches(prev => prev.map(b => {
          if (b.id === oldBatchId) return { ...b, enrolled: Math.max(0, (b.enrolled || 0) - 1) }
          if (b.id === newBatchId) return { ...b, enrolled: (b.enrolled || 0) + 1 }
          return b
        }))
      }

      if (paidTill && updated.fees > 0) {
        const joinDateStr = s.joinDate || updated.join_date || new Date().toISOString().split('T')[0]
        const { monthsCovered, label, amount, startDate } = calcHistoricalPayment(joinDateStr, paidTill, updated.fees, s.feePlan || 'monthly')
        const existing = payments.find(p =>
          p.studentId === id && p.month === label && (p.status === 'Paid' || p.status === 'Pending')
        )
        if (!existing) {
          const pt = new Date(paidTill + 'T00:00:00')
          const invNum = await db.fetchNextInvoiceNum()
          const invoiceId = `INV-${pt.getFullYear()}-${String(invNum).padStart(3, '0')}`
          const payRow = {
            studentId: id, student: updated.name,
            amount, month: label, date: startDate,
            status: 'Paid', mode: 'Cash', monthsCovered,
            academyId: user?.academyId,
          }
          await db.insertPayment(payRow, invoiceId)
          setPayments(prev => [{ ...payRow, id: invoiceId, paymentType: 'monthly', discountPct: 0 }, ...prev])
        } else if (existing.amount !== amount) {
          await db.updatePaymentAmount(existing.id, amount, monthsCovered)
          setPayments(prev => prev.map(p => p.id === existing.id ? { ...p, amount, monthsCovered } : p))
        }
      }

      showToast('Student updated')
      const diff = diffObjects(
        oldStudent,
        { name: s.name, batch: s.batchName || s.batch, fees: Number(s.fees), paidTill, sport: s.sport, feePlan: s.feePlan, phone: s.phone },
        [
          { key: 'name' }, { key: 'batch', label: 'Batch' }, { key: 'fees', label: 'Fees' },
          { key: 'paidTill', label: 'Paid Till' }, { key: 'sport', label: 'Sport' },
          { key: 'feePlan', label: 'Fee Plan' }, { key: 'phone', label: 'Phone' },
        ]
      )
      logAudit({ actor: user, action: ACTIONS.STUDENT_EDIT, entityType: 'student', entityId: id, entityName: s.name || oldStudent?.name, changes: diff, academyId: user?.academyId })
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
      throw err
    }
  }

  const reactivateStudent = async (student) => {
    try {
      await db.reactivateStudent(student.id)
      if (student.batchId) {
        await db.updateBatchEnrolled(student.batchId, 1)
        setBatches(prev => prev.map(b => b.id === student.batchId
          ? { ...b, enrolled: (b.enrolled || 0) + 1 } : b))
      }
      setStudents(prev => prev.map(s => s.id === student.id ? {
        ...s, status: 'Active', suspendedSince: null,
      } : s))
      showToast(`${student.name} reactivated`)
      logAudit({ actor: user, action: ACTIONS.STUDENT_REACTIVATE, entityType: 'student', entityId: student.id, entityName: student.name, academyId: user?.academyId })
    } catch (err) {
      showToast(err.message || 'Reactivate failed', 'error')
    }
  }

  const deleteStudent = async (student) => {
    try {
      await db.deleteStudent(student.id)
      if (student.status !== 'Suspended' && student.batchId) {
        await db.updateBatchEnrolled(student.batchId, -1)
        setBatches(prev => prev.map(b => b.id === student.batchId
          ? { ...b, enrolled: Math.max(0, (b.enrolled || 0) - 1) } : b))
      }
      setStudents(prev => prev.filter(s => s.id !== student.id))
      setPayments(prev => prev.filter(p => p.studentId !== student.id))
      logAudit({ actor: user, action: ACTIONS.STUDENT_DELETE, entityType: 'student', entityId: student.id, entityName: student.name, changes: { batch: student.batch || '—', sport: student.sport }, academyId: user?.academyId })
      showToast(`${student.name} deleted`)
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  const suspendStudent = async (student) => {
    try {
      await db.suspendStudent(student.id)
      if (student.batchId) {
        await db.updateBatchEnrolled(student.batchId, -1)
        setBatches(prev => prev.map(b => b.id === student.batchId
          ? { ...b, enrolled: Math.max(0, (b.enrolled || 0) - 1) } : b))
      }
      const today = new Date().toISOString().split('T')[0]
      setStudents(prev => prev.map(s => s.id === student.id ? {
        ...s, status: 'Suspended', suspendedSince: today,
      } : s))
      showToast(`${student.name} suspended`)
      logAudit({ actor: user, action: ACTIONS.STUDENT_SUSPEND, entityType: 'student', entityId: student.id, entityName: student.name, academyId: user?.academyId })
    } catch (err) {
      showToast(err.message || 'Suspend failed', 'error')
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
      const resetS = students.find(x => x.id === id)
      logAudit({ actor: user, action: ACTIONS.STUDENT_RESET, entityType: 'student', entityId: id, entityName: resetS?.name, academyId: user?.academyId })
      return newJoin
    } catch (err) {
      showToast(err.message || 'Reset failed', 'error')
      throw err
    }
  }

  const refreshStudents = async () => {
    try { const s = await db.fetchStudents(user?.academyId); setStudents(s) } catch { /* silent */ }
  }

  // ── Payments ──────────────────────────────────────────

  const addPayment = async (p) => {
    try {
      const collectionDate = p.paymentDate ? new Date(p.paymentDate + 'T00:00:00') : new Date()
      // For advance payments, coverage starts from the month after the student's current paidTill
      const baseDate  = p.advanceStart ? new Date(p.advanceStart + 'T00:00:00') : collectionDate
      const months    = p.monthsCovered || (p.paymentType === 'quarterly' ? 3 : p.paymentType === 'yearly' ? 12 : 1)
      const paidTill  = new Date(baseDate.getFullYear(), baseDate.getMonth() + months, 0)
        .toISOString().split('T')[0]
      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      const endDate    = new Date(baseDate.getFullYear(), baseDate.getMonth() + months, 0)
      const monthLabel = months === 1
        ? `${MONTHS[baseDate.getMonth()]} ${baseDate.getFullYear()}`
        : `${MONTHS[baseDate.getMonth()]}–${MONTHS[endDate.getMonth()]} ${
            baseDate.getFullYear() === endDate.getFullYear()
              ? baseDate.getFullYear()
              : `${baseDate.getFullYear()}/${String(endDate.getFullYear()).slice(2)}`
          }`
      const payDate   = collectionDate.toISOString().split('T')[0]
      const nextNum   = await db.fetchNextInvoiceNum()
      const invoiceId = `INV-${collectionDate.getFullYear()}-${String(nextNum).padStart(3, '0')}`
      const paymentRow = { ...p, month: monthLabel, monthsCovered: months, amount: p.amount, date: payDate, academyId: user?.academyId }
      await db.insertPayment(paymentRow, invoiceId)

      const student = students.find(s => s.id === Number(p.studentId))
      if (student) {
        if (student.status === 'Suspended') {
          const batchId   = p.batchId   || student.batchId
          const batchName = p.batchName || student.batch
          await db.activateStudentWithBatch(student.id, batchId, batchName, paidTill, p.baseAmount)
          if (batchId) await db.updateBatchEnrolled(batchId, 1)
          setStudents(prev => prev.map(s => s.id === student.id ? {
            ...s, status: 'Active', batchId, batch: batchName,
            paidTill, fees: p.baseAmount || s.fees, feeAmount: p.baseAmount || s.fees,
            suspendedSince: null,
          } : s))
          showToast(`${student.name} reactivated → ${batchName || 'no batch'}`, 'success')
        } else {
          await db.updateStudentPaidTill(student.id, paidTill, p.baseAmount)
          setStudents(prev => prev.map(s => s.id === student.id ? {
            ...s, paidTill,
            fees: p.baseAmount || s.fees, feeAmount: p.baseAmount || s.fees,
          } : s))
        }
      }
      setPayments(prev => [{
        ...paymentRow, id: invoiceId,
        date: payDate, status: 'Paid', month: monthLabel,
      }, ...prev])
      logAudit({ actor: user, action: ACTIONS.PAYMENT_ADD, entityType: 'payment', entityId: invoiceId, entityName: p.student, changes: { amount: String(p.amount), months: String(months), mode: p.mode || 'Cash' }, academyId: user?.academyId })
      showToast('Payment recorded')
    } catch (err) {
      showToast(err.message || 'Payment failed', 'error')
    }
  }

  const updatePaymentDate = async (id, date) => {
    try {
      await db.updatePaymentDate(id, date)
      setPayments(prev => prev.map(p => p.id === id ? { ...p, date } : p))
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  const removePayment = async (payment) => {
    try {
      await db.deletePayment(payment.id)
      const remaining = payments.filter(p => p.id !== payment.id)
      setPayments(remaining)

      // Revert student's paid_till to their previous payment
      const student = students.find(s => s.id === Number(payment.studentId))
      if (student) {
        const prevPaid = remaining
          .filter(p => String(p.studentId) === String(payment.studentId) && p.status === 'Paid' && p.date)
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0]
        let newPaidTill = null
        if (prevPaid) {
          const d = new Date(prevPaid.date + 'T00:00:00')
          const m = prevPaid.monthsCovered || 1
          newPaidTill = new Date(d.getFullYear(), d.getMonth() + m, 0).toISOString().split('T')[0]
        }
        await db.updateStudentPaidTill(student.id, newPaidTill, null)
        setStudents(prev => prev.map(s => s.id === student.id ? { ...s, paidTill: newPaidTill } : s))
      }
      logAudit({ actor: user, action: ACTIONS.PAYMENT_REMOVE, entityType: 'payment', entityId: payment.id, entityName: payment.student, changes: { amount: String(payment.amount), month: payment.month || '—' }, academyId: user?.academyId })
      showToast('Payment deleted')
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  const markPaymentPaid = async (id, mode = 'UPI') => {
    try {
      await db.updatePaymentStatus(id, 'Paid', mode)
      setPayments(prev => prev.map(p =>
        p.id === id ? { ...p, status: 'Paid', mode, date: new Date().toISOString().split('T')[0] } : p
      ))
      const paidPay = payments.find(p => p.id === id)
      logAudit({ actor: user, action: ACTIONS.PAYMENT_PAID, entityType: 'payment', entityId: id, entityName: paidPay?.student, changes: { mode }, academyId: user?.academyId })
      showToast('Payment marked as paid')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Trials ────────────────────────────────────────────

  const addTrial = async (t) => {
    try {
      const created = await db.insertTrial({ ...t, academyId: user?.academyId })
      setTrials(prev => [created, ...prev])
      logAudit({ actor: user, action: ACTIONS.TRIAL_ADD, entityType: 'trial', entityId: created.id, entityName: t.name, changes: { sport: t.sport || '—', source: t.source || '—', date: t.trialDate || '—' }, academyId: user?.academyId })
      showToast('Trial lead added')
    } catch (err) {
      showToast(err.message || 'Failed to add trial', 'error')
    }
  }

  const updateTrialStatus = async (id, updates) => {
    try {
      await db.updateTrial(id, updates)
      const trial = trials.find(t => t.id === id)
      const isConvert = updates.converted === true
      const action = isConvert ? ACTIONS.TRIAL_CONVERT : ACTIONS.TRIAL_UPDATE
      setTrials(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
      logAudit({ actor: user, action, entityType: 'trial', entityId: id, entityName: trial?.name, changes: updates.status ? { status: { old: trial?.status, new: updates.status } } : {}, academyId: user?.academyId })
      showToast('Trial updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Batches ───────────────────────────────────────────

  const addBatch = async (b) => {
    try {
      const created = await db.insertBatchV2({ ...b, academyId: user?.academyId })
      setBatches(prev => [...prev, {
        id: created.id, name: created.name, code: created.code || null, time: created.time,
        sports: created.sports || [], coach: created.coach,
        capacity: created.capacity, enrolled: created.enrolled, waitlist: created.waitlist,
        days: created.days || [], startTime: created.start_time,
        endTime: created.end_time, ageMin: created.age_min, ageMax: created.age_max,
        ground: created.ground || null,
        defaultFee: created.default_fee || 0, defaultPlan: created.default_plan || 'monthly',
      }])
      logAudit({ actor: user, action: ACTIONS.BATCH_ADD, entityType: 'batch', entityId: created.id, entityName: created.name, changes: { sport: (b.sports || []).join(', '), capacity: String(b.capacity), coach: b.coach || '—' }, academyId: user?.academyId })
      showToast('Batch created')
    } catch (err) {
      showToast(err.message || 'Failed to create batch', 'error')
    }
  }

  const addFeePlan = async (plan) => {
    try {
      const created = await db.insertFeePlan({ ...plan, academyId: user?.academyId })
      setFeePlans(prev => [...prev, created])
      showToast('Plan created')
      return created
    } catch (err) { showToast(err.message || 'Failed', 'error'); throw err }
  }

  const editFeePlan = async (id, plan) => {
    try {
      await db.updateFeePlan(id, plan)
      setFeePlans(prev => prev.map(p => p.id === id ? { ...p, ...plan } : p))
      showToast('Plan updated')
    } catch (err) { showToast(err.message || 'Failed', 'error') }
  }

  const removeFeePlan = async (id) => {
    try {
      await db.deleteFeePlan(id)
      setFeePlans(prev => prev.filter(p => p.id !== id))
      showToast('Plan deleted')
    } catch (err) { showToast(err.message || 'Failed', 'error') }
  }

  const updateBatchFee = async (batchId, defaultFee, defaultPlan) => {
    try {
      await db.updateBatchFee(batchId, defaultFee, defaultPlan)
      setBatches(prev => prev.map(b => b.id === batchId
        ? { ...b, defaultFee: Number(defaultFee) || 0, defaultPlan: defaultPlan || 'monthly' }
        : b))
      showToast('Batch fee updated')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  const updateBatchCoach = async (batchId, coachName) => {
    try {
      const oldBatch = batches.find(b => b.id === batchId)
      await db.updateBatchCoach(batchId, coachName)
      setBatches(prev => prev.map(b => b.id === batchId ? { ...b, coach: coachName } : b))
      logAudit({ actor: user, action: ACTIONS.BATCH_COACH, entityType: 'batch', entityId: batchId, entityName: oldBatch?.name, changes: { Coach: { old: oldBatch?.coach || '—', new: coachName || '—' } }, academyId: user?.academyId })
      showToast('Coach assigned')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  const updateBatch = async (batchId, b) => {
    try {
      const oldBatch = batches.find(x => x.id === batchId)
      const updated = await db.updateBatch(batchId, b)
      setBatches(prev => prev.map(existing => existing.id === batchId ? {
        ...existing,
        name: updated.name, code: updated.code || null, time: updated.time,
        sports: updated.sports || [], coach: updated.coach,
        capacity: updated.capacity,
        days: updated.days || [], startTime: updated.start_time,
        endTime: updated.end_time, ageMin: updated.age_min, ageMax: updated.age_max,
        ground: updated.ground || null,
        defaultFee: updated.default_fee || 0, defaultPlan: updated.default_plan || 'monthly',
      } : existing))
      const batchDiff = diffObjects(oldBatch, { name: b.name, coach: b.coach, capacity: b.capacity }, [
        { key: 'name' }, { key: 'coach', label: 'Coach' }, { key: 'capacity', label: 'Capacity' },
      ])
      logAudit({ actor: user, action: ACTIONS.BATCH_EDIT, entityType: 'batch', entityId: batchId, entityName: b.name || oldBatch?.name, changes: batchDiff, academyId: user?.academyId })
      showToast('Batch updated')
      return updated
    } catch (err) {
      showToast(err.message || 'Failed to update batch', 'error')
    }
  }

  const deleteBatch = async (id) => {
    const delBatch = batches.find(b => b.id === id)
    await db.deleteBatch(id)
    setBatches(prev => prev.filter(b => b.id !== id))
    logAudit({ actor: user, action: ACTIONS.BATCH_DELETE, entityType: 'batch', entityId: id, entityName: delBatch?.name, academyId: user?.academyId })
    showToast('Batch deleted')
  }

  // ── Events ────────────────────────────────────────────

  const addEvent = async (e) => {
    try {
      const created = await db.insertEvent({ ...e, academyId: user?.academyId })
      setEvents(prev => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
      logAudit({ actor: user, action: ACTIONS.EVENT_ADD, entityType: 'event', entityId: created.id, entityName: e.title, changes: { type: e.type || '—', date: e.date || '—', venue: e.venue || '—' }, academyId: user?.academyId })
      showToast('Event added')
      return created
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
      throw err
    }
  }

  const updateEventStatus = async (id, status) => {
    try {
      const ev = events.find(e => e.id === id)
      await db.updateEventStatus(id, status)
      setEvents(prev => prev.map(e => e.id === id ? { ...e, status } : e))
      logAudit({ actor: user, action: ACTIONS.EVENT_UPDATE, entityType: 'event', entityId: id, entityName: ev?.title, changes: { status: { old: ev?.status, new: status } }, academyId: user?.academyId })
      showToast('Event updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  const updateEvent = async (id, fields) => {
    try {
      await db.updateEvent(id, fields)
      const ev = events.find(e => e.id === id)
      logAudit({ actor: user, action: ACTIONS.EVENT_UPDATE, entityType: 'event', entityId: id, entityName: ev?.title || fields.title, changes: fields.title ? { title: { old: ev?.title, new: fields.title } } : {}, academyId: user?.academyId })
      setEvents(prev => prev.map(e => e.id === id ? {
        ...e,
        ...(fields.title        !== undefined && { title:         fields.title }),
        ...(fields.type         !== undefined && { type:          fields.type }),
        ...(fields.sport        !== undefined && { sport:         fields.sport }),
        ...(fields.date         !== undefined && { date:          fields.date }),
        ...(fields.endDate      !== undefined && { end_date:      fields.endDate }),
        ...(fields.venue        !== undefined && { venue:         fields.venue }),
        ...(fields.description  !== undefined && { description:   fields.description }),
        ...(fields.audienceType !== undefined && { audience_type: fields.audienceType }),
        ...(fields.audienceIds  !== undefined && { audience_ids:  fields.audienceIds }),
        ...(fields.flyerUrl     !== undefined && { flyer_url:     fields.flyerUrl }),
        ...(fields.bracketType  !== undefined && { bracket_type:  fields.bracketType }),
        ...(fields.participants !== undefined && { participants:  fields.participants }),
      } : e))
      showToast('Event updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
      throw err
    }
  }

  const removeEvent = async (id) => {
    try {
      const ev = events.find(e => e.id === id)
      await db.deleteEvent(id)
      setEvents(prev => prev.filter(e => e.id !== id))
      logAudit({ actor: user, action: ACTIONS.EVENT_DELETE, entityType: 'event', entityId: id, entityName: ev?.title, academyId: user?.academyId })
      showToast('Event deleted')
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Staff HR ──────────────────────────────────────────

  const addStaffMember = async (s) => {
    const staffCode = await db.fetchNextStaffCode(s.staffType || 'coach')
    const joinCode  = generateJoinCode()
    const created   = await db.insertStaff({ ...s, academyId: user?.academyId, staffCode, joinCode })
    setStaff(prev => [...prev, {
      ...created,
      photoUrl:      created.photoUrl || null,
      userId:        null,
      accessRole:    null,
      permissions:   [],
      staffCode,
      joinCode:      null,
      staffType:     s.staffType || 'coach',
      accountStatus: 'pending',
    }])
    logAudit({ actor: user, action: ACTIONS.STAFF_ADD, entityType: 'staff', entityId: created.id, entityName: s.name, changes: { role: s.role || '—', sport: (s.sports || []).join(', ') || '—' }, academyId: user?.academyId })
    showToast('Staff member added')
    return { staffCode, joinCode }
  }

  const removeStaffMember = async (id) => {
    try {
      const member = staff.find(s => s.id === id)
      await db.deleteStaff(id)
      setStaff(prev => prev.filter(s => s.id !== id))
      logAudit({ actor: user, action: ACTIONS.STAFF_REMOVE, entityType: 'staff', entityId: id, entityName: member?.name, academyId: user?.academyId })
      showToast('Staff member removed')
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'error')
    }
  }

  const updateStaffProfile = async ({ name, phone, photoFile, age, licenceFile }) => {
    const id = user?.id
    if (!id) return
    let photoUrl   = undefined
    let licenceUrl = undefined
    if (photoFile)   photoUrl   = await db.uploadStaffPhoto(photoFile, name || user.name)
    if (licenceFile) licenceUrl = await db.uploadStaffLicence(licenceFile, id)
    await db.updateStaffProfile(id, { name, phone, photoUrl })
    if (age !== undefined || licenceUrl !== undefined) await db.upsertStaffProfileExtra(id, { age, licenceUrl })
    const updates = {}
    if (name     !== undefined) updates.name       = name
    if (phone    !== undefined) updates.phone      = phone
    if (photoUrl !== undefined) updates.photoUrl   = photoUrl
    if (age      !== undefined) updates.age        = age
    if (licenceUrl)             updates.licenceUrl = licenceUrl
    setUser(prev => ({ ...prev, ...updates }))
    setStaff(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    showToast('Profile updated')
  }

  const saveAcademyLogo = async (file) => {
    const url = await db.uploadAcademyLogo(file, user.academyId)
    await db.updateAcademyLogoUrl(user.academyId, url)
    setUser(prev => ({ ...prev, academyLogo: url }))
    setAcademyLogo(url)
    showToast('Logo updated')
    return url
  }

  const editStaffMember = async (id, { name, phone, photoFile, photoUrl: existingUrl, age }) => {
    let photoUrl = existingUrl
    if (photoFile) { try { photoUrl = await db.uploadStaffPhoto(photoFile, name) } catch (_) {} }
    await db.updateStaffProfile(id, { name, phone, photoUrl })
    if (age !== undefined) await db.upsertStaffProfileExtra(id, { age })
    setStaff(prev => prev.map(s => s.id === id ? { ...s, name, phone, photoUrl: photoUrl || s.photoUrl, age } : s))
    showToast('Staff updated')
  }

  const editStaffPermissions = async (staffId, { accessRole, permissions }) => {
    await db.updateStaffPermissions(staffId, { accessRole, permissions })
    setStaff(prev => prev.map(s => s.id === staffId ? { ...s, accessRole, permissions } : s))
    showToast('Permissions updated')
  }

  // ── Branches ──────────────────────────────────────────

  const addBranch = async (name) => {
    const trimmed = name.trim()
    if (!trimmed || branches.includes(trimmed)) return
    setBranches(prev => [...prev, trimmed].sort())
    if (user?.academyId) {
      try { await db.insertBranch(user.academyId, trimmed) } catch (err) {
        showToast(err.message || 'Failed to save branch', 'error')
        setBranches(prev => prev.filter(b => b !== trimmed))
      }
    }
  }

  const removeBranch = async (name) => {
    setBranches(prev => prev.filter(b => b !== name))
    if (user?.academyId) {
      try { await db.deleteBranch(user.academyId, name) } catch (err) {
        showToast(err.message || 'Failed to remove branch', 'error')
        setBranches(prev => [...prev, name].sort())
      }
    }
  }

  // ── Staff Portal Access / Invite ──────────────────────

  const inviteStaff = async (name, accessRole, permissions) => {
    try {
      const invite = await db.createInvite(user.academyId, user.academy, name, accessRole, permissions)
      logAudit({ actor: user, action: ACTIONS.STAFF_INVITE, entityType: 'staff', entityName: name, changes: { role: accessRole, permissions: permissions.join(', ') || '—' }, academyId: user?.academyId })
      return `${window.location.origin}/invite/${invite.token}`
    } catch (err) {
      showToast(err.message || 'Failed to create invite', 'error')
      throw err
    }
  }

  const updateStaffAccess = async (userId, accessRole, permissions) => {
    try {
      await db.updateAccessUser(userId, accessRole, permissions)
      showToast('Permissions updated')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
      throw err
    }
  }

  const revokeStaffAccess = async (userId) => {
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

  const loadLeaveRequests = async () => {
    if (!user?.id) return
    try {
      const data = role === 'owner'
        ? await db.fetchLeaveRequests()
        : await db.fetchMyLeaveRequests(user.id)
      setLeaveRequests(data)
    } catch { /* silent */ }
  }

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
      const ann     = { ...a, author: user?.name || 'Owner', academyId: user?.academyId }
      const created = await db.insertAnnouncement(ann)
      setAnnouncements(prev => [created, ...prev])
      logAudit({ actor: user, action: ACTIONS.ANNOUNCEMENT_ADD, entityType: 'announcement', entityId: created.id, entityName: a.title, changes: { type: a.type || '—' }, academyId: user?.academyId })
      showToast('Announcement posted')
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  const isAuthenticated = role !== null

  // ── Sport-scoped filtered views ───────────────────────
  // When selectedSport is null or 'All', pages get the full raw data (no filtering)
  // When set to a specific sport, pages see only that sport's slice
  const isAllSports = !selectedSport || selectedSport === 'All'

  const filteredStudents = useMemo(() =>
    isAllSports ? students : students.filter(s => s.sport === selectedSport)
  , [students, selectedSport, isAllSports])

  const filteredBatches = useMemo(() =>
    isAllSports ? batches : batches.filter(b => b.sports?.includes(selectedSport))
  , [batches, selectedSport, isAllSports])

  // Coaches with sports[] filtered by selectedSport;
  // Non-coach staff (empty sports[]) are kept visible everywhere — they're not sport-bound
  const filteredStaff = useMemo(() =>
    isAllSports
      ? staff
      : staff.filter(s => !s.sports?.length || s.sports.includes(selectedSport))
  , [staff, selectedSport, isAllSports])

  const filteredPayments = useMemo(() => {
    if (isAllSports) return payments
    const sportStudentIds = new Set(students.filter(s => s.sport === selectedSport).map(s => s.id))
    return payments.filter(p => sportStudentIds.has(p.studentId))
  }, [payments, students, selectedSport, isAllSports])

  const filteredTrials = useMemo(() =>
    isAllSports ? trials : trials.filter(t => t.sport === selectedSport)
  , [trials, selectedSport, isAllSports])

  return (
    <AppContext.Provider value={{
      // auth
      isAuthenticated, role, user, studentUser, loading, dataLoading,
      features, isFeatureOn, toggleFeature,
      permissions, hasPermission,
      // owner auth
      saveAcademyLogo,
      academyLogo: user?.academyLogo || academyLogo,
      signupOwner, loginOwner, logoutOwner, logoutAdmin,
      // staff auth
      loginStaff, logoutStaff, activateStaff,
      // student auth
      loginStudent, logoutStudent, activateStudent,
      // sport scoping
      selectedSport, setSelectedSport, isAllSports,
      // raw data (for SportSelect page and any page needing unfiltered data)
      allStudents: students, allStaff: staff, allBatches: batches,
      allPayments: payments, allTrials: trials,
      // data — auto-filtered by selectedSport
      students: filteredStudents, addStudent, updateStudent, deleteStudent, suspendStudent, reactivateStudent, updateStudentStatus, resetStudentPasswordAdmin, refreshStudents,
      payments: filteredPayments, addPayment, markPaymentPaid, removePayment, updatePaymentDate,
      trials: filteredTrials, addTrial, updateTrialStatus,
      refreshData: loadAll,
      batches: filteredBatches, setBatches, addBatch, updateBatchCoach, updateBatch, updateBatchFee, deleteBatch,
      feePlans, addFeePlan, editFeePlan, removeFeePlan,
      events, addEvent, updateEvent, updateEventStatus, removeEvent,
      staff: filteredStaff, addStaffMember, removeStaffMember, editStaffMember, editStaffPermissions,
      updateStaffProfile,
      branches, addBranch, removeBranch,
      attendanceData, loadAttendanceForDate, saveAttendance,
      announcements, addAnnouncement,
      leaveRequests, submitLeave, loadLeaveRequests, updateLeave,
      // staff portal management
      inviteStaff, updateStaffAccess, revokeStaffAccess,
      toast, showToast,
      suspendAfterDays, updateSuspendAfterDays,
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
