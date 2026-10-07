// ────────────────────────────────────────────────────────
// Cena de jogo: desenha uma zona (chão + objetos), coloca o jogador
// e segue ele com a câmera.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { Ground, solidTerrainRects } from '../world/ground'
import { addObjectSolids, createObjectSprite } from '../world/objects'
import { Player, isTyping } from '../world/Player'
import { TILE, type Appearance, type ZoneData } from '../types'

export interface WorldSceneData {
  zone: ZoneData
  appearance: Appearance
  assetBase: string
}

const PLAYER_KEY = 'char:me'

export class WorldScene extends Phaser.Scene {
  private player?: Player
  private cfg!: WorldSceneData

  constructor() {
    super('world')
  }

  init(data: WorldSceneData) {
    this.cfg = data
    this.player = undefined
  }

  async create() {
    const { zone, assetBase, appearance } = this.cfg
    const W = zone.width * TILE, H = zone.height * TILE

    new Ground(this, zone)
    for (const o of zone.objects) createObjectSprite(this, o)

    const solids = this.physics.add.staticGroup()
    for (const r of solidTerrainRects(zone)) solids.add(this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
    addObjectSolids(this, zone.objects, solids)

    this.physics.world.setBounds(0, 0, W, H)
    const cam = this.cameras.main
    cam.setBounds(0, 0, W, H).setZoom(2).setRoundPixels(true).setBackgroundColor('#12100e')
    // zona menor que a tela: centraliza em vez de grudar no canto
    if (W * 2 < cam.width || H * 2 < cam.height) cam.removeBounds()

    try {
      await buildCharacter(this, PLAYER_KEY, assetBase, appearance)
    } catch (err) {
      console.error('[vortable] boneco não carregou', err)
      this.add.text(cam.midPoint.x, cam.midPoint.y, 'Não deu pra carregar o boneco.\nConfira a conexão e recarregue.', {
        fontFamily: 'system-ui', fontSize: '12px', color: '#ffc174', align: 'center', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(1e9).setResolution(4)
      return
    }
    if (!this.sys.isActive()) return
    this.player = new Player(this, PLAYER_KEY, zone.spawn.x, zone.spawn.y)
    this.physics.add.collider(this.player.sprite, solids)
    cam.startFollow(this.player.sprite, true, 0.15, 0.15)

    // setas e espaço não rolam a página enquanto se joga (sem prender WASD dos campos de texto)
    const noScroll = (e: KeyboardEvent) => {
      if (!isTyping() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', noScroll)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', noScroll))

    this.input.keyboard!.on('keydown-C', () => {
      if (isTyping()) return
      const w = this.physics.world
      w.drawDebug = !w.drawDebug
      if (!w.debugGraphic) w.createDebugGraphic()
      w.debugGraphic.clear().setDepth(1e9).setVisible(w.drawDebug)
    })
  }

  /** Troca a aparência do jogador sem recarregar a cena. */
  async setAppearance(appearance: Appearance) {
    this.cfg.appearance = appearance
    try {
      await buildCharacter(this, PLAYER_KEY, this.cfg.assetBase, appearance)
      this.player?.refresh()
    } catch (err) {
      console.error('[vortable] aparência não carregou', err)
    }
  }

  update() {
    this.player?.update()
  }
}
