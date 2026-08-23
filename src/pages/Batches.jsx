import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { Layers, Plus, Users, Clock, UserCog, AlertCircle, X, ChevronRight, Pencil, Trash2, UserPlus, Search, UserMinus, Link2, Unlink, Check } from 'lucide-react'
import { slotSummary, groupRowsByPattern } from '../lib/batchCapacity'
import { Modal } from './Students'
import { SPORTS } from '../data/mockData'
import DevFillButton from '../components/DevFillButton'
import { fillBatch } from '../lib/devFill'
import { fetchBatchEnrolments, assignStudentToBatch, unassignStudentFromBatch } from '../lib/db'
import { logAudit, ACTIONS } from '../lib/audit'
import StudentAvatar from '../components/StudentAvatar'
import { FOOTBALL_POSITIONS, POSITION_COLORS } from '../lib/performance'
import { updateStudentPosition } from '../lib/db'

// One consistent brand-blue treatment for every batch card header — matches
// the rest of the app's accent color instead of cycling through unrelated
// hues per card index.
const BRAND_HEX = '#2563eb'
const NAVY_HEX  = '#0f172a'

export default function Batches() {
  const { batches, addBatch, updateBatch, deleteBatch, staff, students, updateBatchCoach, branches, selectedSport, selectedBranch, role, user, hasPermission,
          batchRoster, refreshBatchEnrolments,
          batchSlots, saveBatchSlot, groupBatchesIntoSlot, removeBatchSlot } = useApp()
  const canManageBatches  = hasPermission('batches.manage')
  const canManageStudents = hasPermission('students.manage')
  // Branch is mandatory — a branchless batch would show across every branch.
  const branchReady = role === 'staff' ? !!user?.branchId : !!selectedBranch
  const [showModal, setShowModal] = useState(false)
  const [editingBatch, setEditingBatch] = useState(null)
  const [selectedBatch, setSelectedBatch] = useState(null)
  const [activeBranch, setActiveBranch] = useState('All')
  // Grouping batches onto one shared ground (slot). Kept as page state rather
  // than a route so leaving the page cannot strand a half-built group.
  const [groupMode,   setGroupMode]   = useState(false)
  const [pickedIds,   setPickedIds]   = useState(() => new Set())
  const [draftName,   setDraftName]   = useState('')
  const [draftCap,    setDraftCap]    = useState(20)
  const [editingSlot, setEditingSlot] = useState(null)   // slot being re-edited, if any
  const [slotSaving,  setSlotSaving]  = useState(false)
  const [slotError,   setSlotError]   = useState('')

  // Reset branch tab + selected batch when scope changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveBranch('All'); setSelectedBatch(null) }, [selectedSport, selectedBranch])

  const activeStudents = useMemo(() => students.filter(s => s.status === 'Active'), [students])

  // Per batch: the live roster count AND the student ids behind it. The ids are
  // what let the summary count unique PEOPLE. A daily student legitimately sits
  // in an MWF and a TTS batch on one fee, and summing per-batch counts reported
  // him as two students.
  const { countByBatch, idsByBatch } = useMemo(() => {
    const counts = {}
    const ids    = {}
    batches.forEach(b => {
      const roster = batchRoster(b.id, b.name, activeStudents)
      counts[b.id] = roster.length
      ids[b.id]    = roster.map(s => s.id)
    })
    return { countByBatch: counts, idsByBatch: ids }
  }, [batches, activeStudents, batchRoster])

  // Unique people across a set of batches (deduplicates multi-batch students).
  const uniqueStudents = (list) => new Set(list.flatMap(b => idsByBatch[b.id] || [])).size
  // Seats occupied — the sum. Correct to double-count here: two batches really
  // do give up two seats for the same student.
  const totalEnrolments = (list) => list.reduce((n, b) => n + (countByBatch[b.id] || 0), 0)

  // ── Shared ground capacity (0184) ─────────────────────────────────────
  // Batches pointing at the same slot stand on one patch of grass. Their real
  // limit is per DAY, shared — not three independent per-batch numbers. The
  // rule lives in src/lib/batchCapacity.js and is mirrored by the DB trigger,
  // so what this shows is what the server will actually allow.
  const rosterOf = useMemo(
    () => (b) => batchRoster(b.id, b.name, activeStudents),
    [batchRoster, activeStudents]
  )
  const countOf = useMemo(
    () => (b) => countByBatch[b.id] || 0,
    [countByBatch]
  )

  const slotById = useMemo(() => new Map(batchSlots.map(s => [s.id, s])), [batchSlots])

  // { slotId → slotSummary }. Only slots that still have member batches; a slot
  // whose batches were all detached has nothing to report.
  const slotInfo = useMemo(() => {
    const out = new Map()
    batchSlots.forEach(slot => {
      const members = batches.filter(b => b.slotId === slot.id)
      if (members.length === 0) return
      out.set(slot.id, slotSummary({ slot, slotBatches: members, rosterOf, countOf }))
    })
    return out
  }, [batchSlots, batches, rosterOf, countOf])

  // Per-batch seat detail, keyed by batch id, pulled out of its slot summary.
  const seatByBatch = useMemo(() => {
    const out = {}
    slotInfo.forEach(info => info.batches.forEach(r => { out[r.batch.id] = r }))
    return out
  }, [slotInfo])

  // Live preview while the owner is still picking batches — same function, fed
  // an unsaved slot. Seeing "Mon 20/20" BEFORE committing is the whole point.
  const draftPreview = useMemo(() => {
    if (!groupMode || pickedIds.size === 0) return null
    const members = batches.filter(b => pickedIds.has(b.id))
    return slotSummary({
      slot: { capPerDay: Number(draftCap) || 0 },
      slotBatches: members, rosterOf, countOf,
    })
  }, [groupMode, pickedIds, draftCap, batches, rosterOf, countOf])

  const refreshEnrolments = refreshBatchEnrolments

  // Pick a single "home" sport for grouping a batch in the UI.
  // Prefer the currently-selected sport if the batch belongs to it, else first.
  // Avoids the old length-sort heuristic that grouped "Cricket Advanced" batches
  // under that label even when the user had selected "Cricket".
  const getBatchSection = (b) => {
    const sports = Array.isArray(b.sports) ? b.sports : (b.sports ? [String(b.sports)] : [])
    if (sports.length === 0) return null
    if (selectedSport && sports.includes(selectedSport)) return selectedSport
    return sports[0]
  }

  // Build the branch tab list from primary sports only — no ghost tabs for secondary sports.
  const branchList = useMemo(() => {
    const set = new Set()
    batches.forEach(b => { const s = getBatchSection(b); if (s) set.add(s) })
    return [...set].sort()
  }, [batches])

  // Grouped sections — each batch in exactly one section
  const grouped = useMemo(() => {
    if (branchList.length === 0) return null
    return branchList.map(br => ({
      branch: br,
      batches: batches.filter(b => getBatchSection(b) === br),
    }))
  }, [branchList, batches])

  // Active branch filter — also exclusive
  const visibleBatches = activeBranch === 'All'
    ? batches
    : batches.filter(b => getBatchSection(b) === activeBranch)

  // Seats Free — this tile used to sum each batch's leftovers independently,
  // which counted the same patch of grass once per batch standing on it. A
  // morning U15 slot with a TTS, an MWF and a Daily batch claimed 60 free
  // seats on a ground that holds 20.
  //
  // Now a SLOT contributes once, and only its tightest day. That is the
  // number you can promise whoever walks in next: an alternate-day student
  // might still fit on a looser day, but never fewer than this. Under-
  // promising on capacity is the safe direction to be wrong in.
  const seatsFree = useMemo(() => {
    const countedSlots = new Set()
    return visibleBatches.reduce((total, b) => {
      if (b.slotId && slotInfo.has(b.slotId)) {
        if (countedSlots.has(b.slotId)) return total
        countedSlots.add(b.slotId)
        const rows = slotInfo.get(b.slotId).rows
        return total + (rows.length ? Math.min(...rows.map(r => r.free)) : 0)
      }
      return total + Math.max(0, (b.capacity || 0) - (countByBatch[b.id] || 0))
    }, 0)
  }, [visibleBatches, slotInfo, countByBatch])

  const handleAdd = async (b) => {
    await addBatch(b)
    setShowModal(false)
  }

  // ── Grouping handlers ────────────────────────────────────────────────
  const exitGroupMode = () => {
    setGroupMode(false); setPickedIds(new Set()); setEditingSlot(null)
    setDraftName(''); setDraftCap(20); setSlotError('')
  }

  const togglePicked = (id) => setPickedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Re-open an existing slot for editing: preselect its batches so the owner
  // can add or drop one in the same pass as changing the cap.
  const openSlotForEdit = (slot) => {
    setGroupMode(true)
    setEditingSlot(slot)
    setDraftName(slot.name)
    setDraftCap(slot.capPerDay)
    setPickedIds(new Set(batches.filter(b => b.slotId === slot.id).map(b => b.id)))
    setSlotError('')
  }

  const handleSaveSlot = async () => {
    setSlotSaving(true); setSlotError('')
    try {
      const slot = await saveBatchSlot({
        id: editingSlot?.id ?? null,
        name: draftName.trim(),
        capPerDay: Number(draftCap),
        branchId: editingSlot?.branchId
          ?? batches.find(b => pickedIds.has(b.id))?.branchId
          ?? selectedBranch ?? null,
      })
      const picked = [...pickedIds]
      await groupBatchesIntoSlot(picked, slot.id)
      // Batches dropped from an existing slot must be detached explicitly —
      // secure_set_batch_slot only touches the ids it is handed.
      if (editingSlot) {
        const dropped = batches
          .filter(b => b.slotId === editingSlot.id && !pickedIds.has(b.id))
          .map(b => b.id)
        if (dropped.length) await groupBatchesIntoSlot(dropped, null)
      }
      exitGroupMode()
    } catch (e) {
      setSlotError(e?.message || 'Could not save this slot.')
    } finally {
      setSlotSaving(false)
    }
  }

  const handleUngroupSlot = async (slot) => {
    setSlotSaving(true); setSlotError('')
    try {
      await removeBatchSlot(slot.id)
      exitGroupMode()
    } catch (e) {
      setSlotError(e?.message || 'Could not remove this slot.')
    } finally {
      setSlotSaving(false)
    }
  }

  const handleEdit = async (b) => {
    const updated = await updateBatch(editingBatch.id, b)
    if (updated) {
      setSelectedBatch(prev => prev && prev.id === editingBatch.id
        ? { ...prev, ...updated, sports: updated.sports || [], days: updated.days || [],
            startTime: updated.start_time, endTime: updated.end_time,
            ageMin: updated.age_min, ageMax: updated.age_max, ground: updated.ground || null }
        : prev)
    }
    setEditingBatch(null)
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">Batches</h2>
          <p className="text-xs text-gray-500">Tap a batch to view details &amp; manage students</p>
        </div>
        {canManageBatches && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              className={`shrink-0 px-3 py-2 rounded-lg text-sm font-bold border transition inline-flex items-center gap-1.5 ${
                groupMode
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              title="Group batches that share one ground so they share its daily limit"
              onClick={() => (groupMode ? exitGroupMode() : setGroupMode(true))}>
              {groupMode ? <X size={15} /> : <Link2 size={15} />}
              <span className="hidden sm:inline">{groupMode ? 'Cancel' : 'Group batches'}</span>
            </button>
            <button
              className="btn-primary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!branchReady || groupMode}
              title={branchReady ? '' : 'Open a specific branch first to create a batch'}
              onClick={() => branchReady && setShowModal(true)}>
              <Plus size={15} /> <span className="hidden sm:inline">Create Batch</span><span className="sm:hidden">New</span>
            </button>
          </div>
        )}
      </div>

      {/* Branch jump pills */}
      {branchList.length > 0 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
          <button
            onClick={() => setActiveBranch('All')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-bold border transition ${activeBranch === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
          >
            All <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === 'All' ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.length}</span>
          </button>
          {branchList.map(br => (
            <button key={br} onClick={() => setActiveBranch(br)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-bold border transition ${activeBranch === br ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200'}`}>
              {br} <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${activeBranch === br ? 'bg-white/20' : 'bg-gray-100'}`}>{batches.filter(b => getBatchSection(b) === br).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Summary row */}
      {/* Students vs Enrolments are deliberately two separate numbers. A daily
          student in an MWF and a TTS batch is ONE student holding TWO seats;
          collapsing them into a single "Enrolled" tile made the headcount grow
          every time someone was added to a second batch. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { val: visibleBatches.length, label: 'Batches', color: 'text-gray-900' },
          { val: uniqueStudents(visibleBatches), label: 'Students', color: 'text-brand-600' },
          { val: totalEnrolments(visibleBatches), label: 'Enrolments', color: 'text-brand-500' },
          { val: visibleBatches.reduce((s,b) => s + (b.waitlist || 0), 0), label: 'Waitlist', color: 'text-amber-600' },
          { val: seatsFree, label: 'Seats Free', color: 'text-gray-400' },
        ].map(({ val, label, color }) => (
          <div key={label} className="card p-3 text-center">
            <p className={`text-2xl font-black ${color}`}>{val}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Group mode: pick the batches that share one ground ── */}
      {groupMode && (
        <div className="card p-4 border-2 border-gray-900 space-y-3">
          <div className="flex items-start gap-2">
            <Link2 size={16} className="text-gray-900 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-black text-gray-900">
                {editingSlot ? `Editing "${editingSlot.name}"` : 'Group batches onto one ground'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Tick every batch that stands on the same ground at the same time. They&apos;ll share
                one daily limit instead of each keeping its own.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Slot name</label>
              <input className="input" value={draftName} placeholder="e.g. Morning · Ground A"
                onChange={e => setDraftName(e.target.value)} />
            </div>
            <div>
              <label className="label">Ground holds (students per day)</label>
              <input className="input" type="number" min={1} value={draftCap}
                onChange={e => setDraftCap(e.target.value)} />
            </div>
          </div>

          {/* Live day preview — the reason this panel exists. Seeing "Mon 20/20"
              BEFORE committing is what stops a slot being created already broken. */}
          {draftPreview && draftPreview.days.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 mb-1.5">
                {pickedIds.size} batch{pickedIds.size === 1 ? '' : 'es'} selected ·
                {' '}{draftPreview.headcount} student{draftPreview.headcount === 1 ? '' : 's'} on this ground
              </p>
              <DayLoadStrip
                rows={groupRowsByPattern(
                  draftPreview.rows,
                  batches.filter(b => pickedIds.has(b.id)),
                  draftPreview.days,
                )}
                cap={Number(draftCap) || 0}
              />
              {draftPreview.anyOver && (
                <p className="text-[11px] text-red-600 mt-1.5 flex items-start gap-1">
                  <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                  Some days are already over this limit. Existing students stay put — new
                  enrolments on those days are blocked until it drains or you raise the number.
                </p>
              )}
            </div>
          )}

          {slotError && (
            <p className="text-xs text-red-600 flex items-start gap-1">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{slotError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {editingSlot && (
              <button className="px-3 py-2 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:opacity-50"
                disabled={slotSaving} onClick={() => handleUngroupSlot(editingSlot)}>
                <Unlink size={14} /> Ungroup
              </button>
            )}
            <button className="btn-secondary" onClick={exitGroupMode} disabled={slotSaving}>Cancel</button>
            <button className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={slotSaving || pickedIds.size < 2 || !draftName.trim() || Number(draftCap) < 1}
              title={pickedIds.size < 2 ? 'Pick at least two batches' : ''}
              onClick={handleSaveSlot}>
              {slotSaving ? 'Saving…' : editingSlot ? 'Save slot' : 'Create slot'}
            </button>
          </div>
        </div>
      )}

      {/* ── Existing slots: the day table that per-batch numbers can't show ── */}
      {!groupMode && [...slotInfo.entries()].map(([slotId, info]) => {
        const slot = slotById.get(slotId)
        // Respect the active sport/branch tab. A slot whose batches are all
        // filtered out belongs to another part of the academy — showing its
        // day table here would leak another branch's headcount onto this one.
        if (!slot || !visibleBatches.some(b => b.slotId === slotId)) return null
        return (
          <div key={slotId} className="card p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900 flex items-center gap-1.5">
                  <Link2 size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="truncate">{slot.name}</span>
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {info.batches.length} batches share this ground ·
                  {' '}{info.headcount} student{info.headcount === 1 ? '' : 's'} ·
                  {' '}holds {slot.capPerDay}/day
                </p>
              </div>
              {canManageBatches && (
                <button onClick={() => openSlotForEdit(slot)}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition flex-shrink-0"
                  title="Edit this slot">
                  <Pencil size={13} />
                </button>
              )}
            </div>
            <DayLoadStrip
              rows={groupRowsByPattern(info.rows, info.batches.map(r => r.batch), info.days)}
              cap={slot.capPerDay}
            />
          </div>
        )
      })}

      {/* ── Grouped branch sections (when branches configured) ── */}
      {grouped && activeBranch === 'All' ? (
        <div className="space-y-8">
          {grouped.map(({ branch, batches: branchBatches }) => (
            <div key={branch}>
              {/* Branch heading */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-2 h-6 bg-brand-600 rounded-full" />
                <h3 className="text-base font-black text-gray-900">{branch}</h3>
                <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                  {branchBatches.length} batch{branchBatches.length !== 1 ? 'es' : ''} · {uniqueStudents(branchBatches)} student{uniqueStudents(branchBatches) !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {branchBatches.map((b) => (
                  <BatchCard key={b.id} b={b} liveCount={countByBatch[b.id] || 0} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} canEdit={canManageBatches} seat={seatByBatch[b.id]} selectable={groupMode} selected={pickedIds.has(b.id)} onToggleSelect={togglePicked} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : visibleBatches.length === 0 ? (
        <div className="card p-10 text-center">
          <Layers size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">No batches in {activeBranch}</p>
        </div>
      ) : (
        /* Single branch selected — flat grid */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleBatches.map((b) => (
            <BatchCard key={b.id} b={b} liveCount={countByBatch[b.id] || 0} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} canEdit={canManageBatches} seat={seatByBatch[b.id]} selectable={groupMode} selected={pickedIds.has(b.id)} onToggleSelect={togglePicked} />
          ))}
        </div>
      )}

      {/* Fallback flat grid when no branches configured */}
      {!grouped && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {batches.map((b) => <BatchCard key={b.id} b={b} liveCount={countByBatch[b.id] || 0} staff={staff} onSelect={setSelectedBatch} onEdit={setEditingBatch} canEdit={canManageBatches} seat={seatByBatch[b.id]} selectable={groupMode} selected={pickedIds.has(b.id)} onToggleSelect={togglePicked} />)}
        </div>
      )}

      {showModal && <AddBatchModal onClose={() => setShowModal(false)} onSave={handleAdd} staff={staff} />}

      {editingBatch && (
        <AddBatchModal
          onClose={() => setEditingBatch(null)}
          onSave={handleEdit}
          staff={staff}
          initialData={editingBatch}
        />
      )}

      {selectedBatch && (
        <BatchDetailPanel
          batch={selectedBatch}
          students={students}
          staff={staff}
          canManageBatches={canManageBatches}
          canManageStudents={canManageStudents}
          onClose={() => setSelectedBatch(null)}
          onEdit={() => { setEditingBatch(selectedBatch); setSelectedBatch(null) }}
          onDelete={async () => { await deleteBatch(selectedBatch.id); setSelectedBatch(null) }}
          onAssignCoach={async (id, name) => {
            await updateBatchCoach(id, name)
            setSelectedBatch(prev => ({ ...prev, coach: name }))
          }}
          onEnrolledChange={refreshEnrolments}
        />
      )}
    </div>
  )
}

// One tile per batch-day PATTERN the ground runs (MWF / TTS / Daily / …),
// not one per weekday — bodies standing on it, out of the slot's limit. This
// is the view a per-batch number can never give you — a daily student shows
// up on every day, an alternate only on their own batch's days, and the
// pattern that fills first is what actually blocks the next enrolment.
function DayLoadStrip({ rows, cap }) {
  if (!rows?.length) return null
  const nearlyFull = Math.max(1, Math.round((cap || 0) * 0.15))
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
      {rows.map(r => {
        const tone = r.over          ? 'bg-red-100 text-red-700 border-red-300'
                   : r.full          ? 'bg-red-50 text-red-600 border-red-200'
                   : r.free <= nearlyFull ? 'bg-amber-50 text-amber-700 border-amber-200'
                   : 'bg-gray-50 text-gray-600 border-gray-200'
        return (
          <div key={r.label} title={r.days.join(', ')}
            className={`rounded-lg border px-2 py-1.5 text-center ${tone}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide opacity-60">{r.label}</p>
            <p className="text-sm font-black leading-tight">
              {r.occupied}<span className="opacity-40 font-bold">/{cap}</span>
            </p>
            <p className="text-[9px] font-bold opacity-70">
              {r.over ? `${r.occupied - cap} over` : r.full ? 'FULL' : `${r.free} free`}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function BatchCard({ b, liveCount = 0, staff = [], onSelect, onEdit, canEdit,
                     seat = null, selectable = false, selected = false, onToggleSelect }) {
  const enrolled      = liveCount
  const pct           = Math.min(Math.round((enrolled / b.capacity) * 100), 100)
  // A grouped batch is full when EITHER its own cap or the shared ground is
  // out of room on a day it runs — seat.altFree already folds both together.
  const isFull        = seat ? seat.altFree === 0 : enrolled >= b.capacity
  const hex           = BRAND_HEX
  const barColor      = isFull ? '#ef4444' : pct > 80 ? '#f59e0b' : hex
  const todayDayShort = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]

  const coachStaff = b.coach ? staff.find(s => s.name === b.coach) : null

  return (
    <div
      onClick={selectable ? () => onToggleSelect?.(b.id) : undefined}
      className={`bg-white rounded-2xl shadow-sm transition-all border relative ${
        selectable ? 'cursor-pointer' : 'hover:shadow-lg active:scale-[0.98]'
      } ${selected ? 'border-gray-900 ring-2 ring-gray-900' : 'border-gray-200'}`}>
      {/* Selection tick — only in group mode, where the whole card is the target */}
      {selectable && (
        <div className={`absolute top-3 right-3 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition ${
          selected ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white/90 border-white/60'
        }`}>
          {selected && <Check size={14} strokeWidth={3} />}
        </div>
      )}
      {/* Header — click opens detail panel. Solid deep-navy band, inset with
          its own rounded corners so adjacent cards read as clearly separate
          chips instead of merging into one dark strip at a glance. */}
      <div className="p-2 pb-0">
        <div
          className={`relative rounded-xl px-4 pt-3.5 pb-3.5 ${selectable ? '' : 'cursor-pointer'}`}
          style={{ background: NAVY_HEX }}
          onClick={() => { if (!selectable) onSelect(b) }}
        >
          {/* Edit button top-right */}
          {canEdit && !selectable && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(b) }}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition"
              title="Edit batch"
            >
              <Pencil size={12} />
            </button>
          )}

          {/* Sport badge */}
          {b.sports?.length > 0 && (
            <span className="inline-block text-[10px] font-bold text-white/80 bg-white/10 px-2 py-0.5 rounded-full mb-1.5">
              {b.sports[0]}
            </span>
          )}

          {/* Batch name + code on one line — stacking them as two near-identical
              lines ("Under 15" / "u15") read as a duplicated title. The code is
              now a small trailing tag instead of a second line. */}
          <div className="flex items-baseline gap-1.5 min-w-0 pr-8">
            <h3 className="font-bold text-white text-base leading-snug truncate">{b.name}</h3>
            {b.code && <span className="font-mono text-[10px] text-white/40 flex-shrink-0">{b.code}</span>}
          </div>

          {/* Schedule */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
            {b.time && (
              <span className="flex items-center gap-1 text-white/60 text-xs">
                <Clock size={10} className="flex-shrink-0" />{b.time}
              </span>
            )}
            {b.days?.map(d => (
              <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                d === todayDayShort ? 'bg-white/25 text-white' : 'bg-white/10 text-white/40'
              }`}>{d}</span>
            ))}
          </div>
          {b.ground && <p className="text-white/40 text-[10px] mt-1 truncate">{b.ground}</p>}
        </div>
      </div>

      {/* Card body */}
      <div className={`px-4 py-3 ${selectable ? '' : 'cursor-pointer'}`}
           onClick={() => { if (!selectable) onSelect(b) }}>
        {/* Capacity bar */}
        <div className="mb-2">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">{enrolled} / {b.capacity} students</span>
            <span className="font-bold" style={{ color: barColor }}>{pct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
          </div>
          {/* Shared-ground seats. TWO numbers, because they genuinely differ:
              an alternate-day kid only needs this batch's days, a daily kid
              needs every day the ground runs. An MWF batch can be wide open
              for alternates and completely shut for dailies at once — which
              is exactly the case the old single number got wrong. */}
          {seat && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-bold">
              <Link2 size={10} className="text-gray-400 flex-shrink-0" />
              <span className={seat.altFree === 0 ? 'text-red-600' : 'text-gray-600'}>
                {seat.altFree} alt-day
              </span>
              <span className="text-gray-300">·</span>
              <span className={seat.dailyFree === 0 ? 'text-red-600' : 'text-gray-600'}>
                {seat.dailyFree} daily
              </span>
              <span className="text-gray-400 font-medium">seats left</span>
            </div>
          )}
        </div>

        {/* Status badges + age */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className={`badge text-[10px] ${b.batchType === 'advance' ? 'badge-purple' : 'badge-blue'}`}>
            {b.batchType === 'advance' ? 'Advance' : 'Development'}
          </span>
          {isFull && <span className="badge badge-red text-[10px]">Full</span>}
          {!isFull && b.waitlist > 0 && <span className="badge badge-yellow text-[10px]">{b.waitlist} waitlist</span>}
          {(b.ageMin > 0 || b.ageMax < 99) && (
            <span className="text-[11px] text-gray-400">Ages {b.ageMin}–{b.ageMax} yrs</span>
          )}
        </div>

        {/* Coach footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            {coachStaff?.photoUrl ? (
              <img src={coachStaff.photoUrl} alt={b.coach}
                className="w-7 h-7 rounded-full object-cover flex-shrink-0 border-2 border-white shadow-sm" />
            ) : (
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black text-white flex-shrink-0 shadow-sm"
                style={{ background: hex }}>
                {(b.coach || 'U')[0]}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-700 truncate">{b.coach || 'Unassigned'}</p>
              <p className="text-[10px] text-gray-400">Coach</p>
            </div>
          </div>
          <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
        </div>
      </div>
    </div>
  )
}

const ALL_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// Training level of a batch. Mirrors the batches.batch_type CHECK (migration 0157) —
// keep the values in sync if that constraint ever changes.
const BATCH_TYPES = [
  { value: 'development', label: 'Development', hint: 'Beginners & skill building' },
  { value: 'advance',     label: 'Advance',     hint: 'Competitive / elite squad' },
]

function AddBatchModal({ onClose, onSave, staff, initialData }) {
  const { selectedSport, selectedBranch, sportBranches, user, role } = useApp()
  const isEdit = !!initialData
  // Sport context: owners use the selected-sport switcher; staff use their single
  // assigned sport. When there's one clear sport, lock the new batch to it (no picker).
  const staffSport  = role !== 'owner' && user?.sports?.length === 1 ? user.sports[0] : null
  const scopedSport = (selectedSport && selectedSport !== 'All') ? selectedSport : staffSport
  const defaultSports = initialData?.sports ?? (scopedSport ? [scopedSport] : [])
  // Locked on create whenever a sport is scoped (unchanged). Also locked on
  // edit, but ONLY when the batch is already a clean single-sport match for
  // the current scope — editing a genuinely multi-sport batch, or one whose
  // sport doesn't match the active view, still needs the full picker so its
  // real tags stay visible and editable instead of being hidden behind a
  // chip that only shows one of them.
  const sportLocked = Boolean(scopedSport) && (
    !isEdit || (defaultSports.length === 1 && defaultSports[0] === scopedSport)
  )
  const branchName = selectedBranch
    ? sportBranches.find(b => b.id === selectedBranch)?.branchName
    : null
  const [form, setForm] = useState({
    name:        initialData?.name        || '',
    code:        initialData?.code        || '',
    startTime:   initialData?.startTime   || '',
    endTime:     initialData?.endTime     || '',
    sports:      defaultSports,
    coach:       initialData?.coach       || staff[0]?.name || '',
    capacity:    initialData?.capacity    || 20,
    days:        initialData?.days        || [],
    ageMin:      initialData?.ageMin      ?? 0,
    ageMax:      initialData?.ageMax      ?? 99,
    ground:      initialData?.ground      || '',
    defaultFee:  initialData?.defaultFee  || 0,
    defaultPlan: initialData?.defaultPlan || 'monthly',
    batchType:   initialData?.batchType   || 'development',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleSport = (sport) => setForm(f => ({
    ...f,
    sports: f.sports.includes(sport) ? f.sports.filter(s => s !== sport) : [...f.sports, sport],
  }))

  const toggleDay = (day) => setForm(f => ({
    ...f,
    days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day],
  }))

  const sportOptions = [...new Set(
    (sportBranches || []).map(b => b.sportName).filter(Boolean).concat(SPORTS)
  )]
  // Staff may only tag a batch with sports they're assigned to — otherwise they
  // could create a batch in a sport their own sport-scoped view then hides.
  // Owners and sport-less office staff get the full catalogue.
  const pickerSports = role === 'staff' && user?.sports?.length > 0 ? user.sports : SPORTS
  const handleDevFill = () => {
    if (isEdit) return
    // Constrain the random sport to what the user is allowed to pick, so DevFill
    // can't silently set an out-of-scope sport (which would hide the new batch).
    const data = fillBatch({ sportOptions: pickerSports })
    if (sportLocked) data.sports = [scopedSport]
    setForm(f => ({ ...f, ...data, coach: staff[0]?.name || data.coach }))
  }

  return (
    <Modal title={isEdit ? `Edit Batch — ${initialData.name}` : 'Create New Batch'} onClose={onClose}>
      <div className="space-y-4">
        {!isEdit && (
          <div className="flex justify-end -mt-1 mb-1">
            <DevFillButton onFill={handleDevFill} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Batch Name *</label>
            <input className="input" placeholder="e.g. Morning Cricket U20" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label">Batch Code *</label>
            <input className="input font-mono" placeholder="e.g. u20-eve" value={form.code}
              onChange={e => set('code', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} />
            <p className="text-[11px] text-gray-400 mt-1">
              Shown to students at registration instead of the full batch name — must be unique.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Start Time</label>
            <input className="input" type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} />
          </div>
          <div>
            <label className="label">End Time</label>
            <input className="input" type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Ground / Venue <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input" placeholder="e.g. Ground A, Court 1, Indoor Hall"
            value={form.ground} onChange={e => set('ground', e.target.value)} />
        </div>
        <div>
          <label className="label">Batch Days</label>
          <div className="flex flex-wrap gap-2">
            {ALL_DAYS.map(d => (
              <button key={d} type="button" onClick={() => toggleDay(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  form.days.includes(d) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Sport</label>
          {sportLocked ? (
            <div className="input flex items-center gap-2 bg-gray-50 cursor-default">
              <span className="text-sm font-semibold text-gray-800">{scopedSport}</span>
              {branchName && <span className="text-xs text-gray-400 font-medium">· {branchName}</span>}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pickerSports.map(s => (
                <button key={s} type="button" onClick={() => toggleSport(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    form.sports.includes(s) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}>{s}</button>
              ))}
            </div>
          )}
        </div>
        <div>
          <label className="label">Batch Type</label>
          <div className="grid grid-cols-2 gap-2">
            {BATCH_TYPES.map(t => (
              <button key={t.value} type="button" onClick={() => set('batchType', t.value)}
                className={`px-3 py-2 rounded-lg text-left border transition ${
                  form.batchType === t.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}>
                <span className="block text-xs font-bold">{t.label}</span>
                <span className={`block text-[10px] ${form.batchType === t.value ? 'text-white/70' : 'text-gray-400'}`}>
                  {t.hint}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Age Min</label>
            <input className="input" type="number" min={0} value={form.ageMin} onChange={e => set('ageMin', e.target.value)} />
          </div>
          <div>
            <label className="label">Age Max</label>
            <input className="input" type="number" min={0} value={form.ageMax} onChange={e => set('ageMax', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Assigned Coach</label>
          <select className="input" value={form.coach} onChange={e => set('coach', e.target.value)}>
            {staff.filter(s => s.staffType !== 'office').map(s => <option key={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Maximum Capacity</label>
          <input className="input" type="number" min={1} value={form.capacity} onChange={e => set('capacity', Number(e.target.value))} />
        </div>

      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSave({ ...form, branchId: isEdit ? (initialData?.branchId || null) : (selectedBranch || null) })}>
          {isEdit ? 'Save Changes' : 'Create Batch'}
        </button>
      </div>
    </Modal>
  )
}

function BatchDetailPanel({ batch: b, students, staff, canManageBatches, canManageStudents, onClose, onEdit, onDelete, onAssignCoach, onEnrolledChange }) {
  const { user, reassignPrimaryBatch, batches, batchEnrolments } = useApp()
  const [mbEnrolments, setMbEnrolments] = useState([])
  const [assignSearch, setAssignSearch] = useState('')
  // The server can now refuse an enrolment (shared ground full on some day,
  // migration 0184). Its message names the day and which limit to raise, so
  // it must reach the screen — this handler used to be try/finally with no
  // catch, which turned a refusal into "nothing happened".
  const [assignError, setAssignError] = useState('')
  const [assigning, setAssigning] = useState(null)
  const [unassigning, setUnassigning] = useState(null)
  const [moveId, setMoveId]       = useState(null)   // primary student being moved
  const [movingId, setMovingId]   = useState(null)
  const [editCoach, setEditCoach] = useState(false)
  const [newCoach, setNewCoach] = useState(b.coach || '')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [posEditId, setPosEditId]   = useState(null)  // student id being position-edited
  const [posInput,  setPosInput]    = useState('')
  const [posSaving, setPosSaving]   = useState(false)
  // local position overrides: { [studentId]: positionString }
  const [localPositions, setLocalPositions] = useState({})

  const openPosEdit = (s) => { setPosEditId(s.id); setPosInput(localPositions[s.id] ?? s.position ?? '') }
  const closePosEdit = () => { setPosEditId(null); setPosInput('') }
  const savePosition = async (studentId) => {
    setPosSaving(true)
    try {
      await updateStudentPosition(studentId, posInput || null)
      setLocalPositions(prev => ({ ...prev, [studentId]: posInput || null }))
      closePosEdit()
    } catch {}
    setPosSaving(false)
  }
  const coaches = staff.filter(s => s.staffType !== 'office')

  useEffect(() => {
    fetchBatchEnrolments(b.id).then(rows => setMbEnrolments(rows)).catch(() => {})
  }, [b.id])

  const primaryEnrolled = students.filter(s => s.status === 'Active' && (s.batchId === b.id || s.batch === b.name))
  const primaryIds = useMemo(() => new Set(primaryEnrolled.map(s => s.id)), [primaryEnrolled])
  const mbStudentIds = useMemo(() => new Set(mbEnrolments.map(e => e.student_id)), [mbEnrolments])
  const mbOnly = students.filter(s => mbStudentIds.has(s.id) && !primaryIds.has(s.id) && s.status === 'Active')
  const allEnrolled = [...primaryEnrolled, ...mbOnly]
  const enrolledIds = useMemo(() => new Set(allEnrolled.map(s => s.id)), [allEnrolled])

  // Target batches for moving a primary student: other batches in the SAME
  // sport+branch (branchId is unique per sport-branch), excluding this one.
  const moveTargets = useMemo(
    () => (batches || []).filter(x => x.id !== b.id && x.branchId === b.branchId),
    [batches, b.id, b.branchId]
  )

  const doMove = async (student, target) => {
    setMovingId(student.id)
    try {
      await reassignPrimaryBatch(student, target.id, target.name)
      setMoveId(null)
      onEnrolledChange?.(b.id, -1)   // student left this batch's primary roster
    } catch { /* error toast shown by context */ }
    finally { setMovingId(null) }
  }

  const nameMatch = (s) => s.name.toLowerCase().includes(assignSearch.toLowerCase())
  // Alternate-day students pay for three days a week, so holding both halves of
  // an MWF/TTS pair would give them daily training on an alternate-day fee.
  // (Daily students in two batches are fine — one fee, six days, as intended.)
  // Mirrors the server guard in migration 0155; this is only the courtesy half.
  //
  // Two fixes over the original check:
  //   * normalise the casing — comparing to the literal 'Alternate' silently
  //     stops firing the day a row arrives lower-cased, the same trap
  //     normTrainingType() exists for in src/lib/studentRules.js
  //   * look at student_batches too, not just s.batchId — an Alternate student
  //     whose only enrolment was a student_batches row slipped through and
  //     could still be added to a second batch
  const otherBatchStudentIds = useMemo(
    () => new Set(batchEnrolments.filter(e => e.batch_id !== b.id).map(e => e.student_id)),
    [batchEnrolments, b.id]
  )
  const isAlternateBlocked = (s) =>
    (s.trainingType || '').trim().toLowerCase() === 'alternate' &&
    (otherBatchStudentIds.has(s.id) || (!!s.batchId && s.batchId !== b.id))

  const searchResults = assignSearch.trim().length >= 2
    ? students
        .filter(s => s.status === 'Active' && !enrolledIds.has(s.id) && nameMatch(s))
        .slice(0, 8)
    : []

  const handleAssign = async (student) => {
    if (isAlternateBlocked(student)) return
    // Guard: assignStudentToBatch is an UPSERT — silent no-op if already enrolled.
    // Without this check, the UI counter bumped +1 even on no-op, inflating `enrolled` beyond reality.
    if (primaryIds.has(student.id) || mbStudentIds.has(student.id)) {
      setAssignSearch('')
      return
    }
    setAssigning(student.id)
    setAssignError('')
    try {
      await assignStudentToBatch(student.id, b.id, b.name, user?.academyId)
      setMbEnrolments(prev => [...prev, { student_id: student.id, batch_id: b.id }])
      onEnrolledChange?.(b.id, 1)
      logAudit({ actor: user, action: ACTIONS.BATCH_ASSIGN, entityType: 'batch', entityId: b.id, entityName: b.name, changes: { student: student.name }, academyId: user?.academyId, sport: b.sports?.[0] ?? null, branchId: b.branchId ?? null })
      setAssignSearch('')
    } catch (e) {
      // Capacity refusals arrive here with a message written to be read
      // ("Ground full on Mon: … Raise the slot capacity"). Show it verbatim
      // rather than a generic failure — it tells the owner what to do next.
      setAssignError(e?.message || 'Could not add this student to the batch.')
    } finally {
      setAssigning(null)
    }
  }

  const handleUnassign = async (studentId) => {
    setUnassigning(studentId)
    try {
      await unassignStudentFromBatch(studentId, b.id)
      setMbEnrolments(prev => prev.filter(e => e.student_id !== studentId))
      onEnrolledChange?.(b.id, -1)
      const removedS = students.find(s => s.id === studentId)
      logAudit({ actor: user, action: ACTIONS.BATCH_UNASSIGN, entityType: 'batch', entityId: b.id, entityName: b.name, changes: { student: removedS?.name || String(studentId) }, academyId: user?.academyId, sport: b.sports?.[0] ?? null, branchId: b.branchId ?? null })
    } finally {
      setUnassigning(null)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try { await onDelete() } finally { setDeleting(false) }
  }

  const handleSaveCoach = async () => {
    setSaving(true)
    await onAssignCoach(b.id, newCoach)
    setSaving(false)
    setEditCoach(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white h-full w-full max-w-lg shadow-2xl flex flex-col animate-slide-in-right overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 px-5 pt-5 pb-6 sm:px-6 sm:pt-6 sm:pb-8">
          <div className="flex items-start justify-between mb-4">
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition">
              <X size={16} className="text-white" />
            </button>
            {canManageBatches && (
            <div className="flex items-center gap-2">
              <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-xs font-semibold">
                <Pencil size={12} /> Edit
              </button>
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/30 hover:bg-red-500/50 transition text-white text-xs font-semibold">
                <Trash2 size={12} /> Delete
              </button>
            </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-white">{b.name}</h2>
            {b.code && <span className="font-mono text-xs text-brand-300 bg-white/10 px-2 py-0.5 rounded">{b.code}</span>}
          </div>
          <p className="text-brand-200 text-sm">{b.time}</p>
          {b.ground && (
            <p className="text-brand-300 text-xs mt-0.5 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              {b.ground}
            </p>
          )}
          {b.days?.length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {b.days.map(d => {
                const isToday = d === ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()]
                return (
                  <span key={d} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                    isToday ? 'bg-white/65 text-gray-800' : 'bg-white/15 text-white/45'
                  }`}>{d}</span>
                )
              })}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{allEnrolled.length}</p>
              <p className="text-[10px] text-brand-200">Enrolled</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{Math.max(0, b.capacity - allEnrolled.length)}</p>
              <p className="text-[10px] text-brand-200">Seats Left</p>
            </div>
            <div className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-lg font-black text-white">{b.capacity > 0 ? Math.round((allEnrolled.length / b.capacity) * 100) : 0}%</p>
              <p className="text-[10px] text-brand-200">Filled</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sports */}
          {b.sports?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {b.sports.map(sp => <span key={sp} className="badge badge-blue">{sp}</span>)}
            </div>
          )}

          {/* Coach */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assigned Coach</p>
              {canManageBatches && (
                <button onClick={() => setEditCoach(e => !e)} className="text-xs text-brand-600 font-semibold hover:underline">
                  {editCoach ? 'Cancel' : 'Change'}
                </button>
              )}
            </div>
            {editCoach ? (
              <div className="flex gap-2">
                <select className="input flex-1 text-xs" value={newCoach} onChange={e => setNewCoach(e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {coaches.map(c => <option key={c.id} value={c.name}>{c.name} ({c.role})</option>)}
                </select>
                <button onClick={handleSaveCoach} disabled={saving} className="btn-primary text-xs px-3 py-2">
                  {saving ? '…' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center text-sm font-bold text-gray-600">
                  {(b.coach || 'U')[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{b.coach || 'Unassigned'}</p>
                  <p className="text-xs text-gray-400">Head Coach</p>
                </div>
              </div>
            )}
          </div>

          {/* Assign Student */}
          {canManageStudents && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus size={14} className="text-brand-600" />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assign Student</p>
            </div>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8 text-sm"
                placeholder="Type name to search…"
                value={assignSearch}
                onChange={e => { setAssignSearch(e.target.value); setAssignError('') }}
              />
            </div>
            {assignError && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-px flex-shrink-0" />
                <span>{assignError}</span>
              </p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map(s => {
                  const blocked = isAlternateBlocked(s)
                  return (
                    <div key={s.id} className={`flex items-center gap-3 px-2 py-1.5 rounded-xl transition ${blocked ? 'opacity-50' : 'hover:bg-gray-50'}`}>
                      <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={28} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                        <p className="text-xs text-gray-400">{s.sport} · {s.batch || 'No primary batch'}</p>
                      </div>
                      {blocked ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg flex-shrink-0 whitespace-nowrap">
                          Alternate — 1 batch only
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAssign(s)}
                          disabled={assigning === s.id}
                          className="text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                        >
                          {assigning === s.id ? '…' : 'Assign'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {assignSearch.trim().length >= 2 && searchResults.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-3">No students found</p>
            )}
          </div>
          )}

          {/* Student list */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Enrolled Students ({allEnrolled.length})
            </p>
            {allEnrolled.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">No active students in this batch</p>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {allEnrolled.map((s, i) => {
                  const canUnassign = mbStudentIds.has(s.id)
                  const pos = localPositions[s.id] !== undefined ? localPositions[s.id] : s.position
                  const preset = pos ? FOOTBALL_POSITIONS.find(p => p.id === pos) : null
                  const posCol = preset ? POSITION_COLORS[preset.id] : null
                  return (
                    <div key={s.id} className="rounded-xl border border-gray-100 overflow-hidden">
                      {/* Main row */}
                      <div className="flex items-center gap-3 px-2 py-2">
                        <span className="text-xs text-gray-400 w-5 flex-shrink-0">{i + 1}</span>
                        <StudentAvatar photoUrl={s.photoUrl} name={s.name} size={32} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-gray-800 truncate">{s.name}</p>
                            {s.trainingType === 'Alternate'
                              ? <span className="text-[9px] font-bold bg-violet-100 text-violet-600 px-1 py-0.5 rounded leading-none flex-shrink-0">ALT</span>
                              : <span className="text-[9px] font-bold bg-brand-100 text-brand-600 px-1 py-0.5 rounded leading-none flex-shrink-0">DAY</span>
                            }
                            {!primaryIds.has(s.id) && (
                              <span className="text-[9px] font-bold bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full flex-shrink-0">Multi</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">{s.sport} · {s.age} yrs</p>
                        </div>
                        {/* Position chip / button */}
                        {canManageStudents ? (
                          <button
                            onClick={() => posEditId === s.id ? closePosEdit() : openPosEdit(s)}
                            className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition flex-shrink-0 ${
                              pos
                                ? posCol
                                  ? `${posCol.bg} ${posCol.text} border-current`
                                  : 'bg-gray-100 text-gray-600 border-gray-200'
                                : 'bg-gray-50 text-gray-400 border-dashed border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            {pos || '+ Pos'}
                          </button>
                        ) : pos ? (
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border flex-shrink-0 ${posCol ? `${posCol.bg} ${posCol.text} border-current` : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                            {pos}
                          </span>
                        ) : null}
                        {canUnassign ? (
                          canManageStudents && (
                            <button
                              onClick={() => handleUnassign(s.id)}
                              disabled={unassigning === s.id}
                              className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition disabled:opacity-40 flex-shrink-0"
                            >
                              {unassigning === s.id ? '…' : 'Remove'}
                            </button>
                          )
                        ) : (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="badge badge-green text-[10px]">Primary</span>
                            {canManageStudents && moveTargets.length > 0 && (
                              <button
                                onClick={() => { setMoveId(moveId === s.id ? null : s.id); closePosEdit() }}
                                className="text-[10px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2 py-1 rounded-lg transition"
                              >
                                Move
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Inline position editor */}
                      {posEditId === s.id && (
                        <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
                          <input
                            className="input text-xs py-1.5 mb-2"
                            placeholder="Type position or pick below…"
                            value={posInput}
                            onChange={e => setPosInput(e.target.value)}
                            maxLength={40}
                            autoFocus
                          />
                          <div className="flex flex-wrap gap-1 mb-2">
                            {FOOTBALL_POSITIONS.map(p => {
                              const c = POSITION_COLORS[p.id]
                              const active = posInput === p.id
                              return (
                                <button key={p.id} type="button"
                                  onClick={() => setPosInput(active ? '' : p.id)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition ${
                                    active ? `${c.bg} ${c.text} border-current` : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-100'
                                  }`}>
                                  {p.id}
                                </button>
                              )
                            })}
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => savePosition(s.id)}
                              disabled={posSaving}
                              className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-50"
                            >
                              {posSaving ? '…' : 'Save'}
                            </button>
                            <button onClick={closePosEdit} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Inline "move to another batch" picker for primary students */}
                      {moveId === s.id && (
                        <div className="px-3 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Move to another batch</p>
                          <div className="flex flex-wrap gap-1.5">
                            {moveTargets.map(t => (
                              <button key={t.id} type="button" disabled={movingId === s.id}
                                onClick={() => doMove(s, t)}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-white text-gray-600 border-gray-200 hover:bg-brand-50 hover:text-brand-700 transition disabled:opacity-50">
                                {movingId === s.id ? '…' : t.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Delete trigger button — only for users who can manage batches */}
          {canManageBatches && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-red-200 text-red-600 text-sm font-bold hover:bg-red-50 active:bg-red-100 transition"
            >
              <Trash2 size={15} /> Delete Batch
            </button>
          )}

          {/* Delete confirmation */}
          {canManageBatches && confirmDelete && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={16} className="text-red-600" />
                <p className="text-sm font-bold text-red-800">Delete "{b.name}"?</p>
              </div>
              {allEnrolled.length > 0 && (
                <p className="text-xs text-red-600 mb-3">
                  ⚠ This batch has {allEnrolled.length} active student{allEnrolled.length > 1 ? 's' : ''}. Move them to another batch first, or they will lose their batch assignment.
                </p>
              )}
              <p className="text-xs text-red-600 mb-4">This cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl text-xs font-bold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Yes, Delete Batch'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
