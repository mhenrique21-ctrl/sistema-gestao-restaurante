import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const makeSvg = (size, rounded = true) => {
  const s = size;
  const rx = rounded ? Math.round(s * 0.18) : 0;
  // Use a wider viewBox to avoid clipping, then let sharp crop
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="stm1" x1="0.3" y1="1" x2="0.7" y2="0">
      <stop offset="0%" stop-color="#C07A50"/>
      <stop offset="50%" stop-color="#B8876A"/>
      <stop offset="100%" stop-color="#D4A88A"/>
    </linearGradient>
    <linearGradient id="stm2" x1="0.4" y1="1" x2="0.6" y2="0">
      <stop offset="0%" stop-color="#A56840"/>
      <stop offset="100%" stop-color="#C9907A"/>
    </linearGradient>
  </defs>
  <rect width="200" height="200" rx="${Math.round(rx * 200/s)}" fill="#FFFFFF"/>
  <g>
    <!-- Vapor S -->
    <path d="M 118,10 C 108,2 104,9 106,17 C 110,30 126,28 128,42 C 130,52 118,56 114,47"
          fill="none" stroke="url(#stm1)" stroke-width="8" stroke-linecap="round" opacity="0.9"/>
    <path d="M 127,7 C 119,1 115,6 117,13 C 120,24 134,22 136,34 C 138,43 126,47 123,39"
          fill="none" stroke="url(#stm2)" stroke-width="5" stroke-linecap="round" opacity="0.75"/>
    <!-- CONFRARIA -->
    <text x="100" y="78" text-anchor="middle"
          font-family="'Arial','Helvetica',sans-serif"
          font-size="17" font-weight="800" fill="#A0603A"
          letter-spacing="3">CONFRARIA</text>
    <!-- CAFE -->
    <text x="100" y="175" text-anchor="middle"
          font-family="'Arial Black','Impact',sans-serif"
          font-size="65" font-weight="900" fill="#A0603A"
          letter-spacing="4">CAFÉ</text>
  </g>
</svg>`;
};

async function generate() {
  const outDir = path.join(process.cwd(), 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  for (const size of [192, 512]) {
    await sharp(Buffer.from(makeSvg(size, true))).resize(size, size).png().toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`✅ icon-${size}.png`);
  }
  await sharp(Buffer.from(makeSvg(180, false))).resize(180, 180).png().toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('✅ apple-touch-icon.png');
  await sharp(Buffer.from(makeSvg(64, true))).resize(32, 32).png().toFile(path.join(outDir, 'favicon-32.png'));
  console.log('✅ favicon-32.png');

  const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="stm1" x1="0.3" y1="1" x2="0.7" y2="0">
        <stop offset="0%" stop-color="#C07A50"/><stop offset="50%" stop-color="#B8876A"/><stop offset="100%" stop-color="#D4A88A"/>
      </linearGradient>
      <linearGradient id="stm2" x1="0.4" y1="1" x2="0.6" y2="0">
        <stop offset="0%" stop-color="#A56840"/><stop offset="100%" stop-color="#C9907A"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="#FFFFFF"/>
    <g transform="translate(250,20) scale(3)">
      <path d="M 118,10 C 108,2 104,9 106,17 C 110,30 126,28 128,42 C 130,52 118,56 114,47"
            fill="none" stroke="url(#stm1)" stroke-width="8" stroke-linecap="round" opacity="0.9"/>
      <path d="M 127,7 C 119,1 115,6 117,13 C 120,24 134,22 136,34 C 138,43 126,47 123,39"
            fill="none" stroke="url(#stm2)" stroke-width="5" stroke-linecap="round" opacity="0.75"/>
      <text x="100" y="78" text-anchor="middle" font-family="'Arial','Helvetica',sans-serif" font-size="17" font-weight="800" fill="#A0603A" letter-spacing="3">CONFRARIA</text>
      <text x="100" y="175" text-anchor="middle" font-family="'Arial Black','Impact',sans-serif" font-size="65" font-weight="900" fill="#A0603A" letter-spacing="4">CAFÉ</text>
    </g>
  </svg>`;
  await sharp(Buffer.from(ogSvg)).png().toFile(path.join(outDir, 'og-image.png'));
  console.log('✅ og-image.png');
  console.log('\n🎉 Pronto!');
}

generate().catch(console.error);
