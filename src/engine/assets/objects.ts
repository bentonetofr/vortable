// ────────────────────────────────────────────────────────
// Catálogo de objetos (gerado por scripts/build-catalog.mjs). Carregado
// uma vez pela BootScene e consultado pelo editor e pelo jogo.
// ────────────────────────────────────────────────────────

export interface ObjectDef {
  /** `${folha}@${x},${y}` — posição na folha, estável entre versões do catálogo. */
  id: string
  sheet: string
  category: string
  label: string
  x: number
  y: number
  w: number
  h: number
  /** Pé (o que colide), relativo à base-centro do sprite. null = não colide. */
  foot: { w: number; h: number; lift: number; dx: number } | null
}

export interface ObjectCatalog {
  sheets: { id: string; url: string }[]
  objects: ObjectDef[]
}

export const CATALOG_URL = 'catalog/objects.json'
export const sheetTexture = (sheet: string) => `obj:${sheet}`

let catalog: ObjectCatalog = { sheets: [], objects: [] }
let byId = new Map<string, ObjectDef>()

export function setObjectCatalog(c: ObjectCatalog) {
  catalog = c
  byId = new Map(c.objects.map((o) => [o.id, o]))
}

export const objectCatalog = () => catalog
export const objectDef = (id: string) => byId.get(id)

/**
 * Profundidade de desenho: a linha do pé, não a borda de baixo do sprite
 * (que inclui a sombra). Assim quem pisa na sombra, na frente do tronco,
 * aparece na frente da árvore.
 */
export function objectDepth(def: ObjectDef | undefined, y: number) {
  return y - (def?.foot?.lift ?? 0)
}

/** Retângulo que colide de um objeto colocado em (x, y) (base-centro), em px do mundo. */
export function footRect(def: ObjectDef, x: number, y: number) {
  if (!def.foot) return null
  const { w, h, lift, dx } = def.foot
  return { x: x + dx - w / 2, y: y - lift - h, w, h }
}
