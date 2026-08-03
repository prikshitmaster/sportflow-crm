import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, CreditCard, CalendarCheck, Award, Layers, Users, Clock,
  FileText, Activity, IndianRupee, CalendarDays, UserCog, ChevronRight, MapPin,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { isOutstanding, firstOfMonthIso, daysOverdue, normTrainingType, trainingTypeLabel } from '../lib/studentRules'
import { SPORT_CATEGORIES, FOOTBALL_CATEGORIES, getOverallScore } from '../lib/performance'

// ── 360° record detail page — /detail/:type/:id ──────────────────────────
// One page for any record the AI assistant (or, later, any list) links to:
// student, coach, batch, payment. Purely read-only + additive: it composes
// data already in AppContext with a few targeted fetches, and never touches
// the existing list pages.

const fmtMoney = n => '₹' + Number(n || 0).toLocaleString('en-IN')
const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
const monthLabel = (y, m) => new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

// Whole calendar months owed between paidTill's month and the anchor month —
// same approximation the edge function and Reports use.
function monthsOwed(paidTill, anchor) {
  if (!paidTill || !anchor) return 0
  const [py, pm] = paidTill.split('-').map(Number)
  const [ay, am] = anchor.split('-').map(Number)
  return Math.max(0, (ay * 12 + am - 1) - (py * 12 + pm - 1))
}

