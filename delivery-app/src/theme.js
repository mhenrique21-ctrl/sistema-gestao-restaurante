function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      default: h = (r - g) / d + 4
    }
    h /= 6
  }
  return [h * 360, s * 100, l * 100]
}

// Reescreve as variáveis de cor "violet" do Tailwind com a cor de marca da loja,
// já que todas as classes bg-violet-*/text-violet-*/border-violet-* leem essas variáveis.
export function applyThemeColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return
  const [h, s] = hexToHsl(hex)
  const shade = (l) => `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l}%)`
  const css = `:root {
    --color-violet-50: ${shade(97)};
    --color-violet-100: ${shade(93)};
    --color-violet-200: ${shade(85)};
    --color-violet-400: ${shade(65)};
    --color-violet-500: ${shade(55)};
    --color-violet-600: ${shade(45)};
    --color-violet-700: ${shade(38)};
  }`
  let styleEl = document.getElementById('theme-override')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'theme-override'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = css
}
