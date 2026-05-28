import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component, lazy, Suspense } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { logger } from './lib/logger'
import Layout from './components/Layout'
import StaffLayout from './components/StaffLayout'
import StudentLayout from './components/StudentLayout'
import ParentLayout from './components/ParentLayout'

// Ops monitoring — secret URL, PIN-gated, no nav link
import OpsActivity from './pages/OpsActivity'

// Auth pages — kept eager (tiny, needed on first render)
import Login from './pages/Login'
import Signup from './pages/Signup'
import StaffLogin from './pages/StaffLogin'
import StaffActivate from './pages/StaffActivate'
import StudentLogin from './pages/StudentLogin'
import ParentLogin from './pages/ParentLogin'
import Activate from './pages/Activate'
import Invite from './pages/Invite'

// Owner pages — lazy loaded
const Dashboard        = lazy(() => import('./pages/Dashboard'))
const Students         = lazy(() => import('./pages/Students'))
const Attendance       = lazy(() => import('./pages/Attendance'))
const Payments         = lazy(() => import('./pages/Payments'))
const Trials           = lazy(() => import('./pages/Trials'))
const Batches          = lazy(() => import('./pages/Batches'))
const Staff            = lazy(() => import('./pages/Staff'))
const Reports          = lazy(() => import('./pages/Reports'))
const Community        = lazy(() => import('./pages/Community'))
const Settings         = lazy(() => import('./pages/Settings'))
const AdminQR          = lazy(() => import('./pages/AdminQR'))
const Events           = lazy(() => import('./pages/Events'))
const StaffAttendanceQR = lazy(() => import('./pages/StaffAttendanceQR'))
const SportSelect      = lazy(() => import('./pages/SportSelect'))
const Drills           = lazy(() => import('./pages/Drills'))
const Sessions         = lazy(() => import('./pages/Sessions'))
const Parents          = lazy(() => import('./pages/Parents'))
const Backups          = lazy(() => import('./pages/Backups'))
const Inventory        = lazy(() => import('./pages/Inventory'))
const TurfBooking      = lazy(() => import('./pages/TurfBooking'))

// Staff pages — lazy loaded
const StaffDashboard   = lazy(() => import('./pages/staff/StaffDashboard'))
const StaffMe          = lazy(() => import('./pages/staff/StaffMe'))
const StaffProfile     = lazy(() => import('./pages/staff/StaffProfile'))
const StaffRoster      = lazy(() => import('./pages/staff/StaffRoster'))
const StaffNotices     = lazy(() => import('./pages/staff/StaffNotices'))
const StaffAttendance  = lazy(() => import('./pages/staff/StaffAttendance'))
const StaffScanIn      = lazy(() => import('./pages/staff/StaffScanIn'))
const StaffAssess      = lazy(() => import('./pages/staff/StaffAssess'))
const StaffPulse       = lazy(() => import('./pages/staff/StaffPulse'))
const StaffTrials      = lazy(() => import('./pages/staff/StaffTrials'))
const SessionPlanner   = lazy(() => import('./pages/staff/SessionPlanner'))

// Parent pages — lazy loaded
const ParentDashboard      = lazy(() => import('./pages/parent/ParentDashboard'))
const ParentPayments       = lazy(() => import('./pages/parent/ParentPayments'))
const ParentNotices        = lazy(() => import('./pages/parent/ParentNotices'))
const ParentMe             = lazy(() => import('./pages/parent/ParentMe'))

// Public Razorpay pay-link landing page — no auth required
const PayPublic            = lazy(() => import('./pages/PayPublic'))

// Standalone printable assessment report — no app chrome
const AssessmentReport     = lazy(() => import('./pages/AssessmentReport'))

// Student pages — lazy loaded
const StudentDashboard     = lazy(() => import('./pages/student/StudentDashboard'))
const StudentAttendance    = lazy(() => import('./pages/student/StudentAttendance'))
const StudentPayments      = lazy(() => import('./pages/student/StudentPayments'))
const StudentAnnouncements = lazy(() => import('./pages/student/StudentAnnouncements'))
const StudentScan          = lazy(() => import('./pages/student/StudentScan'))
const StudentStats         = lazy(() => import('./pages/student/StudentStats'))
const StudentProgress      = lazy(() => import('./pages/student/StudentProgress'))

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
  componentDidCatch(err, info) {
    // Report every React render crash to Sentry. Chunk errors are handled
    // separately below (auto-reload) but still get reported the first time.
    logger.error('React ErrorBoundary caught', err, { componentStack: info?.componentStack })

    const isChunkError = err?.message?.includes('dynamically imported module') || err?.message?.includes('Failed to fetch')
    if (isChunkError) {
      const reloads = Number(sessionStorage.getItem('_eb_reloads') || 0)
      if (reloads < 2) {
        sessionStorage.setItem('_eb_reloads', String(reloads + 1))
        // Wipe SW caches so stale index.html can't serve deleted chunk hashes
        const nukeAndReload = () => window.location.reload()
        try {
          const nukes = []
          if ('caches' in window) nukes.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
          if ('serviceWorker' in navigator) nukes.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))))
          Promise.all(nukes).finally(nukeAndReload)
        } catch { nukeAndReload() }
        return
      }
    }
  }
  componentDidMount() { sessionStorage.removeItem('_eb_reloads') }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-5">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button onClick={() => {
              try {
                const nukes = []
                if ('caches' in window) nukes.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
                if ('serviceWorker' in navigator) nukes.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))))
                Promise.all(nukes).finally(() => window.location.reload())
              } catch { window.location.reload() }
            }}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition">
              Reload app
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <p className="text-sm text-gray-500">Loading SportFlow…</p>
      </div>
    </div>
  )
}

