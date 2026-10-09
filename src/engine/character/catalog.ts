// ────────────────────────────────────────────────────────
// Catálogo do personagem (gerado por scripts/build-character-catalog.mjs
// a partir do Universal LPC Spritesheet Character Generator): espaços
// (cabelo, camisa...), itens, camadas, canais de cor e variantes.
// ────────────────────────────────────────────────────────

import { PROC_SLOTS, procItems, procPalettes } from './proc'
import { HEIGHTS, type Appearance, type AppearanceItem, type BodyType } from '../types'

export interface CharLayer {
  z: number
  /** Pasta da folha por tipo de corpo (relativa a `sheets`). */
  paths: Partial<Record<BodyType, string>>
}

export interface CharColorChannel {
  key: string
  label: string | null
  material: string
  /** Cores em que a folha foi desenhada (as que são trocadas). */
  source: string[]
}

export interface CharItem {
  id: string
  slot: string
  name: string
  layers: CharLayer[]
  bodies: BodyType[]
  /** Animações que existem; as que faltam usam a "walk". */
  anims: string[]
  variants?: string[]
  colors?: CharColorChannel[]
  /** Pele acompanha a cor do corpo (cabeça, orelhas, nariz...). */
  matchBody?: boolean
  /** Só vale com certas cabeças (as expressões pedem cabeça humana). */
  requiresHead?: 'human'
  /** Peça desenhada por código (ver proc.ts), sem folhas de imagem. */
  proc?: boolean
}

export interface CharSlot {
  id: string
  label: string
  group: string
  required?: boolean
}

export interface CharCatalog {
  sheets: string
  source: string
  bodies: BodyType[]
  slots: CharSlot[]
  items: CharItem[]
}

/** material → nome da cor → rampa de cores. */
export type CharPalettes = Record<string, Record<string, string[]>>

export interface CharacterData {
  catalog: CharCatalog
  palettes: CharPalettes
  byId: Map<string, CharItem>
}

const cache = new Map<string, Promise<CharacterData>>()

export function loadCharacterData(assetBase: string): Promise<CharacterData> {
  let p = cache.get(assetBase)
  if (!p) {
    p = (async () => {
      const [catalog, palettes] = await Promise.all([
        fetchJson<CharCatalog>(assetBase + 'character/catalog.json'),
        fetchJson<CharPalettes>(assetBase + 'character/palettes.json'),
      ])
      // peças desenhadas por código entram junto com as do LPC
      catalog.slots = [...catalog.slots, ...PROC_SLOTS]
      catalog.items = [...catalog.items, ...procItems()]
      Object.assign(palettes, procPalettes())
      return { catalog, palettes, byId: new Map(catalog.items.map((i) => [i.id, i])) }
    })()
    p.catch(() => cache.delete(assetBase)) // deixa tentar de novo
    cache.set(assetBase, p)
  }
  return p
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`não carregou ${url} (${r.status})`)
  return r.json() as Promise<T>
}

export const BODY_LABELS: Record<BodyType, string> = {
  male: 'Masculino', female: 'Feminino', muscular: 'Musculoso', teen: 'Esguio (jovem)', child: 'Pequeno (criança)',
}

/** Nomes das alturas, da mais baixa à mais alta (mesma ordem de HEIGHTS). */
export const HEIGHT_LABELS = ['Muito baixo', 'Baixo', 'Médio', 'Alto', 'Muito alto']

/** A cabeça escolhida combina com peças que pedem cabeça humana (a idosa não)? */
function humanHead(a: Appearance) {
  const id = a.slots.head?.id ?? ''
  return id.includes('/human/') && !id.includes('elderly')
}

/** Cor representativa de uma rampa (pra amostras). */
export function swatch(palettes: CharPalettes, material: string, color: string) {
  const ramp = palettes[material]?.[color]
  return ramp ? ramp[Math.min(ramp.length - 1, Math.floor(ramp.length * 0.6))] : '#888'
}

export function itemsForSlot(data: CharacterData, slot: string, body: BodyType, a?: Appearance) {
  return data.catalog.items.filter((i) => i.slot === slot && i.bodies.includes(body) && !(a && i.requiresHead && !humanHead(a)))
}

