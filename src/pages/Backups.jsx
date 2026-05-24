import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { exportAcademyData } from '../lib/exportImport'
import { Download, ShieldCheck, RefreshCw } from 'lucide-react'

export default function Backups() {
  const { user, showToast } = useApp()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setRows(await db.listBackups(user?.academyId)) }
    catch (e) { showToast(e.message || 'Failed to load backups', 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (user?.academyId) load() }, [user?.academyId])

  const downloadNow = async () => {
    setBusy(true)
    try { await exportAcademyData(user.academyId); showToast('Backup downloaded') }
    catch (e) { showToast(e.message || 'Backup failed', 'error') }
    finally { setBusy(false) }
  }

  const downloadStored = async (path) => {
    try { window.open(await db.getBackupSignedUrl(path), '_blank') }
    catch (e) { showToast(e.message || 'Could not open backup', 'error') }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-brand-600" size={22} /> Backups
          </h2>
          <p className="text-sm text-gray-400">Automatic weekly backups, kept 12 weeks. Download anytime.</p>
        </div>
        <button onClick={downloadNow} disabled={busy}
          className="px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 flex-shrink-0">
          <Download size={16} /> {busy ? 'Preparing…' : 'Download now'}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Saved backups</span>
          <button onClick={load} className="text-gray-400 hover:text-gray-700" aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        {loading ? (
          <p className="px-4 py-6 text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400">No saved backups yet — the first weekly backup will appear here.</p>
        ) : rows.map(r => (
          <button key={r.path} onClick={() => downloadStored(r.path)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left transition">
            <span className="text-sm font-medium text-gray-800">{r.date}</span>
            <span className="text-xs text-gray-400 flex items-center gap-2">
              {r.size ? `${(r.size / 1024).toFixed(0)} KB` : ''} <Download size={14} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
