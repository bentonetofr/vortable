// ────────────────────────────────────────────────────────
// Catálogo do personagem: camadas LPC, paletas e animações.
// Caminhos relativos à pasta de assets (opção assetBase do motor).
// Terrenos: terrains.ts · Objetos: objects.ts
// ────────────────────────────────────────────────────────

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