/** Pasta de uma camada pro corpo pedido (cai no outro corpo se faltar). */
export function layerDir(layer: CharLayer, body: BodyType) {
  return layer.paths[body] ?? Object.values(layer.paths)[0]!
}

// ── Nomes em português (os do LPC vêm em inglês) ─────────

const WORDS: Record<string, string> = {
  human: 'Humano', male: 'masc.', female: 'fem.', elderly: 'idoso', small: 'pequeno', plump: 'gordo', gaunt: 'magro',
  long: 'longo', short: 'curto', longsleeve: 'manga longa', shortsleeve: 'manga curta', sleeveless: 'sem manga',
  pants: 'calça', skirt: 'saia', shoes: 'sapatos', boots: 'botas', basic: 'simples', hat: 'chapéu', helmet: 'elmo',
  hood: 'capuz', cape: 'capa', solid: 'lisa', tattered: 'rasgada', dress: 'vestido', vest: 'colete', jacket: 'jaqueta',
  belt: 'cinto', apron: 'avental', glasses: 'óculos', beard: 'barba', mustache: 'bigode', ponytail: 'rabo de cavalo',
  wings: 'asas', tail: 'cauda', ears: 'orelhas', nose: 'nariz', horns: 'chifres', skeleton: 'esqueleto', zombie: 'zumbi',
  body: 'corpo', color: 'cor', messy: 'bagunçado', curly: 'cacheado', straight: 'liso', bald: 'careca', braid: 'trança',
  bangs: 'franja', buzzcut: 'raspado', spiked: 'espetado', wavy: 'ondulado', formal: 'social', leather: 'couro',
  plate: 'placas', chain: 'malha', gloves: 'luvas', socks: 'meias', scarf: 'cachecol', necklace: 'colar',
  // expressões do rosto
  angry: 'raiva', alt: 'alt.', closed: 'fechados', closing: 'fechando', eyes: 'olhos', looking: 'olhando', rolling: 'revirando',
  happy: 'feliz', sad: 'triste', shame: 'vergonha', shock: 'choque', tears: 'lágrimas', neutral: 'neutra', blush: 'corado',
  // cabelo e rosto
  bun: 'coque', buns: 'coques', cornrows: 'tranças rente', dreadlocks: 'dreads', dreads: 'dreads', mohawk: 'moicano', pixie: 'pixie',
  bob: 'chanel', page: 'pajem', shag: 'desfiado', medium: 'médio', extra: 'extra', tall: 'alto', top: 'topo', fade: 'degradê',
  twists: 'twists', afro: 'afro', balding: 'calvície', cowlick: 'topete', flat: 'achatado', tight: 'rente', high: 'alto', loose: 'solto',
  side: 'lateral', part: 'repartido', swoop: 'volume', lob: 'chanel longo', unkempt: 'desgrenhado', halfmessy: 'meio bagunçado',
  // roupas
  tshirt: 'camiseta', scoop: 'gola redonda', vneck: 'gola V', collared: 'com gola', buttoned: 'abotoada', laced: 'com cadarço',
  shorts: 'bermuda', hose: 'meia-calça', leggings: 'legging', pantaloons: 'bombacha', wide: 'larga',
  striped: 'listrada', plain: 'lisa', original: 'original', legion: 'legião', pauldrons: 'ombreiras', epaulets: 'dragonas', cuffs: 'punhos',
  sandals: 'sandálias', sneakers: 'tênis', slippers: 'pantufas', revised: 'revisado', cloak: 'manto', robe: 'túnica', tunic: 'túnica',
  // acessórios
  bandana: 'bandana', headband: 'faixa', kerchief: 'lenço', monocle: 'monóculo', earring: 'brinco', simple: 'simples', gem: 'gema',
  amulet: 'amuleto', charm: 'amuleto', star: 'estrela', spider: 'aranha', ring: 'anel', cut: 'lapidação', round: 'redonda',
}

