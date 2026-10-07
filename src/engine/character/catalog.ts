// ────────────────────────────────────────────────────────
// Catálogo do personagem (gerado por scripts/build-character-catalog.mjs
// a partir do Universal LPC Spritesheet Character Generator): espaços
// (cabelo, camisa...), itens, camadas, canais de cor e variantes.
// ────────────────────────────────────────────────────────

import type { Appearance, AppearanceItem, BodyType } from '../types'

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

export const BODY_LABELS: Record<BodyType, string> = { male: 'Masculino', female: 'Feminino' }

/** Cor representativa de uma rampa (pra amostras). */
export function swatch(palettes: CharPalettes, material: string, color: string) {
  const ramp = palettes[material]?.[color]
  return ramp ? ramp[Math.min(ramp.length - 1, Math.floor(ramp.length * 0.6))] : '#888'
}

export function itemsForSlot(data: CharacterData, slot: string, body: BodyType) {
  return data.catalog.items.filter((i) => i.slot === slot && i.bodies.includes(body))
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
}

/** Nomes inteiros que pedem tradução própria. */
const NAMES: Record<string, string> = { 'Body Color': 'Humano' }

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

const DEFAULTS: Record<BodyType, Record<string, AppearanceItem>> = {
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

export function defaultAppearance(body: BodyType = 'male'): Appearance {
  return { version: 2, body, skin: 'light', slots: structuredClone(DEFAULTS[body]) }
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
    if (item && item.slot === s.id && item.bodies.includes(a.body)) {
      const variant = item.variants ? (item.variants.includes(chosen.variant ?? '') ? chosen.variant : item.variants[0]) : undefined
      const colors: Record<string, string> = {}
      for (const ch of item.colors ?? []) {
        const c = chosen.colors?.[ch.key]
        if (c && data.palettes[ch.material]?.[c]) colors[ch.key] = c
      }
      slots[s.id] = { id: item.id, ...(variant ? { variant } : {}), ...(Object.keys(colors).length ? { colors } : {}) }
    } else if (s.required) {
      const fallback = DEFAULTS[a.body][s.id] ?? { id: itemsForSlot(data, s.id, a.body)[0]?.id }
      if (fallback.id) slots[s.id] = structuredClone(fallback)
    }
  }
  const skin = data.palettes.body?.[a.skin] ? a.skin : 'light'
  return { version: 2, body: a.body, skin, slots }
}

const NATURAL_SKINS = ['light', 'amber', 'olive', 'taupe', 'bronze', 'brown', 'black']
const OPTIONAL_CHANCE: Record<string, number> = {
  hair: 0.92, legs: 1, clothes: 1, shoes: 0.9, beard: 0.2, mustache: 0.15, hat: 0.25, belt: 0.3, cape: 0.12,
  vest: 0.12, jacket: 0.15, neck: 0.15, earrings: 0.15, facial: 0.08, bandana: 0.06, arms: 0.1, socks: 0.1,
  scar_eye_l: 0.05, scar_eye_r: 0.05, scar_mouth: 0.05, apron: 0.05, backpack: 0.08, gloves: 0.06, shoulders: 0.06,
}

export function randomAppearance(data: CharacterData, rnd: () => number = Math.random): Appearance {
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)]
  const body: BodyType = rnd() < 0.5 ? 'male' : 'female'
  const skins = Object.keys(data.palettes.body ?? {})
  const skin = rnd() < 0.9 ? pick(NATURAL_SKINS.filter((s) => skins.includes(s))) : pick(skins)
  const slots: Record<string, AppearanceItem> = { body: { id: 'body/body' } }

  const heads = itemsForSlot(data, 'head', body)
  const human = heads.filter((h) => h.id.includes('/human/') && h.id.includes(body === 'male' ? '_male' : '_female'))
  slots.head = { id: (rnd() < 0.9 && human.length ? pick(human) : pick(heads)).id }

  for (const [slot, chance] of Object.entries(OPTIONAL_CHANCE)) {
    if (rnd() > chance) continue
    // barba/bigode quase só em corpo masculino
    if ((slot === 'beard' || slot === 'mustache') && body === 'female' && rnd() < 0.95) continue
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
  return normalizeAppearance(data, { version: 2, body, skin, slots })
}
