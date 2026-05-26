import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { exportAcademyData } from '../lib/exportImport'
import { Download, ShieldCheck, RefreshCw, Filter, ChevronDown, ChevronUp, FileSpreadsheet, Calendar } from 'lucide-react'
import { SkeletonRows } from '../components/Skeleton'

const SHEET_OPTIONS = [
  { key: 'students',   label: 'Students' },
  { key: 'payments',   label: 'Payments' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'trials',     label: 'Trials' },
  { key: 'batches',    label: 'Batches' },
]

export default function Backups() {
  const { user, showToast, sports } = useApp()
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  // Filters
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const [sport,     setSport]     = useState('')
  const [sheets,    setSheets]    = useState(SHEET_OPTIONS.map(s => s.key))

  const load = async () => {
    setLoading(true)
    try { setRows(await db.listBackups(user?.academyId)) }
    catch (e) { showToast(e.message || 'Failed to load backups', 'error') }
    finally { setLoading(false) }
  }
  useEffect(() => { if (user?.academyId) load() }, [user?.academyId])

  const toggleSheet = (key) =>
    setSheets(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const downloadNow = async () => {
    if (!sheets.length) { showToast('Select at least one data type', 'error'); return }
    setBusy(true)
    try {
      await exportAcademyData(user.academyId, {
        download:     true,
        dateFrom:     dateFrom     || undefined,
        dateTo:       dateTo       || undefined,
        sport:        sport        || undefined,
        sheets,
        academyName:  user?.academy,
      })
      showToast('Export downloaded')
    }
    catch (e) { showToast(e.message || 'Export failed', 'error') }
    finally { setBusy(false) }
  }

  const downloadStored = async (path) => {
    try { window.open(await db.getBackupSignedUrl(path), '_blank') }
    catch (e) { showToast(e.message || 'Could not open backup', 'error') }
  }

  const activeFilterCount = [dateFrom, dateTo, sport].filter(Boolean).length + (sheets.length < SHEET_OPTIONS.length ? 1 : 0)

  const sportList = sports || []

  return (
    <div className="max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-brand-600" size={22} /> Backups
          </h2>
          <p className="text-sm text-gray-400">Download your academy data as a professional Excel report.</p>
        </div>
        <button
          onClick={downloadNow}
          disabled={busy}
          className="px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
        >
          <FileSpreadsheet size={16} /> {busy ? 'Preparing…' : 'Export Excel'}
        </button>
      </div>

      {/* Filter panel */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button
          onClick={() => setShowFilter(f => !f)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
        >
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Export Filters</span>
            {activeFilterCount > 0 && (
              <span className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full">{activeFilterCount}</span>
            )}
          </div>
          {showFilter ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>

        {showFilter && (
          <div className="px-4 pb-4 space-y-4 border-t border-gray-50 pt-4">
            {/* Date range */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                <Calendar size={12} /> Date Range <span className="text-gray-400 font-normal lowercase tracking-normal">(payments & attendance)</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="label text-[11px]">From</label>
                  <input type="date" className="input text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className="label text-[11px]">To</label>
                  <input type="date" className="input text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </div>
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(''); setDateTo('') }}
                    className="mt-5 text-xs text-gray-400 hover:text-gray-600 font-medium">Clear</button>
                )}
              </div>
            </div>

            {/* Sport filter */}
            {sportList.length > 1 && (
              <div>
                <label className="label text-[11px] uppercase tracking-wide font-bold text-gray-500">Sport</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    onClick={() => setSport('')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${!sport ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  >All Sports</button>
                  {sportList.map(s => (
                    <button
                      key={s}
                      onClick={() => setSport(s === sport ? '' : s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${sport === s ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >{s}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Sheet selection */}
            <div>
              <label className="label text-[11px] uppercase tracking-wide font-bold text-gray-500 mb-2">Include in Export</label>
              <div className="flex flex-wrap gap-2">
                {SHEET_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => toggleSheet(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${sheets.includes(key) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                  >{label}</button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">{sheets.length} of {SHEET_OPTIONS.length} sheets selected</p>
            </div>

            {/* Quick presets */}
            <div>
              <label className="label text-[11px] uppercase tracking-wide font-bold text-gray-500 mb-2">Quick Presets</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'This Month', action: () => {
                    const now = new Date()
                    setDateFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
                    setDateTo(new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10))
                  }},
                  { label: 'Last 3 Months', action: () => {
                    const now = new Date()
                    const from = new Date(now.getFullYear(), now.getMonth()-2, 1)
                    setDateFrom(from.toISOString().slice(0,10))
                    setDateTo(now.toISOString().slice(0,10))
                  }},
                  { label: 'This Year', action: () => {
                    const y = new Date().getFullYear()
                    setDateFrom(`${y}-01-01`)
                    setDateTo(`${y}-12-31`)
                  }},
                  { label: 'Full Export', action: () => {
                    setDateFrom(''); setDateTo(''); setSport(''); setSheets(SHEET_OPTIONS.map(s => s.key))
                  }},
                ].map(({ label, action }) => (
                  <button key={label} onClick={action}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200 transition">
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Saved backups list */}
      <div className="bg-white rounded-2xl border border-gray-100 divide-y">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Saved backups</span>
          <button onClick={load} className="text-gray-400 hover:text-gray-700" aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        {loading ? (
          <SkeletonRows rows={4} />
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
