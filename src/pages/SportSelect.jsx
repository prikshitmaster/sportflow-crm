import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import {
  Zap, LogOut, Trophy, Users, UserCog, Layers, Plus, Sparkles,
  X, Check, Trash2, Download, AlertTriangle, Loader2, IndianRupee,
  ArrowLeft, MapPin, Pencil, TrendingUp, ShieldCheck,
} from 'lucide-react'
import { exportSportData, downloadJSON, downloadExcel } from '../lib/exportImport'
import { SPORT_CATALOG } from '../lib/sportCatalog'
import SportIcon from '../components/SportIcon'
import { toLocalDateStr, toLocalMonthStr } from '../lib/dates'

// Per-sport color theme — each card gets a distinct accent so the page
// has visual identity instead of a sea of identical blue cards.
const SPORT_THEMES = {
  Football:       { accent: 'bg-emerald-500',  iconBg: 'bg-emerald-50',  iconText: 'text-emerald-600', tint: 'bg-emerald-50/40', ring: 'group-hover:ring-emerald-200' },
  Cricket:        { accent: 'bg-amber-500',    iconBg: 'bg-amber-50',    iconText: 'text-amber-600',   tint: 'bg-amber-50/40',   ring: 'group-hover:ring-amber-200' },
  Tennis:         { accent: 'bg-lime-500',     iconBg: 'bg-lime-50',     iconText: 'text-lime-600',    tint: 'bg-lime-50/40',    ring: 'group-hover:ring-lime-200' },
  Squash:         { accent: 'bg-violet-500',   iconBg: 'bg-violet-50',   iconText: 'text-violet-600',  tint: 'bg-violet-50/40',  ring: 'group-hover:ring-violet-200' },
  Basketball:     { accent: 'bg-orange-500',   iconBg: 'bg-orange-50',   iconText: 'text-orange-600',  tint: 'bg-orange-50/40',  ring: 'group-hover:ring-orange-200' },
  Badminton:      { accent: 'bg-cyan-500',     iconBg: 'bg-cyan-50',     iconText: 'text-cyan-600',    tint: 'bg-cyan-50/40',    ring: 'group-hover:ring-cyan-200' },
  'Table Tennis': { accent: 'bg-rose-500',     iconBg: 'bg-rose-50',     iconText: 'text-rose-600',    tint: 'bg-rose-50/40',    ring: 'group-hover:ring-rose-200' },
  Hockey:         { accent: 'bg-blue-500',     iconBg: 'bg-blue-50',     iconText: 'text-blue-600',    tint: 'bg-blue-50/40',    ring: 'group-hover:ring-blue-200' },
  Volleyball:     { accent: 'bg-yellow-500',   iconBg: 'bg-yellow-50',   iconText: 'text-yellow-700',  tint: 'bg-yellow-50/40',  ring: 'group-hover:ring-yellow-200' },
  Swimming:       { accent: 'bg-sky-500',      iconBg: 'bg-sky-50',      iconText: 'text-sky-600',     tint: 'bg-sky-50/40',     ring: 'group-hover:ring-sky-200' },
}
const DEFAULT_THEME = { accent: 'bg-brand-600', iconBg: 'bg-brand-50', iconText: 'text-brand-600', tint: 'bg-brand-50/30', ring: 'group-hover:ring-brand-200' }
const getSportTheme = (sport) => SPORT_THEMES[sport] || DEFAULT_THEME

