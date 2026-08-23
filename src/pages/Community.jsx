import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Megaphone, Plus, Calendar, Trophy, Bell, Mic, PartyPopper, X, Send, Search, Trash2, MapPin, Image, Loader2 } from 'lucide-react'
import * as db from '../lib/db'
import { Modal } from './Students'
import SendStaffNoticeModal from '../components/SendStaffNoticeModal'
import DevFillButton from '../components/DevFillButton'
import { fillAnnouncement } from '../lib/devFill'
import { fetchNoticeReceipts } from '../lib/notifications'

const TYPE_CONFIG = {
  Holiday:     { cls: 'badge-yellow', icon: Calendar,     bg: 'bg-amber-50',   border: 'border-amber-100' },
  Tournament:  { cls: 'badge-blue',   icon: Trophy,       bg: 'bg-brand-50',   border: 'border-brand-100' },
  Achievement: { cls: 'badge-green',  icon: PartyPopper,  bg: 'bg-emerald-50', border: 'border-emerald-100' },
  Reminder:    { cls: 'badge-gray',   icon: Bell,         bg: 'bg-gray-50',    border: 'border-gray-100' },
  Announcement:{ cls: 'badge-purple', icon: Megaphone,    bg: 'bg-purple-50',  border: 'border-purple-100' },
  'Staff Notice': { cls: 'badge-yellow', icon: Bell,      bg: 'bg-amber-50',   border: 'border-amber-100' },
}

const TYPES = Object.keys(TYPE_CONFIG)

// Who a post went to, for the feed + detail view. Rows created before the
// audience feature have no audience_type and were broadcast to everyone.
function audienceLabel(a) {
  const type = a?.audienceType || a?.audience_type || 'all'
  const n    = (a?.audienceIds || a?.audience_ids || []).length
  if (type === 'students')      return 'All students'
  if (type === 'staff')         return 'All staff'
  if (type === 'batches')       return `${n} batch${n === 1 ? '' : 'es'}`
  if (type === 'students_list') return `${n} student${n === 1 ? '' : 's'}`
  if (type === 'staff_members') return `${n} staff`
  return 'Everyone'
}

// "When" line for a notice carrying event dates (0183). Relative wording for
// the near future because that is what people are actually scanning for —
// an exact date tells you less than "Tomorrow" when it is tomorrow.
const dmy = (d) => new Date(d + 'T00:00:00')
  .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

