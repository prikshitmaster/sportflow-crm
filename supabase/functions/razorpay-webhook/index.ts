// ============================================================
// razorpay-webhook
// ============================================================
// Endpoint URL (set in Razorpay Dashboard → Webhooks):
//   https://<project>.functions.supabase.co/razorpay-webhook
//
// Events to subscribe (Razorpay Dashboard):
//   - payment.captured     (primary — record the payment)
//   - payment.failed       (optional — log + show in admin)
//   - order.paid           (optional — double-confirm)
//
// Required env:
//   RAZORPAY_WEBHOOK_SECRET  — set in Razorpay Dashboard webhook config
//                              AND in Supabase Functions env
//
// Idempotency: we dedupe on Razorpay's event id at the DB level via
// secure_record_gateway_payment. Razorpay retries failed deliveries up
// to 24h with exponential backoff — that's safe here.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// HMAC-SHA256 hex (Razorpay signs the raw body with the webhook secret)
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Constant-time string compare (timing-attack safe)
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok({ error: 'POST only' }, 405)

  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) {
    console.error('RAZORPAY_WEBHOOK_SECRET not set')
    return ok({ error: 'misconfigured' }, 500)
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-razorpay-signature') || ''

  const expected = await hmacHex(secret, rawBody)
  if (!safeEq(expected, signature)) {
    console.warn('webhook signature mismatch')
    return ok({ error: 'invalid signature' }, 400)
  }

  let evt: any
  try { evt = JSON.parse(rawBody) } catch { return ok({ error: 'bad json' }, 400) }

  const eventId   = evt.id || evt.event_id || `${evt.event}-${Date.now()}`
  const eventType = evt.event as string

  // We care primarily about payment.captured for v1
  if (eventType !== 'payment.captured') {
    // Log for visibility but don't act
    await supabase.from('razorpay_events')
      .upsert({ event_id: eventId, event_type: eventType, payload: evt, status: 'skipped' },
              { onConflict: 'event_id' })
    return ok({ ok: true, skipped: eventType })
  }

  const payment = evt.payload?.payment?.entity
  if (!payment) return ok({ error: 'no payment entity in payload' }, 400)

  const notes = payment.notes || {}
  const academyId      = notes.academy_id
  const studentId      = notes.student_id ? Number(notes.student_id) : null
  const monthsCovered  = notes.months_covered ? Number(notes.months_covered) : 1
  const coverageStart  = notes.coverage_start || null
  const paymentLinkId  = notes.payment_link_id || null

  if (!academyId || !studentId) {
    console.error('webhook missing notes.academy_id or notes.student_id', notes)
    await supabase.from('razorpay_events')
      .upsert({ event_id: eventId, event_type: eventType, payload: evt, status: 'failed' },
              { onConflict: 'event_id' })
    return ok({ error: 'missing required notes' }, 400)
  }

  // Amount is in paise — convert to rupees (NUMERIC)
  const amount = Number(payment.amount) / 100

  const { data, error } = await supabase.rpc('secure_record_gateway_payment', {
    p_event_id:           eventId,
    p_event_type:         eventType,
    p_payload:            evt,
    p_gateway_payment_id: payment.id,
    p_gateway_order_id:   payment.order_id,
    p_amount:             amount,
    p_academy_id:         academyId,
    p_student_id:         studentId,
    p_months_covered:     monthsCovered,
    p_coverage_start:     coverageStart || null,
    p_payment_link_id:    paymentLinkId || null,
  })

  if (error) {
    console.error('record_gateway_payment failed', error)
    await supabase.from('razorpay_events')
      .update({ status: 'failed' })
      .eq('event_id', eventId)
    // Return 500 so Razorpay retries
    return ok({ error: error.message }, 500)
  }

  return ok({ ok: true, result: data })
})
