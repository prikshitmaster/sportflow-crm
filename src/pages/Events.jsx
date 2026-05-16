import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import {
  Plus, Calendar, MapPin, Users, Trophy, Trash2, Pencil,
  X, Check, RotateCcw, Image,
} from 'lucide-react'

// ── Bracket helpers ──────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function genKnockout(participants) {
  const seeded = shuffle(participants)
  return seeded.reduce((acc, p, i) => {
    if (i % 2 === 0) {
      const opp = seeded[i + 1]
      acc.push(opp
        ? { round: 1, matchNumber: acc.length + 1, player1Id: p.id, player1Name: p.name, player2Id: opp.id, player2Name: opp.name, isBye: false }
        : { round: 1, matchNumber: acc.length + 1, player1Id: p.id, player1Name: p.name, player2Id: null, player2Name: 'BYE', isBye: true, winnerId: p.id, winnerName: p.name }
      )
    }
    return acc
  }, [])
}

function genRoundRobin(participants) {
  const matches = []; let num = 1
  for (let i = 0; i < participants.length; i++)
    for (let j = i + 1; j < participants.length; j++)
      matches.push({ round: 1, matchNumber: num++, player1Id: participants[i].id, player1Name: participants[i].name, player2Id: participants[j].id, player2Name: participants[j].name, isBye: false })
  return matches
}

function genNextRound(allMatches, curRound) {
  const winners = allMatches.filter(m => m.round === curRound && m.winner_id).map(m => ({ id: m.winner_id, name: m.winner_name }))
  if (winners.length < 2) return []
  return winners.reduce((acc, w, i) => {
    if (i % 2 === 0) {
      const opp = winners[i + 1]
      acc.push(opp
        ? { round: curRound + 1, matchNumber: acc.length + 1, player1Id: w.id, player1Name: w.name, player2Id: opp.id, player2Name: opp.name, isBye: false }
        : { round: curRound + 1, matchNumber: acc.length + 1, player1Id: w.id, player1Name: w.name, player2Id: null, player2Name: 'BYE', isBye: true, winnerId: w.id, winnerName: w.name }
      )
    }
    return acc
  }, [])
}

function roundLabel(round, totalRounds) {
  if (round === totalRounds)     return 'Final'
  if (round === totalRounds - 1) return 'Semifinal'
  if (round === totalRounds - 2) return 'Quarterfinal'
  return `Round ${round}`
}

// ── Constants ────────────────────────────────────────────────
const BLANK = { title: '', type: 'event', sport: '', date: '', endDate: '', venue: '', description: '', audienceType: 'all', audienceIds: [], bracketType: 'knockout', flyerFile: null }
const SPORTS   = ['Football', 'Tennis', 'Squash', 'Table Tennis']
const AUDIENCE = [
  { value: 'all',           label: 'Everyone' },
  { value: 'students',      label: 'All Students' },
  { value: 'staff',         label: 'All Staff' },
  { value: 'batches',       label: 'Specific Batches' },
  { value: 'staff_members', label: 'Specific Staff' },
]
const STATUS_COLOR = { Upcoming: 'badge-blue', Ongoing: 'badge-green', Completed: 'badge-gray', Cancelled: 'badge-red' }

