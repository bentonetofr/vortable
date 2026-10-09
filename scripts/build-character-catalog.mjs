// Gera o catálogo do criador de personagem a partir do Universal LPC
// Spritesheet Character Generator (fixado num commit, pra não mudar sozinho).
//
// As folhas usadas (walk/idle/run, corpos masculino e feminino, ~13 MB) são
// baixadas pro projeto, pra o jogo não depender de CDN de terceiros. Sai:
//   public/assets/character/sheets/…      — as folhas (mesmos caminhos do LPC)
//   public/assets/character/catalog.json  — itens, camadas, cores, variantes
//   public/assets/character/palettes.json — paletas de cor por material
//   assets-src/credits/CREDITS-character.md — autores e licenças (obrigatório)
//
//   node scripts/build-character-catalog.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator'
const SHA = '58ce1aa479e4df32845a73a5d0afc221c3a893c2'
const CDN = `https://raw.githubusercontent.com/${REPO}/${SHA}/`

/** Tipos de corpo oferecidos: masculino, feminino, musculoso (forte), jovem esguio e pequeno (criança). */
const BODIES = ['male', 'female', 'muscular', 'teen', 'child']
/** Animações que o jogo usa hoje (walk é obrigatória). */
const ANIMS = ['walk', 'idle', 'run']

/**
 * Espaços do personagem: cada um aceita UM item dos tipos listados.
 * group = aba do criador. required = não pode ficar vazio.
 */
const SLOTS = [
  { id: 'body', label: 'Corpo', group: 'Corpo', types: ['body'], required: true },
  { id: 'head', label: 'Cabeça', group: 'Corpo', types: ['head'], required: true },
  { id: 'ears', label: 'Orelhas', group: 'Corpo', types: ['ears'] },
  { id: 'nose', label: 'Nariz', group: 'Corpo', types: ['nose'] },
  { id: 'eyebrows', label: 'Sobrancelhas', group: 'Corpo', types: ['eyebrows'] },
  { id: 'eyes', label: 'Olhos especiais', group: 'Corpo', types: ['eyes'] },
  { id: 'wrinkles', label: 'Rugas', group: 'Corpo', types: ['wrinkles'] },
  { id: 'expression', label: 'Expressão', group: 'Corpo', types: ['expression', 'expression_crying'] },
  { id: 'horns', label: 'Chifres', group: 'Corpo', types: ['horns'] },
  { id: 'tail', label: 'Cauda', group: 'Corpo', types: ['tail'] },
  { id: 'wings', label: 'Asas', group: 'Corpo', types: ['wings'] },

  { id: 'hair', label: 'Cabelo', group: 'Cabelo', types: ['hair', 'updo'] },
  { id: 'ponytail', label: 'Rabo de cavalo', group: 'Cabelo', types: ['ponytail'] },
  { id: 'beard', label: 'Barba', group: 'Cabelo', types: ['beard'] },
  { id: 'mustache', label: 'Bigode', group: 'Cabelo', types: ['mustache'] },

  { id: 'clothes', label: 'Camisa', group: 'Roupa', types: ['clothes'] },
  { id: 'vest', label: 'Colete', group: 'Roupa', types: ['vest'] },
  { id: 'jacket', label: 'Jaqueta', group: 'Roupa', types: ['jacket'] },
  { id: 'dress', label: 'Vestido', group: 'Roupa', types: ['dress'] },
  { id: 'overalls', label: 'Macacão', group: 'Roupa', types: ['overalls'] },
  { id: 'armour', label: 'Armadura', group: 'Roupa', types: ['armour', 'chainmail'] },
  { id: 'legs', label: 'Calça / saia', group: 'Roupa', types: ['legs'] },
  { id: 'socks', label: 'Meias', group: 'Roupa', types: ['socks'] },
  { id: 'shoes', label: 'Calçado', group: 'Roupa', types: ['shoes'] },
  { id: 'gloves', label: 'Luvas', group: 'Roupa', types: ['gloves'] },

  { id: 'hat', label: 'Chapéu / elmo', group: 'Acessórios', types: ['hat'] },
  { id: 'bandana', label: 'Bandana / faixa', group: 'Acessórios', types: ['bandana', 'headcover'] },
  { id: 'facial', label: 'Óculos', group: 'Acessórios', types: ['facial_eyes'] },
  { id: 'mask', label: 'Máscara', group: 'Acessórios', types: ['facial_mask'] },
  { id: 'earrings', label: 'Brincos', group: 'Acessórios', types: ['earrings', 'earring_left', 'earring_right'] },
  { id: 'neck', label: 'Pescoço / amuleto', group: 'Acessórios', types: ['neck', 'necklace', 'charm'] },
  { id: 'cape', label: 'Capa', group: 'Acessórios', types: ['cape'] },
  { id: 'shoulders', label: 'Ombreiras', group: 'Acessórios', types: ['shoulders'] },
  { id: 'arms', label: 'Braçadeiras', group: 'Acessórios', types: ['bracers', 'wrists'] },
  { id: 'belt', label: 'Cinto', group: 'Acessórios', types: ['belt'] },
  { id: 'sash', label: 'Faixa', group: 'Acessórios', types: ['sash'] },
  { id: 'apron', label: 'Avental', group: 'Acessórios', types: ['apron'] },
  { id: 'backpack', label: 'Mochila', group: 'Acessórios', types: ['backpack'] },

  { id: 'scar_eye_l', label: 'Cicatriz no olho (esq.)', group: 'Marcas', types: ['wound_eye_left'] },
  { id: 'scar_eye_r', label: 'Cicatriz no olho (dir.)', group: 'Marcas', types: ['wound_eye_right'] },
  { id: 'scar_mouth', label: 'Cicatriz na boca', group: 'Marcas', types: ['wound_mouth'] },
  { id: 'scar_arm', label: 'Ferimento no braço', group: 'Marcas', types: ['wound_arm'] },
  { id: 'wound_head', label: 'Ferimento na cabeça', group: 'Marcas', types: ['wound_brain'] },
  { id: 'wound_ribs', label: 'Ferimento no tronco', group: 'Marcas', types: ['wound_ribs'] },
  { id: 'bandages', label: 'Bandagens', group: 'Marcas', types: ['bandages'] },
  { id: 'prosthesis_hand', label: 'Prótese de mão', group: 'Marcas', types: ['prosthesis_hand'] },
  { id: 'prosthesis_leg', label: 'Prótese de perna', group: 'Marcas', types: ['prosthesis_leg'] },
]
const slotOfType = new Map(SLOTS.flatMap((s) => s.types.map((t) => [t, s.id])))

