import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { QRCodeSVG } from 'qrcode.react'
import { Clock, RefreshCw, Monitor } from 'lucide-react'

const CHECKIN_PREFIX = 'sportflow-staff:'

function generateToken(academyId) {
  const now  = new Date()
  const date = now.toISOString().slice(0, 10)   // "2026-05-08"
  const hour = now.getHours()                    // 0-23
  return `${CHECKIN_PREFIX}${academyId}:${date}:${hour}`
}

function minsUntilNextHour() {
  const now = new Date()
  return 60 - now.getMinutes() - (now.getSeconds() > 0 ? 0 : 0)
}

export default function StaffAttendanceQR() {
  const { user } = useApp()
  const [token,    setToken]    = useState(() => generateToken(user?.academyId || 'demo'))
  const [timeLeft, setTimeLeft] = useState(minsUntilNextHour())
  const qrRef = useRef(null)

  // Regenerate token every hour on the hour
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const mins = 60 - now.getMinutes()
      setTimeLeft(mins)
      setToken(generateToken(user?.academyId || 'demo'))
    }

    // Check every minute
    const interval = setInterval(() => {
      const now = new Date()
      setTimeLeft(60 - now.getMinutes())
      // Regenerate at top of hour
      if (now.getMinutes() === 0) {
        setToken(generateToken(user?.academyId || 'demo'))
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [user?.academyId])

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
      const link = document.createElement('a')
      link.download = 'staff-qr.png'
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
  }

  const hourLabel = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-5 max-w-[800px]">
      <div>
        <h2 className="text-xl font-black text-gray-900">Staff Attendance QR</h2>
        <p className="text-sm text-gray-500">Display this on your entrance monitor. Staff scan it to clock in. Refreshes every hour.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* QR display */}
        <div className="card p-6 flex flex-col items-center gap-5">
          <div ref={qrRef} className="p-5 bg-white rounded-2xl border-2 border-gray-900 shadow-sm">
            <QRCodeSVG value={token} size={220} bgColor="#ffffff" fgColor="#111827" level="H" includeMargin={false} />
          </div>

          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">{user?.academy}</p>
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
