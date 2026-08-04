import { useState, useMemo } from 'react'
import { Phone, ArrowRight, ArrowLeft, MapPin, Trophy, Users, CheckCircle2, Camera, X } from 'lucide-react'
import * as db from '../lib/db'

// Public, no-auth trial self-enrollment funnel for Ahmedabad Racquet Academy.
// Deliberately does NOT use AppContext (see plan: this is a one-shot
// anonymous submission, not an ongoing role) — talks to db.js directly,
// same convention as PayPublic.jsx.
//
// *** BRANDING PLACEHOLDER: these are stand-in green values, not sampled
// *** from the real Ahmedabad Racquet Academy logo (no accessible file to
// *** sample from). Swap for the exact hex before shipping.
const GREEN         = '#1B4332'
const GREEN_LIGHT   = '#E9F2ED'
const GREEN_BORDER  = '#CFE3D8'

const STEPS = ['phone', 'otp', 'branch', 'sport', 'batch', 'form', 'confirm']

const FIELD_CLASS = 'w-full px-3.5 py-2.5 text-sm text-gray-900 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 placeholder-gray-400 transition'
const FIELD_STYLE = { '--tw-ring-color': GREEN }

// Same normalisation as ParentLogin.jsx (India-default E.164), duplicated
// locally since this page intentionally doesn't import from AppContext-tied
// pages and no shared phone-format utility exists yet.
function normalisePhone(raw) {
  const digits = String(raw).replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10)   return '+91' + digits
  return digits
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
      {msg}
    </div>
  )
}

function PrimaryButton({ children, loading, ...props }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full flex items-center justify-center gap-2 py-3.5 text-base font-semibold text-white rounded-xl active:scale-95 transition-all duration-150 shadow-sm disabled:opacity-50"
      style={{ backgroundColor: GREEN }}
    >
      {loading ? <Spinner /> : children}
    </button>
  )
}

