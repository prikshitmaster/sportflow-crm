import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { TrendingUp, Award, Sparkles, FileText } from 'lucide-react'
import * as db from '../../lib/db'
import {
  SPORT_CATEGORIES, FOOTBALL_CATEGORIES,
  getCategoryAvg, getOverallScore, getTier, monthLabel, SKILL_SHORTS,
  FOOTBALL_POSITIONS, POSITION_COLORS,
} from '../../lib/performance'

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY

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
      <div className="min-h-screen pb-10" style={{ background: '#0f0f13' }}>
        <div className="flex flex-col items-center justify-center px-8 pt-16 pb-8 text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 32px rgba(99,102,241,0.4)' }}>
            <TrendingUp size={32} className="text-white" />
          </div>
          <p className="text-xl font-black" style={{ color: '#fff' }}>No assessments yet</p>
          <p className="text-sm mt-2 leading-relaxed max-w-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
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
    <div className="min-h-screen" style={{ background: '#0f0f13' }}>

      {/* ── Pro Hero ── */}
      <div className="relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg,#0d0d14 0%,#111827 60%,#0d1117 100%)' }}>

        {/* Top accent bar */}
        <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg,#6366f1,#a855f7,transparent)' }} />

        {/* Diagonal grid lines — subtle */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: 'repeating-linear-gradient(45deg,#fff 0,#fff 1px,transparent 0,transparent 50%)',
          backgroundSize: '24px 24px',
        }} />

        <div className="relative px-5 pt-5 pb-6">
          {/* Download PDF button (top-right) */}
          <button
            onClick={() => window.open('/student/assessment-report', '_blank')}
            className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border"
            style={{ borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc', background: 'rgba(99,102,241,0.1)' }}>
            <FileText size={11} /> PDF
          </button>

          {/* Sport + position row */}
          <div className="flex items-center gap-2 mb-5">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">{sport} · Performance</span>
            {studentUser?.position && (() => {
              const preset = FOOTBALL_POSITIONS.find(p => p.id === studentUser.position)
              const posCol = preset ? POSITION_COLORS[preset.id] : null
              return (
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: '0.08em',
                  padding: '2px 8px', borderRadius: 3,
                  backgroundColor: posCol?.hex || '#6366f1',
                  color: '#fff', textTransform: 'uppercase',
                }}>
                  {preset ? `${preset.id} · ${preset.label}` : studentUser.position}
                </span>
              )
            })()}
          </div>

          <div className="flex items-end gap-6">
            {/* Score ring */}
            <ScoreRingDark score={overall} tier={tier} />

            {/* Right stats */}
            <div className="flex-1 pb-1">
              {/* Tier strip */}
              <div className="flex items-center gap-2 mb-3">
                <div style={{
                  width: 3, height: 20, borderRadius: 2,
                  backgroundColor: tier.label === 'Elite' ? '#a855f7' : tier.label === 'Gold' ? '#f59e0b' : tier.label === 'Silver' ? '#94a3b8' : '#b45309',
                }} />
                <span style={{
                  fontSize: 11, fontWeight: 900, letterSpacing: '0.15em',
                  color: tier.label === 'Elite' ? '#c084fc' : tier.label === 'Gold' ? '#fbbf24' : tier.label === 'Silver' ? '#cbd5e1' : '#d97706',
                  textTransform: 'uppercase',
                }}>{tier.label} Tier</span>
              </div>

              {/* Big score */}
              <div className="flex items-baseline gap-1 mb-2">
                <span style={{ fontSize: 52, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-2px' }}>{overall}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>/100</span>
              </div>

              {/* Delta */}
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.05em' }}>VS LAST MONTH</span>
                {overallDelta !== null ? (
                  <span style={{
                    fontSize: 11, fontWeight: 900, padding: '1px 6px', borderRadius: 2,
                    backgroundColor: overallDelta > 0 ? 'rgba(52,211,153,0.15)' : overallDelta < 0 ? 'rgba(239,68,68,0.15)' : 'transparent',
                    color: overallDelta > 0 ? '#34d399' : overallDelta < 0 ? '#f87171' : 'rgba(255,255,255,0.25)',
                    border: `1px solid ${overallDelta > 0 ? 'rgba(52,211,153,0.3)' : overallDelta < 0 ? 'rgba(239,68,68,0.3)' : 'transparent'}`,
                  }}>
                    {overallDelta > 0 ? `+${overallDelta}` : overallDelta === 0 ? '—' : overallDelta}
                  </span>
                ) : (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>First</span>
                )}
              </div>
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

      {/* Month selector */}
      {assessments.length > 1 && (
        <div className="px-4 pt-3 pb-1" style={{ background: '#0f0f13' }}>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {assessments.map((a, i) => (
              <button key={a.id || i}
                onClick={() => { setSelectedIdx(i); setActiveCatId(null) }}
                style={{
                  flexShrink: 0, padding: '5px 14px', borderRadius: 3,
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                  textTransform: 'uppercase', transition: 'all 0.15s',
                  backgroundColor: selectedIdx === i ? '#6366f1' : 'rgba(255,255,255,0.06)',
                  color: selectedIdx === i ? '#fff' : 'rgba(255,255,255,0.35)',
                  border: `1px solid ${selectedIdx === i ? '#6366f1' : 'rgba(255,255,255,0.08)'}`,
                }}>
                {monthLabel(a.assessed_month)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pt-3 space-y-3 pb-10" style={{ background: '#0f0f13' }}>

        {/* ── Radar card ── */}
        <div style={{ background: '#16161d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>

          {/* Card header */}
          <div className="px-5 pt-4 pb-1 flex items-center justify-between">
            <div>
              <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: activeCat ? activeCat.color : '#6366f1' }}>
                {activeCat ? activeCat.label : 'Skill Radar'}
              </p>
              <p style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginTop: 2 }}>
                {activeCat ? 'Drill Down' : 'Performance Map'}
              </p>
            </div>
            {activeCat && (
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: activeCat.color, boxShadow: `0 0 8px ${activeCat.color}` }} />
            )}
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

          {/* Category selector — sharp sport tabs */}
          <div className="px-4 pb-4 flex gap-2 flex-wrap">
            {categories.map(cat => {
              const avg      = getCategoryAvg(current.scores, cat.skills)
              const isActive = activeCatId === cat.id
              const barColor = avg >= 75 ? '#22c55e' : avg >= 55 ? '#f59e0b' : '#ef4444'
              return (
                <button key={cat.id}
                  onClick={() => setActiveCatId(isActive ? null : cat.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', borderRadius: 4,
                    backgroundColor: isActive ? cat.color : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${isActive ? cat.color : 'rgba(255,255,255,0.08)'}`,
                    boxShadow: isActive ? `0 0 12px ${cat.color}44` : 'none',
                    transition: 'all 0.15s',
                  }}>
                  <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: isActive ? '#fff' : 'rgba(255,255,255,0.45)' }}>{cat.short}</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: isActive ? '#fff' : barColor }}>{avg}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Skills panel ── */}
        {activeCat && (
          <div style={{ background: '#16161d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
            {/* Left accent bar */}
            <div style={{ height: 2, background: `linear-gradient(90deg,${activeCat.color},transparent)` }} />
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {activeCat.skills.map(skill => {
                const val        = Number(current.scores?.[skill] || 0)
                const prevVal    = prev?.scores?.[skill] != null ? Number(prev.scores[skill]) : null
                const skillDelta = prevVal !== null ? val - prevVal : null
                const barColor   = val >= 75 ? '#22c55e' : val >= 55 ? '#f59e0b' : '#ef4444'
                return (
                  <div key={skill}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.65)', letterSpacing: '0.02em' }}>{skill}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {skillDelta !== null && skillDelta !== 0 && (
                          <span style={{
                            fontSize: 9, fontWeight: 900, padding: '1px 5px', borderRadius: 2,
                            backgroundColor: skillDelta > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: skillDelta > 0 ? '#4ade80' : '#f87171',
                            border: `1px solid ${skillDelta > 0 ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                          }}>
                            {skillDelta > 0 ? `+${skillDelta}` : skillDelta}
                          </span>
                        )}
                        <span style={{ fontSize: 20, fontWeight: 900, color: barColor, tabularNums: true, letterSpacing: '-0.5px' }}>{val}</span>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: 3, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
                      <div style={{
                        height: 3, borderRadius: 2,
                        width: `${val}%`,
                        background: `linear-gradient(90deg,${barColor}88,${barColor})`,
                        boxShadow: `0 0 6px ${barColor}66`,
                        transition: 'width 0.7s ease',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
            {current.notes && (
              <div style={{ padding: '0 20px 16px' }}>
                <div style={{ padding: '10px 14px', borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.04)', borderLeft: `3px solid ${activeCat.color}` }}>
                  <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', color: activeCat.color, marginBottom: 4 }}>Coach Note</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic' }}>"{current.notes}"</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── AI Coach Tip ── */}
        <AiCoachTip
          assessment={current}
          allAssessments={assessments}
          sport={sport}
          categories={categories}
          position={studentUser?.position}
          overall={overall}
          tier={tier}
          history={historyData}
          studentName={studentUser?.name?.split(' ')[0]}
          batch={studentUser?.batch}
        />

        {/* ── History chart ── */}
        <div style={{ background: '#16161d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ height: 2, background: 'linear-gradient(90deg,#6366f1,transparent)' }} />
          <div style={{ padding: '16px 20px 4px' }}>
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6366f1' }}>Progress</p>
            <p style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginTop: 2, marginBottom: 16 }}>Score over time</p>
          </div>
          {historyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={historyData} margin={{ top: 5, right: 16, bottom: 8, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.35)', fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.25)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: '#1e1e2e', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontSize: 13, fontWeight: 700, color: '#fff' }}
                  formatter={val => [`${val}/100`, 'Score']}
                  labelStyle={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                />
                <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2.5}
                  dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#0f0f13' }}
                  activeDot={{ r: 6, fill: '#818cf8', stroke: '#0f0f13', strokeWidth: 2 }}
                  style={{ filter: 'drop-shadow(0 0 4px #6366f188)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ margin: '0 16px 16px', padding: '14px 16px', borderRadius: 8, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <TrendingUp size={18} style={{ color: '#818cf8' }} />
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Baseline: {historyData[0]?.score ?? overall}/100</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>Trend graph appears after your second assessment</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Tier scale ── */}
        <div style={{ background: '#16161d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ height: 2, background: 'linear-gradient(90deg,#a855f7,transparent)' }} />
          <div style={{ padding: '16px 20px 4px' }}>
            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>Tier Scale</p>
          </div>
          <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Elite',  range: '80–100', color: '#a855f7', glow: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.3)' },
              { label: 'Gold',   range: '60–79',  color: '#f59e0b', glow: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
              { label: 'Silver', range: '40–59',  color: '#94a3b8', glow: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)' },
              { label: 'Bronze', range: '0–39',   color: '#b45309', glow: 'rgba(180,83,9,0.12)',   border: 'rgba(180,83,9,0.25)'   },
            ].map(t => {
              const isYou = t.label === tier.label
              return (
                <div key={t.label} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 8,
                  backgroundColor: isYou ? t.glow : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isYou ? t.border : 'rgba(255,255,255,0.06)'}`,
                  boxShadow: isYou ? `0 0 16px ${t.glow}` : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: t.color }} />
                    <span style={{ fontSize: 13, fontWeight: 900, color: isYou ? t.color : 'rgba(255,255,255,0.5)', letterSpacing: '0.04em' }}>{t.label}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)' }}>{t.range}</span>
                    {isYou && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 3,
                        backgroundColor: t.color, color: '#fff', letterSpacing: '0.06em',
                      }}>YOU</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Position priority map — what a pro coach values per role ─
const POSITION_PRIORITIES = {
  GK:  ['Shot Stopping', 'Distribution', 'Positioning', 'Commanding Area'],
  CB:  ['Aerial/Heading', 'Defensive Positioning', 'Tackling', 'Passing from Back'],
  LB:  ['Defensive Tracking', 'Crossing', 'Stamina', 'Pace'],
  RB:  ['Defensive Tracking', 'Crossing', 'Stamina', 'Pace'],
  CDM: ['Ball Winning', 'Positioning', 'Short Passing', 'Stamina'],
  CM:  ['Passing Range', 'Movement', 'Decision Making', 'Stamina'],
  CAM: ['Creativity', 'Final Pass', 'Movement off Ball', 'Shooting'],
  LW:  ['Dribbling', 'Pace', 'Crossing/Cutting Inside', 'Finishing'],
  RW:  ['Dribbling', 'Pace', 'Crossing/Cutting Inside', 'Finishing'],
  ST:  ['Finishing', 'Movement off Ball', 'Hold-up Play', 'Aerial Ability'],
  SS:  ['Movement', 'Finishing', 'Link-up Play', 'Dribbling'],
}

function renderInline(text) {
  // Render **bold** inline
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )
}

function TipDisplay({ tip }) {
  const blocks = tip.trim().split('\n')
  const elements = []
  let sectionCount = 0

  blocks.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return

    if (line.startsWith('**') && line.endsWith('**')) {
      const label = line.slice(2, -2)
      elements.push(
        <div key={`h${i}`} className={sectionCount > 0 ? 'pt-3 border-t border-white/10' : ''}>
          <p className="text-xs font-bold text-violet-300 mb-1">{label}</p>
        </div>
      )
      sectionCount++
    } else if (/^\d+\./.test(line)) {
      const num  = line.match(/^(\d+)\./)[1]
      const text = line.replace(/^\d+\.\s*/, '')
      const parts = text.split(/\s*—\s*/)
      elements.push(
        <div key={`n${i}`} className="flex items-start gap-2.5 ml-0.5">
          <span className="text-violet-400 text-xs font-black mt-0.5 flex-shrink-0 w-4 text-center">{num}.</span>
          <p className="text-sm text-white/85 leading-snug">
            {parts.length > 1
              ? <><span className="font-semibold text-white">{parts[0]}</span><span className="text-white/55"> — {parts.slice(1).join(' — ')}</span></>
              : renderInline(text)}
          </p>
        </div>
      )
    } else if (line.startsWith('•') || line.startsWith('-')) {
      const text = line.replace(/^[•\-]\s*/, '')
      const parts = text.split(/\s*—\s*/)
      elements.push(
        <div key={`b${i}`} className="flex items-start gap-2.5 ml-0.5">
          <span className="text-violet-400 text-xs mt-1 flex-shrink-0">▸</span>
          <p className="text-sm text-white/85 leading-snug">
            {parts.length > 1
              ? <><span className="font-semibold text-white">{parts[0]}</span><span className="text-white/55"> — {parts.slice(1).join(' — ')}</span></>
              : renderInline(text)}
          </p>
        </div>
      )
    } else {
      elements.push(
        <p key={`p${i}`} className="text-sm text-white/80 leading-relaxed">{renderInline(line)}</p>
      )
    }
  })

  return <div className="space-y-2">{elements}</div>
}

// ── AI Coaching Tip ──────────────────────────────────────
function AiCoachTip({ assessment, allAssessments, sport, categories, position, overall, tier, history, studentName, batch }) {
  const [tip,     setTip]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // Cache invalidates when latest notes OR any historical note changes
  const allNotesStamp = (allAssessments || [assessment])
    .map(a => (a.notes || '').trim().slice(0, 15))
    .join('|')
    .replace(/\s+/g, '_')
  const cacheKey = `ai_tip_v8_${assessment.id || assessment.assessed_month}_${allNotesStamp}`

  useEffect(() => {
    if (!GROQ_KEY) return
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) { setTip(cached); return }
    generate()
  }, [cacheKey])

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const history_full = (allAssessments || [assessment])

      // Latest assessment scores
      const allSkills = categories.flatMap(cat =>
        cat.skills.map(s => {
          const val = Number(assessment.scores?.[s] || 0)
          return val > 0 ? `  ${s}: ${val}/10` : null
        }).filter(Boolean)
      ).join('\n')

      const catSummary = categories.map(cat => {
        const avg = getCategoryAvg(assessment.scores, cat.skills)
        return `  ${cat.label || cat.short}: ${avg}/100`
      }).join('\n')

      // Score trend across all months
      const trendLine = history?.length > 1
        ? `Score trend: ${history.map(h => `${h.month}:${h.score}`).join(' → ')} (${history[history.length-1].score - history[0].score >= 0 ? '+' : ''}${history[history.length-1].score - history[0].score} overall)`
        : 'First assessment — no trend yet'

      // All coach notes across all months (most recent first)
      const allNotes = history_full
        .filter(a => a.notes?.trim())
        .map(a => `  [${monthLabel(a.assessed_month)}]: "${a.notes.trim()}"`)
        .join('\n')

      // Recurring themes in coach notes
      const noteCount = history_full.filter(a => a.notes?.trim()).length
      const latestNote = assessment.notes?.trim()

      const scoredSkills = categories.flatMap(cat =>
        cat.skills.map(s => ({ name: s, val: Number(assessment.scores?.[s] || 0) }))
      ).filter(x => x.val > 0).sort((a, b) => a.val - b.val)
      const weakest   = scoredSkills[0]
      const strongest = [...scoredSkills].sort((a, b) => b.val - a.val)[0]

      // Per-skill trend: show improvement/decline for top weak skills
      const skillTrends = scoredSkills.slice(0, 3).map(sk => {
        const vals = history_full.map(a => Number(a.scores?.[sk.name] || 0)).filter(v => v > 0)
        if (vals.length < 2) return null
        const delta = vals[0] - vals[vals.length - 1]
        return `  ${sk.name}: ${vals.join('→')} (${delta >= 0 ? '+' : ''}${delta})`
      }).filter(Boolean).join('\n')

      const posKey = Object.keys(POSITION_PRIORITIES).find(k =>
        position?.toUpperCase().includes(k)
      )
      const priorities = posKey ? POSITION_PRIORITIES[posKey] : null

      const hasNotes  = !!allNotes
      const hasLatest = !!latestNote

      const prompt = `You are a UEFA Pro-Licensed ${sport || 'football'} coach with 20 years of elite youth development experience. You have been tracking this player across ${history_full.length} assessment${history_full.length > 1 ? 's' : ''}.

PLAYER: ${studentName || 'Player'}, ${batch || ''} batch
POSITION: ${position || 'Not assigned'}
CURRENT RATING: ${overall}/100 — ${tier.label} Tier
${trendLine}

CURRENT MONTH SKILL SCORES (out of 10):
${allSkills || '  No scores recorded'}

CATEGORY AVERAGES (current):
${catSummary}

KEY STRENGTH: ${strongest ? `${strongest.name} (${strongest.val}/10)` : 'Not enough data'}
BIGGEST WEAKNESS: ${weakest ? `${weakest.name} (${weakest.val}/10)` : 'Not enough data'}
${skillTrends ? `SKILL TRENDS (weakest skills, oldest→newest):\n${skillTrends}` : ''}
${priorities ? `CRITICAL SKILLS FOR ${position?.toUpperCase()}: ${priorities.join(', ')}` : ''}
${hasNotes ? `
⚑ COACH OBSERVATIONS ACROSS ALL SESSIONS (${noteCount} note${noteCount > 1 ? 's' : ''} — HIGHEST PRIORITY):
${allNotes}
${noteCount > 1 ? 'Identify PATTERNS — if the coach has flagged the same issue multiple times, it is a persistent problem that MUST be the primary focus.' : ''}
${hasLatest ? `The LATEST note is: "${latestNote}" — this is the most current priority.` : ''}
Your analysis MUST be shaped by these coach observations. They override scores.` : ''}

Write directly to the player ("you/your"). Use EXACTLY this structure:

**Strength**
• Your [top skill] — [edge it gives at your position]. One line.
• Your [second quality] — [what it unlocks]. One line.

**This Week's Focus**
• [${hasNotes ? 'Top issue from coach notes — especially if recurring' : 'Biggest weakness from scores'}] — [why it holds you back]. One line.
• [${hasNotes ? 'Second coach-flagged or score-based issue' : 'Second weakness'}] — [specific aspect]. One line.

**Drills**
1. Drill Name (Xmin) — [directly addresses ${hasLatest ? 'latest coach note' : 'top weakness'}]. One line.
2. Drill Name (Xmin) — [addresses score gap or recurring coach theme]. One line.
3. Drill Name (Xmin) — [targets position-critical skill]. One line.
4. Drill Name (Xmin) — [complements drill 1, different muscle group or skill]. One line.
5. Drill Name (Xmin) — [match-realistic drill combining strength + technique]. One line.

**Verdict**
One punchy sentence tying ${noteCount > 1 ? 'the recurring coach observations' : hasLatest ? "the coach's note" : 'the data'} to what this player can become.

Rules: Bold headers exactly as shown. No intro. No greetings. Real drills, real skills. ${hasNotes ? 'Coach notes = ground truth. Recurring notes = urgent.' : ''} Tone: direct, warm, like Pep Guardiola.`

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 380,
          temperature: 0.8,
        }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error.message); return }
      const text = json.choices?.[0]?.message?.content?.trim()
      if (text) { sessionStorage.setItem(cacheKey, text); setTip(text) }
      else setError('No response from AI')
    } catch (e) {
      setError(e.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!GROQ_KEY) return null

  return (
    <div className="rounded-3xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)', boxShadow: '0 8px 40px rgba(99,102,241,0.32)' }}>
      <div className="px-5 py-5">
        <div className="flex items-center justify-between gap-2.5 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(167,139,250,0.25)', border: '1px solid rgba(167,139,250,0.3)' }}>
              <Sparkles size={15} className="text-violet-300" />
            </div>
            <div>
              <p className="text-[10px] font-black text-violet-400 uppercase tracking-widest leading-none">AI Coach Analysis</p>
              <p className="text-[9px] text-violet-600 mt-0.5">Personalised for your position & scores</p>
            </div>
          </div>
          {!loading && (tip || error) && (
            <button onClick={() => { sessionStorage.removeItem(cacheKey); setTip(null); generate() }}
              className="text-[10px] text-violet-500 hover:text-violet-300 transition">↺ refresh</button>
          )}
        </div>

        {loading ? (
          <div className="space-y-2.5">
            <div className="h-2.5 rounded-full bg-white/8 animate-pulse w-full" />
            <div className="h-2.5 rounded-full bg-white/8 animate-pulse w-11/12" />
            <div className="h-2.5 rounded-full bg-white/8 animate-pulse w-4/5" />
            <div className="h-2.5 rounded-full bg-white/8 animate-pulse w-10/12" />
            <p className="text-[10px] text-violet-500 mt-2">Analysing your performance data…</p>
          </div>
        ) : error ? (
          <div>
            <p className="text-xs text-red-400 mb-2">{error}</p>
            <button onClick={generate} className="text-[11px] font-bold text-violet-400 underline">Try again</button>
          </div>
        ) : tip ? (
          <TipDisplay tip={tip} />
        ) : null}
      </div>
    </div>
  )
}

function ScoreRingDark({ score, tier }) {
  const r     = 42
  const circ  = 2 * Math.PI * r
  const dash  = (score / 100) * circ
  const color = tier.label === 'Elite' ? '#a855f7' : tier.label === 'Gold' ? '#f59e0b' : tier.label === 'Silver' ? '#94a3b8' : '#b45309'
  return (
    <svg width="100" height="100" viewBox="0 0 100 100" style={{ flexShrink: 0 }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="butt"
        transform="rotate(-90 50 50)"
        style={{ filter: `drop-shadow(0 0 6px ${color}99)`, transition: 'stroke-dasharray 1s ease' }}
      />
      {/* Tick marks */}
      {[0,25,50,75,100].map(v => {
        const angle = (v / 100) * 360 - 90
        const rad   = (angle * Math.PI) / 180
        const x1 = 50 + (r - 4) * Math.cos(rad)
        const y1 = 50 + (r - 4) * Math.sin(rad)
        const x2 = 50 + (r + 1) * Math.cos(rad)
        const y2 = 50 + (r + 1) * Math.sin(rad)
        return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
      })}
      <text x="50" y="46" textAnchor="middle" fontSize="24" fontWeight="900" fill="white" fontFamily="system-ui,sans-serif" letterSpacing="-1">{score}</text>
      <text x="50" y="60" textAnchor="middle" fontSize="9" fontWeight="700" fill="rgba(255,255,255,0.3)" fontFamily="system-ui,sans-serif" letterSpacing="1">SCORE</text>
    </svg>
  )
}

// ── Pitch View ────────────────────────────────────────────────────────────────

function PitchViewCard({ batchId, currentStudentId, overallScore }) {
  const [students,      setStudents]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [resolvedBatch, setResolvedBatch] = useState(batchId)
  const [selectedId,    setSelectedId]    = useState(null)   // tapped other player
  const [rivalMode,     setRivalMode]     = useState(false)  // tapped self → show competitors
  const [statsCache,    setStatsCache]    = useState({})
  const [coach,         setCoach]         = useState(null)

  useEffect(() => {
    async function load() {
      try {
        // Fetch batchmates across ALL batches the student belongs to
        const data = await db.fetchStudentBatchmatesForPitch(currentStudentId)
        if (data.length > 0) {
          setResolvedBatch(true)
          setStudents(data)
        } else {
          let bid = batchId || await db.fetchStudentAnyBatchId(currentStudentId)
          if (bid) {
            setResolvedBatch(bid)
            const fallback = await db.fetchBatchStudentsForPitch(bid)
            setStudents(fallback)
          }
        }
        // Fetch assigned coach for the batch
        const bid = batchId || await db.fetchStudentAnyBatchId(currentStudentId)
        if (bid) {
          const coachInfo = await db.fetchBatchCoachInfo(bid)
          if (coachInfo) setCoach(coachInfo)
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [batchId, currentStudentId])

  const fetchStats = async (studentId) => {
    if (statsCache[studentId] !== undefined) return
    setStatsCache(prev => ({ ...prev, [studentId]: 'loading' }))
    try {
      const assessments = await db.fetchStudentAssessments(studentId)
      if (assessments.length) {
        const overall  = getOverallScore(assessments[0].scores, FOOTBALL_CATEGORIES)
        const tier     = getTier(overall)
        const topSkill = Object.entries(assessments[0].scores || {})
          .map(([skill, val]) => ({ skill, val: Number(val) }))
          .filter(x => x.val > 0)
          .sort((a, b) => b.val - a.val)[0] || null
        setStatsCache(prev => ({ ...prev, [studentId]: { overall, tier, topSkill } }))
      } else {
        setStatsCache(prev => ({ ...prev, [studentId]: null }))
      }
    } catch {
      setStatsCache(prev => ({ ...prev, [studentId]: null }))
    }
  }

  const handleTap = (student) => {
    if (student.id === currentStudentId) {
      const entering = !rivalMode
      setRivalMode(entering)
      setSelectedId(null)
      if (entering) {
        const rivals = students.filter(s => s.id !== currentStudentId && s.position === student.position)
        rivals.forEach(r => fetchStats(r.id))
      }
    } else {
      setSelectedId(prev => prev === student.id ? null : student.id)
      setRivalMode(false)
      fetchStats(student.id)
    }
  }

  const positionedStudents = students.filter(s => FOOTBALL_POSITIONS.find(p => p.id === s.position))
  const customPositioned   = students.filter(s => s.position && !FOOTBALL_POSITIONS.find(p => p.id === s.position))
  const benchStudents      = students.filter(s => !s.position)

  // Group all positioned students by position (multiple players can share a slot)
  const positionGroups = {}
  positionedStudents.forEach(s => {
    if (!positionGroups[s.position]) positionGroups[s.position] = []
    positionGroups[s.position].push(s)
  })

  // Ghost fill: assign bench students to empty position slots (deterministic by id order)
  const filledIds     = new Set(positionedStudents.map(s => s.position))
  const emptySlots    = FOOTBALL_POSITIONS.filter(p => !filledIds.has(p.id))
  const sortedBench   = [...benchStudents].sort((a, b) => a.id - b.id)
  const ghostMap      = {}  // { posId: student }
  emptySlots.forEach((pos, i) => { if (sortedBench[i]) ghostMap[pos.id] = sortedBench[i] })
  const ghostedIds    = new Set(Object.values(ghostMap).map(s => s.id))
  const trueBench     = benchStudents.filter(s => !ghostedIds.has(s.id))

  const currentStudent = students.find(s => s.id === currentStudentId)
  const rivals = rivalMode && currentStudent?.position
    ? students.filter(s => s.id !== currentStudentId && s.position === currentStudent.position)
    : []

  const selectedStudent = selectedId ? students.find(s => s.id === selectedId) : null

  return (
    <div style={{ background: '#16161d', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ height: 2, background: 'linear-gradient(90deg,#10b981,transparent)' }} />
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#10b981' }}>Team</p>
          <p style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginTop: 2 }}>Formation View</p>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>{students.length} players</span>
      </div>

      {loading ? (
        <div className="h-40 flex items-center justify-center">
          <svg className="animate-spin h-6 w-6" style={{ color: '#10b981' }} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
        </div>
      ) : !resolvedBatch && students.length === 0 ? (
        <p className="text-center pb-8 px-4" style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>You're not assigned to a batch yet. Ask your coach to add you.</p>
      ) : students.length === 0 ? (
        <p className="text-center pb-8" style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>No players in this batch yet.</p>
      ) : (
        <div className="px-3 pb-4">
          {/* Pitch */}
          <div className="relative rounded-2xl overflow-hidden" style={{ paddingBottom: '138%' }}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,#14532d 0%,#166534 20%,#15803d 50%,#166534 80%,#14532d 100%)' }}>
              {[0,1,2,3,4,5,6,7].map(i => (
                <div key={i} className="absolute inset-x-0" style={{
                  top: `${i * 12.5}%`, height: '12.5%',
                  backgroundColor: i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'transparent',
                }} />
              ))}
            </div>
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

            {/* Real positioned players — all students per slot, offset horizontally */}
            {FOOTBALL_POSITIONS.map(pos => {
              const group = positionGroups[pos.id]
              if (!group || group.length === 0) return null
              const total  = group.length
              const spread = Math.min((total - 1) * 8, 20) // max 20% spread
              return group.map((student, idx) => {
                const offset = total === 1 ? 0 : -spread / 2 + (spread / (total - 1)) * idx
                return (
                  <PlayerDot key={student.id} student={student} posId={pos.id}
                    x={pos.x + offset} y={pos.y}
                    isCurrent={student.id === currentStudentId}
                    score={student.id === currentStudentId ? overallScore : null}
                    onTap={() => handleTap(student)}
                    highlighted={rivalMode && student.id === currentStudentId}
                  />
                )
              })
            })}

            {/* Completely empty slots — show position label only */}
            {FOOTBALL_POSITIONS.map(pos => {
              const hasPlayer = positionGroups[pos.id]?.length > 0
              const hasGhost  = ghostMap[pos.id]
              if (hasPlayer || hasGhost) return null
              const posColor = POSITION_COLORS[pos.id]
              return (
                <div key={`empty-${pos.id}`} style={{
                  position: 'absolute',
                  top: `${100 - pos.y}%`, left: `${pos.x}%`,
                  transform: 'translate(-50%, -50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    border: '1.5px dashed rgba(255,255,255,0.35)',
                  }} />
                  <span style={{
                    fontSize: 7, fontWeight: 900,
                    backgroundColor: 'rgba(0,0,0,0.40)', color: 'rgba(255,255,255,0.7)',
                    borderRadius: 4, padding: '1px 4px', lineHeight: 1.4,
                  }}>{pos.id}</span>
                </div>
              )
            })}

            {/* Ghost fill — bench students at empty positions, show slot label */}
            {Object.entries(ghostMap).map(([posId, student]) => {
              const pos = FOOTBALL_POSITIONS.find(p => p.id === posId)
              if (!pos) return null
              return (
                <PlayerDot key={`ghost-${student.id}`} student={student} posId={posId}
                  x={pos.x} y={pos.y}
                  isCurrent={false} score={null}
                  onTap={() => handleTap(student)}
                  ghost
                />
              )
            })}

            {/* Coach — center circle */}
            {coach && <CoachDot coach={coach} />}

            {/* Custom-position players */}
            {customPositioned.map((s, i) => (
              <PlayerDot key={s.id} student={s} posId={null}
                x={15 + (i % 5) * 17} y={50}
                isCurrent={s.id === currentStudentId}
                score={s.id === currentStudentId ? overallScore : null}
                onTap={() => handleTap(s)}
                customLabel={s.position}
              />
            ))}
          </div>

          {/* ── Tap hint ── */}
          {currentStudent?.position && !rivalMode && !selectedId && (
            <p className="text-center mt-2" style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
              Tap your icon to see competitors at {currentStudent.position}
            </p>
          )}

          {/* ── Rivals panel ── */}
          {rivalMode && (
            <div style={{ marginTop: 12, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(99,102,241,0.25)', background: 'rgba(99,102,241,0.08)' }}>
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <div>
                  <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#818cf8' }}>
                    {currentStudent?.position} · Competitors
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                    {rivals.length === 0 ? 'No one else at this position yet' : `${rivals.length} player${rivals.length > 1 ? 's' : ''} competing for your spot`}
                  </p>
                </div>
                <button onClick={() => setRivalMode(false)} style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
              {rivals.length > 0 && (
                <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rivals.map(r => {
                    const st = statsCache[r.id]
                    return (
                      <div key={r.id} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <PlayerAvatar photoUrl={r.photoUrl} name={r.name} size={40} isCurrent={false} score={null} dark />
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: 13, fontWeight: 900, color: '#fff' }} className="truncate">{r.name}</p>
                          {st === 'loading' ? (
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Loading…</p>
                          ) : st ? (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 4, backgroundColor: `${st.tier.hex}22`, color: st.tier.hex, border: `1px solid ${st.tier.hex}44` }}>
                                {st.tier.label} · {st.overall}
                              </span>
                              {st.topSkill && (
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                                  Top: <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>{SKILL_SHORTS[st.topSkill.skill] || st.topSkill.skill}</span> {st.topSkill.val}
                                </span>
                              )}
                            </div>
                          ) : (
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>No assessment yet</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Quick stats panel (other player tapped) ── */}
          {selectedStudent && !rivalMode && (
            <div style={{ marginTop: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-3">
                <PlayerAvatar photoUrl={selectedStudent.photoUrl} name={selectedStudent.name} size={44} isCurrent={false} score={null} dark />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>{selectedStudent.name}</p>
                    {selectedStudent.position && (() => {
                      const preset = FOOTBALL_POSITIONS.find(p => p.id === selectedStudent.position)
                      const hex    = preset ? POSITION_COLORS[preset.id]?.hex : null
                      return (
                        <span style={{ fontSize: 9, fontWeight: 900, padding: '2px 6px', borderRadius: 3, backgroundColor: hex || '#374151', color: '#fff' }}>
                          {selectedStudent.position}
                        </span>
                      )
                    })()}
                  </div>
                  {(() => {
                    const st = statsCache[selectedId]
                    if (st === 'loading') return <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Loading…</p>
                    if (st) return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 7px', borderRadius: 4, backgroundColor: `${st.tier.hex}22`, color: st.tier.hex, border: `1px solid ${st.tier.hex}44` }}>
                          {st.tier.label} · {st.overall}/100
                        </span>
                        {st.topSkill && (
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                            Top: <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>{SKILL_SHORTS[st.topSkill.skill] || st.topSkill.skill}</span> {st.topSkill.val}
                          </span>
                        )}
                      </div>
                    )
                    return <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', marginTop: 2 }}>No assessment yet</p>
                  })()}
                </div>
                <button onClick={() => setSelectedId(null)} style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

function CoachDot({ coach }) {
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    }}>
      {/* Tactics board icon above avatar */}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
        <rect x="1" y="2" width="14" height="12" rx="2" fill="#d97706" stroke="#fff" strokeWidth="1"/>
        <rect x="4" y="0.5" width="8" height="3" rx="1" fill="#d97706" stroke="#fff" strokeWidth="1"/>
        <line x1="4" y1="7" x2="12" y2="7" stroke="white" strokeWidth="1" strokeDasharray="2 1"/>
        <line x1="4" y1="10" x2="9"  y2="10" stroke="white" strokeWidth="1" strokeDasharray="2 1"/>
        <circle cx="11" cy="10" r="1.2" fill="white"/>
      </svg>

      {/* Avatar */}
      <div style={{ position: 'relative' }}>
        {coach.photoUrl ? (
          <img src={coach.photoUrl} alt={coach.name} style={{
            width: 38, height: 38, borderRadius: '50%', objectFit: 'cover',
            border: '2.5px solid #fbbf24',
            boxShadow: '0 0 0 2px #d97706, 0 3px 10px rgba(0,0,0,0.5)',
          }} />
        ) : (
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: 'linear-gradient(135deg,#f59e0b,#d97706)',
            border: '2.5px solid #fbbf24',
            boxShadow: '0 0 0 2px #d97706, 0 3px 10px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 900, color: '#fff',
          }}>
            {coach.name?.[0]?.toUpperCase()}
          </div>
        )}
      </div>

      {/* Name */}
      <span style={{
        fontSize: 7, fontWeight: 700, color: '#fff', maxWidth: 52,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        textShadow: '0 1px 4px rgba(0,0,0,0.9)',
      }}>
        {coach.name.split(' ')[0]}
      </span>

      {/* COACH chip */}
      <span style={{
        fontSize: 7, fontWeight: 900,
        background: 'linear-gradient(90deg,#d97706,#b45309)',
        color: '#fff', borderRadius: 4, padding: '1px 4px', lineHeight: 1.4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
      }}>COACH</span>
    </div>
  )
}

function PlayerDot({ student, posId, x, y, isCurrent, score, customLabel, onTap, ghost, highlighted }) {
  const posColor = posId ? POSITION_COLORS[posId] : null
  return (
    <div
      onClick={onTap}
      style={{
        position:  'absolute',
        top:       `${100 - y}%`,
        left:      `${x}%`,
        transform: 'translate(-50%, -50%)',
        zIndex:    isCurrent ? 10 : ghost ? 3 : 5,
        opacity:   ghost ? 0.42 : 1,
        cursor:    'pointer',
      }}
    >
      <div className="flex flex-col items-center" style={{ gap: 2 }}>
        <PlayerAvatar
          photoUrl={student.photoUrl}
          name={student.name}
          size={ghost ? 30 : 36}
          isCurrent={isCurrent}
          score={score}
          dark
          highlighted={highlighted}
          posHex={posColor?.hex}
        />
        {!ghost && (
          <span style={{
            fontSize: 8, fontWeight: 700, color: '#fff',
            maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}>
            {student.name.split(' ')[0]}
          </span>
        )}
        {posId && posColor && (
          <span style={{
            fontSize: 7, fontWeight: 900,
            backgroundColor: ghost ? 'rgba(0,0,0,0.45)' : posColor.hex,
            color: '#fff',
            borderRadius: 4, padding: '1px 4px', lineHeight: 1.4,
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            {posId}
          </span>
        )}
        {!ghost && customLabel && (
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

function PlayerAvatar({ photoUrl, name, size, isCurrent, score, dark, highlighted, posHex }) {
  const border = isCurrent ? '2.5px solid #fff' : dark ? '2px solid rgba(255,255,255,0.5)' : '2px solid #e5e7eb'
  const shadow = highlighted
    ? '0 0 0 3px #fbbf24, 0 0 12px #fbbf2488, 0 3px 10px rgba(0,0,0,0.5)'
    : isCurrent
    ? '0 0 0 2.5px #6366f1, 0 3px 10px rgba(0,0,0,0.5)'
    : dark ? '0 2px 6px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.12)'
  // Use position colour for identity on pitch; fallback to indigo for current, grey for rest
  const bg     = isCurrent ? '#6366f1' : posHex ? posHex : dark ? '#374151' : '#e5e7eb'
  const color  = '#fff'
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {photoUrl ? (
        <img src={photoUrl} alt={name} loading="lazy" style={{
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
