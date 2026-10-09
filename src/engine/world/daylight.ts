// ────────────────────────────────────────────────────────
// Hora do dia e cor da luz. A luz ambiente é uma cor que MULTIPLICA a
// cena (branco = dia claro, azul-escuro = noite); as luzes somam em cima
// dela. A cor do céu segue uma curva de chaves por hora (madrugada,
// aurora, dia, hora dourada, pôr do sol, crepúsculo, noite).
// ────────────────────────────────────────────────────────

import { DAY_MINUTES, type WorldSky, type ZoneLighting } from '../types'

export type RGB = [number, number, number]

export const UNDERGROUND_TINT = '#2a2e3c'

/** Luz de uma zona que nunca foi ajustada: interior se o fundo é o vazio, senão ao ar livre. */
export function lightingOf(zone: { lighting?: ZoneLighting; base?: string }): ZoneLighting {
  return zone.lighting ?? { place: zone.base === 'void' ? 'indoor' : 'outdoor' }
}

/** Hora e tempo do mundo (iguais em todas as zonas); mundo sem ajuste = ciclo dia/noite, tempo limpo. */
export function skyOf(world?: { sky?: WorldSky } | null): WorldSky {
  return world?.sky ?? { hour: null }
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
  [4.8, '#2f3668'],
  [5.3, '#4d4180'],
  [5.7, '#8c5a96'],
  [6.1, '#e48aa0'],
  [6.5, '#fba88a'],
  [6.9, '#ffbf88'],
  [7.4, '#ffdcae'],
  [8.2, '#fff1de'],
  [9.5, '#ffffff'],
  [15.5, '#ffffff'],
  [16.5, '#fff0d4'],
  [17.2, '#ffddaa'],
  [17.8, '#ffc486'],
  [18.3, '#ffa270'],
  [18.7, '#f4849a'],
  [19.0, '#c46ca6'],
  [19.45, '#a2629f'],
  [19.75, '#7c5a9a'],
  [20, '#38406f'],
  [20.3, '#262f5c'],
  [24, '#262f5c'],
]
const SKY_RGB = SKY.map(([h, c]) => [h, hexToRgb(c)] as const)

function skyAt(hour: number): RGB {
  const h = ((hour % 24) + 24) % 24
  const n = SKY_RGB.length
  for (let i = 1; i < n; i++) {
    if (h > SKY_RGB[i][0]) continue
    // curva suave que passa por todas as chaves (Catmull-Rom): sem degrau
    // nem quina onde uma cor vira a outra
    const [h0, c0] = SKY_RGB[i - 1], [h1, c1] = SKY_RGB[i]
    const [hp, cp] = SKY_RGB[Math.max(0, i - 2)], [hn, cn] = SKY_RGB[Math.min(n - 1, i + 1)]
    const span = h1 - h0
    const t = (h - h0) / span
    const t2 = t * t, t3 = t2 * t
    const out: RGB = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const m0 = hp === h0 ? (c1[k] - c0[k]) / span : (c1[k] - cp[k]) / (h1 - hp)
      const m1 = hn === h1 ? (c1[k] - c0[k]) / span : (cn[k] - c0[k]) / (hn - h0)
      const v = (2 * t3 - 3 * t2 + 1) * c0[k] + (t3 - 2 * t2 + t) * span * m0 + (-2 * t3 + 3 * t2) * c1[k] + (t3 - t2) * span * m1
      out[k] = Math.max(0, Math.min(1, v))
    }
    return out
  }
  return SKY_RGB[0][1]
}

/** Interior: luz de fora entrando, mais fraca, puxada pro quente; à noite, quase breu. */
const INDOOR_DAY: RGB = hexToRgb('#b6a898')
const INDOOR_NIGHT: RGB = hexToRgb('#2a2638')

