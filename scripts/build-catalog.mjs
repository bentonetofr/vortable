// Gera o catálogo de objetos do editor a partir dos pacotes de arte em
// assets-src/packs/<pacote>/. Cada pacote tem um pack.json (manifesto):
//
//   {
//     "name": "...", "license": "...", "source": "https://...",
//     "sheets": [ { folha }, ... ],
//     "objects": { "<id>": { ajustes de curadoria }, ... }
//   }
//
// Folha: { id, file, category, label, kind?, tags?, collision?, mode?, ... }
//   collision "foot" (padrão: o pé de árvores e postes), "base" (a faixa de
//                 baixo: móveis, barris, pedras) ou "none"
//   mode "auto"   (padrão) acha cada objeto solto (pixels encostados) e copia
//                 SÓ os pixels dele (sem pedaços dos vizinhos)
//   mode "strip"  cada linha de quadros (frame: {w,h}) vira UM objeto animado
//                 (fps); quadros vazios no fim da linha são ignorados
//   mode "pieces" retângulos escritos à mão (pieces: [{x,y,w,h}]), cortados no opaco
//   mode "grid"   cada célula (cell: {w,h}, padrão 32×32) com algo vira uma peça
//                 (trim: true corta cada uma no que é opaco)
// Extras de qualquer folha:
//   crop: {x,y,w,h}        usa só um pedaço da imagem (ex.: um tom de cor)
//   ignoreColor: "#rrggbb" cor que marca "vazio" na folha (vira transparente)
//   exclude: [{x,y,w,h}]   áreas ignoradas (arte fora do tema)
//   anims: [{x,y,w,h,frames,fps,dx?,dy?,...}]  animações dentro da folha (quadros lado a lado)
//   pieces (numa folha automática): retângulos à mão pra peças que se encostam
//   regions: [{x,y,w,h,...}] ajustes pra todas as peças cujo centro cai na área
//                 (label vira "label 1", "label 2"...; hidden esconde a área toda)
//   variantOf/variant: a folha é outra versão (cor/estado) de outra folha; as
//                 peças na mesma posição viram variantes da mesma peça
//   peças (mode "pieces") com o mesmo group/variant também viram variantes
//
// Ajuste de curadoria (objects[id]): label, category, tags, kind, solids,
// sort, light, fps, hidden. O que não for ajustado sai automático.
//
// Terrenos (manifest.terrains), viram catalog/terrains.json:
//   { type: 'block', file, id, label, category, x?, y? }   bloco LPC 3×6/3×7
//   { type: 'gen', file, idPrefix, items: [{x,y,size,label,category}] }
//                 pisos montados no navegador de uma textura de 32 ou 64px
//   { type: 'wang', file, tsx, set, idPrefix, labels|labelPrefix, category|categories,
//     solid?, layer? }   autotile de cantos do Tiled (paredes, molduras, tapetes)
//   { type: 'fence', file, tsx, idPrefix, labels, category }
//                 cercas (wangsets de borda do Tiled), camada de tiles
//
//   node scripts/build-catalog.mjs              tudo
//   node scripts/build-catalog.mjs --pack nome  só um pacote (curadoria)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets-src')
const PACKS = path.join(SRC, 'packs')
const OUT = path.join(ROOT, 'public', 'assets')
const CATALOG = path.join(OUT, 'catalog', 'objects.json')
const TERRAIN_CATALOG = path.join(OUT, 'catalog', 'terrains.json')

/** Arquivos copiados como estão (terrenos etc.). */
const COPY = [
  ['lpc/terrain-v7.png', 'lpc/terrain.png'],
  // texturas de interior: os pisos/paredes são gerados no navegador (BootScene)
  ['lpc/interior/inside.png', 'lpc/interior/inside.png'],
  ['lpc/interior/castlefloors.png', 'lpc/interior/castlefloors.png'],
  ['lpc/interior/house.png', 'lpc/interior/house.png'],
]

