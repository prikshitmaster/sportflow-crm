import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import {
  Phone, ArrowLeft, MapPin, Trophy, Camera, X, User,
  Home as HomeIcon, CalendarDays, Search, Bell, ChevronDown, ChevronRight,
  LogOut, Download, Check, Eye, Bookmark, Info, Share, Plus,
} from 'lucide-react'
import * as db from '../lib/db'
import DevFillButton from '../components/DevFillButton'
import { fillPublicRegistration } from '../lib/devFill'
import { RELATIONSHIP_OPTIONS, MEDICAL_OPTIONS, GENDER_OPTIONS } from '../lib/studentIntake'
import { computeTrialTotal, taxRowLabel } from '../lib/tax'
import { useJoinManifest, useInstallPrompt } from '../lib/joinPwa'
import { downloadTrialReceipt, viewTrialReceipt, buildTrialReceiptHTML } from '../lib/trialReceipt'

// Public, no-auth-to-browse, multi-tenant student self-registration funnel.
// Served at /join (hardcoded slug "ara" — the bare route is kept permanently
// since enroll-app/capacitor.config.ts's server.url has that exact URL baked
// into an already-built APK) and /join/:academySlug for every other academy.
//
// ── Visual system: "Academy App v2" ────────────────────────────
// Implements the Claude Design canvas file `Academy App v2.dc.html` (project
// 0abedb7b-6d74-4f38-a167-dd2b26e113fb) as the funnel's design language:
// cool-grey page, navy brand, lime accent, Schibsted Grotesk, 14px cards on
// hairline borders, near-flat elevation, and direction-aware screen
// transitions (forward / back / tab-switch each animate differently).
//
// The design ref is a mockup with invented sample data. Every slot in it that
// a real academy's database can fill IS filled from real data — sport photos,
// branch address, batch count, batch time, seats left / capacity, coach,
// training days, trial fee, completion count, reference number. The four
// slots nothing in the schema backs — walking distance to a branch, a
// facilities list ("Floodlit turf · Gym"), a "next session" time on the
// branch card, and a monthly fee — are deliberately NOT reproduced. Inventing
// availability or distance numbers for real prospective parents would be
// misleading, and that rule outranks pixel fidelity. Sport CATEGORY chips are
// kept: the Team/Racquet/Water grouping is a fact about the sports themselves
// (see SPORT_GROUPS), not a claim about this academy.
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
// The Sessions tab must show stage, not status, or it looks frozen on
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

// ── Design tokens — Academy App v2 ───────────────────────────
// Structural chrome is fixed across every academy (cool greys); only the
// brand colour is tenant-driven. Lifted verbatim from the design file so a
// value here can be diffed against the canvas rather than eyeballed.
const N = {
  text:     '#131A2B',  // headings, values
  dim:      '#5A6377',  // field labels, secondary rows
  muted:    '#8A93A5',  // captions, inactive
  faint:    '#AAB2C0',  // chevrons, hint text
  page:     '#F6F7FA',
  line:     '#E4E7EE',  // card + control borders
  hair:     '#EBEEF4',  // inner dividers, meter track
  track:    '#EEF0F5',  // segmented-control groove
  navIdle:  '#98A0B0',
  ctaOff:   '#E2E5EC',
  ctaOffTx: '#A0A8B7',
  radio:    '#C3CAD6',
  dayOff:   '#BCC4D2',
  dot:      '#D3D8E2',
}
// The accent is a fixed design token rather than derived from the academy's
// brand: it only ever appears against the dark brand or against white (the
// live dot, the success tick, valid-field ticks, the active day tint), and a
// lime derived from an arbitrary brand hex stops reading as an accent at all.
const A       = '#8FC63D'
const A_TINT  = '#F1F7E4'
const A_SOFT  = '#B9DC7C'
const DANGER      = '#C0442E'
const DANGER_TEXT = '#A6482C'
const DANGER_TINT = '#FBEFE9'

const FONT = "'Schibsted Grotesk', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

const R = { chip: 8, day: 9, control: 10, field: 11, card: 14, tile: 18, icon: 15, pill: 100 }

// v2 is a near-flat system — one resting shadow for the floating brand card,
// one for the sticky footer, and nothing else. Separation comes from the
// hairline border, not elevation.
const E = {
  brand:  '0 10px 28px rgba(21,36,73,0.26)',
  cta:    '0 6px 18px rgba(21,36,73,0.26)',
  footer: '0 -6px 20px rgba(21,36,73,0.05)',
  chip:   '0 1px 2px rgba(16,25,23,0.12)',
}

// Short, heavy at the top, tabular wherever digits line up — sport apps are
// read at a glance and half of what they show is numbers.
const T = {
  hero:    { fontSize: 26,   fontWeight: 800, letterSpacing: -0.7, lineHeight: 1.1 },
  h1:      { fontSize: 21,   fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.2 },
  h2:      { fontSize: 20,   fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.2 },
  h3:      { fontSize: 15.5, fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.25 },
  section: { fontSize: 15,   fontWeight: 700, letterSpacing: -0.1 },
  card:    { fontSize: 14.5, fontWeight: 700, letterSpacing: -0.25, lineHeight: 1.3 },
  stat:    { fontSize: 17,   fontWeight: 800 },
  body:    { fontSize: 13,   fontWeight: 500, lineHeight: 1.5 },
  sub:     { fontSize: 12.5, fontWeight: 500, lineHeight: 1.45 },
  label:   { fontSize: 12,   fontWeight: 600 },
  meta:    { fontSize: 11.5, fontWeight: 500, lineHeight: 1.4 },
  metaB:   { fontSize: 11.5, fontWeight: 600 },
  eyebrow: { fontSize: 10.5, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase' },
  badge:   { fontSize: 9.5,  fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' },
}
const NUM = { fontVariantNumeric: 'tabular-nums' }

// Injected once at the funnel root. Everything here is either a state the
// browser owns and inline styles can't reach (:active, :focus-visible,
// ::placeholder, reduced motion) or an animation — never layout, which stays
// inline next to the markup it belongs to. --jf-accent carries the academy's
// own brand colour into those states.
//
// The three screen animations are what make the funnel read as an app rather
// than a stack of pages: going deeper slides in from the right, backing out
// slides in from the left, switching tab rises. See `dir` in the nav helpers.
const JOIN_CSS = `
@keyframes jfFwd     { from { opacity:0; transform: translate3d(22px,0,0) } to { opacity:1; transform:none } }
@keyframes jfBack    { from { opacity:0; transform: translate3d(-22px,0,0) } to { opacity:1; transform:none } }
@keyframes jfTab     { from { opacity:0; transform: translate3d(0,10px,0) scale(.985) } to { opacity:1; transform:none } }
@keyframes jfStagger { from { opacity:0; transform: translate3d(0,14px,0) } to { opacity:1; transform:none } }
@keyframes jfRise    { from { opacity:0; transform: translateY(10px) } to { opacity:1; transform:none } }
@keyframes jfFooter  { from { opacity:0; transform: translate3d(0,100%,0) } to { opacity:1; transform:none } }
@keyframes jfPop     { 0% { transform: scale(.6); opacity:0 } 60% { transform: scale(1.06) } 100% { transform: scale(1); opacity:1 } }
@keyframes jfPing    { 75%,100% { transform: scale(2.2); opacity:0 } }
@keyframes jfShimmer { 0% { background-position:-180px 0 } 100% { background-position:220px 0 } }
.jf-shell { height: 100vh; height: 100dvh }
.jf-fwd  { animation: jfFwd  .36s cubic-bezier(.2,.8,.2,1) both }
.jf-back { animation: jfBack .36s cubic-bezier(.2,.8,.2,1) both }
.jf-tab  { animation: jfTab  .42s cubic-bezier(.2,.8,.2,1) both }
.jf-stagger > * { animation: jfStagger .46s cubic-bezier(.2,.8,.2,1) both }
.jf-tap { -webkit-tap-highlight-color: transparent; transition: transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-color .22s ease, background .18s ease, color .18s ease }
.jf-tap:active { transform: scale(.975) }
.jf-press:active { transform: scale(.94) }
.jf-tap:focus-visible, .jf-focus:focus-visible { outline: 2.5px solid var(--jf-accent); outline-offset: 3px }
/* !important because the fields carry their border inline, which otherwise
   wins over this rule and leaves focus showing only the outer glow. */
.jf-field:focus { border-color: var(--jf-accent) !important; box-shadow: 0 0 0 3px var(--jf-accent-soft) }
.jf-field::placeholder { color: #A0A8B7; font-weight: 400 }
.jf-skel { background: linear-gradient(90deg,#EBEEF4 0%,#F4F6FA 50%,#EBEEF4 100%); background-size: 400px 100%; animation: jfShimmer 1.4s linear infinite }
.jf-scroll { -webkit-overflow-scrolling: touch; overscroll-behavior: contain; scrollbar-width: none }
.jf-scroll::-webkit-scrollbar { width: 0; height: 0 }
.jf-row:active { background: #F6F7FA }
@media (prefers-reduced-motion: reduce) {
  .jf-fwd, .jf-back, .jf-tab, .jf-stagger > *, .jf-skel, .jf-pop, .jf-ping, .jf-footer { animation: none !important }
  .jf-tap, .jf-press { transition: none }
  .jf-tap:active, .jf-press:active { transform: none }
}
`

// Schibsted Grotesk is loaded from inside this component rather than from
// index.html on purpose: /join is deliberately isolated from the rest of the
// bundle (see App.jsx) so a prospect on mobile data doesn't pay for four role
// layouts — and shouldn't pay for a font only this route uses either. The
// system fallback stack renders text immediately while it arrives.
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700;800;900&display=swap'
function useJoinFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_HREF}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONT_HREF
    document.head.appendChild(link)
  }, [])
}

// One stored hex per academy -> {main, dark, tint}. Defaults to the design
// file's own navy so an academy that never set a brand colour gets the v2
// look exactly as drawn, rather than a stand-in green.
function deriveShades(hex) {
  const clean = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#152449'
  const r = parseInt(clean.slice(1, 3), 16)
  const g = parseInt(clean.slice(3, 5), 16)
  const b = parseInt(clean.slice(5, 7), 16)
  const hx = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')
  const toWhite = (ratio) => `#${hx(r + (255 - r) * ratio)}${hx(g + (255 - g) * ratio)}${hx(b + (255 - b) * ratio)}`
  const toBlack = (ratio) => `#${hx(r * (1 - ratio))}${hx(g * (1 - ratio))}${hx(b * (1 - ratio))}`
  const toMid   = (ratio) => `#${hx(r + (255 - r) * ratio)}${hx(g + (255 - g) * ratio)}${hx(b + (255 - b) * ratio)}`
  return { main: clean, dark: toBlack(0.3), deep: toBlack(0.45), lift: toMid(0.12), tint: toWhite(0.9) }
}

// The design's category chips. This is a taxonomy of the sports themselves —
// tennis IS a racquet sport regardless of who teaches it — so unlike distance
// or facilities it can be stated without inventing anything about a specific
// academy. Keyed against SPORT_CATALOG (lib/sportCatalog.js); a sport outside
// the catalog simply has no group and only ever appears under "All".
const SPORT_GROUPS = {
  football: 'Team', cricket: 'Team', basketball: 'Team', volleyball: 'Team', hockey: 'Team',
  tennis: 'Racquet', squash: 'Racquet', 'table tennis': 'Racquet', badminton: 'Racquet',
  swimming: 'Water',
}
const CATEGORY_ORDER = ['Team', 'Racquet', 'Water']
const sportGroup = (name) => SPORT_GROUPS[String(name || '').toLowerCase().trim()] || null

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
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
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
// brand-coloured focus ring, in one place. `press="chip"` swaps the card-sized
// 0.975 scale for the tighter 0.94 the design uses on chips and icon buttons.
function Tappable({ onClick, children, style, disabled, label, pressed, press, className, as: Tag = 'div' }) {
  return (
    <Tag
      className={[press === 'chip' ? 'jf-tap jf-press' : 'jf-tap', className].filter(Boolean).join(' ')}
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

// Relationship, preferred days, category and fee mode were four hand-rolled
// copies of the same selected/unselected chip, already drifting apart in
// padding and weight. One component keeps them identical and correctly
// announced. v2's chip is a 30–34px rounded rectangle, not a pill.
function Chip({ active, onClick, children, C, style, height = 34 }) {
  return (
    <Tappable onClick={onClick} pressed={active} press="chip"
      style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 13px', borderRadius: R.chip, ...T.label, fontWeight: 600,
        whiteSpace: 'nowrap', flex: 'none',
        background: active ? C.main : '#fff',
        color:      active ? '#fff'  : N.dim,
        border: `1px solid ${active ? C.main : N.line}`,
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
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="17 40" />
    </svg>
  )
}

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div role="alert" style={{
      background: DANGER_TINT, border: `1px solid ${DANGER}33`, color: DANGER_TEXT,
      ...T.label, padding: '11px 13px', borderRadius: R.control, marginBottom: 12, lineHeight: 1.45,
    }}>
      {msg}
    </div>
  )
}

