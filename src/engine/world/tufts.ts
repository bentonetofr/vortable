// ────────────────────────────────────────────────────────
// Tufinhos de grama que balançam. Nos blocos de grama LPC, o miolo liso
// (quadro 10) é uma cor só e as variações (15–17) são esse mesmo liso com
// tufos desenhados por cima — então o tufo é exatamente o que difere do
// liso. O chão desenha o liso; o tufo vira um sprite que balança com o
// vento (e chacoalha quando alguém passa por cima).
//
// Só existe sprite pros tiles à vista (reaproveitados): uma zona grande
// tem milhares de tufos, a tela mostra uma ou duas centenas.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { terrainFrameRect, terrainTexture, type TerrainDef } from '../assets/terrains'
import { TILE } from '../types'
import { hash2 } from '../rng'
import { setSway, terrainSway, type SwaySpec } from './wind'

const DEPTH_TUFTS = -900_000
/** Mais que isso de pixels diferentes = não é tufo sobre liso (ex.: trigo): fica no chão. */
const MAX_TUFT_PIXELS = 400
/** Com tanto tile de tufo à vista (zoom bem longe), eles somem: são pontinhos e pesariam. */
const MAX_VISIBLE = 3000

/**
 * Um tufo recortado: a textura (só a caixa em volta dos tufos) e onde fica
 * o canto de baixo à esquerda dela dentro do tile — o balanço prende ali,
 * no pé do tufo, não no pé do tile.
 */
export interface Tuft { key: string; x: number; bottom: number }

/** Tufo de cada terreno/variação (null = sem tufo: desenha o quadro normal). */
const tuftKeys = new Map<string, Tuft | null>()

/** O tufo (o que difere do miolo liso), recortado na primeira vez. */
export function tuftTexture(scene: Phaser.Scene, t: TerrainDef, frame: number): Tuft | null {
  const id = `${t.id}:${frame}`
  const known = tuftKeys.get(id)
  if (known !== undefined) return known
  let tuft: Tuft | null = null
  if (!t.gen && !t.wang && !t.fence && terrainSway(t) > 0) {
    const src = scene.textures.get(terrainTexture(t)).getSourceImage() as CanvasImageSource
    const c = document.createElement('canvas')
    c.width = TILE * 2
    c.height = TILE
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const a = terrainFrameRect(t, frame), b = terrainFrameRect(t, 10)
    ctx.drawImage(src, a.x, a.y, TILE, TILE, 0, 0, TILE, TILE)
    ctx.drawImage(src, b.x, b.y, TILE, TILE, TILE, 0, TILE, TILE)
    const img = ctx.getImageData(0, 0, TILE * 2, TILE)
    const out = ctx.createImageData(TILE, TILE)
    let n = 0, x0 = TILE, y0 = TILE, x1 = -1, y1 = -1
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = (y * TILE * 2 + x) * 4, j = (y * TILE * 2 + x + TILE) * 4
        const same = img.data[i] === img.data[j] && img.data[i + 1] === img.data[j + 1] && img.data[i + 2] === img.data[j + 2]
        if (same) continue
        const o = (y * TILE + x) * 4
        out.data.set(img.data.subarray(i, i + 4), o)
        n++
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      }
    }
    if (n > 0 && n <= MAX_TUFT_PIXELS) {
      const t2 = document.createElement('canvas')
      t2.width = x1 - x0 + 1
      t2.height = y1 - y0 + 1
      t2.getContext('2d', { willReadFrequently: true })!.putImageData(out, -x0, -y0, x0, y0, t2.width, t2.height)
      const key = `tuft:${id}`
      if (!scene.textures.exists(key)) scene.textures.addCanvas(key, t2)
      tuft = { key, x: x0, bottom: y1 + 1 }
    }
  }
  tuftKeys.set(id, tuft)
  return tuft
}

interface Active { img: Phaser.GameObjects.Image; spec: SwaySpec; rustle: number }

