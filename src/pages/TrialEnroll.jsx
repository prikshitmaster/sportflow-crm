import { useState, useMemo, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Phone, ArrowLeft, ArrowRight, MapPin, Trophy, CheckCircle2,
  Camera, X, User, Home as HomeIcon, CalendarDays, Search, Bell, ChevronDown,
} from 'lucide-react'
import * as db from '../lib/db'
import DevFillButton from '../components/DevFillButton'
import { fillPublicRegistration } from '../lib/devFill'

// Public, no-auth-to-browse, multi-tenant student self-registration funnel.
// Served at /join (hardcoded slug "ara" — the bare route is kept permanently
// since enroll-app/capacitor.config.ts's server.url has that exact URL baked
// into an already-built APK) and /join/:academySlug for every other academy.
//
// Visual language matches the "Ahmedabad Racquet Academy App v2" design ref:
// photo-hero login, dark-green gradient home header, photo sport tiles,
// photo branch cards. Photos prefer REAL data (sport_branches.photo_url)
// and fall back to a deterministic picsum.photos "seed" placeholder photo
// per sport/branch — same placeholder convention the design file itself
// uses — never a fabricated stat. Ratings/"slots left"/facility tags from
// the visual reference are deliberately NOT reproduced: nothing in the DB
// backs them, and inventing availability/rating numbers for real
// prospective parents would be misleading.
//
// Auth model — "skip to browse, OTP at submit":
//   • Branch/batch lists are anon-readable (migration 0140), so a prospect
//     can browse without verifying first.
//   • submitPublicTrial STILL requires a phone-OTP session server-side, so
//     if the visitor skipped the login OTP, a gate appears at Submit time.
//   • The lead's phone is always the server-verified OTP number, never a
//     form field — every submitted lead is phone-verified regardless of path.
//
// Deliberately does NOT use AppContext (one-shot anonymous submission, not
// an ongoing role) — talks to db.js directly, same convention as PayPublic.jsx.

// India-default E.164 normalisation (mirrors ParentLogin.jsx), duplicated
// locally since this page intentionally stays free of AppContext-tied imports.
function normalisePhone(raw) {
  const digits = String(raw).replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10)   return '+91' + digits
  return digits
}

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'x'
}

// Deterministic hash so the same seedKey always locks to the same photo
// (stable across reloads) without needing real randomness.
function hashSeed(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// loremflickr matches real Flickr photos against the given keyword TAGS —
// unlike picsum.photos' "seed" (which just repeats a stable RANDOM photo
// with zero relation to the seed text, e.g. it once rendered a cartoon
// character for "football"), so a sport name tag reliably returns a photo
// that's actually about that sport. `lock` pins one matching photo per
// seedKey so it doesn't change on every reload.
function tagPhoto(tags, seedKey, w, h) {
  return `https://loremflickr.com/${w}/${h}/${encodeURIComponent(tags)}?lock=${hashSeed(seedKey)}`
}

// trials.status is written once at creation and never updated again —
// trials.stage is the field that actually moves through the pipeline
// (new -> scheduled -> attended -> accepted/followup/rejected -> converted).
// The Profile tab must show stage, not status, or it looks frozen on
// "Scheduled" forever even after staff move it all the way to Accepted.
// Labels are deliberately warmer than the raw internal stage codes — a
// parent shouldn't see pipeline jargon like "rejected" or "converted".
const STAGE_LABEL = {
  new: 'New', scheduled: 'Scheduled', attended: 'Attended',
  accepted: 'Accepted!', followup: 'Reviewing', rejected: 'Not Selected',
  converted: 'Enrolled 🎉',
}
const STAGE_STRONG = new Set(['accepted', 'converted']) // gets the solid brand-color badge instead of the soft tint

// Stage-appropriate "what happens next" copy for the expanded card detail —
// honest about what's actually known, never promising a specific date/time
// that isn't in the data.
const STAGE_NEXT = {
  new:       "We've got your registration — the academy will be in touch to schedule your trial.",
  scheduled: 'Your trial is scheduled. See you soon!',
  attended:  "Thanks for attending! The coach is reviewing and the academy will follow up soon.",
  accepted:  'Your spot is confirmed! The academy will reach out to finalize your batch and start date.',
  followup:  'The academy wants to follow up before finalizing — they’ll be in touch.',
  rejected:  "This trial wasn't taken forward this time. Contact the academy directly if you have questions.",
  converted: "You're enrolled! See below for how to access the student app.",
}

// Fixed near-neutral chrome shared across every academy (matches the design
// ref: only the accent color is brand-driven, structural neutrals stay put).
const N = {
  text:  '#0B1F12',
  muted: '#6E8577',
  faint: '#9AAC9F',
  page:  '#F4F8F4',
  input: '#F7FBF7',
  line:  '#E2EEE4',
}
const LIME = '#C9F04D'
const LIME_TEXT = '#123A1F'
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

// One stored hex per academy -> {main, dark, tint} — dark for gradients,
// tint for soft brand-colored fills (badges, pills). Structural chrome
// (page/input/border) stays in the fixed neutral palette above.
function deriveShades(hex) {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#17853F'
  const r = parseInt(clean.slice(1, 3), 16)
  const g = parseInt(clean.slice(3, 5), 16)
  const b = parseInt(clean.slice(5, 7), 16)
  const hx = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')
  const toWhite = (ratio) => `#${hx(r + (255 - r) * ratio)}${hx(g + (255 - g) * ratio)}${hx(b + (255 - b) * ratio)}`
  const toBlack = (ratio) => `#${hx(r * (1 - ratio))}${hx(g * (1 - ratio))}${hx(b * (1 - ratio))}`
  return { main: clean, dark: toBlack(0.42), tint: toWhite(0.9) }
}

// Derives age from a yyyy-mm-dd DOB — the form shouldn't ask a parent for
// both when one directly implies the other.
function ageFromDob(dobStr) {
  if (!dobStr) return ''
  const dob = new Date(dobStr + 'T00:00:00')
  if (Number.isNaN(dob.getTime())) return ''
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDiff = now.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--
  return age >= 0 ? String(age) : ''
}

function greetingWord() {
  const h = new Date().getHours()
  if (h < 12) return 'GOOD MORNING'
  if (h < 17) return 'GOOD AFTERNOON'
  return 'GOOD EVENING'
}

// Lazy-loads the Razorpay Checkout script tag once — same pattern as
// ParentPayments.jsx's loadRazorpayScript().
function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload  = () => resolve(true)
    s.onerror = () => reject(new Error('Could not load payment gateway'))
    document.body.appendChild(s)
  })
}

function Spinner({ size = 16, color = '#fff' }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color }}>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: '#FEECEC', border: '1px solid #F6C9C9', color: '#B42318', fontSize: 13, padding: '11px 14px', borderRadius: 14, marginBottom: 14 }}>
      {msg}
    </div>
  )
}

