import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// Confraria Cafe logo SVG — coffee cup silhouette with steam
// Brown/copper color scheme matching the brand
const makeSvg = (size) => {
  const s = size;
  const pad = Math.round(s * 0.12);
  const inner = s - pad * 2;
  // Scale factor from reference 512
  const sc = inner / 400;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a0f08"/>
      <stop offset="100%" stop-color="#0e0805"/>
    </linearGradient>
    <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c07a50"/>
      <stop offset="100%" stop-color="#8b5a3a"/>
    </linearGradient>
    <linearGradient id="steam1" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#c07a50"/>
      <stop offset="100%" stop-color="#d4956a"/>
    </linearGradient>
  </defs>
  <!-- Background with rounded corners -->
  <rect width="${s}" height="${s}" rx="${Math.round(s * 0.18)}" fill="url(#bg)"/>

  <g transform="translate(${pad}, ${pad}) scale(${sc})">
    <!-- Coffee cup body -->
    <path d="M 90 195
             Q 90 330, 200 340
             Q 310 330, 310 195
             L 310 185
             L 90 185 Z"
          fill="url(#cup)" opacity="0.95"/>

    <!-- Cup rim -->
    <rect x="70" y="170" width="260" height="28" rx="14" fill="#c07a50"/>

    <!-- Cup handle -->
    <path d="M 310 200
             Q 365 200, 365 245
             Q 365 290, 310 290"
          fill="none" stroke="#c07a50" stroke-width="18" stroke-linecap="round"/>

    <!-- Saucer -->
    <ellipse cx="200" cy="355" rx="150" ry="22" fill="#8b5a3a" opacity="0.7"/>

    <!-- Steam lines -->
    <path d="M 150 155 Q 135 120, 150 85 Q 165 50, 150 20"
          fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    <path d="M 200 145 Q 185 105, 200 70 Q 215 35, 200 5"
          fill="none" stroke="url(#steam1)" stroke-width="12" stroke-linecap="round" opacity="0.8"/>
    <path d="M 250 155 Q 235 120, 250 85 Q 265 50, 250 20"
          fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>

    <!-- Text "CONFRARIA" -->
    <text x="200" y="260" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="800"
          font-size="38" fill="#f5e6d8" letter-spacing="4" opacity="0.95">CONFRARIA</text>

    <!-- Text "CAFÉ" -->
    <text x="200" y="310" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="900"
          font-size="52" fill="#f5e6d8" letter-spacing="6" opacity="0.95">CAFÉ</text>
  </g>
</svg>`;
};

// Apple touch icon — no rounded corners (iOS adds them)
const makeAppleSvg = (size) => {
  const s = size;
  const pad = Math.round(s * 0.10);
  const inner = s - pad * 2;
  const sc = inner / 400;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a0f08"/>
      <stop offset="100%" stop-color="#0e0805"/>
    </linearGradient>
    <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c07a50"/>
      <stop offset="100%" stop-color="#8b5a3a"/>
    </linearGradient>
    <linearGradient id="steam1" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#c07a50"/>
      <stop offset="100%" stop-color="#d4956a"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" fill="url(#bg)"/>

  <g transform="translate(${pad}, ${pad}) scale(${sc})">
    <path d="M 90 195 Q 90 330, 200 340 Q 310 330, 310 195 L 310 185 L 90 185 Z"
          fill="url(#cup)" opacity="0.95"/>
    <rect x="70" y="170" width="260" height="28" rx="14" fill="#c07a50"/>
    <path d="M 310 200 Q 365 200, 365 245 Q 365 290, 310 290"
          fill="none" stroke="#c07a50" stroke-width="18" stroke-linecap="round"/>
    <ellipse cx="200" cy="355" rx="150" ry="22" fill="#8b5a3a" opacity="0.7"/>
    <path d="M 150 155 Q 135 120, 150 85 Q 165 50, 150 20"
          fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    <path d="M 200 145 Q 185 105, 200 70 Q 215 35, 200 5"
          fill="none" stroke="url(#steam1)" stroke-width="12" stroke-linecap="round" opacity="0.8"/>
    <path d="M 250 155 Q 235 120, 250 85 Q 265 50, 250 20"
          fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    <text x="200" y="260" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="800"
          font-size="38" fill="#f5e6d8" letter-spacing="4" opacity="0.95">CONFRARIA</text>
    <text x="200" y="310" text-anchor="middle"
          font-family="Arial, Helvetica, sans-serif" font-weight="900"
          font-size="52" fill="#f5e6d8" letter-spacing="6" opacity="0.95">CAFÉ</text>
  </g>
</svg>`;
};

