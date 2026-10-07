// ────────────────────────────────────────────────────────
// Chão da zona com autotile no formato LPC.
//
// Cada VÉRTICE da grade tem um terreno. Pra cada tile e cada terreno,
// olha os 4 cantos (TL=1, TR=2, BL=4, BR=8): a combinação escolhe qual
// pedaço da folha LPC usar (borda, canto de fora, canto de dentro, miolo).
// Terreno de rank maior "conta" também pros de rank menor — água em cima
// de terra deixa uma margem de terra em volta, como no Stardew.
//
// Folha LPC 3×6 (índice = linha*3 + coluna):
//   0 enfeite   1 dentro-TL  2 dentro-TR
//   3 enfeite   4 dentro-BL  5 dentro-BR
//   6 fora-TL   7 borda-cima 8 fora-TR
//   9 borda-esq 10 miolo     11 borda-dir
//  12 fora-BL  13 borda-baixo 14 fora-BR
//  15,16,17 variações do miolo
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { TERRAINS, terrainById } from '../assets/catalog'
import { TILE, type ZoneData } from '../types'
import { hash2 } from '../rng'

const MASK_FRAMES: Record<number, number[]> = {
  1: [14], 2: [12], 4: [8], 8: [6],
  3: [13], 12: [7], 5: [11], 10: [9],
  9: [14, 6], 6: [12, 8],
  7: [1], 11: [2], 13: [4], 14: [5],
}
const FILL = [10, 10, 10, 10, 15, 16, 17]

export function terrainKey(id: string) {
  return `terrain:${id}`
}

export function preloadTerrains(scene: Phaser.Scene, assetBase: string) {
  for (const t of TERRAINS) {
    scene.load.spritesheet(terrainKey(t.id), assetBase + t.url, { frameWidth: TILE, frameHeight: TILE })
  }
}

function rankOf(id: string, base: string) {
  return terrainById.get(id || base)?.rank ?? 0
}

/** Máscara de cantos de um terreno num tile (quais cantos têm rank ≥ o dele). */
export function cornerMask(zone: ZoneData, tx: number, ty: number, rank: number) {
  const W = zone.width + 1
  const r = (x: number, y: number) => rankOf(zone.corners[y * W + x], zone.base)
  return (
    (r(tx, ty) >= rank ? 1 : 0) |
    (r(tx + 1, ty) >= rank ? 2 : 0) |
    (r(tx, ty + 1) >= rank ? 4 : 0) |
    (r(tx + 1, ty + 1) >= rank ? 8 : 0)
  )
}

/** Desenha o chão inteiro numa textura só (o chão é estático). */
export function renderGround(scene: Phaser.Scene, zone: ZoneData) {
  const rt = scene.add.renderTexture(0, 0, zone.width * TILE, zone.height * TILE).setOrigin(0, 0).setDepth(-1_000_000)
  const base = terrainById.get(zone.base) ?? TERRAINS[0]
  const above = TERRAINS.filter((t) => t.rank > base.rank).sort((a, b) => a.rank - b.rank)

  rt.beginDraw()
  for (let ty = 0; ty < zone.height; ty++) {
    for (let tx = 0; tx < zone.width; tx++) {
      const x = tx * TILE, y = ty * TILE
      rt.batchDrawFrame(terrainKey(base.id), FILL[hash2(tx, ty) % FILL.length], x, y)
      for (const t of above) {
        const mask = cornerMask(zone, tx, ty, t.rank)
        if (mask === 0) continue
        const frames = mask === 15 ? [FILL[hash2(tx + 101, ty + 7) % FILL.length]] : MASK_FRAMES[mask]
        for (const f of frames) rt.batchDrawFrame(terrainKey(t.id), f, x, y)
      }
    }
  }
  rt.endDraw()
  return rt
}

/**
 * Tiles bloqueados pelo terreno (água etc.): bloqueia se 3+ cantos são
 * sólidos. Junta tiles vizinhos na mesma linha num retângulo só.
 */
export function solidTerrainRects(zone: ZoneData) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const solids = TERRAINS.filter((t) => t.solid)
  if (!solids.length) return rects
  const minSolidRank = Math.min(...solids.map((t) => t.rank))
  for (let ty = 0; ty < zone.height; ty++) {
    let runStart = -1
    for (let tx = 0; tx <= zone.width; tx++) {
      let blocked = false
      if (tx < zone.width) {
        const m = cornerMask(zone, tx, ty, minSolidRank)
        blocked = ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)) >= 3
      }
      if (blocked && runStart < 0) runStart = tx
      if (!blocked && runStart >= 0) {
        rects.push({ x: runStart * TILE, y: ty * TILE, w: (tx - runStart) * TILE, h: TILE })
        runStart = -1
      }
    }
  }
  return rects
}
