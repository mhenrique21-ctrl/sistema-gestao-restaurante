import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -5 350 200">
  <path d="M158,12 C148,4 162,-2 165,8 C168,18 154,22 152,32 C150,42 162,46 164,36"
        fill="none" stroke="#C4713A" stroke-width="7" stroke-linecap="round"/>
  <path d="M148,8 C140,2 152,-3 154,6 C156,15 144,18 142,27 C140,36 150,40 152,30"
        fill="none" stroke="#D4936A" stroke-width="4" stroke-linecap="round"/>
  <text x="18" y="72"
        font-family="'Arial','Helvetica',sans-serif"
        font-size="19" font-weight="700" fill="#7B2E10"
        letter-spacing="5">CONFRARIA</text>
  <text x="10" y="175"
        font-family="'Arial Black','Impact','Arial',sans-serif"
        font-size="118" font-weight="900" fill="#7B2E10">CAFE</text>
  <rect x="10" y="178" width="22" height="8" rx="3" fill="#7B2E10"/>
  <rect x="155" y="178" width="35" height="8" rx="3" fill="#7B2E10"/>
</svg>`;

const makeIcon = (size, rounded = true) => {
  const rx = rounded ? Math.round(size * 0.18) : 0;
  const pad = Math.round(size * 0.06);
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="#FFFFFF"/>
  <g transform="translate(${pad},${pad + Math.round(inner * 0.08)}) scale(${(inner / 200).toFixed(4)})">
    <path d="M158,12 C148,4 162,-2 165,8 C168,18 154,22 152,32 C150,42 162,46 164,36"
          fill="none" stroke="#C4713A" stroke-width="7" stroke-linecap="round"/>
    <path d="M148,8 C140,2 152,-3 154,6 C156,15 144,18 142,27 C140,36 150,40 152,30"
          fill="none" stroke="#D4936A" stroke-width="4" stroke-linecap="round"/>
    <text x="18" y="72"
          font-family="'Arial','Helvetica',sans-serif"
          font-size="19" font-weight="700" fill="#7B2E10"
          letter-spacing="5">CONFRARIA</text>
    <text x="10" y="175"
          font-family="'Arial Black','Impact','Arial',sans-serif"
          font-size="118" font-weight="900" fill="#7B2E10">CAFE</text>
    <rect x="10" y="178" width="22" height="8" rx="3" fill="#7B2E10"/>
    <rect x="155" y="178" width="35" height="8" rx="3" fill="#7B2E10"/>
  </g>
</svg>`;
};

async function generate() {
  const outDir = path.join(process.cwd(), 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  // First render the logo SVG at high resolution to see its natural bounds
  const logoBuf = Buffer.from(logoSvg);
  const logoWide = await sharp(logoBuf, { density: 300 })
    .png()
    .toBuffer();
  const logoMeta = await sharp(logoWide).metadata();
  console.log(`Logo natural size: ${logoMeta.width}x${logoMeta.height}`);

  // Generate square icons with padding
  for (const size of [192, 512]) {
    // Render logo at high res then composite on white square
    const rendered = await sharp(logoBuf, { density: 300 })
      .resize({ width: Math.round(size * 0.88), height: Math.round(size * 0.88), fit: 'inside' })
      .png()
      .toBuffer();
    const renderedMeta = await sharp(rendered).metadata();

    const rx = Math.round(size * 0.18);
    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" rx="${rx}" fill="#FFFFFF"/>
    </svg>`;

    await sharp(Buffer.from(bgSvg))
      .composite([{
        input: rendered,
        left: Math.round((size - renderedMeta.width) / 2),
        top: Math.round((size - renderedMeta.height) / 2),
      }])
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`✅ icon-${size}.png`);
  }

  // Apple touch icon (no rounded corners)
  {
    const size = 180;
    const rendered = await sharp(logoBuf, { density: 300 })
      .resize({ width: Math.round(size * 0.85), height: Math.round(size * 0.85), fit: 'inside' })
      .png()
      .toBuffer();
    const renderedMeta = await sharp(rendered).metadata();

    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="#FFFFFF"/>
    </svg>`;

    await sharp(Buffer.from(bgSvg))
      .composite([{
        input: rendered,
        left: Math.round((size - renderedMeta.width) / 2),
        top: Math.round((size - renderedMeta.height) / 2),
      }])
      .png()
      .toFile(path.join(outDir, 'apple-touch-icon.png'));
    console.log('✅ apple-touch-icon.png');
  }

  // Favicon 32x32
  {
    const rendered = await sharp(logoBuf, { density: 300 })
      .resize({ width: 28, height: 28, fit: 'inside' })
      .png()
      .toBuffer();
    const renderedMeta = await sharp(rendered).metadata();

    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
      <rect width="32" height="32" rx="4" fill="#FFFFFF"/>
    </svg>`;

    await sharp(Buffer.from(bgSvg))
      .composite([{
        input: rendered,
        left: Math.round((32 - renderedMeta.width) / 2),
        top: Math.round((32 - renderedMeta.height) / 2),
      }])
      .png()
      .toFile(path.join(outDir, 'favicon-32.png'));
    console.log('✅ favicon-32.png');
  }

  // OG Image 1200x630
  {
    const rendered = await sharp(logoBuf, { density: 300 })
      .resize({ width: 800, height: 500, fit: 'inside' })
      .png()
      .toBuffer();
    const renderedMeta = await sharp(rendered).metadata();

    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <rect width="1200" height="630" fill="#FFFFFF"/>
    </svg>`;

    await sharp(Buffer.from(bgSvg))
      .composite([{
        input: rendered,
        left: Math.round((1200 - renderedMeta.width) / 2),
        top: Math.round((630 - renderedMeta.height) / 2),
      }])
      .png()
      .toFile(path.join(outDir, 'og-image.png'));
    console.log('✅ og-image.png');
  }

  console.log('\n🎉 Pronto!');
}

generate().catch(console.error);
