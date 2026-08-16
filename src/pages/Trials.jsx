import { useState, useMemo, useEffect } from 'react'
import Paginator, { PAGE_SIZE } from '../components/Paginator'
import { useApp } from '../context/AppContext'
import {
  UserPlus, Search, Plus, X, ChevronDown, CheckCircle2,
  Clock, RotateCcw, XCircle, ArrowRight, Calendar, Settings2,
  Trash2, Phone, User, Pencil, Users, IndianRupee,
} from 'lucide-react'
import DevFillButton from '../components/DevFillButton'
import { fillTrial } from '../lib/devFill'
import { toLocalDateStr } from '../lib/dates'
import { normTrainingType, trainingTypeLabel } from '../lib/studentRules'
import { MEDICAL_OPTIONS, GENDER_OPTIONS } from '../lib/studentIntake'
import { resolveBranchTax, computeTax, taxRowLabel } from '../lib/tax'
import { buildTrialReceiptHTML } from '../lib/trialReceipt'
import ReceiptActions from '../components/ReceiptActions'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

// ── Stage config ─────────────────────────────────────────────

const STAGES = [
  { id: 'all',       label: 'Active'    }, // everything except converted/rejected — those live under Done
  { id: 'new',       label: 'New'       },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'attended',  label: 'Attended'  },
  { id: 'accepted',  label: 'Accepted'  },
  { id: 'followup',  label: 'Follow-up' },
  { id: 'done',      label: 'Done'      }, // converted + rejected
]

const STAGE_STYLE = {
  new:       { bg: 'bg-gray-100',    text: 'text-gray-600'    },
  scheduled: { bg: 'bg-blue-100',   text: 'text-blue-700'    },
  attended:  { bg: 'bg-amber-100',  text: 'text-amber-700'   },
  accepted:  { bg: 'bg-emerald-100',text: 'text-emerald-700' },
  followup:  { bg: 'bg-orange-100', text: 'text-orange-700'  },
  converted: { bg: 'bg-brand-100',  text: 'text-brand-700'   },
  rejected:  { bg: 'bg-red-100',    text: 'text-red-600'     },
}

const REC_STYLE = {
  accept:  { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '✓ Accept'    },
  followup:{ bg: 'bg-orange-100',  text: 'text-orange-700',  label: '↺ Follow-up' },
  decline: { bg: 'bg-red-100',     text: 'text-red-600',     label: '✗ Decline'   },
}

const DEFAULT_SOURCES = ['Instagram', 'Walk-in', 'Referral', 'Google', 'WhatsApp', 'Facebook', 'Word of Mouth']

// ── Helpers ───────────────────────────────────────────────────

const pad = n => String(n).padStart(2, '0')
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'

// ── Shared fee-plan helpers (mirrors Students.jsx) ────────────
const _MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const _PLAN_MOS = { monthly: 1, quarterly: 3, yearly: 12 }
function calcPaidTill(joinDate, feePlan) {
  if (!joinDate || feePlan === 'custom') return ''
  const [yr, mo] = joinDate.split('-').map(Number)
  const end = new Date(yr, mo - 1 + (_PLAN_MOS[feePlan] || 1) - 1, 1)
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
}
function coveragePreview(joinDate, paidTill) {
  if (!joinDate || !paidTill) return null
  const [sy, sm] = joinDate.split('-').map(Number)
  const [ey, em] = paidTill.slice(0, 7).split('-').map(Number)
  const months = (ey - sy) * 12 + (em - sm) + 1
  if (months < 1) return null
  const label = months === 1
    ? `${_MO[sm - 1]} ${sy}`
    : `${_MO[sm - 1]} ${sy} – ${_MO[em - 1]} ${ey}`
  return `${label} · ${months} month${months > 1 ? 's' : ''}`
}
const FEE_PLAN_OPTIONS = [
  { key: 'monthly',   label: 'Monthly',   sub: '1 month'    },
  { key: 'quarterly', label: 'Quarterly', sub: '3 months'   },
  { key: 'yearly',    label: 'Yearly',    sub: '12 months'  },
  { key: 'custom',    label: 'Custom',    sub: 'pick dates' },
]
const FEE_LABEL = {
  monthly: 'Monthly Fee (₹) *', quarterly: 'Quarterly Fee (₹) *',
  yearly: 'Yearly Fee (₹) *',   custom: 'Plan Fee (₹) *',
}

function SessionDots({ done, total }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${i < done ? 'bg-brand-500' : 'bg-gray-200'}`} />
      ))}
      <span className="text-[10px] text-gray-400 ml-1">{done}/{total}</span>
    </div>
  )
}

const AGE_GROUPS = ['U6', 'U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Open']

// ── Trial Slip Printer ────────────────────────────────────────

function calcAge(dob) {
  if (!dob) return null
  const diff = Date.now() - new Date(dob).getTime()
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))
}

// Fallback only, for trials created before migration 0124. Note it is NOT
// unique — two same-initial trials on the same day collide. Trials created
// since then carry receiptNo, which is the real payments row id.
function genReceiptNo(name) {
  const d = new Date()
  const initials = (name || 'XX').replace(/\s+/g,'').slice(0,3).toUpperCase()
  return `TRL-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${initials}`
}

function buildPrintHTML(trial, academyName, logoUrl, customLogo) {
  const logo      = customLogo || logoUrl || ''
  const isAcademy = trial.programType !== 'development'
  const isDev     = trial.programType === 'development'
  const feeCollected = trial.trialFeeMode !== 'Not collected'
  const age       = trial.age || calcAge(trial.dob) || ''
  // Prefer the real payments row id so the printed slip and the revenue
  // record carry the same number.
  const receiptNo = trial.receiptNo || genReceiptNo(trial.name)
  const fmtD      = iso => iso ? new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'
  const today     = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Trial Slip — ${trial.name}</title>
<style>
  @page { size: A5; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1a1a2e; }

  .page { width: 148mm; min-height: 210mm; position: relative; overflow: hidden; }

  /* ── Header ── */
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%); padding: 20px 24px 18px; color: #fff; display: flex; align-items: center; gap: 18px; }
  .logo-wrap { width: 68px; height: 68px; background: rgba(255,255,255,0.12); border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,0.25); flex-shrink: 0; overflow: hidden; }
  .logo-wrap img { width: 100%; height: 100%; object-fit: contain; }
  .logo-placeholder { font-size: 22px; font-weight: 900; color: rgba(255,255,255,0.7); letter-spacing: -1px; }
  .header-text { flex: 1; }
  .acad-name { font-size: 18px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
  .acad-sub { font-size: 10px; color: rgba(255,255,255,0.65); margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
  .acad-sport { font-size: 11px; color: #e94560; margin-top: 5px; font-weight: 600; }

  /* ── Title band ── */
  .title-band { background: #e94560; padding: 8px 24px; display: flex; align-items: center; justify-content: space-between; }
  .slip-title { color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; }
  .receipt-no { color: rgba(255,255,255,0.85); font-size: 10px; font-family: monospace; }

  /* ── Body ── */
  .body { padding: 20px 24px; }

  /* Info box */
  .info-box { border: 1.5px solid #e8eaf0; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
  .info-box-header { background: #f5f6fa; padding: 6px 14px; font-size: 9px; font-weight: 700; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; border-bottom: 1px solid #e8eaf0; }
  .info-row { display: flex; border-bottom: 1px solid #f0f0f5; }
  .info-row:last-child { border-bottom: none; }
  .info-label { width: 105px; padding: 8px 14px; font-size: 10px; color: #6b7280; font-weight: 600; background: #fafafa; border-right: 1px solid #f0f0f5; flex-shrink: 0; display: flex; align-items: center; }
  .info-value { flex: 1; padding: 8px 14px; font-size: 11px; font-weight: 700; color: #1a1a2e; display: flex; align-items: center; }

  /* Program */
  .prog-row { display: flex; gap: 10px; margin-bottom: 16px; }
  .prog-box { flex: 1; border: 1.5px solid #e8eaf0; border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  .prog-box.active { border-color: #1a1a2e; background: #f5f6fa; }
  .prog-check { width: 18px; height: 18px; border: 2px solid #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .prog-check.checked { background: #1a1a2e; border-color: #1a1a2e; color: #fff; font-size: 11px; font-weight: 900; }
  .prog-label { font-size: 11px; font-weight: 700; }

  /* Fee */
  .fee-box { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 1.5px solid #86efac; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
  .fee-label { font-size: 10px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  .fee-amount { font-size: 20px; font-weight: 900; color: #15803d; }
  .fee-badge { background: #15803d; color: #fff; font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 20px; letter-spacing: 1px; }
  .fee-badge.unpaid { background: #b91c1c; }

  /* Signatures */
  .sig-row { display: flex; gap: 16px; margin-top: 4px; }
  .sig-block { flex: 1; text-align: center; }
  .sig-space { height: 36px; border-bottom: 1.5px solid #374151; margin-bottom: 4px; }
  .sig-name { font-size: 9.5px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Footer */
  .footer { position: absolute; bottom: 0; left: 0; right: 0; background: #1a1a2e; padding: 8px 24px; display: flex; align-items: center; justify-content: space-between; }
  .footer-text { font-size: 8.5px; color: rgba(255,255,255,0.55); }
  .footer-valid { font-size: 8.5px; color: #e94560; font-weight: 600; }

  /* Watermark */
  .watermark { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 80px; font-weight: 900; color: rgba(0,0,0,0.03); pointer-events: none; white-space: nowrap; z-index: 0; text-transform: uppercase; }
</style>
</head><body>
<div class="page">
  <div class="watermark">${(academyName||'').split(' ')[0]}</div>

  <div class="header">
    <div class="logo-wrap">
      ${logo ? `<img src="${logo}" />` : `<span class="logo-placeholder">${(academyName||'A').charAt(0)}</span>`}
    </div>
    <div class="header-text">
      <div class="acad-name">${academyName || 'Academy'}</div>
      <div class="acad-sub">Sports Academy &amp; Development Centre</div>
      <div class="acad-sport">${trial.sport || ''} Programme</div>
    </div>
  </div>

  <div class="title-band">
    <span class="slip-title">Trial Enrollment Slip</span>
    <span class="receipt-no">${receiptNo}</span>
  </div>

  <div class="body">
    <div class="info-box">
      <div class="info-box-header">Player Information</div>
      ${[
        ['Full Name',    trial.name || ''],
        ['Date of Birth',fmtD(trial.dob)],
        ['Age',          age ? `${age} Years` : ''],
        ['Contact No.',  trial.phone ? `+91 ${trial.phone}` : ''],
        ['Age Group',    trial.ageGroup || ''],
        ['Sport',        trial.sport || ''],
        ['Trial Date',   fmtD(trial.trialDate)],
        ['Date of Slip', today],
      ].map(([l,v]) => `
      <div class="info-row">
        <div class="info-label">${l}</div>
        <div class="info-value">${v || '—'}</div>
      </div>`).join('')}
    </div>

    <div class="prog-row">
      <div class="prog-box ${isAcademy ? 'active' : ''}">
        <div class="prog-check ${isAcademy ? 'checked' : ''}">${isAcademy ? '✓' : ''}</div>
        <span class="prog-label">Academy</span>
      </div>
      <div class="prog-box ${isDev ? 'active' : ''}">
        <div class="prog-check ${isDev ? 'checked' : ''}">${isDev ? '✓' : ''}</div>
        <span class="prog-label">Development</span>
      </div>
    </div>

    <div class="fee-box">
      <div>
        <div class="fee-label">Trial Registration Fee</div>
        <div class="fee-amount">₹${(trial.trialFeePaid ?? 590).toLocaleString('en-IN')}</div>
      </div>
      <div class="fee-badge ${feeCollected ? '' : 'unpaid'}">${feeCollected ? 'PAID' : 'NOT COLLECTED'}</div>
    </div>

    <div class="sig-row">
      <div class="sig-block"><div class="sig-space"></div><div class="sig-name">Coach</div></div>
      <div class="sig-block"><div class="sig-space"></div><div class="sig-name">Parent / Guardian</div></div>
      <div class="sig-block"><div class="sig-space"></div><div class="sig-name">Admin</div></div>
    </div>
  </div>

  <div class="footer">
    <span class="footer-text">This slip is valid for the trial session only. Non-transferable.</span>
    <span class="footer-valid">OFFICIAL DOCUMENT</span>
  </div>
</div>
</body></html>`
}

