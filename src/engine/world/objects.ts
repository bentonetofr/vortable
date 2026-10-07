// ────────────────────────────────────────────────────────
// Objetos da zona (árvores, pedras...). Cada um é um sprite com a
// profundidade = y do pé: quem está mais embaixo na tela é desenhado
// por cima (y-sort). Só o "pé" do objeto colide.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { footRect, objectDef, objectDepth, sheetTexture } from '../assets/objects'
import type { ZoneObject } from '../types'

/**
 * Sprite de um objeto. Objeto que não está no catálogo (arte removida, zona
 * de outra versão): `missing` decide — no jogo some, no editor vira um
 * quadrado de aviso que dá pra selecionar e apagar.
 */
export function createObjectSprite(scene: Phaser.Scene, o: ZoneObject, missing: 'skip' | 'placeholder' = 'skip') {
  const def = objectDef(o.kind)
  if (def) return scene.add.image(o.x, o.y, sheetTexture(def.sheet), def.id).setOrigin(0.5, 1).setDepth(objectDepth(def, o.y))
  if (missing === 'skip') return null
  return scene.add.image(o.x, o.y, '__MISSING').setOrigin(0.5, 1).setDepth(o.y)
}

/** Reposiciona um sprite de objeto (arrastar no editor). */
export function moveObjectSprite(s: Phaser.GameObjects.Image, o: ZoneObject) {
  s.setPosition(o.x, o.y).setDepth(objectDepth(objectDef(o.kind), o.y))
}

/** Corpos estáticos invisíveis nos pés dos objetos. */
export function addObjectSolids(scene: Phaser.Scene, objects: ZoneObject[], solids: Phaser.Physics.Arcade.StaticGroup) {
  for (const o of objects) {
    const def = objectDef(o.kind)
    const r = def && footRect(def, o.x, o.y)
    if (r) solids.add(scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
  }
}
