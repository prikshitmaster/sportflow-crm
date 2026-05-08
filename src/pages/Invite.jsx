import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, CheckCircle } from 'lucide-react'
import * as db from '../lib/db'
import { ACCESS_ROLE_LABEL, PERM_LABEL } from '../lib/permissions'

export default function Invite() {
  const { token } = useParams()
  const navigate   = useNavigate()

  const [invite,   setInvite]   = useState(null)
  const [checking, setChecking] = useState(true)
  const [invalid,  setInvalid]  = useState(false)
  const [done,     setDone]     = useState(false)

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // demo token — just show a demo notice
  const isDemo = token?.startsWith('demo-')

  useEffect(() => {
    if (isDemo) { setChecking(false); return }
    db.fetchInviteByToken(token)
      .then(data => {
        if (!data) setInvalid(true)
        else setInvite(data)
      })
      .catch(() => setInvalid(true))
      .finally(() => setChecking(false))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) return
    setError('')
    setLoading(true)
    try {
      await db.acceptInvite(token, email, password)
      setDone(true)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <svg className="animate-spin h-5 w-5 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Validating invite…
        </div>
      </div>
    )
  }

  if (isDemo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Zap size={22} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-gray-900">SportFlow CRM</h1>
          </div>
          <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6 text-center">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-amber-600 font-bold text-lg">!</span>
            </div>
            <h2 className="text-base font-bold text-gray-900 mb-2">Demo Invite Link</h2>
            <p className="text-sm text-gray-500 mb-4">
              This is a demo invite link. In production, real staff would land here, set their email + password, and get instant portal access.
            </p>
            <button onClick={() => navigate('/login')} className="btn-primary w-full justify-center">
              Back to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Zap size={22} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-gray-900">SportFlow CRM</h1>
          </div>
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-6 text-center">
            <p className="text-sm font-bold text-red-600 mb-2">Invite link invalid or expired</p>
            <p className="text-sm text-gray-500 mb-4">Ask your academy owner to generate a new invite link.</p>
            <button onClick={() => navigate('/login')} className="btn-secondary w-full justify-center">
              Back to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <CheckCircle size={48} className="text-emerald-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-gray-900 mb-2">Account created!</h2>
          <p className="text-sm text-gray-500 mb-2">
            Your account is ready. Use your email and password to log in.
          </p>
          <p className="text-xs text-gray-400 mb-5">
            If email confirmation is required, check your inbox first.
          </p>
          <button onClick={() => navigate('/login')} className="btn-primary justify-center">
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Zap size={22} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-900">SportFlow CRM</h1>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {/* Invite info banner */}
          {invite && (
            <div className="bg-brand-50 border border-brand-100 rounded-xl px-4 py-3 mb-6">
              <p className="text-xs text-brand-600 font-semibold uppercase tracking-wide mb-0.5">You're invited to</p>
              <p className="text-sm font-bold text-gray-900">{invite.academy_name || 'SportFlow Academy'}</p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full font-semibold">
                  {ACCESS_ROLE_LABEL[invite.access_role] || invite.access_role}
                </span>
                <span className="text-xs text-brand-500">
                  {invite.permissions?.length || 0} permissions
                </span>
              </div>
              {invite.permissions?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {invite.permissions.slice(0, 4).map(p => (
                    <span key={p} className="text-[10px] bg-white border border-brand-100 text-brand-600 px-1.5 py-0.5 rounded font-medium">
                      {PERM_LABEL[p] || p}
                    </span>
                  ))}
                  {invite.permissions.length > 4 && (
                    <span className="text-[10px] text-brand-400">+{invite.permissions.length - 4} more</span>
                  )}
                </div>
              )}
            </div>
          )}

          <h2 className="text-lg font-black text-gray-900 mb-1">Set Up Your Account</h2>
          <p className="text-sm text-gray-500 mb-5">
            Hi <strong>{invite?.name}</strong>! Choose your email and password to activate your portal access.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Your Email *</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password *</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full justify-center" disabled={loading}>
              {loading ? 'Creating account…' : 'Activate Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
