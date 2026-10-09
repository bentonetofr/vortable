// ────────────────────────────────────────────────────────
// Porte do corpo: peito, bunda e peso. O LPC só tem um corpo de cada tipo,
// então estas formas vêm de um ajuste no desenho pronto: depois de montar todas as
// camadas (corpo e roupa juntos, pra a roupa acompanhar), cada linha de pixels do
// tronco pra baixo é alargada ou estreitada em volta do centro do boneco.
// De frente alarga; de lado é a espessura (peito pra frente, bunda pra trás).
// A cabeça fica de fora: só mexe da linha do peito pra baixo.
// ────────────────────────────────────────────────────────

import type { Appearance } from '../types'

/** Níveis -1 (menor), 0 (como o LPC desenha) e 1 (maior). */
export interface Shape {
  bust?: number
  hips?: number
  weight?: number
}

/** O quanto cada nível mexe na largura (fração). */
const BUST = { '-1': -0.07, '0': 0, '1': 0.17 } as const
const HIPS = { '-1': -0.07, '0': 0, '1': 0.17 } as const
const WEIGHT = { '-1': -0.13, '0': 0, '1': 0.22 } as const

const lvl = (v: number | undefined) => (v === -1 || v === 1 ? v : 0)

/** Linha do quadro (de 64) onde começa o tronco abaixo da cabeça. */
const TORSO_Y = 37

const bump = (y: number, c: number, w: number) => Math.max(0, Math.cos(((y - c) / w) * (Math.PI / 2)))

/** Ponto fixo (x) do alargamento, por vista: 0 cima, 1 esquerda, 2 baixo, 3 direita. */
const ANCHOR = {
  bust: [32, 41, 32, 23],
  hips: [32, 26, 32, 38],
} as const

export function hasShape(a: Appearance) {
  const s = a.shape
  return !!s && (lvl(s.bust) !== 0 || lvl(s.hips) !== 0 || lvl(s.weight) !== 0)
}

/**
 * Aplica o porte numa folha pronta (`frames` colunas × 4 linhas de quadros de 64).
 * Altera o canvas no lugar.
 */
export function reshapeSheet(canvas: HTMLCanvasElement, a: Appearance, frames: number) {
  if (!hasShape(a)) return
  const s = a.shape!
  const bust = BUST[String(lvl(s.bust)) as '-1']
  const hips = HIPS[String(lvl(s.hips)) as '-1']
  const weight = WEIGHT[String(lvl(s.weight)) as '-1']
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const out = new ImageData(new Uint8ClampedArray(src.data), canvas.width, canvas.height)
  const W = canvas.width

  for (let row = 0; row < 4; row++) {
    // por linha do quadro: quanto alargar e em volta de qual x
    const factor: number[] = []
    const anchor: number[] = []
    for (let y = 0; y < 64; y++) {
      if (y < TORSO_Y) { factor.push(1); anchor.push(32); continue }
      // peito não aparece de costas (só um pouco no ombro)
      const b = bust * bump(y, 40, 4) * (row === 0 ? 0.2 : 1)
      const h = hips * bump(y, 50, 5)
      // peso: sobe do tronco e vale até os pés; a barriga pesa um pouco mais
      const w = weight * Math.min(1, (y - TORSO_Y) / 6) + (weight > 0 ? 0.07 * bump(y, 45, 4) : 0)
      factor.push(1 + b + h + w)
      const mag = Math.abs(b) + Math.abs(h) + Math.abs(w)
      anchor.push(mag ? (Math.abs(b) * ANCHOR.bust[row] + Math.abs(h) * ANCHOR.hips[row] + Math.abs(w) * 32) / mag : 32)
    }
    for (let col = 0; col < frames; col++) {
      const ox = col * 64
      for (let y = TORSO_Y; y < 64; y++) {
        const f = factor[y]
        if (Math.abs(f - 1) < 0.004) continue
        const ax = anchor[y]
        const rowOff = (row * 64 + y) * W
        for (let x = 0; x < 64; x++) {
          const sx = Math.round(ax + (x - ax) / f)
          const d = (rowOff + ox + x) * 4
          if (sx < 0 || sx >= 64) { out.data[d + 3] = 0; continue }
          const s = (rowOff + ox + sx) * 4
          out.data[d] = src.data[s]
          out.data[d + 1] = src.data[s + 1]
          out.data[d + 2] = src.data[s + 2]
          out.data[d + 3] = src.data[s + 3]
        }
      }
    }
  }
  ctx.putImageData(out, 0, 0)
}
