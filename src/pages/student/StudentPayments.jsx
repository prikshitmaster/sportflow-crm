import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { isOutstanding, firstOfMonthIso } from '../../lib/studentRules'
import { CreditCard, CheckCircle2, Clock, AlertCircle, IndianRupee } from 'lucide-react'

const statusIcon = {
  Paid:    <CheckCircle2 size={16} className="text-emerald-500" />,
  Pending: <Clock size={16} className="text-amber-500" />,
  Overdue: <AlertCircle size={16} className="text-red-500" />,
}

const statusBadge = {
  Paid:    'badge-green',
  Pending: 'badge-yellow',
  Overdue: 'badge-red',
}

export default function StudentPayments() {
  const { studentUser } = useApp()
  const [payments, setPayments] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!studentUser?.id) return
    db.fetchStudentOwnPayments(studentUser.id)
      .then(setPayments)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [studentUser])

  // The owner's Payments page shows overdue from TWO sources: persisted
  // 'Overdue' rows AND a virtual row computed from the student's expired
  // paid_till when no open (Pending/Overdue) record exists. This portal only
  // read persisted rows, so a student whose dues are virtual-only saw nothing.
  // Mirror the owner logic (lib/studentRules) so the two views agree.
  const records = useMemo(() => {
    const hasOpenRecord = payments.some(p => p.status === 'Overdue' || p.status === 'Pending')
    const outstanding = !!studentUser && isOutstanding(
      { status: studentUser.status, paidTill: studentUser.paid_till },
      firstOfMonthIso(),
    )
    if (!outstanding || hasOpenRecord) return payments
    const virtual = {
      id:     `DUE-${studentUser.id}`,
      amount: Number(studentUser.fees) || 0,
      month:  studentUser.paid_till
        ? `Due — paid till ${new Date(studentUser.paid_till + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
        : 'Fees due',
      date:   null,
      status: 'Overdue',
      mode:   null,
    }
    return [virtual, ...payments]
  }, [payments, studentUser])

  const paid    = records.filter(p => p.status === 'Paid')
  const unpaid  = records.filter(p => p.status !== 'Paid')
  const totalPaid = paid.reduce((s, p) => s + (p.amount || 0), 0)
  const totalDue  = unpaid.reduce((s, p) => s + (p.amount || 0), 0)

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900">Fee History</h1>
        <p className="text-sm text-gray-500">Your monthly fee records</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-700">Paid</span>
          </div>
          <p className="text-2xl font-black text-emerald-700">₹{totalPaid.toLocaleString('en-IN')}</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle size={14} className="text-red-600" />
            <span className="text-xs font-semibold text-red-700">Outstanding</span>
          </div>
          <p className="text-2xl font-black text-red-700">₹{totalDue.toLocaleString('en-IN')}</p>
        </div>
      </div>

      {/* Payments list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <CreditCard size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No payment records yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map(p => (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center">
                    {statusIcon[p.status] || <CreditCard size={16} className="text-gray-400" />}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{p.month}</p>
                    <p className="text-xs text-gray-400">
                      {p.date
                        ? `Paid on ${new Date(p.date).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}`
                        : p.status === 'Overdue' ? 'Payment overdue' : 'Due this month'
                      }
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-gray-900">₹{p.amount?.toLocaleString('en-IN')}</p>
                  <span className={`badge ${statusBadge[p.status] || 'badge-gray'}`}>{p.status}</span>
                </div>
              </div>
              {p.mode && (
                <div className="mt-2 pt-2 border-t border-gray-50">
                  <p className="text-xs text-gray-400">Payment mode: <span className="font-medium text-gray-600">{p.mode}</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <p className="text-xs text-blue-700">
          <span className="font-semibold">Note:</span> For payment queries, contact your academy admin directly.
        </p>
      </div>
    </div>
  )
}