function OwnerRoute({ children }) {
  const { role, loading, selectedSport, user } = useApp()
  if (loading) return <PageLoading />
  if (role === 'staff' && !user) return <PageLoading />
  const isOfficeStaff = role === 'staff' && user?.accessRole && user.accessRole !== 'coach'
  if (!isOfficeStaff && role !== 'owner') return <Navigate to="/login" replace />
  if (role === 'owner' && !selectedSport) return <Navigate to="/sport-select" replace />
  return children
}

function SportSelectRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role !== 'owner') return <Navigate to="/login" replace />
  return children
}

function StaffRoute({ children }) {
  const { role, loading, user } = useApp()
  if (loading || (role === 'staff' && !user)) return <PageLoading />
  if (role === 'staff' && user?.accessRole && user.accessRole !== 'coach') return <Navigate to="/dashboard" replace />
  if (role === 'staff') return children
  return <Navigate to="/staff-login" replace />
}

function StudentRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'student') return children
  return <Navigate to="/student-login" replace />
}

function ParentRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'parent') return children
  return <Navigate to="/parent-login" replace />
}

// Renders children only if the current staff user has the given permission.
// Shows a locked screen otherwise — staff cannot bypass by typing the URL.
function PermRequired({ perm, children }) {
  const { hasPermission } = useApp()
  if (hasPermission(perm)) return children
  return (
    <div className="flex flex-col items-center justify-center h-[55vh] px-6 text-center">
      <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-base font-black text-gray-900">Access Restricted</p>
      <p className="text-sm text-gray-400 mt-1">You don't have permission to view this page.</p>
    </div>
  )
}

// Blocks direct URL access when a feature is disabled — redirects to dashboard.
function FeatureRoute({ feature, children }) {
  const { isFeatureOn } = useApp()
  if (!isFeatureOn(feature)) return <Navigate to="/dashboard" replace />
  return children
}

function NotFound() {
  const { role, loading, user } = useApp()
  if (loading) return <PageLoading />
  if (!role) return <Navigate to="/login" replace />
  const home = role === 'owner'   ? '/dashboard'
             : role === 'staff'   ? (user?.accessRole && user.accessRole !== 'coach' ? '/dashboard' : '/staff/home')
             : role === 'student' ? '/student/dashboard'
             : role === 'parent'  ? '/parent/home'
             : '/login'
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-4xl font-black text-gray-900 mb-1">404</p>
        <p className="text-base font-bold text-gray-700 mb-1">Page not found</p>
        <p className="text-sm text-gray-400 mb-6">The URL you typed doesn't exist.</p>
        <a href={home}
          className="inline-flex items-center justify-center px-5 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition">
          Go to Home
        </a>
      </div>
    </div>
  )
}

