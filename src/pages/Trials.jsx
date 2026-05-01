import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { SPORTS, SOURCES } from '../data/mockData'
import { UserPlus, Search, CheckCircle, Clock, Calendar, MessageCircle, Plus } from 'lucide-react'
import { Modal } from './Students'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const COLORS = ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4']

const statusMap = {
  Scheduled: 'badge-blue',
  Completed: 'badge-green',
  Cancelled: 'badge-red',
}

export default function Trials() {
  const { trials, addTrial, updateTrialStatus } = useApp()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  const filtered = trials.filter(t => {
    const q = search.toLowerCase()
    return !q || t.name.toLowerCase().includes(q) || t.sport.toLowerCase().includes(q) || t.phone.includes(q)
  })

  const converted = trials.filter(t => t.converted).length
  const convRate = trials.length ? Math.round((converted / trials.length) * 100) : 0
  const scheduled = trials.filter(t => t.status === 'Scheduled').length

  const sourceData = SOURCES.map(s => ({
    name: s,
    value: trials.filter(t => t.source === s).length,
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-gray-900">{trials.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Leads</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-brand-600">{scheduled}</p>
          <p className="text-xs text-gray-500 mt-1">Scheduled</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-emerald-600">{converted}</p>
          <p className="text-xs text-gray-500 mt-1">Converted</p>
        </div>
        <div className="card p-5 text-center">
          <p className="text-2xl font-black text-purple-600">{convRate}%</p>
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

function AddTrialModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    name: '', parent: '', phone: '', sport: SPORTS[0],
    trialDate: new Date().toISOString().split('T')[0],
    source: SOURCES[0], status: 'Scheduled', followUp: '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="Add Trial Lead" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Student Name *</label>
          <input className="input" placeholder="Full name" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Parent Name *</label>
          <input className="input" placeholder="Father / Mother" value={form.parent} onChange={e => set('parent', e.target.value)} />
        </div>
        <div>
          <label className="label">Phone *</label>
          <input className="input" placeholder="10-digit mobile" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Sport</label>
          <select className="input" value={form.sport} onChange={e => set('sport', e.target.value)}>
            {SPORTS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Trial Date</label>
          <input className="input" type="date" value={form.trialDate} onChange={e => set('trialDate', e.target.value)} />
        </div>
        <div>
          <label className="label">Lead Source</label>
          <select className="input" value={form.source} onChange={e => set('source', e.target.value)}>
            {SOURCES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Follow-up Date</label>
          <input className="input" type="date" value={form.followUp} onChange={e => set('followUp', e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { onSave(form); onClose() }}>Add Lead</button>
      </div>
    </Modal>
  )
}
