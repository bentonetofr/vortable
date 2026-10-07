// Encontra cada objeto solto numa folha de sprites (árvores, pedras...) e
// grava os retângulos num JSON. Pixels próximos (até GAP px) contam como o
// mesmo objeto, pra sombra e folhas soltas não virarem objetos separados.
//
//   node scripts/extract-sprites.mjs <entrada.png> <saida.json> [gap] [minLado]

import fs from 'node:fs'
import { PNG } from 'pngjs'

const [, , input, output, gapArg = '3', minArg = '12'] = process.argv
if (!input || !output) {
  console.error('uso: node scripts/extract-sprites.mjs <entrada.png> <saida.json> [gap] [minLado]')
  process.exit(1)
}
const GAP = Number(gapArg)
const MIN = Number(minArg)

const png = PNG.sync.read(fs.readFileSync(input))
const { width: w, height: h, data } = png
const solid = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > 8 ? 1 : 0

const seen = new Uint8Array(w * h)
const rects = []
for (let start = 0; start < w * h; start++) {
  if (!solid[start] || seen[start]) continue
  let x0 = w, y0 = h, x1 = 0, y1 = 0
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    const i = stack.pop()
    const x = i % w, y = (i - x) / w
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    for (let dy = -GAP; dy <= GAP; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -GAP; dx <= GAP; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= w) continue
        const j = ny * w + nx
        if (solid[j] && !seen[j]) { seen[j] = 1; stack.push(j) }
      }
    }
  }
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1
  if (rw >= MIN && rh >= MIN) rects.push({ x: x0, y: y0, w: rw, h: rh })
}

// ordem de leitura: linha a linha (com tolerância), da esquerda pra direita
rects.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x))
fs.writeFileSync(output, JSON.stringify(rects.map((r, i) => ({ id: i, ...r })), null, 2))
console.log(`${rects.length} objetos -> ${output}`)
