import { useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import * as db from '../lib/db'
import { QrCode, RefreshCw, Download, AlertTriangle, CheckCircle } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

export default function AdminQR() {
  const { user, showToast } = useApp()
  const [gateQR,    setGateQR]    = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [regenConf, setRegenConf] = useState(false)
  const qrRef = useRef(null)

  useEffect(() => {
    loadQR()
  }, [])

  const loadQR = async () => {
    setLoading(true)
    try {
      const qr = await db.getOrCreateGateQR(user?.academy || 'Academy Gate')
      setGateQR(qr)
    } catch (err) {
      showToast('Failed to load Gate QR', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleRegenerate = async () => {
    if (!regenConf) { setRegenConf(true); return }
    setLoading(true)
    setRegenConf(false)
    try {
      const qr = await db.regenerateGateQR(user?.academy || 'Academy Gate')
      setGateQR(qr)
      showToast('Gate QR regenerated successfully')
    } catch (err) {
      showToast('Regeneration failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svg)
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, 512, 512)
      ctx.drawImage(img, 0, 0, 512, 512)
      const link = document.createElement('a')
      link.download = 'gate-qr.png'
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
  }

  return (
    <div className="space-y-5 max-w-[800px]">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black text-gray-900">Gate QR Code</h2>
        <p className="text-sm text-gray-500">Print this QR code and post it at your academy gate. Students scan it to mark attendance.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* QR display */}
        <div className="card p-6 flex flex-col items-center gap-5">
          {loading ? (
            <div className="w-64 h-64 bg-gray-100 rounded-xl animate-pulse flex items-center justify-center">
              <QrCode size={40} className="text-gray-300" />
            </div>
          ) : gateQR ? (
            <div ref={qrRef} className="p-4 bg-white rounded-xl border-2 border-gray-900 shadow-sm">
              <QRCodeSVG
                value={gateQR.token}
                size={220}
                bgColor="#ffffff"
                fgColor="#111827"
                level="H"
                includeMargin={false}
              />
            </div>
          ) : (
            <div className="w-64 h-64 bg-gray-50 rounded-xl flex items-center justify-center">
              <p className="text-gray-400 text-sm">No QR available</p>
            </div>
          )}

          <div className="text-center">
            <p className="text-sm font-bold text-gray-900">{user?.academy || 'Academy Gate'}</p>
            <p className="text-xs text-gray-400 mt-0.5">Scan to mark attendance</p>
            {gateQR && (
              <p className="text-[10px] font-mono text-gray-300 mt-1 break-all max-w-[220px]">
                {gateQR.token.slice(0, 16)}…
              </p>
            )}
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={handleDownload}
              disabled={!gateQR || loading}
              className="flex-1 btn-secondary justify-center py-2.5 text-sm gap-2"
            >
              <Download size={14} /> Download PNG
            </button>
            <button
              onClick={() => window.print()}
              disabled={!gateQR || loading}
              className="flex-1 btn-primary justify-center py-2.5 text-sm gap-2"
            >
              🖨 Print
            </button>
          </div>
        </div>

        {/* Info & controls */}
        <div className="space-y-4">
          {/* Status */}
          <div className="card p-4">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle size={18} className="text-emerald-500" />
              <span className="font-semibold text-gray-900 text-sm">QR Status</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className="font-semibold text-emerald-600">Active</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="font-semibold text-gray-700">
                  {gateQR ? new Date(gateQR.created_at).toLocaleDateString('en-IN') : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Validity</span>
                <span className="font-semibold text-gray-700">Permanent</span>
              </div>
            </div>
          </div>

          {/* How it works */}
          <div className="card p-4">
            <p className="font-semibold text-gray-900 text-sm mb-3">How it works</p>
            <ol className="space-y-2 text-xs text-gray-600">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
                Print or display this QR at your academy gate
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
                Student opens the app and taps "Scan Gate QR"
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
                Student scans the code — attendance is marked instantly
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-brand-100 text-brand-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span>
                Each student can only scan once per day
              </li>
            </ol>
          </div>

          {/* Regenerate */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <span className="font-semibold text-gray-900 text-sm">Regenerate QR</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Generating a new QR invalidates the current one. Students will need to scan the new code. Only do this if the QR is compromised.
            </p>
            {regenConf ? (
              <div className="flex gap-2">
                <button onClick={handleRegenerate} className="flex-1 bg-red-600 text-white text-xs font-semibold py-2 px-3 rounded-lg hover:bg-red-700 transition">
                  Yes, regenerate
                </button>
                <button onClick={() => setRegenConf(false)} className="flex-1 btn-secondary py-2 text-xs justify-center">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleRegenerate}
                disabled={loading}
                className="w-full btn-secondary justify-center py-2.5 text-sm gap-2"
              >
                <RefreshCw size={14} /> Regenerate QR Code
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
