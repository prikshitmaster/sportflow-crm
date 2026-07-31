// Student Performance — owner-facing analysis for Football.
//
// The three performance tables are all populated by coaches but had never been
// joined on one screen: skill_assessments (monthly, 0-100, 28 skills),
// session_feedback (per-session pulse 1-3), attendance. This page unifies them
// per student, and lets the academy set a development plan off the back of it.
//
// BRANCH ISOLATION — none of these tables is branch-scoped by RLS
// (skill_assessments is literally `USING (true)`), so isolation is enforced
// here: every fetched row is filtered through `visibleIds`, which is derived
// from the already sport+branch-scoped `students` in context. App.jsx also
// remounts this page on scope change via key={sport-branch}.
//
// SCALES — assessments are 0-100/month, pulse is 1-3/session. They are shown in
// separate cards and never averaged together.

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Search, TrendingUp, TrendingDown, Star, Target, FileDown, FileSpreadsheet,
  CalendarCheck, Activity, ChevronRight, ChevronLeft, X, Sparkles,
} from 'lucide-react'
import { Modal } from './Students'
import StudentAvatar from '../components/StudentAvatar'
import Paginator, { PAGE_SIZE } from '../components/Paginator'
import DevFillButton from '../components/DevFillButton'
import { Skeleton } from '../components/Skeleton'
import {
  SPORT_CATEGORIES, FOOTBALL_CATEGORIES, getCategoryAvg, getOverallScore,
  getTier, SKILL_SHORTS, monthLabel, buildMonthOpts, POSITION_COLORS,
} from '../lib/performance'
import { exportPerformanceReport } from '../lib/performancePDF'
import { saveOrShareFile } from '../lib/nativeSave'
import { notify } from '../lib/notifications'

const MONTH_OPTS = buildMonthOpts(12)
const TIERS = ['All', 'Elite', 'Gold', 'Silver', 'Bronze']

// Same presets the coach sees in StaffAssess → Goals, so the two surfaces agree.
const GOAL_PRESETS = [
  'Improve weak foot', 'Better positioning', 'First touch under pressure',
  'Pass accuracy', 'Defensive awareness', 'Communication on field',
  'Fitness & stamina', 'Decision making', 'Shooting power', 'Aerial duels',
]

const MAX_FOCUS = 5

// 'YYYY-MM' → previous month, same format
function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// CSV writer — same shape as Reports.jsx:41, routed through nativeSave so it
// works inside the Android app too.
async function downloadCSV(headers, rows, filename) {
  const lines = [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
  ]
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  await saveOrShareFile(blob, filename)
}

// Remount on scope change so no fetched row, selection or filter can survive a
// sport/branch switch. Same guard Reports.jsx:243 uses on its stateful tabs.
export default function StudentPerformance() {
  const { selectedSport, selectedBranch } = useApp()
  return <PerformanceView key={`${selectedSport}-${selectedBranch}`} />
}

