import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, CreditCard, CalendarCheck, Award, Layers, Users, Clock,
  FileText, Activity, IndianRupee, CalendarDays, UserCog, ChevronRight, MapPin,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { normTrainingType, trainingTypeLabel } from '../lib/studentRules'
import StudentDetail from './StudentDetail'
// Presentation primitives live in ./detail/ui so StudentDetail can share them
// without importing back from this file (which imports StudentDetail).
import { fmtMoney, fmtDate, monthLabel, Pill, Avatar, Tile, Section, Empty } from './detail/ui'

// ── 360° record detail page — /detail/:type/:id ──────────────────────────
// One page for any record the AI assistant (or, later, any list) links to:
// student, coach, batch, payment. Purely read-only + additive: it composes
// data already in AppContext with a few targeted fetches, and never touches
// the existing list pages.

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

  const views = { student: StudentDetail, coach: CoachView, batch: BatchView, payment: PaymentView }
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
  <div className="space-y-5 max-w-[1240px]">
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

// ── Coach / staff ─────────────────────────────────────────────────────────
function CoachView({ id, batches, staff, students, user, goDetail }) {
  const { batchRoster } = useApp()
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
  // Active only, and de-duplicated: a daily student in this coach's MWF *and*
  // TTS batch is one student, not two.
  const activeStudents = students.filter(s => s.status === 'Active')
  const rosterByBatch = new Map(myBatches.map(b => [b.id, batchRoster(b.id, b.name, activeStudents)]))
  const myStudentCount = new Set(
    [...rosterByBatch.values()].flat().map(s => s.id)
  ).size
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
                      <div className="text-xs text-gray-400">{(b.days || []).join(' ')} · {b.time || '—'} · {(rosterByBatch.get(b.id) || []).length}/{b.capacity ?? '—'} enrolled</div>
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
  const { batchRoster } = useApp()
  const batch = batches.find(b => String(b.id) === String(id))
  if (!batch) return <NotFound>Batch not found in the current view.</NotFound>

  const plans = feePlans.filter(p => String(p.batchId) === String(batch.id))
  // Same roster rule as the Batches page (primary assignment OR a
  // student_batches row). This panel used to miss multi-batch students, so it
  // could report a different headcount than the card that opened it.
  const roster = batchRoster(batch.id, batch.name, students)
  const activeRoster = roster.filter(s => s.status === 'Active')
  const coach = staff.find(s => s.name?.trim().toLowerCase() === batch.coach?.trim().toLowerCase())

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

      {/* No per-batch revenue tile: fees belong to the STUDENT, not the batch.
          A daily student legitimately sits in an MWF and a TTS batch on one
          fee, so showing his full monthly amount on both batch pages counted
          the same money twice. Revenue lives in Reports → Overview and
          Payments, where it is academy-level and cannot double. */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile icon={Users} label="Enrolled" value={`${activeRoster.length}/${batch.capacity ?? '—'}`} sub={batch.waitlist ? `${batch.waitlist} waitlisted` : 'capacity'} />
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
