// Signup page — Owner creates new academy account, Staff joins existing academy
// Owner: name + academy name + email + password
// Staff: name + email + password + 6-char academy join code (owner shares this)

import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, ArrowRight, ShieldCheck, UserCog, Building, Key } from 'lucide-react'
import DevFillButton from '../components/DevFillButton'
import { fillSignupOwner } from '../lib/devFill'

export default function Signup() {
  const { signupOwner, signupStaff } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Pre-select 'staff' tab if coming from Login → Staff → Sign up
  const [tab, setTab] = useState(params.get('role') === 'staff' ? 'staff' : 'owner')

  // Owner form fields
  const [ownerName,    setOwnerName]    = useState('')
  const [academyName,  setAcademyName]  = useState('')
  const [ownerEmail,   setOwnerEmail]   = useState('')
  const [ownerPw,      setOwnerPw]      = useState('')

  // Staff form fields
  const [staffName,    setStaffName]    = useState('')
  const [staffEmail,   setStaffEmail]   = useState('')
  const [staffPw,      setStaffPw]      = useState('')
  const [academyCode,  setAcademyCode]  = useState('')

  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [emailSent, setEmailSent] = useState(false)  // true if Supabase requires email verify

  const switchTab = (t) => { setTab(t); setError('') }

  // ── Owner signup ──────────────────────────────────────
  const handleOwner = async (e) => {
    e.preventDefault()
    if (!ownerName || !academyName || !ownerEmail || !ownerPw) {
      setError('Please fill all fields'); return
    }
    if (ownerPw.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      const result = await signupOwner(ownerEmail, ownerPw, ownerName, academyName)
      if (result.needsEmailConfirmation) {
        setEmailSent(true)  // Show "check your email" message
      } else {
        navigate('/dashboard')
      }
    } catch (err) {
      setError(err.message || 'Signup failed')
    } finally { setLoading(false) }
  }

  // ── Staff signup ──────────────────────────────────────
  const handleStaff = async (e) => {
    e.preventDefault()
    if (!staffName || !staffEmail || !staffPw || !academyCode) {
      setError('Please fill all fields'); return
    }
    if (staffPw.length < 6) { setError('Password must be at least 6 characters'); return }
    if (academyCode.trim().length !== 6) { setError('Academy code must be 6 characters'); return }
    setLoading(true); setError('')
    try {
      const result = await signupStaff(staffEmail, staffPw, staffName, academyCode)
      if (result.needsEmailConfirmation) {
        setEmailSent(true)
      } else {
        navigate('/staff/dashboard')
      }
    } catch (err) {
      setError(err.message || 'Signup failed')
    } finally { setLoading(false) }
  }

  // Show email-sent confirmation screen
  if (emailSent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Check your email</h2>
          <p className="text-sm text-gray-500 mb-6">
            We sent a confirmation link to your email address. Click it to activate your account, then come back to log in.
          </p>
          <Link to="/login" className="btn-primary justify-center py-3 w-full inline-flex">
            Back to Login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">SportFlow</span>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
          {[
            { id: 'owner', label: 'New Academy',  icon: ShieldCheck },
            { id: 'staff', label: 'Join Academy', icon: UserCog },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5">
            {error}
          </div>
        )}

        {/* ── Owner signup ──────────────────────────────── */}
        {tab === 'owner' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h1 className="text-2xl font-black text-gray-900">Create Academy</h1>
              <DevFillButton onFill={() => {
                const d = fillSignupOwner()
                setOwnerName(d.ownerName)
                setAcademyName(d.academyName)
                setOwnerEmail(d.ownerEmail)
                setOwnerPw(d.ownerPw)
              }} />
            </div>
            <p className="text-sm text-gray-500 mb-6">Set up your sports academy account</p>
            <form onSubmit={handleOwner} className="space-y-4">
              <div>
                <label className="label">Your Full Name</label>
                <input className="input" type="text" placeholder="Vikram Mehta"
                  value={ownerName} onChange={e => setOwnerName(e.target.value)} />
              </div>
              <div>
                <label className="label flex items-center gap-1.5">
                  <Building size={13} className="text-gray-400" /> Academy Name
                </label>
                <input className="input" type="text" placeholder="Champions Sports Academy"
                  value={academyName} onChange={e => setAcademyName(e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" placeholder="owner@academy.in"
                  value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input className="input pr-10" type={showPw ? 'text' : 'password'}
                    placeholder="Min. 6 characters" value={ownerPw}
                    onChange={e => setOwnerPw(e.target.value)} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading}
                className="w-full btn-primary justify-center py-3 text-base mt-2">
                {loading ? 'Creating account…' : <>Create Academy <ArrowRight size={16} /></>}
              </button>
            </form>
          </>
        )}

        {/* ── Staff signup ──────────────────────────────── */}
        {tab === 'staff' && (
          <>
            <h1 className="text-2xl font-black text-gray-900 mb-1">Join as Staff</h1>
            <p className="text-sm text-gray-500 mb-6">Create your coach / trainer account</p>
            <form onSubmit={handleStaff} className="space-y-4">
              <div>
                <label className="label">Your Full Name</label>
                <input className="input" type="text" placeholder="Ravi Kumar"
                  value={staffName} onChange={e => setStaffName(e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" placeholder="coach@academy.in"
                  value={staffEmail} onChange={e => setStaffEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input className="input pr-10" type={showPw ? 'text' : 'password'}
                    placeholder="Min. 6 characters" value={staffPw}
                    onChange={e => setStaffPw(e.target.value)} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              <div>
                <label className="label flex items-center gap-1.5">
                  <Key size={13} className="text-gray-400" /> Academy Join Code
                </label>
                <input className="input font-mono tracking-widest uppercase" type="text"
                  placeholder="XXXXXX" maxLength={6}
                  value={academyCode}
                  onChange={e => setAcademyCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
                <p className="text-xs text-gray-400 mt-1">Ask your academy owner for this 6-character code</p>
              </div>
              <button type="submit" disabled={loading}
                className="w-full btn-primary justify-center py-3 text-base mt-2">
                {loading ? 'Joining…' : <>Join Academy <ArrowRight size={16} /></>}
              </button>
            </form>
          </>
        )}

        <p className="text-xs text-gray-500 text-center mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-600 font-semibold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
