import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  Menu, X, ArrowRight, CheckCircle, XCircle, MinusCircle, ChevronDown,
  Users, ScanLine, CreditCard, UserPlus, BarChart3, Layers, ShieldCheck, Smartphone,
  Instagram, DoorOpen, Share2, Megaphone, Dumbbell, Wallet, CalendarClock,
  MessageCircle, FileSpreadsheet, IndianRupee, Phone, MessagesSquare, FileWarning,
  ClipboardList, AlertTriangle, LayoutDashboard, TrendingUp, Sparkles, Globe, Monitor,
  MapPin, Receipt, UserX, Building2, Database, Award,
} from 'lucide-react'

// The Khelit "K" mark — matches the real app icon / Play Store listing
// (public/icon-512.svg, store-assets/play-store-icon-512.png), not a generic glyph.
function KMark({ size = 18, ring = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      {ring && (
        <>
          <circle cx="50" cy="50" r="34" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" />
          <line x1="8" y1="50" x2="92" y2="50" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" />
        </>
      )}
      <g stroke="white" strokeWidth="11" strokeLinecap="round">
        <line x1="33" y1="25" x2="33" y2="75" />
        <line x1="39" y1="50" x2="72" y2="23" />
        <line x1="39" y1="50" x2="72" y2="77" />
      </g>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Reveal — small on-scroll fade/slide-up wrapper, used throughout the page
// instead of a heavier animation library.
// ─────────────────────────────────────────────────────────────────────────
function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.unobserve(el) }
    }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

function Logo({ size = 34, dark = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex items-center justify-center rounded-lg shadow-sm"
        style={{ width: size, height: size, background: '#2563eb' }}
      >
        <KMark size={size * 0.52} />
      </div>
      <span className={`text-lg font-extrabold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>Khelit</span>
    </div>
  )
}

// Thin diagonal "track lines" texture — a court/running-track motif instead
// of a generic radial-gradient blob, used behind the dark sections.
function TrackLines({ className = '' }) {
  return (
    <svg className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} preserveAspectRatio="none">
      <defs>
        <pattern id="khTrack" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
          <line x1="0" y1="0" x2="0" y2="64" stroke="white" strokeOpacity="0.05" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#khTrack)" />
    </svg>
  )
}

// A short, bold "scoreboard" number — the sportier alternative to another
// generic stat-card row.
function ScoreStat({ value, label, accent = false }) {
  return (
    <div className="text-center px-3">
      <p
        className={`text-4xl md:text-5xl font-bold leading-none tabular-nums ${accent ? 'text-orange-400' : 'text-white'}`}
        style={{ fontFamily: "'Oswald', 'Plus Jakarta Sans', sans-serif" }}
      >
        {value}
      </p>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">{label}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Without/With diagram — the FollowUpBoss-style centerpiece.
// Same three "input" zones in both states (things that happen at an academy
// regardless of software); only the fourth, right-hand zone changes: a
// scattered chaos of bad outcomes without Khelit, or a clean hub-and-fan-out
// of real outcomes with it.
// ─────────────────────────────────────────────────────────────────────────
const VB_W = 1200
const VB_H = 800
const HUB = { x: 600, y: 400 }

const TOP    = [270, 490, 710, 930].map(x => ({ x, y: 92 }))
const LEFT   = [205, 335, 465, 595].map(y => ({ x: 118, y }))
const BOTTOM = [270, 490, 710, 930].map(x => ({ x, y: 708 }))
const RIGHT  = [205, 335, 465, 595].map(y => ({ x: 1082, y }))

const captureNodes = [
  { icon: Instagram, label: 'Instagram DM' },
  { icon: DoorOpen,  label: 'Walk-in Enquiry' },
  { icon: Share2,    label: 'Referral' },
  { icon: Megaphone, label: 'Ad Lead' },
]
const realityNodes = [
  { icon: Users,         label: 'Student Attendance' },
  { icon: Dumbbell,      label: 'Coaching Sessions' },
  { icon: Wallet,        label: 'Fee Collection' },
  { icon: CalendarClock, label: 'Staff Schedules' },
]
const channelNodes = [
  { icon: MessageCircle,   label: 'WhatsApp' },
  { icon: FileSpreadsheet, label: 'Excel Sheet' },
  { icon: IndianRupee,     label: 'Razorpay / UPI' },
  { icon: Phone,           label: 'Phone Calls' },
]
const chaosNodes = [
  { icon: MessagesSquare, label: 'Buried in Group Chats' },
  { icon: FileWarning,    label: "Numbers Don't Add Up" },
  { icon: ClipboardList,  label: 'Paper Piles Up' },
  { icon: AlertTriangle,  label: 'Follow-ups Fall Through' },
]
const resultNodes = [
  { icon: LayoutDashboard, label: 'Owner Dashboard' },
  { icon: Users,           label: 'Coach & Staff Portal' },
  { icon: Smartphone,      label: 'Parent & Student App' },
  { icon: TrendingUp,      label: 'Revenue Reports' },
]

// Which top/left/bottom source (by zone+index) feeds which chaos destination,
// deliberately not aligned by position so the lines actually cross.
const CHAOS_LINKS = [
  { from: ['top', 0],    to: 3 }, // Instagram DM        -> Follow-ups Fall Through
  { from: ['top', 1],    to: 3 }, // Walk-in Enquiry     -> Follow-ups Fall Through
  { from: ['top', 2],    to: 3 }, // Referral            -> Follow-ups Fall Through
  { from: ['top', 3],    to: 0 }, // Ad Lead             -> Buried in Group Chats
  { from: ['left', 0],   to: 2 }, // Student Attendance  -> Paper Piles Up
  { from: ['left', 1],   to: 2 }, // Coaching Sessions   -> Paper Piles Up
  { from: ['left', 2],   to: 1 }, // Fee Collection      -> Numbers Don't Add Up
  { from: ['left', 3],   to: 0 }, // Staff Schedules     -> Buried in Group Chats
  { from: ['bottom', 0], to: 0 }, // WhatsApp            -> Buried in Group Chats
  { from: ['bottom', 1], to: 1 }, // Excel Sheet         -> Numbers Don't Add Up
  { from: ['bottom', 2], to: 1 }, // Razorpay / UPI      -> Numbers Don't Add Up
  { from: ['bottom', 3], to: 3 }, // Phone Calls         -> Follow-ups Fall Through
]

function connector(x1, y1, x2, y2) {
  const c1x = x1 + (x2 - x1) * 0.35
  const c2x = x1 + (x2 - x1) * 0.65
  return `M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`
}

function zonePoint(zone, i) {
  if (zone === 'top') return { x: TOP[i].x, y: TOP[i].y + 32 }
  if (zone === 'left') return { x: LEFT[i].x + 85, y: LEFT[i].y }
  return { x: BOTTOM[i].x, y: BOTTOM[i].y - 32 }
}

function DiagramNode({ x, y, icon: Icon, label, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-white border-slate-200 text-slate-800',
    chaos:   'bg-red-50 border-red-200 text-red-800',
    result:  'bg-orange-50 border-orange-200 text-slate-900',
    hub:     '',
  }
  const iconTones = {
    neutral: 'bg-slate-100 text-slate-600',
    chaos:   'bg-red-100 text-red-600',
    result:  'bg-orange-500 text-white',
  }
  return (
    <foreignObject x={x - 90} y={y - 32} width={180} height={64}>
      <div className={`w-full h-full flex items-center gap-2.5 px-3.5 rounded-full border shadow-sm ${tones[tone]}`}>
        <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${iconTones[tone]}`}>
          <Icon size={16} />
        </span>
        <span className="text-[13px] font-semibold leading-tight">{label}</span>
      </div>
    </foreignObject>
  )
}

