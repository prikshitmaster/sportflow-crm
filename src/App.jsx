import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Login from './pages/Login'
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

function PrivateRoute({ children }) {
  const { isAuthenticated } = useApp()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useApp()
  return !isAuthenticated ? children : <Navigate to="/dashboard" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
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