/** Expressões do rosto: pedem cabeça humana e trazem ${head} no caminho (male/female). */
const isFace = (d) => String(d.type_name).startsWith('expression') && d.required_tags?.length === 1 && d.required_tags[0] === 'human'
/** Pede etiquetas que não sabemos atender (fora as expressões)? */
const needsTags = (d) => !!d.required_tags && !isFace(d)
/** Caminho de uma camada pro corpo b, com ${head} resolvido (corpo feminino = rosto feminino, os outros = masculino). */
const dirFor = (dir, b) => {
  if (typeof dir !== 'string') return null
  const out = dir.replace('${head}', b === 'female' ? 'female' : 'male')
  return out.includes('${') ? null : out
}

const MATERIALS = ['body', 'hair', 'cloth', 'eye', 'metal', 'wood']
const VERSIONS = ['ulpc', 'lpcr']

/** fetch com até 4 tentativas (a rede/GitHub às vezes engasga). */
async function fetchRetry(url, init) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (i >= 3) throw err
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

async function json(url) {
  const r = await fetchRetry(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function pool(items, n, fn) {
  let i = 0
  const out = new Array(items.length)
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++
      out[k] = await fn(items[k])
    }
  }))
  return out
}

console.log('lendo a árvore do repositório...')
// a árvore vem cortada (o repositório tem >100 mil arquivos), mas as
// definições vêm antes das imagens; a existência das imagens é checada
// uma a uma (HEAD) mais abaixo
const tree = (await json(`https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`)).tree.map((t) => t.path)
const files = new Set(tree)
const defPaths = tree.filter((p) => p.startsWith('sheet_definitions/') && p.endsWith('.json') && !path.basename(p).startsWith('meta_'))

