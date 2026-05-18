import { Outlet } from 'react-router-dom'
import { useState, useEffect, Suspense } from 'react'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'

// Lightweight skeleton — only the page area pulses while a chunk loads.
// Sidebar + Header stay visible, so the user never sees a blank screen.
function PageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 bg-gray-100 rounded-xl w-1/3" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
      <div className="h-64 bg-gray-100 rounded-2xl" />
      <div className="h-40 bg-gray-100 rounded-2xl" />
    </div>
  )
}

// Run prefetches at idle so they don't compete with the dashboard's initial render.
const onIdle = (cb) => {
  if (typeof window === 'undefined') return
  if ('requestIdleCallback' in window) window.requestIdleCallback(cb, { timeout: 2000 })
  else setTimeout(cb, 800)
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Warm up every owner page chunk after first paint.
    // Once these promises resolve the chunks live in module cache, so
    // navigating to any tab is synchronous — no more loading screen.
    onIdle(() => {
      import('../pages/Dashboard')
      import('../pages/Students')
      import('../pages/Attendance')
      import('../pages/Payments')
      import('../pages/Trials')
      import('../pages/Batches')
      import('../pages/Staff')
      import('../pages/Reports')
      import('../pages/Community')
      import('../pages/Settings')
      import('../pages/AdminQR')
      import('../pages/StaffAttendanceQR')
      import('../pages/Events')
      import('../pages/Drills')
      import('../pages/Sessions')
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-h-screen transition-all duration-300 ${collapsed ? 'lg:ml-16' : 'lg:ml-60'}`}>
        <Header />
        <main className="flex-1 p-4 md:p-6 pb-24 lg:pb-6">
          {/* Suspense moved INSIDE the layout so sidebar + header stay
              visible during the (now rare) chunk load. Pages animate in
              with page-enter for a native feel. */}
          <Suspense fallback={<PageSkeleton />}>
            <div className="page-enter">
              <Outlet />
            </div>
          </Suspense>
        </main>
      </div>

      {/* Mobile bottom nav — hidden on desktop */}
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  )
}
