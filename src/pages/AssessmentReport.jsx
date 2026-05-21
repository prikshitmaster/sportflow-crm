// AssessmentReport — printable A4 PDF view of a student's football assessment.
//
// Standalone page (no app chrome). One route per role:
//   /report/student/:studentId         — owner & coach navigate here
//   /student/assessment-report         — student auto-uses their own id
//
// Date-range picker lets you average across multiple monthly assessments.
// `@media print` hides the header bar → "Save as PDF" produces a clean A4.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useApp } from '../context/AppContext'
import { FOOTBALL_CATEGORIES } from '../lib/performance'
import { Download, ArrowLeft, Calendar, Printer, Loader2 } from 'lucide-react'

const pad2 = n => String(n).padStart(2, '0')
const monthStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`

// Convert a 0–100 score to a 1–5 cell rating
const cellRating = (score) => {
  if (score == null) return 0
  return Math.max(1, Math.min(5, Math.round(score / 20)))
}

// Average a list of numbers, ignoring null/undefined. Returns null if empty.
const avg = (xs) => {
  const nums = xs.filter(x => typeof x === 'number' && !Number.isNaN(x))
  if (!nums.length) return null
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

// Concat non-empty unique strings with separator (for category notes across months)
const concatUnique = (strs) => {
  const seen = new Set()
  const out  = []
  for (const s of strs) {
    const t = (s || '').trim()
    if (!t || seen.has(t)) continue
    seen.add(t); out.push(t)
  }
  return out.join('  •  ')
}

export default function AssessmentReport({ asStudent = false }) {
  const { studentId: paramStudentId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { studentUser } = useApp()

  const studentId = asStudent ? studentUser?.id : (paramStudentId ? Number(paramStudentId) : null)

  // Date range — default to last 3 months
  const today    = new Date()
  const defFrom  = monthStr(new Date(today.getFullYear(), today.getMonth() - 2, 1))
  const defTo    = monthStr(today)
  const [fromMonth, setFromMonth] = useState(searchParams.get('from') || defFrom)
  const [toMonth,   setToMonth]   = useState(searchParams.get('to')   || defTo)

  const [student,     setStudent]     = useState(null)
  const [academy,     setAcademy]     = useState(null)
  const [assessments, setAssessments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')

  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const [{ data: s }, { data: ass }] = await Promise.all([
          supabase.from('students').select('*').eq('id', studentId).maybeSingle(),
          supabase.from('skill_assessments').select('*')
            .eq('student_id', studentId)
            .order('assessed_month', { ascending: false }),
        ])
        if (cancelled) return
        if (!s) { setError('Student not found'); setLoading(false); return }
        setStudent(s)
        setAssessments(ass || [])
        // Get academy name + logo
        if (s.academy_id) {
          const { data: ac } = await supabase.from('academies')
            .select('id, name, logo_url').eq('id', s.academy_id).maybeSingle()
          if (!cancelled) setAcademy(ac)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [studentId])

  // Filter assessments to the chosen date range
  const inRange = useMemo(() => assessments.filter(a =>
    a.assessed_month >= fromMonth && a.assessed_month <= toMonth
  ), [assessments, fromMonth, toMonth])

  // Aggregate scores (avg per skill) + concat category notes
  const aggregated = useMemo(() => {
    const scores = {}
    const categoryNotes = {}
    for (const cat of FOOTBALL_CATEGORIES) {
      for (const skill of cat.skills) {
        scores[skill] = avg(inRange.map(a => a.scores?.[skill]))
      }
      categoryNotes[cat.id] = concatUnique(inRange.map(a => a.category_notes?.[cat.id]))
    }
    return { scores, categoryNotes }
  }, [inRange])

  const rangeLabel = useMemo(() => {
    const fmt = (m) => {
      const [y, mo] = m.split('-')
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    }
    return fromMonth === toMonth ? fmt(fromMonth) : `${fmt(fromMonth)} → ${fmt(toMonth)}`
  }, [fromMonth, toMonth])

  const handleRangeChange = (from, to) => {
    setFromMonth(from); setToMonth(to)
    setSearchParams({ from, to }, { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    )
  }
  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-red-600 font-semibold">{error}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-brand-600 hover:underline">Go back</button>
      </div>
    )
  }
  if (!student) return null

  const hasData = inRange.length > 0
  const dob     = student.dob ? new Date(student.dob).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
  const generated = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-200 print:bg-white">
      {/* Control bar — hidden when printing */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap shadow-sm">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 font-semibold">
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Calendar size={14} className="text-gray-400" />
          <input type="month" value={fromMonth} max={toMonth}
            onChange={e => handleRangeChange(e.target.value, toMonth)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <span className="text-xs text-gray-400">to</span>
          <input type="month" value={toMonth} min={fromMonth}
            onChange={e => handleRangeChange(fromMonth, e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" />
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-brand-600 text-white text-xs font-bold rounded-lg hover:bg-brand-700">
            <Printer size={13} /> Download PDF
          </button>
        </div>
      </div>

      {/* A4 page */}
      <div className="mx-auto bg-white shadow-md my-6 print:my-0 print:shadow-none report-page">
        {/* Header */}
        <div className="bg-blue-700 text-white px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-widest opacity-80">Player Assessment</p>
            <h1 className="text-lg font-black leading-tight">{academy?.name || 'Academy'}</h1>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest opacity-80">Period</p>
            <p className="text-sm font-bold">{rangeLabel}</p>
          </div>
        </div>

        {!hasData ? (
          <div className="p-12 text-center">
            <p className="text-sm text-gray-500 font-semibold">No assessments in this date range.</p>
            <p className="text-xs text-gray-400 mt-1">Coach hasn't filled an assessment for the selected months.</p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-0">
            {/* LEFT — Personal Details */}
            <div className="col-span-4 border-r border-gray-200">
              <div className="bg-blue-600 text-white px-3 py-2 text-[11px] font-black uppercase tracking-wider">
                Personal Details
              </div>
              <div className="p-4 space-y-3">
                {student.photo_url ? (
                  <img src={student.photo_url} alt={student.name}
                    className="w-full aspect-square object-cover rounded border border-gray-300" />
                ) : (
                  <div className="w-full aspect-square bg-gray-100 rounded border border-gray-200 flex items-center justify-center text-3xl font-black text-gray-300">
                    {student.name?.[0]}
                  </div>
                )}
                <div className="space-y-1 text-[11px]">
                  <Field label="Name"           value={student.name} />
                  <Field label="DOB"            value={dob} />
                  <Field label="Age"            value={student.age ? `${student.age} yrs` : '—'} />
                  <Field label="Club"           value={academy?.name || '—'} />
                  <Field label="Position"       value={student.position || '—'} />
                  <Field label="Batch"          value={student.batch || '—'} />
                  <Field label="Height"         value={student.height_cm ? `${student.height_cm} cm` : '—'} />
                  <Field label="Weight"         value={student.weight_kg ? `${student.weight_kg} kg` : '—'} />
                  <Field label="Preferred Foot" value={student.preferred_foot || '—'} />
                  <Field label="Wing"           value={student.wing || '—'} />
                </div>
              </div>
            </div>

            {/* RIGHT — 4 category sections */}
            <div className="col-span-8">
              {FOOTBALL_CATEGORIES.map(cat => (
                <CategorySection
                  key={cat.id}
                  cat={cat}
                  scores={aggregated.scores}
                  note={aggregated.categoryNotes[cat.id]}
                />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 flex items-center justify-between text-[10px] text-gray-500">
          <span>Generated {generated}</span>
          <span>Coach signature: ___________________________</span>
        </div>
      </div>

      {/* Print styles — A4 portrait, hide everything but the report */}
      <style>{`
        .report-page {
          width: 210mm;
          min-height: 297mm;
          box-sizing: border-box;
        }
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { background: white !important; }
          .no-print  { display: none !important; }
          .report-page {
            box-shadow: none !important;
            margin: 0 !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex justify-between gap-2 border-b border-gray-100 py-1">
      <span className="text-gray-500 font-semibold uppercase tracking-wide text-[9px]">{label}</span>
      <span className="text-gray-900 font-bold text-right">{value}</span>
    </div>
  )
}

