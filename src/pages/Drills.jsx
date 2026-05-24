// Drill Library — completely isolated from other CRM features
// Reads/writes: drills, drill_favorites tables only

import { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { BookOpen, Plus, Search, Heart, X, Edit2, Copy, Clock, Users, Check, Trash2, Image, Upload } from 'lucide-react'
import DevFillButton from '../components/DevFillButton'
import { fillDrill } from '../lib/devFill'

// ── Constants ──────────────────────────────────────────────────

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

const DIFF_COLORS = {
  beginner:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-amber-50   text-amber-700   border-amber-200',
  advanced:     'bg-red-50     text-red-700     border-red-200',
}

const EMPTY_FORM = {
  name: '', category: 'warm_up', age_group: 'All', duration: 15,
  min_players: 6, max_players: 16, difficulty: 'beginner',
  equipment: [], tags: [], area: '', context_ct: '', context_mt: '',
  procedure: [''], coaching_points: [''],
  progressions: [], regressions: [], objectives: [],
  diagram_preset: '', diagram_url: '',
}

// ── Pitch preset SVGs ──────────────────────────────────────────

const PITCH_PRESETS = [
  { key: 'full_pitch',   label: 'Full Pitch' },
  { key: 'half_pitch',   label: 'Half Pitch' },
  { key: 'channel',      label: 'Channel' },
  { key: 'penalty_box',  label: 'Penalty Box' },
  { key: 'thirds',       label: '3 Thirds' },
  { key: 'small_grid',   label: 'Small Grid' },
]

const PITCH_BG = '#2D7A3A'
const W = { stroke: 'white', strokeWidth: '1.5', fill: 'none' }

function PitchSVG({ type, className = '' }) {
  const base = { viewBox: '0 0 100 65', xmlns: 'http://www.w3.org/2000/svg', className: `w-full h-full ${className}` }
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
      </svg>
    )
    case 'half_pitch': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="3" y="3" width="94" height="59" {...W}/>
        <line x1="3" y1="3" x2="97" y2="3" stroke="white" strokeWidth="2.5" fill="none"/>
        <rect x="18" y="45" width="64" height="17" {...W}/>
        <rect x="35" y="57" width="30" height="8" fill="white" opacity="0.3"/>
        <path d="M 35 3 A 15 15 0 0 0 65 3" {...W}/>
      </svg>
    )
    case 'channel': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="25" y="3" width="50" height="59" {...W}/>
        <line x1="25" y1="32.5" x2="75" y2="32.5" stroke="white" strokeWidth="1" strokeDasharray="3 2" fill="none"/>
        <rect x="40" y="3" width="20" height="5" fill="white" opacity="0.4"/>
        <rect x="40" y="57" width="20" height="5" fill="white" opacity="0.4"/>
      </svg>
    )
    case 'penalty_box': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="10" y="8" width="80" height="47" {...W}/>
        <rect x="30" y="46" width="40" height="9" {...W}/>
        <circle cx="50" cy="34" r="2" fill="white"/>
        <rect x="35" y="55" width="30" height="9" fill="white" opacity="0.35" stroke="white" strokeWidth="1.5"/>
        <path d="M 30 8 A 20 20 0 0 0 70 8" {...W}/>
      </svg>
    )
    case 'thirds': return (
      <svg {...base}><rect width="100" height="65" fill={PITCH_BG}/>
        <rect x="3" y="3" width="94" height="59" {...W}/>
        <line x1="3" y1="23" x2="97" y2="23" stroke="white" strokeWidth="1" strokeDasharray="4 2" fill="none"/>
        <line x1="3" y1="42" x2="97" y2="42" stroke="white" strokeWidth="1" strokeDasharray="4 2" fill="none"/>
        <text x="50" y="15" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Defensive</text>
        <text x="50" y="34" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Middle</text>
        <text x="50" y="53" textAnchor="middle" fill="white" fontSize="5" opacity="0.7">Attacking</text>
      </svg>
    )
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
      </svg>
    )
    default: return null
  }
}

