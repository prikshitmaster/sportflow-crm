// ============================================================
// razorpay-create-trial-order
// ============================================================
// Called from the PUBLIC /join registration funnel (TrialEnroll.jsx) via
// supabase.functions.invoke(), which automatically forwards the caller's
// current session as the Authorization header. Unlike razorpay-create-order
// (owner/staff charging an EXISTING student), the caller here is an
// anonymous prospect who has only completed phone-OTP — there is no
// actor_kind to check. The only things that matter:
//   1. The caller has a valid, currently-verified phone-OTP session.
//   2. The trial they're paying for is THEIRS (phone matches) and belongs
//      to the academy the slug resolves to.
//   3. The amount charged is the branch's server-side trial_fee — never a
//      client-supplied number.
//
// Frontend POSTs { slug, branchId, trialId }.
//
// Env vars (already set for razorpay-create-order, reused here):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   RAZORPAY_KEY_SECRET
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST')    return json({ error: 'POST only' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  const { slug, branchId, trialId } = body
  if (!slug)     return json({ error: 'slug required' }, 400)
  if (!branchId) return json({ error: 'branchId required' }, 400)
  if (!trialId)  return json({ error: 'trialId required' }, 400)

  // ── Resolve caller from their own JWT — any verified phone-OTP session,
  // no owner/staff role required. This is the only auth check.
  const authHeader = req.headers.get('Authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  // Raw, no '+' prefix — matches how the SQL RPC stores auth.users.phone
  // directly into trials.phone (secure_submit_public_trial_v2), never adding one.
  const callerPhone = userData?.user?.phone || null
  if (userErr || !callerPhone) return json({ error: 'unauthorized' }, 401)

  // ── Resolve academy from slug, verify branch belongs to it ───
  const { data: academy } = await supabase
    .from('academies')
    .select('id, name')
    .eq('slug', String(slug).toLowerCase().trim())
    .maybeSingle()
  if (!academy) return json({ error: 'academy not found' }, 404)

  const { data: branch } = await supabase
    .from('sport_branches')
    .select('id, academy_id, sport_name, branch_name, trial_fee')
    .eq('id', branchId)
    .maybeSingle()
  if (!branch || branch.academy_id !== academy.id) {
    return json({ error: 'invalid branch' }, 403)
  }

  // ── Verify the trial exists, belongs to this academy/branch, and is
  // the CALLER's own trial (same verified phone) ────────────────
  const { data: trial } = await supabase
    .from('trials')
    .select('id, academy_id, branch_id, phone, name, trial_fee_paid, razorpay_payment_id')
    .eq('id', trialId)
    .maybeSingle()
  if (!trial || trial.academy_id !== academy.id || trial.branch_id !== branchId) {
    return json({ error: 'trial not found' }, 404)
  }
  if (trial.phone !== callerPhone) {
    return json({ error: 'forbidden' }, 403)
  }
  if (trial.razorpay_payment_id) {
    return json({ error: 'already paid' }, 409)
  }

  // ── Read academy payment config ──────────────────────────────
  const { data: cfg } = await supabase
    .from('academy_payment_configs')
    .select('razorpay_key_id, razorpay_account_id, enabled')
    .eq('academy_id', academy.id)
    .maybeSingle()
  if (!cfg || !cfg.enabled || !cfg.razorpay_key_id) {
    return json({ error: 'razorpay not configured for this academy' }, 412)
  }

  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
  if (!keySecret) return json({ error: 'gateway misconfigured' }, 500)

  // Server-authoritative amount — the client never dictates what gets charged.
  const amount = Number(branch.trial_fee ?? 590)
  const amountPaise = Math.round(amount * 100)

  const orderBody: any = {
    amount:   amountPaise,
    currency: 'INR',
    receipt:  `trial-${trialId}-${Date.now()}`,
    notes: {
      kind:       'trial',
      academy_id: academy.id,
      trial_id:   String(trialId),
      branch_id:  String(branchId),
      slug:       String(slug),
    },
  }
  if (cfg.razorpay_account_id) {
    orderBody.transfers = [{
      account: cfg.razorpay_account_id, amount: amountPaise, currency: 'INR',
      notes: { academy_id: academy.id },
    }]
  }

  const auth = btoa(`${cfg.razorpay_key_id}:${keySecret}`)
  const rzpResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(orderBody),
  })
  const rzpJson = await rzpResp.json().catch(() => ({}))
  if (!rzpResp.ok) return json({ error: 'razorpay order failed', details: rzpJson }, 502)

  return json({
    ok:       true,
    orderId:  rzpJson.id,
    keyId:    cfg.razorpay_key_id,
    amount:   amountPaise,
    currency: 'INR',
    prefill:  { name: trial.name, contact: callerPhone },
  })
})
