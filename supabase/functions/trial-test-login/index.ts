// ============================================================
// trial-test-login — DEV ONLY shortcut to skip phone OTP
// ============================================================
// Takes a 10-digit phone, creates (or reuses) a synthetic auth user with
// BOTH a deterministic email+password (for signInWithPassword) AND the
// real phone set + phone_confirmed — so auth.users.phone is populated
// exactly as a real OTP verification would leave it. That means
// secure_submit_public_trial's `SELECT phone FROM auth.users` needs no
// special-casing for the test path; it just works.
//
// Unlike parent-test-login, there's no pre-existing row to look up —
// a trial doesn't exist until submit time, so this always creates/reuses
// a bare auth user keyed by phone.
//
// HARD-GATED behind ENABLE_TRIAL_TEST_LOGIN env var. If unset, returns 404.
// DO NOT set this var in production.
//
// Env vars (Supabase Functions dashboard):
//   SUPABASE_URL                — auto
//   SUPABASE_SERVICE_ROLE_KEY   — auto
//   ENABLE_TRIAL_TEST_LOGIN     — set to "true" to enable
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

  if (Deno.env.get('ENABLE_TRIAL_TEST_LOGIN') !== 'true') {
    return json({ error: 'not found' }, 404)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  const rawPhone = String(body.phone || '').replace(/\D/g, '')
  const phone10  = rawPhone.slice(-10)
  if (phone10.length !== 10) return json({ error: 'need 10-digit phone' }, 400)

  const phoneE164      = `+91${phone10}`
  const syntheticEmail = `trial-${phone10}@sportflow.test`
  const password        = `test-${phone10}-pw`   // deterministic so we can re-login

  // Try create; if email already exists (orphan), find by listing
  const created = await supabase.auth.admin.createUser({
    email:         syntheticEmail,
    password,
    email_confirm: true,
    phone:         phoneE164,
    phone_confirm: true,
    user_metadata: { source: 'trial-test-login' },
  })

  let userId: string | undefined = created.data?.user?.id

  if (created.error && !/already.*registered|already exists/i.test(created.error.message)) {
    return json({ error: created.error.message }, 500)
  }

  if (!userId) {
    const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const found = list.data?.users?.find(u => u.email === syntheticEmail)
    if (!found) return json({ error: 'could not resolve existing user' }, 500)
    userId = found.id
    // Always reset password + re-confirm phone so a re-run stays reliable.
    await supabase.auth.admin.updateUserById(userId, {
      password, phone: phoneE164, phone_confirm: true,
    })
  }

  return json({ ok: true, email: syntheticEmail, password })
})
