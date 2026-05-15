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
      <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center"
        style={{ background: 'linear-gradient(160deg,#f0f0ff 0%,#fff 60%)' }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          <TrendingUp size={32} className="text-white" />
        </div>
        <p className="text-xl font-black text-gray-900">No assessments yet</p>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed max-w-xs">
          Your coach hasn't submitted a performance assessment yet. Check back after your next session.
        </p>
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

        <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-6 relative">{sport} · Performance</p>

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
