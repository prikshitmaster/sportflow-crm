// Shared document-vault card — used by the owner's student drawer and the
// coach roster sheet. RLS decides what the caller can actually list; this
// component just renders + optionally uploads/deletes when allowed.
import { useState, useEffect, useRef } from 'react'
import * as db from '../lib/db'
import { FileText, Upload, Trash2, ExternalLink, Loader2, Download } from 'lucide-react'
import { saveOrShareFile } from '../lib/nativeSave'

export const DOC_TYPES = [
  { value: 'birth_certificate', label: 'Birth Certificate' },
  { value: 'id_proof',          label: 'ID Proof' },
  { value: 'photo_id',          label: 'Photo ID' },
  { value: 'medical',           label: 'Medical Certificate' },
  { value: 'other',             label: 'Other' },
]
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map(d => [d.value, d.label]))
const MAX_SIZE = 10 * 1024 * 1024

function fmtSize(bytes) {
  if (!bytes) return ''
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export default function StudentDocumentsCard({ studentId, canUpload = false, canDelete = false }) {
  const [docs,      setDocs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [docType,   setDocType]   = useState('birth_certificate')
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState('')
  const [busyId,    setBusyId]    = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!studentId) return
    setLoading(true)
    db.fetchStudentDocuments(studentId)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setLoading(false))
  }, [studentId])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_SIZE) { setError('File too large — max 10 MB'); return }
    setUploading(true); setError('')
    try {
      await db.uploadStudentDocument(file, {
        studentId, docType,
        title: DOC_LABEL[docType] === 'Other' ? file.name : DOC_LABEL[docType],
      })
      setDocs(await db.fetchStudentDocuments(studentId))
    } catch (e2) { setError(e2.message || 'Upload failed') }
    finally { setUploading(false) }
  }

  const handleDelete = async (doc) => {
    if (!confirm(`Delete "${doc.title}"?`)) return
    try {
      await db.deleteStudentDocument(doc.id)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
    } catch (e2) { setError(e2.message || 'Delete failed') }
  }

  // Fetch → blob → saveOrShareFile so downloads work in the native app too
  const handleDownload = async (doc) => {
    setBusyId(doc.id)
    try {
      const res  = await fetch(doc.url)
      const blob = await res.blob()
      await saveOrShareFile(blob, doc.fileName || `${doc.title}.${(doc.filePath.split('.').pop() || 'pdf')}`)
    } catch { setError('Download failed') }
    finally { setBusyId(null) }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-[11px] text-red-600 font-semibold">{error}</p>}

      {canUpload && (
        <div className="flex gap-2">
          <select className="input flex-1 text-xs" value={docType} onChange={e => setDocType(e.target.value)}>
            {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-1.5 px-3 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition disabled:opacity-50 flex-shrink-0">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {uploading ? '…' : 'Upload'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleUpload} />
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 text-center py-3">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">No documents uploaded</p>
      ) : (
        <div className="divide-y divide-gray-50">
          {docs.map(doc => (
            <div key={doc.id} className="flex items-center gap-2.5 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                <FileText size={14} className="text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">{doc.title}</p>
                <p className="text-[10px] text-gray-400">
                  {DOC_LABEL[doc.docType] || doc.docType}
                  {doc.sizeBytes ? ` · ${fmtSize(doc.sizeBytes)}` : ''}
                  {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                </p>
              </div>
              <button onClick={() => handleDownload(doc)} disabled={busyId === doc.id}
                className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition" title="Download">
                {busyId === doc.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              </button>
              <a href={doc.url} target="_blank" rel="noreferrer"
                className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition" title="Open">
                <ExternalLink size={14} />
              </a>
              {canDelete && (
                <button onClick={() => handleDelete(doc)}
                  className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition" title="Delete">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
