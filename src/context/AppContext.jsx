// ============================================================
// AppContext — owner-only production auth & global state
// ============================================================

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
import { logger } from '../lib/logger'
import { notify } from '../lib/notifications'

// Module-level in-flight payment lock — survives across renders, isolated per tab.
// Used to refuse rapid duplicate submissions before any network round-trip.
const _paymentInFlight = new Set()

// ── Ops activity session tracking (powers /ops/live) ─────────
const _ops = { uuid: null, interval: null }

function _getDevice() {
  try {
    const ua  = navigator.userAgent
    const mob = /Mobi|Android|iPhone|iPad/i.test(ua)
    const br  = /Edg/i.test(ua)     ? 'Edge'
              : /Chrome/i.test(ua)  ? 'Chrome'
              : /Firefox/i.test(ua) ? 'Firefox'
              : /Safari/i.test(ua)  ? 'Safari'
              : 'Browser'
    return `${mob ? 'Mobile' : 'Desktop'} · ${br}`
  } catch { return 'Unknown' }
}

async function _startOps(userType, userId, userName, academyId, academyName) {
  try {
    const uuid = await db.startActivitySession({
      userType, userId: userId ? String(userId) : null,
      userName, academyId, academyName, device: _getDevice(),
    })
    _ops.uuid = uuid
    clearInterval(_ops.interval)
    _ops.interval = setInterval(() => {
      if (_ops.uuid) db.heartbeatActivitySession(_ops.uuid).catch(() => {})
    }, 90_000)
  } catch {}
}

async function _endOps() {
  if (!_ops.uuid) return
  clearInterval(_ops.interval)
  _ops.interval = null
  const u = _ops.uuid
  _ops.uuid = null
  await db.endActivitySession(u).catch(() => {})
}

