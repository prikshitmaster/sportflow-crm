const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON') ?? ''
let serviceAccount: any = null
try { serviceAccount = JSON.parse(serviceAccountJson) } catch { /* checked below */ }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// google-auth-library's JWT signer needs Node's crypto.Sign, which the Deno
// edge runtime doesn't implement — sign the service-account JWT ourselves
// with Web Crypto (natively supported) instead of pulling in that library.
function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function getAccessToken(sa: any): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${base64url(signature)}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error_description || json.error || 'token exchange failed')
  return json.access_token
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

    const accessToken = await getAccessToken(serviceAccount)

    const fcmRes = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: { link: link ?? '/' },
            android: {
              priority: 'high',
              notification: {
                // Must match FCM_CHANNEL_ID in src/lib/fcm.js. Without it FCM
                // uses its "Miscellaneous" fallback channel, which is
                // IMPORTANCE_DEFAULT — shade only, no heads-up banner.
                channel_id: 'sportflow_default',
                sound: 'default',
                default_vibrate_timings: true,
              },
            },
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