function DiagramDisplay({ url, preset, className = '' }) {
  if (url) return (
    <div className={`rounded-xl overflow-hidden bg-gray-100 ${className}`}>
      <img src={url} alt="Drill diagram" className="w-full h-full object-contain" />
    </div>
  )
  if (preset) return (
    <div className={`rounded-xl overflow-hidden ${className}`}>
      <PitchSVG type={preset} />
    </div>
  )
  return null
}

// ── Shared small components ────────────────────────────────────

function CategoryBadge({ category, size = 'sm' }) {
  const c = CATEGORIES[category] || CATEGORIES.technical
  return (
    <span className={`inline-flex items-center gap-1 font-black rounded-full border ${c.bg} ${c.text} ${c.border} ${size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}>
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
        <label className={`text-xs font-semibold ${highlight ? highlight : 'text-gray-700'}`}>{label}</label>
        <button type="button" onClick={add}
          className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-0.5">
          <Plus size={11} /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {value.map((v, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="text-gray-300 text-xs flex-shrink-0">•</span>
            <input value={v} onChange={e => update(i, e.target.value)}
              placeholder={placeholder} className="flex-1 input text-sm py-1.5" />
            <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 flex-shrink-0">
              <X size={13} />
            </button>
          </div>
        ))}
        {value.length === 0 && (
          <p className="text-xs text-gray-400 italic pl-4">None yet — click Add</p>
        )}
      </div>
    </div>
  )
}

// ── Drill Card ─────────────────────────────────────────────────

function DrillCard({ drill, isFav, onFavorite, onClick }) {
  return (
    <div onClick={onClick}
      className="bg-white border border-gray-100 rounded-2xl p-4 cursor-pointer hover:border-gray-200 hover:shadow-sm transition group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <CategoryBadge category={drill.category} />
        <button onClick={e => { e.stopPropagation(); onFavorite() }}
          className={`p-1.5 rounded-lg flex-shrink-0 transition ${isFav ? 'text-red-500' : 'text-gray-200 group-hover:text-gray-400'}`}>
          <Heart size={15} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <h3 className="font-bold text-gray-900 text-sm leading-snug mb-2 line-clamp-2">{drill.name}</h3>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500 mb-2">
        {drill.duration      && <span className="flex items-center gap-1"><Clock size={11} className="text-gray-400"/>{drill.duration}m</span>}
        {drill.min_players   && <span className="flex items-center gap-1"><Users size={11} className="text-gray-400"/>{drill.min_players}–{drill.max_players}</span>}
        {drill.age_group     && <span>{drill.age_group}</span>}
      </div>

      {drill.difficulty && (
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${DIFF_COLORS[drill.difficulty]}`}>
          {drill.difficulty}
        </span>
      )}

      {drill.equipment?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {drill.equipment.slice(0, 3).map((e, i) => (
            <span key={i} className="text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">{e}</span>
          ))}
          {drill.equipment.length > 3 && <span className="text-[10px] text-gray-400">+{drill.equipment.length - 3}</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {!drill.is_global && (
          <span className="text-[10px] font-semibold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">My drill</span>
        )}
        {(drill.diagram_url || drill.diagram_preset) && (
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Image size={9}/> Diagram
          </span>
        )}
      </div>
    </div>
  )
}

// ── Drill Detail Modal ─────────────────────────────────────────

