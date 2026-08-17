import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import {
  Phone, ArrowLeft, ArrowRight, MapPin, Trophy, CheckCircle2,
  Camera, X, User, Home as HomeIcon, CalendarDays, Search, Bell, ChevronDown, LogOut,
  Download, Check, Eye,
} from 'lucide-react'
import * as db from '../lib/db'
import DevFillButton from '../components/DevFillButton'
import { fillPublicRegistration } from '../lib/devFill'
import { RELATIONSHIP_OPTIONS, MEDICAL_OPTIONS, GENDER_OPTIONS } from '../lib/studentIntake'
import { computeTrialTotal, taxRowLabel } from '../lib/tax'
import { downloadTrialReceipt, viewTrialReceipt, buildTrialReceiptHTML, saveTrialReceiptNative } from '../lib/trialReceipt'
import { saveOrShareFile } from '../lib/nativeSave'

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

// Renders the "Skip OTP" test buttons. Deliberately NOT gated on
// import.meta.env.DEV — the point is to exercise the funnel against the live
// deployment, where DEV is false. Set VITE_ALLOW_OTP_SKIP=true on the build
// that needs it and unset it afterwards; the button is inert unless the
// trial-test-login function also has ENABLE_TRIAL_TEST_LOGIN=true.
const OTP_SKIP = import.meta.env.VITE_ALLOW_OTP_SKIP === 'true'

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

// Batch codes are stored lowercase (uniqueness is case-insensitive, 0160) —
// this only dresses up how one displays, e.g. "u15-tts" -> "U15-tts".
function capFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
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

// ── Design tokens ────────────────────────────────────────────
// One ramp for type, radius and elevation, drawn from by every screen. The
// funnel is styled inline (no Tailwind here by design), and without a shared
// scale that turned into ~15 font sizes and 11 radii doing the same jobs —
// the specific thing that reads as "unfinished" rather than any one screen.
const R = { chip: 12, control: 14, card: 20, tile: 26, sheet: 28, pill: 999 }

const E = {
  rest:   '0 2px 10px rgba(11,50,26,0.05)',
  raised: '0 8px 22px rgba(11,50,26,0.08)',
  lifted: '0 14px 30px rgba(11,50,26,0.14)',
}

// Sport apps are read at a glance and half of what they show is numbers, so
// the ramp is short, heavy at the top, and tabular wherever digits line up.
const T = {
  hero:    { fontSize: 30,   fontWeight: 800, letterSpacing: -0.9, lineHeight: 1.1 },
  h1:      { fontSize: 24,   fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.15 },
  h2:      { fontSize: 19,   fontWeight: 800, letterSpacing: -0.4 },
  h3:      { fontSize: 16,   fontWeight: 800, letterSpacing: -0.2 },
  body:    { fontSize: 14,   fontWeight: 500, lineHeight: 1.5 },
  strong:  { fontSize: 14,   fontWeight: 700 },
  label:   { fontSize: 12.5, fontWeight: 600 },
  micro:   { fontSize: 11.5, fontWeight: 600 },
  eyebrow: { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase' },
}
const NUM = { fontVariantNumeric: 'tabular-nums' }

// Injected once at the funnel root. Everything here is either a state the
// browser owns and inline styles can't reach (:active, :focus-visible,
// ::placeholder, reduced motion) or an animation — never layout, which stays
// inline next to the markup it belongs to. --jf-accent carries the academy's
// own brand colour into those states.
const JOIN_CSS = `
@keyframes jfRise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes jfShimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
.jf-screen { animation: jfRise .34s cubic-bezier(.22,.61,.36,1) both }
.jf-stagger > * { animation: jfRise .40s cubic-bezier(.22,.61,.36,1) both }
.jf-tap { -webkit-tap-highlight-color: transparent; transition: transform .14s cubic-bezier(.22,.61,.36,1), box-shadow .14s ease, background .14s ease }
.jf-tap:active { transform: scale(.978) }
.jf-tap:focus-visible, .jf-focus:focus-visible { outline: 2.5px solid var(--jf-accent); outline-offset: 3px }
/* !important because the fields carry their border inline, which otherwise
   wins over this rule and leaves focus showing only the outer glow. */
.jf-field:focus { border-color: var(--jf-accent) !important; box-shadow: 0 0 0 3.5px var(--jf-accent-soft) }
.jf-field::placeholder { color: #9AAC9F; font-weight: 500 }
.jf-skel { background: linear-gradient(90deg, #E9F2EB 25%, #F6FAF6 50%, #E9F2EB 75%); background-size: 200% 100%; animation: jfShimmer 1.5s linear infinite }
@media (prefers-reduced-motion: reduce) {
  .jf-screen, .jf-stagger > *, .jf-skel { animation: none !important }
  .jf-tap { transition: none }
  .jf-tap:active { transform: none }
}
`

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

// Best-fit batch for a given age (Auto-Assign Batch by Age, 0162).
// Development batches only — Advance squads are earned via Edit Student,
// never handed out automatically at registration (same rule Students.jsx's
// Add Student already enforces). Among batches whose range fits: prefers
// the tightest age range (most specific match), then one with open seats
// over a full one, then whichever has the most room.
function matchBatchByAge(batches, age) {
  if (age == null || age === '') return null
  const n = Number(age)
  if (!Number.isFinite(n)) return null
  const candidates = (batches || []).filter(b =>
    (b.batchType || 'development') !== 'advance' &&
    n >= (b.ageMin ?? 0) && n <= (b.ageMax ?? 99)
  )
  if (candidates.length === 0) return null
  return candidates.slice().sort((a, b) => {
    const rangeA = (a.ageMax ?? 99) - (a.ageMin ?? 0)
    const rangeB = (b.ageMax ?? 99) - (b.ageMin ?? 0)
    if (rangeA !== rangeB) return rangeA - rangeB
    const openA = (a.seatsLeft ?? 0) > 0 ? 1 : 0
    const openB = (b.seatsLeft ?? 0) > 0 ? 1 : 0
    if (openA !== openB) return openB - openA
    return (b.seatsLeft ?? 0) - (a.seatsLeft ?? 0)
  })[0]
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

// Every tappable surface on this funnel is a div (cards wrap photos and rich
// layout), which cost them keyboard operation and any sense of touch response.
// This gives all of them the same press physics, Enter/Space activation and a
// brand-coloured focus ring, in one place.
function Tappable({ onClick, children, style, disabled, label, pressed, as: Tag = 'div' }) {
  return (
    <Tag
      className="jf-tap"
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={e => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(e) }
      }}
      style={{ cursor: disabled ? 'default' : 'pointer', ...style }}
    >
      {children}
    </Tag>
  )
}

// Relationship, preferred days and fee mode were three hand-rolled copies of
// the same selected/unselected chip, already drifting apart in padding and
// weight. One component keeps them identical and correctly announced.
function Chip({ active, onClick, children, C, style }) {
  return (
    <Tappable onClick={onClick} pressed={active}
      style={{
        padding: '10px 15px', borderRadius: R.chip, ...T.label, fontWeight: 700, textAlign: 'center',
        background: active ? C.main : N.input, color: active ? '#fff' : N.muted,
        border: `1.5px solid ${active ? C.main : N.line}`,
        boxShadow: active ? `0 4px 12px ${C.main}33` : 'none',
        ...style,
      }}>
      {children}
    </Tappable>
  )
}

// Shown while a list is genuinely in flight, so a slow connection sees the
// shape of what's coming instead of an empty screen that looks broken.
function Skeleton({ height, radius = R.card, style }) {
  return <div className="jf-skel" style={{ height, borderRadius: radius, ...style }} />
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
    <div role="alert" style={{ background: '#FEECEC', border: '1px solid #F6C9C9', color: '#B42318', fontSize: 13, fontWeight: 600, padding: '12px 14px', borderRadius: R.control, marginBottom: 14, lineHeight: 1.45 }}>
      {msg}
    </div>
  )
}

// Big green pill CTA — the design's signature button.
function Cta({ children, onClick, loading, disabled, C, type = 'button' }) {
  return (
    <button
      type={type}
      className="jf-tap"
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: C.main, color: '#fff', fontSize: 15.5, fontWeight: 800, border: 'none',
        borderRadius: R.card, padding: '17px 0', letterSpacing: -0.1, minHeight: 56,
        cursor: (loading || disabled) ? 'default' : 'pointer',
        boxShadow: (loading || disabled) ? 'none' : `0 10px 22px ${C.main}4D`,
        opacity: (loading || disabled) ? 0.55 : 1, fontFamily: FONT,
      }}
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
  const [loaded, setLoaded] = useState(false)
  const url = src || fallback
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden', background: `linear-gradient(135deg, ${C.main}, ${C.dark})` }}>
      {!failed && (
        // Cross-fading over the brand gradient turns a hard photo pop-in — the
        // loudest thing on a photo-led screen over a slow connection — into
        // the picture simply arriving.
        <img src={url} alt={alt} loading="lazy"
          onError={() => setFailed(true)} onLoad={() => setLoaded(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                   opacity: loaded ? 1 : 0, transition: 'opacity .45s ease' }} />
      )}
    </div>
  )
}

