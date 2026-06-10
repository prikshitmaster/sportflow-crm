import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { CreditCard, AlertCircle, CheckCircle2, Calendar, User } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toLocalDateStr } from '../../lib/dates'

function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}

function paymentBadge(child, firstOfMonth) {
  if (!child.paid_till) return { label: 'No payment on file', tone: 'gray' }
  if (child.paid_till >= firstOfMonth) {
    return { label: `Paid till ${new Date(child.paid_till + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`, tone: 'green' }
  }
  return { label: 'Fees overdue', tone: 'red' }
}

export default function ParentDashboard() {
  const { parentUser } = useApp()
  const [loading, setLoading] = useState(true)
  const [children, setChildren] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dash = await db.fetchParentDashboard()
        if (cancelled) return
        setChildren(dash?.children || [])
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const now = new Date()
  const firstOfMonth = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1))

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-5 space-y-3">
        <div className="h-28 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
        <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 text-center">
        <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="font-bold text-gray-900 mb-1">No children linked yet</p>
        <p className="text-sm text-gray-500">Ask your academy to link your child to this phone number.</p>
      </div>
    )
  }

  const overdueCount = children.filter(c => c.paid_till && c.paid_till < firstOfMonth).length

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl p-5 text-white shadow-sm">
        <p className="text-xs text-brand-100 mb-1">Welcome back</p>
        <h1 className="text-xl font-black mb-3">{parentUser?.name || 'Parent'}</h1>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wide text-brand-100">Children</p>
            <p className="text-2xl font-black">{children.length}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wide text-brand-100">Fees overdue</p>
            <p className="text-2xl font-black">{overdueCount}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {children.map(c => {
          const badge = paymentBadge(c, firstOfMonth)
          const toneCls = badge.tone === 'green' ? 'bg-emerald-50 text-emerald-700'
                        : badge.tone === 'red'   ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-gray-600'
          return (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                {c.photo_url
                  ? <img src={c.photo_url} alt={c.name} className="w-12 h-12 rounded-full object-cover" />
                  : <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold">{c.name?.[0]}</div>}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-500">
                    {[c.sport, c.batch, c.student_code].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${toneCls}`}>
                  {badge.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-gray-400 mb-0.5">Monthly fee</p>
                  <p className="font-bold text-gray-900">{formatINR(c.fees)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-gray-400 mb-0.5">Plan</p>
                  <p className="font-bold text-gray-900 capitalize">{c.fee_plan || 'monthly'}</p>
                </div>
              </div>

              {badge.tone === 'red' && (
                <Link to={`/parent/payments?child=${c.id}`}
                  className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 bg-emerald-600 text-white font-semibold text-sm rounded-xl hover:bg-emerald-700 transition">
                  <CreditCard size={14} /> Pay now
                </Link>
              )}
              {badge.tone === 'green' && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-emerald-700 bg-emerald-50 py-2 rounded-xl">
                  <CheckCircle2 size={14} /> All up to date
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
