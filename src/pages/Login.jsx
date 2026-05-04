import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, Eye, EyeOff, ArrowRight, ShieldCheck, User } from 'lucide-react'

export default function Login() {
  const { loginAdmin, loginStudent } = useApp()
  const navigate = useNavigate()
  const [tab, setTab]         = useState('admin')   // 'admin' | 'student'
  const [email,    setEmail]  = useState('')
  const [password, setPassword] = useState('')
  const [studentId, setStudentId] = useState('')
  const [stuPassword, setStuPassword] = useState('')
  const [showPw, setShowPw]   = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleAdminSubmit = (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true); setError('')
    setTimeout(() => {
      loginAdmin(email)
      navigate('/dashboard')
    }, 600)
  }

  const handleStudentSubmit = async (e) => {
    e.preventDefault()
    if (!studentId || !stuPassword) { setError('Please fill in all fields'); return }
    setLoading(true); setError('')
    try {
      await loginStudent(studentId.trim().toUpperCase(), stuPassword)
      navigate('/student/dashboard')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDemo = () => {
    setLoading(true)
    setTimeout(() => { loginAdmin('admin@championsacademy.in'); navigate('/dashboard') }, 400)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Form side */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex items-center gap-2 mb-8">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SportFlow</span>
          </div>

          {/* Tab switcher */}
          <div className="flex bg-gray-100 rounded-xl p-1 mb-8">
            <button
              onClick={() => { setTab('admin'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'admin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <ShieldCheck size={15} /> Admin
            </button>
            <button
              onClick={() => { setTab('student'); setError('') }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'student' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <User size={15} /> Student
            </button>
          </div>

          {tab === 'admin' ? (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Admin Login</h1>
              <p className="text-sm text-gray-500 mb-6">Sign in to your academy dashboard</p>

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label className="label">Email or Phone</label>
                  <input className="input" type="text" placeholder="admin@youracademy.in"
                    value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="label">Password</label>
                  <PasswordInput value={password} onChange={setPassword} show={showPw} onToggle={() => setShowPw(s => !s)} />
                </div>
                <SubmitBtn loading={loading} label="Sign In" />
              </form>

              <Divider />
              <button onClick={handleDemo} disabled={loading} className="w-full btn-secondary justify-center py-3 text-sm">
                Try Demo Account — No signup needed
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black text-gray-900 mb-1">Student Login</h1>
              <p className="text-sm text-gray-500 mb-6">
                Use your Student ID and password to sign in
              </p>

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleStudentSubmit} className="space-y-4">
                <div>
                  <label className="label">Student ID</label>
                  <input className="input font-mono tracking-wider" type="text"
                    placeholder="SA001"
                    value={studentId} onChange={e => setStudentId(e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="label">Password</label>
                  <PasswordInput value={stuPassword} onChange={setStuPassword} show={showPw} onToggle={() => setShowPw(s => !s)} />
                </div>
                <SubmitBtn loading={loading} label="Sign In" />
              </form>

              <p className="text-xs text-gray-500 text-center mt-5">
                First time?{' '}
                <Link to="/activate" className="text-brand-600 font-semibold hover:underline">
                  Activate your account
                </Link>
              </p>
              <p className="text-xs text-gray-400 text-center mt-2">
                Forgot password? Contact your academy admin.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Branding panel */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-gray-900 via-brand-900 to-gray-900 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22%23ffffff%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="relative max-w-md text-white">
          <div className="text-5xl font-black mb-6 leading-tight">
            Managing 200 students<br />
            <span className="text-brand-400">shouldn't feel like chaos</span>
          </div>
          <p className="text-gray-300 text-base leading-relaxed mb-8">
            SportFlow puts attendance, fees, trial leads and staff management into one clean dashboard.
          </p>
          <div className="space-y-3">
            {[
              'QR-based gate attendance in seconds',
              'Student self-service portal',
              'Admin-controlled onboarding',
              'Real-time fee tracking',
            ].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div className="w-5 h-5 bg-brand-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-sm text-gray-200">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
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

function PasswordInput({ value, onChange, show, onToggle }) {
  return (
    <div className="relative">
      <input
        className="input pr-10"
        type={show ? 'text' : 'password'}
        placeholder="••••••••"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        onClick={onToggle}>
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
    <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-3 text-base">
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Signing in…
        </span>
      ) : <>{label} <ArrowRight size={16} /></>}
    </button>
  )
}

function Divider() {
  return (
    <div className="relative my-5">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
      <div className="relative flex justify-center"><span className="bg-gray-50 px-3 text-xs text-gray-400">or</span></div>
    </div>
  )
}
