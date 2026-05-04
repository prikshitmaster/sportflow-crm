import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import Layout from './components/Layout'
import StudentLayout from './components/StudentLayout'
import Login from './pages/Login'
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
import StudentDashboard from './pages/student/StudentDashboard'
import StudentScan from './pages/student/StudentScan'
import StudentAttendance from './pages/student/StudentAttendance'
import StudentPayments from './pages/student/StudentPayments'
import StudentAnnouncements from './pages/student/StudentAnnouncements'

function AdminRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'admin') return children
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return <Navigate to="/login" replace />
}

function StudentRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'student') return children
  if (role === 'admin') return <Navigate to="/dashboard" replace />
  return <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { role, loading } = useApp()
  if (loading) return <PageLoading />
  if (role === 'admin')   return <Navigate to="/dashboard" replace />
  if (role === 'student') return <Navigate to="/student/dashboard" replace />
  return children
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

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"         element={<Navigate to="/login" replace />} />
      <Route path="/login"    element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/activate" element={<Activate />} />

      {/* Admin routes */}
      <Route path="/" element={<AdminRoute><Layout /></AdminRoute>}>
        <Route path="dashboard"  element={<Dashboard />} />
        <Route path="students"   element={<Students />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="payments"   element={<Payments />} />
        <Route path="trials"     element={<Trials />} />
        <Route path="batches"    element={<Batches />} />
        <Route path="staff"      element={<Staff />} />
        <Route path="reports"    element={<Reports />} />
        <Route path="community"  element={<Community />} />
        <Route path="settings"   element={<Settings />} />
        <Route path="gate-qr"    element={<AdminQR />} />
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
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  )
}