console.log(`baixando ${defPaths.length} definições...`)
const defs = await pool(defPaths, 12, async (p) => ({ path: p, def: await json(CDN + p) }))

console.log('baixando paletas...')
const palettes = {}
const bases = {}
for (const m of MATERIALS) {
  palettes[m] = {}
  for (const v of VERSIONS) {
    const f = `palette_definitions/${m}/${m}_${v}.json`
    if (files.has(f)) palettes[m][v] = await json(CDN + f)
  }
  bases[m] = (await json(CDN + `palette_definitions/${m}/meta_${m}.json`)).base
}

/** Cor-base de um canal: lista de cores da folha original. */
function resolveSource(ch) {
  if (Array.isArray(ch.source)) return ch.source
  const m = ch.material
  let version = 'ulpc', color = ch.base ?? bases[m]
  if (color && color.includes('.')) [version, color] = color.split('.')
  return palettes[m]?.[version]?.[color] ?? null
}

/** Tamanho de cada imagem que existe (HEAD); ausente = não existe. */
const sizes = new Map()
async function head(rel) {
  if (sizes.has(rel)) return sizes.get(rel)
  const r = await fetchRetry(CDN + 'spritesheets/' + rel, { method: 'HEAD' })
  const size = r.ok ? Number(r.headers.get('content-length') ?? 0) : -1
  sizes.set(rel, size)
  return size
}
const variantFile = (v) => String(v).trim().replace(/\s+/g, '_')
const sheetFile = (dir, anim, variant) => (variant ? `${dir}${anim}/${variant}.png` : `${dir}${anim}.png`)

// 1ª passada: quais "walk" existem (é o que decide se a camada vale)
const candidates = new Set()
for (const { def: d } of defs) {
  if (!slotOfType.get(d.type_name) || needsTags(d)) continue
  const v = Array.isArray(d.variants) ? variantFile(d.variants[0]) : null
  for (const k of Object.keys(d).filter((k) => /^layer_\d+$/.test(k))) {
    for (const b of BODIES) {
      const dir = dirFor(d[k][b], b)
      if (dir) candidates.add(sheetFile(dir, 'walk', v))
    }
  }
}
console.log(`conferindo ${candidates.size} folhas...`)
await pool([...candidates], 12, head)

