// sessionPDF.js — AFC B License format session plan export
//
// Web: renders HTML, opens in a new window, triggers browser print → the
// user picks "Save as PDF" in the native print dialog. Zero extra deps,
// already produces a real PDF.
//
// Native Android (Capacitor): window.open()+print() doesn't work there — the
// WebView has no print-to-PDF dialog (silent no-op). Previously this branch
// shared the raw HTML file instead, which (a) isn't actually a PDF and
// (b) showed broken diagram images once opened outside the app, since the
// image was a live network URL and whatever app opened the shared file
// often can't/won't fetch it. Fixed by rendering the same HTML off-screen,
// rasterizing it with html2canvas, and paginating it into a real multi-page
// PDF with jsPDF — self-contained, no network access needed to view it.
// Diagram images are embedded as base64 data URIs (both platforms) so they
// never depend on a live fetch at view time, and so html2canvas doesn't
// hit a cross-origin canvas-tainting error.

import { Capacitor } from '@capacitor/core'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { saveOrShareFile } from './nativeSave'

// ── Pitch SVG strings ─────────────────────────────────────────────────────────
const BG = '#2D7A3A'
const PITCH_SVGS = {
  full_pitch: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="3" y="3" width="94" height="59" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="50" y1="3" x2="50" y2="62" stroke="white" stroke-width="1.5"/>
    <circle cx="50" cy="32.5" r="8" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="3" y="17" width="16" height="31" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="81" y="17" width="16" height="31" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="3" y="26" width="4" height="13" fill="white" opacity="0.3"/>
    <rect x="93" y="26" width="4" height="13" fill="white" opacity="0.3"/>
  </svg>`,

  half_pitch: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="3" y="3" width="94" height="59" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="3" y1="3" x2="97" y2="3" stroke="white" stroke-width="2.5"/>
    <rect x="18" y="45" width="64" height="17" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="35" y="57" width="30" height="8" fill="white" opacity="0.3"/>
    <path d="M 35 3 A 15 15 0 0 0 65 3" stroke="white" stroke-width="1.5" fill="none"/>
  </svg>`,

  channel: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="25" y="3" width="50" height="59" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="25" y1="32.5" x2="75" y2="32.5" stroke="white" stroke-width="1" stroke-dasharray="3 2"/>
    <rect x="40" y="3" width="20" height="5" fill="white" opacity="0.4"/>
    <rect x="40" y="57" width="20" height="5" fill="white" opacity="0.4"/>
  </svg>`,

  penalty_box: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="10" y="8" width="80" height="47" stroke="white" stroke-width="1.5" fill="none"/>
    <rect x="30" y="46" width="40" height="9" stroke="white" stroke-width="1.5" fill="none"/>
    <circle cx="50" cy="34" r="2" fill="white"/>
    <rect x="35" y="55" width="30" height="9" fill="white" opacity="0.35" stroke="white" stroke-width="1.5"/>
    <path d="M 30 8 A 20 20 0 0 0 70 8" stroke="white" stroke-width="1.5" fill="none"/>
  </svg>`,

  thirds: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="3" y="3" width="94" height="59" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="3" y1="23" x2="97" y2="23" stroke="white" stroke-width="1" stroke-dasharray="4 2"/>
    <line x1="3" y1="42" x2="97" y2="42" stroke="white" stroke-width="1" stroke-dasharray="4 2"/>
    <text x="50" y="15" text-anchor="middle" fill="white" font-size="5" opacity="0.8">Defensive</text>
    <text x="50" y="34" text-anchor="middle" fill="white" font-size="5" opacity="0.8">Middle</text>
    <text x="50" y="53" text-anchor="middle" fill="white" font-size="5" opacity="0.8">Attacking</text>
  </svg>`,

  small_grid: `<svg viewBox="0 0 100 65" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:auto">
    <rect width="100" height="65" fill="${BG}"/>
    <rect x="10" y="5" width="80" height="55" stroke="white" stroke-width="1.5" fill="none"/>
    <line x1="10" y1="23.3" x2="90" y2="23.3" stroke="white" stroke-width="0.8" opacity="0.6"/>
    <line x1="10" y1="41.7" x2="90" y2="41.7" stroke="white" stroke-width="0.8" opacity="0.6"/>
    <line x1="36.7" y1="5" x2="36.7" y2="60" stroke="white" stroke-width="0.8" opacity="0.6"/>
    <line x1="63.3" y1="5" x2="63.3" y2="60" stroke="white" stroke-width="0.8" opacity="0.6"/>
    <circle cx="10" cy="5" r="2.5" fill="#FFD700"/>
    <circle cx="90" cy="5" r="2.5" fill="#FFD700"/>
    <circle cx="10" cy="60" r="2.5" fill="#FFD700"/>
    <circle cx="90" cy="60" r="2.5" fill="#FFD700"/>
  </svg>`,
}

function esc(s) {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// `categories` is the academy's own per-academy drill_categories list
// (migration 0128) — a custom category's label must win over this fallback
// map, which only covers the fixed set every academy starts with.
function catLabel(key, categories) {
  const custom = (categories || []).find(c => c.key === key)
  if (custom) return custom.label
  return {
    warm_up: 'Warm Up', technical: 'Technical', passing: 'Passing',
    shooting: 'Shooting', defending: 'Defending', ssg: 'Small-Sided Game',
    cool_down: 'Cool Down', match: 'Match',
  }[key] || key
}

// Fetches a (usually remote, public Supabase Storage) image URL and inlines
// it as a base64 data URI, so the exported file never depends on a live
// network fetch to display it, and html2canvas doesn't hit a cross-origin
// canvas-tainting error on the rasterize step. Returns null on any failure
// so the caller can fall back to a placeholder instead of a broken <img>.
async function toDataURL(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function diagBox(phase) {
  const drill = phase.drills
  const preset = phase.diagram_preset || drill?.diagram_preset
  const url    = phase.diagram_url    || drill?.diagram_url
  if (url) {
    const dataUrl = await toDataURL(url)
    if (dataUrl) {
      return `<img src="${dataUrl}" style="max-width:100%;max-height:120px;display:block;margin:auto;border-radius:4px" />`
    }
    return `<div style="border:1px dashed #ccc;border-radius:4px;padding:20px;text-align:center;color:#aaa;font-size:8pt">Image unavailable</div>`
  }
  if (preset && PITCH_SVGS[preset]) {
    return `<div style="max-width:180px;margin:auto">${PITCH_SVGS[preset]}</div>`
  }
  return `<div style="border:1px dashed #ccc;border-radius:4px;padding:20px;text-align:center;color:#aaa;font-size:8pt">No diagram</div>`
}

async function renderPhase(phase, index, categories) {
  const drill = phase.drills
  const area  = phase.area || drill?.area || ''
  const ct    = phase.context_ct || drill?.context_ct || ''
  const mt    = phase.context_mt || drill?.context_mt || ''
  const proc  = (phase.procedure?.length ? phase.procedure : drill?.procedure) || []
  const pts   = (phase.coaching_points?.length ? phase.coaching_points : drill?.coaching_points) || []
  const prog  = drill?.progressions || []
  const regr  = drill?.regressions  || []

  const drillName = drill?.name ? `<div style="font-size:8pt;color:#555;margin-bottom:3px">Drill: <em>${esc(drill.name)}</em></div>` : ''
  const diagramHtml = await diagBox(phase)

  return `
  <div style="margin-bottom:8px;border:1.5px solid #1e3a5f;border-radius:4px;page-break-inside:avoid;break-inside:avoid">
    <!-- Phase header -->
    <div style="background:#1e3a5f;color:white;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;border-radius:2px 2px 0 0">
      <span style="font-weight:bold;font-size:9pt">Phase ${index + 1} — ${catLabel(phase.phase_name, categories)}</span>
      <span style="font-size:8pt;opacity:0.85">${phase.duration || 0} min</span>
    </div>
    <!-- Phase body: text left, diagram right -->
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="width:60%;vertical-align:top;padding:6px 8px;border-right:1px solid #ddd">
          ${drillName}
          ${area ? `<div style="margin-bottom:4px"><span style="font-size:7pt;font-weight:bold;color:#555;text-transform:uppercase">Area</span><br><span style="font-size:8pt">${esc(area)}</span></div>` : ''}
          ${ct ? `<div style="margin-bottom:4px"><span style="font-size:7pt;font-weight:bold;color:#0033cc;text-transform:uppercase">CT —</span> <span style="font-size:8pt;color:#0033cc">${esc(ct)}</span></div>` : ''}
          ${mt ? `<div style="margin-bottom:4px"><span style="font-size:7pt;font-weight:bold;color:#cc0000;text-transform:uppercase">MT —</span> <span style="font-size:8pt;color:#cc0000">${esc(mt)}</span></div>` : ''}
          ${proc.length ? `
            <div style="margin-top:5px;margin-bottom:2px;font-size:7pt;font-weight:bold;color:#555;text-transform:uppercase">Procedure</div>
            <ol style="margin:0;padding-left:14px;font-size:8pt">
              ${proc.map(s => `<li style="margin-bottom:1px">${esc(s)}</li>`).join('')}
            </ol>
          ` : ''}
          ${pts.length ? `
            <div style="margin-top:5px;margin-bottom:2px;font-size:7pt;font-weight:bold;color:#1a6b3a;text-transform:uppercase">Coaching Points</div>
            <ul style="margin:0;padding-left:12px;font-size:8pt">
              ${pts.map(p => `<li style="margin-bottom:1px">${esc(p)}</li>`).join('')}
            </ul>
          ` : ''}
          ${prog.length || regr.length ? `
            <table style="width:100%;margin-top:5px;font-size:7.5pt">
              <tr>
                ${prog.length ? `<td style="vertical-align:top;padding-right:4px">
                  <div style="font-weight:bold;color:#166534;margin-bottom:2px">↑ Progressions</div>
                  <ul style="margin:0;padding-left:12px">${prog.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>
                </td>` : '<td></td>'}
                ${regr.length ? `<td style="vertical-align:top">
                  <div style="font-weight:bold;color:#92400e;margin-bottom:2px">↓ Regressions</div>
                  <ul style="margin:0;padding-left:12px">${regr.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>
                </td>` : '<td></td>'}
              </tr>
            </table>
          ` : ''}
        </td>
        <td style="width:40%;vertical-align:middle;padding:8px;text-align:center">
          ${diagramHtml}
        </td>
      </tr>
    </table>
  </div>`
}

const PAGE_STYLE = `
  @page { size: A4 landscape; margin: 12mm 12mm 10mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; }
  table { border-collapse: collapse; }
`

function buildBodyHTML({ plan, phaseHTML, totalDur, batchName, academyName, coachName }) {
  return `
  <!-- ── HEADER ── -->
  <table style="width:100%;margin-bottom:8px;border:1.5px solid #1e3a5f;border-radius:4px;overflow:hidden">
    <tr>
      <td colspan="4" style="background:#1e3a5f;color:white;text-align:center;padding:5px 8px;font-size:12pt;font-weight:bold;letter-spacing:1px">
        TRAINING SESSION PLAN
      </td>
    </tr>
    <tr style="background:#f0f4ff">
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Academy:</strong> ${esc(academyName || '—')}</td>
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Coach:</strong> ${esc(coachName || '—')}</td>
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Date:</strong> ${fmtDate(plan.date)}</td>
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Batch:</strong> ${esc(batchName || '—')}</td>
    </tr>
    <tr>
      <td colspan="2" style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Topic:</strong> ${esc(plan.topic || '—')}</td>
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Duration:</strong> ${totalDur} min</td>
      <td style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Players:</strong> ${plan.num_players || '—'}</td>
    </tr>
    ${plan.objective ? `<tr><td colspan="4" style="padding:4px 8px;border:1px solid #c8d4e8"><strong>Objective:</strong> ${esc(plan.objective)}</td></tr>` : ''}
  </table>

  <!-- ── PHASES ── -->
  ${phaseHTML}

  <!-- ── FOOTER ── -->
  <div style="margin-top:6px;border-top:1px solid #ddd;padding-top:4px;display:flex;justify-content:space-between;font-size:7pt;color:#999">
    <span>Khelit</span>
    <span>Generated: ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</span>
  </div>`
}

// Rasterizes bodyHTML off-screen and paginates it into a real multi-page A4
// landscape PDF. Doesn't try to avoid slicing a phase card across a page
// boundary — acceptable tradeoff for a from-scratch native PDF exporter.
async function renderToPDF(bodyHTML) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '1600px'
  container.style.background = '#ffffff'
  container.innerHTML = `<style>${PAGE_STYLE}</style><div style="padding:24px">${bodyHTML}</div>`
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })

    const pageWidthMm  = 297
    const pageHeightMm = 210
    const pxPerMm = canvas.width / pageWidthMm
    const pageHeightPx = pageHeightMm * pxPerMm

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    let renderedPx = 0
    let firstPage = true
    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx)
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width  = canvas.width
      pageCanvas.height = sliceHeightPx
      pageCanvas.getContext('2d').drawImage(
        canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
      )
      const sliceData = pageCanvas.toDataURL('image/jpeg', 0.95)
      if (!firstPage) pdf.addPage()
      pdf.addImage(sliceData, 'JPEG', 0, 0, pageWidthMm, sliceHeightPx / pxPerMm)
      renderedPx += sliceHeightPx
      firstPage = false
    }

    return pdf.output('blob')
  } finally {
    document.body.removeChild(container)
  }
}

export async function exportSessionPDF({ plan, phases, batchName, academyName, coachName, drillCategories }) {
  const totalDur = phases.reduce((s, p) => s + (p.duration || 0), 0)

  const sortedPhases = phases.slice().sort((a, b) => a.position - b.position)
  const phaseHTML = (await Promise.all(sortedPhases.map((p, i) => renderPhase(p, i, drillCategories)))).join('')
  const bodyHTML = buildBodyHTML({ plan, phaseHTML, totalDur, batchName, academyName, coachName })

  const safeDate  = (plan.date || 'export').replace(/[^\w-]/g, '_')
  const safeBatch = (batchName || 'session').replace(/[^\w-]/g, '_')

  if (Capacitor.isNativePlatform()) {
    try {
      const pdfBlob = await renderToPDF(bodyHTML)
      await saveOrShareFile(pdfBlob, `session-plan-${safeBatch}-${safeDate}.pdf`)
    } catch (err) {
      // If canvas rendering fails for any reason, fall back to sharing the
      // HTML directly rather than leaving the user with no export at all.
      console.error('PDF render failed, falling back to HTML share', err)
      const blob = new Blob([`<!DOCTYPE html><html><head><style>${PAGE_STYLE}</style></head><body>${bodyHTML}</body></html>`], { type: 'text/html' })
      await saveOrShareFile(blob, `session-plan-${safeBatch}-${safeDate}.html`)
    }
    return
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Session Plan — ${esc(batchName)} — ${esc(plan.date)}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  ${bodyHTML}
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=1000,height=700')
  if (!w) {
    alert('PDF export was blocked by your browser. Please allow popups for this site.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
