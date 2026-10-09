// ────────────────────────────────────────────────────────
// Gerador de NPCs: sorteia gente que combina com o lugar (estilo vindo da
// análise da zona), mas cada uma com rosto, cabelo e roupa diferentes.
// Só pele humana natural: brancas, pardas e negras. Cabelos, olhos e barbas
// também só em cores naturais.
// ────────────────────────────────────────────────────────

import type { Appearance, AppearanceItem, BodyType } from '../types'
import { itemsForSlot, normalizeAppearance, type CharItem, type CharacterData } from '../character/catalog'
import type { ProfileId } from './analyze'
import { HAIR_STYLES, PROFILES, type Age, type Outfit, type Role, type SlotSpec } from './profiles'

export type Rng = () => number

/** O que sai do gerador (ainda sem lugar no mapa). */
export interface NpcDraft {
  name: string
  role: string
  appearance: Appearance
  /** NPC especial: a ficha a que pertence (o gerador não usa). */
  sheet?: string
}

/** Famílias de tom de pele aceitas, cada uma com as cores da paleta que a representam. */
export const SKIN_FAMILIES = {
  branca: ['light'],
  parda: ['amber', 'olive', 'taupe', 'bronze'],
  negra: ['brown', 'black'],
} as const
export type SkinFamily = keyof typeof SKIN_FAMILIES

// só tons naturais (os castanhos do LPC puxam pro laranja: cocoa e umber, criados por nós, são os castanhos "de verdade")
const HAIR_COLORS: Record<SkinFamily, string[]> = {
  branca: ['black', 'cocoa', 'umber', 'light_brown', 'chestnut', 'sandy', 'blonde', 'ginger', 'strawberry', 'umber', 'cocoa'],
  parda: ['black', 'cocoa', 'umber', 'black', 'umber', 'cocoa'],
  negra: ['black', 'black', 'cocoa', 'umber', 'dark_gray'],
}
/** Cores de roupa que somem contra a pele (parece que a pessoa está sem camisa). */
const SKIN_CLASH: Record<SkinFamily, string[]> = {
  branca: ['rose', 'pink', 'tan'],
  parda: ['brown', 'walnut', 'tan', 'leather', 'orange', 'rose', 'espresso'],
  negra: ['brown', 'walnut', 'tan', 'leather', 'espresso', 'charcoal', 'black', 'orange'],
}
const ELDER_HAIR = ['gray', 'white', 'dark_gray', 'gray']
const EYE_COLORS = ['brown', 'brown', 'brown', 'brown', 'green', 'gray', 'blue']

const MALE_NAMES = ['Aurélio', 'Benício', 'Cássio', 'Davi', 'Eládio', 'Fausto', 'Gaspar', 'Heitor', 'Isidoro', 'Joaquim', 'Leandro', 'Matias', 'Nestor', 'Otávio', 'Rúben', 'Silvestre', 'Tadeu', 'Ulisses', 'Valério', 'Xavier', 'Abel', 'Bento', 'Caetano', 'Dimas', 'Elias', 'Félix', 'Gil', 'Hugo']
const FEMALE_NAMES = ['Adélia', 'Beatriz', 'Cecília', 'Dalila', 'Eulália', 'Fabíola', 'Gabriela', 'Helena', 'Ísis', 'Joana', 'Lívia', 'Marta', 'Nair', 'Olívia', 'Pietra', 'Quitéria', 'Rosana', 'Sílvia', 'Tereza', 'Valéria', 'Zélia', 'Alice', 'Bianca', 'Clara', 'Dora', 'Elisa', 'Flora', 'Graça']
const SURNAMES = ['Albuquerque', 'Barbosa', 'Cardoso', 'Duarte', 'Esteves', 'Furtado', 'Guedes', 'Horta', 'Ivo', 'Junqueira', 'Lacerda', 'Moura', 'Nogueira', 'Oliveira', 'Paiva', 'Queiroz', 'Rangel', 'Siqueira', 'Teixeira', 'Valadares', 'Xavier', 'Pimentel', 'Sampaio', 'Tavares', 'Brandão', 'Coelho', 'Ferraz', 'Lobo']

const pick = <T,>(list: readonly T[], rnd: Rng): T => list[Math.floor(rnd() * list.length)]

function weighted<T extends { weight: number }>(list: T[], rnd: Rng): T {
  const total = list.reduce((n, x) => n + x.weight, 0)
  let r = rnd() * total
  for (const x of list) { r -= x.weight; if (r <= 0) return x }
  return list[list.length - 1]
}

function shuffle<T>(list: T[], rnd: Rng): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const LONG_SHIRT = /shirts\/longsleeve\//