const items = []
const credits = new Map()
let skipped = 0
for (const { path: p, def: d } of defs) {
  const slot = slotOfType.get(d.type_name)
  if (!slot || needsTags(d)) { skipped++; continue }
  const layerKeys = Object.keys(d).filter((k) => /^layer_\d+$/.test(k)).sort()
  // no LPC, variante "dark brown" fica no arquivo dark_brown.png
  const variants = Array.isArray(d.variants) ? [...new Set(d.variants.map(variantFile))] : null
  const anims = ANIMS.filter((a) => (d.animations ?? ANIMS).includes(a))
  if (!anims.includes('walk')) { skipped++; continue }

  // camadas por tipo de corpo, só com os arquivos que existem de verdade
  const exists = (dir) => (sizes.get(sheetFile(dir, 'walk', variants?.[0])) ?? -1) > 0
  const layers = []
  let broken = false
  for (const k of layerKeys) {
    const L = d[k]
    const paths = {}
    for (const b of BODIES) {
      const dir = dirFor(L[b], b)
      if (dir && exists(dir)) paths[b] = dir
    }
    if (!Object.keys(paths).length) { broken = true; break }
    layers.push({ z: L.zPos ?? 0, paths })
  }
  if (broken || !layers.length) { skipped++; continue }
  const bodies = BODIES.filter((b) => layers.every((l) => l.paths[b]))
  if (!bodies.length) { skipped++; continue }

  // canais de cor
  const r = d.recolors
  const channels = []
  if (r) {
    const list = r.material ? [['color', r]] : Object.entries(r)
    for (const [key, ch] of list) {
      if (!MATERIALS.includes(ch.material)) continue
      const source = resolveSource(ch)
      if (!source) continue
      channels.push({ key, label: ch.label ?? null, material: ch.material, source })
    }
  }

  if (!channels.length && d.match_body_color) {
    const source = resolveSource({ material: 'body' })
    if (source) channels.push({ key: 'color', material: 'body', source })
  }

  const id = p.replace(/^sheet_definitions\//, '').replace(/\.json$/, '')
  items.push({
    id,
    slot,
    name: d.name,
    layers,
    bodies,
    anims,
    ...(variants ? { variants } : {}),
    ...(channels.length ? { colors: channels } : {}),
    ...(d.match_body_color ? { matchBody: true } : {}),
    ...(isFace(d) ? { requiresHead: 'human' } : {}),
  })
  for (const c of d.credits ?? []) {
    if (!credits.has(c.file)) credits.set(c.file, c)
  }
}

// 2ª passada: idle/run de verdade (e o peso total, pra saber o custo de hospedar)
const needed = new Set()
for (const it of items) {
  for (const l of it.layers) {
    for (const dir of new Set(Object.values(l.paths))) {
      for (const a of it.anims) for (const v of it.variants ?? [null]) needed.add(sheetFile(dir, a, v))
    }
  }
}
console.log(`conferindo ${needed.size} folhas de animação...`)
await pool([...needed], 12, head)
const walkOk = (it, v) => it.layers.every((l) => Object.values(l.paths).every((dir) => (sizes.get(sheetFile(dir, 'walk', v)) ?? -1) > 0))
for (let i = items.length - 1; i >= 0; i--) {
  const it = items[i]
  // variante sem arquivo (o LPC tem algumas listadas que não existem pra todo corpo)
  if (it.variants) {
    it.variants = it.variants.filter((v) => walkOk(it, v))
    if (!it.variants.length) {
      items.splice(i, 1)
      skipped++
      continue
    }
  }
}
for (const it of items) {
  // animação que falta em alguma camada/variante: o jogo usa a "walk" no lugar
  it.anims = it.anims.filter((a) => it.layers.every((l) =>
    Object.values(l.paths).every((dir) => (it.variants ?? [null]).every((v) => (sizes.get(sheetFile(dir, a, v)) ?? -1) > 0))))
}
const totalBytes = [...needed].reduce((sum, f) => sum + Math.max(0, sizes.get(f) ?? 0), 0)
console.log(`peso das folhas usadas: ${(totalBytes / 1024 / 1024).toFixed(1)} MB em ${needed.size} arquivos`)

// baixa o que ainda não está no projeto
const sheetsDir = path.join(ROOT, 'public', 'assets', 'character', 'sheets')
const missing = [...needed].filter((f) => (sizes.get(f) ?? -1) > 0 && !fs.existsSync(path.join(sheetsDir, f)))
console.log(`baixando ${missing.length} folhas novas...`)
let done = 0
await pool(missing, 12, async (f) => {
  const r = await fetchRetry(CDN + 'spritesheets/' + f)
  if (!r.ok) throw new Error(`${r.status} ${f}`)
  const out = path.join(sheetsDir, f)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
  if (++done % 1000 === 0) console.log(`  ${done}/${missing.length}`)
})

items.sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name))

/**
 * Tons que o LPC não tem (os castanhos dele puxam pro laranja e o marinho pro roxo).
 * Cada rampa tem 6 cores, do escuro ao claro, como as do LPC.
 */
