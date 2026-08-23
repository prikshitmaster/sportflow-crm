import { useState, useEffect, useMemo } from 'react'
import {
  Phone, CreditCard, CalendarCheck, Award, Clock, FileText, Activity,
  IndianRupee, CalendarDays, ChevronRight, ChevronLeft, AlertTriangle,
  MessageCircle, Target, Layers, ShieldAlert, Sparkles,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { isOutstanding, firstOfMonthIso, daysOverdue } from '../lib/studentRules'
import { SPORT_CATEGORIES, FOOTBALL_CATEGORIES, getOverallScore, getCategoryAvg, getTier } from '../lib/performance'
import StudentDocumentsCard from '../components/StudentDocumentsCard'
import {
  fmtMoney, fmtDate, monthLabel, monthsOwed,
  Pill, Avatar, Tile, Section, Empty, KV, ATT_TONE, ATT_FILL,
} from './detail/ui'

// ── Student 360 — the tabbed detail view behind /detail/student/:id ────────
// Read-only by design: it composes what AppContext already holds with three
// targeted fetches (attendance months, assessment history, documents). Quick
// actions navigate to the existing flows rather than duplicating their modals.

const TABS = [
  { id: 'overview',    label: 'Overview',    icon: Activity },
  { id: 'fees',        label: 'Fees',        icon: CreditCard },
  { id: 'attendance',  label: 'Attendance',  icon: CalendarDays },
  { id: 'performance', label: 'Performance', icon: Award },
  { id: 'profile',     label: 'Profile',     icon: FileText },
]

const countAttendance = (map) => {
  const c = { Present: 0, Absent: 0, Late: 0, Leave: 0 }
  Object.values(map || {}).forEach(st => { if (c[st] != null) c[st] += 1 })
  const total = c.Present + c.Absent + c.Late + c.Leave
  const attended = c.Present + c.Late
  return { ...c, total, pct: total ? Math.round((attended / total) * 100) : null }
}

export default function StudentDetail({ id, students, payments, batches, staff, goDetail }) {
  const { batchEnrolments, hasPermission, role } = useApp()
  const student = students.find(s => String(s.id) === String(id))

  const [tab, setTab] = useState('overview')
  // { 'YYYY-M': { dayNumber: 'Present' } } — filled lazily, one month per fetch
  const [attMonths, setAttMonths] = useState({})
  const [assessments, setAssessments] = useState(null)
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })

  const now = new Date()
  const thisKey = `${now.getFullYear()}-${now.getMonth()}`
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevKey = `${prevDate.getFullYear()}-${prevDate.getMonth()}`

  // Overview needs only the two most recent months; the Attendance tab pulls
  // more as the user pages back, so the page stays cheap on first paint.
  useEffect(() => {
    if (!student) return
    ;[[now.getFullYear(), now.getMonth()], [prevDate.getFullYear(), prevDate.getMonth()]]
      .forEach(([y, m]) => loadMonth(y, m))
    db.fetchStudentAssessments(student.id).then(rows => setAssessments(rows || [])).catch(() => setAssessments([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id])

  // Paging the calendar pulls whichever month came into view.
  useEffect(() => {
    if (student) loadMonth(cursor.y, cursor.m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.y, cursor.m, student?.id])

  async function loadMonth(y, m) {
    const key = `${y}-${m}`
    setAttMonths(prev => (key in prev ? prev : { ...prev, [key]: 'loading' }))
    try {
      const res = await db.fetchAttendanceForStudents(y, m, [student.id])
      setAttMonths(prev => ({ ...prev, [key]: res[student.id] || {} }))
    } catch { setAttMonths(prev => ({ ...prev, [key]: {} })) }
  }

  const myPayments = useMemo(
    () => payments
      .filter(p => String(p.studentId) === String(id))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [payments, id])

  const batch  = batches.find(b => String(b.id) === String(student?.batchId))
              || batches.find(b => b.name === student?.batch)
  const coach  = batch && staff.find(s => s.name?.trim().toLowerCase() === batch.coach?.trim().toLowerCase())

  // Additional batches come from the enrolment join, not students.batchId.
  const extraBatches = useMemo(() => {
    if (!student) return []
    const ids = new Set((batchEnrolments || [])
      .filter(e => String(e.studentId ?? e.student_id) === String(student.id))
      .map(e => String(e.batchId ?? e.batch_id)))
    return batches.filter(b => ids.has(String(b.id)) && String(b.id) !== String(student.batchId))
  }, [batchEnrolments, batches, student])

  if (!student) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
        <p className="text-sm text-gray-500">Student not found in the current view.</p>
      </div>
    )
  }

  const firstOfMonth = firstOfMonthIso()
  const outstanding  = isOutstanding(student, firstOfMonth)
  const owed         = outstanding ? monthsOwed(student.paidTill, firstOfMonth) : 0
  const owedAmount   = owed * Number(student.fees || 0)
  const overdueDays  = daysOverdue(student)
  // Partial payments (migration 0172) leave a Due balance on the payment row.
  const dueBalance   = myPayments.reduce((sum, p) => sum + Number(p.dueAmount || 0), 0)
  const thisMonthAtt = attMonths[thisKey] && attMonths[thisKey] !== 'loading' ? countAttendance(attMonths[thisKey]) : null

  const ctx = {
    student, myPayments, batch, coach, extraBatches, outstanding, owed, owedAmount,
    overdueDays, dueBalance, attMonths, thisKey, prevKey, assessments, cursor, setCursor,
    goDetail, hasPermission, role, countAttendance,
  }

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start">
      <IdentityRail {...ctx} />

      <div className="flex-1 min-w-0 w-full space-y-5">
        <div className="bg-white rounded-2xl border border-gray-100 px-2 flex overflow-x-auto no-scrollbar">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition ${
                tab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview'    && <OverviewTab    {...ctx} thisMonthAtt={thisMonthAtt} />}
        {tab === 'fees'        && <FeesTab        {...ctx} />}
        {tab === 'attendance'  && <AttendanceTab  {...ctx} />}
        {tab === 'performance' && <PerformanceTab {...ctx} />}
        {tab === 'profile'     && <ProfileTab     {...ctx} />}
      </div>
    </div>
  )
}

// ── Left rail — identity + money + actions, always in view ────────────────
function IdentityRail({ student, batch, coach, extraBatches, outstanding, owedAmount, owed, dueBalance, goDetail }) {
  const waPhone = (student.parentPhone || student.phone || '').replace(/\D/g, '')
  return (
    <aside className="w-full lg:w-72 flex-shrink-0 lg:sticky lg:top-4 space-y-3">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex lg:flex-col lg:items-center gap-4 lg:text-center">
          <Avatar name={student.name} photoUrl={student.photoUrl} size="w-20 h-20 text-2xl" />
          <div className="min-w-0">
            <h2 className="text-lg font-black text-gray-900 leading-tight truncate">{student.name}</h2>
            <p className="text-xs text-gray-400 font-semibold mt-0.5">{student.studentCode}</p>
            <div className="mt-2 flex lg:justify-center gap-1.5 flex-wrap">
              <Pill>{student.status}</Pill>
              {student.fromTrial && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-50 text-violet-600">From trial</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 space-y-2.5 text-sm">
          <RailRow label="Sport" value={student.sport || '—'} />
          <RailRow label="Batch" value={
            batch
              ? <button onClick={() => goDetail('batch', batch.id)} className="text-brand-600 font-semibold hover:underline text-right">{batch.name}</button>
              : <span className="text-amber-600 font-semibold">Not assigned</span>
          } />
          {extraBatches.map(b => (
            <RailRow key={b.id} label="Also in" value={
              <button onClick={() => goDetail('batch', b.id)} className="text-brand-600 font-semibold hover:underline text-right">{b.name}</button>
            } />
          ))}
          <RailRow label="Coach" value={
            coach
              ? <button onClick={() => goDetail('coach', coach.id)} className="text-brand-600 font-semibold hover:underline text-right">{coach.name}</button>
              : (batch?.coach || '—')
          } />
          <RailRow label="Training" value={student.trainingType || 'Daily'} />
        </div>
      </div>

      {/* Money state — the single thing a counter person needs at a glance */}
      <div className={`rounded-2xl border p-4 ${
        outstanding || dueBalance > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
      }`}>
        {outstanding || dueBalance > 0 ? (
          <>
            <div className="text-xs font-black uppercase tracking-wide text-red-500">Amount due</div>
            <div className="text-2xl font-black text-red-600 leading-tight mt-1">
              {fmtMoney((outstanding ? owedAmount : 0) + dueBalance)}
            </div>
            <p className="text-xs text-red-500/80 mt-1">
              {outstanding && `${owed} month${owed === 1 ? '' : 's'} unpaid`}
              {outstanding && dueBalance > 0 && ' · '}
              {dueBalance > 0 && `${fmtMoney(dueBalance)} part-payment balance`}
            </p>
          </>
        ) : (
          <>
            <div className="text-xs font-black uppercase tracking-wide text-emerald-600">Fees</div>
            <div className="text-2xl font-black text-emerald-700 leading-tight mt-1">Up to date</div>
            <p className="text-xs text-emerald-600/80 mt-1">Paid till {fmtDate(student.paidTill)}</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {student.phone && (
          <a href={`tel:${student.phone}`}
            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition">
            <Phone size={13} /> Call
          </a>
        )}
        {waPhone && (
          <a href={`https://wa.me/${waPhone.length === 10 ? '91' + waPhone : waPhone}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition">
            <MessageCircle size={13} /> WhatsApp
          </a>
        )}
      </div>
    </aside>
  )
}

const RailRow = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide flex-shrink-0">{label}</span>
    <span className="text-sm font-semibold text-gray-800 text-right truncate">{value}</span>
  </div>
)

// ── Overview ──────────────────────────────────────────────────────────────
function OverviewTab({ student, myPayments, assessments, thisMonthAtt, outstanding, owed, owedAmount,
                       overdueDays, dueBalance, batch, goDetail }) {
  const now = new Date()
  const latest = assessments?.[0]
  const cats = SPORT_CATEGORIES[student.sport] || FOOTBALL_CATEGORIES
  const avg = latest?.scores ? getOverallScore(latest.scores, cats) : null

  // One merged, date-sorted stream so "what happened lately" reads at a glance.
  const activity = useMemo(() => {
    const items = []
    myPayments.slice(0, 6).forEach(p => items.push({
      date: p.date, kind: 'payment', tone: 'bg-emerald-500',
      title: `Paid ${fmtMoney(p.amount)}`,
      sub: `${p.month || ''} · ${p.mode || '—'}${Number(p.dueAmount) > 0 ? ` · ${fmtMoney(p.dueAmount)} due` : ''}`,
    }))
    ;(assessments || []).slice(0, 4).forEach(a => {
      const s = a.scores ? getOverallScore(a.scores, cats) : null
      items.push({
        date: a.assessed_month, kind: 'assessment', tone: 'bg-violet-500',
        title: s != null ? `Assessed ${s}/100` : 'Assessment recorded',
        sub: a.assessed_month || '',
      })
    })
    return items
      .filter(i => i.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 8)
  }, [myPayments, assessments, cats])

  const alerts = []
  if (outstanding)          alerts.push({ tone: 'red',   text: `${fmtMoney(owedAmount)} unpaid — ${owed} month${owed === 1 ? '' : 's'}${overdueDays ? `, ${overdueDays} days overdue` : ''}` })
  if (dueBalance > 0)       alerts.push({ tone: 'red',   text: `${fmtMoney(dueBalance)} part-payment balance outstanding` })
  if (!batch)               alerts.push({ tone: 'amber', text: 'No batch assigned — this student is invisible to coaches' })
  if (student.status === 'Suspended') alerts.push({ tone: 'amber', text: `Suspended${student.suspendedSince ? ` since ${fmtDate(student.suspendedSince)}` : ''}` })
  if (student.accountStatus === 'pending') alerts.push({ tone: 'sky', text: `Portal not activated${student.joinCode ? ` — join code ${student.joinCode}` : ''}` })
  if (String(student.hasMedical || '').toLowerCase() === 'yes' || student.medicalNotes)
    alerts.push({ tone: 'sky', text: `Medical note on file: ${student.medicalNotes || 'see profile'}` })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={IndianRupee} label="Monthly fee" value={fmtMoney(student.fees)}
              sub={`${student.feePlan || 'monthly'} · ${student.trainingType || 'Daily'}`} />
        {/* Only call it overdue when fees are ACTUALLY outstanding. daysOverdue()
            can read 1 the day after paidTill while the month is still covered,
            which otherwise contradicts the ₹0 tile beside it. */}
        <Tile icon={CalendarCheck} label="Paid till" value={fmtDate(student.paidTill)}
              sub={outstanding && overdueDays ? `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue` : 'up to date'}
              tone={outstanding ? 'text-red-600' : 'text-gray-900'} />
        <Tile icon={CreditCard} label="Outstanding"
              value={outstanding || dueBalance > 0 ? fmtMoney(owedAmount + dueBalance) : '₹0'}
              sub={dueBalance > 0 ? `incl. ${fmtMoney(dueBalance)} part-payment` : (outstanding ? `${owed} month${owed === 1 ? '' : 's'}` : 'nothing due')}
              tone={outstanding || dueBalance > 0 ? 'text-red-600' : 'text-emerald-600'} />
        <Tile icon={Activity} label="Attendance"
              value={thisMonthAtt?.pct != null ? `${thisMonthAtt.pct}%` : '—'}
              sub={monthLabel(now.getFullYear(), now.getMonth() + 1)} />
      </div>

      {alerts.length > 0 && (
        <Section icon={ShieldAlert} title="Needs attention">
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-2 text-sm rounded-xl px-3 py-2 ${
                a.tone === 'red' ? 'bg-red-50 text-red-700'
                : a.tone === 'amber' ? 'bg-amber-50 text-amber-700'
                : 'bg-sky-50 text-sky-700'}`}>
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <Section icon={Clock} title="Recent activity">
          {activity.length === 0 ? <Empty>Nothing recorded yet.</Empty> : (
            <div className="relative pl-4">
              <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-gray-100" />
              {activity.map((a, i) => (
                <div key={i} className="relative py-2">
                  <span className={`absolute -left-4 top-3.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${a.tone}`} />
                  <div className="text-sm font-bold text-gray-800">{a.title}</div>
                  <div className="text-xs text-gray-400">{a.sub} · {fmtDate(a.date)}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Summary only — the full ~24-skill breakdown lives on the
            Performance tab. Rolling up to the four categories keeps Overview
            scannable instead of a wall of near-identical bars. */}
        <Section icon={Award} title="Latest performance"
          right={latest?.assessed_month && <span className="text-[11px] text-gray-400">{latest.assessed_month}</span>}>
          {!latest ? <Empty>No skill assessment recorded yet.</Empty> : (
            <PerformanceSummary scores={latest.scores} cats={cats} overall={avg} />
          )}
        </Section>
      </div>
    </div>
  )
}

// Overview roll-up: one bar per category (4) instead of one per skill (~24),
// plus the single best and weakest skill so there's something actionable.
function PerformanceSummary({ scores, cats, overall }) {
  const tier = getTier(overall || 0)
  const rows = cats
    .map(c => ({ label: c.short || c.label, color: c.hex || c.color, value: getCategoryAvg(scores, c.skills) }))
    .filter(r => r.value > 0)

  const skills = scores && typeof scores === 'object'
    ? Object.entries(scores).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0)
    : []
  const best  = skills.length ? skills.reduce((a, b) => (b[1] > a[1] ? b : a)) : null
  const worst = skills.length ? skills.reduce((a, b) => (b[1] < a[1] ? b : a)) : null

  return (
    <>
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-baseline gap-0.5">
          <span className="text-4xl font-black text-gray-900 leading-none">{overall ?? '—'}</span>
          <span className="text-sm font-bold text-gray-300">/100</span>
        </div>
        <span className={`text-xs font-black px-2.5 py-1 rounded-full ${tier.bgClass} ${tier.textClass}`}>
          {tier.label}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-24 truncate">{r.label}</span>
            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.value)}%`, background: r.color }} />
            </div>
            <span className="text-xs font-black text-gray-700 w-7 text-right">{r.value}</span>
          </div>
        ))}
      </div>

      {best && worst && best[0] !== worst[0] && (
        <div className="mt-4 pt-3 border-t border-gray-50 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Strongest</div>
            <div className="font-bold text-emerald-600 truncate">{best[0]} · {best[1]}</div>
          </div>
          <div>
            <div className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Needs work</div>
            <div className="font-bold text-amber-600 truncate">{worst[0]} · {worst[1]}</div>
          </div>
        </div>
      )}
    </>
  )
}

const ScoreBars = ({ scores }) => {
  const entries = scores && typeof scores === 'object' ? Object.entries(scores) : []
  if (entries.length === 0) return <Empty>No scores in this assessment.</Empty>
  return (
    <div className="space-y-1.5">
      {entries.map(([skill, val]) => (
        <div key={skill} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-28 capitalize truncate">{skill}</span>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-brand-600 rounded-full" style={{ width: `${Math.min(100, Number(val) || 0)}%` }} />
          </div>
          <span className="text-xs font-bold text-gray-700 w-7 text-right">{val}</span>
        </div>
      ))}
    </div>
  )
}

// ── Fees ──────────────────────────────────────────────────────────────────
function FeesTab({ myPayments, goDetail }) {
  const [year, setYear] = useState('All')
  const [status, setStatus] = useState('All')
  const [mode, setMode] = useState('All')

  const years  = useMemo(() => [...new Set(myPayments.map(p => String(p.date || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [myPayments])
  const modes  = useMemo(() => [...new Set(myPayments.map(p => p.mode).filter(Boolean))].sort(), [myPayments])

  const rows = myPayments.filter(p =>
    (year === 'All'   || String(p.date || '').startsWith(year)) &&
    (status === 'All' || p.status === status) &&
    (mode === 'All'   || p.mode === mode))

  const totals = rows.reduce((t, p) => ({
    paid: t.paid + (p.status === 'Paid' ? Number(p.amount || 0) : 0),
    pending: t.pending + (p.status !== 'Paid' ? Number(p.amount || 0) : 0),
    due: t.due + Number(p.dueAmount || 0),
  }), { paid: 0, pending: 0, due: 0 })

  const sel = 'input w-auto text-xs py-1.5'
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Tile icon={IndianRupee} label="Collected" value={fmtMoney(totals.paid)} sub={`${rows.length} record${rows.length === 1 ? '' : 's'}`} tone="text-emerald-600" />
        <Tile icon={Clock} label="Pending" value={fmtMoney(totals.pending)} sub="not yet paid" tone={totals.pending ? 'text-amber-600' : 'text-gray-900'} />
        <Tile icon={AlertTriangle} label="Part-payment due" value={fmtMoney(totals.due)} sub="balance carried" tone={totals.due ? 'text-red-600' : 'text-gray-900'} />
      </div>

      <Section icon={CreditCard} title="Payment history"
        right={
          <div className="flex gap-2 flex-wrap">
            <select className={sel} value={year} onChange={e => setYear(e.target.value)}>
              <option value="All">All years</option>
              {years.map(y => <option key={y}>{y}</option>)}
            </select>
            <select className={sel} value={status} onChange={e => setStatus(e.target.value)}>
              {['All', 'Paid', 'Pending', 'Overdue'].map(s => <option key={s}>{s}</option>)}
            </select>
            {modes.length > 1 && (
              <select className={sel} value={mode} onChange={e => setMode(e.target.value)}>
                <option value="All">All modes</option>
                {modes.map(m => <option key={m}>{m}</option>)}
              </select>
            )}
          </div>
        }>
        {rows.length === 0 ? <Empty>No payments match these filters.</Empty> : (
          <div className="divide-y divide-gray-50 -mx-2">
            {rows.map(p => (
              <button key={p.id} onClick={() => goDetail('payment', p.id)}
                className="w-full flex items-center justify-between gap-3 py-2.5 px-2 text-left hover:bg-gray-50 rounded-lg transition">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-gray-800">
                    {fmtMoney(p.amount)}
                    <span className="font-normal text-gray-400"> · {p.month || '—'}</span>
                    {Number(p.dueAmount) > 0 && (
                      <span className="ml-2 text-xs font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                        {fmtMoney(p.dueAmount)} due
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{fmtDate(p.date)} · {p.mode || '—'} · {p.id}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Pill>{p.status}</Pill>
                  <ChevronRight size={14} className="text-gray-300" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Attendance ────────────────────────────────────────────────────────────
function AttendanceTab({ attMonths, cursor, setCursor, countAttendance }) {
  const key = `${cursor.y}-${cursor.m}`
  const raw = attMonths[key]
  const loading = raw === 'loading' || raw === undefined
  const counts = loading ? null : countAttendance(raw)

  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay()  // 0=Sun
  const lead = (firstWeekday + 6) % 7                            // make Monday first

  // Recent months that have already been fetched, for a small trend strip.
  const trend = useMemo(() => Object.entries(attMonths)
    .filter(([, v]) => v && v !== 'loading')
    .map(([k, v]) => {
      const [y, m] = k.split('-').map(Number)
      return { k, y, m, ...countAttendance(v) }
    })
    .filter(t => t.total > 0)
    .sort((a, b) => (a.y * 12 + a.m) - (b.y * 12 + b.m)),
    [attMonths, countAttendance])

  const step = (d) => setCursor(c => {
    const nm = c.m + d
    return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 }
  })

  return (
    <div className="space-y-5">
      <Section icon={CalendarDays} title={monthLabel(cursor.y, cursor.m + 1)}
        right={
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"><ChevronLeft size={15} /></button>
            <button onClick={() => step(1)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"><ChevronRight size={15} /></button>
          </div>
        }>
        {loading ? <Empty>Loading…</Empty> : counts.total === 0 ? <Empty>No attendance marked this month.</Empty> : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {['Present', 'Late', 'Absent', 'Leave'].map(k => counts[k] > 0 && (
                <span key={k} className={`text-xs font-bold ${ATT_TONE[k]}`}>{counts[k]} {k}</span>
              ))}
              <span className="ml-auto text-lg font-black text-gray-900">{counts.pct}%</span>
            </div>

            {/* Capped width: aspect-square cells across the full card would
                render ~100px tiles, which reads as a grid of buttons rather
                than a calendar. */}
            <div className="grid grid-cols-7 gap-1.5 text-center max-w-[360px]">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <div key={i} className="text-[10px] font-bold text-gray-300 uppercase pb-1">{d}</div>
              ))}
              {Array.from({ length: lead }).map((_, i) => <div key={`lead${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1
                const st = raw?.[day]
                return (
                  <div key={day} title={st ? `${day} — ${st}` : `${day} — not marked`}
                    className={`aspect-square rounded-lg flex items-center justify-center text-xs font-bold ${
                      st ? ATT_FILL[st] : 'bg-gray-50 text-gray-300'}`}>
                    {day}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Section>

      {trend.length > 1 && (
        <Section icon={Activity} title="Recent months">
          <div className="space-y-2">
            {trend.map(t => (
              <div key={t.k} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-28 flex-shrink-0">{monthLabel(t.y, t.m + 1)}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${t.pct || 0}%` }} />
                </div>
                <span className="text-xs font-black text-gray-700 w-10 text-right">{t.pct}%</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Page back through the calendar to load more months.</p>
        </Section>
      )}
    </div>
  )
}

// ── Performance ───────────────────────────────────────────────────────────
function PerformanceTab({ student, assessments }) {
  const cats = SPORT_CATEGORIES[student.sport] || FOOTBALL_CATEGORIES
  if (assessments === null) return <Section icon={Award} title="Performance"><Empty>Loading…</Empty></Section>
  if (assessments.length === 0) {
    return (
      <Section icon={Award} title="Performance">
        <Empty>No skill assessment recorded yet. Coaches add these from the Assess tab in the staff app.</Empty>
      </Section>
    )
  }

  const scored = assessments
    .map(a => ({ ...a, overall: a.scores ? getOverallScore(a.scores, cats) : null }))
    .filter(a => a.overall != null)

  return (
    <div className="space-y-5">
      {scored.length > 1 && (() => {
        // Only the most recent runs — 25 bars squeezes every label to "202…".
        const recent = scored.slice(0, 12).reverse()
        return (
          <Section icon={Sparkles} title="Overall score trend"
            right={<span className="text-[11px] text-gray-400">last {recent.length} assessments</span>}>
            <div className="flex items-stretch gap-2 h-32">
              {recent.map((a, i) => (
                // h-full matters: the bar's percentage height needs a parent
                // with a definite height, otherwise it resolves to zero and the
                // chart renders as bare numbers.
                <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1 min-w-0">
                  <span className="text-[11px] font-black text-gray-700">{a.overall}</span>
                  <div className="w-full bg-brand-600 rounded-t-md transition-all"
                       style={{ height: `${Math.max(3, a.overall)}%` }} />
                  <span className="text-[9px] text-gray-400 truncate w-full text-center">
                    {String(a.assessed_month || '').replace(/^\d{2}/, '')}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )
      })()}

      <Section icon={Award} title={`Latest — ${assessments[0].assessed_month || ''}`}
        right={assessments[0].scores && getOverallScore(assessments[0].scores, cats) != null &&
          <span className="text-sm font-black text-brand-600">{getOverallScore(assessments[0].scores, cats)}/100</span>}>
        <ScoreBars scores={assessments[0].scores} />
        {assessments[0].notes && <p className="text-xs text-gray-500 mt-3 bg-gray-50 rounded-xl p-3">{assessments[0].notes}</p>}
      </Section>

      {assessments.length > 1 && (
        <Section icon={Clock} title={`Assessment history (${assessments.length - 1} earlier)`}>
          {/* Collapsed by default: some students have 25 assessments, and
              rendering them all expanded is ~500 score bars on one page. */}
          <div className="divide-y divide-gray-50 -mx-2">
            {assessments.slice(1).map((a, i) => (
              <HistoryRow key={a.id || i} a={a} cats={cats} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function HistoryRow({ a, cats }) {
  const [open, setOpen] = useState(false)
  const score = a.scores ? getOverallScore(a.scores, cats) : null
  return (
    <div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 py-2.5 px-2 text-left hover:bg-gray-50 rounded-lg transition">
        <span className="text-sm font-bold text-gray-800">{a.assessed_month || 'Assessment'}</span>
        <span className="flex items-center gap-2">
          {score != null && <span className="text-sm font-black text-gray-700">{score}/100</span>}
          <ChevronRight size={14} className={`text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="px-2 pb-3">
          <ScoreBars scores={a.scores} />
          {a.notes && <p className="text-xs text-gray-500 mt-3 bg-gray-50 rounded-xl p-3">{a.notes}</p>}
        </div>
      )}
    </div>
  )
}

// ── Profile & documents ───────────────────────────────────────────────────
function ProfileTab({ student, hasPermission, role }) {
  const canManage = role === 'owner' || hasPermission?.('students.manage')
  return (
    <div className="space-y-5">
      <Section icon={FileText} title="Student">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Student ID" value={student.studentCode} />
          <KV label="Date of birth" value={fmtDate(student.dob)} />
          <KV label="Age" value={student.age} />
          <KV label="Gender" value={student.gender} />
          <KV label="Joined" value={fmtDate(student.joinDate)} />
          <KV label="Position" value={student.position} />
          <KV label="Fee plan" value={student.feePlan} />
          <KV label="Training" value={student.trainingType} />
        </div>
      </Section>

      <Section icon={Phone} title="Family & contact">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Parent" value={student.parent} />
          <KV label="Mother" value={student.motherName} />
          <KV label="Relationship" value={student.relationship} />
          <KV label="Occupation" value={student.occupation} />
          <KV label="Student phone" value={student.phone ? <a className="text-brand-600" href={`tel:${student.phone}`}>{student.phone}</a> : '—'} />
          <KV label="Parent phone" value={student.parentPhone ? <a className="text-brand-600" href={`tel:${student.parentPhone}`}>{student.parentPhone}</a> : '—'} />
          <KV label="Alternate" value={student.alternateContactPhone} />
          <KV label="Email" value={student.email} />
        </div>
        {student.address && (
          <div className="mt-4 pt-4 border-t border-gray-50">
            <KV label="Address" value={student.address} />
          </div>
        )}
      </Section>

      <Section icon={ShieldAlert} title="Emergency & medical">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Emergency contact" value={student.emergencyContactName} />
          <KV label="Emergency number" value={student.emergencyContactPhone} />
          <KV label="Medical condition" value={
            student.medicalNotes
              ? <span className="text-amber-700">{student.medicalNotes}</span>
              : 'None recorded'} />
          <KV label="Suspended since" value={student.suspendedSince ? fmtDate(student.suspendedSince) : '—'} />
        </div>
      </Section>

      <Section icon={Target} title="Portal account">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Account" value={
            student.accountStatus === 'active'
              ? <span className="text-emerald-600">Activated</span>
              : <span className="text-amber-600">Pending activation</span>} />
          {student.accountStatus !== 'active' && <KV label="Join code" value={student.joinCode} />}
          <KV label="Converted from trial" value={student.fromTrial ? 'Yes' : 'No'} />
        </div>
      </Section>

      <StudentDocumentsCard studentId={student.id} canUpload={canManage} canDelete={canManage} />
    </div>
  )
}
