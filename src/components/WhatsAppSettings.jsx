// Settings → WhatsApp. Replaces the mock tab that used to live inside
// Settings.jsx, where Connect flipped a useState boolean and the template
// textareas saved nowhere.
//
// Everything on this screen works before a Meta account exists: you can write
// every message, set every timing and every limit, and it all persists. The one
// thing that needs Meta is submitting a template for approval — and an
// automation cannot be switched on until its template is approved, because an
// unapproved template can only ever fail at send time.
//
// Design: docs/superpowers/specs/2026-08-22-whatsapp-automation-design.md

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import {
  MessageCircle, Check, Loader2, AlertTriangle, X, Plus, Clock,
  ShieldCheck, Ban, ExternalLink, RefreshCw, Send, Info,
} from 'lucide-react'
import * as db from '../lib/db'
import {
  WA_CATALOGUE, WA_GROUPS, WA_VARIABLES, WA_COST,
  mergeAutomations, defaultVarMap, renderPreview, validateTemplate, promoWarnings,
} from '../lib/whatsappCatalogue'

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

// ── Template status chip ─────────────────────────────────────
const STATUS_CHIP = {
  none:     { cls: 'badge-gray',   text: 'Not written' },
  draft:    { cls: 'badge-yellow', text: 'Draft' },
  pending:  { cls: 'badge-blue',   text: 'Awaiting Meta' },
  approved: { cls: 'badge-green',  text: 'Approved' },
  rejected: { cls: 'badge-red',    text: 'Rejected' },
  paused:   { cls: 'badge-orange', text: 'Paused by Meta' },
  disabled: { cls: 'badge-red',    text: 'Disabled by Meta' },
}

