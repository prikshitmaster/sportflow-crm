import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { Bell, MessageCircle, Mail, Smartphone, LogOut, Save } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const CHANNELS = [
  { key: 'sms',      label: 'SMS',       icon: Smartphone },
  { key: 'whatsapp', label: 'WhatsApp',  icon: MessageCircle },
  { key: 'email',    label: 'Email',     icon: Mail },
  { key: 'push',     label: 'App push',  icon: Bell },
]

export default function ParentMe() {
  const { parentUser, logoutParent } = useApp()
  const navigate = useNavigate()
  const [prefs, setPrefs] = useState(parentUser?.notification_prefs || { sms: true, whatsapp: true, email: false, push: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (parentUser?.notification_prefs) setPrefs(parentUser.notification_prefs)
  }, [parentUser?.notification_prefs])

  const toggle = (k) => setPrefs(p => ({ ...p, [k]: !p[k] }))

  const save = async () => {
    setSaving(true); setSaved(false)
    try {
      await db.updateParentPrefs(prefs)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const logout = async () => {
    await logoutParent()
    navigate('/parent-login')
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <p className="text-xs text-gray-400">Parent</p>
        <p className="font-bold text-gray-900 text-lg">{parentUser?.name || '—'}</p>
        <p className="text-sm text-gray-500">{parentUser?.phone || ''}</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
        <p className="font-bold text-gray-900 mb-3">Notifications</p>
        <div className="space-y-2">
          {CHANNELS.map(({ key, label, icon: Icon }) => (
            <label key={key} className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="flex items-center gap-3 text-sm text-gray-700">
                <Icon size={16} className="text-gray-400" />
                {label}
              </span>
              <input type="checkbox" checked={!!prefs[key]} onChange={() => toggle(key)}
                className="w-10 h-6 appearance-none bg-gray-200 rounded-full relative cursor-pointer
                           checked:bg-brand-600 transition
                           before:content-[''] before:absolute before:top-0.5 before:left-0.5
                           before:w-5 before:h-5 before:bg-white before:rounded-full before:transition
                           checked:before:translate-x-4" />
            </label>
          ))}
        </div>
        <button onClick={save} disabled={saving}
          className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 bg-brand-600 text-white font-semibold text-sm rounded-xl hover:bg-brand-700 transition disabled:opacity-50">
          <Save size={14} /> {saved ? 'Saved' : saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>

      <button onClick={logout}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 text-red-600 font-semibold text-sm rounded-xl hover:bg-red-50 transition">
        <LogOut size={14} /> Log out
      </button>
    </div>
  )
}