function ZoneLabel({ x, y, anchor = 'middle', children }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fill-slate-400 font-bold" style={{ fontSize: 12, letterSpacing: '0.12em' }}>
      {children}
    </text>
  )
}

function WithoutDiagram() {
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto">
      <ZoneLabel x={600} y={30}>CAPTURE</ZoneLabel>
      <ZoneLabel x={40} y={400} anchor="start">DAILY REALITY</ZoneLabel>
      <ZoneLabel x={600} y={775}>TOOLS YOU REACH FOR</ZoneLabel>
      <ZoneLabel x={1160} y={130} anchor="end">WITHOUT KHELIT</ZoneLabel>

      <g stroke="#fca5a5" strokeWidth="2" fill="none" opacity="0.75">
        {CHAOS_LINKS.map((l, i) => {
          const p1 = zonePoint(l.from[0], l.from[1])
          const p2 = { x: RIGHT[l.to].x - 90, y: RIGHT[l.to].y }
          return <path key={i} d={connector(p1.x, p1.y, p2.x, p2.y)} />
        })}
      </g>

      {captureNodes.map((n, i) => <DiagramNode key={n.label} x={TOP[i].x} y={TOP[i].y} {...n} />)}
      {realityNodes.map((n, i) => <DiagramNode key={n.label} x={LEFT[i].x} y={LEFT[i].y} {...n} />)}
      {channelNodes.map((n, i) => <DiagramNode key={n.label} x={BOTTOM[i].x} y={BOTTOM[i].y} {...n} />)}
      {chaosNodes.map((n, i) => <DiagramNode key={n.label} x={RIGHT[i].x} y={RIGHT[i].y} tone="chaos" {...n} />)}
    </svg>
  )
}