const SPORT_KEY        = 'sf_selected_sport'
const BRANCH_KEY       = 'sf_selected_branch'   // sport_branches.id (uuid) or null
const SUSPEND_KEY      = 'sf_suspend_days'
const SUSPEND_RUN_KEY  = 'sf_last_auto_suspend_at'  // throttle per-tab to avoid audit spam
const SUSPEND_THROTTLE_MS = 60 * 60 * 1000  // 1 hour
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

  // ── Branch scoping (within a sport — owner drill-in or branch manager) ──
  // Stored as the sport_branches.id (uuid). null = all branches of the sport.
  const [sportBranches, setSportBranches] = useState([])   // [{id, sportName, branchName, createdAt}]
  const [selectedBranch, setSelectedBranchState] = useState(() => {
    try { return localStorage.getItem(BRANCH_KEY) || null } catch { return null }
  })
  const setSelectedBranch = useCallback((branchId) => {
    setSelectedBranchState(branchId)
    try {
      if (branchId) localStorage.setItem(BRANCH_KEY, branchId)
      else          localStorage.removeItem(BRANCH_KEY)
    } catch {}
  }, [])
  // Clearing the sport also clears the branch
  const setSelectedSportAndBranch = useCallback((sport, branchId = null) => {
    setSelectedSport(sport)
    setSelectedBranch(branchId)
  }, [setSelectedSport, setSelectedBranch])

  // Wrapper: auto-injects the active sport + branch so every audit entry is branch-scoped.
  const logAuditSport = useCallback((args) =>
    logAudit({ ...args, sport: selectedSport || null, branchId: selectedBranch || null })
  , [selectedSport, selectedBranch])

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
  const [trialSources,   setTrialSources]   = useState([])
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
  const loadAll = useCallback(async (isRetry = false) => {
    const academyId = user?.academyId
    if (!academyId) return
    setDataLoading(true)
    try {
      // STUDENTS_PAGE_SIZE caps the initial roster pull. 1000 covers ~99% of
      // single-academy customers — academies that grow past this will see a
      // console warn and need follow-up to paginate properly (chunked load).
      // Until then, dashboard sees the first 1000 by name and pages that filter
      // by sport/branch still work correctly within that slice.
      const STUDENTS_PAGE_SIZE = 1000
      const [studentsPage, p, t, b, st, a, ev, fp, ts] = await Promise.all([
        db.fetchStudentsPaginated(academyId, { page: 0, pageSize: STUDENTS_PAGE_SIZE }),
        db.fetchPayments(academyId),
        db.fetchTrials(academyId),
        db.fetchBatches(academyId),
        db.fetchStaff(academyId),
        db.fetchAnnouncements(academyId),
        db.fetchEvents(academyId),
        db.fetchFeePlans(academyId),
        db.fetchTrialSources(academyId).catch(() => []),
      ])
      const s = studentsPage.students
      if (studentsPage.total > STUDENTS_PAGE_SIZE) {
        // Hard-flag this so we don't quietly serve stale rosters at scale.
        // eslint-disable-next-line no-console
        console.warn(
          `[AppContext] Roster paginated: showing ${s.length} of ${studentsPage.total} students. ` +
          `Increase STUDENTS_PAGE_SIZE or add chunked loading to avoid missing rows.`
        )
      }
      setStudents(s); setPayments(p); setTrials(t)
      setBatches(b);  setStaff(st);   setAnnouncements(a)
      setEvents(ev);  setFeePlans(fp); setTrialSources(ts)

      // Auto-suspend overdue students after configurable grace period.
      // Throttled to once per hour per browser so re-mounting AppProvider (sport switch,
      // logout/login, manual refresh) doesn't re-run the whole loop and spam the audit log.
      const now = new Date()
      let lastRunAt = 0
      try { lastRunAt = Number(localStorage.getItem(SUSPEND_RUN_KEY)) || 0 } catch {}
      const sinceLastRun = now.getTime() - lastRunAt
      try {
        if (sinceLastRun < SUSPEND_THROTTLE_MS) {
          // Skipped — recently ran. Don't even compute the list.
        } else {
        const graceDays = getSuspendDays()
        const todayStr  = now.toISOString().split('T')[0]
        const toSuspend = s.filter(x => {
          if (x.status !== 'Active' || !x.paidTill) return false
          const diffMs   = now - new Date(x.paidTill + 'T00:00:00')
          const diffDays = Math.floor(diffMs / 86400000)
          return diffDays >= graceDays
        })
        // Mark the run timestamp regardless of whether anyone was suspended —
        // empty pass also means "we checked, nothing to do for an hour."
        try { localStorage.setItem(SUSPEND_RUN_KEY, String(now.getTime())) } catch {}
        if (toSuspend.length > 0) {
          // Suspend students in parallel — safe, each touches a different student row
          await Promise.all(toSuspend.map(s => db.suspendStudent(s.id)))
          // Group by batch and decrement each batch ONCE with total count.
          // Avoids read-modify-write race when multiple students from the same batch suspend together.
          const batchDeltas = {}
          toSuspend.forEach(s => {
            if (s.batchId) batchDeltas[s.batchId] = (batchDeltas[s.batchId] || 0) - 1
          })
          await Promise.all(
            Object.entries(batchDeltas).map(([batchId, delta]) =>
              db.updateBatchEnrolled(batchId, delta)
            )
          )
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
        }  // end throttle else
      } catch (suspendErr) {
        console.error('Auto-suspend failed:', suspendErr)
        showToast(`Auto-suspend error: ${suspendErr.message}`, 'error')
      }

      // LOCAL date (not UTC) — toISOString() would return previous day in early-morning IST
      const pad2 = (n) => String(n).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
      const att = await db.fetchAttendanceForDate(today)
      setAttendanceData({ [today]: att })
    } catch (err) {
      logger.error('loadAll failed', err, { role, academyId: user?.academyId })
      if (!isRetry) {
        // Auto-retry once after 2s — handles mobile network not ready on app wake
        setTimeout(() => loadAll(true), 2000)
      } else {
        showToast('Could not connect to database', 'error')
      }
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
            _startOps(ctxRole, profile.id, profile.name, academy.id, academy.name)
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
            _startOps('staff', member.id, member.name, academyId, academyName)
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
            _startOps('student', student.id, student.name, student.academy_id, '')
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

  // End ops session on tab close / page unload (best-effort)
  useEffect(() => {
    const handler = () => { if (_ops.uuid) db.endActivitySession(_ops.uuid).catch(() => {}) }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Load data whenever owner/staff logs in
  useEffect(() => {
    if (role === 'owner' || role === 'staff') loadAll()
  }, [role, loadAll])

  // Re-fetch when app comes back to foreground (mobile PWA wakes from background).
  // Throttled to once per 5 min — without this, every tab focus re-downloads the
  // full students/payments/batches/staff payload (~6MB at 1000 students).
  const lastRefreshRef = useRef(Date.now())
  useEffect(() => {
    if (role !== 'owner' && role !== 'staff') return
    const REFRESH_THROTTLE_MS = 5 * 60 * 1000
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return
      lastRefreshRef.current = now
      loadAll()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [role, loadAll])

  // Load branches when academy is known. Always replace state — even if the DB
  // returns an empty list, so newly-added sports (e.g. Tennis) are picked up by
  // the next refresh and stale ones go away.
  const refreshBranches = useCallback(async () => {
    if (!user?.academyId) return
    try {
      const list = await db.fetchBranches(user.academyId)
      setBranches(list || [])
    } catch { /* keep prior */ }
  }, [user?.academyId])
  useEffect(() => { refreshBranches() }, [refreshBranches])

  // Load sport_branches (proper branches under sports) when academy is known
  const refreshSportBranches = useCallback(async () => {
    if (!user?.academyId) return
    try {
      const list = await db.fetchSportBranches(user.academyId)
      setSportBranches(list)
    } catch {}
  }, [user?.academyId])
  useEffect(() => { refreshSportBranches() }, [refreshSportBranches])

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
    // First request after a new JWT can be silently blocked by PostgREST before the
    // token propagates — retry once with a short delay to avoid the 1-second error flash
    let profile = await db.fetchProfile(data.user.id)
    if (!profile) {
      await new Promise(r => setTimeout(r, 200))
      profile = await db.fetchProfile(data.user.id)
    }
    if (!profile) throw new Error('Account setup incomplete. Please contact support.')
    if (profile.role !== 'owner') throw new Error('This account is not an owner account.')
    const academy = await db.fetchAcademy(profile.academy_id)
    const flags   = await db.fetchFeatureFlags(profile.academy_id)
    setUser({ id: profile.id, name: profile.name, email, academy: academy.name, academyId: academy.id, joinCode: academy.join_code, academyLogo: academy.logo_url || null, role: 'owner' })
    setFeatures(flags)
    setSelectedSport(null)
    setRole('owner')
    _startOps('owner', profile.id, profile.name, academy.id, academy.name)
  }

  const logoutOwner = async () => {
    await _endOps()
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
    logAudit({
      actor: { id: member.id, name: member.name, role: 'Staff', accessRole: member.access_role },
      action: ACTIONS.AUTH_STAFF_LOGIN, entityType: 'auth',
      entityId: member.id, entityName: member.name, academyId,
    })
    _startOps('staff', member.id, member.name, academyId, academyName)
  }

  const logoutStaff = async () => {
    await _endOps()
    const sess = getStaffSession()
    if (user?.id) {
      logAudit({
        actor: { id: user.id, name: user.name, role: 'Staff', accessRole: user.accessRole },
        action: ACTIONS.AUTH_STAFF_LOGOUT, entityType: 'auth',
        entityId: user.id, entityName: user.name, academyId: user.academyId,
      })
    }
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
    logAudit({
      actor: { id: member.id, name: member.name, role: 'Staff', accessRole: member.access_role },
      action: ACTIONS.AUTH_STAFF_ACTIVATE, entityType: 'auth',
      entityId: member.id, entityName: member.name, academyId: member.academy_id,
    })
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
    logAudit({
      actor: { id: student.id, name: student.name, role: 'Student' },
      action: ACTIONS.AUTH_STUDENT_LOGIN, entityType: 'auth',
      entityId: student.id, entityName: student.name, academyId: student.academy_id,
    })
    _startOps('student', student.id, student.name, student.academy_id, '')
    return student
  }

  const logoutStudent = async () => {
    await _endOps()
    const sess = getStudentSession()
    if (studentUser?.id) {
      logAudit({
        actor: { id: studentUser.id, name: studentUser.name, role: 'Student' },
        action: ACTIONS.AUTH_STUDENT_LOGOUT, entityType: 'auth',
        entityId: studentUser.id, entityName: studentUser.name, academyId: studentUser.academy_id,
      })
    }
    if (sess?.token) await db.deleteStudentSession(sess.token).catch(() => {})
    clearStudentSession()
    setRole(null)
    setStudentUser(null)
  }

  const activateStudent = async (studentCode, joinCode, password) => {
    const hash = await hashPassword(password)
    const result = await db.activateStudentAccount(studentCode, joinCode, hash)
    logAudit({
      actor: { id: result?.id || null, name: result?.name || studentCode, role: 'Student' },
      action: ACTIONS.AUTH_STUDENT_ACTIVATE, entityType: 'auth',
      entityId: result?.id || studentCode, entityName: result?.name || studentCode,
      academyId: result?.academy_id || null,
    })
    return result
  }

  const updateStudentPhoto = async (file) => {
    const photoUrl = await db.uploadStudentPhoto(file, studentUser.id)
    await db.updateStudentPhotoUrl(studentUser.id, photoUrl)
    setStudentUser(prev => ({ ...prev, photo_url: photoUrl }))
    return photoUrl
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
    if (!user?.academyId) {
      showToast('Session expired — please log out and log in again', 'error')
      return
    }
    try {
      await supabase.auth.refreshSession()
      const studentCode = await db.fetchNextStudentCode()
      const joinCode    = generateJoinCode()

      // Normalise paidTill ("2026-05" → "2026-05-31")
      let paidTill = s.paidTill || null
      if (paidTill && paidTill.length === 7) {
        const [yr, mo] = paidTill.split('-').map(Number)
        paidTill = new Date(yr, mo, 0).toISOString().split('T')[0]
      }

      // Decide suspend-now BEFORE the write, so the RPC can apply it atomically
      const addNow    = new Date()
      const addDiff   = paidTill ? Math.floor((addNow - new Date(paidTill + 'T00:00:00')) / 86400000) : 0
      const suspendNow = addDiff >= getSuspendDays()

      // Pre-compute historical payment fields if applicable
      const fees        = Number(s.fees) || 0
      const trialDeduct = s.fromTrial ? (Number(s.trialFeePaid) || 0) : 0
      const joiningFee  = Number(s.joiningFee) || 0
      let payment = null
      if (paidTill && fees > 0) {
        const joinDateStr = s.joinDate || new Date().toISOString().split('T')[0]
        const { monthsCovered, label, amount, startDate } = calcHistoricalPayment(joinDateStr, paidTill, fees, s.feePlan || 'monthly')
        const payAmount = Math.max(0, amount - trialDeduct + joiningFee)
        const invoiceId = await db.fetchNextInvoiceId()
        payment = { invoiceId, amount: payAmount, label, startDate, monthsCovered }
      }

      // ONE atomic write: student + (optional) batch counter + (optional) payment
      const newId = await db.createStudentWithPayment({
        ...s,
        studentCode, joinCode, paidTill, fees,
        suspendNow, payment,
        academyId: user?.academyId,
      })

      // Inherit current branch scope — awaited so the DB record has branch_id
      // before we return. A failed update would make the student invisible to
      // branch-filtered views on next reload (they'd show in optimistic state
      // but disappear after refresh). Don't throw — student was created fine.
      if (selectedBranch) {
        const { error: brErr } = await supabase
          .from('students').update({ branch_id: selectedBranch }).eq('id', newId)
        if (brErr) console.warn('branch_id update failed:', brErr.message)
      }

      // Mark from_trial on student record (fire-and-forget, column added via migration 0013)
      if (s.fromTrial) {
        ;(async () => {
          try { await supabase.from('students').update({ from_trial: true }).eq('id', newId) } catch {}
        })()
      }
      // Persist trial deduction / joining fee notes to payment record
      if (payment && (trialDeduct > 0 || joiningFee > 0)) {
        const noteParts = []
        if (trialDeduct > 0) noteParts.push(`Trial fee deducted: −₹${trialDeduct}`)
        if (joiningFee  > 0) noteParts.push(`Joining fee included: +₹${joiningFee}`)
        ;(async () => {
          try { await supabase.from('payments').update({ notes: noteParts.join(' · ') }).eq('id', payment.invoiceId) } catch {}
        })()
      }

      // Build local state from inputs (the RPC returns only the id)
      const todayStr = addNow.toISOString().split('T')[0]
      const mapped = {
        id:             newId,
        name:           s.name,
        parent:         s.parent || '',
        phone:          s.phone || '',
        parentPhone:    s.parentPhone || '',
        age:            Number(s.age) || null,
        sport:          s.sport || '',
        batch:          s.batchName || '',
        batchId:        s.batchId || null,
        joinDate:       s.joinDate || todayStr,
        status:         suspendNow ? 'Suspended' : 'Active',
        accountStatus:  'pending',
        fees:           fees,
        paidTill:       paidTill,
        studentCode,
        joinCode,
        feeAmount:      Number(s.feeAmount) || fees,
        feeDueDay:      Number(s.feeDueDay) || null,
        lastBatchId:    null,
        lastBatchName:  null,
        suspendedSince: suspendNow ? todayStr : null,
        trainingType:   s.trainingType || 'Daily',
        feePlan:        s.feePlan || 'monthly',
        fromTrial:      s.fromTrial   || false,
        trialDeduct:    trialDeduct,
        branchId:       selectedBranch || null,
      }
      setStudents(prev => [...prev, mapped])

      // Optimistic batch counter update (RPC already bumped DB if not suspended)
      if (s.batchId && !suspendNow) {
        setBatches(prev => prev.map(b => b.id === s.batchId
          ? { ...b, enrolled: (b.enrolled || 0) + 1 } : b))
      }

      // Optimistic payment row (RPC already inserted it in DB)
      if (payment) {
        setPayments(prev => [{
          id:             payment.invoiceId,
          studentId:      newId,
          student:        s.name,
          amount:         payment.amount,
          month:          payment.label,
          date:           payment.startDate,
          coverageStart:  payment.startDate,
          status:         'Paid',
          mode:           'Cash',
          paymentType:    'monthly',
          discountPct:    0,
          monthsCovered:  payment.monthsCovered,
          academyId:      user?.academyId,
          notes:          [trialDeduct > 0 ? `Trial fee deducted: −₹${trialDeduct}` : '', joiningFee > 0 ? `Joining fee included: +₹${joiningFee}` : ''].filter(Boolean).join(' · '),
        }, ...prev])
      }

      showToast(`Student created — Code: ${studentCode} · Join: ${joinCode}`, 'success')
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_ADD, entityType: 'student', entityId: mapped.id, entityName: mapped.name, changes: { batch: mapped.batch || '—', sport: mapped.sport, fees: String(mapped.fees) }, academyId: user?.academyId })
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
        position:     updated.position || null,
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
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_EDIT, entityType: 'student', entityId: id, entityName: s.name || oldStudent?.name, changes: diff, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_REACTIVATE, entityType: 'student', entityId: student.id, entityName: student.name, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_DELETE, entityType: 'student', entityId: student.id, entityName: student.name, changes: { batch: student.batch || '—', sport: student.sport }, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_SUSPEND, entityType: 'student', entityId: student.id, entityName: student.name, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.STUDENT_RESET, entityType: 'student', entityId: id, entityName: resetS?.name, academyId: user?.academyId })
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
    // Idempotency guard #1: in-memory lock against double-click / rapid resubmit
    // on the same browser session (kicks in before any network round-trip).
    const lockKey = `${p.studentId}-${Number(p.amount)}-${p.monthsCovered || 1}`
    if (_paymentInFlight.has(lockKey)) {
      showToast('Already recording this payment — please wait', 'error')
      return
    }
    _paymentInFlight.add(lockKey)
    try {
      // Idempotency guard #2: server-side check for any payment with the same
      // (student, amount) inserted in the last 60s — catches duplicates from
      // a different tab/device or a network retry that bypassed the local lock.
      const recent = await db.findRecentDuplicatePayment(p.studentId, p.amount, 60)
      if (recent) {
        const secsAgo = Math.max(1, Math.round((Date.now() - new Date(recent.created_at).getTime()) / 1000))
        showToast(`Duplicate blocked — ${recent.id} for ₹${Number(recent.amount).toLocaleString('en-IN')} was just recorded ${secsAgo}s ago`, 'error')
        return
      }
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
      const payDate      = collectionDate.toISOString().split('T')[0]
      const coverageStart = baseDate.toISOString().split('T')[0]
      const invoiceId    = await db.fetchNextInvoiceId()
      const paymentRow   = { ...p, month: monthLabel, monthsCovered: months, amount: p.amount, date: payDate, coverageStart, academyId: user?.academyId }
      // DB insert first — if it fails (PK collision, RLS reject), no optimistic row gets left behind.
      await db.insertPayment(paymentRow, invoiceId)

      // Optimistic state update — only runs if DB insert succeeded above.
      setPayments(prev => [{
        ...paymentRow, id: invoiceId,
        date: payDate, status: 'Paid', month: monthLabel, coverageStart,
      }, ...prev])

      const student = students.find(s => String(s.id) === String(p.studentId))
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
      logAuditSport({ actor: user, action: ACTIONS.PAYMENT_ADD, entityType: 'payment', entityId: invoiceId, entityName: p.student, changes: { amount: String(p.amount), months: String(months), mode: p.mode || 'Cash' }, academyId: user?.academyId })
      showToast('Payment recorded')
      // Notify student — fire and forget
      if (p.studentId) {
        notify({
          academyId: user.academyId,
          recipientType: 'student',
          recipientId: p.studentId,
          title: 'Payment Received',
          body: `₹${p.amount} for ${monthLabel} has been recorded.`,
          type: 'payment',
          link: '/student/payments',
        }).catch(() => {})
      }
    } catch (err) {
      showToast(err.message || 'Payment failed', 'error')
    } finally {
      // Hold the lock briefly past completion so a stale click can't slip through
      setTimeout(() => _paymentInFlight.delete(lockKey), 1500)
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
      const student = students.find(s => String(s.id) === String(payment.studentId))
      if (student) {
        // Find the previous payment with the highest coverage end date.
        // Use coverageStart (stored since migration 0020) when available;
        // fall back to date (collection date) for older rows — correct for non-advance payments.
        const studentPaid = remaining
          .filter(p => String(p.studentId) === String(payment.studentId) && p.status === 'Paid')
        let newPaidTill = null
        if (studentPaid.length > 0) {
          const withEnd = studentPaid.map(p => {
            const base = new Date((p.coverageStart || p.date) + 'T00:00:00')
            const m    = p.monthsCovered || 1
            const end  = new Date(base.getFullYear(), base.getMonth() + m, 0)
            return { end, endStr: end.toISOString().split('T')[0] }
          })
          newPaidTill = withEnd.sort((a, b) => b.end - a.end)[0].endStr
        }
        await db.updateStudentPaidTill(student.id, newPaidTill, null)
        setStudents(prev => prev.map(s => s.id === student.id ? { ...s, paidTill: newPaidTill } : s))
      }
      logAuditSport({ actor: user, action: ACTIONS.PAYMENT_REMOVE, entityType: 'payment', entityId: payment.id, entityName: payment.student, changes: { amount: String(payment.amount), month: payment.month || '—' }, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.PAYMENT_PAID, entityType: 'payment', entityId: id, entityName: paidPay?.student, changes: { mode }, academyId: user?.academyId })
      showToast('Payment marked as paid')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Trials ────────────────────────────────────────────

  const addTrial = async (t) => {
    try {
      const created = await db.insertTrial({ ...t, academyId: user?.academyId, branchId: selectedBranch || null })
      setTrials(prev => [created, ...prev])
      logAuditSport({ actor: user, action: ACTIONS.TRIAL_ADD, entityType: 'trial', entityId: created.id, entityName: t.name, changes: { sport: t.sport || '—', source: t.source || '—', date: t.trialDate || '—' }, academyId: user?.academyId })
      showToast('Trial lead added')
      // If staff added the trial, notify the owner
      if (role === 'staff' && user?.academyId) {
        supabase.from('academies').select('owner_id').eq('id', user.academyId).single()
          .then(({ data }) => {
            if (data?.owner_id) notify({
              academyId: user.academyId, recipientType: 'owner', recipientId: data.owner_id,
              title: 'New Trial Lead', body: `${t.name} wants to join${t.sport ? ' ' + t.sport : ''}.`, type: 'trial', link: '/trials',
            }).catch(() => {})
          })
      }
    } catch (err) {
      showToast(err.message || 'Failed to add trial', 'error')
    }
  }

  const updateTrialStatus = async (id, updates, opts = {}) => {
    const oldTrial = trials.find(t => t.id === id)
    // Optimistic: update UI immediately so the Convert button disappears before the DB round-trip
    setTrials(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))
    try {
      await db.updateTrial(id, updates)
      const isConvert = updates.converted === true
      const action = isConvert ? ACTIONS.TRIAL_CONVERT : ACTIONS.TRIAL_UPDATE
      logAuditSport({ actor: user, action, entityType: 'trial', entityId: id, entityName: oldTrial?.name, changes: updates.stage ? { stage: { old: oldTrial?.stage, new: updates.stage } } : {}, academyId: user?.academyId })
      // `silent: true` suppresses the toast — used by handleConvert so the user only
      // sees the final "Student created" toast, not a redundant "Trial updated" prefix.
      if (!opts.silent) showToast('Trial updated')
    } catch (err) {
      // Revert optimistic update on failure
      if (oldTrial) setTrials(prev => prev.map(t => t.id === id ? oldTrial : t))
      if (!opts.silent) showToast(err.message || 'Update failed', 'error')
    }
  }

  const deleteTrial = async (id) => {
    try {
      await db.deleteTrial(id)
      setTrials(prev => prev.filter(t => t.id !== id))
      showToast('Trial lead deleted')
    } catch (err) { showToast(err.message || 'Delete failed', 'error') }
  }

  const addTrialSource = async (label) => {
    try {
      const src = await db.insertTrialSource(user?.academyId, label)
      setTrialSources(prev => [...prev, src])
    } catch (err) { showToast(err.message || 'Failed to add source', 'error') }
  }

  const removeTrialSource = async (id) => {
    try {
      await db.deleteTrialSource(id)
      setTrialSources(prev => prev.filter(s => s.id !== id))
    } catch (err) { showToast(err.message || 'Failed to remove source', 'error') }
  }

  // ── Batches ───────────────────────────────────────────

  const addBatch = async (b) => {
    try {
      const created = await db.insertBatchV2({ ...b, academyId: user?.academyId, branchId: selectedBranch || null })
      setBatches(prev => [...prev, {
        id: created.id, name: created.name, code: created.code || null, time: created.time,
        sports: created.sports || [], coach: created.coach,
        capacity: created.capacity, enrolled: created.enrolled, waitlist: created.waitlist,
        days: created.days || [], startTime: created.start_time,
        endTime: created.end_time, ageMin: created.age_min, ageMax: created.age_max,
        ground: created.ground || null,
        defaultFee: created.default_fee || 0, defaultPlan: created.default_plan || 'monthly',
        branchId: created.branch_id || null,
      }])
      logAuditSport({ actor: user, action: ACTIONS.BATCH_ADD, entityType: 'batch', entityId: created.id, entityName: created.name, changes: { sport: (b.sports || []).join(', '), capacity: String(b.capacity), coach: b.coach || '—' }, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.BATCH_COACH, entityType: 'batch', entityId: batchId, entityName: oldBatch?.name, changes: { Coach: { old: oldBatch?.coach || '—', new: coachName || '—' } }, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.BATCH_EDIT, entityType: 'batch', entityId: batchId, entityName: b.name || oldBatch?.name, changes: batchDiff, academyId: user?.academyId })
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
    logAuditSport({ actor: user, action: ACTIONS.BATCH_DELETE, entityType: 'batch', entityId: id, entityName: delBatch?.name, academyId: user?.academyId })
    showToast('Batch deleted')
  }

  // ── Events ────────────────────────────────────────────

  const addEvent = async (e) => {
    try {
      const created = await db.insertEvent({ ...e, academyId: user?.academyId })
      setEvents(prev => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
      logAuditSport({ actor: user, action: ACTIONS.EVENT_ADD, entityType: 'event', entityId: created.id, entityName: e.title, changes: { type: e.type || '—', date: e.date || '—', venue: e.venue || '—' }, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.EVENT_UPDATE, entityType: 'event', entityId: id, entityName: ev?.title, changes: { status: { old: ev?.status, new: status } }, academyId: user?.academyId })
      showToast('Event updated')
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  const updateEvent = async (id, fields) => {
    try {
      await db.updateEvent(id, fields)
      const ev = events.find(e => e.id === id)
      logAuditSport({ actor: user, action: ACTIONS.EVENT_UPDATE, entityType: 'event', entityId: id, entityName: ev?.title || fields.title, changes: fields.title ? { title: { old: ev?.title, new: fields.title } } : {}, academyId: user?.academyId })
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
      logAuditSport({ actor: user, action: ACTIONS.EVENT_DELETE, entityType: 'event', entityId: id, entityName: ev?.title, academyId: user?.academyId })
      showToast('Event deleted')
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Staff HR ──────────────────────────────────────────

  const addStaffMember = async (s, photoFile = null) => {
    const staffCode = await db.fetchNextStaffCode(s.staffType || 'coach')
    const joinCode  = generateJoinCode()
    const created   = await db.insertStaff({ ...s, academyId: user?.academyId, staffCode, joinCode })
    // Upload photo AFTER insert so we have the real staff ID for fixed-path storage
    let photoUrl = created.photoUrl || null
    if (photoFile) {
      try {
        photoUrl = await db.uploadStaffPhoto(photoFile, created.id)
        await db.updateStaffProfile(created.id, { name: s.name, phone: s.phone, photoUrl })
      } catch (_) {}
    }
    setStaff(prev => [...prev, {
      ...created,
      photoUrl,
      userId:        null,
      accessRole:    null,
      permissions:   [],
      staffCode,
      joinCode:      null,
      staffType:     s.staffType || 'coach',
      accountStatus: 'pending',
    }])
    logAuditSport({ actor: user, action: ACTIONS.STAFF_ADD, entityType: 'staff', entityId: created.id, entityName: s.name, changes: { role: s.role || '—', sport: (s.sports || []).join(', ') || '—' }, academyId: user?.academyId })
    showToast('Staff member added')
    return { staffCode, joinCode }
  }

  const removeStaffMember = async (id) => {
    try {
      const member = staff.find(s => s.id === id)
      await db.deleteStaff(id)
      setStaff(prev => prev.filter(s => s.id !== id))
      logAuditSport({ actor: user, action: ACTIONS.STAFF_REMOVE, entityType: 'staff', entityId: id, entityName: member?.name, academyId: user?.academyId })
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
    if (photoFile)   photoUrl   = await db.uploadStaffPhoto(photoFile, id)
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
    if (photoFile) { try { photoUrl = await db.uploadStaffPhoto(photoFile, id) } catch (_) {} }
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
      logAuditSport({ actor: user, action: ACTIONS.STAFF_INVITE, entityType: 'staff', entityName: name, changes: { role: accessRole, permissions: permissions.join(', ') || '—' }, academyId: user?.academyId })
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

  const loadAttendanceForDate = async (date, force = false) => {
    if (!force && attendanceData[date]) return
    try {
      const rec = await db.fetchAttendanceForDate(date)
      setAttendanceData(prev => ({ ...prev, [date]: rec }))
    } catch (err) {
      console.error('Attendance load failed:', err)
    }
  }

  const saveAttendance = async (date, records, batchId = null) => {
    try {
      await db.saveAttendanceForDate(date, records, batchId)
      // Merge into aggregate cache (so dashboard present-count stays current)
      setAttendanceData(prev => {
        const updated = { ...(prev[date] || {}) }
        Object.entries(records).forEach(([id, status]) => {
          if (status) updated[id] = status
          else delete updated[id]
        })
        return { ...prev, [date]: updated }
      })
      showToast('Attendance saved')
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    }
  }

  // ── Leave Requests ────────────────────────────────────

  const submitLeave = async (startDate, endDate, reason) => {
    if (!user?.id) return
    try {
      const created = await db.createLeaveRequest(user.id, user.name, startDate, endDate, reason, user.academyId)
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
        ? await db.fetchLeaveRequests(user.academyId)
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

  const sendStaffNotice = async ({ title, body, actionLabel, recipientIds }) => {
    const ids = recipientIds?.length ? recipientIds : staff.map(s => s.id)
    await Promise.allSettled(ids.map(id => notify({
      academyId: user.academyId,
      recipientType: 'staff',
      recipientId: id,
      title,
      body,
      type: 'announcement',
      link: '/staff/notices',
      actionLabel: actionLabel || null,
    })))
  }

  const addAnnouncement = async (a) => {
    try {
      const ann     = { ...a, author: user?.name || 'Owner', academyId: user?.academyId }
      const created = await db.insertAnnouncement(ann)
      setAnnouncements(prev => [created, ...prev])
      logAuditSport({ actor: user, action: ACTIONS.ANNOUNCEMENT_ADD, entityType: 'announcement', entityId: created.id, entityName: a.title, changes: { type: a.type || '—' }, academyId: user?.academyId })
      showToast('Announcement posted')
      // Notify all staff and active students — fire and forget
      const preview = (a.content || a.body || '').slice(0, 80)
      staff.forEach(s => notify({
        academyId: user.academyId, recipientType: 'staff', recipientId: s.id,
        title: a.title, body: preview || 'New announcement from academy', type: 'announcement', link: '/staff/notices',
      }).catch(() => {}))
      students.filter(s => s.status === 'Active').forEach(s => notify({
        academyId: user.academyId, recipientType: 'student', recipientId: s.id,
        title: a.title, body: preview || 'New announcement from academy', type: 'announcement', link: '/student/announcements',
      }).catch(() => {}))
    } catch (err) {
      showToast(err.message || 'Failed', 'error')
    }
  }

  const isAuthenticated = role !== null

  // ── Sport + Branch scoped filtered views ──────────────
  // Two layered filters: selectedSport (legacy) and selectedBranch (new).
  //   • No sport selected → "All Sports" view, raw data
  //   • Sport selected, no branch → all branches of that sport
  //   • Sport + branch selected → only that branch's slice (the isolation case)
  const isAllSports = !selectedSport || selectedSport === 'All'
  const hasBranchScope = Boolean(selectedBranch)

  // Clear attendance cache when sport or branch changes so stale cross-scope
  // aggregate counts don't leak into the new view's batch cards.
  useEffect(() => { setAttendanceData({}) }, [selectedSport, selectedBranch])

  // Step 1: sport filter (existing behavior, unchanged)
  const sportStudents = useMemo(() =>
    isAllSports ? students : students.filter(s => s.sport === selectedSport)
  , [students, selectedSport, isAllSports])

  const sportBatches = useMemo(() => {
    if (isAllSports) return batches
    return batches.filter(b => {
      const sports = Array.isArray(b.sports) ? b.sports : (b.sports ? [String(b.sports)] : [])
      return sports.includes(selectedSport)
    })
  }, [batches, selectedSport, isAllSports])

  const sportStaff = useMemo(() =>
    isAllSports ? staff : staff.filter(s => !s.sports?.length || s.sports.includes(selectedSport))
  , [staff, selectedSport, isAllSports])

  const sportPayments = useMemo(() => {
    if (isAllSports) return payments
    const ids = new Set(students.filter(s => s.sport === selectedSport).map(s => s.id))
    return payments.filter(p => ids.has(p.studentId))
  }, [payments, students, selectedSport, isAllSports])

  const sportTrials = useMemo(() =>
    isAllSports ? trials : trials.filter(t => t.sport === selectedSport)
  , [trials, selectedSport, isAllSports])

  // Step 2: branch filter on top — only narrows further when selectedBranch is set
  const filteredStudents = useMemo(() =>
    hasBranchScope ? sportStudents.filter(s => s.branchId === selectedBranch) : sportStudents
  , [sportStudents, selectedBranch, hasBranchScope])

  const filteredBatches = useMemo(() =>
    hasBranchScope ? sportBatches.filter(b => b.branchId === selectedBranch) : sportBatches
  , [sportBatches, selectedBranch, hasBranchScope])

  const filteredStaff = useMemo(() => {
    if (!hasBranchScope) return sportStaff
    // Keep non-branch-bound staff visible (no branchId), filter the rest by branch
    return sportStaff.filter(s => !s.branchId || s.branchId === selectedBranch)
  }, [sportStaff, selectedBranch, hasBranchScope])

  const filteredPayments = useMemo(() => {
    if (!hasBranchScope) return sportPayments
    const branchStudentIds = new Set(
      students.filter(s => s.branchId === selectedBranch).map(s => s.id)
    )
    return sportPayments.filter(p => branchStudentIds.has(p.studentId))
  }, [sportPayments, students, selectedBranch, hasBranchScope])

  const filteredTrials = useMemo(() =>
    hasBranchScope ? sportTrials.filter(t => t.branchId === selectedBranch) : sportTrials
  , [sportTrials, selectedBranch, hasBranchScope])

  // Fee plans inherit scope through their batch_id. If we can see the batch,
  // we can see its fee plans. Outside any sport scope → show everything.
  const filteredFeePlans = useMemo(() => {
    if (isAllSports && !hasBranchScope) return feePlans
    const visibleBatchIds = new Set(filteredBatches.map(b => b.id))
    return feePlans.filter(p => visibleBatchIds.has(p.batchId))
  }, [feePlans, filteredBatches, isAllSports, hasBranchScope])

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
      loginStudent, logoutStudent, activateStudent, updateStudentPhoto,
      // sport scoping
      selectedSport, setSelectedSport, isAllSports,
      // branch scoping (within a sport)
      selectedBranch, setSelectedBranch, setSelectedSportAndBranch,
      sportBranches, refreshSportBranches, hasBranchScope,
      // raw data (for SportSelect page and any page needing unfiltered data)
      allStudents: students, allStaff: staff, allBatches: batches,
      allPayments: payments, allTrials: trials,
      // data — auto-filtered by selectedSport
      students: filteredStudents, addStudent, updateStudent, deleteStudent, suspendStudent, reactivateStudent, updateStudentStatus, resetStudentPasswordAdmin, refreshStudents,
      payments: filteredPayments, addPayment, markPaymentPaid, removePayment, updatePaymentDate,
      trials: filteredTrials, addTrial, updateTrialStatus, deleteTrial,
      trialSources, addTrialSource, removeTrialSource,
      refreshData: loadAll,
      batches: filteredBatches, setBatches, addBatch, updateBatchCoach, updateBatch, updateBatchFee, deleteBatch,
      feePlans: filteredFeePlans, addFeePlan, editFeePlan, removeFeePlan,
      events, addEvent, updateEvent, updateEventStatus, removeEvent,
      staff: filteredStaff, addStaffMember, removeStaffMember, editStaffMember, editStaffPermissions,
      updateStaffProfile,
      branches, addBranch, removeBranch,
      // raw fee plans (unfiltered) for places that need everything
      allFeePlans: feePlans,
      attendanceData, loadAttendanceForDate, saveAttendance,
      announcements, addAnnouncement, sendStaffNotice,
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
