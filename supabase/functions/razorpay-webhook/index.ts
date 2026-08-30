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

  // Idempotency hangs entirely on this id being STABLE across Razorpay's
  // retries. The old fallback appended Date.now(), which minted a fresh key on
  // every retry — the dedupe check would miss and the same payment could be
  // booked twice. With no stable id there is no safe way to dedupe, so refuse
  // and let Razorpay retry rather than risk double-booking money.
  const eventId   = evt.id || evt.event_id
  const eventType = evt.event as string

  if (!eventId) {
    console.error('webhook has no stable event id — refusing to process', { eventType })
    return ok({ error: 'missing event id' }, 400)
  }

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

  // ── Trial backstop ────────────────────────────────────────────────
  // A trial order has no notes.student_id (the payer is not a student yet),
  // so it used to land in the branch below, get logged 'failed', and 400 —
  // which made Razorpay retry the same event for 24h while the captured
  // money stayed out of the ledger entirely. The normal path for a trial is
  // razorpay-verify-trial-payment, called synchronously from the browser;
  // this covers the case where the phone loses network or the app is closed
  // between capture and that call.
  //
  // Matched on order_id, stamped onto the trial by razorpay-create-trial-order:
  // an order's `notes` are NOT copied onto the payment entity delivered here,
  // so notes.trial_id cannot be relied on.
  if (!studentId && payment.order_id) {
    const { data: trial } = await supabase
      .from('trials')
      .select('id, academy_id, trial_fee_paid, razorpay_payment_id')
      .eq('razorpay_order_id', payment.order_id)
      .maybeSingle()

    if (trial) {
      if (trial.razorpay_payment_id) {
        // The browser's verify call already booked it. Nothing to do.
        await supabase.from('razorpay_events')
          .upsert({ event_id: eventId, event_type: eventType, payload: evt, status: 'skipped' },
                  { onConflict: 'event_id' })
        return ok({ ok: true, alreadyRecorded: true, trialId: trial.id })
      }

      // Razorpay's own richer method → the four values trials.trial_fee_mode
      // allows, same mapping razorpay-verify-trial-payment uses.
      const method  = payment.method
      const feeMode = method === 'upi' ? 'UPI' : 'Card'

      const { data: booked, error: bookErr } = await supabase.rpc('secure_book_trial_payment', {
        p_trial_id:           trial.id,
        p_amount:             Number(payment.amount) / 100,
        p_mode:               feeMode,
        p_gateway_payment_id: payment.id,
        p_gateway_order_id:   payment.order_id,
        // Tax breakdown lives on the order's notes, which this payload does
        // not carry. The trial keeps whatever the branch config stamped; the
        // gross amount above is authoritative either way.
        p_tax_percent:        null,
        p_tax_amount:         null,
      })

      if (bookErr) {
        console.error('trial backstop booking failed', bookErr)
        await supabase.from('razorpay_events')
          .upsert({ event_id: eventId, event_type: eventType, payload: evt, status: 'failed' },
                  { onConflict: 'event_id' })
        return ok({ error: bookErr.message }, 500)
      }

      await supabase.from('razorpay_events')
        .upsert({ event_id: eventId, event_type: eventType, payload: evt,
                  status: 'processed', processed_at: new Date().toISOString() },
                { onConflict: 'event_id' })
      return ok({ ok: true, kind: 'trial', trialId: trial.id, result: booked })
    }
  }

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
