// Login page — three tabs: Owner | Staff | Student
// Owner + Staff use Supabase Auth (email + password)
// Student uses custom auth (student code + password)

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, ArrowRight, ShieldCheck, UserCog, GraduationCap } from 'lucide-react'

export default function Login() {
  const { loginOwner, loginStaff, loginStudent, loginDemo } = useApp()
  const navigate = useNavigate()

  const [tab,      setTab]      = useState('owner')  // 'owner' | 'staff' | 'student'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [code,     setCode]     = useState('')        // student ID
  const [showPw,   setShowPw]   = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const switchTab = (t) => { setTab(t); setError(''); setEmail(''); setPassword(''); setCode('') }

  // ── Owner login ───────────────────────────────────────
  const handleOwner = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please fill all fields'); return }
    setLoading(true); setError('')
    try {
      await loginOwner(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally { setLoading(false) }
  }

  // ── Staff login ───────────────────────────────────────
  const handleStaff = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please fill all fields'); return }
    setLoading(true); setError('')
    try {
      await loginStaff(email, password)
      navigate('/staff/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally { setLoading(false) }
  }

  // ── Student login ─────────────────────────────────────
  const handleStudent = async (e) => {
    e.preventDefault()
    if (!code || !password) { setError('Please fill all fields'); return }
    setLoading(true); setError('')
    try {
      await loginStudent(code.trim().toUpperCase(), password)
      navigate('/student/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* ── Form panel ──────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">

          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SportFlow</span>
          </div>

          {/* Tab switcher — 3 tabs */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
            {[
              { id: 'owner',   label: 'Owner',   icon: ShieldCheck },
              { id: 'staff',   label: 'Staff',   icon: UserCog },
              { id: 'student', label: 'Student', icon: GraduationCap },
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

          {error && <ErrorBox msg={error} />}

          {/* ── Owner form ─────────────────────────────── */}
          {tab === 'owner' && (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Owner Login</h1>
              <p className="text-sm text-gray-500 mb-6">Sign in to manage your academy</p>
              <form onSubmit={handleOwner} className="space-y-4">
                <Field label="Email">
                  <input className="input" type="email" placeholder="owner@academy.in"
                    value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                </Field>
                <Field label="Password">
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(s => !s)} />
                </Field>
                <SubmitBtn loading={loading} label="Sign In as Owner" />
              </form>
              <p className="text-xs text-gray-500 text-center mt-5">
                New academy?{' '}
                <Link to="/signup" className="text-brand-600 font-semibold hover:underline">
                  Create your account
                </Link>
              </p>
            </>
          )}

          {/* ── Staff form ─────────────────────────────── */}
          {tab === 'staff' && (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Staff Login</h1>
              <p className="text-sm text-gray-500 mb-6">Coach / trainer sign in</p>
              <form onSubmit={handleStaff} className="space-y-4">
                <Field label="Email">
                  <input className="input" type="email" placeholder="coach@academy.in"
                    value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                </Field>
                <Field label="Password">
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(s => !s)} />
                </Field>
                <SubmitBtn loading={loading} label="Sign In as Staff" />
              </form>
              <p className="text-xs text-gray-500 text-center mt-5">
                First time?{' '}
                <Link to="/signup?role=staff" className="text-brand-600 font-semibold hover:underline">
                  Sign up with academy code
                </Link>
              </p>
            </>
          )}

          {/* ── Student form ───────────────────────────── */}
          {tab === 'student' && (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Student Login</h1>
              <p className="text-sm text-gray-500 mb-6">Use your Student ID and password</p>
              <form onSubmit={handleStudent} className="space-y-4">
                <Field label="Student ID">
                  <input className="input font-mono tracking-wider" type="text" placeholder="SA001"
                    value={code} onChange={e => setCode(e.target.value.toUpperCase())} />
                </Field>
                <Field label="Password">
                  <PwInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(s => !s)} />
                </Field>
                <SubmitBtn loading={loading} label="Sign In as Student" />
              </form>
              <p className="text-xs text-gray-500 text-center mt-5">
                First time?{' '}
                <Link to="/activate" className="text-brand-600 font-semibold hover:underline">
                  Activate account
                </Link>
              </p>
              <p className="text-xs text-gray-400 text-center mt-2">
                Forgot password? Contact your academy admin.
              </p>
            </>
          )}

          {/* ── Demo login ─────────────────────────────── */}
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">Try a demo account</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { role: 'owner',   label: 'Owner',   color: 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100' },
                { role: 'staff',   label: 'Staff',   color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
                { role: 'student', label: 'Student', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
              ].map(({ role, label, color }) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => loginDemo(role)}
                  className={`py-2.5 rounded-xl border text-xs font-bold transition ${color}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 text-center mt-2">No sign up needed — instant mock data</p>
          </div>

        </div>
      </div>

      {/* ── Branding panel (desktop only) ───────────────── */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-gray-900 via-brand-900 to-gray-900 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22%23ffffff%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="relative max-w-md text-white">
          <div className="text-4xl font-black mb-6 leading-tight">
            One platform for<br />
            <span className="text-brand-400">your entire academy</span>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed mb-8">
            Owners manage everything. Staff mark attendance. Students track their progress — all from one app.
          </p>
          <div className="space-y-3">
            {[
              { role: 'Owner', desc: 'Full control — students, fees, reports, staff' },
              { role: 'Staff / Coach', desc: 'Mark attendance, view roster, manage batches' },
              { role: 'Student', desc: 'View attendance, fee receipts, announcements' },
            ].map(r => (
              <div key={r.role} className="flex items-start gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{r.role}</p>
                  <p className="text-xs text-gray-400">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5">
      {msg}
    </div>
  )
}

function PwInput({ value, onChange, show, onToggle }) {
  return (
    <div className="relative">
      <input
        className="input pr-10"
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete="current-password"
      />
      <button type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show
          ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" /></svg>
          : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        }
      </button>
    </div>
  )
}

function SubmitBtn({ loading, label }) {
  return (
    <button type="submit" disabled={loading}
      className="w-full btn-primary justify-center py-3 text-base mt-2">
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Please wait…
        </span>
      ) : <>{label} <ArrowRight size={16} /></>}
    </button>
  )
}