const KINDS = ['stand', 'floor', 'wall', 'over']
const GAP = 1
const MIN = 12
const OPAQUE = 250
/** Largura da folha gerada; 1px de folga entre peças. */
const ATLAS_W = 1024
const ATLAS_MAX_H = 2048
const PAD = 1

const only = process.argv.includes('--pack') ? process.argv[process.argv.indexOf('--pack') + 1] : null

// ── Leitura de imagem ───────────────────────────────────

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
  // migalhas fora; peças finas e altas (poste, lampião) ficam
  const kept = comps.filter((c) => (c.w >= MIN && c.h >= MIN) || Math.max(c.w, c.h) >= MIN * 2)
  kept.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x))
  return { kept, label }
}

/** Retângulo opaco de um trecho da imagem (null = vazio). */
function opaqueBox(png, x, y, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (png.data[(yy * png.width + xx) * 4 + 3] <= 8) continue
      if (xx < x0) x0 = xx
      if (xx > x1) x1 = xx
      if (yy < y0) y0 = yy
      if (yy > y1) y1 = yy
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * Pé automático: linha opaca mais baixa no miolo do sprite (pulando a
 * sombra semitransparente). Devolve o retângulo que colide, relativo à
 * base-centro, e a linha de profundidade (quantos px acima da base).
 */
function autoFoot(png, r, mask) {
  const { w, h } = r
  if (h < 24) return null // mudas, tocos minúsculos: decoração sem colisão
  const alpha = (x, y) => {
    const si = (r.y + y) * png.width + r.x + x
    return mask && mask(si) ? 0 : png.data[si * 4 + 3]
  }
  const cx0 = Math.floor(w * 0.3), cx1 = Math.min(w - 1, Math.ceil(w * 0.7))
  for (let y = h - 1; y > h * 0.4; y--) {
    let left = -1, right = -1
    for (let x = cx0; x <= cx1; x++) {
      if (alpha(x, y) >= OPAQUE) { if (left < 0) left = x; right = x }
    }
    if (left >= 0 && right - left >= 3) {
      const fw = Math.max(10, Math.min(48, Math.max(right - left + 1, Math.round(w * 0.2))))
      const fh = Math.max(6, Math.min(16, Math.round(w * 0.1)))
      // centro do pé em relação ao centro do sprite (troncos tortos)
      const dx = Math.round((left + right) / 2 - w / 2)
      const lift = h - 1 - y
      return { solid: { x: dx - Math.round(fw / 2), y: -lift - fh, w: fw, h: fh }, sort: lift }
    }
  }
  return null
}

/**
 * Base automática (móveis, barris, pedras): a faixa de baixo da peça, na
 * largura do que é opaco ali. A linha de profundidade fica no meio da faixa.
 */
function autoBase(png, r, mask) {
  const alpha = (x, y) => {
    const si = (r.y + y) * png.width + r.x + x
    return mask && mask(si) ? 0 : png.data[si * 4 + 3]
  }
  // última linha "cheia" (ignora sombra e pés finos)
  let bottom = -1
  for (let y = r.h - 1; y >= 0 && bottom < 0; y--) {
    let n = 0
    for (let x = 0; x < r.w; x++) if (alpha(x, y) >= OPAQUE) n++
    if (n >= r.w * 0.3) bottom = y
  }
  if (bottom < 0 || r.h < 10) return null
  const depth = Math.max(6, Math.min(20, Math.round(r.h * 0.3)))
  let left = r.w, right = -1
  for (let y = Math.max(0, bottom - depth + 1); y <= bottom; y++)
    for (let x = 0; x < r.w; x++) if (alpha(x, y) >= OPAQUE) { if (x < left) left = x; if (x > right) right = x }
  if (right < 0) return null
  const lift = r.h - 1 - bottom
  // 1px de folga de cada lado: dá pra encostar sem parecer que bateu no ar
  const w = Math.max(4, right - left + 1 - 2)
  return { solid: { x: left + 1 - Math.round(r.w / 2), y: -lift - depth, w, h: depth }, sort: lift + Math.round(depth / 2) }
}

function cropPng(png, r) {
  const out = new PNG({ width: r.w, height: r.h })
  PNG.bitblt(png, out, r.x, r.y, r.w, r.h, 0, 0)
  return out
}

function clearRect(png, r) {
  for (let y = Math.max(0, r.y); y < Math.min(png.height, r.y + r.h); y++)
    for (let x = Math.max(0, r.x); x < Math.min(png.width, r.x + r.w); x++) png.data[(y * png.width + x) * 4 + 3] = 0
}

function clearColor(png, hex) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
  const d = png.data
  for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0
}

