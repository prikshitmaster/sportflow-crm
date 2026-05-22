// ============================================================
// razorpay-create-order
// ============================================================
// Frontend POSTs { studentId, amount, monthsCovered?, coverageStart?,
// paymentLinkId? } with the staff/owner session token in x-session-token.
//
// We:
//   1. Validate the caller (owner or staff with payments.manage) via current_actor
//   2. Verify the student belongs to the caller's academy
//   3. Read razorpay_key_id (and account_id if using Razorpay Route) from
//      academy_payment_configs
//   4. Create a Razorpay order via REST API (HTTP Basic Auth with key_id:key_secret)
//   5. Return { orderId, keyId, amount, currency, prefill }
//
// The frontend then opens Razorpay Checkout with these. Razorpay charges the card.
// Razorpay calls our razorpay-webhook with payment.captured. The webhook records
// the payment via secure_record_gateway_payment.
//
// Env vars (set in Supabase Functions dashboard):
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
//   RAZORPAY_KEY_SECRET         — platform-wide Razorpay test/live secret
//
// Why the secret is platform-wide for v1:
//   For per-academy payouts, set up Razorpay Route and store linked
//   account_id in academy_payment_configs.razorpay_account_id. The order
//   below already passes "transfers" to direct funds to that account.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  const { studentId, amount, monthsCovered = 1, coverageStart = null, paymentLinkId = null } = body
  if (!studentId)                      return json({ error: 'studentId required' }, 400)
  if (!amount || Number(amount) <= 0)  return json({ error: 'amount must be > 0' }, 400)

  const sessionToken = req.headers.get('x-session-token')

  // ── Resolve caller via current_actor ─────────────────────
  const { data: actor, error: actorErr } = await supabase
    .rpc('current_actor', { p_token: sessionToken })
    .maybeSingle()

  if (actorErr || !actor || !actor.actor_kind) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (actor.actor_kind !== 'owner' && actor.actor_kind !== 'staff') {
    return json({ error: 'forbidden' }, 403)
  }

  // ── Verify student belongs to this academy ───────────────
  const { data: student, error: studErr } = await supabase
    .from('students')
    .select('id, name, academy_id, phone, parent_phone')
    .eq('id', studentId)
    .maybeSingle()

  if (studErr || !student)                         return json({ error: 'student not found' }, 404)
  if (student.academy_id !== actor.academy_id)     return json({ error: 'cross-academy denied' }, 403)

  // ── Read academy payment config ──────────────────────────
  const { data: cfg } = await supabase
    .from('academy_payment_configs')
    .select('razorpay_key_id, razorpay_account_id, enabled, invoice_prefix')
    .eq('academy_id', actor.academy_id)
    .maybeSingle()

  if (!cfg || !cfg.enabled || !cfg.razorpay_key_id) {
    return json({ error: 'razorpay not configured for this academy' }, 412)
  }

  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keySecret) return json({ error: 'gateway misconfigured' }, 500)

  // ── Create Razorpay order ────────────────────────────────
  const amountPaise = Math.round(Number(amount) * 100)
  const orderBody: any = {
    amount:   amountPaise,
    currency: 'INR',
    receipt:  `sf-${studentId}-${Date.now()}`,
    notes: {
      academy_id:     actor.academy_id,
      student_id:     String(studentId),
      student_name:   student.name,
      months_covered: String(monthsCovered),
      coverage_start: coverageStart || '',
      payment_link_id: paymentLinkId || '',
    },
  }

  // If using Razorpay Route to a linked academy account
  if (cfg.razorpay_account_id) {
    orderBody.transfers = [{
      account: cfg.razorpay_account_id,
      amount:  amountPaise,
      currency:'INR',
      notes:   { academy_id: actor.academy_id },
    }]
  }

  const auth = btoa(`${cfg.razorpay_key_id}:${keySecret}`)
  const rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(orderBody),
  })

  const rzpJson = await rzpResp.json().catch(() => ({}))
  if (!rzpResp.ok) {
    return json({ error: 'razorpay order failed', details: rzpJson }, 502)
  }

  return json({
    ok:        true,
    orderId:   rzpJson.id,
    keyId:     cfg.razorpay_key_id,
    amount:    amountPaise,
    currency:  'INR',
    prefill: {
      name:    student.name,
      contact: student.parent_phone || student.phone || '',
    },
    notes: orderBody.notes,
  })
})