function eventWhen(a) {
  if (!a?.eventDate) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = dmy(a.eventDate)
  if (a.eventEndDate && a.eventEndDate !== a.eventDate) {
    return `${start} – ${dmy(a.eventEndDate)}`
  }
  const days = Math.round((new Date(a.eventDate + 'T00:00:00') - today) / 86400000)
  if (days === 0) return `Today · ${start}`
  if (days === 1) return `Tomorrow · ${start}`
  if (days < 0)   return start
  if (days <= 7)  return `In ${days} days · ${start}`
  return new Date(a.eventDate + 'T00:00:00')
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Community() {
  // students/batches/staff from context are already branch+sport scoped, so the
  // audience picker can only ever target people in the sender's current scope.
  const { announcements, addAnnouncement, removeAnnouncement, sendStaffNotice,
          staff, students, batches, hasPermission } = useApp()
  const [filter,     setFilter]     = useState('All')
  const [search,     setSearch]     = useState('')
  const [showModal,  setShowModal]  = useState(false)
  const [showNotice, setShowNotice] = useState(false)
  const [detail,     setDetail]     = useState(null)   // announcement being viewed
  const [confirmDel, setConfirmDel] = useState(null)   // announcement pending delete

  // Posting and deleting community content both go with managing it.
  const canManage = hasPermission('community.manage')
  // Messaging the whole staff body is a staff-management action, deliberately a
  // higher bar than posting announcements: owners bypass, branch_manager/admin
  // hold every permission, and ordinary coaches never get staff.manage even
  // when they've been granted community.manage.
  const canNotifyStaff = hasPermission('staff.manage')

  const q = search.toLowerCase().trim()
  const filtered = announcements.filter(a => {
    if (filter !== 'All' && a.type !== filter) return false
    if (q && !((a.title || '').toLowerCase().includes(q) || (a.body || '').toLowerCase().includes(q))) return false
    return true
  })

  // Read receipts for the open Staff Notice — owner can't confirm one
  // themselves (they're never the recipient), just see who has. Fetched only
  // when a Staff Notice's detail is opened, not for the whole feed at once.
  const [detailReceipts, setDetailReceipts] = useState([])
  useEffect(() => {
    if (!detail || detail.type !== 'Staff Notice') { setDetailReceipts([]); return }
    let alive = true
    fetchNoticeReceipts(detail.id).then(rows => { if (alive) setDetailReceipts(rows) }).catch(() => {})
    return () => { alive = false }
  }, [detail])
  const staffById = Object.fromEntries((staff || []).map(s => [String(s.id), s]))
  // Only notices with an explicit action_label have a "Got it" button to set
  // actioned_at — a plain FYI notice never gets one, so counting only
  // actioned_at left those permanently at "0 confirmed" no matter how many
  // staff had opened and read it. Fall back to the plain `read` flag (set
  // when a staff member taps the notice in their bell) for those.
  const receiptsNeedAction = detailReceipts.some(r => r.action_label)
  const confirmedReceipts  = detailReceipts.filter(r => receiptsNeedAction ? r.actioned_at : r.read)

  return (
    <div className="space-y-5 max-w-[800px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Community Updates</h2>
          <p className="text-sm text-gray-500">Announce to parents, coaches and students</p>
        </div>
        <div className="flex gap-2">
          {canNotifyStaff && (
            <button className="btn-secondary" onClick={() => setShowNotice(true)}>
              <Send size={15} /> Staff Notice
            </button>
          )}
          {canManage && (
            <button className="btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Announcement
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search announcements…"
          className="input w-full pl-9 text-sm" />
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
            <div key={a.id}
              onClick={() => setDetail(a)}
              className={`card p-5 border-l-4 ${tc.border} cursor-pointer hover:shadow-md transition group`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 ${tc.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <Icon size={18} className={tc.cls.includes('blue') ? 'text-brand-600' : tc.cls.includes('green') ? 'text-emerald-600' : tc.cls.includes('yellow') ? 'text-amber-600' : tc.cls.includes('purple') ? 'text-purple-600' : 'text-gray-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`badge ${tc.cls}`}>{a.type}</span>
                    <span className="text-xs text-gray-400">{new Date(a.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span className="text-[10px] text-gray-400 font-medium">{audienceLabel(a)}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1.5">{a.title}</h3>
                  {/* When / where, when this notice is an event (0183). Sits
                      above the body because it is the part people scan for. */}
                  {a.eventDate && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 bg-brand-50 px-2 py-1 rounded-lg">
                        <Calendar size={11} />
                        {eventWhen(a)}
                      </span>
                      {a.venue && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <MapPin size={11} className="text-gray-400" /> {a.venue}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Truncated here — full text lives in the detail popup */}
                  <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{a.body}</p>
                  <p className="text-xs text-gray-400 mt-3">— {a.author}</p>
                </div>
                {canManage && (
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDel(a) }}
                    title="Delete announcement"
                    className="p-2 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition flex-shrink-0">
                    <Trash2 size={15} />
                  </button>
                )}
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

      {showModal  && <AddAnnouncementModal staff={staff} students={students} batches={batches}
                       onClose={() => setShowModal(false)} onSave={addAnnouncement} />}
      {showNotice && canNotifyStaff &&
        <SendStaffNoticeModal staff={staff} onClose={() => setShowNotice(false)} onSend={sendStaffNotice} />}

      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}
          footer={
            <div className="flex justify-end gap-3">
              {canManage && (
                <button className="btn-secondary text-red-600"
                  onClick={() => { setConfirmDel(detail); setDetail(null) }}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
              <button className="btn-primary" onClick={() => setDetail(null)}>Close</button>
            </div>
          }>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <span className={`badge ${(TYPE_CONFIG[detail.type] || TYPE_CONFIG.Announcement).cls}`}>{detail.type}</span>
            <span className="text-xs text-gray-400">
              {new Date(detail.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="text-xs text-gray-500 font-medium">{audienceLabel(detail)}</span>
          </div>

          {/* Event details (0183) */}
          {detail.flyerUrl && (
            <img src={detail.flyerUrl} alt={detail.title}
              className="w-full rounded-xl mb-3 max-h-72 object-cover" />
          )}
          {detail.eventDate && (
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 bg-brand-50 px-2.5 py-1.5 rounded-lg">
                <Calendar size={12} /> {eventWhen(detail)}
              </span>
              {detail.venue && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1.5 rounded-lg">
                  <MapPin size={12} /> {detail.venue}
                </span>
              )}
            </div>
          )}

          {/* whitespace-pre-wrap so line breaks the author typed survive */}
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
            {detail.body || <span className="text-gray-400 italic">No message body</span>}
          </p>
          <p className="text-xs text-gray-400 mt-4">— {detail.author}</p>

          {/* View-only — the owner isn't a recipient, so no confirm button
              here, just who has confirmed so far. */}
          {detail.type === 'Staff Notice' && detailReceipts.length > 0 && (
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
              {confirmedReceipts.length > 0 && (
                <div className="flex -space-x-2">
                  {confirmedReceipts.slice(0, 6).map(r => {
                    const m = staffById[r.recipient_id]
                    const label = `${m?.name || 'Staff'} — ${receiptsNeedAction ? 'confirmed' : 'read'}`
                    return m?.photoUrl ? (
                      <img key={r.recipient_id} src={m.photoUrl} alt={m.name} title={label}
                        className="w-6 h-6 rounded-full object-cover border-2 border-white flex-shrink-0" />
                    ) : (
                      <div key={r.recipient_id} title={label}
                        className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-emerald-700">
                        {m?.name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )
                  })}
                  {confirmedReceipts.length > 6 && (
                    <div className="w-6 h-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-[9px] font-bold text-gray-500">
                      +{confirmedReceipts.length - 6}
                    </div>
                  )}
                </div>
              )}
              <span className="text-[11px] text-gray-400">
                {confirmedReceipts.length}/{detailReceipts.length} {receiptsNeedAction ? 'confirmed' : 'read'}
              </span>
            </div>
          )}
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Delete announcement?" onClose={() => setConfirmDel(null)}
          footer={
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
                onClick={() => { removeAnnouncement(confirmDel.id); setConfirmDel(null) }}>
                Delete
              </button>
            </div>
          }>
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">“{confirmDel.title}”</span> will be removed for
            everyone. Notifications already sent stay in people's inboxes. This can't be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}

const AUDIENCES = [
  { value: 'all',           label: 'Everyone' },
  { value: 'students',      label: 'All Students' },
  { value: 'staff',         label: 'All Staff' },
  { value: 'batches',       label: 'Batches' },
  { value: 'students_list', label: 'Students' },
  { value: 'staff_members', label: 'Staff' },
]

// Which list the checkboxes come from, per audience type
const PICKER = { batches: 'batches', students_list: 'students', staff_members: 'staff' }

function AddAnnouncementModal({ onClose, onSave, staff = [], students = [], batches = [] }) {
  const [form, setForm] = useState({
    title: '', body: '', type: TYPES[4], audienceType: 'all', audienceIds: [],
    eventDate: '', eventEndDate: '', venue: '', flyerUrl: null,
  })
  const [isEvent,   setIsEvent]   = useState(false)
  const [flyerFile, setFlyerFile] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const pickerKind = PICKER[form.audienceType]
  const pickerList = pickerKind === 'batches' ? batches : pickerKind === 'students' ? students : pickerKind === 'staff' ? staff : []
  const toggleId = (id) => setForm(f => ({
    ...f,
    audienceIds: f.audienceIds.some(x => String(x) === String(id))
      ? f.audienceIds.filter(x => String(x) !== String(id))
      : [...f.audienceIds, id],
  }))

  // A "pick specific people" audience with nothing ticked would notify nobody.
  const needsPick = !!pickerKind && form.audienceIds.length === 0
  // An event with no date is just a notice — the date is what makes it one.
  const needsDate = isEvent && !form.eventDate
  const badRange  = isEvent && form.eventEndDate && form.eventEndDate < form.eventDate
  const canSave   = form.title.trim() && !needsPick && !needsDate && !badRange && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      let flyerUrl = null
      if (isEvent && flyerFile) flyerUrl = await db.uploadEventFlyer(flyerFile, form.title)
      // Event fields are stripped unless the toggle is on, so turning it off
      // after typing a date can't post a stray one the feed would then render.
      await onSave({
        ...form,
        eventDate:    isEvent ? form.eventDate            : null,
        eventEndDate: isEvent ? (form.eventEndDate || null) : null,
        venue:        isEvent ? (form.venue || null)        : null,
        flyerUrl:     isEvent ? flyerUrl                    : null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Buttons go in the Modal's pinned footer, not the scrolling body — the
  // audience picker makes this form tall enough that on a phone they'd sit
  // below the fold and the form would look like it had no submit button.
  const footer = (
    <div className="flex justify-end gap-3">
      <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
      <button className="btn-primary disabled:opacity-50" disabled={!canSave} onClick={handleSave}>
        {saving ? <><Loader2 size={14} className="animate-spin" /> Posting…</> : isEvent ? 'Post Event' : 'Post Announcement'}
      </button>
    </div>
  )

  return (
    <Modal title="New Announcement" onClose={onClose} footer={footer}>
      <div className="flex justify-end -mt-1 mb-1">
        <DevFillButton onFill={() => setForm(f => ({ ...f, ...fillAnnouncement() }))} />
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

        {/* Event details — the old Events page, folded in. A notice with a
            date is an event; without one it stays an ordinary notice. */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setIsEvent(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-3.5 py-3 bg-gray-50 hover:bg-gray-100 transition"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Calendar size={14} className="text-brand-600" />
              This is an event
            </span>
            <span className={`relative inline-flex w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${isEvent ? 'bg-brand-600' : 'bg-gray-300'}`}
                  style={{ height: 22, width: 40 }}>
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform mt-1 ${isEvent ? 'translate-x-5' : 'translate-x-1'}`} />
            </span>
          </button>

          {isEvent && (
            <div className="p-3.5 space-y-3 bg-white border-t border-gray-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Date *</label>
                  <input type="date" className="input" value={form.eventDate}
                    onChange={e => set('eventDate', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ends <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                  <input type="date" className="input" value={form.eventEndDate} min={form.eventDate || undefined}
                    onChange={e => set('eventEndDate', e.target.value)} />
                </div>
              </div>
              {badRange && (
                <p className="text-[11px] text-red-600 font-semibold">The end date is before the start date.</p>
              )}
              <div>
                <label className="label">Venue</label>
                <div className="relative">
                  <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8" placeholder="e.g. ARA Ground, SG Highway"
                    value={form.venue} onChange={e => set('venue', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Flyer <span className="normal-case font-normal text-gray-400">(optional)</span></label>
                {!flyerFile ? (
                  <label className="flex items-center justify-center gap-2 py-3 text-xs font-semibold text-gray-500 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition">
                    <Image size={14} /> Choose an image
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => setFlyerFile(e.target.files?.[0] || null)} />
                  </label>
                ) : (
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl">
                    <span className="text-xs text-gray-700 truncate">{flyerFile.name}</span>
                    <button type="button" onClick={() => setFlyerFile(null)} className="flex-shrink-0">
                      <X size={15} className="text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Audience */}
        <div>
          <label className="label">Send to</label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCES.map(a => (
              <button
                key={a.value}
                type="button"
                onClick={() => { set('audienceType', a.value); set('audienceIds', []) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${form.audienceType===a.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {a.label}
              </button>
            ))}
          </div>

          {pickerKind && (
            <div className="mt-3 border border-gray-200 rounded-xl max-h-44 overflow-y-auto divide-y divide-gray-50">
              {pickerList.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  No {pickerKind} in the current sport/branch view
                </p>
              )}
              {pickerList.map(item => {
                const checked = form.audienceIds.some(x => String(x) === String(item.id))
                return (
                  <label key={item.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={checked} onChange={() => toggleId(item.id)} className="accent-brand-600" />
                    <span className="text-sm text-gray-700 flex-1 truncate">{item.name}</span>
                    {pickerKind === 'students' && item.batch && (
                      <span className="text-[10px] text-gray-400">{item.batch}</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}

          <p className="text-[11px] text-gray-500 mt-2">
            {needsPick
              ? `Pick at least one ${pickerKind === 'batches' ? 'batch' : pickerKind === 'students' ? 'student' : 'staff member'}.`
              : 'Only people in your current sport/branch view are notified.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
