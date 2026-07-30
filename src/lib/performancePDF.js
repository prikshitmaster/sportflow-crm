// performancePDF.js — printable/shareable performance report for one student.
// Generates an HTML string, opens it in a new window and triggers print → Save as PDF.
// Zero external dependencies.
//
// Native Android (Capacitor): window.open()+print() is a silent no-op there —
// the WebView has no print-to-PDF dialog — so we hand the rendered HTML to the
// native Share sheet instead, same as sessionPDF.js / weeklySchedulePDF.js.
// (src/pages/AssessmentReport.jsx uses a bare window.print() and is broken in
// the app for exactly this reason — do not copy that pattern.)

import { Capacitor } from '@capacitor/core'
import { saveOrShareFile } from './nativeSave'
import { getCategoryAvg, getTier, monthLabel } from './performance'

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// CSS-only bar — no chart library in print output.
const bar = (value, color) => `
  <div class="bar"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Number(value) || 0))}%;background:${color}"></div></div>`

function skillRows(cat, scores, prevScores) {
  return cat.skills.map(skill => {
    const v = Number(scores?.[skill] || 0)
    const p = prevScores ? Number(prevScores[skill] || 0) : null
    const d = p ? v - p : null
    if (!v) {
      return `<tr class="muted"><td>${esc(skill)}</td><td colspan="3">not rated</td></tr>`
    }
    return `<tr>
      <td>${esc(skill)}</td>
      <td class="num">${v}</td>
      <td class="barcell">${bar(v, cat.color)}</td>
      <td class="num ${d == null ? 'muted' : d > 0 ? 'up' : d < 0 ? 'down' : 'muted'}">${
        d == null ? '—' : d === 0 ? '0' : d > 0 ? `+${d}` : d
      }</td>
    </tr>`
  }).join('')
}