/** Uma animação (quadros lado a lado), recortada na união do que é opaco. */
function animPiece(sheet, png, a) {
  const dx = a.dx ?? (a.dy ? 0 : a.w), dy = a.dy ?? 0
  const boxes = []
  for (let i = 0; i < a.frames; i++) {
    const box = opaqueBox(png, a.x + i * dx, a.y + i * dy, a.w, a.h)
    if (box) boxes.push({ ox: a.x + i * dx, oy: a.y + i * dy, box })
  }
  if (!boxes.length) return null
  const top = Math.min(...boxes.map((b) => b.box.y - b.oy)), bottom = Math.max(...boxes.map((b) => b.box.y - b.oy + b.box.h))
  const left = Math.min(...boxes.map((b) => b.box.x - b.ox)), right = Math.max(...boxes.map((b) => b.box.x - b.ox + b.box.w))
  const { x: _x, y: _y, w: _w, h: _h, frames: _f, dx: _d, dy: _e, ...meta } = a
  return {
    id: `${sheet.id}@${a.x},${a.y}`,
    src: boxes.map((b) => ({ x: b.ox + left, y: b.oy + top, w: right - left, h: bottom - top })),
    meta,
  }
}

// ── Pacote → peças ──────────────────────────────────────

/**
 * Peças de uma folha. Cada peça: { id, src: [{x,y,w,h}] (quadros),
 * mask?(índice do pixel) → true se o pixel é de outra peça }.
 */
function piecesOf(sheet, png) {
  const mode = sheet.mode ?? 'auto'
  if (mode === 'auto') {
    const { kept, label } = components(png)
    const used = new Set()
    return kept.map((c) => {
      // duas peças com o mesmo canto (uma dentro da caixa da outra): o tamanho desempata
      let id = `${sheet.id}@${c.x},${c.y}`
      if (used.has(id)) id += `,${c.w}x${c.h}`
      used.add(id)
      return { id, src: [c], mask: (si) => label[si] !== c.id }
    })
  }
  if (mode === 'pieces') {
    // cada retângulo é cortado no que tem de opaco (dá pra marcar a célula com folga)
    return sheet.pieces.flatMap((p) => {
      const found = opaqueBox(png, p.x, p.y, p.w, p.h)
      // trim: false mantém o retângulo inteiro (variantes que trocam sem "pular")
      const box = found && p.trim === false ? { x: p.x, y: p.y, w: p.w, h: p.h } : found
      // o resto da entrada (label, kind, light...) vale como ajuste de curadoria
      const { x: _x, y: _y, w: _w, h: _h, trim: _t, ...meta } = p
      return box ? [{ id: `${sheet.id}@${box.x},${box.y}`, src: [box], meta }] : []
    })
  }
  if (mode === 'grid') {
    const cw = sheet.cell?.w ?? 32, ch = sheet.cell?.h ?? 32
    const out = []
    for (let y = 0; y + ch <= png.height; y += ch) {
      for (let x = 0; x + cw <= png.width; x += cw) {
        const box = opaqueBox(png, x, y, cw, ch)
        if (!box) continue
        // por padrão a célula inteira (encaixa na grade); trim: true corta no opaco
        out.push({ id: `${sheet.id}@${x},${y}`, src: [sheet.trim ? box : { x, y, w: cw, h: ch }] })
      }
    }
    return out
  }
  if (mode === 'strip') {
    const { w, h } = sheet.frame
    const out = []
    for (let y = 0; y + h <= png.height; y += h) {
      const cells = []
      for (let x = 0; x + w <= png.width; x += w) {
        const box = opaqueBox(png, x, y, w, h)
        if (box) cells.push({ x, box })
        else break
      }
      if (!cells.length) continue
      // mesmo recorte em todos os quadros (a união), pra animação não tremer
      const top = Math.min(...cells.map((c) => c.box.y)), bottom = Math.max(...cells.map((c) => c.box.y + c.box.h))
      const left = Math.min(...cells.map((c) => c.box.x - c.x)), right = Math.max(...cells.map((c) => c.box.x - c.x + c.box.w))
      out.push({
        id: `${sheet.id}@0,${y}`,
        src: cells.map((c) => ({ x: c.x + left, y: top, w: right - left, h: bottom - top })),
      })
    }
    return out
  }
  throw new Error(`${sheet.id}: mode desconhecido "${mode}"`)
}

