import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const iconDir = path.join(__dirname, 'src-tauri', 'icons')

// Ensure icons directory exists
if (!fs.existsSync(iconDir)) {
  fs.mkdirSync(iconDir, { recursive: true })
}

// Generate a simple SVG-based icon (blue square with rounded corners)
const baseSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1f6feb;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#26a641;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#grad)" rx="100"/>
  <text x="256" y="320" font-size="180" font-weight="bold" fill="white" text-anchor="middle" font-family="system-ui">≠</text>
</svg>`

const sizes = [
  { size: 32, name: '32x32.png' },
  { size: 128, name: '128x128.png' },
  { size: 256, name: '128x128@2x.png' },
]

async function generateIcons() {
  console.log('🎨 Generating application icons...')

  for (const { size, name } of sizes) {
    try {
      await sharp(Buffer.from(baseSvg))
        .resize(size, size, { fit: 'fill', position: 'center' })
        .png()
        .toFile(path.join(iconDir, name))
      console.log(`  ✓ Generated ${name}`)
    } catch (err) {
      console.error(`  ✗ Failed to generate ${name}:`, err.message)
      process.exit(1)
    }
  }

  // Generate ICO for Windows
  try {
    await sharp(Buffer.from(baseSvg))
      .resize(256, 256, { fit: 'fill', position: 'center' })
      .toFile(path.join(iconDir, 'icon.ico'))
    console.log(`  ✓ Generated icon.ico`)
  } catch (err) {
    console.error(`  ✗ Failed to generate icon.ico:`, err.message)
  }

  // Generate ICNS for macOS
  try {
    await sharp(Buffer.from(baseSvg))
      .resize(512, 512, { fit: 'fill', position: 'center' })
      .toFile(path.join(iconDir, 'icon.icns'))
    console.log(`  ✓ Generated icon.icns`)
  } catch (err) {
    console.error(`  ✗ Failed to generate icon.icns:`, err.message)
  }

  console.log('✅ Icon generation complete!')
}

generateIcons().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