const EXTRA_PALETTES = {
  hair: {
    cocoa: ['#0d0806', '#1c120d', '#2e2018', '#433025', '#5c4535', '#7a5f4c'],
    umber: ['#0a0605', '#1a0f0a', '#2b1a12', '#3d281c', '#573a29', '#6f4e38'],
  },
  cloth: {
    midnight: ['#07090f', '#0f1522', '#172136', '#20304c', '#2d4266', '#3d5882'],
    oxblood: ['#120706', '#25100c', '#3a1a13', '#50241a', '#6a3324', '#874633'],
    pale_gray: ['#2a272a', '#4f4b4f', '#76716f', '#989391', '#b3aeab', '#cdc8c4'],
    espresso: ['#0c0605', '#1c0f0b', '#2d1a14', '#3f261c', '#573629', '#704733'],
    steel_blue: ['#0a1219', '#142331', '#1f3547', '#2d4a60', '#41627b', '#587c97'],
    sea_green: ['#07181a', '#0f2e30', '#1a4747', '#2a6662', '#3a827c', '#52a09a'],
    sand: ['#2e261c', '#5a4b36', '#8f7d5a', '#c0ab82', '#d9c7a1', '#eddfc0'],
    garnet: ['#150808', '#2a1010', '#431a1a', '#5c2828', '#763838', '#924a4a'],
  },
  metal: {
    saddle: ['#0a0604', '#1a0f0a', '#2b1a12', '#3d281c', '#573a29', '#6f4e38'],
  },
}

// ── Tons gerados: rampas de 6 cores (escuro → claro) a partir de uma cor média, como as do LPC ──
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => toHex(...toRgb(a).map((v, i) => v + (toRgb(b)[i] - v) * t))
const lighten = (hex, t) => mix(hex, '#ffffff', t)
const darken = (hex, t, tint = '#0a0508') => mix(hex, tint, t)
/** Pele: contorno escuro, sombra avermelhada, meia sombra, base, luz e brilho. */
const skinRamp = (base) => [darken(base, 0.84), mix(darken(base, 0.45), '#8a2a28', 0.25), darken(base, 0.2, '#5a2a1c'), base, lighten(base, 0.38), lighten(base, 0.7)]
/** Cabelo: do quase preto ao mechado claro. */
const hairRamp = (base) => [darken(base, 0.78), darken(base, 0.58), darken(base, 0.3), base, lighten(base, 0.28), lighten(base, 0.52)]
/** Roupa: sombra funda até o realce. */
const clothRamp = (base) => [darken(base, 0.8), darken(base, 0.6), darken(base, 0.32), base, lighten(base, 0.22), lighten(base, 0.42)]
/** Olho: contorno, íris e brilho (3 cores). */
const eyeRamp = (base) => [darken(base, 0.62), base, lighten(base, 0.45)]
const gen = (fn, list) => Object.fromEntries(Object.entries(list).map(([name, base]) => [name, fn(base)]))

Object.assign(EXTRA_PALETTES.body ??= {}, gen(skinRamp, {
  porcelain: '#f4d9c8', fair: '#eab99a', peach: '#e8ae86', beige: '#d9a074', sand_tan: '#cf9468', honey: '#c2865a', caramel: '#b57a4f',
  tan: '#a86d44', golden_brown: '#9c6038', chestnut_skin: '#8a5232', mocha: '#744327', cocoa_skin: '#5f3721', espresso_skin: '#4a2b19',
  ebony: '#36201a', rosy: '#e6a39a', ashen: '#b9b3ad', pale_blue: '#c9d3de', moon: '#e9e4ef',
}))
Object.assign(EXTRA_PALETTES.hair, gen(hairRamp, {
  jet_black: '#2b2528', blue_black: '#263042', chocolate: '#5a382a', mahogany: '#6e3426', auburn: '#8a431f', copper: '#b4602a',
  honey_blonde: '#d2a24a', dirty_blonde: '#b09258', silver: '#b8bcc4', snow: '#e8eaee', steel: '#7f8794',
  neon_pink: '#ff4fa3', hot_magenta: '#d81b8a', electric_blue: '#2f7bff', cyan_hair: '#19d3e0', teal_hair: '#12a39a', mint: '#62e0a8',
  lime_hair: '#a6e22e', sunset: '#ff7a2f', crimson_hair: '#c4122c', lilac: '#b79af0', midnight_blue: '#233a8a', rose_gold: '#e0a190',
}))
Object.assign(EXTRA_PALETTES.cloth, gen(clothRamp, {
  burgundy: '#8a2336', wine: '#6a1f35', crimson: '#c0243a', coral: '#ee6b5d', salmon: '#f2998a', peach_cloth: '#f6b98f', mustard: '#caa228',
  gold_cloth: '#e0b335', olive: '#76852f', moss: '#557433', lime: '#9ac93a', mint_cloth: '#7fd1ae', turquoise: '#1fb5ad', cyan: '#29b6d6',
  azure: '#2f86d8', cobalt: '#2c56d0', indigo: '#403fa6', plum: '#722f7a', magenta: '#b8279f', hot_pink: '#ee3f95', neon_green: '#39ff88',
  neon_blue: '#3ab7ff', neon_pink: '#ff4fa3', neon_yellow: '#f4f23a', silver: '#b6bcc6', ivory: '#efe6d0', cream: '#f3e9c8', khaki: '#b8a56d',
  rust: '#a94e26', terracotta: '#c0603f', chocolate: '#583527', graphite: '#464a53', onyx: '#1b1c21', snow: '#f6f6f7',
}))
EXTRA_PALETTES.eye ??= {}
Object.assign(EXTRA_PALETTES.eye, gen(eyeRamp, {
  hazel: '#8a6a2f', amber: '#c28a1d', ice: '#9cd5ef', lime: '#7ed321', pink: '#e86fb0', white: '#e6e6ea', black: '#26262e', teal: '#12a39a',
  gold: '#e0b335', violet: '#8a5be0', crimson: '#d01a38', silver: '#aeb4c0',
}))
EXTRA_PALETTES.body ??= {}

