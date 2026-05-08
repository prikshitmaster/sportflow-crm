import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { Building, Bell, MessageCircle, Shield, CreditCard, Check, ToggleLeft, Key } from 'lucide-react'

const tabs = [
  { id: 'academy',       label: 'Academy Profile', icon: Building },
  { id: 'features',      label: 'Features',        icon: ToggleLeft },
  { id: 'fees',          label: 'Fee Plans',        icon: CreditCard },
  { id: 'notifications', label: 'Notifications',    icon: Bell },
  { id: 'whatsapp',      label: 'WhatsApp',         icon: MessageCircle },
  { id: 'security',      label: 'Security',         icon: Shield },
]

export default function Settings() {
  const { user, showToast } = useApp()
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
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div>
      <SectionHeader title="Academy Profile" desc="Basic information about your sports academy" />
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

function FeePlansTab({ onSave, saved }) {
  const [plans] = useState([
    { name: 'Cricket / Football', amount: 2500 },
    { name: 'Dance / Martial Arts', amount: 2200 },
    { name: 'Badminton / Basketball', amount: 1800 },
    { name: 'Tennis', amount: 3000 },
    { name: 'Swimming (new)', amount: 3500 },
  ])
  const [dueDay, setDueDay] = useState('10')
  const [lateFee, setLateFee] = useState('200')

  return (
    <div>
      <SectionHeader title="Fee Plans" desc="Set monthly fee amounts per sport category" />
      <div className="space-y-3 mb-6">
        {plans.map(p => (
          <div key={p.name} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <span className="text-sm font-medium text-gray-700">{p.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">₹</span>
              <input
                className="w-20 input text-right py-1.5"
                defaultValue={p.amount}
              />
            </div>
          </div>
        ))}
      </div>
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
