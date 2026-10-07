// ────────────────────────────────────────────────────────
// Cena principal: desenha uma zona (chão + objetos), coloca o jogador
// e segue ele com a câmera.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { preloadTerrains, renderGround, solidTerrainRects } from '../world/ground'
import { preloadObjects, registerObjectFrames, spawnObjects } from '../world/objects'
import { Player } from '../world/Player'
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
  }

  preload() {
    preloadTerrains(this, this.cfg.assetBase)
    preloadObjects(this, this.cfg.assetBase)
  }

  async create() {
    const { zone, assetBase, appearance } = this.cfg
    const W = zone.width * TILE, H = zone.height * TILE

    renderGround(this, zone)
    registerObjectFrames(this)

    const solids = this.physics.add.staticGroup()
    for (const r of solidTerrainRects(zone)) solids.add(this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
    spawnObjects(this, zone, solids)

    this.physics.world.setBounds(0, 0, W, H)
    this.cameras.main.setBounds(0, 0, W, H).setZoom(2).setRoundPixels(true).setBackgroundColor('#12100e')

    await buildCharacter(this, PLAYER_KEY, assetBase, appearance)
    this.player = new Player(this, PLAYER_KEY, zone.spawn.x, zone.spawn.y)
    this.physics.add.collider(this.player.sprite, solids)
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15)

    this.input.keyboard!.on('keydown-C', () => {
      const w = this.physics.world
      w.drawDebug = !w.drawDebug
      if (!w.debugGraphic) w.createDebugGraphic()
      w.debugGraphic.clear().setDepth(1e9).setVisible(w.drawDebug)
    })
    this.events.emit('vortable-ready')
  }

  /** Troca a aparência do jogador sem recarregar a cena. */
  async setAppearance(appearance: Appearance) {
    this.cfg.appearance = appearance
    await buildCharacter(this, PLAYER_KEY, this.cfg.assetBase, appearance)
    this.player?.refresh()
  }

  update() {
    this.player?.update()
  }
}