// ── EventForm Modal ──────────────────────────────────────────
function EventFormModal({ initial, onClose, onSave, batches, allStaff }) {
  const [form, setForm] = useState(initial || BLANK)
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleId = (id) => setForm(f => ({
    ...f, audienceIds: f.audienceIds.includes(id) ? f.audienceIds.filter(x => x !== id) : [...f.audienceIds, id],
  }))

  const handleSave = async () => {
    if (!form.title.trim()) { setErr('Title is required'); return }
    if (!form.date)          { setErr('Start date is required'); return }
    setSaving(true); setErr('')
    try { await onSave(form); onClose() }
    catch (e) { setErr(e.message || 'Failed to save') }
    finally   { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-black text-gray-900">{initial?.id ? 'Edit Event' : 'New Event'}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex gap-2">
            {[['event', 'Event'], ['tournament', 'Tournament']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => set('type', v)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${form.type === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                {l}
              </button>
            ))}
          </div>
          <div>
            <label className="label">Title *</label>
            <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Annual Football Cup" />
          </div>
          <div>
            <label className="label">Sport</label>
            <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
              <option value="">All Sports</option>
              {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date *</label>
              <input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input className="input" type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Venue</label>
            <input className="input" value={form.venue} onChange={e => set('venue', e.target.value)} placeholder="e.g. Main Ground, Court A" />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Details…" />
          </div>
          <div>
            <label className="label">Flyer / Image (optional)</label>
            <label className="flex items-center gap-2 w-full px-3 py-2.5 border border-dashed border-gray-300 hover:border-brand-400 rounded-xl text-sm text-gray-500 hover:text-brand-600 cursor-pointer transition">
              <Image size={15} />
              {form.flyerFile ? form.flyerFile.name : (initial?.flyerUrl ? 'Replace flyer' : 'Upload flyer')}
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => set('flyerFile', e.target.files?.[0] || null)} />
            </label>
          </div>
          <div>
            <label className="label">Send To</label>
            <div className="space-y-2 mt-1">
              {AUDIENCE.map(a => (
                <label key={a.value} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="radio" name="aud" checked={form.audienceType === a.value}
                    onChange={() => { set('audienceType', a.value); set('audienceIds', []) }}
                    className="accent-brand-600" />
                  <span className="text-sm text-gray-700">{a.label}</span>
                </label>
              ))}
            </div>
          </div>
          {form.audienceType === 'batches' && (
            <div>
              <label className="label">Select Batches</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {batches.map(b => (
                  <label key={b.id} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.audienceIds.includes(b.id)} onChange={() => toggleId(b.id)} className="accent-brand-600" />
                    <span className="text-sm text-gray-700">{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {form.audienceType === 'staff_members' && (
            <div>
              <label className="label">Select Staff</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {allStaff.map(s => (
                  <label key={s.id} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.audienceIds.includes(s.id)} onChange={() => toggleId(s.id)} className="accent-brand-600" />
                    <span className="text-sm text-gray-700">{s.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {form.type === 'tournament' && (
            <div>
              <label className="label">Bracket Type</label>
              <div className="flex gap-2">
                {[['knockout', 'Knockout'], ['round-robin', 'Round Robin']].map(([v, l]) => (
                  <button key={v} type="button" onClick={() => set('bracketType', v)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${form.bracketType === v ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-500 border-gray-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-3 pb-2">
            <button onClick={onClose} className="flex-1 btn-secondary justify-center">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary justify-center">
              {saving
                ? <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                : <><Check size={14} /> Save</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Match Card ───────────────────────────────────────────────
function MatchCard({ match, input, onChange, onSave, saving, isRR }) {
  if (match.is_bye) return (
    <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
      <span className="text-sm font-bold text-gray-700">{match.player1_name}</span>
      <span className="badge badge-gray text-xs">BYE — auto-advances</span>
    </div>
  )
  const inp  = input || {}
  const done = !!match.winner_id
  return (
    <div className={`rounded-xl border p-4 ${done ? 'border-gray-100 bg-gray-50/50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`flex-1 text-center py-2 rounded-lg text-sm font-bold ${done && match.winner_id === match.player1_id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
          {match.player1_name}
        </div>
        <span className="text-xs text-gray-400 font-semibold">vs</span>
        <div className={`flex-1 text-center py-2 rounded-lg text-sm font-bold ${done && match.winner_id === match.player2_id ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
          {match.player2_name}
        </div>
      </div>
      {done ? (
        <p className="text-xs text-center text-gray-400">
          Winner: <span className="font-bold text-emerald-600">{match.winner_name}</span>
          {match.score && <> · <span className="font-mono">{match.score}</span></>}
        </p>
      ) : (
        <div className="space-y-2">
          <input className="input text-sm" placeholder="Score (e.g. 3-1)"
            value={inp.score || ''} onChange={e => onChange({ ...inp, score: e.target.value })} />
          <div className="flex gap-2">
            {[{ id: match.player1_id, name: match.player1_name }, { id: match.player2_id, name: match.player2_name }].map(p => (
              <button key={p.id} type="button" onClick={() => onChange({ ...inp, winnerId: p.id, winnerName: p.name })}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition ${inp.winnerId === p.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {p.name} wins
              </button>
            ))}
            {isRR && (
              <button type="button" onClick={() => onChange({ ...inp, winnerId: -1, winnerName: 'Draw' })}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${inp.winnerId === -1 ? 'bg-gray-600 text-white border-gray-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                Draw
              </button>
            )}
          </div>
          {inp.winnerId && (
            <button onClick={onSave} disabled={saving} className="w-full btn-primary justify-center text-sm py-2">
              {saving ? 'Saving…' : 'Confirm Result'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tournament Modal ─────────────────────────────────────────
function TournamentModal({ event, students, onClose }) {
  const [tab,          setTab]          = useState(event.participants?.length ? 'bracket' : 'participants')
  const [participants, setParticipants] = useState(event.participants || [])
  const [matches,      setMatches]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [inputs,       setInputs]       = useState({})
  const [activeRound,  setActiveRound]  = useState(1)

  const isKO = !event.bracket_type || event.bracket_type === 'knockout'

  const availableStudents = event.audience_type === 'batches' && event.audience_ids?.length
    ? students.filter(s => event.audience_ids.includes(s.batchId))
    : students.filter(s => s.status === 'Active')

  useEffect(() => {
    db.fetchTournamentMatches(event.id)
      .then(rows => {
        setMatches(rows)
        if (rows.length) setActiveRound(Math.max(...rows.map(r => r.round)))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [event.id])

  const toggleP = (s) => setParticipants(prev =>
    prev.find(p => p.id === s.id) ? prev.filter(p => p.id !== s.id) : [...prev, { id: s.id, name: s.name }]
  )

  const saveParticipants = async () => {
    if (participants.length < 2) { alert('Add at least 2 participants'); return }
    setSaving(true)
    try { await db.updateEvent(event.id, { participants }); event.participants = participants; setTab('bracket') }
    catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const drawBracket = async () => {
    if (participants.length < 2) return
    setSaving(true)
    try {
      await db.deleteEventMatches(event.id)
      const newMatches = isKO ? genKnockout(participants) : genRoundRobin(participants)
      await db.insertTournamentMatches(event.id, newMatches)
      const fresh = await db.fetchTournamentMatches(event.id)
      setMatches(fresh); setActiveRound(1); setInputs({})
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const saveResult = async (match) => {
    const inp = inputs[match.id] || {}
    if (!inp.winnerId) { alert('Select a winner'); return }
    setSaving(true)
    try {
      await db.updateTournamentMatch(match.id, { winnerId: inp.winnerId, winnerName: inp.winnerName, score: inp.score })
      setMatches(prev => prev.map(m => m.id === match.id
        ? { ...m, winner_id: inp.winnerId, winner_name: inp.winnerName, score: inp.score || null } : m))
      setInputs(prev => { const n = { ...prev }; delete n[match.id]; return n })
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const advanceRound = async () => {
    setSaving(true)
    try {
      const next = genNextRound(matches, activeRound)
      if (!next.length) { alert('Cannot generate next round'); setSaving(false); return }
      await db.insertTournamentMatches(event.id, next)
      const fresh = await db.fetchTournamentMatches(event.id)
      setMatches(fresh); setActiveRound(activeRound + 1); setInputs({})
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  const rounds       = [...new Set(matches.map(m => m.round))].sort((a, b) => a - b)
  const totalRounds  = isKO ? Math.max(Math.ceil(Math.log2(Math.max(participants.length, 2))), rounds.length) : 1
  const roundMatches = matches.filter(m => m.round === activeRound)
  const allRoundDone = roundMatches.length > 0 && roundMatches.every(m => m.winner_id)
  const finalWinner  = isKO && allRoundDone && roundMatches.length === 1 ? roundMatches[0].winner_name : null

  const rrStandings = !isKO ? (() => {
    const map = {}
    participants.forEach(p => { map[p.id] = { name: p.name, W: 0, L: 0, D: 0, pts: 0 } })
    matches.forEach(m => {
      if (!m.winner_id) return
      if (m.winner_id === -1) {
        if (map[m.player1_id]) { map[m.player1_id].D++; map[m.player1_id].pts++ }
        if (map[m.player2_id]) { map[m.player2_id].D++; map[m.player2_id].pts++ }
      } else {
        const loserId = m.winner_id === m.player1_id ? m.player2_id : m.player1_id
        if (map[m.winner_id]) { map[m.winner_id].W++; map[m.winner_id].pts += 3 }
        if (map[loserId])     { map[loserId].L++ }
      }
    })
    return Object.values(map).sort((a, b) => b.pts - a.pts || b.W - a.W)
  })() : []

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <p className="font-black text-gray-900">{event.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">{isKO ? 'Knockout' : 'Round Robin'} · {participants.length} participants</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={15} /></button>
        </div>
        <div className="flex border-b border-gray-100 px-5 flex-shrink-0">
          {['participants', 'bracket'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-3 px-4 text-sm font-bold border-b-2 transition ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-400'}`}>
              {t === 'participants' ? `Participants (${participants.length})` : 'Bracket / Results'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'participants' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">Select students for this tournament</p>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {availableStudents.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No students available</p>}
                {availableStudents.map(s => (
                  <label key={s.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={!!participants.find(p => p.id === s.id)} onChange={() => toggleP(s)} className="accent-brand-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.batch || 'No batch'}</p>
                    </div>
                  </label>
                ))}
              </div>
              <button onClick={saveParticipants} disabled={saving || participants.length < 2} className="w-full btn-primary justify-center">
                {saving ? 'Saving…' : `Save & Go to Bracket (${participants.length} players)`}
              </button>
            </div>
          )}

          {tab === 'bracket' && (
            <div className="space-y-4">
              {loading ? (
                <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
              ) : (
                <>
                  {finalWinner && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
                      <Trophy size={30} className="text-amber-500 mx-auto mb-2" />
                      <p className="font-black text-amber-700 text-xl">{finalWinner}</p>
                      <p className="text-sm text-amber-500 mt-0.5">Tournament Champion</p>
                    </div>
                  )}
                  {matches.length === 0 ? (
                    <div className="text-center py-10">
                      <Trophy size={36} className="text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-gray-400 mb-4">Bracket not drawn yet</p>
                      {participants.length >= 2
                        ? <button onClick={drawBracket} disabled={saving} className="btn-primary mx-auto">{saving ? 'Drawing…' : 'Draw Bracket'}</button>
                        : <p className="text-xs text-gray-400">Add participants first</p>}
                    </div>
                  ) : (
                    <>
                      {isKO && rounds.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {rounds.map(r => (
                            <button key={r} onClick={() => setActiveRound(r)}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition ${activeRound === r ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                              {roundLabel(r, totalRounds)}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="space-y-3">
                        {(isKO ? roundMatches : matches).map(m => (
                          <MatchCard key={m.id} match={m}
                            input={inputs[m.id]}
                            onChange={v => setInputs(prev => ({ ...prev, [m.id]: v }))}
                            onSave={() => saveResult(m)}
                            saving={saving} isRR={!isKO} />
                        ))}
                      </div>
                      {!isKO && rrStandings.length > 0 && (
                        <div>
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 mt-4">Standings</p>
                          <div className="bg-gray-50 rounded-xl overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-gray-200">
                                  {['#','Player','W','L','D','Pts'].map(h => (
                                    <th key={h} className={`${h==='Player'?'text-left px-3':'text-center px-2'} py-2 text-gray-400 font-semibold`}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rrStandings.map((s, i) => (
                                  <tr key={i} className={`border-b border-gray-100 ${i===0?'bg-amber-50':'bg-white'}`}>
                                    <td className="px-2 py-2 text-center font-bold text-gray-500">{i+1}</td>
                                    <td className="px-3 py-2 font-semibold text-gray-800">{s.name}</td>
                                    <td className="px-2 py-2 text-center text-emerald-600 font-bold">{s.W}</td>
                                    <td className="px-2 py-2 text-center text-red-400">{s.L}</td>
                                    <td className="px-2 py-2 text-center text-gray-400">{s.D}</td>
                                    <td className="px-2 py-2 text-center font-black text-brand-600">{s.pts}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {isKO && allRoundDone && roundMatches.length > 1 && (
                        <button onClick={advanceRound} disabled={saving} className="w-full btn-primary justify-center">
                          {saving ? 'Generating…' : `Generate ${roundLabel(activeRound + 1, totalRounds)} →`}
                        </button>
                      )}
                      <button
                        onClick={() => { if (window.confirm('Redraw bracket? All results will be cleared.')) drawBracket() }}
                        disabled={saving}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition">
                        <RotateCcw size={12} /> Redraw Bracket
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────
export default function Events() {
  const { events, addEvent, updateEvent, updateEventStatus, removeEvent, batches, students, staff } = useApp()
  const [showForm,        setShowForm]        = useState(false)
  const [editTarget,      setEditTarget]      = useState(null)
  const [tournamentEvent, setTournamentEvent] = useState(null)
  const [typeFilter,      setTypeFilter]      = useState('all')
  const [timeFilter,      setTimeFilter]      = useState('upcoming')
  const [deletingId,      setDeletingId]      = useState(null)

  const today     = new Date().toISOString().slice(0, 10)
  const allEvents = events || []

  const filtered = allEvents.filter(e => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false
    if (timeFilter === 'upcoming') return e.date >= today || e.status === 'Upcoming' || e.status === 'Ongoing'
    if (timeFilter === 'past')     return e.date < today  || e.status === 'Completed' || e.status === 'Cancelled'
    return true
  })

  const audienceLabel = (e) => {
    if (e.audience_type === 'students')      return 'All Students'
    if (e.audience_type === 'staff')         return 'All Staff'
    if (e.audience_type === 'batches')       return (e.audience_ids||[]).map(id=>(batches||[]).find(b=>b.id===id)?.name).filter(Boolean).join(', ')||'Batches'
    if (e.audience_type === 'staff_members') return (e.audience_ids||[]).map(id=>(staff||[]).find(s=>s.id===id)?.name).filter(Boolean).join(', ')||'Staff'
    return 'Everyone'
  }

  const handleCreate = async (form) => {
    let flyerUrl = null
    if (form.flyerFile) flyerUrl = await db.uploadEventFlyer(form.flyerFile, form.title)
    await addEvent({ title: form.title, type: form.type, sport: form.sport, date: form.date,
      endDate: form.endDate, venue: form.venue, description: form.description, status: 'Upcoming',
      audienceType: form.audienceType, audienceIds: form.audienceIds,
      bracketType: form.type === 'tournament' ? form.bracketType : null, flyerUrl, participants: [] })
  }

  const handleEdit = async (form) => {
    let flyerUrl = editTarget.flyer_url || null
    if (form.flyerFile) flyerUrl = await db.uploadEventFlyer(form.flyerFile, form.title)
    await updateEvent(editTarget.id, { title: form.title, type: form.type, sport: form.sport,
      date: form.date, endDate: form.endDate, venue: form.venue, description: form.description,
      audienceType: form.audienceType, audienceIds: form.audienceIds,
      bracketType: form.type === 'tournament' ? form.bracketType : null, flyerUrl })
    setEditTarget(null)
  }

  const editInitial = editTarget ? {
    id: editTarget.id, title: editTarget.title||'', type: editTarget.type||'event',
    sport: editTarget.sport||'', date: editTarget.date||'', endDate: editTarget.end_date||'',
    venue: editTarget.venue||'', description: editTarget.description||'',
    audienceType: editTarget.audience_type||'all', audienceIds: editTarget.audience_ids||[],
    bracketType: editTarget.bracket_type||'knockout', flyerUrl: editTarget.flyer_url||null, flyerFile: null,
  } : null

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Events &amp; Tournaments</h1>
          <p className="text-sm text-gray-500 mt-0.5">{allEvents.length} total</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary"><Plus size={16} /> New Event</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {[['all','All'],['event','Events'],['tournament','Tournaments']].map(([v,l]) => (
            <button key={v} onClick={() => setTypeFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${typeFilter===v?'bg-white text-gray-900 shadow-sm':'text-gray-500'}`}>{l}</button>
          ))}
        </div>
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {[['upcoming','Upcoming'],['past','Past'],['all','All Time']].map(([v,l]) => (
            <button key={v} onClick={() => setTimeFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${timeFilter===v?'bg-white text-gray-900 shadow-sm':'text-gray-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <Calendar size={40} className="text-gray-200 mx-auto mb-3" />
          <p className="font-bold text-gray-400">No events here</p>
          <p className="text-xs text-gray-300 mt-1">Create an event or tournament to get started</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map(e => (
          <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-5 hover:shadow-sm transition flex flex-col">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex flex-wrap gap-1.5">
                <span className={`badge ${e.type==='tournament'?'badge-yellow':'badge-purple'}`}>{e.type==='tournament'?'Tournament':'Event'}</span>
                <span className={`badge ${STATUS_COLOR[e.status]||'badge-gray'}`}>{e.status}</span>
                {e.sport && <span className="badge badge-blue">{e.sport}</span>}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => setEditTarget(e)} className="p-1.5 rounded-lg hover:bg-gray-100"><Pencil size={13} className="text-gray-400" /></button>
                <button onClick={async () => { setDeletingId(e.id); await removeEvent(e.id); setDeletingId(null) }}
                  disabled={deletingId===e.id} className="p-1.5 rounded-lg hover:bg-red-50">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            </div>
            <h3 className="font-black text-gray-900 text-base mb-2 leading-snug">{e.title}</h3>
            <div className="space-y-1.5 mb-3 flex-1">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Calendar size={12} className="text-gray-400 flex-shrink-0" />
                <span>
                  {e.date ? new Date(e.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}
                  {e.end_date && e.end_date !== e.date && ` – ${new Date(e.end_date).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`}
                </span>
              </div>
              {e.venue && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <MapPin size={12} className="text-gray-400 flex-shrink-0" /><span className="truncate">{e.venue}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Users size={12} className="text-gray-400 flex-shrink-0" /><span className="truncate">{audienceLabel(e)}</span>
              </div>
              {e.type === 'tournament' && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Trophy size={12} className="text-gray-400 flex-shrink-0" />
                  <span>{e.bracket_type==='round-robin'?'Round Robin':'Knockout'} · {(e.participants||[]).length} players</span>
                </div>
              )}
            </div>
            {e.description && <p className="text-xs text-gray-400 mb-3 line-clamp-2 leading-relaxed">{e.description}</p>}
            <div className="flex gap-2 pt-3 border-t border-gray-50">
              <select value={e.status} onChange={ev => updateEventStatus(e.id, ev.target.value)}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white cursor-pointer">
                {['Upcoming','Ongoing','Completed','Cancelled'].map(s => <option key={s}>{s}</option>)}
              </select>
              {e.type === 'tournament' && (
                <button onClick={() => setTournamentEvent(e)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold hover:bg-amber-100 transition">
                  <Trophy size={13} /> Bracket
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showForm    && <EventFormModal onClose={() => setShowForm(false)} onSave={handleCreate} batches={batches||[]} allStaff={staff||[]} />}
      {editTarget  && <EventFormModal initial={editInitial} onClose={() => setEditTarget(null)} onSave={handleEdit} batches={batches||[]} allStaff={staff||[]} />}
      {tournamentEvent && <TournamentModal event={tournamentEvent} students={students||[]} onClose={() => setTournamentEvent(null)} />}
    </div>
  )
}
