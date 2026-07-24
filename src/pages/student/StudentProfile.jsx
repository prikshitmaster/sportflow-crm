// Student Profile — personal details (height, weight, CRS number) plus a
// document vault (birth certificate, ID proof, medical…). Documents upload
// to the 'student-documents' bucket; metadata rows are RLS-guarded so only
// the student, the owner, and permission-granted staff can list them.
import { useState, useEffect, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import {
  Camera, Save, FileText, Upload, Trash2, ExternalLink, ShieldCheck, Loader2,
} from 'lucide-react'

const DOC_TYPES = [
  { value: 'birth_certificate', label: 'Birth Certificate' },
  { value: 'id_proof',          label: 'ID Proof (Aadhaar / Passport)' },
  { value: 'photo_id',          label: 'Photo ID' },
  { value: 'medical',           label: 'Medical Certificate' },
  { value: 'other',             label: 'Other' },
]
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map(d => [d.value, d.label]))
const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

function fmtSize(bytes) {
  if (!bytes) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export default function StudentProfile() {
  const { studentUser, updateStudentProfile, updateStudentPhoto } = useApp()

  const [height, setHeight] = useState(studentUser?.height_cm || '')
  const [weight, setWeight] = useState(studentUser?.weight_kg || '')
  const [crs,    setCrs]    = useState(studentUser?.crs_number || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const [docs,      setDocs]      = useState([])
  const [docType,   setDocType]   = useState('birth_certificate')
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef  = useRef(null)
  const photoRef = useRef(null)

  useEffect(() => {
    if (!studentUser?.id) return
    db.fetchStudentDocuments(studentUser.id).then(setDocs).catch(() => {})
  }, [studentUser?.id])

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      await updateStudentProfile({
        heightCm:  height === '' ? null : Number(height),
        weightKg:  weight === '' ? null : Number(weight),
        crsNumber: crs.trim(),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e.message || 'Failed to save')
    } finally { setSaving(false) }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_SIZE) { setError('File too large — max 10 MB'); return }
    setUploading(true); setError('')
    try {
      await db.uploadStudentDocument(file, {
        studentId: studentUser.id,
        docType,
        title: DOC_LABEL[docType] === 'Other' ? file.name : DOC_LABEL[docType],
      })
      setDocs(await db.fetchStudentDocuments(studentUser.id))
    } catch (e2) {
      setError(e2.message || 'Upload failed')
    } finally { setUploading(false) }
  }

  const handleDelete = async (doc) => {
    if (!confirm(`Delete "${doc.title}"?`)) return
    try {
      await db.deleteStudentDocument(doc.id)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
    } catch (e2) { setError(e2.message || 'Delete failed') }
  }

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try { await updateStudentPhoto(file) } catch {} finally { setPhotoBusy(false) }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
      {/* Profile header */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 rounded-2xl p-5 flex items-center gap-4">
        <div className="relative">
          {studentUser?.photo_url ? (
            <img src={studentUser.photo_url} alt="" className="w-16 h-16 rounded-2xl object-cover border-2 border-white/30" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-black text-white border-2 border-white/30">
              {studentUser?.name?.[0]?.toUpperCase()}
            </div>
          )}
          <button onClick={() => photoRef.current?.click()} disabled={photoBusy}
            className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center">
            {photoBusy
              ? <Loader2 size={13} className="text-brand-600 animate-spin" />
              : <Camera size={13} className="text-brand-600" />}
          </button>
          <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-white truncate">{studentUser?.name}</h1>
          <p className="text-brand-200 text-xs">{studentUser?.sport}{studentUser?.batch ? ` · ${studentUser.batch}` : ''}</p>
          {studentUser?.student_code && <p className="text-brand-300 text-xs font-mono mt-0.5">{studentUser.student_code}</p>}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-xl px-3 py-2.5">{error}</div>
      )}

      {/* My details */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">My Details</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">Height (cm)</label>
            <input type="number" inputMode="numeric" min="50" max="250" className="input"
              placeholder="e.g. 165" value={height} onChange={e => setHeight(e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">Weight (kg)</label>
            <input type="number" inputMode="numeric" min="10" max="200" className="input"
              placeholder="e.g. 55" value={weight} onChange={e => setWeight(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1 block">CRS / Registration Number</label>
          <input type="text" className="input font-mono" placeholder="e.g. AIFF CRS number"
            value={crs} onChange={e => setCrs(e.target.value)} />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl py-2.5 transition disabled:opacity-50">
          {saved ? <><ShieldCheck size={15} /> Saved</> : <><Save size={15} /> {saving ? 'Saving…' : 'Save Details'}</>}
        </button>
      </div>

      {/* Document vault */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">My Documents</p>
          <span className="text-[10px] text-gray-400">{docs.length} file{docs.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex gap-2">
          <select className="input flex-1" value={docType} onChange={e => setDocType(e.target.value)}>
            {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition disabled:opacity-50 flex-shrink-0">
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
        </div>
        <p className="text-[10px] text-gray-400">PDF or photo · max 10 MB · visible to your academy owner{docs.length > 0 ? '' : ' — upload your birth certificate to get started'}</p>

        {docs.length > 0 && (
          <div className="divide-y divide-gray-50 -mx-4">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{doc.title}</p>
                  <p className="text-[11px] text-gray-400">
                    {DOC_LABEL[doc.docType] || doc.docType}
                    {doc.sizeBytes ? ` · ${fmtSize(doc.sizeBytes)}` : ''}
                    {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </p>
                </div>
                <a href={doc.url} target="_blank" rel="noreferrer"
                  className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition">
                  <ExternalLink size={15} />
                </a>
                <button onClick={() => handleDelete(doc)}
                  className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