/** Os tufos de uma zona: qual textura em cada tile, e os sprites dos que estão à vista. */
export class Tufts {
  /** Tufo de cada tile (índice ty * w + tx); null = sem tufo solto. */
  private keys: (Tuft | null)[]
  private active = new Map<number, Active>()
  private pool: Phaser.GameObjects.Image[] = []
  private time = 0

  constructor(private scene: Phaser.Scene, private w: number, private h: number) {
    this.keys = new Array(w * h).fill(null)
  }

  set(tx: number, ty: number, key: Tuft | null) {
    this.keys[ty * this.w + tx] = key
  }

  destroy() {
    for (const a of this.active.values()) a.img.destroy()
    for (const img of this.pool) img.destroy()
    this.active.clear()
    this.pool = []
  }

  /**
   * Põe sprite nos tiles à vista e tira dos que saíram. `feet` = quem está
   * andando (a grama chacoalha embaixo).
   */
  update(cam: Phaser.Cameras.Scene2D.Camera, dt: number, feet: { x: number; y: number }[] = []) {
    this.time += dt
    const z = cam.zoom
    const vw = cam.width / z, vh = cam.height / z
    const vx = cam.scrollX + cam.width / 2 - vw / 2, vy = cam.scrollY + cam.height / 2 - vh / 2
    const tx0 = Math.max(0, Math.floor(vx / TILE) - 1), ty0 = Math.max(0, Math.floor(vy / TILE) - 1)
    const tx1 = Math.min(this.w - 1, Math.floor((vx + vw) / TILE) + 1), ty1 = Math.min(this.h - 1, Math.floor((vy + vh) / TILE) + 2)
    const tooMany = (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_VISIBLE

    // os que saíram da tela (ou mudaram de textura/sumiram) voltam pro estoque
    for (const [i, a] of this.active) {
      const tx = i % this.w, ty = Math.floor(i / this.w)
      const key = this.keys[i]
      if (tooMany || tx < tx0 || tx > tx1 || ty < ty0 || ty > ty1 || !key) {
        a.img.setVisible(false)
        this.pool.push(a.img)
        this.active.delete(i)
      } else if (a.img.texture.key !== key.key) {
        this.place(a, tx, ty, key)
      }
    }
    if (tooMany) return
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * this.w + tx
        const key = this.keys[i]
        if (!key || this.active.has(i)) continue
        const img = (this.pool.pop() ?? this.scene.add.image(0, 0, key.key).setOrigin(0, 1).setDepth(DEPTH_TUFTS)).setVisible(true)
        const a: Active = { img, spec: { amp: 0, freq: 1.25, anchor: 'bottom', phase: (hash2(tx, ty) % 628) / 100, x: 0, y: 0 }, rustle: 0 }
        this.place(a, tx, ty, key)
        this.active.set(i, a)
      }
    }

    // quem passa por cima chacoalha o tufo (some aos poucos)
    this.shake(feet, dt)
  }

  /** Sprite no lugar do tufo; quanto mais alto o tufo, mais a ponta anda. */
  private place(a: Active, tx: number, ty: number, tuft: Tuft) {
    const x = tx * TILE + tuft.x, y = ty * TILE + tuft.bottom
    a.img.setTexture(tuft.key).setPosition(x, y)
    a.spec.x = x
    a.spec.y = y
    a.spec.amp = Math.min(2, 0.4 + a.img.height * 0.09)
    setSway(a.img, a.spec)
  }

  private shake(feet: { x: number; y: number }[], dt: number) {
    for (const f of feet) {
      const i = Math.floor(f.y / TILE) * this.w + Math.floor(f.x / TILE)
      const a = this.active.get(i)
      if (a) a.rustle = 1
    }
    for (const a of this.active.values()) {
      if (a.rustle <= 0) {
        a.spec.kick = 0
        continue
      }
      a.rustle = Math.max(0, a.rustle - dt * 2.2)
      a.spec.kick = a.rustle * Math.sin(this.time * 26 + a.spec.phase) * 2
    }
  }
}