const outDir = path.join(ROOT, 'public', 'assets', 'character')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({
  // relativo à pasta de assets do motor
  sheets: 'character/sheets/',
  source: `https://github.com/${REPO}/tree/${SHA}`,
  bodies: BODIES,
  slots: SLOTS.map(({ id, label, group, required }) => ({ id, label, group, ...(required ? { required } : {}) })),
  items,
}))
// só a paleta ulpc vira opção de cor (mais as nossas, EXTRA_PALETTES); a lpcr fica pra resolver cores-base
fs.writeFileSync(path.join(outDir, 'palettes.json'), JSON.stringify(
  Object.fromEntries(MATERIALS.map((m) => [m, { ...(palettes[m].ulpc ?? {}), ...(EXTRA_PALETTES[m] ?? {}) }])),
))

// créditos (a licença exige)
let md = '# Créditos — personagem\n\n'
md += `Universal LPC Spritesheet Character Generator — https://github.com/${REPO} (commit ${SHA.slice(0, 7)})\n\n`
md += 'Cada item abaixo lista os autores e as licenças da arte original.\n\n'
for (const c of [...credits.values()].sort((a, b) => a.file.localeCompare(b.file))) {
  md += `## ${c.file}\n`
  if (c.notes) md += `${c.notes}\n\n`
  md += `- Autores: ${(c.authors ?? []).join(', ')}\n- Licenças: ${(c.licenses ?? []).join(' / ')}\n`
  for (const u of c.urls ?? []) md += `- ${u}\n`
  md += '\n'
}
fs.writeFileSync(path.join(ROOT, 'assets-src', 'credits', 'CREDITS-character.md'), md)
// cópia publicada: o jogo mostra na tela de créditos
fs.mkdirSync(path.join(ROOT, 'public', 'assets', 'credits'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'public', 'assets', 'credits', 'CREDITS-character.md'), md)

// folhas que sobraram de versões antigas do catálogo
let removed = 0
const keep = new Set([...needed].map((f) => path.normalize(f)))
;(function sweep(dir, rel = '') {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name), r = path.join(rel, name)
    if (fs.statSync(full).isDirectory()) {
      sweep(full, r)
      if (!fs.readdirSync(full).length) fs.rmdirSync(full)
    } else if (!keep.has(path.normalize(r))) {
      fs.unlinkSync(full)
      removed++
    }
  }
})(sheetsDir)
if (removed) console.log(`${removed} folhas antigas removidas`)

const perSlot = Object.fromEntries(SLOTS.map((s) => [s.id, items.filter((i) => i.slot === s.id).length]))
console.log(`${items.length} itens (${skipped} ignorados), ${credits.size} créditos`)
console.log(Object.entries(perSlot).map(([k, v]) => `${k}:${v}`).join('  '))
