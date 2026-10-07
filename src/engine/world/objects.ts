// ────────────────────────────────────────────────────────
// Objetos da zona (árvores, móveis, tochas...). Cada um é um sprite cuja
// profundidade depende do tipo (ver objectDepth): em pé = y do pé (quem
// está mais embaixo na tela é desenhado por cima), no chão = por baixo de
// tudo, por cima = acima de tudo. Só os retângulos de colisão colidem.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { animFrame, animKey, objectDef, objectDepth, objectSolids, sheetTexture, type ObjectCatalog, type ObjectDef } from '../assets/objects'
import type { ZoneObject } from '../types'

export type ObjectSprite = Phaser.GameObjects.Sprite

/**
 * Registra os quadros e animações das peças nas folhas já carregadas. Pode
 * rodar de novo depois da curadoria (refaz as animações, mantém o resto).
 */
export function registerObjectArt(scene: { textures: Phaser.Textures.TextureManager; anims: Phaser.Animations.AnimationManager }, catalog: ObjectCatalog) {
  for (const o of catalog.objects) {
    const tex = scene.textures.get(sheetTexture(o.sheet))
    if (!tex.has(o.id)) tex.add(o.id, 0, o.x, o.y, o.w, o.h)
    if (!o.anim) continue
    o.anim.frames.forEach(([x, y], n) => n && !tex.has(animFrame(o.id, n)) && tex.add(animFrame(o.id, n), 0, x, y, o.w, o.h))
    scene.anims.remove(animKey(o.id))
    scene.anims.create({
      key: animKey(o.id),
      frames: o.anim.frames.map((_, n) => ({ key: sheetTexture(o.sheet), frame: animFrame(o.id, n) })),
      frameRate: o.anim.fps,
      repeat: -1,
    })
  }
}

/**
 * Sprite de um objeto. Objeto que não está no catálogo (arte removida, zona
 * de outra versão): `missing` decide — no jogo some, no editor vira um
 * quadrado de aviso que dá pra selecionar e apagar.
 */
export function createObjectSprite(scene: Phaser.Scene, o: ZoneObject, missing: 'skip' | 'placeholder' = 'skip'): ObjectSprite | null {
  const def = objectDef(o.kind)
  if (!def) {
    if (missing === 'skip') return null
    return scene.add.sprite(o.x, o.y, '__MISSING').setOrigin(0.5, 1).setDepth(o.y)
  }
  const s = scene.add.sprite(o.x, o.y - (o.z ?? 0), sheetTexture(def.sheet), def.id).setOrigin(0.5, 1).setFlipX(!!o.flip).setName(def.id)
  s.setDepth(depthOf(def, o))
  playAnim(s, def)
  return s
}

/** Elevado (em cima de algo) fica um tiquinho acima do que está no mesmo ponto. */
function depthOf(def: ObjectDef | undefined, o: ZoneObject) {
  return objectDepth(def, o.y) + (o.z ? 0.5 : 0)
}

/** Começa a animação num quadro sorteado (tochas lado a lado não piscam juntas). */
function playAnim(s: ObjectSprite, def: ObjectDef) {
  if (!def.anim) return
  s.play({ key: animKey(def.id), startFrame: Math.floor(Math.random() * def.anim.frames.length) })
}

/** Reaplica posição/espelho/arte de um sprite (arrastar, espelhar, trocar variante no editor). */
export function updateObjectSprite(s: ObjectSprite, o: ZoneObject) {
  const def = objectDef(o.kind)
  s.setPosition(o.x, o.y - (o.z ?? 0)).setFlipX(!!o.flip).setDepth(depthOf(def, o))
  if (def && s.name !== def.id) {
    s.stop()
    s.setTexture(sheetTexture(def.sheet), def.id).setName(def.id)
    playAnim(s, def)
  }
}

/** Corpos estáticos invisíveis nos retângulos de colisão dos objetos. */
export function addObjectSolids(scene: Phaser.Scene, objects: ZoneObject[], solids: Phaser.Physics.Arcade.StaticGroup) {
  for (const o of objects) {
    const def = objectDef(o.kind)
    if (!def || o.z) continue
    for (const r of objectSolids(def, o)) solids.add(scene.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
  }
}

const FADE_OVER = 0.35
const FADE_STAND = 0.55
/** Objetos em pé mais baixos que isso não escondem ninguém (não precisam ficar transparentes). */
const TALL = 48

interface Occluder {
  sprite: ObjectSprite
  kind: 'over' | 'stand'
  /** Área do desenho, em px do mundo. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Linha de profundidade (stand): quem está acima dela está atrás. */
  line: number
}

/**
 * Objetos que ficam transparentes quando escondem o jogador: telhados e
 * copas (por cima) sempre que ele está embaixo; árvores e móveis altos
 * (em pé) quando ele passa por trás.
 */
export class Occluders {
  private list: Occluder[] = []

  add(s: ObjectSprite | null, o: ZoneObject) {
    const def = objectDef(o.kind)
    if (!s || !def) return
    if (def.kind !== 'over' && !(def.kind === 'stand' && def.h >= TALL)) return
    this.list.push({
      sprite: s,
      kind: def.kind,
      x0: o.x - def.w / 2,
      x1: o.x + def.w / 2,
      y0: o.y - (o.z ?? 0) - def.h,
      y1: o.y - (o.z ?? 0),
      line: o.y - def.sort,
    })
  }

  /** (x, y) = pés do jogador; o corpo dele ocupa ~16px pros lados e ~40px pra cima. */
  update(x: number, y: number) {
    for (const c of this.list) {
      let hidden = false
      if (c.kind === 'over') hidden = x > c.x0 && x < c.x1 && y - 20 > c.y0 && y - 20 < c.y1
      else hidden = y < c.line && x + 12 > c.x0 && x - 12 < c.x1 && y > c.y0 + 8 && y - 40 < c.line
      const target = hidden ? (c.kind === 'over' ? FADE_OVER : FADE_STAND) : 1
      const a = c.sprite.alpha
      if (a !== target) c.sprite.setAlpha(Math.abs(target - a) < 0.02 ? target : a + (target - a) * 0.18)
    }
  }
}
