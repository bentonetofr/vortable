// ────────────────────────────────────────────────────────
// Objetos da zona (árvores, pedras...). Cada um é um sprite com a
// profundidade = y da base: quem está mais embaixo na tela é desenhado
// por cima (y-sort). Só o "pé" do objeto colide.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { footRect, objectDef, sheetTexture } from '../assets/objects'
import type { ZoneObject } from '../types'

export function createObjectSprite(scene: Phaser.Scene, o: ZoneObject) {
  const def = objectDef(o.kind)
  if (!def) return null
  return scene.add.image(o.x, o.y, sheetTexture(def.sheet), def.id).setOrigin(0.5, 1).setDepth(o.y)
}

/** Corpos estáticos invisíveis nos pés dos objetos. */
export function addObjectSolids(scene: Phaser.Scene, objects: ZoneObject[], solids: Phaser.Physics.Arcade.StaticGroup) {
  for (const o of objects) {
    const def = objectDef(o.kind)
    const r = def && footRect(def, o.x, o.y)
    if (r) solids.add(scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
  }
}
