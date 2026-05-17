import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  Zap, LogOut, Trophy, Users, UserCog, Layers, Plus, Sparkles,
  X, Check, Trash2, Download, AlertTriangle, Loader2, IndianRupee,
} from 'lucide-react'
import { exportSportData, downloadJSON, downloadExcel } from '../lib/exportImport'
import { SPORT_CATALOG } from '../lib/sportCatalog'

export default function SportSelect() {
  const navigate = useNavigate()
  const {
    user, branches, allStudents, allStaff, allBatches, allPayments,
    setSelectedSport, logoutOwner, dataLoading,
    addBranch, removeBranch, showToast,
  } = useApp()

  const [adding,       setAdding]       = useState(false)
  const [newSport,     setNewSport]     = useState('')
  const [removing,     setRemoving]     = useState(null)   // sport name entering delete flow
  const [exportingFor, setExportingFor] = useState(null)   // sport name currently exporting
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  const sportList = useMemo(() => {
    if (branches && branches.length > 0) return branches
    const set = new Set()
    allStudents.forEach(s => s.sport && set.add(s.sport))
    return Array.from(set).sort()
  }, [branches, allStudents])

  // Per-sport stats
  const counts = useMemo(() => {
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().split('T')[0]

    const map = {}
    sportList.forEach(sport => {
      const sportStudents = allStudents.filter(s => s.sport === sport)
      const activeStudents = sportStudents.filter(s => s.status === 'Active')
      const overdue = activeStudents.filter(
        s => s.paid_till && s.paid_till < firstOfMonth
      ).length

      // Monthly revenue: payments for this sport in current month
      const monthKey = today.toISOString().slice(0, 7)
      const monthlyRevenue = allPayments
        .filter(p => {
          const student = allStudents.find(s => s.id === p.student_id)
          return student?.sport === sport && p.month?.startsWith(monthKey)
        })
        .reduce((sum, p) => sum + (p.amount || 0), 0)

      map[sport] = {
        students:  sportStudents.length,
        active:    activeStudents.length,
        staff:     allStaff.filter(s => s.sports?.includes(sport)).length,
        batches:   allBatches.filter(b => b.sports?.includes(sport)).length,
        overdue,
        monthlyRevenue,
      }
    })
    return map
  }, [sportList, allStudents, allStaff, allBatches, allPayments])

  const totalCounts = useMemo(() => ({
    students: allStudents.length,
    staff:    allStaff.length,
    batches:  allBatches.length,
  }), [allStudents, allStaff, allBatches])

  const pickSport = (sport) => {
    setSelectedSport(sport)
    navigate('/dashboard')
  }

  // Catalog sports not yet added (case-insensitive comparison against existing)
  const existingLower = useMemo(
    () => new Set((branches || []).map(b => String(b).toLowerCase())),
    [branches]
  )
  const availableCatalog = useMemo(
    () => SPORT_CATALOG.filter(s => !existingLower.has(s.toLowerCase())),
    [existingLower]
  )

  const handleAddSport = async () => {
    const v = newSport.trim()
    if (!v) { setAdding(false); return }
    if (!SPORT_CATALOG.includes(v)) {
      showToast('Pick a sport from the catalog', 'error')
      return
    }
    if (existingLower.has(v.toLowerCase())) {
      showToast(`${v} already exists`, 'info')
      setNewSport(''); setAdding(false); return
    }
    await addBranch(v)
    showToast(`${v} added`, 'success')
    setNewSport('')
    setAdding(false)
  }

  const handleDownloadBackup = async (sport) => {
    setExportingFor(sport)
    try {
      const data = await exportSportData(sport)
      downloadJSON(data)
      downloadExcel(data)
      showToast(`Backup downloaded for ${sport}`, 'success')
    } catch (err) {
      showToast(`Export failed: ${err.message}`, 'error')
    } finally {
      setExportingFor(null)
    }
  }

  const handleRemoveSport = async (sport) => {
    await removeBranch(sport)
    showToast(`${sport} removed`, 'success')
    setRemoving(null)
  }

  const handleLogout = async () => { await logoutOwner(); navigate('/login') }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-brand-50/30">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-gray-900 leading-tight">SportFlow</p>
              <p className="text-[11px] text-gray-500 leading-tight">{user?.academy}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 transition"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Heading */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-brand-600 mb-2">
            <Sparkles size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Welcome back</span>
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-1">
            Hi {user?.name?.split(' ')[0] || 'there'} — pick a sport
          </h1>
          <p className="text-gray-500 text-sm">
            Students, staff, batches and payments will all be scoped to your selection.
          </p>
        </div>

        {/* All Sports card */}
        <button
          onClick={() => pickSport('All')}
          className="w-full mb-5 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 transition rounded-2xl p-5 text-left flex items-center justify-between text-white shadow-md hover:shadow-lg"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Trophy size={22} />
            </div>
            <div>
              <p className="text-lg font-black">All Sports</p>
              <p className="text-xs text-white/80">View everything across your academy</p>
            </div>
          </div>
          <div className="flex items-center gap-5 text-xs">
            <div className="text-right">
              <p className="font-black text-base">{totalCounts.students}</p>
              <p className="text-white/70">Students</p>
            </div>
            <div className="text-right">
              <p className="font-black text-base">{totalCounts.staff}</p>
              <p className="text-white/70">Staff</p>
            </div>
            <div className="text-right">
              <p className="font-black text-base">{totalCounts.batches}</p>
              <p className="text-white/70">Batches</p>
            </div>
          </div>
        </button>

        {/* Sport cards grid */}
        {dataLoading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading sports…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sportList.map(sport => {
              const c = counts[sport] || {}
              const isConfirming = removing === sport
              const isExporting  = exportingFor === sport

              return (
                <div
                  key={sport}
                  className="group relative bg-white border border-gray-100 hover:border-brand-200 hover:shadow-md rounded-2xl p-5 transition"
                >
                  {/* Trash icon — appears on hover when not in delete flow */}
                  {!isConfirming && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRemoving(sport) }}
                      className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                      title="Remove sport"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  {/* Delete confirmation overlay */}
                  {isConfirming && (
                    <div className="absolute inset-0 bg-white rounded-2xl border-2 border-red-200 p-4 flex flex-col z-10">
                      <div className="flex items-start gap-2 mb-2">
                        <AlertTriangle size={15} className="text-red-500 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-black text-gray-900 leading-tight">Remove {sport}?</p>
                          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
                            {c.students > 0 || c.batches > 0
                              ? `${c.students} student${c.students !== 1 ? 's' : ''} and ${c.batches} batch${c.batches !== 1 ? 'es' : ''} will only appear under "All Sports". Data is not deleted.`
                              : 'No students or batches assigned. Safe to remove.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col gap-2 justify-end">
                        {/* Primary: Download backup */}
                        <button
                          disabled={isExporting}
                          onClick={(e) => { e.stopPropagation(); handleDownloadBackup(sport) }}
                          className="w-full flex items-center justify-center gap-2 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition"
                        >
                          {isExporting
                            ? <><Loader2 size={12} className="animate-spin" /> Exporting…</>
                            : <><Download size={12} /> Download Backup</>}
                        </button>

                        <div className="flex gap-2">
                          {/* Secondary: Delete without backup */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveSport(sport) }}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 text-[11px] font-bold rounded-lg transition"
                          >
                            <Trash2 size={11} /> Remove
                          </button>
                          {/* Cancel */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setRemoving(null) }}
                            className="flex-1 flex items-center justify-center py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] font-bold rounded-lg transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Clickable card content */}
                  <button
                    onClick={() => pickSport(sport)}
                    disabled={isConfirming}
                    className="w-full text-left disabled:pointer-events-none"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center group-hover:bg-brand-100 transition">
                        <Trophy size={20} className="text-brand-600" />
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {c.overdue > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                            <AlertTriangle size={9} /> {c.overdue} overdue
                          </span>
                        )}
                        {!isConfirming && (
                          <span className="text-[10px] font-bold text-gray-400 group-hover:text-brand-600 uppercase tracking-wider transition">
                            Open →
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-lg font-black text-gray-900 mb-1">{sport}</p>

                    {/* Monthly revenue */}
                    {c.monthlyRevenue > 0 && (
                      <p className="flex items-center gap-0.5 text-[11px] text-emerald-600 font-bold mb-3">
                        <IndianRupee size={10} />
                        {c.monthlyRevenue.toLocaleString('en-IN')} this month
                      </p>
                    )}

                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
                      <div>
                        <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5">
                          <Users size={10} /> Students
                        </div>
                        <p className="text-sm font-black text-gray-900">
                          {c.active}
                          {c.students > c.active && (
                            <span className="text-[10px] text-gray-400 font-normal">/{c.students}</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5">
                          <UserCog size={10} /> Coaches
                        </div>
                        <p className="text-sm font-black text-gray-900">{c.staff}</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5">
                          <Layers size={10} /> Batches
                        </div>
                        <p className="text-sm font-black text-gray-900">{c.batches}</p>
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}

            {/* + Add Sport card */}
            {adding ? (
              <div className="bg-white border-2 border-brand-300 rounded-2xl p-5 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center">
                    <Plus size={20} className="text-brand-600" />
                  </div>
                </div>
                {availableCatalog.length === 0 ? (
                  <p className="text-xs text-gray-500 mb-3">All catalog sports already added.</p>
                ) : (
                  <select
                    ref={inputRef}
                    value={newSport}
                    onChange={(e) => setNewSport(e.target.value)}
                    className="input mb-3 text-base font-bold"
                  >
                    <option value="">— Pick a sport —</option>
                    {availableCatalog.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddSport}
                    disabled={!newSport || availableCatalog.length === 0}
                    className="flex-1 btn-primary py-2 text-sm justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check size={14} /> Add
                  </button>
                  <button
                    onClick={() => { setNewSport(''); setAdding(false) }}
                    className="btn-secondary py-2 text-sm px-3 justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="border-2 border-dashed border-gray-200 hover:border-brand-300 hover:bg-brand-50/40 rounded-2xl p-5 flex flex-col items-center justify-center text-center transition min-h-[200px] group"
              >
                <div className="w-12 h-12 bg-gray-100 group-hover:bg-brand-100 rounded-2xl flex items-center justify-center mb-2 transition">
                  <Plus size={22} className="text-gray-400 group-hover:text-brand-600 transition" />
                </div>
                <p className="text-sm font-bold text-gray-700 group-hover:text-brand-700 transition">Add Sport</p>
                <p className="text-[11px] text-gray-400 mt-1">Pick from catalog</p>
              </button>
            )}
          </div>
        )}

        {sportList.length === 0 && !dataLoading && !adding && (
          <p className="text-center text-xs text-gray-400 mt-6">
            No sports yet — tap "Add Sport" above, or pick "All Sports" to continue without filtering.
          </p>
        )}
      </main>
    </div>
  )
}
