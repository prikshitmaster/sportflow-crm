// Payment Trail — the money view of the audit log.
//
// The generic audit list treats a ₹2,500 payment exactly like a batch rename:
// the amount is hidden behind a "Details" toggle and the summary cards count
// Added/Edited/Deleted rather than rupees. This screen answers the question the
// generic one cannot — who took how much, in what form, and what did they
// delete — which is the only version of an audit log that catches anything.
//
// Reads the same audit_logs rows the parent tab already fetched; no extra query.

import { useState, useMemo } from 'react'
import {
  IndianRupee, Trash2, Globe, Banknote, FileDown, AlertTriangle,
  TrendingUp, Users, Calendar, Search,
} from 'lucide-react'
import { saveOrShareFile } from '../lib/nativeSave'

const PAYMENT_ACTIONS = ['payment.add', 'payment.online', 'payment.remove', 'payment.mark_paid']

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })

// Live data holds both 'Owner' and 'owner' for the same person (19 rows one
// way, 23 the other). Without this, one person splits into two rows in the
// collector breakdown and neither total is right.
const normRole = (r) => {
  const s = String(r || 'Staff')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

const amountOf = (log) => {
  const raw = log?.changes?.amount
  const n = Number(String(raw ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const modeOf = (log) => log?.changes?.mode || '—'

const MODE_STYLE = {
  Cash:     'bg-amber-50 text-amber-700 border-amber-100',
  UPI:      'bg-violet-50 text-violet-700 border-violet-100',
  Razorpay: 'bg-sky-50 text-sky-700 border-sky-100',
  Card:     'bg-blue-50 text-blue-700 border-blue-100',
  Cheque:   'bg-orange-50 text-orange-700 border-orange-100',
  Bank:     'bg-teal-50 text-teal-700 border-teal-100',
}
const modeStyle = (m) => MODE_STYLE[m] || 'bg-gray-50 text-gray-600 border-gray-100'

function fmtDateHeading(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default function PaymentTrail({ logs, branchNameById, loading, todayStr }) {
  const [person, setPerson]     = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [search, setSearch]     = useState('')
  const [onlyDeletions, setOnlyDeletions] = useState(false)

  const payLogs = useMemo(
    () => (logs || [])
      .filter(l => PAYMENT_ACTIONS.includes(l.action))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [logs]
  )

  const people = useMemo(
    () => ['All', ...[...new Set(payLogs.map(l => l.actor_name).filter(Boolean))].sort()],
    [payLogs]
  )

  const filtered = useMemo(() => payLogs.filter(l => {
    if (onlyDeletions && l.action !== 'payment.remove') return false
    if (person !== 'All' && l.actor_name !== person) return false
    const d = (l.created_at || '').slice(0, 10)
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    if (search) {
      const q = search.toLowerCase()
      const hit = l.entity_name?.toLowerCase().includes(q)
        || l.actor_name?.toLowerCase().includes(q)
        || String(l.entity_id || '').toLowerCase().includes(q)
      if (!hit) return false
    }
    return true
  }), [payLogs, person, dateFrom, dateTo, search, onlyDeletions])

  // Totals are computed over the filtered set so the cards always describe the
  // rows actually on screen — a card that disagrees with the list below it is
  // worse than no card.
  const stats = useMemo(() => {
    let collected = 0, online = 0, deleted = 0, deletions = 0, cleared = 0
    for (const l of filtered) {
      if (l.action === 'payment.add')        collected += amountOf(l)
      else if (l.action === 'payment.online') { collected += amountOf(l); online += amountOf(l) }
      else if (l.action === 'payment.remove') { deleted += amountOf(l); deletions += 1 }
      else if (l.action === 'payment.mark_paid') cleared += 1
    }
    return { collected, online, deleted, deletions, cleared }
  }, [filtered])

  // Per-person breakdown: the "who did it" this screen exists for.
  const byPerson = useMemo(() => {
    const m = new Map()
    for (const l of filtered) {
      const key = l.actor_name || 'Unknown'
      if (!m.has(key)) {
        m.set(key, {
          name: key, role: normRole(l.actor_role),
          count: 0, total: 0, deletions: 0, deletedTotal: 0, modes: {},
        })
      }
      const row = m.get(key)
      if (l.action === 'payment.add' || l.action === 'payment.online') {
        row.count += 1
        row.total += amountOf(l)
        const mode = modeOf(l)
        row.modes[mode] = (row.modes[mode] || 0) + amountOf(l)
      } else if (l.action === 'payment.remove') {
        row.deletions += 1
        row.deletedTotal += amountOf(l)
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [filtered])

  const grouped = useMemo(() => {
    const m = {}
    for (const l of filtered) {
      const d = (l.created_at || '').slice(0, 10)
      ;(m[d] ||= []).push(l)
    }
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const exportCSV = async () => {
    const rows = [
      ['Date', 'Time', 'Action', 'Person', 'Role', 'Student', 'Invoice', 'Amount', 'Mode', 'Reason / Note'],
      ...filtered.map(l => {
        const dt = l.created_at ? new Date(l.created_at) : null
        return [
          dt ? dt.toLocaleDateString('en-IN') : '',
          dt ? fmtTime(l.created_at) : '',
          l.action === 'payment.add' ? 'Collected'
            : l.action === 'payment.online' ? 'Collected (online)'
            : l.action === 'payment.remove' ? 'DELETED' : 'Cheque cleared',
          l.actor_name || '', normRole(l.actor_role),
          l.entity_name || '', l.entity_id || '',
          amountOf(l) || '', modeOf(l), l.note || '',
        ]
      }),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    await saveOrShareFile(new Blob([csv], { type: 'text/csv' }), `payment-trail-${todayStr}.csv`)
  }

  const hasFilters = person !== 'All' || dateFrom || dateTo || search || onlyDeletions

  if (loading) {
    return <div className="card p-10 text-center text-sm text-gray-400">Loading payment trail…</div>
  }

  if (!payLogs.length) {
    return (
      <div className="card p-10 text-center">
        <IndianRupee size={26} className="text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-bold text-gray-500">No payment activity recorded</p>
        <p className="text-xs text-gray-400 mt-1">
          Payments recorded, deleted or cleared will appear here with who did it.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Money cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<TrendingUp size={14} />} tone="emerald"
          label="Collected" value={inr(stats.collected)}
          sub={`${filtered.filter(l => l.action === 'payment.add' || l.action === 'payment.online').length} payments`}
        />
        <StatCard
          icon={<Globe size={14} />} tone="sky"
          label="Paid online" value={inr(stats.online)}
          sub={stats.collected ? `${Math.round((stats.online / stats.collected) * 100)}% of collected` : '—'}
        />
        <StatCard
          icon={<Trash2 size={14} />} tone={stats.deletions ? 'red' : 'gray'}
          label="Deleted" value={inr(stats.deleted)}
          sub={`${stats.deletions} deletion${stats.deletions === 1 ? '' : 's'}`}
        />
        <StatCard
          icon={<Banknote size={14} />} tone="amber"
          label="Cheques cleared" value={String(stats.cleared)}
          sub="marked paid"
        />
      </div>

      {stats.deletions > 0 && (
        <button
          onClick={() => setOnlyDeletions(v => !v)}
          className={`w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-left transition ${
            onlyDeletions
              ? 'bg-red-600 border-red-600 text-white'
              : 'bg-red-50 border-red-100 text-red-700 hover:bg-red-100'
          }`}
        >
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="text-xs font-bold">
            {inr(stats.deleted)} across {stats.deletions} deleted payment{stats.deletions === 1 ? '' : 's'}
          </span>
          <span className={`text-[11px] ml-auto font-semibold ${onlyDeletions ? 'text-red-100' : 'text-red-500'}`}>
            {onlyDeletions ? 'Showing only deletions — tap to clear' : 'Review these'}
          </span>
        </button>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Student, person or invoice…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select value={person} onChange={e => setPerson(e.target.value)}
                className="px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500">
          {people.map(p => <option key={p} value={p}>{p === 'All' ? 'Everyone' : p}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
               className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
               className="px-2.5 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" />
        {hasFilters && (
          <button onClick={() => { setPerson('All'); setDateFrom(''); setDateTo(''); setSearch(''); setOnlyDeletions(false) }}
                  className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2">Clear</button>
        )}
        <button onClick={exportCSV} disabled={!filtered.length} className="btn-secondary text-xs gap-1.5">
          <FileDown size={12} /> Export
        </button>
      </div>

      {/* ── Who collected what ── */}
      {byPerson.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Users size={13} className="text-brand-600" />
            <h4 className="text-xs font-black text-gray-800 uppercase tracking-wide">Who collected what</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-50">
                  <th className="px-4 py-2 font-semibold">Person</th>
                  <th className="px-4 py-2 font-semibold text-right">Payments</th>
                  <th className="px-4 py-2 font-semibold text-right">Collected</th>
                  <th className="px-4 py-2 font-semibold">Breakdown</th>
                  <th className="px-4 py-2 font-semibold text-right">Deleted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {byPerson.map(p => (
                  <tr key={p.name} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-[10px] font-black uppercase flex-shrink-0">
                          {p.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-800 truncate">{p.name}</p>
                          <p className="text-[10px] text-gray-400">{p.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 font-semibold">{p.count}</td>
                    <td className="px-4 py-2.5 text-right font-black text-gray-900">{inr(p.total)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(p.modes).sort((a, b) => b[1] - a[1]).map(([mode, amt]) => (
                          <span key={mode} className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${modeStyle(mode)}`}>
                            {mode} {inr(amt)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {p.deletions ? (
                        <span className="text-red-600 font-bold">
                          {inr(p.deletedTotal)}
                          <span className="text-[10px] font-semibold text-red-400 ml-1">({p.deletions})</span>
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Timeline ── */}
      {!filtered.length ? (
        <div className="card p-8 text-center text-sm text-gray-400">Nothing matches those filters.</div>
      ) : grouped.map(([date, entries]) => {
        const dayTotal = entries
          .filter(l => l.action === 'payment.add' || l.action === 'payment.online')
          .reduce((s, l) => s + amountOf(l), 0)
        return (
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                <Calendar size={10} /> {fmtDateHeading(date)}
                {dayTotal > 0 && <><span className="text-gray-300">·</span>
                  <span className="text-emerald-600">{inr(dayTotal)}</span></>}
              </span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>
            <div className="space-y-1.5">
              {entries.map(l => (
                <TrailRow key={l.id} log={l} branchName={branchNameById?.[l.branch_id]} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ icon, label, value, sub, tone }) {
  const tones = {
    emerald: 'text-emerald-600 bg-emerald-50',
    sky:     'text-sky-600 bg-sky-50',
    red:     'text-red-600 bg-red-50',
    amber:   'text-amber-600 bg-amber-50',
    gray:    'text-gray-400 bg-gray-50',
  }
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</span>
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-black ${tone === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

function TrailRow({ log, branchName }) {
  const deleted = log.action === 'payment.remove'
  const online  = log.action === 'payment.online'
  const cleared = log.action === 'payment.mark_paid'
  const amount  = amountOf(log)
  const mode    = modeOf(log)

  return (
    <div className={`rounded-xl border p-3 transition ${
      deleted ? 'bg-red-50/70 border-red-200' : 'bg-white border-gray-100 hover:border-gray-200'
    }`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-black uppercase ${
          deleted ? 'bg-red-100 text-red-600'
            : online ? 'bg-sky-100 text-sky-600'
            : 'bg-emerald-100 text-emerald-700'
        }`}>
          {online ? <Globe size={13} /> : deleted ? <Trash2 size={13} /> : (log.actor_name || '?')[0]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-gray-900 truncate">{log.entity_name || '—'}</span>
            {log.entity_id && (
              <span className="text-[10px] font-mono text-gray-400">{log.entity_id}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className={`text-[11px] font-semibold ${deleted ? 'text-red-600' : 'text-gray-500'}`}>
              {deleted ? 'Deleted by' : cleared ? 'Cheque cleared by' : online ? 'Paid online' : 'Collected by'}
            </span>
            {!online && <span className="text-[11px] font-bold text-gray-700">{log.actor_name}</span>}
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400">{fmtTime(log.created_at)}</span>
            {branchName && <>
              <span className="text-[10px] text-gray-300">·</span>
              <span className="text-[10px] text-purple-600 font-semibold">{branchName}</span>
            </>}
          </div>
          {log.note && (
            <p className={`text-[11px] mt-1 italic ${deleted ? 'text-red-700 font-semibold' : 'text-gray-400'}`}>
              {deleted ? 'Reason: ' : ''}{log.note}
            </p>
          )}
          {deleted && !log.note && (
            <p className="text-[11px] mt-1 text-red-500 font-semibold italic">
              No reason recorded — deleted before reasons were required.
            </p>
          )}
        </div>

        <div className="text-right flex-shrink-0">
          {amount > 0 && (
            <p className={`text-base font-black ${deleted ? 'text-red-600 line-through' : 'text-gray-900'}`}>
              {inr(amount)}
            </p>
          )}
          {mode !== '—' && (
            <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${modeStyle(mode)}`}>
              {mode}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
