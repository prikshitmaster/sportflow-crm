import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Megaphone, Plus, Calendar, Trophy, Bell, Mic, PartyPopper, X, Send } from 'lucide-react'
import { Modal } from './Students'
import SendStaffNoticeModal from '../components/SendStaffNoticeModal'
import DevFillButton from '../components/DevFillButton'
import { fillAnnouncement } from '../lib/devFill'

const TYPE_CONFIG = {
  Holiday:     { cls: 'badge-yellow', icon: Calendar,     bg: 'bg-amber-50',   border: 'border-amber-100' },
  Tournament:  { cls: 'badge-blue',   icon: Trophy,       bg: 'bg-brand-50',   border: 'border-brand-100' },
  Achievement: { cls: 'badge-green',  icon: PartyPopper,  bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Reminder:    { cls: 'badge-gray',   icon: Bell,         bg: 'bg-gray-50',    border: 'border-gray-100' },
  Announcement:{ cls: 'badge-purple', icon: Megaphone,    bg: 'bg-purple-50',  border: 'border-purple-100' },
}

const TYPES = Object.keys(TYPE_CONFIG)

export default function Community() {
  const { announcements, addAnnouncement, sendStaffNotice, staff } = useApp()
  const [filter,     setFilter]     = useState('All')
  const [showModal,  setShowModal]  = useState(false)
  const [showNotice, setShowNotice] = useState(false)

  const filtered = filter === 'All' ? announcements : announcements.filter(a => a.type === filter)

  return (
    <div className="space-y-5 max-w-[800px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Community Updates</h2>
          <p className="text-sm text-gray-500">Announce to parents, coaches and students</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowNotice(true)}>
            <Send size={15} /> Staff Notice
          </button>
          <button className="btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={16} /> New Announcement
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {['All', ...TYPES].map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition ${filter===t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {filtered.map(a => {
          const tc = TYPE_CONFIG[a.type] || TYPE_CONFIG.Announcement
          const Icon = tc.icon
          return (
            <div key={a.id} className={`card p-5 border-l-4 ${tc.border}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 ${tc.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <Icon size={18} className={tc.cls.includes('blue') ? 'text-brand-600' : tc.cls.includes('green') ? 'text-emerald-600' : tc.cls.includes('yellow') ? 'text-amber-600' : tc.cls.includes('purple') ? 'text-purple-600' : 'text-gray-500'} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`badge ${tc.cls}`}>{a.type}</span>
                    <span className="text-xs text-gray-400">{new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1.5">{a.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{a.body}</p>
                  <p className="text-xs text-gray-400 mt-3">— {a.author}</p>
                </div>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No announcements yet</p>
          </div>
        )}
      </div>

      {showModal  && <AddAnnouncementModal onClose={() => setShowModal(false)} onSave={addAnnouncement} />}
      {showNotice && <SendStaffNoticeModal staff={staff} onClose={() => setShowNotice(false)} onSend={sendStaffNotice} />}
    </div>
  )
}

function AddAnnouncementModal({ onClose, onSave }) {
  const [form, setForm] = useState({ title: '', body: '', type: TYPES[4] })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="New Announcement" onClose={onClose}>
      <div className="flex justify-end -mt-1 mb-1">
        <DevFillButton onFill={() => setForm(fillAnnouncement())} />
      </div>
      <div className="space-y-4">
        <div>
          <label className="label">Type</label>
          <div className="flex flex-wrap gap-2">
            {TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => set('type', t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${form.type===t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Title *</label>
          <input className="input" placeholder="Announcement title" value={form.title} onChange={e => set('title', e.target.value)} />
        </div>
        <div>
          <label className="label">Message</label>
          <textarea
            className="input resize-none"
            rows={4}
            placeholder="Write your announcement here..."
            value={form.body}
            onChange={e => set('body', e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => { onSave(form); onClose() }}>Post Announcement</button>
      </div>
    </Modal>
  )
}
