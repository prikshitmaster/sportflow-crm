import { useState, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { TrendingUp, Award, Sparkles } from 'lucide-react'
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

        {/* ── AI Coach Tip ── */}
        <AiCoachTip
          assessment={current}
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
        <div className="bg-white rounded-3xl p-5"
          style={{ boxShadow: '0 4px 24px rgba(99,102,241,0.08), 0 1px 4px rgba(0,0,0,0.05)' }}>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Progress</p>
          <p className="text-lg font-black text-gray-900 mt-0.5 mb-4">Score over time</p>
          {historyData.length > 1 ? (
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
          ) : (
            <div className="flex items-center gap-4 bg-indigo-50 rounded-2xl p-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <TrendingUp size={20} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Baseline: {historyData[0]?.score ?? overall}/100</p>
                <p className="text-xs text-gray-400 mt-0.5">Your trend graph appears after your second assessment</p>
              </div>
            </div>
          )}
        </div>

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
function AiCoachTip({ assessment, sport, categories, position, overall, tier, history, studentName, batch }) {
  const [tip,     setTip]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const cacheKey = `ai_tip_v6_${assessment.id || assessment.assessed_month}`

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

      const trendLine = history?.length > 1
        ? `Score trend: ${history.map(h => h.score).join(' → ')} (${history[history.length-1].score - history[0].score > 0 ? '+' : ''}${history[history.length-1].score - history[0].score} overall)`
        : 'First assessment — no trend data yet'

      const scoredSkills = categories.flatMap(cat =>
        cat.skills.map(s => ({ name: s, val: Number(assessment.scores?.[s] || 0) }))
      ).filter(x => x.val > 0).sort((a, b) => a.val - b.val)
      const weakest  = scoredSkills[0]
      const strongest = [...scoredSkills].sort((a, b) => b.val - a.val)[0]

      const posKey = Object.keys(POSITION_PRIORITIES).find(k =>
        position?.toUpperCase().includes(k)
      )
      const priorities = posKey ? POSITION_PRIORITIES[posKey] : null

      const prompt = `You are a UEFA Pro-Licensed ${sport || 'football'} coach with 20 years of elite youth development experience.

PLAYER: ${studentName || 'Player'}, ${batch || ''} batch
POSITION: ${position || 'Not assigned'}
OVERALL RATING: ${overall}/100 — ${tier.label} Tier
${trendLine}

INDIVIDUAL SKILL SCORES (out of 10):
${allSkills || '  No scores recorded'}

CATEGORY AVERAGES:
${catSummary}

KEY STRENGTHS: ${strongest ? `${strongest.name} (${strongest.val}/10)` : 'Not enough data'}
BIGGEST WEAKNESS: ${weakest ? `${weakest.name} (${weakest.val}/10)` : 'Not enough data'}
${priorities ? `CRITICAL SKILLS FOR ${position?.toUpperCase() || 'THIS POSITION'}: ${priorities.join(', ')}` : ''}
${assessment.notes ? `COACH OBSERVATION: "${assessment.notes}"` : ''}

Write the analysis directly to the player using "you/your". Use EXACTLY this markdown structure:

**Strength**
• Your [best skill] — [why it gives you an edge at your position]. One line.
• Your [second quality] — [what it enables you to do]. One line.

**This Week's Focus**
• [Most critical weakness] — [why it's holding you back at your position]. One line.
• [Second improvement area] — [specific aspect to work on]. One line.

**Drills**
• Drill Name (Xmin) — what to do and what it trains. One line.
• Drill Name (Xmin) — second drill, different muscle group. One line.

**Verdict**
One punchy sentence about what this player can become if they execute.

Rules: Address the player as "you/your". Use bullet points in every section except Verdict. Bold headers exactly as shown. No intro sentence, no greetings. Be specific — name real skills and real drills. Tone: direct, warm, confident like Pep Guardiola.`

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
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
      ) : !resolvedBatch && students.length === 0 ? (
        <p className="text-center text-sm text-gray-400 pb-8 px-4">You're not assigned to a batch yet. Ask your coach to add you.</p>
      ) : students.length === 0 ? (
        <p className="text-center text-sm text-gray-400 pb-8">No players in this batch yet.</p>
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
            <p className="text-center text-[10px] text-gray-400 mt-2">
              Tap your icon to see competitors at {currentStudent.position}
            </p>
          )}

          {/* ── Rivals panel ── */}
          {rivalMode && (
            <div className="mt-3 rounded-2xl overflow-hidden border border-indigo-100" style={{ background: 'linear-gradient(135deg,#eef2ff,#f5f3ff)' }}>
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-indigo-500 uppercase tracking-wider">
                    {currentStudent?.position} · Competitors
                  </p>
                  <p className="text-xs text-indigo-700 font-semibold mt-0.5">
                    {rivals.length === 0 ? 'No one else at this position yet' : `${rivals.length} player${rivals.length > 1 ? 's' : ''} competing for your spot`}
                  </p>
                </div>
                <button onClick={() => setRivalMode(false)} className="text-indigo-300 hover:text-indigo-500 text-lg leading-none">✕</button>
              </div>
              {rivals.length > 0 && (
                <div className="px-3 pb-3 space-y-2">
                  {rivals.map(r => {
                    const st = statsCache[r.id]
                    return (
                      <div key={r.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
                        <PlayerAvatar photoUrl={r.photoUrl} name={r.name} size={40} isCurrent={false} score={null} dark={false} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-gray-800 truncate">{r.name}</p>
                          {st === 'loading' ? (
                            <p className="text-xs text-gray-400">Loading…</p>
                          ) : st ? (
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${st.tier.bgClass} ${st.tier.textClass}`}>
                                {st.tier.label} · {st.overall}
                              </span>
                              {st.topSkill && (
                                <span className="text-[10px] text-gray-500">
                                  Top: <span className="font-bold text-gray-700">{SKILL_SHORTS[st.topSkill.skill] || st.topSkill.skill}</span> {st.topSkill.val}
                                </span>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">No assessment yet</p>
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
            <div className="mt-3 bg-gray-50 rounded-2xl p-3 border border-gray-100">
              <div className="flex items-center gap-3">
                <PlayerAvatar photoUrl={selectedStudent.photoUrl} name={selectedStudent.name} size={44} isCurrent={false} score={null} dark={false} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-black text-gray-900">{selectedStudent.name}</p>
                    {selectedStudent.position && (() => {
                      const preset = FOOTBALL_POSITIONS.find(p => p.id === selectedStudent.position)
                      const col    = preset ? POSITION_COLORS[preset.id] : null
                      return (
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${col ? `${col.bg} ${col.text}` : 'bg-gray-100 text-gray-600'}`}>
                          {selectedStudent.position}
                        </span>
                      )
                    })()}
                  </div>
                  {(() => {
                    const st = statsCache[selectedId]
                    if (st === 'loading') return <p className="text-xs text-gray-400 mt-0.5">Loading…</p>
                    if (st) return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${st.tier.bgClass} ${st.tier.textClass}`}>
                          {st.tier.label} · {st.overall}/100
                        </span>
                        {st.topSkill && (
                          <span className="text-[10px] text-gray-500">
                            Top: <span className="font-bold text-gray-700">{SKILL_SHORTS[st.topSkill.skill] || st.topSkill.skill}</span> {st.topSkill.val}
                          </span>
                        )}
                      </div>
                    )
                    return <p className="text-xs text-gray-400 italic mt-0.5">No assessment yet</p>
                  })()}
                </div>
                <button onClick={() => setSelectedId(null)} className="text-gray-300 hover:text-gray-500 text-lg leading-none flex-shrink-0">✕</button>
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