/** Lê um pacote e devolve as peças (com pixels) e as definições prontas. */
function buildPack(packId) {
  const dir = path.join(PACKS, packId)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'))
  const overrides = manifest.objects ?? {}
  const sheets = []
  const defs = []

  for (const sheet of manifest.sheets ?? []) {
    let png = PNG.sync.read(fs.readFileSync(path.join(dir, sheet.file)))
    if (sheet.crop) png = cropPng(png, sheet.crop)
    if (sheet.ignoreColor) clearColor(png, sheet.ignoreColor)
    for (const r of sheet.exclude ?? []) clearRect(png, r)
    const kind = sheet.kind ?? 'stand'
    if (!KINDS.includes(kind)) throw new Error(`${sheet.id}: kind inválido "${kind}"`)
    // animações saem da folha antes de procurar as peças soltas
    const anims = (sheet.anims ?? []).map((a) => animPiece(sheet, png, a)).filter(Boolean)
    const work = new PNG({ width: png.width, height: png.height })
    png.data.copy(work.data)
    for (const a of sheet.anims ?? []) {
      const dx = a.dx ?? (a.dy ? 0 : a.w), dy = a.dy ?? 0
      for (let i = 0; i < a.frames; i++) clearRect(work, { x: a.x + i * dx, y: a.y + i * dy, w: a.w, h: a.h })
    }
    // folha automática pode ter retângulos à mão (peças que se encostam na arte)
    const manual = (sheet.mode ?? 'auto') !== 'pieces' ? piecesOf({ ...sheet, mode: 'pieces', pieces: sheet.pieces ?? [] }, work) : []
    for (const p of sheet.mode !== 'pieces' ? sheet.pieces ?? [] : []) clearRect(work, p)
    const pieces = [
      ...piecesOf(sheet, work).map((p) => ({ ...p, png: work })),
      ...manual.map((p) => ({ ...p, png })),
      ...anims.map((p) => ({ ...p, png })),
    ]
    // ajustes por área (regions): o centro do primeiro quadro decide
    const regions = sheet.regions ?? []
    const regionOf = (p) => {
      const r = p.src[0], cx = r.x + r.w / 2, cy = r.y + r.h / 2
      return regions.findIndex((g) => cx >= g.x && cx < g.x + g.w && cy >= g.y && cy < g.y + g.h)
    }
    const count = new Map(), seen = new Map()
    for (const p of pieces) { const g = regionOf(p); p.region = g; count.set(g, (count.get(g) ?? 0) + 1) }
    const items = []
    pieces.forEach((p, i) => {
      let regionMeta = {}
      if (p.region >= 0) {
        const { x: _x, y: _y, w: _w, h: _h, label, ...rest } = regions[p.region]
        const n = (seen.get(p.region) ?? 0) + 1
        seen.set(p.region, n)
        regionMeta = { ...rest, ...(label ? { label: count.get(p.region) > 1 ? `${label} ${n}` : label } : {}) }
      }
      const ov = { ...regionMeta, ...p.meta, ...overrides[p.id] }
      const r = p.src[0]
      const k = ov.kind ?? kind
      const collision = ov.collision ?? sheet.collision
      const auto = collision === 'base' ? autoBase : autoFoot
      const foot = k === 'stand' && collision !== 'none' ? auto(p.png, r, p.mask) : null
      const def = {
        id: p.id,
        pack: packId,
        sheet: sheet.id,
        category: ov.category ?? sheet.category,
        label: ov.label ?? (pieces.length > 1 ? `${sheet.label} ${i + 1}` : sheet.label),
        tags: ov.tags ?? sheet.tags ?? [],
        kind: k,
        x: 0, y: 0, w: r.w, h: r.h,
        solids: ov.solids ?? (foot ? [foot.solid] : []),
        sort: ov.sort ?? (foot ? foot.sort : 0),
      }
      if (p.src.length > 1) def.anim = { fps: ov.fps ?? sheet.fps ?? 8, frames: [] }
      // light: null no ajuste = sem luz, mesmo que a folha tenha
      const light = 'light' in ov ? ov.light : sheet.light
      if (light) def.light = light
      if (sheet.variant) def.variant = sheet.variant
      // escondida continua na folha gerada (as outras não mudam de lugar
      // durante a curadoria), só não entra no catálogo
      items.push({ def, piece: { ...p, meta: { ...regionMeta, ...p.meta } }, src: r, hidden: !!ov.hidden })
    })
    sheets.push({ sheet, png, items })
  }

  // variantes: peça de uma folha "variantOf" ↔ peça na mesma posição da folha base
  for (const { sheet, items } of sheets) {
    if (!sheet.variantOf) continue
    const base = sheets.find((s) => s.sheet.id === sheet.variantOf)
    if (!base) throw new Error(`${sheet.id}: variantOf "${sheet.variantOf}" não existe no pacote`)
    for (const it of items) {
      const c = { x: it.src.x + it.src.w / 2, y: it.src.y + it.src.h }
      let best = null, bestD = 10
      for (const b of base.items) {
        const d = Math.hypot(b.src.x + b.src.w / 2 - c.x, b.src.y + b.src.h - c.y)
        if (d < bestD && Math.abs(b.src.w - it.src.w) < 20 && Math.abs(b.src.h - it.src.h) < 20) { best = b; bestD = d }
      }
      if (!best) continue
      // peça base escondida esconde as variantes (a não ser que tenham ajuste próprio)
      if (best.hidden) { if (!overrides[it.def.id]) it.hidden = true; continue }
      best.def.group = best.def.id
      it.def.group = best.def.id
      // a variante herda o que foi curado na peça base (a curadoria é feita uma vez)
      const own = { ...it.piece.meta, ...overrides[it.def.id] }, from = { ...best.piece.meta, ...overrides[best.def.id] }
      for (const key of ['label', 'category', 'tags', 'kind', 'solids', 'sort', 'light']) {
        if (key in own) continue
        if (key in from || ['label', 'category', 'tags'].includes(key)) {
          if (best.def[key] === undefined) delete it.def[key]
          else it.def[key] = structuredClone(best.def[key])
        }
      }
    }
  }
  // variantes de estado escritas à mão: peças com o mesmo "group" (ex.: baú
  // fechado/aberto); a primeira do grupo é a base
  const firstOf = new Map()
  for (const { items } of sheets) {
    for (const it of items) {
      const key = it.piece.meta?.group
      if (!key || it.hidden) continue
      if (!firstOf.has(key)) firstOf.set(key, it.def.id)
      it.def.group = firstOf.get(key)
      it.def.variant = it.piece.meta.variant ?? it.def.label
    }
  }
  for (const { items } of sheets) for (const it of items) if (!it.hidden) defs.push(it.def)

  // empacota cada folha em prateleiras (linhas), na ordem de leitura; folha
  // gerada grande demais vira várias páginas (limite de textura das GPUs)
  const atlases = []
  for (const { sheet, items } of sheets) {
    const frames = items.flatMap((it) => it.piece.src.map((src, f) => ({ it, src, f })))
    if (!frames.length) continue
    let page = 0, cx = 0, cy = 0, rowH = 0
    const heights = [0]
    for (const fr of frames) {
      if (cx + fr.src.w > ATLAS_W) { cx = 0; cy += rowH + PAD; rowH = 0 }
      // quadros de uma animação ficam na mesma página
      if (cy + fr.src.h > ATLAS_MAX_H && (fr.f === 0 || !fr.it.def.anim)) { page++; heights.push(0); cx = 0; cy = 0; rowH = 0 }
      fr.page = page
      fr.ax = cx
      fr.ay = cy
      cx += fr.src.w + PAD
      rowH = Math.max(rowH, fr.src.h)
      heights[page] = Math.max(heights[page], cy + rowH)
    }
    const pageId = (n) => (n === 0 ? sheet.id : `${sheet.id}~${n + 1}`)
    const pngs = heights.map((hh) => new PNG({ width: ATLAS_W, height: hh }))
    for (const fr of frames) {
      const { src, it } = fr
      const from = it.piece.png
      const atlas = pngs[fr.page]
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
          const si = (src.y + y) * from.width + (src.x + x)
          if (it.piece.mask?.(si)) continue
          from.data.copy(atlas.data, ((fr.ay + y) * ATLAS_W + fr.ax + x) * 4, si * 4, si * 4 + 4)
        }
      }
      if (fr.f === 0) { it.def.x = fr.ax; it.def.y = fr.ay; it.def.sheet = pageId(fr.page) }
      if (it.def.anim) it.def.anim.frames.push([fr.ax, fr.ay])
    }
    pngs.forEach((png, n) => atlases.push({ id: pageId(n), png }))
  }

  return { manifest, defs, atlases }
}

