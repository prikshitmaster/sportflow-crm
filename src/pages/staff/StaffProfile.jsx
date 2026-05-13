import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, UserCircle, ChevronRight, Camera, Pencil, Check, X, FileText, ExternalLink } from 'lucide-react'

export default function StaffProfile() {
  const { user, logoutStaff, updateStaffProfile, leaveRequests, loadLeaveRequests } = useApp()
  useEffect(() => { loadLeaveRequests() }, [])
  const navigate = useNavigate()
  const photoRef   = useRef(null)
  const licenceRef = useRef(null)

  const [editing,       setEditing]       = useState(false)
  const [name,          setName]          = useState(user?.name  || '')
  const [phone,         setPhone]         = useState(user?.phone || '')
  const [age,           setAge]           = useState(user?.age   || '')
  const [photoPreview,  setPhotoPreview]  = useState(null)
  const [photoFile,     setPhotoFile]     = useState(null)
  const [licenceFile,   setLicenceFile]   = useState(null)
  const [licenceName,   setLicenceName]   = useState('')
  const [saving,        setSaving]        = useState(false)
  const [saveError,     setSaveError]     = useState('')

  const isFieldStaff = user?.staffType !== 'office'
  const approvedLeaves = (leaveRequests || []).filter(r => r.status === 'Approved').length
  const rejectedLeaves = (leaveRequests || []).filter(r => r.status === 'Rejected').length

  const handlePhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleLicence = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLicenceFile(file)
    setLicenceName(file.name)
  }

  const handleSave = async () => {
    if (!name.trim()) { setSaveError('Name is required'); return }
    setSaving(true); setSaveError('')
    try {
      await updateStaffProfile({
        name:        name.trim(),
        phone:       phone.trim(),
        photoFile,
        age:         age ? Number(age) : null,
        licenceFile: isFieldStaff ? licenceFile : undefined,
      })
      setEditing(false)
      setPhotoFile(null)
      setPhotoPreview(null)
      setLicenceFile(null)
      setLicenceName('')
    } catch (err) {
      setSaveError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setName(user?.name  || '')
    setPhone(user?.phone || '')
    setAge(user?.age    || '')
    setPhotoFile(null); setPhotoPreview(null)
    setLicenceFile(null); setLicenceName('')
    setSaveError('')
  }

  const handleLogout = async () => {
    await logoutStaff()
    navigate('/login')
  }

  const currentPhoto = photoPreview || user?.photoUrl
  const typeLabel = isFieldStaff ? 'Field Staff / Coach' : 'Office Staff'

  return (
    <div className="px-4 pt-5 pb-4 space-y-4">

      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        {!editing ? (
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt={user.name} className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center text-2xl font-black text-brand-700">
                  {user?.name?.[0] || 'S'}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-gray-900 text-base truncate">{user?.name}</p>
              {user?.phone && <p className="text-xs text-gray-400 mt-0.5">{user.phone}</p>}
              {user?.age   && <p className="text-xs text-gray-400 mt-0.5">Age {user.age}</p>}
              <p className="text-xs text-brand-600 font-semibold mt-0.5">{user?.academy}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{typeLabel} · {user?.staffCode}</p>
            </div>
            <button onClick={() => setEditing(true)}
              className="p-2 rounded-xl bg-gray-50 hover:bg-gray-100 transition flex-shrink-0">
              <Pencil size={15} className="text-gray-500" />
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-900">Edit Profile</p>
              <button onClick={handleCancel} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
                <X size={15} className="text-gray-400" />
              </button>
            </div>

            {/* Photo */}
            <div className="flex flex-col items-center gap-2">
              <button type="button" onClick={() => photoRef.current?.click()}
                className="relative group w-20 h-20 rounded-full overflow-hidden border-2 border-dashed border-gray-300 hover:border-brand-400 transition">
                {currentPhoto ? (
                  <img src={currentPhoto} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-brand-50 flex flex-col items-center justify-center gap-1 text-brand-400">
                    <Camera size={20} /><span className="text-[10px] font-semibold">Photo</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                  <Camera size={16} className="text-white" />
                </div>
              </button>
              <p className="text-[11px] text-gray-400">Tap to change photo</p>
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>

            <div>
              <label className="label">Full Name *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="label">Phone Number</label>
              <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile number" type="tel" />
            </div>
            <div>
              <label className="label">Age</label>
              <input className="input" value={age} onChange={e => setAge(e.target.value)} placeholder="Your age" type="number" min="16" max="70" />
            </div>

            {/* Football licence — field staff only */}
            {isFieldStaff && (
              <div>
                <label className="label">Football / Sport Licence</label>
                {user?.licenceUrl && !licenceFile && (
                  <div className="flex items-center gap-2 mb-2 text-xs text-brand-600">
                    <FileText size={13} />
                    <a href={user.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline flex items-center gap-1">
                      View current licence <ExternalLink size={11} />
                    </a>
                  </div>
                )}
                <button type="button" onClick={() => licenceRef.current?.click()}
                  className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-gray-300 hover:border-brand-400 rounded-xl text-sm text-gray-500 hover:text-brand-600 transition">
                  <FileText size={15} />
                  {licenceName || (user?.licenceUrl ? 'Replace licence file' : 'Upload licence (PDF/image)')}
                </button>
                <input ref={licenceRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleLicence} />
              </div>
            )}

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}

            <div className="flex gap-3 pt-1">
              <button onClick={handleCancel} className="flex-1 btn-secondary justify-center py-2.5 text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary justify-center py-2.5 text-sm">
                {saving ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                ) : <><Check size={14} /> Save</>}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Licence display (view mode, field staff) */}
      {!editing && isFieldStaff && user?.licenceUrl && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText size={15} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-gray-700">Sport Licence</p>
            <a href={user.licenceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-brand-600 underline flex items-center gap-1 mt-0.5">
              View licence <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}

      {/* Leave summary */}
      {(leaveRequests || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Leave Summary</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-black text-amber-600">{(leaveRequests || []).filter(r => r.status === 'Pending').length}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Pending</p>
            </div>
            <div>
              <p className="text-xl font-black text-emerald-600">{approvedLeaves}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Approved</p>
            </div>
            <div>
              <p className="text-xl font-black text-red-500">{rejectedLeaves}</p>
              <p className="text-[10px] text-gray-400 font-semibold">Rejected</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
        <button onClick={() => navigate('/staff/me')}
          className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left">
          <div className="w-8 h-8 bg-purple-50 rounded-xl flex items-center justify-center">
            <Bell size={15} className="text-purple-600" />
          </div>
          <span className="text-sm font-semibold text-gray-700 flex-1">Leave &amp; Schedule</span>
          <ChevronRight size={14} className="text-gray-300" />
        </button>
        <button onClick={() => navigate('/staff/roster')}
          className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 text-left">
          <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center">
            <UserCircle size={15} className="text-brand-600" />
          </div>
          <span className="text-sm font-semibold text-gray-700 flex-1">Student Roster</span>
          <ChevronRight size={14} className="text-gray-300" />
        </button>
      </div>

      {/* Logout */}
      <button onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-red-50 text-red-600 font-bold text-sm border border-red-100 active:bg-red-100 transition">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  )
}
