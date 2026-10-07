// Gera o catálogo de objetos do editor a partir das folhas em assets-src/.
//
// Pra cada folha: acha cada objeto solto (pixels encostados, até GAP px),
// copia SÓ os pixels dele pra uma folha nova (sem pedaços dos vizinhos que
// caem no mesmo retângulo), calcula o "pé" (onde colide: a linha opaca mais
// baixa no miolo do sprite, pulando a sombra semitransparente) e grava tudo
// em public/assets/catalog/objects.json.
//
//   node scripts/build-catalog.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
const COPY = [
  ['lpc/terrain-v7.png', 'lpc/terrain.png'],
  // texturas de interior: os pisos/paredes são gerados no navegador (BootScene)
  ['lpc/interior/inside.png', 'lpc/interior/inside.png'],
  ['lpc/interior/castlefloors.png', 'lpc/interior/castlefloors.png'],
  ['lpc/interior/house.png', 'lpc/interior/house.png'],
]

const GAP = 1
const MIN = 12
const OPAQUE = 250
/** Largura da folha gerada; 1px de folga entre objetos. */
const ATLAS_W = 1024
const PAD = 1

/** Componentes ligados: retângulo de cada um + rótulo de cada pixel (0 = nenhum). */
function components(png) {
  const { width: w, height: h, data } = png
  const solid = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) solid[i] = data[i * 4 + 3] > 8 ? 1 : 0
  const label = new Int32Array(w * h)
  const comps = []
  for (let start = 0; start < w * h; start++) {
    if (!solid[start] || label[start]) continue
    const id = comps.length + 1
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    const stack = [start]
    label[start] = id
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
          if (solid[j] && !label[j]) { label[j] = id; stack.push(j) }
        }
      }
    }
    comps.push({ id, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
  }
  const kept = comps.filter((c) => c.w >= MIN && c.h >= MIN)
  kept.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x))
  return { kept, label }
}

/** Pé do objeto: linha opaca mais baixa no miolo; largura = trecho opaco nessa linha. */
function footOf(px, w, h) {
  if (h < 24) return null // mudas, tocos minúsculos: decoração sem colisão
  const cx0 = Math.floor(w * 0.3), cx1 = Math.min(w - 1, Math.ceil(w * 0.7))
  for (let y = h - 1; y > h * 0.4; y--) {
    let left = -1, right = -1
    for (let x = cx0; x <= cx1; x++) {
      if (px[(y * w + x) * 4 + 3] >= OPAQUE) { if (left < 0) left = x; right = x }
    }
    if (left >= 0 && right - left >= 3) {
      const fw = Math.max(10, Math.min(48, Math.max(right - left + 1, Math.round(w * 0.2))))
      const fh = Math.max(6, Math.min(16, Math.round(w * 0.1)))
      // centro do pé em relação ao centro do sprite (troncos tortos)
      const dx = Math.round((left + right) / 2 - w / 2)
      return { w: fw, h: fh, lift: h - 1 - y, dx }
    }
  }
  return null
}

fs.mkdirSync(path.join(OUT, 'catalog'), { recursive: true })
const catalog = { sheets: [], objects: [] }

for (const s of SHEETS) {
  const src = PNG.sync.read(fs.readFileSync(path.join(SRC, s.file)))
  const { kept, label } = components(src)

  // empacota em prateleiras (linhas), na ordem de leitura
  let cx = 0, cy = 0, rowH = 0
  const placed = kept.map((c) => {
    if (cx + c.w > ATLAS_W) { cx = 0; cy += rowH + PAD; rowH = 0 }
    const at = { ax: cx, ay: cy }
    cx += c.w + PAD
    rowH = Math.max(rowH, c.h)
    return { ...c, ...at }
  })
  const atlas = new PNG({ width: ATLAS_W, height: cy + rowH })

  placed.forEach((c, i) => {
    // só os pixels deste objeto (o rótulo dele), nunca os do vizinho
    const own = Buffer.alloc(c.w * c.h * 4)
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const si = (c.y + y) * src.width + (c.x + x)
        if (label[si] !== c.id) continue
        const oi = (y * c.w + x) * 4
        src.data.copy(own, oi, si * 4, si * 4 + 4)
        own.copy(atlas.data, ((c.ay + y) * ATLAS_W + c.ax + x) * 4, oi, oi + 4)
      }
    }
    catalog.objects.push({
      // id pela posição na folha ORIGINAL: estável mesmo se a folha gerada mudar
      id: `${s.id}@${c.x},${c.y}`,
      sheet: s.id,
      category: s.category,
      label: `${s.label} ${i + 1}`,
      x: c.ax,
      y: c.ay,
      w: c.w,
      h: c.h,
      foot: footOf(own, c.w, c.h),
    })
  })

  const url = `catalog/${s.id}.png`
  fs.writeFileSync(path.join(OUT, url), PNG.sync.write(atlas))
  catalog.sheets.push({ id: s.id, url })
}

for (const [from, to] of COPY) {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true })
  fs.copyFileSync(path.join(SRC, from), path.join(OUT, to))
}
fs.writeFileSync(path.join(OUT, 'catalog', 'objects.json'), JSON.stringify(catalog))
console.log(`${catalog.objects.length} objetos em ${catalog.sheets.length} folhas`)