// ── Saída ───────────────────────────────────────────────

const packIds = fs.readdirSync(PACKS).filter((d) => fs.existsSync(path.join(PACKS, d, 'pack.json'))).sort()
if (only && !packIds.includes(only)) throw new Error(`pacote "${only}" não existe em assets-src/packs`)

let catalog = { packs: [], sheets: [], objects: [] }
if (only && fs.existsSync(CATALOG)) {
  const old = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
  if (old.packs) catalog = old
}
const drop = new Set(only ? [only] : packIds)
catalog.packs = catalog.packs.filter((p) => !drop.has(p.id))
catalog.sheets = catalog.sheets.filter((s) => !drop.has(s.pack))
catalog.objects = catalog.objects.filter((o) => !drop.has(o.pack))

fs.mkdirSync(path.join(OUT, 'catalog'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'credits', 'packs'), { recursive: true })
for (const id of only ? [only] : packIds) {
  const { manifest, defs, atlases } = buildPack(id)
  for (const a of atlases) {
    const url = `catalog/${a.id}.png`
    fs.writeFileSync(path.join(OUT, url), PNG.sync.write(a.png))
    catalog.sheets.push({ id: a.id, pack: id, url })
  }
  catalog.objects.push(...defs)
  // créditos visíveis no jogo (a licença da arte exige)
  const credits = `credits/packs/${id}.txt`
  fs.copyFileSync(path.join(PACKS, id, 'CREDITS.txt'), path.join(OUT, credits))
  catalog.packs.push({ id, name: manifest.name, license: manifest.license, credits })
}

