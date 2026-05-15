import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { TrendingUp, Award } from 'lucide-react'
import * as db from '../../lib/db'
import {
  SPORT_CATEGORIES, FOOTBALL_CATEGORIES,
  getCategoryAvg, getOverallScore, getTier, monthLabel, SKILL_SHORTS,
  FOOTBALL_POSITIONS, POSITION_COLORS,
} from '../../lib/performance'

export default function StudentStats() {
  const { studentUser } = useApp()
  const [assessments, setAssessments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [activeCatId, setActiveCatId] = useState(null)

  useEffect(() => {
    if (!studentUser?.id) { setLoading(false); return }
    db.fetchStudentAssessments(studentUser.id)
      .then(data => { setAssessments(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [studentUser?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60">
        <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
      </div>
    )
  }

  if (!assessments.length) {
    return (
      <div className="min-h-screen pb-10" style={{ background: 'linear-gradient(160deg,#f0f0ff 0%,#fff 60%)' }}>
        <div className="flex flex-col items-center justify-center px-8 pt-16 pb-8 text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <TrendingUp size={32} className="text-white" />
          </div>
          <p className="text-xl font-black text-gray-900">No assessments yet</p>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed max-w-xs">
            Your coach hasn't submitted a performance assessment yet. Check back after your next session.
          </p>
        </div>
        {studentUser?.id && (
          <div className="px-4">
            <PitchViewCard
              batchId={studentUser.batch_id || null}
              currentStudentId={studentUser.id}
              overallScore={0}
            />
          </div>
        )}
      </div>
    )
  }

  const current      = assessments[selectedIdx]
  const prev         = assessments[selectedIdx + 1] || null
  const sport        = current.sport || 'Football'
  const categories   = SPORT_CATEGORIES[sport] || FOOTBALL_CATEGORIES
  const overall      = getOverallScore(current.scores, categories)
  const prevOverall  = prev ? getOverallScore(prev.scores, categories) : null
  const tier         = getTier(overall)
  const overallDelta = prevOverall !== null ? overall - prevOverall : null
  const activeCat    = categories.find(c => c.id === activeCatId) || null

  const radarData = activeCat
    ? activeCat.skills.map(skill => ({
        subject:   SKILL_SHORTS[skill] || skill,
        value:     Number(current.scores?.[skill] || 0),
        prevValue: prev ? Number(prev.scores?.[skill] || 0) : undefined,
        fullMark:  100,
      }))
    : categories.map(cat => ({
        subject:   cat.short,
        value:     getCategoryAvg(current.scores, cat.skills),
        prevValue: prev ? getCategoryAvg(prev.scores, cat.skills) : undefined,
        fullMark:  100,
      }))

  const historyData = [...assessments].reverse().map(a => ({
    month: monthLabel(a.assessed_month).split(' ')[0],
    score: getOverallScore(a.scores, categories),
  }))

  const radarColor = activeCat ? activeCat.color : '#6366f1'

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#f5f4ff 0%,#f9f9ff 40%,#fff 100%)' }}>

      {/* ── Premium Hero ── */}
      <div className="relative overflow-hidden px-5 pt-8 pb-12"
        style={{ background: 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 55%,#a855f7 100%)' }}>
        {/* Decorative circles */}
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle,#fff,transparent)' }} />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle,#fff,transparent)' }} />

        <div className="flex items-center gap-2 mb-6 relative">
          <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">{sport} · Performance</p>
          {studentUser?.position && (() => {
            const preset = FOOTBALL_POSITIONS.find(p => p.id === studentUser.position)
            const col    = preset ? POSITION_COLORS[preset.id] : null
            return (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/20 text-white backdrop-blur-sm">
                {preset ? `${preset.id} · ${preset.label}` : studentUser.position}
              </span>
            )
          })()}
        </div>

        <div className="flex items-center gap-6 relative">
          {/* Score ring — white on gradient */}
          <WhiteScoreRing score={overall} />

          <div>
            {/* Tier badge */}
            <div className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-full mb-3">
              <Award size={13} className="text-white/90" />
              <span className="text-xs font-black text-white">{tier.label} Tier</span>
            </div>
            <p className="text-4xl font-black text-white leading-none">
              {overall}<span className="text-lg font-bold text-white/60 ml-1">/100</span>
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-white/50">vs last month</span>
              {overallDelta !== null ? (
                <span className={`text-sm font-black px-2 py-0.5 rounded-full ${
                  overallDelta > 0 ? 'bg-emerald-400/30 text-emerald-200'
                  : overallDelta < 0 ? 'bg-red-400/30 text-red-200'
                  : 'text-white/40'
                }`}>
                  {overallDelta > 0 ? `+${overallDelta}` : overallDelta === 0 ? '—' : overallDelta}
                </span>
              ) : (
                <span className="text-xs text-white/40 italic">first assessment</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Pitch view */}
      {studentUser?.id && (
        <div className="px-4 mt-4 relative z-20 mb-1">
          <PitchViewCard
            batchId={studentUser.batch_id || null}
            currentStudentId={studentUser.id}
            overallScore={overall}
          />
        </div>
      )}

      {/* Month pills — overlap hero bottom */}
      {assessments.length > 1 && (
        <div className="px-4 -mt-4 relative z-10 mb-1">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {assessments.map((a, i) => (
              <button key={a.id || i}
                onClick={() => { setSelectedIdx(i); setActiveCatId(null) }}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold shadow-sm transition border ${
                  selectedIdx === i
                    ? 'bg-white text-indigo-700 border-indigo-200 shadow-indigo-100'
                    : 'bg-white/80 text-gray-500 border-gray-100'
                }`}>
                {monthLabel(a.assessed_month)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-4 space-y-4 pb-10">

        {/* ── Radar card ── */}
        <div className="bg-white rounded-3xl overflow-hidden"
          style={{ boxShadow: '0 4px 24px rgba(99,102,241,0.10), 0 1px 4px rgba(0,0,0,0.06)' }}>

          {/* Card header */}
          <div className="px-5 pt-5 pb-1">
            <p className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: activeCat ? activeCat.color : '#6366f1' }}>
              {activeCat ? activeCat.label : 'Skill Shape'}
            </p>
            <p className="text-lg font-black text-gray-900 mt-0.5">
              {activeCat ? 'Detailed view' : 'Your performance map'}
            </p>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} margin={{ top: 15, right: 28, bottom: 10, left: 28 }}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="subject"
                tick={{ fontSize: 10, fontWeight: 700, fill: activeCat ? activeCat.color : '#6b7280' }}
              />
              {prev && (
                <Radar name="prev" dataKey="prevValue"
                  stroke="#e5e7eb" fill="#f9fafb" fillOpacity={0.7} strokeWidth={1.5} />
              )}
              <Radar name="current" dataKey="value"
                stroke={radarColor} fill={radarColor} fillOpacity={0.18}
                strokeWidth={2.5}
                dot={{ r: 4, fill: radarColor, strokeWidth: 2, stroke: '#fff' }}
              />
            </RadarChart>
          </ResponsiveContainer>

          {/* Category pill tabs */}
          <div className="px-4 pb-5 flex gap-2 flex-wrap">
            {categories.map(cat => {
              const avg     = getCategoryAvg(current.scores, cat.skills)
              const isActive = activeCatId === cat.id
              return (
                <button key={cat.id}
                  onClick={() => setActiveCatId(isActive ? null : cat.id)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-black transition"
                  style={isActive
                    ? { backgroundColor: cat.color, color: '#fff', boxShadow: `0 4px 12px ${cat.color}55` }
                    : { backgroundColor: '#f3f4f6', color: '#6b7280' }
                  }>
                  <span>{cat.short}</span>
                  <span className={`text-sm font-black ${isActive ? 'text-white' : 'text-gray-800'}`}>{avg}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Skills panel ── */}
        {activeCat && (
          <div className="bg-white rounded-3xl overflow-hidden"
            style={{ boxShadow: `0 4px 24px ${activeCat.color}18, 0 1px 4px rgba(0,0,0,0.06)` }}>
            {/* Colored top stripe */}
            <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg,${activeCat.color},${activeCat.color}88)` }} />
            <div className="px-5 py-5 space-y-5">
              {activeCat.skills.map(skill => {
                const val        = Number(current.scores?.[skill] || 0)
                const prevVal    = prev?.scores?.[skill] != null ? Number(prev.scores[skill]) : null
                const skillDelta = prevVal !== null ? val - prevVal : null
                return (
                  <div key={skill}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-gray-700">{skill}</span>
                      <div className="flex items-center gap-2">
                        {skillDelta !== null && skillDelta !== 0 && (
                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                            skillDelta > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {skillDelta > 0 ? `+${skillDelta}` : skillDelta}
                          </span>
                        )}
                        <span className="text-xl font-black tabular-nums" style={{ color: activeCat.color }}>{val}</span>
                      </div>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-gray-100">
                      <div className="h-2.5 rounded-full transition-all duration-700"
                        style={{
                          width: `${val}%`,
                          background: `linear-gradient(90deg,${activeCat.color}99,${activeCat.color})`,
                        }} />
                    </div>
                  </div>
                )
              })}
            </div>
            {current.notes && (
              <div className="px-5 pb-5 pt-0">
                <div className="rounded-2xl p-4" style={{ backgroundColor: activeCat.color + '10' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: activeCat.color }}>Coach Note</p>
                  <p className="text-sm text-gray-700 italic">"{current.notes}"</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── History chart ── */}
        {historyData.length > 1 && (
          <div className="bg-white rounded-3xl p-5"
            style={{ boxShadow: '0 4px 24px rgba(99,102,241,0.08), 0 1px 4px rgba(0,0,0,0.05)' }}>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Progress</p>
            <p className="text-lg font-black text-gray-900 mt-0.5 mb-5">Score over time</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={historyData} margin={{ top: 5, right: 8, bottom: 5, left: -25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 700 }}
                  formatter={val => [`${val}/100`, 'Score']}
                />
                <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3}
                  dot={{ r: 5, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 7, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Tier scale ── */}
        <div className="bg-white rounded-3xl p-5"
          style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.05)' }}>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Tier Scale</p>
          <div className="space-y-3">
            {[
              { label: 'Elite',  range: '80–100', color: '#7c3aed', bg: '#f5f3ff' },
              { label: 'Gold',   range: '60–79',  color: '#d97706', bg: '#fffbeb' },
              { label: 'Silver', range: '40–59',  color: '#64748b', bg: '#f8fafc' },
              { label: 'Bronze', range: '0–39',   color: '#c2410c', bg: '#fff7ed' },
            ].map(t => {
              const isYou = t.label === tier.label
              return (
                <div key={t.label}
                  className={`flex items-center justify-between px-4 py-3 rounded-2xl transition ${isYou ? 'ring-2' : ''}`}
                  style={{ backgroundColor: t.bg, ringColor: t.color }}>
                  <span className="text-sm font-black" style={{ color: t.color }}>{t.label}</span>
                  <span className="text-xs font-semibold text-gray-400">{t.range}</span>
                  {isYou && (
                    <span className="text-xs font-black px-2.5 py-1 rounded-full text-white" style={{ backgroundColor: t.color }}>
                      You
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

function WhiteScoreRing({ score }) {
  const r    = 46
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <svg width="118" height="118" viewBox="0 0 118 118" className="flex-shrink-0">
      <circle cx="59" cy="59" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="10" />
      <circle cx="59" cy="59" r={r} fill="none" stroke="white" strokeWidth="10"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 59 59)"
        style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.6))', transition: 'stroke-dasharray 1s ease' }}
      />
      <text x="59" y="54" textAnchor="middle" fontSize="28" fontWeight="900" fill="white" fontFamily="system-ui,sans-serif">{score}</text>
      <text x="59" y="71" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.55)" fontFamily="system-ui,sans-serif">/100</text>
    </svg>
  )
}

// ── Pitch View ────────────────────────────────────────────────────────────────

function PitchViewCard({ batchId, currentStudentId, overallScore }) {
  const [students,      setStudents]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [resolvedBatch, setResolvedBatch] = useState(batchId)

  useEffect(() => {
    async function load() {
      try {
        let bid = batchId
        if (!bid) {
          bid = await db.fetchStudentAnyBatchId(currentStudentId)
          if (bid) setResolvedBatch(bid)
        }
        if (!bid) { setLoading(false); return }
        const data = await db.fetchBatchStudentsForPitch(bid)
        setStudents(data)
      } catch {}
      setLoading(false)
    }
    load()
  }, [batchId, currentStudentId])

  const positionedStudents = students.filter(s => FOOTBALL_POSITIONS.find(p => p.id === s.position))
  const customPositioned   = students.filter(s => s.position && !FOOTBALL_POSITIONS.find(p => p.id === s.position))
  const benchStudents      = students.filter(s => !s.position)

  return (
    <div className="bg-white rounded-3xl overflow-hidden"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)' }}>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Team</p>
          <p className="text-base font-black text-gray-900">Formation View</p>
        </div>
        <span className="text-xs text-gray-400 font-semibold">{students.length} players</span>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center">
          <svg className="animate-spin h-6 w-6 text-emerald-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      ) : !resolvedBatch ? (
        <p className="text-center text-sm text-gray-400 pb-8 px-4">You're not assigned to a batch yet. Ask your coach to add you.</p>
      ) : students.length === 0 ? (
        <p className="text-center text-sm text-gray-400 pb-8">No players in this batch yet.</p>
      ) : (
        <div className="px-3 pb-4">
          {/* Pitch */}
          <div className="relative rounded-2xl overflow-hidden" style={{ paddingBottom: '138%' }}>
            {/* Green pitch */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#14532d 0%,#166534 20%,#15803d 50%,#166534 80%,#14532d 100%)' }}>
              {[0,1,2,3,4,5,6,7].map(i => (
                <div key={i} className="absolute inset-x-0" style={{
                  top: `${i * 12.5}%`, height: '12.5%',
                  backgroundColor: i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'transparent',
                }} />
              ))}
            </div>

            {/* Field lines SVG */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 138" preserveAspectRatio="none">
              <rect x="3" y="3" width="94" height="132" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <line x1="3" y1="69" x2="97" y2="69" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <circle cx="50" cy="69" r="13" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <circle cx="50" cy="69" r="1.2" fill="rgba(255,255,255,0.8)"/>
              <rect x="22" y="3" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <rect x="35" y="3" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <rect x="22" y="115" width="56" height="20" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <rect x="35" y="125" width="30" height="10" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"/>
              <rect x="41" y="1" width="18" height="3" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="0.8"/>
              <rect x="41" y="134" width="18" height="3" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="0.8"/>
            </svg>

            {/* Preset-position players */}
            {FOOTBALL_POSITIONS.map(pos => {
              const student = positionedStudents.find(s => s.position === pos.id)
              if (!student) return null
              return (
                <PlayerDot key={pos.id}
                  student={student}
                  posId={pos.id}
                  x={pos.x}
                  y={pos.y}
                  isCurrent={student.id === currentStudentId}
                  score={student.id === currentStudentId ? overallScore : null}
                />
              )
            })}

            {/* Custom-position players — spread along centre */}
            {customPositioned.map((s, i) => (
              <PlayerDot key={s.id}
                student={s}
                posId={null}
                x={15 + (i % 5) * 17}
                y={50}
                isCurrent={s.id === currentStudentId}
                score={s.id === currentStudentId ? overallScore : null}
                customLabel={s.position}
              />
            ))}
          </div>

          {/* Bench — students without any position */}
          {benchStudents.length > 0 && (
            <div className="mt-3 px-3 py-3 bg-gray-50 rounded-2xl">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2.5">No Position Assigned</p>
              <div className="flex flex-wrap gap-3">
                {benchStudents.map(s => (
                  <div key={s.id} className="flex flex-col items-center gap-1">
                    <PlayerAvatar
                      photoUrl={s.photoUrl}
                      name={s.name}
                      size={34}
                      isCurrent={s.id === currentStudentId}
                      score={s.id === currentStudentId ? overallScore : null}
                      dark={false}
                    />
                    <span className="text-[8px] font-semibold text-gray-500 max-w-[40px] truncate text-center">
                      {s.name.split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlayerDot({ student, posId, x, y, isCurrent, score, customLabel }) {
  const posColor = posId ? POSITION_COLORS[posId] : null
  return (
    <div style={{
      position:  'absolute',
      top:       `${100 - y}%`,
      left:      `${x}%`,
      transform: 'translate(-50%, -50%)',
      zIndex:    isCurrent ? 10 : 5,
    }}>
      <div className="flex flex-col items-center" style={{ gap: 2 }}>
        <PlayerAvatar
          photoUrl={student.photoUrl}
          name={student.name}
          size={36}
          isCurrent={isCurrent}
          score={score}
          dark
        />
        <span style={{
          fontSize: 8, fontWeight: 700, color: '#fff',
          maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textShadow: '0 1px 4px rgba(0,0,0,0.9)',
        }}>
          {student.name.split(' ')[0]}
        </span>
        {posId && posColor && (
          <span style={{
            fontSize: 7, fontWeight: 900,
            backgroundColor: posColor.hex, color: '#fff',
            borderRadius: 4, padding: '1px 3px', lineHeight: 1.3,
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {posId}
          </span>
        )}
        {customLabel && (
          <span style={{
            fontSize: 7, fontWeight: 900,
            backgroundColor: '#4b5563', color: '#fff',
            borderRadius: 4, padding: '1px 3px', lineHeight: 1.3,
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {customLabel.length > 8 ? customLabel.slice(0, 7) + '…' : customLabel}
          </span>
        )}
      </div>
    </div>
  )
}

function PlayerAvatar({ photoUrl, name, size, isCurrent, score, dark }) {
  const border = isCurrent ? '2.5px solid #fff' : dark ? '2px solid rgba(255,255,255,0.4)' : '2px solid #e5e7eb'
  const shadow = isCurrent
    ? '0 0 0 2.5px #6366f1, 0 3px 10px rgba(0,0,0,0.5)'
    : dark ? '0 2px 6px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.12)'
  const bg     = isCurrent ? '#6366f1' : dark ? 'rgba(255,255,255,0.2)' : '#e5e7eb'
  const color  = dark ? '#fff' : '#6b7280'
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} style={{
          width: size, height: size, borderRadius: '50%', objectFit: 'cover',
          border, boxShadow: shadow,
        }} />
      ) : (
        <div style={{
          width: size, height: size, borderRadius: '50%',
          backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.38, fontWeight: 900, color,
          border, boxShadow: shadow,
        }}>
          {name?.[0]?.toUpperCase()}
        </div>
      )}
      {score > 0 && (
        <div style={{
          position: 'absolute', bottom: -4, right: -4,
          background: '#fbbf24', color: '#78350f',
          fontSize: 8, fontWeight: 900,
          borderRadius: 5, padding: '1px 3px', lineHeight: 1.3,
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.8)',
        }}>
          {score}
        </div>
      )}
    </div>
  )
}