function printTrialSlip(trial, academyName, logoUrl, customLogo) {
  const html = buildPrintHTML(trial, academyName, logoUrl, customLogo)
  const w = window.open('', '_blank', 'width=600,height=850')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { w.print() }, 400)
}

// ── Trial Slip Preview Modal ──────────────────────────────────

function TrialSlipModal({ trial, academyName, logoUrl, onClose }) {
  useBodyScrollLock()
  const [customLogo, setCustomLogo] = useState(null)
  const activeLogo = customLogo || logoUrl

  function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCustomLogo(ev.target.result)
    reader.readAsDataURL(file)
  }

  // Prefer the real payments row id so the printed slip and the revenue
  // record carry the same number.
  const receiptNo = trial.receiptNo || genReceiptNo(trial.name)
  const age       = trial.age || calcAge(trial.dob) || '—'
  const isAcademy = trial.programType !== 'development'
  const isDev     = trial.programType === 'development'
  const feeCollected = trial.trialFeeMode !== 'Not collected'
  const fmtD      = iso => iso ? new Date(iso).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

  // No backdrop-blur — see ConvertModal's comment on this pattern; here
  // it's worse, since this same element both blurs AND scrolls.
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col my-4">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <div>
            <h2 className="font-black text-gray-900">Trial Enrollment Slip</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{receiptNo}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 text-gray-500"><X size={15} /></button>
        </div>

        {/* Logo upload strip */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
          {activeLogo
            ? <img src={activeLogo} alt="logo" className="w-10 h-10 rounded-lg object-contain border border-gray-200 bg-white p-0.5" />
            : <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-gray-400 text-xs font-bold">{(academyName||'A').charAt(0)}</div>
          }
          <div>
            <p className="text-xs font-semibold text-gray-700">Academy Logo</p>
            <p className="text-[10px] text-gray-400">Upload to override the logo on this slip</p>
          </div>
          <label className="ml-auto cursor-pointer">
            <span className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg font-semibold text-gray-600 hover:bg-gray-50 transition">
              {customLogo ? 'Change' : 'Upload'}
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
        </div>

        {/* Professional slip preview */}
        <div className="mx-4 my-4 rounded-xl overflow-hidden border border-gray-200 shadow-md" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>

          {/* Header */}
          <div className="flex items-center gap-4 px-5 py-4" style={{ background: 'linear-gradient(135deg,#1a1a2e,#0f3460)' }}>
            <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden border-2 border-white/20" style={{ background: 'rgba(255,255,255,0.1)' }}>
              {activeLogo
                ? <img src={activeLogo} alt="logo" className="w-full h-full object-contain" />
                : <span className="text-white font-black text-xl">{(academyName||'A').charAt(0)}</span>
              }
            </div>
            <div>
              <p className="text-white font-black text-base tracking-wide uppercase">{academyName}</p>
              <p className="text-white/50 text-[10px] uppercase tracking-widest mt-0.5">Sports Academy &amp; Development Centre</p>
              <p className="text-red-400 text-[11px] font-semibold mt-1">{trial.sport} Programme</p>
            </div>
          </div>

          {/* Title band */}
          <div className="flex items-center justify-between px-5 py-2" style={{ background: '#e94560' }}>
            <span className="text-white font-black text-xs tracking-widest uppercase">Trial Enrollment Slip</span>
            <span className="text-white/80 text-[10px] font-mono">{receiptNo}</span>
          </div>

          {/* Fields */}
          <div className="bg-white">
            {[
              ['Full Name',    trial.name],
              ['Date of Birth',fmtD(trial.dob)],
              ['Age',          age !== '—' ? `${age} Years` : '—'],
              ['Contact No.',  trial.phone ? `+91 ${trial.phone}` : '—'],
              ['Age Group',    trial.ageGroup || '—'],
              ['Trial Date',   fmtD(trial.trialDate)],
            ].map(([l, v], i) => (
              <div key={l} className={`flex ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                <div className="w-28 px-4 py-2.5 text-[10px] font-semibold text-gray-500 border-r border-gray-100 flex items-center">{l}</div>
                <div className="flex-1 px-4 py-2.5 text-xs font-bold text-gray-900 flex items-center">{v || '—'}</div>
              </div>
            ))}
          </div>

          {/* Program + Fee */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-3">
            {[['Academy', isAcademy], ['Development', isDev]].map(([lbl, active]) => (
              <div key={lbl} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${active ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-200 text-gray-400 bg-white'}`}>
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-[8px] ${active ? 'bg-white border-white text-gray-900 font-black' : 'border-gray-300'}`}>{active ? '✓' : ''}</span>
                {lbl}
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <div className="text-right">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">Trial Fee</p>
                <p className={`text-base font-black ${feeCollected ? 'text-green-700' : 'text-red-700'}`}>₹{(trial.trialFeePaid ?? 590).toLocaleString('en-IN')}</p>
              </div>
              <span className={`text-[9px] text-white px-2 py-0.5 rounded-full font-black tracking-wide ${feeCollected ? 'bg-green-600' : 'bg-red-600'}`}>
                {feeCollected ? 'PAID' : 'NOT COLLECTED'}
              </span>
            </div>
          </div>

          {/* Signatures */}
          <div className="flex border-t border-gray-100 bg-white">
            {['Coach', 'Parent / Guardian', 'Admin'].map(s => (
              <div key={s} className="flex-1 px-3 py-3 border-r last:border-r-0 border-gray-100 text-center">
                <div className="h-7 border-b border-gray-400 mb-1"></div>
                <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide">{s}</p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2" style={{ background: '#1a1a2e' }}>
            <span className="text-[8px] text-white/40">Valid for trial session only. Non-transferable.</span>
            <span className="text-[8px] text-red-400 font-bold tracking-wide">OFFICIAL DOCUMENT</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            Close
          </button>
          <button onClick={() => printTrialSlip(trial, academyName, logoUrl, customLogo)}
            className="flex-2 px-6 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition flex items-center gap-2">
            🖨 Print Slip
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add / Edit Trial Modal ────────────────────────────────────

// Reusable styled field wrapper
function Field({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-500 tracking-wide">
        {label}{required && <span className="text-brand-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const fieldCls = 'w-full px-3.5 py-2.5 text-sm text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 focus:bg-white placeholder-gray-400 transition'
const selectCls = fieldCls + ' appearance-none cursor-pointer'

function TrialModal({ onClose, onSave, batches, initial = {}, isEdit = false, selectedSport = null }) {
  useBodyScrollLock()
  const { ageGroups, showToast, selectedBranch, sportBranches } = useApp()
  const ageGroupOptions = ageGroups.length ? ageGroups.map(g => g.label) : AGE_GROUPS
  // Branch tax (migration 0154), same rate/toggle /join quotes a new
  // registrant with. Only applied on CREATE — on edit, trialFeePaid already
  // holds whatever the trial's true collectible total is (tax-inclusive if
  // it came from /join, already-fixed-up if it came from the office form
  // pre-0160), and re-adding tax on every save would double-tax it. Setting
  // the rate to 0 in edit mode makes computeTax() below a no-op, so edit
  // behaves exactly as it always has.
  const feeBranch    = sportBranches.find(b => b.id === (initial?.branchId || selectedBranch))
  const trialTaxPct  = !isEdit ? resolveBranchTax(feeBranch, 'trial') : 0
  const [form, setForm] = useState({
    name: '', parent: '', age: '', dob: '',
    ageGroup: '', programType: 'academy',
    sport: selectedSport || '',
    trialDate: todayStr(), quotedFee: '', notes: '',
    sessionStart: '', sessionEnd: '',
    // Same contact/personal fields the /join funnel asks — kept optional
    // here since a quick walk-in add doesn't always have every answer yet.
    gender: '', motherName: '', email: '', alternateContactPhone: '',
    occupation: '', address: '', emergencyContactName: '', emergencyContactPhone: '',
    medicalNotes: '',
    ...initial,
    trialSessions: initial.trialSessions || 1,
    trialFeePaid:  initial.trialFeePaid  ?? 590,
    trialFeeMode:  initial.trialFeeMode  || 'Not collected',
    batchId:       initial.batchId ? String(initial.batchId) : '',
    phone:         initial.phone   ? initial.phone.replace(/^\+91\s?/, '') : '',
    // medicalNotes is the only part actually persisted — hasMedical is a
    // UI-only yes/no derived from whether it's set, same as Students.jsx.
    hasMedical:    initial.medicalNotes ? 'yes' : '',
  })
  const [saving, setSaving] = useState(false)
  // form.trialFeePaid is the BASE fee on create (trialTaxPct > 0 only then);
  // feeCalc.total is what actually gets booked as revenue and saved.
  const feeCalc = computeTax(Number(form.trialFeePaid) || 0, trialTaxPct)

  // When a sport is scoped, only show that sport; otherwise derive from batches
  const sports    = useMemo(() => {
    if (selectedSport) return [selectedSport]
    return [...new Set(batches.flatMap(b => b.sports || []))].sort()
  }, [batches, selectedSport])
  const batchOpts = form.sport ? batches.filter(b => (b.sports || []).includes(form.sport)) : batches

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim() || !form.phone.trim() || !form.sport || !form.trialDate) return
    setSaving(true)
    try {
      const age = form.age ? Number(form.age) : calcAge(form.dob) || null
      await onSave({
        ...form,
        phone:         form.phone.trim(),
        age,
        batchId:       form.batchId   ? Number(form.batchId)   : null,
        trialSessions: Number(form.trialSessions) || 1,
        // `|| 590` would silently turn a deliberate 0 back into 590, which
        // now books ₹590 of revenue that was never collected. Only an
        // empty field falls back to the default. computeTax() with
        // trialTaxPct=0 (edit mode, or no tax configured) just returns the
        // base back unchanged, so this is a no-op outside create-with-tax.
        trialFeePaid: computeTax(
          form.trialFeePaid === '' || form.trialFeePaid == null ? 590 : (Number(form.trialFeePaid) || 0),
          trialTaxPct
        ).total,
        trialFeeMode:  form.trialFeeMode || 'Not collected',
        quotedFee:     form.quotedFee ? Number(form.quotedFee) : null,
        notes:         form.notes?.trim() || null,
        sessionStart:  form.sessionStart || null,
        sessionEnd:    form.sessionEnd   || null,
        dob:           form.dob          || null,
        ageGroup:      form.ageGroup     || null,
        programType:   form.programType  || 'academy',
        gender:                 form.gender                 || null,
        motherName:             form.motherName?.trim()     || null,
        email:                  form.email?.trim()          || null,
        alternateContactPhone:  form.alternateContactPhone  || null,
        occupation:             form.occupation?.trim()     || null,
        address:                form.address?.trim()        || null,
        emergencyContactName:   form.emergencyContactName?.trim()  || null,
        emergencyContactPhone:  form.emergencyContactPhone         || null,
        // Same "no separate boolean" convention as /join: a blank note on
        // an explicit 'no' means answered-no, not never-asked.
        medicalNotes:  form.hasMedical === 'yes' ? (form.medicalNotes?.trim() || null) : null,
      })
      onClose()
    } catch (e) {
      showToast(e.message || 'Failed to save trial', 'error')
    } finally {
      setSaving(false)
    }
  }

  const canSave = form.name.trim() && form.phone.trim() && form.sport && form.trialDate

  // No backdrop-blur — see ConvertModal's comment on this pattern.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl ring-1 ring-black/5">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <h2 className="text-base font-black text-gray-900">
              {isEdit ? 'Edit Trial Lead' : 'New Trial Lead'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isEdit ? 'Update lead details' : 'Add a new prospect to the pipeline'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isEdit && <DevFillButton onFill={() => {
              const data = fillTrial({ sports, batches })
              setForm(f => ({ ...f, ...data }))
            }} />}
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 transition">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2 space-y-4">

          {/* ── Player Info ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Player Info</p>

            <Field label="Full Name" required>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="e.g. Rahul Sharma" autoFocus className={fieldCls} />
            </Field>

            <div className="grid grid-cols-5 gap-2.5">
              <div className="col-span-3">
                <Field label="Phone" required>
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
                    <span className="flex items-center px-3 text-sm font-semibold text-gray-500 bg-gray-100 border-r border-gray-200 shrink-0 select-none">
                      +91
                    </span>
                    <input
                      value={form.phone}
                      onChange={e => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                      placeholder="98765 43210"
                      inputMode="tel"
                      maxLength={10}
                      className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none placeholder-gray-400"
                    />
                  </div>
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Age">
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
                    <input
                      value={form.age ?? ''}
                      onChange={e => set('age', e.target.value)}
                      placeholder="12"
                      type="number" min="3" max="60" inputMode="numeric"
                      className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none placeholder-gray-400 w-full"
                    />
                    <span className="flex items-center pr-3 text-xs text-gray-400 shrink-0">yrs</span>
                  </div>
                </Field>
              </div>
            </div>

            <Field label="Parent / Guardian">
              <input value={form.parent} onChange={e => set('parent', e.target.value)}
                placeholder="Parent or guardian name" className={fieldCls} />
            </Field>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Date of Birth">
                <input value={form.dob || ''} onChange={e => set('dob', e.target.value)}
                  type="date" className={fieldCls} />
              </Field>
              <Field label="Age Group">
                <div className="relative">
                  <select value={form.ageGroup || ''} onChange={e => set('ageGroup', e.target.value)}
                    className={selectCls}>
                    <option value="">Select…</option>
                    {ageGroupOptions.map(g => <option key={g} value={g}>{g}</option>)}
                    {form.ageGroup && !ageGroupOptions.includes(form.ageGroup) && (
                      <option key={form.ageGroup} value={form.ageGroup}>{form.ageGroup}</option>
                    )}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          {/* ── Trial Details ── */}
          <div className="space-y-3 pt-1">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Trial Details</p>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Sport" required>
                {selectedSport ? (
                  <div className={fieldCls + ' text-gray-700 font-medium bg-gray-100 cursor-default'}>
                    {selectedSport}
                  </div>
                ) : (
                  <div className="relative">
                    <select value={form.sport}
                      onChange={e => { set('sport', e.target.value); set('batchId', '') }}
                      className={selectCls}>
                      <option value="">Select…</option>
                      {sports.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                )}
              </Field>
              <Field label="Batch">
                <div className="relative">
                  <select value={form.batchId} onChange={e => set('batchId', e.target.value)}
                    className={selectCls}>
                    <option value="">Unassigned</option>
                    {batchOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Trial Date" required>
                <input value={form.trialDate} onChange={e => set('trialDate', e.target.value)}
                  type="date" className={fieldCls} />
              </Field>
              <Field label="Trial Fee ₹">
                <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
                  <span className="flex items-center px-3 text-sm font-semibold text-gray-500 bg-gray-100 border-r border-gray-200 shrink-0 select-none">₹</span>
                  <input value={form.trialFeePaid ?? 590} onChange={e => set('trialFeePaid', e.target.value)}
                    type="number" min="0" inputMode="numeric"
                    className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none" />
                </div>
                {/* Branch tax (Settings > Fees & Tax), same as /join quotes a
                    new registrant — only computed on create, see trialTaxPct. */}
                {feeCalc.taxAmount > 0 && (
                  <p className="mt-1.5 text-[11px] text-gray-500">
                    {taxRowLabel(feeCalc.taxPct)} = ₹{feeCalc.taxAmount.toLocaleString('en-IN')}
                    {' · '}<span className="font-bold text-gray-700">Total ₹{feeCalc.total.toLocaleString('en-IN')}</span>
                  </p>
                )}
              </Field>
            </div>

            {/* Whether the fee was actually taken. This drives revenue — a
                collected fee is booked as a real payment receipt, so this
                defaults to 'Not collected' and staff must actively pick
                Cash/UPI once money has genuinely changed hands (0159 — it
                used to default to Cash, which silently booked revenue and
                showed the coach a trial as "paid" that never was). */}
            <Field label="Fee Collected">
              <div className="flex gap-2">
                {['Not collected', 'Cash', 'UPI'].map(m => (
                  <button key={m} type="button" onClick={() => set('trialFeeMode', m)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                      form.trialFeeMode === m
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                {form.trialFeeMode === 'Not collected'
                  ? 'No receipt is issued and nothing is added to revenue.'
                  : `₹${feeCalc.total.toLocaleString('en-IN')} will be recorded as revenue with a trial receipt.`}
              </p>
            </Field>

            {/* Program type */}
            <Field label="Program">
              <div className="flex gap-2">
                {[['academy', 'Academy'], ['development', 'Development']].map(([val, lbl]) => (
                  <button key={val} type="button" onClick={() => set('programType', val)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                      form.programType === val
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}>
                    {lbl}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Sessions">
              <div className="flex gap-2">
                {[1, 2, 3].map(n => (
                  <button key={n} type="button" onClick={() => set('trialSessions', n)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                      Number(form.trialSessions) === n
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}>
                    {n}×
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* ── Additional Info — same contact/personal fields the /join
              funnel collects (studentIntake.js), so a walk-in lead entered
              by staff carries as much onto conversion as a self-registered
              one does. All optional: a quick add doesn't always have every
              answer yet. ── */}
          <div className="space-y-3 pt-1">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Additional Info</p>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Gender">
                <div className="flex gap-1.5">
                  {GENDER_OPTIONS.map(g => (
                    <button key={g} type="button" onClick={() => set('gender', g)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                        form.gender === g
                          ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                      }`}>
                      {g}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Mother's Name">
                <input value={form.motherName} onChange={e => set('motherName', e.target.value)}
                  placeholder="Mother's name" className={fieldCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Email">
                <input value={form.email} onChange={e => set('email', e.target.value)}
                  type="email" placeholder="parent@email.com" className={fieldCls} />
              </Field>
              <Field label="Alternate Contact">
                <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
                  <span className="flex items-center px-3 text-sm font-semibold text-gray-500 bg-gray-100 border-r border-gray-200 shrink-0 select-none">+91</span>
                  <input value={form.alternateContactPhone}
                    onChange={e => set('alternateContactPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="98765 43210" inputMode="tel" maxLength={10}
                    className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none placeholder-gray-400" />
                </div>
              </Field>
            </div>

            <Field label="Occupation">
              <input value={form.occupation} onChange={e => set('occupation', e.target.value)}
                placeholder="Parent's occupation" className={fieldCls} />
            </Field>

            <Field label="Address">
              <input value={form.address} onChange={e => set('address', e.target.value)}
                placeholder="Home address" className={fieldCls} />
            </Field>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Emergency Contact Name">
                <input value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)}
                  placeholder="Contact name" className={fieldCls} />
              </Field>
              <Field label="Emergency Contact Phone">
                <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
                  <span className="flex items-center px-3 text-sm font-semibold text-gray-500 bg-gray-100 border-r border-gray-200 shrink-0 select-none">+91</span>
                  <input value={form.emergencyContactPhone}
                    onChange={e => set('emergencyContactPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="98765 43210" inputMode="tel" maxLength={10}
                    className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none placeholder-gray-400" />
                </div>
              </Field>
            </div>

            <Field label="Any Medical Condition?">
              <div className="flex gap-2">
                {MEDICAL_OPTIONS.map(opt => (
                  <button key={opt.value} type="button" onClick={() => set('hasMedical', opt.value)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                      form.hasMedical === opt.value
                        ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>
            {form.hasMedical === 'yes' && (
              <Field label="Medical Notes">
                <textarea value={form.medicalNotes ?? ''} onChange={e => set('medicalNotes', e.target.value)}
                  rows={2} placeholder="Allergies, conditions, medication…"
                  className={fieldCls + ' resize-none'} />
              </Field>
            )}
          </div>

          {/* ── Notes ── */}
          <div className="space-y-3 pt-1 pb-2">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Notes</p>
            <textarea value={form.notes ?? ''} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="Any remarks about this lead…"
              className={fieldCls + ' resize-none'} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100">
          <button onClick={handleSave} disabled={!canSave || saving}
            className="w-full bg-brand-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-40 hover:bg-brand-700 active:scale-[0.98] transition-all shadow-sm">
            {saving
              ? (isEdit ? 'Saving…' : 'Adding lead…')
              : (isEdit ? 'Save Changes' : 'Add Trial Lead')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Schedule Modal (new → scheduled, or reschedule) ──────────

function ScheduleModal({ trial, batches, onClose, onSave }) {
  useBodyScrollLock()
  const { showToast } = useApp()
  const [date,    setDate]    = useState(trial.trialDate || todayStr())
  const [batchId, setBatchId] = useState(trial.batchId ? String(trial.batchId) : '')
  const [saving,  setSaving]  = useState(false)

  const batchOpts = trial.sport ? batches.filter(b => (b.sports || []).includes(trial.sport)) : batches

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(trial.id, { stage: 'scheduled', trialDate: date, batchId: batchId ? Number(batchId) : null })
      onClose()
    } catch (e) { showToast(e.message || 'Failed to schedule trial', 'error') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-900">Schedule Trial</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100 text-gray-500"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm font-bold text-gray-700">{trial.name} · {trial.sport}</p>
          <div>
            <label className="label-xs">Trial Date *</label>
            <input value={date} onChange={e => setDate(e.target.value)} type="date" className="input-field" />
          </div>
          <div>
            <label className="label-xs">Assign Batch</label>
            <select value={batchId} onChange={e => setBatchId(e.target.value)} className="input-field">
              <option value="">Unassigned</option>
              {batchOpts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button onClick={handleSave} disabled={!date || saving}
            className="w-full bg-brand-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Collect Fee Modal (mark trial fee paid, without opening the full
//    edit form) ──────────────────────────────────────────────

function CollectFeeModal({ trial, batches, onClose, onSave }) {
  useBodyScrollLock()
  const { showToast, sportBranches, user, fetchTrialReceiptNo } = useApp()
  const feeBranch   = sportBranches.find(b => b.id === trial.branchId)
  const trialTaxPct = resolveBranchTax(feeBranch, 'trial')
  // /join already computes and stores the tax-inclusive TOTAL at registration
  // (computeTrialTotal in submitPublicTrial) — trust that number as-is, don't
  // tax it again. Anything entered through the office "New Trial Lead" form
  // before 0160 only ever asked for a raw base amount with no branch tax
  // applied at all, so for those, add the branch's current trial-fee tax on
  // top of whatever is stored, same rate /join would have quoted.
  const alreadyTaxed = trial.source === 'App'
  const storedFee     = trial.trialFeePaid ?? 590
  const suggestedCalc = alreadyTaxed
    ? { base: storedFee, taxPct: 0, taxAmount: 0, total: storedFee }
    : computeTax(storedFee, trialTaxPct)
  const [amount, setAmount] = useState(suggestedCalc.total)
  const [mode,   setMode]   = useState('Cash')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null) // set once saved — switches this modal to the receipt view

  async function handleSave() {
    setSaving(true)
    const finalAmount = amount === '' || amount == null ? 0 : (Number(amount) || 0)
    try {
      // Payload carries ONLY these two keys. secure_update_trial's CASE WHEN
      // pattern (0159) means every other column on the trial — name, batch,
      // stage, notes, everything — is left completely untouched; nothing
      // here can clobber a field this modal doesn't show. The RPC's payment
      // sync (create/update the linked payments row, book/clear the receipt)
      // is the exact same logic the full Edit form's Fee Collected control
      // already exercises — this is a narrower door onto the same system,
      // not a separate one.
      await onSave(trial.id, { trialFeePaid: finalAmount, trialFeeMode: mode })
      // secure_update_trial returns void, so the receipt number it just
      // generated (next_trial_receipt_id) has to be re-fetched — this is
      // read-only and can't affect what was just booked either way.
      let receiptNo = null
      try { receiptNo = await fetchTrialReceiptNo(trial.id) } catch { /* non-fatal — receipt still shows without it */ }
      setReceipt({ receiptNo, amount: finalAmount, mode, paidOn: new Date() })
    } catch (e) { showToast(e.message || 'Failed to record payment', 'error') } finally { setSaving(false) }
  }

  if (receipt) {
    const batch = batches?.find(b => b.id === trial.batchId)
    const html = buildTrialReceiptHTML({
      academyName: user?.academy,
      logoUrl:     user?.academyLogo,
      receiptNo:   receipt.receiptNo || `Trial-${trial.id}`,
      paymentRef:  null,
      paidOn:      receipt.paidOn,
      studentName: trial.name,
      parentName:  trial.parent,
      phone:       trial.phone,
      sport:       trial.sport,
      branchName:  feeBranch?.branchName,
      batchName:   batch?.name || null,
      fee: { trialFee: receipt.amount, kitFee: 0, taxPct: 0, taxAmount: 0, total: receipt.amount },
      method: receipt.mode,
    })
    const filename = `Receipt-${(receipt.receiptNo || trial.id).toString().replace(/[^A-Za-z0-9-]/g, '')}.html`
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
            <h2 className="text-base font-black text-gray-900">Fee Collected</h2>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100 text-gray-500"><X size={15} /></button>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
              <p className="text-sm font-bold text-emerald-800">₹{receipt.amount.toLocaleString('en-IN')} · {receipt.mode}</p>
              <p className="text-[11px] text-emerald-600 mt-0.5">{trial.name} · {receipt.receiptNo || `Trial #${trial.id}`}</p>
            </div>
            <ReceiptActions
              html={html} filename={filename}
              whatsappPhone={trial.phone}
              whatsappText={`Hi ${trial.parent || ''},\n\nReceipt for ${trial.name}'s trial fee — ₹${receipt.amount.toLocaleString('en-IN')} (${receipt.mode}).\n\n— ${user?.academy || 'Academy'}`}
              emailTo={trial.email}
              emailSubject={`Trial Fee Receipt — ${trial.name}`}
              emailBody={`Receipt attached for ${trial.name}'s trial fee: ₹${receipt.amount.toLocaleString('en-IN')} (${receipt.mode}).`}
            />
          </div>
          <div className="px-5 pb-5">
            <button onClick={onClose} className="w-full text-xs text-gray-500 hover:text-gray-700 underline">
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-900">Collect Trial Fee</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100 text-gray-500"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm font-bold text-gray-700">{trial.name} · {trial.sport}</p>

          <div>
            <label className="label-xs">Amount ₹</label>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-400 focus-within:bg-white transition">
              <span className="flex items-center px-3 text-sm font-semibold text-gray-500 bg-gray-100 border-r border-gray-200 shrink-0 select-none">₹</span>
              <input value={amount} onChange={e => setAmount(e.target.value)}
                type="number" min="0" inputMode="numeric" autoFocus
                className="flex-1 px-3 py-2.5 text-sm text-gray-900 bg-transparent focus:outline-none" />
            </div>
            {suggestedCalc.taxAmount > 0 && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                ₹{storedFee.toLocaleString('en-IN')} + {taxRowLabel(suggestedCalc.taxPct)}
                {' '}(₹{suggestedCalc.taxAmount.toLocaleString('en-IN')}) — branch tax, Settings &gt; Fees &amp; Tax
              </p>
            )}
          </div>

          <div>
            <label className="label-xs">Payment Mode</label>
            <div className="flex gap-2 mt-1">
              {['Cash', 'UPI'].map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                    mode === m
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            ₹{Number(amount) || 0} will be recorded as revenue with a trial receipt.
          </p>
        </div>
        <div className="px-5 pb-5">
          <button onClick={handleSave} disabled={saving}
            className="w-full bg-brand-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-40">
            {saving ? 'Saving…' : 'Mark Fee Collected'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Session Modal (mark attended + optional note) ─────────────

function SessionModal({ trial, onClose, onSave }) {
  useBodyScrollLock()
  const { showToast } = useApp()
  const [note,   setNote]   = useState('')
  const [rec,    setRec]    = useState('')
  const [saving, setSaving] = useState(false)
  const newDone = (trial.sessionsDone || 0) + 1
  // Matches StaffTrials.jsx's AttendSheet exactly — only advance the pipeline
  // stage once the LAST expected session is marked, not every session. A
  // multi-session trial (trialSessions > 1) should stay "Scheduled" between
  // sessions; only the final one completes it.
  const isLastSession = newDone >= (trial.trialSessions || 1)

  async function handleSave() {
    setSaving(true)
    try {
      const updates = { sessionsDone: newDone, ...(isLastSession ? { stage: 'attended' } : {}) }
      if (note.trim()) updates.coachNote = note.trim()
      if (rec)         updates.coachRec  = rec
      await onSave(trial.id, updates)
      onClose()
    } catch (e) { showToast(e.message || 'Failed to save session', 'error') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-900">Mark Session {newDone}</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600">
            <span className="font-bold text-gray-900">{trial.name}</span> — Session {newDone} of {trial.trialSessions}
          </p>
          <div>
            <label className="label-xs">Coach Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Observations about this player…"
              className="input-field resize-none" />
          </div>
          <div>
            <label className="label-xs">Recommendation</label>
            <div className="flex gap-2 mt-1">
              {[
                { id: 'accept',   label: 'Accept',    cls: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
                { id: 'followup', label: 'Follow-up', cls: 'border-orange-400 bg-orange-50 text-orange-700'   },
                { id: 'decline',  label: 'Decline',   cls: 'border-red-400 bg-red-50 text-red-600'            },
              ].map(r => (
                <button key={r.id} type="button" onClick={() => setRec(rec === r.id ? '' : r.id)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition ${rec === r.id ? r.cls : 'border-gray-200 text-gray-400 bg-white'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button onClick={handleSave} disabled={saving}
            className="w-full bg-brand-600 text-white rounded-xl py-3 font-bold text-sm disabled:opacity-40">
            {saving ? 'Saving…' : isLastSession ? 'Mark Attended' : `Save Session ${newDone}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Convert Modal ─────────────────────────────────────────────

function ConvertModal({ trial, batches, feePlans, onClose, onConvert }) {
  useBodyScrollLock()
  const batchOpts = trial.sport
    ? batches.filter(b => (b.sports || []).includes(trial.sport))
    : batches

  const autoMonth = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  const [form, setForm] = useState({
    name:        trial.name,
    parent:      trial.parent      || '',
    phone:       trial.phone       || '',
    parentPhone: '',
    dob:         trial.dob         || '',
    sport:       trial.sport,
    batchId:     trial.batchId ? String(trial.batchId) : '',
    batchName:   '',
    joinDate:    todayStr(),
    fees:        trial.quotedFee ? String(trial.quotedFee) : '',
    feePlan:     'monthly',
    feePlanId:   '',
    trainingType:'Daily',
    paidTill:    trial.trialFeePaid > 0 ? autoMonth : '',
    joiningFee:  '',
  })
  const [errors, setErrors] = useState({})

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleBatch = (id) => {
    const b = batches.find(b => String(b.id) === id)
    const batchPlans = feePlans.filter(p => p.batchId === Number(id))
    // Auto-fill from whichever plan matches the CURRENT training type
    // (defaults to 'Daily') so picking a batch alone already suggests a fee
    // — the type is already visually selected, no need to make them re-click
    // it just to trigger handleTrainingType's own matching.
    const matches     = batchPlans.filter(p => normTrainingType(p.trainingType) === normTrainingType(form.trainingType))
    const matchedPlan = matches.length === 1 ? matches[0] : null
    const feeMap       = matchedPlan ? { monthly: matchedPlan.monthlyFee, quarterly: matchedPlan.quarterlyFee, yearly: matchedPlan.yearlyFee } : null
    setForm(f => ({
      ...f,
      batchId:    id ? Number(id) : '',
      batchName:  b ? b.name : '',
      feePlanId:  matchedPlan ? matchedPlan.id : '',
      ...(matchedPlan
        ? { fees: feeMap[f.feePlan] || matchedPlan.monthlyFee || '' }
        : (batchPlans.length === 0 && b?.defaultFee ? { fees: b.defaultFee } : {})),
      ...(batchPlans.length === 0 && b?.defaultPlan ? { feePlan: b.defaultPlan } : {}),
    }))
  }

  const handleFeePlanPick = (planId) => {
    const plan = feePlans.find(p => String(p.id) === String(planId))
    if (!plan) { setForm(f => ({ ...f, feePlanId: '' })); return }
    const feeMap = { monthly: plan.monthlyFee, quarterly: plan.quarterlyFee, yearly: plan.yearlyFee }
    setForm(f => ({
      ...f,
      feePlanId:    plan.id,
      // Bridge the casing gap: fee plans store 'alternate'/'daily', students
      // store 'Alternate'/'Daily'. Normalise first so a plan saved with any
      // casing doesn't silently land the student on 'Daily'.
      trainingType: normTrainingType(plan.trainingType) === 'alternate' ? 'Alternate' : 'Daily',
      fees:         feeMap[f.feePlan] || plan.monthlyFee || '',
    }))
  }

  // Daily/Alternate is now the ONE way to pick training type, whether or not
  // the batch has named fee plans — unifies what used to be two disconnected
  // UIs (a "Fee Plan" dropdown when plans existed, plain buttons that never
  // touched the fee when they didn't). Picking a type looks up whichever
  // named plan matches THIS batch + type and auto-fills the fee from it; if
  // more than one plan matches, the caller shows a small disambiguation
  // dropdown instead of guessing which one they meant.
  const handleTrainingType = (type) => {
    const candidates = feePlans.filter(p =>
      p.batchId === Number(form.batchId) &&
      normTrainingType(p.trainingType) === normTrainingType(type))
    if (candidates.length === 1) {
      const plan = candidates[0]
      const feeMap = { monthly: plan.monthlyFee, quarterly: plan.quarterlyFee, yearly: plan.yearlyFee }
      setForm(f => ({ ...f, trainingType: type, feePlanId: plan.id, fees: feeMap[f.feePlan] || plan.monthlyFee || '' }))
    } else {
      // 0 matches: nothing to auto-fill, fee stays manually editable as
      // before. >1 match: caller renders a small picker to disambiguate.
      setForm(f => ({ ...f, trainingType: type, feePlanId: '' }))
    }
  }

  const handleJoinDate = (date) => {
    setForm(f => ({
      ...f, joinDate: date,
      paidTill: f.feePlan !== 'custom' ? calcPaidTill(date, f.feePlan) : f.paidTill,
    }))
  }

  const handleFeePlan = (plan) => {
    setForm(f => {
      const sel = f.feePlanId ? feePlans.find(p => String(p.id) === String(f.feePlanId)) : null
      const feeMap = sel ? { monthly: sel.monthlyFee, quarterly: sel.quarterlyFee, yearly: sel.yearlyFee } : null
      return {
        ...f, feePlan: plan,
        paidTill: plan !== 'custom' ? calcPaidTill(f.joinDate, plan) : '',
        ...(feeMap && feeMap[plan] ? { fees: feeMap[plan] } : {}),
      }
    })
  }

  const validate = () => {
    const e = {}
    if (!form.name.trim())                    e.name    = 'Required'
    if (!/^\d{10}$/.test(form.phone))         e.phone   = 'Enter 10-digit number'
    if (!form.fees || Number(form.fees) <= 0) e.fees    = 'Required'
    if (!form.batchId)                        e.batchId = 'Select a batch'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSave() {
    if (!validate()) return
    // Parent (handleConvert) closes modal immediately and handles errors internally
    onConvert(form)
  }

  const preview     = coveragePreview(form.joinDate, form.paidTill)
  // trialFeePaid ALWAYS defaults to 590 on every trial row regardless of
  // whether it was actually collected — trialFeeMode is the real signal
  // (same gotcha already handled in TrialCard/TrialSlipModal in this file).
  // Without this check, a trial explicitly marked "Not collected" still had
  // its fee deducted here, undercharging the first payment by that amount —
  // real lost revenue, not just a cosmetic display bug.
  const trialDeduct = trial.trialFeeMode !== 'Not collected' ? (trial.trialFeePaid || 0) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* No backdrop-blur — it forces the browser to keep recompositing this
          layer as the modal's own content scrolls, which reads as jank even
          with body scroll locked. Plain dimming has the same visual read
          without the performance cost. */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-black text-gray-900">Convert to Student</h3>
            <p className="text-xs text-gray-400 mt-0.5">Pre-filled from trial — complete all details</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Trial badge */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 mb-5">
            <span className="text-amber-500 text-base flex-shrink-0">★</span>
            <p className="text-xs text-amber-800 font-semibold">A Student ID and Join Code will be auto-generated on conversion.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Name */}
            <div className="sm:col-span-2">
              <label className="label">Student Name *</label>
              <input className={`input ${errors.name ? 'border-red-400' : ''}`}
                value={form.name} onChange={e => set('name', e.target.value)} />
              {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* Parent */}
            <div>
              <label className="label">Parent Name</label>
              <input className="input" placeholder="Father / Mother name"
                value={form.parent} onChange={e => set('parent', e.target.value)} />
            </div>

            {/* DOB */}
            <div>
              <label className="label">Date of Birth</label>
              <input className="input" type="date"
                value={form.dob || ''} onChange={e => set('dob', e.target.value)} />
            </div>

            {/* Student Phone */}
            <div>
              <label className="label">Student Phone *</label>
              <div className="flex">
                <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
                <input className={`input rounded-l-none flex-1 ${errors.phone ? 'border-red-400' : ''}`}
                  placeholder="10-digit number" inputMode="numeric" maxLength={10}
                  value={form.phone} onChange={e => set('phone', e.target.value.replace(/\D/g,'').slice(0,10))} />
              </div>
              {errors.phone && <p className="text-[11px] text-red-500 mt-1">{errors.phone}</p>}
            </div>

            {/* Parent Phone */}
            <div>
              <label className="label">Parent Phone</label>
              <div className="flex">
                <span className="flex items-center px-3 bg-gray-100 border border-gray-200 border-r-0 rounded-l-lg text-sm font-semibold text-gray-600 whitespace-nowrap">+91</span>
                <input className="input rounded-l-none flex-1"
                  placeholder="10-digit number" inputMode="numeric" maxLength={10}
                  value={form.parentPhone || ''} onChange={e => set('parentPhone', e.target.value.replace(/\D/g,'').slice(0,10))} />
              </div>
            </div>

            {/* Batch */}
            <div className="sm:col-span-2">
              <label className="label">Primary Batch *</label>
              <select className={`input ${errors.batchId ? 'border-red-400' : ''}`}
                value={form.batchId} onChange={e => handleBatch(e.target.value)}>
                <option value="">— Select Batch —</option>
                {batchOpts.map(b => <option key={b.id} value={b.id}>{b.name}{b.code ? ` (${b.code})` : ''}</option>)}
              </select>
              {errors.batchId && <p className="text-[11px] text-red-500 mt-1">{errors.batchId}</p>}
            </div>

            {/* Training type — always the primary control now. Picking Daily/
                Alternate auto-fills the fee from whichever named plan matches
                this batch + type; if more than one plan matches, a small
                picker below lets them disambiguate instead of guessing. */}
            <div className="sm:col-span-2">
              <label className="label">Training Type</label>
              <div className="flex gap-2">
                {['Daily','Alternate'].map(t => (
                  <button key={t} type="button" onClick={() => handleTrainingType(t)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold border transition ${form.trainingType === t ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {(() => {
                const matches = form.batchId ? feePlans.filter(p =>
                  p.batchId === Number(form.batchId) &&
                  normTrainingType(p.trainingType) === normTrainingType(form.trainingType)) : []
                if (matches.length > 1) {
                  return (
                    <select className="input mt-2" value={form.feePlanId} onChange={e => handleFeePlanPick(e.target.value)}>
                      <option value="">— Select Plan —</option>
                      {matches.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )
                }
                if (form.feePlanId && matches.length === 1) {
                  return <p className="text-[11px] text-emerald-600 mt-1.5">Fee auto-filled from "{matches[0].name}"</p>
                }
                return null
              })()}
            </div>

            {/* Fee duration */}
            <div className="sm:col-span-2">
              <label className="label">Fee Duration</label>
              <div className="grid grid-cols-4 gap-2">
                {FEE_PLAN_OPTIONS.map(p => (
                  <button key={p.key} type="button" onClick={() => handleFeePlan(p.key)}
                    className={`py-3 rounded-xl text-xs font-bold border transition ${form.feePlan === p.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                    <div>{p.label}</div>
                    <div className={`font-normal mt-0.5 ${form.feePlan === p.key ? 'text-brand-200' : 'text-gray-400'}`}>{p.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Fee amount */}
            <div>
              <label className="label">{FEE_LABEL[form.feePlan] || 'Fee (₹) *'}</label>
              <input className={`input ${errors.fees ? 'border-red-400' : ''}`}
                type="number" inputMode="numeric" placeholder="e.g. 4500"
                value={form.fees} onChange={e => set('fees', e.target.value)} />
              {errors.fees && <p className="text-[11px] text-red-500 mt-1">{errors.fees}</p>}
            </div>

            {/* Join Date */}
            {form.feePlan !== 'custom' && (
              <div>
                <label className="label">Join Date</label>
                <input className="input" type="date" value={form.joinDate}
                  max={toLocalDateStr()}
                  onChange={e => handleJoinDate(e.target.value)} />
              </div>
            )}

            {/* Paid Till */}
            {form.feePlan !== 'custom' && (
              <div className="sm:col-span-2">
                <label className="label">Paid Till</label>
                <input className="input" type="month" value={form.paidTill}
                  onChange={e => set('paidTill', e.target.value)} />
                {preview && <p className="text-xs text-brand-600 font-semibold mt-1">Covers: {preview}</p>}
              </div>
            )}

            {/* Custom date range */}
            {form.feePlan === 'custom' && (
              <div className="sm:col-span-2 bg-brand-50 border border-brand-100 rounded-xl p-4 grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="label text-brand-700">Join / Start Date</label>
                  <input className="input" type="date" max={toLocalDateStr()}
                    value={form.joinDate} onChange={e => set('joinDate', e.target.value)} />
                </div>
                <div>
                  <label className="label text-brand-700">Paid Till (End Date)</label>
                  <input className="input" type="date" min={form.joinDate || undefined}
                    value={form.paidTill} onChange={e => set('paidTill', e.target.value)} />
                </div>
                {preview && <p className="sm:col-span-2 text-xs text-brand-600 font-semibold -mt-2">Covers: {preview}</p>}
              </div>
            )}
          </div>

          {/* Trial fee deduction banner — always show when converting so joining fee is always accessible */}
          <div className="mt-4 rounded-xl overflow-hidden border border-emerald-200">
            <div className="bg-emerald-600 px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-black text-white uppercase tracking-wider">Trial Conversion — First Payment</span>
              {trialDeduct > 0 && <span className="text-[10px] text-emerald-100 font-semibold">₹{trialDeduct} already collected</span>}
            </div>
            <div className="bg-emerald-50 px-4 py-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>{FEE_LABEL[form.feePlan]?.replace(' *','') || 'Fee'}</span>
                <span className="font-semibold">₹{form.fees ? Number(form.fees).toLocaleString('en-IN') : '—'}</span>
              </div>
              {trialDeduct > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Trial Fee Deduction</span>
                  <span className="font-bold">− ₹{trialDeduct.toLocaleString('en-IN')}</span>
                </div>
              )}
              {/* Joining Fee row */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-purple-700 font-semibold">Joining Fee (one-time)</span>
                <div className="flex items-center gap-1">
                  <span className="text-purple-600 font-bold text-[11px]">+ ₹</span>
                  <input
                    type="number" min="0" inputMode="numeric"
                    placeholder="0"
                    value={form.joiningFee}
                    onChange={e => set('joiningFee', e.target.value)}
                    className="w-24 px-2 py-1 rounded-lg border border-purple-200 bg-white text-sm font-semibold text-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-300 text-right"
                  />
                </div>
              </div>
              <div className="flex justify-between font-black text-gray-900 border-t border-emerald-200 pt-2 text-sm">
                <span>First Payment Due</span>
                <span className="text-emerald-700">
                  ₹{form.fees
                    ? Math.max(0, Number(form.fees) - trialDeduct + (Number(form.joiningFee) || 0)).toLocaleString('en-IN')
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-2 px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-black hover:bg-emerald-700 active:scale-[0.98] transition flex items-center gap-2">
            ★ Convert to Student
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Source Manager Modal ──────────────────────────────────────

function SourceManager({ trialSources, addTrialSource, removeTrialSource, onClose }) {
  useBodyScrollLock()
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!label.trim()) return
    setSaving(true)
    await addTrialSource(label.trim())
    setLabel('')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-900">Lead Sources</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto">
          {trialSources.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No sources yet. Using defaults.</p>
          )}
          {trialSources.map(s => (
            <div key={s.id} className="flex items-center justify-between">
              <span className="text-sm text-gray-800">{s.label}</span>
              <button onClick={() => removeTrialSource(s.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 border-t border-gray-100 pt-3 flex gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="New source name…"
            className="flex-1 input-field" />
          <button onClick={handleAdd} disabled={!label.trim() || saving}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Age Group Manager Modal ───────────────────────────────────

function AgeGroupManager({ ageGroups, addAgeGroup, removeAgeGroup, onClose }) {
  useBodyScrollLock()
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!label.trim()) return
    setSaving(true)
    await addAgeGroup(label.trim())
    setLabel('')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-black text-gray-900">Age Groups</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl bg-gray-100"><X size={15} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto">
          {ageGroups.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No age groups yet. Using defaults.</p>
          )}
          {ageGroups.map(g => (
            <div key={g.id} className="flex items-center justify-between">
              <span className="text-sm text-gray-800">{g.label}</span>
              <button onClick={() => removeAgeGroup(g.id)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="px-5 pb-5 border-t border-gray-100 pt-3 flex gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="New age group name…"
            className="flex-1 input-field" />
          <button onClick={handleAdd} disabled={!label.trim() || saving}
            className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-bold disabled:opacity-40">
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Trial Card ────────────────────────────────────────────────

function TrialCard({ trial, batches, onAction, onDelete }) {
  const batch = batches.find(b => b.id === trial.batchId)
  const st    = STAGE_STYLE[trial.stage] || STAGE_STYLE.new
  const rec   = trial.coachRec ? REC_STYLE[trial.coachRec] : null
  const isDone = trial.stage === 'converted' || trial.stage === 'rejected'
  // trialFeePaid always defaults to 590 regardless of whether it was actually
  // collected — trialFeeMode is the real signal (see trial-fee-revenue-model
  // memory). The quoted program fee (below) is a different number entirely
  // and showing it alone reads as "the trial fee," so it's easy to mistake a
  // ₹1,000 quote for a paid trial fee when nothing was collected.
  const feeCollected = trial.trialFeeMode !== 'Not collected'

  return (
    <div className={`bg-white rounded-2xl border p-4 space-y-3 ${isDone ? 'border-gray-100 opacity-70' : 'border-gray-200 shadow-sm'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-black text-gray-900 text-sm">{trial.name}</p>
            {trial.age && <span className="text-[10px] text-gray-400 font-semibold">{trial.age}y</span>}
            {trial.quotedFee && (
              <span className="text-[10px] text-gray-400 font-semibold">Fee ₹{trial.quotedFee.toLocaleString('en-IN')}</span>
            )}
          </div>
          <div className="mt-1">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
              feeCollected ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {feeCollected
                ? `✓ Trial fee paid · ₹${(trial.trialFeePaid ?? 590).toLocaleString('en-IN')}`
                : '✗ Trial fee not collected'}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-gray-400 flex items-center gap-1"><Phone size={9} />{trial.phone}</span>
            {trial.parent && <span className="text-[10px] text-gray-400 flex items-center gap-1"><User size={9} />{trial.parent}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => onAction('edit', trial)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition">
            <Pencil size={13} />
          </button>
          <button onClick={() => onDelete(trial)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition">
            <Trash2 size={13} />
          </button>
          <div className="flex flex-col items-end gap-1">
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${st.bg} ${st.text} capitalize`}>
              {trial.stage === 'converted' ? '✓ Converted' : trial.stage === 'rejected' ? '✗ Rejected' : trial.stage}
            </span>
            {rec && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${rec.bg} ${rec.text}`}>{rec.label}</span>
            )}
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
        <span className="badge badge-blue text-[11px]">{trial.sport}</span>
        {trial.trialDate && (
          <span className="flex items-center gap-1">
            <Calendar size={11} />{fmtDate(trial.trialDate)}
            {trial.sessionStart && (
              <span className="ml-0.5 text-gray-400">
                {trial.sessionStart.slice(0,5)}{trial.sessionEnd ? `–${trial.sessionEnd.slice(0,5)}` : ''}
              </span>
            )}
          </span>
        )}
        {batch && <span className="text-gray-400 text-[11px]">{batch.name}</span>}
        {/* Days the prospect asked for on /join — the main signal for placing
            them when the public form's batch step is turned off */}
        {trial.preferredDays?.length > 0 && (
          <span className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
            Prefers {trial.preferredDays.join(', ')}
          </span>
        )}
      </div>

      {/* Sessions */}
      {trial.trialSessions > 1 || trial.sessionsDone > 0 ? (
        <SessionDots done={trial.sessionsDone} total={trial.trialSessions} />
      ) : null}

      {/* Office notes */}
      {trial.notes && (
        <p className="text-xs text-gray-500 bg-amber-50 rounded-xl px-3 py-2 leading-relaxed border border-amber-100">
          {trial.notes}
        </p>
      )}

      {/* Coach note */}
      {trial.coachNote && (
        <p className="text-xs text-gray-500 italic bg-gray-50 rounded-xl px-3 py-2 leading-relaxed">
          "{trial.coachNote}"
        </p>
      )}

      {/* Stage actions */}
      {!isDone && (
        <div className="flex gap-2 flex-wrap pt-1">
          {trial.stage === 'new' && (
            trial.trialFeeMode === 'Not collected' ? (
              // Nothing gets scheduled on an unpaid trial — collect the fee
              // first, via a focused popup rather than the full Edit form.
              // Once the fee is no longer 'Not collected' this card flips to
              // the normal Schedule button on its own.
              <button onClick={() => onAction('collectFee', trial)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 text-white rounded-xl py-2 text-xs font-bold">
                <IndianRupee size={13} /> Collect Trial Fee to Schedule
              </button>
            ) : (
              <button onClick={() => onAction('schedule', trial)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 text-white rounded-xl py-2 text-xs font-bold">
                <Calendar size={13} /> Schedule
              </button>
            )
          )}

          {trial.stage === 'scheduled' && (
            trial.trialFeeMode === 'Not collected' ? (
              // Same gate as 'new': a scheduled-but-unpaid trial (pre-dates
              // this rule, or was scheduled before the fee was collected)
              // can't be progressed to Attended/session-marked either. No
              // Show stays open regardless — closing out a lead who never
              // showed up has nothing to do with whether they paid.
              <>
                <button onClick={() => onAction('collectFee', trial)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 text-white rounded-xl py-2 text-xs font-bold">
                  <IndianRupee size={13} /> Collect Trial Fee First
                </button>
                <button onClick={() => onAction('noshow', trial)}
                  className="px-3 bg-red-50 text-red-500 rounded-xl py-2 text-xs font-bold border border-red-100">
                  No Show
                </button>
              </>
            ) : (
              <>
                <button onClick={() => onAction('session', trial)}
                  className="flex-1 bg-amber-500 text-white rounded-xl py-2 text-xs font-bold">
                  + Mark Session
                </button>
                <button onClick={() => onAction('attend', trial)}
                  className="flex-1 bg-emerald-600 text-white rounded-xl py-2 text-xs font-bold">
                  → Attended
                </button>
                <button onClick={() => onAction('noshow', trial)}
                  className="px-3 bg-red-50 text-red-500 rounded-xl py-2 text-xs font-bold border border-red-100">
                  No Show
                </button>
              </>
            )
          )}

          {trial.stage === 'attended' && (
            <>
              <button onClick={() => onAction('accept', trial)}
                className="flex-1 bg-emerald-600 text-white rounded-xl py-2 text-xs font-bold">
                Accept ✓
              </button>
              <button onClick={() => onAction('followup', trial)}
                className="flex-1 bg-orange-500 text-white rounded-xl py-2 text-xs font-bold">
                Follow-up ↺
              </button>
              <button onClick={() => onAction('reject', trial)}
                className="flex-1 bg-red-500 text-white rounded-xl py-2 text-xs font-bold">
                Reject ✗
              </button>
            </>
          )}

          {trial.stage === 'accepted' && (
            <button onClick={() => onAction('convert', trial)}
              className="w-full bg-brand-600 text-white rounded-xl py-2.5 text-xs font-black flex items-center justify-center gap-2">
              <ArrowRight size={14} /> Convert → Student
            </button>
          )}

          {trial.stage === 'followup' && (
            <>
              <button onClick={() => onAction('schedule', trial)}
                className="flex-1 bg-brand-600 text-white rounded-xl py-2 text-xs font-bold">
                Reschedule
              </button>
              <button onClick={() => onAction('reject', trial)}
                className="px-3 bg-gray-100 text-gray-500 rounded-xl py-2 text-xs font-bold">
                Archive
              </button>
            </>
          )}
        </div>
      )}

      {trial.stage === 'rejected' && (
        <button onClick={() => onAction('reopen', trial)}
          className="text-xs text-gray-400 hover:text-brand-600 font-semibold">
          ↩ Reopen
        </button>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────

export default function Trials() {
  const { trials, addTrial, updateTrialStatus, deleteTrial, batches, feePlans, addStudent,
          trialSources, addTrialSource, removeTrialSource,
          ageGroups, addAgeGroup, removeAgeGroup, selectedSport, isAllSports,
          user } = useApp()

  const [stage,    setStage]    = useState('all')
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)
  const [modal,    setModal]    = useState(null) // null | 'add' | 'edit' | 'schedule' | 'session' | 'convert' | 'sources' | 'ageGroups' | 'slip'
  const [active,   setActive]   = useState(null) // the trial being actioned
  const [slipTrial,setSlipTrial]= useState(null) // trial to show receipt for

  // Stats
  const total     = trials.length
  const scheduled = trials.filter(t => t.stage === 'scheduled').length
  const attended  = trials.filter(t => t.stage === 'attended').length
  const converted = trials.filter(t => t.stage === 'converted').length
  const convRate  = total > 0 ? Math.round((converted / total) * 100) : 0

  // Filter
  const filtered = useMemo(() => {
    let list = trials
    if (stage === 'done')     list = list.filter(t => t.stage === 'converted' || t.stage === 'rejected')
    else if (stage === 'all') list = list.filter(t => t.stage !== 'converted' && t.stage !== 'rejected')
    else                      list = list.filter(t => t.stage === stage)
    if (search.trim())     list = list.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.phone || '').includes(search) ||
      (t.sport || '').toLowerCase().includes(search.toLowerCase())
    )
    return list
  }, [trials, stage, search])

  useEffect(() => setPage(1), [stage, search])
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Stage counts
  const stageCount = id => {
    if (id === 'all')  return trials.filter(t => t.stage !== 'converted' && t.stage !== 'rejected').length
    if (id === 'done') return trials.filter(t => t.stage === 'converted' || t.stage === 'rejected').length
    return trials.filter(t => t.stage === id).length
  }

  // Actions
  async function handleAction(type, trial) {
    setActive(trial)
    if (type === 'edit')       { setModal('edit');       return }
    if (type === 'schedule')   { setModal('schedule');   return }
    if (type === 'session')    { setModal('session');    return }
    if (type === 'convert')    { setModal('convert');    return }
    if (type === 'collectFee') { setModal('collectFee'); return }

    const updates = {
      attend:  { stage: 'attended'  },
      accept:  { stage: 'accepted'  },
      followup:{ stage: 'followup'  },
      reject:  { stage: 'rejected'  },
      noshow:  { stage: 'rejected', coachNote: 'No show' },
      reopen:  { stage: 'scheduled' },
    }[type]

    if (updates) {
      await updateTrialStatus(trial.id, updates)
      setActive(null)
    }
  }

  async function handleConvert(form) {
    const trial = active  // capture before clearing
    // Close modal and mark converted immediately — prevents any re-click duplication.
    // `silent: true` because `addStudent` below will already toast "Student created" —
    // a separate "Trial updated" toast would be redundant and confusing.
    setModal(null)
    setActive(null)
    updateTrialStatus(trial.id, { stage: 'converted', converted: true }, { silent: true })

    try {
      await addStudent({
        name:         form.name,
        parent:       form.parent      || '',
        phone:        form.phone,
        parentPhone:  form.parentPhone || '',
        dob:          form.dob         || null,
        age:          form.dob ? null : (form.age ? Number(form.age) : null),
        sport:        form.sport,
        batchId:      form.batchId ? Number(form.batchId) : null,
        batchName:    form.batchName   || '',
        joinDate:     form.joinDate,
        fees:         Number(form.fees) || 0,
        feePlan:      form.feePlan,
        trainingType: form.trainingType || 'Daily',
        paidTill:     form.paidTill    || null,
        fromTrial:    true,
        // Answered on the /join form and stored on the trial row — carry the
        // whole set onto the student so converting doesn't quietly drop a
        // declared medical condition or the emergency contact. `students` has
        // matching columns since migrations 0152/0153.
        medicalNotes:          trial.medicalNotes          || '',
        relationship:          trial.relationship          || '',
        gender:                trial.gender                || '',
        motherName:            trial.motherName            || '',
        email:                 trial.email                 || '',
        alternateContactPhone: trial.alternateContactPhone || '',
        occupation:            trial.occupation            || '',
        address:               trial.address               || '',
        emergencyContactName:  trial.emergencyContactName  || '',
        emergencyContactPhone: trial.emergencyContactPhone || '',
        // trialFeePaid always defaults to 590 on every trial row regardless
        // of whether it was collected — trialFeeMode is the real signal.
        // Without this check, converting a "Not collected" trial still
        // deducted the fee from the actual saved first payment (real lost
        // revenue), even after the modal's own preview was fixed to show
        // the correct amount — this is a separate code path that bypassed
        // that fix entirely.
        trialFeePaid: trial.trialFeeMode !== 'Not collected' ? (trial.trialFeePaid || 0) : 0,
        // Lets addStudent attach the fee receipt already booked at trial
        // time to this student, instead of creating a second payment row.
        trialId:      trial.id,
        joiningFee:   Number(form.joiningFee) || 0,
      })
    } catch {
      // Revert trial stage if student creation failed (silent — addStudent already toasted the failure)
      updateTrialStatus(trial.id, { stage: 'accepted' }, { silent: true })
    }
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-black text-gray-900">Trial Management</h2>
          <p className="text-sm text-gray-500">Pipeline: capture → schedule → assess → convert</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setModal('sources')}
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition" title="Manage sources">
            <Settings2 size={16} />
          </button>
          <button onClick={() => setModal('ageGroups')}
            className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition" title="Manage age groups">
            <Users size={16} />
          </button>
          <button onClick={() => setModal('add')} className="btn-primary">
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',   value: total,     color: 'text-gray-900'    },
          { label: 'Scheduled',     value: scheduled,  color: 'text-brand-600'   },
          { label: 'Attended',      value: attended,   color: 'text-amber-600'   },
          { label: 'Converted',     value: `${converted} (${convRate}%)`, color: 'text-emerald-600' },
        ].map(s => (
          <div key={s.label} className="card p-4 text-center">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Pipeline tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {STAGES.map(s => (
          <button key={s.id} onClick={() => setStage(s.id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              stage === s.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {s.label}
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
              stage === s.id ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
            }`}>{stageCount(s.id)}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
        <Search size={14} className="text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, sport…"
          className="bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none flex-1" />
        {search && <button onClick={() => setSearch('')}><X size={13} className="text-gray-400" /></button>}
      </div>

      {/* Trial cards grid */}
      {filtered.length === 0 ? (
        <div className="card py-16 text-center">
          <UserPlus size={32} className="text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-400">No leads in this stage</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paged.map(t => (
              <TrialCard key={t.id} trial={t} batches={batches} onAction={handleAction}
                onDelete={t => {
                  // An unconverted trial's fee receipt is deleted with it,
                  // so revenue drops. Say so rather than surprising them.
                  const fee = Number(t.trialFeePaid) || 0
                  const losesRevenue = !t.converted && fee > 0 && t.trialFeeMode !== 'Not collected'
                  const msg = losesRevenue
                    ? `Delete "${t.name}"?\n\nThe ₹${fee.toLocaleString('en-IN')} trial fee receipt will also be removed and revenue will drop by that amount.\n\nThis cannot be undone.`
                    : `Delete "${t.name}"? This cannot be undone.`
                  if (window.confirm(msg)) deleteTrial(t.id)
                }} />
            ))}
          </div>
          <Paginator page={page} total={filtered.length} onChange={setPage} />
        </>
      )}

      {/* Modals */}
      {modal === 'add' && (
        <TrialModal
          batches={batches}
          selectedSport={isAllSports ? null : selectedSport}
          onClose={() => setModal(null)}
          onSave={async (data) => {
            await addTrial(data)
            setSlipTrial({ ...data, trialFeePaid: data.trialFeePaid ?? 590 })
            setModal(null)
          }}
        />
      )}
      {modal === 'edit' && active && (
        <TrialModal
          batches={batches}
          selectedSport={isAllSports ? null : selectedSport}
          initial={active}
          isEdit
          onClose={() => { setModal(null); setActive(null) }}
          onSave={updates => updateTrialStatus(active.id, updates)}
        />
      )}
      {modal === 'schedule' && active && (
        <ScheduleModal
          trial={active} batches={batches}
          onClose={() => { setModal(null); setActive(null) }}
          onSave={updateTrialStatus}
        />
      )}
      {modal === 'session' && active && (
        <SessionModal
          trial={active}
          onClose={() => { setModal(null); setActive(null) }}
          onSave={updateTrialStatus}
        />
      )}
      {modal === 'collectFee' && active && (
        <CollectFeeModal
          trial={active} batches={batches}
          onClose={() => { setModal(null); setActive(null) }}
          onSave={updateTrialStatus}
        />
      )}
      {modal === 'convert' && active && (
        <ConvertModal
          trial={active} batches={batches} feePlans={feePlans}
          onClose={() => { setModal(null); setActive(null) }}
          onConvert={handleConvert}
        />
      )}
      {modal === 'sources' && (
        <SourceManager
          trialSources={trialSources}
          addTrialSource={addTrialSource}
          removeTrialSource={removeTrialSource}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'ageGroups' && (
        <AgeGroupManager
          ageGroups={ageGroups}
          addAgeGroup={addAgeGroup}
          removeAgeGroup={removeAgeGroup}
          onClose={() => setModal(null)}
        />
      )}
      {slipTrial && (
        <TrialSlipModal
          trial={slipTrial}
          academyName={user?.academy || 'Academy'}
          logoUrl={user?.academyLogo || null}
          onClose={() => setSlipTrial(null)}
        />
      )}
    </div>
  )
}