// ordem estável: pacotes em ordem alfabética, peças na ordem de cada pacote
const order = new Map(packIds.map((id, i) => [id, i]))
const byPack = (a, b) => order.get(a.pack ?? a.id) - order.get(b.pack ?? b.id)
catalog.packs.sort(byPack)
catalog.sheets.sort(byPack)
catalog.objects = catalog.objects.map((o, i) => [o, i]).sort((a, b) => byPack(a[0], b[0]) || a[1] - b[1]).map(([o]) => o)

const ids = new Set()
for (const o of catalog.objects) {
  if (ids.has(o.id)) throw new Error(`id repetido: ${o.id} (folhas com o mesmo id em pacotes diferentes?)`)
  ids.add(o.id)
}
fs.writeFileSync(CATALOG, JSON.stringify(catalog))

if (!only) {
  for (const [from, to] of COPY) {
    fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true })
    fs.copyFileSync(path.join(SRC, from), path.join(OUT, to))
  }
  fs.copyFileSync(path.join(SRC, 'credits', 'CREDITS-terrain.txt'), path.join(OUT, 'credits', 'CREDITS-terrain.txt'))
  // folhas de versões antigas do catálogo que não existem mais
  const live = new Set(catalog.sheets.map((s) => path.basename(s.url)))
  for (const f of fs.readdirSync(path.join(OUT, 'catalog'))) {
    if (f.endsWith('.png') && !live.has(f)) fs.rmSync(path.join(OUT, 'catalog', f))
  }
  const stale = path.join(OUT, 'credits', 'CREDITS-trees.txt')
  if (fs.existsSync(stale)) fs.rmSync(stale)
}
// ── Terrenos dos pacotes ────────────────────────────────
// manifest.terrains: [{ type: 'block' | 'gen' | 'wang', file, ... }] (ver README dos pacotes)
// Sempre refeitos por inteiro (é rápido): o rank de cada um depende da ordem global.

