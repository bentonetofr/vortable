// ────────────────────────────────────────────────────────
// Objetos da zona (árvores, pedras...). Cada um é um sprite com a
// profundidade = y da base: quem está mais embaixo na tela é desenhado
// por cima (y-sort). Só o "pé" do objeto colide.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { OBJECT_SHEETS, objectById } from '../assets/catalog'
import type { ZoneData } from '../types'

interface Rect { id: number; x: number; y: number; w: number; h: number }

const sheetKey = (id: string) => `objsheet:${id}`
const rectsKey = (id: string) => `objrects:${id}`

export function preloadObjects(scene: Phaser.Scene, assetBase: string) {
  for (const s of OBJECT_SHEETS) {
    scene.load.image(sheetKey(s.id), assetBase + s.url)
    scene.load.json(rectsKey(s.id), assetBase + s.rects)
  }
}

/** Cria um quadro nomeado pra cada retângulo das folhas de objetos. */
export function registerObjectFrames(scene: Phaser.Scene) {
  for (const s of OBJECT_SHEETS) {
    const tex = scene.textures.get(sheetKey(s.id))
    const rects = scene.cache.json.get(rectsKey(s.id)) as Rect[]
    for (const r of rects) if (!tex.has(String(r.id))) tex.add(String(r.id), 0, r.x, r.y, r.w, r.h)
  }
}

export function spawnObjects(scene: Phaser.Scene, zone: ZoneData, solids: Phaser.Physics.Arcade.StaticGroup) {
  for (const o of zone.objects) {
    const def = objectById.get(o.kind)
    if (!def) continue
    scene.add.image(o.x, o.y, sheetKey(def.sheet), String(def.rect)).setOrigin(0.5, 1).setDepth(o.y)
    const { w, h, lift } = def.foot
    const foot = scene.add.zone(o.x, o.y - lift - h / 2, w, h)
    solids.add(foot)
  }
}
