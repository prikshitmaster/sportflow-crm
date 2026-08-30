// Runtime checks for the /join funnel's PWA wiring.
//
//   npm run build && npm run preview        # in one terminal
//   node scripts/_test-join-pwa.mjs         # in another
//
// Unlike the other _test-*.mjs scripts here, this one drives a real browser
// rather than the database — the thing being verified is document state that
// only exists once React has mounted.
//
// WHAT IT PROTECTS
// One origin serves two products. vite-plugin-pwa generates a single manifest
// describing the owner CRM ("Khelit", start_url "/"), so installing from
// /join produced an app called Khelit that opened the OWNER LOGIN. The funnel
// swaps the document onto its own manifest while mounted and restores the
// original on unmount. Both halves matter: forget the swap and parents install
// the wrong app; forget the restore and the CRM becomes installable as the
// parent app for the rest of the session.

import { chromium, devices } from '@playwright/test'

const BASE = process.env.PWA_BASE || 'http://localhost:4173'

const results = []
const check = (name, want, got) =>
  results.push({ pass: JSON.stringify(want) === JSON.stringify(got), name, want, got })

// The funnel opens on a login/register gate; the tab bar only exists past it.
async function toAcademyTab(page) {
  await page.goto(`${BASE}/join`, { waitUntil: 'networkidle' })
  await page.getByText(/Skip for now/i).click()
  // Tab-bar tabs are aria-labelled Tappables, not plain text nodes.
  const tab = page.getByRole('button', { name: 'Academy' })
  await tab.waitFor({ state: 'visible', timeout: 20000 })
  await tab.click()
  await page.waitForTimeout(800)
}

const readHead = (page) => page.evaluate(() => ({
  manifest:   document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
  appleIcon:  document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
  appleTitle: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') ?? null,
  theme:      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
}))

const res = await fetch(`${BASE}/join.webmanifest`).catch(() => null)
if (!res?.ok) {
  console.error(`No preview server at ${BASE} — run \`npm run build && npm run preview\` first.`)
  process.exit(2)
}

const browser = await chromium.launch()

// ── The funnel adopts its own identity ──────────────────────────────
const page = await browser.newPage()
await page.goto(`${BASE}/join`, { waitUntil: 'networkidle' })
const onJoin = await readHead(page)
check('/join manifest',     '/join.webmanifest',         onJoin.manifest)
// Safari ignores manifest icons and reads apple-touch-icon, and cannot render
// the SVG index.html points at — without a PNG the iOS home-screen icon is a
// blurred screenshot of the page.
check('/join apple icon',   '/apple-touch-icon.png',     onJoin.appleIcon)
check('/join apple title',  'Ahmedabad Racquet Academy', onJoin.appleTitle)
check('/join theme colour', '#152449',                   onJoin.theme)

const mf = await page.evaluate(async () => {
  const r = await fetch('/join.webmanifest')
  return { status: r.status, body: await r.json() }
})
check('manifest status',  200,                         mf.status)
check('manifest name',    'Ahmedabad Racquet Academy', mf.body.name)
check('manifest start',   '/join',                     mf.body.start_url)
check('manifest scope',   '/join',                     mf.body.scope)
check('manifest display', 'standalone',                mf.body.display)
// Android crops icons to a circle; without a maskable entry it crops the
// square one and clips the crest.
check('maskable icon present', true,
  mf.body.icons.some(i => i.purpose === 'maskable' && i.sizes === '512x512'))

for (const icon of mf.body.icons) {
  const r = await page.evaluate(async (src) => {
    const res = await fetch(src)
    return { status: res.status, type: res.headers.get('content-type') }
  }, icon.src)
  check(`icon ${icon.src}`, { status: 200, type: 'image/png' }, r)
}

// ── …and gives it back on the way out ───────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
const onOwner = await readHead(page)
check('/ manifest restored',    '/manifest.webmanifest', onOwner.manifest)
check('/ apple title restored', 'Khelit',                onOwner.appleTitle)
check('/ theme restored',       '#2563eb',               onOwner.theme)
await page.close()

// ── The install affordance ──────────────────────────────────────────
// Safari fires no beforeinstallprompt and exposes no install API, so this row
// is the ONLY route to installing on iOS. If it stops rendering, iPhone users
// silently get nothing.
const iphone = await browser.newContext({ ...devices['iPhone 13'] })
const p1 = await iphone.newPage()
await toAcademyTab(p1)
const row = p1.getByText(/Install app/).first()
check('iOS: install row visible', true, await row.isVisible().catch(() => false))
await row.click()
await p1.waitForTimeout(500)
check('iOS: sheet explains Share step', true,
  await p1.getByText(/Share button/i).first().isVisible().catch(() => false))
check('iOS: sheet explains Add to Home Screen', true,
  await p1.getByText(/Add to Home Screen/i).first().isVisible().catch(() => false))
await iphone.close()

// A desktop browser fires no beforeinstallprompt and isn't iOS. An "Install
// app" row there would do nothing when tapped, which is worse than none.
const desktop = await browser.newContext()
const p2 = await desktop.newPage()
await toAcademyTab(p2)
check('desktop: no dead install row', 0, await p2.getByText(/Install app/).count())
await desktop.close()

await browser.close()

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS    ' : '*** FAIL'} | ${r.name.padEnd(34)} | want ${JSON.stringify(r.want)}` +
              (r.pass ? '' : `  got ${JSON.stringify(r.got)}`))
}
console.log(`\n${results.length - failed}/${results.length} passing`)
process.exit(failed ? 1 : 0)
