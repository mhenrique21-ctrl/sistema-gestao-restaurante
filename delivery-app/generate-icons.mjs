import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('./public/icons/icon.svg', 'utf-8')
mkdirSync('./public/icons', { recursive: true })

for (const size of [192, 512]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  const png = resvg.render().asPng()
  writeFileSync(`./public/icons/icon-${size}.png`, png)
  console.log(`✅ icon-${size}.png gerado`)
}
