import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useLoginThrottle } from '../lib/loginThrottle'
import { Zap, ArrowRight } from 'lucide-react'

export default function StaffLogin() {
  const { loginStaff } = useApp()
  const navigate = useNavigate()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const { blocked, secondsLeft, recordFailure, reset } = useLoginThrottle('staff')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (blocked) return
    if (!email || !password) { setError('Please fill all fields'); return }
    setLoading(true); setError('')
    try {
      const result = await loginStaff(email.trim(), password)
      reset()
      navigate(result?.accessRole && result.accessRole !== 'coach' ? '/dashboard' : '/staff/home')
    } catch (err) {
      recordFailure()
      setError(err.message || 'Login failed')
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

          <h1 className="text-2xl font-black text-gray-900 mb-1">Staff login</h1>
          <p className="text-sm text-gray-500 mb-6">Sign in with your email and password</p>

          {blocked && (
            <div className="bg-orange-50 border border-orange-200 text-orange-700 text-sm px-4 py-3 rounded-lg mb-5">
              Too many failed attempts. Try again in {secondsLeft}s.
            </div>
          )}
          {!blocked && error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input className="input pr-10" type={showPw ? 'text' : 'password'}
                  placeholder="••••••••" value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                <button type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(s => !s)}>
                  {showPw
                    ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
                    : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  }
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading || blocked}
              className="w-full btn-primary justify-center py-3 text-base mt-2">
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Signing in…
                </span>
              ) : <><span>Sign In</span><ArrowRight size={16} /></>}
            </button>
          </form>

          <p className="text-xs text-gray-500 text-center mt-6">
            First time?{' '}
            <Link to="/staff-activate" className="text-brand-600 font-semibold hover:underline">
              Activate your account
            </Link>
          </p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <Link to="/login" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
              Owner login
            </Link>
            <span className="text-gray-200">·</span>
            <Link to="/student-login" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
              Student login
            </Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-gray-900 via-brand-900 to-gray-900 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22%23ffffff%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C%2Fg%3E%3C%2Fsvg%3E')]" />
        <div className="relative max-w-md text-white">
          <div className="text-4xl font-black mb-6 leading-tight">
            Your academy,<br />
            <span className="text-brand-400">right in your pocket</span>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed mb-8">
            View your batches, mark attendance, check notices — all from your phone.
          </p>
          <div className="space-y-3">
            {[
              'Mark student attendance by batch',
              'View your schedule & rosters',
              'Read academy announcements',
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
