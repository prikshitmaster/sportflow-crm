import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { QrCode, CheckCircle2, XCircle, Camera, ArrowLeft } from 'lucide-react'

export default function StudentScan() {
  const { studentUser } = useApp()
  const navigate = useNavigate()

  const [phase, setPhase] = useState('ready')  // ready | scanning | processing | success | error
  const [errMsg, setErrMsg] = useState('')
  const scannerInstanceRef = useRef(null)
  const handledRef = useRef(false)  // prevent double-fire from scanner

  // Auto-navigate to attendance page 2s after success
  useEffect(() => {
    if (phase !== 'success') return
    const t = setTimeout(() => navigate('/student/attendance'), 2000)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    return () => { stopScanner() }
  }, [])

  const stopScanner = async () => {
    if (scannerInstanceRef.current) {
      try {
        await scannerInstanceRef.current.stop()
        scannerInstanceRef.current.clear()
      } catch (_) {}
      scannerInstanceRef.current = null
    }
  }

  const startScanner = async () => {
    handledRef.current = false
    setPhase('scanning')
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('qr-reader-div', { verbose: false })
      scannerInstanceRef.current = scanner

      await scanner.start(
        { facingMode: { ideal: 'environment' } },
        { fps: 15, qrbox: { width: 260, height: 260 }, aspectRatio: 1.0 },
        async (decodedText) => {
          if (handledRef.current) return
          handledRef.current = true
          await stopScanner()
          setPhase('processing')
          await handleScanResult(decodedText)
        },
        () => {}
      )
    } catch (err) {
      setErrMsg('Camera access denied. Please allow camera permissions and try again.')
      setPhase('error')
    }
  }

  const handleScanResult = async (qrValue) => {
    try {
      await db.markAttendanceViaQR(studentUser.id, qrValue.trim())
      setPhase('success')
    } catch (err) {
      setErrMsg(err.message || 'Could not mark attendance.')
      setPhase('error')
    }
  }

  const reset = async () => {
    await stopScanner()
    handledRef.current = false
    setPhase('ready')
    setErrMsg('')
  }

  const markDirect = async () => {
    setPhase('processing')
    try {
      await db.markAttendanceDirect(studentUser.id)
      setPhase('success')
    } catch (err) {
      setErrMsg(err.message || 'Could not mark attendance.')
      setPhase('error')
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

      {/* Ready */}
      {phase === 'ready' && (
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <QrCode size={40} className="text-gray-400" />
            </div>
            <h2 className="text-lg font-black text-gray-900 mb-2">Ready to scan</h2>
            <p className="text-sm text-gray-500 mb-6">
              Point your camera at the QR code posted at the academy entrance gate.
            </p>
            <button onClick={startScanner} className="w-full btn-primary justify-center py-3.5 text-base gap-3">
              <Camera size={20} /> Open Camera &amp; Scan QR
            </button>
            <button onClick={markDirect} className="w-full btn-secondary justify-center py-3 text-sm gap-2 mt-2">
              ✓ Mark Attendance Without Scan (Test)
            </button>
          </div>

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

      {/* Scanning */}
      {phase === 'scanning' && (
        <div className="space-y-4">
          <div className="bg-black rounded-2xl overflow-hidden relative">
            <div id="qr-reader-div" className="w-full" style={{ minHeight: 320 }} />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-52 h-52 relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-brand-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-brand-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-brand-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-brand-400 rounded-br-lg" />
              </div>
            </div>
          </div>
          <p className="text-center text-sm text-gray-500">Align the gate QR code within the frame</p>
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
          <p className="text-gray-400 text-sm">Please wait a moment</p>
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
          <p className="text-xs text-brand-500 mb-8 animate-pulse">Redirecting to attendance…</p>
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
          <h2 className="text-2xl font-black text-gray-900 mb-2">Scan Failed</h2>
          <p className="text-gray-500 text-sm mb-8">{errMsg || 'Something went wrong. Please try again.'}</p>
          <div className="flex gap-3">
            <button onClick={reset} className="flex-1 btn-primary justify-center py-3">Try Again</button>
            <button onClick={() => navigate('/student/attendance')} className="flex-1 btn-secondary justify-center py-3">Attendance</button>
          </div>
        </div>
      )}
    </div>
  )
}
