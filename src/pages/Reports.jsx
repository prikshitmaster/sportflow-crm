import { useApp } from '../context/AppContext'
import { revenueData, attendanceData as attendanceTrend } from '../data/mockData'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Download, TrendingUp, Users, CreditCard, UserPlus } from 'lucide-react'

export default function Reports() {
  const { students, payments, trials } = useApp()

  const activeStudents = students.filter(s => s.status === 'Active').length
  const totalRevenue = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + p.amount, 0)
  const pendingRevenue = payments.filter(p => p.status !== 'Paid').reduce((s, p) => s + p.amount, 0)
  const convRate = trials.length ? Math.round((trials.filter(t=>t.converted).length / trials.length) * 100) : 0

  const overduePayments = payments.filter(p => p.status === 'Overdue').sort((a,b) => b.amount - a.amount)

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-black text-gray-900">Reports & Analytics</h2>
          <p className="text-sm text-gray-500">Academy performance at a glance</p>
        </div>
        <button className="btn-secondary text-xs">
          <Download size={14} /> Export PDF
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Students',     value: activeStudents,                        icon: Users,      color: 'text-brand-600',   bg: 'bg-brand-50' },
          { label: 'Revenue (Apr 2026)', value: `₹${totalRevenue.toLocaleString('en-IN')}`, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pending Collection', value: `₹${pendingRevenue.toLocaleString('en-IN')}`, icon: CreditCard, color: 'text-amber-600',   bg: 'bg-amber-50' },
          { label: 'Trial Conversion',   value: `${convRate}%`,                         icon: UserPlus,   color: 'text-purple-600',  bg: 'bg-purple-50' },
        ].map(k => (
          <div key={k.label} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{k.label}</p>
              <div className={`w-9 h-9 ${k.bg} rounded-xl flex items-center justify-center`}>
                <k.icon size={18} className={k.color} />
              </div>
            </div>
            <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue vs Target */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-gray-900">Revenue vs Target</h3>
            <p className="text-xs text-gray-500">Monthly comparison</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-brand-600 rounded-sm"></div>Revenue</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 bg-gray-200 rounded-sm"></div>Target</div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={revenueData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v,n) => [`₹${v.toLocaleString('en-IN')}`, n === 'revenue' ? 'Revenue' : 'Target']} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
            <Bar dataKey="revenue" fill="#2563eb" radius={[4,4,0,0]} />
            <Bar dataKey="target" fill="#e5e7eb" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Attendance trend */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-1">Attendance Trend</h3>
          <p className="text-xs text-gray-500 mb-4">Monthly attendance rate %</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={attendanceTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[70, 100]} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
              <Tooltip formatter={(v) => [`${v}%`, 'Attendance']} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }} />
              <Line type="monotone" dataKey="rate" stroke="#10b981" strokeWidth={2.5} dot={{ fill: '#10b981', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pending collection table */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-4">Overdue Collections</h3>
          <div className="space-y-2.5">
            {overduePayments.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No overdue payments 🎉</p>
            ) : overduePayments.map(p => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{p.student}</p>
                  <p className="text-xs text-gray-400">{p.month}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-600">₹{p.amount.toLocaleString('en-IN')}</p>
                  <p className="text-xs text-gray-400">Overdue</p>
                </div>
              </div>
            ))}
          </div>
          {overduePayments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500">Total Overdue</p>
              <p className="text-sm font-black text-red-600">
                ₹{overduePayments.reduce((s,p) => s+p.amount, 0).toLocaleString('en-IN')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
