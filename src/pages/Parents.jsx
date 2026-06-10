// Parents — owner admin page
// Lists every parent in the academy, shows claim status (ready for OTP login
// to the parent app), links to children, and offers quick "Send pay link"
// per child for Razorpay collection.

import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import SendPayLinkModal from '../components/SendPayLinkModal'
import { toLocalDateStr } from '../lib/dates'
import {
  Users, Search, CheckCircle2, AlertCircle, Phone, Mail, X,
  CreditCard, Loader2, Pencil, Unlink, ChevronRight, UserCheck, UserX,
} from 'lucide-react'

function formatINR(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN')
}

export default function Parents() {
  const { showToast, students } = useApp()
  const [loading, setLoading] = useState(true)
  const [parents, setParents] = useState([])
  const [search,  setSearch]  = useState('')
  const [detailId, setDetailId] = useState(null)
  const [payTarget, setPayTarget] = useState(null)   // student row → opens SendPayLinkModal

  const load = async () => {
    try {
      setLoading(true)
      const rows = await db.fetchParents()
      setParents(rows || [])
    } catch (e) {
      showToast(e.message || 'Could not load parents', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return parents
    return parents.filter(p =>
      p.name?.toLowerCase().includes(q) ||
      p.phone?.includes(q) ||
      p.email?.toLowerCase().includes(q)
    )
  }, [parents, search])

  const stats = useMemo(() => ({
    total:    parents.length,
    claimed:  parents.filter(p => p.claimed).length,
    linkedKids: parents.reduce((sum, p) => sum + Number(p.children_count || 0), 0),
  }), [parents])

  return (
    <div className="max-w-5xl mx-auto px-4 py-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-black text-gray-900">Parents</h1>
          <p className="text-sm text-gray-500">Manage parent accounts &amp; payment links</p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <StatCard label="Parents" value={stats.total} icon={Users} tone="brand" />
        <StatCard label="Logged in" value={stats.claimed} icon={UserCheck} tone="emerald"
          subtitle={stats.total ? `${Math.round(stats.claimed / stats.total * 100)}% claimed` : ''} />
        <StatCard label="Linked kids" value={stats.linkedKids} icon={Users} tone="purple" />
      </div>

      {/* Razorpay info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3 mb-4 flex items-start gap-2">
        <CreditCard size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800 leading-relaxed">
          <strong>For Razorpay payments:</strong> parents log in to the parent app with their phone +
          OTP, see their kids, and pay via UPI/card. Or click any child below to send them a one-time pay link.
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Search name, phone, email"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-gray-500">No parents yet</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Parents are auto-created when you add a student with parent name + phone.
            Or run migration 0061 to backfill from existing data.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden">
          {filtered.map(p => (
            <button key={p.id} onClick={() => setDetailId(p.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3 transition">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-sm flex-shrink-0">
                {p.name?.[0]?.toUpperCase() || 'P'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 truncate">{p.name || '—'}</p>
                <p className="text-[11px] text-gray-500 flex items-center gap-1">
                  <Phone size={10} /> {p.phone || '—'}
                  {p.email && <><span className="mx-1">·</span><Mail size={10} /> <span className="truncate">{p.email}</span></>}
                </p>
              </div>
              <div className="text-right flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[10px] font-bold text-gray-500">
                  {p.children_count} {p.children_count === 1 ? 'child' : 'kids'}
                </span>
                {p.claimed
                  ? <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"><CheckCircle2 size={9} /> logged in</span>
                  : <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1"><AlertCircle size={9} /> not yet</span>}
              </div>
              <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}

      {detailId && (
        <ParentDetailModal
          parentId={detailId}
          onClose={() => setDetailId(null)}
          onUpdated={() => { load(); }}
          onSendPayLink={(student) => setPayTarget(student)}
        />
      )}

      {payTarget && (
        <SendPayLinkModal
          students={[payTarget]}
          onClose={() => setPayTarget(null)}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, icon: Icon, tone, subtitle }) {
  const toneCls = {
    brand:   'bg-brand-50 text-brand-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    purple:  'bg-purple-50 text-purple-700',
  }[tone] || 'bg-gray-50 text-gray-700'
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-3">
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-1.5 ${toneCls}`}>
        <Icon size={14} />
      </div>
      <p className="text-lg font-black text-gray-900 leading-tight">{value}</p>
      <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">{label}</p>
      {subtitle && <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function ParentDetailModal({ parentId, onClose, onUpdated, onSendPayLink }) {
  const { showToast } = useApp()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const d = await db.fetchParentDetail(parentId)
      setData(d)
      setForm({ name: d.parent.name || '', phone: d.parent.phone || '', email: d.parent.email || '' })
    } catch (e) {
      showToast(e.message || 'Could not load', 'error')
      onClose()
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [parentId])

  const save = async () => {
    try {
      setSaving(true)
      await db.updateParent(parentId, form)
      showToast('Parent updated', 'success')
      setEditing(false)
      await load()
      onUpdated?.()
    } catch (e) {
      showToast(e.message || 'Update failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const unlink = async (studentId, studentName) => {
    if (!confirm(`Unlink ${studentName} from this parent?`)) return
    try {
      await db.unlinkStudentFromParent(parentId, studentId)
      showToast('Unlinked', 'success')
      await load()
      onUpdated?.()
    } catch (e) {
      showToast(e.message || 'Unlink failed', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Parent details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {loading || !data ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="animate-spin text-brand-600" />
          </div>
        ) : (
          <div className="overflow-y-auto p-5 space-y-4">
            {/* Account claim status */}
            {data.parent.claimed ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 text-emerald-700">
                <CheckCircle2 size={16} />
                <p className="text-xs font-semibold">Logged in — can pay via Razorpay in the parent app</p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 text-amber-800">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-semibold mb-0.5">Hasn't logged in yet</p>
                  <p>Share <code className="bg-amber-100 px-1 rounded">/parent-login</code> with them — they enter this phone, get an OTP, and they're in.</p>
                </div>
              </div>
            )}

            {/* Profile block */}
            <div className="border border-gray-100 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Profile</p>
                {!editing
                  ? <button onClick={() => setEditing(true)} className="text-xs text-brand-700 font-semibold flex items-center gap-1 hover:underline"><Pencil size={11} /> Edit</button>
                  : <button onClick={() => { setEditing(false); setForm({ name: data.parent.name || '', phone: data.parent.phone || '', email: data.parent.email || '' }) }} className="text-xs text-gray-500 hover:underline">Cancel</button>}
              </div>

              {editing ? (
                <>
                  <div>
                    <label className="label">Name</label>
                    <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Phone (10 digits)</label>
                    <input className="input" inputMode="tel" maxLength={10}
                      value={form.phone}
                      onChange={e => setForm(p => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                    <p className="text-[10px] text-amber-600 mt-1">
                      Warning: changing this will require the parent to log in again with the new phone.
                    </p>
                  </div>
                  <div>
                    <label className="label">Email <span className="font-normal text-gray-400">(optional)</span></label>
                    <input className="input" type="email" value={form.email}
                      onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <button onClick={save} disabled={saving || !form.name || form.phone.length !== 10}
                    className="w-full btn-primary justify-center py-2.5">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              ) : (
                <div className="space-y-2 text-sm">
                  <Row label="Name"  value={data.parent.name} />
                  <Row label="Phone" value={data.parent.phone} mono />
                  <Row label="Email" value={data.parent.email || '—'} />
                </div>
              )}
            </div>

            {/* Children + pay link */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Linked children ({data.children.length})
              </p>
              {data.children.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-gray-200 rounded-2xl">
                  <UserX size={20} className="text-gray-300 mx-auto mb-1" />
                  <p className="text-xs text-gray-500">No children linked.</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Edit a student and set their parent name + phone to this parent's phone.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.children.map(c => {
                    const today = toLocalDateStr()
                    const overdue = c.paid_till && c.paid_till < today.slice(0, 7) + '-01'
                    return (
                      <div key={c.id} className="border border-gray-100 rounded-2xl p-3">
                        <div className="flex items-center gap-3">
                          {c.photo_url
                            ? <img src={c.photo_url} alt={c.name} className="w-9 h-9 rounded-full object-cover" />
                            : <div className="w-9 h-9 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-xs font-bold">{c.name?.[0]}</div>}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-900 truncate">{c.name}</p>
                            <p className="text-[11px] text-gray-500">
                              {[c.student_code, c.sport, c.batch].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <button onClick={() => unlink(c.id, c.name)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition"
                            title="Unlink from this parent">
                            <Unlink size={13} />
                          </button>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-3">
                            <span className="text-gray-500">
                              <span className="font-bold text-gray-700">{formatINR(c.fees)}</span>/{(c.fee_plan || 'mo').slice(0, 2)}
                            </span>
                            {c.paid_till && (
                              <span className={overdue ? 'text-red-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                                {overdue ? 'Overdue' : `Paid till ${c.paid_till.slice(0, 7)}`}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => onSendPayLink({
                              id: c.id, name: c.name, fees: c.fees, feePlan: c.fee_plan,
                              studentCode: c.student_code, sport: c.sport, batch: c.batch,
                              parentPhone: data.parent.phone, parent: data.parent.name,
                            })}
                            className="flex items-center gap-1 px-2.5 py-1 bg-brand-50 text-brand-700 rounded-lg font-semibold hover:bg-brand-100 transition">
                            <CreditCard size={11} /> Send pay link
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
