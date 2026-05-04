import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import * as db from '../../lib/db'
import { QrCode, CheckCircle2, XCircle, Camera, ArrowLeft } from 'lucide-react'

export default function StudentScan() {
  const { studentUser } = useApp()
  const navigate = useNavigate()

  const [phase, setPhase] = useState('ready')   // ready | scanning | success | error | already
  const [errMsg, setErrMsg] = useState('')
  const scannerRef = useRef(null)
  const scannerInstanceRef = useRef(null)

  useEffect(() => {
    return () => stopScanner()
  }, [])

  const stopScanner = () => {
    if (scannerInstanceRef.current) {
      scannerInstanceRef.current.stop().catch(() => {})
      scannerInstanceRef.current.clear()
      scannerInstanceRef.current = null
    }
  }

  const startScanner = async () => {
    setPhase('scanning')
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const scanner = new Html5Qrcode('qr-reader-div')
      scannerInstanceRef.current = scanner
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodedText) => {
          stopScanner()
          await handleScanResult(decodedText)
        },
        () => {}   // suppress per-frame errors
      )
    } catch (err) {
      console.error(err)
      setErrMsg('Camera access denied. Please allow camera permissions and try again.')
      setPhase('error')
    }
  }

  const handleScanResult = async (qrValue) => {
    try {
      // QR value is the gate token
      const token = qrValue.trim()
      await db.markAttendanceViaQR(studentUser.id, token)
      setPhase('success')
    } catch (err) {
      if (err.message?.includes('already marked')) {
        setPhase('already')
      } else if (err.message?.includes('Invalid gate')) {
        setErrMsg('This QR code is not a valid academy gate QR.')
        setPhase('error')
      } else {
        setErrMsg(err.message || 'Could not mark attendance.')
        setPhase('error')
      }
    }
  }

  const reset = () => {
    stopScanner()
    setPhase('ready')
    setErrMsg('')
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/student/dashboard')}
          className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-black text-gray-900">Scan Gate QR</h1>
          <p className="text-xs text-gray-500">Scan the QR code at the academy gate</p>
        </div>
      </div>

      {/* Ready state */}
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
              <Camera size={20} /> Open Camera
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

      {/* Scanning state */}
      {phase === 'scanning' && (
        <div className="space-y-4">
          <div className="bg-black rounded-2xl overflow-hidden relative">
            <div id="qr-reader-div" className="w-full" style={{ minHeight: 320 }} />
            {/* Corner decorations */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-48 h-48 relative">
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

      {/* Success state */}
      {phase === 'success' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 size={44} className="text-emerald-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Attendance Marked!</h2>
          <p className="text-gray-500 text-sm mb-1">You're marked <span className="font-bold text-emerald-600">Present</span> today</p>
          <p className="text-xs text-gray-400 mb-8">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <button onClick={() => navigate('/student/dashboard')} className="w-full btn-primary justify-center py-3">
            Back to Home
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
          <p className="text-gray-500 text-sm mb-8">
            Your attendance is already recorded for today.
          </p>
          <button onClick={() => navigate('/student/dashboard')} className="w-full btn-primary justify-center py-3">
            Back to Home
          </button>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <XCircle size={44} className="text-red-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 mb-2">Scan Failed</h2>
          <p className="text-gray-500 text-sm mb-8">{errMsg || 'Something went wrong. Please try again.'}</p>
          <div className="flex gap-3">
            <button onClick={reset} className="flex-1 btn-primary justify-center py-3">Try Again</button>
            <button onClick={() => navigate('/student/dashboard')} className="flex-1 btn-secondary justify-center py-3">Home</button>
          </div>
        </div>
      )}
    </div>
  )
}
