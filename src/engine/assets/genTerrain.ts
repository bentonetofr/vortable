// ────────────────────────────────────────────────────────
// Gera, num canvas, o bloco de autotile (3×7 tiles, mesmo layout do LPC)
// dos terrenos de interior a partir de uma textura de 32×32 que se repete.
// Cada pedaço da borda cobre só os quadrantes dos cantos que têm o
// terreno (bordas retas), com uma linha escura marcando o limite.
// ────────────────────────────────────────────────────────

import { GEN_TERRAINS, type TerrainDef } from './terrains'
import { MASK_FRAMES } from '../world/ground'

const QUADS: [bit: number, qx: number, qy: number][] = [[1, 0, 0], [2, 16, 0], [4, 0, 16], [8, 16, 16]]
const FILL_FRAMES = [10, 15, 16, 17]

/** quadro → máscara de cantos (só os quadros de um pedaço só). */
function frameMasks() {
  const m = new Map<number, number>()
  for (const [mask, frames] of Object.entries(MASK_FRAMES)) if (frames.length === 1) m.set(frames[0], Number(mask))
  for (const f of FILL_FRAMES) m.set(f, 15)
  return m
}

/**
 * Desenha os blocos de todos os terrenos gerados lado a lado.
 * `images` = imagens-fonte já carregadas, por URL relativa.
 */
export function buildGeneratedTerrains(images: Map<string, CanvasImageSource>) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, GEN_TERRAINS.length) * 96
  canvas.height = 224
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const masks = frameMasks()

  for (const t of GEN_TERRAINS) {
    const tile = sourceTile(t, images)
    for (const [frame, mask] of masks) {
      const x = t.block[1] * 96 + (frame % 3) * 32
      const y = Math.floor(frame / 3) * 32
      for (const [bit, qx, qy] of QUADS) {
        if (mask & bit) ctx.drawImage(tile, qx, qy, 16, 16, x + qx, y + qy, 16, 16)
      }
      if (mask !== 15) outline(ctx, x, y, mask)
    }
  }
  return canvas
}

function sourceTile(t: TerrainDef, images: Map<string, CanvasImageSource>) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')!
  const g = t.gen!
  if ('color' in g) {
    ctx.fillStyle = g.color
    ctx.fillRect(0, 0, 32, 32)
  } else {
    const img = images.get(g.url)
    if (img) ctx.drawImage(img, g.x, g.y, 32, 32, 0, 0, 32, 32)
  }
  return c
}

/** Linha escura de 2px do lado de dentro, onde o terreno encontra o vizinho. */
function outline(ctx: CanvasRenderingContext2D, x: number, y: number, mask: number) {
  const has = (bit: number) => (mask & bit) !== 0
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  for (const [bit, qx, qy] of QUADS) {
    if (!has(bit)) continue
    const left = qx === 0, top = qy === 0
    // vizinho horizontal e vertical deste quadrante dentro do tile
    const hBit = left ? bit << 1 : bit >> 1
    const vBit = top ? bit << 2 : bit >> 2
    if (!has(hBit)) ctx.fillRect(x + qx + (left ? 14 : 0), y + qy, 2, 16)
    if (!has(vBit)) ctx.fillRect(x + qx, y + qy + (top ? 14 : 0), 16, 2)
  }
}
