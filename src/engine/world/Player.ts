// ────────────────────────────────────────────────────────
// O boneco controlado pelo jogador local: lê o teclado, move com física
// e escolhe a animação (parado / andando / correndo) pela direção.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import type { Dir } from '../types'

const WALK_SPEED = 90
const RUN_SPEED = 160
/** Os pés do boneco LPC ficam ~2px acima do fundo do quadro 64×64. */
const FEET_Y = 62

type Keys = Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'shift', Phaser.Input.Keyboard.Key>

export class Player {
  readonly sprite: Phaser.Physics.Arcade.Sprite
  private keys: Keys
  /** Parado à força (trocando de zona, cutscene): ignora o teclado. */
  frozen = false

  constructor(scene: Phaser.Scene, private charKey: string, x: number, y: number, private dir: Dir = 'down') {
    this.sprite = scene.physics.add.sprite(x, y, `${charKey}:idle`, 0)
    this.sprite.setOrigin(0.5, FEET_Y / 64)
    // caixa de colisão só nos pés, pra poder passar "atrás" das coisas
    const body = this.sprite.body as Phaser.Physics.Arcade.Body
    body.setSize(18, 10).setOffset(23, FEET_Y - 10)
    body.setCollideWorldBounds(true)

    const kb = scene.input.keyboard!
    const K = Phaser.Input.Keyboard.KeyCodes
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, shift: K.SHIFT,
    }, false) as Keys
    this.play('idle')
  }

  /** Troca a aparência (as texturas foram regeradas com a mesma chave). */
  refresh() {
    this.sprite.anims.stop()
    this.play(this.sprite.body!.velocity.length() > 0 ? 'walk' : 'idle')
  }

  get facing() {
    return this.dir
  }

  /** Retângulo do pé (o que colide e o que pisa nas saídas), em px do mundo. */
  get foot() {
    const b = this.sprite.body as Phaser.Physics.Arcade.Body
    return { x: b.x, y: b.y, w: b.width, h: b.height }
  }

  update() {
    if (this.frozen) {
      this.sprite.setVelocity(0, 0)
      this.play('idle')
      return
    }
    const k = this.keys
    // digitando num campo de texto da página (ex.: chat do Vorterium): o boneco não anda
    const typing = isTyping()
    const on = (key: Phaser.Input.Keyboard.Key) => !typing && key.isDown
    const vx = (on(k.right) || on(k.d) ? 1 : 0) - (on(k.left) || on(k.a) ? 1 : 0)
    const vy = (on(k.down) || on(k.s) ? 1 : 0) - (on(k.up) || on(k.w) ? 1 : 0)
    const running = on(k.shift)
    const speed = running ? RUN_SPEED : WALK_SPEED
    const v = new Phaser.Math.Vector2(vx, vy).normalize().scale(speed)
    this.sprite.setVelocity(v.x, v.y)

    if (vx || vy) {
      // na diagonal, mantém a direção atual se ela ainda vale
      const horiz: Dir = vx > 0 ? 'right' : 'left'
      const vert: Dir = vy > 0 ? 'down' : 'up'
      if (!vx) this.dir = vert
      else if (!vy) this.dir = horiz
      else if (this.dir !== horiz && this.dir !== vert) this.dir = vert
      this.play(running ? 'run' : 'walk')
    } else {
      this.play('idle')
    }
    this.sprite.setDepth(this.sprite.y)
  }

  private play(anim: 'walk' | 'run' | 'idle') {
    this.sprite.anims.play(`${this.charKey}:${anim}:${this.dir}`, true)
  }
}

/** O foco está num campo de texto? */
export function isTyping() {
  const el = document.activeElement as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}