// Big green pill CTA — the design's signature button.
function Cta({ children, onClick, loading, disabled, C, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: C.main, color: '#fff', fontSize: 15.5, fontWeight: 800, border: 'none',
        borderRadius: 18, padding: '17px 0', cursor: 'pointer', letterSpacing: -0.1,
        boxShadow: `0 10px 22px ${C.main}4D`, opacity: (loading || disabled) ? 0.6 : 1,
        transition: 'transform .12s ease', fontFamily: FONT,
      }}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {loading ? <Spinner /> : children}
    </button>
  )
}

// Photo with a graceful brand-gradient fallback if BOTH the real photo and
// the placeholder 404/can't load (e.g. offline, blocked CDN) — layout never
// breaks either way. `src` (real, owner-uploaded) always wins over `fallback`
// (a topically-tagged placeholder built by tagPhoto()).
function Photo({ src, fallback, radius = 0, C, alt = '' }) {
  const [failed, setFailed] = useState(false)
  const url = src || fallback
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden', background: `linear-gradient(135deg, ${C.main}, ${C.dark})` }}>
      {!failed && (
        <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
    </div>
  )
}

const inputStyle = {
  border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 15, fontWeight: 600, color: N.text,
  background: N.input, borderRadius: 14, padding: '14px 15px', width: '100%',
  boxSizing: 'border-box', fontFamily: FONT,
}

function LabeledInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />
}

