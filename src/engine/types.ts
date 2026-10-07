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
  /** Saídas: áreas que levam a outra zona (porta, escada, borda do mapa). */
  portals: Portal[]
  /** Onde o jogador aparece quando entra no mundo por esta zona, em pixels. */
  spawn: { x: number; y: number }
}

/**
 * Uma saída: retângulo (px) que, ao ser pisado, leva pra outra zona. Quem
 * chega por uma saída aparece no meio da saída de destino.
 */
export interface Portal {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  /** Pra onde leva (zona + saída de lá). null = ainda não ligada. */
  to: { zone: string; portal: string } | null
}

/** O mundo: as zonas de uma campanha e como elas aparecem no mapa do mundo. */
export interface WorldData {
  version: 1
  id: string
  name: string
  /** Zona onde os jogadores começam. */
  start: string | null
  /** Posição de cada zona no mapa do mundo (só visual). */
  layout: Record<string, { x: number; y: number }>
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
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
    id: newId('zona'),
    name,
    width,
    height,
    base,
    corners: new Array((width + 1) * (height + 1)).fill(''),
    objects: [],
    portals: [],
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
