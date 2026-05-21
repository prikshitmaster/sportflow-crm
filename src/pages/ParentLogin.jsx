import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, ArrowRight, Phone } from 'lucide-react'

// Parent login uses Supabase Auth phone OTP.
// Two stages: enter phone → enter 6-digit OTP → on success, calls
// secure_claim_parent_account to bind the auth.users row to the parents table.
// This means the academy must have pre-added the parent record for the same phone.

export default function ParentLogin() {
  const { sendParentOtp, verifyParentOtp, testLoginParent } = useApp()
  const navigate = useNavigate()

  const [stage,    setStage]    = useState('phone')   // 'phone' | 'otp'
  const [phone,    setPhone]    = useState('')
  const [otp,      setOtp]      = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // Normalise to E.164 — assume India if 10 digits with no country code
  const normalisePhone = (raw) => {
    const digits = String(raw).replace(/[^\d+]/g, '')
    if (digits.startsWith('+')) return digits
    if (digits.length === 10)   return '+91' + digits
    return digits
  }

  const sendCode = async (e) => {
    e?.preventDefault()
    const p = normalisePhone(phone)
    if (!/^\+\d{10,15}$/.test(p)) { setError('Enter a valid phone number'); return }
    setLoading(true); setError('')
    try {
      await sendParentOtp(p)
      setStage('otp')
    } catch (err) {
      setError(err?.message || 'Could not send code')
    } finally { setLoading(false) }
  }

  // DEV ONLY — skip OTP, log in straight from phone
  const devSkipOtp = async () => {
    const p = String(phone).replace(/\D/g, '').slice(-10)
    if (p.length !== 10) { setError('Enter a 10-digit phone'); return }
    setLoading(true); setError('')
    try {
      await testLoginParent(p)
      navigate('/parent/home')
    } catch (err) {
      setError(err?.message || 'Test login failed (is ENABLE_PARENT_TEST_LOGIN set?)')
    } finally { setLoading(false) }
  }

  const verifyCode = async (e) => {
    e?.preventDefault()
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the code'); return }
    setLoading(true); setError('')
    try {
      const p = normalisePhone(phone)
      await verifyParentOtp(p, otp)
      navigate('/parent/home')
    } catch (err) {
      setError(err?.message || 'Invalid code or this number is not registered as a parent')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">

          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SportFlow</span>
          </div>

          <h1 className="text-2xl font-black text-gray-900 mb-1">Parent login</h1>
          <p className="text-sm text-gray-500 mb-6">
            {stage === 'phone'
              ? 'Sign in with the phone number registered with your academy'
              : `We sent a code to ${normalisePhone(phone)}`}
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}

          {stage === 'phone' ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div>
                <label className="label">Phone number</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="input pl-9"
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Use the number you gave the academy. India numbers don't need +91.
                </p>
              </div>
              <button type="submit" disabled={loading}
                className="w-full btn-primary justify-center py-3 text-base mt-2">
                {loading
                  ? <span className="flex items-center gap-2">Sending code…</span>
                  : <><span>Send code</span><ArrowRight size={16} /></>}
              </button>
              {import.meta.env.DEV && (
                <button type="button" onClick={devSkipOtp} disabled={loading}
                  className="w-full py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition">
                  ⚡ Skip OTP (dev only)
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4">
              <div>
                <label className="label">6-digit code</label>
                <input
                  className="input tracking-widest text-center text-lg"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="123456"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading}
                className="w-full btn-primary justify-center py-3 text-base mt-2">
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>
              <button type="button" onClick={() => { setStage('phone'); setOtp(''); setError('') }}
                className="w-full text-xs text-gray-500 hover:text-gray-700 underline">
                Use a different number
              </button>
            </form>
          )}

          <div className="flex items-center justify-center gap-4 mt-6">
            <Link to="/login" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
              Owner login
            </Link>
            <span className="text-gray-200">·</span>
            <Link to="/staff-login" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
              Staff login
            </Link>
            <span className="text-gray-200">·</span>
            <Link to="/student-login" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
              Student login
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-gray-900 via-brand-900 to-gray-900 items-center justify-center p-12 relative overflow-hidden">
        <div className="relative max-w-md text-white">
          <div className="text-4xl font-black mb-6 leading-tight">
            Stay close to your<br />
            <span className="text-brand-400">child's journey</span>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed mb-8">
            See attendance, pay fees, and get updates from your academy — for every child, in one place.
          </p>
          <div className="space-y-3">
            {[
              'See every child in one dashboard',
              'Pay fees online via UPI / card',
              'Get attendance & event alerts',
            ].map(f => (
              <div key={f} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-gray-200">{f}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
