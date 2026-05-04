import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, ArrowRight, CheckCircle, KeyRound } from 'lucide-react'

export default function Activate() {
  const { activateStudent } = useApp()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)      // 1: code entry  2: set password  3: done
  const [studentId,  setStudentId]  = useState('')
  const [joinCode,   setJoinCode]   = useState('')
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [studentName, setStudentName] = useState('')

  const handleStep1 = (e) => {
    e.preventDefault()
    if (!studentId.trim() || !joinCode.trim()) { setError('Both fields are required'); return }
    setError('')
    setStep(2)
  }

  const handleStep2 = async (e) => {
    e.preventDefault()
    if (password.length < 6)       { setError('Password must be at least 6 characters'); return }
    if (password !== confirm)       { setError('Passwords do not match'); return }
    setLoading(true); setError('')
    try {
      const student = await activateStudent(
        studentId.trim().toUpperCase(),
        joinCode.trim().toUpperCase(),
        password
      )
      setStudentName(student.name)
      setStep(3)
    } catch (err) {
      setError(err.message || 'Activation failed. Check your Student ID and Join Code.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">SportFlow</span>
        </div>

        {/* Step indicator */}
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
              {step === 1 ? 'Enter your codes' : 'Set your password'}
            </span>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          {step === 1 && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                  <KeyRound size={20} className="text-brand-600" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-gray-900">Activate Account</h1>
                  <p className="text-xs text-gray-500">Enter the details your academy gave you</p>
                </div>
              </div>

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleStep1} className="space-y-4">
                <div>
                  <label className="label">Student ID</label>
                  <input
                    className="input font-mono tracking-wider text-lg"
                    type="text"
                    placeholder="SA001"
                    value={studentId}
                    onChange={e => setStudentId(e.target.value.toUpperCase())}
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-400 mt-1">Provided by your academy (e.g. SA001)</p>
                </div>
                <div>
                  <label className="label">Join Code</label>
                  <input
                    className="input font-mono tracking-widest text-lg uppercase"
                    type="text"
                    placeholder="ABC123"
                    maxLength={6}
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-400 mt-1">6-character code from the admin</p>
                </div>
                <button type="submit" className="w-full btn-primary justify-center py-3">
                  Continue <ArrowRight size={16} />
                </button>
              </form>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <KeyRound size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-gray-900">Set Password</h1>
                  <p className="text-xs text-gray-500">Choose a secure password for your account</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 flex items-center gap-3">
                <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-xs font-bold text-brand-700">
                  {studentId[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{studentId}</p>
                  <p className="text-xs text-gray-400">Your Student ID</p>
                </div>
              </div>

              {error && <ErrorBox msg={error} />}

              <form onSubmit={handleStep2} className="space-y-4">
                <div>
                  <label className="label">New Password</label>
                  <input className="input" type="password" placeholder="Min 6 characters"
                    value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <input className="input" type="password" placeholder="Repeat password"
                    value={confirm} onChange={e => setConfirm(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => { setStep(1); setError('') }}
                    className="flex-1 btn-secondary justify-center py-3">Back</button>
                  <button type="submit" disabled={loading} className="flex-1 btn-primary justify-center py-3">
                    {loading ? (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                    ) : <>Activate <ArrowRight size={16} /></>}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-4">
              <div className="flex justify-center mb-5">
                <CheckCircle size={56} className="text-emerald-500" strokeWidth={1.5} />
              </div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">You're in! 🎉</h2>
              <p className="text-gray-500 text-sm mb-1">Account activated successfully</p>
              {studentName && (
                <p className="text-brand-600 font-semibold mb-6">Welcome, {studentName}!</p>
              )}
              <button
                onClick={() => navigate('/login')}
                className="w-full btn-primary justify-center py-3"
              >
                Go to Login <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {step < 3 && (
          <p className="text-xs text-gray-400 text-center mt-5">
            Already activated?{' '}
            <Link to="/login" className="text-brand-600 font-semibold hover:underline">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ msg }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
      {msg}
    </div>
  )
}
