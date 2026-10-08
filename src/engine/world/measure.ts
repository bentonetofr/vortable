// ────────────────────────────────────────────────────────
// Medidas do mundo, pra régua do editor: 1 tile (32 px) = 1 metro.
// A escala combina com os bonecos (um adulto tem ~1,6 tile de altura, ≈ 1,7 m)
// e com as portas e móveis do catálogo. Mudar METERS_PER_TILE (em types.ts)
// muda todas as medidas de uma vez.
// ────────────────────────────────────────────────────────

import { METERS_PER_TILE, TILE } from '../types'

export interface Ruler {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Metros → pixels do mundo. */
export const metersToPx = (m: number) => (m / METERS_PER_TILE) * TILE

/** Pixels do mundo → metros. */
export const pxToMeters = (px: number) => (px / TILE) * METERS_PER_TILE

const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "12,4 m" (até 1 casa decimal; abaixo de 1 m, em centímetros). */
export function formatMeters(px: number) {
  const m = pxToMeters(px)
  return m < 1 ? `${Math.round(m * 100)} cm` : `${nf.format(m)} m`
}

const CARDINALS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO']

/** Direção da régua como bússola: 0° = norte (pra cima), sentido horário. */
export function bearing(r: Ruler) {
  const deg = ((Math.atan2(r.x1 - r.x0, -(r.y1 - r.y0)) * 180) / Math.PI + 360) % 360
  return { deg, cardinal: CARDINALS[Math.round(deg / 45) % 8] }
}

export const rulerLength = (r: Ruler) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0)

/** O passo (em metros) das marcas da régua: o menor "redondo" que deixa as marcas separadas na tela. */
export function tickStepMeters(zoom: number, minGapPx = 9) {
  const pxPerMeter = (TILE / METERS_PER_TILE) * zoom
  for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (step * pxPerMeter >= minGapPx) return step
  return 1000
}