function CategorySection({ cat, scores, note }) {
  return (
    <div className="border-b border-gray-200">
      <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-white"
        style={{ backgroundColor: cat.color }}>
        {cat.label}
      </div>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-500 font-bold uppercase">
            <th className="text-left px-3 py-1 w-2/5">Skill</th>
            <th className="text-center py-1" style={{ width: '8%' }}>1</th>
            <th className="text-center py-1" style={{ width: '8%' }}>2</th>
            <th className="text-center py-1" style={{ width: '8%' }}>3</th>
            <th className="text-center py-1" style={{ width: '8%' }}>4</th>
            <th className="text-center py-1" style={{ width: '8%' }}>5</th>
          </tr>
        </thead>
        <tbody>
          {cat.skills.map(skill => {
            const rating = cellRating(scores[skill])
            return (
              <tr key={skill} className="border-t border-gray-100">
                <td className="px-3 py-1.5 text-gray-800 font-semibold">{skill}</td>
                {[1, 2, 3, 4, 5].map(i => {
                  const filled = i <= rating
                  const isPeak = i === rating
                  return (
                    <td key={i} className="text-center py-1.5">
                      <div
                        className="mx-auto w-4 h-4 rounded-sm border border-gray-300"
                        style={{
                          backgroundColor: filled
                            ? (isPeak ? '#dc2626' : cat.color)
                            : '#ffffff',
                        }}
                      />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {note && (
        <div className="px-3 py-2 bg-gray-50 text-[10px] text-gray-700 leading-snug">
          <span className="font-bold text-gray-500">Comment:</span> {note}
        </div>
      )}
    </div>
  )
}
