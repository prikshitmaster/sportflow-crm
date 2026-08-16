const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const BRAND = '#1B4332'
const GOLD = '#D4AF37'
const OUT = path.join(__dirname, '..', 'assets')
fs.mkdirSync(OUT, { recursive: true })

function stars(cx, cy, r, count, size) {
  let s = ''
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    s += `<text x="${x}" y="${y}" font-size="${size}" fill="${GOLD}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif">&#9733;</text>`
  }
  return s
}

// Full-bleed icon: brand-green square with a centered circular badge.
const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BRAND}"/>
  <circle cx="512" cy="512" r="430" fill="none" stroke="${GOLD}" stroke-width="14"/>
  <circle cx="512" cy="512" r="330" fill="${BRAND}" stroke="${GOLD}" stroke-width="6"/>
  ${stars(512, 512, 380, 10, 34)}
  <text x="512" y="470" font-size="200" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif">ARA</text>
  <text x="512" y="600" font-size="46" letter-spacing="4" fill="${GOLD}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif">RACQUET ACADEMY</text>
</svg>`

// Adaptive-icon foreground: same badge mark, transparent bg, kept inside the ~66% safe zone.
const foregroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <circle cx="512" cy="512" r="300" fill="none" stroke="${GOLD}" stroke-width="10"/>
  <text x="512" y="480" font-size="170" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif">ARA</text>
  <text x="512" y="590" font-size="38" letter-spacing="3" fill="${GOLD}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif">RACQUET</text>
</svg>`

const backgroundSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BRAND}"/>
</svg>`

const splashSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732">
  <rect width="2732" height="2732" fill="${BRAND}"/>
  <circle cx="1366" cy="1366" r="520" fill="none" stroke="${GOLD}" stroke-width="16"/>
  <text x="1366" y="1320" font-size="260" font-weight="700" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, 'Times New Roman', serif">ARA</text>
  <text x="1366" y="1470" font-size="58" letter-spacing="6" fill="${GOLD}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif">AHMEDABAD RACQUET ACADEMY</text>
</svg>`

async function run() {
  await sharp(Buffer.from(iconSvg)).png().toFile(path.join(OUT, 'icon.png'))
  await sharp(Buffer.from(foregroundSvg)).png().toFile(path.join(OUT, 'icon-foreground.png'))
  await sharp(Buffer.from(backgroundSvg)).png().toFile(path.join(OUT, 'icon-background.png'))
  await sharp(Buffer.from(splashSvg)).png().toFile(path.join(OUT, 'splash.png'))
  console.log('generated', fs.readdirSync(OUT))
}

run().catch(e => { console.error(e); process.exit(1) })
