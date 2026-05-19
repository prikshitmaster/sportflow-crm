// Staff Session Planner — coaches build and manage training sessions
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import {
  fetchSessionPlans, fetchSessionPlan, createSessionPlan, updateSessionPlan,
  deleteSessionPlan as dbDeleteSessionPlan, activateSessionPlan, completeSessionPlan,
  duplicateSessionPlan, createSessionPhase, updateSessionPhase, deleteSessionPhase,
  reorderSessionPhases, fetchDrills, fetchDrillFavorites, toggleDrillFavorite,
  createDrill, updateDrill, deleteDrill,
} from '../../lib/db'
import { exportSessionPDF } from '../../lib/sessionPDF'
import {
  Plus, ChevronLeft, Edit2, Trash2, Check, Copy,
  Clock, Users, BookOpen, ChevronDown, ChevronUp, X, Save,
  CalendarDays, Trophy, ArrowUp, ArrowDown, FileDown, AlertCircle,
  Zap, Package, MapPin, TrendingUp, TrendingDown, Target, ListOrdered,
  Heart, Search,
} from 'lucide-react'

// ── Pitch SVG presets (mirrors Drills.jsx) ───────────────────────────────────
const PITCH_BG = '#2D7A3A'
const W = { stroke: 'white', strokeWidth: '1.5', fill: 'none' }
function PitchSVG({ type }) {
  const base = { viewBox: '0 0 100 65', xmlns: 'http://www.w3.org/2000/svg', className: 'w-full h-full' }
  switch (type) {
    case 'full_pitch': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="3" y="3" width="94" height="59" {...W}/>
        <line x1="50" y1="3" x2="50" y2="62" {...W}/>
        <circle cx="50" cy="32.5" r="8" {...W}/>
        <rect x="3" y="17" width="16" height="31" {...W}/>
        <rect x="81" y="17" width="16" height="31" {...W}/>
        <rect x="3" y="26" width="4" height="13" fill="white" opacity="0.3"/>
        <rect x="93" y="26" width="4" height="13" fill="white" opacity="0.3"/>
      </svg>)
    case 'half_pitch': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="3" y="3" width="94" height="59" {...W}/>
        <line x1="3" y1="3" x2="97" y2="3" stroke="white" strokeWidth="2.5" fill="none"/>
        <rect x="18" y="45" width="64" height="17" {...W}/>
        <rect x="35" y="57" width="30" height="8" fill="white" opacity="0.3"/>
        <path d="M 35 3 A 15 15 0 0 0 65 3" {...W}/>
      </svg>)
    case 'channel': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="25" y="3" width="50" height="59" {...W}/>
        <line x1="25" y1="32.5" x2="75" y2="32.5" stroke="white" strokeWidth="1" strokeDasharray="3 2" fill="none"/>
        <rect x="40" y="3" width="20" height="5" fill="white" opacity="0.4"/>
        <rect x="40" y="57" width="20" height="5" fill="white" opacity="0.4"/>
      </svg>)
    case 'penalty_box': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="10" y="8" width="80" height="47" {...W}/>
        <rect x="30" y="46" width="40" height="9" {...W}/>
        <circle cx="50" cy="34" r="2" fill="white"/>
        <rect x="35" y="55" width="30" height="9" fill="white" opacity="0.35" stroke="white" strokeWidth="1.5"/>
        <path d="M 30 8 A 20 20 0 0 0 70 8" {...W}/>
      </svg>)
    case 'thirds': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="3" y="3" width="94" height="59" {...W}/>
        <line x1="3" y1="23" x2="97" y2="23" stroke="white" strokeWidth="1" strokeDasharray="4 2" fill="none"/>
        <line x1="3" y1="42" x2="97" y2="42" stroke="white" strokeWidth="1" strokeDasharray="4 2" fill="none"/>
        <text x="50" y="15" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Defensive</text>
        <text x="50" y="34" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Middle</text>
        <text x="50" y="53" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Attacking</text>
      </svg>)
    case 'small_grid': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="10" y="5" width="80" height="55" {...W}/>
        <line x1="10" y1="23.3" x2="90" y2="23.3" stroke="white" strokeWidth="0.8" opacity="0.6"/>
        <line x1="10" y1="41.7" x2="90" y2="41.7" stroke="white" strokeWidth="0.8" opacity="0.6"/>
        <line x1="36.7" y1="5" x2="36.7" y2="60" stroke="white" strokeWidth="0.8" opacity="0.6"/>
        <line x1="63.3" y1="5" x2="63.3" y2="60" stroke="white" strokeWidth="0.8" opacity="0.6"/>
        <circle cx="10" cy="5" r="2.5" fill="#FFD700"/>
        <circle cx="90" cy="5" r="2.5" fill="#FFD700"/>
        <circle cx="10" cy="60" r="2.5" fill="#FFD700"/>
        <circle cx="90" cy="60" r="2.5" fill="#FFD700"/>
      </svg>)
    default: return null
  }
}
function DrillDiagram({ url, preset }) {
  if (url) return <img src={url} alt="Drill diagram" className="w-full object-contain bg-gray-100" />
  if (preset) return <div className="w-full aspect-video"><PitchSVG type={preset} /></div>
  return null
}

