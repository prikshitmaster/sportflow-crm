// ============================================================
// razorpay-verify-trial-payment
// ============================================================
// Called from TrialEnroll.jsx right after Razorpay Checkout's `handler`
// fires with { razorpay_order_id, razorpay_payment_id, razorpay_signature }.
//
// Unlike the parent/student payment flow (which trusts ONLY the async
// razorpay-webhook + polling, never the client), trials need an immediate
// "paid" reflection — so this function does the verification Razorpay
// itself documents as safe to do synchronously in the success callback:
//   expected_signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
// That signature can only be produced by someone holding the secret — i.e.
// Razorpay itself, after a real capture. It is not something a client can
// forge by calling the `handler` manually with made-up values.
//
// We then re-fetch the order from Razorpay's own API (not the client) to
// read the AUTHORITATIVE charged amount before writing anything, and only
// update the exact trial row that the order was created for.
//
// If the browser closes between Razorpay's capture and this call, the
// razorpay-webhook (payment.captured) backstop books the same payment by
// matching trials.razorpay_order_id — see that function. Both paths go
// through secure_book_trial_payment, which is idempotent, so whichever
// arrives first wins and the other is a no-op.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  const { slug, trialId, orderId, paymentId, signature } = body
  if (!slug || !trialId || !orderId || !paymentId || !signature) {
    return json({ error: 'slug, trialId, orderId, paymentId, signature all required' }, 400)
  }

  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  // auth.users.phone is E.164 without '+' (e.g. "919979369521"). Since
  // migration 0165, secure_submit_public_trial_v2 strips the country code
  // before storing trials.phone as a bare 10-digit number — normalize the
  // same way here, or the trial.phone === callerPhone check below always
  // fails and a real, already-charged payment never gets recorded.
  const callerPhone = (userData?.user?.phone || '').replace(/\D/g, '').slice(-10) || null
  if (userErr || !callerPhone) return json({ error: 'unauthorized' }, 401)

  const { data: academy } = await supabase
    .from('academies')
    .select('id')
    .eq('slug', String(slug).toLowerCase().trim())
    .maybeSingle()
  if (!academy) return json({ error: 'academy not found' }, 404)

  const { data: trial } = await supabase
    .from('trials')
    .select('id, academy_id, phone, razorpay_payment_id')
    .eq('id', trialId)
    .maybeSingle()
  if (!trial || trial.academy_id !== academy.id) return json({ error: 'trial not found' }, 404)
  if (trial.phone !== callerPhone) return json({ error: 'forbidden' }, 403)
  if (trial.razorpay_payment_id) {
    return json({ ok: true, alreadyRecorded: true })
  }

  const { data: cfg } = await supabase
    .from('academy_payment_configs')
    .select('razorpay_key_id')
    .eq('academy_id', academy.id)
    .maybeSingle()
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!cfg?.razorpay_key_id || !keySecret) return json({ error: 'gateway misconfigured' }, 500)

  // ── Verify Razorpay's own signature — this is the entire trust boundary ──
  const expected = await hmacHex(keySecret, `${orderId}|${paymentId}`)
  if (!safeEq(expected, signature)) {
    return json({ error: 'signature mismatch — payment not verified' }, 400)
  }

  // ── Re-fetch the order from Razorpay directly for the authoritative
  // amount + to confirm it's actually for THIS trial, not a replayed
  // signature from an unrelated order. ─────────────────────────
  const auth = btoa(`${cfg.razorpay_key_id}:${keySecret}`)
  const orderResp = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const order = await orderResp.json().catch(() => ({}))
  if (!orderResp.ok || !order?.id) {
    return json({ error: 'could not verify order with razorpay' }, 502)
  }
  if (order.notes?.kind !== 'trial' || String(order.notes?.trial_id) !== String(trialId)) {
    return json({ error: 'order does not match this trial' }, 400)
  }
  if (order.status !== 'paid') {
    return json({ error: `order not paid (status: ${order.status})` }, 400)
  }

  const amount   = Number(order.amount_paid ?? order.amount) / 100
  // Read back the breakdown razorpay-create-trial-order stamped onto the
  // order's notes at charge time — reflects the tax that was ACTUALLY
  // charged, not whatever the branch's tax config happens to be right now.
  const taxPct   = Number(order.notes?.tax_percent) || 0
  const taxAmt   = Number(order.notes?.tax_amount) || 0

  // trials.trial_fee_mode has a DB check constraint limited to exactly
  // 'Cash' | 'UPI' | 'Card' | 'Not collected' (the same values the staff-side
  // manual entry UI uses) — map Razorpay's richer `method` field down to
  // that set rather than writing a value the constraint would reject.
  const paymentResp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const paymentEntity = await paymentResp.json().catch(() => ({}))
  const method = paymentEntity?.method
  const feeMode = method === 'upi' ? 'UPI' : method === 'card' ? 'Card' : 'Card' // netbanking/wallet/emi -> closest non-cash bucket

  // Book it through secure_book_trial_payment (migration 0197) rather than
  // UPDATEing `trials` directly. A raw update marked the trial paid but wrote
  // NOTHING to the payments ledger, so the money existed on the trial row and
  // in no revenue report — Reports reads trial revenue as
  // payments.payment_type='trial'. The RPC writes both halves in one
  // transaction, mints the receipt number, and is idempotent, so it is safe
  // for this call and the webhook backstop to race.
  const { data: booked, error: bookErr } = await supabase.rpc('secure_book_trial_payment', {
    p_trial_id:           Number(trialId),
    p_amount:             amount,
    p_mode:               feeMode,
    p_gateway_payment_id: paymentId,
    p_gateway_order_id:   orderId,
    p_tax_percent:        taxAmt > 0 ? taxPct : null,
    p_tax_amount:         taxAmt > 0 ? taxAmt : null,
  })

  if (bookErr) {
    // Unique index on razorpay_payment_id — this exact payment was already
    // recorded against a different trial row (replay), refuse cleanly.
    if (bookErr.code === '23505') return json({ error: 'payment already recorded' }, 409)
    console.error('trial payment booking failed', bookErr)
    return json({ error: 'could not record payment' }, 500)
  }

  return json({
    ok:              true,
    amount,
    receiptNo:       booked?.receiptNo ?? null,
    alreadyRecorded: Boolean(booked?.already),
  })
})