/** Tabela de cada cor de um wangset de cantos do Tiled: cor → máscara → tiles [x, y]. */
function readWang(tsxPath, setName) {
  const xml = fs.readFileSync(tsxPath, 'utf8')
  const cols = Number(xml.match(/columns="(\d+)"/)[1])
  const set = xml.split('<wangset ').slice(1).find((w) => w.match(/name="([^"]*)"/)[1] === setName)
  if (!set) throw new Error(`${tsxPath}: wangset "${setName}" não existe`)
  const colors = [...set.matchAll(/<wangcolor name="([^"]*)"/g)].map((m) => m[1])
  const table = new Map()
  for (const t of set.matchAll(/<wangtile tileid="(\d+)" wangid="([^"]*)"/g)) {
    const v = t[2].split(',').map(Number)
    const used = new Set([v[1], v[3], v[5], v[7]].filter(Boolean))
    if (used.size !== 1) continue // tiles que misturam duas cores: não usados
    const c = [...used][0]
    // bits do Vortable: TL=1, TR=2, BL=4, BR=8 (wangid: 7=TL, 1=TR, 5=BL, 3=BR)
    const mask = (v[7] === c ? 1 : 0) | (v[1] === c ? 2 : 0) | (v[5] === c ? 4 : 0) | (v[3] === c ? 8 : 0)
    const id = Number(t[1])
    if (!table.has(c)) table.set(c, {})
    ;(table.get(c)[mask] ??= []).push([(id % cols) * 32, Math.floor(id / cols) * 32])
  }
  return { colors, table }
}

/**
 * Cercas: wangsets de BORDA no formato antigo do Tiled (wangid em hex, um
 * nibble por posição a partir do menos significativo: 0 cima, 2 direita,
 * 4 baixo, 6 esquerda). Cor 1 = a cerca continua por aquela borda.
 * Devolve, por wangset: nome e tabela máscara (cima=1, dir=2, baixo=4, esq=8) → [x, y].
 */
function readFenceSets(tsxPath) {
  const xml = fs.readFileSync(tsxPath, 'utf8')
  const cols = Number(xml.match(/columns="(\d+)"/)[1])
  return xml.split('<wangset ').slice(1).map((set) => {
    const name = set.match(/name="([^"]*)"/)[1]
    const table = {}
    for (const t of set.matchAll(/<wangtile tileid="(\d+)" wangid="0x([0-9a-fA-F]+)"/g)) {
      const v = parseInt(t[2], 16)
      const edge = (i) => (v >>> (i * 4)) & 15
      const mask = (edge(0) === 1 ? 1 : 0) | (edge(2) === 1 ? 2 : 0) | (edge(4) === 1 ? 4 : 0) | (edge(6) === 1 ? 8 : 0)
      const id = Number(t[1])
      ;(table[mask] ??= []).push([(id % cols) * 32, Math.floor(id / cols) * 32])
    }
    return { name, table }
  })
}