export default function WhatsAppSettings() {
  const { showToast } = useApp()

  const [status,      setStatus]      = useState(null)
  const [rows,        setRows]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(null)
  const [composing,   setComposing]   = useState(null)
  const [tab,         setTab]         = useState('automations')

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const [st, autos] = await Promise.all([
        db.fetchWhatsAppStatus(),
        db.fetchWhatsAppAutomations(),
      ])
      setStatus(st)
      setRows(autos)
    } catch (err) {
      setLoadError(err?.message || 'Could not load WhatsApp settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const automations = useMemo(() => mergeAutomations(rows), [rows])
  const connected   = status?.status === 'connected'

  // Re-read the saved rows after any write, so template status and enabled
  // state can never drift from what the database actually holds.
  const refreshAutomations = async () => {
    try { setRows(await db.fetchWhatsAppAutomations()) } catch { /* keep last good */ }
  }

  const toggleAutomation = async (entry, next) => {
    try {
      await db.saveWhatsAppAutomation({ kind: entry.kind, enabled: next })
      await refreshAutomations()
      showToast(`${entry.label} ${next ? 'on' : 'off'}`)
    } catch (err) {
      showToast(err?.message || 'Could not change that', 'error')
    }
  }

  const saveKnob = async (entry, key, value) => {
    const timing = { ...entry.timing, [key]: value }
    // Optimistic: knobs are fiddly and a round-trip per keystroke feels broken.
    setRows(prev => {
      const found = prev.some(r => r.kind === entry.kind)
      return found
        ? prev.map(r => (r.kind === entry.kind ? { ...r, timing } : r))
        : [...prev, { kind: entry.kind, timing, enabled: false }]
    })
    try {
      await db.saveWhatsAppAutomation({ kind: entry.kind, timing })
    } catch (err) {
      showToast(err?.message || 'Could not save that setting', 'error')
      refreshAutomations()
    }
  }

  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
        <Loader2 size={22} className="animate-spin" />
        <p className="text-sm">Loading WhatsApp settings…</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-12 text-center">
        <AlertTriangle size={22} className="text-amber-500 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-700 mb-1">Could not load WhatsApp settings</p>
        <p className="text-xs text-gray-500 mb-4">{loadError}</p>
        <button className="btn-secondary" onClick={load}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 pb-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900">WhatsApp Automation</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Choose what gets sent automatically, write each message, and set when it goes out.
        </p>
      </div>

      <ConnectionPanel status={status} setStatus={setStatus} showToast={showToast} />

      <LimitsPanel status={status} setStatus={setStatus} showToast={showToast} />

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-100">
        {[
          { id: 'automations', label: 'Automations' },
          { id: 'log',         label: 'Send log' },
          { id: 'optouts',     label: 'Opt-outs' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition ${
              tab === t.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'automations' && (
        <AutomationList
          automations={automations}
          connected={connected}
          onToggle={toggleAutomation}
          onKnob={saveKnob}
          onCompose={setComposing}
        />
      )}
      {tab === 'log'     && <SendLog />}
      {tab === 'optouts' && <OptOuts showToast={showToast} />}

      {composing && (
        <ComposerDrawer
          entry={composing}
          connected={connected}
          onClose={() => setComposing(null)}
          onSaved={async () => { await refreshAutomations(); setComposing(null) }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ── Connection ───────────────────────────────────────────────
// Deliberately a checklist rather than a bare credentials form. The four things
// above the form take days (a spare SIM, a Meta Business account, a verified
// number, a permanent token), and a screen that just says "paste your token"
// reads as broken to anyone who has not done them.
const SETUP_STEPS = [
  {
    title: 'A spare phone number',
    body: 'It must not be active on WhatsApp — not the consumer app, not WhatsApp Business. ' +
          'Registering a number to the API removes it from normal WhatsApp, so use a fresh SIM ' +
          'rather than the academy\'s main line.',
  },
  {
    title: 'A Meta Business account with a WhatsApp Business Account (WABA)',
    body: 'Add and verify the number inside it.',
    link: { href: 'https://business.facebook.com/', label: 'business.facebook.com' },
  },
  {
    title: 'A payment method in Meta Business Manager',
    body: 'Messages are billed by Meta directly. Utility messages cost about ₹0.15 each; ' +
          'marketing about 7 times that.',
  },
  {
    title: 'A System User with a permanent access token',
    body: 'Give it the whatsapp_business_messaging and whatsapp_business_management permissions. ' +
          'A temporary token expires in 24 hours and the automations will stop.',
    link: { href: 'https://business.facebook.com/settings/system-users', label: 'System users' },
  },
]

function ConnectionPanel({ status, setStatus, showToast }) {
  const connected = status?.status === 'connected'
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    phoneNumberId: status?.phoneNumberId || '',
    wabaId:        status?.wabaId || '',
    accessToken:   '',
    appSecret:     '',
    displayNumber: status?.displayNumber || '',
  })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const connect = async () => {
    setBusy(true)
    try {
      const next = await db.connectWhatsApp(form)
      setStatus(next)
      setOpen(false)
      setForm(f => ({ ...f, accessToken: '', appSecret: '' }))
      showToast('WhatsApp connected')
    } catch (err) {
      showToast(err?.message || 'Could not connect', 'error')
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      setStatus(await db.disconnectWhatsApp())
      showToast('WhatsApp disconnected')
    } catch (err) {
      showToast(err?.message || 'Could not disconnect', 'error')
    } finally { setBusy(false) }
  }

  if (connected) {
    return (
      <div className="p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <MessageCircle size={18} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-emerald-700 text-sm">WhatsApp connected</p>
              <p className="text-xs text-emerald-600">
                {status.displayNumber || status.phoneNumberId} · {status.sentToday} sent today
              </p>
            </div>
          </div>
          <button className="btn-ghost" onClick={disconnect} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Disconnect
          </button>
        </div>
        {status.lastError && (
          <p className="text-xs text-red-600 mt-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {status.lastError}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 mb-5 p-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <MessageCircle size={20} className="text-green-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">Not connected to WhatsApp</p>
          <p className="text-xs text-gray-500 mt-0.5">
            You can still write every message and set every timing below — it all saves.
            Connecting is what lets messages actually go out.
          </p>
        </div>
      </div>

      <ol className="space-y-2.5 mb-4">
        {SETUP_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-2.5 text-xs">
            <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-gray-700">{s.title}</p>
              <p className="text-gray-500 leading-relaxed">{s.body}</p>
              {s.link && (
                <a href={s.link.href} target="_blank" rel="noreferrer"
                   className="text-brand-600 hover:underline font-semibold inline-flex items-center gap-1 mt-0.5">
                  {s.link.label} <ExternalLink size={11} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {!open ? (
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={15} /> I have all four — enter credentials
        </button>
      ) : (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Phone number ID</label>
              <input className="input" value={form.phoneNumberId} onChange={set('phoneNumberId')}
                     placeholder="1234567890123456" />
            </div>
            <div>
              <label className="label">WABA ID</label>
              <input className="input" value={form.wabaId} onChange={set('wabaId')}
                     placeholder="1234567890123456" />
            </div>
          </div>
          <div>
            <label className="label">Permanent access token</label>
            <input className="input font-mono text-xs" type="password" value={form.accessToken}
                   onChange={set('accessToken')} placeholder="EAA…" />
            <p className="text-[11px] text-gray-400 mt-1">
              Stored server-side and never sent back to this screen.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">App secret <span className="normal-case font-normal">(optional now)</span></label>
              <input className="input font-mono text-xs" type="password" value={form.appSecret}
                     onChange={set('appSecret')} placeholder="Needed for delivery receipts" />
            </div>
            <div>
              <label className="label">Display number</label>
              <input className="input" value={form.displayNumber} onChange={set('displayNumber')}
                     placeholder="+91 98765 43210" />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={connect} disabled={busy}>
              {busy ? <><Loader2 size={15} className="animate-spin" /> Connecting…</> : 'Connect'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Limits ───────────────────────────────────────────────────
function LimitsPanel({ status, setStatus, showToast }) {
  const [draft, setDraft] = useState({
    dailyCap:   status?.dailyCap ?? 200,
    quietStart: status?.quietStart ?? '09:00',
    quietEnd:   status?.quietEnd ?? '20:00',
    graceDays:  status?.suspendGraceDays ?? 3,
  })
  const [busy, setBusy] = useState(false)
  const dirty =
    draft.dailyCap   !== status?.dailyCap ||
    draft.quietStart !== status?.quietStart ||
    draft.quietEnd   !== status?.quietEnd ||
    draft.graceDays  !== status?.suspendGraceDays

  const save = async () => {
    setBusy(true)
    try {
      setStatus(await db.saveWhatsAppSettings(draft))
      showToast('Limits saved')
    } catch (err) {
      showToast(err?.message || 'Could not save limits', 'error')
    } finally { setBusy(false) }
  }

  const togglePause = async () => {
    try {
      setStatus(await db.saveWhatsAppSettings({ paused: !status.paused }))
      showToast(status.paused ? 'Automations resumed' : 'All automations paused')
    } catch (err) {
      showToast(err?.message || 'Could not change that', 'error')
    }
  }

  return (
    <div className="mb-6 p-4 rounded-xl border border-gray-200 bg-gray-50/60">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <p className="text-sm font-bold text-gray-800">Limits &amp; safety</p>
          <p className="text-xs text-gray-500">Applies to every automation below.</p>
        </div>
        <button
          onClick={togglePause}
          className={status?.paused ? 'btn-danger' : 'btn-ghost'}
        >
          {status?.paused ? <><Ban size={14} /> Everything is paused</> : <><ShieldCheck size={14} /> Pause everything</>}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="label">Daily limit</label>
          <input type="number" min={1} max={5000} className="input"
                 value={draft.dailyCap}
                 onChange={e => setDraft(d => ({ ...d, dailyCap: Number(e.target.value) }))} />
          <p className="text-[11px] text-gray-400 mt-1">Caps a runaway loop.</p>
        </div>
        <div>
          <label className="label">Not before</label>
          <input type="time" className="input" value={draft.quietStart}
                 onChange={e => setDraft(d => ({ ...d, quietStart: e.target.value }))} />
        </div>
        <div>
          <label className="label">Not after</label>
          <input type="time" className="input" value={draft.quietEnd}
                 onChange={e => setDraft(d => ({ ...d, quietEnd: e.target.value }))} />
        </div>
        <div>
          <label className="label">Grace period</label>
          <input type="number" min={0} max={60} className="input"
                 value={draft.graceDays}
                 onChange={e => setDraft(d => ({ ...d, graceDays: Number(e.target.value) }))} />
          <p className="text-[11px] text-gray-400 mt-1">Days before suspension.</p>
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end mt-3">
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> Save limits</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Automation list ──────────────────────────────────────────
function AutomationList({ automations, connected, onToggle, onKnob, onCompose }) {
  return (
    <div className="space-y-6">
      {WA_GROUPS.map(group => {
        const items = automations.filter(a => a.group === group.id)
        if (!items.length) return null
        return (
          <div key={group.id}>
            <div className="flex items-baseline gap-2 mb-2">
              <h4 className="text-sm font-bold text-gray-700">{group.label}</h4>
              <span className="text-[11px] text-gray-400">{group.desc}</span>
            </div>
            <div className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {items.map(entry => (
                <AutomationRow
                  key={entry.kind}
                  entry={entry}
                  connected={connected}
                  onToggle={onToggle}
                  onKnob={onKnob}
                  onCompose={onCompose}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AutomationRow({ entry, connected, onToggle, onKnob, onCompose }) {
  const chip     = STATUS_CHIP[entry.templateStatus] || STATUS_CHIP.none
  const canArm   = entry.templateStatus === 'approved'
  const blockWhy = !canArm
    ? entry.templateStatus === 'none'
      ? 'Write the message first'
      : entry.templateStatus === 'draft'
        ? 'Submit this message to Meta and wait for approval'
        : entry.templateStatus === 'pending'
          ? 'Meta is still reviewing this message'
          : 'Meta rejected this message — edit and resubmit'
    : null

  return (
    <div className="p-3.5 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-800">{entry.label}</p>
            <span className={chip.cls}>{chip.text}</span>
            {entry.category === 'marketing' && (
              <span className="badge-orange" title="Marketing templates cost roughly 7x more">
                ~{inr(WA_COST.marketing)}/msg
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{entry.desc}</p>
          {entry.templateStatus === 'rejected' && entry.rejectionReason && (
            <p className="text-[11px] text-red-600 mt-1">Meta said: {entry.rejectionReason}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button className="btn-ghost" onClick={() => onCompose(entry)}>
            {entry.bodyText ? 'Edit message' : 'Write message'}
          </button>
          <button
            onClick={() => canArm && onToggle(entry, !entry.enabled)}
            disabled={!canArm}
            title={blockWhy || ''}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
              entry.enabled ? 'bg-brand-600' : 'bg-gray-200'
            } ${!canArm ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <span className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform mt-1 ${
              entry.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {blockWhy && (
        <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1">
          <Info size={11} /> {blockWhy} before this can be switched on.
        </p>
      )}

      {!!entry.knobs.length && (
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-50">
          {entry.knobs.map(knob => (
            <Knob key={knob.key} knob={knob} value={entry.timing[knob.key]}
                  onChange={v => onKnob(entry, knob.key, v)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Knob({ knob, value, onChange }) {
  if (knob.type === 'toggle') {
    return (
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
               className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
        {knob.label}
      </label>
    )
  }
  return (
    <label className="flex items-center gap-2 text-xs text-gray-600">
      <Clock size={12} className="text-gray-400" />
      {knob.label}
      {knob.type === 'time' ? (
        <input type="time" value={value ?? knob.default}
               onChange={e => onChange(e.target.value)}
               className="px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
      ) : (
        <input type="number" min={knob.min} max={knob.max} value={value ?? knob.default}
               onChange={e => onChange(Number(e.target.value))}
               className="w-16 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500" />
      )}
    </label>
  )
}

// ── Composer ─────────────────────────────────────────────────
function ComposerDrawer({ entry, connected, onClose, onSaved, showToast }) {
  const [name,   setName]   = useState(entry.templateName || entry.defaultName)
  const [body,   setBody]   = useState(entry.bodyText || entry.defaultBody)
  const [varMap, setVarMap] = useState(
    Object.keys(entry.varMap || {}).length ? entry.varMap : defaultVarMap(entry)
  )
  const [footer, setFooter] = useState(entry.footerText || '')
  const [busy,   setBusy]   = useState(false)

  const errors  = useMemo(() => validateTemplate(entry, body, varMap), [entry, body, varMap])
  const warns   = useMemo(() => promoWarnings(body, entry.category), [body, entry.category])
  const preview = useMemo(() => renderPreview(body, varMap), [body, varMap])

  // Append a variable: it takes the next free slot and is recorded in var_map,
  // so the stored mapping can never disagree with the text the owner sees.
  const insertVar = (token) => {
    const used = Object.keys(varMap).map(Number)
    const existing = Object.entries(varMap).find(([, v]) => v === token)
    const slot = existing ? Number(existing[0]) : (used.length ? Math.max(...used) + 1 : 1)
    setVarMap(m => ({ ...m, [String(slot)]: token }))
    setBody(b => `${b}{{${slot}}}`)
  }

  const save = async () => {
    setBusy(true)
    try {
      await db.saveWhatsAppTemplate({
        kind: entry.kind, templateName: name, bodyText: body,
        category: entry.category, footerText: footer || null, varMap,
        buttons: entry.payButton ? [{ type: 'URL', text: 'Pay now', url: 'https://khelit.com/pay/{{1}}' }] : [],
      })
      showToast('Message saved')
      onSaved()
    } catch (err) {
      showToast(err?.message || 'Could not save the message', 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 text-sm">{entry.label}</h3>
            <p className="text-xs text-gray-500">{entry.desc}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {entry.templateStatus === 'approved' && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                This message is approved and live. Meta does not allow editing an approved
                template in place — saving a change turns this automation off and needs a
                fresh approval before it sends again.
              </span>
            </div>
          )}

          <div>
            <label className="label">Template name</label>
            <input className="input font-mono text-xs" value={name}
                   onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} />
            <p className="text-[11px] text-gray-400 mt-1">
              Meta's internal name. Lowercase letters, numbers and underscores only.
            </p>
          </div>

          <div>
            <label className="label">Message</label>
            <textarea className="input resize-none font-mono text-xs leading-relaxed" rows={6}
                      value={body} onChange={e => setBody(e.target.value)} />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[11px] text-gray-400">Click a variable to add it.</p>
              <p className={`text-[11px] ${body.length > 1024 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                {body.length}/1024
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {entry.vars.map(token => (
                <button key={token} onClick={() => insertVar(token)}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 transition">
                  + {WA_VARIABLES[token].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Footer <span className="normal-case font-normal">(optional)</span></label>
            <input className="input text-xs" value={footer} onChange={e => setFooter(e.target.value)}
                   placeholder="Elite Sports Academy" />
          </div>

          {/* Preview */}
          <div>
            <label className="label">Preview</label>
            <div className="rounded-xl bg-[#e5ddd5] p-3">
              <div className="bg-white rounded-lg rounded-tl-none p-3 shadow-sm max-w-[85%]">
                <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{preview}</p>
                {footer && <p className="text-[11px] text-gray-400 mt-2">{footer}</p>}
                {entry.payButton && (
                  <div className="mt-2 pt-2 border-t border-gray-100 text-center">
                    <span className="text-[13px] text-[#00a5f4] font-medium">Pay now</span>
                  </div>
                )}
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Shown with sample data.</p>
          </div>

          {errors.map(e => (
            <p key={e} className="text-xs text-red-600 flex items-start gap-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" /> {e}
            </p>
          ))}
          {warns.map(w => (
            <p key={w} className="text-xs text-amber-700 flex items-start gap-1.5">
              <Info size={13} className="flex-shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            {connected
              ? 'Saves as a draft. Submitting to Meta comes next.'
              : 'Connect WhatsApp to submit this for approval.'}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy || !!errors.length}>
              {busy ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Check size={15} /> Save message</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Send log ─────────────────────────────────────────────────
function SendLog() {
  const [rows, setRows] = useState(null)
  const [err,  setErr]  = useState(null)

  useEffect(() => {
    db.fetchWhatsAppLog(100).then(setRows).catch(e => setErr(e?.message || 'Could not load the log'))
  }, [])

  if (err)   return <p className="text-xs text-red-600 py-6">{err}</p>
  if (!rows) return <p className="text-xs text-gray-400 py-6">Loading…</p>

  if (!rows.length) {
    return (
      <div className="text-center py-10">
        <Send size={20} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Nothing sent yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Every message this academy sends will be listed here with its delivery status.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            <th className="py-2 font-semibold">When</th>
            <th className="py-2 font-semibold">Message</th>
            <th className="py-2 font-semibold">To</th>
            <th className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.id}>
              <td className="py-2 text-gray-500 whitespace-nowrap">
                {new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
              </td>
              <td className="py-2 text-gray-700">{r.kind}</td>
              <td className="py-2 text-gray-500">{r.studentName || r.toPhone}</td>
              <td className="py-2">
                <span className={
                  r.status === 'sent'   ? 'badge-green'
                  : r.status === 'failed' ? 'badge-red'
                  : r.status === 'skipped' ? 'badge-gray' : 'badge-yellow'
                }>{r.deliveryStatus || r.status}</span>
                {r.error && <span className="text-red-500 ml-2">{r.error}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Opt-outs ─────────────────────────────────────────────────
function OptOuts({ showToast }) {
  const [rows,  setRows]  = useState(null)
  const [phone, setPhone] = useState('')
  const [busy,  setBusy]  = useState(false)

  const load = () => db.fetchWhatsAppOptOuts().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!phone.trim()) return
    setBusy(true)
    try {
      await db.setWhatsAppOptOut(phone, true)
      setPhone(''); await load()
      showToast('Added to opt-outs')
    } catch (err) {
      showToast(err?.message || 'Could not add that number', 'error')
    } finally { setBusy(false) }
  }

  const remove = async (p) => {
    try { await db.setWhatsAppOptOut(p, false); await load(); showToast('Removed') }
    catch (err) { showToast(err?.message || 'Could not remove', 'error') }
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        These numbers never receive an automated message. A parent replying STOP is added here
        automatically. Opt-outs are keyed by phone, so one STOP covers every child in that family.
      </p>
      <div className="flex gap-2 mb-4">
        <input className="input flex-1" placeholder="+91 98765 43210" value={phone}
               onChange={e => setPhone(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn-secondary" onClick={add} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      {rows === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : !rows.length ? (
        <p className="text-xs text-gray-400 py-4 text-center">No opt-outs.</p>
      ) : (
        <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
          {rows.map(r => (
            <div key={r.phone} className="flex items-center justify-between px-3 py-2.5 bg-white">
              <div>
                <p className="text-sm font-mono text-gray-700">{r.phone}</p>
                <p className="text-[11px] text-gray-400">
                  {r.source === 'stop_reply' ? 'Replied STOP' : 'Added manually'} ·{' '}
                  {new Date(r.optedOutAt).toLocaleDateString('en-IN')}
                </p>
              </div>
              <button onClick={() => remove(r.phone)} className="text-xs text-gray-400 hover:text-red-600 font-semibold">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