// White, not the tinted N.input — on this screen's pale mint page background
// a same-toned field read as washed out rather than as a distinct, tappable
// surface. The added shadow borrows the same elevation scale SectionCard
// already uses, so a field now reads as part of one considered system
// instead of a flat default HTML input.
const inputStyle = {
  border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 15, fontWeight: 600, color: N.text,
  background: '#fff', borderRadius: R.control, padding: '14px 16px', width: '100%',
  boxSizing: 'border-box', fontFamily: FONT, transition: 'border-color .15s ease, box-shadow .15s ease',
  boxShadow: E.rest,
}

// `invalid` paints the field itself red and captions it, so a missed required
// field is visible where the user is actually looking. Applied last so it
// always wins over a per-instance style override.
const invalidStyle = { border: '1.5px solid #E5484D', background: '#FFF5F5' }

const fieldLabelStyle = { fontSize: 11.5, fontWeight: 700, color: N.muted, letterSpacing: 0.3, textTransform: 'uppercase', paddingLeft: 1 }

// A field with only a placeholder loses its own identity the moment someone
// types into it — the placeholder-as-label habit that reads as unfinished.
// `label` sits above the field and stays put; `placeholder` goes back to
// being what it's actually for, a one-line example.
function LabeledInput({ invalid, label, ...props }) {
  const field = <input {...props} className="jf-field" style={{ ...inputStyle, ...(props.style || {}), ...(invalid ? invalidStyle : {}) }} />
  if (!label && !invalid) return field
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: props.style?.flex }}>
      {label && <label htmlFor={props.id} style={fieldLabelStyle}>{label}</label>}
      {field}
      {invalid && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B42318', paddingLeft: 2 }}>Required</span>}
    </div>
  )
}

// name/parentName are also enforced server-side (secure_submit_public_trial_v2
// rejects a blank one). The contact pair and gender are client-side rules:
// gender is asked because batches are frequently gendered (e.g. "Football
// Girls Squad"), so a blank one leaves staff unable to place the child without
// phoning back. Everything not listed here is genuinely optional.
const REQUIRED_FIELDS = [
  { key: 'name' },
  { key: 'parentName' },
  { key: 'gender' },
  { key: 'emergencyContactName' },
  { key: 'emergencyContactPhone' },
]

