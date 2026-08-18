// SPIKE — throwaway prototype proving auto-send-on-payment works via Twilio's
// free WhatsApp sandbox. Not the production design (see
// docs/superpowers/specs/2026-08-13-whatsapp-fee-reminders-design.md for the
// real Meta-Cloud-API rail this gets replaced by). Delete or replace once that
// lands.
//
// Trial-account limitation: Twilio will only deliver to numbers that sent
// "join <code>" to the sandbox number, so `to` must be a verified/sandboxed
// number for now.

const ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const AUTH_TOKEN   = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const FROM         = Deno.env.get('TWILIO_WHATSAPP_FROM') ?? '' // e.g. whatsapp:+14155238886

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-staff-token, x-student-token, x-session-token',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

  try {
    if (!ACCOUNT_SID || !AUTH_TOKEN || !FROM) {
      return new Response(JSON.stringify({ error: 'Twilio secrets not configured' }), { status: 500, headers: cors })
    }

    const { to, body, mediaUrl } = await req.json()
    if (!to || !body) {
      return new Response(JSON.stringify({ error: 'to and body are required' }), { status: 400, headers: cors })
    }

    const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

    const form = new URLSearchParams({ To: toWhatsApp, From: FROM, Body: body })
    if (mediaUrl) form.append('MediaUrl', mediaUrl)
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`),
      },
      body: form,
    })
    const json = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: json.message || 'Twilio send failed', details: json }), { status: 502, headers: cors })
    }

    return new Response(JSON.stringify({ ok: true, sid: json.sid, status: json.status }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || 'unknown error' }), { status: 500, headers: cors })
  }
})
