import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, SOURCES } from '../data/mockData'
import { UserPlus, Search, CheckCircle, Clock, Calendar, MessageCircle, Plus, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Modal } from './Students'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

// ── Date helpers ─────────────────────────────────────────
const today   = () => new Date().toISOString().split('T')[0]
const addDays = (base, n) => {
  const d = new Date(base || today())
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}
const fmtShort = iso => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Get Monday of the week containing a date
const weekStart = (iso) => {
  const d = new Date(iso)
  const day = d.getDay() || 7  // treat Sunday as 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().split('T')[0]
}
const weekEnd = (mondayIso) => addDays(mondayIso, 6)

const fmtWeekLabel = (mondayIso) => {
  const mon = new Date(mondayIso)
  const sun = new Date(mondayIso); sun.setDate(sun.getDate() + 6)
  const fmt = d => `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0,3)}`
  return `${fmt(mon)} – ${fmt(sun)}`
}

const COLORS = ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4']

const statusMap = {
  Scheduled: 'badge-blue',
  Completed: 'badge-green',
  Cancelled: 'badge-red',
}

export default function Trials() {
  const { trials, addTrial, updateTrialStatus } = useApp()
  const [search,     setSearch]     = useState('')
  const [showModal,  setShowModal]  = useState(false)
  const [viewMode,   setViewMode]   = useState('month')   // 'month' | 'week' | 'all'

  const now = new Date()
  const [navYear,  setNavYear]  = useState(now.getFullYear())
  const [navMonth, setNavMonth] = useState(now.getMonth())       // 0-11
  const [navWeek,  setNavWeek]  = useState(weekStart(today()))   // monday ISO

  // ── Period navigation ─────────────────────────────────
  const prevPeriod = () => {
    if (viewMode === 'month') {
      if (navMonth === 0) { setNavYear(y => y - 1); setNavMonth(11) }
      else setNavMonth(m => m - 1)
    } else {
      setNavWeek(w => addDays(w, -7))
    }
  }
  const nextPeriod = () => {
    if (viewMode === 'month') {
      if (navMonth === 11) { setNavYear(y => y + 1); setNavMonth(0) }
      else setNavMonth(m => m + 1)
    } else {
      setNavWeek(w => addDays(w, 7))
    }
  }
  const goToday = () => {
    setNavYear(now.getFullYear()); setNavMonth(now.getMonth())
    setNavWeek(weekStart(today()))
  }

  const periodLabel = viewMode === 'month'
    ? `${MONTH_NAMES[navMonth]} ${navYear}`
    : viewMode === 'week'
    ? fmtWeekLabel(navWeek)
    : 'All Time'

  // ── Filter trials by period ───────────────────────────
  const periodFiltered = useMemo(() => {
    if (viewMode === 'all') return trials
    return trials.filter(t => {
      const d = t.trialDate || ''
      if (!d) return false
      if (viewMode === 'month') {
        const [y, m] = d.split('-').map(Number)
        return y === navYear && m - 1 === navMonth
      }
      // week
      const wEnd = weekEnd(navWeek)
      return d >= navWeek && d <= wEnd
    })
  }, [trials, viewMode, navYear, navMonth, navWeek])

  // ── Search on top of period filter ───────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return !q ? periodFiltered : periodFiltered.filter(t =>
      t.name.toLowerCase().includes(q) || t.sport.toLowerCase().includes(q) || t.phone.includes(q)
    )
  }, [periodFiltered, search])

  // ── Stats — scoped to period ──────────────────────────
  const periodConverted  = periodFiltered.filter(t => t.converted).length
  const periodScheduled  = periodFiltered.filter(t => t.status === 'Scheduled').length
  const periodConvRate   = periodFiltered.length ? Math.round((periodConverted / periodFiltered.length) * 100) : 0

  const sourceData = SOURCES.map(s => ({
    name: s,
    value: periodFiltered.filter(t => t.source === s).length,
  })).filter(x => x.value > 0)

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Trial Management</h2>
          <p className="text-sm text-gray-500">Track leads, schedule trials, convert to students</p>
        </div>
        <button className="btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Trial Lead
        </button>
      </div>

      {/* ── Period navigator ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Toggle */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-100 p-0.5 gap-0.5">
          {[['month','Monthly'],['week','Weekly'],['all','All']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition ${
                viewMode === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Arrow navigator — hidden in All mode */}
        {viewMode !== 'all' && (
          <div className="flex items-center gap-1">
            <button onClick={prevPeriod} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition active:bg-gray-200">
              <ChevronLeft size={16} className="text-gray-600" />
            </button>
            <span className="text-sm font-bold text-gray-800 min-w-[140px] text-center">{periodLabel}</span>
            <button onClick={nextPeriod} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition active:bg-gray-200">
              <ChevronRight size={16} className="text-gray-600" />
            </button>
            <button onClick={goToday} className="text-xs font-semibold text-brand-600 px-2.5 py-1.5 rounded-lg hover:bg-brand-50 transition active:bg-brand-100">
              Today
            </button>
          </div>
        )}

        {/* Period count badge */}
        <span className="ml-auto text-xs font-semibold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
          {periodFiltered.length} lead{periodFiltered.length !== 1 ? 's' : ''}
          {viewMode !== 'all' && ` in ${viewMode === 'month' ? MONTH_NAMES[navMonth].slice(0,3) : 'this week'}`}
        </span>
      </div>

      {/* Stats — scoped to period */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-gray-900">{periodFiltered.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Leads</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-brand-600">{periodScheduled}</p>
          <p className="text-xs text-gray-500 mt-1">Scheduled</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-emerald-600">{periodConverted}</p>
          <p className="text-xs text-gray-500 mt-1">Converted</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-purple-600">{periodConvRate}%</p>
          <p className="text-xs text-gray-500 mt-1">Conversion Rate</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Trial table */}
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-3">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-1">
              <Search size={14} className="text-gray-400" />
              <input
                className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none w-full"
                placeholder="Search leads..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="py-14 text-center">
              <Calendar size={32} className="text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-400">No trials in this period</p>
              <p className="text-xs text-gray-400 mt-1">Try navigating to another {viewMode === 'week' ? 'week' : 'month'} or switch to All</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Lead', 'Sport', 'Trial Date', 'Source', 'Status', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50/60 transition">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.parent} · {t.phone}</p>
                    </td>
                    <td className="px-4 py-3"><span className="badge badge-blue">{t.sport}</span></td>
                    <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                      <div className="flex items-center gap-1"><Calendar size={12} /> {new Date(t.trialDate).toLocaleDateString('en-IN')}</div>
                    </td>
                    <td className="px-4 py-3"><span className="badge badge-gray">{t.source}</span></td>
                    <td className="px-4 py-3">
                      {t.converted ? (
                        <span className="badge badge-green">Converted ✓</span>
                      ) : (
                        <span className={`badge ${statusMap[t.status]}`}>{t.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {!t.converted && t.status === 'Completed' && (
                          <button
                            className="text-xs text-emerald-600 font-semibold hover:underline whitespace-nowrap"
                            onClick={() => updateTrialStatus(t.id, { converted: true })}
                          >
                            Convert →
                          </button>
                        )}
                        {t.status === 'Scheduled' && (
                          <button
                            className="text-xs text-brand-600 font-semibold hover:underline"
                            onClick={() => updateTrialStatus(t.id, { status: 'Completed' })}
                          >
                            Mark Done
                          </button>
                        )}
                        <button className="text-xs text-green-600 font-semibold hover:underline flex items-center gap-0.5">
                          <MessageCircle size={11} /> WhatsApp
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

        {/* Source breakdown */}
        <div className="card p-5">
          <h3 className="font-bold text-gray-900 mb-1">Lead Sources</h3>
          <p className="text-xs text-gray-500 mb-4">Where your trials come from</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={sourceData} cx="50%" cy="50%" outerRadius={65} dataKey="value" paddingAngle={2}>
                {sourceData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v, n, { payload }) => [v, payload.name]} contentStyle={{ borderRadius: 8, border: 'none', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 mt-3">
            {sourceData.map((s, i) => (
              <div key={s.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }}></div>
                  <span className="text-xs text-gray-600">{s.name}</span>
                </div>
                <span className="text-xs font-bold text-gray-900">{s.value}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 p-3 bg-brand-50 rounded-xl">
            <p className="text-xs font-bold text-brand-700 mb-1">WhatsApp Reminders</p>
            <p className="text-xs text-brand-600 mb-3">Send follow-up messages to pending trial leads</p>
            <button className="w-full bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-2 px-3 rounded-lg transition flex items-center justify-center gap-1.5">
              <MessageCircle size={13} /> Send WhatsApp Follow-up
            </button>
          </div>
        </div>
      </div>

      {showModal && <AddTrialModal onClose={() => setShowModal(false)} onSave={addTrial} />}
    </div>
  )
}

// ── Quick-pick date row ───────────────────────────────────
function DatePicker({ label, value, onChange, chips, showCustom, setShowCustom }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label mb-0">{label}</label>
        {value && (
          <span className="text-[11px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
            {fmtShort(value)}
          </span>
        )}
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {chips.map(({ label: cl, value: cv }) => (
          <button
            key={cl}
            type="button"
            onClick={() => { onChange(cv); setShowCustom(false) }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
              value === cv
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
            }`}
          >
            {cl}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom(v => !v)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
            showCustom
              ? 'bg-gray-800 text-white border-gray-800'
              : 'bg-white text-gray-500 border-gray-200 active:bg-gray-50'
          }`}
        >
          Pick date <ChevronDown size={11} className={`transition-transform ${showCustom ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Custom date input — shown when "Pick date" is tapped */}
      {showCustom && (
        <input
          className="input"
          type="date"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

function AddTrialModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', sport: SPORTS[0],
    trialDate: today(),
    source: SOURCES[0], status: 'Scheduled', followUp: '',
  })
  const [showTrialCustom,  setShowTrialCustom]  = useState(false)
  const [showFollowCustom, setShowFollowCustom] = useState(false)
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const trialChips = [
    { label: 'Today',     value: today() },
    { label: 'Tomorrow',  value: addDays(today(), 1) },
    { label: '+2 days',   value: addDays(today(), 2) },
    { label: '+3 days',   value: addDays(today(), 3) },
  ]

  // Follow-up chips relative to selected trial date
  const followChips = [
    { label: '+3 days',  value: addDays(form.trialDate, 3) },
    { label: '+5 days',  value: addDays(form.trialDate, 5) },
    { label: '+1 week',  value: addDays(form.trialDate, 7) },
    { label: '+2 weeks', value: addDays(form.trialDate, 14) },
  ]

  const handleSave = async () => {
    if (!form.name || !form.phone) return
    setLoading(true)
    try { await onSave(form); onClose() } finally { setLoading(false) }
  }

  return (
    <Modal title="Add Trial Lead" onClose={onClose}>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="label">Student Name *</label>
          <input className="input" placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>

        {/* Parent + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Parent Name</label>
            <input className="input" placeholder="Father / Mother" value={form.parent} onChange={e => set('parent', e.target.value)} />
          </div>
          <div>
            <label className="label">Phone *</label>
            <input className="input" placeholder="10-digit mobile" value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
        </div>

        {/* Sport + Source */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Sport</label>
            <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
              {SPORTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Lead Source</label>
            <select className="input" value={form.source} onChange={e => set('source', e.target.value)}>
              {SOURCES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Trial Date — quick pick */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
          <DatePicker
            label="Trial Date *"
            value={form.trialDate}
            onChange={v => { set('trialDate', v); set('followUp', '') }}
            chips={trialChips}
            showCustom={showTrialCustom}
            setShowCustom={setShowTrialCustom}
          />
        </div>

        {/* Follow-up Date — quick pick, relative to trial date */}
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
          <DatePicker
            label="Follow-up Date"
            value={form.followUp}
            onChange={v => set('followUp', v)}
            chips={followChips}
            showCustom={showFollowCustom}
            setShowCustom={setShowFollowCustom}
          />
          {!form.followUp && (
            <p className="text-[11px] text-gray-400 mt-1.5">Optional — set a reminder to call back</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-5">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          onClick={handleSave}
          disabled={loading || !form.name || !form.phone}
        >
          {loading ? '…' : 'Add Lead'}
        </button>
      </div>
    </Modal>
  )
}
