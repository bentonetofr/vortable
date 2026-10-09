// ────────────────────────────────────────────────────────
// Os bonecos dos outros jogadores na cena: criados a partir do NetHub,
// suavizados entre uma mensagem e outra e escondidos quando estão em
// outra zona.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { buildRat } from '../character/rat'
import { BLOB } from '../world/lighting'
import type { Appearance } from '../types'
import type { NetHub, NetState } from './hub'

/** Quão rápido o boneco alcança a posição recebida (maior = mais colado). */
const SMOOTH = 14
/** Mais longe que isso = teletransporte: aparece direto, sem deslizar. */
const SNAP_DIST = 160
/** Sem notícias há tanto tempo, o boneco some (conexão caiu sem avisar). */
const STALE_MS = 8000

interface Avatar {
  id: string
  texKey: string
  sig: string
  appearance: Appearance
  building: boolean
  sprite: Phaser.GameObjects.Sprite | null
  shadow: Phaser.GameObjects.Image | null
  label: Phaser.GameObjects.Text | null
  name: string
  /** Nome em cima da cabeça (NPC controlado só mostra se o mestre ligou). */
  showLabel: boolean
  /** NPC transformado em rato: desenho próprio, bem menor. */
  rat: boolean
  state: NetState | null
  stateAt: number
  placed: boolean
  playing: string
}

export class Remotes {
  private avatars = new Map<string, Avatar>()

  constructor(
    private scene: Phaser.Scene,
    private hub: NetHub,
    private assetBase: string,
    private zoneId: string,
  ) {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  /** Sprites visíveis agora (pra sombra do sol). */
  get sprites() {
    return [...this.avatars.values()].filter((a) => a.sprite?.visible).map((a) => a.sprite!)
  }

  update(dt: number) {
    const now = this.scene.time.now
    // entrou / trocou de boneco
    for (const [id, peer] of this.hub.peers) {
      const rat = peer.hello.form === 'rat'
      const sig = (rat ? 'rato:' : '') + JSON.stringify(peer.hello.appearance)
      let a = this.avatars.get(id)
      if (!a) {
        a = {
          id, texKey: `char:r:${id}`, sig: '', appearance: peer.hello.appearance, building: false,
          sprite: null, shadow: null, label: null, name: peer.hello.name, showLabel: true, rat: false, state: null, stateAt: 0, placed: false, playing: '',
        }
        this.avatars.set(id, a)
      }
      a.name = peer.hello.name
      a.showLabel = !peer.hello.npc || !!peer.hello.showName
      if (a.label && a.label.text !== a.name) a.label.setText(a.name)
      if (peer.state && peer.state !== a.state) { a.state = peer.state; a.stateAt = now }
      if (a.sig !== sig && !a.building) void this.build(a, peer.hello.appearance, sig, rat)
    }
    // saiu
    for (const [id, a] of this.avatars) {
      if (!this.hub.peers.has(id)) { this.drop(a); this.avatars.delete(id) }
    }
    // posição, animação e visibilidade
    const k = 1 - Math.exp(-SMOOTH * dt)
    for (const a of this.avatars.values()) {
      const { sprite, shadow, label, state } = a
      if (!sprite || !shadow || !label || !state) continue
      const here = state.zone === this.zoneId && now - a.stateAt < STALE_MS
      sprite.setVisible(here)
      shadow.setVisible(here)
      label.setVisible(here && a.showLabel)
      if (!here) { a.placed = false; continue }
      if (!a.placed || Phaser.Math.Distance.Between(sprite.x, sprite.y, state.x, state.y) > SNAP_DIST) {
        sprite.setPosition(state.x, state.y)
        a.placed = true
      } else {
        sprite.setPosition(sprite.x + (state.x - sprite.x) * k, sprite.y + (state.y - sprite.y) * k)
      }
      sprite.setDepth(sprite.y)
      shadow.setPosition(sprite.x, sprite.y - 1).setDepth(sprite.depth - 0.5)
      label.setPosition(sprite.x, sprite.y - (a.rat ? 22 : 66)).setDepth(1e8)
      const key = `${a.texKey}:${state.anim}:${state.dir}`
      if (a.playing !== key && this.scene.anims.exists(key)) {
        sprite.anims.play(key, true)
        a.playing = key
      }
    }
  }

  private async build(a: Avatar, appearance: Appearance, sig: string, rat = false) {
    a.building = true
    try {
      if (rat) buildRat(this.scene, a.texKey)
      else await buildCharacter(this.scene, a.texKey, this.assetBase, appearance)
    } catch (err) {
      console.error('[vortable] boneco de outro jogador não carregou', err)
      a.building = false
      a.sig = sig // não tenta de novo em loop
      return
    }
    a.building = false
    // a cena pode ter acabado (troca de zona) ou o jogador saído durante o carregamento
    if (!this.scene.sys.isActive() || this.avatars.get(a.id) !== a) return
    a.sig = sig
    a.appearance = appearance
    a.playing = ''
    a.rat = rat
    if (!a.sprite) {
      a.sprite = this.scene.add.sprite(0, 0, `${a.texKey}:idle`, 0).setOrigin(0.5, 62 / 64).setVisible(false)
      a.shadow = this.scene.add.image(0, 0, BLOB).setScale(0.75, 0.6).setAlpha(0.32).setVisible(false)
      a.label = this.scene.add.text(0, 0, a.name, {
        fontFamily: 'system-ui', fontSize: '9px', color: '#ffe9c2', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setResolution(4).setVisible(false)
    }
    a.label?.setText(a.name)
    // a textura de mesmo nome foi refeita: o sprite aponta pra ela de novo; o rato tem sombra menor
    a.sprite.setTexture(`${a.texKey}:idle`, 0)
    a.shadow?.setScale(rat ? 0.38 : 0.75, rat ? 0.3 : 0.6)
  }

  private drop(a: Avatar) {
    a.sprite?.destroy()
    a.shadow?.destroy()
    a.label?.destroy()
    a.sprite = a.shadow = a.label = null
  }

  private destroy() {
    for (const a of this.avatars.values()) this.drop(a)
    this.avatars.clear()
  }
}
