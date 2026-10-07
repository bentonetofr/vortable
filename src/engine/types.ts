// ────────────────────────────────────────────────────────
// Formatos de dados do Vortable. Tudo aqui é JSON puro: é o que vai
// ser salvo (hoje no navegador, depois no Supabase do Vorterium).
// ────────────────────────────────────────────────────────

export const TILE = 32

export type Dir = 'up' | 'left' | 'down' | 'right'

/** Uma zona: um pedaço do mundo carregado de uma vez. */
export interface ZoneData {
  version: 1
  id: string
  name: string
  /** Tamanho em tiles. */
  width: number
  height: number
  /** Terreno que cobre a zona inteira por baixo de tudo. */
  base: string
  /**
   * Terreno de cada vértice da grade, (width+1) × (height+1), linha a linha.
   * '' = terreno base. As bordas entre terrenos saem daqui (autotile).
   */
  corners: string[]
  objects: ZoneObject[]
  /** Onde o jogador aparece, em pixels. */
  spawn: { x: number; y: number }
}

/** Um objeto colocado na zona. kind = id no catálogo; x/y = base-centro, em px. */
export interface ZoneObject {
  kind: string
  x: number
  y: number
}

export const ZONE_MIN = 8
export const ZONE_MAX = 128

/** Tamanho válido de zona: inteiro entre ZONE_MIN e ZONE_MAX (vazio/inválido → `fallback`). */
export function clampZoneSize(n: number, fallback: number) {
  const v = Math.round(n)
  return Number.isFinite(v) && v > 0 ? Math.max(ZONE_MIN, Math.min(ZONE_MAX, v)) : fallback
}

export function newZone(name: string, width: number, height: number, base = 'grass'): ZoneData {
  width = clampZoneSize(width, 40)
  height = clampZoneSize(height, 30)
  return {
    version: 1,
    id: `zona-${Date.now().toString(36)}`,
    name,
    width,
    height,
    base,
    corners: new Array((width + 1) * (height + 1)).fill(''),
    objects: [],
    spawn: { x: (width * TILE) / 2, y: (height * TILE) / 2 },
  }
}

/** Uma cor escolhida de uma paleta LPC (ex.: material 'hair', cor 'ginger'). */
export interface PaletteChoice {
  material: string
  color: string
}

/** Uma camada da aparência: qual folha LPC e com qual cor. */
export interface AppearanceLayer {
  sheet: string
  palette?: PaletteChoice
}

export interface Appearance {
  layers: AppearanceLayer[]
}
