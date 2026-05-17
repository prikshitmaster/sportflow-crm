import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import {
  Building, Bell, MessageCircle, Shield, CreditCard, Check, ToggleLeft, Key,
  Database, Upload, FileJson, AlertTriangle, Loader2, CheckCircle2, X,
} from 'lucide-react'
import { parseImportFile, importSportData } from '../lib/exportImport'

const tabs = [
  { id: 'academy',       label: 'Academy Profile', icon: Building },
  { id: 'features',      label: 'Features',        icon: ToggleLeft },
  { id: 'fees',          label: 'Fee Plans',        icon: CreditCard },
  { id: 'notifications', label: 'Notifications',    icon: Bell },
  { id: 'whatsapp',      label: 'WhatsApp',         icon: MessageCircle },
  { id: 'security',      label: 'Security',         icon: Shield },
  { id: 'data',          label: 'Data',             icon: Database },
]

export default function Settings() {
  const { user, showToast, allStudents } = useApp()
  const [activeTab, setActiveTab] = useState('academy')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    showToast('Settings saved')
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h2 className="text-xl font-black text-gray-900">Settings</h2>
        <p className="text-sm text-gray-500">Manage your academy preferences</p>
      </div>

      <div className="flex gap-6 flex-col md:flex-row">
        {/* Sidebar tabs — horizontal scroll on mobile */}
        <div className="md:w-48 flex-shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 flex-shrink-0 md:flex-shrink px-3 py-2.5 rounded-xl text-sm font-medium text-left transition whitespace-nowrap ${activeTab === t.id ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <t.icon size={16} className={activeTab === t.id ? 'text-brand-600' : 'text-gray-400'} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content panel */}
        <div className="flex-1 card p-6">
          {activeTab === 'academy'       && <AcademyTab user={user} onSave={handleSave} saved={saved} />}
          {activeTab === 'features'      && <FeaturesTab />}
          {activeTab === 'fees'          && <FeePlansTab onSave={handleSave} saved={saved} />}
          {activeTab === 'notifications' && <NotificationsTab onSave={handleSave} saved={saved} />}
          {activeTab === 'whatsapp'      && <WhatsAppTab onSave={handleSave} saved={saved} />}
          {activeTab === 'security'      && <SecurityTab onSave={handleSave} saved={saved} />}
          {activeTab === 'data'          && <DataTab user={user} allStudents={allStudents} showToast={showToast} />}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, desc }) {
  return (
    <div className="mb-6 pb-4 border-b border-gray-100">
      <h3 className="font-bold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
    </div>
  )
}

function SaveButton({ onSave, saved }) {
  return (
    <div className="mt-6 pt-5 border-t border-gray-100 flex justify-end">
      <button className="btn-primary" onClick={onSave}>
        {saved ? <><Check size={15} /> Saved!</> : 'Save Changes'}
      </button>
    </div>
  )
}

