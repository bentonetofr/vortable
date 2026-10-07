// ────────────────────────────────────────────────────────
// Hora do dia e cor da luz. A luz ambiente é uma cor que MULTIPLICA a
// cena (branco = dia claro, azul-escuro = noite); as luzes somam em cima
// dela. A cor do céu segue uma curva de chaves por hora (madrugada,
// aurora, dia, hora dourada, pôr do sol, crepúsculo, noite).
// ────────────────────────────────────────────────────────

import { DAY_MINUTES, type ZoneLighting } from '../types'

export type RGB = [number, number, number]

export const UNDERGROUND_TINT = '#2a2e3c'

/** Luz de uma zona que nunca foi ajustada: interior se o fundo é o vazio, senão ao ar livre; ciclo dia/noite. */
export function lightingOf(zone: { lighting?: ZoneLighting; base?: string }): ZoneLighting {
  return zone.lighting ?? { place: zone.base === 'void' ? 'indoor' : 'outdoor', hour: null }
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1, 7), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToInt([r, g, b]: RGB) {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  return (c(r) << 16) | (c(g) << 8) | c(b)
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Céu ao ar livre: [hora, cor]. Entre as chaves, mistura suave. */
const SKY: [number, string][] = [
  [0, '#262f5c'],
  [4, '#283260'],
  [5.2, '#46407a'],
  [6, '#b07a8c'],
  [6.8, '#f0b890'],
  [8, '#fff0dc'],
  [10, '#ffffff'],
  [15.5, '#ffffff'],
  [17, '#ffe2b0'],
  [18, '#ffb070'],
  [18.8, '#d0707a'],
  [19.6, '#6a5490'],
  [20.6, '#323a6c'],
  [22, '#262f5c'],
  [24, '#262f5c'],
]
const SKY_RGB = SKY.map(([h, c]) => [h, hexToRgb(c)] as const)

function skyAt(hour: number): RGB {
  const h = ((hour % 24) + 24) % 24
  for (let i = 1; i < SKY_RGB.length; i++) {
    const [h1, c1] = SKY_RGB[i]
    if (h <= h1) {
      const [h0, c0] = SKY_RGB[i - 1]
      const t = (h - h0) / (h1 - h0)
      // suaviza a passagem entre chaves (sem "quinas" na mudança de cor)
      return mix(c0, c1, t * t * (3 - 2 * t))
    }
  }
  return SKY_RGB[0][1]
}

/** Interior: luz de fora entrando, mais fraca, puxada pro quente; à noite, quase breu. */
const INDOOR_DAY: RGB = hexToRgb('#b6a898')
const INDOOR_NIGHT: RGB = hexToRgb('#2a2638')

/** Quanto de sol há (0 = noite, 1 = dia pleno), suave na aurora e no pôr do sol. */
export function daylight(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const up = smooth(5.4, 8, h), down = 1 - smooth(17, 19.8, h)
  return Math.max(0, Math.min(up, down))
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Cor da luz ambiente da zona naquela hora. */
export function ambientAt(l: ZoneLighting, hour: number): RGB {
  if (l.place === 'underground') return hexToRgb(l.tint ?? UNDERGROUND_TINT)
  const sky = skyAt(hour)
  if (l.place === 'outdoor') return sky
  // interior: a cor do céu tinge um pouco a luz que entra
  const d = daylight(hour)
  return mix(INDOOR_NIGHT, mix(INDOOR_DAY, [INDOOR_DAY[0] * sky[0], INDOOR_DAY[1] * sky[1], INDOOR_DAY[2] * sky[2]], 0.5), d)
}

/** Quão escuro está (0 = claro, 1 = breu): decide o brilho extra das luzes. */
export function darkness(ambient: RGB) {
  const lum = ambient[0] * 0.3 + ambient[1] * 0.55 + ambient[2] * 0.15
  return Math.max(0, Math.min(1, (0.95 - lum) / 0.75))
}

/**
 * Sol: direção da sombra (radianos; 0 = pra baixo, + = pra esquerda) e
 * comprimento (escala da silhueta). De manhã a sombra cai pra oeste
 * (esquerda) e é longa; ao meio-dia é curta; à tarde vai pro leste.
 */
export function sunAt(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const t = Math.max(0, Math.min(1, (h - 6) / 12)) // 0 = nascente, 1 = poente
  const angle = (0.5 - t) * 2 * 1.05
  const height = Math.sin(t * Math.PI) // 0 no horizonte, 1 ao meio-dia
  const length = 0.32 + (1 - height) * 0.62
  return { angle, length, strength: daylight(h) }
}

/**
 * Relógio do mundo (ciclo dia/noite): todo mundo vê a mesma hora, porque
 * vem do relógio de verdade. 6h da manhã no instante zero.
 */
export function worldHour(dayMinutes = DAY_MINUTES, now = Date.now()) {
  const day = dayMinutes * 60_000
  return ((now % day) / day * 24 + 6) % 24
}

/** Hora da zona agora: a fixa, ou a do ciclo. */
export function zoneHour(l: ZoneLighting, now = Date.now()) {
  return l.hour ?? worldHour(l.dayMinutes, now)
}

export function formatHour(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Presets do painel Luz. */
export const LIGHT_PRESETS: { id: string; label: string; lighting: ZoneLighting }[] = [
  { id: 'cycle', label: 'Ciclo dia/noite', lighting: { place: 'outdoor', hour: null } },
  { id: 'day', label: 'Dia', lighting: { place: 'outdoor', hour: 12 } },
  { id: 'dusk', label: 'Entardecer', lighting: { place: 'outdoor', hour: 18.2 } },
  { id: 'night', label: 'Noite', lighting: { place: 'outdoor', hour: 23 } },
  { id: 'indoor', label: 'Interior', lighting: { place: 'indoor', hour: null } },
  { id: 'tavern', label: 'Taverna à noite', lighting: { place: 'indoor', hour: 21.5 } },
  { id: 'cave', label: 'Caverna', lighting: { place: 'underground', hour: null, tint: '#343a4e' } },
  { id: 'dungeon', label: 'Masmorra', lighting: { place: 'underground', hour: null, tint: '#1e2420' } },
]