function WithDiagram() {
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto">
      <defs>
        <marker id="khArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#f97316" />
        </marker>
      </defs>

      <ZoneLabel x={600} y={30}>CAPTURE</ZoneLabel>
      <ZoneLabel x={40} y={400} anchor="start">DAILY REALITY</ZoneLabel>
      <ZoneLabel x={600} y={775}>TOOLS YOU REACH FOR</ZoneLabel>
      <ZoneLabel x={1160} y={130} anchor="end">WITH KHELIT</ZoneLabel>

      {/* inbound: sources -> hub, plain */}
      <g stroke="#cbd5e1" strokeWidth="2.5" fill="none">
        {TOP.map((p, i) => <path key={`t${i}`} d={connector(p.x, p.y + 32, HUB.x, HUB.y - 72)} />)}
        {LEFT.map((p, i) => <path key={`l${i}`} d={connector(p.x + 85, p.y, HUB.x - 72, HUB.y)} />)}
        {BOTTOM.map((p, i) => <path key={`b${i}`} d={connector(p.x, p.y - 32, HUB.x, HUB.y + 72)} />)}
      </g>

      {/* outbound: hub -> results, animated flow */}
      <g stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" markerEnd="url(#khArrow)">
        {RIGHT.map((p, i) => (
          <path key={`r${i}`} className="kh-flow" d={connector(HUB.x + 72, HUB.y, p.x - 90, p.y)} />
        ))}
      </g>

      {captureNodes.map((n, i) => <DiagramNode key={n.label} x={TOP[i].x} y={TOP[i].y} {...n} />)}
      {realityNodes.map((n, i) => <DiagramNode key={n.label} x={LEFT[i].x} y={LEFT[i].y} {...n} />)}
      {channelNodes.map((n, i) => <DiagramNode key={n.label} x={BOTTOM[i].x} y={BOTTOM[i].y} {...n} />)}
      {resultNodes.map((n, i) => <DiagramNode key={n.label} x={RIGHT[i].x} y={RIGHT[i].y} tone="result" {...n} />)}

      <foreignObject x={HUB.x - 72} y={HUB.y - 72} width={144} height={144}>
        <div className="w-full h-full rounded-full bg-blue-600 shadow-lg shadow-blue-600/30 flex flex-col items-center justify-center gap-1.5 border-4 border-white relative overflow-hidden">
          <KMark size={34} ring />
          <span className="text-white text-[13px] font-extrabold tracking-wide">Khelit</span>
        </div>
      </foreignObject>
    </svg>
  )
}

