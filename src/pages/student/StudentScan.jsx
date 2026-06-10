import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { QrCode, CheckCircle2, XCircle, Camera, ArrowLeft, Lock, CreditCard, Clock } from 'lucide-react'
import jsQR from 'jsqr'
import { logAudit, ACTIONS } from '../../lib/audit'
import { todayStr } from '../../lib/dates'

const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAYS_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const WINDOW_MINS = 30  // minutes before/after batch start that scanning is allowed

// Parse "HH:MM" (24h) or "H:MM AM/PM" (12h) into today's Date object
function parseBatchTime(timeStr) {
  if (!timeStr) return null
  const ampm = /([ap]m)/i.exec(timeStr)
  if (ampm) {
    const clean = timeStr.replace(/\s*(am|pm)/i, '').trim()
    let [h, m] = clean.split(':').map(Number)
    if (isNaN(h) || isNaN(m)) return null
    if (/pm/i.test(ampm[1]) && h !== 12) h += 12
    if (/am/i.test(ampm[1]) && h === 12) h = 0
    const d = new Date(); d.setHours(h, m, 0, 0); return d
  }
  const [h, m] = timeStr.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return null
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}

// Returns { allowed: bool, reason: string|null, opensAt: string|null }
function checkScanWindow(batchDays, startTime, endTime) {
  const now = new Date()
  const todayShort = DAYS_SHORT[now.getDay()]
  const todayFull  = DAYS_FULL[now.getDay()]

  // No batch config — always open
  if (!batchDays?.length && !startTime) return { allowed: true }

  // Off day — accept both 'Mon' and 'Monday' formats
  if (batchDays?.length > 0 && !batchDays.includes(todayShort) && !batchDays.includes(todayFull)) {
    return { allowed: false, reason: 'No training today', opensAt: null }
  }

  // No start time configured — allow all day on training days
  const batchStart = parseBatchTime(startTime)
  if (!batchStart) return { allowed: true }

  // Window opens 30 min before batch start
  const windowOpen = new Date(batchStart.getTime() - WINDOW_MINS * 60 * 1000)

  // Window closes 30 min after batch END (or 30 min after start if no end time)
  const batchEnd   = parseBatchTime(endTime)
  const windowClose = batchEnd
    ? new Date(batchEnd.getTime()  + WINDOW_MINS * 60 * 1000)
    : new Date(batchStart.getTime() + WINDOW_MINS * 60 * 1000)

  if (now < windowOpen) {
    const h = String(windowOpen.getHours()).padStart(2, '0')
    const m = String(windowOpen.getMinutes()).padStart(2, '0')
    return { allowed: false, reason: 'Too early', opensAt: `${h}:${m}` }
  }
  if (now > windowClose) {
    return { allowed: false, reason: 'Attendance window closed', opensAt: null }
  }
  return { allowed: true }
}

