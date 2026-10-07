// Gera o catálogo de objetos do editor a partir das folhas em assets-src/.
//
// Pra cada folha: acha cada objeto solto (pixels encostados, até GAP px),
// calcula o "pé" (onde colide: a linha opaca mais baixa no miolo do
// sprite, pulando a sombra semitransparente) e grava tudo em
// public/assets/catalog/objects.json. As folhas são copiadas pra public/.
//
//   node scripts/build-catalog.mjs

import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
const SRC = path.join(ROOT, 'assets-src')
const OUT = path.join(ROOT, 'public', 'assets')

/** Folhas de objetos: arquivo em assets-src, categoria e nome-base dos itens. */
const SHEETS = [
  { file: 'lpc/trees-green.png',  id: 'trees-green',  category: 'Árvores',            label: 'Árvore' },
  { file: 'lpc/trees-orange.png', id: 'trees-orange', category: 'Árvores de outono',  label: 'Árvore de outono' },
  { file: 'lpc/trees-brown.png',  id: 'trees-brown',  category: 'Árvores marrons',    label: 'Árvore marrom' },
  { file: 'lpc/trees-pale.png',   id: 'trees-pale',   category: 'Árvores pálidas',    label: 'Árvore pálida' },
  { file: 'lpc/trees-dead.png',   id: 'trees-dead',   category: 'Árvores secas',      label: 'Árvore seca' },
]

/** Arquivos copiados como estão (terrenos etc.). */
const COPY = [['lpc/terrain-v7.png', 'lpc/terrain.png']]

const GAP = 1
const MIN = 12
const OPAQUE = 250

function components(png) {
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
  rects.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x))
  return rects
}

/** Pé do objeto: linha opaca mais baixa no miolo; largura = trecho opaco nessa linha. */
function footOf(png, r) {
  if (r.h < 24) return null // mudas, tocos minúsculos: decoração sem colisão
  const { width: w, data } = png
  const cx0 = r.x + Math.floor(r.w * 0.3), cx1 = r.x + Math.ceil(r.w * 0.7)
  for (let y = r.y + r.h - 1; y > r.y + r.h * 0.4; y--) {
    let left = -1, right = -1
    for (let x = cx0; x <= cx1; x++) {
      if (data[(y * w + x) * 4 + 3] >= OPAQUE) { if (left < 0) left = x; right = x }
    }
    if (left >= 0 && right - left >= 3) {
      const fw = Math.max(10, Math.min(48, Math.max(right - left + 1, Math.round(r.w * 0.2))))
      const fh = Math.max(6, Math.min(16, Math.round(r.w * 0.1)))
      const lift = r.y + r.h - 1 - y
      // centro do pé em relação ao centro do sprite (troncos tortos)
      const dx = Math.round((left + right) / 2 - (r.x + r.w / 2))
      return { w: fw, h: fh, lift, dx }
    }
  }
  return null
}

const catalog = { sheets: [], objects: [] }
for (const s of SHEETS) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SRC, s.file)))
  const url = `catalog/${s.id}.png`
  fs.mkdirSync(path.join(OUT, 'catalog'), { recursive: true })
  fs.copyFileSync(path.join(SRC, s.file), path.join(OUT, url))
  catalog.sheets.push({ id: s.id, url })
  components(png).forEach((r, i) => {
    catalog.objects.push({
      // id pela posição na folha: não muda se outros objetos forem detectados diferente
      id: `${s.id}@${r.x},${r.y}`,
      sheet: s.id,
      category: s.category,
      label: `${s.label} ${i + 1}`,
      ...r,
      foot: footOf(png, r),
    })
  })
}
for (const [from, to] of COPY) {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true })
  fs.copyFileSync(path.join(SRC, from), path.join(OUT, to))
}
fs.writeFileSync(path.join(OUT, 'catalog', 'objects.json'), JSON.stringify(catalog))
console.log(`${catalog.objects.length} objetos em ${catalog.sheets.length} folhas`)
