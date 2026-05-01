import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, Eye, EyeOff, ArrowRight } from 'lucide-react'

export default function Login() {
  const { login } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true)
    setError('')
    setTimeout(() => {
      login(email)
      navigate('/dashboard')
    }, 800)
  }

  const handleDemo = () => {
    setLoading(true)
    setTimeout(() => {
      login('admin@championsacademy.in')
      navigate('/dashboard')
    }, 600)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left — form */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mb-10">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">SportFlow</span>
          </Link>

          <h1 className="text-2xl font-black text-gray-900 mb-1">Welcome back</h1>
          <p className="text-sm text-gray-500 mb-8">Sign in to your academy dashboard</p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-5">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email or Phone</label>
              <input
                className="input"
                type="text"
                placeholder="admin@youracademy.in"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Password</label>
                <a href="#" className="text-xs text-brand-600 hover:underline font-medium">Forgot password?</a>
              </div>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPw(s => !s)}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center py-3 text-base"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Signing in...
                </span>
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-gray-50 px-3 text-xs text-gray-400">or</span>
            </div>
          </div>

          <button
            onClick={handleDemo}
            disabled={loading}
            className="w-full btn-secondary justify-center py-3 text-sm"
          >
            Try Demo Account — No signup needed
          </button>

          <p className="text-xs text-gray-400 text-center mt-6">
            New to SportFlow?{' '}
            <a href="#" className="text-brand-600 font-semibold hover:underline">Create free account</a>
          </p>
        </div>
      </div>

      {/* Right — branding panel */}
      <div className="hidden lg:flex flex-1 bg-gradient-to-br from-gray-900 via-brand-900 to-gray-900 items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22%23ffffff%22 fill-opacity=%221%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="relative max-w-md text-white">
          <div className="text-5xl font-black mb-6 leading-tight">
            Managing 200 students<br />
            <span className="text-brand-400">shouldn't feel like chaos</span>
          </div>
          <p className="text-gray-300 text-base leading-relaxed mb-8">
            SportFlow puts attendance, fees, trial leads and staff management into one clean dashboard that works on your phone and laptop.
          </p>
          <div className="space-y-3">
            {['Mark attendance in under 60 seconds', 'Auto-send fee reminders via WhatsApp', 'Track trial conversions in real time', 'Know your revenue without Excel'].map(f => (
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