export async function exportPerformanceReport({
  student, assessment, prev, cats, score, delta,
  pulse, attendance, goal, month, academyName, strengths = [], weakest = [],
}) {
  if (!assessment) throw new Error('No assessment for this month to export')

  const tier = getTier(score)
  const scores = assessment.scores || {}
  const prevScores = prev?.scores || null
  const catNotes = assessment.category_notes || {}

  // Mean of whichever pulse metrics were actually recorded, on its own 1-3 scale.
  const pulseParts = [pulse?.effort, pulse?.execution, pulse?.focus].filter(v => v != null)
  const pulseOverall = pulseParts.length
    ? (pulseParts.reduce((a, b) => a + b, 0) / pulseParts.length).toFixed(1)
    : null

  const catBlocks = cats.map(cat => {
    const avg = getCategoryAvg(scores, cat.skills)
    const note = catNotes[cat.id]
    return `
    <section class="cat">
      <div class="cat-head" style="border-color:${cat.color}">
        <h3 style="color:${cat.color}">${esc(cat.label)}</h3>
        <span class="cat-avg">${avg}<span class="of">/100</span></span>
      </div>
      <table>
        <thead><tr><th>Skill</th><th class="num">Score</th><th></th><th class="num">Change</th></tr></thead>
        <tbody>${skillRows(cat, scores, prevScores)}</tbody>
      </table>
      ${note ? `<p class="note"><strong>Coach:</strong> ${esc(note)}</p>` : ''}
    </section>`
  }).join('')

  const attRows = (attendance || []).map(a => `
    <tr><td>${esc(monthLabel(a.key))}</td>
      <td class="num">${a.pct == null ? '—' : a.pct + '%'}</td>
      <td class="num muted">${a.marked ? `${a.present}/${a.marked}` : 'not marked'}</td></tr>`).join('')

  const listBlock = (title, items) => items.length ? `
    <div class="half">
      <h4>${esc(title)}</h4>
      <ul>${items.map(i => `<li><span>${esc(i.skill)}</span><b>${i.value}</b></li>`).join('')}</ul>
    </div>` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Performance · ${esc(student.name)} · ${esc(monthLabel(month))}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #111827; margin: 0; font-size: 11px; }
  h1, h2, h3, h4 { margin: 0; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #111827; padding-bottom:10px; margin-bottom:14px; }
  .head h1 { font-size:18px; letter-spacing:-.02em; }
  .head .sub { color:#6b7280; font-size:11px; margin-top:3px; }
  .head .right { text-align:right; }
  .tier { display:inline-block; padding:3px 10px; border-radius:4px; font-weight:600; font-size:11px; color:#fff; }
  .score { font-size:30px; font-weight:600; letter-spacing:-.03em; line-height:1; }
  .meta { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .meta div { border:1px solid #e5e7eb; border-radius:6px; padding:7px 9px; }
  .meta .k { color:#9ca3af; font-size:9px; text-transform:uppercase; letter-spacing:.06em; }
  .meta .v { font-weight:600; font-size:12px; margin-top:2px; }
  .row { display:flex; gap:12px; margin-bottom:14px; }
  .half { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:9px 11px; }
  .half h4 { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#6b7280; margin-bottom:6px; }
  .half ul { list-style:none; margin:0; padding:0; }
  .half li { display:flex; justify-content:space-between; padding:2px 0; }
  .cat { margin-bottom:12px; page-break-inside:avoid; }
  .cat-head { display:flex; justify-content:space-between; align-items:baseline; border-left:3px solid; padding-left:8px; margin-bottom:5px; }
  .cat-head h3 { font-size:12px; }
  .cat-avg { font-weight:600; font-size:14px; }
  .cat-avg .of { color:#9ca3af; font-weight:400; font-size:9px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:#9ca3af; font-weight:500; padding:3px 5px; border-bottom:1px solid #e5e7eb; }
  td { padding:3px 5px; border-bottom:1px solid #f3f4f6; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; width:52px; }
  td.barcell { width:110px; }
  .bar { height:5px; background:#f3f4f6; border-radius:3px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:3px; }
  .muted { color:#9ca3af; }
  .up { color:#047857; } .down { color:#dc2626; }
  .note { font-size:10px; color:#374151; margin:5px 0 0; padding:5px 7px; background:#f9fafb; border-radius:4px; }
  .plan { border:1px solid #111827; border-radius:6px; padding:10px 12px; margin-bottom:14px; page-break-inside:avoid; }
  .plan h4 { font-size:10px; text-transform:uppercase; letter-spacing:.06em; margin-bottom:5px; }
  .chips { margin-top:6px; }
  .chip { display:inline-block; border:1px solid #d1d5db; border-radius:4px; padding:2px 7px; margin:0 4px 4px 0; font-size:10px; font-weight:500; }
  footer { margin-top:16px; border-top:1px solid #e5e7eb; padding-top:7px; color:#9ca3af; font-size:9px; display:flex; justify-content:space-between; }
</style>
</head>
<body>

  <div class="head">
    <div>
      <h1>${esc(student.name)}</h1>
      <div class="sub">
        ${esc(academyName || 'Academy')} · ${esc(student.batch || 'No batch')}${student.position ? ' · ' + esc(student.position) : ''}
        ${student.studentCode ? ' · ' + esc(student.studentCode) : ''}
      </div>
    </div>
    <div class="right">
      <div class="score">${score}<span class="of" style="font-size:12px;color:#9ca3af">/100</span></div>
      <div class="tier" style="background:${tier.hex}">${esc(tier.label)}</div>
      <div class="sub">${esc(monthLabel(month))}</div>
    </div>
  </div>

  <div class="meta">
    <div><div class="k">Change</div><div class="v ${delta == null ? 'muted' : delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${
      delta == null ? 'First assessment' : delta === 0 ? 'No change' : delta > 0 ? `+${delta} points` : `${delta} points`
    }</div></div>
    <div><div class="k">Session pulse</div><div class="v">${
      pulseOverall ? `${pulseOverall}<span class="muted" style="font-weight:400">/3</span>` : '—'
    }</div></div>
    <div><div class="k">Sessions rated</div><div class="v">${pulse?.sessions || 0}</div></div>
    <div><div class="k">Attendance</div><div class="v">${
      attendance?.[0]?.pct == null ? '—' : attendance[0].pct + '%'
    }</div></div>
  </div>

  ${goal ? `
  <div class="plan">
    <h4>Development plan · ${esc(monthLabel(month))}</h4>
    <div style="font-size:12px;font-weight:500">${esc(goal.goal_text)}</div>
    ${Array.isArray(goal.focus_skills) && goal.focus_skills.length ? `
      <div class="chips">${goal.focus_skills.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
  </div>` : ''}

  <div class="row">
    ${listBlock('Strengths', strengths)}
    ${listBlock('Areas to work on', weakest)}
    ${attRows ? `<div class="half"><h4>Attendance</h4><table><tbody>${attRows}</tbody></table></div>` : ''}
  </div>

  ${catBlocks}

  ${assessment.notes ? `<p class="note"><strong>Overall coach note:</strong> ${esc(assessment.notes)}</p>` : ''}

  <footer>
    <span>${esc(academyName || 'SportFlow')} · Football performance report</span>
    <span>Generated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
  </footer>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`

  if (Capacitor.isNativePlatform()) {
    const safeName = String(student.name || 'student').replace(/[^\w-]/g, '_')
    const blob = new Blob([html], { type: 'text/html' })
    await saveOrShareFile(blob, `performance-${safeName}-${month}.html`)
    return
  }

  const w = window.open('', '_blank', 'width=1000,height=800')
  if (!w) throw new Error('Export was blocked by your browser — allow popups for this site')
  w.document.open()
  w.document.write(html)
  w.document.close()
}
