// ────────────────────────────────────────────────────────
// NPCs parados na cena (jogo e editor): um boneco por NPC da zona, de pé na
// pose "parado", virado pra direção que o mestre deixou, com sombra e o nome
// aparecendo quando alguém chega perto. A arte do boneco é montada no
// navegador a partir da aparência (a mesma dos personagens).
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import type { ZoneNpc } from '../types'
import { BLOB } from './lighting'

/** Até que distância (px) o nome aparece. */
const NAME_RANGE = 96

interface Item {
  npc: ZoneNpc
  sig: string
  texKey: string
  sprite: Phaser.GameObjects.Sprite | null
  shadow: Phaser.GameObjects.Image | null
  label: Phaser.GameObjects.Text | null
  building: boolean
}

export class NpcLayer {
  private items = new Map<string, Item>()

  /** `names`: 'near' mostra o nome de quem está perto do foco; 'always' sempre (editor). */
  constructor(private scene: Phaser.Scene, private assetBase: string, private names: 'near' | 'always' = 'near') {
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  /** Sprites visíveis agora (pra sombra do sol e luzes). */
  get sprites() {
    return [...this.items.values()].map((i) => i.sprite).filter((s): s is Phaser.GameObjects.Sprite => !!s)
  }

  /** Põe a lista de NPCs da zona na cena (cria os novos, move os que mudaram, tira os que saíram). */
  set(npcs: ZoneNpc[]) {
    const ids = new Set(npcs.map((n) => n.id))
    for (const [id, it] of this.items) if (!ids.has(id)) { this.drop(it); this.items.delete(id) }
    for (const npc of npcs) {
      const sig = JSON.stringify(npc.appearance)
      let it = this.items.get(npc.id)
      if (!it) {
        it = { npc, sig: '', texKey: `char:npc:${npc.id}`, sprite: null, shadow: null, label: null, building: false }
        this.items.set(npc.id, it)
      }
      it.npc = npc
      if (it.sig !== sig && !it.building) void this.build(it, sig)
      else this.place(it)
    }
  }

  private async build(it: Item, sig: string) {
    it.building = true
    try {
      await buildCharacter(this.scene, it.texKey, this.assetBase, it.npc.appearance)
    } catch (err) {
      console.error('[vortable] NPC não carregou', err)
      it.building = false
      it.sig = sig // não tenta de novo em loop
      return
    }
    it.building = false
    // a cena pode ter acabado (troca de zona) ou o NPC sido removido durante o carregamento
    if (!this.scene.sys.isActive() || this.items.get(it.npc.id) !== it) return
    it.sig = sig
    if (!it.sprite) {
      it.sprite = this.scene.add.sprite(0, 0, `${it.texKey}:idle`, 0).setOrigin(0.5, 62 / 64)
      it.shadow = this.scene.add.image(0, 0, BLOB).setScale(0.75, 0.6).setAlpha(0.32)
      it.label = this.scene.add.text(0, 0, it.npc.name, {
        fontFamily: 'system-ui', fontSize: '9px', color: '#ffe9c2', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setResolution(4).setVisible(false)
    }
    it.sprite.anims.play(`${it.texKey}:idle:${it.npc.dir}`, true)
    this.place(it)
  }

  private place(it: Item) {
    const { sprite, shadow, label, npc } = it
    if (!sprite || !shadow || !label) return
    sprite.setPosition(npc.x, npc.y).setDepth(npc.y)
    shadow.setPosition(npc.x, npc.y - 1).setDepth(npc.y - 0.5)
    label.setPosition(npc.x, npc.y - 66).setDepth(1e8)
    if (label.text !== npc.name) label.setText(npc.name)
    // sem nome em cima da cabeça, a não ser que o mestre ligue (ZoneNpc.showName)
    if (!npc.showName) label.setVisible(false)
    else if (this.names === 'always') label.setVisible(true)
    const key = `${it.texKey}:idle:${npc.dir}`
    if (sprite.anims.currentAnim?.key !== key && this.scene.anims.exists(key)) sprite.anims.play(key, true)
  }

  /** Mostra o nome de quem está perto de `focus` (o jogador). */
  update(focus?: { x: number; y: number }) {
    if (this.names === 'always') return
    for (const it of this.items.values()) {
      if (!it.label) continue
      if (!it.npc.showName) { it.label.setVisible(false); continue }
      const near = !!focus && Phaser.Math.Distance.Between(focus.x, focus.y, it.npc.x, it.npc.y) < NAME_RANGE
      it.label.setVisible(near)
    }
  }

  /** O NPC (do editor) sob um ponto do mundo, ou null. */
  npcAt(x: number, y: number): ZoneNpc | null {
    let best: ZoneNpc | null = null
    for (const it of this.items.values()) {
      const { npc } = it
      if (Math.abs(x - npc.x) <= 14 && y <= npc.y + 4 && y >= npc.y - 52 && (!best || npc.y > best.y)) best = npc
    }
    return best
  }

  private drop(it: Item) {
    it.sprite?.destroy()
    it.shadow?.destroy()
    it.label?.destroy()
    it.sprite = it.shadow = it.label = null
  }

  destroy() {
    for (const it of this.items.values()) this.drop(it)
    this.items.clear()
  }
}
