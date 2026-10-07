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
//   variantOf/variant: a folha é outra versão (cor/estado) de outra folha; as
//                 peças na mesma posição viram variantes da mesma peça
//   peças (mode "pieces") com o mesmo group/variant também viram variantes
//
// Ajuste de curadoria (objects[id]): label, category, tags, kind, solids,
// sort, light, fps, hidden. O que não for ajustado sai automático.
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

// ── Pacote → peças ──────────────────────────────────────

/**
 * Peças de uma folha. Cada peça: { id, src: [{x,y,w,h}] (quadros),
 * mask?(índice do pixel) → true se o pixel é de outra peça }.
 */
function piecesOf(sheet, png) {
  const mode = sheet.mode ?? 'auto'
  if (mode === 'auto') {
    const { kept, label } = components(png)
    return kept.map((c) => ({ id: `${sheet.id}@${c.x},${c.y}`, src: [c], mask: (si) => label[si] !== c.id }))
  }
  if (mode === 'pieces') {
    // cada retângulo é cortado no que tem de opaco (dá pra marcar a célula com folga)
    return sheet.pieces.flatMap((p) => {
      const box = opaqueBox(png, p.x, p.y, p.w, p.h)
      // o resto da entrada (label, kind, light...) vale como ajuste de curadoria
      const { x: _x, y: _y, w: _w, h: _h, ...meta } = p
      return box ? [{ id: `${sheet.id}@${box.x},${box.y}`, src: [box], meta }] : []
    })
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

  for (const sheet of manifest.sheets) {
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, sheet.file)))
    const kind = sheet.kind ?? 'stand'
    if (!KINDS.includes(kind)) throw new Error(`${sheet.id}: kind inválido "${kind}"`)
    const pieces = piecesOf(sheet, png)
    const items = []
    pieces.forEach((p, i) => {
      const ov = { ...p.meta, ...overrides[p.id] }
      const r = p.src[0]
      const k = ov.kind ?? kind
      const auto = sheet.collision === 'base' ? autoBase : autoFoot
      const foot = k === 'stand' && sheet.collision !== 'none' ? auto(png, r, p.mask) : null
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
      items.push({ def, piece: p, src: r, hidden: !!ov.hidden })
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
      if (!best || best.hidden) continue
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

  // empacota cada folha em prateleiras (linhas), na ordem de leitura
  const atlases = []
  for (const { sheet, png, items } of sheets) {
    const frames = items.flatMap((it) => it.piece.src.map((src, f) => ({ it, src, f })))
    let cx = 0, cy = 0, rowH = 0
    for (const fr of frames) {
      if (cx + fr.src.w > ATLAS_W) { cx = 0; cy += rowH + PAD; rowH = 0 }
      fr.ax = cx
      fr.ay = cy
      cx += fr.src.w + PAD
      rowH = Math.max(rowH, fr.src.h)
    }
    if (!frames.length) continue
    const atlas = new PNG({ width: ATLAS_W, height: cy + rowH })
    for (const fr of frames) {
      const { src, it } = fr
      for (let y = 0; y < src.h; y++) {
        for (let x = 0; x < src.w; x++) {
          const si = (src.y + y) * png.width + (src.x + x)
          if (it.piece.mask?.(si)) continue
          png.data.copy(atlas.data, ((fr.ay + y) * ATLAS_W + fr.ax + x) * 4, si * 4, si * 4 + 4)
        }
      }
      if (fr.f === 0) { it.def.x = fr.ax; it.def.y = fr.ay }
      if (it.def.anim) it.def.anim.frames.push([fr.ax, fr.ay])
    }
    atlases.push({ id: sheet.id, png: atlas })
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
const n = catalog.objects.filter((o) => !only || o.pack === only).length
console.log(`${n} objetos${only ? ` no pacote ${only}` : ` em ${catalog.packs.length} pacotes`}`)