export default function TrialEnroll() {
  const [step, setStep] = useState('phone')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')

  const [branchRows, setBranchRows] = useState([])          // flat [{id, sportName, branchName}]
  const [branchName, setBranchName] = useState('')
  const [chosenRow, setChosenRow]   = useState(null)         // the {id, sportName, branchName} row carried forward

  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState(null)

  const [form, setForm] = useState({
    name: '', parentName: '', emergencyContactName: '', emergencyContactPhone: '',
    dob: '', age: '', medicalNotes: '',
  })
  const [documentFile, setDocumentFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const locations = useMemo(
    () => [...new Set(branchRows.map(r => r.branchName))],
    [branchRows]
  )
  const sportsAtLocation = useMemo(
    () => branchRows.filter(r => r.branchName === branchName),
    [branchRows, branchName]
  )

  // After OTP success (real or dev-skip): fetch branches, then skip any
  // step that has only one option — cheap, real progress toward "minimal tap."
  async function afterAuthed() {
    const rows = await db.fetchPublicTrialBranches()
    setBranchRows(rows)
    const uniqueLocations = [...new Set(rows.map(r => r.branchName))]
    if (uniqueLocations.length === 1) {
      await chooseLocation(uniqueLocations[0], rows)
    } else {
      setStep('branch')
    }
  }

  async function chooseLocation(loc, rowsOverride) {
    const rows = rowsOverride || branchRows
    setBranchName(loc)
    const atLoc = rows.filter(r => r.branchName === loc)
    if (atLoc.length === 1) {
      await chooseSport(atLoc[0])
    } else {
      setStep('sport')
    }
  }

  async function chooseSport(row) {
    setChosenRow(row)
    setLoading(true); setError('')
    try {
      const list = await db.fetchPublicTrialBatches(row.id)
      setBatches(list)
      setStep('batch')
    } catch (err) {
      setError(err?.message || 'Could not load batches')
    } finally {
      setLoading(false)
    }
  }

  const sendCode = async (e) => {
    e?.preventDefault()
    const p = normalisePhone(phone)
    if (!/^\+\d{10,15}$/.test(p)) { setError('Enter a valid phone number'); return }
    setLoading(true); setError('')
    try {
      await db.sendTrialOtp(p)
      setStep('otp')
    } catch (err) {
      setError(err?.message || 'Could not send code')
    } finally { setLoading(false) }
  }

  // DEV ONLY — skip OTP, mirrors ParentLogin.jsx's devSkipOtp
  const devSkipOtp = async () => {
    setLoading(true); setError('')
    try {
      await db.trialTestLogin(phone)
      await afterAuthed()
    } catch (err) {
      setError(err?.message || 'Test login failed (is ENABLE_TRIAL_TEST_LOGIN set?)')
    } finally { setLoading(false) }
  }

  const verifyCode = async (e) => {
    e?.preventDefault()
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the code'); return }
    setLoading(true); setError('')
    try {
      await db.verifyTrialOtp(normalisePhone(phone), otp)
      await afterAuthed()
    } catch (err) {
      setError(err?.message || 'Invalid code')
    } finally { setLoading(false) }
  }

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const submit = async (e) => {
    e?.preventDefault()
    if (!form.name.trim() || !form.parentName.trim()) {
      setError('Name and parent name are required'); return
    }
    if (!form.emergencyContactName.trim() || !form.emergencyContactPhone.trim()) {
      setError('Emergency contact is required'); return
    }
    setSubmitting(true); setError('')
    try {
      let documentPath = null
      if (documentFile) {
        documentPath = await db.uploadPublicTrialDocument(documentFile)
      }
      const res = await db.submitPublicTrial({
        branchId: chosenRow.id,
        batchId,
        name: form.name.trim(),
        parentName: form.parentName.trim(),
        emergencyContactName: form.emergencyContactName.trim(),
        emergencyContactPhone: form.emergencyContactPhone.trim(),
        dob: form.dob || null,
        age: form.age ? Number(form.age) : null,
        medicalNotes: form.medicalNotes.trim() || null,
        documentPath,
      })
      setResult(res)
      setStep('confirm')
    } catch (err) {
      setError(err?.message || 'Could not submit — please try again')
    } finally {
      setSubmitting(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: GREEN }}>
            <Trophy size={18} className="text-white" />
          </div>
          <span className="text-lg font-bold text-gray-900">Ahmedabad Racquet Academy</span>
        </div>

        {/* Progress dots — only for the steps before confirm */}
        {step !== 'confirm' && (
          <div className="flex items-center gap-1.5 mb-6">
            {STEPS.slice(0, -1).map((s, i) => (
              <div key={s} className="h-1.5 flex-1 rounded-full transition-all"
                style={{ backgroundColor: i <= stepIndex ? GREEN : '#E5E7EB' }} />
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <ErrorBox msg={error} />

          {step === 'phone' && (
            <>
              <h1 className="text-xl font-black text-gray-900 mb-1">Book a free trial</h1>
              <p className="text-sm text-gray-500 mb-6">Enter your phone number to get started</p>
              <form onSubmit={sendCode} className="space-y-4">
                <div className="relative">
                  <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="w-full pl-9 pr-3.5 py-3 text-base text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 placeholder-gray-400"
                    style={{ '--tw-ring-color': GREEN }}
                    type="tel" inputMode="tel" placeholder="98765 43210"
                    value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" autoFocus
                  />
                </div>
                <PrimaryButton type="submit" loading={loading}>
                  Send code <ArrowRight size={16} />
                </PrimaryButton>
                {import.meta.env.DEV && (
                  <button type="button" onClick={devSkipOtp} disabled={loading}
                    className="w-full py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition">
                    ⚡ Skip OTP (dev only)
                  </button>
                )}
              </form>
            </>
          )}

          {step === 'otp' && (
            <>
              <h1 className="text-xl font-black text-gray-900 mb-1">Enter the code</h1>
              <p className="text-sm text-gray-500 mb-6">We sent a code to {normalisePhone(phone)}</p>
              <form onSubmit={verifyCode} className="space-y-4">
                <input
                  className="w-full px-3.5 py-3 text-lg text-center tracking-widest text-gray-900 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2"
                  type="text" inputMode="numeric" maxLength={8} placeholder="123456"
                  value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  autoComplete="one-time-code" autoFocus
                />
                <PrimaryButton type="submit" loading={loading}>
                  Verify & continue <ArrowRight size={16} />
                </PrimaryButton>
                <button type="button" onClick={() => { setStep('phone'); setOtp(''); setError('') }}
                  className="w-full text-xs text-gray-500 hover:text-gray-700 underline">
                  Use a different number
                </button>
              </form>
            </>
          )}

          {step === 'branch' && (
            <>
              <StepHeader icon={<MapPin size={20} />} title="Choose a location" subtitle="Which branch is closest to you?" />
              <div className="space-y-2">
                {locations.map(loc => (
                  <OptionRow key={loc} label={loc} onClick={() => chooseLocation(loc)} />
                ))}
              </div>
            </>
          )}

          {step === 'sport' && (
            <>
              <StepHeader icon={<Trophy size={20} />} title="Choose a sport" subtitle={branchName} back={() => setStep('branch')} />
              <div className="space-y-2">
                {sportsAtLocation.map(row => (
                  <OptionRow key={row.id} label={row.sportName} loading={loading} onClick={() => chooseSport(row)} />
                ))}
              </div>
            </>
          )}

          {step === 'batch' && (
            <>
              <StepHeader icon={<Users size={20} />} title="Choose a batch" subtitle={`${chosenRow?.sportName} · ${chosenRow?.branchName}`} back={() => setStep(sportsAtLocation.length > 1 ? 'sport' : 'branch')} />
              <div className="space-y-2 mb-3">
                {batches.map(b => (
                  <button key={b.id} type="button" onClick={() => { setBatchId(b.id); setStep('form') }}
                    className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 transition flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{b.name}</p>
                      <p className="text-xs text-gray-400">
                        {(b.days || []).join(', ')}{b.startTime ? ` · ${b.startTime}–${b.endTime}` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-semibold px-2 py-1 rounded-full"
                      style={{ backgroundColor: b.seatsLeft > 0 ? GREEN_LIGHT : '#FEF3C7', color: b.seatsLeft > 0 ? GREEN : '#92400E' }}>
                      {b.seatsLeft > 0 ? `${b.seatsLeft} seats left` : 'Waitlist'}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => { setBatchId(null); setStep('form') }}
                className="w-full text-xs text-gray-500 hover:text-gray-700 underline py-2">
                Not sure yet — let the academy pick
              </button>
            </>
          )}

          {step === 'form' && (
            <>
              <StepHeader icon={<Users size={20} />} title="A few details" subtitle="So the academy can prepare for you" back={() => setStep('batch')} />
              <form onSubmit={submit} className="space-y-3.5">
                <Field label="Student name *">
                  <input className={FIELD_CLASS} style={FIELD_STYLE} value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
                </Field>
                <Field label="Parent / guardian name *">
                  <input className={FIELD_CLASS} style={FIELD_STYLE} value={form.parentName} onChange={e => set('parentName', e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date of birth">
                    <input className={FIELD_CLASS} style={FIELD_STYLE} type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
                  </Field>
                  <Field label="Age">
                    <input className={FIELD_CLASS} style={FIELD_STYLE} type="number" min="1" max="99" value={form.age} onChange={e => set('age', e.target.value)} />
                  </Field>
                </div>
                <Field label="Emergency contact name *">
                  <input className={FIELD_CLASS} style={FIELD_STYLE} value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} placeholder="Someone we can call if needed" />
                </Field>
                <Field label="Emergency contact phone *">
                  <input className={FIELD_CLASS} style={FIELD_STYLE} type="tel" inputMode="tel" value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} />
                </Field>
                <Field label="Medical notes (optional)">
                  <textarea className={FIELD_CLASS} style={FIELD_STYLE} rows={2} value={form.medicalNotes} onChange={e => set('medicalNotes', e.target.value)} placeholder="Allergies, conditions, anything the coach should know" />
                </Field>
                <Field label="ID / medical document photo (optional)">
                  {!documentFile ? (
                    <label className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-gray-500 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 transition">
                      <Camera size={16} /> Add a photo
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={e => setDocumentFile(e.target.files?.[0] || null)} />
                    </label>
                  ) : (
                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                      <span className="text-sm text-gray-700 truncate">{documentFile.name}</span>
                      <button type="button" onClick={() => setDocumentFile(null)} className="text-gray-400 hover:text-gray-600">
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </Field>
                <div className="pt-2">
                  <PrimaryButton type="submit" loading={submitting}>
                    Submit <ArrowRight size={16} />
                  </PrimaryButton>
                </div>
              </form>
            </>
          )}

          {step === 'confirm' && (
            <div className="text-center py-4">
              <div className="flex justify-center mb-5">
                <CheckCircle2 size={56} style={{ color: GREEN }} strokeWidth={1.5} />
              </div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">You're on the list! 🎉</h2>
              <p className="text-gray-500 text-sm mb-1">
                Thanks, {result?.name || 'there'} — the academy will reach out shortly to confirm your trial.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepHeader({ icon, title, subtitle, back }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      {back && (
        <button type="button" onClick={back} className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </button>
      )}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: GREEN_LIGHT, color: GREEN }}>
        {icon}
      </div>
      <div>
        <h1 className="text-lg font-black text-gray-900">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  )
}

function OptionRow({ label, onClick, loading }) {
  return (
    <button type="button" onClick={onClick} disabled={loading}
      className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-gray-200 hover:border-gray-300 transition text-left disabled:opacity-50"
      style={{ borderColor: GREEN_BORDER }}>
      <span className="text-sm font-semibold text-gray-900">{label}</span>
      {loading ? <Spinner /> : <ArrowRight size={16} className="text-gray-400" />}
    </button>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