// v2's CTA: 48px, radius 12, solid brand when live and a flat grey when not —
// the disabled state is a real design state here, not a 55%-opacity version
// of the live one, so "what's missing" reads before the tap rather than after.
//
// `inactive` paints that same grey but leaves the button LIVE. It is what the
// form's CTA uses: a genuinely disabled button announces "not yet" and then
// refuses to say which field is missing, so the tap that should have scrolled
// the parent to the empty box does nothing at all. Greyed-but-tappable keeps
// the design's read and keeps the answer one tap away. `disabled` proper is
// still used where a tap really has nothing to do (in-flight submits).
function Cta({ children, onClick, loading, disabled, inactive, C, type = 'button', style }) {
  const off = loading || disabled || inactive
  return (
    <button
      type={type}
      className="jf-tap"
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: off ? N.ctaOff : C.main, color: off ? N.ctaOffTx : '#fff',
        fontSize: 14.5, fontWeight: 700, border: 'none', borderRadius: 12,
        cursor: (loading || disabled) ? 'default' : 'pointer', fontFamily: FONT,
        boxShadow: off ? 'none' : E.cta,
        ...style,
      }}
    >
      {loading ? <Spinner color={off ? N.ctaOffTx : '#fff'} /> : children}
    </button>
  )
}

// Photo with a shimmer placeholder underneath, so a slow connection sees the
// card's real shape filling in rather than a hard pop-in. `src` (real,
// owner-uploaded) always wins over `fallback` (a topically-tagged placeholder
// built by tagPhoto()); if both fail the shimmer settles into a flat neutral
// and layout never breaks.
function Photo({ src, fallback, radius = 0, alt = '' }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const url = src || fallback
  return (
    <div className={loaded || failed ? undefined : 'jf-skel'}
      style={{ position: 'relative', width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden', background: failed ? N.hair : undefined }}>
      {!failed && (
        <img src={url} alt={alt} loading="lazy"
          onError={() => setFailed(true)} onLoad={() => setLoaded(true)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                   opacity: loaded ? 1 : 0, transition: 'opacity .45s ease' }} />
      )}
    </div>
  )
}

const inputStyle = {
  border: `1px solid ${N.line}`, outline: 'none', fontSize: 14.5, fontWeight: 500, color: N.text,
  background: '#fff', borderRadius: R.control, padding: '0 12px', height: 46, width: '100%',
  boxSizing: 'border-box', fontFamily: FONT, transition: 'border-color .18s ease, box-shadow .22s ease',
}

// `invalid` paints the field itself red and captions it, so a missed required
// field is visible where the user is actually looking. Applied last so it
// always wins over a per-instance style override.
const invalidStyle = { border: `1px solid ${DANGER}`, background: '#FFF8F6' }

const fieldLabelStyle = { ...T.label, color: N.dim, marginBottom: 6, display: 'block' }

// A field with only a placeholder loses its own identity the moment someone
// types into it. `label` sits above the field and stays put; `placeholder`
// goes back to being what it's actually for, a one-line example. `tick` shows
// the design's lime check once the answer is good — quiet progress feedback
// on the long form, where the completion counter in the header is the summary
// and this is the per-field detail.
function LabeledInput({ invalid, label, tick, hint, ...props }) {
  const field = (
    <input {...props} className="jf-field"
      style={{ ...inputStyle, ...(props.style || {}), ...(invalid ? invalidStyle : {}) }} />
  )
  if (!label && !invalid && !tick) return field
  return (
    <div style={{ position: 'relative', flex: props.style?.flex }}>
      {tick !== undefined && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="2.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          style={{ position: 'absolute', right: 12, bottom: 16, opacity: tick ? 1 : 0, transition: 'opacity .18s ease', pointerEvents: 'none' }}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
      {label && <label htmlFor={props.id} style={fieldLabelStyle}>
        {label}{hint && <span style={{ color: N.faint, fontWeight: 500 }}> {hint}</span>}
      </label>}
      {field}
      {invalid && <span style={{ ...T.metaB, color: DANGER_TEXT, display: 'block', marginTop: 5 }}>Required</span>}
    </div>
  )
}

// The design's segmented control — a groove with a white raised thumb, used
// for gender. Reads as one question with N answers, where N separate chips
// read as N independent toggles.
function Segmented({ options, value, onChange, invalid }) {
  return (
    <div style={{ display: 'flex', background: N.track, borderRadius: R.control, padding: 3, gap: 3,
                  border: invalid ? `1px solid ${DANGER}` : '1px solid transparent' }}>
      {options.map(opt => {
        const on = value === opt
        return (
          <Tappable key={opt} onClick={() => onChange(opt)} pressed={on}
            style={{
              flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: R.chip, fontSize: 13, fontWeight: 600,
              background: on ? '#fff' : 'transparent', color: on ? N.text : N.dim,
              boxShadow: on ? E.chip : 'none',
            }}>
            {opt}
          </Tappable>
        )
      })}
    </div>
  )
}

// v2's screen header: a flat white bar with a square-ish back button, a title
// and a breadcrumb — no rounded sheet, no drop shadow. `right` takes the
// completion counter on the form; `progress` (0–1) draws the 2px rule under it.
function TopBar({ title, subtitle, onBack, right, progress, sticky }) {
  return (
    <div style={{
      position: sticky ? 'sticky' : undefined, top: 0, zIndex: 5,
      background: '#fff', borderBottom: `1px solid ${N.line}`, padding: progress != null ? '12px 16px 0' : '12px 16px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: progress != null ? 12 : 0 }}>
        {onBack && (
          <Tappable onClick={onBack} label="Go back" press="chip"
            style={{ width: 34, height: 34, borderRadius: R.control, border: `1px solid ${N.line}`,
                     display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ArrowLeft size={17} color={N.text} strokeWidth={2} />
          </Tappable>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...T.h3, color: N.text }}>{title}</div>
          {subtitle && (
            <div style={{ ...T.meta, color: N.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
        </div>
        {right}
      </div>
      {progress != null && (
        <div style={{ height: 2, background: N.hair, borderRadius: 2 }}>
          <div style={{ height: '100%', background: N.text, borderRadius: 2,
                        width: `${Math.round(progress * 100)}%`, transition: 'width .46s cubic-bezier(.2,.8,.2,1)' }} />
        </div>
      )}
    </div>
  )
}

// v2 groups form fields under an uppercase eyebrow with the card below it,
// rather than numbering sections inside a titled card. The eyebrow is page
// furniture; the card holds only fields.
function Section({ title, optional, children, style }) {
  return (
    <>
      <div style={{ ...T.eyebrow, color: N.muted, margin: '22px 0 10px' }}>
        {title}
        {optional && <span style={{ fontWeight: 600, color: N.faint, letterSpacing: 0.4, textTransform: 'none' }}> optional</span>}
      </div>
      <div style={{ background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, padding: 14,
                    display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
        {children}
      </div>
    </>
  )
}

// The seven-square training-day strip on a batch card. Real batches.days,
// never a sample pattern — an empty days array simply renders nothing.
const DAY_INITIALS = [['Mon', 'M'], ['Tue', 'T'], ['Wed', 'W'], ['Thu', 'T'], ['Fri', 'F'], ['Sat', 'S'], ['Sun', 'S']]
function DayStrip({ days, C }) {
  if (!days?.length) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 11 }} aria-label={`Training days: ${days.join(', ')}`}>
      {DAY_INITIALS.map(([full, ini], i) => {
        const on = days.includes(full)
        return (
          <div key={full + i} aria-hidden="true"
            style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                     fontSize: 10.5, fontWeight: on ? 700 : 600,
                     background: on ? A_TINT : 'transparent', color: on ? C.main : N.dayOff }}>
            {ini}
          </div>
        )
      })}
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

// ── Install-to-home-screen row (Academy tab) ──────────────────────────────
// Lives here rather than in components/ because every style token it needs
// (N, T, R, Tappable) is module-private to this file, and lifting the whole
// design system out is unrelated scope.
//
// Two different mechanisms, because the platforms genuinely differ: Chrome
// fires beforeinstallprompt and hands us a prompt() we can call from a real
// tap, while Safari fires nothing and exposes no install API at all — on iOS
// the only route is the user doing Share → Add to Home Screen themselves, so
// the row opens a sheet showing those steps. Renders nothing once installed,
// and nothing on a desktop browser that offers no install at all.
function InstallAppRow({ C }) {
  const { canInstall, promptInstall, isIOS, isInstalled } = useInstallPrompt()
  const [showSteps, setShowSteps] = useState(false)

  if (isInstalled) return null
  if (!canInstall && !isIOS) return null

  const steps = [
    { icon: Share, text: 'Tap the Share button in Safari’s toolbar' },
    { icon: Plus,  text: 'Choose "Add to Home Screen"' },
    { icon: Check, text: 'Tap Add — the academy appears with your other apps' },
  ]

  return (
    <>
      <Tappable className="jf-row" onClick={() => (isIOS ? setShowSteps(true) : promptInstall())}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 14, ...T.label, fontSize: 14, borderTop: `1px solid ${N.hair}` }}>
        Install app
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, ...T.metaB, color: N.muted }}>
          Add to home screen
          <Download size={15} color={C.main} />
        </span>
      </Tappable>

      {showSteps && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,26,43,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
          onClick={() => setShowSteps(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: `${R.tile}px ${R.tile}px 0 0`,
                     padding: '18px 20px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
                     animation: 'jfFooter .32s cubic-bezier(.2,.8,.2,1) both' }}>
            <div style={{ width: 36, height: 4, borderRadius: R.pill, background: N.line, margin: '0 auto 16px' }} />
            <div style={{ ...T.h3, fontSize: 17, marginBottom: 4 }}>Add to your home screen</div>
            <div style={{ ...T.sub, color: N.muted, marginBottom: 16 }}>
              Three taps, and it opens like an app — no App Store needed.
            </div>
            {steps.map(({ icon: Icon, text }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${N.hair}` : 'none' }}>
                <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: R.icon, background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={16} color={C.main} />
                </div>
                <span style={{ ...T.body, color: N.dim }}>{text}</span>
              </div>
            ))}
            <Cta onClick={() => setShowSteps(false)} C={C}>Got it</Cta>
          </div>
        </div>
      )}
    </>
  )
}

export default function TrialEnroll({ academySlug: slugProp }) {
  const { academySlug: slugParam } = useParams()
  const slug = slugProp || slugParam
  useJoinFont()
  // Repoint the document at /join.webmanifest for as long as the funnel is
  // mounted. Without this, installing from here produced an app called
  // "Khelit" that opened the owner login — see src/lib/joinPwa.js.
  useJoinManifest()

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

  // The funnel is pinned to the design file's own navy rather than the
  // academy's stored brandColor. "Academy App v2" is a complete palette, not a
  // layout with a swappable accent — its navy is load-bearing (the hero
  // gradient, the lime accent that only reads against a deep cool base, the
  // day-strip tint, the filled meter), and rendering it in an arbitrary
  // tenant hex is what made this screen look like a different app than the
  // reference. Flip USE_ACADEMY_BRAND_COLOR to true to go back to per-tenant
  // branding — everything downstream already reads from C, so that one line
  // is the whole switch.
  const USE_ACADEMY_BRAND_COLOR = false
  const C = useMemo(
    () => deriveShades(USE_ACADEMY_BRAND_COLOR ? branding?.brandColor : '#152449'),
    [branding, USE_ACADEMY_BRAND_COLOR]
  )

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
  const [homeTab, setHomeTab] = useState('home')    // home | sessions | academy
  const [homeSearch, setHomeSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [saved, setSaved] = useState([])            // bookmarked sports — this device, this visit

  // Direction of the last navigation, so the screen animation matches the
  // gesture: deeper slides in from the right, back from the left, a tab
  // switch rises. navSeq re-keys the screen so the animation replays even
  // when the same screen is re-entered.
  const [dir, setDir] = useState('fwd')
  const [navSeq, setNavSeq] = useState(0)
  const bump = (d) => { setDir(d); setNavSeq(n => n + 1) }
  const screenAnim = dir === 'back' ? 'jf-back' : dir === 'tab' ? 'jf-tab' : 'jf-fwd'

  const scrollRef = useRef(null)
  // Every screen lives in one scroll container, so without this a deep screen
  // opens at the scroll offset the previous one was left at.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [navSeq])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Supabase Auth persists the OTP session across reloads even though this
  // component's own state doesn't — without this, reloading always looked
  // like being logged out. Runs once on mount, independent of branding.
  //
  // If a reload lands here with a very recent registration already on file
  // (last 15 min), open straight on the Sessions tab instead of the generic
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
            setHomeTab('sessions')
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
  // Occupation and address are the two questions people meet before they have
  // decided to join at all, so they start folded away. Auto-opens if a restored
  // draft already carries either — collapsing must never hide typed answers.
  const [showMoreContact, setShowMoreContact] = useState(false)

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
  const openReceiptDownload = (args) => {
    if (Capacitor.isNativePlatform()) { setReceiptHtml(buildTrialReceiptHTML(args)); return }
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

  // Sessions tab shows this phone's own registered students — fetch whenever
  // it's opened while verified. Also the source for the "Sibling of" picker
  // on the registration form, so re-fetching here keeps that current too.
  const refreshMyTrials = () => db.fetchMyTrials(slug).then(setMyTrials).catch(() => {})
  useEffect(() => {
    if (homeTab !== 'sessions' || !isAuthed) return
    let cancelled = false
    setProfileLoading(true)
    db.fetchMyTrials(slug)
      .then(rows => { if (!cancelled) setMyTrials(rows) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [homeTab, isAuthed, slug])

  // Unique sports across the academy, each with its branch count, the total
  // number of batches behind it, the cheapest trial fee, and a real photo if
  // any branch offering it has one uploaded. batchCount and trialFee are both
  // real columns (0164 / 0154) — this is what fills the design's meta line
  // and fee row without inventing anything.
  const sportsView = useMemo(() => {
    const map = new Map()
    for (const r of branchRows) {
      if (!map.has(r.sportName)) {
        map.set(r.sportName, { name: r.sportName, count: 0, batches: 0, photo: '', fee: null, group: sportGroup(r.sportName) })
      }
      const e = map.get(r.sportName)
      e.count += 1
      e.batches += (r.batchCount || 0)
      if (!e.photo && r.photoUrl) e.photo = r.photoUrl
      if (r.trialFee != null && (e.fee == null || r.trialFee < e.fee)) e.fee = r.trialFee
    }
    return [...map.values()]
  }, [branchRows])

  // Only offer a category chip the academy actually has sports in — a
  // "Water" filter that always returns nothing is worse than no filter.
  const categories = useMemo(() => {
    const present = new Set(sportsView.map(s => s.group).filter(Boolean))
    return ['All', ...CATEGORY_ORDER.filter(c => present.has(c))]
  }, [sportsView])

  const filteredSportsView = useMemo(() => {
    const q = homeSearch.trim().toLowerCase()
    return sportsView.filter(sp => {
      if (category !== 'All' && sp.group !== category) return false
      if (!q) return true
      return sp.name.toLowerCase().includes(q) ||
        branchRows.some(r => r.sportName === sp.name && r.branchName.toLowerCase().includes(q))
    })
  }, [sportsView, branchRows, homeSearch, category])

  const branchesForSport = useMemo(
    () => branchRows.filter(r => r.sportName === chosenSport),
    [branchRows, chosenSport]
  )
  const currentSportView = useMemo(
    () => sportsView.find(s => s.name === chosenSport) || null,
    [sportsView, chosenSport]
  )

  const branchCount = useMemo(() => new Set(branchRows.map(r => r.branchName)).size, [branchRows])

  const toggleSaved = (name) => setSaved(s => s.includes(name) ? s.filter(x => x !== name) : [...s, name])

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

  // Sessions-tab verify — same OTP mechanics as login, but deliberately does
  // NOT call goHome(): the visitor opened Sessions on purpose, so verifying
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
      setHomeTab('home'); setStep('login'); bump('tab')
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
    bump('back')
  }
  const goTab = (t) => { setHomeTab(t); setError(''); bump('tab') }
  const chooseSport = (name) => { setError(''); setChosenSport(name); setStep('branch'); bump('fwd') }

  async function chooseBranch(row) {
    setChosenRow(row); setError('')
    // Batch step disabled and no auto-assign → skip the fetch entirely and
    // let the academy assign one, exactly as batchId = null already meant.
    if (!batchChoice && !autoAssignByAge) { setBatches([]); setBatchId(null); setStep('form'); bump('fwd'); return }
    setLoading(true); setBatchesLoading(true)
    try {
      const list = await db.fetchPublicTrialBatches(slug, row.id)
      setBatches(list); setBatchId(null)
      // Auto-assign still needs the list (to match by age once DOB is known)
      // but never shows the picker screen itself — straight to the form,
      // same as the disabled-with-no-auto-assign path above.
      setStep(batchChoice ? 'batch' : 'form'); bump('fwd')
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
        case 'batch':   setStep('branch'); bump('back'); break
        case 'form':    setStep(batchChoiceRef.current ? 'batch' : 'branch'); bump('back'); break
        case 'pay':     setStep('form'); bump('back'); break
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
  const missingFields = () => {
    const missing = REQUIRED_FIELDS.filter(f => !form[f.key].trim())
    // The health question is required on its own — an unanswered yes/no is
    // not the same as "no", and a Yes with no description tells staff nothing.
    if (!form.hasMedical) missing.push({ key: 'hasMedical' })
    else if (form.hasMedical === 'yes' && !form.medicalNotes.trim()) missing.push({ key: 'medicalNotes' })
    return missing
  }

  // The design's "3/5" counter and progress rule. Counts the same six checks
  // the submit gate enforces, so the bar reaching full and the CTA going live
  // are always the same moment — a progress bar that can hit 100% on a form
  // that still won't submit is worse than none.
  const requiredChecks = [
    !!form.name.trim(),
    !!form.parentName.trim(),
    !!form.gender,
    !!form.emergencyContactName.trim(),
    !!form.emergencyContactPhone.trim(),
    !!form.hasMedical && (form.hasMedical !== 'yes' || !!form.medicalNotes.trim()),
  ]
  const doneCount = requiredChecks.filter(Boolean).length
  const formComplete = doneCount === requiredChecks.length

  const goToPayment = () => {
    setError('')
    const missing = missingFields()
    if (missing.length) {
      setInvalid(Object.fromEntries(missing.map(f => [f.key, true])))
      document.getElementById(`jf-${missing[0].key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setInvalid({})
    setStep('pay'); bump('fwd')
  }

  // The pay page's CTA. Validation already passed to get here; re-running it
  // costs nothing and means a restored draft that skipped the form page can't
  // submit an incomplete registration.
  const startSubmit = () => {
    setError('')
    const missing = missingFields()
    if (missing.length) {
      setInvalid(Object.fromEntries(missing.map(f => [f.key, true])))
      setStep('form'); bump('back')
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

  const chosenBatch = batchId ? batches.find(b => b.id === batchId) : null
  const batchLabel = chosenBatch ? capFirst(chosenBatch.code || chosenBatch.name) : (batchChoice ? 'Academy allocates batch' : '')
  const formBreadcrumb = [chosenSport, chosenRow?.branchName, batchLabel].filter(Boolean).join(' · ')

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
      refreshMyTrials() // keeps the Sessions list + next sibling-picker current; fire-and-forget
      // 0198: a full batch at an academy that has turned off "Take payment for
      // a full batch" comes back parked as 'enquired' with a zero fee — there
      // is no seat, so there is nothing to charge for. Skipping Razorpay here
      // is the visible half; secure_book_trial_payment refuses an enquired row
      // outright, so a client that ignored this still could not take the money.
      if (feeMode === 'online' && res?.stage !== 'enquired') {
        await runOnlinePayment(res.id)
      } else {
        setStep('confirm'); bump('fwd')
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
      setStep('confirm'); bump('fwd')
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
      <div style={{ minHeight: '100vh', background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <style>{JOIN_CSS}</style>
        <Spinner size={26} color={C.main} />
      </div>
    )
  }
  if (brandingStatus === 'not-found') {
    return (
      <div style={{ minHeight: '100vh', background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: FONT }}>
        <style>{JOIN_CSS}</style>
        <div style={{ width: '100%', maxWidth: 340, background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, padding: 20, textAlign: 'center' }}>
          <div style={{ ...T.h3, color: N.text, marginBottom: 6 }}>Link not found</div>
          <div style={{ ...T.sub, color: N.muted }}>
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
  // Shared by both the View and Download receipt buttons on a Sessions-tab
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
  const sportFallback = (name, w, h) => tagPhoto(`${slugify(name)},sport`, `${slug}-${slugify(name)}`, w, h)
  const branchFallback = (row, w, h) => tagPhoto(`${slugify(row.sportName)},sport`, `${slug}-branch-${row.id}`, w, h)

  const heroSubtitle = branchRows.length > 0
    ? `${sportsView.length} sport${sportsView.length === 1 ? '' : 's'} · ${branchCount} branch${branchCount === 1 ? '' : 'es'} · One academy.`
    : 'Register in under 2 minutes.'
  // The design's header sub-line. Both halves are real counts, never a
  // "6 programs live" placeholder.
  const headerLine = branchesLoading && branchRows.length === 0
    ? greetingWord()
    : `${greetingWord()} · ${sportsView.length} program${sportsView.length === 1 ? '' : 's'} live`

  // The tab bar rides with the browsing screens and steps aside for the
  // committed part of the funnel, exactly as the design has it — once you are
  // filling the form there is one way forward and it isn't a tab.
  const showTabBar = ['home', 'branch', 'batch'].includes(step)

  const AcademyMark = ({ size = 36, radius = R.control, imgSize }) => (
    <div style={{ width: size, height: size, borderRadius: radius, background: '#fff', border: `1px solid ${N.line}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
      {branding?.logoUrl
        ? <img src={branding.logoUrl} alt={displayName} style={{ width: imgSize || size - 6, height: imgSize || size - 6, objectFit: 'contain' }} />
        : <Trophy size={Math.round(size * 0.45)} color={C.main} />}
    </div>
  )

  // ── LOGIN — full-bleed, outside the app shell ────────────────
  if (step === 'login') {
    return (
      <div style={{ minHeight: '100vh', background: N.page, fontFamily: FONT,
                    '--jf-accent': C.main, '--jf-accent-soft': `${C.main}2E` }}>
        <style>{JOIN_CSS}</style>
        <div className="jf-shell" style={{ margin: '0 auto', width: '100%', maxWidth: 440, position: 'relative', overflow: 'hidden', background: C.deep }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Photo fallback={heroFallback} alt={displayName} />
          </div>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                        background: `linear-gradient(180deg, ${C.deep}D9 0%, ${C.deep}66 34%, ${C.deep}F2 76%)` }} />

          <div className="jf-fwd" style={{ position: 'absolute', top: 54, left: 22, right: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: R.tile, background: 'rgba(255,255,255,0.12)',
                          border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {branding?.logoUrl
                ? <img src={branding.logoUrl} alt={displayName} style={{ width: 44, height: 44, objectFit: 'contain' }} />
                : <Trophy size={24} color="#fff" />}
            </div>
            <div style={{ ...T.hero, color: '#fff' }}>Train with<br />{displayName}.</div>
            <div style={{ ...T.body, color: 'rgba(255,255,255,0.62)' }}>{heroSubtitle}</div>
          </div>

          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff',
                        borderRadius: `${R.tile}px ${R.tile}px 0 0`, padding: '20px 20px calc(24px + env(safe-area-inset-bottom))' }}>
            <div style={{ display: 'flex', background: N.track, borderRadius: R.control, padding: 3, gap: 3, marginBottom: 18 }}>
              {['login', 'register'].map(m => (
                <Tappable key={m} pressed={authMode === m}
                  onClick={() => { setAuthMode(m); setOtpSent(false); setOtp(''); setError('') }}
                  style={{
                    flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: R.chip, fontSize: 13, fontWeight: 600,
                    background: authMode === m ? '#fff' : 'transparent',
                    color: authMode === m ? N.text : N.dim,
                    boxShadow: authMode === m ? E.chip : 'none',
                  }}>
                  {m === 'login' ? 'Login' : 'Register'}
                </Tappable>
              ))}
            </div>

            <ErrorBox msg={error} />

            {!otpSent ? (
              <>
                <label style={fieldLabelStyle} htmlFor="jf-login-phone">Phone number</label>
                <div style={{ display: 'flex', alignItems: 'center', height: 46, border: `1px solid ${N.line}`, borderRadius: R.control, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px', borderRight: `1px solid ${N.line}`,
                                ...T.label, fontSize: 14, color: N.dim, background: N.page, ...NUM }}>+91</div>
                  <input id="jf-login-phone" type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                    onChange={e => setMobile(e.target.value)}
                    style={{ flex: 1, height: '100%', border: 'none', outline: 'none', padding: '0 12px', fontSize: 14.5, color: N.text, fontFamily: FONT, ...NUM }} />
                </div>
                <Cta onClick={sendCode} loading={loading} C={C}>{authMode === 'login' ? 'Send OTP' : 'Create account'}</Cta>
                {OTP_SKIP && (
                  <button type="button" onClick={() => devSkip(false)} disabled={loading}
                    style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 12.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: R.control, cursor: 'pointer', fontFamily: FONT }}>
                    ⚡ Skip OTP (testing only)
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={{ ...T.sub, color: N.dim, marginBottom: 12 }}>
                  Code sent to <b style={{ color: N.text }}>+91 {phone}</b> ·{' '}
                  <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                </div>
                <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="––––" value={otp} autoFocus
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                  style={{ ...inputStyle, height: 52, fontSize: 22, fontWeight: 700, letterSpacing: 12, textAlign: 'center', marginBottom: 16, ...NUM }} />
                <Cta onClick={verifyCode} loading={loading} C={C}>Verify &amp; continue</Cta>
              </>
            )}

            <Tappable onClick={skipLogin}
              style={{ textAlign: 'center', ...T.label, color: N.muted, padding: '16px 0 2px', borderRadius: R.chip }}>
              Skip for now →
            </Tappable>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: N.page, fontFamily: FONT, color: N.text,
                  '--jf-accent': C.main, '--jf-accent-soft': `${C.main}2E` }}>
      <style>{JOIN_CSS}</style>
      {/* The app shell: one fixed-height column with a single scrolling
          region, the way the design is built — not a long page with things
          floating over it. Keeps the tab bar and the form's checkout footer
          genuinely fixed on mobile, including when the keyboard opens. */}
      <div className="jf-shell" style={{ margin: '0 auto', width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', background: N.page, position: 'relative', overflow: 'hidden' }}>
        <div ref={scrollRef} className="jf-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <div key={navSeq} className={screenAnim}>

            {/* ── HOME ──────────────────────────────────────── */}
            {step === 'home' && homeTab === 'home' && (
              <>
                <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'rgba(246,247,250,0.86)',
                              backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                              borderBottom: `1px solid ${N.line}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 10px' }}>
                    <AcademyMark size={36} radius={R.control} imgSize={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: -0.15, lineHeight: 1.25,
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
                      <div style={{ ...T.metaB, color: N.muted, lineHeight: 1.3 }}>{headerLine}</div>
                    </div>
                    <Tappable onClick={() => goTab('sessions')} label="Your registrations" press="chip"
                      style={{ position: 'relative', width: 34, height: 34, borderRadius: R.control,
                               border: `1px solid ${N.line}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Bell size={17} color={N.text} strokeWidth={1.7} />
                      {myTrials.length > 0 && (
                        <span style={{ position: 'absolute', top: 7, right: 8, width: 6, height: 6, borderRadius: '50%', background: DANGER, border: '1.5px solid #fff' }} />
                      )}
                    </Tappable>
                  </div>

                  <div style={{ padding: '0 16px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', border: `1px solid ${N.line}`,
                                  borderRadius: R.field, padding: '0 12px', height: 42 }}>
                      <Search size={16} color={N.muted} strokeWidth={2} />
                      <input value={homeSearch} onChange={e => setHomeSearch(e.target.value)}
                        placeholder="Search sport, branch or batch" aria-label="Search programs"
                        style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: N.text, fontFamily: FONT }} />
                    </div>
                  </div>

                  {categories.length > 1 && (
                    <div className="jf-scroll" style={{ display: 'flex', gap: 7, padding: '0 16px 11px', overflowX: 'auto' }}>
                      {categories.map(c => (
                        <Chip key={c} active={category === c} onClick={() => setCategory(c)} C={C} height={30}>{c}</Chip>
                      ))}
                    </div>
                  )}
                </div>

                {/* Free-trial hero. The ₹0 is the honest headline: the trial
                    FEE (if this academy charges one) is quoted per branch on
                    the pay page — what's free here is committing to anything. */}
                <div style={{ padding: '14px 16px 0' }}>
                  <Tappable onClick={() => { if (sportsView[0]) chooseSport(sportsView[0].name) }}
                    label="Book a free trial session"
                    style={{ position: 'relative', overflow: 'hidden', borderRadius: R.tile, padding: 18, boxShadow: E.brand,
                             background: `linear-gradient(145deg, ${C.lift} 0%, ${C.main} 55%, ${C.deep} 100%)` }}>
                    <div style={{ position: 'absolute', top: -52, right: -46, width: 150, height: 150, borderRadius: '50%', border: `1px solid ${A}38` }} />
                    <div style={{ position: 'absolute', top: -24, right: -18, width: 96, height: 96, borderRadius: '50%',
                                  background: `radial-gradient(circle at 30% 30%, ${A}4D, ${A}00 70%)` }} />
                    <div style={{ position: 'absolute', bottom: -46, left: -30, width: 120, height: 120, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.06)' }} />

                    <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 13 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${A}24`,
                                    border: `1px solid ${A}4D`, borderRadius: R.pill, padding: '5px 11px 5px 9px' }}>
                        <span style={{ position: 'relative', display: 'flex', width: 7, height: 7 }}>
                          <span className="jf-ping" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: A, opacity: 0.55, animation: 'jfPing 1.9s cubic-bezier(0,0,.2,1) infinite' }} />
                          <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: A }} />
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.9, color: A_SOFT, textTransform: 'uppercase' }}>Admissions open</span>
                      </div>
                    </div>
                    <div style={{ position: 'relative', ...T.h2, color: '#fff', marginBottom: 5 }}>Book a free trial session</div>
                    <div style={{ position: 'relative', ...T.sub, color: 'rgba(255,255,255,0.58)', marginBottom: 15, maxWidth: 250 }}>
                      Try any sport at any branch before you commit. Coaches confirm within 24 hours.
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', borderRadius: R.field,
                                    padding: '11px 16px', boxShadow: '0 3px 10px rgba(0,0,0,0.18)' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.main, letterSpacing: -0.1 }}>Get started</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.main} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M12 6l6 6-6 6" /></svg>
                      </div>
                      {branchCount > 0 && (
                        <div style={{ ...T.metaB, color: 'rgba(255,255,255,0.5)', lineHeight: 1.3, textAlign: 'right', ...NUM }}>
                          {branchCount} branch{branchCount === 1 ? '' : 'es'}<br />to choose from
                        </div>
                      )}
                    </div>
                  </Tappable>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 16px 10px' }}>
                  <div style={{ ...T.section }}>{category === 'All' ? 'All programs' : `${category} sports`}</div>
                  {sportsView.length > 0 && (
                    <div style={{ ...T.label, color: N.muted, ...NUM }}>{filteredSportsView.length} of {sportsView.length}</div>
                  )}
                </div>

                <div className="jf-stagger" style={{ display: 'grid', gap: 12, padding: '0 16px 20px', gridTemplateColumns: '1fr 1fr' }}>
                  {branchesLoading && branchRows.length === 0 &&
                    [0, 1, 2, 3].map(i => <Skeleton key={i} height={186} radius={R.card} />)}

                  {filteredSportsView.map((sp, i) => {
                    const on = saved.includes(sp.name)
                    return (
                      <Tappable key={sp.name} onClick={() => chooseSport(sp.name)}
                        label={`${sp.name}, ${sp.count} branch${sp.count === 1 ? '' : 'es'}`}
                        style={{ background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, overflow: 'hidden',
                                 animationDelay: `${Math.min(i, 7) * 45}ms` }}>
                        <div style={{ position: 'relative', height: 104 }}>
                          <Photo src={sp.photo} fallback={sportFallback(sp.name, 700, 540)} alt={sp.name} />
                          <Tappable onClick={e => { e.stopPropagation(); toggleSaved(sp.name) }}
                            label={on ? `Remove ${sp.name} from saved` : `Save ${sp.name}`} pressed={on} press="chip"
                            style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: R.chip,
                                     background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                                     display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Bookmark size={14} strokeWidth={1.9} color={on ? C.main : N.dim} fill={on ? C.main : 'none'} />
                          </Tappable>
                        </div>
                        <div style={{ padding: '10px 12px 12px' }}>
                          <div style={{ ...T.card, fontSize: 14, marginBottom: 3 }}>{sp.name}</div>
                          <div style={{ ...T.metaB, color: N.muted, ...NUM, marginBottom: sp.fee != null ? 8 : 0 }}>
                            {sp.count} branch{sp.count === 1 ? '' : 'es'}
                            {sp.batches > 0 && ` · ${sp.batches} batch${sp.batches === 1 ? '' : 'es'}`}
                          </div>
                          {/* Real trial fee from sport_branches, labelled for
                              what it actually is — the design's "/mo" would be
                              a monthly figure nothing in the schema holds. */}
                          {sp.fee != null && (
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.main, letterSpacing: -0.2, ...NUM }}>
                                {sp.fee > 0 ? `₹${sp.fee.toLocaleString('en-IN')}` : 'Free'}
                              </span>
                              <span style={{ fontSize: 10.5, fontWeight: 600, color: N.faint }}>{sp.fee > 0 ? 'trial' : 'trial'}</span>
                            </div>
                          )}
                        </div>
                      </Tappable>
                    )
                  })}
                </div>

                {!branchesLoading && filteredSportsView.length === 0 && (
                  <div style={{ padding: '8px 16px 28px', textAlign: 'center' }}>
                    <div style={{ ...T.h3, marginBottom: 6 }}>
                      {sportsView.length === 0 ? 'No sports listed yet' : 'Nothing matches that'}
                    </div>
                    <div style={{ ...T.sub, color: N.muted }}>
                      {sportsView.length === 0
                        ? 'The academy is still setting up its programs — check back shortly.'
                        : `Try a different sport or branch name.`}
                    </div>
                    {sportsView.length > 0 && (
                      <Tappable onClick={() => { setHomeSearch(''); setCategory('All') }}
                        style={{ display: 'inline-flex', marginTop: 14, ...T.label, color: C.main, padding: '9px 16px',
                                 borderRadius: R.chip, border: `1px solid ${N.line}`, background: '#fff' }}>
                        Clear filters
                      </Tappable>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── SESSIONS TAB — this phone's registrations ─── */}
            {step === 'home' && homeTab === 'sessions' && (
              !isAuthed ? (
                <div style={{ padding: '28px 16px 24px' }}>
                  <div style={{ textAlign: 'center', marginBottom: 22 }}>
                    <div style={{ width: 52, height: 52, borderRadius: R.icon, border: `1px solid ${N.line}`, background: '#fff',
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                      <CalendarDays size={22} color={N.muted} strokeWidth={1.8} />
                    </div>
                    <div style={{ ...T.section, marginBottom: 6 }}>Verify your number</div>
                    <div style={{ ...T.sub, color: N.muted, maxWidth: 250, margin: '0 auto' }}>
                      Trials and batch registrations for your phone number appear here.
                    </div>
                  </div>
                  <ErrorBox msg={error} />
                  {!otpSent ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', height: 46, border: `1px solid ${N.line}`, borderRadius: R.control, overflow: 'hidden', marginBottom: 14, background: '#fff' }}>
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', padding: '0 12px', borderRight: `1px solid ${N.line}`,
                                      ...T.label, fontSize: 14, color: N.dim, background: N.page, ...NUM }}>+91</div>
                        <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                          onChange={e => setMobile(e.target.value)} aria-label="Phone number"
                          style={{ flex: 1, height: '100%', border: 'none', outline: 'none', padding: '0 12px', fontSize: 14.5, color: N.text, fontFamily: FONT, ...NUM }} />
                      </div>
                      <Cta onClick={profileSendOtp} loading={loading} C={C}>Send OTP</Cta>
                      {OTP_SKIP && (
                        <button type="button" onClick={profileDevSkip} disabled={loading}
                          style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 12.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: R.control, cursor: 'pointer', fontFamily: FONT }}>
                          ⚡ Skip OTP (testing only)
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ ...T.sub, color: N.dim, marginBottom: 12 }}>
                        OTP sent to <b style={{ color: N.text }}>+91 {phone}</b>.{' '}
                        <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                      </div>
                      <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="––––" value={otp} autoFocus
                        onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                        style={{ ...inputStyle, height: 52, fontSize: 22, fontWeight: 700, letterSpacing: 12, textAlign: 'center', marginBottom: 16, ...NUM }} />
                      <Cta onClick={profileVerifyOtp} loading={loading} C={C}>Verify</Cta>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ padding: '16px 16px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...T.section }}>Your registrations</div>
                      <div style={{ ...T.meta, color: N.muted, ...NUM }}>+91 {phone}</div>
                    </div>
                    <Tappable onClick={logout} label="Log out" press="chip"
                      style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 11px', borderRadius: R.chip,
                               border: `1px solid ${N.line}`, background: '#fff', flexShrink: 0 }}>
                      <LogOut size={13} color={N.muted} />
                      <span style={{ ...T.metaB, color: N.muted }}>Log out</span>
                    </Tappable>
                  </div>

                  {profileLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[0, 1].map(i => <Skeleton key={i} height={104} />)}
                    </div>
                  ) : myTrials.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px 16px' }}>
                      <div style={{ width: 52, height: 52, borderRadius: R.icon, border: `1px solid ${N.line}`, background: '#fff',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                        <CalendarDays size={22} color={N.muted} strokeWidth={1.8} />
                      </div>
                      <div style={{ ...T.section, marginBottom: 6 }}>No sessions booked</div>
                      <div style={{ ...T.sub, color: N.muted, maxWidth: 230, margin: '0 auto' }}>
                        Trials and batch registrations appear here once the academy confirms them.
                      </div>
                    </div>
                  ) : (
                    <div className="jf-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {myTrials.map((t, i) => {
                        const expanded = expandedTrialId === t.id
                        return (
                          <div key={t.id} style={{ background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, padding: 14, animationDelay: `${Math.min(i, 6) * 45}ms` }}>
                            <Tappable onClick={() => setExpandedTrialId(expanded ? null : t.id)}
                              label={`${t.name} — ${expanded ? 'hide' : 'show'} details`}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ ...T.card }}>{t.name}</div>
                                <div style={{ ...T.metaB, color: N.muted, marginTop: 2 }}>{t.sport}{t.branchName ? ` · ${t.branchName}` : ''}</div>
                                {t.relationship && <div style={{ ...T.metaB, color: C.main, marginTop: 4 }}>{t.relationship}</div>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                <span style={{
                                  ...T.badge, padding: '4px 7px', borderRadius: 5, whiteSpace: 'nowrap',
                                  background: STAGE_STRONG.has(t.stage) ? C.main : A_TINT,
                                  color:      STAGE_STRONG.has(t.stage) ? '#fff' : C.main,
                                }}>
                                  {STAGE_LABEL[t.stage] || t.stage}
                                </span>
                                <ChevronDown size={16} color={N.faint} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }} />
                              </div>
                            </Tappable>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 11, paddingTop: 10, borderTop: `1px solid ${N.hair}` }}>
                              <span style={{ ...T.metaB, color: N.muted }}>Trial fee</span>
                              <span style={{ ...T.metaB, fontWeight: 700, ...NUM, color: t.trialFeeMode === 'Not collected' ? DANGER_TEXT : C.main }}>
                                {t.trialFeeMode === 'Not collected' ? `₹${t.trialFeePaid} due` : `₹${t.trialFeePaid} paid (${t.trialFeeMode})`}
                              </span>
                            </div>

                            {expanded && (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${N.hair}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ ...T.sub, color: N.dim }}>{STAGE_NEXT[t.stage] || ''}</div>

                                {t.batchName && (
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                                    <span style={{ ...T.meta, color: N.muted, flexShrink: 0 }}>Batch</span>
                                    <span style={{ ...T.metaB, fontWeight: 700, textAlign: 'right', ...NUM }}>
                                      {t.batchName}{t.batchDays?.length ? ` · ${t.batchDays.join(', ')}` : ''}{t.batchStartTime ? ` · ${t.batchStartTime}–${t.batchEndTime}` : ''}
                                    </span>
                                  </div>
                                )}

                                {t.coachNote && (
                                  <div style={{ background: N.page, borderRadius: R.control, padding: 10 }}>
                                    <div style={{ ...T.badge, color: N.muted, marginBottom: 3 }}>Coach's note</div>
                                    <div style={{ ...T.sub, color: N.text }}>{t.coachNote}</div>
                                  </div>
                                )}

                                {t.trialFeeMode !== 'Not collected' && (
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <Tappable onClick={() => openReceiptView(trialReceiptArgs(t))} label="View receipt"
                                      style={{ flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                               background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.control, ...T.label, fontWeight: 700 }}>
                                      <Eye size={14} color={C.main} /> View
                                    </Tappable>
                                    <Tappable onClick={() => openReceiptDownload(trialReceiptArgs(t))} label="Download receipt"
                                      style={{ flex: 1, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                               background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.control, ...T.label, fontWeight: 700 }}>
                                      <Download size={14} color={C.main} /> Download
                                    </Tappable>
                                  </div>
                                )}

                                {/* Converted — a real student account exists */}
                                {t.stage === 'converted' && academyFeatures.studentCodeLogin && t.studentCode && (
                                  <div style={{ background: N.page, border: `1px solid ${N.line}`, borderRadius: R.control, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ ...T.label, fontWeight: 700, color: N.text }}>Access the Student App</div>
                                    {t.accountStatus === 'active' ? (
                                      <div style={{ ...T.sub, color: N.dim }}>
                                        Already activated — <a href="https://khelit.com" style={{ color: C.main, fontWeight: 700 }}>log in at khelit.com</a>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ ...T.meta, color: N.muted }}>Student ID</span>
                                          <span style={{ ...T.metaB, fontWeight: 700, fontFamily: 'monospace' }}>{t.studentCode}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ ...T.meta, color: N.muted }}>Join Code</span>
                                          <span style={{ ...T.metaB, fontWeight: 700, fontFamily: 'monospace' }}>{t.joinCode}</span>
                                        </div>
                                        <a href="https://khelit.com/activate" style={{ textDecoration: 'none' }}>
                                          <div style={{ marginTop: 4, textAlign: 'center', background: C.main, color: '#fff', ...T.label, fontWeight: 700, borderRadius: R.control, padding: '10px 0' }}>
                                            Open Student App →
                                          </div>
                                        </a>
                                      </div>
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

                  <div style={{ marginTop: 18 }}>
                    <Cta onClick={() => goTab('home')} C={C}>Register another student</Cta>
                  </div>
                </div>
              )
            )}

            {/* ── ACADEMY TAB ───────────────────────────────── */}
            {step === 'home' && homeTab === 'academy' && (
              <div style={{ padding: '18px 16px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
                  <AcademyMark size={52} radius={R.card} imgSize={44} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...T.section, lineHeight: 1.3 }}>{displayName}</div>
                    <div style={{ ...T.label, color: N.muted, fontWeight: 500 }}>
                      {academyAddress || `${branchCount} branch${branchCount === 1 ? '' : 'es'} · ${sportsView.length} sport${sportsView.length === 1 ? '' : 's'}`}
                    </div>
                  </div>
                </div>

                <div style={{ background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, overflow: 'hidden' }}>
                  <Tappable className="jf-row" onClick={() => goTab('sessions')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, ...T.label, fontSize: 14 }}>
                    Your registrations<ChevronRight size={16} color={N.faint} />
                  </Tappable>
                  {branding?.contactPhone && (
                    <a href={`tel:${branding.contactPhone}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, ...T.label, fontSize: 14, borderTop: `1px solid ${N.hair}` }}>
                        Call the academy
                        <span style={{ ...T.metaB, color: N.muted, ...NUM }}>{branding.contactPhone}</span>
                      </div>
                    </a>
                  )}
                  {branding?.contactEmail && (
                    <a href={`mailto:${branding.contactEmail}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 14, ...T.label, fontSize: 14, borderTop: `1px solid ${N.hair}` }}>
                        {/* "Email the academy", not "Email" — this card is the
                            visitor's own account (it ends in Log out) and the
                            visitor signs in by PHONE, so a bare "Email" label
                            reads as their address rather than the academy's.
                            Mirrors "Call the academy" directly above. */}
                        Email the academy
                        <span style={{ ...T.metaB, color: N.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branding.contactEmail}</span>
                      </div>
                    </a>
                  )}
                  <InstallAppRow C={C} />
                  {isAuthed && (
                    <Tappable className="jf-row" onClick={logout}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, ...T.label, fontSize: 14, borderTop: `1px solid ${N.hair}`, color: DANGER_TEXT }}>
                      Log out<LogOut size={15} color={DANGER_TEXT} />
                    </Tappable>
                  )}
                </div>

                {academyAddress && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 16, padding: '0 2px' }}>
                    <MapPin size={13} color={N.faint} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ ...T.meta, color: N.muted }}>{academyAddress}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── SPORT → CHOOSE A BRANCH ───────────────────── */}
            {step === 'branch' && (
              <>
                <div style={{ position: 'relative', height: 188, background: N.hair }}>
                  <Photo fallback={sportFallback(chosenSport, 900, 500)} alt={chosenSport} />
                  <Tappable onClick={goHome} label="Back to sports" press="chip"
                    style={{ position: 'absolute', top: 14, left: 14, width: 34, height: 34, borderRadius: R.control,
                             background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                             display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowLeft size={17} color={N.text} strokeWidth={2} />
                  </Tappable>
                </div>

                <div style={{ background: '#fff', borderBottom: `1px solid ${N.line}`, padding: '16px 16px 0' }}>
                  <div style={{ ...T.hero }}>{chosenSport}</div>
                  <div style={{ ...T.sub, color: N.muted, marginTop: 4 }}>
                    Free trial session · coaches confirm within 24 hours
                  </div>
                  <div style={{ display: 'flex', marginTop: 14, borderTop: `1px solid ${N.line}` }}>
                    {[
                      { v: branchesForSport.length, l: branchesForSport.length === 1 ? 'Branch' : 'Branches' },
                      { v: currentSportView?.batches ?? 0, l: 'Batches' },
                      {
                        v: currentSportView?.fee == null ? '—' : (currentSportView.fee > 0 ? `₹${currentSportView.fee.toLocaleString('en-IN')}` : 'Free'),
                        l: 'Trial fee',
                      },
                    ].map((s, i, arr) => (
                      <div key={s.l} style={{ flex: 1, padding: i === 0 ? '12px 0' : '12px 0 12px 14px',
                                              borderRight: i < arr.length - 1 ? `1px solid ${N.line}` : 'none' }}>
                        <div style={{ ...T.stat, ...NUM }}>{s.v}</div>
                        <div style={{ ...T.badge, fontSize: 10.5, letterSpacing: 0.6, color: N.muted, marginTop: 2 }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ padding: '18px 16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ ...T.label, fontWeight: 700, letterSpacing: 0.2, fontSize: 13 }}>Choose a branch</div>
                    {branchesForSport.length > 1 && (
                      <div style={{ ...T.metaB, color: N.muted }}>{branchesForSport.length} available</div>
                    )}
                  </div>

                  <div className="jf-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {branchesForSport.map((row, i) => {
                      const open = (row.batchCount || 0) > 0
                      return (
                        <Tappable key={row.id} onClick={() => chooseBranch(row)} disabled={loading}
                          label={`${row.branchName} — register here`}
                          style={{ background: '#fff', border: `1px solid ${N.line}`, borderRadius: R.card, padding: 12,
                                   opacity: loading ? 0.6 : 1, animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <div style={{ width: 64, height: 64, flexShrink: 0 }}>
                              <Photo src={row.photoUrl} fallback={branchFallback(row, 300, 300)} radius={R.control} alt={row.branchName} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
                                <div style={{ ...T.card }}>{row.branchName}</div>
                                <div style={{ ...T.badge, padding: '3px 6px', borderRadius: 5,
                                              background: open ? A_TINT : DANGER_TINT,
                                              color:      open ? C.main : DANGER_TEXT }}>
                                  {open ? 'Open' : 'Opening soon'}
                                </div>
                              </div>
                              {row.address && (
                                <div style={{ display: 'flex', gap: 5, ...T.sub, color: N.muted }}>
                                  <MapPin size={12} color={N.faint} strokeWidth={2} style={{ flexShrink: 0, marginTop: 3 }} />
                                  <span>{row.address}</span>
                                </div>
                              )}
                            </div>
                            <ChevronRight size={17} color={N.faint} style={{ flexShrink: 0, alignSelf: 'center' }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 11, paddingTop: 10,
                                        borderTop: `1px solid ${N.hair}`, ...T.metaB, color: N.dim, ...NUM }}>
                            <span>{row.batchCount > 0 ? `${row.batchCount} batch${row.batchCount === 1 ? '' : 'es'}` : 'Batches opening soon'}</span>
                            {row.trialFee != null && (
                              <>
                                <span style={{ width: 3, height: 3, borderRadius: '50%', background: N.dot }} />
                                <span>{row.trialFee > 0 ? `₹${row.trialFee.toLocaleString('en-IN')} trial` : 'Free trial'}</span>
                              </>
                            )}
                            <span style={{ marginLeft: 'auto', color: C.main, fontWeight: 700 }}>{loading ? 'Opening…' : 'Register'}</span>
                          </div>
                        </Tappable>
                      )
                    })}

                    {branchesForSport.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '26px 10px' }}>
                        <div style={{ ...T.h3, marginBottom: 6 }}>No branches for {chosenSport} yet</div>
                        <div style={{ ...T.sub, color: N.muted }}>Pick another sport, or contact the academy to ask when this one opens.</div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ── BATCH ─────────────────────────────────────── */}
            {step === 'batch' && (
              <>
                <TopBar title="Choose a batch" subtitle={[chosenSport, chosenRow?.branchName].filter(Boolean).join(' · ')}
                  onBack={() => { setStep('branch'); bump('back') }} sticky />
                <div style={{ padding: '16px 16px 24px' }}>
                  <div className="jf-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {batches.map((b, i) => {
                      const seatsLeft = Math.max(0, b.seatsLeft ?? 0)
                      const cap = b.capacity || 0
                      const openSeats = seatsLeft > 0
                      // Seat policy (0198). "Waitlist" used to be a label on a
                      // fully tappable card: the family could pick a full batch,
                      // pay the trial fee, and only weeks later — when staff
                      // tried to convert them — did anyone discover there had
                      // never been a seat. The academy now decides, in
                      // Settings > Registration, whether a full batch can be
                      // booked at all and whether it can be charged. Both
                      // default on, so this changes nothing until they opt in.
                      const blocked  = b.isFull && !b.fullSelectable
                      const freeOnly = b.isFull && b.fullSelectable && !b.fullPayable
                      // Threshold scales with capacity (typically 15–30) rather
                      // than a flat count, so "nearly full" still means
                      // something on a small batch.
                      const tight = !openSeats || (cap > 0 && seatsLeft <= Math.max(2, Math.round(cap * 0.15)))
                      const filledPct = cap > 0 ? Math.round(((cap - seatsLeft) / cap) * 100) : 0
                      const sel = batchId === b.id
                      // Code is the short, unique label batches are required to
                      // carry (0160) — same one Add Student's picker shows.
                      const label = capFirst(b.code || b.name)
                      return (
                        <Tappable key={b.id}
                          onClick={() => { if (blocked) return; setBatchId(b.id); setStep('form'); bump('fwd') }}
                          pressed={sel}
                          label={`${label}, ${openSeats ? `${seatsLeft} of ${cap} seats left` : blocked ? 'full, not accepting registrations' : freeOnly ? 'full, join the list at no charge' : 'waitlist'}`}
                          style={{ background: '#fff', border: `1px solid ${sel ? C.main : N.line}`, borderRadius: R.card,
                                   padding: 14, animationDelay: `${Math.min(i, 6) * 60}ms`,
                                   // Dimmed and inert rather than hidden: the family
                                   // can still see the batch exists and when it runs,
                                   // which is what they need in order to ask about it.
                                   opacity: blocked ? 0.5 : 1,
                                   cursor: blocked ? 'not-allowed' : undefined }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${sel ? C.main : N.radio}`,
                                          background: sel ? C.main : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          flexShrink: 0, marginTop: 2 }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: sel ? '#fff' : 'transparent' }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.15, ...NUM }}>
                                  {b.startTime ? `${b.startTime} – ${b.endTime}` : label}
                                </div>
                                {cap > 0 && (
                                  <div style={{ ...T.metaB, fontWeight: 700, ...NUM, color: tight ? DANGER_TEXT : N.muted, flexShrink: 0 }}>
                                    {openSeats ? `${seatsLeft} of ${cap} left`
                                      : blocked  ? 'Full'
                                      : freeOnly ? 'Full · no fee'
                                      : 'Waitlist'}
                                  </div>
                                )}
                              </div>
                              <div style={{ ...T.sub, color: N.muted, marginBottom: 10 }}>
                                {[b.startTime ? label : null, b.coach].filter(Boolean).join(' · ') || label}
                              </div>
                              {cap > 0 && (
                                <div style={{ height: 3, borderRadius: 2, background: N.hair, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', borderRadius: 2, background: tight ? DANGER : C.main,
                                                width: `${filledPct}%`, transition: 'width .42s cubic-bezier(.2,.8,.2,1)' }} />
                                </div>
                              )}
                              <DayStrip days={b.days} C={C} />
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 11, paddingTop: 10,
                                            borderTop: `1px solid ${N.hair}`, ...T.metaB, color: N.dim, ...NUM }}>
                                <Check size={13} color={A} strokeWidth={2} style={{ flexShrink: 0 }} />
                                <span>
                                  {trialFee > 0 ? `₹${trialFee.toLocaleString('en-IN')} trial fee` : 'Free trial session'}
                                  {b.ageMin != null && b.ageMax != null ? ` · ages ${b.ageMin}–${b.ageMax}` : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                        </Tappable>
                      )
                    })}

                    {batchesLoading && batches.length === 0 &&
                      [0, 1, 2].map(i => <Skeleton key={i} height={150} />)}

                    {!batchesLoading && batches.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 10px' }}>
                        <div style={{ ...T.h3, marginBottom: 6 }}>No batches listed yet</div>
                        <div style={{ ...T.sub, color: N.muted }}>Carry on with your registration — the academy will place you in one.</div>
                      </div>
                    )}
                  </div>

                  <Tappable onClick={() => { setBatchId(null); setStep('form'); bump('fwd') }}
                    style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44,
                             border: `1px dashed ${N.radio}`, borderRadius: 12, ...T.label, fontSize: 13, color: N.dim }}>
                    <Info size={15} color={N.dim} strokeWidth={1.9} />
                    <span>Not sure yet — let the academy pick</span>
                  </Tappable>
                </div>
              </>
            )}

            {/* ── FORM ──────────────────────────────────────── */}
            {step === 'form' && (
              <>
                <TopBar title="Registration" subtitle={formBreadcrumb}
                  onBack={() => { setStep(batchChoice ? 'batch' : 'branch'); bump('back') }}
                  progress={doneCount / requiredChecks.length} sticky
                  right={<div style={{ ...T.metaB, fontWeight: 700, color: C.main, flexShrink: 0, ...NUM }}>{doneCount}/{requiredChecks.length}</div>} />

                <div style={{ padding: '0 16px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12 }}>
                    <DevFillButton onFill={handleDevFill} />
                  </div>
                  {error && <div style={{ marginTop: 12 }}><ErrorBox msg={error} /></div>}

                  <Section title="Student">
                    <LabeledInput id="jf-name" label="Full name" placeholder="e.g. Rahul Sharma" value={form.name}
                      onChange={e => set('name', e.target.value)} invalid={invalid.name} tick={!!form.name.trim()} />

                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1.6 }}>
                        <label htmlFor="jf-dob" style={fieldLabelStyle}>Date of birth</label>
                        <input id="jf-dob" type="date" className="jf-field" value={form.dob}
                          onChange={e => { const dob = e.target.value; setForm(f => ({ ...f, dob, age: ageFromDob(dob) })) }}
                          style={{ ...inputStyle, fontSize: 14, ...NUM }} />
                      </div>
                      {/* Age is derived, never typed — the date picker is the
                          only input, so DOB and age can't disagree. */}
                      <div style={{ flex: 1 }}>
                        <span style={fieldLabelStyle}>Age</span>
                        <div title="Calculated from date of birth"
                          style={{ height: 46, border: `1px solid ${N.hair}`, borderRadius: R.control, background: N.page,
                                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                                   fontSize: 14.5, fontWeight: 600, color: form.age ? N.dim : N.faint, ...NUM }}>
                          {form.age || '—'}
                        </div>
                      </div>
                    </div>

                    {/* Auto-Assign Batch by Age (0162) — only ever shows when the
                        manual "Choose a Batch" step is off and this is turned on.
                        Development only (matchBatchByAge excludes Advance) and
                        silent when nothing fits — Preferred Days below still
                        covers that case exactly as it always has. */}
                    {autoAssignByAge && autoMatchedBatch && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12,
                                    background: N.page, borderRadius: R.control, border: `1px solid ${N.line}` }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          {autoMatchedBatch.coachPhotoUrl ? (
                            <img src={autoMatchedBatch.coachPhotoUrl} alt={autoMatchedBatch.coach || ''}
                              style={{ width: 42, height: 42, borderRadius: R.control, objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: 42, height: 42, borderRadius: R.control, display: 'flex',
                                          alignItems: 'center', justifyContent: 'center', background: C.main,
                                          color: '#fff', fontWeight: 800, fontSize: 16 }}>
                              {(autoMatchedBatch.coach || 'C').trim().charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div style={{ position: 'absolute', bottom: -3, right: -3, width: 17, height: 17,
                                        borderRadius: '50%', background: A, border: '2px solid #fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={9} color="#fff" strokeWidth={3.5} />
                          </div>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ ...T.badge, color: N.muted, marginBottom: 2 }}>Your coach</div>
                          <div style={{ ...T.card, fontSize: 14.5 }}>{autoMatchedBatch.coach || "You're placed!"}</div>
                          <div style={{ ...T.metaB, color: N.muted, marginTop: 1, ...NUM }}>
                            {capFirst(autoMatchedBatch.code || autoMatchedBatch.name)}
                            {autoMatchedBatch.startTime ? ` · ${autoMatchedBatch.startTime}–${autoMatchedBatch.endTime}` : ''}
                          </div>
                        </div>
                      </div>
                    )}

                    <div id="jf-gender">
                      <span style={fieldLabelStyle}>Gender</span>
                      <Segmented options={GENDER_OPTIONS} value={form.gender} onChange={v => set('gender', v)} invalid={invalid.gender} />
                      {invalid.gender && <span style={{ ...T.metaB, color: DANGER_TEXT, display: 'block', marginTop: 5 }}>Required</span>}
                    </div>

                    <div>
                      <span style={fieldLabelStyle}>Registering for</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        {RELATIONSHIP_OPTIONS.map(opt => (
                          <Chip key={opt} active={relationship === opt} onClick={() => setRelationship(opt)} C={C}>{opt}</Chip>
                        ))}
                      </div>
                      {relationship === 'Other' && (
                        <div style={{ marginTop: 12 }}>
                          <LabeledInput label="Describe the relationship" placeholder="e.g. Grandparent, Uncle" value={relationshipCustom}
                            onChange={e => setRelationshipCustom(e.target.value)} autoFocus />
                        </div>
                      )}
                    </div>

                    {myTrials.length > 0 && (
                      <div>
                        <label htmlFor="jf-sibling" style={fieldLabelStyle}>Sibling of <span style={{ color: N.faint, fontWeight: 500 }}>optional</span></label>
                        <select id="jf-sibling" className="jf-field" value={siblingOfId} onChange={e => setSiblingOfId(e.target.value)}
                          style={{ ...inputStyle, cursor: 'pointer' }}>
                          <option value="">— Not linked to another registration —</option>
                          {myTrials.map(t => <option key={t.id} value={t.id}>{t.name} ({t.sport})</option>)}
                        </select>
                      </div>
                    )}
                  </Section>

                  <Section title="Preferred days" optional style={{ padding: 12 }}>
                    <div>
                      <div style={{ ...T.sub, color: N.muted, marginBottom: 10 }}>
                        {batchChoice ? 'Helps the coach confirm the right session.' : 'Helps us place you in the right batch.'}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {DAY_OPTIONS.map(day => {
                          const on = form.preferredDays.includes(day)
                          return (
                            <Tappable key={day} onClick={() => toggleDay(day)} pressed={on} press="chip"
                              label={`${day}${on ? ' selected' : ''}`}
                              style={{ flex: 1, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                       borderRadius: R.day, fontSize: 12, fontWeight: 700,
                                       background: on ? C.main : '#fff', color: on ? '#fff' : N.dim,
                                       border: `1px solid ${on ? C.main : N.line}` }}>
                              {day}
                            </Tappable>
                          )
                        })}
                      </div>
                    </div>
                  </Section>

                  <Section title="Guardian contact">
                    <LabeledInput id="jf-parentName" label="Father's / guardian's name" placeholder="e.g. Rajesh Sharma"
                      value={form.parentName} onChange={e => set('parentName', e.target.value)}
                      invalid={invalid.parentName} tick={!!form.parentName.trim()} />
                    <LabeledInput label="Mother's name" hint="optional" placeholder="e.g. Priya Sharma"
                      value={form.motherName} onChange={e => set('motherName', e.target.value)} />
                    <LabeledInput type="email" inputMode="email" label="Email" hint="optional" placeholder="e.g. name@email.com"
                      value={form.email} onChange={e => set('email', e.target.value)} />
                    <LabeledInput type="tel" inputMode="tel" label="Alternate contact number" hint="optional" placeholder="10-digit number"
                      value={form.alternateContactPhone} onChange={e => set('alternateContactPhone', e.target.value)} />

                    {/* Folded by default — see showMoreContact. */}
                    {(showMoreContact || form.occupation || form.address) ? (
                      <>
                        <LabeledInput label="Occupation" hint="optional" placeholder="e.g. Software Engineer"
                          value={form.occupation} onChange={e => set('occupation', e.target.value)} />
                        <LabeledInput label="Address" hint="optional" placeholder="House / street, area, city"
                          value={form.address} onChange={e => set('address', e.target.value)} />
                      </>
                    ) : (
                      <button type="button" onClick={() => setShowMoreContact(true)}
                        style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                                 ...T.label, fontWeight: 700, color: C.main, cursor: 'pointer', fontFamily: FONT }}>
                        + Add occupation and address
                      </button>
                    )}
                  </Section>

                  {/* Emergency contact is two required fields, and for most
                      families it is the mother — whose name was typed a few
                      fields above. One tap instead of retyping. */}
                  <Section title="Emergency contact">
                    {(form.motherName?.trim() || form.parentName?.trim() || form.alternateContactPhone?.trim()) && (
                      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {form.motherName?.trim() && form.emergencyContactName !== form.motherName && (
                          <Chip active={false} onClick={() => set('emergencyContactName', form.motherName)} C={C}>Use mother</Chip>
                        )}
                        {form.parentName?.trim() && form.emergencyContactName !== form.parentName && (
                          <Chip active={false} onClick={() => set('emergencyContactName', form.parentName)} C={C}>Use father / guardian</Chip>
                        )}
                        {form.alternateContactPhone?.trim() && form.emergencyContactPhone !== form.alternateContactPhone && (
                          <Chip active={false} onClick={() => set('emergencyContactPhone', form.alternateContactPhone)} C={C}>Use alternate number</Chip>
                        )}
                      </div>
                    )}
                    <LabeledInput id="jf-emergencyContactName" label="Contact name" placeholder="e.g. Priya Sharma"
                      value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)}
                      invalid={invalid.emergencyContactName} tick={!!form.emergencyContactName.trim()} />
                    <LabeledInput id="jf-emergencyContactPhone" type="tel" inputMode="tel" label="Contact number" placeholder="10-digit number"
                      value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)}
                      invalid={invalid.emergencyContactPhone} tick={!!form.emergencyContactPhone.trim()} />
                  </Section>

                  {/* Yes/No first, details only behind Yes — a free-text box on
                      its own was routinely left blank by people who DID have
                      something to declare, and blank read as "nothing". */}
                  <Section title="Health">
                    <div id="jf-hasMedical">
                      <span style={{ ...fieldLabelStyle, color: invalid.hasMedical ? DANGER_TEXT : N.dim }}>
                        Any medical condition or allergy?
                      </span>
                      <div style={{ display: 'flex', gap: 7 }}>
                        {MEDICAL_OPTIONS.map(opt => (
                          <Chip key={opt.value} active={form.hasMedical === opt.value}
                            onClick={() => chooseHasMedical(opt.value)} C={C} height={42} style={{ flex: 1 }}>
                            {opt.label}
                          </Chip>
                        ))}
                      </div>
                      {invalid.hasMedical && <span style={{ ...T.metaB, color: DANGER_TEXT, display: 'block', marginTop: 5 }}>Required</span>}
                    </div>

                    {form.hasMedical === 'yes' && (
                      <>
                        <div>
                          <textarea id="jf-medicalNotes" className="jf-field"
                            placeholder="Describe the condition or allergy, and anything a coach should know"
                            value={form.medicalNotes} onChange={e => set('medicalNotes', e.target.value)}
                            style={{ ...inputStyle, height: 'auto', minHeight: 78, padding: '12px', resize: 'none', lineHeight: 1.45,
                                     ...(invalid.medicalNotes ? invalidStyle : {}) }} />
                          {invalid.medicalNotes && <span style={{ ...T.metaB, color: DANGER_TEXT, display: 'block', marginTop: 5 }}>Required</span>}
                        </div>

                        {!documentFile ? (
                          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44,
                                          ...T.label, color: N.dim, border: `1px dashed ${N.radio}`, borderRadius: 12, cursor: 'pointer' }}>
                            <Camera size={15} strokeWidth={1.9} /> Upload medical document (optional)
                            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                              onChange={e => setDocumentFile(e.target.files?.[0] || null)} />
                          </label>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 13px',
                                        background: N.page, border: `1px solid ${N.line}`, borderRadius: R.control }}>
                            <span style={{ ...T.sub, color: N.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{documentFile.name}</span>
                            <Tappable onClick={() => setDocumentFile(null)} label="Remove document" press="chip"
                              style={{ flexShrink: 0, display: 'flex' }}>
                              <X size={17} color={N.faint} />
                            </Tappable>
                          </div>
                        )}
                      </>
                    )}
                  </Section>
                </div>
              </>
            )}

            {/* ── PAY ───────────────────────────────────────── */}
            {step === 'pay' && (
              <>
                <TopBar title="Trial fee" subtitle={formBreadcrumb} onBack={() => { setStep('form'); bump('back') }} sticky />
                <div style={{ padding: '0 16px 24px' }}>
                  {error && <div style={{ marginTop: 14 }}><ErrorBox msg={error} /></div>}

                  <Section title="Registering">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: R.control, background: C.main, color: '#fff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                        {(form.name.trim() || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...T.card, fontSize: 15 }}>{form.name.trim() || 'Student'}</div>
                        <div style={{ ...T.metaB, color: N.muted, marginTop: 2 }}>{formBreadcrumb}</div>
                      </div>
                    </div>
                  </Section>

                  <Section title="Amount due">
                    {/* Itemise as soon as there is more than one number to add
                        up — a kit fee, a tax row, or both. A bare total that
                        doesn't match the advertised trial fee reads as a
                        mistake. */}
                    {(kitFee > 0 || fee.taxAmount > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ ...T.sub, color: N.muted }}>Trial fee</span>
                          <span style={{ ...T.label, fontWeight: 700, ...NUM }}>₹{trialFee.toLocaleString('en-IN')}</span>
                        </div>
                        {kitFee > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <span style={{ ...T.sub, color: N.muted }}>Kit fee</span>
                            <span style={{ ...T.label, fontWeight: 700, ...NUM }}>₹{kitFee.toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        {fee.taxAmount > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                            {/* The label names its own base when only one of the
                                two items is taxed, so this can't be misread as
                                tax on the whole subtotal. */}
                            <span style={{ ...T.sub, color: N.muted }}>{taxRowLabel(fee.taxPct, fee.taxedLabel)}</span>
                            <span style={{ ...T.label, fontWeight: 700, ...NUM }}>₹{fee.taxAmount.toLocaleString('en-IN')}</span>
                          </div>
                        )}
                        <div style={{ height: 1, background: N.hair }} />
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ ...T.label, color: N.dim }}>Total</span>
                      <span style={{ ...T.h1, ...NUM }}>₹{totalDue.toLocaleString('en-IN')}</span>
                    </div>
                  </Section>

                  <Section title="How you'll pay">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { key: 'walkin', label: 'Pay at the academy', note: "You'll pay this in cash when you visit." },
                        { key: 'online', label: 'Pay online now', note: 'UPI, cards & netbanking — secured by Razorpay.' },
                      ].map(opt => {
                        const on = feeMode === opt.key
                        return (
                          <Tappable key={opt.key} onClick={() => setFeeMode(opt.key)} pressed={on}
                            style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 12, borderRadius: R.control,
                                     border: `1px solid ${on ? C.main : N.line}`, background: on ? N.page : '#fff' }}>
                            <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? C.main : N.radio}`,
                                          background: on ? C.main : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          flexShrink: 0, marginTop: 1 }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#fff' : 'transparent' }} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ ...T.label, fontWeight: 700, fontSize: 13.5 }}>{opt.label}</div>
                              <div style={{ ...T.meta, color: N.muted, marginTop: 2 }}>{opt.note}</div>
                            </div>
                          </Tappable>
                        )
                      })}
                    </div>
                  </Section>
                </div>
              </>
            )}

            {/* ── CONFIRM ───────────────────────────────────── */}
            {step === 'confirm' && (
              <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'center', textAlign: 'center', padding: 32 }}>
                <div className="jf-pop" style={{ width: 64, height: 64, borderRadius: R.tile, background: C.main,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20,
                              animation: 'jfPop .46s cubic-bezier(.2,.9,.2,1) both' }}>
                  <Check size={28} color={A} strokeWidth={2.4} />
                </div>
                {/* 0198: an 'enquired' result means the batch was full and the
                    academy chose not to charge for it. Saying "Request
                    submitted · we'll call to confirm" there would imply a seat
                    that does not exist, so both the heading and the body change
                    — and the branch address is shown, because "come and see us"
                    is useless without it. */}
                <div style={{ ...T.h1, marginBottom: 8 }}>
                  {result?.stage === 'enquired' ? 'You are on the list' : 'Request submitted'}
                </div>
                <div style={{ ...T.sub, fontSize: 13.5, color: N.dim, lineHeight: 1.6, maxWidth: 272, marginBottom: 22 }}>
                  {result?.stage === 'enquired'
                    ? <>This batch is full right now, so <strong>nothing has been charged</strong>. {form.name.trim() || 'Your student'}&rsquo;s details are with the academy and they will call the moment a seat opens. You are welcome to visit us in the meantime.</>
                    : <>{form.name.trim() || 'Your student'} is registered for {formBreadcrumb || 'the programme'}. The academy will call to confirm.</>}
                </div>

                {result?.stage === 'enquired' && chosenRow?.address && (
                  <div style={{ width: '100%', maxWidth: 300, background: '#fff', border: `1px solid ${N.line}`,
                                borderRadius: R.card, padding: 14, textAlign: 'left', marginBottom: 14 }}>
                    <div style={{ ...T.sub, color: N.muted, marginBottom: 4 }}>Visit us at</div>
                    <div style={{ ...T.sub, fontWeight: 700, lineHeight: 1.5 }}>{chosenRow.branchName}</div>
                    <div style={{ ...T.sub, color: N.dim, lineHeight: 1.5 }}>{chosenRow.address}</div>
                  </div>
                )}

                <div style={{ width: '100%', maxWidth: 300, background: '#fff', border: `1px solid ${N.line}`,
                              borderRadius: R.card, padding: 14, textAlign: 'left', marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', ...T.sub, paddingBottom: 9, borderBottom: `1px solid ${N.hair}` }}>
                    <span style={{ color: N.muted }}>Reference</span>
                    <span style={{ fontWeight: 700, ...NUM }}>{shortCode}-{new Date().getFullYear()}-{result?.id ?? '—'}</span>
                  </div>
                  {batchChoice && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...T.sub, padding: '9px 0', borderBottom: `1px solid ${N.hair}` }}>
                      <span style={{ color: N.muted, flexShrink: 0 }}>Batch</span>
                      <span style={{ fontWeight: 700, textAlign: 'right' }}>{chosenBatch ? capFirst(chosenBatch.code || chosenBatch.name) : 'To be assigned'}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, ...T.sub, padding: '9px 0', borderBottom: `1px solid ${N.hair}` }}>
                    <span style={{ color: N.muted, flexShrink: 0 }}>{kitFee > 0 ? 'Trial + kit fee' : 'Trial fee'}</span>
                    <span style={{ fontWeight: 700, textAlign: 'right', ...NUM,
                                   color: result?.stage === 'enquired' ? C.main
                                        : paymentStatus === 'paid' ? C.main
                                        : paymentStatus === 'failed' ? DANGER_TEXT : N.text }}>
                      {/* Never quote a rupee figure on an enquired row — the
                          server stored the fee as 0, and showing the trial fee
                          here would read as an amount still owed. */}
                      {result?.stage === 'enquired'
                        ? 'No fee — batch full'
                        : feeMode === 'online'
                        ? (paymentStatus === 'paid' ? `₹${totalDue.toLocaleString('en-IN')} paid ✓`
                           : paymentStatus === 'failed' ? `₹${totalDue.toLocaleString('en-IN')} — pay at academy`
                           : `₹${totalDue.toLocaleString('en-IN')}`)
                        : `₹${totalDue.toLocaleString('en-IN')} — pay at academy`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', ...T.sub, paddingTop: 9 }}>
                    <span style={{ color: N.muted }}>Response time</span>
                    <span style={{ fontWeight: 700 }}>Within 24 hours</span>
                  </div>
                </div>

                {feeMode === 'online' && paymentStatus === 'failed' && (
                  <div style={{ width: '100%', maxWidth: 300, marginBottom: 14 }}>
                    <div style={{ ...T.meta, color: DANGER_TEXT, marginBottom: 10, lineHeight: 1.5 }}>
                      Online payment didn't go through. Try again, or pay ₹{totalDue.toLocaleString('en-IN')} in cash at the academy — your registration is saved either way.
                    </div>
                    <Cta onClick={() => runOnlinePayment(result.id)} C={C}>Retry payment</Cta>
                  </div>
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
                    batchName: chosenBatch?.name || null,
                    fee,
                  }
                  return (
                    <div style={{ width: '100%', maxWidth: 300, display: 'flex', gap: 10, marginBottom: 14 }}>
                      <Tappable onClick={() => openReceiptView(confirmReceiptArgs)} label="View receipt"
                        style={{ flex: 1, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                 background: '#fff', border: `1px solid ${N.line}`, borderRadius: 12, ...T.label, fontWeight: 700 }}>
                        <Eye size={15} color={C.main} /> View
                      </Tappable>
                      <Tappable onClick={() => openReceiptDownload(confirmReceiptArgs)} label="Download receipt"
                        style={{ flex: 1, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                 background: '#fff', border: `1px solid ${N.line}`, borderRadius: 12, ...T.label, fontWeight: 700 }}>
                        <Download size={15} color={C.main} /> Download
                      </Tappable>
                    </div>
                  )
                })()}

                <div style={{ width: '100%', maxWidth: 300 }}>
                  <Cta onClick={goHome} C={C}>Back to home</Cta>
                  <div style={{ ...T.meta, color: N.muted, marginTop: 12 }}>
                    Registering a sibling? No need to verify your number again.
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── BOTTOM TAB BAR ──────────────────────────────── */}
        {showTabBar && (
          <div style={{ flexShrink: 0, background: 'rgba(255,255,255,0.94)',
                        backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                        borderTop: `1px solid ${N.line}`, padding: '7px 20px calc(8px + env(safe-area-inset-bottom))',
                        display: 'flex', justifyContent: 'space-around' }}>
            {[
              { key: 'home', label: 'Explore', Icon: HomeIcon },
              { key: 'sessions', label: 'Sessions', Icon: CalendarDays },
              { key: 'academy', label: 'Academy', Icon: User },
            ].map(({ key, label, Icon }) => {
              // A deep screen (sport / batch) still belongs to the Explore
              // tab, so the highlight has to follow the funnel, not homeTab.
              const active = step === 'home' ? homeTab === key : key === 'home'
              return (
                <Tappable key={key} press="chip" label={label} pressed={active}
                  onClick={() => { if (step !== 'home') { goHome(); if (key !== 'home') setHomeTab(key) } else { goTab(key) } }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '2px 14px' }}>
                  <Icon size={20} color={active ? C.main : N.navIdle} strokeWidth={active ? 2.2 : 1.7}
                    style={{ transition: 'stroke .22s ease' }} />
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: active ? C.main : N.navIdle, transition: 'color .22s ease' }}>{label}</div>
                </Tappable>
              )
            })}
          </div>
        )}

        {/* ── FORM CHECKOUT FOOTER ────────────────────────── */}
        {step === 'form' && (
          <div style={{ flexShrink: 0, background: '#fff', borderTop: `1px solid ${N.line}`,
                        padding: '10px 16px calc(12px + env(safe-area-inset-bottom))',
                        boxShadow: E.footer, animation: 'jfFooter .34s cubic-bezier(.2,.8,.2,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ ...T.metaB, color: N.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {formBreadcrumb}
              </div>
              <div style={{ ...T.metaB, fontWeight: 700, color: C.main, flexShrink: 0, marginLeft: 10, ...NUM }}>
                {trialFee > 0 ? `₹${totalDue.toLocaleString('en-IN')}` : 'Free trial'}
              </div>
            </div>
            <Cta onClick={goToPayment} C={C} inactive={!formComplete}>
              {formComplete ? 'Continue' : 'Complete required fields'}
            </Cta>
          </div>
        )}

        {/* ── PAY CHECKOUT FOOTER ─────────────────────────── */}
        {step === 'pay' && (
          <div style={{ flexShrink: 0, background: '#fff', borderTop: `1px solid ${N.line}`,
                        padding: '10px 16px calc(12px + env(safe-area-inset-bottom))',
                        boxShadow: E.footer, animation: 'jfFooter .34s cubic-bezier(.2,.8,.2,1) both' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ ...T.metaB, color: N.muted }}>
                Amount due · {feeMode === 'online' ? 'paying online' : 'pay at the academy'}
              </div>
              <div style={{ ...T.h3, flexShrink: 0, marginLeft: 10, ...NUM }}>₹{totalDue.toLocaleString('en-IN')}</div>
            </div>
            <Cta onClick={startSubmit} loading={submitting} C={C}>Submit registration</Cta>
          </div>
        )}

        {/* ── RECEIPT VIEWER (native only — see openReceiptView/Download) ── */}
        {receiptHtml && (
          <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${N.line}`, flexShrink: 0 }}>
              <span style={{ ...T.h3 }}>Receipt</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Tappable
                  onClick={() => { try { document.getElementById('sf-receipt-frame')?.contentWindow?.print() } catch {} }}
                  label="Print or save as PDF" press="chip"
                  style={{ height: 34, display: 'flex', alignItems: 'center', padding: '0 12px', borderRadius: R.chip, background: N.page, ...T.label, fontWeight: 700 }}>
                  Print / Save PDF
                </Tappable>
                <Tappable onClick={() => setReceiptHtml(null)} label="Close" press="chip"
                  style={{ width: 34, height: 34, borderRadius: R.chip, background: N.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={16} color={N.text} />
                </Tappable>
              </div>
            </div>
            <iframe id="sf-receipt-frame" srcDoc={receiptHtml} title="Receipt" style={{ flex: 1, border: 'none', width: '100%' }} />
          </div>
        )}

        {/* ── OTP GATE (submit-time verification for the skip path) ── */}
        {showGate && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(19,26,43,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 }}
            onClick={() => { if (!loading) { setShowGate(false); setError('') } }}>
            <div onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: `${R.tile}px ${R.tile}px 0 0`,
                       padding: '18px 20px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box',
                       animation: 'jfFooter .32s cubic-bezier(.2,.8,.2,1) both' }}>
              <div style={{ width: 36, height: 4, borderRadius: R.pill, background: N.line, margin: '0 auto 16px' }} />
              <div style={{ ...T.h3, fontSize: 17, marginBottom: 4 }}>Verify your number</div>
              <div style={{ ...T.sub, color: N.muted, marginBottom: 16 }}>One quick step so the academy can confirm your registration.</div>
              <ErrorBox msg={error} />

              {!otpSent ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', height: 46, border: `1px solid ${N.line}`, borderRadius: R.control, overflow: 'hidden', marginBottom: 16 }}>
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderRight: `1px solid ${N.line}`, background: N.page }}>
                      <Phone size={14} color={N.muted} />
                      <span style={{ ...T.label, fontSize: 14, color: N.dim, ...NUM }}>+91</span>
                    </div>
                    <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} autoFocus
                      onChange={e => setMobile(e.target.value)} aria-label="Phone number"
                      style={{ flex: 1, height: '100%', border: 'none', outline: 'none', padding: '0 12px', fontSize: 14.5, color: N.text, fontFamily: FONT, ...NUM }} />
                  </div>
                  <Cta onClick={gateSend} loading={loading} C={C}>Send OTP</Cta>
                  {OTP_SKIP && (
                    <button type="button" onClick={() => devSkip(true)} disabled={loading}
                      style={{ width: '100%', marginTop: 10, padding: '10px 0', fontSize: 12.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: R.control, cursor: 'pointer', fontFamily: FONT }}>
                      ⚡ Skip OTP &amp; submit (testing only)
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div style={{ ...T.sub, color: N.dim, marginBottom: 12 }}>
                    OTP sent to <b style={{ color: N.text }}>+91 {phone}</b>.{' '}
                    <span onClick={() => { setOtpSent(false); setOtp('') }} style={{ color: C.main, fontWeight: 700, cursor: 'pointer' }}>Change</span>
                  </div>
                  <input className="jf-field" type="tel" inputMode="numeric" maxLength={8} placeholder="––––" value={otp} autoFocus
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code"
                    style={{ ...inputStyle, height: 52, fontSize: 22, fontWeight: 700, letterSpacing: 12, textAlign: 'center', marginBottom: 16, ...NUM }} />
                  <Cta onClick={gateVerify} loading={loading || submitting} C={C}>Verify &amp; submit</Cta>
                </>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
