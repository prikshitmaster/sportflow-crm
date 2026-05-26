import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, ArrowRight, CheckCircle, KeyRound, Mail } from 'lucide-react'
import * as db from '../lib/db'

export default function StaffActivate() {
  const { activateStaff, role, logoutOwner, logoutStaff, logoutStudent, logoutParent } = useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const urlId   = searchParams.get('id')   || ''
  const urlCode = searchParams.get('code') || ''

  const [staffId,  setStaffId]  = useState(urlId.toUpperCase())
  const [joinCode, setJoinCode] = useState(urlCode.toUpperCase())
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [step,     setStep]     = useState(1)   // 1: verify  2: set email+password  3: done
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [staffName, setStaffName] = useState('')

  const handleStep1 = async (e) => {
    e.preventDefault()
    if (!staffId.trim() || !joinCode.trim()) { setError('Both fields are required'); return }
    setLoading(true); setError('')
    try {
      const result = await db.verifyStaffCodes(staffId.trim().toUpperCase(), joinCode.trim().toUpperCase())
      setStaffName(result?.name || '')
      setStep(2)
    } catch (err) {
      setError(err.message || 'Invalid codes.')
    } finally {
      setLoading(false)
    }
  }

  const handleStep2 = async (e) => {
    e.preventDefault()
    if (!email.trim())                       { setError('Email is required'); return }
    if (!/\S+@\S+\.\S+/.test(email))        { setError('Enter a valid email'); return }
    if (password.length < 6)                 { setError('Password must be at least 6 characters'); return }
    if (password !== confirm)                { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    try {
      const member = await activateStaff(
        staffId.trim().toUpperCase(),
        joinCode.trim().toUpperCase(),
        password,
        { email: email.trim() }
      )
      // Sign out any pre-existing session in this browser so the
      // "Go to Login" button doesn't bounce back to that account's home.
      // (Common case: owner generated the invite link and is opening it in
      // the same browser to test — without this, /staff-login → PublicRoute
      // would silently redirect them to /dashboard as the owner.)
      try {
        if (role === 'owner')   await logoutOwner()
        if (role === 'staff')   await logoutStaff()
        if (role === 'student') await logoutStudent()
        if (role === 'parent')  await logoutParent()
      } catch {}
      setStaffName(member?.name || '')
      setStep(3)
    } catch (err) {
      setError(err.message || 'Activation failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">SportFlow</span>
        </div>

        {step < 3 && (
          <div className="flex items-center gap-2 mb-6">
            {[1, 2].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  step >= s ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'
                }`}>{s}</div>
                {s < 2 && <div className={`h-0.5 w-8 ${step > s ? 'bg-brand-600' : 'bg-gray-200'}`} />}
              </div>
            ))}
            <span className="text-xs text-gray-500 ml-2">
              {step === 1 ? 'Verify your link' : 'Set email & password'}
            </span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">

          {/* ── Step 1: Verify ── */}
          {step === 1 && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                  <KeyRound size={20} className="text-brand-600" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-gray-900">Activate Account</h1>
                  <p className="text-xs text-gray-500">
                    {urlId && urlCode ? 'Your link is ready — click Continue' : 'Enter the codes from your admin'}
                  </p>
                </div>
              </div>

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleStep1} className="space-y-4">
                <div>
                  <label className="label">Staff ID</label>
                  <input
                    className={`input font-mono tracking-wider text-lg ${urlId ? 'bg-gray-50 text-gray-500' : ''}`}
                    type="text"
                    placeholder="FC001 or OF001"
                    value={staffId}
                    onChange={e => setStaffId(e.target.value.toUpperCase())}
                    readOnly={!!urlId}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="label">Join Code</label>
                  <input
                    className={`input font-mono tracking-widest text-lg uppercase ${urlCode ? 'bg-gray-50 text-gray-500' : ''}`}
                    type="text"
                    placeholder="ABC123"
                    maxLength={6}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    readOnly={!!urlCode}
                    autoComplete="off"
                  />
                </div>
                <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3">
                  {loading ? <Spinner /> : <>Continue <ArrowRight size={16} /></>}
                </button>
              </form>
            </>
          )}

          {/* ── Step 2: Email + Password ── */}
          {step === 2 && (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                  <Mail size={20} className="text-purple-600" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-gray-900">Set Login Details</h1>
                  <p className="text-xs text-gray-500">Your email and password to sign in</p>
                </div>
              </div>
              {staffName && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-5">
                  <CheckCircle size={16} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-emerald-800">Activating account for:</p>
                    <p className="text-sm font-semibold text-emerald-900">{staffName}</p>
                    <p className="text-[11px] text-emerald-600 mt-0.5">Not you? Go back and enter the correct ID.</p>
                  </div>
                </div>
              )}

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleStep2} className="space-y-4">
                <div>
                  <label className="label">Email *</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="you@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                  />
                  <p className="text-xs text-gray-400 mt-1">You'll use this to log in</p>
                </div>
                <div>
                  <label className="label">Password *</label>
                  <input className="input" type="password" placeholder="Min 6 characters"
                    value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
                <div>
                  <label className="label">Confirm Password *</label>
                  <input className="input" type="password" placeholder="Repeat password"
                    value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(1); setError('') }}
                    className="flex-1 btn-secondary justify-center py-3">Back</button>
                  <button type="submit" disabled={loading} className="flex-1 btn-primary justify-center py-3">
                    {loading ? <Spinner /> : <>Activate <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* ── Step 3: Done ── */}
          {step === 3 && (
            <div className="text-center py-4">
              <div className="flex justify-center mb-5">
                <CheckCircle size={56} className="text-emerald-500" strokeWidth={1.5} />
              </div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">You're in!</h2>
              <p className="text-gray-500 text-sm mb-1">Account activated successfully</p>
              {staffName && <p className="text-brand-600 font-semibold mb-6">Welcome, {staffName}!</p>}
              <button onClick={() => navigate('/staff-login')} className="w-full btn-primary justify-center py-3">
                Go to Login <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {step < 3 && (
          <p className="text-xs text-gray-400 text-center mt-5">
            Already activated?{' '}
            <Link to="/staff-login" className="text-brand-600 font-semibold hover:underline">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
    </svg>
  )
}

function ErrorBox({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
      {msg}
    </div>
  )
}