/** As cores do papel sem as que somem contra a pele (se sobrar alguma). */
function safeColors(spec: SlotSpec, family: SkinFamily): SlotSpec {
  if (!spec.colors) return spec
  const ok = spec.colors.filter((c) => !SKIN_CLASH[family].includes(c))
  return { ...spec, colors: ok.length ? ok : ['navy', 'forest', 'maroon', 'gray'] }
}

/** Escolhe uma peça do espaço dentro das opções do papel, já com cor e variante. */
function choose(data: CharacterData, slot: string, body: BodyType, specs: SlotSpec[] | undefined, rnd: Rng, force = false): AppearanceItem | null {
  if (!specs?.length) return null
  const order = shuffle(specs, rnd)
  for (const spec of order) {
    if (!force && rnd() > (spec.chance ?? 1)) continue
    const items = itemsForSlot(data, slot, body).filter((i) => spec.re.test(i.id))
    if (!items.length) continue
    return dress(data, pick(items, rnd), spec.colors, rnd)
  }
  return null
}

/** Cor do item: uma das preferidas que existe na paleta/variantes; senão, qualquer uma da paleta. */
function dress(data: CharacterData, item: CharItem, prefer: string[] | undefined, rnd: Rng): AppearanceItem {
  const out: AppearanceItem = { id: item.id }
  if (item.variants?.length) {
    const ok = prefer?.filter((c) => item.variants!.includes(c)) ?? []
    out.variant = ok.length ? pick(ok, rnd) : pick(item.variants, rnd)
  }
  for (const ch of item.colors ?? []) {
    if (ch.material === 'body' && item.matchBody) continue
    const names = Object.keys(data.palettes[ch.material] ?? {})
    if (!names.length) continue
    const ok = prefer?.filter((c) => names.includes(c)) ?? []
    ;(out.colors ??= {})[ch.key] = ok.length ? pick(ok, rnd) : pick(names, rnd)
  }
  return out
}

function hairFor(data: CharacterData, body: BodyType, sex: 'male' | 'female', style: Outfit['hair'], elder: boolean, family: SkinFamily, rnd: Rng, taken: Set<string>): AppearanceItem | null {
  const hairs = itemsForSlot(data, 'hair', body)
  const key = elder ? 'elder' : style
  const re = HAIR_STYLES[key][sex]
  // um quinto das vezes vale qualquer estilo "parente" (cabelo de homem em mulher e vice-versa), pra não ficar tudo igual
  let pool = hairs.filter((h) => re.test(h.id) && !taken.has(h.id))
  if (!pool.length) pool = hairs.filter((h) => re.test(h.id))
  if (rnd() < 0.2) {
    const other = HAIR_STYLES[key][sex === 'male' ? 'female' : 'male']
    const alt = hairs.filter((h) => other.test(h.id) && !taken.has(h.id))
    if (alt.length) pool = alt
  }
  if (!pool.length) return null
  const item = pick(pool, rnd)
  const colorPool = elder ? ELDER_HAIR : HAIR_COLORS[family]
  return dress(data, item, [pick(colorPool, rnd)], rnd)
}

/** Cabeça humana do corpo e da idade. */
function headFor(data: CharacterData, body: BodyType, sex: 'male' | 'female', elder: boolean, rnd: Rng): AppearanceItem {
  const heads = itemsForSlot(data, 'head', body).filter((h) => h.id.includes('/human/') && !/_small$/.test(h.id))
  const byAge = heads.filter((h) => (elder ? /elderly/.test(h.id) : !/elderly/.test(h.id)))
  let pool = byAge.length ? byAge : heads
  // homens: um pouco de variedade de rosto (magro, robusto)
  if (sex === 'male' && !elder && rnd() < 0.25) {
    const odd = pool.filter((h) => /gaunt|plump/.test(h.id))
    if (odd.length) pool = odd
  } else if (sex === 'male' && !elder) {
    pool = pool.filter((h) => !/gaunt|plump/.test(h.id)).length ? pool.filter((h) => !/gaunt|plump/.test(h.id)) : pool
  }
  const head = pick(pool, rnd)
  return { id: head.id, colors: { color_2: pick(EYE_COLORS, rnd) } }
}

export interface GenerateOptions {
  rnd?: Rng
  /** Estilo do lugar (da análise da zona). */
  profile: ProfileId
  /** Família de pele; sem ela, sorteia. */
  skin?: SkinFamily
  /** Força uma ocupação (pelo rótulo masculino). */
  role?: string
  /** Cabelos e looks já usados nesta leva (pra não repetir). */
  avoid?: { hair: Set<string>; looks: Set<string>; roles: Map<string, number> }
}

