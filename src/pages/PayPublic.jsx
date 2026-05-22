import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as db from '../lib/db'
import { Zap, CreditCard, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}

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

// Public landing page for a shared payment link. Anyone with the short code can
// open this page and pay. The link itself is the bearer — no login required.
export default function PayPublic() {
  const { shortCode } = useParams()
  const [loading, setLoading] = useState(true)
  const [data,    setData]    = useState(null)
  const [error,   setError]   = useState('')
  const [paying,  setPaying]  = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await db.fetchPaymentLink(shortCode)
        if (cancelled) return
        if (!r?.ok) {
          setError(r?.reason === 'not_found_or_expired'
            ? 'This payment link has expired or was already used.'
            : 'Could not load payment link.')
        } else {
          setData(r)
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [shortCode])

  const pay = async () => {
    if (!data?.link) return
    setPaying(true); setError('')
    try {
      await loadRazorpayScript()

      const order = await db.createRazorpayOrder({
        studentId:     data.student.id,
        amount:        data.link.amount,
        monthsCovered: data.link.months_covered || 1,
        coverageStart: data.link.coverage_start || null,
        paymentLinkId: data.link.id,
      })
      if (!order?.orderId) throw new Error(order?.error || 'Could not create order')

      const rzp = new window.Razorpay({
        key:      order.keyId,
        order_id: order.orderId,
        amount:   order.amount,
        currency: order.currency || 'INR',
        name:     data.academy?.name || 'Academy',
        description: data.link.description || `Fees for ${data.student.name}`,
        prefill:  order.prefill || {},
        theme:    { color: '#2563eb' },
        handler:  () => { setSuccess(true); setPaying(false) },
        modal:    { ondismiss: () => setPaying(false) },
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <Zap size={13} className="text-white" />
          </div>
          <span className="font-bold text-gray-900 text-sm">SportFlow</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm">
          {loading && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <Loader2 size={28} className="animate-spin text-brand-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )}

          {!loading && error && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
              <p className="font-bold text-gray-900 mb-1">Link unavailable</p>
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          )}

          {!loading && success && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <CheckCircle2 size={36} className="text-emerald-500 mx-auto mb-3" />
              <p className="font-bold text-gray-900 mb-1">Payment received</p>
              <p className="text-sm text-gray-500">Your receipt will be available shortly in your parent dashboard.</p>
            </div>
          )}

          {!loading && !error && !success && data && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              {data.academy?.logo_url && (
                <img src={data.academy.logo_url} alt={data.academy.name}
                  className="w-14 h-14 rounded-xl object-cover mx-auto mb-3" />
              )}
              <p className="text-center text-sm text-gray-500 mb-1">{data.academy?.name}</p>
              <h1 className="text-center text-xl font-black text-gray-900 mb-1">Pay fees</h1>
              <p className="text-center text-sm text-gray-500 mb-5">
                For <span className="font-semibold text-gray-900">{data.student?.name}</span>
                {data.student?.sport ? ` · ${data.student.sport}` : ''}
              </p>

              <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2 text-sm">
                {data.link.description && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">For</span>
                    <span className="text-gray-900 text-right">{data.link.description}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Months</span>
                  <span className="text-gray-900">{data.link.months_covered || 1}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2">
                  <span className="font-semibold text-gray-700">Amount</span>
                  <span className="text-2xl font-black text-brand-700">
                    {formatINR(data.link.amount)}
                  </span>
                </div>
              </div>

              <button onClick={pay} disabled={paying}
                className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 transition disabled:opacity-50">
                {paying
                  ? <><Loader2 size={16} className="animate-spin" /> Opening payment…</>
                  : <><CreditCard size={16} /> Pay {formatINR(data.link.amount)}</>}
              </button>
              <p className="text-[11px] text-gray-400 text-center mt-3">
                Powered by Razorpay · UPI, cards & netbanking
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