/** O tile mais "cheio" (mais pixels opacos) entre os da tabela: vira a miniatura. */
function bestThumb(png, tiles) {
  let best = null, bestN = -1
  for (const list of Object.values(tiles)) for (const [x, y] of list) {
    let n = 0
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) if (png.data[((y + j) * png.width + x + i) * 4 + 3] > 8) n++
    if (n > bestN) { best = [x, y]; bestN = n }
  }
  return best
}

function buildTerrains() {
  const out = { sheets: [], terrains: [] }
  fs.mkdirSync(path.join(OUT, 'terrain'), { recursive: true })
  let rank = 1000
  for (const packId of packIds) {
    const dir = path.join(PACKS, packId)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'))
    for (const entry of manifest.terrains ?? []) {
      const sheet = `${packId}-${path.basename(entry.file, '.png')}`
      const url = `terrain/${sheet}.png`
      if (!out.sheets.some((s) => s.id === sheet)) {
        fs.copyFileSync(path.join(dir, entry.file), path.join(OUT, url))
        out.sheets.push({ id: sheet, pack: packId, url })
      }
      const base = { pack: packId, sheet, ...(entry.solid ? { solid: true } : {}), ...(entry.layer ? { layer: entry.layer } : {}) }
      if (entry.type === 'block') {
        out.terrains.push({ ...base, id: entry.id, label: entry.label, category: entry.category, rank: rank++, origin: [entry.x ?? 0, entry.y ?? 0], ...(entry.fills ? { fills: entry.fills } : {}) })
      } else if (entry.type === 'gen') {
        entry.items.forEach((it, k) => {
          out.terrains.push({ ...base, id: `${entry.idPrefix}-${k + 1}`, label: it.label, category: it.category ?? entry.category, rank: rank++, gen: { url, x: it.x, y: it.y, size: it.size ?? 32 } })
        })
      } else if (entry.type === 'wang') {
        const png = PNG.sync.read(fs.readFileSync(path.join(dir, entry.file)))
        const { colors, table } = readWang(path.join(dir, entry.tsx), entry.set)
        colors.forEach((_, i) => {
          const c = i + 1
          const tiles = table.get(c)
          if (!tiles || (entry.hide ?? []).includes(c)) return
          const label = entry.labels?.[i] ?? `${entry.labelPrefix} ${c}`
          const category = entry.categories ? entry.categories[Math.floor(i / (entry.perCategory ?? 16))] : entry.category
          out.terrains.push({ ...base, id: `${entry.idPrefix}-${c}`, label, category, rank: rank++, wang: tiles, thumb: bestThumb(png, tiles) })
        })
      } else if (entry.type === 'fence') {
        const png = PNG.sync.read(fs.readFileSync(path.join(dir, entry.file)))
        readFenceSets(path.join(dir, entry.tsx)).forEach((set, i) => {
          out.terrains.push({ ...base, id: `${entry.idPrefix}-${i + 1}`, label: entry.labels?.[i] ?? set.name, category: entry.category, rank: rank++, layer: 'fence', fence: set.table, thumb: set.table[10]?.[0] ?? set.table[2]?.[0] ?? bestThumb(png, set.table) })
        })
      } else {
        throw new Error(`${packId}: terreno de tipo desconhecido "${entry.type}"`)
      }
    }
  }
  const seenIds = new Set()
  for (const t of out.terrains) {
    if (seenIds.has(t.id)) throw new Error(`terreno com id repetido: ${t.id}`)
    seenIds.add(t.id)
  }
  fs.writeFileSync(TERRAIN_CATALOG, JSON.stringify(out))
  // folhas de terreno que sobraram de versões antigas
  const live = new Set(out.sheets.map((s) => path.basename(s.url)))
  for (const f of fs.readdirSync(path.join(OUT, 'terrain'))) if (!live.has(f)) fs.rmSync(path.join(OUT, 'terrain', f))
  return out.terrains.length
}
const nTerrains = buildTerrains()

const n = catalog.objects.filter((o) => !only || o.pack === only).length
console.log(`${n} objetos${only ? ` no pacote ${only}` : ` em ${catalog.packs.length} pacotes`}; ${nTerrains} terrenos de pacote`)
