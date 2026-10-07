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
//
// Terrenos de autotile do Tiled (wang: paredes, molduras, tapetes) têm
// uma tabela máscara → tiles; máscara que falta é montada com pedaços.
// A camada `overlay` (zone.overlay) é desenhada por cima do chão, com a
// mesma regra; vértice vazio ('') não tem nada.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { TERRAINS, terrainById, terrainFrame, terrainTexture, wangFrame, type TerrainDef } from '../assets/terrains'
import { TILE, type ZoneData } from '../types'
import { hash2 } from '../rng'
import { roomRoles } from './rooms'

export const MASK_FRAMES: Record<number, number[]> = {
  1: [14], 2: [12], 4: [8], 8: [6],
  3: [13], 12: [7], 5: [11], 10: [9],
  9: [14, 6], 6: [12, 8],
  7: [1], 11: [2], 13: [4], 14: [5],
}
/** Miolo: o quadro 10 na maioria das vezes, às vezes uma variação. */
function fillFrame(t: TerrainDef, tx: number, ty: number) {
  // textura de 64×64: o quadrante certo pra posição (emenda sem costura)
  if (t.gen && 'size' in t.gen && t.gen.size === 64) return [10, 15, 16, 17][(tx & 1) + (ty & 1) * 2]
  const variants = t.fills ?? [15, 16, 17]
  const r = hash2(tx, ty) % 7
  return r < variants.length ? variants[r] : 10
}

/** Ordem de tentativa pra montar uma máscara que falta na tabela (maiores primeiro). */
const WANG_PARTS = [7, 11, 13, 14, 3, 12, 5, 10, 1, 2, 4, 8]

/** Tiles (wang) que desenham a máscara: o próprio, ou pedaços que somados a cobrem. */
function wangTiles(t: TerrainDef, mask: number, tx: number, ty: number): [number, number][] {
  const table = t.wang!
  const pick = (m: number) => {
    const list = table[m]
    return list && list.length ? list[hash2(tx, ty) % list.length] : null
  }
  const exact = pick(mask)
  if (exact) return [exact]
  const out: [number, number][] = []
  let covered = 0
  for (const part of WANG_PARTS) {
    if ((part & mask) !== part || (part & ~covered) === 0) continue
    const tile = pick(part)
    if (!tile) continue
    out.push(tile)
    covered |= part
    if (covered === mask) break
  }
  return out
}

export function overlayTerrain(zone: ZoneData, vx: number, vy: number): TerrainDef | null {
  const id = zone.overlay?.[vy * (zone.width + 1) + vx]
  return (id && terrainById.get(id)) || null
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
    const x = tx * TILE, y = ty * TILE
    // máscara 15 = tile inteiro (miolo)
    const draw = (t: TerrainDef, mask: number) => {
      if (t.wang) {
        for (const [fx, fy] of wangTiles(t, mask, tx, ty)) this.rt.batchDrawFrame(terrainTexture(t), wangFrame(fx, fy), x, y)
        return
      }
      const frames = mask === 15 ? [fillFrame(t, tx, ty)] : MASK_FRAMES[mask] ?? []
      for (const n of frames) this.rt.batchDrawFrame(terrainTexture(t), terrainFrame(t.id, n), x, y)
    }

    // chão: o de menor rank é o fundo inteiro; os outros por cima, só nos cantos deles
    const c = [cornerTerrain(z, tx, ty), cornerTerrain(z, tx + 1, ty), cornerTerrain(z, tx, ty + 1), cornerTerrain(z, tx + 1, ty + 1)]
    const present = [...new Set(c)].sort((a, b) => a.rank - b.rank)
    draw(present[0], 15)
    for (let i = 1; i < present.length; i++) draw(present[i], cornerMask(c, present[i].rank))

    // camada de cima: vértice vazio não tem nada
    if (!z.overlay) return
    const o = [overlayTerrain(z, tx, ty), overlayTerrain(z, tx + 1, ty), overlayTerrain(z, tx, ty + 1), overlayTerrain(z, tx + 1, ty + 1)]
    const layers = [...new Set(o.filter((t): t is TerrainDef => !!t))].sort((a, b) => a.rank - b.rank)
    for (const t of layers) draw(t, cornerMask(o, t.rank))
  }
}

/** Cantos (TL=1, TR=2, BL=4, BR=8) com terreno de rank ≥ r (vazio = nenhum). */
function cornerMask(c: (TerrainDef | null)[], r: number) {
  return (c[0] && c[0].rank >= r ? 1 : 0) | (c[1] && c[1].rank >= r ? 2 : 0) | (c[2] && c[2].rank >= r ? 4 : 0) | (c[3] && c[3].rank >= r ? 8 : 0)
}

/**
 * Tiles bloqueados pelo terreno: 3+ cantos sólidos. Junta vizinhos na mesma
 * linha. Nos cômodos (zone.rooms) a estrutura manda: todo tile que toca a
 * parede é sólido, e a borda em volta do cômodo também (em qualquer fundo).
 */
export function solidTerrainRects(zone: ZoneData) {
  const rects: { x: number; y: number; w: number; h: number }[] = []
  const W = zone.width + 1
  const roles = zone.rooms ? roomRoles(zone) : null
  const isWall = (vx: number, vy: number) => !!roles && roles[vy * W + vx].endsWith('#w')
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
        blocked = n >= 3 || isWall(tx, ty) || isWall(tx + 1, ty) || isWall(tx, ty + 1) || isWall(tx + 1, ty + 1)
      }
      if (blocked && runStart < 0) runStart = tx
      if (!blocked && runStart >= 0) {
        rects.push({ x: runStart * TILE, y: ty * TILE, w: (tx - runStart) * TILE, h: TILE })
        runStart = -1
      }
    }
  }
  // borda: vazio encostado em outro terreno, ou qualquer vértice fora de um
  // cômodo encostado nele, ganha um bloco em volta (fecha as paredes finas
  // entre cômodos e segura o boneco antes da moldura)
  const E = 12
  const inRoom = (vx: number, vy: number) => !!roles && roles[vy * W + vx] !== ''
  for (let vy = 0; vy <= zone.height; vy++) {
    for (let vx = 0; vx <= zone.width; vx++) {
      const near = [[vx + 1, vy], [vx - 1, vy], [vx, vy + 1], [vx, vy - 1]]
        .filter(([x, y]) => x >= 0 && y >= 0 && x <= zone.width && y <= zone.height)
      const voidEdge = cornerTerrain(zone, vx, vy).edgeSolid && near.some(([x, y]) => !cornerTerrain(zone, x, y).edgeSolid)
      const roomEdge = !!roles && !inRoom(vx, vy) && near.some(([x, y]) => inRoom(x, y))
      if (voidEdge || roomEdge) rects.push({ x: vx * TILE - E, y: vy * TILE - E, w: E * 2, h: E * 2 })
    }
  }
  return rects
}