function DrillDetailModal({ drill, isFav, onClose, onFavorite, onEdit, onClone, isOwn, onDelete }) {
  if (!drill) return null
  const c = CATEGORIES[drill.category] || CATEGORIES.technical

  const Section = ({ title, items, color, symbol }) => items?.length > 0 ? (
    <div>
      <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${color || 'text-gray-400'}`}>{title}</p>
      <ul className="space-y-1.5">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700">
            <span className={`flex-shrink-0 mt-0.5 font-bold ${color || 'text-gray-300'}`}>{symbol || `${i+1}.`}</span>
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className={`px-5 py-4 ${c.bg} border-b ${c.border} flex-shrink-0`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <CategoryBadge category={drill.category} size="md" />
              <h2 className={`text-lg font-black ${c.text} mt-1.5 leading-tight`}>{drill.name}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {drill.duration    && <span className="flex items-center gap-1 text-xs text-gray-600 bg-white/70 px-2 py-0.5 rounded-full"><Clock size={11}/>{drill.duration} min</span>}
                {drill.min_players && <span className="flex items-center gap-1 text-xs text-gray-600 bg-white/70 px-2 py-0.5 rounded-full"><Users size={11}/>{drill.min_players}–{drill.max_players} players</span>}
                {drill.age_group   && <span className="text-xs text-gray-600 bg-white/70 px-2 py-0.5 rounded-full">{drill.age_group}</span>}
                {drill.difficulty  && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize ${DIFF_COLORS[drill.difficulty]}`}>{drill.difficulty}</span>}
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
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {/* Pitch diagram */}
          {(drill.diagram_url || drill.diagram_preset) && (
            <DiagramDisplay
              url={drill.diagram_url}
              preset={drill.diagram_preset}
              className="aspect-video max-w-sm mx-auto shadow-sm border border-gray-100"
            />
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
              {drill.area        && <div className="flex gap-3"><span className="text-xs font-bold text-gray-500 w-14 flex-shrink-0">AREA</span><span className="text-xs text-gray-700">{drill.area}</span></div>}
              {drill.context_ct  && <div className="flex gap-3"><span className="text-xs font-bold text-blue-600 w-14 flex-shrink-0">CT —</span><span className="text-xs text-gray-700">{drill.context_ct}</span></div>}
              {drill.context_mt  && <div className="flex gap-3"><span className="text-xs font-bold text-red-600 w-14 flex-shrink-0">MT —</span><span className="text-xs text-gray-700">{drill.context_mt}</span></div>}
            </div>
          )}

          <Section title="Procedure" items={drill.procedure} color="text-gray-400" />
          <Section title="Coaching Points" items={drill.coaching_points} color="text-brand-500" symbol="•" />

          {(drill.progressions?.length > 0 || drill.regressions?.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
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

          <Section title="Objectives" items={drill.objectives} color="text-gray-400" symbol={<Check size={11}/>} />
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

// ── Drill Editor Modal ─────────────────────────────────────────

function DrillEditorModal({ drill, onClose, onSave, saving, academyId, staffId }) {
  const isEdit = !!drill?.id
  const [form, setForm] = useState(() => drill
    ? { ...EMPTY_FORM, ...drill }
    : { ...EMPTY_FORM }
  )
  const [errors, setErrors]       = useState({})
  const [eqInput, setEqInput]     = useState('')
  const [uploading, setUploading] = useState(false)

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

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const drillId = form.id || `draft-${Date.now()}`
      const url = await db.uploadDrillDiagram(file, drillId)
      set('diagram_url', url)
      set('diagram_preset', '')
    } catch (err) {
      console.error(err)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh]">

        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-black text-gray-900">{isEdit ? 'Edit Drill' : 'Add New Drill'}</h2>
          <div className="flex items-center gap-2">
            {!isEdit && <DevFillButton onFill={() => setForm(f => ({ ...f, ...fillDrill() }))} />}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
              <X size={16} className="text-gray-500"/>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Name */}
          <div>
            <label className="label">Drill Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Rondo 4v1"
              className={`input w-full mt-1 ${errors.name ? 'border-red-400' : ''}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Category */}
          <div>
            <label className="label mb-1.5 block">Category *</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(CATEGORIES).map(([key, cat]) => (
                <button key={key} type="button" onClick={() => set('category', key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition ${
                    form.category === key ? `${cat.bg} ${cat.text} ${cat.border}` : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Row: Age, Duration, Players */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="label">Age Group</label>
              <select value={form.age_group} onChange={e => set('age_group', e.target.value)} className="input w-full mt-1 text-sm">
                {AGE_GROUPS.map(a => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Duration (min)</label>
              <input type="number" value={form.duration} onChange={e => set('duration', Number(e.target.value))}
                min="1" max="120" className="input w-full mt-1 text-sm" />
            </div>
            <div>
              <label className="label">Min Players</label>
              <input type="number" value={form.min_players} onChange={e => set('min_players', Number(e.target.value))}
                min="2" className="input w-full mt-1 text-sm" />
            </div>
            <div>
              <label className="label">Max Players</label>
              <input type="number" value={form.max_players} onChange={e => set('max_players', Number(e.target.value))}
                min="2" className="input w-full mt-1 text-sm" />
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <label className="label mb-1.5 block">Difficulty</label>
            <div className="flex gap-2">
              {DIFFICULTIES.map(d => (
                <button key={d} type="button" onClick={() => set('difficulty', d)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border capitalize transition ${
                    form.difficulty === d ? DIFF_COLORS[d] : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment */}
          <div>
            <label className="label mb-1 block">Equipment</label>
            <div className="flex gap-2 mb-2">
              <input value={eqInput} onChange={e => setEqInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addEquipment())}
                placeholder="Balls, Cones, Bibs... (press Enter)"
                className="input flex-1 text-sm" />
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Area</label>
              <input value={form.area} onChange={e => set('area', e.target.value)}
                placeholder="½ pitch, box, grid..." className="input w-full mt-1 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-blue-600 block mb-1">CT — Coaching Team</label>
              <input value={form.context_ct} onChange={e => set('context_ct', e.target.value)}
                placeholder="Blue team role..." className="input w-full text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-red-600 block mb-1">MT — Main Team</label>
              <input value={form.context_mt} onChange={e => set('context_mt', e.target.value)}
                placeholder="Red team role..." className="input w-full text-sm" />
            </div>
          </div>

          {/* Diagram */}
          <div>
            <label className="label mb-2 block">Pitch Diagram</label>
            {/* Preset picker */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
              {PITCH_PRESETS.map(p => (
                <button key={p.key} type="button"
                  onClick={() => { set('diagram_preset', form.diagram_preset === p.key ? '' : p.key); set('diagram_url', '') }}
                  className={`rounded-xl overflow-hidden border-2 transition ${
                    form.diagram_preset === p.key ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div className="aspect-video"><PitchSVG type={p.key} /></div>
                  <p className="text-[10px] font-semibold text-gray-600 text-center py-1 bg-white">{p.label}</p>
                </button>
              ))}
            </div>
            {/* Upload custom image */}
            <div className="flex items-center gap-3">
              <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-300 text-xs font-semibold text-gray-500 cursor-pointer hover:bg-gray-50 transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? <><span className="w-3 h-3 border-2 border-gray-400 border-t-brand-600 rounded-full animate-spin"/>Uploading…</> : <><Upload size={13}/> Upload custom image</>}
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {(form.diagram_url || form.diagram_preset) && (
                <button type="button" onClick={() => { set('diagram_url', ''); set('diagram_preset', '') }}
                  className="text-xs text-red-500 hover:underline">Remove diagram</button>
              )}
            </div>
            {/* Preview */}
            {(form.diagram_preset || form.diagram_url) && (
              <div className="mt-3 max-w-xs">
                <DiagramDisplay preset={form.diagram_preset} url={form.diagram_url} className="aspect-video" />
              </div>
            )}
          </div>

          <ArrayEditor label="Procedure (step by step)" value={form.procedure || []}
            onChange={v => set('procedure', v)} placeholder="Describe a step..." />

          <ArrayEditor label="Coaching Points" value={form.coaching_points || []}
            onChange={v => set('coaching_points', v)} placeholder="Key point..." />

          <ArrayEditor label="↑ Progressions (make harder)" value={form.progressions || []}
            onChange={v => set('progressions', v)} placeholder="e.g. Add defender" highlight="text-emerald-600" />

          <ArrayEditor label="↓ Regressions (make easier)" value={form.regressions || []}
            onChange={v => set('regressions', v)} placeholder="e.g. More space" highlight="text-amber-600" />

          <ArrayEditor label="Objectives" value={form.objectives || []}
            onChange={v => set('objectives', v)} placeholder="e.g. Develop passing under pressure" />
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

