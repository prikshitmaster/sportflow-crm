import { useApp } from '../context/AppContext'
import { revenueData, sportBreakdown } from '../data/mockData'
import {
  Users, CalendarCheck, CreditCard, TrendingUp, UserPlus, ChevronRight,
  ArrowUpRight, Bell, Zap, CheckCircle, Clock,
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { Link } from 'react-router-dom'

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

export default function Dashboard() {
  const { students, payments, trials, user, dataLoading, attendanceData } = useApp()

  if (dataLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-sm text-gray-500 font-medium">Loading academy data...</p>
        </div>
      </div>
    )
  }
  const activeStudents = students.filter(s => s.status === 'Active').length
  const todayStr = new Date().toISOString().split('T')[0]
  const todayAttendance = Object.values(attendanceData[todayStr] || {}).filter(v => v === 'Present' || v === true).length
  const pendingAmt = payments.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
  const paidAmt = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const overdueCount = payments.filter(p => p.status === 'Overdue').length
  const newTrials = trials.filter(t => !t.converted).length

  const recentPayments = [...payments].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 5)

  const quickActions = [
    { label: 'Mark Attendance', to: '/attendance', icon: CalendarCheck, color: 'bg-brand-50 text-brand-600' },
    { label: 'Collect Fee',     to: '/payments',   icon: CreditCard,    color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Add Student',     to: '/students',   icon: Users,         color: 'bg-purple-50 text-purple-600' },
    { label: 'Add Trial Lead',  to: '/trials',     icon: UserPlus,      color: 'bg-amber-50 text-amber-600' },
  ]

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Welcome bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Good morning, {user?.name?.split(' ')[0]} 👋</h2>
          <p className="text-sm text-gray-500 mt-0.5">{user?.academy} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <div className="flex gap-2">
          {quickActions.map(a => (
            <Link key={a.label} to={a.to} className={`hidden md:flex items-center gap-2 ${a.color} px-3 py-2 rounded-lg text-xs font-semibold hover:opacity-80 transition`}>
              <a.icon size={14} />
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Students"
          value={activeStudents}
          sub={`${students.length - activeStudents} inactive`}
          icon={Users}
          color="blue"
          trend="+3 this month"
        />
        <StatCard
          label="Today's Attendance"
          value={`${todayAttendance}/${activeStudents}`}
          sub={`${Math.round((todayAttendance / activeStudents) * 100)}% present`}
          icon={CalendarCheck}
          color="green"
          trend="↑ from yesterday"
        />
        <StatCard
          label="Pending Fees"
          value={`₹${pendingAmt.toLocaleString('en-IN')}`}
          sub={`${overdueCount} overdue`}
          icon={CreditCard}
          color="amber"
          trend={overdueCount > 0 ? `${overdueCount} overdue` : 'All good'}
        />
        <StatCard
          label="Monthly Revenue"
          value={`₹${paidAmt.toLocaleString('en-IN')}`}
          sub="April 2026"
          icon={TrendingUp}
          color="purple"
          trend="↑ vs last month"
        />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Revenue area chart */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-gray-900">Revenue Trend</h3>
              <p className="text-xs text-gray-500">Oct 2025 – May 2026</p>
            </div>
            <span className="badge badge-blue">₹ Monthly</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={revenueData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [`₹${v.toLocaleString('en-IN')}`, 'Revenue']} contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: 12 }} />
              <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2.5} fill="url(#revGrad)" />
              <Area type="monotone" dataKey="target" stroke="#e5e7eb" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Sport breakdown pie */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-1">Students by Sport</h3>
          <p className="text-xs text-gray-500 mb-4">Active enrollment</p>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie data={sportBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="count" paddingAngle={2}>
                {sportBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, n, { payload }) => [v, payload.sport]} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-2 gap-1 mt-3">
            {sportBreakdown.map((s, i) => (
              <div key={s.sport} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }}></div>
                <span className="text-xs text-gray-600 truncate">{s.sport}</span>
                <span className="text-xs font-bold text-gray-900 ml-auto">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Recent payments */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900">Recent Payments</h3>
            <Link to="/payments" className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentPayments.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
                  {p.student[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.student}</p>
                  <p className="text-xs text-gray-400">{p.month}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">₹{p.amount.toLocaleString('en-IN')}</p>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick actions + summary */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-bold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              {quickActions.map(a => (
                <Link key={a.label} to={a.to}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition group"
                >
                  <div className={`w-9 h-9 ${a.color} rounded-lg flex items-center justify-center`}>
                    <a.icon size={16} />
                  </div>
                  <span className="text-sm font-semibold text-gray-700 flex-1">{a.label}</span>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500 transition" />
                </Link>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-bold text-gray-900 mb-3">Alerts</h3>
            <div className="space-y-2.5">
              <AlertRow icon={CreditCard} color="text-amber-600" bg="bg-amber-50" text={`${overdueCount} students overdue`} />
              <AlertRow icon={UserPlus} color="text-brand-600" bg="bg-brand-50" text={`${newTrials} trial follow-ups pending`} />
              <AlertRow icon={CalendarCheck} color="text-emerald-600" bg="bg-emerald-50" text="Attendance marked for today" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, icon: Icon, color, trend }) {
  const colorMap = {
    blue:   { bg: 'bg-brand-50',   icon: 'text-brand-600',   border: 'border-brand-100' },
    green:  { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100' },
    amber:  { bg: 'bg-amber-50',   icon: 'text-amber-600',   border: 'border-amber-100' },
    purple: { bg: 'bg-purple-50',  icon: 'text-purple-600',  border: 'border-purple-100' },
  }
  const c = colorMap[color]
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        <div className={`w-9 h-9 ${c.bg} rounded-xl flex items-center justify-center`}>
          <Icon size={18} className={c.icon} />
        </div>
      </div>
      <p className="text-2xl font-black text-gray-900">{value}</p>
      <p className="text-xs text-gray-400 mt-1">{sub}</p>
    </div>
  )
}

function AlertRow({ icon: Icon, color, bg, text }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-7 h-7 ${bg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        <Icon size={13} className={color} />
      </div>
      <p className="text-xs text-gray-600 font-medium">{text}</p>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    Paid:    'badge-green',
    Pending: 'badge-yellow',
    Overdue: 'badge-red',
  }
  return <span className={`badge ${map[status] || 'badge-gray'} mt-0.5`}>{status}</span>
}
