// ============================================================
// parent-test-login — DEV ONLY shortcut to skip phone OTP
// ============================================================
// Takes a 10-digit phone, finds the matching parent, creates (or reuses)
// a synthetic email+password auth user, links it to parents.auth_user_id,
// and returns { email, password } so the client can call
// supabase.auth.signInWithPassword() and get a real Supabase session.
//
// HARD-GATED behind ENABLE_PARENT_TEST_LOGIN env var. If unset, returns 404.
// DO NOT set this var in production.
//
// Env vars (Supabase Functions dashboard):
//   SUPABASE_URL                — auto
//   SUPABASE_SERVICE_ROLE_KEY   — auto
//   ENABLE_PARENT_TEST_LOGIN    — set to "true" to enable
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

  if (Deno.env.get('ENABLE_PARENT_TEST_LOGIN') !== 'true') {
    return json({ error: 'not found' }, 404)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }

  const rawPhone = String(body.phone || '').replace(/\D/g, '')
  const phone10  = rawPhone.slice(-10)
  if (phone10.length !== 10) return json({ error: 'need 10-digit phone' }, 400)

  // 1. Find parent by phone (any academy)
  const { data: parent, error: pErr } = await supabase
    .from('parents')
    .select('id, name, auth_user_id, academy_id')
    .eq('phone', phone10)
    .limit(1)
    .maybeSingle()

  if (pErr) return json({ error: pErr.message }, 500)
  if (!parent) {
    return json({ error: `no parent found with phone ${phone10}` }, 404)
  }

  // 2. Create or reuse synthetic auth user
  const syntheticEmail = `parent-${phone10}@sportflow.test`
  const password       = `test-${phone10}-pw`   // deterministic so we can re-login

  let userId = parent.auth_user_id
  if (!userId) {
    // Try create; if email already exists (orphan), find by listing
    const created = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: { phone: phone10, source: 'parent-test-login' },
    })
    if (created.error && !/already.*registered|already exists/i.test(created.error.message)) {
      return json({ error: created.error.message }, 500)
    }
    if (created.data?.user) {
      userId = created.data.user.id
    } else {
      // already-registered: look it up
      const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const found = list.data?.users?.find(u => u.email === syntheticEmail)
      if (!found) return json({ error: 'could not resolve existing user' }, 500)
      userId = found.id
    }
  }

  // 3. Always reset password so client-side login is reliable
  await supabase.auth.admin.updateUserById(userId!, { password })

  // 4. Link parents.auth_user_id (claim happens client-side via secure_claim_parent_account too)
  if (parent.auth_user_id !== userId) {
    await supabase.from('parents').update({ auth_user_id: userId }).eq('id', parent.id)
  }

  return json({
    ok:    true,
    email: syntheticEmail,
    password,
    parent: { id: parent.id, name: parent.name },
  })
})
