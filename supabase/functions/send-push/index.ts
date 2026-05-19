import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_EMAIL   = Deno.env.get('VAPID_EMAIL')       ?? 'mailto:admin@sportflow.app'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE)
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: 'VAPID keys not configured' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { subscription, title, body, link, icon } = await req.json()

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, link: link ?? '/', icon: icon ?? '/icon-192.svg' }),
    )

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    // 410 = subscription expired — caller should delete it from DB
    const status = err.statusCode === 410 ? 410 : 500
    return new Response(JSON.stringify({ error: err.message, statusCode: err.statusCode }), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