// White rounded-bottom header with a round back button — branch/batch/form screens.
function TopBar({ title, subtitle, onBack, C, children }) {
  return (
    <div style={{ background: '#fff', padding: '56px 22px 18px', borderRadius: '0 0 28px 28px', boxShadow: '0 4px 16px rgba(11,50,26,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <div onClick={onBack} role="button" tabIndex={0}
            style={{ width: 38, height: 38, borderRadius: 999, background: C.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <ArrowLeft size={17} color={C.main} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: N.text, letterSpacing: -0.4 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12.5, fontWeight: 600, color: N.muted, marginTop: 1 }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

function SectionCard({ index, title, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 24, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 6px 18px rgba(11,50,26,0.07)' }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#17853F', letterSpacing: 0.8 }}>{index} · {title}</div>
      {children}
    </div>
  )
}

export default function TrialEnroll({ academySlug: slugProp }) {
  const { academySlug: slugParam } = useParams()
  const slug = slugProp || slugParam

  // Branding is fetched before anything renders — the whole point is showing
  // the RIGHT academy immediately, never a flash of wrong/default branding.
  const [brandingStatus, setBrandingStatus] = useState('loading') // 'loading' | 'not-found' | 'ready'
  const [branding, setBranding] = useState(null)
  const [academyFeatures, setAcademyFeatures] = useState({ studentCodeLogin: true, familyLogin: true })

  useEffect(() => {
    let cancelled = false
    setBrandingStatus('loading')
    db.fetchAcademyBranding(slug)
      .then(b => {
        if (cancelled) return
        if (b) { setBranding(b); setBrandingStatus('ready') }
        else { setBrandingStatus('not-found') }
      })
      .catch(() => { if (!cancelled) setBrandingStatus('not-found') })
    db.fetchPublicAcademyFeatures(slug)
      .then(f => { if (!cancelled) setAcademyFeatures(f) })
      .catch(() => {}) // non-fatal — defaults (both on) already cover this
    return () => { cancelled = true }
  }, [slug])

  const C = useMemo(() => deriveShades(branding?.brandColor), [branding])

  const [step, setStep] = useState('login')  // login | home | branch | batch | form | confirm
  const [authMode, setAuthMode] = useState('login') // cosmetic Login/Register tabs
  const [isAuthed, setIsAuthed] = useState(false)   // completed phone-OTP in THIS funnel
  const [authChecked, setAuthChecked] = useState(false) // has the restore-session check below finished?
  const [homeTab, setHomeTab] = useState('home')    // home | batches | profile (stubs)
  const [homeSearch, setHomeSearch] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Supabase Auth persists the OTP session across reloads even though this
  // component's own state doesn't — without this, reloading always looked
  // like being logged out. Runs once on mount, independent of branding.
  useEffect(() => {
    let cancelled = false
    db.getCurrentAuthPhone()
      .then(phone => {
        if (cancelled || !phone) return
        setIsAuthed(true)
        setPhone(phone.slice(-10))
        setStep('home')
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAuthChecked(true) })
    return () => { cancelled = true }
  }, [])

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  const [branchRows, setBranchRows] = useState([])   // flat [{id, sportName, branchName, photoUrl}]
  const [chosenSport, setChosenSport] = useState('')
  const [chosenRow, setChosenRow] = useState(null)   // the {id, sportName, branchName} row carried forward

  const [batches, setBatches] = useState([])
  const [batchId, setBatchId] = useState(null)

  const [myTrials, setMyTrials] = useState([])          // this phone's own registered students at this academy
  const [profileLoading, setProfileLoading] = useState(false)
  const [expandedTrialId, setExpandedTrialId] = useState(null)
  const [relationship, setRelationship] = useState('')       // 'Son' | 'Daughter' | 'Ward' | 'Other'
  const [relationshipCustom, setRelationshipCustom] = useState('')
  const [siblingOfId, setSiblingOfId] = useState('')

  const [form, setForm] = useState({
    name: '', parentName: '', emergencyContactName: '', emergencyContactPhone: '',
    dob: '', age: '', medicalNotes: '',
  })
  const [documentFile, setDocumentFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [showGate, setShowGate] = useState(false)
  const [feeMode, setFeeMode] = useState('walkin')       // 'walkin' | 'online'
  const [paymentStatus, setPaymentStatus] = useState('idle') // idle | processing | paid | failed

  // Browse data is anon-readable (migration 0140) — fetch as soon as branding
  // resolves, before any OTP, so the Home sport grid is ready on arrival.
  useEffect(() => {
    if (brandingStatus !== 'ready') return
    let cancelled = false
    db.fetchPublicTrialBranches(slug)
      .then(rows => { if (!cancelled) setBranchRows(rows) })
      .catch(() => { /* non-fatal; Home shows an empty state */ })
    return () => { cancelled = true }
  }, [brandingStatus, slug])

  // Profile tab shows this phone's own registered students — fetch whenever
  // it's opened while verified. Also the source for the "Sibling of" picker
  // on the registration form, so re-fetching here keeps that current too.
  const refreshMyTrials = () => db.fetchMyTrials(slug).then(setMyTrials).catch(() => {})
  useEffect(() => {
    if (homeTab !== 'profile' || !isAuthed) return
    let cancelled = false
    setProfileLoading(true)
    db.fetchMyTrials(slug)
      .then(rows => { if (!cancelled) setMyTrials(rows) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [homeTab, isAuthed, slug])

  // Unique sports across the academy, each with a location count + a real
  // photo if any branch offering it has one uploaded.
  const sportsView = useMemo(() => {
    const map = new Map()
    for (const r of branchRows) {
      if (!map.has(r.sportName)) map.set(r.sportName, { name: r.sportName, count: 0, photo: '' })
      const e = map.get(r.sportName)
      e.count += 1
      if (!e.photo && r.photoUrl) e.photo = r.photoUrl
    }
    return [...map.values()]
  }, [branchRows])

  const filteredSportsView = useMemo(() => {
    const q = homeSearch.trim().toLowerCase()
    if (!q) return sportsView
    return sportsView.filter(sp =>
      sp.name.toLowerCase().includes(q) ||
      branchRows.some(r => r.sportName === sp.name && r.branchName.toLowerCase().includes(q))
    )
  }, [sportsView, branchRows, homeSearch])

  const branchesForSport = useMemo(
    () => branchRows.filter(r => r.sportName === chosenSport),
    [branchRows, chosenSport]
  )

  const branchCount = useMemo(() => new Set(branchRows.map(r => r.branchName)).size, [branchRows])

  // ── login / otp ──────────────────────────────────────────────
  const setMobile = (v) => setPhone(v.replace(/\D/g, '').slice(0, 10))

  const sendCode = async () => {
    const p = normalisePhone(phone)
    if (!/^\+\d{10,15}$/.test(p)) { setError('Enter a valid mobile number'); return }
    setLoading(true); setError('')
    try {
      await db.sendTrialOtp(p)
      setOtpSent(true)
    } catch (err) {
      setError(err?.message || 'Could not send OTP')
    } finally { setLoading(false) }
  }

  const verifyCode = async () => {
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the OTP'); return }
    setLoading(true); setError('')
    try {
      await db.verifyTrialOtp(normalisePhone(phone), otp)
      setIsAuthed(true)
      goHome()
    } catch (err) {
      setError(err?.message || 'Invalid OTP')
    } finally { setLoading(false) }
  }

  // DEV ONLY — bypass SMS. Mirrors ParentLogin devSkipOtp / trialTestLogin.
  const devSkip = async (thenSubmit) => {
    setLoading(true); setError('')
    try {
      await db.trialTestLogin(phone)
      setIsAuthed(true)
      if (thenSubmit) { setShowGate(false); await doSubmit() } else { goHome() }
    } catch (err) {
      setError(err?.message || 'Test login failed (is ENABLE_TRIAL_TEST_LOGIN set?)')
    } finally { setLoading(false) }
  }

  const skipLogin = () => { setError(''); goHome() }

  // Profile-tab verify — same OTP mechanics as login, but deliberately does
  // NOT call goHome(): the visitor opened Profile on purpose, so verifying
  // should land them ON the list they asked to see, not bounce to Home.
  const profileSendOtp = async () => {
    const p = normalisePhone(phone)
    if (!/^\+\d{10,15}$/.test(p)) { setError('Enter a valid mobile number'); return }
    setLoading(true); setError('')
    try { await db.sendTrialOtp(p); setOtpSent(true) }
    catch (err) { setError(err?.message || 'Could not send OTP') }
    finally { setLoading(false) }
  }
  const profileVerifyOtp = async () => {
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the OTP'); return }
    setLoading(true); setError('')
    try {
      await db.verifyTrialOtp(normalisePhone(phone), otp)
      setIsAuthed(true); setOtpSent(false); setOtp('')
    } catch (err) {
      setError(err?.message || 'Invalid OTP')
    } finally { setLoading(false) }
  }
  const profileDevSkip = async () => {
    setLoading(true); setError('')
    try { await db.trialTestLogin(phone); setIsAuthed(true) }
    catch (err) { setError(err?.message || 'Test login failed (is ENABLE_TRIAL_TEST_LOGIN set?)') }
    finally { setLoading(false) }
  }

  // ── navigation ───────────────────────────────────────────────
  // Resets everything EXCEPT isAuthed and the parent/emergency-contact
  // fields — one verified phone number can register several students
  // (siblings) back to back without repeating OTP or retyping the same
  // household's contact info. Only the STUDENT-specific fields clear, so
  // the next child's form doesn't start pre-filled with the previous
  // child's name/DOB/medical notes/document.
  function goHome() {
    setStep('home'); setHomeTab('home'); setChosenSport(''); setChosenRow(null)
    setOtpSent(false); setOtp(''); setError('')
    setBatches([]); setBatchId(null)
    setForm(f => ({ ...f, name: '', dob: '', age: '', medicalNotes: '' }))
    setDocumentFile(null); setResult(null)
    setFeeMode('walkin'); setPaymentStatus('idle')
    setRelationship(''); setRelationshipCustom(''); setSiblingOfId('')
  }
  const chooseSport = (name) => { setError(''); setChosenSport(name); setStep('branch') }

  async function chooseBranch(row) {
    setChosenRow(row); setLoading(true); setError('')
    try {
      const list = await db.fetchPublicTrialBatches(slug, row.id)
      setBatches(list); setBatchId(null); setStep('batch')
    } catch (err) {
      setError(err?.message || 'Could not load batches')
    } finally { setLoading(false) }
  }

  const set = (field, value) => setForm(f => ({ ...f, [field]: value }))

  // DevFillButton shows in local dev AND on the live site once ?demo=1 has
  // been visited (see DevFillButton.jsx) — this only fills form FIELDS with
  // fake data, unlike the OTP-skip buttons below which stay dev-only since
  // bypassing phone verification on the live public funnel would be a real
  // security hole, not just a testing convenience.
  const handleDevFill = () => {
    const data = fillPublicRegistration()
    setForm(f => ({ ...f, ...data }))
    setRelationship(data.relationship)
  }

  // ── submit ───────────────────────────────────────────────────
  const startSubmit = () => {
    setError('')
    if (!form.name.trim() || !form.parentName.trim()) { setError('Student name and parent name are required'); return }
    if (!form.emergencyContactName.trim() || !form.emergencyContactPhone.trim()) { setError('Emergency contact is required'); return }
    if (isAuthed) { doSubmit() }
    else { setOtp(''); setOtpSent(false); setShowGate(true) }
  }

  const trialFee = chosenRow?.trialFee ?? 590

  async function doSubmit() {
    setSubmitting(true); setError('')
    try {
      let documentPath = null
      if (documentFile) documentPath = await db.uploadPublicTrialDocument(documentFile)
      // Submit the trial FIRST regardless of fee mode — the lead is captured
      // even if online payment is abandoned or fails; staff can always
      // collect walk-in cash for an unpaid trial. Payment never gates
      // whether the registration itself succeeds.
      const res = await db.submitPublicTrial(slug, {
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
        // Always 'Not collected' at submission — true either way (walk-in
        // hasn't been paid yet; online hasn't succeeded yet). The verify
        // function flips this to the REAL Razorpay method (UPI/Card) only
        // once payment actually succeeds — trial_fee_mode has a DB check
        // constraint limited to Cash/UPI/Card/Not collected, no "Pending".
        trialFeeMode:   'Not collected',
        trialFeeAmount: trialFee,
        relationship:      relationship === 'Other' ? relationshipCustom.trim() : relationship,
        siblingOfTrialId:  siblingOfId || null,
      })
      setResult(res)
      refreshMyTrials() // keeps the Profile list + next sibling-picker current; fire-and-forget
      if (feeMode === 'online') {
        await runOnlinePayment(res.id)
      } else {
        setStep('confirm')
      }
    } catch (err) {
      setShowGate(false)
      setError(err?.message || 'Could not submit — please try again')
    } finally { setSubmitting(false) }
  }

  // Opens Razorpay Checkout for the just-created trial. Whatever happens —
  // paid, dismissed, or failed — we still land on the confirm screen, since
  // the trial itself already exists (submitted above); the academy can
  // always collect cash for an unpaid one. Only paymentStatus changes what
  // the confirm screen says.
  async function runOnlinePayment(trialId) {
    setPaymentStatus('processing')
    try {
      await loadRazorpayScript()
      const order = await db.createTrialRazorpayOrder({ slug, branchId: chosenRow.id, trialId })
      if (!order?.orderId) throw new Error('Could not start payment')

      await new Promise((resolve) => {
        const rzp = new window.Razorpay({
          key:      order.keyId,
          order_id: order.orderId,
          amount:   order.amount,
          currency: order.currency || 'INR',
          name:     displayName,
          description: `Trial fee — ${chosenSport}`,
          prefill:  order.prefill || {},
          theme:    { color: C.main },
          handler: async function (response) {
            try {
              await db.verifyTrialRazorpayPayment({
                slug, trialId,
                orderId:   response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              })
              setPaymentStatus('paid')
            } catch {
              setPaymentStatus('failed')
            }
            resolve()
          },
          modal: { ondismiss: () => { setPaymentStatus('failed'); resolve() } },
        })
        rzp.on('payment.failed', () => { setPaymentStatus('failed'); resolve() })
        rzp.open()
      })
    } catch {
      setPaymentStatus('failed')
    } finally {
      setStep('confirm')
    }
  }

  // OTP gate (shown at submit if the visitor skipped the login OTP).
  const gateSend = async () => {
    const p = normalisePhone(phone)
    if (!/^\+\d{10,15}$/.test(p)) { setError('Enter a valid mobile number'); return }
    setLoading(true); setError('')
    try { await db.sendTrialOtp(p); setOtpSent(true) }
    catch (err) { setError(err?.message || 'Could not send OTP') }
    finally { setLoading(false) }
  }
  const gateVerify = async () => {
    if (!/^\d{4,8}$/.test(otp)) { setError('Enter the OTP'); return }
    setLoading(true); setError('')
    try {
      await db.verifyTrialOtp(normalisePhone(phone), otp)
      setIsAuthed(true); setShowGate(false)
      await doSubmit()
    } catch (err) {
      setError(err?.message || 'Invalid OTP')
    } finally { setLoading(false) }
  }

  // ── branding gates ───────────────────────────────────────────
  if (brandingStatus === 'loading' || !authChecked) {
    return (
      <div style={{ minHeight: '100vh', background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.main, fontFamily: FONT }}>
        <Spinner size={26} color={C.main} />
      </div>
    )
  }
  if (brandingStatus === 'not-found') {
    return (
      <div style={{ minHeight: '100vh', background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: FONT }}>
        <div style={{ width: '100%', maxWidth: 360, background: '#fff', border: `1.5px solid ${N.line}`, borderRadius: 24, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: N.text, marginBottom: 8 }}>Link not found</div>
          <div style={{ fontSize: 14, color: N.muted }}>
            This registration link isn't valid. Please contact the academy directly for the correct link.
          </div>
        </div>
      </div>
    )
  }

  const displayName = branding?.appDisplayName || branding?.name || 'Academy'
  const shortCode = (branding?.name || 'ARA').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ARA'
  const heroFallback  = tagPhoto('sports,stadium,training', `${slug}-hero`, 800, 1400)
  const promoFallback = tagPhoto('sports,team,training', `${slug}-promo`, 900, 380)
  const sportFallback = (name, w, h) => tagPhoto(`${slugify(name)},sport`, `${slug}-${slugify(name)}`, w, h)
  const branchFallback = (row, w, h) => tagPhoto(`${slugify(row.sportName)},sport`, `${slug}-branch-${row.id}`, w, h)

  const heroSubtitle = branchRows.length > 0
    ? `${sportsView.length} sport${sportsView.length === 1 ? '' : 's'} · ${branchCount} branch${branchCount === 1 ? '' : 'es'} · One academy.`
    : 'Register in under 2 minutes.'

  return (
    <div style={{ minHeight: '100vh', background: N.page, fontFamily: FONT }}>
      <div style={{ margin: '0 auto', width: '100%', maxWidth: 440, minHeight: '100vh', position: 'relative', overflow: 'hidden', background: N.page }}>

        {/* ── LOGIN ─────────────────────────────────────────── */}
        {step === 'login' && (
          <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', background: '#0B1F12' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <Photo fallback={heroFallback} C={C} alt={displayName} />
            </div>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,28,16,0.72) 0%, rgba(8,28,16,0.45) 35%, rgba(8,28,16,0.9) 78%)', pointerEvents: 'none' }} />

            <div style={{ position: 'absolute', top: 58, left: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {branding?.logoUrl ? (
                <img src={branding.logoUrl} alt={displayName} style={{ width: 56, height: 56, borderRadius: 999, objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 999, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trophy size={26} color="#fff" />
                </div>
              )}
              <div style={{ color: '#fff', fontSize: 28, fontWeight: 800, lineHeight: 1.12, letterSpacing: -0.7 }}>
                Train with<br />{displayName}.
              </div>
              <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: 500 }}>{heroSubtitle}</div>
            </div>

            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '34px 34px 0 0', padding: '22px 24px 30px', boxShadow: '0 -18px 40px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', background: '#F1F7F1', borderRadius: 16, padding: 4, gap: 4, marginBottom: 18 }}>
                {['login', 'register'].map(m => (
                  <div key={m} onClick={() => { setAuthMode(m); setOtpSent(false); setOtp(''); setError('') }}
                    style={{
                      flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 13, fontSize: 14.5, fontWeight: 800, cursor: 'pointer',
                      background: authMode === m ? '#fff' : 'transparent', color: authMode === m ? '#10462A' : '#8AA091',
                      boxShadow: authMode === m ? '0 2px 8px rgba(11,50,26,0.1)' : 'none', transition: 'all .15s',
                    }}>
                    {m === 'login' ? 'Login' : 'Register'}
                  </div>
                ))}
              </div>

              <ErrorBox msg={error} />

              {!otpSent ? (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: N.muted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>Mobile number</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: N.input, border: `1.5px solid ${N.line}`, borderRadius: 16, padding: '15px 16px', marginBottom: 16 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#10462A' }}>+91</span>
                    <div style={{ width: 1, height: 18, background: N.line }} />
                    <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                      onChange={e => setMobile(e.target.value)}
                      style={{ border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, color: N.text, flex: 1, background: 'transparent', fontFamily: FONT }} />
                  </div>
                  <Cta onClick={sendCode} loading={loading} C={C}>{authMode === 'login' ? 'Send OTP' : 'Create Account'}</Cta>
                  {import.meta.env.DEV && (
                    <button type="button" onClick={() => devSkip(false)} disabled={loading}
                      style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                      ⚡ Skip OTP (dev only)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: '#4C6455', fontWeight: 500, marginBottom: 14 }}>
                    Code sent to <b style={{ color: N.text }}>+91 {phone}</b> ·{' '}
                    <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 800, cursor: 'pointer' }}>Change</span>
                  </div>
                  <input type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                    style={{ border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 24, fontWeight: 700, letterSpacing: 14, color: N.text, background: N.input, borderRadius: 16, padding: '15px 16px', fontFamily: FONT, textAlign: 'center', width: '100%', boxSizing: 'border-box', marginBottom: 16 }} />
                  <Cta onClick={verifyCode} loading={loading} C={C}>Verify &amp; Continue</Cta>
                </>
              )}

              <div onClick={skipLogin} role="button" tabIndex={0}
                style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: N.muted, padding: '16px 0 0', cursor: 'pointer' }}>
                Skip for now →
              </div>
            </div>
          </div>
        )}

        {/* ── HOME ──────────────────────────────────────────── */}
        {step === 'home' && (
          <div style={{ minHeight: '100vh', position: 'relative' }}>
            <div style={{ minHeight: '100vh', overflowY: 'auto' }}>
              <div style={{ background: `linear-gradient(160deg, ${C.main} 0%, ${C.dark} 100%)`, padding: '56px 22px 28px', borderRadius: '0 0 32px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {branding?.logoUrl ? (
                      <img src={branding.logoUrl} alt={displayName} style={{ width: 38, height: 38, borderRadius: 999, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Trophy size={17} color="#fff" />
                      </div>
                    )}
                    <div>
                      <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: 600, letterSpacing: 0.4 }}>{greetingWord()}</div>
                      <div style={{ color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>{displayName}</div>
                    </div>
                  </div>
                  <div style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Bell size={16} color="#fff" />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 16, padding: '13px 15px', marginTop: 20 }}>
                  <Search size={15} color="rgba(255,255,255,0.85)" />
                  <input value={homeSearch} onChange={e => setHomeSearch(e.target.value)}
                    placeholder="Search sport or branch"
                    style={{ background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 14, fontWeight: 500, flex: 1, fontFamily: FONT }} />
                </div>
              </div>

              {homeTab === 'home' ? (
                <>
                  <div style={{ padding: '18px 22px 0' }}>
                    <div style={{ position: 'relative', borderRadius: 26, overflow: 'hidden', boxShadow: '0 12px 26px rgba(11,50,26,0.16)', height: 140 }}>
                      <Photo fallback={promoFallback} C={C} alt="Promotion" />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(6,24,13,0.82) 8%, rgba(6,24,13,0.15) 78%)', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, pointerEvents: 'none' }}>
                        <div style={{ display: 'inline-flex', alignSelf: 'flex-start', background: LIME, color: LIME_TEXT, fontSize: 10, fontWeight: 800, letterSpacing: 0.6, borderRadius: 999, padding: '4px 10px' }}>ADMISSIONS OPEN</div>
                        <div style={{ color: '#fff', fontSize: 19, fontWeight: 800, lineHeight: 1.15, letterSpacing: -0.3 }}>Book your<br />free trial</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '16px 22px 12px' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: N.text, letterSpacing: -0.4 }}>Our Sports</div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.main }}>
                      {sportsView.length} program{sportsView.length === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ padding: '0 22px 120px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {filteredSportsView.length === 0 && (
                      <div style={{ textAlign: 'center', color: N.muted, fontSize: 14, padding: '30px 0' }}>
                        {sportsView.length === 0 ? 'No sports available yet.' : 'No matches — try a different search.'}
                      </div>
                    )}
                    {filteredSportsView.map(sp => (
                      <div key={sp.name} onClick={() => chooseSport(sp.name)}
                        style={{ position: 'relative', width: '100%', height: 148, borderRadius: 28, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 10px 24px rgba(11,50,26,0.14)' }}>
                        <Photo src={sp.photo} fallback={sportFallback(sp.name, 700, 420)} radius={28} C={C} alt={sp.name} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,24,13,0.05) 30%, rgba(6,24,13,0.85) 100%)', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.92)', color: '#10462A', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, borderRadius: 999, padding: '5px 10px', pointerEvents: 'none' }}>
                          {sp.count} location{sp.count === 1 ? '' : 's'}
                        </div>
                        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 14, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', pointerEvents: 'none' }}>
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>{sp.name}</div>
                          <div style={{ width: 34, height: 34, borderRadius: 999, background: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ArrowRight size={15} color={LIME_TEXT} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : homeTab === 'batches' ? (
                <div style={{ padding: '60px 30px 120px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: N.text, marginBottom: 6 }}>Coming soon</div>
                  <div style={{ fontSize: 14, color: N.muted }}>Batch browsing lands here soon.</div>
                </div>
              ) : !isAuthed ? (
                /* ── PROFILE, not verified yet ──────────────── */
                <div style={{ padding: '40px 22px 120px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: N.text, marginBottom: 6, textAlign: 'center' }}>Verify your number</div>
                  <div style={{ fontSize: 13, color: N.muted, marginBottom: 20, textAlign: 'center' }}>to see your registered students</div>
                  <ErrorBox msg={error} />
                  {!otpSent ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1.5px solid ${N.line}`, borderRadius: 16, padding: '14px 16px', marginBottom: 14 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#10462A' }}>+91</span>
                        <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                          onChange={e => setMobile(e.target.value)}
                          style={{ border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, color: N.text, flex: 1, background: 'transparent', fontFamily: FONT }} />
                      </div>
                      <Cta onClick={profileSendOtp} loading={loading} C={C}>Send OTP</Cta>
                      {import.meta.env.DEV && (
                        <button type="button" onClick={profileDevSkip} disabled={loading}
                          style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                          ⚡ Skip OTP (dev only)
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13.5, color: N.text, marginBottom: 12 }}>
                        OTP sent to <b>+91 {phone}</b>.{' '}
                        <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                      </div>
                      <input type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
                        onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                        style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 22, fontWeight: 700, letterSpacing: 10, color: N.text, background: N.input, borderRadius: 16, padding: '14px 16px', fontFamily: FONT, textAlign: 'center', marginBottom: 16 }} />
                      <Cta onClick={profileVerifyOtp} loading={loading} C={C}>Verify</Cta>
                    </>
                  )}
                </div>
              ) : (
                /* ── PROFILE, verified — the actual registrations list ── */
                <div style={{ padding: '20px 22px 120px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: N.text, marginBottom: 2 }}>Your registrations</div>
                  <div style={{ fontSize: 12.5, color: N.muted, marginBottom: 16 }}>+91 {phone}</div>
                  {profileLoading ? (
                    <div style={{ textAlign: 'center', padding: '30px 0' }}><Spinner size={22} color={C.main} /></div>
                  ) : myTrials.length === 0 ? (
                    <div style={{ textAlign: 'center', color: N.muted, fontSize: 14, padding: '30px 0' }}>No registrations yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {myTrials.map(t => {
                        const expanded = expandedTrialId === t.id
                        return (
                          <div key={t.id} style={{ background: '#fff', borderRadius: 18, padding: 14, boxShadow: '0 4px 14px rgba(11,50,26,0.06)' }}>
                            <div onClick={() => setExpandedTrialId(expanded ? null : t.id)} role="button" tabIndex={0}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                              <div>
                                <div style={{ fontSize: 15, fontWeight: 800, color: N.text }}>{t.name}</div>
                                <div style={{ fontSize: 12, color: N.muted, marginTop: 2 }}>{t.sport}{t.branchName ? ` · ${t.branchName}` : ''}</div>
                                {t.relationship && <div style={{ fontSize: 11.5, color: C.main, fontWeight: 700, marginTop: 4 }}>{t.relationship}</div>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{
                                  fontSize: 10.5, fontWeight: 800, padding: '5px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                                  background: STAGE_STRONG.has(t.stage) ? C.main : C.tint,
                                  color:      STAGE_STRONG.has(t.stage) ? '#fff' : C.dark,
                                }}>
                                  {STAGE_LABEL[t.stage] || t.stage}
                                </span>
                                <ChevronDown size={16} color={N.faint} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                              </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${N.line}` }}>
                              <span style={{ fontSize: 11.5, color: N.muted }}>Trial fee</span>
                              <span style={{ fontSize: 11.5, fontWeight: 700, color: t.trialFeeMode === 'Not collected' ? '#B45309' : C.main }}>
                                {t.trialFeeMode === 'Not collected' ? `₹${t.trialFeePaid} due` : `₹${t.trialFeePaid} paid (${t.trialFeeMode})`}
                              </span>
                            </div>

                            {expanded && (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${N.line}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ fontSize: 12.5, color: N.text, lineHeight: 1.5 }}>{STAGE_NEXT[t.stage] || ''}</div>

                                {t.batchName && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                    <span style={{ fontSize: 11.5, color: N.muted, flexShrink: 0 }}>Batch</span>
                                    <span style={{ fontSize: 11.5, fontWeight: 700, color: N.text, textAlign: 'right' }}>
                                      {t.batchName}{t.batchDays?.length ? ` · ${t.batchDays.join(', ')}` : ''}{t.batchStartTime ? ` · ${t.batchStartTime}–${t.batchEndTime}` : ''}
                                    </span>
                                  </div>
                                )}

                                {t.coachNote && (
                                  <div style={{ background: N.input, borderRadius: 12, padding: 10 }}>
                                    <div style={{ fontSize: 10.5, fontWeight: 800, color: N.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>Coach's note</div>
                                    <div style={{ fontSize: 12, color: N.text, lineHeight: 1.4 }}>{t.coachNote}</div>
                                  </div>
                                )}

                                {/* Converted — a real student account exists */}
                                {t.stage === 'converted' && (academyFeatures.studentCodeLogin || academyFeatures.familyLogin) && (
                                  <div style={{ background: C.tint, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 800, color: C.dark }}>Access the Student App</div>

                                    {academyFeatures.studentCodeLogin && t.studentCode && (
                                      t.accountStatus === 'active' ? (
                                        <div style={{ fontSize: 12, color: N.text }}>
                                          Already activated — <a href="https://khelit.com" style={{ color: C.main, fontWeight: 700 }}>log in at khelit.com</a>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: 11.5, color: N.muted }}>Student ID</span>
                                            <span style={{ fontSize: 12.5, fontWeight: 800, color: N.text, fontFamily: 'monospace' }}>{t.studentCode}</span>
                                          </div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: 11.5, color: N.muted }}>Join Code</span>
                                            <span style={{ fontSize: 12.5, fontWeight: 800, color: N.text, fontFamily: 'monospace' }}>{t.joinCode}</span>
                                          </div>
                                          <a href="https://khelit.com/activate" style={{ textDecoration: 'none' }}>
                                            <div style={{ marginTop: 4, textAlign: 'center', background: C.main, color: '#fff', fontSize: 12.5, fontWeight: 800, borderRadius: 10, padding: '9px 0' }}>
                                              Open Student App →
                                            </div>
                                          </a>
                                        </div>
                                      )
                                    )}

                                    {academyFeatures.familyLogin && (
                                      <a href="/parent-login" style={{ textDecoration: 'none' }}>
                                        <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.dark, padding: '6px 0' }}>
                                          Or log in with just your phone number →
                                        </div>
                                      </a>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div style={{ marginTop: 20 }}>
                    <Cta onClick={() => setHomeTab('home')} C={C}>+ Add New Student</Cta>
                  </div>
                </div>
              )}
            </div>

            {/* Floating glass bottom nav — home screen only */}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 18,
              background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)',
              borderRadius: 999, boxShadow: '0 12px 28px rgba(11,50,26,0.22)', display: 'flex', gap: 2, padding: 6, border: '1px solid rgba(255,255,255,0.7)' }}>
              {[
                { key: 'home', label: 'Home', Icon: HomeIcon },
                { key: 'batches', label: 'Batches', Icon: CalendarDays },
                { key: 'profile', label: 'Profile', Icon: User },
              ].map(({ key, label, Icon }) => {
                const active = homeTab === key
                return (
                  <div key={key} onClick={() => setHomeTab(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: active ? '10px 16px' : '10px 14px', borderRadius: 999, background: active ? C.main : 'transparent', cursor: 'pointer' }}>
                    <Icon size={active ? 15 : 17} color={active ? '#fff' : N.faint} />
                    {active && <div style={{ fontSize: 12.5, fontWeight: 800, color: '#fff' }}>{label}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── BRANCH ────────────────────────────────────────── */}
        {step === 'branch' && (
          <div style={{ minHeight: '100vh' }}>
            <div style={{ position: 'relative', height: 210 }}>
              <Photo fallback={sportFallback(chosenSport, 900, 500)} C={C} alt={chosenSport} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,24,13,0.6) 0%, rgba(6,24,13,0.15) 45%, rgba(6,24,13,0.88) 100%)', pointerEvents: 'none' }} />
              <div onClick={goHome} role="button" tabIndex={0}
                style={{ position: 'absolute', top: 58, left: 20, width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <ArrowLeft size={17} color="#10462A" />
              </div>
              <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18, pointerEvents: 'none' }}>
                <div style={{ display: 'inline-flex', background: 'rgba(201,240,77,0.95)', color: LIME_TEXT, fontSize: 10, fontWeight: 800, letterSpacing: 0.6, borderRadius: 999, padding: '4px 10px' }}>SPORT</div>
                <div style={{ color: '#fff', fontSize: 27, fontWeight: 800, letterSpacing: -0.6, marginTop: 8 }}>{chosenSport}</div>
                <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {branchesForSport.length} branch{branchesForSport.length === 1 ? '' : 'es'}
                </div>
              </div>
            </div>

            <div style={{ padding: '20px 22px 8px', fontSize: 17, fontWeight: 800, color: N.text, letterSpacing: -0.3 }}>Choose a branch</div>
            <div style={{ padding: '0 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {branchesForSport.map(row => (
                <div key={row.id} onClick={() => chooseBranch(row)}
                  style={{ background: '#fff', borderRadius: 26, padding: 14, cursor: 'pointer', boxShadow: '0 6px 18px rgba(11,50,26,0.08)', opacity: loading ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <div style={{ width: 88, height: 88, flexShrink: 0 }}>
                      <Photo src={row.photoUrl} fallback={branchFallback(row, 320, 320)} radius={20} C={C} alt={row.branchName} />
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: N.text, letterSpacing: -0.2 }}>{row.branchName}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={12} color={N.faint} />
                        <span style={{ fontSize: 12.5, color: '#5E7566', fontWeight: 600 }}>{row.address || chosenSport}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderTop: `1px solid ${N.line}`, marginTop: 12, paddingTop: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.main, fontSize: 13, fontWeight: 800 }}>
                      Register <ArrowRight size={13} />
                    </div>
                  </div>
                </div>
              ))}
              {branchesForSport.length === 0 && (
                <div style={{ textAlign: 'center', color: N.muted, fontSize: 14, padding: '20px 0' }}>No branches for this sport yet.</div>
              )}
            </div>
          </div>
        )}

        {/* ── BATCH ─────────────────────────────────────────── */}
        {step === 'batch' && (
          <div style={{ minHeight: '100vh' }}>
            <TopBar title="Choose a Batch" onBack={() => setStep('branch')} C={C}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.tint, color: C.dark, borderRadius: 10, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, marginTop: 12 }}>
                {chosenSport} • {chosenRow?.branchName}
              </div>
            </TopBar>
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {batches.map(b => (
                <div key={b.id} onClick={() => { setBatchId(b.id); setStep('form') }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: '#fff', borderRadius: 18, padding: '14px 16px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(11,50,26,0.06)' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: N.text }}>{b.name}</div>
                    <div style={{ fontSize: 12.5, color: N.faint, marginTop: 2 }}>
                      {(b.days || []).join(', ')}{b.startTime ? ` · ${b.startTime}–${b.endTime}` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: '5px 10px', borderRadius: 999,
                    background: b.seatsLeft > 0 ? C.tint : '#FEF3C7', color: b.seatsLeft > 0 ? C.dark : '#92400E' }}>
                    {b.seatsLeft > 0 ? `${b.seatsLeft} seats left` : 'Waitlist'}
                  </span>
                </div>
              ))}
              {batches.length === 0 && (
                <div style={{ textAlign: 'center', color: N.muted, fontSize: 14, padding: '10px 0' }}>No batches listed — the academy will place you.</div>
              )}
              <div onClick={() => { setBatchId(null); setStep('form') }} role="button" tabIndex={0}
                style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: N.muted, padding: '10px 0', cursor: 'pointer', textDecoration: 'underline' }}>
                Not sure yet — let the academy pick
              </div>
            </div>
          </div>
        )}

        {/* ── FORM ──────────────────────────────────────────── */}
        {step === 'form' && (
          <div style={{ minHeight: '100vh', position: 'relative' }}>
            <div style={{ minHeight: '100vh', overflowY: 'auto', paddingBottom: 100 }}>
              <TopBar title="Student Registration" subtitle={`${chosenSport} · ${chosenRow?.branchName}`} onBack={() => setStep('batch')} C={C} />

              <div style={{ padding: '18px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <DevFillButton onFill={handleDevFill} />
                </div>
                <ErrorBox msg={error} />

                <SectionCard index="01" title="STUDENT DETAILS">
                  <LabeledInput placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} />
                  <div style={{ display: 'flex', gap: 12 }}>
                    <LabeledInput type="date" value={form.dob}
                      onChange={e => { const dob = e.target.value; setForm(f => ({ ...f, dob, age: dob ? ageFromDob(dob) : f.age })) }}
                      style={{ flex: 1 }} />
                    <LabeledInput type="number" min="1" max="99" placeholder="Age" value={form.age}
                      onChange={e => set('age', e.target.value)}
                      readOnly={!!form.dob} title={form.dob ? 'Calculated from date of birth' : ''}
                      style={{ width: 96, ...(form.dob ? { color: N.muted, cursor: 'not-allowed' } : {}) }} />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.muted }}>Relationship to parent</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {['Son', 'Daughter', 'Ward', 'Other'].map(opt => {
                        const active = relationship === opt
                        return (
                          <div key={opt} onClick={() => setRelationship(opt)} role="button" tabIndex={0}
                            style={{
                              padding: '9px 14px', borderRadius: 12, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                              background: active ? C.main : N.input, color: active ? '#fff' : N.muted,
                              border: active ? `1.5px solid ${C.main}` : `1.5px solid ${N.line}`,
                            }}>
                            {opt}
                          </div>
                        )
                      })}
                    </div>
                    {relationship === 'Other' && (
                      <LabeledInput placeholder="Describe the relationship" value={relationshipCustom}
                        onChange={e => setRelationshipCustom(e.target.value)} autoFocus />
                    )}
                  </div>

                  {myTrials.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: N.muted }}>Sibling of (optional)</div>
                      <select value={siblingOfId} onChange={e => setSiblingOfId(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">— Not linked to another registration —</option>
                        {myTrials.map(t => <option key={t.id} value={t.id}>{t.name} ({t.sport})</option>)}
                      </select>
                    </div>
                  )}
                </SectionCard>

                <SectionCard index="02" title="CONTACT">
                  <LabeledInput placeholder="Parent / guardian name" value={form.parentName} onChange={e => set('parentName', e.target.value)} />
                  <LabeledInput placeholder="Emergency contact name" value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} />
                  <LabeledInput type="tel" inputMode="tel" placeholder="Emergency contact number" value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} />
                </SectionCard>

                <SectionCard index="03" title="HEALTH">
                  <textarea placeholder="Any medical condition or allergy? (leave blank if none)" value={form.medicalNotes}
                    onChange={e => set('medicalNotes', e.target.value)}
                    style={{ ...inputStyle, resize: 'none', minHeight: 74, lineHeight: 1.45 }} />
                </SectionCard>

                <SectionCard index="04" title="DOCUMENT">
                  {!documentFile ? (
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0', fontSize: 14, fontWeight: 600, color: N.muted, border: `2px dashed ${N.line}`, borderRadius: 18, cursor: 'pointer' }}>
                      <Camera size={16} /> Upload ID / medical document
                      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                        onChange={e => setDocumentFile(e.target.files?.[0] || null)} />
                    </label>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: N.input, border: `1.5px solid ${N.line}`, borderRadius: 14 }}>
                      <span style={{ fontSize: 14, color: N.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{documentFile.name}</span>
                      <X size={18} color={N.faint} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setDocumentFile(null)} />
                    </div>
                  )}
                </SectionCard>

                <SectionCard index="05" title="TRIAL FEE">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, color: N.muted, fontWeight: 600 }}>Amount due</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: N.text }}>₹{trialFee.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { key: 'walkin', label: 'Pay at the Academy' },
                      { key: 'online', label: 'Pay Online Now' },
                    ].map(opt => {
                      const active = feeMode === opt.key
                      return (
                        <div key={opt.key} onClick={() => setFeeMode(opt.key)} role="button" tabIndex={0}
                          style={{
                            flex: 1, textAlign: 'center', padding: '13px 10px', borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            background: active ? C.main : N.input,
                            color: active ? '#fff' : N.muted,
                            border: active ? `1.5px solid ${C.main}` : `1.5px solid ${N.line}`,
                          }}>
                          {opt.label}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 12, color: N.muted, lineHeight: 1.4 }}>
                    {feeMode === 'walkin'
                      ? "You'll pay this in cash when you visit the academy."
                      : "You'll pay securely online right after submitting — UPI, cards & netbanking."}
                  </div>
                </SectionCard>
              </div>
            </div>

            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '16px 22px 26px', background: `linear-gradient(180deg, rgba(244,248,244,0) 0%, ${N.page} 45%)` }}>
              <Cta onClick={startSubmit} loading={submitting} C={C}>Submit Registration</Cta>
            </div>
          </div>
        )}

        {/* ── CONFIRM ───────────────────────────────────────── */}
        {step === 'confirm' && (
          <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 30px', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: 999, background: C.main, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 14px 30px ${C.main}52`, marginBottom: 10 }}>
              <CheckCircle2 size={38} color="#fff" strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: N.text, letterSpacing: -0.5 }}>You're in!</div>
            <div style={{ fontSize: 14, color: '#5E7566', fontWeight: 500, lineHeight: 1.55, maxWidth: 280 }}>
              Registration received for <b style={{ color: N.text }}>{chosenSport}</b> at <b style={{ color: N.text }}>{chosenRow?.branchName}</b>. Our coach will call within 24 hours.
            </div>
            <div style={{ background: '#fff', borderRadius: 22, padding: '16px 18px', marginTop: 20, width: '100%', boxShadow: '0 6px 18px rgba(11,50,26,0.08)', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Application ID</span>
                <span style={{ fontSize: 12.5, color: N.text, fontWeight: 800 }}>{shortCode}-{new Date().getFullYear()}-{result?.id ?? '—'}</span>
              </div>
              <div style={{ height: 1, background: N.line }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Batch</span>
                <span style={{ fontSize: 12.5, color: N.text, fontWeight: 800 }}>
                  {batchId ? (batches.find(b => b.id === batchId)?.name || '—') : 'To be assigned'}
                </span>
              </div>
              <div style={{ height: 1, background: N.line }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Trial fee</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: paymentStatus === 'paid' ? C.main : paymentStatus === 'failed' ? '#B45309' : N.text }}>
                  {feeMode === 'online'
                    ? (paymentStatus === 'paid' ? `₹${trialFee.toLocaleString('en-IN')} paid online ✓`
                       : paymentStatus === 'failed' ? `₹${trialFee.toLocaleString('en-IN')} — pay at academy`
                       : `₹${trialFee.toLocaleString('en-IN')}`)
                    : `₹${trialFee.toLocaleString('en-IN')} — pay at academy`}
                </span>
              </div>
            </div>
            {feeMode === 'online' && paymentStatus === 'failed' && (
              <div style={{ fontSize: 12.5, color: '#B45309', fontWeight: 500, marginTop: 10, maxWidth: 280 }}>
                Online payment didn't go through — no problem, you can pay ₹{trialFee.toLocaleString('en-IN')} in cash at the academy instead.
              </div>
            )}
            <div style={{ width: '100%', marginTop: 24 }}>
              <Cta onClick={goHome} C={C}>Register Another Student</Cta>
              <div style={{ fontSize: 12.5, color: N.muted, fontWeight: 500, marginTop: 12 }}>
                Registering a sibling? No need to verify your number again.
              </div>
            </div>
          </div>
        )}

        {/* ── OTP GATE (submit-time verification for the skip path) ── */}
        {showGate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,26,13,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
            onClick={() => { if (!loading) { setShowGate(false); setError('') } }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: '28px 28px 0 0', padding: '22px 24px 30px', boxSizing: 'border-box' }}>
              <div style={{ width: 40, height: 4, borderRadius: 999, background: N.line, margin: '0 auto 18px' }} />
              <div style={{ fontSize: 18, fontWeight: 800, color: N.text, marginBottom: 4 }}>Verify your number</div>
              <div style={{ fontSize: 13.5, color: N.muted, marginBottom: 18 }}>One quick step so the academy can confirm your registration.</div>
              <ErrorBox msg={error} />

              {!otpSent ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: N.input, border: `1.5px solid ${N.line}`, borderRadius: 16, padding: '15px 16px', marginBottom: 16 }}>
                    <Phone size={16} color="#6E8677" />
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#10462A' }}>+91</span>
                    <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                      onChange={e => setMobile(e.target.value)}
                      style={{ border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, color: N.text, flex: 1, background: 'transparent', fontFamily: FONT }} />
                  </div>
                  <Cta onClick={gateSend} loading={loading} C={C}>Send OTP</Cta>
                  {import.meta.env.DEV && (
                    <button type="button" onClick={() => devSkip(true)} disabled={loading}
                      style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                      ⚡ Skip OTP & submit (dev only)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13.5, color: N.text, marginBottom: 12 }}>
                    OTP sent to <b>+91 {phone}</b>.{' '}
                    <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                  </div>
                  <input type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                    style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 22, fontWeight: 700, letterSpacing: 10, color: N.text, background: N.input, borderRadius: 16, padding: '14px 16px', fontFamily: FONT, textAlign: 'center', marginBottom: 16 }} />
                  <Cta onClick={gateVerify} loading={loading || submitting} C={C}>Verify &amp; Submit</Cta>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
