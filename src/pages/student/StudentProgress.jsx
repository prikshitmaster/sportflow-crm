// Student Development page — what the player sees of their own progress.
//
// Pulls together everything from session_feedback + player_goals:
//   1. This month's focus goal (set by coach)
//   2. Last 7 sessions trend chart (Effort / Execution / Focus)
//   3. Today's self-reflection card (only after coach has rated them today)
//   4. Coach spotlights — detailed 4-corner feedback + notes

import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Target, Sparkles, MessageCircle, TrendingUp, CheckCircle2, BarChart3, ChevronRight, FileText,
} from 'lucide-react'

const pad2     = (n) => String(n).padStart(2, '0')
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`

const CORNERS = [
  { key: 'technical', label: 'TECH', full: 'Technical', color: '#3b82f6' },
  { key: 'tactical',  label: 'TACT', full: 'Tactical',  color: '#a855f7' },
  { key: 'physical',  label: 'PHYS', full: 'Physical',  color: '#f97316' },
  { key: 'mental',    label: 'MENT', full: 'Mental',    color: '#ec4899' },
]

function formatDate(dateStr) {
  const d     = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  const diff = Math.round((today - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7)   return `${diff} days ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function StudentProgress() {
  const { studentUser } = useApp()
  const isFootball = studentUser?.sport?.toLowerCase() === 'football'
  const now      = new Date()
  const today    = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const monthStr = monthKey(now)

  const [feedback, setFeedback]     = useState([])
  const [goal, setGoal]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [self, setSelf]             = useState({ energy: null, performance: null, focus: null })
  const [savedSelf, setSavedSelf]   = useState(false)
  const [savingSelf, setSavingSelf] = useState(false)

  useEffect(() => {
    if (!studentUser?.id) return
    Promise.all([
      db.fetchStudentFeedback(studentUser.id, 30).catch(() => []),
      db.fetchPlayerGoal(studentUser.id, monthStr).catch(() => null),
    ]).then(([fb, g]) => {
      setFeedback(fb)
      setGoal(g)
      const todayRow = fb.find(r => r.date === today)
      if (todayRow?.self_at) {
        setSelf({
          energy:      todayRow.self_energy,
          performance: todayRow.self_performance,
          focus:       todayRow.self_focus,
        })
        setSavedSelf(true)
      }
      setLoading(false)
    })
  }, [studentUser?.id])

  // Last 7 sessions where coach actually rated — chronological for chart
  const trendData = useMemo(() => (
    [...feedback]
      .filter(r => r.effort && r.execution && r.focus)
      .slice(0, 7)
      .reverse()
      .map(r => ({
        date:      r.date.slice(5),    // 'MM-DD' is enough on x-axis
        Effort:    r.effort,
        Execution: r.execution,
        Focus:     r.focus,
      }))
  ), [feedback])

  const spotlights = feedback.filter(r => r.spotlight_at)
  const todayRow   = feedback.find(r => r.date === today)
  const canReflect = !!todayRow?.effort  // can only self-rate after coach has rated

  async function saveReflection() {
    if (!todayRow) return
    setSavingSelf(true)
    try {
      await db.saveSelfReflection({
        date:        today,
        batchId:     todayRow.batch_id,
        academyId:   studentUser?.academy_id,
        studentId:   studentUser.id,
        energy:      self.energy,
        performance: self.performance,
        focus:       self.focus,
      })
      setSavedSelf(true)
    } catch (e) {
      alert(`Save failed: ${e.message}`)
    } finally {
      setSavingSelf(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <svg className="animate-spin h-7 w-7 text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-900">My Development</h1>
          <p className="text-sm text-gray-500">Your coach feedback &amp; focus</p>
        </div>
        {isFootball && (
          <button
            onClick={() => window.open('/student/assessment-report', '_blank')}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-sm active:scale-95 transition">
            <FileText size={13} /> PDF
          </button>
        )}
      </div>

      {/* This month's focus goal */}
      {goal ? (
        <div className="bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <Target size={16} />
            <p className="text-[10px] font-black uppercase tracking-widest opacity-90">This Month's Focus</p>
          </div>
          <p className="text-lg font-black leading-tight">{goal.goal_text}</p>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
          <Target size={20} className="text-gray-300 flex-shrink-0" />
          <p className="text-sm text-gray-400">No focus set this month yet — check back soon.</p>
        </div>
      )}

      {/* Trend chart */}
      {trendData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-brand-600" />
            <p className="text-sm font-bold text-gray-900">Last {trendData.length} sessions</p>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={trendData} margin={{ top: 5, right: 10, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 3]} ticks={[1, 2, 3]} tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }}
                labelStyle={{ fontWeight: 700, color: '#374151' }}
              />
              <Line type="monotone" dataKey="Effort"    stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Execution" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Focus"     stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 justify-center text-[10px] text-gray-600 font-semibold">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Effort</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Execution</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Focus</span>
          </div>
        </div>
      )}

      {/* Self-reflection — only when coach has already rated today's session */}
      {canReflect && (
        <div className="bg-white rounded-2xl border border-brand-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle size={16} className="text-brand-600" />
            <p className="text-sm font-bold text-gray-900">How did today feel?</p>
          </div>
          {savedSelf ? (
            <div className="text-center py-3">
              <CheckCircle2 size={28} className="text-emerald-500 mx-auto" />
              <p className="text-xs text-gray-500 mt-1.5">Reflection saved — coach can see this</p>
            </div>
          ) : (
            <>
              <SelfRow label="Energy"      v={self.energy}      onChange={v => setSelf(p => ({ ...p, energy: v }))} />
              <SelfRow label="Performance" v={self.performance} onChange={v => setSelf(p => ({ ...p, performance: v }))} />
              <SelfRow label="Focus"       v={self.focus}       onChange={v => setSelf(p => ({ ...p, focus: v }))} />
              <button
                onClick={saveReflection}
                disabled={!self.energy || !self.performance || !self.focus || savingSelf}
                className="w-full mt-3 bg-brand-600 text-white rounded-xl py-2.5 font-bold text-sm disabled:opacity-40"
              >
                {savingSelf ? 'Saving…' : 'Save reflection'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Coach spotlights */}
      {spotlights.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-amber-500" />
            <p className="text-sm font-bold text-gray-900">Coach Feedback</p>
          </div>
          <div className="space-y-2">
            {spotlights.slice(0, 5).map(r => (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
                <p className="text-[11px] text-gray-400 font-bold uppercase tracking-wide">{formatDate(r.date)}</p>
                <div className="grid grid-cols-4 gap-2">
                  {CORNERS.map(c => (
                    <div key={c.key} className="text-center">
                      <p className="text-[9px] font-black text-gray-400 tracking-wide">{c.label}</p>
                      <div className="flex justify-center gap-0.5 mt-1.5">
                        {[1, 2, 3].map(i => (
                          <span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full transition-colors"
                            style={{ background: r[c.key] && i <= r[c.key] ? c.color : '#e5e7eb' }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {r.note && (
                  <p className="text-xs text-gray-700 italic border-t border-gray-100 pt-2 leading-relaxed">"{r.note}"</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {spotlights.length === 0 && trendData.length === 0 && !canReflect && (
        <div className="text-center py-10">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <TrendingUp size={24} className="text-gray-300" />
          </div>
          <p className="text-sm font-bold text-gray-500">No feedback yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            After your next session, your coach will rate your effort and focus — it'll show up here.
          </p>
        </div>
      )}

      {/* Link to detailed monthly stats — football only (pitch view + position ratings) */}
      {isFootball && <Link
        to="/student/stats"
        className="block w-full bg-white rounded-2xl border border-gray-100 p-3.5 flex items-center justify-between active:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-50 rounded-xl flex items-center justify-center">
            <BarChart3 size={16} className="text-indigo-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Detailed stats</p>
            <p className="text-[11px] text-gray-400">Monthly skill assessment scores</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-300" />
      </Link>}
    </div>
  )
}

function SelfRow({ label, v, onChange }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <p className="text-xs font-bold text-gray-600 w-24 shrink-0">{label}</p>
      <div className="flex-1 grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map(val => (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={`py-2 rounded-lg text-xs font-bold border transition ${
              v === val
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-400 border-gray-200'
            }`}
          >
            {val === 1 ? 'Low' : val === 2 ? 'OK' : 'Great'}
          </button>
        ))}
      </div>
    </div>
  )
}
