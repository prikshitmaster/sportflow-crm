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
  // auth.users.phone is E.164 without '+' (e.g. "919979369521"). Since
  // migration 0165, secure_submit_public_trial_v2 strips the country code
  // before storing trials.phone as a bare 10-digit number — normalize the
  // same way here, or every trial.phone comparison below fails.
  const rawCallerPhone = userData?.user?.phone || null
  const callerPhone = rawCallerPhone ? rawCallerPhone.replace(/\D/g, '').slice(-10) : null
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
    .select('id, academy_id, sport_name, branch_name, trial_fee, kit_fee, tax_percent, tax_on_trial, tax_on_kit')
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
  // Trial fee + kit fee (if the branch has one configured) + branch tax, if
  // any — mirrors src/lib/tax.js's computeTrialTotal() exactly, so this
  // must be kept in sync with that file if the tax rule ever changes.
  // Previously this omitted tax entirely, silently undercharging GST on
  // every online trial payment at a tax-enabled branch (caught while wiring
  // up receipts: branch b32308fc.../Football has 12% tax_on_trial, but this
  // function was only ever charging the untaxed ₹590).
  const round = (n: number) => Math.round(Number(n) || 0)
  const trialFeeAmt = round(branch.trial_fee ?? 590)
  const kitFeeAmt   = round(branch.kit_fee ?? 0)
  const taxPct      = Number(branch.tax_percent) || 0
  const trialTaxed  = taxPct > 0 && branch.tax_on_trial
  const kitTaxed    = taxPct > 0 && branch.tax_on_kit
  const taxableBase = (trialTaxed ? trialFeeAmt : 0) + (kitTaxed ? kitFeeAmt : 0)
  const taxAmount   = round((taxableBase * taxPct) / 100)
  const amount      = trialFeeAmt + kitFeeAmt + taxAmount
  const amountPaise = Math.round(amount * 100)

  const orderBody: any = {
    amount:   amountPaise,
    currency: 'INR',
    receipt:  `trial-${trialId}-${Date.now()}`,
    notes: {
      kind:        'trial',
      academy_id:  academy.id,
      trial_id:    String(trialId),
      branch_id:   String(branchId),
      slug:        String(slug),
      // Carried through to razorpay-verify-trial-payment so it can persist
      // the breakdown against the exact order actually charged, rather than
      // re-reading branch config that may have changed in between.
      tax_percent: String(trialTaxed || kitTaxed ? taxPct : 0),
      tax_amount:  String(taxAmount),
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

  // Stamp the order id on the trial NOW, before the payer is sent to Checkout.
  // This is what lets razorpay-webhook find the trial if the browser dies
  // between Razorpay capturing the money and razorpay-verify-trial-payment
  // running: an order's `notes` do not propagate to the payment entity the
  // webhook receives, so order_id is the only reliable link back.
  // razorpay_payment_id stays NULL, so nothing treats the trial as paid yet
  // and the "already paid" guard above still works on a retry.
  if (rzpJson?.id) {
    const { error: stampErr } = await supabase
      .from('trials')
      .update({ razorpay_order_id: rzpJson.id })
      .eq('id', trialId)
    // Non-fatal: a failed stamp only costs the webhook backstop, and the
    // synchronous verify path does not need it. Never block a payment for it.
    if (stampErr) console.error('could not stamp order id on trial', stampErr)
  }

  // rawCallerPhone is Supabase Auth's raw auth.users.phone — digits only, no
  // leading '+' but WITH the country code (e.g. "919998887777"). Razorpay
  // Checkout's prefill.contact expects proper E.164 (+91XXXXXXXXXX); the
  // normalized bare-10-digit callerPhone used for the trial-ownership check
  // above has the country code stripped, so it must not be reused here.
  return json({
    ok:       true,
    orderId:  rzpJson.id,
    keyId:    cfg.razorpay_key_id,
    amount:   amountPaise,
    currency: 'INR',
    prefill:  { name: trial.name, contact: `+${rawCallerPhone}` },
  })
})