// ── Session phase categories ──────────────────────────────────────────────────
const PHASE_CATEGORIES = [
  { key: 'warm_up',    label: 'Warm Up',      color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'technical',  label: 'Technical',    color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { key: 'passing',    label: 'Passing',      color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'shooting',   label: 'Shooting',     color: 'bg-red-100 text-red-700 border-red-200' },
  { key: 'defending',  label: 'Defending',    color: 'bg-purple-100 text-purple-700 border-purple-200' },
  { key: 'ssg',        label: 'Small-Sided',  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'cool_down',  label: 'Cool Down',    color: 'bg-gray-100 text-gray-600 border-gray-200' },
]

// ── Drill library constants ───────────────────────────────────────────────────
const CATEGORIES = {
  warm_up:   { label: 'Warm-up',   bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-400' },
  technical: { label: 'Technical', bg: 'bg-blue-100',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400'   },
  passing:   { label: 'Passing',   bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-400' },
  shooting:  { label: 'Shooting',  bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-400'    },
  defending: { label: 'Defending', bg: 'bg-slate-100',  text: 'text-slate-700',  border: 'border-slate-200',  dot: 'bg-slate-400'  },
  ssg:       { label: 'SSG',       bg: 'bg-green-100',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-400'  },
  match:     { label: 'Match',     bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-400' },
  cool_down: { label: 'Cool-down', bg: 'bg-teal-100',   text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-400'   },
}
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced']
const AGE_GROUPS   = ['All', 'U6', 'U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Senior']
const DIFF_COLORS  = {
  beginner:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-amber-50   text-amber-700   border-amber-200',
  advanced:     'bg-red-50     text-red-700     border-red-200',
}
const PITCH_PRESETS = [
  { key: 'full_pitch',  label: 'Full Pitch' },
  { key: 'half_pitch',  label: 'Half Pitch' },
  { key: 'channel',     label: 'Channel' },
  { key: 'penalty_box', label: 'Penalty Box' },
  { key: 'thirds',      label: '3 Thirds' },
  { key: 'small_grid',  label: 'Small Grid' },
]
const EMPTY_DRILL_FORM = {
  name: '', category: 'warm_up', age_group: 'All', duration: 15,
  min_players: 6, max_players: 16, difficulty: 'beginner',
  equipment: [], area: '', context_ct: '', context_mt: '',
  procedure: [''], coaching_points: [''],
  progressions: [], regressions: [], objectives: [],
  diagram_preset: '', diagram_url: '',
}

function catStyle(key) {
  return PHASE_CATEGORIES.find(c => c.key === key)?.color || 'bg-gray-100 text-gray-600 border-gray-200'
}
function catLabel(key) {
  return PHASE_CATEGORIES.find(c => c.key === key)?.label || key
}

function fmt(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
}

// ── Drill library shared components ──────────────────────────────────────────
function CategoryBadge({ category }) {
  const c = CATEGORIES[category] || CATEGORIES.technical
  return (
    <span className={`inline-flex items-center gap-1 font-black rounded-full border ${c.bg} ${c.text} ${c.border} text-[10px] px-2 py-0.5`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  )
}

function ArrayEditor({ label, value = [], onChange, placeholder, highlight }) {
  const add    = () => onChange([...value, ''])
  const update = (i, v) => onChange(value.map((x, j) => j === i ? v : x))
  const remove = (i)    => onChange(value.filter((_, j) => j !== i))
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={`text-xs font-semibold ${highlight || 'text-gray-700'}`}>{label}</label>
        <button type="button" onClick={add}
          className="text-xs text-brand-600 font-semibold flex items-center gap-0.5">
          <Plus size={11} /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {value.map((v, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="text-gray-300 text-xs flex-shrink-0">•</span>
            <input value={v} onChange={e => update(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
            <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 flex-shrink-0">
              <X size={13} />
            </button>
          </div>
        ))}
        {value.length === 0 && <p className="text-xs text-gray-400 italic pl-4">None yet — tap Add</p>}
      </div>
    </div>
  )
}

// ── Staff Drill Card (mobile row) ─────────────────────────────────────────────
function StaffDrillCard({ drill, isFav, onFavorite, onClick, onClone, onEdit, onDelete, isOwn }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-sm transition">
      {/* Main row — tap to view detail */}
      <div onClick={onClick} className="p-4 flex items-start gap-3 cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <CategoryBadge category={drill.category} />
            {!drill.is_global && (
              <span className="text-[10px] font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">Mine</span>
            )}
            {(drill.diagram_url || drill.diagram_preset) && (
              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">Diagram</span>
            )}
          </div>
          <p className="font-semibold text-sm text-gray-900 leading-snug line-clamp-2">{drill.name}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
            {drill.duration    && <span className="flex items-center gap-1"><Clock size={10}/>{drill.duration}m</span>}
            {drill.min_players && <span className="flex items-center gap-1"><Users size={10}/>{drill.min_players}–{drill.max_players}</span>}
            {drill.difficulty  && <span className="capitalize">{drill.difficulty}</span>}
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); onFavorite() }}
          className={`p-1.5 rounded-lg flex-shrink-0 transition ${isFav ? 'text-red-500' : 'text-gray-200 hover:text-gray-400'}`}>
          <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Action bar */}
      <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-1">
        <button onClick={onClone}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 transition">
          <Copy size={12}/> Clone
        </button>
        {isOwn && (
          <>
            <button onClick={onEdit}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-brand-600 hover:bg-brand-50 transition">
              <Edit2 size={12}/> Edit
            </button>
            <button onClick={onDelete}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-50 transition ml-auto">
              <Trash2 size={12}/> Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Staff Drill Detail Modal ──────────────────────────────────────────────────
function StaffDrillDetailModal({ drill, isFav, isOwn, onClose, onFavorite, onEdit, onClone, onDelete }) {
  if (!drill) return null
  const c = CATEGORIES[drill.category] || CATEGORIES.technical
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className={`px-5 py-4 ${c.bg} border-b ${c.border} flex-shrink-0`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CategoryBadge category={drill.category} />
              <h2 className={`text-lg font-black ${c.text} mt-1.5 leading-tight`}>{drill.name}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {drill.duration    && <span className="flex items-center gap-1 text-xs text-gray-600 bg-white/70 px-2 py-0.5 rounded-full"><Clock size={11}/>{drill.duration} min</span>}
                {drill.min_players && <span className="flex items-center gap-1 text-xs text-gray-600 bg-white/70 px-2 py-0.5 rounded-full"><Users size={11}/>{drill.min_players}–{drill.max_players} players</span>}
                {drill.difficulty  && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${DIFF_COLORS[drill.difficulty] || ''}`}>{drill.difficulty}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button onClick={onFavorite} className={`p-2 rounded-xl transition ${isFav ? 'text-red-500 bg-white/70' : 'text-gray-400 hover:text-red-400 bg-white/50'}`}>
                <Heart size={18} fill={isFav ? 'currentColor' : 'none'} />
              </button>
              <button onClick={onClose} className="p-2 rounded-xl text-gray-500 hover:bg-white/50 transition">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {(drill.diagram_url || drill.diagram_preset) && (
            <div className="rounded-xl overflow-hidden aspect-video max-w-sm mx-auto shadow-sm border border-gray-100">
              <DrillDiagram url={drill.diagram_url} preset={drill.diagram_preset} />
            </div>
          )}
          {drill.equipment?.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Equipment</p>
              <div className="flex flex-wrap gap-1.5">
                {drill.equipment.map((e, i) => <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">{e}</span>)}
              </div>
            </div>
          )}
          {(drill.area || drill.context_ct || drill.context_mt) && (
            <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5">
              {drill.area       && <div className="flex gap-3"><span className="text-xs font-bold text-gray-500 w-14 flex-shrink-0">AREA</span><span className="text-xs text-gray-700">{drill.area}</span></div>}
              {drill.context_ct && <div className="flex gap-3"><span className="text-xs font-bold text-blue-600 w-14 flex-shrink-0">CT —</span><span className="text-xs text-gray-700">{drill.context_ct}</span></div>}
              {drill.context_mt && <div className="flex gap-3"><span className="text-xs font-bold text-red-600 w-14 flex-shrink-0">MT —</span><span className="text-xs text-gray-700">{drill.context_mt}</span></div>}
            </div>
          )}
          {drill.procedure?.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">How to run it</p>
              <ol className="space-y-1.5">
                {drill.procedure.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-[10px]">{i+1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {drill.coaching_points?.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Coaching Points</p>
              <ul className="space-y-1">
                {drill.coaching_points.map((cp, i) => (
                  <li key={i} className="text-sm text-gray-700 flex gap-2"><span className="text-brand-500">•</span>{cp}</li>
                ))}
              </ul>
            </div>
          )}
          {(drill.progressions?.length > 0 || drill.regressions?.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {drill.progressions?.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1.5">↑ Progressions</p>
                  {drill.progressions.map((p, i) => <p key={i} className="text-xs text-gray-600 flex gap-1"><span className="text-emerald-400">+</span>{p}</p>)}
                </div>
              )}
              {drill.regressions?.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1.5">↓ Regressions</p>
                  {drill.regressions.map((r, i) => <p key={i} className="text-xs text-gray-600 flex gap-1"><span className="text-amber-400">−</span>{r}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex items-center gap-3 flex-wrap">
          <button onClick={onClone}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition">
            <Copy size={13}/> Clone as my drill
          </button>
          {isOwn && (
            <>
              <button onClick={onEdit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 transition">
                <Edit2 size={13}/> Edit
              </button>
              <button onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 transition ml-auto">
                <Trash2 size={13}/> Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Staff Drill Editor Modal ──────────────────────────────────────────────────
function StaffDrillEditorModal({ drill, onClose, onSave, saving }) {
  const isEdit = !!drill?.id
  const [form, setForm] = useState(() => drill ? { ...EMPTY_DRILL_FORM, ...drill } : { ...EMPTY_DRILL_FORM })
  const [errors, setErrors] = useState({})
  const [eqInput, setEqInput] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addEquipment = () => {
    const v = eqInput.trim()
    if (v && !form.equipment.includes(v)) set('equipment', [...form.equipment, v])
    setEqInput('')
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Drill name is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return
    onSave({
      ...form,
      procedure:       (form.procedure       || []).filter(x => x.trim()),
      coaching_points: (form.coaching_points || []).filter(x => x.trim()),
      progressions:    (form.progressions    || []).filter(x => x.trim()),
      regressions:     (form.regressions     || []).filter(x => x.trim()),
      objectives:      (form.objectives      || []).filter(x => x.trim()),
      equipment:       (form.equipment       || []).filter(x => x.trim()),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-2xl shadow-2xl flex flex-col max-h-[95vh]">

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-black text-gray-900">{isEdit ? 'Edit Drill' : 'New Custom Drill'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500"/>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Drill Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Rondo 4v1"
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 ${errors.name ? 'border-red-400' : 'border-gray-200'}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">Category *</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button key={key} type="button" onClick={() => set('category', key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
                    form.category === key ? `${cat.bg} ${cat.text} ${cat.border}` : 'bg-white text-gray-500 border-gray-200'
                  }`}>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Age / Duration / Players */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Age Group</label>
              <select value={form.age_group} onChange={e => set('age_group', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 bg-white">
                {AGE_GROUPS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Duration (min)</label>
              <input type="number" value={form.duration} min="1" max="120"
                onChange={e => set('duration', Number(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Min Players</label>
              <input type="number" value={form.min_players} min="2"
                onChange={e => set('min_players', Number(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Max Players</label>
              <input type="number" value={form.max_players} min="2"
                onChange={e => set('max_players', Number(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">Difficulty</label>
            <div className="flex gap-2">
              {DIFFICULTIES.map(d => (
                <button key={d} type="button" onClick={() => set('difficulty', d)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border capitalize transition ${
                    form.difficulty === d ? DIFF_COLORS[d] : 'bg-white text-gray-500 border-gray-200'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-1">Equipment</label>
            <div className="flex gap-2 mb-2">
              <input value={eqInput} onChange={e => setEqInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEquipment())}
                placeholder="Balls, Cones, Bibs… (press Enter)"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
              <button type="button" onClick={addEquipment}
                className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 transition">
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(form.equipment || []).map((e, i) => (
                <span key={i} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                  {e}
                  <button type="button" onClick={() => set('equipment', form.equipment.filter((_, j) => j !== i))}>
                    <X size={10}/>
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Area + Context */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-700 block mb-1">Area</label>
              <input value={form.area} onChange={e => set('area', e.target.value)}
                placeholder="½ pitch, box, grid…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-blue-600 block mb-1">CT — Coaching Team</label>
                <input value={form.context_ct} onChange={e => set('context_ct', e.target.value)}
                  placeholder="Blue team role…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
              <div>
                <label className="text-xs font-semibold text-red-600 block mb-1">MT — Main Team</label>
                <input value={form.context_mt} onChange={e => set('context_mt', e.target.value)}
                  placeholder="Red team role…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
            </div>
          </div>

          {/* Pitch Diagram */}
          <div>
            <label className="text-xs font-semibold text-gray-700 block mb-2">Pitch Diagram</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {PITCH_PRESETS.map(p => (
                <button key={p.key} type="button"
                  onClick={() => { set('diagram_preset', form.diagram_preset === p.key ? '' : p.key); set('diagram_url', '') }}
                  className={`rounded-xl overflow-hidden border-2 transition ${
                    form.diagram_preset === p.key ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200'
                  }`}>
                  <div className="aspect-video"><PitchSVG type={p.key} /></div>
                  <p className="text-[10px] font-semibold text-gray-600 text-center py-1 bg-white">{p.label}</p>
                </button>
              ))}
            </div>
            {(form.diagram_url || form.diagram_preset) && (
              <button type="button" onClick={() => { set('diagram_url', ''); set('diagram_preset', '') }}
                className="text-xs text-red-500 hover:underline">
                Remove diagram
              </button>
            )}
          </div>

          <ArrayEditor label="Procedure (step by step)" value={form.procedure || []}
            onChange={v => set('procedure', v)} placeholder="Describe a step…" />

          <ArrayEditor label="Coaching Points" value={form.coaching_points || []}
            onChange={v => set('coaching_points', v)} placeholder="Key point…" />

          <ArrayEditor label="↑ Progressions (make harder)" value={form.progressions || []}
            onChange={v => set('progressions', v)} placeholder="e.g. Add defender" highlight="text-emerald-600" />

          <ArrayEditor label="↓ Regressions (make easier)" value={form.regressions || []}
            onChange={v => set('regressions', v)} placeholder="e.g. More space" highlight="text-amber-600" />
        </div>

        <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"/>}
            {isEdit ? 'Save Changes' : 'Add Drill'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Staff Drill Library (full drill management for coaches) ───────────────────
function StaffDrillLibrary({ academyId, coachId, sportName }) {
  const [drills,     setDrills]     = useState([])
  const [favorites,  setFavorites]  = useState(new Set())
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [search,     setSearch]     = useState('')
  const [catFilter,  setCatFilter]  = useState('all')
  const [showFavs,   setShowFavs]   = useState(false)
  const [selected,   setSelected]   = useState(null)
  const [editing,    setEditing]    = useState(null)
  const [showEditor, setShowEditor] = useState(false)
  const [toast,      setToast]      = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const drillData = await fetchDrills(academyId, sportName)
      setDrills(drillData)
    } catch (e) {
      console.error('fetchDrills error:', e)
    }
    try {
      const favData = await fetchDrillFavorites(coachId)
      setFavorites(new Set(favData))
    } catch (e) {
      console.error('fetchDrillFavorites error:', e)
    }
    setLoading(false)
  }, [academyId, coachId, sportName])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let d = drills
    if (showFavs)            d = d.filter(x => favorites.has(x.id))
    if (catFilter !== 'all') d = d.filter(x => x.category === catFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(x =>
        x.name?.toLowerCase().includes(q) ||
        x.equipment?.some(e => e.toLowerCase().includes(q)) ||
        x.area?.toLowerCase().includes(q)
      )
    }
    return d
  }, [drills, favorites, catFilter, search, showFavs])

  const handleFavorite = async (drill) => {
    const updated = new Set(favorites)
    if (updated.has(drill.id)) updated.delete(drill.id)
    else updated.add(drill.id)
    setFavorites(updated)
    try { await toggleDrillFavorite(drill.id, coachId, academyId) }
    catch { await load() }
  }

  const handleSave = async (form) => {
    setSaving(true)
    try {
      if (form.id) {
        await updateDrill(form.id, form)
        showToast('Drill updated')
      } else {
        await createDrill({ ...form, academy_id: academyId, created_by: coachId, is_global: false, sport_name: sportName })
        showToast('Drill added to library')
      }
      setShowEditor(false)
      setEditing(null)
      await load()
    } catch (e) {
      showToast(e.message || 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (drill) => {
    if (!confirm(`Delete "${drill.name}"?`)) return
    try {
      await deleteDrill(drill.id)
      setSelected(null)
      showToast('Drill deleted')
      await load()
    } catch (e) {
      showToast(e.message || 'Failed to delete', 'error')
    }
  }

  const handleClone = (drill) => {
    const { id, is_global, academy_id, created_by, created_at, ...rest } = drill
    setEditing({ ...rest, name: `${drill.name} (copy)` })
    setSelected(null)
    setShowEditor(true)
  }

  return (
    <div className="px-4 pb-6 space-y-4">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white ${toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Search + Add */}
      <div className="flex gap-2 pt-1">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search drills…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
        </div>
        <button onClick={() => { setEditing(null); setShowEditor(true) }}
          className="flex items-center gap-1 px-3 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold flex-shrink-0">
          <Plus size={14}/> Add
        </button>
      </div>

      {/* Stats row */}
      <p className="text-xs text-gray-400">
        {drills.length} drills · {drills.filter(d => !d.is_global).length} custom · {favorites.size} favorites
      </p>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar -mx-4 px-4">
        <button onClick={() => { setCatFilter('all'); setShowFavs(false) }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex-shrink-0 border transition ${catFilter === 'all' && !showFavs ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600'}`}>
          All
        </button>
        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <button key={key} onClick={() => { setCatFilter(key); setShowFavs(false) }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex-shrink-0 border transition ${catFilter === key && !showFavs ? `${cat.bg} ${cat.text} ${cat.border}` : 'bg-white border-gray-200 text-gray-600'}`}>
            {cat.label}
          </button>
        ))}
        <button onClick={() => { setShowFavs(f => !f); setCatFilter('all') }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex-shrink-0 flex items-center gap-1.5 border transition ${showFavs ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white border-gray-200 text-gray-600'}`}>
          <Heart size={11} fill={showFavs ? 'currentColor' : 'none'}/> Favs ({favorites.size})
        </button>
      </div>

      {/* Drill list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse"/>)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen size={32} className="mx-auto text-gray-200 mb-3"/>
          <p className="text-sm font-semibold text-gray-500">
            {search ? `No drills match "${search}"` : showFavs ? 'No favorites yet — heart a drill' : 'No drills in this category'}
          </p>
          {!search && !showFavs && (
            <button onClick={() => { setEditing(null); setShowEditor(true) }}
              className="mt-3 text-sm text-brand-600 font-semibold">
              Add your first drill →
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(drill => (
            <StaffDrillCard key={drill.id} drill={drill}
              isFav={favorites.has(drill.id)}
              isOwn={!drill.is_global && drill.academy_id === academyId}
              onFavorite={() => handleFavorite(drill)}
              onClick={() => setSelected(drill)}
              onClone={() => handleClone(drill)}
              onEdit={() => { setEditing(drill); setShowEditor(true) }}
              onDelete={() => handleDelete(drill)}
            />
          ))}
        </div>
      )}

      {selected && (
        <StaffDrillDetailModal
          drill={selected}
          isFav={favorites.has(selected.id)}
          isOwn={!selected.is_global && selected.academy_id === academyId}
          onClose={() => setSelected(null)}
          onFavorite={() => handleFavorite(selected)}
          onEdit={() => { setEditing(selected); setSelected(null); setShowEditor(true) }}
          onClone={() => handleClone(selected)}
          onDelete={() => handleDelete(selected)}
        />
      )}

      {showEditor && (
        <StaffDrillEditorModal
          drill={editing}
          onClose={() => { setShowEditor(false); setEditing(null) }}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  )
}

// ── Drill Picker Modal ────────────────────────────────────────────────────────
function DrillPicker({ category, academyId, sportName, onSelect, onClose }) {
  const [drills, setDrills] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => {
    fetchDrills(academyId, sportName).then(setDrills).catch(() => {})
  }, [academyId, sportName])

  const filtered = drills.filter(d => {
    const matchCat = !category || d.category === category
    const matchQ   = !q || d.name.toLowerCase().includes(q.toLowerCase())
    return matchCat && matchQ
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end">
      <div className="bg-white rounded-t-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Pick a Drill</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-4 py-2 border-b border-gray-100">
          <input
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400"
            placeholder="Search drills…"
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
          {filtered.map(d => (
            <button key={d.id} onClick={() => onSelect(d)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex items-start gap-3">
              <span className={`mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${catStyle(d.category)}`}>
                {catLabel(d.category)}
              </span>
              <div>
                <p className="font-semibold text-sm text-gray-900">{d.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{d.duration}m · {d.age_group} · {d.difficulty}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No drills found</p>
          )}
        </div>
        <div className="px-4 pb-5 pt-2 border-t border-gray-100">
          <button onClick={() => onSelect(null)}
            className="w-full py-2.5 text-sm text-gray-500 border border-dashed border-gray-300 rounded-xl hover:bg-gray-50">
            + Add phase without drill
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phase Card ────────────────────────────────────────────────────────────────
function PhaseCard({ phase, index, total, onChange, onDelete, onMoveUp, onMoveDown }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dur, setDur] = useState(phase.duration || 15)
  const [notes, setNotes] = useState(phase.coaching_points?.join('\n') || '')

  const save = async () => {
    await onChange(phase.id, {
      duration: dur,
      coaching_points: notes ? notes.split('\n').filter(Boolean) : [],
    })
    setEditing(false)
  }

  const drill = phase.drills

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="text-xs font-bold text-gray-400 w-5 text-center">{index + 1}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${catStyle(phase.phase_name)}`}>
          {catLabel(phase.phase_name)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-900 truncate">
            {drill?.name || phase.area || 'Custom phase'}
          </p>
          <p className="text-xs text-gray-400">{phase.duration}m{drill?.area ? ` · ${drill.area}` : ''}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp}   disabled={index === 0}         className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp size={13} /></button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown size={13} /></button>
          <button onClick={() => { setEditing(e => !e); setExpanded(true) }} className="p-1 text-gray-400 hover:text-brand-600"><Edit2 size={13} /></button>
          <button onClick={onDelete} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>
          <button onClick={() => setExpanded(e => !e)} className="p-1 text-gray-400">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100">
          {editing ? (
            <div className="px-4 pb-3 pt-2 space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-500 w-16">Duration</label>
                <input type="number" value={dur} min={1} max={90}
                  onChange={e => setDur(Number(e.target.value))}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-400"
                />
                <span className="text-xs text-gray-400">min</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Coaching notes (one per line)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder="Key coaching points for this phase…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={save} className="flex-1 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1">
                  <Save size={13} /> Save
                </button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-0">
              {/* ── Pitch diagram ── */}
              {(drill?.diagram_url || drill?.diagram_preset) && (
                <div className="w-full">
                  <DrillDiagram url={drill.diagram_url} preset={drill.diagram_preset} />
                </div>
              )}

              <div className="px-4 pt-3 pb-4 space-y-3">
                {/* Context strips */}
                {(drill?.context_ct || drill?.context_mt) && (
                  <div className="grid grid-cols-2 gap-2">
                    {drill.context_ct && (
                      <div className="bg-blue-50 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-blue-400 uppercase mb-0.5">Your Team (CT)</p>
                        <p className="text-xs text-blue-700">{drill.context_ct}</p>
                      </div>
                    )}
                    {drill.context_mt && (
                      <div className="bg-red-50 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-red-400 uppercase mb-0.5">Opposition (MT)</p>
                        <p className="text-xs text-red-700">{drill.context_mt}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Equipment */}
                {drill?.equipment?.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Package size={13} className="text-gray-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-600">{drill.equipment.join(' · ')}</p>
                  </div>
                )}

                {/* Area */}
                {drill?.area && (
                  <div className="flex items-start gap-2">
                    <MapPin size={13} className="text-gray-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-600">{drill.area}</p>
                  </div>
                )}

                {/* Step-by-step procedure */}
                {drill?.procedure?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <ListOrdered size={11} /> How to run it
                    </p>
                    <ol className="space-y-1.5">
                      {drill.procedure.map((step, i) => (
                        <li key={i} className="flex gap-2 text-xs text-gray-700">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Drill coaching points */}
                {drill?.coaching_points?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                      <Target size={11} /> Coaching points
                    </p>
                    <ul className="space-y-1">
                      {drill.coaching_points.map((cp, i) => (
                        <li key={i} className="text-xs text-gray-600 flex gap-2">
                          <span className="text-brand-500 shrink-0">•</span>{cp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Phase-level coach notes */}
                {phase.coaching_points?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">My notes</p>
                    <ul className="space-y-1">
                      {phase.coaching_points.map((cp, i) => (
                        <li key={i} className="text-xs text-gray-600 flex gap-2">
                          <span className="text-amber-500 shrink-0">•</span>{cp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Progressions / Regressions */}
                {(drill?.progressions?.length > 0 || drill?.regressions?.length > 0) && (
                  <div className="grid grid-cols-2 gap-2">
                    {drill.progressions?.length > 0 && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><TrendingUp size={10} /> Harder</p>
                        {drill.progressions.map((p, i) => (
                          <p key={i} className="text-[11px] text-gray-600">• {p}</p>
                        ))}
                      </div>
                    )}
                    {drill.regressions?.length > 0 && (
                      <div className="bg-gray-50 rounded-xl px-3 py-2">
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><TrendingDown size={10} /> Easier</p>
                        {drill.regressions.map((r, i) => (
                          <p key={i} className="text-[11px] text-gray-600">• {r}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Session Editor ────────────────────────────────────────────────────────────
function SessionEditor({ plan: initPlan, batches, academyId, sportName, onBack, onSaved }) {
  const [plan, setPlan] = useState(initPlan)
  const [phases, setPhases] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [picker, setPicker] = useState(null)
  const [activating, setActivating] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [duplicateModal, setDuplicateModal] = useState(false)
  const [dupDate, setDupDate] = useState('')
  const [dupBatch, setDupBatch] = useState(plan.batch_id || '')

  const totalDur = phases.reduce((s, p) => s + (p.duration || 0), 0)

  useEffect(() => {
    if (initPlan.id) {
      fetchSessionPlan(initPlan.id)
        .then(full => { setPlan(full); setPhases(full.session_phases || []) })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [initPlan.id])

  const addPhase = async (category, drill) => {
    const position = phases.length
    const newPhase = await createSessionPhase({
      session_id: plan.id,
      phase_name: category,
      drill_id: drill?.id || null,
      duration: drill?.duration || 15,
      area: drill?.area || null,
      context_ct: drill?.context_ct || null,
      context_mt: drill?.context_mt || null,
      coaching_points: drill?.coaching_points || [],
      position,
    })
    setPhases(prev => [...prev, newPhase])
    setPicker(null)
  }

  const changePhase = async (id, updates) => {
    const updated = await updateSessionPhase(id, updates)
    setPhases(prev => prev.map(p => p.id === id ? updated : p))
  }

  const removePhase = async (id) => {
    await deleteSessionPhase(id)
    setPhases(prev => {
      const next = prev.filter(p => p.id !== id)
      reorderSessionPhases(next.map((p, i) => ({ id: p.id, position: i })))
      return next.map((p, i) => ({ ...p, position: i }))
    })
  }

  const movePhase = async (index, dir) => {
    const next = [...phases]
    const swap = index + dir
    ;[next[index], next[swap]] = [next[swap], next[index]]
    setPhases(next)
    await reorderSessionPhases(next.map((p, i) => ({ id: p.id, position: i })))
  }

  const saveHeader = async (field, value) => {
    const updated = await updateSessionPlan(plan.id, { [field]: value })
    setPlan(prev => ({ ...prev, ...updated }))
  }

  const handleActivate = async () => {
    setActivating(true)
    try {
      await activateSessionPlan(plan.id)
      setPlan(prev => ({ ...prev, status: 'active' }))
    } finally {
      setActivating(false)
    }
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      await completeSessionPlan(plan.id)
      onSaved()
    } finally {
      setCompleting(false)
    }
  }

  const handleDuplicate = async () => {
    if (!dupDate) return
    setSaving(true)
    try {
      await duplicateSessionPlan(plan.id, dupDate, dupBatch)
      setDuplicateModal(false)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-sm text-gray-400">Loading session…</div>

  const batch = batches.find(b => b.id === plan.batch_id)

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-gray-700">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{batch?.name || 'Session'}</p>
          <p className="text-xs text-gray-400">{fmt(plan.date)} · {totalDur}m total</p>
        </div>
        <button
          onClick={() => exportSessionPDF({ plan, phases, batchName: batch?.name || '—' })}
          className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition"
          title="Export PDF">
          <FileDown size={17} />
        </button>
        {plan.status === 'draft' && (
          <button onClick={handleActivate} disabled={activating}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
            <Zap size={13} /> {activating ? 'Starting…' : 'Go Active'}
          </button>
        )}
        {plan.status === 'active' && (
          <button onClick={handleComplete} disabled={completing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
            <Check size={13} /> {completing ? 'Saving…' : 'Complete'}
          </button>
        )}
        {plan.status === 'completed' && (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
            <Trophy size={12} /> Done
          </span>
        )}
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Session meta */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Topic</label>
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Session topic / theme…"
              defaultValue={plan.topic || ''}
              onBlur={e => saveHeader('topic', e.target.value)}
              disabled={plan.status === 'completed'}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Objective</label>
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="Main objective…"
              defaultValue={plan.objective || ''}
              onBlur={e => saveHeader('objective', e.target.value)}
              disabled={plan.status === 'completed'}
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500 w-16 shrink-0">Players</label>
            <input type="number"
              className="w-20 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-400"
              placeholder="0"
              defaultValue={plan.num_players || ''}
              onBlur={e => saveHeader('num_players', parseInt(e.target.value) || null)}
              disabled={plan.status === 'completed'}
            />
          </div>
        </div>

        {/* Phases */}
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1">
          Phases · {phases.length} · {totalDur}min
        </p>

        {phases.map((phase, i) => (
          <PhaseCard key={phase.id} phase={phase} index={i} total={phases.length}
            onChange={changePhase}
            onDelete={() => removePhase(phase.id)}
            onMoveUp={() => movePhase(i, -1)}
            onMoveDown={() => movePhase(i, 1)}
          />
        ))}

        {(plan.status === 'draft' || plan.status === 'active') && (
          <>
            <p className="text-xs font-semibold text-gray-500 px-1">Add phase</p>
            <div className="grid grid-cols-4 gap-2">
              {PHASE_CATEGORIES.map(cat => (
                <button key={cat.key}
                  onClick={() => setPicker(cat.key)}
                  className={`rounded-xl border py-2 text-[11px] font-semibold ${cat.color} hover:opacity-80 transition`}>
                  {cat.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Duplicate button */}
        <button onClick={() => setDuplicateModal(true)}
          className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-gray-300 rounded-2xl text-sm text-gray-500 hover:bg-gray-50 transition mt-2">
          <Copy size={14} /> Use as template for another day
        </button>
      </div>

      {/* Drill picker sheet */}
      {picker && (
        <DrillPicker
          category={picker}
          academyId={academyId}
          sportName={sportName}
          onSelect={drill => addPhase(picker, drill)}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Duplicate modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-gray-900">Duplicate to another day</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">New date</label>
                <input type="date" value={dupDate} onChange={e => setDupDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Batch</label>
                <select value={dupBatch} onChange={e => setDupBatch(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 bg-white">
                  {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleDuplicate} disabled={!dupDate || saving}
                className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                {saving ? 'Duplicating…' : 'Duplicate'}
              </button>
              <button onClick={() => setDuplicateModal(false)}
                className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const DAY_SHORT = { Sunday:'Sun', Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat' }

function nextValidDate(fromDate, days) {
  if (!days?.length) return fromDate
  const d = new Date(fromDate + 'T00:00:00')
  for (let i = 0; i < 7; i++) {
    if (days.includes(DAY_NAMES[d.getDay()])) return d.toISOString().split('T')[0]
    d.setDate(d.getDate() + 1)
  }
  return fromDate
}

// ── New Session Modal ─────────────────────────────────────────────────────────
function NewSessionModal({ batches, academyId, coachId, onCreated, onClose }) {
  const [batchId, setBatchId] = useState(batches[0]?.id || '')
  const [date, setDate]       = useState(() => {
    const today = new Date().toISOString().split('T')[0]
    const first = batches[0]
    return first?.days?.length ? nextValidDate(today, first.days) : today
  })
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const batch     = batches.find(b => b.id === batchId)
  const batchDays = batch?.days || []
  const selDay    = date ? DAY_NAMES[new Date(date + 'T00:00:00').getDay()] : null
  const dayBlocked = batchDays.length > 0 && selDay && !batchDays.includes(selDay)

  const handleBatchChange = (newBatchId) => {
    setBatchId(newBatchId)
    const newBatch = batches.find(b => b.id === newBatchId)
    if (newBatch?.days?.length) setDate(nextValidDate(date, newBatch.days))
  }

  const create = async () => {
    if (!batchId || !date) return
    setSaving(true)
    setErr('')
    try {
      const payload = {
        academy_id: academyId || undefined,
        batch_id:   batchId   || undefined,
        coach_id:   coachId   || undefined,
        date,
        status: 'draft',
      }
      const plan = await createSessionPlan(payload)
      onCreated(plan)
    } catch (e) {
      if (e.code === '23505')  setErr('A session already exists for this batch on that date.')
      else if (e.code === '42P01') setErr('Session tables not found — please run migrations 0021–0024 in Supabase.')
      else if (e.code === '23502') setErr('Missing required field. Check academy / batch setup.')
      else setErr(`Error ${e.code || '?'}: ${e.message || 'unknown'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-4">
        <h3 className="font-bold text-gray-900">New Session Plan</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Batch</label>
            <select value={batchId} onChange={e => handleBatchChange(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 bg-white">
              {batches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {batchDays.length > 0 && (
              <p className="text-[11px] mt-1 text-gray-400">
                Training days: {batchDays.map(d => DAY_SHORT[d] || d).join(' · ')}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-400 ${dayBlocked ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
            {dayBlocked && (
              <div className="flex items-start gap-1.5 mt-1.5">
                <AlertCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] text-red-600 font-medium">{selDay} is not a training day.</p>
                  <button type="button" onClick={() => setDate(nextValidDate(date, batchDays))}
                    className="text-[11px] text-brand-600 font-semibold underline mt-0.5">
                    Jump to next training day →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        {err && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={create} disabled={!batchId || !date || saving || dayBlocked}
            className="flex-1 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50">
            {saving ? 'Creating…' : 'Create'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main SessionPlanner ───────────────────────────────────────────────────────
export default function SessionPlanner() {
  const { user, batches: ctxBatches, selectedSport, sportBranches } = useApp()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(null)
  const [newModal, setNewModal] = useState(false)
  const [tab, setTab]           = useState('upcoming')
  const [deletingId, setDeletingId] = useState(null)

  const academyId = user?.academyId
  const coachId   = user?.staffId || user?.id

  const myBatches = (ctxBatches || []).filter(b =>
    b.coach && user?.name && b.coach.toLowerCase() === user.name.toLowerCase()
  )
  const batches = myBatches.length > 0 ? myBatches : (ctxBatches || [])
  const sportName = (sportBranches || []).find(sb => sb.id === selectedSport)?.sportName || null

  const load = useCallback(() => {
    if (!academyId) return
    setLoading(true)
    fetchSessionPlans({ academyId, coachId })
      .then(plans => setSessions(plans))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [academyId, coachId])

  useEffect(() => { load() }, [load])

  if (editing) {
    return (
      <SessionEditor
        plan={editing}
        batches={batches}
        academyId={academyId}
        sportName={sportName}
        onBack={() => { setEditing(null); load() }}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  const handleDelete = async (e, planId) => {
    e.stopPropagation()
    if (!confirm('Delete this session plan?')) return
    setDeletingId(planId)
    try { await dbDeleteSessionPlan(planId); load() }
    catch { setDeletingId(null) }
  }

  const upcoming  = sessions.filter(s => s.status === 'draft' || s.status === 'active').sort((a, b) => a.date < b.date ? -1 : 1)
  const completed = sessions.filter(s => s.status === 'completed').sort((a, b) => a.date > b.date ? -1 : 1)

  const batchName = id => batches.find(b => b.id === id)?.name || '—'

  const phaseSummary = plan => {
    const phases = plan.session_phases || []
    return phases.length ? `${phases.length} phase${phases.length > 1 ? 's' : ''} · ${plan.total_duration || phases.reduce((s, p) => s + (p.duration || 0), 0)}m` : 'No phases yet'
  }

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Sessions</h1>
          <p className="text-xs text-gray-400 mt-0.5">Build and manage training plans</p>
        </div>
        {tab !== 'drills' && (
          <button onClick={() => setNewModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-semibold shadow-sm">
            <Plus size={15} /> New
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 mb-4">
        <div className="flex bg-gray-100 rounded-xl p-0.5 gap-0.5">
          {[
            { key: 'upcoming',  label: `Upcoming (${upcoming.length})` },
            { key: 'completed', label: `History (${completed.length})` },
            { key: 'drills',    label: 'Drill Library' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drill Library tab */}
      {tab === 'drills' && (
        <StaffDrillLibrary
          academyId={academyId}
          coachId={coachId}
          sportName={sportName}
        />
      )}

      {/* Session list tabs */}
      {tab !== 'drills' && (
        <div className="px-4 space-y-3">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />)
          ) : (tab === 'upcoming' ? upcoming : completed).length === 0 ? (
            <div className="text-center py-12">
              <CalendarDays size={32} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-500">
                {tab === 'upcoming' ? 'No upcoming sessions' : 'No completed sessions yet'}
              </p>
              {tab === 'upcoming' && (
                <button onClick={() => setNewModal(true)}
                  className="mt-3 text-sm text-brand-600 font-semibold">
                  Create your first session →
                </button>
              )}
            </div>
          ) : (
            (tab === 'upcoming' ? upcoming : completed).map(plan => (
              <div key={plan.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-sm transition">
                {plan.ground_photo_url && (
                  <img src={plan.ground_photo_url} alt="Ground"
                    className="w-full h-24 object-cover cursor-pointer"
                    onClick={() => setEditing(plan)} />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2"
                    onClick={() => setEditing(plan)} style={{ cursor: 'pointer' }}>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-sm">{batchName(plan.batch_id)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmt(plan.date)}</p>
                      {plan.topic && <p className="text-xs text-gray-600 mt-1 truncate">{plan.topic}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {plan.status === 'completed' && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <Trophy size={10} /> Done
                        </span>
                      )}
                      {plan.status === 'active' && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                          <Zap size={10} /> Active
                        </span>
                      )}
                      {plan.status === 'draft' && (
                        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Created</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={11} /> {phaseSummary(plan)}
                    </span>
                    <button onClick={e => handleDelete(e, plan.id)} disabled={deletingId === plan.id}
                      className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition disabled:opacity-40">
                      <Trash2 size={12} /> {deletingId === plan.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {newModal && (
        <NewSessionModal
          batches={batches}
          academyId={academyId}
          coachId={coachId}
          onCreated={plan => { setNewModal(false); load(); setEditing(plan) }}
          onClose={() => setNewModal(false)}
        />
      )}
    </div>
  )
}
