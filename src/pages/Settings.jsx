import { useState, useRef, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import {
  Building, Bell, MessageCircle, Shield, CreditCard, Check, ToggleLeft, Key,
  Database, Upload, FileJson, AlertTriangle, Loader2, CheckCircle2, X, Wand2, Link2,
} from 'lucide-react'
import { parseImportFile, importSportData } from '../lib/exportImport'
import DevFillButton, { setDemoMode, isDemoModeEnabled } from '../components/DevFillButton'
import { fillFeePlan } from '../lib/devFill'

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
          {activeTab === 'academy'       && <AcademyTab user={user} />}
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

function SaveButton({ onSave, saved, busy }) {
  return (
    <div className="mt-6 pt-5 border-t border-gray-100 flex justify-end">
      <button className="btn-primary disabled:opacity-60" onClick={onSave} disabled={busy}>
        {busy ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : saved ? <><Check size={15} /> Saved!</>
              : 'Save Changes'}
      </button>
    </div>
  )
}

function AcademyTab({ user }) {
  const { saveAcademyLogo, fetchAcademyProfile, saveAcademyProfile, showToast } = useApp()
  // Seeded from the session (name/owner/email are already in `user`), then
  // overwritten by the real row once it loads. Everything else starts blank —
  // this form used to ship hardcoded demo values ('Plot 14, Sector 7,
  // Kharghar…', a fake GSTIN) that read as though they were the academy's own.
  const [form, setForm] = useState({
    name:  user?.academy || '',
    owner: user?.name    || '',
    email: user?.email   || '',
    phone: '', address: '', city: '', state: '', gstin: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [logoPreview, setLogoPreview] = useState(user?.academyLogo || null)
  const [logoUploading, setLogoUploading] = useState(false)
  const logoRef = useRef(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    let alive = true
    fetchAcademyProfile()
      .then(p => {
        if (!alive) return
        setForm(f => ({
          ...f,
          name:  p.name || f.name,
          phone: p.contactPhone,
          // Falls back to the owner's login address so receipts have something
          // to print before anyone sets a dedicated contact address.
          email: p.contactEmail || f.email,
          address: p.address, city: p.city, state: p.state, gstin: p.gstin,
        }))
      })
      .catch(err => showToast(err?.message || 'Could not load academy profile', 'error'))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveAcademyProfile({
        name: form.name, owner: form.owner,
        contactPhone: form.phone, contactEmail: form.email,
        address: form.address, city: form.city, state: form.state, gstin: form.gstin,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      // The GSTIN CHECK from 0152 is the one a typo realistically trips, and
      // Postgres reports it by constraint name — translate before showing it.
      const msg = /academies_gstin_format/.test(err?.message || '')
        ? 'That GSTIN is not valid. It should be 15 characters, like 27AADCC1234A1ZV.'
        : (err?.message || 'Could not save academy profile')
      showToast(msg, 'error')
    } finally { setSaving(false) }
  }

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
          <label className="label">Contact Email</label>
          <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">Shown on receipts. Separate from your login email, which stays {user?.email}.</p>
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
      <SaveButton onSave={handleSave} saved={saved} busy={saving || loading} />

      <PublicRegistrationLinkSection />
    </div>
  )
}

// Slugify a suggestion from the academy name — a starting point the owner
// must confirm/edit, never auto-saved. Auto-saving a naive slugify risks
// silent collisions (this exact platform has two differently-cased
// academies named "ARA"/"ara" today).
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function PublicRegistrationLinkSection() {
  const { user, fetchOwnAcademyBranding, saveAcademyBranding } = useApp()
  const [loaded, setLoaded] = useState(false)
  const [slug, setSlug] = useState('')
  const [brandColor, setBrandColor] = useState('#1B4332')
  const [appDisplayName, setAppDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlag, setSavedFlag] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchOwnAcademyBranding().then(b => {
      if (cancelled) return
      setSlug(b.slug || slugify(user?.academy))
      setBrandColor(COLOR_PATTERN.test(b.brandColor) ? b.brandColor : '#1B4332')
      setAppDisplayName(b.appDisplayName || '')
      setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slugValid = slug === '' || SLUG_PATTERN.test(slug)

  const submit = async () => {
    if (!SLUG_PATTERN.test(slug)) {
      setErr('URL must be 3-50 characters: lowercase letters, numbers, and hyphens only')
      return
    }
    setSaving(true); setErr('')
    try {
      await saveAcademyBranding({ slug, brandColor, appDisplayName: appDisplayName.trim() || null })
      setSavedFlag(true)
      setTimeout(() => setSavedFlag(false), 2000)
    } catch (e) {
      if (e?.code === '23505') setErr('That URL is already taken by another academy — try a different one.')
      else setErr(e?.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="mt-8 pt-6 border-t border-gray-100">
      <div className="flex items-center gap-2 mb-1">
        <Link2 size={15} className="text-brand-600" />
        <h4 className="font-bold text-gray-900 text-sm">Public Registration Link</h4>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Students can self-register for a trial at this link — pick your own web address and brand color.
      </p>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg mb-3">{err}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="label">Registration URL</label>
          <div className="flex items-center">
            <span className="text-xs text-gray-400 bg-gray-50 border border-r-0 border-gray-200 rounded-l-lg px-3 py-2.5 whitespace-nowrap">
              khelit.com/join/
            </span>
            <input
              className={`input rounded-l-none flex-1 ${!slugValid ? 'border-red-400' : ''}`}
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())}
              placeholder="your-academy-name"
            />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Changing this after your Android app is published will require a new app build.
          </p>
        </div>
        <div>
          <label className="label">Brand Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
            <input className="input flex-1 font-mono text-sm" value={brandColor}
              onChange={e => setBrandColor(e.target.value)} placeholder="#1B4332" />
          </div>
        </div>
        <div>
          <label className="label">App Display Name <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" value={appDisplayName} onChange={e => setAppDisplayName(e.target.value)}
            placeholder={user?.academy} />
          <p className="text-[11px] text-gray-400 mt-1">Shown to students on the registration page.</p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={submit} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : savedFlag ? <><Check size={15} /> Saved!</> : 'Save Link Settings'}
        </button>
      </div>
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
  const { suspendAfterDays, updateSuspendAfterDays, batches: allBatches, feePlans, addFeePlan, editFeePlan, removeFeePlan, hasPermission } = useApp()
  const canManage = hasPermission('settings.manage')
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
                  {!addForm && canManage && (
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
                            {canManage && (
                              <div className="flex items-center gap-3">
                                <button onClick={() => startEdit(p)} className="text-xs text-brand-600 font-semibold hover:underline">Edit</button>
                                <button onClick={() => { if (window.confirm(`Delete "${p.name}"?`)) removeFeePlan(p.id) }}
                                  className="text-xs text-red-400 hover:text-red-600 font-semibold hover:underline">Delete</button>
                              </div>
                            )}
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
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-brand-700">New Plan</p>
                      <DevFillButton onFill={() => setAdding(prev => ({ ...prev, [b.id]: { ...prev[b.id], ...fillFeePlan() } }))} />
                    </div>
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
    { key: 'training',   label: 'Training',           desc: 'Sessions, drills and training planner' },
    { key: 'backups',    label: 'Backups',             desc: 'Data backup and restore' },
    { key: 'student_code_login', label: 'Student Direct Login', desc: 'Students log in with their own Student ID + Join Code' },
    { key: 'family_login',       label: 'Family (Parent) Login', desc: 'Parents log in with just their phone number and pick a child — supports siblings under one number' },
    { key: 'join_batch_choice',  label: 'Batch Choice on Registration', desc: 'Public /join form lets the student pick a batch — turn off to skip that step and assign batches yourself' },
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
      // Context students are camelCase (db.js maps student_code → studentCode);
      // reading s.student_code here produced a Set of undefined, so the
      // "already exists" pre-check never skipped anything.
      const existingCodes = new Set(
        allStudents.map(s => s.studentCode ?? s.student_code).filter(Boolean)
      )
      // Likewise the user object exposes academyId, not academy_id — with the
      // wrong key this passed null and every imported student was written with
      // a NULL academy_id, leaving the rows invisible to the app.
      const res = await importSportData(preview, user?.academyId || null, existingCodes)
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
        desc="Restore a sport backup file (.json) exported from this or another Khelit academy."
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
          <p className="text-xs text-gray-400">JSON backup exported from Khelit (.json)</p>
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

      <div className="mt-8 pt-6 border-t border-gray-100">
        <DemoFillSection />
      </div>
    </div>
  )
}

function DemoFillSection() {
  const [enabled, setEnabled] = useState(() => isDemoModeEnabled())

  const toggle = () => {
    const next = !enabled
    setDemoMode(next)
    setEnabled(next)
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Wand2 size={15} className="text-amber-500" />
        <h3 className="font-bold text-gray-900 text-sm">Demo Fill Mode</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4 max-w-md">
        Shows a "Fill Demo" button on every Add form (students, batches, staff, payments, events...)
        that fills it with random test data in one click. Turn off once you're done testing.
      </p>
      <button
        onClick={toggle}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm font-semibold transition ${
          enabled ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-500'
        }`}
      >
        <span className={`relative w-9 h-5 rounded-full transition ${enabled ? 'bg-amber-500' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </span>
        {enabled ? 'Enabled — Fill Demo buttons visible' : 'Disabled — click to enable'}
      </button>
    </div>
  )
}
