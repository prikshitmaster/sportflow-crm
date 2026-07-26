import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { studentMatchesAudience } from '../../lib/announcementAudience'
import { Megaphone, Calendar, Trophy, MapPin, Bell, Users, ChevronDown, ChevronUp } from 'lucide-react'

const typeIcon  = { Holiday: <Calendar size={16} className="text-blue-500"/>, Tournament: <Trophy size={16} className="text-amber-500"/>, Achievement: <Trophy size={16} className="text-yellow-500"/>, Reminder: <Bell size={16} className="text-red-500"/>, Announcement: <Megaphone size={16} className="text-brand-500"/> }
const typeBadge = { Holiday: 'badge-blue', Tournament: 'badge-yellow', Achievement: 'badge-yellow', Reminder: 'badge-red', Announcement: 'badge-blue' }

export default function StudentAnnouncements() {
  const { announcements: ctxAnnouncements, studentUser } = useApp()
  const [announcements, setAnnouncements] = useState([])
  const [events,        setEvents]        = useState([])
  const [loading,       setLoading]       = useState(true)
  const [expanded,      setExpanded]      = useState(new Set())  // event ids showing squad/bracket
  const [matchesByEvent,setMatchesByEvent]= useState({})         // eventId -> matches[]
  const [matchesLoading,setMatchesLoading]= useState(new Set())

  useEffect(() => {
    const academyId = studentUser?.academy_id
    Promise.all([
      // Always fetch fresh — context announcements may be from a different sport scope
      db.fetchAnnouncements(academyId),
      db.fetchEvents(academyId),
    ])
      .then(([ann, evts]) => {
        setAnnouncements(ann || [])
        setEvents(evts || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [studentUser?.academy_id])

  // Scope filters — student only sees content tagged for their sport+branch
  // OR content with no sport/branch tag (= academy-wide).
  const studentSport    = (studentUser?.sport || '').toLowerCase()
  // studentUser comes from secure_validate_student_session, which returns
  // row_to_json(students) — i.e. snake_case. Reading only .batchId left this
  // undefined, silently hiding every batch-targeted event and announcement.
  // Same defensive read the other student pages already use.
  const studentBatchId  = studentUser?.batch_id || studentUser?.batchId || null
  const studentBranchId = studentUser?.branch_id || studentUser?.branchId || null

  const sportMatch  = (item) => !item.sport || item.sport.toLowerCase() === studentSport
  // Announcements are mapped to camelCase (branchId); events come as raw rows (branch_id).
  const branchMatch = (item) => {
    const b = item.branchId ?? item.branch_id ?? null
    return !b || b === studentBranchId
  }

  const visibleEvents = events.filter(e => {
    if (e.status === 'Cancelled') return false
    if (!sportMatch(e))           return false
    if (!branchMatch(e))          return false
    if (!e.audience_type || e.audience_type === 'all')      return true
    if (e.audience_type === 'students') return true
    if (e.audience_type === 'batches')  return studentBatchId && (e.audience_ids || []).includes(studentBatchId)
    return false
  }).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  // Scope (sport/branch) first, then the announcement's explicit audience —
  // a batch- or student-targeted post must not show up for everyone else.
  const visibleAnnouncements = announcements.filter(a =>
    sportMatch(a) && branchMatch(a) &&
    studentMatchesAudience({ id: studentUser?.id, batchId: studentBatchId }, a)
  )

  const hasContent = visibleEvents.length > 0 || visibleAnnouncements.length > 0

  const toggleSquad = async (eventId) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(eventId) ? next.delete(eventId) : next.add(eventId)
      return next
    })
    if (matchesByEvent[eventId]) return
    setMatchesLoading(prev => new Set(prev).add(eventId))
    try {
      const rows = await db.fetchTournamentMatches(eventId)
      setMatchesByEvent(prev => ({ ...prev, [eventId]: rows }))
    } catch {
      // Squad list still works even if the bracket fetch fails
    } finally {
      setMatchesLoading(prev => { const n = new Set(prev); n.delete(eventId); return n })
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-xl font-black text-gray-900">Notices</h1>
        <p className="text-sm text-gray-500">Events, tournaments &amp; academy updates</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : !hasContent ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <Megaphone size={36} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No notices yet</p>
        </div>
      ) : (
        <>
          {visibleEvents.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Events &amp; Tournaments</p>
              <div className="space-y-3">
                {visibleEvents.map(e => (
                  <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${e.type==='tournament'?'bg-amber-50':'bg-brand-50'}`}>
                        {e.type === 'tournament'
                          ? <Trophy size={16} className="text-amber-500" />
                          : <Calendar size={16} className="text-brand-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-bold text-gray-900 text-sm leading-snug">{e.title}</p>
                          <span className={`badge flex-shrink-0 ${e.type==='tournament'?'badge-yellow':'badge-purple'}`}>
                            {e.type==='tournament'?'Tournament':'Event'}
                          </span>
                        </div>
                        {e.description && <p className="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-2">{e.description}</p>}
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          {e.date && <span>{new Date(e.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</span>}
                          {e.venue && <span className="flex items-center gap-0.5"><MapPin size={10}/>{e.venue}</span>}
                          {e.sport && <span>{e.sport}</span>}
                        </div>

                        {e.participants?.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-50">
                            <button onClick={() => toggleSquad(e.id)}
                              className="flex items-center gap-1.5 text-xs font-bold text-brand-600">
                              <Users size={12} />
                              {e.participants.some(p => p.id === studentUser?.id) ? "You're selected" : `Squad (${e.participants.length})`}
                              {expanded.has(e.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>

                            {expanded.has(e.id) && (
                              <div className="mt-2.5 space-y-2.5">
                                <div className="flex flex-wrap gap-1.5">
                                  {e.participants.map(p => (
                                    <span key={p.id}
                                      className={`text-[11px] px-2 py-1 rounded-full font-semibold ${
                                        p.id === studentUser?.id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
                                      }`}>
                                      {p.name}{p.id === studentUser?.id ? ' (You)' : ''}
                                    </span>
                                  ))}
                                </div>

                                {matchesLoading.has(e.id) ? (
                                  <p className="text-xs text-gray-400">Loading bracket…</p>
                                ) : matchesByEvent[e.id]?.length > 0 && (
                                  <div className="space-y-2">
                                    {[...new Set(matchesByEvent[e.id].map(m => m.round))].sort((a, b) => a - b).map(round => (
                                      <div key={round}>
                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">Round {round}</p>
                                        <div className="space-y-1">
                                          {matchesByEvent[e.id].filter(m => m.round === round).map(m => (
                                            <p key={m.id} className="text-xs text-gray-600">
                                              {m.is_bye ? `${m.player1_name} — BYE` : `${m.player1_name} vs ${m.player2_name}`}
                                              {m.winner_name && !m.is_bye && (
                                                <span className="text-emerald-600 font-semibold"> · {m.winner_name} won{m.score ? ` (${m.score})` : ''}</span>
                                              )}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleAnnouncements.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Announcements</p>
              <div className="space-y-3">
                {visibleAnnouncements.map(a => (
                  <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                        {typeIcon[a.type] || <Megaphone size={16} className="text-gray-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="font-bold text-gray-900 text-sm leading-snug">{a.title}</p>
                          <span className={`badge flex-shrink-0 ${typeBadge[a.type]||'badge-gray'}`}>{a.type}</span>
                        </div>
                        {a.body && <p className="text-xs text-gray-500 leading-relaxed mb-2">{a.body}</p>}
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{a.date}</span>
                          {a.author && <><span>·</span><span>{a.author}</span></>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
