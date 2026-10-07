// ────────────────────────────────────────────────────────
// Cena de jogo: desenha uma zona (chão + objetos), coloca o jogador
// e segue ele com a câmera.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { Ground, solidTerrainRects } from '../world/ground'
import { addObjectSolids, createObjectSprite } from '../world/objects'
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

    await buildCharacter(this, PLAYER_KEY, assetBase, appearance)
    if (!this.sys.isActive()) return
    this.player = new Player(this, PLAYER_KEY, zone.spawn.x, zone.spawn.y)
    this.physics.add.collider(this.player.sprite, solids)
    cam.startFollow(this.player.sprite, true, 0.15, 0.15)

    this.input.keyboard!.on('keydown-C', () => {
      const w = this.physics.world
      w.drawDebug = !w.drawDebug
      if (!w.debugGraphic) w.createDebugGraphic()
      w.debugGraphic.clear().setDepth(1e9).setVisible(w.drawDebug)
    })
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
