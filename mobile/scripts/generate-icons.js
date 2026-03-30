/**
 * Generate Memu app icons from the three-circle brand mark.
 * Uses sharp to render SVG → PNG at required dimensions.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Brand colors
const PURPLE = '#667eea';
const WHITE = '#ffffff';
const BLACK = '#000000';

// Three-circle mark SVG generator
// Circles arranged in a triangular pattern — "we" / family / togetherness
function threeCircleMark({ size, circleColor, bgColor, bgOpacity = 1, includeWordmark = false }) {
  const r = size * 0.185; // radius relative to canvas
  const cx = size / 2;
  const cy = size * 0.44; // shift mark slightly above center

  // Triangular arrangement
  const dx = r * 0.59; // horizontal offset from center
  const dy = r * 0.52; // vertical offset for lower circles

  const circles = [
    { x: cx - dx, y: cy + dy },  // lower-left
    { x: cx + dx, y: cy + dy },  // lower-right
    { x: cx, y: cy - dy * 0.8 }, // upper
  ];

  let wordmarkSvg = '';
  if (includeWordmark) {
    const textY = cy + dy + r + size * 0.12;
    const fontSize = size * 0.1;
    const teluguY = textY + fontSize * 0.7;
    const teluguSize = fontSize * 0.4;
    wordmarkSvg = `
      <text x="${cx}" y="${textY}" text-anchor="middle"
            font-family="-apple-system, 'Segoe UI', sans-serif"
            font-size="${fontSize}" font-weight="600" fill="${circleColor}">memu</text>
      <text x="${cx}" y="${teluguY}" text-anchor="middle"
            font-family="sans-serif"
            font-size="${teluguSize}" font-weight="300" fill="${circleColor}" opacity="0.5">మేము</text>`;
  }

  const bg = bgColor
    ? `<rect width="${size}" height="${size}" fill="${bgColor}" opacity="${bgOpacity}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bg}
    ${circles.map(c => `<circle cx="${c.x}" cy="${c.y}" r="${r}" fill="${circleColor}" opacity="0.85"/>`).join('\n    ')}
    ${wordmarkSvg}
  </svg>`;
}

async function generate() {
  // 1. App Icon (iOS) — 1024x1024, no transparency
  const iconSvg = threeCircleMark({ size: 1024, circleColor: WHITE, bgColor: PURPLE });
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'icon.png'));
  console.log('✓ icon.png (1024x1024)');

  // 2. Android Adaptive Icon Foreground — 432x432, transparent bg
  const fgSvg = threeCircleMark({ size: 432, circleColor: WHITE, bgColor: null });
  await sharp(Buffer.from(fgSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-foreground.png'));
  console.log('✓ android-icon-foreground.png (432x432)');

  // 3. Android Adaptive Icon Background — 432x432, solid purple
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="432">
    <rect width="432" height="432" fill="${PURPLE}"/>
  </svg>`;
  await sharp(Buffer.from(bgSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-background.png'));
  console.log('✓ android-icon-background.png (432x432)');

  // 4. Android Monochrome Icon — 432x432, black circles, transparent bg
  const monoSvg = threeCircleMark({ size: 432, circleColor: BLACK, bgColor: null });
  await sharp(Buffer.from(monoSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'android-icon-monochrome.png'));
  console.log('✓ android-icon-monochrome.png (432x432)');

  // 5. Splash Icon — 600x600, mark + wordmark, transparent (Expo adds bg color)
  const splashSvg = threeCircleMark({ size: 600, circleColor: WHITE, bgColor: null, includeWordmark: true });
  await sharp(Buffer.from(splashSvg))
    .png()
    .toFile(path.join(ASSETS_DIR, 'splash-icon.png'));
  console.log('✓ splash-icon.png (600x600)');

  // 6. Favicon — 48x48 (sharp can't render well at 32, so render at 48 and resize)
  const faviconSvg = threeCircleMark({ size: 192, circleColor: WHITE, bgColor: PURPLE });
  await sharp(Buffer.from(faviconSvg))
    .resize(48, 48)
    .png()
    .toFile(path.join(ASSETS_DIR, 'favicon.png'));
  console.log('✓ favicon.png (48x48)');

  console.log('\nAll assets generated in', ASSETS_DIR);
}

generate().catch(console.error);