// skipOwnerRedirect — used for /staff-login and /student-login so an active
// owner Supabase session on a shared device doesn't block staff/students from
// reaching their own login form. Staff and students are still redirected if
// they're already authenticated.
function PublicRoute({ children, skipOwnerRedirect = false }) {
  const { role, loading, user } = useApp()
  if (loading) return <PageLoading />
  if (!skipOwnerRedirect && role === 'owner')  return <Navigate to="/dashboard" replace />
  if (!skipOwnerRedirect && role === 'parent') return <Navigate to="/parent/home" replace />
  if (role === 'staff')   return <Navigate to={user?.accessRole && user.accessRole !== 'coach' ? '/dashboard' : '/staff/home'} replace />
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Owner */}
      <Route path="/login"  element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
      <Route path="/sport-select" element={<SportSelectRoute><SportSelect /></SportSelectRoute>} />
      <Route path="/" element={<OwnerRoute><Layout /></OwnerRoute>}>
        <Route path="dashboard"  element={<Dashboard />} />
        <Route path="students"   element={<Students />} />
        <Route path="parents"    element={<Parents />} />
        <Route path="attendance" element={<FeatureRoute feature="attendance"><Attendance /></FeatureRoute>} />
        <Route path="payments"   element={<FeatureRoute feature="payments"><Payments /></FeatureRoute>} />
        <Route path="trials"     element={<FeatureRoute feature="trials"><Trials /></FeatureRoute>} />
        <Route path="batches"    element={<FeatureRoute feature="batches"><Batches /></FeatureRoute>} />
        <Route path="coaches"    element={<FeatureRoute feature="staff"><Staff /></FeatureRoute>} />
        <Route path="reports"    element={<FeatureRoute feature="reports"><Reports /></FeatureRoute>} />
        <Route path="community"  element={<FeatureRoute feature="community"><Community /></FeatureRoute>} />
        <Route path="settings"   element={<Settings />} />
        <Route path="inventory"  element={<Inventory />} />
        <Route path="turf"       element={<TurfBooking />} />
        <Route path="backups"    element={<FeatureRoute feature="backups"><Backups /></FeatureRoute>} />
        <Route path="gate-qr"    element={<FeatureRoute feature="gate_qr"><AdminQR /></FeatureRoute>} />
        <Route path="staff-qr"   element={<FeatureRoute feature="attendance"><StaffAttendanceQR /></FeatureRoute>} />
        <Route path="events"     element={<FeatureRoute feature="events"><Events /></FeatureRoute>} />
        <Route path="drills"     element={<FeatureRoute feature="training"><Drills /></FeatureRoute>} />
        <Route path="sessions"   element={<FeatureRoute feature="training"><Sessions /></FeatureRoute>} />
      </Route>

      {/* Staff */}
      <Route path="/staff-login"     element={<PublicRoute skipOwnerRedirect><StaffLogin /></PublicRoute>} />
      <Route path="/staff-activate"  element={<StaffActivate />} />
      <Route path="/staff" element={<StaffRoute><StaffLayout /></StaffRoute>}>
        <Route path="home"       element={<StaffDashboard />} />
        <Route path="profile"    element={<StaffProfile />} />
        <Route path="me"         element={<StaffMe />} />
        <Route path="roster"     element={<PermRequired perm="students.view">     <StaffRoster />    </PermRequired>} />
        <Route path="notices"    element={<StaffNotices />} />
        <Route path="attendance" element={<PermRequired perm="attendance.manage"><StaffAttendance /></PermRequired>} />
        <Route path="scan-in"    element={<StaffScanIn />} />
        <Route path="assess"     element={<PermRequired perm="training.manage">  <StaffAssess />    </PermRequired>} />
        <Route path="pulse"      element={<StaffPulse />} />
        {/* Permission-gated admin pages rendered inside staff portal */}
        <Route path="students"  element={<PermRequired perm="students.view">   <Students />     </PermRequired>} />
        <Route path="payments"  element={<PermRequired perm="payments.view">   <Payments />     </PermRequired>} />
        <Route path="sessions"  element={<PermRequired perm="training.manage"> <SessionPlanner /></PermRequired>} />
        <Route path="trials"    element={<PermRequired perm="trials.manage">  <StaffTrials /></PermRequired>} />
        <Route path="batches"   element={<PermRequired perm="batches.view">   <Batches />   </PermRequired>} />
        <Route path="reports"   element={<PermRequired perm="reports.view">   <Reports />   </PermRequired>} />
        <Route path="community" element={<PermRequired perm="community.manage"><Community /></PermRequired>} />
        <Route path="events"    element={<PermRequired perm="events.manage">  <Events />    </PermRequired>} />
        <Route path="coaches"   element={<PermRequired perm="staff.manage">   <Staff />     </PermRequired>} />
        <Route path="settings"  element={<PermRequired perm="settings.manage"><Settings />  </PermRequired>} />
      </Route>

      {/* Parent */}
      <Route path="/parent-login"  element={<PublicRoute><ParentLogin /></PublicRoute>} />
      <Route path="/parent" element={<ParentRoute><ParentLayout /></ParentRoute>}>
        <Route path="home"     element={<ParentDashboard />} />
        <Route path="payments" element={<ParentPayments />} />
        <Route path="notices"  element={<ParentNotices />} />
        <Route path="me"       element={<ParentMe />} />
      </Route>

      {/* Student */}
      <Route path="/student-login" element={<PublicRoute skipOwnerRedirect><StudentLogin /></PublicRoute>} />
      <Route path="/activate"      element={<Activate />} />
      <Route path="/student" element={<StudentRoute><StudentLayout /></StudentRoute>}>
        <Route path="dashboard"   element={<StudentDashboard />} />
        <Route path="attendance"  element={<StudentAttendance />} />
        <Route path="stats"       element={<StudentStats />} />
        <Route path="progress"    element={<StudentProgress />} />
        <Route path="payments"    element={<StudentPayments />} />
        <Route path="announcements" element={<StudentAnnouncements />} />
        <Route path="scan"        element={<StudentScan />} />
      </Route>

      {/* Invite — public, no auth required */}
      <Route path="/invite/:token" element={<Invite />} />

      {/* Razorpay pay-link landing — public, no auth required */}
      <Route path="/pay/:shortCode" element={<PayPublic />} />

      {/* Printable assessment report — standalone (no app chrome).
          Owner/coach pass studentId; student route auto-uses logged-in id. */}
      <Route path="/report/student/:studentId" element={<AssessmentReport />} />
      <Route path="/student/assessment-report" element={<AssessmentReport asStudent />} />

      {/* Ops monitor — PIN-gated, secret URL, not linked anywhere */}
      <Route path="/ops/live" element={<OpsActivity />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <Suspense fallback={<PageLoading />}>
            <AppRoutes />
          </Suspense>
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