/** Nomes inteiros que pedem tradução própria. */
const NAMES: Record<string, string> = { 'Body Color': 'Humano', 'Eye color': 'Cor dos olhos', 'Eye Color': 'Cor dos olhos' }

export function itemLabel(item: CharItem) {
  if (NAMES[item.name]) return NAMES[item.name]
  return item.name
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((w) => WORDS[w.toLowerCase()] ?? w)
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase())
}

// ── Aparência padrão e sorteio ───────────────────────────

const DEFAULTS: Record<'male' | 'female', Record<string, AppearanceItem>> = {
  male: {
    body: { id: 'body/body' },
    head: { id: 'head/heads/human/heads_human_male', colors: { color_2: 'brown' } },
    hair: { id: 'hair/short/hair_messy1', colors: { color: 'chestnut' } },
    clothes: { id: 'torso/shirts/longsleeve/torso_clothes_longsleeve', colors: { color: 'forest' } },
    legs: { id: 'legs/pants/legs_pants2', colors: { color: 'navy' } },
    shoes: { id: 'feet/shoes/feet_shoes_basic', colors: { color: 'brown' } },
  },
  female: {
    body: { id: 'body/body' },
    head: { id: 'head/heads/human/heads_human_female', colors: { color_2: 'green' } },
    hair: { id: 'hair/long/hair_long', colors: { color: 'dark_brown' } },
    clothes: { id: 'torso/shirts/longsleeve/torso_clothes_longsleeve', colors: { color: 'maroon' } },
    legs: { id: 'legs/pants/legs_pants2', colors: { color: 'tan' } },
    shoes: { id: 'feet/boots/feet_boots_basic', colors: { color: 'brown' } },
  },
}

/** Qual dos dois conjuntos de peças padrão serve pro corpo (só o feminino é feminino). */
const baseOf = (body: BodyType) => (body === 'female' ? 'female' : 'male')

export function defaultAppearance(body: BodyType = 'male'): Appearance {
  return { version: 2, body, skin: 'light', slots: structuredClone(DEFAULTS[baseOf(body)]) }
}

/**
 * Tira o que não existe pro corpo escolhido (itens, variantes, cores) e
 * garante os espaços obrigatórios. Usado ao carregar e ao trocar de corpo.
 */
export function normalizeAppearance(data: CharacterData, a: Appearance): Appearance {
  const slots: Record<string, AppearanceItem> = {}
  for (const s of data.catalog.slots) {
    const chosen = a.slots[s.id]
    const item = chosen && data.byId.get(chosen.id)
    if (item && item.slot === s.id && item.bodies.includes(a.body) && !(item.requiresHead && !humanHead({ ...a, slots: { ...a.slots, head: headChoice(data, a) } }))) {
      const variant = item.variants ? (item.variants.includes(chosen.variant ?? '') ? chosen.variant : item.variants[0]) : undefined
      const colors: Record<string, string> = {}
      for (const ch of item.colors ?? []) {
        const c = chosen.colors?.[ch.key]
        if (c && data.palettes[ch.material]?.[c]) colors[ch.key] = c
      }
      slots[s.id] = { id: item.id, ...(variant ? { variant } : {}), ...(Object.keys(colors).length ? { colors } : {}) }
    } else if (s.required) {
      const fallback = DEFAULTS[baseOf(a.body)][s.id] ?? { id: itemsForSlot(data, s.id, a.body)[0]?.id }
      if (fallback.id) slots[s.id] = structuredClone(fallback)
    }
  }
  const skin = data.palettes.body?.[a.skin] ? a.skin : 'light'
  const height = HEIGHTS.includes(a.height as (typeof HEIGHTS)[number]) && a.height !== 1 ? a.height : undefined
  // porte: peito e bunda só no corpo feminino; peso em todos menos no musculoso
  const lv = (v: number | undefined) => (v === -1 || v === 1 ? v : 0)
  const bust = a.body === 'female' ? lv(a.shape?.bust) : 0
  const hips = a.body === 'female' ? lv(a.shape?.hips) : 0
  const weight = a.body === 'muscular' ? 0 : lv(a.shape?.weight)
  const shape = bust || hips || weight ? { ...(bust ? { bust } : {}), ...(hips ? { hips } : {}), ...(weight ? { weight } : {}) } : undefined
  return { version: 2, body: a.body, skin, slots, ...(height ? { height } : {}), ...(shape ? { shape } : {}) }
}