export default function SportSelect() {
  const navigate = useNavigate()
  const {
    user, branches, allStudents, allStaff, allBatches, allPayments,
    setSelectedSport, logoutOwner, dataLoading,
    addBranch, removeBranch, showToast,
    sportBranches, refreshSportBranches, setSelectedSportAndBranch,
  } = useApp()

  // view: 'sports' (default) | 'branches' (drill-in for a sport)
  const [view, setView]               = useState('sports')
  const [drillSport, setDrillSport]   = useState(null)   // sport_name being drilled into
  const [addingBranch, setAddingBranch] = useState(false)
  const [newBranch,    setNewBranch]    = useState('')
  const [newBranchAddress, setNewBranchAddress] = useState('')
  const [editingBranch, setEditingBranch] = useState(null)   // { id, branchName, address } when editing
  const [deletingBranch, setDeletingBranch] = useState(null) // 3-step delete state

  const [adding,       setAdding]       = useState(false)
  const [newSport,     setNewSport]     = useState('')
  const [removing,     setRemoving]     = useState(null)   // sport name entering delete flow
  const [exportingFor, setExportingFor] = useState(null)   // sport name currently exporting
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  // Primary source: sport_branches (new system). Fallback to legacy academy_branches
  // text array, then to sports inferred from existing students — covers the
  // migration period where some owners pre-date sport_branches entirely.
  const sportList = useMemo(() => {
    const set = new Set()
    ;(sportBranches || []).forEach(b => b.sportName && set.add(b.sportName))
    if (set.size === 0 && branches && branches.length > 0) {
      branches.forEach(b => set.add(b))
    }
    if (set.size === 0) {
      allStudents.forEach(s => s.sport && set.add(s.sport))
    }
    return Array.from(set).sort()
  }, [sportBranches, branches, allStudents])

  // Per-sport stats
  const counts = useMemo(() => {
    const today = new Date()
    const firstOfMonth = toLocalDateStr(new Date(today.getFullYear(), today.getMonth(), 1))

    const map = {}
    sportList.forEach(sport => {
      const sportStudents = allStudents.filter(s => s.sport === sport)
      const activeStudents = sportStudents.filter(s => s.status === 'Active')
      const overdue = activeStudents.filter(
        s => s.paid_till && s.paid_till < firstOfMonth
      ).length

      // Monthly revenue: payments for this sport in current month
      const monthKey = toLocalMonthStr(today)
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

  // Branches under a given sport (from sport_branches table)
  const branchesOf = (sportName) =>
    (sportBranches || []).filter(b => b.sportName === sportName)

  // Per-branch stats (students/batches in this branch)
  const branchCounts = useMemo(() => {
    const map = {}
    ;(sportBranches || []).forEach(sb => {
      map[sb.id] = {
        students: allStudents.filter(s => s.branchId === sb.id).length,
        active:   allStudents.filter(s => s.branchId === sb.id && s.status === 'Active').length,
        batches:  allBatches.filter(b => b.branchId === sb.id).length,
      }
    })
    return map
  }, [sportBranches, allStudents, allBatches])

  const pickSport = (sport) => {
    // "All Sports" goes straight to dashboard with no scoping
    if (sport === 'All') {
      setSelectedSportAndBranch('All', null)
      navigate('/dashboard')
      return
    }
    const list = branchesOf(sport)
    // No branches yet → show branch picker so owner can add the first one
    if (list.length === 0) {
      setDrillSport(sport)
      setView('branches')
      return
    }
    // Single branch → auto-select it
    if (list.length === 1) {
      setSelectedSportAndBranch(sport, list[0].id)
      navigate('/dashboard')
      return
    }
    // Multiple branches → drill into branch picker
    setDrillSport(sport)
    setView('branches')
  }

  const pickBranch = (sportName, branchId) => {
    setSelectedSportAndBranch(sportName, branchId)
    navigate('/dashboard')
  }

  const handleAddBranch = async () => {
    const v = newBranch.trim()
    if (!v || !drillSport || !user?.academyId) { setAddingBranch(false); return }
    if (branchesOf(drillSport).some(b => b.branchName.toLowerCase() === v.toLowerCase())) {
      showToast(`${v} already exists in ${drillSport}`, 'info'); return
    }
    try {
      await db.insertSportBranch(user.academyId, drillSport, v, newBranchAddress.trim())
      await refreshSportBranches()
      showToast(`${v} added to ${drillSport}`, 'success')
      setNewBranch('')
      setNewBranchAddress('')
      setAddingBranch(false)
    } catch (err) {
      showToast(err.message || 'Failed to add branch', 'error')
    }
  }

  const handleSaveEditBranch = async (fields) => {
    if (!editingBranch) return
    const newName = (fields.branchName ?? '').trim()
    if (!newName) { showToast('Branch name required', 'error'); return }
    // Block duplicate names within the same sport (ignoring own row, case-insensitive)
    const dup = branchesOf(drillSport).some(b =>
      b.id !== editingBranch.id && b.branchName.toLowerCase() === newName.toLowerCase()
    )
    if (dup) { showToast(`${newName} already exists in ${drillSport}`, 'info'); return }
    try {
      // 1. Save name + address only (no manager_id here)
      await db.updateSportBranch(editingBranch.id, {
        branchName: newName,
        address:    fields.address ?? '',
      })

      // 2. Manager change → call the dedicated assign/unassign RPCs which
      //    also grant full permissions + lock the staff to this branch.
      const oldManager = editingBranch.managerId ?? null
      const newManager = fields.managerId ?? null
      if (String(oldManager || '') !== String(newManager || '')) {
        if (newManager) {
          await db.assignBranchManager(editingBranch.id, newManager)
        } else {
          await db.unassignBranchManager(editingBranch.id)
        }
      }

      await refreshSportBranches()
      showToast('Branch updated', 'success')
      setEditingBranch(null)
    } catch (err) {
      showToast(err.message || 'Failed to update branch', 'error')
    }
  }

  // Confirmed 3-step delete (called only from the final step of the dialog)
  const handleConfirmDeleteBranch = async () => {
    if (!deletingBranch) return
    const studentsInBranch = allStudents.filter(s => s.branchId === deletingBranch.id).length
    if (studentsInBranch > 0) {
      showToast(`Cannot remove: ${studentsInBranch} students still assigned. Reassign them first.`, 'error')
      return
    }
    try {
      await db.deleteSportBranch(deletingBranch.id)
      await refreshSportBranches()
      showToast(`${deletingBranch.branchName} removed`, 'success')
      setDeletingBranch(null)
    } catch (err) {
      showToast(err.message || 'Failed to remove branch', 'error')
    }
  }

  // Catalog sports not yet added — uses sportList (DB + student-derived fallback)
  // so the dropdown hides Football when the academy already has Football students,
  // even if the DB read of academy_branches returned empty.
  const existingLower = useMemo(
    () => new Set(sportList.map(b => String(b).toLowerCase())),
    [sportList]
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
    // 1. Legacy registry (academy_branches) — keeps backward compat
    await addBranch(v)
    // 2. Auto-create "Branch 1" under the new sport so fee plans / students
    //    always live in a branch.
    if (user?.academyId) {
      try {
        await db.insertSportBranch(user.academyId, v, 'Branch 1')
        await refreshSportBranches()
      } catch (err) {
        showToast(`Added ${v}, but couldn't create Branch 1: ${err.message || 'error'}`, 'error')
      }
    }
    showToast(`${v} added — set up its branches`, 'success')
    setNewSport('')
    setAdding(false)
    // 3. Drill straight into the new sport's branch view so the owner can
    //    rename Branch 1, add more branches, etc. before adding any data.
    setDrillSport(v)
    setView('branches')
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
    // Block delete if any branch under this sport still has students assigned.
    // Mirrors the guard in handleConfirmDeleteBranch so callers can't orphan rows.
    const sportBranchIds = (sportBranches || [])
      .filter(b => b.sportName === sport)
      .map(b => b.id)
    const studentsInSport = allStudents.filter(s => sportBranchIds.includes(s.branchId)).length
    if (studentsInSport > 0) {
      showToast(`Cannot remove: ${studentsInSport} students still assigned. Reassign first.`, 'error')
      return
    }
    try {
      // Legacy registry (academy_branches) — keeps sportList fallback in sync
      await removeBranch(sport)
      // New system (sport_branches) — without this, sportList still shows the sport
      const orphans = (sportBranches || []).filter(b => b.sportName === sport)
      await Promise.all(orphans.map(b => db.deleteSportBranch(b.id)))
      await refreshSportBranches()
      showToast(`${sport} removed`, 'success')
      setRemoving(null)
    } catch (err) {
      showToast(err.message || `Failed to remove ${sport}`, 'error')
    }
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
        {view === 'branches' && drillSport ? (
          <BranchView
            sportName={drillSport}
            branches={branchesOf(drillSport)}
            counts={branchCounts}
            allStaff={allStaff}
            studentsInBranch={(id) => allStudents.filter(s => s.branchId === id).length}
            onBack={() => { setView('sports'); setDrillSport(null); setAddingBranch(false); setNewBranch(''); setNewBranchAddress('') }}
            onPickBranch={(id) => pickBranch(drillSport, id)}
            adding={addingBranch}
            newBranch={newBranch}
            setNewBranch={setNewBranch}
            newBranchAddress={newBranchAddress}
            setNewBranchAddress={setNewBranchAddress}
            onStartAdd={() => setAddingBranch(true)}
            onCancelAdd={() => { setAddingBranch(false); setNewBranch(''); setNewBranchAddress('') }}
            onConfirmAdd={handleAddBranch}
            editingBranch={editingBranch}
            onStartEdit={(b) => setEditingBranch({ id: b.id, branchName: b.branchName, address: b.address || '', managerId: b.managerId || null })}
            onCancelEdit={() => setEditingBranch(null)}
            onSaveEdit={handleSaveEditBranch}
            deletingBranch={deletingBranch}
            onStartDelete={(b) => setDeletingBranch({ ...b, step: 1, typed: '', finalCheck: false })}
            setDeletingBranch={setDeletingBranch}
            onConfirmDelete={handleConfirmDeleteBranch}
          />
        ) : (<>
        {/* Heading */}
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-gray-400 mb-2">
              <Sparkles size={13} />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Welcome back</span>
            </div>
            <h1 className="text-[28px] font-black text-gray-900 leading-tight tracking-tight">
              Hi {user?.name?.split(' ')[0] || 'there'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Pick a sport to scope your dashboard.
            </p>
          </div>
          <p className="text-[11px] text-gray-400 font-medium hidden sm:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Academy summary strip — refined */}
        <div className="mb-6 bg-white border border-gray-100 rounded-2xl px-5 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-brand-50 to-brand-100 rounded-xl flex items-center justify-center">
              <Trophy size={18} className="text-brand-600" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400">Academy</p>
              <p className="text-sm font-black text-gray-900 leading-tight">{user?.academy}</p>
            </div>
          </div>
          <div className="flex items-center divide-x divide-gray-100 text-xs">
            <div className="px-5 text-right">
              <p className="font-black text-xl text-gray-900 leading-none">{totalCounts.students}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">Students</p>
            </div>
            <div className="px-5 text-right">
              <p className="font-black text-xl text-gray-900 leading-none">{totalCounts.staff}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">Staff</p>
            </div>
            <div className="pl-5 text-right">
              <p className="font-black text-xl text-gray-900 leading-none">{totalCounts.batches}</p>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">Batches</p>
            </div>
          </div>
        </div>

        {/* Sport cards grid */}
        {dataLoading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading sports…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sportList.map(sport => {
              const c = counts[sport] || {}
              const isConfirming = removing === sport
              const isExporting  = exportingFor === sport

              const theme = getSportTheme(sport)
              return (
                <div
                  key={sport}
                  className={`group relative bg-white rounded-2xl overflow-hidden transition-all duration-200 shadow-sm hover:shadow-xl hover:-translate-y-0.5 ring-1 ring-gray-100 ${theme.ring}`}
                >
                  {/* Color accent strip */}
                  <div className={`h-1 ${theme.accent}`} />

                  {/* Action icons — top-right, below the accent strip */}
                  {!isConfirming && (
                    <div className="absolute top-4 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition z-20">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDrillSport(sport); setView('branches') }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-gray-700 bg-white hover:bg-gray-100 transition"
                        title="Manage branches"
                      >
                        <MapPin size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRemoving(sport) }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 bg-white hover:bg-red-50 transition"
                        title="Remove sport"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
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
                    className="w-full text-left disabled:pointer-events-none p-5 pb-4"
                  >
                    {/* Sport-specific icon */}
                    <div className={`w-12 h-12 ${theme.iconBg} rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-105 ${theme.iconText}`}>
                      <SportIcon sport={sport} size={24} />
                    </div>

                    {/* Sport name + active count */}
                    <div className="mb-4">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xl font-black text-gray-900 leading-tight tracking-tight">{sport}</p>
                        {c.overdue > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex-shrink-0 mt-1">
                            <AlertTriangle size={9} /> {c.overdue}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        <span className="font-bold text-gray-900">{c.active}</span>
                        {c.students > c.active && <span className="text-gray-400"> / {c.students}</span>}
                        <span className="text-gray-400"> active</span>
                        {c.monthlyRevenue > 0 && (
                          <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-600 font-bold">
                            <TrendingUp size={10} /> ₹{(c.monthlyRevenue / 1000).toFixed(c.monthlyRevenue >= 100000 ? 0 : 1)}k
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Inline stats */}
                    <div className="flex items-center gap-3 text-[11px] text-gray-500">
                      <div className="flex items-center gap-1">
                        <UserCog size={11} className="text-gray-400" />
                        <span><span className="font-black text-gray-800">{c.staff}</span> {c.staff === 1 ? 'coach' : 'coaches'}</span>
                      </div>
                      <span className="w-0.5 h-0.5 rounded-full bg-gray-300" />
                      <div className="flex items-center gap-1">
                        <Layers size={11} className="text-gray-400" />
                        <span><span className="font-black text-gray-800">{c.batches}</span> {c.batches === 1 ? 'batch' : 'batches'}</span>
                      </div>
                    </div>
                  </button>

                  {/* Footer: branch link + Open CTA */}
                  {!isConfirming && (() => {
                    const branchCount = branchesOf(sport).length
                    return (
                      <div className={`flex items-center justify-between border-t border-gray-100 ${theme.tint}`}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDrillSport(sport); setView('branches') }}
                          className="flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold text-gray-600 hover:text-gray-900 transition group/branch">
                          <MapPin size={11} className={theme.iconText} />
                          <span>{branchCount} {branchCount === 1 ? 'branch' : 'branches'}</span>
                          <span className="text-gray-400 group-hover/branch:text-gray-700 transition">→</span>
                        </button>
                        <button
                          onClick={() => pickSport(sport)}
                          className="px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 group-hover:text-gray-900 transition">
                          Open →
                        </button>
                      </div>
                    )
                  })()}
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
        </>)}
      </main>
    </div>
  )
}

// ── Branch picker view (rendered when user drills into a sport) ─────
function BranchView({
  sportName, branches, counts, studentsInBranch, allStaff,
  onBack, onPickBranch,
  adding, newBranch, setNewBranch, newBranchAddress, setNewBranchAddress,
  onStartAdd, onCancelAdd, onConfirmAdd,
  editingBranch, onStartEdit, onCancelEdit, onSaveEdit,
  deletingBranch, onStartDelete, setDeletingBranch, onConfirmDelete,
}) {
  const theme = getSportTheme(sportName)
  // Staff eligible to be managers: those whose sports array includes this sport
  const eligibleStaff = (allStaff || []).filter(s =>
    Array.isArray(s.sports) ? s.sports.includes(sportName) : s.sport === sportName
  )
  const staffById = Object.fromEntries((allStaff || []).map(s => [s.id, s]))
  return (<>
    <div className="mb-8">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-brand-600 mb-3">
        <ArrowLeft size={14} /> Back to sports
      </button>
      <div className={`flex items-center gap-2 mb-2 ${theme.iconText}`}>
        <SportIcon sport={sportName} size={16} />
        <span className="text-xs font-bold uppercase tracking-wider">{sportName}</span>
      </div>
      <h1 className="text-3xl font-black text-gray-900 mb-1">Pick a branch</h1>
      <p className="text-gray-500 text-sm">Each branch is isolated — its students, batches, payments and reports are separate.</p>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {branches.map(b => {
        const c = counts[b.id] || {}
        return (
          <div key={b.id} className="group relative bg-white border border-gray-100 hover:border-brand-200 hover:shadow-md rounded-2xl p-5 transition">
            {/* Action buttons — shown on hover */}
            <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button
                onClick={(e) => { e.stopPropagation(); onStartEdit(b) }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition"
                title="Edit branch"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onStartDelete(b) }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                title="Delete branch"
              >
                <Trash2 size={13} />
              </button>
            </div>

            <button onClick={() => onPickBranch(b.id)} className="w-full text-left">
              <div className="flex items-start justify-between mb-3">
                <div className="w-11 h-11 bg-purple-50 rounded-xl flex items-center justify-center group-hover:bg-purple-100 transition">
                  <MapPin size={20} className="text-purple-600" />
                </div>
                <span className="text-[10px] font-bold text-gray-400 group-hover:text-brand-600 uppercase tracking-wider transition">Open →</span>
              </div>
              <p className="text-lg font-black text-gray-900 mb-0.5">{b.branchName}</p>
              {b.managerId && staffById[b.managerId] && (
                <p className="flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold mb-1">
                  {staffById[b.managerId].photoUrl ? (
                    <img
                      src={staffById[b.managerId].photoUrl}
                      alt={staffById[b.managerId].name}
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-indigo-100"
                    />
                  ) : (
                    <ShieldCheck size={10} className="flex-shrink-0" />
                  )}
                  {staffById[b.managerId].name}
                </p>
              )}
              {b.address && (
                <p className="flex items-start gap-1 text-[11px] text-gray-500 mb-2 leading-snug">
                  <MapPin size={10} className="mt-0.5 flex-shrink-0" />
                  <span className="line-clamp-2">{b.address}</span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                <div>
                  <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5"><Users size={10} /> Students</div>
                  <p className="text-sm font-black text-gray-900">
                    {c.active || 0}
                    {(c.students || 0) > (c.active || 0) && <span className="text-[10px] text-gray-400 font-normal">/{c.students}</span>}
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5"><Layers size={10} /> Batches</div>
                  <p className="text-sm font-black text-gray-900">{c.batches || 0}</p>
                </div>
              </div>
            </button>
          </div>
        )
      })}

      {/* + Add Branch */}
      {adding ? (
        <div className="bg-white border-2 border-brand-300 rounded-2xl p-5 flex flex-col">
          <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center mb-4">
            <Plus size={20} className="text-brand-600" />
          </div>
          <input
            autoFocus
            type="text"
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            placeholder="Branch name (e.g. Andheri)"
            className="input mb-2 text-base font-bold"
          />
          <input
            type="text"
            value={newBranchAddress}
            onChange={e => setNewBranchAddress(e.target.value)}
            placeholder="Address (optional)"
            className="input mb-3 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={onConfirmAdd} disabled={!newBranch.trim()} className="flex-1 btn-primary py-2 text-sm justify-center disabled:opacity-50">
              <Check size={14} /> Add
            </button>
            <button onClick={onCancelAdd} className="btn-secondary py-2 text-sm px-3 justify-center"><X size={14} /></button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartAdd}
          className="border-2 border-dashed border-gray-200 hover:border-brand-300 hover:bg-brand-50/40 rounded-2xl p-5 flex flex-col items-center justify-center text-center transition min-h-[180px] group"
        >
          <div className="w-12 h-12 bg-gray-100 group-hover:bg-brand-100 rounded-2xl flex items-center justify-center mb-2 transition">
            <Plus size={22} className="text-gray-400 group-hover:text-brand-600 transition" />
          </div>
          <p className="text-sm font-bold text-gray-700 group-hover:text-brand-700 transition">Add Branch</p>
          <p className="text-[11px] text-gray-400 mt-1">Within {sportName}</p>
        </button>
      )}
    </div>

    {/* Edit modal */}
    {editingBranch && (
      <EditBranchModal
        initial={editingBranch}
        staffList={eligibleStaff}
        onCancel={onCancelEdit}
        onSave={onSaveEdit}
      />
    )}

    {/* 3-step delete dialog */}
    {deletingBranch && (
      <DeleteBranchDialog
        branch={deletingBranch}
        studentCount={studentsInBranch(deletingBranch.id)}
        setDeletingBranch={setDeletingBranch}
        onConfirm={onConfirmDelete}
      />
    )}
  </>)
}

// ── Edit branch modal ───────────────────────────────────────────────
function EditBranchModal({ initial, staffList = [], onCancel, onSave }) {
  const [name,      setName]      = useState(initial.branchName || '')
  const [address,   setAddress]   = useState(initial.address    || '')
  const [managerId, setManagerId] = useState(initial.managerId  || '')
  const [saving,    setSaving]    = useState(false)
  // Only offer staff who are free (no branch) or already in THIS branch — a
  // staff member assigned to another branch shouldn't manage this one.
  // Always keep the current manager visible even if data is inconsistent.
  const options = staffList.filter(s =>
    s.id === initial.managerId || !s.branchId || s.branchId === initial.id
  )
  const submit = async () => {
    setSaving(true)
    try { await onSave({ branchName: name, address, managerId: managerId || null }) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-gray-900">Edit branch</h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">Branch name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Address <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, landmark…" />
          </div>
          <div>
            <label className="label">
              Branch manager <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              className="input"
              value={managerId}
              onChange={e => setManagerId(e.target.value)}
            >
              <option value="">— No manager —</option>
              {options.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {options.length === 0 ? (
              <p className="text-[11px] text-gray-400 mt-1">
                Add staff to this sport first to assign a manager.
              </p>
            ) : (
              <p className="text-[11px] text-indigo-600 mt-1.5 leading-snug">
                <ShieldCheck size={10} className="inline -mt-0.5 mr-1" />
                Branch manager gets <strong>full permissions</strong> for this branch — students, payments, attendance, batches, staff, settings. Their access is scoped to this branch only.
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onCancel} className="flex-1 btn-secondary py-2 justify-center">Cancel</button>
          <button onClick={submit} disabled={!name.trim() || saving} className="flex-1 btn-primary py-2 justify-center disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 3-step delete confirmation dialog ───────────────────────────────
function DeleteBranchDialog({ branch, studentCount, setDeletingBranch, onConfirm }) {
  const close = () => setDeletingBranch(null)
  const next  = () => setDeletingBranch({ ...branch, step: branch.step + 1 })
  const back  = () => setDeletingBranch({ ...branch, step: branch.step - 1 })

  // Step 1 — initial warning
  // Step 2 — type-to-confirm (must type the branch name exactly)
  // Step 3 — final "hold to confirm" with explicit checkbox
  const typedMatch = (branch.typed || '').trim() === branch.branchName
  const finalReady = branch.finalCheck === true

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-black text-red-900">Delete branch — step {branch.step} of 3</p>
            <p className="text-[11px] text-red-700 mt-0.5">This action is permanent.</p>
          </div>
          <button onClick={close} className="text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>

        {/* Body — switches per step */}
        <div className="p-5">
          {branch.step === 1 && (
            <>
              <p className="text-sm text-gray-700 mb-2">
                You're about to delete <strong>{branch.branchName}</strong> from <strong>{branch.sportName}</strong>.
              </p>
              {studentCount > 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  <strong>Blocked:</strong> {studentCount} student{studentCount !== 1 ? 's' : ''} {studentCount !== 1 ? 'are' : 'is'} still assigned to this branch. Reassign them before deleting.
                </div>
              ) : (
                <p className="text-xs text-gray-500 leading-relaxed">
                  No students are assigned. Batches and trials linked to this branch will also lose their branch tag (their data is not deleted).
                </p>
              )}
            </>
          )}
          {branch.step === 2 && (
            <>
              <p className="text-sm text-gray-700 mb-3">
                Type <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-bold">{branch.branchName}</code> below to confirm:
              </p>
              <input
                autoFocus
                className={`input font-bold ${branch.typed && !typedMatch ? 'border-red-400' : ''}`}
                value={branch.typed || ''}
                onChange={(e) => setDeletingBranch({ ...branch, typed: e.target.value })}
                placeholder={branch.branchName}
              />
              {branch.typed && !typedMatch && (
                <p className="text-[11px] text-red-500 mt-1">Doesn't match — type the branch name exactly.</p>
              )}
            </>
          )}
          {branch.step === 3 && (
            <>
              <p className="text-sm text-gray-700 mb-3">
                Last check. Once you click <strong>Delete forever</strong>, <strong>{branch.branchName}</strong> is gone.
              </p>
              <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!branch.finalCheck}
                  onChange={(e) => setDeletingBranch({ ...branch, finalCheck: e.target.checked })}
                  className="mt-0.5"
                />
                <span>I understand this cannot be undone.</span>
              </label>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 border-t border-gray-100 px-5 py-3 flex gap-2 justify-end">
          {branch.step > 1 && (
            <button onClick={back} className="btn-secondary py-2 px-3 text-xs">Back</button>
          )}
          <button onClick={close} className="btn-secondary py-2 px-3 text-xs">Cancel</button>
          {branch.step < 3 ? (
            <button
              onClick={next}
              disabled={
                (branch.step === 1 && studentCount > 0) ||
                (branch.step === 2 && !typedMatch)
              }
              className="btn-primary py-2 px-4 text-xs disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={onConfirm}
              disabled={!finalReady}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-lg py-2 px-4 text-xs transition"
            >
              <Trash2 size={12} className="inline mr-1" /> Delete forever
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
