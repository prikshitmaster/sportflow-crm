import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { UserPlus, X, Calendar, CheckCircle2, Clock, Phone, Plus } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
const fmtDate  = iso => iso ? new Date(iso+'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'

const REC_LABEL = { accept: 'Accept ✓', followup: 'Follow-up ↺', decline: 'Decline ✗' }
const REC_TEXT  = { accept: 'text-emerald-600', followup: 'text-orange-600', decline: 'text-red-500' }

// ── Mark Attend Sheet ─────────────────────────────────────────

function AttendSheet({ trial, onClose, onSave }) {
  const [note,    setNote]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const sessionNum = (trial.sessionsDone || 0) + 1
  const totalSessions = trial.trialSessions || 1
  const isLastSession = sessionNum >= totalSessions

  async function handleMark() {
    setSaving(true)
    try {
      await onSave(trial.id, {
        sessionsDone: sessionNum,
        coachNote:    note.trim() || null,
        ...(isLastSession ? { stage: 'attended' } : {}),
      })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
      <div className="w-full bg-white rounded-t-3xl px-5 pt-5 pb-8">

        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-black text-gray-900">{trial.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{trial.sport} · Session {sessionNum} of {totalSessions}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Session dots */}
        <div className="flex gap-1.5 mb-5">
          {Array.from({ length: totalSessions }).map((_, i) => (
            <div key={i} className={`flex-1 h-2 rounded-full transition-all ${i < sessionNum ? 'bg-brand-500' : 'bg-gray-100'}`} />
          ))}
        </div>

        <label className="block text-xs font-semibold text-gray-500 mb-1.5">Quick note (optional)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="Good footwork, needs stamina work…"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400 mb-4"
        />

        <button onClick={handleMark} disabled={saving}
          className="w-full py-3.5 bg-brand-600 text-white rounded-2xl font-black text-sm disabled:opacity-50 flex items-center justify-center gap-2">
          <CheckCircle2 size={18} />
          {saving ? 'Marking…' : isLastSession ? 'Mark Present · Complete Trial' : `Mark Present · Session ${sessionNum}`}
        </button>
      </div>
    </div>
  )
}

// ── Trial Card (coach view) ───────────────────────────────────

function TrialCard({ trial, batches, onMark, onRecommend }) {
  const batch     = batches.find(b => b.id === trial.batchId)
  // trialFeePaid defaults to 590 on every row regardless of whether it was
  // actually collected — trialFeeMode is the real signal (same rule Trials.jsx
  // uses). Stays 'Not collected' for a walk-in until the office collects the
  // cash and marks it paid, so a coach never sees "paid" for money that
  // hasn't actually come in yet — only real online payments or an office
  // paid-confirmation flip this.
  const feeCollected = trial.trialFeeMode !== 'Not collected'
  const today     = todayStr()
  const isToday   = trial.trialDate === today
  const isPast    = trial.trialDate && trial.trialDate < today
  // Same fee gate Trials.jsx enforces for the office (a scheduled-but-unpaid
  // trial can't progress to Attended there either) — without this a coach
  // could mark an unpaid trial present, which the office UI never allows.
  const dueToMark = (isToday || isPast) && trial.stage === 'scheduled' && (trial.sessionsDone || 0) < (trial.trialSessions || 1)
  const canMark   = dueToMark && feeCollected
  const needsCall = trial.stage === 'attended' && !trial.coachRec

  const converted = trial.stage === 'converted'
  const accepted  = trial.stage === 'accepted'
  const followup  = trial.stage === 'followup'

  const sessionsDone  = trial.sessionsDone || 0
  const totalSessions = trial.trialSessions || 1

  return (
    <div className={`bg-white rounded-2xl border px-4 py-3.5 ${converted ? 'border-emerald-200 bg-emerald-50/30' : isToday ? 'border-brand-200 bg-brand-50/20' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-gray-900 text-sm">{trial.name}</p>
            {trial.age && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{trial.age}y</span>}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {trial.sport}{batch ? ` · ${batch.name}` : ''}
          </p>
          {trial.phone && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
              <Phone size={9} />{trial.phone}
            </p>
          )}
          {feeCollected && (
            <p className="text-[11px] font-black text-emerald-600 flex items-center gap-1 mt-1">
              <CheckCircle2 size={11} />
              Trial fee paid · ₹{(trial.trialFeePaid ?? 590).toLocaleString('en-IN')}
            </p>
          )}
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0 text-right">
          {converted && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              ★ Joined
            </span>
          )}
          {needsCall && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Needs Your Call
            </span>
          )}
          {trial.stage === 'attended' && trial.coachRec && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              Sent to Office
            </span>
          )}
          {accepted && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              ✓ Accepted
            </span>
          )}
          {followup && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
              Follow-up
            </span>
          )}
          {trial.stage === 'scheduled' && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${isToday ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}>
              {isToday ? 'Today' : 'Scheduled'}
            </span>
          )}
        </div>
      </div>

      {/* Date row */}
      <div className="flex items-center gap-3 mt-2.5">
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <Calendar size={11} />
          {trial.trialDate ? fmtDate(trial.trialDate) : '—'}
          {trial.sessionStart && <span className="text-gray-400 ml-0.5">{trial.sessionStart.slice(0,5)}{trial.sessionEnd ? `–${trial.sessionEnd.slice(0,5)}` : ''}</span>}
        </span>

        {/* Session progress dots */}
        {totalSessions > 1 && (
          <div className="flex items-center gap-1">
            {Array.from({ length: totalSessions }).map((_, i) => (
              <div key={i} className={`w-2 h-2 rounded-full ${i < sessionsDone ? 'bg-brand-500' : 'bg-gray-200'}`} />
            ))}
            <span className="text-[10px] text-gray-400 ml-0.5">{sessionsDone}/{totalSessions}</span>
          </div>
        )}
      </div>

      {/* Coach note */}
      {trial.coachNote && (
        <p className="text-[11px] text-gray-500 italic mt-2 bg-gray-50 px-2.5 py-1.5 rounded-lg">"{trial.coachNote}"</p>
      )}

      {/* Your recommendation, once given — office still finalizes accept/reject/convert */}
      {trial.coachRec && (
        <p className={`text-[11px] font-black mt-2 ${REC_TEXT[trial.coachRec] || 'text-gray-500'}`}>
          Your call: {REC_LABEL[trial.coachRec] || trial.coachRec} · sent to office
        </p>
      )}

      {/* Mark attend button */}
      {canMark && (
        <button onClick={() => onMark(trial)}
          className="mt-3 w-full py-2.5 bg-brand-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5">
          <CheckCircle2 size={14} />
          Mark Present{totalSessions > 1 ? ` · Session ${sessionsDone + 1}` : ''}
        </button>
      )}

      {/* Due but blocked on fee — explains why Mark Present isn't here instead of just omitting it silently */}
      {dueToMark && !feeCollected && (
        <p className="mt-3 text-[11px] font-bold text-red-500 bg-red-50 rounded-xl px-3 py-2 text-center">
          Trial fee not collected — office needs to collect it before this can be marked
        </p>
      )}

      {/* Accept / Decline — appears once all sessions are marked present */}
      {needsCall && (
        <div className="mt-3 flex gap-1.5">
          <button onClick={() => onRecommend(trial, 'accept')}
            className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black">
            Accept ✓
          </button>
          <button onClick={() => onRecommend(trial, 'decline')}
            className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-xs font-black">
            Decline ✗
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function StaffTrials() {
  const { user, trials, batches, updateTrialStatus } = useApp()

  const isOffice = user?.accessRole && !['coach', 'staff'].includes(user.accessRole)

  // Coach: only trials for their batches. Mirrors StaffAttendance's fallback —
  // a coach with zero batches assigned to their name sees everything, so a
  // batch nobody's been assigned as coach yet doesn't strand its trials
  // (unreachable by name-matching) invisible to every coach.
  const myBatchIds = useMemo(() => {
    if (isOffice) return null
    const mine = batches.filter(b => b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase())
    const pool = mine.length > 0 ? mine : batches
    return new Set(pool.map(b => b.id))
  }, [batches, user, isOffice])

  const myTrials = useMemo(() => {
    // Converted trials are now real students (visible in batch rosters/attendance
    // instead) and rejected ones are dead leads — neither belongs in this list.
    let list = trials.filter(t => !['rejected', 'converted'].includes(t.stage))
    if (!isOffice) {
      // 'new' leads (freshly captured — walk-in or public /join, which always
      // lands in 'new' even when a batch got auto-assigned and the fee was
      // already paid) haven't been through the office's Schedule step yet, so
      // TrialCard has nothing for a coach to do with them — they'd render as a
      // dead card with a name and no button. They become visible here the
      // moment office schedules a real date.
      list = list.filter(t => t.stage !== 'new')
      if (myBatchIds) list = list.filter(t => t.batchId && myBatchIds.has(t.batchId))
    }
    return list.sort((a, b) => (a.trialDate || '') < (b.trialDate || '') ? -1 : 1)
  }, [trials, isOffice, myBatchIds])

  const today     = todayStr()
  const todayList = myTrials.filter(t => t.trialDate === today && t.stage === 'scheduled')
  const upcoming  = myTrials.filter(t => t.trialDate > today  && t.stage === 'scheduled')
  const past      = myTrials.filter(t => (t.trialDate < today || !['new','scheduled'].includes(t.stage)) && !['rejected'].includes(t.stage) && !todayList.includes(t) && !upcoming.includes(t))

  const [markTrial, setMarkTrial] = useState(null)

  // Coach's accept/follow-up/decline call — a recommendation only. It does NOT
  // move the trial's stage; the office still makes the final call (and runs
  // Convert → Student) from Trials.jsx, now informed by what the coach flagged.
  async function handleRecommend(trial, rec) {
    await updateTrialStatus(trial.id, { coachRec: rec })
  }

  function Section({ title, items, emptyText }) {
    if (items.length === 0) return null
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">{title}</p>
        {items.map(t => (
          <TrialCard key={t.id} trial={t} batches={batches} onMark={setMarkTrial} onRecommend={handleRecommend} />
        ))}
      </div>
    )
  }

  return (
    <div className="px-4 pt-5 pb-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-black text-gray-900">Trial Schedule</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {isOffice ? 'All scheduled trials' : 'Your batch trials'}
          </p>
        </div>
        {todayList.length > 0 && (
          <span className="text-xs font-black px-2.5 py-1 bg-brand-600 text-white rounded-full">
            {todayList.length} today
          </span>
        )}
      </div>

      {/* Content */}
      {myTrials.length === 0 ? (
        <div className="text-center py-20">
          <UserPlus size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm font-semibold text-gray-400">No trial sessions scheduled</p>
          <p className="text-xs text-gray-300 mt-1">Trials assigned to your batches appear here</p>
        </div>
      ) : (
        <>
          <Section title="Today" items={todayList} />
          <Section title="Upcoming" items={upcoming} />
          <Section title="Past · Results" items={past} />
        </>
      )}

      {/* Mark attend sheet */}
      {markTrial && (
        <AttendSheet
          trial={markTrial}
          onClose={() => setMarkTrial(null)}
          onSave={updateTrialStatus}
        />
      )}
    </div>
  )
}