const STATUS_STYLE = {
  Active:    'bg-emerald-50 text-emerald-700',
  Suspended: 'bg-amber-50 text-amber-700',
  Inactive:  'bg-gray-100 text-gray-500',
  Paid:      'bg-emerald-50 text-emerald-700',
  Pending:   'bg-amber-50 text-amber-700',
  Overdue:   'bg-red-50 text-red-600',
  Approved:  'bg-emerald-50 text-emerald-700',
  Rejected:  'bg-red-50 text-red-600',
}
const Pill = ({ children }) => (
  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[children] || 'bg-gray-100 text-gray-600'}`}>
    {children}
  </span>
)

const Avatar = ({ name, photoUrl, size = 'w-16 h-16 text-xl' }) => (
  photoUrl
    ? <img src={photoUrl} alt={name} className={`${size} rounded-2xl object-cover flex-shrink-0`} />
    : (
      <div className={`${size} rounded-2xl bg-brand-600 text-white font-black flex items-center justify-center flex-shrink-0`}>
        {(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
      </div>
    )
)

const Tile = ({ icon: Icon, label, value, sub, tone = 'text-gray-900' }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-4">
    <div className="flex items-center gap-1.5 text-gray-400 text-xs font-semibold uppercase tracking-wide">
      <Icon size={13} /> {label}
    </div>
    <div className={`mt-1.5 text-lg font-black leading-tight ${tone}`}>{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
  </div>
)

const Section = ({ icon: Icon, title, right, children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-5">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="font-black text-gray-900 flex items-center gap-2 text-sm">
        <Icon size={15} className="text-brand-600" /> {title}
      </h3>
      {right}
    </div>
    {children}
  </div>
)

const Empty = ({ children }) => (
  <p className="text-sm text-gray-400 py-2">{children}</p>
)

const KV = ({ label, value }) => (
  <div>
    <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{label}</div>
    <div className="text-sm font-semibold text-gray-800 mt-0.5">{value ?? '—'}</div>
  </div>
)

const ATT_TONE = { Present: 'text-emerald-600', Late: 'text-amber-600', Absent: 'text-red-500', Leave: 'text-sky-600' }

export default function RecordDetail() {
  const { type, id } = useParams()
  const navigate = useNavigate()
  const { students, payments, batches, staff, feePlans, role, user, hasPermission } = useApp()
  const base = role === 'staff' ? '/staff' : ''
  const goDetail = (t, rid) => navigate(`${base}/detail/${t}/${rid}`)

  // Staff portal users only see record types their permissions allow.
  const allowed = role !== 'staff' || (
    { student: 'students.view', payment: 'payments.view', batch: 'batches.view', coach: 'staff.manage' }[type]
      ? hasPermission({ student: 'students.view', payment: 'payments.view', batch: 'batches.view', coach: 'staff.manage' }[type])
      : false
  )

  if (!allowed) {
    return (
      <Shell onBack={() => navigate(-1)} title="Record detail">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-500">
          You don't have permission to view this record.
        </div>
      </Shell>
    )
  }

  const views = { student: StudentView, coach: CoachView, batch: BatchView, payment: PaymentView }
  const View = views[type]
  return (
    <Shell onBack={() => navigate(-1)} title={`${type?.charAt(0).toUpperCase()}${type?.slice(1)} detail`}>
      {View
        ? <View id={id} {...{ students, payments, batches, staff, feePlans, user, goDetail }} />
        : <NotFound>Unknown record type "{type}".</NotFound>}
    </Shell>
  )
}

const Shell = ({ onBack, title, children }) => (
  <div className="space-y-5 max-w-[1000px]">
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 transition"
        title="Back"
      >
        <ArrowLeft size={16} />
      </button>
      <h2 className="text-xl font-black text-gray-900">{title}</h2>
    </div>
    {children}
  </div>
)

const NotFound = ({ children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
    <p className="text-sm text-gray-500">{children}</p>
    <p className="text-xs text-gray-400 mt-1">If this record belongs to another branch or sport, switch to it first.</p>
  </div>
)

// ── Student ───────────────────────────────────────────────────────────────
function StudentView({ id, students, payments, batches, staff, goDetail }) {
  const student = students.find(s => String(s.id) === String(id))
  const [attendance, setAttendance] = useState(null)   // { thisMonth: {counts,pct}, lastMonth: {...} }
  const [assessment, setAssessment] = useState(null)

  useEffect(() => {
    if (!student) return
    const now = new Date()
    const counts = map => {
      const c = { Present: 0, Absent: 0, Late: 0, Leave: 0 }
      Object.values(map || {}).forEach(st => { c[st] = (c[st] || 0) + 1 })
      const total = Object.values(c).reduce((a, b) => a + b, 0)
      const attended = c.Present + c.Late
      return { ...c, total, pct: total ? Math.round((attended / total) * 100) : null }
    }
    const load = async (y, m0) => counts((await db.fetchAttendanceForStudents(y, m0, [student.id]))[student.id])
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    Promise.all([load(now.getFullYear(), now.getMonth()), load(prev.getFullYear(), prev.getMonth())])
      .then(([thisMonth, lastMonth]) => setAttendance({ thisMonth, lastMonth }))
      .catch(() => setAttendance({}))
    db.fetchStudentAssessments(student.id).then(rows => setAssessment(rows[0] || null)).catch(() => {})
  }, [student?.id])

  if (!student) return <NotFound>Student not found in the current view.</NotFound>

  const firstOfMonth = firstOfMonthIso()
  const outstanding = isOutstanding(student, firstOfMonth)
  const owed = outstanding ? monthsOwed(student.paidTill, firstOfMonth) : 0
  const owedAmount = owed * Number(student.fees || 0)
  const overdueDays = daysOverdue(student)
  const myPayments = payments.filter(p => String(p.studentId) === String(student.id)).slice(0, 8)
  const batch = batches.find(b => String(b.id) === String(student.batchId)) || batches.find(b => b.name === student.batch)
  const coach = batch && staff.find(s => s.name?.trim().toLowerCase() === batch.coach?.trim().toLowerCase())
  const scores = assessment?.scores && typeof assessment.scores === 'object' ? Object.entries(assessment.scores) : []
  // Same category-weighted average used everywhere else assessments are shown
  // (StaffAssess, StudentPerformance, StudentStats) — this used to be a flat
  // mean of every raw skill score here, which silently disagreed with those
  // pages for the exact same assessment.
  const assessCategories = SPORT_CATEGORIES[student.sport] || FOOTBALL_CATEGORIES
  const avgScore = assessment?.scores ? getOverallScore(assessment.scores, assessCategories) || null : null
  const now = new Date()

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 flex-wrap">
        <Avatar name={student.name} photoUrl={student.photoUrl} />
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-black text-gray-900">{student.name}</h2>
            <Pill>{student.status}</Pill>
            {outstanding && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600">Fees due</span>}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {student.studentCode} · {student.sport || '—'}
            {batch && <> · <button className="text-brand-600 font-semibold hover:underline" onClick={() => goDetail('batch', batch.id)}>{batch.name}</button></>}
          </p>
        </div>
        {student.phone && (
          <a href={`tel:${student.phone}`} className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-2 rounded-xl hover:bg-brand-100 transition">
            <Phone size={14} /> {student.phone}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={IndianRupee} label="Monthly fee" value={fmtMoney(student.fees)} sub={`${student.feePlan || 'monthly'} · ${student.trainingType || 'Daily'}`} />
        <Tile icon={CalendarCheck} label="Paid till" value={fmtDate(student.paidTill)} sub={overdueDays ? `${overdueDays} days overdue` : 'up to date'} tone={outstanding ? 'text-red-600' : 'text-gray-900'} />
        <Tile icon={CreditCard} label="Outstanding" value={outstanding ? `~${fmtMoney(owedAmount)}` : '₹0'} sub={outstanding ? `${owed} month${owed === 1 ? '' : 's'} unpaid` : 'nothing due'} tone={outstanding ? 'text-red-600' : 'text-emerald-600'} />
        <Tile icon={Activity} label="Attendance" value={attendance?.thisMonth?.pct != null ? `${attendance.thisMonth.pct}%` : '—'} sub={monthLabel(now.getFullYear(), now.getMonth() + 1)} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Section icon={CreditCard} title="Recent payments">
          {myPayments.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
            <div className="divide-y divide-gray-50">
              {myPayments.map(p => (
                <button key={p.id} onClick={() => goDetail('payment', p.id)} className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition">
                  <div>
                    <div className="text-sm font-bold text-gray-800">{fmtMoney(p.amount)} <span className="font-normal text-gray-400">· {p.month}</span></div>
                    <div className="text-xs text-gray-400">{fmtDate(p.date)} · {p.mode || '—'} · {p.id}</div>
                  </div>
                  <div className="flex items-center gap-2"><Pill>{p.status}</Pill><ChevronRight size={14} className="text-gray-300" /></div>
                </button>
              ))}
            </div>
          )}
        </Section>

        <div className="space-y-5">
          <Section icon={CalendarDays} title="Attendance">
            {!attendance ? <Empty>Loading…</Empty> : (
              [['This month', attendance.thisMonth], ['Last month', attendance.lastMonth]].map(([label, a]) => (
                <div key={label} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-500 w-24">{label}</span>
                  {!a || !a.total ? <span className="text-sm text-gray-400">not marked</span> : (
                    <div className="flex items-center gap-3 text-xs font-semibold">
                      {['Present', 'Late', 'Absent', 'Leave'].map(k => a[k] > 0 && <span key={k} className={ATT_TONE[k]}>{a[k]} {k}</span>)}
                      <span className="text-gray-900 font-black text-sm">{a.pct}%</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section icon={Award} title="Latest performance">
            {!assessment ? <Empty>No skill assessment recorded yet.</Empty> : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400">{assessment.assessed_month}{assessment.sport ? ` · ${assessment.sport}` : ''}</span>
                  {avgScore != null && <span className="text-sm font-black text-brand-600">{avgScore}/100 avg</span>}
                </div>
                <div className="space-y-1.5">
                  {scores.map(([skill, val]) => (
                    <div key={skill} className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 w-28 capitalize truncate">{skill}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-600 rounded-full" style={{ width: `${Math.min(100, Number(val) || 0)}%` }} />
                      </div>
                      <span className="text-xs font-bold text-gray-700 w-7 text-right">{val}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Section>
        </div>
      </div>

      <Section icon={FileText} title="Profile">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KV label="Parent" value={student.parent} />
          <KV label="Parent phone" value={student.parentPhone ? <a className="text-brand-600" href={`tel:${student.parentPhone}`}>{student.parentPhone}</a> : '—'} />
          <KV label="Age" value={student.age} />
          <KV label="Joined" value={fmtDate(student.joinDate)} />
          <KV label="Training" value={student.trainingType} />
          <KV label="Fee plan" value={student.feePlan} />
          <KV label="Position" value={student.position || '—'} />
          <KV label="Coach" value={coach ? <button className="text-brand-600 font-semibold hover:underline" onClick={() => goDetail('coach', coach.id)}>{coach.name}</button> : (batch?.coach || '—')} />
        </div>
      </Section>
    </>
  )
}

// ── Coach / staff ─────────────────────────────────────────────────────────
function CoachView({ id, batches, staff, students, user, goDetail }) {
  const person = staff.find(s => String(s.id) === String(id))
  const [checkins, setCheckins] = useState(null)
  const [leaves, setLeaves] = useState(null)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    if (!person || !user?.academyId) return
    const now = new Date()
    db.fetchStaffCheckinsMonth(user.academyId, person.id, now.getFullYear(), now.getMonth() + 1)
      .then(setCheckins).catch(() => setCheckins([]))
    db.fetchLeaveRequests(user.academyId)
      .then(rows => setLeaves((rows || []).filter(r => r.staff_name?.trim().toLowerCase() === person.name?.trim().toLowerCase()).slice(0, 5)))
      .catch(() => setLeaves([]))
    db.fetchAuditLogs(user.academyId, 300)
      .then(rows => setActivity((rows || []).filter(r => r.actor_name?.trim().toLowerCase() === person.name?.trim().toLowerCase()).slice(0, 10)))
      .catch(() => setActivity([]))
  }, [person?.id, user?.academyId])

  if (!person) return <NotFound>Staff member not found in the current view.</NotFound>

  const myBatches = batches.filter(b => b.coach?.trim().toLowerCase() === person.name?.trim().toLowerCase())
  const myStudentCount = students.filter(s => myBatches.some(b => String(b.id) === String(s.batchId) || b.name === s.batch)).length
  const now = new Date()
  const daysCheckedIn = checkins ? new Set(checkins.map(c => c.date)).size : null

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 flex-wrap">
        <Avatar name={person.name} photoUrl={person.photoUrl} />
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-black text-gray-900">{person.name}</h2>
            <Pill>{person.status}</Pill>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {person.role}{person.staffCode ? ` · ${person.staffCode}` : ''}
            {(person.sports || []).length > 0 && ` · ${person.sports.join(', ')}`}
          </p>
        </div>
        {person.phone && (
          <a href={`tel:${person.phone}`} className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-2 rounded-xl hover:bg-brand-100 transition">
            <Phone size={14} /> {person.phone}
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={IndianRupee} label="Salary" value={person.salary ? fmtMoney(person.salary) : '—'} sub="per month" />
        <Tile icon={CalendarCheck} label="Check-ins" value={daysCheckedIn != null ? `${daysCheckedIn} days` : '—'} sub={monthLabel(now.getFullYear(), now.getMonth() + 1)} />
        <Tile icon={Layers} label="Batches" value={myBatches.length} sub={`${myStudentCount} students`} />
        <Tile icon={CalendarDays} label="Joined" value={fmtDate(person.joinDate)} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Section icon={Layers} title="Batches coached">
            {myBatches.length === 0 ? <Empty>No batches assigned.</Empty> : (
              <div className="divide-y divide-gray-50">
                {myBatches.map(b => (
                  <button key={b.id} onClick={() => goDetail('batch', b.id)} className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition">
                    <div>
                      <div className="text-sm font-bold text-gray-800">{b.name}</div>
                      <div className="text-xs text-gray-400">{(b.days || []).join(' ')} · {b.time || '—'} · {b.enrolled ?? 0}/{b.capacity ?? '—'} enrolled</div>
                    </div>
                    <ChevronRight size={14} className="text-gray-300" />
                  </button>
                ))}
              </div>
            )}
          </Section>

          <Section icon={UserCog} title="Leave requests">
            {!leaves ? <Empty>Loading…</Empty> : leaves.length === 0 ? <Empty>No leave requests.</Empty> : (
              <div className="divide-y divide-gray-50">
                {leaves.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-gray-800">{fmtDate(l.start_date)} → {fmtDate(l.end_date)}</div>
                      {l.reason && <div className="text-xs text-gray-400 truncate max-w-[220px]">{l.reason}</div>}
                    </div>
                    <Pill>{l.status}</Pill>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section icon={Clock} title={`Check-ins — ${monthLabel(now.getFullYear(), now.getMonth() + 1)}`}>
            {!checkins ? <Empty>Loading…</Empty> : checkins.length === 0 ? <Empty>No QR check-ins recorded this month.</Empty> : (
              <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {checkins.map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-gray-700 font-semibold">{fmtDate(c.date)}</span>
                    <span className="text-xs text-gray-500">{c.clock_in || '—'}{c.clock_out ? ` → ${c.clock_out}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section icon={Activity} title="Recent activity">
            {!activity ? <Empty>Loading…</Empty> : activity.length === 0 ? <Empty>No logged activity.</Empty> : (
              <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {activity.map((a, i) => (
                  <div key={i} className="py-2">
                    <div className="text-sm text-gray-700">
                      <span className="font-semibold">{a.action}</span>
                      {a.entity_name && <span className="text-gray-500"> — {a.entity_name}</span>}
                    </div>
                    <div className="text-xs text-gray-400">{a.created_at ? new Date(a.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

// ── Batch ─────────────────────────────────────────────────────────────────
function BatchView({ id, batches, students, staff, feePlans, goDetail }) {
  const batch = batches.find(b => String(b.id) === String(id))
  if (!batch) return <NotFound>Batch not found in the current view.</NotFound>

  const plans = feePlans.filter(p => String(p.batchId) === String(batch.id))
  const roster = students.filter(s => String(s.batchId) === String(batch.id) || s.batch === batch.name)
  const coach = staff.find(s => s.name?.trim().toLowerCase() === batch.coach?.trim().toLowerCase())
  const expectedMonthly = roster.filter(s => s.status === 'Active').reduce((sum, s) => sum + Number(s.fees || 0), 0)

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 flex-wrap">
        <div className="w-16 h-16 rounded-2xl bg-brand-600 text-white flex items-center justify-center flex-shrink-0"><Layers size={26} /></div>
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-lg font-black text-gray-900">{batch.name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {(batch.sports || []).join(', ') || '—'} · {(batch.days || []).join(' ')} · {batch.time || '—'}
            {batch.ground && <> · <MapPin size={12} className="inline -mt-0.5" /> {batch.ground}</>}
          </p>
        </div>
        {coach
          ? <button onClick={() => goDetail('coach', coach.id)} className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-2 rounded-xl hover:bg-brand-100 transition"><UserCog size={14} /> {coach.name}</button>
          : batch.coach && <span className="text-sm text-gray-500 flex items-center gap-1.5"><UserCog size={14} /> {batch.coach}</span>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={Users} label="Enrolled" value={`${batch.enrolled ?? roster.length}/${batch.capacity ?? '—'}`} sub={batch.waitlist ? `${batch.waitlist} waitlisted` : 'capacity'} />
        <Tile icon={IndianRupee} label="Expected / month" value={fmtMoney(expectedMonthly)} sub="active students × fee" />
        <Tile icon={CalendarDays} label="Schedule" value={(batch.days || []).join(' ') || '—'} sub={batch.time || ''} />
        <Tile icon={Award} label="Age group" value={batch.ageMin || batch.ageMax ? `${batch.ageMin ?? '?'}–${batch.ageMax ?? '?'} yrs` : '—'} />
      </div>

      <Section icon={IndianRupee} title="Fee plans">
        {plans.length === 0 ? <Empty>No fee plans yet — create them in Settings → Fee Plans.</Empty> : (
          <div className="divide-y divide-gray-50">
            {plans.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${normTrainingType(p.trainingType) === 'daily' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                    {trainingTypeLabel(p.trainingType) || 'Any'}
                  </span>
                  <span className="text-sm font-bold text-gray-800">{p.name}</span>
                </div>
                <div className="text-xs text-gray-500">
                  Monthly <b className="text-gray-800">{fmtMoney(p.monthlyFee)}</b> · Quarterly <b className="text-gray-800">{fmtMoney(p.quarterlyFee)}</b> · Yearly <b className="text-gray-800">{fmtMoney(p.yearlyFee)}</b>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Users} title={`Students (${roster.length})`}>
        {roster.length === 0 ? <Empty>No students enrolled.</Empty> : (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {roster.map(s => (
              <button key={s.id} onClick={() => goDetail('student', s.id)} className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition">
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} photoUrl={s.photoUrl} size="w-9 h-9 text-xs" />
                  <div>
                    <div className="text-sm font-bold text-gray-800">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.studentCode} · {fmtMoney(s.fees)}/mo</div>
                  </div>
                </div>
                <div className="flex items-center gap-2"><Pill>{s.status}</Pill><ChevronRight size={14} className="text-gray-300" /></div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

// ── Payment ───────────────────────────────────────────────────────────────
function PaymentView({ id, payments, students, goDetail }) {
  const payment = payments.find(p => String(p.id) === String(id))
  if (!payment) return <NotFound>Payment not found in the current view.</NotFound>

  const student = students.find(s => String(s.id) === String(payment.studentId))
  const others = payments.filter(p => String(p.studentId) === String(payment.studentId) && p.id !== payment.id).slice(0, 6)

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4 flex-wrap">
        <div className="w-16 h-16 rounded-2xl bg-brand-600 text-white flex items-center justify-center flex-shrink-0"><CreditCard size={26} /></div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-black text-gray-900">{fmtMoney(payment.amount)}</h2>
            <Pill>{payment.status}</Pill>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{payment.id} · {payment.month}</p>
        </div>
        {(student || payment.student) && (
          student
            ? <button onClick={() => goDetail('student', student.id)} className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 bg-brand-50 px-3 py-2 rounded-xl hover:bg-brand-100 transition">{payment.student || student.name} <ChevronRight size={14} /></button>
            : <span className="text-sm text-gray-500">{payment.student}</span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon={CalendarDays} label="Paid on" value={fmtDate(payment.date)} />
        <Tile icon={CreditCard} label="Mode" value={payment.mode || '—'} sub={payment.paymentType} />
        <Tile icon={CalendarCheck} label="Covers" value={`${payment.monthsCovered || 1} month${(payment.monthsCovered || 1) > 1 ? 's' : ''}`} sub={payment.coverageStart ? `from ${fmtDate(payment.coverageStart)}` : payment.month} />
        <Tile icon={IndianRupee} label="Discount" value={payment.discountPct ? `${payment.discountPct}%` : 'None'} />
      </div>

      {payment.notes && (
        <Section icon={FileText} title="Notes"><p className="text-sm text-gray-600">{payment.notes}</p></Section>
      )}

      <Section icon={CreditCard} title={`Other payments by ${payment.student || 'this student'}`}>
        {others.length === 0 ? <Empty>No other payments on record.</Empty> : (
          <div className="divide-y divide-gray-50">
            {others.map(p => (
              <button key={p.id} onClick={() => goDetail('payment', p.id)} className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-gray-50 rounded-lg px-2 -mx-2 transition">
                <div>
                  <div className="text-sm font-bold text-gray-800">{fmtMoney(p.amount)} <span className="font-normal text-gray-400">· {p.month}</span></div>
                  <div className="text-xs text-gray-400">{fmtDate(p.date)} · {p.mode || '—'} · {p.id}</div>
                </div>
                <div className="flex items-center gap-2"><Pill>{p.status}</Pill><ChevronRight size={14} className="text-gray-300" /></div>
              </button>
            ))}
          </div>
        )}
      </Section>
    </>
  )
}
