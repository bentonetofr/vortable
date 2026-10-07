// ────────────────────────────────────────────────────────
// Catálogo de arte: terrenos, objetos e camadas de personagem LPC.
// Caminhos relativos à pasta de assets (opção assetBase do motor).
// ────────────────────────────────────────────────────────

/** Terreno no formato LPC: folha 3×6 de tiles 32px (cantos, bordas, miolo). */
export interface TerrainDef {
  id: string
  label: string
  url: string
  /** Quem tem rank maior é desenhado por cima. */
  rank: number
  /** Não dá pra andar por cima (água, lava). */
  solid?: boolean
}

export const TERRAINS: TerrainDef[] = [
  { id: 'grass', label: 'Grama', url: 'lpc/tiles/grass.png', rank: 0 },
  { id: 'dirt',  label: 'Terra', url: 'lpc/tiles/dirt.png',  rank: 1 },
  { id: 'water', label: 'Água',  url: 'lpc/tiles/water.png', rank: 2, solid: true },
]

export const terrainById = new Map(TERRAINS.map((t) => [t.id, t]))

/** Folha com vários objetos soltos; os retângulos vêm de scripts/extract-sprites.mjs. */
export interface ObjectSheetDef {
  id: string
  url: string
  rects: string
}

export const OBJECT_SHEETS: ObjectSheetDef[] = [
  { id: 'trees-green', url: 'lpc/tiles/trees-green.png', rects: 'lpc/tiles/trees-green.json' },
]

export interface ObjectDef {
  id: string
  label: string
  sheet: string
  /** Índice do retângulo no JSON da folha. */
  rect: number
  /**
   * Pé do objeto (o que colide), relativo à base-centro do sprite:
   * w×h em px, subindo `lift` px a partir da borda de baixo (pula a sombra).
   */
  foot: { w: number; h: number; lift: number }
}

export const OBJECTS: ObjectDef[] = [
  { id: 'tree-round',   label: 'Árvore redonda', sheet: 'trees-green', rect: 24, foot: { w: 18, h: 10, lift: 12 } },
  { id: 'tree-tall',    label: 'Árvore alta',    sheet: 'trees-green', rect: 26, foot: { w: 18, h: 10, lift: 14 } },
  { id: 'tree-old',     label: 'Árvore velha',   sheet: 'trees-green', rect: 27, foot: { w: 22, h: 10, lift: 14 } },
  { id: 'tree-leafy',   label: 'Árvore frondosa', sheet: 'trees-green', rect: 28, foot: { w: 22, h: 10, lift: 14 } },
  { id: 'tree-pine',    label: 'Pinheiro',       sheet: 'trees-green', rect: 23, foot: { w: 12, h: 8,  lift: 8 } },
  { id: 'tree-big',     label: 'Árvore grande',  sheet: 'trees-green', rect: 33, foot: { w: 30, h: 12, lift: 20 } },
  { id: 'bush',         label: 'Arbusto',        sheet: 'trees-green', rect: 25, foot: { w: 60, h: 14, lift: 6 } },
]

export const objectById = new Map(OBJECTS.map((o) => [o.id, o]))

// ── Personagem ───────────────────────────────────────────

/** Uma camada LPC (folhas no formato do Universal LPC Spritesheet Generator). */
export interface CharacterSheetDef {
  id: string
  label: string
  /** Pasta com walk.png, idle.png, run.png... */
  dir: string
  /** Ordem de desenho (zPos do LPC). */
  z: number
  /** Material da paleta (body, hair, cloth, eye) — as cores da folha são a paleta base dele. */
  material: string
}

export const CHARACTER_SHEETS: CharacterSheetDef[] = [
  { id: 'body',             label: 'Corpo',         dir: 'lpc/character/body',             z: 10,  material: 'body' },
  { id: 'feet_shoes',       label: 'Sapatos',       dir: 'lpc/character/feet_shoes',       z: 15,  material: 'cloth' },
  { id: 'legs_pants',       label: 'Calça',         dir: 'lpc/character/legs_pants',       z: 20,  material: 'cloth' },
  { id: 'torso_longsleeve', label: 'Camisa longa',  dir: 'lpc/character/torso_longsleeve', z: 35,  material: 'cloth' },
  { id: 'head',             label: 'Cabeça',        dir: 'lpc/character/head',             z: 100, material: 'body' },
  { id: 'eyes',             label: 'Olhos',         dir: 'lpc/character/eyes',             z: 105, material: 'eye' },
  { id: 'hair_messy1',      label: 'Cabelo bagunçado', dir: 'lpc/character/hair_messy1',   z: 120, material: 'hair' },
]

export const characterSheetById = new Map(CHARACTER_SHEETS.map((s) => [s.id, s]))

/** Paletas LPC por material; `base` = a paleta em que as folhas foram desenhadas. */
export const PALETTES: Record<string, { url: string; base: string }> = {
  body:  { url: 'lpc/palettes/body_ulpc.json',  base: 'light' },
  hair:  { url: 'lpc/palettes/hair_ulpc.json',  base: 'orange' },
  cloth: { url: 'lpc/palettes/cloth_ulpc.json', base: 'white' },
  eye:   { url: 'lpc/palettes/eye_ulpc.json',   base: 'blue' },
}

/** Animações LPC: quadros por linha; linhas sempre up, left, down, right. */
export const ANIMS = {
  walk: { frames: 9, rate: 10 },
  run:  { frames: 8, rate: 12 },
  idle: { frames: 2, rate: 2 },
} as const

export type AnimName = keyof typeof ANIMS
export const FRAME = 64