export default function StudentScan() {
  const { studentUser } = useApp()
  const navigate = useNavigate()
  const [scanWindow, setScanWindow] = useState(null) // null while loading
  const [alreadyMarked, setAlreadyMarked] = useState(null) // null=checking, true=marked today, false=not yet
  const activeBatchIdRef  = useRef(null) // batch that is open for scanning today
  const activeBranchIdRef = useRef(null) // branch_id of that batch (for audit log tagging)

  useEffect(() => {
    if (!studentUser?.id) { setScanWindow({ allowed: true }); return }
    const primaryId = studentUser?.batch_id || studentUser?.batchId

    Promise.all([
      primaryId
        ? supabase.from('batches').select('id, days, start_time, end_time, branch_id').eq('id', primaryId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('student_batches')
        .select('batch_id, batches(id, days, start_time, end_time, branch_id)')
        .eq('student_id', studentUser.id),
    ]).then(([primary, multi]) => {
      const seen = new Set()
      const all = []
      if (primary.data) { all.push(primary.data); seen.add(primary.data.id) }
      for (const row of (multi.data || [])) {
        const b = row.batches
        if (b && !seen.has(b.id)) { all.push(b); seen.add(b.id) }
      }

      if (all.length === 0) { setScanWindow({ allowed: true }); return }

      // Find first batch whose scan window is open right now
      const openBatch = all.find(b => checkScanWindow(b.days, b.start_time, b.end_time).allowed)
      if (openBatch) {
        activeBatchIdRef.current  = openBatch.id
        activeBranchIdRef.current = openBatch.branch_id || null
        setScanWindow({ allowed: true })
        return
      }

      // No batch open — pick best reason from the primary batch (or first batch)
      const best = checkScanWindow(all[0].days, all[0].start_time, all[0].end_time)
      // If at least one batch trains today (not "No training today"), show that reason
      const trainsToday = all.find(b => {
        const w = checkScanWindow(b.days, b.start_time, b.end_time)
        return w.reason !== 'No training today'
      })
      setScanWindow(trainsToday ? checkScanWindow(trainsToday.days, trainsToday.start_time, trainsToday.end_time) : best)
    }).catch(() => setScanWindow({ allowed: true }))
  }, [studentUser])

  // Check if student already has attendance for today
  useEffect(() => {
    if (!studentUser?.id) { setAlreadyMarked(false); return }
    const today = todayStr()
    supabase.from('attendance')
      .select('id')
      .eq('student_id', studentUser.id)
      .eq('date', today)
      .maybeSingle()
      .then(({ data }) => setAlreadyMarked(!!data))
      .catch(() => setAlreadyMarked(false))
  }, [studentUser])

  // Suspended students cannot mark attendance — must clear dues first
  if (studentUser?.status === 'Suspended') {
    return (
      <div className="max-w-lg mx-auto px-4 py-5">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/student/dashboard')}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-black text-gray-900">Attendance Locked</h1>
            <p className="text-xs text-gray-500">Account suspended</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-red-100 p-8 text-center">
          <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Lock size={36} className="text-red-500" />
          </div>
          <h2 className="text-lg font-black text-gray-900 mb-2">Cannot mark attendance</h2>
          <p className="text-sm text-gray-500 mb-6 leading-relaxed">
            Your account is suspended due to overdue fees. Please clear your dues to resume attendance.
          </p>
          <Link to="/student/payments"
            className="inline-flex items-center justify-center gap-2 w-full bg-red-600 text-white font-bold rounded-xl py-3 active:scale-95 transition">
            <CreditCard size={18} /> View &amp; Pay Dues
          </Link>
        </div>
      </div>
    )
  }

  // ready | scanning | processing | success | already | error
  const [phase, setPhase] = useState('ready')
  const [errMsg, setErrMsg] = useState('')

  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const streamRef   = useRef(null)
  const rafRef      = useRef(null)
  const doneRef     = useRef(false)
  const detectorRef = useRef(null)

  // Auto-navigate to attendance 2s after success or already
  useEffect(() => {
    if (phase !== 'success' && phase !== 'already') return
    const t = setTimeout(() => navigate('/student/attendance'), 2500)
    return () => clearTimeout(t)
  }, [phase])

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [])

  const stopCamera = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
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
      if ('BarcodeDetector' in window) {
        try { detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch {}
      }
      // wait one tick for React to paint the <video> element
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
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(tickScan)
      return
    }

    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0)

    let qrValue = null

    // Try native BarcodeDetector first (Chrome Android, Edge) — use video directly, faster
    if (detectorRef.current) {
      try {
        const codes = await detectorRef.current.detect(video)
        if (codes.length > 0) qrValue = codes[0].rawValue
      } catch (_) {}
    }

    // Fallback: jsQR — attemptBoth tries normal + inverted orientations
    if (!qrValue) {
      try {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
        if (code) qrValue = code.data
      } catch (_) {}
    }

    if (qrValue) {
      doneRef.current = true
      stopCamera()
      setPhase('processing')
      await processQR(qrValue)
      return
    }

    rafRef.current = requestAnimationFrame(tickScan)
  }

  const processQR = async (token) => {
    try {
      await db.markAttendanceViaQR(studentUser.id, token.trim(), activeBatchIdRef.current, studentUser.academy_id)
      logAudit({
        actor: { id: studentUser.id, name: studentUser.name, role: 'Student' },
        action: ACTIONS.ATTENDANCE_QR_SCAN, entityType: 'attendance',
        entityId: studentUser.id, entityName: studentUser.name,
        academyId: studentUser.academy_id,
        sport: studentUser.sport || null,
        branchId: activeBranchIdRef.current,
        note: 'gate QR',
      })
      setPhase('success')
    } catch (err) {
      if (err.message?.includes('already marked')) {
        setPhase('already')
      } else {
        setErrMsg(err.message || 'Could not mark attendance.')
        setPhase('error')
      }
    }
  }

  const reset = () => {
    stopCamera()
    doneRef.current = false
    setPhase('ready')
    setErrMsg('')
  }

  const markDirect = async () => {
    setPhase('processing')
    try {
      await db.markAttendanceDirect(studentUser.id, activeBatchIdRef.current)
      logAudit({
        actor: { id: studentUser.id, name: studentUser.name, role: 'Student' },
        action: ACTIONS.ATTENDANCE_MANUAL, entityType: 'attendance',
        entityId: studentUser.id, entityName: studentUser.name,
        academyId: studentUser.academy_id,
        sport: studentUser.sport || null,
        branchId: activeBranchIdRef.current,
        note: 'manual (phone)',
      })
      setPhase('success')
    } catch (err) {
      if (err.message?.includes('already marked')) {
        setPhase('already')
      } else {
        setErrMsg(err.message || 'Could not mark attendance.')
        setPhase('error')
      }
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => { reset(); navigate('/student/attendance') }}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-black text-gray-900">Scan Gate QR</h1>
          <p className="text-xs text-gray-500">Scan the QR code at the academy gate</p>
        </div>
      </div>

      {/* Ready — locked if outside scan window */}
      {phase === 'ready' && (
        <div className="space-y-5">
          {scanWindow && !scanWindow.allowed ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
              <div className="w-20 h-20 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Clock size={40} className="text-amber-400" />
              </div>
              <h2 className="text-lg font-black text-gray-900 mb-2">
                {scanWindow.reason || 'Attendance Closed'}
              </h2>
              {scanWindow.opensAt ? (
                <p className="text-sm text-gray-500 mb-2">
                  Attendance opens at <strong>{scanWindow.opensAt}</strong><br/>
                  <span className="text-xs text-gray-400">{WINDOW_MINS} min before batch starts</span>
                </p>
              ) : (
                <p className="text-sm text-gray-500 mb-2">
                  Attendance window is <strong>{WINDOW_MINS} min</strong> before and after batch start time.
                </p>
              )}
              <button
                onClick={() => navigate('/student/dashboard')}
                className="w-full btn-secondary justify-center py-3 mt-4"
              >
                Back to Dashboard
              </button>
            </div>
          ) : alreadyMarked ? (
            <div className="bg-white rounded-2xl border border-blue-100 p-8 text-center">
              <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-5">
                <CheckCircle2 size={44} className="text-blue-400" strokeWidth={1.5} />
              </div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">Already Marked</h2>
              <p className="text-gray-500 text-sm mb-6">
                Your attendance is already recorded for today.
              </p>
              <button onClick={() => navigate('/student/attendance')} className="w-full btn-primary justify-center py-3">
                View Attendance
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <QrCode size={40} className="text-gray-400" />
              </div>
              <h2 className="text-lg font-black text-gray-900 mb-2">Ready to scan</h2>
              <p className="text-sm text-gray-500 mb-6">
                Point your camera at the QR code posted at the academy entrance gate.
              </p>
              <button onClick={startCamera} className="w-full btn-primary justify-center py-3.5 text-base gap-3">
                <Camera size={20} /> Open Camera &amp; Scan QR
              </button>
              <button onClick={markDirect} className="w-full btn-secondary justify-center py-3 text-sm gap-2 mt-2">
                ✓ Mark Attendance Manually
              </button>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-800 mb-1">How it works</p>
            <ol className="text-xs text-blue-700 space-y-1">
              <li>1. Tap "Open Camera" above</li>
              <li>2. Point at the QR code at the gate</li>
              <li>3. Attendance is marked automatically</li>
            </ol>
          </div>
        </div>
      )}

      {/* Scanning — video + hidden canvas for decoding */}
      {phase === 'scanning' && (
        <div className="space-y-4">
          <div className="bg-black rounded-2xl overflow-hidden relative" style={{ minHeight: 320 }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{ minHeight: 320 }}
              playsInline
              muted
              autoPlay
            />
            <canvas ref={canvasRef} className="hidden" />
            {/* Viewfinder corners */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-52 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-brand-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-brand-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-brand-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-brand-400 rounded-br-lg" />
              </div>
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70">
              Align QR code within the frame
            </p>
          </div>
          <button onClick={reset} className="w-full btn-secondary justify-center py-3">Cancel</button>
        </div>
      )}

      {/* Processing */}
      {phase === 'processing' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <svg className="animate-spin h-10 w-10 text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
          </div>
          <h2 className="text-xl font-black text-gray-900 mb-2">Marking Attendance…</h2>
          <p className="text-gray-400 text-sm">Please wait</p>
        </div>
      )}

      {/* Success */}
      {phase === 'success' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={44} className="text-emerald-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Attendance Marked!</h2>
          <p className="text-gray-500 text-sm mb-1">
            You're marked <span className="font-bold text-emerald-600">Present</span> today
          </p>
          <p className="text-xs text-gray-400 mb-2">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="text-xs text-brand-500 mb-8 animate-pulse">Going to attendance…</p>
          <button onClick={() => navigate('/student/attendance')} className="w-full btn-primary justify-center py-3">
            View Attendance
          </button>
        </div>
      )}

      {/* Already marked */}
      {phase === 'already' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={44} className="text-blue-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Already Marked</h2>
          <p className="text-gray-500 text-sm mb-2">
            Your attendance is already recorded for today.
          </p>
          <p className="text-xs text-brand-500 mb-8 animate-pulse">Going to attendance…</p>
          <button onClick={() => navigate('/student/attendance')} className="w-full btn-primary justify-center py-3">
            View Attendance
          </button>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <XCircle size={44} className="text-red-400" strokeWidth={1.5} />
          </div>
          {errMsg === '__permission__' ? (<>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Camera Blocked</h2>
            <p className="text-gray-600 text-sm mb-4">Camera permission was denied. To fix this:</p>
            <ol className="text-left text-sm text-gray-600 space-y-2 mb-6 bg-gray-50 rounded-xl p-4">
              <li><span className="font-bold text-gray-800">1.</span> Tap the <span className="font-bold">lock / info icon</span> in your browser address bar</li>
              <li><span className="font-bold text-gray-800">2.</span> Find <span className="font-bold">Camera</span> and set it to <span className="font-bold text-emerald-600">Allow</span></li>
              <li><span className="font-bold text-gray-800">3.</span> Reload this page and tap <span className="font-bold">Try Again</span></li>
            </ol>
            <div className="flex gap-3 w-full">
              <button onClick={reset} className="flex-1 btn-primary justify-center py-3">Try Again</button>
              <button onClick={() => navigate('/student/attendance')} className="flex-1 btn-secondary justify-center py-3">Attendance</button>
            </div>
          </>) : (<>
            <h2 className="text-2xl font-black text-gray-900 mb-2">Error</h2>
            <p className="text-gray-500 text-sm mb-8">{errMsg || 'Something went wrong. Please try again.'}</p>
            <div className="flex gap-3 w-full">
              <button onClick={reset} className="flex-1 btn-primary justify-center py-3">Try Again</button>
              <button onClick={() => navigate('/student/attendance')} className="flex-1 btn-secondary justify-center py-3">Attendance</button>
            </div>
          </>)}
        </div>
      )}
    </div>
  )
}