function AcademyTab({ user, onSave, saved }) {
  const { saveAcademyLogo } = useApp()
  const [form, setForm] = useState({
    name: user?.academy || 'Champions Sports Academy',
    owner: user?.name || 'Vikram Mehta',
    phone: '9876543210',
    email: user?.email || 'admin@championsacademy.in',
    address: 'Plot 14, Sector 7, Kharghar, Navi Mumbai – 410210',
    city: 'Navi Mumbai',
    state: 'Maharashtra',
    gstin: '27AADCC1234A1ZV',
  })
  const [logoPreview, setLogoPreview] = useState(user?.academyLogo || null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoPreview(URL.createObjectURL(file))
    setLogoUploading(true)
    try { await saveAcademyLogo(file) } finally { setLogoUploading(false) }
  }

  return (
    <div>
      <SectionHeader title="Academy Profile" desc="Basic information about your sports academy" />

      {/* Logo upload */}
      <div className="mb-6 flex items-center gap-4">
        <div
          onClick={() => logoRef.current?.click()}
          className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center overflow-hidden cursor-pointer hover:ring-2 hover:ring-brand-400 transition flex-shrink-0"
        >
          {logoPreview
            ? <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
            : <span className="text-2xl font-black text-white">{(user?.academy || 'S')[0]}</span>
          }
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Academy Logo</p>
          <p className="text-xs text-gray-400 mb-2">Shown in the header on all portals</p>
          <button
            onClick={() => logoRef.current?.click()}
            disabled={logoUploading}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            <Upload size={13} />
            {logoUploading ? 'Uploading…' : logoPreview ? 'Change Logo' : 'Upload Logo'}
          </button>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Academy Name</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Owner / Admin Name</label>
          <input className="input" value={form.owner} onChange={e => set('owner', e.target.value)} />
        </div>
        <div>
          <label className="label">Contact Phone</label>
          <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Email Address</label>
          <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Address</label>
          <textarea className="input resize-none" rows={2} value={form.address} onChange={e => set('address', e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city} onChange={e => set('city', e.target.value)} />
        </div>
        <div>
          <label className="label">State</label>
          <input className="input" value={form.state} onChange={e => set('state', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">GSTIN (optional)</label>
          <input className="input" placeholder="For invoices" value={form.gstin} onChange={e => set('gstin', e.target.value)} />
        </div>
      </div>
      <SaveButton onSave={onSave} saved={saved} />
    </div>
  )
}

const TT_COLOR = { daily: 'bg-purple-100 text-purple-700', alternate: 'bg-blue-100 text-blue-700' }
const TT_LABEL = { daily: 'Daily', alternate: 'Alternate Day' }

const BLANK_PLAN = { name: '', trainingType: 'daily', monthlyFee: 0, quarterlyFee: 0, yearlyFee: 0 }

function FeePlansTab({ onSave, saved }) {
  // Use `batches` (scope-filtered by current sport + branch) instead of allBatches
  // so the Fee Plans tab only shows batches — and therefore plans — in the
  // currently-selected sport/branch. Fee plans inherit scope via their batch_id.
  const { suspendAfterDays, updateSuspendAfterDays, batches: allBatches, feePlans, addFeePlan, editFeePlan, removeFeePlan } = useApp()
  const [adding,  setAdding]  = useState({})   // batchId → form state
  const [editing, setEditing] = useState({})   // planId  → form state
  const [dueDay,  setDueDay]  = useState('10')
  const [lateFee, setLateFee] = useState('200')

  const startAdd  = (batchId) => setAdding(prev => ({ ...prev, [batchId]: { ...BLANK_PLAN } }))
  const cancelAdd = (batchId) => setAdding(prev => { const n = { ...prev }; delete n[batchId]; return n })
  const saveAdd   = async (batchId) => {
    const f = adding[batchId]
    if (!f?.name.trim()) return
    await addFeePlan({ ...f, batchId })
    cancelAdd(batchId)
  }

  const startEdit  = (p) => setEditing(prev => ({ ...prev, [p.id]: { name: p.name, trainingType: p.trainingType, monthlyFee: p.monthlyFee, quarterlyFee: p.quarterlyFee, yearlyFee: p.yearlyFee } }))
  const cancelEdit = (id) => setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  const saveEdit   = async (id) => { await editFeePlan(id, editing[id]); cancelEdit(id) }

  const setAddField  = (batchId, k, v) => setAdding(prev => ({ ...prev, [batchId]: { ...prev[batchId], [k]: v } }))
  const setEditField = (id, k, v)      => setEditing(prev => ({ ...prev, [id]: { ...prev[id], [k]: v } }))

  return (
    <div>
      <SectionHeader title="Fee Plans" desc="Create plans per batch — each plan has Daily or Alternate training with monthly, quarterly and yearly rates." />

      {allBatches.length === 0 ? (
        <p className="text-sm text-gray-400 mb-6">No batches yet — create batches first.</p>
      ) : (
        <div className="space-y-5 mb-6">
          {allBatches.map(b => {
            const batchPlans = feePlans.filter(p => p.batchId === b.id)
            const addForm    = adding[b.id]
            return (
              <div key={b.id} className="border border-gray-200 rounded-xl overflow-hidden">
                {/* Batch header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <p className="text-sm font-bold text-gray-800">{b.name}</p>
                  {!addForm && (
                    <button onClick={() => startAdd(b.id)}
                      className="text-xs text-brand-600 font-semibold hover:underline flex items-center gap-1">
                      + Add Plan
                    </button>
                  )}
                </div>

                {/* Existing plans */}
                <div className="divide-y divide-gray-50">
                  {batchPlans.map(p => {
                    const ef = editing[p.id]
                    return (
                      <div key={p.id} className="px-4 py-3">
                        {ef ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="label text-[11px]">Plan Name</label>
                                <input className="input py-1.5 text-sm" value={ef.name}
                                  onChange={e => setEditField(p.id, 'name', e.target.value)} />
                              </div>
                              <div>
                                <label className="label text-[11px]">Training Type</label>
                                <div className="flex gap-2 mt-1">
                                  {['daily','alternate'].map(t => (
                                    <button key={t} type="button" onClick={() => setEditField(p.id, 'trainingType', t)}
                                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${ef.trainingType === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                                      {TT_LABEL[t]}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              {[['monthlyFee','Monthly'],['quarterlyFee','Quarterly'],['yearlyFee','Yearly']].map(([k, lbl]) => (
                                <div key={k}>
                                  <label className="label text-[11px]">{lbl} (₹)</label>
                                  <input className="input py-1.5 text-sm" type="number" min={0}
                                    value={ef[k]} onChange={e => setEditField(p.id, k, Number(e.target.value))} />
                                </div>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button className="btn-primary text-xs py-1.5 px-3" onClick={() => saveEdit(p.id)}>Save</button>
                              <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => cancelEdit(p.id)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TT_COLOR[p.trainingType] || TT_COLOR.daily}`}>
                                  {TT_LABEL[p.trainingType] || p.trainingType}
                                </span>
                                <span className="text-sm font-semibold text-gray-800">{p.name}</span>
                              </div>
                              <div className="flex gap-3 text-xs text-gray-500">
                                <span>Monthly: <strong className="text-gray-800">₹{p.monthlyFee.toLocaleString('en-IN')}</strong></span>
                                <span>Quarterly: <strong className="text-gray-800">₹{p.quarterlyFee.toLocaleString('en-IN')}</strong></span>
                                <span>Yearly: <strong className="text-gray-800">₹{p.yearlyFee.toLocaleString('en-IN')}</strong></span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <button onClick={() => startEdit(p)} className="text-xs text-brand-600 font-semibold hover:underline">Edit</button>
                              <button onClick={() => { if (window.confirm(`Delete "${p.name}"?`)) removeFeePlan(p.id) }}
                                className="text-xs text-red-400 hover:text-red-600 font-semibold hover:underline">Delete</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {batchPlans.length === 0 && !addForm && (
                    <p className="px-4 py-3 text-xs text-gray-400">No plans yet — click Add Plan to create one.</p>
                  )}
                </div>

                {/* Add plan form */}
                {addForm && (
                  <div className="px-4 py-3 bg-brand-50/40 border-t border-brand-100 space-y-2">
                    <p className="text-xs font-bold text-brand-700">New Plan</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label text-[11px]">Plan Name *</label>
                        <input className="input py-1.5 text-sm" placeholder="e.g. Daily Plan"
                          value={addForm.name} onChange={e => setAddField(b.id, 'name', e.target.value)} />
                      </div>
                      <div>
                        <label className="label text-[11px]">Training Type</label>
                        <div className="flex gap-2 mt-1">
                          {['daily','alternate'].map(t => (
                            <button key={t} type="button" onClick={() => setAddField(b.id, 'trainingType', t)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition ${addForm.trainingType === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                              {TT_LABEL[t]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[['monthlyFee','Monthly'],['quarterlyFee','Quarterly'],['yearlyFee','Yearly']].map(([k, lbl]) => (
                        <div key={k}>
                          <label className="label text-[11px]">{lbl} (₹)</label>
                          <input className="input py-1.5 text-sm" type="number" min={0}
                            value={addForm[k]} onChange={e => setAddField(b.id, k, Number(e.target.value))} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary text-xs py-1.5 px-3" onClick={() => saveAdd(b.id)}>Add Plan</button>
                      <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => cancelAdd(b.id)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Fee Due Day (each month)</label>
          <input className="input" type="number" min={1} max={28} value={dueDay} onChange={e => setDueDay(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">Reminders sent 3 days before</p>
        </div>
        <div>
          <label className="label">Late Fee (₹ per month)</label>
          <input className="input" type="number" value={lateFee} onChange={e => setLateFee(e.target.value)} />
        </div>
      </div>

      {/* Auto-suspend grace period */}
      <div className="mt-6 pt-5 border-t border-gray-100">
        <label className="label">Auto-Suspend After (days overdue)</label>
        <p className="text-xs text-gray-400 mb-3">Students are automatically suspended this many days after their Paid Till date passes.</p>
        <div className="flex flex-wrap gap-2">
          {[1, 3, 5, 7, 10, 15, 30].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => updateSuspendAfterDays(n)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition ${
                suspendAfterDays === n
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {n} day{n !== 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-600 font-semibold mt-2">
          Currently: suspend after <strong>{suspendAfterDays} day{suspendAfterDays !== 1 ? 's' : ''}</strong>
        </p>
      </div>

      <SaveButton onSave={onSave} saved={saved} />
    </div>
  )
}

function Toggle({ label, desc, defaultChecked }) {
  const [checked, setChecked] = useState(defaultChecked)
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-700">{label}</p>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
      <button
        onClick={() => setChecked(c => !c)}
        className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-gray-200'}`}
      >
        <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform mt-1 ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  )
}

function NotificationsTab({ onSave, saved }) {
  return (
    <div>
      <SectionHeader title="Notifications" desc="Control when and how alerts are sent" />
      <div>
        <Toggle label="Fee Due Reminders" desc="3 days before due date" defaultChecked={true} />
        <Toggle label="Overdue Alerts" desc="After due date passes" defaultChecked={true} />
        <Toggle label="Trial Follow-up Reminders" desc="Day before scheduled trial" defaultChecked={true} />
        <Toggle label="Attendance Absence Alert" desc="When student is absent 3 days in a row" defaultChecked={false} />
        <Toggle label="Monthly Revenue Summary" desc="Sent on 1st of every month" defaultChecked={true} />
        <Toggle label="New Student Registration" desc="Alert when a new student is added" defaultChecked={true} />
      </div>
      <SaveButton onSave={onSave} saved={saved} />
    </div>
  )
}

function WhatsAppTab({ onSave, saved }) {
  const [connected, setConnected] = useState(false)
  const [phone, setPhone] = useState('')

  return (
    <div>
      <SectionHeader title="WhatsApp Integration" desc="Connect your WhatsApp Business number to send automatic messages" />
      <div className={`p-4 rounded-xl border-2 mb-6 ${connected ? 'border-emerald-200 bg-emerald-50' : 'border-dashed border-gray-200'}`}>
        {connected ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
              <MessageCircle size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-emerald-700 text-sm">WhatsApp Connected</p>
              <p className="text-xs text-emerald-600">{phone} · Active</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MessageCircle size={22} className="text-green-600" />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Connect WhatsApp Business</p>
            <p className="text-xs text-gray-500 mb-4">Auto-send fee reminders, trial confirmations and updates</p>
            <div className="flex gap-2 max-w-xs mx-auto">
              <input className="input flex-1" placeholder="+91 98765 43210" value={phone} onChange={e => setPhone(e.target.value)} />
              <button className="bg-green-500 hover:bg-green-600 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition" onClick={() => phone && setConnected(true)}>
                Connect
              </button>
            </div>
          </div>
        )}
      </div>

      <h4 className="text-sm font-bold text-gray-700 mb-3">Message Templates</h4>
      {[
        { name: 'Fee Reminder', template: 'Dear {parent_name}, fees of ₹{amount} for {student_name} are due on {due_date}. Pay via UPI: {upi_id}' },
        { name: 'Trial Confirmation', template: 'Hi {parent_name}, {student_name}\'s trial session is scheduled for {trial_date} at {time}. See you at the academy!' },
        { name: 'Overdue Alert', template: 'Dear {parent_name}, fees of ₹{amount} for {student_name} are overdue. Please clear dues to avoid suspension.' },
      ].map(t => (
        <div key={t.name} className="mb-3">
          <label className="label">{t.name}</label>
          <textarea className="input resize-none text-xs" rows={2} defaultValue={t.template} />
        </div>
      ))}
      <SaveButton onSave={onSave} saved={saved} />
    </div>
  )
}

// ── Features Tab (owner only) ──────────────────────────────
// Each toggle calls AppContext.toggleFeature() which saves to DB immediately
function FeaturesTab() {
  const { features, toggleFeature, user } = useApp()

  const FEATURE_LIST = [
    { key: 'attendance', label: 'Attendance',        desc: 'Mark and track daily attendance' },
    { key: 'payments',   label: 'Payments & Fees',   desc: 'Fee tracking, invoices, receipts' },
    { key: 'trials',     label: 'Trial Management',  desc: 'Capture trial leads and track conversion' },
    { key: 'batches',    label: 'Batch Management',  desc: 'Create and manage sport batches' },
    { key: 'staff',      label: 'Staff & HR',        desc: 'Coach profiles and salary tracking' },
    { key: 'reports',    label: 'Reports',           desc: 'Financial and attendance reports' },
    { key: 'community',  label: 'Community',         desc: 'Notices, announcements, holidays' },
    { key: 'events',     label: 'Events & Tournaments', desc: 'Manage upcoming events' },
    { key: 'gate_qr',    label: 'Gate QR Attendance', desc: 'QR code-based entry attendance' },
  ]

  return (
    <div>
      <SectionHeader
        title="Feature Toggles"
        desc="Enable or disable modules for your entire academy. Staff will only see enabled features."
      />

      {/* Academy join code — staff use this to sign up */}
      {user?.joinCode && (
        <div className="flex items-center justify-between p-4 bg-brand-50 border border-brand-100 rounded-xl mb-6">
          <div>
            <p className="text-xs font-semibold text-brand-800 uppercase tracking-wide">Academy Join Code</p>
            <p className="text-xs text-brand-600 mt-0.5">Share this with staff so they can sign up</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-black text-brand-700 tracking-widest">{user.joinCode}</span>
            <button
              onClick={() => navigator.clipboard?.writeText(user.joinCode)}
              className="text-xs text-brand-600 hover:underline font-semibold"
            >Copy</button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {FEATURE_LIST.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between py-3.5 border-b border-gray-50 last:border-0">
            <div>
              <p className="text-sm font-semibold text-gray-700">{label}</p>
              <p className="text-xs text-gray-400">{desc}</p>
            </div>
            {/* Toggle — calls DB immediately on click */}
            <button
              onClick={() => toggleFeature(key, features[key] === false ? true : false)}
              className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                features[key] !== false ? 'bg-brand-600' : 'bg-gray-200'
              }`}
            >
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform mt-1 ${
                features[key] !== false ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function SecurityTab({ onSave, saved }) {
  return (
    <div>
      <SectionHeader title="Security" desc="Manage account security and access" />
      <div className="space-y-4">
        <div>
          <label className="label">Current Password</label>
          <input className="input" type="password" placeholder="••••••••" />
        </div>
        <div>
          <label className="label">New Password</label>
          <input className="input" type="password" placeholder="Min. 8 characters" />
        </div>
        <div>
          <label className="label">Confirm New Password</label>
          <input className="input" type="password" placeholder="Repeat new password" />
        </div>
        <div className="p-4 bg-gray-50 rounded-xl mt-4">
          <Toggle label="Two-Factor Authentication" desc="Require OTP on login" defaultChecked={false} />
        </div>
      </div>
      <SaveButton onSave={onSave} saved={saved} />
    </div>
  )
}

// ── Data Tab — Import sport backup ────────────────────────
function DataTab({ user, allStudents, showToast }) {
  const fileRef = useRef(null)
  const [preview,    setPreview]    = useState(null)   // parsed JSON data
  const [importing,  setImporting]  = useState(false)
  const [results,    setResults]    = useState(null)   // import results
  const [dragOver,   setDragOver]   = useState(false)

  const handleFile = async (file) => {
    if (!file) return
    try {
      const data = await parseImportFile(file)
      setPreview(data)
      setResults(null)
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.json')) handleFile(file)
    else showToast('Please drop a JSON backup file', 'error')
  }

  const handleImport = async () => {
    if (!preview) return
    setImporting(true)
    try {
      const existingCodes = new Set(allStudents.map(s => s.student_code).filter(Boolean))
      const res = await importSportData(preview, user?.academy_id || null, existingCodes)
      setResults(res)
      setPreview(null)
      if (res.errors.length === 0) {
        showToast(`Import done — ${res.created} students added`, 'success')
      } else {
        showToast(`Import finished with ${res.errors.length} error(s)`, 'info')
      }
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  const reset = () => { setPreview(null); setResults(null) }

  return (
    <div>
      <SectionHeader
        title="Data Import"
        desc="Restore a sport backup file (.json) exported from this or another SportFlow academy."
      />

      {/* Results panel */}
      {results && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <p className="text-sm font-bold text-emerald-800">Import Complete</p>
            </div>
            <button onClick={reset} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-lg font-black text-emerald-700">{results.created}</p>
              <p className="text-[11px] text-gray-500">Students added</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className="text-lg font-black text-gray-500">{results.skipped}</p>
              <p className="text-[11px] text-gray-500">Skipped (exists)</p>
            </div>
            <div className="bg-white rounded-lg p-3 text-center">
              <p className={`text-lg font-black ${results.errors.length ? 'text-red-600' : 'text-gray-400'}`}>
                {results.errors.length}
              </p>
              <p className="text-[11px] text-gray-500">Errors</p>
            </div>
          </div>
          {results.errors.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3">
              <p className="text-[11px] font-bold text-red-700 mb-1">Errors</p>
              {results.errors.map((e, i) => (
                <p key={i} className="text-[11px] text-red-600">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drop zone */}
      {!preview && !results && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition ${
            dragOver
              ? 'border-brand-400 bg-brand-50'
              : 'border-gray-200 hover:border-brand-300 hover:bg-brand-50/40'
          }`}
        >
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Upload size={22} className="text-gray-400" />
          </div>
          <p className="text-sm font-bold text-gray-700 mb-1">Drop backup file here</p>
          <p className="text-xs text-gray-400">JSON backup exported from SportFlow (.json)</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>
      )}

      {/* Preview panel */}
      {preview && (
        <div className="border border-brand-200 bg-brand-50/30 rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileJson size={18} className="text-brand-600" />
              <div>
                <p className="text-sm font-black text-gray-900">{preview.sport} Backup</p>
                <p className="text-[11px] text-gray-500">
                  Exported {new Date(preview.exported_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
            <button onClick={reset} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={14} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Students',  value: preview.students?.length  || 0 },
              { label: 'Payments',  value: preview.payments?.length  || 0 },
              { label: 'Batches',   value: preview.batches?.length   || 0 },
              { label: 'Trials',    value: preview.trials?.length    || 0 },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-xl p-3 text-center border border-gray-100">
                <p className="text-lg font-black text-gray-900">{value}</p>
                <p className="text-[11px] text-gray-500">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3 mb-5">
            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-700 leading-snug">
              Students with codes that already exist will be skipped. All other data will be imported fresh.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl transition"
            >
              {importing
                ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                : `Import ${preview.sport} Data`}
            </button>
            <button
              onClick={reset}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold rounded-xl transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
