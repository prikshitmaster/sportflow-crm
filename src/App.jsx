// ── Route guards ──────────────────────────────────────────
// OwnerRoute  → only role='owner' may enter
// StaffRoute  → only role='staff' may enter (staff has its own portal)
// StudentRoute → only role='student' may enter
// PublicRoute → redirects logged-in users to their home

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Component } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import Layout from './components/Layout'
import StudentLayout from './components/StudentLayout'
import StaffLayout from './components/StaffLayout'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Activate from './pages/Activate'
import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Attendance from './pages/Attendance'
import Payments from './pages/Payments'
import Trials from './pages/Trials'
import Batches from './pages/Batches'
import Staff from './pages/Staff'
import Reports from './pages/Reports'
import Community from './pages/Community'
import Settings from './pages/Settings'
import AdminQR from './pages/AdminQR'
import Events from './pages/Events'
import StudentDashboard from './pages/student/StudentDashboard'
import StudentScan from './pages/student/StudentScan'
import StudentAttendance from './pages/student/StudentAttendance'
import StudentPayments from './pages/student/StudentPayments'
import StudentAnnouncements from './pages/student/StudentAnnouncements'
import StaffDashboard   from './pages/staff/StaffDashboard'
import StaffAttendance  from './pages/staff/StaffAttendance'
import StaffRoster      from './pages/staff/StaffRoster'
import StaffMe          from './pages/staff/StaffMe'
import StaffProfile     from './pages/staff/StaffProfile'
import StaffScanIn      from './pages/staff/StaffScanIn'
import StaffNotices     from './pages/staff/StaffNotices'
import StaffAttendanceQR from './pages/StaffAttendanceQR'
import Invite           from './pages/Invite'

// ── Error boundary — catches render crashes (shows error msg instead of blank) ──
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(err) { return { error: err } }
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
            <button onClick={() => window.location.reload()}
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

// ── Route guard helpers ───────────────────────────────────

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

// Owner-only routes
function OwnerRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'owner') return children
  if (role === 'staff')   return <Navigate to="/staff/dashboard" replace />
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return <Navigate to="/login" replace />
}

// Staff-only routes
function StaffRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'staff')   return children
  if (role === 'owner')   return <Navigate to="/dashboard" replace />
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return <Navigate to="/login" replace />
}

// Student-only routes
function StudentRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'student') return children
  if (role === 'owner')   return <Navigate to="/dashboard" replace />
  if (role === 'staff')   return <Navigate to="/staff/dashboard" replace />
  return <Navigate to="/login" replace />
}

// Public (login / signup) — redirect if already logged in
function PublicRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'owner') return <Navigate to="/dashboard" replace />
  if (role === 'staff')   return <Navigate to="/staff/dashboard" replace />
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return children
}

// ── Route tree ────────────────────────────────────────────
function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"        element={<Navigate to="/login" replace />} />
      <Route path="/login"   element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/signup"  element={<PublicRoute><Signup /></PublicRoute>} />
      <Route path="/activate" element={<Activate />} />
      <Route path="/invite/:token" element={<Invite />} />

      {/* Owner portal — full admin dashboard */}
      <Route path="/" element={<OwnerRoute><Layout /></OwnerRoute>}>
        <Route path="dashboard"  element={<Dashboard />} />
        <Route path="students"   element={<Students />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="payments"   element={<Payments />} />
        <Route path="trials"     element={<Trials />} />
        <Route path="batches"    element={<Batches />} />
        <Route path="coaches"    element={<Staff />} />
        <Route path="reports"    element={<Reports />} />
        <Route path="community"  element={<Community />} />
        <Route path="settings"   element={<Settings />} />
        <Route path="gate-qr"    element={<AdminQR />} />
        <Route path="staff-qr"   element={<StaffAttendanceQR />} />
        <Route path="events"     element={<Events />} />
      </Route>

      {/* Staff portal — full coach flow */}
      <Route path="/staff" element={<StaffRoute><StaffLayout /></StaffRoute>}>
        <Route index             element={<Navigate to="/staff/dashboard" replace />} />
        <Route path="dashboard"  element={<StaffDashboard />} />
        <Route path="attendance" element={<StaffAttendance />} />
        <Route path="roster"     element={<StaffRoster />} />
        <Route path="me"         element={<StaffMe />} />
        <Route path="profile"    element={<StaffProfile />} />
        {/* Community still reuses the owner page */}
        <Route path="community"  element={<Community />} />
        <Route path="scan-in"    element={<StaffScanIn />} />
        <Route path="notices"    element={<StaffNotices />} />
      </Route>

      {/* Student portal */}
      <Route path="/student" element={<StudentRoute><StudentLayout /></StudentRoute>}>
        <Route index                    element={<Navigate to="/student/dashboard" replace />} />
        <Route path="dashboard"         element={<StudentDashboard />} />
        <Route path="scan"              element={<StudentScan />} />
        <Route path="attendance"        element={<StudentAttendance />} />
        <Route path="payments"          element={<StudentPayments />} />
        <Route path="announcements"     element={<StudentAnnouncements />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <AppRoutes />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
