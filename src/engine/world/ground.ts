// ────────────────────────────────────────────────────────
// Chão da zona com autotile no formato LPC.
//
// Cada VÉRTICE da grade tem um terreno. Num tile, os terrenos dos 4
// cantos são ordenados por rank: o menor vira o fundo (miolo inteiro) e
// cada um acima desenha o pedaço que cobre os cantos de rank ≥ o dele
// (TL=1, TR=2, BL=4, BR=8). Só os terrenos presentes no tile entram.
//
// Bloco LPC (índice = linha*3 + coluna):
//   0 enfeite   1 dentro-TL  2 dentro-TR
//   3 enfeite   4 dentro-BL  5 dentro-BR
//   6 fora-TL   7 borda-cima 8 fora-TR
//   9 borda-esq 10 miolo     11 borda-dir
//  12 fora-BL  13 borda-baixo 14 fora-BR
//  15,16,17 variações do miolo
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { TERRAIN_TEXTURE, TERRAINS, terrainById, terrainFrame, type TerrainDef } from '../assets/terrains'
import { TILE, type ZoneData } from '../types'
import { hash2 } from '../rng'

const MASK_FRAMES: Record<number, number[]> = {
  1: [14], 2: [12], 4: [8], 8: [6],
  3: [13], 12: [7], 5: [11], 10: [9],
  9: [14, 6], 6: [12, 8],
  7: [1], 11: [2], 13: [4], 14: [5],
}
/** Miolo: o quadro 10 na maioria das vezes, às vezes uma variação. */
function fillFrame(t: TerrainDef, tx: number, ty: number) {
  const variants = t.fills ?? [15, 16, 17]
  const r = hash2(tx, ty) % 7
  return r < variants.length ? variants[r] : 10
}

export function cornerTerrain(zone: ZoneData, vx: number, vy: number): TerrainDef {
  return terrainById.get(zone.corners[vy * (zone.width + 1) + vx] || zone.base) ?? terrainById.get(zone.base) ?? TERRAINS[0]
}

/** O chão desenhado numa textura só; dá pra redesenhar só um pedaço (editor). */
export class Ground {
  readonly rt: Phaser.GameObjects.RenderTexture

  constructor(scene: Phaser.Scene, private zone: ZoneData) {
    this.rt = scene.add
      .renderTexture(0, 0, zone.width * TILE, zone.height * TILE)
      .setOrigin(0, 0)
      .setDepth(-1_000_000)
    this.redrawAll()
  }

  setZone(zone: ZoneData) {
    this.zone = zone
  }

  redrawAll() {
    this.redrawTiles(0, 0, this.zone.width - 1, this.zone.height - 1)
  }

  /** Redesenha os tiles afetados por vértices no retângulo (inclusive). */
  redrawVertices(vx0: number, vy0: number, vx1: number, vy1: number) {
    this.redrawTiles(vx0 - 1, vy0 - 1, vx1, vy1)
  }

  redrawTiles(tx0: number, ty0: number, tx1: number, ty1: number) {
    const z = this.zone
    tx0 = Math.max(0, tx0); ty0 = Math.max(0, ty0)
    tx1 = Math.min(z.width - 1, tx1); ty1 = Math.min(z.height - 1, ty1)
    this.rt.beginDraw()
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.drawTile(tx, ty)
    this.rt.endDraw()
  }

  private drawTile(tx: number, ty: number) {
    const z = this.zone
    const c = [cornerTerrain(z, tx, ty), cornerTerrain(z, tx + 1, ty), cornerTerrain(z, tx, ty + 1), cornerTerrain(z, tx + 1, ty + 1)]
    const present = [...new Set(c)].sort((a, b) => a.rank - b.rank)
    const x = tx * TILE, y = ty * TILE
    const draw = (t: TerrainDef, n: number) => this.rt.batchDrawFrame(TERRAIN_TEXTURE, terrainFrame(t.id, n), x, y)

    draw(present[0], fillFrame(present[0], tx, ty))
    for (let i = 1; i < present.length; i++) {
      const r = present[i].rank
      const mask = (c[0].rank >= r ? 1 : 0) | (c[1].rank >= r ? 2 : 0) | (c[2].rank >= r ? 4 : 0) | (c[3].rank >= r ? 8 : 0)
      for (const n of MASK_FRAMES[mask] ?? []) draw(present[i], n)
    }
  }
}

/** Tiles bloqueados pelo terreno: 3+ cantos sólidos. Junta vizinhos na mesma linha. */
export function solidTerrainRects(zone: ZoneData) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  for (let ty = 0; ty < zone.height; ty++) {
    let runStart = -1
    for (let tx = 0; tx <= zone.width; tx++) {
      let blocked = false
      if (tx < zone.width) {
        let n = 0
        if (cornerTerrain(zone, tx, ty).solid) n++
        if (cornerTerrain(zone, tx + 1, ty).solid) n++
        if (cornerTerrain(zone, tx, ty + 1).solid) n++
        if (cornerTerrain(zone, tx + 1, ty + 1).solid) n++
        blocked = n >= 3
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
