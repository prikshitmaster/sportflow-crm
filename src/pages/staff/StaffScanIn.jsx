import { useState, useEffect, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { QrCode, CheckCircle2, XCircle, Camera } from 'lucide-react'
import jsQR from 'jsqr'
import * as db from '../../lib/db'

const CHECKIN_PREFIX = 'sportflow-staff:'

function validateToken(qrValue, academyId) {
  if (!qrValue?.startsWith(CHECKIN_PREFIX)) return false
  const parts = qrValue.slice(CHECKIN_PREFIX.length).split(':')
  if (parts.length !== 3) return false
  const [qrAcademy, qrDate, qrHour] = parts
  if (qrAcademy !== academyId) return false
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const currentHour = now.getHours()
  const prevHour = currentHour === 0 ? 23 : currentHour - 1
  if (qrDate !== today) return false
  const h = parseInt(qrHour)
  return h === currentHour || h === prevHour  // 10-min grace if hour just flipped
}

const CHECKIN_KEY = (uid, date) => `staff_checkin_${uid}_${date}`

export default function StaffScanIn() {
  const { user, demoMode } = useApp()
  const today = new Date().toISOString().slice(0, 10)

  // Check if already clocked in today
  const alreadyToday = () => {
    try { return !!localStorage.getItem(CHECKIN_KEY(user?.id, today)) } catch { return false }
  }

  const [phase, setPhase]   = useState(alreadyToday() ? 'already' : 'ready')
  const [errMsg, setErrMsg] = useState('')
  const [checkinTime, setCheckinTime] = useState(
    localStorage.getItem(CHECKIN_KEY(user?.id, today)) || ''
  )

  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const doneRef   = useRef(false)

  useEffect(() => () => stopCamera(), [])

  const stopCamera = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  const startCamera = async () => {
    doneRef.current = false
    setPhase('scanning')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      await new Promise(r => setTimeout(r, 80))
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      tickScan()
    } catch (err) {
      const msg = err?.message || ''
      const isDenied = msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('notallowed')
      setErrMsg(isDenied ? '__permission__' : 'Camera error: ' + (msg || 'Please allow camera access and try again.'))
      setPhase('error')
    }
  }

  const tickScan = async () => {
    if (doneRef.current) return
    const video = videoRef.current; const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(tickScan); return }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0)
    let qrValue = null
    if ('BarcodeDetector' in window) {
      try { const codes = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas); if (codes.length) qrValue = codes[0].rawValue } catch (_) {}
    }
    if (!qrValue) {
      try { const img = ctx.getImageData(0, 0, canvas.width, canvas.height); const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (code) qrValue = code.data } catch (_) {}
    }
    if (qrValue) { doneRef.current = true; stopCamera(); setPhase('processing'); await processQR(qrValue); return }
    rafRef.current = requestAnimationFrame(tickScan)
  }

  const processQR = async (qrValue) => {
    if (!validateToken(qrValue, user?.academyId)) {
      setErrMsg('Invalid or expired QR code. Ask your manager to refresh the Staff QR.')
      setPhase('error')
      return
    }
    const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    // DB write FIRST — only mark localStorage if persistence succeeded.
    // Previously, a DB failure (offline, RLS, table missing) still set localStorage,
    // which locked the coach out of retrying the next day if the bad write was near midnight.
    if (user?.academyId && user?.id) {
      try {
        await db.clockIn()
      } catch (err) {
        setErrMsg('Clock-in failed — please try again. (' + (err?.message || 'network error') + ')')
        setPhase('error')
        return
      }
    }
    try { localStorage.setItem(CHECKIN_KEY(user?.id, today), timeStr) } catch (_) {}
    setCheckinTime(timeStr)
    setPhase('success')
  }

  const markDirect = () => {
    const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    try { localStorage.setItem(CHECKIN_KEY(user?.id, today), timeStr) } catch (_) {}
    setCheckinTime(timeStr)
    setPhase('success')
  }

  const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <div>
        <h1 className="text-xl font-black text-gray-900">Clock In</h1>
        <p className="text-xs text-gray-500 mt-0.5">{dateLabel}</p>
      </div>

      {/* Ready */}
      {phase === 'ready' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <QrCode size={40} className="text-gray-400" />
            </div>
            <h2 className="text-lg font-black text-gray-900 mb-2">Scan the Staff QR</h2>
            <p className="text-sm text-gray-500 mb-6">Point your camera at the QR code displayed on the entrance monitor.</p>
            <button onClick={startCamera} className="w-full btn-primary justify-center py-3.5 text-base gap-3">
              <Camera size={20} /> Open Camera
            </button>
            {demoMode && (
              <button onClick={markDirect} className="w-full btn-secondary justify-center py-3 text-sm gap-2 mt-2">
                Demo: Clock In Without Scan
              </button>
            )}
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-800 mb-1">How it works</p>
            <ol className="text-xs text-blue-700 space-y-1">
              <li>1. Open the app and tap Clock In each morning</li>
              <li>2. Point camera at the QR on the entrance screen</li>
              <li>3. Done — you're marked present for today</li>
              <li>4. QR refreshes every hour to prevent proxy</li>
            </ol>
          </div>
        </div>
      )}

      {/* Scanning */}
      {phase === 'scanning' && (
        <div className="space-y-4">
          <div className="bg-black rounded-2xl overflow-hidden relative" style={{ minHeight: 320 }}>
            <video ref={videoRef} className="w-full h-full object-cover" style={{ minHeight: 320 }} playsInline muted autoPlay />
            <canvas ref={canvasRef} className="hidden" />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-52 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-brand-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-brand-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-brand-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-brand-400 rounded-br-lg" />
              </div>
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70">Align QR within frame</p>
          </div>
          <button onClick={() => { stopCamera(); setPhase('ready') }} className="w-full btn-secondary justify-center py-3">Cancel</button>
        </div>
      )}

      {/* Processing */}
      {phase === 'processing' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <svg className="animate-spin h-10 w-10 text-brand-600 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="font-bold text-gray-900">Processing…</p>
        </div>
      )}

      {/* Success */}
      {(phase === 'success') && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-2">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 size={44} className="text-emerald-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Clocked In!</h2>
          <p className="text-gray-500 text-sm">You're marked <span className="font-bold text-emerald-600">Present</span> today</p>
          <p className="text-xs text-gray-400">{dateLabel}</p>
          {checkinTime && <p className="text-sm font-bold text-brand-600">{checkinTime}</p>}
        </div>
      )}

      {/* Already */}
      {phase === 'already' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-2">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 size={44} className="text-blue-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900">Already Clocked In</h2>
          <p className="text-gray-500 text-sm">Your attendance is already recorded for today.</p>
          {checkinTime && <p className="text-sm font-bold text-brand-600">Clocked in at {checkinTime}</p>}
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-4">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <XCircle size={44} className="text-red-400" strokeWidth={1.5} />
          </div>
          {errMsg === '__permission__' ? (<>
            <h2 className="text-xl font-black text-gray-900">Camera Blocked</h2>
            <ol className="text-left text-sm text-gray-600 space-y-2 bg-gray-50 rounded-xl p-4">
              <li><span className="font-bold text-gray-800">1.</span> Tap the <span className="font-bold">lock / info icon</span> in your browser address bar</li>
              <li><span className="font-bold text-gray-800">2.</span> Set <span className="font-bold">Camera</span> to <span className="font-bold text-emerald-600">Allow</span></li>
              <li><span className="font-bold text-gray-800">3.</span> Reload and tap Try Again</li>
            </ol>
          </>) : (<>
            <h2 className="text-xl font-black text-gray-900">Scan Failed</h2>
            <p className="text-gray-500 text-sm">{errMsg}</p>
          </>)}
          <button onClick={() => { setPhase('ready'); setErrMsg('') }} className="w-full btn-primary justify-center py-3">Try Again</button>
        </div>
      )}
    </div>
  )
}