export function generateNpc(data: CharacterData, opts: GenerateOptions): NpcDraft {
  const rnd = opts.rnd ?? Math.random
  const roles = PROFILES[opts.profile] ?? PROFILES.geral
  const avoid = opts.avoid

  // ocupação (as já muito usadas na leva perdem peso)
  const candidates = roles.map((r): Role => ({ ...r, weight: r.weight / (1 + (avoid?.roles.get(r.label[0]) ?? 0) * 1.5) }))
  const role = (opts.role && candidates.find((r) => r.label[0] === opts.role)) || weighted(candidates, rnd)

  const sex: 'male' | 'female' = rnd() < 0.5 ? 'male' : 'female'
  const family = opts.skin ?? pick(Object.keys(SKIN_FAMILIES) as SkinFamily[], rnd)
  const skin = pick(SKIN_FAMILIES[family], rnd)
  const o = role.outfit
  const ageRule: Age = o.age ?? 'adult'
  const elder = ageRule === 'elder' || (ageRule !== 'adult' ? rnd() < 0.35 : rnd() < 0.08)

  // corpo: o do sexo; o ferreiro (e às vezes o prisioneiro) é musculoso; gente jovem das casas e do campo pode ser esguia
  let body: BodyType = sex
  const job = role.label[0]
  if (sex === 'male' && !elder && ((job === 'Ferreiro' && rnd() < 0.55) || (job === 'Prisioneiro' && rnd() < 0.25))) body = 'muscular'
  else if (!elder && ['Criado', 'Peão', 'Garçom', 'Cliente', 'Freguês', 'Morador', 'Estudioso'].includes(job) && rnd() < 0.18) body = 'teen'

  const slots: Record<string, AppearanceItem> = { body: { id: 'body/body' }, head: headFor(data, body, sex, elder, rnd) }

  const hair = hairFor(data, body, sex, o.hair, elder, family, rnd, avoid?.hair ?? new Set())
  if (hair) {
    slots.hair = hair
    const color = hair.colors?.color
    // sobrancelhas combinando com o cabelo (às vezes só um tom mais escuro)
    const brow = choose(data, 'eyebrows', body, [{ re: /eyebrows_(thick|thin)/, chance: 1 }], rnd, true)
    if (brow) { brow.colors = { color: color && rnd() < 0.8 ? color : 'black' }; slots.eyebrows = brow }
    if (sex === 'male' && o.beard && rnd() < (elder ? Math.max(o.beard, 0.45) : o.beard)) {
      const beard = choose(data, rnd() < 0.7 ? 'beard' : 'mustache', body, [{ re: /beards_/ }], rnd, true)
      if (beard) { if (color) beard.colors = { color }; slots[slotOf(data, beard)] = beard }
    }
  }

  // vestido (mulher): substitui blusa, colete e calça
  let dressed = false
  if (sex === 'female' && o.dress) {
    const d = choose(data, 'dress', body, o.dress, rnd)
    if (d) { slots.dress = d; dressed = true }
  }
  if (!dressed) {
    const put = (slot: string, specs?: SlotSpec[], force = false) => { const it = choose(data, slot, body, specs, rnd, force); if (it) slots[slot] = it }
    // armadura substitui a camisa; senão, camisa
    if (o.armour) put('armour', o.armour, true)
    else put('clothes', o.clothes?.map((sp) => safeColors(sp, family)), true)
    put('vest', o.vest)
    put('jacket', o.jacket)
    put('legs', o.legs, true)
  }
  // sem camisa nem armadura (ex.: roupa que só existe pro outro corpo): uma camisa comprida nas cores do papel
  if (!dressed && !slots.clothes && !slots.armour) {
    const it = choose(data, 'clothes', body, [{ re: LONG_SHIRT, colors: safeColors(o.clothes?.[0] ?? { re: LONG_SHIRT }, family).colors }], rnd, true)
    if (it) slots.clothes = it
  }
  const extra = (slot: string, specs?: SlotSpec[], force = false) => { const it = choose(data, slot, body, specs, rnd, force); if (it) slots[slot] = it }
  extra('shoes', o.shoes, true)
  extra('hat', o.hat)
  extra('neck', o.neck)
  extra('cape', o.cape)
  extra('apron', o.apron)
  extra('belt', o.belt)
  extra('gloves', o.gloves)
  extra('arms', o.arms)
  extra('backpack', o.backpack)
  extra('facial', o.facial)

  flavor(data, body, sex, role, elder, slots, rnd)
  // altura: gente comum é de altura média; um pouco de variedade (idosos tendem a ser mais baixos)
  const hr = rnd()
  const height = elder ? (hr < 0.5 ? 0.92 : 1) : hr < 0.6 ? 1 : hr < 0.8 ? 0.92 : hr < 0.95 ? 1.08 : 0.84
  const appearance = normalizeAppearance(data, { version: 2, body, skin, slots, height })

  // nome e registro do que foi usado (a leva evita repetir)
  const first = pick(sex === 'male' ? MALE_NAMES : FEMALE_NAMES, rnd)
  const name = `${first} ${pick(SURNAMES, rnd)}`
  const label = role.label[sex === 'male' ? 0 : 1]
  if (avoid) {
    if (appearance.slots.hair) avoid.hair.add(appearance.slots.hair.id)
    avoid.roles.set(role.label[0], (avoid.roles.get(role.label[0]) ?? 0) + 1)
    avoid.looks.add(`${appearance.slots.clothes?.id ?? appearance.slots.dress?.id}:${JSON.stringify(appearance.slots.clothes?.colors ?? appearance.slots.clothes?.variant ?? '')}`)
  }
  return { name, role: label, appearance }
}