async function generate() {
  const outDir = path.join(process.cwd(), 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  // PWA icons (with rounded corners built into SVG)
  for (const size of [192, 512]) {
    const svg = Buffer.from(makeSvg(size));
    await sharp(svg).png().toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`✅ icon-${size}.png`);
  }

  // Apple touch icon 180x180 (no rounded corners — iOS masks automatically)
  const appleSvg = Buffer.from(makeAppleSvg(180));
  await sharp(appleSvg).png().toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('✅ apple-touch-icon.png');

  // Favicon 32x32
  const favSvg = Buffer.from(makeSvg(32));
  await sharp(favSvg).png().toFile(path.join(outDir, 'favicon-32.png'));
  console.log('✅ favicon-32.png');

  // OG image for sharing (wider format)
  const ogSize = 1200;
  const ogHeight = 630;
  const ogSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ogSize}" height="${ogHeight}" viewBox="0 0 ${ogSize} ${ogHeight}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1a0f08"/>
        <stop offset="100%" stop-color="#0e0805"/>
      </linearGradient>
      <linearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c07a50"/>
        <stop offset="100%" stop-color="#8b5a3a"/>
      </linearGradient>
      <linearGradient id="steam1" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#c07a50"/>
        <stop offset="100%" stop-color="#d4956a"/>
      </linearGradient>
    </defs>
    <rect width="${ogSize}" height="${ogHeight}" fill="url(#bg)"/>
    <g transform="translate(150, 50) scale(1.2)">
      <path d="M 90 195 Q 90 330, 200 340 Q 310 330, 310 195 L 310 185 L 90 185 Z" fill="url(#cup)" opacity="0.95"/>
      <rect x="70" y="170" width="260" height="28" rx="14" fill="#c07a50"/>
      <path d="M 310 200 Q 365 200, 365 245 Q 365 290, 310 290" fill="none" stroke="#c07a50" stroke-width="18" stroke-linecap="round"/>
      <ellipse cx="200" cy="355" rx="150" ry="22" fill="#8b5a3a" opacity="0.7"/>
      <path d="M 150 155 Q 135 120, 150 85 Q 165 50, 150 20" fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
      <path d="M 200 145 Q 185 105, 200 70 Q 215 35, 200 5" fill="none" stroke="url(#steam1)" stroke-width="12" stroke-linecap="round" opacity="0.8"/>
      <path d="M 250 155 Q 235 120, 250 85 Q 265 50, 250 20" fill="none" stroke="url(#steam1)" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
    </g>
    <text x="700" y="250" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="72" fill="#c07a50" letter-spacing="6">CONFRARIA</text>
    <text x="700" y="360" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="96" fill="#f5e6d8" letter-spacing="8">CAFÉ</text>
    <text x="700" y="430" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="400" font-size="28" fill="#8b7a6a" letter-spacing="4">SISTEMA DE GESTÃO</text>
  </svg>`);
  await sharp(ogSvg).png().toFile(path.join(outDir, 'og-image.png'));
  console.log('✅ og-image.png (1200x630)');

  console.log('\n🎉 Todos os ícones gerados!');
}

generate().catch(console.error);
