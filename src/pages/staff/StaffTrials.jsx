import { useState, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { UserPlus, X, Calendar, CheckCircle2, Clock, Phone, Plus } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
const fmtDate  = iso => iso ? new Date(iso+'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'

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

function TrialCard({ trial, batches, onMark }) {
  const batch     = batches.find(b => b.id === trial.batchId)
  const today     = todayStr()
  const isToday   = trial.trialDate === today
  const isPast    = trial.trialDate && trial.trialDate < today
  const canMark   = (isToday || isPast) && trial.stage === 'scheduled' && (trial.sessionsDone || 0) < (trial.trialSessions || 1)

  const converted = trial.stage === 'converted'
  const attended  = trial.stage === 'attended' || trial.stage === 'accepted'
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
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0 text-right">
          {converted && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              ★ Joined
            </span>
          )}
          {attended && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              Attended
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

      {/* Mark attend button */}
      {canMark && (
        <button onClick={() => onMark(trial)}
          className="mt-3 w-full py-2.5 bg-brand-600 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5">
          <CheckCircle2 size={14} />
          Mark Present{totalSessions > 1 ? ` · Session ${sessionsDone + 1}` : ''}
        </button>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function StaffTrials() {
  const { user, trials, batches, updateTrialStatus } = useApp()

  const isOffice = user?.accessRole && !['coach', 'staff'].includes(user.accessRole)

  // Coach: only trials for their batches
  const myBatchIds = useMemo(() => {
    if (isOffice) return null
    const mine = batches.filter(b => b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase())
    return new Set(mine.map(b => b.id))
  }, [batches, user, isOffice])

  const myTrials = useMemo(() => {
    let list = trials.filter(t => !['rejected'].includes(t.stage))
    if (!isOffice && myBatchIds) {
      list = list.filter(t => t.batchId && myBatchIds.has(t.batchId))
    }
    return list.sort((a, b) => (a.trialDate || '') < (b.trialDate || '') ? -1 : 1)
  }, [trials, isOffice, myBatchIds])

  const today     = todayStr()
  const todayList = myTrials.filter(t => t.trialDate === today && t.stage === 'scheduled')
  const upcoming  = myTrials.filter(t => t.trialDate > today  && t.stage === 'scheduled')
  const past      = myTrials.filter(t => (t.trialDate < today || !['new','scheduled'].includes(t.stage)) && !['rejected'].includes(t.stage) && !todayList.includes(t) && !upcoming.includes(t))

  const [markTrial, setMarkTrial] = useState(null)

  function Section({ title, items, emptyText }) {
    if (items.length === 0) return null
    return (
      <div className="space-y-2.5">
        <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-1">{title}</p>
        {items.map(t => (
          <TrialCard key={t.id} trial={t} batches={batches} onMark={setMarkTrial} />
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