/** Ocupações que costumam ter cicatriz, tatuagem ou maquiagem. */
const ROUGH = ['Guarda do palácio', 'Guarda da vila', 'Guarda', 'Vigia', 'Carcereiro', 'Prisioneiro', 'Aventureiro', 'Batedor', 'Caçador', 'Montanhês', 'Ferreiro', 'Taverneiro']
const SHOWY = ['Nobre', 'Bardo', 'Garçom', 'Criado', 'Cliente', 'Freguês', 'Mercador', 'Comerciante']
const NATURAL: Record<string, string[]> = {
  freckle: ['castanho', 'ruivo', 'claro', 'escuro', 'dourado'],
  scar: ['palida', 'antiga', 'branca', 'fresca'],
  lip: ['vermelho', 'rosa', 'vinho', 'nude', 'coral', 'ameixa'],
  shadow: ['preto', 'marrom', 'cinza', 'roxo'],
  blush: ['rosa', 'pessego', 'coral'],
  ink: ['preto', 'azul_escuro', 'verde_escuro', 'cinza'],
  paint: ['branco', 'vermelho', 'preto', 'verde', 'azul'],
}

/** Marcas do rosto (sardas, cicatrizes, maquiagem, tatuagem) e expressão: dão personalidade sem tirar o ar de gente comum. */
function flavor(data: CharacterData, body: BodyType, sex: 'male' | 'female', role: Role, elder: boolean, slots: Record<string, AppearanceItem>, rnd: Rng) {
  const job = role.label[0]
  const put = (slot: string, chance: number, only?: RegExp) => {
    if (rnd() > chance) return
    const items = itemsForSlot(data, slot, body).filter((i) => i.proc && (!only || only.test(i.id)))
    if (!items.length) return
    const item = pick(items, rnd)
    const palette = item.colors?.[0]?.material
    slots[slot] = dress(data, item, palette ? NATURAL[palette] : undefined, rnd)
  }
  const rough = ROUGH.includes(job)
  put('skin_spots', elder ? 0.5 : 0.22, elder ? /manchas_idade|olheiras|sardas_leves/ : /sardas|pinta|acne|fuligem|queimado|olheiras/)
  put('scar_face', rough ? 0.3 : 0.04)
  if (sex === 'female' || SHOWY.includes(job)) {
    put('makeup_lips', sex === 'female' ? (SHOWY.includes(job) ? 0.5 : 0.14) : 0.03, /batom_(fino|cheio)|gloss/)
    put('makeup_cheeks', sex === 'female' && SHOWY.includes(job) ? 0.35 : 0.06, /blush_suave|rubor/)
    put('makeup_eyes', sex === 'female' && SHOWY.includes(job) ? 0.2 : 0.03, /delineado|sombra/)
  }
  if (job === 'Bardo') put('face_paint', 0.18)
  if (rough || job === 'Andarilho') put('tattoo_face', 0.1)
  // expressão: quase todos de rosto neutro, alguns com uma cara marcada
  if (rnd() < 0.18 && !elder) {
    const faces = itemsForSlot(data, 'expression', body).filter((i) => !i.proc && /happy|sad|angry|shame|neutral|blush/i.test(i.name))
    if (faces.length) slots.expression = dress(data, pick(faces, rnd), EYE_COLORS, rnd)
  }
}

/** Espaço (slot) de um item do catálogo. */
function slotOf(data: CharacterData, item: AppearanceItem) {
  return data.byId.get(item.id)?.slot ?? 'beard'
}

/**
 * Uma leva de NPCs variados: peles em rodízio (brancas, pardas e negras), cabelos e
 * ocupações sem repetir demais.
 */
export function generateBatch(data: CharacterData, profile: ProfileId, count: number, rnd: Rng = Math.random): NpcDraft[] {
  const avoid = { hair: new Set<string>(), looks: new Set<string>(), roles: new Map<string, number>() }
  const families = shuffle(Object.keys(SKIN_FAMILIES) as SkinFamily[], rnd)
  const out: NpcDraft[] = []
  for (let i = 0; i < count; i++) {
    out.push(generateNpc(data, { rnd, profile, skin: families[i % families.length], avoid }))
  }
  return shuffle(out, rnd)
}