/** A cabeça que vale (a escolhida, já conferida) — as expressões olham pra ela. */
function headChoice(data: CharacterData, a: Appearance): AppearanceItem {
  const chosen = a.slots.head
  const item = chosen && data.byId.get(chosen.id)
  return item && item.slot === 'head' && item.bodies.includes(a.body) ? chosen : (DEFAULTS[baseOf(a.body)].head)
}

const NATURAL_SKINS = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black']
const OPTIONAL_CHANCE: Record<string, number> = {
  hair: 0.92, legs: 1, clothes: 1, shoes: 0.9, beard: 0.2, mustache: 0.15, hat: 0.25, belt: 0.3, cape: 0.12,
  vest: 0.12, jacket: 0.15, neck: 0.15, earrings: 0.15, facial: 0.08, bandana: 0.06, arms: 0.1, socks: 0.1,
  scar_eye_l: 0.05, scar_eye_r: 0.05, scar_mouth: 0.05, apron: 0.05, backpack: 0.08, gloves: 0.06, shoulders: 0.06,
  skin_spots: 0.2, scar_face: 0.1, makeup_lips: 0.18, makeup_eyes: 0.12, makeup_cheeks: 0.12, face_paint: 0.04, tattoo_face: 0.05, expression: 0.25,
}

export function randomAppearance(data: CharacterData, rnd: () => number = Math.random): Appearance {
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)]
  const roll = rnd()
  const body: BodyType = roll < 0.32 ? 'male' : roll < 0.64 ? 'female' : roll < 0.8 ? 'muscular' : roll < 0.95 ? 'teen' : 'child'
  const skins = Object.keys(data.palettes.body ?? {})
  const skin = rnd() < 0.9 ? pick(NATURAL_SKINS.filter((s) => skins.includes(s))) : pick(skins)
  const slots: Record<string, AppearanceItem> = { body: { id: 'body/body' } }

  const heads = itemsForSlot(data, 'head', body)
  const human = heads.filter((h) => h.id.includes('/human/') && !h.id.includes('elderly') && h.id.includes(body === 'female' ? '_female' : '_male'))
  slots.head = { id: (rnd() < 0.9 && human.length ? pick(human) : pick(heads)).id }

  for (const [slot, chance] of Object.entries(OPTIONAL_CHANCE)) {
    if (rnd() > chance) continue
    // barba/bigode quase só em corpo masculino
    if ((slot === 'beard' || slot === 'mustache') && (body === 'female' || body === 'child') && rnd() < 0.95) continue
    const list = itemsForSlot(data, slot, body)
    if (list.length) slots[slot] = { id: pick(list).id }
  }
  // cores de cada canal (olhos e cabelo com paletas próprias)
  for (const chosen of Object.values(slots)) {
    const item = data.byId.get(chosen.id)!
    if (item.variants) chosen.variant = pick(item.variants)
    for (const ch of item.colors ?? []) {
      if (ch.material === 'body' && item.matchBody) continue
      const names = Object.keys(data.palettes[ch.material] ?? {})
      if (names.length) (chosen.colors ??= {})[ch.key] = pick(names)
    }
  }
  // barba e bigode da cor do cabelo
  const hairColor = slots.hair?.colors?.color
  for (const s of ['beard', 'mustache']) if (slots[s] && hairColor) slots[s].colors = { color: hairColor }
  // altura: quase sempre média
  const height = rnd() < 0.6 ? 1 : pick([...HEIGHTS])
  const lvl = () => { const r = rnd(); return r < 0.2 ? -1 : r < 0.75 ? 0 : 1 }
  const shape = { bust: lvl(), hips: lvl(), weight: rnd() < 0.7 ? 0 : lvl() }
  return normalizeAppearance(data, { version: 2, body, skin, slots, height, shape })
}
