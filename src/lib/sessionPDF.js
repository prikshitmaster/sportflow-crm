// sessionPDF.js — AFC B License format session plan export
// Generates an HTML string, opens in a new window, triggers browser print → Save as PDF
// Zero external dependencies.
//
// Native Android (Capacitor): window.open()+print() doesn't work there — the
// WebView has no print-to-PDF dialog (silent no-op), and the popup is a bare
// document outside the SPA's router, so it has no back button either. Instead
// we hand the rendered HTML to the native Share sheet (same nativeSave.js
// pattern already used for Excel/CSV/QR exports) — the user can open it in
// Chrome to view/print/save as PDF, or forward it directly via WhatsApp/Drive.

import { Capacitor } from '@capacitor/core'
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

function catLabel(key) {
  return {
    warm_up: 'Warm Up', technical: 'Technical', passing: 'Passing',
    shooting: 'Shooting', defending: 'Defending', ssg: 'Small-Sided Game',
    cool_down: 'Cool Down', match: 'Match',
  }[key] || key
}

function diagBox(phase) {
  const drill = phase.drills
  const preset = phase.diagram_preset || drill?.diagram_preset
  const url    = phase.diagram_url    || drill?.diagram_url
  if (url) {
    return `<img src="${esc(url)}" style="max-width:100%;max-height:120px;display:block;margin:auto;border-radius:4px" />`
  }
  if (preset && PITCH_SVGS[preset]) {
    return `<div style="max-width:180px;margin:auto">${PITCH_SVGS[preset]}</div>`
  }
  return `<div style="border:1px dashed #ccc;border-radius:4px;padding:20px;text-align:center;color:#aaa;font-size:8pt">No diagram</div>`
}

function renderPhase(phase, index) {
  const drill = phase.drills
  const area  = phase.area || drill?.area || ''
  const ct    = phase.context_ct || drill?.context_ct || ''
  const mt    = phase.context_mt || drill?.context_mt || ''
  const proc  = (phase.procedure?.length ? phase.procedure : drill?.procedure) || []
  const pts   = (phase.coaching_points?.length ? phase.coaching_points : drill?.coaching_points) || []
  const prog  = drill?.progressions || []
  const regr  = drill?.regressions  || []

  const drillName = drill?.name ? `<div style="font-size:8pt;color:#555;margin-bottom:3px">Drill: <em>${esc(drill.name)}</em></div>` : ''

  return `
  <div style="margin-bottom:8px;border:1.5px solid #1e3a5f;border-radius:4px;page-break-inside:avoid;break-inside:avoid">
    <!-- Phase header -->
    <div style="background:#1e3a5f;color:white;padding:4px 8px;display:flex;justify-content:space-between;align-items:center;border-radius:2px 2px 0 0">
      <span style="font-weight:bold;font-size:9pt">Phase ${index + 1} — ${catLabel(phase.phase_name)}</span>
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
          ${diagBox(phase)}
        </td>
      </tr>
    </table>
  </div>`
}

export async function exportSessionPDF({ plan, phases, batchName, academyName, coachName }) {
  const totalDur = phases.reduce((s, p) => s + (p.duration || 0), 0)

  const phaseHTML = phases
    .sort((a, b) => a.position - b.position)
    .map((p, i) => renderPhase(p, i))
    .join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Session Plan — ${esc(batchName)} — ${esc(plan.date)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm 12mm 10mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; margin: 0; }
    table { border-collapse: collapse; }
  </style>
</head>
<body>

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
    <span>SportFlow CRM</span>
    <span>Generated: ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  if (Capacitor.isNativePlatform()) {
    const safeDate  = (plan.date || 'export').replace(/[^\w-]/g, '_')
    const safeBatch = (batchName || 'session').replace(/[^\w-]/g, '_')
    const blob = new Blob([html], { type: 'text/html' })
    await saveOrShareFile(blob, `session-plan-${safeBatch}-${safeDate}.html`)
    return
  }

  const w = window.open('', '_blank', 'width=1000,height=700')
  if (!w) {
    alert('PDF export was blocked by your browser. Please allow popups for this site.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
