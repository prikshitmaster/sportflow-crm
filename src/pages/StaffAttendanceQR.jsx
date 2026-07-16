import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { QRCodeSVG } from 'qrcode.react'
import { Clock, RefreshCw, Monitor } from 'lucide-react'
import { toLocalDateStr } from '../lib/dates'
import { saveOrShareFile } from '../lib/nativeSave'

const CHECKIN_PREFIX = 'sportflow-staff:'

// Token is branch-scoped: each branch shows a distinct code, and StaffScanIn
// hard-blocks a staff member whose branch doesn't match.
function generateToken(academyId, branchId) {
  const now  = new Date()
  const date = toLocalDateStr(now)              // "2026-05-08"
  const hour = now.getHours()                    // 0-23
  return `${CHECKIN_PREFIX}${academyId}:${branchId}:${date}:${hour}`
}

function minsUntilNextHour() {
  const now = new Date()
  return 60 - now.getMinutes() - (now.getSeconds() > 0 ? 0 : 0)
}

export default function StaffAttendanceQR() {
  const { user, role, selectedBranch, sportBranches } = useApp()
  // Branch-scoped: owner uses the branch they're in; a branch manager their own.
  const effectiveBranch = role === 'staff' ? (user?.branchId || null) : selectedBranch
  const branchName = effectiveBranch
    ? ((sportBranches || []).find(b => b.id === effectiveBranch)?.branchName || 'This branch')
    : null
  const [token,    setToken]    = useState(() => generateToken(user?.academyId || 'demo', effectiveBranch || 'none'))
  const [timeLeft, setTimeLeft] = useState(minsUntilNextHour())
  const qrRef = useRef(null)

  // Regenerate token hourly, and whenever academy/branch changes.
  useEffect(() => {
    setToken(generateToken(user?.academyId || 'demo', effectiveBranch || 'none'))
    const interval = setInterval(() => {
      const now = new Date()
      setTimeLeft(60 - now.getMinutes())
      if (now.getMinutes() === 0) {
        setToken(generateToken(user?.academyId || 'demo', effectiveBranch || 'none'))
      }
    }, 60000)
    return () => clearInterval(interval)
  }, [user?.academyId, effectiveBranch])

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const svgStr = new XMLSerializer().serializeToString(svg)
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512)
      ctx.drawImage(img, 0, 0, 512, 512)
      canvas.toBlob(blob => { if (blob) saveOrShareFile(blob, 'staff-qr.png') }, 'image/png')
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
  }

  const hourLabel = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  if (!effectiveBranch) {
    return (
      <div className="space-y-5 max-w-[800px]">
        <div>
          <h2 className="text-xl font-black text-gray-900">Staff Attendance QR</h2>
          <p className="text-sm text-gray-500">Each branch has its own staff clock-in QR.</p>
        </div>
        <div className="card p-8 text-center">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock size={26} className="text-amber-400" />
          </div>
          <p className="font-semibold text-gray-900 mb-1">Open a specific branch first</p>
          <p className="text-sm text-gray-500">Pick a branch from the switcher to display that branch's staff clock-in QR.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-[800px]">
      <div>
        <h2 className="text-xl font-black text-gray-900">Staff Attendance QR</h2>
        <p className="text-sm text-gray-500">Display this at <span className="font-semibold text-brand-600">{branchName}</span>. Only this branch's staff can clock in with it. Refreshes every hour.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* QR display */}
        <div className="card p-6 flex flex-col items-center gap-5">
          <div ref={qrRef} className="p-5 bg-white rounded-2xl border-2 border-gray-900 shadow-sm">
            <QRCodeSVG value={token} size={220} bgColor="#ffffff" fgColor="#111827" level="H" includeMargin={false} />
          </div>

          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">{user?.academy}</p>
            <p className="text-xs font-semibold text-brand-600 mt-0.5">{branchName}</p>
            <p className="text-xs text-gray-400 mt-0.5">Staff Clock-in QR</p>
            <div className="flex items-center justify-center gap-1.5 mt-2">
              <Clock size={12} className="text-amber-500" />
              <span className="text-xs font-semibold text-amber-600">
                Refreshes in {timeLeft} min · current hour: {hourLabel}
              </span>
            </div>
          </div>

          <div className="flex gap-3 w-full">
            <button onClick={handleDownload} className="flex-1 btn-secondary justify-center py-2.5 text-sm gap-2">
              Download PNG
            </button>
            <button onClick={() => window.print()} className="flex-1 btn-primary justify-center py-2.5 text-sm gap-2">
              🖨 Print
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw size={16} className="text-brand-500" />
              <p className="font-semibold text-gray-900 text-sm">Hourly Rotation</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              This QR code changes every hour automatically. Yesterday's screenshot won't work — staff must be physically present to scan the current code.
            </p>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-xs font-semibold text-amber-800">Current window</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Valid for this hour and 10 min into the next (grace period for end-of-hour scans).
              </p>
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={16} className="text-brand-500" />
              <p className="font-semibold text-gray-900 text-sm">Display Setup</p>
            </div>
            <ol className="space-y-2 text-xs text-gray-600">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
                Open this page on your entrance monitor / reception screen
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
                Leave it open — the QR refreshes automatically every hour
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
                Staff (coaches + office) scan it each morning to clock in
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span>
                One scan per person per day — duplicates are blocked
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
