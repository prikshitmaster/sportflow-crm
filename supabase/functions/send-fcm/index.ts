import { JWT } from 'https://esm.sh/google-auth-library@9.15.1?target=deno'

const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? ''
let serviceAccount: any = null
try { serviceAccount = JSON.parse(serviceAccountJson) } catch { /* checked below */ }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!serviceAccount) {
    return new Response(JSON.stringify({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { token, title, body, link } = await req.json()

    const jwtClient = new JWT({
      email:  serviceAccount.client_email,
      key:    serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
    const { access_token } = await jwtClient.authorize()

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: { link: link ?? '/' },
            android: { priority: 'high' },
          },
        }),
      }
    )

    const result = await fcmRes.json()

    if (!fcmRes.ok) {
      // UNREGISTERED / NOT_FOUND = stale token — caller should delete it
      const status = result?.error?.status
      const invalidToken = status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT'
      return new Response(JSON.stringify({ error: result?.error?.message, invalidToken }), {
        status: fcmRes.status, headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