function DiagramSection() {
  const [withKhelit, setWithKhelit] = useState(true)

  return (
    <section id="diagram" className="py-24 bg-white border-y border-slate-100">
      <style>{`
        @keyframes khDash { to { stroke-dashoffset: -24; } }
        .kh-flow { stroke-dasharray: 6 8; animation: khDash 1s linear infinite; }
      `}</style>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">One Academy, Two Realities</p>
          <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">The same day. A completely different outcome.</h2>
          <p className="text-slate-500 max-w-xl mx-auto text-base">
            Trials still come from Instagram and walk-ins. Fees still get paid over WhatsApp and UPI.
            What changes is what happens to all of it after.
          </p>
        </div>

        <div className="flex justify-center mb-10">
          <div className="relative inline-flex bg-slate-100 rounded-full p-1 border border-slate-200">
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-full shadow transition-transform duration-300 ease-out"
              style={{ transform: withKhelit ? 'translateX(calc(100% + 8px))' : 'translateX(0)' }}
            />
            <button
              onClick={() => setWithKhelit(false)}
              className={`relative z-10 px-6 py-2.5 text-sm font-bold rounded-full transition-colors ${!withKhelit ? 'text-slate-900' : 'text-slate-500'}`}
            >
              WITHOUT KHELIT
            </button>
            <button
              onClick={() => setWithKhelit(true)}
              className={`relative z-10 px-6 py-2.5 text-sm font-bold rounded-full transition-colors ${withKhelit ? 'text-orange-600' : 'text-slate-500'}`}
            >
              WITH KHELIT
            </button>
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 px-4">
          <div className="min-w-[960px] relative">
            <div className={`transition-opacity duration-300 ${withKhelit ? 'opacity-0 absolute inset-0 pointer-events-none' : 'opacity-100'}`}>
              <WithoutDiagram />
            </div>
            <div className={`transition-opacity duration-300 ${withKhelit ? 'opacity-100' : 'opacity-0 absolute inset-0 pointer-events-none'}`}>
              <WithDiagram />
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-4 md:hidden">← swipe to see the full diagram →</p>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Device showcase — laptop / tablet / phone, each showing a faithful mini
// recreation of a real screen (Owner Dashboard, Attendance list, Student
// stats), not a generic "browser window with colored boxes."
// ─────────────────────────────────────────────────────────────────────────
function ScreenChrome({ children, className = '' }) {
  return <div className={`bg-white overflow-hidden ${className}`}>{children}</div>
}

function DeviceShowcase() {
  return (
    <div className="relative mx-auto" style={{ width: '100%', maxWidth: 640, height: 420 }}>
      {/* Laptop — Owner Dashboard */}
      <div className="absolute left-0 top-4 w-[62%] z-10">
        <div className="bg-slate-950 rounded-t-xl p-2 border border-slate-800 shadow-2xl">
          <ScreenChrome className="rounded-md aspect-[16/10] p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black text-slate-800">Owner Dashboard</span>
              <div className="w-5 h-5 rounded-full bg-blue-600" />
            </div>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {[
                { icon: CreditCard, label: '6 overdue', tone: 'bg-red-50 text-red-600' },
                { icon: UserX,      label: '4 not attending', tone: 'bg-slate-100 text-slate-500' },
                { icon: UserPlus,   label: '3 follow-ups', tone: 'bg-amber-50 text-amber-600' },
              ].map(k => (
                <div key={k.label} className={`rounded p-1.5 ${k.tone}`}>
                  <k.icon size={10} />
                  <p className="text-[7px] font-bold mt-1 leading-tight">{k.label}</p>
                </div>
              ))}
            </div>
            <div className="bg-slate-50 rounded h-14 flex items-end gap-0.5 p-1.5">
              {[40,65,45,80,55,90,70,60,85,75].map((h,i) => (
                <div key={i} className="flex-1 bg-blue-500 rounded-sm" style={{ height: `${h}%`, opacity: 0.6 + (i%3)*0.15 }} />
              ))}
            </div>
          </ScreenChrome>
        </div>
        <div className="h-2.5 bg-slate-800 rounded-b-xl mx-1" />
      </div>

      {/* Tablet — Attendance */}
      <div className="absolute right-6 top-0 w-[34%] rotate-[6deg] z-20">
        <div className="bg-slate-950 rounded-2xl p-1.5 border-4 border-slate-900 shadow-2xl">
          <ScreenChrome className="rounded-lg aspect-[3/4] p-2 flex flex-col">
            <span className="text-[8px] font-black text-slate-800">Attendance — Today</span>
            <div className="mt-2 space-y-1.5">
              {[
                { n: 'Aarav K.', s: true }, { n: 'Diya S.', s: true },
                { n: 'Kabir M.', s: false }, { n: 'Riya P.', s: true },
                { n: 'Vihaan T.', s: true }, { n: 'Meera J.', s: true },
              ].map(r => (
                <div key={r.n} className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-blue-100 shrink-0" />
                  <div className="h-1.5 bg-slate-100 rounded flex-1" />
                  <span className={`text-[6px] font-bold px-1 rounded ${r.s ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                    {r.s ? 'IN' : '—'}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-auto rounded bg-slate-50 p-1.5 flex items-center justify-between">
              <span className="text-[6px] font-bold text-slate-500">Present today</span>
              <span className="text-[7px] font-black text-slate-800">32 / 38</span>
            </div>
          </ScreenChrome>
        </div>
      </div>

      {/* Phone — Student stats */}
      <div className="absolute right-0 bottom-0 w-[26%] rotate-[-7deg] z-30">
        <div className="bg-slate-950 rounded-[1.6rem] p-1.5 border-4 border-slate-900 shadow-2xl">
          <ScreenChrome className="rounded-[1.2rem] aspect-[9/19] p-2 flex flex-col">
            <span className="text-[7px] font-black text-slate-800">My Progress</span>
            <div className="mt-2 rounded-lg bg-blue-50 p-1.5 text-center">
              <p className="text-[13px] font-black text-blue-600 leading-none">18</p>
              <p className="text-[5.5px] font-bold text-blue-400 mt-0.5">DAY STREAK</p>
            </div>
            <div className="mt-1.5 rounded-lg bg-emerald-50 p-1.5 flex items-center justify-between">
              <span className="text-[6px] font-bold text-emerald-700">Fees</span>
              <span className="text-[6px] font-black text-emerald-700">Paid ✓</span>
            </div>
            <div className="mt-1.5 rounded-lg bg-violet-50 p-1.5">
              <div className="flex items-center gap-1 mb-1">
                <Sparkles size={7} className="text-violet-500" />
                <span className="text-[5.5px] font-black text-violet-500 tracking-wide">AI COACH TIP</span>
              </div>
              <div className="h-1 bg-violet-100 rounded w-full mb-0.5" />
              <div className="h-1 bg-violet-100 rounded w-4/5" />
            </div>
            <div className="mt-1.5 space-y-1">
              {[1,2].map(i => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-slate-100 shrink-0" />
                  <div className="h-1 bg-slate-100 rounded flex-1" />
                </div>
              ))}
            </div>
          </ScreenChrome>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Static content for the rest of the page — every item below maps to a
// real route/feature in this codebase (see src/App.jsx), not marketing filler.
// ─────────────────────────────────────────────────────────────────────────
const painPoints = [
  'A fee reminder buried three scrolls up in the parents’ WhatsApp group',
  'No idea which of your students actually paid this month',
  'A paper attendance register nobody’s opened since last term',
  'A student who quietly stopped coming two months ago still counted in this month’s revenue forecast',
]

const scoreStats = [
  { value: '4',  label: 'Dedicated Portals' },
  { value: '13', label: 'WhatsApp Automations', accent: true },
  { value: '0',  label: 'Spreadsheets Needed' },
  { value: '100%', label: 'Branch Data Isolation' },
]

const features = [
  { icon: Users,      title: 'Student & Batch Management',    desc: 'Full profiles, join codes, multi-batch enrolment, coaches, and parent contacts — organized by sport and branch, not by memory.' },
  { icon: MapPin,      title: 'Shared Ground & Slot Capacity', desc: 'Batches training on the same ground get one real, auto-derived daily ceiling — no more double-booking a pitch three coaches think is theirs.' },
  { icon: CalendarClock, title: 'Alternate & Daily Schedules', desc: 'Training pattern is a real field on the batch, not a guess — fee plans and the student form both key off it automatically.' },
  { icon: ScanLine,   title: 'QR Gate & Staff Attendance',     desc: 'One printed code at the entrance for students, a separate scan-in for staff. Present, timestamped, tamper-proof — no register, no arguments.' },
  { icon: CreditCard, title: 'Partial Payments & Proration',   desc: 'Mid-month joins are billed by the day, not the month. A parent paying less than the full fee leaves a tracked Due balance — never just a note in a chat.' },
  { icon: Receipt,    title: 'Payment Trail & Collection Sheet', desc: 'A money-first audit view of every rupee in and out, plus a printable daily collection sheet for reconciling cash at day’s end.' },
  { icon: UserPlus,   title: 'Trial Pipeline & Public Join Page', desc: 'Every trial from Instagram, a walk-in, a referral, or your own /join link lands in one list — followed up until it converts, not forgotten.' },
  { icon: MessageCircle, title: 'WhatsApp Automation',         desc: '13 built-in automations — fee reminders, payment receipts, trial follow-ups — fire themselves on schedule. You approve the templates once.' },
  { icon: UserX,      title: 'Not Attending & Inactive Tracking', desc: 'A student who’s stopped showing up gets pulled out of your revenue forecast and overdue total automatically — reviewed by you, not hidden, not auto-charged.' },
  { icon: BarChart3,  title: 'Reports & Analytics',            desc: 'Revenue, ageing buckets, attendance trends, and batch-by-batch collection at a glance — the numbers your Excel sheet was supposed to give you.' },
  { icon: Building2,  title: 'Multi-Sport & Multi-Branch',     desc: 'Run football, cricket, and tennis from one account. Every branch’s students, staff, and fee data stays fully isolated from the others.' },
  { icon: ShieldCheck, title: 'Staff Permissions, Down to the Action', desc: 'Coaches see their students and schedule. Office staff see exactly what you allow — payment data stays owner-controlled by default.' },
  { icon: Award,      title: 'Skill Assessments + AI Analysis', desc: 'Score a student on real criteria, and get a specific, per-student written breakdown of what to work on next — not a generic percentage.' },
  { icon: Database,   title: 'Backups & Data Ownership',       desc: 'Export your students, attendance, and payment history any time. Your data isn’t held hostage by the platform.' },
]

const portals = [
  { badge: 'Owner',         title: 'Full Control',         desc: 'The complete academy hub — every branch, every rupee, every report.', points: ['Multi-sport & multi-branch dashboard', 'Revenue, ageing & overdue reports', 'Staff permissions & roles', 'Trial pipeline oversight', 'Inventory, turf booking & backups'] },
  { badge: 'Coach & Staff', title: 'Built for the Ground',  desc: 'Coaches and office staff see exactly what their role needs — nothing more.', points: ['Roster & attendance in seconds', 'Skill assessments & session plans', 'Own schedule & leave requests', 'QR scan-in for staff', 'Permission-gated — not guesswork'] },
  { badge: 'Parent',        title: 'No More Office Calls',  desc: 'Parents see what’s happening without messaging the front desk.', points: ['Payment receipts & Due balances', 'Attendance updates', 'Staff notices & announcements', 'One login covers every sibling'] },
  { badge: 'Student',       title: 'Progress, In Their Pocket', desc: 'Players track their own journey from their own phone.', points: ['Attendance history & streaks', 'Payment status', 'AI performance breakdown', 'Self QR check-in'] },
]

const steps = [
  { step: '01', title: 'Create your academy',       desc: 'Sign up, name your academy, and pick your first sport. Takes minutes, not a training session.' },
  { step: '02', title: 'Add students & batches',    desc: 'Import existing students or add them one by one. Set up batches with coaches, timings, ground capacity, and fees.' },
  { step: '03', title: 'Invite your staff',         desc: 'Coaches get their own portal. Office staff get exactly the permissions you choose — and no more.' },
  { step: '04', title: 'Go live',                   desc: 'Print the gate QR, share student codes, and start tracking attendance and fees from day one.' },
]

// NOTE: placeholder pricing — not tied to a live billing system yet.
// Confirm real numbers before this goes to production.
const plans = [
  { name: 'Starter', price: '₹999',   period: '/month', students: 'Single branch, one sport', features: ['Student & attendance', 'Partial payment tracking', 'QR gate attendance', 'Trial pipeline', 'Coach & student portals'], popular: false },
  { name: 'Growth',  price: '₹2,499', period: '/month', students: 'Multi-branch, multi-sport', features: ['Everything in Starter', 'Unlimited branches & sports', 'WhatsApp automation', 'Full reports & analytics', 'Priority support'], popular: true },
  { name: 'Enterprise', price: 'Custom', period: '', students: 'Large or multi-city academies', features: ['Everything in Growth', 'Dedicated onboarding', 'Custom integrations', 'Account manager'], popular: false },
]

// Why Khelit — a direct comparison, not a vague "we're the best" claim.
// Rows are things Khelit genuinely does that a chat-app-plus-spreadsheet
// setup or an off-the-shelf, sport-agnostic CRM/ERP realistically doesn't.
const comparisonRows = [
  { label: 'Built specifically for sports academies', chat: false, generic: false, khelit: true },
  { label: 'QR gate attendance with timestamps',      chat: false, generic: false, khelit: true },
  { label: 'Partial payments tracked as a real Due balance', chat: 'partial', generic: 'partial', khelit: true },
  { label: 'Ground/slot capacity shared across batches', chat: false, generic: false, khelit: true },
  { label: 'Inactive students auto-excluded from revenue forecasts', chat: false, generic: false, khelit: true },
  { label: 'WhatsApp reminders that send themselves', chat: false, generic: 'partial', khelit: true },
  { label: 'Dedicated apps for owner, coach, parent & student', chat: false, generic: false, khelit: true },
  { label: 'Per-branch data isolation, multi-sport', chat: false, generic: 'partial', khelit: true },
  { label: 'AI performance write-up per assessment', chat: false, generic: false, khelit: true },
  { label: 'Your data, exportable any time',          chat: 'partial', generic: 'partial', khelit: true },
]

function ComparisonCell({ state }) {
  if (state === true)  return <CheckCircle size={18} className="text-orange-500 mx-auto" />
  if (state === false) return <XCircle size={18} className="text-slate-300 mx-auto" />
  return <MinusCircle size={18} className="text-slate-300 mx-auto" />
}

const faqs = [
  { q: 'How does QR gate attendance actually work?', a: 'You print one Gate QR code and place it at your academy entrance. Each student scans it once with their phone — it marks them present with a timestamp instantly. No app install needed to scan; it works from any mobile browser.' },
  { q: 'Can coaches see fee or payment data?',        a: 'Not unless you explicitly allow it. Payment data is owner-controlled by default. Every coach and staff permission is configurable — you decide what each person can see and do.' },
  { q: 'What happens when a student stops attending but hasn’t formally left?', a: 'Khelit tracks it: an Active student with almost no attendance for a couple of months gets pulled into a separate "Not Attending" view instead of quietly inflating your revenue forecast or overdue total. Nothing is auto-charged or auto-suspended — you review and decide.' },
  { q: 'Can I run multiple sports or branches from one account?', a: 'Yes. You can run football, cricket, tennis, or any combination from a single login, with each branch’s students, staff, and fee data kept fully isolated from the others.' },
  { q: 'Does this work on a phone, or do I need a laptop?', a: 'The owner dashboard, coach portal, and student app are all built mobile-first. The same account also works as a native Android app and a Windows/Mac desktop app.' },
  { q: 'What happens to my data if I stop using Khelit?', a: 'It’s yours. Student records, attendance logs, and payment history can be exported at any time — your data isn’t held hostage by the platform.' },
]

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 py-5 text-left"
      >
        <span className="font-semibold text-slate-900 text-[15px]">{q}</span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180 text-orange-600' : ''}`} />
      </button>
      <div className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr] pb-5' : 'grid-rows-[0fr]'}`} style={{ display: 'grid' }}>
        <div className="overflow-hidden">
          <p className="text-sm text-slate-500 leading-relaxed pr-8">{a}</p>
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-canvas" style={{ fontFamily: "'Plus Jakarta Sans', Inter, system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Oswald:wght@500;600;700&display=swap');`}</style>
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Logo />
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-slate-600 hover:text-slate-900 transition">Features</a>
            <a href="#diagram" className="text-sm text-slate-600 hover:text-slate-900 transition">Why Khelit</a>
            <a href="#compare" className="text-sm text-slate-600 hover:text-slate-900 transition">Compare</a>
            <a href="#portals" className="text-sm text-slate-600 hover:text-slate-900 transition">Portals</a>
            <a href="#pricing" className="text-sm text-slate-600 hover:text-slate-900 transition">Pricing</a>
            <a href="#faq" className="text-sm text-slate-600 hover:text-slate-900 transition">FAQ</a>
            <Link to="/login" className="text-sm text-slate-600 hover:text-slate-900 transition">Login</Link>
            <Link to="/signup" className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg transition shadow-sm shadow-orange-500/20">
              Start Free
            </Link>
          </div>
          <button className="md:hidden p-2 text-slate-700" onClick={() => setMenuOpen(o => !o)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-3">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">Features</a>
            <a href="#diagram" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">Why Khelit</a>
            <a href="#compare" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">Compare</a>
            <a href="#portals" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">Portals</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">Pricing</a>
            <a href="#faq" onClick={() => setMenuOpen(false)} className="block text-sm text-slate-700">FAQ</a>
            <Link to="/login" className="block text-sm text-slate-700">Login</Link>
            <Link to="/signup" className="block text-center bg-orange-500 text-white font-bold text-sm py-2.5 rounded-lg">Start Free</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-slate-900 text-white">
        <TrackLines />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(37,99,235,0.28),transparent_60%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28">
          <div className="max-w-4xl">
            <Reveal>
              <div className="inline-flex items-center gap-2 bg-orange-500/15 border border-orange-400/30 rounded-full px-4 py-1.5 mb-8">
                <span className="w-2 h-2 bg-orange-400 rounded-full" />
                <span className="text-xs font-bold text-orange-300 uppercase tracking-wide">Built for academies running on WhatsApp and hope</span>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h1
                className="text-4xl md:text-6xl font-bold leading-[1.05] mb-6 uppercase"
                style={{ fontFamily: "'Oswald', 'Plus Jakarta Sans', sans-serif" }}
              >
                Coach the team.<br />
                Let <span className="text-orange-400">Khelit</span> coach the paperwork.
              </h1>
            </Reveal>
            <Reveal delay={140}>
              <p className="text-lg md:text-xl text-slate-300 mb-10 max-w-2xl leading-relaxed">
                Students, batches, attendance, fees, trials, and staff — in one system built for
                how Indian sports academies actually run, not a generic CRM with a cricket bat icon.
              </p>
            </Reveal>
            <Reveal delay={200}>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/signup" className="inline-flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg shadow-orange-500/30 active:scale-95">
                  Start Free
                  <ArrowRight size={18} />
                </Link>
                <a href="#compare" className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold text-base px-8 py-4 rounded-xl border border-white/20 transition">
                  See Why We're Different
                </a>
              </div>
            </Reveal>
            <Reveal delay={260}>
              <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-slate-400">
                {['No credit card to start', 'Web, Android & desktop', 'Setup in minutes'].map(t => (
                  <div key={t} className="flex items-center gap-1.5">
                    <CheckCircle size={14} className="text-orange-400" />
                    {t}
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>

        {/* Device showcase — real-screen recreations, not a generic browser-window mockup */}
        <Reveal delay={320}>
          <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pb-16">
            <DeviceShowcase />
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              <span className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Globe size={13} className="text-emerald-400" /> Web — Live
              </span>
              <span className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Monitor size={13} className="text-emerald-400" /> Windows & Mac — Live
              </span>
              <span className="inline-flex items-center gap-1.5 bg-orange-500/10 border border-orange-400/30 text-orange-300 text-xs font-semibold px-3 py-1.5 rounded-full">
                <Smartphone size={13} /> Android — Coming Soon to Google Play
              </span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Scoreboard stat strip */}
      <section className="relative bg-slate-950 py-10 overflow-hidden">
        <TrackLines className="opacity-60" />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-2 md:grid-cols-4 gap-y-8 gap-x-4">
          {scoreStats.map(s => (
            <Reveal key={s.label}><ScoreStat {...s} /></Reveal>
          ))}
        </div>
      </section>

      {/* Problem-agitation strip */}
      <section className="bg-slate-50 border-b border-slate-100 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-4">Sound familiar?</p>
          <div className="grid sm:grid-cols-2 gap-4 text-left max-w-3xl mx-auto">
            {painPoints.map(p => (
              <Reveal key={p} className="flex items-start gap-3 bg-white border border-slate-100 rounded-xl p-4">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <span className="text-sm text-slate-700 leading-relaxed">{p}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Without/With diagram */}
      <DiagramSection />

      {/* Features */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">Everything You Need</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">
              Replace the group chat, the spreadsheet,<br />and the paper register
            </h2>
            <p className="text-slate-500 max-w-xl mx-auto text-base">Real features built for how Indian sports academies actually run — every one of these is a live screen, not a roadmap promise.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 60} className="border border-slate-100 rounded-2xl p-6 hover:border-orange-200 hover:shadow-md transition-all group">
                <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-orange-50 transition">
                  <f.icon size={22} className="text-blue-600 group-hover:text-orange-600 transition" />
                </div>
                <h3 className="font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* AI Coach Analysis spotlight — a real, differentiated feature, not a generic "AI" bullet */}
      <section className="relative py-24 bg-slate-950 text-white overflow-hidden">
        <TrackLines className="opacity-40" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <p className="text-xs font-bold text-violet-400 uppercase tracking-widest mb-3">Not Just a Spreadsheet Replacement</p>
            <h2 className="text-3xl md:text-4xl font-black mb-5">
              Every student gets an <span className="text-violet-400">AI performance breakdown</span>
            </h2>
            <p className="text-slate-400 text-base leading-relaxed mb-6 max-w-lg">
              After each assessment, Khelit turns a student’s skill scores and their coach’s
              own notes into a short, specific write-up of what they’re good at and exactly
              what to work on next — not a generic score, an actual analysis.
            </p>
            <ul className="space-y-3">
              {[
                'Built from real skill assessment data, not guesswork',
                'Weighs the coach’s own notes as ground truth',
                'A fresh read for every assessment, every student',
              ].map(t => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-slate-300">
                  <Sparkles size={15} className="text-violet-400 shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-3xl overflow-hidden max-w-md mx-auto"
              style={{ background: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)', boxShadow: '0 8px 40px rgba(99,102,241,0.32)' }}>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles size={15} className="text-violet-300" />
                  <p className="text-[10px] font-black text-violet-400 uppercase tracking-widest leading-none">AI Coach Analysis</p>
                </div>
                <p className="text-white text-sm leading-relaxed mb-4">
                  <strong className="text-violet-300">Strong first touch, needs pace off the ball.</strong>{' '}
                  Aarav’s ball control jumped a full tier this month — the next step is closing
                  space faster without the ball. Two short sprint-repeat drills a week would
                  turn that “good touch” into “can’t be caught.”
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {['Ball Control ↑', 'Off-ball Movement', 'Sprint Repeats'].map(t => (
                    <span key={t} className="text-[10px] font-semibold text-violet-200 bg-violet-500/15 border border-violet-400/20 rounded-full px-2.5 py-1">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Why Khelit — direct comparison table */}
      <section id="compare" className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">The Honest Comparison</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">What you’re actually choosing between</h2>
            <p className="text-slate-500 max-w-xl mx-auto text-base">
              Not a made-up "us vs. them" — this is WhatsApp + Excel + a paper register, and a
              generic sport-agnostic CRM, against what Khelit actually does.
            </p>
          </div>
          <Reveal className="overflow-x-auto rounded-2xl border border-slate-100 shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-5 py-4 font-bold text-slate-500 text-xs uppercase tracking-wide">Capability</th>
                  <th className="px-4 py-4 font-bold text-slate-500 text-xs uppercase tracking-wide text-center w-36">WhatsApp + Excel + Register</th>
                  <th className="px-4 py-4 font-bold text-slate-500 text-xs uppercase tracking-wide text-center w-36">Generic CRM / ERP</th>
                  <th className="px-4 py-4 font-black text-orange-600 text-xs uppercase tracking-wide text-center w-32 bg-orange-50/60">Khelit</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((r, i) => (
                  <tr key={r.label} className={i % 2 ? 'bg-white' : 'bg-slate-50/40'}>
                    <td className="px-5 py-4 text-slate-700 font-medium">{r.label}</td>
                    <td className="px-4 py-4"><ComparisonCell state={r.chat} /></td>
                    <td className="px-4 py-4"><ComparisonCell state={r.generic} /></td>
                    <td className="px-4 py-4 bg-orange-50/60"><ComparisonCell state={r.khelit} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
          <p className="text-center text-xs text-slate-400 mt-4">
            <MinusCircle size={11} className="inline -mt-0.5 mr-1" />
            = partially, usually with manual setup or a workaround.
          </p>
        </div>
      </section>

      {/* Portals */}
      <section id="portals" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">Four Roles, One Platform</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">Every role gets their own view</h2>
            <p className="text-slate-500 mt-3 max-w-xl mx-auto">Not a one-size-fits-all interface — owner, coach, parent, and student each see exactly what they need.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {portals.map((p, i) => (
              <Reveal key={p.badge} delay={i * 80} className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full mb-4">{p.badge}</span>
                <h3 className="font-bold text-slate-900 text-lg mb-1.5">{p.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-4">{p.desc}</p>
                <ul className="space-y-2">
                  {p.points.map(pt => (
                    <li key={pt} className="flex items-start gap-2 text-xs text-slate-600">
                      <CheckCircle size={13} className="text-blue-500 shrink-0 mt-0.5" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">Simple Setup</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">Up and running before your next session</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {steps.map((s, i) => (
              <Reveal key={s.step} delay={i * 90} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-full w-full h-px bg-slate-200 -translate-y-px z-0" />
                )}
                <div className="relative bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                  <div
                    className="text-4xl font-bold text-slate-100 mb-3"
                    style={{ fontFamily: "'Oswald', 'Plus Jakarta Sans', sans-serif" }}
                  >{s.step}</div>
                  <h3 className="font-bold text-slate-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">Simple Pricing</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">Start small. Scale with your academy.</h2>
            <p className="text-slate-500 mt-3">No hidden fees. Cancel anytime.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((p, i) => (
              <Reveal key={p.name} delay={i * 100} className={`rounded-2xl p-6 border-2 relative h-full ${p.popular ? 'bg-slate-900 border-slate-900 text-white shadow-xl shadow-slate-900/20' : 'bg-white border-slate-100'}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>
                )}
                <h3 className={`font-bold text-lg mb-1 ${p.popular ? 'text-white' : 'text-slate-900'}`}>{p.name}</h3>
                <p className={`text-xs mb-4 ${p.popular ? 'text-slate-400' : 'text-slate-500'}`}>{p.students}</p>
                <div className="flex items-end gap-1 mb-6">
                  <span className={`text-4xl font-black ${p.popular ? 'text-white' : 'text-slate-900'}`}>{p.price}</span>
                  <span className={`text-sm mb-1 ${p.popular ? 'text-slate-400' : 'text-slate-400'}`}>{p.period}</span>
                </div>
                <ul className="space-y-2.5 mb-8">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5">
                      <CheckCircle size={14} className={p.popular ? 'text-orange-400' : 'text-orange-500'} />
                      <span className={`text-sm ${p.popular ? 'text-slate-300' : 'text-slate-600'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signup"
                  className={`block text-center py-3 px-4 rounded-xl font-bold text-sm transition active:scale-95 ${
                    p.popular ? 'bg-orange-500 text-white hover:bg-orange-400' : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {p.name === 'Enterprise' ? 'Contact Sales' : 'Get Started'}
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-bold text-orange-600 uppercase tracking-widest mb-3">Questions</p>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900">Got questions?</h2>
          </div>
          <Reveal className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6">
            {faqs.map(f => <FaqItem key={f.q} {...f} />)}
          </Reveal>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="relative py-20 bg-slate-900 text-white overflow-hidden">
        <TrackLines className="opacity-40" />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-4">
            Your academy, <span className="text-orange-400">finally in one place</span>
          </h2>
          <p className="text-slate-400 mb-8">Stop reconciling three tools every evening. Start running one.</p>
          <Link to="/signup" className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white font-bold text-lg px-10 py-4 rounded-xl transition shadow-lg shadow-orange-500/30 active:scale-95">
            Create Your Academy Free
            <ArrowRight size={20} />
          </Link>
          <p className="text-xs text-slate-500 mt-4">No credit card required to get started</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo dark />
          <p className="text-sm text-slate-500">© 2026 Khelit. Built for coaches who mean business.</p>
          <div className="flex gap-6 text-sm text-slate-500">
            <Link to="/login" className="hover:text-white transition">Login</Link>
            <Link to="/signup" className="hover:text-white transition">Sign Up</Link>
            <a href="/privacy.html" className="hover:text-white transition">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