// ── Main Page ──────────────────────────────────────────────────

export default function Drills() {
  const { user, selectedSport, sportBranches } = useApp()
  const academyId = user?.academyId
  const staffId   = user?.id
  const sportName = (sportBranches || []).find(sb => sb.id === selectedSport)?.sportName || null

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

  const load = async () => {
    setLoading(true)
    try {
      const [drillData, favData] = await Promise.all([
        db.fetchDrills(academyId, sportName),
        db.fetchDrillFavorites(staffId),
      ])
      setDrills(drillData)
      setFavorites(new Set(favData))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [academyId, sportName])

  const filtered = useMemo(() => {
    let d = drills
    if (showFavs)         d = d.filter(x => favorites.has(x.id))
    if (catFilter !== 'all') d = d.filter(x => x.category === catFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      d = d.filter(x =>
        x.name?.toLowerCase().includes(q) ||
        x.tags?.some(t => t.toLowerCase().includes(q)) ||
        x.equipment?.some(e => e.toLowerCase().includes(q)) ||
        x.area?.toLowerCase().includes(q)
      )
    }
    return d
  }, [drills, favorites, catFilter, search, showFavs])

  const catCounts = useMemo(() => {
    const c = {}
    drills.forEach(d => { c[d.category] = (c[d.category] || 0) + 1 })
    return c
  }, [drills])

  const handleFavorite = async (drill) => {
    const updated = new Set(favorites)
    if (updated.has(drill.id)) updated.delete(drill.id)
    else updated.add(drill.id)
    setFavorites(updated)
    try { await db.toggleDrillFavorite(drill.id, staffId, academyId) }
    catch { await load() }
  }

  const handleSave = async (form) => {
    setSaving(true)
    try {
      if (form.id) {
        await db.updateDrill(form.id, form)
        showToast('Drill updated')
      } else {
        await db.createDrill({ ...form, academy_id: academyId, created_by: staffId, is_global: false, sport_name: sportName })
        showToast('Drill added to your library')
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
    if (!confirm(`Delete "${drill.name}"? This cannot be undone.`)) return
    try {
      await db.deleteDrill(drill.id)
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
    <div className="space-y-5 max-w-7xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white ${
          toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-500'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2.5">
            <BookOpen size={22} className="text-brand-600"/> Drill Library
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {drills.length} drills total · {drills.filter(d => !d.is_global).length} custom
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowEditor(true) }}
          className="btn-primary flex items-center gap-2 flex-shrink-0">
          <Plus size={16}/> Add Drill
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search drills, equipment, tags..."
          className="w-full input pl-10 pr-10" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14}/>
          </button>
        )}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <button onClick={() => { setCatFilter('all'); setShowFavs(false) }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex-shrink-0 border ${
            catFilter === 'all' && !showFavs ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}>
          All ({drills.length})
        </button>

        {Object.entries(CATEGORIES).map(([key, cat]) => (
          <button key={key} onClick={() => { setCatFilter(key); setShowFavs(false) }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex-shrink-0 border ${
              catFilter === key && !showFavs
                ? `${cat.bg} ${cat.text} ${cat.border}`
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {cat.label}{catCounts[key] ? ` (${catCounts[key]})` : ''}
          </button>
        ))}

        <button onClick={() => { setShowFavs(f => !f); setCatFilter('all') }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex-shrink-0 flex items-center gap-1.5 border ${
            showFavs ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}>
          <Heart size={11} fill={showFavs ? 'currentColor' : 'none'}/> Favorites ({favorites.size})
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse"/>)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-14 text-center">
          <BookOpen size={32} className="text-gray-200 mx-auto mb-3"/>
          <p className="text-sm font-bold text-gray-500">
            {search ? `No drills match "${search}"` : showFavs ? 'No favorites yet — heart a drill to save it' : 'No drills in this category'}
          </p>
          {!search && !showFavs && (
            <button onClick={() => { setEditing(null); setShowEditor(true) }}
              className="mt-4 btn-primary text-xs flex items-center gap-1.5 mx-auto">
              <Plus size={13}/> Add your first drill
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(drill => (
            <DrillCard key={drill.id} drill={drill}
              isFav={favorites.has(drill.id)}
              onFavorite={() => handleFavorite(drill)}
              onClick={() => setSelected(drill)}
            />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <DrillDetailModal
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

      {/* Editor modal */}
      {showEditor && (
        <DrillEditorModal
          drill={editing}
          onClose={() => { setShowEditor(false); setEditing(null) }}
          onSave={handleSave}
          saving={saving}
          academyId={academyId}
          staffId={staffId}
        />
      )}
    </div>
  )
}
