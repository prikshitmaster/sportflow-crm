import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as db from '../../lib/db'
import { CreditCard, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}

// Lazy-loads the Razorpay Checkout script tag once
function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload  = () => resolve(true)
    s.onerror = () => reject(new Error('Could not load payment gateway'))
    document.body.appendChild(s)
  })
}

export default function ParentPayments() {
  const [params] = useSearchParams()
  const preselect = params.get('child')

  const [loading, setLoading] = useState(true)
  const [children, setChildren] = useState([])
  const [activeChildId, setActiveChildId] = useState(null)
  const [months, setMonths] = useState(1)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const dash = await db.fetchParentDashboard()
        if (cancelled) return
        const list = dash?.children || []
        setChildren(list)
        setActiveChildId(preselect ? Number(preselect) : list[0]?.id ?? null)
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [preselect])

  const child = useMemo(() => children.find(c => c.id === activeChildId), [children, activeChildId])

  const baseFee = Number(child?.fees || 0)
  const plan    = child?.fee_plan || 'monthly'
  const amount  = plan === 'monthly' ? baseFee * months : baseFee

  const handlePay = async () => {
    if (!child || amount <= 0) return
    setPaying(true); setError(''); setSuccessMsg('')
    try {
      await loadRazorpayScript()

      const order = await db.createRazorpayOrder({
        studentId:     child.id,
        amount,
        monthsCovered: plan === 'monthly' ? months : (plan === 'yearly' ? 12 : 3),
      })

      if (!order?.orderId) throw new Error(order?.error || 'Could not create order')

      const rzp = new window.Razorpay({
        key:      order.keyId,
        order_id: order.orderId,
        amount:   order.amount,
        currency: order.currency || 'INR',
        name:     'SportFlow',
        description: `Fees for ${child.name}`,
        prefill:  order.prefill || {},
        theme:    { color: '#2563eb' },
        handler: function () {
          // Checkout closed after payment. The webhook will record it server-side
          // within a few seconds. Show optimistic success.
          setSuccessMsg('Payment received — your receipt will appear shortly.')
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      })
      rzp.on('payment.failed', (resp) => {
        setError(resp?.error?.description || 'Payment failed')
        setPaying(false)
      })
      rzp.open()
    } catch (e) {
      setError(e?.message || 'Could not start payment')
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-5">
        <div className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (children.length === 0) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 text-center">
        <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No children linked yet.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
      <h1 className="text-xl font-black text-gray-900">Pay fees</h1>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <label className="label">Select child</label>
        <div className="grid grid-cols-1 gap-2">
          {children.map(c => (
            <button key={c.id}
              onClick={() => setActiveChildId(c.id)}
              className={`text-left px-3 py-2.5 rounded-xl border transition ${
                activeChildId === c.id
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}>
              <p className="font-semibold text-sm text-gray-900">{c.name}</p>
              <p className="text-[11px] text-gray-500">
                {[c.sport, c.batch, c.student_code].filter(Boolean).join(' · ')}
              </p>
            </button>
          ))}
        </div>
      </div>

      {child && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Plan</span>
            <span className="font-semibold text-gray-900 capitalize">{plan}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">{plan === 'monthly' ? 'Monthly fee' : 'Plan amount'}</span>
            <span className="font-semibold text-gray-900">{formatINR(baseFee)}</span>
          </div>

          {plan === 'monthly' && (
            <div>
              <label className="label">Months to pay for</label>
              <div className="flex gap-2">
                {[1, 3, 6, 12].map(m => (
                  <button key={m}
                    onClick={() => setMonths(m)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                      months === m
                        ? 'border-brand-600 bg-brand-50 text-brand-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}>
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Total</span>
            <span className="text-xl font-black text-brand-700">{formatINR(amount)}</span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs px-3 py-2 rounded-lg flex items-center gap-2">
              <CheckCircle2 size={14} /> {successMsg}
            </div>
          )}

          <button onClick={handlePay} disabled={paying || amount <= 0 || !!successMsg}
            className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 transition disabled:opacity-50">
            {paying
              ? <><Loader2 size={16} className="animate-spin" /> Opening payment…</>
              : <><CreditCard size={16} /> Pay {formatINR(amount)}</>}
          </button>

          <p className="text-[11px] text-gray-400 text-center">
            Powered by Razorpay · UPI, cards & netbanking
          </p>
        </div>
      )}
    </div>
  )
}