// Short day names, same vocabulary batches.days uses (Batches.jsx ALL_DAYS)
// and what secure_submit_public_trial_v2 whitelists against — staff can then
// eyeball a preference against a batch's days without translating.
const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// White rounded-bottom header with a round back button — branch/batch/form screens.
function TopBar({ title, subtitle, onBack, C, children }) {
  return (
    <div style={{ background: '#fff', padding: '56px 22px 20px', borderRadius: `0 0 ${R.sheet}px ${R.sheet}px`, boxShadow: E.rest }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <Tappable onClick={onBack} label="Go back"
            style={{ width: 42, height: 42, borderRadius: R.pill, background: C.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ArrowLeft size={17} color={C.main} />
          </Tappable>
        )}
        <div>
          <div style={{ ...T.h2, color: N.text }}>{title}</div>
          {subtitle && <div style={{ ...T.label, color: N.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  )
}

// The form genuinely is a sequence, so the numbers carry real information —
// they get a chip of their own instead of being punctuation in the title, and
// the rule to the edge shows how far the card's content reaches. The eyebrow
// was hardcoded green before, which broke on any academy whose brand colour
// isn't the default.
function SectionCard({ index, title, children, C }) {
  return (
    <div style={{ background: '#fff', borderRadius: R.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: E.raised }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ ...T.eyebrow, ...NUM, letterSpacing: 0.2, color: C.dark, background: C.tint, borderRadius: 8, padding: '4px 7px', lineHeight: 1 }}>{index}</span>
        <span style={{ ...T.eyebrow, color: N.muted }}>{title}</span>
        <span style={{ flex: 1, height: 1, background: N.line }} />
      </div>
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
  const [academyFeatures, setAcademyFeatures] = useState({ studentCodeLogin: true, familyLogin: true, joinBatchChoice: true, autoAssignBatchByAge: false })

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

  // Settings → Features → "Batch Choice on Registration". Off = branch goes
  // straight to the form and the academy assigns the batch later, which is
  // what the "let the academy pick" escape hatch already did anyway.
  const batchChoice = academyFeatures.joinBatchChoice !== false
  // Settings → Features → "Auto-Assign Batch by Age" (0162). Only meaningful
  // when batchChoice is OFF — it's what fills the gap that leaves instead of
  // the plain "academy assigns it later" fallback: match a batch by age as
  // soon as DOB is known, and show its coach right there.
  const autoAssignByAge = !batchChoice && academyFeatures.autoAssignBatchByAge === true

  const [step, setStep] = useState('login')  // login | home | branch | batch | form | pay | confirm
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
  //
  // If a reload lands here with a very recent registration already on file
  // (last 15 min), open straight on the Profile tab instead of the generic
  // sport picker — this is the recovery path for a real payment: Android can
  // kill the app's backgrounded process while the user is away in a UPI/bank/
  // 3DS app, which wipes the step draft (sessionStorage) but not the auth
  // session (localStorage), so on relaunch this effect wins the race against
  // the draft-restore effect below and used to always dump the user on plain
  // Home with no trace of what they'd just done — even though the trial (and
  // payment, if it succeeded) was already safely recorded server-side the
  // whole time.
  useEffect(() => {
    let cancelled = false
    db.getCurrentAuthPhone()
      .then(async phone => {
        if (cancelled || !phone) return
        setIsAuthed(true)
        setPhone(phone.slice(-10))
        setStep('home')
        try {
          const list = await db.fetchMyTrials(slug)
          if (cancelled) return
          setMyTrials(list)
          const newest = list[0] // secure_my_trials_v1 orders by created_at DESC
          if (newest && Date.now() - new Date(newest.createdAt).getTime() < 15 * 60 * 1000) {
            setHomeTab('profile')
          }
        } catch { /* non-fatal — worst case, lands on the normal Home tab */ }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setAuthChecked(true) })
    return () => { cancelled = true }
  }, [slug])

  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)

  const [branchRows, setBranchRows] = useState([])   // flat [{id, sportName, branchName, photoUrl}]
  const [branchesLoading, setBranchesLoading] = useState(true)
  const [chosenSport, setChosenSport] = useState('')
  const [chosenRow, setChosenRow] = useState(null)   // the {id, sportName, branchName} row carried forward

  const [batches, setBatches] = useState([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [batchId, setBatchId] = useState(null)
  // Full matched batch (not just its id) so the confirmation card can show
  // its coach without a second lookup — auto-assign mode only.
  const [autoMatchedBatch, setAutoMatchedBatch] = useState(null)

  const [myTrials, setMyTrials] = useState([])          // this phone's own registered students at this academy
  const [profileLoading, setProfileLoading] = useState(false)
  const [expandedTrialId, setExpandedTrialId] = useState(null)
  const [relationship, setRelationship] = useState('')       // one of RELATIONSHIP_OPTIONS, or free text when 'Other'
  const [relationshipCustom, setRelationshipCustom] = useState('')
  const [siblingOfId, setSiblingOfId] = useState('')

  const [form, setForm] = useState({
    name: '', parentName: '', motherName: '', emergencyContactName: '', emergencyContactPhone: '',
    // hasMedical is the explicit yes/no answer ('' until tapped). A blank
    // medicalNotes used to be ambiguous — "nothing to declare" and "didn't
    // bother filling it in" looked identical to the academy.
    dob: '', age: '', gender: '', hasMedical: '', medicalNotes: '',
    address: '', occupation: '', alternateContactPhone: '', email: '',
    preferredDays: [],   // ['Mon','Wed'] — same vocabulary as batches.days
  })
  const [invalid, setInvalid] = useState({})   // { fieldKey: true } after a failed Register tap
  const [documentFile, setDocumentFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [showGate, setShowGate] = useState(false)
  // window.open() with a data: URL — what View/Download used to fall back to
  // on native — is blocked by Chrome/WebView's top-level-navigation policy
  // for data: URLs (anti-phishing hardening since Chrome ~92), so it silently
  // did nothing there too. Rendering the receipt inline via an iframe's
  // srcDoc has no URL scheme and nothing to navigate — it can't be blocked
  // the same way, and it's the same fix pattern already proven for the /join
  // itself (no new native plugin needed).
  const [receiptHtml, setReceiptHtml] = useState(null)
  const openReceiptView = (args) => {
    if (Capacitor.isNativePlatform()) { setReceiptHtml(buildTrialReceiptHTML(args)); return }
    viewTrialReceipt(args)
  }
  // Native "Download" used to just show the same read-only iframe as View —
  // it never actually saved a file. Now it writes the receipt to the app's
  // cache dir and hands it to the OS Share sheet (same pattern as every other
  // native download in this app, see lib/nativeSave.js), so the user gets a
  // real Save-to-Files/Drive/WhatsApp option instead of a dead end.
  const openReceiptDownload = (args) => {
    if (Capacitor.isNativePlatform()) {
      saveTrialReceiptNative(args).catch(err => setError(`Could not save receipt: ${err?.message || err}`))
      return
    }
    downloadTrialReceipt(args)
  }
  const [feeMode, setFeeMode] = useState('walkin')       // 'walkin' | 'online'
  const [paymentStatus, setPaymentStatus] = useState('idle') // idle | processing | paid | failed
  const [paymentRef, setPaymentRef] = useState(null)     // razorpay_payment_id, once paid — for the receipt

  // Browse data is anon-readable (migration 0140) — fetch as soon as branding
  // resolves, before any OTP, so the Home sport grid is ready on arrival.
  useEffect(() => {
    if (brandingStatus !== 'ready') return
    let cancelled = false
    db.fetchPublicTrialBranches(slug)
      .then(rows => { if (!cancelled) setBranchRows(rows) })
      .catch(() => { /* non-fatal; Home shows an empty state */ })
      .finally(() => { if (!cancelled) setBranchesLoading(false) })
    return () => { cancelled = true }
  }, [brandingStatus, slug])

  // Re-point chosenRow at the freshly-fetched branch whenever the list loads.
  // The draft below persists chosenRow into sessionStorage and restores it
  // verbatim, so without this a registrant who started before the academy
  // changed its trial fee, kit fee or tax is quoted the OLD price — while
  // razorpay-create-trial-order, which recomputes server-side, charges the NEW
  // one. Prices must come from the server on every load, never from a snapshot.
  useEffect(() => {
    if (!chosenRow?.id || branchRows.length === 0) return
    const fresh = branchRows.find(r => r.id === chosenRow.id)
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(chosenRow)) setChosenRow(fresh)
  }, [branchRows, chosenRow])

  // In-progress registration draft — a page reload otherwise wipes the sport/
  // branch/batch already chosen and everything typed into the form, which is
  // the real complaint behind "reloading logs me out" (true even for someone
  // who never verified at all, since Skip-mode has no session to lose in the
  // first place — there was never anything to "log out" of). Independent of
  // auth entirely: keyed by slug, sessionStorage (clears when the tab
  // closes), expires after 2h so a very old abandoned draft can't resurrect
  // with mismatched branch/batch data.
  const DRAFT_KEY = `sf_join_draft_${slug}`
  const DRAFT_STEPS = ['branch', 'batch', 'form', 'pay']
  const clearDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY) } catch {} }

  // Restore once, as soon as we know the slug — before the user can see
  // anything, so there's no flash of an empty Home before jumping back in.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let draft = null
      try {
        const raw = sessionStorage.getItem(DRAFT_KEY)
        if (raw) draft = JSON.parse(raw)
      } catch { draft = null }
      if (!draft || !DRAFT_STEPS.includes(draft.step) || Date.now() - (draft.savedAt || 0) > 2 * 60 * 60 * 1000) {
        return
      }
      if (draft.chosenSport) setChosenSport(draft.chosenSport)
      if (draft.chosenRow)   setChosenRow(draft.chosenRow)
      if (draft.batchId !== undefined) setBatchId(draft.batchId)
      if (draft.form)        setForm(f => ({ ...f, ...draft.form }))
      if (draft.relationship)       setRelationship(draft.relationship)
      if (draft.relationshipCustom) setRelationshipCustom(draft.relationshipCustom)
      if (draft.siblingOfId) setSiblingOfId(draft.siblingOfId)
      if (draft.feeMode)     setFeeMode(draft.feeMode)

      // 'batch', 'form' and 'pay' need a real batches list — re-fetch it for
      // the restored branch rather than trusting a stale saved array. 'pay'
      // especially: without chosenRow the fee renders as ₹0.
      if (['batch', 'form', 'pay'].includes(draft.step) && draft.chosenRow?.id) {
        if (!cancelled) setBatchesLoading(true)
        try {
          const list = await db.fetchPublicTrialBatches(slug, draft.chosenRow.id)
          if (!cancelled) setBatches(list)
        } catch { /* non-fatal; batch step just shows empty */ }
        finally { if (!cancelled) setBatchesLoading(false) }
      }
      if (!cancelled) setStep(draft.step)
    })()
    return () => { cancelled = true }
  }, [slug])

  // Save on every relevant change, but only while there's genuinely
  // something worth not losing (branch/batch/form steps).
  useEffect(() => {
    if (!DRAFT_STEPS.includes(step)) return
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(), step, chosenSport, chosenRow, batchId,
        form, relationship, relationshipCustom, siblingOfId, feeMode,
      }))
    } catch {}
  }, [slug, step, chosenSport, chosenRow, batchId, form, relationship, relationshipCustom, siblingOfId, feeMode])

  // The flags arrive a tick after mount, so a restored draft (or a very fast
  // tap) can land on the batch step before we know it's turned off — bounce
  // it forward to the form instead of showing a screen that shouldn't exist.
  useEffect(() => {
    if (!batchChoice && step === 'batch') { setBatchId(null); setStep('form') }
  }, [batchChoice, step])

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

  // TESTING ONLY — bypass SMS. Mirrors ParentLogin devSkipOtp / trialTestLogin.
  // thenSubmit distinguishes the submit-time gate (verify, then post the trial)
  // from the login screen (verify, then land on Home).
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

  // Ends the Supabase session AND wipes every identity-derived bit of state.
  // Both halves are required: the mount effect above restores the session from
  // localStorage, so clearing state alone logs you back in on reload — and
  // signing out alone leaves the previous person's registrations on screen.
  const logout = async () => {
    setLoading(true); setError('')
    try {
      await db.signOutTrial()
      setIsAuthed(false)
      setPhone(''); setOtp(''); setOtpSent(false)
      setMyTrials([]); setExpandedTrialId(null)
      setHomeTab('home'); setStep('login')
    } catch (err) {
      setError(err?.message || 'Could not log out')
    } finally { setLoading(false) }
  }

  // ── navigation ───────────────────────────────────────────────
  // Resets everything EXCEPT isAuthed and the household-level fields
  // (parent/mother name, address, occupation, alternate contact, email,
  // emergency contact) — one verified phone number can register several
  // students (siblings) back to back without repeating OTP or retyping the
  // same household's info. Only the STUDENT-specific fields clear, so the
  // next child's form doesn't start pre-filled with the previous child's
  // name/DOB/gender/medical notes/document.
  function goHome() {
    setStep('home'); setHomeTab('home'); setChosenSport(''); setChosenRow(null)
    setOtpSent(false); setOtp(''); setError('')
    setBatches([]); setBatchId(null)
    setForm(f => ({ ...f, name: '', dob: '', age: '', gender: '', hasMedical: '', medicalNotes: '', preferredDays: [] }))
    setInvalid({})
    setDocumentFile(null); setResult(null)
    setFeeMode('walkin'); setPaymentStatus('idle')
    setRelationship(''); setRelationshipCustom(''); setSiblingOfId('')
  }
  const chooseSport = (name) => { setError(''); setChosenSport(name); setStep('branch') }

  async function chooseBranch(row) {
    setChosenRow(row); setError('')
    // Batch step disabled and no auto-assign → skip the fetch entirely and
    // let the academy assign one, exactly as batchId = null already meant.
    if (!batchChoice && !autoAssignByAge) { setBatches([]); setBatchId(null); setStep('form'); return }
    setLoading(true); setBatchesLoading(true)
    try {
      const list = await db.fetchPublicTrialBatches(slug, row.id)
      setBatches(list); setBatchId(null)
      // Auto-assign still needs the list (to match by age once DOB is known)
      // but never shows the picker screen itself — straight to the form,
      // same as the disabled-with-no-auto-assign path above.
      setStep(batchChoice ? 'batch' : 'form')
    } catch (err) {
      setError(err?.message || 'Could not load batches')
    } finally { setLoading(false); setBatchesLoading(false) }
  }

  // Android hardware/gesture back button. This whole funnel is one route
  // (/join) with its own internal step state, not a stack of router pages —
  // App.jsx's global back handler explicitly steps aside for this route (see
  // useAndroidBackButton there) so this is the ONLY handler acting on a back
  // press anywhere in here. Without this, back had nothing to navigate to
  // and fell through to closing the whole app — the exact bug reported.
  // Mirrors each screen's own TopBar onBack target exactly; 'login' and
  // 'home' are the funnel's true entry points, same treatment as every other
  // role's real dashboard route in App.jsx's BACK_EXIT_PATHS.
  const stepRef = useRef(step); stepRef.current = step
  const showGateRef = useRef(showGate); showGateRef.current = showGate
  const receiptHtmlRef = useRef(receiptHtml); receiptHtmlRef.current = receiptHtml
  const batchChoiceRef = useRef(batchChoice); batchChoiceRef.current = batchChoice
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (receiptHtmlRef.current) { setReceiptHtml(null); return }
      if (showGateRef.current) { setShowGate(false); setError(''); return }
      switch (stepRef.current) {
        case 'login':
        case 'home':    CapacitorApp.exitApp(); break
        case 'branch':  goHome(); break
        case 'batch':   setStep('branch'); break
        case 'form':    setStep(batchChoiceRef.current ? 'batch' : 'branch'); break
        case 'pay':     setStep('form'); break
        case 'confirm': goHome(); break
        default:        CapacitorApp.exitApp()
      }
    })
    return () => { listenerPromise.then(l => l.remove()) }
  }, [])

  // Re-match live as DOB changes. No match (age doesn't fit anything, or the
  // list hasn't loaded yet) just falls through to exactly today's behaviour
  // — batchId stays null, Preferred Days still collects a hint for staff.
  useEffect(() => {
    if (!autoAssignByAge) { setAutoMatchedBatch(null); return }
    const match = matchBatchByAge(batches, form.age)
    setAutoMatchedBatch(match)
    setBatchId(match ? match.id : null)
  }, [autoAssignByAge, batches, form.age])

  // Typing into a flagged field clears its red state immediately — the mark
  // is feedback on the last submit attempt, not a permanent verdict.
  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }))
    setInvalid(v => (v[field] ? { ...v, [field]: false } : v))
  }

  // Answering "No" clears anything already typed or attached — otherwise
  // someone who ticks Yes, describes a condition, then changes their mind
  // leaves a stray note (and file) on a student who has nothing to declare.
  const chooseHasMedical = (value) => {
    setForm(f => ({ ...f, hasMedical: value, medicalNotes: value === 'yes' ? f.medicalNotes : '' }))
    if (value !== 'yes') setDocumentFile(null)
    setInvalid(v => (v.hasMedical || v.medicalNotes) ? { ...v, hasMedical: false, medicalNotes: false } : v)
  }

  // Stored in week order however the chips are tapped, so the academy always
  // reads "Mon, Wed, Fri" and never "Fri, Mon, Wed".
  const toggleDay = (day) => setForm(f => ({
    ...f,
    preferredDays: f.preferredDays.includes(day)
      ? f.preferredDays.filter(d => d !== day)
      : DAY_OPTIONS.filter(d => d === day || f.preferredDays.includes(d)),
  }))

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
  // Missing required fields go red in place instead of as a banner at the top
  // of a form that's taller than the screen — the old message was routinely
  // scrolled out of view, so a tap on Register just looked like nothing
  // happened. Nothing typed is ever cleared by a failed check.
  // Validation gate on the FORM page. The fee lives on its own page now, so
  // nobody reaches payment with a half-filled form — and the red-in-place
  // errors still land on the page the fields are actually on.
  const goToPayment = () => {
    setError('')
    const missing = REQUIRED_FIELDS.filter(f => !form[f.key].trim())
    // The health question is required on its own — an unanswered yes/no is
    // not the same as "no", and a Yes with no description tells staff nothing.
    if (!form.hasMedical) missing.push({ key: 'hasMedical' })
    else if (form.hasMedical === 'yes' && !form.medicalNotes.trim()) missing.push({ key: 'medicalNotes' })
    if (missing.length) {
      setInvalid(Object.fromEntries(missing.map(f => [f.key, true])))
      document.getElementById(`jf-${missing[0].key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setInvalid({})
    setStep('pay')
    window.scrollTo?.({ top: 0 })
  }

  // The pay page's CTA. Validation already passed to get here; re-running it
  // costs nothing and means a restored draft that skipped the form page can't
  // submit an incomplete registration.
  const startSubmit = () => {
    setError('')
    const missing = REQUIRED_FIELDS.filter(f => !form[f.key].trim())
    if (!form.hasMedical) missing.push({ key: 'hasMedical' })
    else if (form.hasMedical === 'yes' && !form.medicalNotes.trim()) missing.push({ key: 'medicalNotes' })
    if (missing.length) {
      setInvalid(Object.fromEntries(missing.map(f => [f.key, true])))
      setStep('form')
      return
    }
    if (isAuthed) { doSubmit() }
    else { setOtp(''); setOtpSent(false); setShowGate(true) }
  }

  const trialFee = chosenRow?.trialFee ?? 590
  const kitFee   = chosenRow?.kitFee   ?? 0
  // Tax is per branch, per fee type (migration 0154) — this branch may tax the
  // trial fee, the kit fee, both or neither, at its own rate. Display only: the
  // amount actually charged is recomputed server-side in
  // razorpay-create-trial-order, and the two must agree.
  const fee       = computeTrialTotal(chosenRow, trialFee, kitFee)
  const totalDue  = fee.total

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
        gender: form.gender || null,
        // Now that the yes/no is required, a NULL here means "answered No"
        // rather than "skipped the question" — no separate flag column needed.
        medicalNotes: form.hasMedical === 'yes' ? (form.medicalNotes.trim() || null) : null,
        motherName: form.motherName.trim() || null,
        address: form.address.trim() || null,
        occupation: form.occupation.trim() || null,
        alternateContactPhone: form.alternateContactPhone.trim() || null,
        email: form.email.trim() || null,
        preferredDays: form.preferredDays,
        documentPath,
        // Always 'Not collected' at submission — true either way (walk-in
        // hasn't been paid yet; online hasn't succeeded yet). The verify
        // function flips this to the REAL Razorpay method (UPI/Card) only
        // once payment actually succeeds — trial_fee_mode has a DB check
        // constraint limited to Cash/UPI/Card/Not collected, no "Pending".
        trialFeeMode:   'Not collected',
        trialFeeAmount: totalDue,
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
              setPaymentRef(response.razorpay_payment_id)
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
  // Only what the owner actually filled in under Settings > Academy Profile
  // ("Shown on receipts") — never fabricated when blank.
  const academyAddress = [branding?.address, branding?.city, branding?.state].filter(Boolean).join(', ')
  // Shared by both the View and Download receipt buttons on a Profile-tab
  // trial card — one place to build the args so the two stay in sync.
  const trialReceiptArgs = (t) => ({
    academyName: displayName,
    logoUrl: branding?.logoUrl,
    academyAddress,
    academyPhone: branding?.contactPhone || '',
    academyEmail: branding?.contactEmail || '',
    academyGstin: branding?.gstin || '',
    receiptNo: t.receiptNo || `${shortCode}-${new Date(t.createdAt).getFullYear()}-${t.id}`,
    paymentRef: t.razorpayPaymentId || null,
    paidOn: t.createdAt ? new Date(t.createdAt) : new Date(),
    studentName: t.name,
    parentName: t.parentName,
    phone,
    sport: t.sport,
    branchName: t.branchName,
    batchName: t.batchName || null,
    fee: { total: t.trialFeePaid, taxAmount: t.taxAmount, taxPct: t.taxPercent },
    method: t.trialFeeMode,
    paidOnline: Boolean(t.razorpayPaymentId),
  })
  const heroFallback  = tagPhoto('sports,stadium,training', `${slug}-hero`, 800, 1400)
  const promoFallback = tagPhoto('sports,team,training', `${slug}-promo`, 900, 380)
  const sportFallback = (name, w, h) => tagPhoto(`${slugify(name)},sport`, `${slug}-${slugify(name)}`, w, h)
  const branchFallback = (row, w, h) => tagPhoto(`${slugify(row.sportName)},sport`, `${slug}-branch-${row.id}`, w, h)

  const heroSubtitle = branchRows.length > 0
    ? `${sportsView.length} sport${sportsView.length === 1 ? '' : 's'} · ${branchCount} branch${branchCount === 1 ? '' : 'es'} · One academy.`
    : 'Register in under 2 minutes.'

  return (
    <div style={{ minHeight: '100vh', background: N.page, fontFamily: FONT,
                  '--jf-accent': C.main, '--jf-accent-soft': `${C.main}2E` }}>
      <style>{JOIN_CSS}</style>
      <div style={{ margin: '0 auto', width: '100%', maxWidth: 440, minHeight: '100vh', position: 'relative', overflow: 'hidden', background: N.page }}>

        {/* ── LOGIN ─────────────────────────────────────────── */}
        {step === 'login' && (
          <div className="jf-screen" style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', background: '#0B1F12' }}>
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
              <div style={{ ...T.hero, color: '#fff' }}>
                Train with<br />{displayName}.
              </div>
              <div style={{ ...T.body, color: 'rgba(255,255,255,0.74)' }}>{heroSubtitle}</div>
            </div>

            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: `${R.sheet}px ${R.sheet}px 0 0`, padding: '22px 24px 30px', boxShadow: '0 -18px 40px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', background: '#F1F7F1', borderRadius: 16, padding: 4, gap: 4, marginBottom: 18 }}>
                {['login', 'register'].map(m => (
                  <Tappable key={m} pressed={authMode === m}
                    onClick={() => { setAuthMode(m); setOtpSent(false); setOtp(''); setError('') }}
                    style={{
                      flex: 1, textAlign: 'center', padding: '13px 0', borderRadius: R.chip, fontSize: 14.5, fontWeight: 800,
                      background: authMode === m ? '#fff' : 'transparent', color: authMode === m ? '#10462A' : '#8AA091',
                      boxShadow: authMode === m ? '0 2px 8px rgba(11,50,26,0.1)' : 'none',
                    }}>
                    {m === 'login' ? 'Login' : 'Register'}
                  </Tappable>
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
                  {OTP_SKIP && (
                    <button type="button" onClick={() => devSkip(false)} disabled={loading}
                      style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                      ⚡ Skip OTP (testing only)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, color: '#4C6455', fontWeight: 500, marginBottom: 14 }}>
                    Code sent to <b style={{ color: N.text }}>+91 {phone}</b> ·{' '}
                    <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 800, cursor: 'pointer' }}>Change</span>
                  </div>
                  <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                    style={{ border: `1.5px solid ${N.line}`, outline: 'none', fontSize: 24, fontWeight: 700, letterSpacing: 14, color: N.text, background: N.input, borderRadius: 16, padding: '15px 16px', fontFamily: FONT, textAlign: 'center', width: '100%', boxSizing: 'border-box', marginBottom: 16 }} />
                  <Cta onClick={verifyCode} loading={loading} C={C}>Verify &amp; Continue</Cta>
                </>
              )}

              <Tappable onClick={skipLogin}
                style={{ textAlign: 'center', ...T.strong, color: N.muted, padding: '16px 0 4px', borderRadius: R.chip }}>
                Skip for now →
              </Tappable>
            </div>
          </div>
        )}

        {/* ── HOME ──────────────────────────────────────────── */}
        {step === 'home' && (
          <div className="jf-screen" style={{ minHeight: '100vh', position: 'relative' }}>
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
                      <div style={{ ...T.eyebrow, color: 'rgba(255,255,255,0.72)' }}>{greetingWord()}</div>
                      <div style={{ ...T.h3, color: '#fff', marginTop: 2 }}>{displayName}</div>
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
                    <div style={{ position: 'relative', borderRadius: R.tile, overflow: 'hidden', boxShadow: E.lifted, height: 140 }}>
                      <Photo fallback={promoFallback} C={C} alt="Promotion" />
                      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(6,24,13,0.82) 8%, rgba(6,24,13,0.15) 78%)', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, pointerEvents: 'none' }}>
                        <div style={{ display: 'inline-flex', alignSelf: 'flex-start', background: LIME, color: LIME_TEXT, ...T.eyebrow, borderRadius: R.pill, padding: '4px 10px' }}>ADMISSIONS OPEN</div>
                        <div style={{ ...T.h2, color: '#fff', lineHeight: 1.15 }}>Book your<br />free trial</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '16px 22px 12px' }}>
                    <div style={{ ...T.h2, color: N.text }}>Our Sports</div>
                    <div style={{ ...T.label, ...NUM, fontWeight: 700, color: C.main }}>
                      {sportsView.length} program{sportsView.length === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div className="jf-stagger" style={{ padding: '0 22px 120px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {branchesLoading && branchRows.length === 0 &&
                      [0, 1, 2].map(i => <Skeleton key={i} height={148} radius={R.sheet} />)}

                    {!branchesLoading && filteredSportsView.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '34px 10px' }}>
                        <div style={{ ...T.h3, color: N.text, marginBottom: 6 }}>
                          {sportsView.length === 0 ? 'No sports listed yet' : `Nothing matches "${homeSearch.trim()}"`}
                        </div>
                        <div style={{ ...T.body, color: N.muted }}>
                          {sportsView.length === 0
                            ? 'The academy is still setting up its programs — check back shortly.'
                            : 'Try a different sport or branch name.'}
                        </div>
                        {sportsView.length > 0 && (
                          <Tappable onClick={() => setHomeSearch('')}
                            style={{ display: 'inline-block', marginTop: 14, ...T.strong, color: C.dark, background: C.tint, padding: '9px 16px', borderRadius: R.pill }}>
                            Clear search
                          </Tappable>
                        )}
                      </div>
                    )}

                    {filteredSportsView.map((sp, i) => (
                      <Tappable key={sp.name} onClick={() => chooseSport(sp.name)} label={`${sp.name}, ${sp.count} location${sp.count === 1 ? '' : 's'}`}
                        style={{ position: 'relative', width: '100%', height: 148, borderRadius: R.sheet, overflow: 'hidden', boxShadow: E.lifted, animationDelay: `${Math.min(i, 6) * 55}ms` }}>
                        <Photo src={sp.photo} fallback={sportFallback(sp.name, 700, 420)} radius={R.sheet} C={C} alt={sp.name} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,24,13,0.05) 30%, rgba(6,24,13,0.85) 100%)', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', top: 14, right: 14, background: 'rgba(255,255,255,0.92)', color: '#10462A', ...T.eyebrow, ...NUM, letterSpacing: 0.4, borderRadius: R.pill, padding: '5px 10px', pointerEvents: 'none' }}>
                          {sp.count} location{sp.count === 1 ? '' : 's'}
                        </div>
                        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 14, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', pointerEvents: 'none' }}>
                          <div style={{ ...T.h1, fontSize: 21, color: '#fff' }}>{sp.name}</div>
                          <div style={{ width: 34, height: 34, borderRadius: R.pill, background: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ArrowRight size={15} color={LIME_TEXT} />
                          </div>
                        </div>
                      </Tappable>
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
                      {OTP_SKIP && (
                        <button type="button" onClick={profileDevSkip} disabled={loading}
                          style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                          ⚡ Skip OTP (testing only)
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13.5, color: N.text, marginBottom: 12 }}>
                        OTP sent to <b>+91 {phone}</b>.{' '}
                        <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                      </div>
                      <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
                    <div style={{ fontSize: 12.5, color: N.muted }}>+91 {phone}</div>
                    <Tappable onClick={logout} label="Log out"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: R.pill, border: `1px solid ${N.line}`, background: '#fff', flexShrink: 0 }}>
                      <LogOut size={13} color={N.muted} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: N.muted }}>Log out</span>
                    </Tappable>
                  </div>
                  {profileLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[0, 1].map(i => <Skeleton key={i} height={104} />)}
                    </div>
                  ) : myTrials.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                      <div style={{ ...T.h3, color: N.text, marginBottom: 6 }}>Nothing registered yet</div>
                      <div style={{ ...T.body, color: N.muted }}>Register a student and it will show up here with its status.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {myTrials.map(t => {
                        const expanded = expandedTrialId === t.id
                        return (
                          <div key={t.id} style={{ background: '#fff', borderRadius: R.card, padding: 14, boxShadow: E.rest }}>
                            <Tappable onClick={() => setExpandedTrialId(expanded ? null : t.id)}
                              label={`${t.name} — ${expanded ? 'hide' : 'show'} details`}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <div>
                                <div style={{ ...T.h3, fontSize: 15, color: N.text }}>{t.name}</div>
                                <div style={{ ...T.micro, color: N.muted, marginTop: 2 }}>{t.sport}{t.branchName ? ` · ${t.branchName}` : ''}</div>
                                {t.relationship && <div style={{ ...T.micro, color: C.main, fontWeight: 700, marginTop: 4 }}>{t.relationship}</div>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{
                                  ...T.eyebrow, letterSpacing: 0.3, padding: '5px 9px', borderRadius: R.pill, whiteSpace: 'nowrap',
                                  background: STAGE_STRONG.has(t.stage) ? C.main : C.tint,
                                  color:      STAGE_STRONG.has(t.stage) ? '#fff' : C.dark,
                                }}>
                                  {STAGE_LABEL[t.stage] || t.stage}
                                </span>
                                <ChevronDown size={16} color={N.faint} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }} />
                              </div>
                            </Tappable>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${N.line}` }}>
                              <span style={{ ...T.micro, color: N.muted }}>Trial fee</span>
                              <span style={{ ...T.micro, ...NUM, fontWeight: 700, color: t.trialFeeMode === 'Not collected' ? '#B45309' : C.main }}>
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

                                {t.trialFeeMode !== 'Not collected' && (
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <Tappable
                                      onClick={() => openReceiptView(trialReceiptArgs(t))}
                                      label="View receipt"
                                      style={{
                                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                        background: '#fff', border: `1.5px solid ${N.line}`, borderRadius: 10,
                                        padding: '10px 0', fontSize: 12.5, fontWeight: 800, color: N.text,
                                      }}>
                                      <Eye size={14} color={C.main} /> View
                                    </Tappable>
                                    <Tappable
                                      onClick={() => openReceiptDownload(trialReceiptArgs(t))}
                                      label="Download receipt"
                                      style={{
                                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                        background: '#fff', border: `1.5px solid ${N.line}`, borderRadius: 10,
                                        padding: '10px 0', fontSize: 12.5, fontWeight: 800, color: N.text,
                                      }}>
                                      <Download size={14} color={C.main} /> Download
                                    </Tappable>
                                  </div>
                                )}

                                {/* Converted — a real student account exists */}
                                {t.stage === 'converted' && academyFeatures.studentCodeLogin && (
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
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* View/Download receipt buttons above had no error display
                      on this screen either — a failed native save was invisible. */}
                  <ErrorBox msg={error} />
                  <div style={{ marginTop: 20 }}>
                    <Cta onClick={() => setHomeTab('home')} C={C}>+ Add New Student</Cta>
                  </div>
                </div>
              )}
            </div>

            {/* Floating glass bottom nav — home screen only. Fixed (not
                absolute) so it stays pinned to the viewport while the
                content behind it scrolls, instead of sitting once at the
                very bottom of the full page height. */}
            <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 18, zIndex: 20,
              background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(16px) saturate(180%)', WebkitBackdropFilter: 'blur(16px) saturate(180%)',
              borderRadius: 999, boxShadow: '0 12px 28px rgba(11,50,26,0.22)', display: 'flex', gap: 2, padding: 6, border: '1px solid rgba(255,255,255,0.7)' }}>
              {[
                { key: 'home', label: 'Home', Icon: HomeIcon },
                { key: 'batches', label: 'Batches', Icon: CalendarDays },
                { key: 'profile', label: 'Profile', Icon: User },
              ].map(({ key, label, Icon }) => {
                const active = homeTab === key
                return (
                  <Tappable key={key} onClick={() => setHomeTab(key)} label={label}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, padding: active ? '10px 16px' : '10px 14px', borderRadius: R.pill, background: active ? C.main : 'transparent' }}>
                    <Icon size={active ? 15 : 17} color={active ? '#fff' : N.faint} />
                    {active && <div style={{ ...T.label, fontWeight: 800, color: '#fff' }}>{label}</div>}
                  </Tappable>
                )
              })}
            </div>
          </div>
        )}

        {/* ── BRANCH ────────────────────────────────────────── */}
        {step === 'branch' && (
          <div className="jf-screen" style={{ minHeight: '100vh' }}>
            <div style={{ position: 'relative', height: 210 }}>
              <Photo fallback={sportFallback(chosenSport, 900, 500)} C={C} alt={chosenSport} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,24,13,0.6) 0%, rgba(6,24,13,0.15) 45%, rgba(6,24,13,0.88) 100%)', pointerEvents: 'none' }} />
              <Tappable onClick={goHome} label="Back to sports"
                style={{ position: 'absolute', top: 58, left: 20, width: 42, height: 42, borderRadius: R.pill, background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowLeft size={17} color="#10462A" />
              </Tappable>
              <div style={{ position: 'absolute', left: 22, right: 22, bottom: 18, pointerEvents: 'none' }}>
                <div style={{ display: 'inline-flex', background: 'rgba(201,240,77,0.95)', color: LIME_TEXT, ...T.eyebrow, borderRadius: R.pill, padding: '4px 10px' }}>SPORT</div>
                <div style={{ ...T.hero, fontSize: 27, color: '#fff', marginTop: 8 }}>{chosenSport}</div>
                <div style={{ ...T.label, ...NUM, color: 'rgba(255,255,255,0.78)', marginTop: 3 }}>
                  {branchesForSport.length} branch{branchesForSport.length === 1 ? '' : 'es'}
                </div>
              </div>
            </div>

            <div style={{ padding: '20px 22px 10px', ...T.h2, color: N.text }}>Choose a branch</div>
            <div className="jf-stagger" style={{ padding: '0 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {branchesForSport.map((row, i) => (
                <Tappable key={row.id} onClick={() => chooseBranch(row)} disabled={loading} label={`${row.branchName} — register here`}
                  style={{ background: '#fff', borderRadius: R.tile, padding: 14, boxShadow: E.raised, opacity: loading ? 0.6 : 1, animationDelay: `${Math.min(i, 6) * 55}ms` }}>
                  <div style={{ display: 'flex', gap: 14 }}>
                    <div style={{ width: 88, height: 88, flexShrink: 0 }}>
                      <Photo src={row.photoUrl} fallback={branchFallback(row, 320, 320)} radius={R.card} C={C} alt={row.branchName} />
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                      <div style={{ ...T.h3, color: N.text }}>{row.branchName}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={12} color={N.faint} style={{ flexShrink: 0 }} />
                        <span style={{ ...T.label, color: '#5E7566' }}>{row.address || chosenSport}</span>
                      </div>
                      {/* Card used to end here — a photo-height block of empty
                          space below the address with nothing to compare
                          branches on. batchCount (0164) was already fetched
                          for this screen too; this is what fills it. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarDays size={12} color={N.faint} style={{ flexShrink: 0 }} />
                        <span style={{ ...T.label, ...NUM, color: '#5E7566' }}>
                          {row.batchCount > 0 ? `${row.batchCount} batch${row.batchCount === 1 ? '' : 'es'} open` : 'Batches opening soon'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderTop: `1px solid ${N.line}`, marginTop: 12, paddingTop: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.main, fontSize: 13, fontWeight: 800 }}>
                      {loading ? 'Opening…' : 'Register'} <ArrowRight size={13} />
                    </div>
                  </div>
                </Tappable>
              ))}
              {branchesForSport.length === 0 && (
                <div style={{ textAlign: 'center', padding: '26px 10px' }}>
                  <div style={{ ...T.h3, color: N.text, marginBottom: 6 }}>No branches for {chosenSport} yet</div>
                  <div style={{ ...T.body, color: N.muted }}>Pick another sport, or contact the academy to ask when this one opens.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── BATCH ─────────────────────────────────────────── */}
        {step === 'batch' && (
          <div className="jf-screen" style={{ minHeight: '100vh' }}>
            <TopBar title="Choose a Batch" onBack={() => setStep('branch')} C={C}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.tint, color: C.dark, borderRadius: R.chip, padding: '7px 12px', ...T.label, fontWeight: 700, marginTop: 12 }}>
                {chosenSport} • {chosenRow?.branchName}
              </div>
            </TopBar>
            <div className="jf-stagger" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {batches.map((b, i) => {
                const seatsLeft = Math.max(0, b.seatsLeft)
                const open = seatsLeft > 0
                // A fill meter under every card said the same thing the pill
                // already said, just slower to read. The pill carries the
                // real signal instead: same amber Waitlist already uses,
                // one notch early — a handful of seats left is the same
                // "don't wait" cue as none, just not there yet. Threshold
                // scales with capacity (typically 15–30) rather than a flat
                // count, so it still means something on a small batch.
                const low = open && b.capacity && seatsLeft <= Math.max(2, Math.round(b.capacity * 0.15))
                const warm = !open || low
                // Code is the short, unique label batches are now required
                // to carry (0160) — same one Add Student's batch picker
                // shows internally. Falls back to the full name only for a
                // batch that somehow still has none.
                const label = capFirst(b.code || b.name)
                return (
                  <Tappable key={b.id} onClick={() => { setBatchId(b.id); setStep('form') }}
                    label={`${label}, ${open ? `${seatsLeft} seats left` : 'waitlist'}`}
                    style={{ background: '#fff', borderRadius: R.card, padding: '14px 16px', boxShadow: E.rest, animationDelay: `${Math.min(i, 6) * 45}ms` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...T.h3, fontSize: 15, color: N.text }}>{label}</div>
                        {/* Days dropped — a code like u15-tts already spells out
                            Tue/Thu/Sat, so the day list was just repeating it. */}
                        {b.startTime && (
                          <div style={{ ...T.label, ...NUM, color: N.faint, marginTop: 3 }}>
                            {b.startTime}–{b.endTime}
                          </div>
                        )}
                      </div>
                      <span style={{ ...T.eyebrow, ...NUM, letterSpacing: 0.3, padding: '6px 10px', borderRadius: R.pill, flexShrink: 0, whiteSpace: 'nowrap',
                        background: warm ? '#FEF3C7' : C.tint, color: warm ? '#92400E' : C.dark }}>
                        {open ? `${seatsLeft} seats left` : 'Waitlist'}
                      </span>
                    </div>
                  </Tappable>
                )
              })}
              {batchesLoading && batches.length === 0 &&
                [0, 1, 2].map(i => <Skeleton key={i} height={74} />)}
              {!batchesLoading && batches.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 10px' }}>
                  <div style={{ ...T.h3, color: N.text, marginBottom: 6 }}>No batches listed yet</div>
                  <div style={{ ...T.body, color: N.muted }}>Carry on with your registration — the academy will place you in one.</div>
                </div>
              )}
              <Tappable onClick={() => { setBatchId(null); setStep('form') }}
                style={{ textAlign: 'center', ...T.strong, fontSize: 13, color: N.muted, padding: '12px 0', marginTop: 2, borderRadius: R.chip, textDecoration: 'underline' }}>
                Not sure yet — let the academy pick
              </Tappable>
            </div>
          </div>
        )}

        {/* ── FORM ──────────────────────────────────────────── */}
        {step === 'form' && (
          <div className="jf-screen" style={{ minHeight: '100vh', position: 'relative' }}>
            <div style={{ minHeight: '100vh', overflowY: 'auto', paddingBottom: 116 }}>
              <TopBar title="Student Registration" subtitle={`${chosenSport} · ${chosenRow?.branchName}`} onBack={() => setStep(batchChoice ? 'batch' : 'branch')} C={C} />

              <div style={{ padding: '18px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <DevFillButton onFill={handleDevFill} />
                </div>
                <ErrorBox msg={error} />

                <SectionCard index="01" title="STUDENT DETAILS" C={C}>
                  <LabeledInput id="jf-name" label="Full Name" placeholder="e.g. Rahul Sharma" value={form.name}
                    onChange={e => set('name', e.target.value)} invalid={invalid.name} />
                  <div style={{ display: 'flex', gap: 12 }}>
                    <LabeledInput type="date" label="Date of Birth" value={form.dob}
                      onChange={e => { const dob = e.target.value; setForm(f => ({ ...f, dob, age: ageFromDob(dob) })) }}
                      style={{ flex: 1 }} />
                    {/* Age is derived, never typed — the date picker is the only
                        input, so DOB and age can't disagree with each other. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 84, flexShrink: 0 }}>
                      <span style={fieldLabelStyle}>Age</span>
                      <div title="Calculated from date of birth"
                        style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 color: form.age ? N.text : N.faint }}>
                        {form.age ? `${form.age}y` : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Auto-Assign Batch by Age (0162) — only ever shows when the
                      manual "Choose a Batch" step is off and this is turned on.
                      Development only (matchBatchByAge excludes Advance) and
                      silent when nothing fits — Preferred Days below still
                      covers that case exactly as it always has. */}
                  {autoAssignByAge && autoMatchedBatch && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px',
                                  background: '#fff', borderRadius: R.control, border: `1.5px solid ${C.main}3D`,
                                  boxShadow: E.raised }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {autoMatchedBatch.coachPhotoUrl ? (
                          <img src={autoMatchedBatch.coachPhotoUrl} alt={autoMatchedBatch.coach || ''}
                            style={{ width: 44, height: 44, borderRadius: R.pill, objectFit: 'cover',
                                     border: `2px solid ${C.main}` }} />
                        ) : (
                          <div style={{ width: 44, height: 44, borderRadius: R.pill, display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        background: `linear-gradient(135deg, ${C.main}, ${C.dark})`,
                                        color: '#fff', fontWeight: 800, fontSize: 16 }}>
                            {(autoMatchedBatch.coach || 'C').trim().charAt(0).toUpperCase()}
                          </div>
                        )}
                        {/* Small confirmed badge rather than a solid tint fill —
                            the "match found" signal lives on the photo, not on a
                            pastel box around the whole row. */}
                        <div style={{ position: 'absolute', bottom: -2, right: -2, width: 17, height: 17,
                                      borderRadius: R.pill, background: C.main, border: '2px solid #fff',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={9} color="#fff" strokeWidth={3.5} />
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...T.eyebrow, color: C.main, marginBottom: 2 }}>Your Coach</div>
                        <div style={{ ...T.strong, fontSize: 15, color: N.text }}>
                          {autoMatchedBatch.coach || "You're placed!"}
                        </div>
                        <div style={{ ...T.micro, ...NUM, color: N.muted, marginTop: 1 }}>
                          {capFirst(autoMatchedBatch.code || autoMatchedBatch.name)}
                          {autoMatchedBatch.startTime ? ` · ${autoMatchedBatch.startTime}–${autoMatchedBatch.endTime}` : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label htmlFor="jf-gender" style={fieldLabelStyle}>Gender</label>
                    <select id="jf-gender" className="jf-field" value={form.gender} onChange={e => set('gender', e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer', color: form.gender ? N.text : N.faint,
                               ...(invalid.gender ? invalidStyle : {}) }}>
                      <option value="">Select…</option>
                      {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                    {invalid.gender && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B42318', paddingLeft: 2 }}>Required</span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.muted }}>Relationship to parent</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {RELATIONSHIP_OPTIONS.map(opt => (
                        <Chip key={opt} active={relationship === opt} onClick={() => setRelationship(opt)} C={C}>
                          {opt}
                        </Chip>
                      ))}
                    </div>
                    {relationship === 'Other' && (
                      <LabeledInput label="Describe the Relationship" placeholder="e.g. Grandparent, Uncle" value={relationshipCustom}
                        onChange={e => setRelationshipCustom(e.target.value)} autoFocus />
                    )}
                  </div>

                  {myTrials.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <label style={fieldLabelStyle}>Sibling Of (Optional)</label>
                      <select className="jf-field" value={siblingOfId} onChange={e => setSiblingOfId(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="">— Not linked to another registration —</option>
                        {myTrials.map(t => <option key={t.id} value={t.id}>{t.name} ({t.sport})</option>)}
                      </select>
                    </div>
                  )}
                </SectionCard>

                <SectionCard index="02" title="PREFERRED DAYS" C={C}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: N.muted }}>
                      Which days would you like to play? {batchChoice ? '(optional)' : '(helps us place you in the right batch)'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {DAY_OPTIONS.map(day => (
                        <Chip key={day} active={form.preferredDays.includes(day)} onClick={() => toggleDay(day)} C={C}
                          style={{ minWidth: 58 }}>
                          {day}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </SectionCard>

                <SectionCard index="03" title="CONTACT" C={C}>
                  <LabeledInput id="jf-parentName" label="Father's / Guardian's Name" placeholder="e.g. Rajesh Sharma" value={form.parentName}
                    onChange={e => set('parentName', e.target.value)} invalid={invalid.parentName} />
                  <LabeledInput label="Mother's Name (Optional)" placeholder="e.g. Priya Sharma" value={form.motherName} onChange={e => set('motherName', e.target.value)} />
                  <LabeledInput type="email" inputMode="email" label="Email (Optional)" placeholder="e.g. name@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
                  <LabeledInput type="tel" inputMode="tel" label="Alternate Contact Number (Optional)" placeholder="10-digit number" value={form.alternateContactPhone} onChange={e => set('alternateContactPhone', e.target.value)} />
                  <LabeledInput label="Occupation (Optional)" placeholder="e.g. Software Engineer" value={form.occupation} onChange={e => set('occupation', e.target.value)} />
                  <LabeledInput label="Address (Optional)" placeholder="House / street, area, city" value={form.address} onChange={e => set('address', e.target.value)} />
                  <LabeledInput id="jf-emergencyContactName" label="Emergency Contact Name" placeholder="e.g. Priya Sharma" value={form.emergencyContactName}
                    onChange={e => set('emergencyContactName', e.target.value)} invalid={invalid.emergencyContactName} />
                  <LabeledInput id="jf-emergencyContactPhone" type="tel" inputMode="tel" label="Emergency Contact Number" placeholder="10-digit number" value={form.emergencyContactPhone}
                    onChange={e => set('emergencyContactPhone', e.target.value)} invalid={invalid.emergencyContactPhone} />
                </SectionCard>

                {/* Yes/No first, details only behind Yes — a free-text box on
                    its own was routinely left blank by people who DID have
                    something to declare, and blank read as "nothing". */}
                <SectionCard index="04" title="HEALTH" C={C}>
                  <div id="jf-hasMedical" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: invalid.hasMedical ? '#B42318' : N.muted }}>
                      Any medical condition or allergy?
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {MEDICAL_OPTIONS.map(opt => (
                        <Chip key={opt.value} active={form.hasMedical === opt.value}
                          onClick={() => chooseHasMedical(opt.value)} C={C}
                          style={{ flex: 1, padding: '13px 10px' }}>
                          {opt.label}
                        </Chip>
                      ))}
                    </div>
                    {invalid.hasMedical && (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B42318', paddingLeft: 2 }}>Required</span>
                    )}
                  </div>

                  {form.hasMedical === 'yes' && (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <textarea id="jf-medicalNotes" className="jf-field"
                          placeholder="Describe the condition or allergy, and anything a coach should know"
                          value={form.medicalNotes} onChange={e => set('medicalNotes', e.target.value)}
                          style={{ ...inputStyle, resize: 'none', minHeight: 74, lineHeight: 1.45,
                                   ...(invalid.medicalNotes ? invalidStyle : {}) }} />
                        {invalid.medicalNotes && (
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B42318', paddingLeft: 2 }}>Required</span>
                        )}
                      </div>

                      {!documentFile ? (
                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0', fontSize: 14, fontWeight: 600, color: N.muted, border: `2px dashed ${N.line}`, borderRadius: 18, cursor: 'pointer' }}>
                          <Camera size={16} /> Upload medical document (optional)
                          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                            onChange={e => setDocumentFile(e.target.files?.[0] || null)} />
                        </label>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '13px 14px', background: N.input, border: `1.5px solid ${N.line}`, borderRadius: 14 }}>
                          <span style={{ fontSize: 14, color: N.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{documentFile.name}</span>
                          <X size={18} color={N.faint} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setDocumentFile(null)} />
                        </div>
                      )}
                    </>
                  )}
                </SectionCard>

              </div>
            </div>

            {/* Form page CTA — no amount here on purpose: the fee, and the
                choice of how to pay it, belong to the next page. */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '13px 22px 24px',
                          background: 'rgba(244,248,244,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                          borderTop: `1px solid ${N.line}` }}>
              <Cta onClick={goToPayment} C={C}>Continue</Cta>
            </div>
          </div>
        )}

        {/* ── PAY ───────────────────────────────────────────── */}
        {step === 'pay' && (
          <div className="jf-screen" style={{ minHeight: '100vh', position: 'relative' }}>
            <div style={{ minHeight: '100vh', overflowY: 'auto', paddingBottom: 116 }}>
              <TopBar title="Payment" subtitle={`${chosenSport} · ${chosenRow?.branchName}`} onBack={() => setStep('form')} C={C} />

              <div style={{ padding: '18px 22px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <ErrorBox msg={error} />

                {/* What is being paid for — the form is a page back now, so the
                    name and batch have to be visible at the moment of paying. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '14px 16px',
                              background: N.input, border: `1.5px solid ${N.line}`, borderRadius: R.control }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: N.text }}>{form.name.trim() || 'Student'}</span>
                  <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>
                    {chosenSport} · {chosenRow?.branchName}
                    {batchId ? ` · ${(() => { const b = batches.find(x => x.id === batchId); return b ? capFirst(b.code || b.name) : '' })()}` : ''}
                  </span>
                </div>

                {/* Still 05: the form's sections are 01–04 and this is the same
                    registration, just on its own page. Restarting at 01 would
                    read as a new form. */}
                <SectionCard index="05" title="TRIAL FEE" C={C}>
                  {/* Itemise as soon as there is more than one number to add up —
                      a kit fee, a tax row, or both. A bare "Amount due" that
                      doesn't match the advertised trial fee reads as a mistake. */}
                  {(kitFee > 0 || fee.taxAmount > 0) && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Trial fee</span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: N.text }}>₹{trialFee.toLocaleString('en-IN')}</span>
                      </div>
                      {kitFee > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Kit fee</span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: N.text }}>₹{kitFee.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      {fee.taxAmount > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                          {/* The label names its own base when only one of the two
                              items is taxed, so this can't be misread as tax on
                              the whole subtotal. */}
                          <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>
                            {taxRowLabel(fee.taxPct, fee.taxedLabel)}
                          </span>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: N.text }}>₹{fee.taxAmount.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      <div style={{ height: 1, background: N.line, margin: '2px 0' }} />
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, color: N.muted, fontWeight: 600 }}>Amount due</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: N.text }}>₹{totalDue.toLocaleString('en-IN')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { key: 'walkin', label: 'Pay at the academy' },
                      { key: 'online', label: 'Pay online now' },
                    ].map(opt => (
                      <Chip key={opt.key} active={feeMode === opt.key} onClick={() => setFeeMode(opt.key)} C={C}
                        style={{ flex: 1, padding: '14px 10px', borderRadius: R.control, fontSize: 13 }}>
                        {opt.label}
                      </Chip>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: N.muted, lineHeight: 1.4 }}>
                    {feeMode === 'walkin'
                      ? "You'll pay this in cash when you visit the academy."
                      : "You'll pay securely online right after submitting — UPI, cards & netbanking."}
                  </div>
                </SectionCard>
              </div>
            </div>

            {/* A checkout bar, not a floating button: the total sits with the
                CTA so what you're agreeing to is on screen at the moment you
                tap, even once the card scrolls past. */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '13px 22px 24px',
                          background: 'rgba(244,248,244,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
                          borderTop: `1px solid ${N.line}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ ...T.micro, color: N.muted }}>
                  Amount due · {feeMode === 'online' ? 'paying online' : 'pay at the academy'}
                </span>
                <span style={{ ...T.h3, ...NUM, color: N.text }}>₹{totalDue.toLocaleString('en-IN')}</span>
              </div>
              <Cta onClick={startSubmit} loading={submitting} C={C}>Submit Registration</Cta>
            </div>
          </div>
        )}

        {/* ── CONFIRM ───────────────────────────────────────── */}
        {step === 'confirm' && (
          <div className="jf-screen" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '40px 30px', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: R.pill, background: C.main, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 14px 30px ${C.main}52`, marginBottom: 10 }}>
              <CheckCircle2 size={38} color="#fff" strokeWidth={2.2} />
            </div>
            <div style={{ ...T.h1, color: N.text }}>You're in!</div>
            <div style={{ ...T.body, color: '#5E7566', lineHeight: 1.55, maxWidth: 280 }}>
              Registration received for <b style={{ color: N.text }}>{chosenSport}</b> at <b style={{ color: N.text }}>{chosenRow?.branchName}</b>. Our coach will call within 24 hours.
            </div>
            <div style={{ background: '#fff', borderRadius: R.card, padding: '16px 18px', marginTop: 20, width: '100%', boxShadow: E.raised, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...T.label, color: N.muted }}>Application ID</span>
                <span style={{ ...T.label, ...NUM, fontWeight: 800, color: N.text, letterSpacing: 0.3 }}>{shortCode}-{new Date().getFullYear()}-{result?.id ?? '—'}</span>
              </div>
              {batchChoice && (
                <>
                  <div style={{ height: 1, background: N.line }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, color: N.muted, fontWeight: 600 }}>Batch</span>
                    <span style={{ fontSize: 12.5, color: N.text, fontWeight: 800 }}>
                      {batchId
                        ? (() => { const b = batches.find(x => x.id === batchId); return b ? capFirst(b.code || b.name) : '—' })()
                        : 'To be assigned'}
                    </span>
                  </div>
                </>
              )}
              <div style={{ height: 1, background: N.line }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...T.label, color: N.muted }}>{kitFee > 0 ? 'Trial + kit fee' : 'Trial fee'}</span>
                <span style={{ ...T.label, ...NUM, fontWeight: 800, color: paymentStatus === 'paid' ? C.main : paymentStatus === 'failed' ? '#B45309' : N.text }}>
                  {feeMode === 'online'
                    ? (paymentStatus === 'paid' ? `₹${totalDue.toLocaleString('en-IN')} paid online ✓`
                       : paymentStatus === 'failed' ? `₹${totalDue.toLocaleString('en-IN')} — pay at academy`
                       : `₹${totalDue.toLocaleString('en-IN')}`)
                    : `₹${totalDue.toLocaleString('en-IN')} — pay at academy`}
                </span>
              </div>
            </div>
            {feeMode === 'online' && paymentStatus === 'failed' && (
              <>
                <div style={{ fontSize: 12.5, color: '#B45309', fontWeight: 500, marginTop: 10, maxWidth: 280 }}>
                  Online payment didn't go through. You can try again, or pay ₹{totalDue.toLocaleString('en-IN')} in cash at the academy instead — your registration is already saved either way.
                </div>
                <Tappable onClick={() => runOnlinePayment(result.id)} label="Retry payment"
                  style={{
                    width: '100%', marginTop: 12, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 8, background: C.main, borderRadius: R.card,
                    padding: '14px 0', fontSize: 14.5, fontWeight: 800, color: '#fff',
                  }}>
                  Retry Payment
                </Tappable>
              </>
            )}
            {feeMode === 'online' && paymentStatus === 'paid' && (() => {
              const confirmReceiptArgs = {
                academyName: displayName,
                logoUrl: branding?.logoUrl,
                academyAddress,
                academyPhone: branding?.contactPhone || '',
                academyEmail: branding?.contactEmail || '',
                academyGstin: branding?.gstin || '',
                receiptNo: `${shortCode}-${new Date().getFullYear()}-${result?.id ?? ''}`,
                paymentRef,
                paidOn: new Date(),
                studentName: form.name.trim(),
                parentName: form.parentName.trim(),
                phone,
                sport: chosenSport,
                branchName: chosenRow?.branchName,
                batchName: batchId ? (batches.find(b => b.id === batchId)?.name || null) : null,
                fee,
              }
              return (
                <div style={{ width: '100%', marginTop: 20, display: 'flex', gap: 10 }}>
                  <Tappable
                    onClick={() => openReceiptView(confirmReceiptArgs)}
                    label="View receipt"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: 8, background: '#fff', border: `1.5px solid ${N.line}`,
                      borderRadius: R.card, padding: '14px 0', fontSize: 14.5, fontWeight: 800,
                      color: N.text, boxShadow: E.rest,
                    }}>
                    <Eye size={16} color={C.main} /> View
                  </Tappable>
                  <Tappable
                    onClick={() => openReceiptDownload(confirmReceiptArgs)}
                    label="Download receipt"
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', gap: 8, background: '#fff', border: `1.5px solid ${N.line}`,
                      borderRadius: R.card, padding: '14px 0', fontSize: 14.5, fontWeight: 800,
                      color: N.text, boxShadow: E.rest,
                    }}>
                    <Download size={16} color={C.main} /> Download
                  </Tappable>
                </div>
              )
            })()}
            {/* This screen had no error display at all — a failed native
                receipt save (or any other error set here) was invisible. */}
            <ErrorBox msg={error} />
            <div style={{ width: '100%', marginTop: feeMode === 'online' && paymentStatus === 'paid' ? 14 : 24 }}>
              <Cta onClick={goHome} C={C}>Register Another Student</Cta>
              <div style={{ fontSize: 12.5, color: N.muted, fontWeight: 500, marginTop: 12 }}>
                Registering a sibling? No need to verify your number again.
              </div>
            </div>
          </div>
        )}

        {/* ── RECEIPT VIEWER (native only — see openReceiptView/Download) ── */}
        {receiptHtml && (
          <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${N.line}`, flexShrink: 0 }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: N.text }}>Receipt</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Tappable
                  onClick={() => {
                    // window.print() isn't implemented by Android's bare
                    // WebView (no native PrintManager wired up), so it's a
                    // silent no-op here — same class of problem as the old
                    // Download button. Route through the same Share-sheet
                    // save used there instead of pretending print works.
                    if (Capacitor.isNativePlatform()) {
                      const blob = new Blob([receiptHtml], { type: 'text/html;charset=utf-8' })
                      saveOrShareFile(blob, 'Receipt.html').catch(err => setError(`Could not save receipt: ${err?.message || err}`))
                      return
                    }
                    try { document.getElementById('sf-receipt-frame')?.contentWindow?.print() } catch {}
                  }}
                  label={Capacitor.isNativePlatform() ? 'Save or share' : 'Print or save as PDF'}
                  style={{ padding: '8px 12px', borderRadius: 8, background: N.input, fontSize: 12.5, fontWeight: 700, color: N.text }}>
                  {Capacitor.isNativePlatform() ? 'Save / Share' : 'Print / Save PDF'}
                </Tappable>
                <Tappable onClick={() => setReceiptHtml(null)} label="Close"
                  style={{ padding: 8, borderRadius: 8, background: N.input, display: 'flex', alignItems: 'center' }}>
                  <X size={16} color={N.text} />
                </Tappable>
              </div>
            </div>
            <iframe id="sf-receipt-frame" srcDoc={receiptHtml} title="Receipt" style={{ flex: 1, border: 'none', width: '100%' }} />
          </div>
        )}

        {/* ── OTP GATE (submit-time verification for the skip path) ── */}
        {showGate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(6,26,13,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
            onClick={() => { if (!loading) { setShowGate(false); setError('') } }}>
            <div onClick={e => e.stopPropagation()}
              className="jf-screen"
              style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: `${R.sheet}px ${R.sheet}px 0 0`, padding: '22px 24px 30px', boxSizing: 'border-box' }}>
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
                  {OTP_SKIP && (
                    <button type="button" onClick={() => devSkip(true)} disabled={loading}
                      style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, cursor: 'pointer', fontFamily: FONT }}>
                      ⚡ Skip OTP &amp; submit (testing only)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13.5, color: N.text, marginBottom: 12 }}>
                    OTP sent to <b>+91 {phone}</b>.{' '}
                    <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                  </div>
                  <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="- - - -" value={otp} autoFocus
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
