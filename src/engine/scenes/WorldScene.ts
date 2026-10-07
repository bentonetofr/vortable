// ────────────────────────────────────────────────────────
// Cena de jogo: desenha UMA zona (chão + objetos), coloca o jogador e
// segue ele com a câmera. Pisar numa saída escurece a tela, carrega a
// zona de destino e reinicia a cena lá — só a zona atual fica na memória.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { Ground, solidTerrainRects } from '../world/ground'
import { Occluders, addObjectSolids, createObjectSprite } from '../world/objects'
import { Player, isTyping } from '../world/Player'
import { TILE, type Appearance, type Dir, type Portal, type ZoneData } from '../types'

export interface WorldSceneData {
  zone: ZoneData
  appearance: Appearance
  assetBase: string
  /** Busca outra zona do mundo (pra atravessar saídas). */
  loadZone: (id: string) => Promise<ZoneData | null>
  /** Chegando por uma saída: aparece nela, virado pra mesma direção. */
  arrival?: { portal: string; dir: Dir }
  /** Avisado a cada troca de zona (a interface mostra o nome). */
  onZone?: (zone: ZoneData) => void
}

const PLAYER_KEY = 'char:me'
const FADE_MS = 220

export class WorldScene extends Phaser.Scene {
  private player?: Player
  private cfg!: WorldSceneData
  /**
   * As saídas só disparam depois que o jogador sai de todas elas: quem
   * chega numa porta não volta na hora pela mesma porta.
   */
  private armed = false
  private travelling = false
  private occluders = new Occluders()

  constructor() {
    super('world')
  }

  init(data: WorldSceneData) {
    this.cfg = data
    this.player = undefined
    this.armed = false
    this.travelling = false
    this.occluders = new Occluders()
  }

  async create() {
    const { zone, assetBase, appearance, arrival } = this.cfg
    const W = zone.width * TILE, H = zone.height * TILE

    new Ground(this, zone)
    for (const o of zone.objects) this.occluders.add(createObjectSprite(this, o), o)

    const solids = this.physics.add.staticGroup()
    for (const r of solidTerrainRects(zone)) solids.add(this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
    addObjectSolids(this, zone.objects, solids)

    this.physics.world.setBounds(0, 0, W, H)
    const cam = this.cameras.main
    cam.setBounds(0, 0, W, H).setZoom(2).setRoundPixels(true).setBackgroundColor('#07080c')
    // zona menor que a tela (interiores): centraliza em vez de grudar no canto
    if (W * 2 < cam.width || H * 2 < cam.height) cam.removeBounds()
    if (arrival) cam.fadeIn(FADE_MS)
    this.cfg.onZone?.(zone)

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

    const door = arrival && zone.portals.find((p) => p.id === arrival.portal)
    // chega no meio da saída de destino; sem ela, no início da zona
    const at = door ? { x: door.x + door.w / 2, y: door.y + door.h / 2 + 5 } : zone.spawn
    this.player = new Player(this, PLAYER_KEY, at.x, at.y, arrival?.dir ?? 'down')
    this.physics.add.collider(this.player.sprite, solids)
    cam.startFollow(this.player.sprite, true, 0.15, 0.15)
    cam.centerOn(at.x, at.y)

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
    const player = this.player
    if (!player) return
    player.update()
    this.occluders.update(player.sprite.x, player.sprite.y)
    if (this.travelling) return

    const portal = this.portalUnder(player.foot)
    if (!portal) this.armed = true
    else if (this.armed && portal.to) this.travel(portal)
  }

  private portalUnder(foot: { x: number; y: number; w: number; h: number }): Portal | null {
    for (const p of this.cfg.zone.portals) {
      if (foot.x < p.x + p.w && p.x < foot.x + foot.w && foot.y < p.y + p.h && p.y < foot.y + foot.h) return p
    }
    return null
  }

  private async travel(portal: Portal) {
    const player = this.player!
    const to = portal.to!
    this.travelling = true
    player.frozen = true
    const cam = this.cameras.main
    const faded = new Promise<void>((resolve) => cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => resolve()))
    cam.fadeOut(FADE_MS)
    const [zone] = await Promise.all([this.cfg.loadZone(to.zone).catch(() => null), faded])
    if (!this.sys.isActive()) return

    if (!zone) {
      console.warn('[vortable] saída leva pra uma zona que não existe:', to.zone)
      cam.fadeIn(FADE_MS)
      this.toast('Essa passagem não leva a lugar nenhum (zona apagada ou não salva).')
      player.frozen = false
      this.travelling = false
      this.armed = false
      return
    }
    this.scene.restart({ ...this.cfg, zone, arrival: { portal: to.portal, dir: player.facing } } satisfies WorldSceneData)
  }

  private toast(msg: string) {
    const cam = this.cameras.main
    const t = this.add.text(cam.midPoint.x, cam.midPoint.y - cam.height / (2 * cam.zoom) + 16, msg, {
      fontFamily: 'system-ui', fontSize: '11px', color: '#ffc174', stroke: '#000', strokeThickness: 3, align: 'center',
      wordWrap: { width: cam.width / cam.zoom - 32 },
    }).setOrigin(0.5, 0).setDepth(1e9).setResolution(4).setScrollFactor(1)
    this.time.delayedCall(3000, () => t.destroy())
  }
}
