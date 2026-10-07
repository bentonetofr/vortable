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
   * '' = só o terreno base. As bordas entre terrenos saem daqui (autotile).
   */
  corners: string[]
  objects: ZoneObject[]
  /** Onde o jogador aparece, em pixels. */
  spawn: { x: number; y: number }
}

/** Um objeto colocado na zona (árvore, pedra, casa...). x/y = base do objeto, em pixels. */
export interface ZoneObject {
  kind: string
  x: number
  y: number
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
