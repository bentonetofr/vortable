// ────────────────────────────────────────────────────────
// Catálogo de objetos (gerado por scripts/build-catalog.mjs a partir dos
// pacotes de arte). Carregado uma vez pela BootScene e consultado pelo
// editor e pelo jogo.
// ────────────────────────────────────────────────────────

import type { ZoneObject } from '../types'

/**
 * Como o objeto se comporta na cena:
 *   stand = em pé: ordenado pela linha do pé (y-sort), pode colidir
 *   floor = no chão: sempre por baixo de quem anda (tapete, folhas)
 *   wall  = na parede: ordenado pela base, sem colisão (quadro, tocha)
 *   over  = por cima de tudo; fica transparente com alguém embaixo (telhado, copa)
 */
export type ObjectKind = 'stand' | 'floor' | 'wall' | 'over'

export const KIND_LABELS: Record<ObjectKind, string> = {
  stand: 'Em pé',
  floor: 'No chão',
  wall: 'Na parede',
  over: 'Por cima',
}

/** Retângulo relativo à base-centro do objeto (y negativo = pra cima). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Luz própria do objeto (usada pela iluminação, M3.5). x/y relativos à base-centro. */
export interface ObjectLight {
  x: number
  y: number
  radius: number
  color: string
  intensity: number
  /** 0 = luz parada; 1 = tremula muito (fogo). */
  flicker: number
}

export interface ObjectDef {
  /** `${folha}@${x},${y}` — posição na folha original, estável entre versões. */
  id: string
  pack: string
  sheet: string
  category: string
  label: string
  tags: string[]
  kind: ObjectKind
  /** Quadro (o primeiro, se animado) na folha gerada. */
  x: number
  y: number
  w: number
  h: number
  /** O que colide (vazio = atravessável). */
  solids: Rect[]
  /** Linha de profundidade: px acima da base (o pé, sem a sombra). */
  sort: number
  anim?: { fps: number; frames: [number, number][] }
  light?: ObjectLight
  /** Peça base do grupo de variantes (cores/estados da mesma peça). */
  group?: string
  variant?: string
}

export interface PackInfo {
  id: string
  name: string
  license: string
  credits: string
}

export interface ObjectCatalog {
  packs: PackInfo[]
  sheets: { id: string; pack: string; url: string }[]
  objects: ObjectDef[]
}

export const CATALOG_URL = 'catalog/objects.json'
export const sheetTexture = (sheet: string) => `obj:${sheet}`
export const animKey = (id: string) => `obj:${id}`
export const animFrame = (id: string, n: number) => (n === 0 ? id : `${id}#${n}`)

let catalog: ObjectCatalog = { packs: [], sheets: [], objects: [] }
let byId = new Map<string, ObjectDef>()
let groups = new Map<string, ObjectDef[]>()

export function setObjectCatalog(c: ObjectCatalog) {
  catalog = c
  byId = new Map(c.objects.map((o) => [o.id, o]))
  groups = new Map()
  for (const o of c.objects) if (o.group) groups.set(o.group, [...(groups.get(o.group) ?? []), o])
}

export const objectCatalog = () => catalog
export const objectDef = (id: string) => byId.get(id)

/** Variantes da peça (ela inclusa), ou só ela. */
export const variantsOf = (def: ObjectDef) => (def.group ? groups.get(def.group) ?? [def] : [def])

/** Peças que aparecem na paleta: uma por grupo de variantes. */
export const paletteObjects = () => catalog.objects.filter((o) => !o.group || o.group === o.id)

/** Curadoria: troca a definição de uma peça já carregada (os sprites são refeitos por quem chamou). */
export function patchObjectDef(def: ObjectDef) {
  const old = byId.get(def.id)
  if (!old) return
  Object.assign(old, def)
}

const DEPTH_FLOOR = -500_000
const DEPTH_OVER = 500_000

/**
 * Profundidade de desenho. Em pé: a linha do pé, não a borda de baixo do
 * sprite (que inclui a sombra) — quem pisa na sombra, na frente do tronco,
 * aparece na frente da árvore.
 */
export function objectDepth(def: ObjectDef | undefined, y: number) {
  if (!def) return y
  if (def.kind === 'floor') return DEPTH_FLOOR + y
  if (def.kind === 'over') return DEPTH_OVER + y
  return y - def.sort
}

/** Retângulos que colidem de um objeto colocado, em px do mundo. */
export function objectSolids(def: ObjectDef, o: Pick<ZoneObject, 'x' | 'y' | 'flip'>): Rect[] {
  return def.solids.map((r) => ({ x: o.x + (o.flip ? -r.x - r.w : r.x), y: o.y + r.y, w: r.w, h: r.h }))
}
