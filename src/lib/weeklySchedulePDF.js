// weeklySchedulePDF.js — Weekly Training Schedule export
// Generates an HTML string, opens in a new window, triggers browser print → Save as PDF
// Zero external dependencies.
//
// Native Android (Capacitor): window.open()+print() doesn't work there — the
// WebView has no print-to-PDF dialog (silent no-op), and the popup is a bare
// document outside the SPA's router, so it has no back button either. Same
// fix as sessionPDF.js: hand the rendered HTML to the native Share sheet
// (nativeSave.js) — the user can open it in Chrome to view/print/save as
// PDF, or forward it directly via WhatsApp/Drive.

import { Capacitor } from '@capacitor/core'
import { saveOrShareFile } from './nativeSave'

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ROWS = [
  { key: 'objective', label: 'Session Objective' },
  { key: 'technical', label: 'Technical' },
  { key: 'tactical',  label: 'Tactical' },
  { key: 'match',     label: 'Match' },
]

function esc(s) {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function weekRangeLabel(weekStart) {
  if (!weekStart) return ''
  const start = new Date(weekStart + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 5)
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${fmt(start)} to ${fmt(end)}`
}

export async function exportWeeklySchedulePDF({ schedule, academyName }) {
  const grid = schedule.grid || {}

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Weekly Schedule — ${esc(schedule.team_name)} — ${esc(schedule.week_start)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; }
    table { border-collapse: collapse; width: 100%; }
  </style>
</head>
<body>

  <table style="margin-bottom:10px;border:1.5px solid #1e3a5f;border-radius:4px;overflow:hidden">
    <tr>
      <td colspan="3" style="background:#1e3a5f;color:white;text-align:center;padding:8px;font-size:15pt;font-weight:bold;letter-spacing:1px">
        ${esc(schedule.team_name).toUpperCase()} WEEKLY TRAINING SCHEDULE
      </td>
    </tr>
    <tr style="background:#f0f4ff">
      <td style="padding:6px 10px;border:1px solid #c8d4e8"><strong>Team Name:</strong> ${esc(schedule.team_name) || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #c8d4e8"><strong>Date:</strong> ${weekRangeLabel(schedule.week_start)}</td>
      <td style="padding:6px 10px;border:1px solid #c8d4e8"><strong>Coach Name:</strong> ${esc(schedule.coach_name) || '—'}</td>
    </tr>
  </table>

  <table style="border:1.5px solid #1e3a5f">
    <tr>
      <td style="background:#1e3a5f;color:white;font-weight:bold;padding:8px;width:14%">Day</td>
      ${WEEK_DAYS.map(day => `<td style="background:#1e3a5f;color:white;font-weight:bold;padding:8px;text-align:center">${day}</td>`).join('')}
    </tr>
    ${ROWS.map((row, i) => `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f7f8fa'}">
        <td style="background:#1e3a5f;color:white;font-weight:bold;padding:8px">${row.label}</td>
        ${WEEK_DAYS.map(day => `<td style="padding:8px;text-align:center;border:1px solid #ddd">${esc(grid[day]?.[row.key]) || '-'}</td>`).join('')}
      </tr>
    `).join('')}
  </table>

  <div style="margin-top:8px;border-top:1px solid #ddd;padding-top:4px;display:flex;justify-content:space-between;font-size:8pt;color:#999">
    <span>${esc(academyName) || 'SportFlow CRM'}</span>
    <span>Generated: ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</span>
  </div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  if (Capacitor.isNativePlatform()) {
    const safeTeam = (schedule.team_name || 'schedule').replace(/[^\w-]/g, '_')
    const safeDate = (schedule.week_start || 'export').replace(/[^\w-]/g, '_')
    const blob = new Blob([html], { type: 'text/html' })
    await saveOrShareFile(blob, `weekly-schedule-${safeTeam}-${safeDate}.html`)
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
