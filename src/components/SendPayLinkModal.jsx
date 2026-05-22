import { useEffect, useMemo, useState } from 'react'
import * as db from '../lib/db'
import { X, Link as LinkIcon, Copy, MessageCircle, CheckCircle2 } from 'lucide-react'

// Generates a shareable Razorpay payment link for a student.
// The link goes to /pay/<shortCode>, a public landing page that
// loads Razorpay Checkout. No app account needed by the parent.
//
// Manual record-payment flow is unchanged — this is an additional channel.

export default function SendPayLinkModal({ students, onClose }) {
  const [studentId, setStudentId] = useState(null)
  const [search, setSearch]       = useState('')
  const [amount, setAmount]       = useState('')
  const [months, setMonths]       = useState(1)
  const [description, setDesc]    = useState('')
  const [busy, setBusy]           = useState(false)
  const [link, setLink]           = useState(null)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)

  const student = useMemo(
    () => students.find(s => s.id === studentId) || null,
    [students, studentId]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return students.slice(0, 8)
    return students.filter(s =>
      s.name?.toLowerCase().includes(q) ||
      s.studentCode?.toLowerCase().includes(q) ||
      s.parentPhone?.includes(q) ||
      s.phone?.includes(q)
    ).slice(0, 8)
  }, [students, search])

  useEffect(() => {
    if (student) {
      const fees = Number(student.fees || 0)
      const plan = (student.feePlan || 'monthly')
      const auto = plan === 'monthly' ? fees * months : fees
      setAmount(String(auto || ''))
    }
  }, [student, months])

  const create = async () => {
    if (!student) { setError('Pick a student first'); return }
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setBusy(true); setError('')
    try {
      const row = await db.createPaymentLink({
        studentId:     student.id,
        amount:        amt,
        description:   description || `Fees for ${student.name}`,
        monthsCovered: (student.feePlan || 'monthly') === 'monthly' ? months : (student.feePlan === 'yearly' ? 12 : 3),
      })
      const url = `${window.location.origin}/pay/${row.short_code}`
      setLink({ ...row, url })
    } catch (e) {
      setError(e?.message || 'Could not create link')
    } finally { setBusy(false) }
  }

  const copyLink = async () => {
    if (!link?.url) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const sendWhatsApp = () => {
    if (!link?.url || !student) return
    const phone = (student.parentPhone || student.phone || '').replace(/[^\d]/g, '')
    const message = encodeURIComponent(
      `Hi ${student.parent || 'Parent'},\n\nPay ${student.name}'s fees here:\n${link.url}\n\n— ${student.academy || 'Your academy'}`
    )
    const target = phone ? `https://wa.me/${phone.startsWith('91') ? phone : '91' + phone}?text=${message}`
                         : `https://wa.me/?text=${message}`
    window.open(target, '_blank')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-up overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
              <LinkIcon size={18} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-sm">Send Pay Link</h3>
              <p className="text-xs text-gray-500">Parent pays online via Razorpay (UPI / card)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!link ? (
            <>
              <div>
                <label className="label">Student</label>
                {student ? (
                  <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{student.name}</p>
                      <p className="text-[11px] text-gray-500">
                        {[student.studentCode, student.sport, student.batch].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <button onClick={() => { setStudentId(null); setSearch('') }}
                      className="text-xs text-brand-700 font-semibold hover:underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input className="input" placeholder="Search name, code, phone"
                      value={search} onChange={e => setSearch(e.target.value)} autoFocus />
                    {filtered.length > 0 && (
                      <div className="mt-1 max-h-48 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                        {filtered.map(s => (
                          <button key={s.id} type="button"
                            onClick={() => { setStudentId(s.id); setSearch('') }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            <p className="font-medium text-gray-900">{s.name}</p>
                            <p className="text-[11px] text-gray-500">
                              {[s.studentCode, s.batch, s.parentPhone].filter(Boolean).join(' · ')}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {student && (student.feePlan || 'monthly') === 'monthly' && (
                <div>
                  <label className="label">Months</label>
                  <div className="flex gap-2">
                    {[1, 3, 6, 12].map(m => (
                      <button key={m} type="button" onClick={() => setMonths(m)}
                        className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition ${
                          months === m
                            ? 'border-brand-600 bg-brand-50 text-brand-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="label">Amount (₹)</label>
                <input className="input" type="number" min="1"
                  value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
              </div>

              <div>
                <label className="label">Note <span className="font-normal text-gray-400">(optional)</span></label>
                <input className="input" type="text"
                  value={description} onChange={e => setDesc(e.target.value)}
                  placeholder={`Fees for ${student?.name || 'student'}`} />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button onClick={create} disabled={busy || !student}
                className="w-full btn-primary justify-center py-3">
                {busy ? 'Generating…' : 'Generate pay link'}
              </button>
              <p className="text-[11px] text-gray-400 text-center">
                Razorpay must be enabled in Settings → Payments
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 flex items-center gap-2 text-emerald-700">
                <CheckCircle2 size={16} /> <span className="text-sm font-semibold">Link ready · expires in 7 days</span>
              </div>
              <div className="bg-gray-50 rounded-xl px-3 py-2.5 break-all text-xs text-gray-700 font-mono">
                {link.url}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={copyLink} className="btn-secondary justify-center">
                  <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={sendWhatsApp} className="flex items-center justify-center gap-2 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl">
                  <MessageCircle size={14} /> WhatsApp
                </button>
              </div>
              <button onClick={onClose} className="w-full text-xs text-gray-500 hover:text-gray-700 underline">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
