import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { Zap, LogOut, Trophy, Users, UserCog, Layers, Plus, Sparkles, X, Check, Trash2 } from 'lucide-react'

export default function SportSelect() {
  const navigate = useNavigate()
  const {
    user, branches, allStudents, allStaff, allBatches,
    setSelectedSport, logoutOwner, dataLoading,
    addBranch, removeBranch, showToast,
  } = useApp()

  const [adding,    setAdding]    = useState(false)
  const [newSport,  setNewSport]  = useState('')
  const [removing,  setRemoving]  = useState(null) // sport name pending confirm
  const inputRef = useRef(null)

  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  // Sport list: prefer owner-managed branches; fall back to unique sports on students
  const sportList = useMemo(() => {
    if (branches && branches.length > 0) return branches
    const set = new Set()
    allStudents.forEach(s => s.sport && set.add(s.sport))
    return Array.from(set).sort()
  }, [branches, allStudents])

  // Counts per sport
  const counts = useMemo(() => {
    const map = {}
    sportList.forEach(sport => {
      map[sport] = {
        students: allStudents.filter(s => s.sport === sport).length,
        staff:    allStaff.filter(s => s.sports?.includes(sport)).length,
        batches:  allBatches.filter(b => b.sports?.includes(sport)).length,
      }
    })
    return map
  }, [sportList, allStudents, allStaff, allBatches])

  const totalCounts = useMemo(() => ({
    students: allStudents.length,
    staff:    allStaff.length,
    batches:  allBatches.length,
  }), [allStudents, allStaff, allBatches])

  const pickSport = (sport) => {
    setSelectedSport(sport)
    navigate('/dashboard')
  }

  const handleAddSport = async () => {
    const v = newSport.trim()
    if (!v) { setAdding(false); return }
    if (branches.includes(v)) {
      showToast(`${v} already exists`, 'info')
      setNewSport(''); setAdding(false); return
    }
    await addBranch(v)
    showToast(`${v} added`, 'success')
    setNewSport('')
    setAdding(false)
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
            Choose which sport you want to manage today. Students, staff, batches and payments will all be scoped to your selection.
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
              const c = counts[sport]
              const isConfirmingRemove = removing === sport
              return (
                <div
                  key={sport}
                  className="group relative bg-white border border-gray-100 hover:border-brand-300 hover:shadow-md rounded-2xl p-5 transition"
                >
                  {/* Remove button (top-right) */}
                  {isConfirmingRemove ? (
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                      <span className="text-[10px] font-bold text-red-700">Remove?</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveSport(sport) }}
                        className="p-1 rounded text-red-600 hover:bg-red-100 transition"
                        title="Confirm remove"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRemoving(null) }}
                        className="p-1 rounded text-gray-500 hover:bg-gray-100 transition"
                        title="Cancel"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRemoving(sport) }}
                      className="absolute top-3 right-3 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                      title="Remove sport"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  <button
                    onClick={() => pickSport(sport)}
                    disabled={isConfirmingRemove}
                    className="w-full text-left disabled:opacity-50"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center group-hover:bg-brand-100 transition">
                        <Trophy size={20} className="text-brand-600" />
                      </div>
                      {!isConfirmingRemove && (
                        <span className="text-[10px] font-bold text-gray-400 group-hover:text-brand-600 uppercase tracking-wider transition mt-1.5">
                          Open →
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-black text-gray-900 mb-3">{sport}</p>
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100">
                      <div>
                        <div className="flex items-center gap-1 text-gray-400 text-[10px] mb-0.5">
                          <Users size={10} /> Students
                        </div>
                        <p className="text-sm font-black text-gray-900">{c.students}</p>
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

            {/* + Add Sport card — always last */}
            {adding ? (
              <div className="bg-white border-2 border-brand-300 rounded-2xl p-5 flex flex-col">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center">
                    <Plus size={20} className="text-brand-600" />
                  </div>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={newSport}
                  onChange={(e) => setNewSport(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddSport()
                    if (e.key === 'Escape') { setNewSport(''); setAdding(false) }
                  }}
                  placeholder="e.g. Football, Tennis…"
                  className="input mb-3 text-base font-bold"
                />
                <div className="flex gap-2">
                  <button onClick={handleAddSport} className="flex-1 btn-primary py-2 text-sm justify-center">
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
                <p className="text-[11px] text-gray-400 mt-1">Football, Tennis, Cricket…</p>
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
