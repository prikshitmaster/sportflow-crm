// Shared presentation primitives for the /detail/:type/:id pages.
// Extracted from RecordDetail.jsx so StudentDetail can reuse them without a
// circular import (RecordDetail imports StudentDetail, so StudentDetail must
// not import back from RecordDetail).

export const fmtMoney = n => '₹' + Number(n || 0).toLocaleString('en-IN')

export const fmtDate = d => {
  if (!d) return '—'
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const monthLabel = (y, m) =>
  new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

// Whole calendar months owed between paidTill's month and the anchor month —
// same approximation the edge function and Reports use.
export function monthsOwed(paidTill, anchor) {
  if (!paidTill || !anchor) return 0
  const [py, pm] = paidTill.split('-').map(Number)
  const [ay, am] = anchor.split('-').map(Number)
  return Math.max(0, (ay * 12 + am - 1) - (py * 12 + pm - 1))
}

export const STATUS_STYLE = {
  Active:    'bg-emerald-50 text-emerald-700',
  Suspended: 'bg-amber-50 text-amber-700',
  Inactive:  'bg-gray-100 text-gray-500',
  Paid:      'bg-emerald-50 text-emerald-700',
  Pending:   'bg-amber-50 text-amber-700',
  Overdue:   'bg-red-50 text-red-600',
  Approved:  'bg-emerald-50 text-emerald-700',
  Rejected:  'bg-red-50 text-red-600',
}

export const Pill = ({ children }) => (
  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[children] || 'bg-gray-100 text-gray-600'}`}>
    {children}
  </span>
)

export const Avatar = ({ name, photoUrl, size = 'w-16 h-16 text-xl' }) => (
  photoUrl
    ? <img src={photoUrl} alt={name} className={`${size} rounded-2xl object-cover flex-shrink-0`} />
    : (
      <div className={`${size} rounded-2xl bg-brand-600 text-white font-black flex items-center justify-center flex-shrink-0`}>
        {(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
      </div>
    )
)

export const Tile = ({ icon: Icon, label, value, sub, tone = 'text-gray-900' }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-4">
    <div className="flex items-center gap-1.5 text-gray-400 text-xs font-semibold uppercase tracking-wide">
      <Icon size={13} /> {label}
    </div>
    <div className={`mt-1.5 text-lg font-black leading-tight ${tone}`}>{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
  </div>
)

export const Section = ({ icon: Icon, title, right, children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 p-5">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="font-black text-gray-900 flex items-center gap-2 text-sm">
        <Icon size={15} className="text-brand-600" /> {title}
      </h3>
      {right}
    </div>
    {children}
  </div>
)

export const Empty = ({ children }) => (
  <p className="text-sm text-gray-400 py-2">{children}</p>
)

export const KV = ({ label, value }) => (
  <div>
    <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{label}</div>
    <div className="text-sm font-semibold text-gray-800 mt-0.5">{value ?? '—'}</div>
  </div>
)

export const ATT_TONE = {
  Present: 'text-emerald-600',
  Late:    'text-amber-600',
  Absent:  'text-red-500',
  Leave:   'text-sky-600',
}

// Solid fills for the attendance calendar. Unmarked days stay near-invisible so
// the marked ones carry the whole signal.
export const ATT_FILL = {
  Present: 'bg-emerald-500 text-white',
  Late:    'bg-amber-400 text-white',
  Absent:  'bg-red-500 text-white',
  Leave:   'bg-sky-400 text-white',
}
