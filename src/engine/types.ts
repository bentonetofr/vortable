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
  /**
   * Camada por cima do chão (molduras de teto, tapetes), no mesmo formato
   * de `corners`; '' = nada. Ausente = camada vazia.
   */
  overlay?: string[]
  /** Cercas, uma por TILE (width × height, linha a linha); '' = nada. */
  fences?: string[]
  /**
   * Cômodos (ferramenta Cômodo do editor), um valor por VÉRTICE como
   * `corners`: o estilo "piso|parede|moldura|altura" ou '' (fora). O jogo
   * não lê isto: piso, parede e moldura já ficam gravados em corners/overlay.
   */
  rooms?: string[]
  objects: ZoneObject[]
  /** Luz e hora da zona. Ausente = ao ar livre, seguindo o ciclo dia/noite. */
  lighting?: ZoneLighting
  /** Luzes soltas (ferramenta Luz), além das que os objetos já têm. */
  lights?: ZoneLight[]
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

/**
 * Onde a zona fica e que horas são lá.
 *   outdoor     = ao ar livre: a cor do céu muda com a hora, o sol faz sombra
 *   indoor      = interior: mais escuro que lá fora; de dia entra luz pelas janelas
 *   underground = caverna/masmorra: nunca vê o sol; a escuridão tem a cor `tint`
 */
export interface ZoneLighting {
  place: 'outdoor' | 'indoor' | 'underground'
  /** null = ciclo dia/noite (segue o relógio do mundo); número = hora fixa (0–24). */
  hour: number | null
  /** Ciclo: quantos minutos reais dura um dia. */
  dayMinutes?: number
  /** Subterrâneo: a cor da escuridão (quanto mais escura, mais breu). */
  tint?: string
  /** Sombras do sol (ao ar livre). Padrão: ligadas. */
  sunShadows?: boolean
  /** Vaga-lumes, poeira, faíscas e fumaça. Padrão: ligados. */
  particles?: boolean
  /** Vento ao ar livre, 0 (parado) a 1 (ventania). Ausente = brisa. Dentro de casa não venta. */
  wind?: number
  /** Sombra de nuvens passando (ao ar livre, de dia). Padrão: ligada. */
  clouds?: boolean
}

export const DAY_MINUTES = 24

/** Uma luz solta no mapa, em px; o brilho dos objetos vem do catálogo. */
export interface ZoneLight {
  id: string
  x: number
  y: number
  radius: number
  color: string
  /** 0–1. */
  intensity: number
  /** 0 = parada; 1 = tremula muito (fogo). */
  flicker: number
}

export const LIGHT_RADIUS_MIN = 16
export const LIGHT_RADIUS_MAX = 512

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
  /** Espelhado na horizontal. */
  flip?: boolean
  /**
   * Altura em px (em cima de uma mesa, balcão, prateleira): o desenho sobe,
   * mas a profundidade continua sendo a do ponto no chão (x, y) — assim
   * a comida na mesa fica na frente da mesa e atrás de quem passa na frente.
   * Objeto elevado não colide.
   */
  z?: number
}

export const Z_MAX = 160

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

export type BodyType = 'male' | 'female'

/** Um item escolhido num espaço do personagem (cabelo, camisa...). */
export interface AppearanceItem {
  /** Id no catálogo do personagem. */
  id: string
  /** Variante (itens que vêm em versões prontas, sem troca de cor). */
  variant?: string
  /** Cor escolhida por canal (ex.: { color: 'ginger' } ou { color_2: 'blue' }). */
  colors?: Record<string, string>
}

/** A aparência de um boneco: corpo, cor da pele e o item de cada espaço. */
export interface Appearance {
  version: 2
  body: BodyType
  /** Cor da pele (paleta "body"); cabeça, orelhas etc. acompanham. */
  skin: string
  /** id do espaço → item. */
  slots: Record<string, AppearanceItem>
}

/** Um personagem salvo. */
export interface CharacterSave {
  version: 1
  id: string
  name: string
  appearance: Appearance
  updatedAt: number
}
