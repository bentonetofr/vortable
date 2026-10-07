// ────────────────────────────────────────────────────────
// Cercas: uma camada de TILES (zone.fences). Cada tile com cerca se liga
// aos vizinhos com a mesma cerca (cima/direita/baixo/esquerda) e escolhe
// o pedaço certo da folha. Viram sprites com y-sort (dá pra passar atrás)
// e colidem só no poste e nos braços que existem.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { terrainById, terrainTexture, wangFrame, type TerrainDef } from '../assets/terrains'
import { TILE, type ZoneData } from '../types'

const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8

export function fenceAt(zone: ZoneData, tx: number, ty: number): TerrainDef | null {
  if (tx < 0 || ty < 0 || tx >= zone.width || ty >= zone.height) return null
  const id = zone.fences?.[ty * zone.width + tx]
  const t = id ? terrainById.get(id) : undefined
  return t?.fence ? t : null
}

/** Bordas ligadas do tile (vizinhos com a mesma cerca). */
export function fenceMask(zone: ZoneData, tx: number, ty: number) {
  const t = fenceAt(zone, tx, ty)
  if (!t) return 0
  const same = (x: number, y: number) => fenceAt(zone, x, y) === t
  return (same(tx, ty - 1) ? UP : 0) | (same(tx + 1, ty) ? RIGHT : 0) | (same(tx, ty + 1) ? DOWN : 0) | (same(tx - 1, ty) ? LEFT : 0)
}

const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1)

/** Pedaço da folha pra máscara; sem ele, o mais parecido (mais bordas em comum). */
export function fenceTile(t: TerrainDef, mask: number): [number, number] | null {
  const table = t.fence!
  if (table[mask]?.length) return table[mask][0]
  let best: number | null = null, score = -Infinity
  for (const k of Object.keys(table).map(Number)) {
    const s = bits(k & mask) * 2 - bits(k & ~mask)
    if (s > score) { best = k; score = s }
  }
  return best === null ? null : table[best][0]
}

/** Retângulos que colidem: o poste no meio e um braço pra cada borda ligada. */
export function fenceSolids(zone: ZoneData) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  if (!zone.fences) return rects
  for (let ty = 0; ty < zone.height; ty++) {
    for (let tx = 0; tx < zone.width; tx++) {
      if (!fenceAt(zone, tx, ty)) continue
      const m = fenceMask(zone, tx, ty)
      const x = tx * TILE, y = ty * TILE
      rects.push({ x: x + 12, y: y + 18, w: 8, h: 10 })
      if (m & RIGHT) rects.push({ x: x + 20, y: y + 18, w: 12, h: 10 })
      if (m & LEFT) rects.push({ x, y: y + 18, w: 12, h: 10 })
      if (m & UP) rects.push({ x: x + 12, y, w: 8, h: 18 })
      if (m & DOWN) rects.push({ x: x + 12, y: y + 28, w: 8, h: 4 })
    }
  }
  return rects
}

/** Os sprites das cercas de uma zona (refaz tudo a cada mudança: são poucos). */
export class FenceLayer {
  private sprites: Phaser.GameObjects.Image[] = []

  constructor(private scene: Phaser.Scene, private zone: ZoneData) {
    this.rebuild()
  }

  setZone(zone: ZoneData) {
    this.zone = zone
    this.rebuild()
  }

  rebuild() {
    for (const s of this.sprites) s.destroy()
    this.sprites = []
    const z = this.zone
    if (!z.fences) return
    for (let ty = 0; ty < z.height; ty++) {
      for (let tx = 0; tx < z.width; tx++) {
        const t = fenceAt(z, tx, ty)
        if (!t) continue
        const tile = fenceTile(t, fenceMask(z, tx, ty))
        if (!tile) continue
        // base do tile = pé da cerca: quem está mais embaixo passa na frente
        const s = this.scene.add.image(tx * TILE, ty * TILE, terrainTexture(t), wangFrame(tile[0], tile[1]))
          .setOrigin(0, 0).setDepth(ty * TILE + 26)
        this.sprites.push(s)
      }
    }
  }

  destroy() {
    for (const s of this.sprites) s.destroy()
    this.sprites = []
  }
}