function PerformanceView() {
  const { students, batches, selectedSport, user, role, showToast } = useApp()

  const [month,       setMonth]       = useState(MONTH_OPTS[0].value)
  const [current,     setCurrent]     = useState([])   // assessments for `month`
  const [previous,    setPrevious]    = useState([])   // assessments for month-1
  const [loading,     setLoading]     = useState(true)
  const [selectedId,  setSelectedId]  = useState(null)
  const [search,      setSearch]      = useState('')
  const [tierFilter,  setTierFilter]  = useState('All')
  const [batchFilter, setBatchFilter] = useState('All')
  const [page,        setPage]        = useState(1)

  // Non-owners use their own sport(s) — selectedSport is null in their
  // session (owner-only concept). Mirrors Sidebar.jsx's footballOk check.
  const effectiveSport = role === 'owner' ? selectedSport : (user?.sports?.[0] || null)
  const isFootball = (effectiveSport || '').toLowerCase() === 'football'
  const academyId  = user?.academyId

  // Active only — matches every other performance surface (Reports'
  // PerformanceTab and the coach's Assess/Goals tabs all filter to Active).
  // Without this the "Assessed n/N" denominator counted suspended students who
  // are never going to be assessed, so the ratio could never reach 100%.
  const roster = useMemo(
    () => students.filter(s => s.status === 'Active'),
    [students]
  )

  // The isolation boundary. Everything fetched is filtered against this.
  const visibleIds = useMemo(
    () => new Set(roster.map(s => String(s.id))),
    [roster]
  )

  useEffect(() => { setPage(1) }, [search, tierFilter, batchFilter, month])

  // ── List data: 2 queries, regardless of student count ──────────────────
  useEffect(() => {
    if (!isFootball || !academyId) { setLoading(false); return }
    if (roster.length === 0) { setCurrent([]); setPrevious([]); setLoading(false); return }
    let alive = true
    setLoading(true)
    // Query by the branch's own student ids, NOT academy-wide: an academy-wide
    // month query can exceed PostgREST's max-rows cap and drop a whole branch's
    // rows silently. The visibleIds filter below stays as a second line.
    const ids = roster.map(s => s.id)
    Promise.all([
      db.fetchAssessmentsForStudents(ids, month),
      db.fetchAssessmentsForStudents(ids, prevMonthKey(month)),
    ])
      .then(([cur, prev]) => {
        if (!alive) return
        // Branch/sport isolation — drop anything outside the visible roster.
        setCurrent((cur  || []).filter(a => visibleIds.has(String(a.student_id))))
        setPrevious((prev || []).filter(a => visibleIds.has(String(a.student_id))))
      })
      .catch(() => { if (alive) { setCurrent([]); setPrevious([]) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isFootball, academyId, month, roster, visibleIds])

  // ── Rows: one entry per visible student ────────────────────────────────
  // skill_assessments is unique on (student_id, assessed_month, SPORT), so a
  // student assessed in two sports in one month has two rows. Keying a Map by
  // student_id alone would keep whichever happened to come last — pick the row
  // matching the student's own sport instead, and only fall back if there
  // isn't one.
  const pickForSport = (rows, student) => {
    if (!rows || rows.length === 0) return undefined
    if (rows.length === 1) return rows[0]
    const want = (student.sport || '').toLowerCase()
    return rows.find(r => (r.sport || '').toLowerCase() === want) || rows[0]
  }

  const entries = useMemo(() => {
    const groupBy = (list) => {
      const m = new Map()
      list.forEach(a => {
        const k = String(a.student_id)
        if (!m.has(k)) m.set(k, [])
        m.get(k).push(a)
      })
      return m
    }
    const curBy  = groupBy(current)
    const prevBy = groupBy(previous)

    return roster.map(s => {
      const a    = pickForSport(curBy.get(String(s.id)), s)
      const p    = pickForSport(prevBy.get(String(s.id)), s)
      const cats = SPORT_CATEGORIES[a?.sport || s.sport] || FOOTBALL_CATEGORIES
      const score     = a ? getOverallScore(a.scores, cats) : null
      const prevScore = p ? getOverallScore(p.scores, cats) : null
      return {
        s, assessment: a, prev: p, cats, score, prevScore,
        delta: score != null && prevScore != null ? score - prevScore : null,
        tier:  score != null ? getTier(score) : null,
      }
    })
  }, [roster, current, previous])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries
      .filter(e => {
        if (q && !(
          e.s.name?.toLowerCase().includes(q) ||
          e.s.studentCode?.toLowerCase().includes(q)
        )) return false
        if (batchFilter !== 'All' && e.s.batch !== batchFilter) return false
        if (tierFilter  !== 'All' && e.tier?.label !== tierFilter) return false
        return true
      })
      // Assessed first, highest score first; unassessed alphabetically at the end.
      .sort((a, b) => {
        if (a.score == null && b.score == null) return a.s.name.localeCompare(b.s.name)
        if (a.score == null) return 1
        if (b.score == null) return -1
        return b.score - a.score
      })
  }, [entries, search, batchFilter, tierFilter])

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const kpis = useMemo(() => {
    const scored = entries.filter(e => e.score != null)
    const avg = scored.length
      ? Math.round(scored.reduce((sum, e) => sum + e.score, 0) / scored.length)
      : 0
    return {
      assessed:  scored.length,
      total:     entries.length,
      avg,
      improving: entries.filter(e => e.delta != null && e.delta > 0).length,
      attention: entries.filter(e => e.score != null && e.score < 40).length,
    }
  }, [entries])

  const selected = useMemo(
    // Re-check membership so a stale selection can never survive a branch switch.
    () => filtered.find(e => String(e.s.id) === String(selectedId))
       || entries.find(e => String(e.s.id) === String(selectedId) && visibleIds.has(String(e.s.id)))
       || null,
    [filtered, entries, selectedId, visibleIds]
  )

  const exportCsv = async () => {
    const headers = ['Student', 'ID', 'Batch', 'Position', 'Overall', 'Tier', 'Change vs prev', ...FOOTBALL_CATEGORIES.map(c => c.label)]
    const rows = filtered.map(e => [
      e.s.name, e.s.studentCode || '', e.s.batch || '', e.s.position || '',
      e.score ?? '', e.tier?.label ?? 'Not assessed',
      e.delta == null ? '' : (e.delta > 0 ? `+${e.delta}` : e.delta),
      ...FOOTBALL_CATEGORIES.map(c => e.assessment ? getCategoryAvg(e.assessment.scores, c.skills) : ''),
    ])
    try {
      await downloadCSV(headers, rows, `performance-${month}.csv`)
      showToast?.('CSV exported')
    } catch { showToast?.('Export failed', 'error') }
  }

  // ── Football-only gate. Hooks above always run; this just controls render. ──
  if (!isFootball) {
    return (
      <div className="max-w-[1400px]">
        <div className="bg-white border border-gray-200 rounded-xl px-6 py-12 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Star size={20} className="text-gray-400" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">Performance is Football-only</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            The skill rubric — 28 skills across Technical, Tactical, Fitness and Mental —
            is defined for Football. Switch to a Football branch to use this page.
          </p>
          {effectiveSport && effectiveSport !== 'All' && (
            <p className="text-xs text-gray-400 mt-3">Currently viewing {effectiveSport}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-[1400px]">

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 tracking-tight">Student Performance</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            Skill assessments, session pulse and attendance in one view · {monthLabel(month)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className="text-[13px] font-medium bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-gray-300"
            value={month} onChange={e => setMonth(e.target.value)}
          >
            {MONTH_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={exportCsv} className="btn-ghost">
            <FileSpreadsheet size={14} className="text-gray-400" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Assessed" value={`${kpis.assessed}/${kpis.total}`}
          sub={kpis.total ? `${Math.round((kpis.assessed / kpis.total) * 100)}% of active students` : 'No active students'}
          icon={CalendarCheck} />
        <Kpi label="Average Score" value={kpis.avg || '—'}
          sub={kpis.avg ? getTier(kpis.avg).label : 'Not assessed yet'} icon={Star} />
        <Kpi label="Improving" value={kpis.improving}
          sub={`vs ${monthLabel(prevMonthKey(month))}`} icon={TrendingUp} />
        <Kpi label="Needs Attention" value={kpis.attention} sub="Scoring under 40"
          icon={TrendingDown} tone={kpis.attention > 0 ? 'negative' : 'muted'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-5 items-start">

        {/* ── List pane ── */}
        {/* On phones this and the detail pane are two separate "screens" —
            only one is ever visible, swapped by selection — since the grid
            just stacks them on narrow viewports otherwise, burying the
            detail a full scrolled-past list below where you tapped. lg+
            keeps the always-both-visible desktop layout unconditionally. */}
        <div className={`bg-white border border-gray-200 rounded-xl overflow-hidden ${selected ? 'hidden lg:block' : ''}`}>
          <div className="px-4 py-3 border-b border-gray-200 space-y-2.5">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Search size={14} className="text-gray-400 shrink-0" />
              <input
                className="bg-transparent text-sm w-full focus:outline-none text-gray-700 placeholder-gray-400"
                placeholder="Search name or ID…"
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <select className="flex-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none"
                value={tierFilter} onChange={e => setTierFilter(e.target.value)}>
                {TIERS.map(t => <option key={t} value={t}>{t === 'All' ? 'All tiers' : t}</option>)}
              </select>
              <select className="flex-1 text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 focus:outline-none"
                value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
                <option value="All">All batches</option>
                {batches.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-400">No students match these filters</p>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {paged.map(e => (
                  <button
                    key={e.s.id}
                    onClick={() => { setSelectedId(e.s.id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      String(selectedId) === String(e.s.id) ? 'bg-gray-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <StudentAvatar photoUrl={e.s.photoUrl} name={e.s.name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-gray-900 truncate">{e.s.name}</span>
                      <span className="block text-[11px] text-gray-400 truncate">
                        {e.s.batch || 'No batch'}{e.s.position ? ` · ${e.s.position}` : ''}
                      </span>
                    </span>
                    {e.score == null ? (
                      <span className="text-[11px] text-gray-400 shrink-0">Not assessed</span>
                    ) : (
                      <span className="text-right shrink-0">
                        <span className="block text-sm font-semibold text-gray-900 tabular-nums">{e.score}</span>
                        <span className={`block text-[10px] font-medium ${e.tier.textClass}`}>{e.tier.label}</span>
                      </span>
                    )}
                    <Delta value={e.delta} />
                  </button>
                ))}
              </div>
              <div className="px-4 py-2 border-t border-gray-200">
                <Paginator page={page} total={filtered.length} onChange={setPage} />
              </div>
            </>
          )}
        </div>

        {/* ── Detail pane ── */}
        <div className={`lg:col-span-2 ${selected ? '' : 'hidden lg:block'}`}>
          {selected && (
            <button onClick={() => setSelectedId(null)}
              className="lg:hidden flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 mb-3">
              <ChevronLeft size={16} /> Back to list
            </button>
          )}
          {selected ? (
            <DetailOverview
              key={selected.s.id}
              entry={selected}
              month={month}
              academyId={academyId}
              academyName={user?.academy}
              staffId={null}
              showToast={showToast}
            />
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl px-6 py-16 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Activity size={20} className="text-gray-400" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">Select a student</h3>
              <p className="text-sm text-gray-500">
                Pick anyone from the list to see their full performance breakdown.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Detail overview ─────────────────────────────────────────────────────────

function DetailOverview({ entry, month, academyId, academyName, staffId, showToast }) {
  const { s, assessment, prev, cats, score, prevScore, delta, tier } = entry

  const [history,    setHistory]    = useState([])
  const [pulse,      setPulse]      = useState([])
  const [spotlights, setSpotlights] = useState([])
  const [goal,       setGoal]       = useState(null)
  const [attendance, setAttendance] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [planOpen,   setPlanOpen]   = useState(false)
  const [activeCat,  setActiveCat]  = useState(null)   // drill into one category

  useEffect(() => {
    let alive = true
    setLoading(true)

    // Last 3 months of attendance, 1 query each. fetchAttendanceForStudents
    // takes a ZERO-BASED month and returns { studentId: { day: status } }.
    const [my, mm] = month.split('-').map(Number)
    const attMonths = [0, 1, 2].map(back => {
      const d = new Date(my, mm - 1 - back, 1)
      return { year: d.getFullYear(), m0: d.getMonth() }
    })

    // Each fetch fails independently — attendance and assessment readers throw
    // on anything but a missing table, and one bad call shouldn't blank the
    // whole panel.
    const safe = (p, fallback) => p.catch(() => fallback)

    Promise.all([
      // ForCoach variant adds the academy_id filter. fetchStudentAssessments()
      // has none at all (it also backs the unauthenticated /report route), so
      // prefer this one even though s.id is already branch-scoped.
      safe(db.fetchStudentAssessmentsForCoach(s.id, academyId), []),
      safe(db.fetchStudentFeedback(s.id, 30), []),
      safe(db.fetchStudentSpotlights(s.id, 5), []),
      safe(db.fetchPlayerGoal(s.id, month), null),
      ...attMonths.map(a => safe(db.fetchAttendanceForStudents(a.year, a.m0, [s.id]), {})),
    ])
      .then(([hist, fb, spots, g, ...atts]) => {
        if (!alive) return
        // The fetch returns every sport this student was ever assessed in.
        // Mixing rubrics on one trend line (and in the "months on record"
        // count) would be misleading, so keep only their own sport.
        const want = (s.sport || '').toLowerCase()
        setHistory((hist || []).filter(a => !want || (a.sport || '').toLowerCase() === want))
        setPulse(fb || [])
        setSpotlights(spots || [])
        setGoal(g || null)
        setAttendance(atts.map((map, i) => {
          const days = Object.values(map?.[s.id] || map?.[String(s.id)] || {})
          const marked  = days.length
          const present = days.filter(d => d === 'Present' || d === 'Late').length
          const { year, m0 } = attMonths[i]
          return {
            key: `${year}-${String(m0 + 1).padStart(2, '0')}`,
            marked, present,
            pct: marked ? Math.round((present / marked) * 100) : null,
          }
        }))
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })

    return () => { alive = false }
  }, [s.id, month, academyId])

  const radarData = activeCat
    ? activeCat.skills.map(skill => ({
        subject:   SKILL_SHORTS[skill] || skill,
        value:     Number(assessment?.scores?.[skill] || 0),
        prevValue: prev ? Number(prev.scores?.[skill] || 0) : undefined,
        fullMark:  100,
      }))
    : cats.map(cat => ({
        subject:   cat.short,
        value:     getCategoryAvg(assessment?.scores, cat.skills),
        prevValue: prev ? getCategoryAvg(prev.scores, cat.skills) : undefined,
        fullMark:  100,
      }))

  const radarColor = activeCat ? activeCat.color : '#3b82f6'

  // Individual skills, best and worst. A literal 0 means "not rated" in this
  // rubric (getCategoryAvg filters them), so exclude them here too.
  const rated = useMemo(() => {
    if (!assessment?.scores) return []
    const known = new Set(cats.flatMap(c => c.skills))
    return Object.entries(assessment.scores)
      .filter(([k, v]) => known.has(k) && Number(v) > 0)
      .map(([k, v]) => ({ skill: k, value: Number(v) }))
      .sort((a, b) => b.value - a.value)
  }, [assessment, cats])

  const strengths = rated.slice(0, 3)
  const weakest   = rated.slice(-3).reverse()

  const pulseAvg = useMemo(() => {
    const avg = (field) => {
      const vals = pulse.map(r => r[field]).filter(v => v != null)
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : null
    }
    return { effort: avg('effort'), execution: avg('execution'), focus: avg('focus'), sessions: pulse.length }
  }, [pulse])

  const pulseChart = useMemo(() =>
    [...pulse].reverse().slice(-10).map(r => ({
      date: r.date?.slice(5) || '',
      effort: r.effort ?? null, execution: r.execution ?? null, focus: r.focus ?? null,
    })), [pulse])

  const scoreHistory = useMemo(() =>
    [...(history || [])]
      .sort((a, b) => String(a.assessed_month).localeCompare(String(b.assessed_month)))
      .map(a => ({
        month: monthLabel(a.assessed_month),
        score: getOverallScore(a.scores, SPORT_CATEGORIES[a.sport] || FOOTBALL_CATEGORIES),
      })), [history])

  const doExport = async () => {
    try {
      await exportPerformanceReport({
        student: s, assessment, prev, cats, score, delta,
        pulse: pulseAvg, attendance, goal, month, academyName,
        strengths, weakest,
      })
      showToast?.('Report opened')
    } catch (e) { showToast?.(e.message || 'Export failed', 'error') }
  }

  const posColor = s.position ? POSITION_COLORS[s.position] : null

  return (
    <div className="space-y-4">

      {/* Snapshot */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={44} />
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 truncate">{s.name}</h3>
              <p className="text-xs text-gray-400 truncate">
                {s.batch || 'No batch'}{s.studentCode ? ` · ${s.studentCode}` : ''}
                {s.age ? ` · ${s.age} yrs` : ''}
              </p>
            </div>
            {s.position && (
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded shrink-0 ${posColor ? `${posColor.bg} ${posColor.text}` : 'bg-gray-100 text-gray-600'}`}>
                {s.position}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPlanOpen(true)} className="btn-ghost">
              <Target size={14} className="text-gray-400" /> Development plan
            </button>
            <button onClick={doExport} className="btn-ghost" disabled={!assessment}>
              <FileDown size={14} className="text-gray-400" /> Export
            </button>
          </div>
        </div>

        {!assessment ? (
          <p className="text-sm text-gray-400 mt-4">
            No assessment recorded for {monthLabel(month)}. A coach can add one from Staff → Player Performance.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-gray-200">
            <Stat label="Overall" value={score} extra={
              <span className={`text-[11px] font-medium ${tier.textClass}`}>{tier.label}</span>
            } />
            <Stat label={`vs ${monthLabel(prevMonthKey(month))}`}
              value={delta == null ? '—' : (delta > 0 ? `+${delta}` : delta)}
              tone={delta == null ? 'muted' : delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'default'}
              extra={prevScore != null && <span className="text-[11px] text-gray-400">was {prevScore}</span>} />
            <Stat label="Assessments" value={history.length} extra={
              <span className="text-[11px] text-gray-400">months on record</span>
            } />
            <Stat label="Skills rated" value={`${rated.length}/${cats.flatMap(c => c.skills).length}`} />
          </div>
        )}
      </div>

      {/* Coach spotlights — surfaced right under the snapshot, not buried
          below the charts, since a coach's in-session note about a student
          is often the single most useful thing here at a glance. */}
      {spotlights.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-amber-900 mb-1 flex items-center gap-1.5">
            <Sparkles size={14} className="text-amber-500" /> Coach spotlights
          </h4>
          <p className="text-[11px] text-amber-700/70 mb-3">
            Recorded in session, scored /3 — a different instrument from the monthly assessment
          </p>
          <div className="space-y-3">
            {spotlights.map(sp => (
              <div key={sp.id} className="bg-white border border-amber-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium text-gray-500">
                    {sp.date ? new Date(sp.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                  </span>
                  <div className="flex gap-3">
                    {[['Technical', sp.technical], ['Tactical', sp.tactical], ['Physical', sp.physical], ['Mental', sp.mental]].map(([label, v]) => (
                      <span key={label} className="text-[10px] text-gray-500 flex items-center gap-1">
                        {label}
                        <span className="flex gap-0.5">
                          {[1, 2, 3].map(n => (
                            <span key={n} className={`w-1.5 h-1.5 rounded-full ${(v ?? 0) >= n ? 'bg-gray-700' : 'bg-gray-200'}`} />
                          ))}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                {sp.note && <p className="text-xs text-gray-700 font-medium">{sp.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {assessment && (
        <>
          {/* Radar + categories */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-gray-900">
                  {activeCat ? activeCat.label : 'Category profile'}
                </h4>
                {activeCat && (
                  <button onClick={() => setActiveCat(null)}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-900 flex items-center gap-1">
                    <X size={11} /> Back
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mb-2">
                {prev ? `Grey = ${monthLabel(prev.assessed_month)}` : 'No previous month to compare'}
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData} margin={{ top: 15, right: 28, bottom: 10, left: 28 }}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject"
                    tick={{ fontSize: 10, fontWeight: 600, fill: activeCat ? activeCat.color : '#6b7280' }} />
                  {prev && (
                    <Radar name="prev" dataKey="prevValue" stroke="#e5e7eb"
                      fill="#f9fafb" fillOpacity={0.7} strokeWidth={1.5} />
                  )}
                  <Radar name="current" dataKey="value" stroke={radarColor} fill={radarColor}
                    fillOpacity={0.18} strokeWidth={2.5}
                    dot={{ r: 4, fill: radarColor, strokeWidth: 2, stroke: '#fff' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-900 mb-3">Categories</h4>
              <div className="space-y-3">
                {cats.map(cat => {
                  const v  = getCategoryAvg(assessment.scores, cat.skills)
                  const pv = prev ? getCategoryAvg(prev.scores, cat.skills) : null
                  const d  = pv != null ? v - pv : null
                  return (
                    <button key={cat.id} onClick={() => setActiveCat(cat)}
                      className="w-full text-left group">
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-medium text-gray-700 group-hover:text-gray-900 flex items-center gap-1">
                          {cat.label} <ChevronRight size={11} className="text-gray-300" />
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 tabular-nums">{v}</span>
                          <Delta value={d} />
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${v}%`, background: cat.color }} />
                      </div>
                    </button>
                  )
                })}
              </div>

              {assessment.notes && (
                <div className="mt-4 pt-3 border-t border-gray-200">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Coach note</p>
                  <p className="text-xs text-gray-600">{assessment.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Strengths / weak spots */}
          <div className="grid md:grid-cols-2 gap-4">
            <SkillList title="Strengths" items={strengths} tone="positive" />
            <SkillList title="Weak spots" items={weakest} tone="negative"
              footer={
                <button onClick={() => setPlanOpen(true)}
                  className="text-[11px] font-medium text-gray-600 hover:text-gray-900">
                  Set these as this month's focus →
                </button>
              } />
          </div>
        </>
      )}

      {/* Pulse + attendance */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-1">
            <h4 className="text-sm font-semibold text-gray-900">Session pulse</h4>
            <span className="text-[11px] text-gray-400">scored /3 per session</span>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            Separate from the 0–100 assessment — this is how the coach rated them in training.
          </p>
          {loading ? <Skeleton className="h-24 w-full rounded-lg" />
            : pulseAvg.sessions === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No pulse recorded yet</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3">
                {[['Effort', pulseAvg.effort], ['Execution', pulseAvg.execution], ['Focus', pulseAvg.focus]].map(([label, v]) => (
                  <div key={label}>
                    <p className="text-[11px] text-gray-400">{label}</p>
                    <p className="text-lg font-semibold text-gray-900 tabular-nums">
                      {v == null ? '—' : v.toFixed(1)}
                      <span className="text-xs font-normal text-gray-400">/3</span>
                    </p>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={110}>
                <LineChart data={pulseChart} margin={{ top: 5, right: 5, bottom: 0, left: -28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <YAxis domain={[0, 3]} ticks={[0, 1, 2, 3]} tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="effort"    stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="execution" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="focus"     stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[11px] text-gray-400 mt-1">
                {pulseAvg.sessions} session{pulseAvg.sessions !== 1 ? 's' : ''} rated · last 10 shown
              </p>
            </>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-gray-900 mb-1">Attendance</h4>
          <p className="text-[11px] text-gray-400 mb-3">Present or late, out of sessions marked</p>
          {loading ? <Skeleton className="h-24 w-full rounded-lg" /> : (
            <div className="space-y-3">
              {attendance.map(a => (
                <div key={a.key}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-gray-600">{monthLabel(a.key)}</span>
                    <span className="text-gray-500">
                      {a.pct == null ? 'Not marked' : (
                        <>
                          <span className="font-semibold text-gray-900 tabular-nums">{a.pct}%</span>
                          <span className="text-gray-400"> · {a.present}/{a.marked}</span>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${
                      a.pct == null ? 'bg-gray-200' : a.pct >= 80 ? 'bg-emerald-600' : a.pct >= 60 ? 'bg-amber-500' : 'bg-red-500'
                    }`} style={{ width: `${a.pct ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {scoreHistory.length > 1 && (
            <div className="mt-4 pt-3 border-t border-gray-200">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-2">Score history</p>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={scoreHistory} margin={{ top: 5, right: 5, bottom: 0, left: -28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2}
                    dot={{ r: 3, fill: '#3b82f6' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Development plan */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Target size={14} className="text-gray-400" /> Development plan · {monthLabel(month)}
          </h4>
          <button onClick={() => setPlanOpen(true)} className="btn-ghost">
            {goal ? 'Edit' : 'Create'}
          </button>
        </div>
        {loading ? <Skeleton className="h-16 w-full rounded-lg" />
          : !goal ? (
          <p className="text-xs text-gray-400">
            No plan set for this month. Build one from the weak spots above — the coach and the
            student both see it.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1">Goal</p>
              <p className="text-sm text-gray-800">{goal.goal_text}</p>
            </div>
            {Array.isArray(goal.focus_skills) && goal.focus_skills.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">Focus skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {goal.focus_skills.map(sk => (
                    <span key={sk} className="text-[11px] font-medium text-gray-700 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                      {sk}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Coaches edit this same row from Staff → Player Performance, so
                show who touched it last rather than letting edits collide silently. */}
            <p className="text-[11px] text-gray-400 pt-1">
              Last set by {goal.updated_by_role === 'owner' ? 'the academy' : goal.updated_by_role === 'staff' ? 'a coach' : '—'}
              {goal.updated_at
                ? ` on ${new Date(goal.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                : ''}
              {' · '}the student was notified
            </p>
          </div>
        )}
      </div>

      {planOpen && (
        <PlanEditorModal
          student={s} month={month} cats={cats} goal={goal}
          suggested={weakest.map(w => w.skill)}
          staffId={staffId}
          academyId={academyId}
          onClose={() => setPlanOpen(false)}
          onSaved={(saved) => { setGoal(saved); setPlanOpen(false) }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ── Plan editor ─────────────────────────────────────────────────────────────

function PlanEditorModal({ student, month, cats, goal, suggested, staffId, academyId, onClose, onSaved, showToast }) {
  const [text,  setText]  = useState(goal?.goal_text || '')
  const [focus, setFocus] = useState(() =>
    Array.isArray(goal?.focus_skills) && goal.focus_skills.length
      ? goal.focus_skills
      : suggested.slice(0, 3)
  )
  const [saving, setSaving] = useState(false)

  const toggle = (skill) => setFocus(prev =>
    prev.includes(skill) ? prev.filter(s => s !== skill)
      : prev.length >= MAX_FOCUS ? prev : [...prev, skill]
  )

  const save = async () => {
    const goalText = text.trim()
    if (!goalText) { showToast?.('Add a goal for the month', 'error'); return }
    setSaving(true)
    try {
      // Order matters: the goal row must exist before focus skills can attach.
      const row = await db.upsertPlayerGoal({ studentId: student.id, month, goalText, staffId })
      const withFocus = await db.setPlayerFocus({ studentId: student.id, month, focusSkills: focus })
      onSaved(withFocus || { ...(row || {}), goal_text: goalText, focus_skills: focus })
      showToast?.('Development plan saved')

      // Tell the student, same as the coach's Goals tab does.
      notify({
        academyId,
        recipientType: 'student',
        recipientId:   String(student.id),
        title:         'New development plan',
        body:          `Your academy set this month's focus: ${goalText}`,
        type:          'performance',
        link:          '/student/progress',
      }).catch(() => {})
    } catch (e) {
      showToast?.(e.message || 'Could not save the plan', 'error')
    } finally { setSaving(false) }
  }

  return (
    <Modal
      title={`Development plan · ${student.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !text.trim()}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-xs text-gray-500">
          For {monthLabel(month)}. Visible to the coach in Player Performance and to the student in their portal.
        </p>

        <div>
          <label className="label">Goal for the month</label>
          <textarea
            className="input resize-none" rows={2} maxLength={140}
            placeholder="e.g. Win 5 aerial duels per session"
            value={text} onChange={e => setText(e.target.value)}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-gray-400">Keep it measurable</span>
            <span className="text-[11px] text-gray-400 tabular-nums">{text.length}/140</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {GOAL_PRESETS.map(p => (
              <button key={p} type="button" onClick={() => setText(p)}
                className="text-[11px] font-medium text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-2 py-1 rounded transition-colors">
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Focus skills</label>
            <span className="text-[11px] text-gray-400 tabular-nums">{focus.length}/{MAX_FOCUS}</span>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            Pre-selected from this month's lowest scores. Pick up to {MAX_FOCUS}.
          </p>
          <div className="space-y-3">
            {cats.map(cat => (
              <div key={cat.id}>
                <p className="text-[11px] font-medium uppercase tracking-wider mb-1.5" style={{ color: cat.color }}>
                  {cat.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cat.skills.map(skill => {
                    const on   = focus.includes(skill)
                    const full = !on && focus.length >= MAX_FOCUS
                    return (
                      <button key={skill} type="button" onClick={() => toggle(skill)} disabled={full}
                        className={`text-[11px] font-medium px-2 py-1 rounded border transition-colors ${
                          on ? 'bg-gray-900 text-white border-gray-900'
                             : full ? 'bg-white text-gray-300 border-gray-100 cursor-not-allowed'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}>
                        {skill}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ── Small shared bits ───────────────────────────────────────────────────────

function Kpi({ label, value, sub, icon: Icon, tone = 'default' }) {
  const valueColor = { default: 'text-gray-900', negative: 'text-red-600', muted: 'text-gray-300' }[tone]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider leading-tight">{label}</p>
        <Icon size={15} className="text-gray-300 shrink-0" />
      </div>
      <p className={`text-2xl font-semibold tracking-tight tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1.5 leading-tight">{sub}</p>
    </div>
  )
}

function Stat({ label, value, extra, tone = 'default' }) {
  const c = {
    default: 'text-gray-900', positive: 'text-emerald-700',
    negative: 'text-red-600', muted: 'text-gray-300',
  }[tone]
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold tracking-tight tabular-nums mt-1 ${c}`}>{value}</p>
      {extra && <div className="mt-0.5">{extra}</div>}
    </div>
  )
}

function Delta({ value }) {
  if (value == null) return <span className="w-10 shrink-0" />
  if (value === 0) return <span className="text-[11px] text-gray-300 w-10 shrink-0 text-right">—</span>
  const up = value > 0
  return (
    <span className={`text-[11px] font-medium w-10 shrink-0 text-right tabular-nums ${up ? 'text-emerald-700' : 'text-red-600'}`}>
      {up ? '+' : ''}{value}
    </span>
  )
}

function SkillList({ title, items, tone, footer }) {
  const bar = tone === 'positive' ? 'bg-emerald-600' : 'bg-red-500'
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing rated yet</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(it => (
            <div key={it.skill}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-gray-600 truncate">{it.skill}</span>
                <span className="font-semibold text-gray-900 tabular-nums ml-2">{it.value}</span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${it.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="mt-3 pt-3 border-t border-gray-200">{footer}</div>}
    </div>
  )
}