/** Quanto de sol há (0 = noite, 1 = dia pleno), suave na aurora e no pôr do sol. */
export function daylight(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const up = smooth(5.4, 8, h), down = 1 - smooth(17.2, 20, h)
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
/**
 * Hora dourada (0–1): o amanhecer (~5h–8h, pico 6h30) e o entardecer
 * (~16h30–20h, pico 18h20). É quando a luz esquenta, as sombras esticam
 * e o céu ganha cor.
 */
/**
 * Semi noite (0–1): a "hora azul" entre o pôr do sol e a noite (pico 19h35)
 * e entre a noite e a aurora (pico 5h20). O mapa fica num gradiente: o lado
 * do sol ainda rosado e claro, o lado oposto já azul-noite.
 */
export function twilight(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const dusk = smooth(18.6, 19.35, h) * (1 - smooth(19.85, 20.5, h))
  const dawn = smooth(4.5, 5.05, h) * (1 - smooth(5.55, 6.2, h))
  return Math.max(dusk, dawn)
}

/** Noite de verdade (0–1): do fim do crepúsculo (20h30) até a aurora (~5h). */
export function nightAmount(hour: number) {
  const h = ((hour % 24) + 24) % 24
  return h >= 12 ? smooth(19.4, 20.4, h) : 1 - smooth(4.6, 5.8, h)
}

/** Dia aberto, sem hora dourada (0–1): manhã, meio-dia e tarde. */
export function sunny(hour: number) {
  return daylight(hour) * (1 - golden(hour))
}

/**
 * Lua: ângulo da sombra e comprimento. Nasce no leste às 18h, passa em cima
 * à meia-noite (sombra curta, pra baixo) e se põe no oeste às 6h.
 */
export function moonAt(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const t = Math.max(0, Math.min(1, (((h - 18) % 24 + 24) % 24) / 12))
  return { angle: (0.5 - t) * 2 * 0.85, length: 0.55 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.8 }
}

export function golden(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const dawn = smooth(5, 6.1, h) * (1 - smooth(7.1, 8.5, h))
  const dusk = smooth(16.4, 17.9, h) * (1 - smooth(18.7, 19.9, h))
  return Math.max(dawn, dusk)
}

/**
 * Sol: direção da sombra (radianos; 0 = pra baixo, + = pra esquerda) e
 * comprimento (escala da silhueta). De manhã a sombra cai pra oeste
 * (esquerda) e é longa; ao meio-dia é curta; à tarde vai pro leste.
 * `strength` é a força da sombra: existe do nascer ao pôr do sol, mesmo
 * quando a luz ainda é fraca (as sombras compridas do amanhecer).
 */
export function sunAt(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const t = Math.max(0, Math.min(1, (h - 6) / 12)) // 0 = nascente, 1 = poente
  const angle = (0.5 - t) * 2 * 1.05
  const height = Math.sin(t * Math.PI) // 0 no horizonte, 1 ao meio-dia
  const length = 0.3 + Math.pow(1 - height, 1.5) * 0.95
  const strength = smooth(5.7, 7, h) * (1 - smooth(18.2, 19.6, h))
  return { angle, length, strength }
}

/**
 * Relógio do mundo (ciclo dia/noite): todo mundo vê a mesma hora, porque
 * vem do relógio de verdade. 6h da manhã no instante zero.
 *
 * O crepúsculo dura mais no relógio real: o amanhecer (5h12–7h) e o
 * entardecer (18h24–20h12) correm a 1/3 da velocidade, pra a luz mudar
 * devagar (o resto do dia corre um pouco mais rápido pra o dia somar o
 * mesmo tempo). A hora continua sendo uma só; só o ritmo varia.
 */
const SLOW_SPANS: [number, number][] = [[5.2, 7], [18.4, 20.2]]
const SLOW = 3

/** Custo no relógio real (em "horas normais") de ir de 0h até a hora h. */
function cost(h: number) {
  let c = h
  for (const [a, b] of SLOW_SPANS) c += Math.max(0, Math.min(h, b) - a) * (SLOW - 1)
  return c
}
const CYCLE = cost(24)

/** Posição (0–1) da hora no ciclo do relógio real. */
export function hourToCycle(hour: number) {
  return cost(((hour % 24) + 24) % 24) / CYCLE
}

/** A hora em que o ciclo está, dada a posição 0–1 (inverso do anterior). */
function cycleToHour(u: number) {
  const target = (((u % 1) + 1) % 1) * CYCLE
  let h = 0
  // anda trecho por trecho: normais (custo 1) e lentos (custo SLOW)
  const edges = [0, ...SLOW_SPANS.flat(), 24]
  for (let i = 0; i < edges.length - 1; i++) {
    const span = edges[i + 1] - edges[i]
    const slow = i % 2 === 1
    const c = span * (slow ? SLOW : 1)
    const base = cost(edges[i])
    if (target <= base + c || i === edges.length - 2) return edges[i] + Math.min(span, (target - base) / (slow ? SLOW : 1))
    h = edges[i + 1]
  }
  return h
}

export function worldHour(dayMinutes = DAY_MINUTES, now = Date.now()) {
  const day = dayMinutes * 60_000
  return cycleToHour(hourToCycle(6) + (now % day) / day) % 24
}

/**
 * Quanto (ms) somar ao relógio pro ciclo marcar `hour` agora, e seguir correndo dali (calibrar a hora
 * sem parar o tempo). Vale pro ciclo de `dayMinutes` minutos.
 */
export function shiftForHour(hour: number, dayMinutes = DAY_MINUTES, now = Date.now()) {
  const day = dayMinutes * 60_000
  const want = hourToCycle(hour) - hourToCycle(6)
  const diff = (((want - (now % day) / day) % 1) + 1) % 1
  return Math.round(diff * day)
}

/** Hora do mundo agora (a mesma em todas as zonas): a fixa, ou a do ciclo. */
export function skyHour(sky: WorldSky, now = Date.now()) {
  return sky.hour ?? worldHour(sky.dayMinutes, now)
}

export function formatHour(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Presets de lugar do painel Luz (valem só pra zona aberta). */
export const LIGHT_PRESETS: { id: string; label: string; lighting: ZoneLighting }[] = [
  { id: 'outdoor', label: 'Ao ar livre', lighting: { place: 'outdoor' } },
  { id: 'indoor', label: 'Interior', lighting: { place: 'indoor' } },
  { id: 'cave', label: 'Caverna', lighting: { place: 'underground', tint: '#343a4e' } },
  { id: 'dungeon', label: 'Masmorra', lighting: { place: 'underground', tint: '#1e2420' } },
]

/** Presets de hora do painel Luz (valem pro mundo todo). */
/** Durações do dia no ciclo (minutos reais). */
export const DAY_LENGTHS = [12, 24, 48, 96]

/** Amostra de cor de uma hora do mundo (no ciclo, dois tons: dia e noite). */
export function skySwatch(hour: number | null): string {
  const css = (h: number) => `#${rgbToInt(ambientAt({ place: 'outdoor' }, h)).toString(16).padStart(6, '0')}`
  return hour === null ? `linear-gradient(135deg, ${css(12)} 0 50%, ${css(23)} 50% 100%)` : css(hour)
}

export const SKY_PRESETS: { id: string; label: string; hour: number | null }[] = [
  { id: 'cycle', label: 'Ciclo dia/noite', hour: null },
  { id: 'day', label: 'Dia', hour: 12 },
  { id: 'dusk', label: 'Entardecer', hour: 18.2 },
  { id: 'seminight', label: 'Semi noite', hour: 19.6 },
  { id: 'night', label: 'Noite', hour: 23 },
]
