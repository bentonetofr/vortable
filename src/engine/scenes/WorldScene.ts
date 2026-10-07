// ────────────────────────────────────────────────────────
// Cena de jogo: desenha UMA zona (chão + objetos), coloca o jogador e
// segue ele com a câmera. Pisar numa saída escurece a tela, carrega a
// zona de destino e reinicia a cena lá — só a zona atual fica na memória.
// A iluminação (lighting.ts) é desenhada depois que a câmera chega na
// posição do quadro — por isso a câmera segue o jogador aqui, à mão.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { buildCharacter } from '../character/compose'
import { Ground, solidTerrainRects } from '../world/ground'
import { Occluders, addObjectSolids, createObjectSprite } from '../world/objects'
import { FenceLayer, fenceSolids } from '../world/fences'
import { Player, isTyping } from '../world/Player'
import { BLOB, Lighting } from '../world/lighting'
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
  /** Avisado de tempos em tempos com a hora da zona (0–24), pro relógio da interface. */
  onClock?: (hour: number) => void
  /** Deslocamento do relógio do mundo em ms (o teste do editor começa na hora da prévia). */
  timeOffset?: number
}

const PLAYER_KEY = 'char:me'
const FADE_MS = 220
/** Quanto a câmera anda até o jogador por quadro (0–1). */
const FOLLOW_LERP = 0.15
const CLOCK_MS = 500

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
  private lighting?: Lighting
  private blob?: Phaser.GameObjects.Image
  private clockAt = 0

  constructor() {
    super('world')
  }

  init(data: WorldSceneData) {
    this.cfg = data
    this.player = undefined
    this.armed = false
    this.travelling = false
    this.occluders = new Occluders()
    this.lighting = undefined
    this.blob = undefined
    this.clockAt = 0
  }

  async create() {
    const { zone, assetBase, appearance, arrival } = this.cfg
    const W = zone.width * TILE, H = zone.height * TILE

    new Ground(this, zone)
    for (const o of zone.objects) this.occluders.add(createObjectSprite(this, o), o)
    new FenceLayer(this, zone)
    const lighting = (this.lighting = new Lighting(this, zone))
    lighting.timeOffset = this.cfg.timeOffset ?? 0
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this))

    const solids = this.physics.add.staticGroup()
    for (const r of [...solidTerrainRects(zone), ...fenceSolids(zone)]) solids.add(this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
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
    cam.centerOn(at.x, at.y)
    // sombra macia sob os pés (o boneco LPC não tem) + a sombra comprida do sol
    this.blob = this.add.image(at.x, at.y, BLOB).setScale(0.75, 0.6).setAlpha(0.32)
    const sprite = this.player.sprite
    lighting.extraCasters = () => [{ key: sprite.texture.key, frame: sprite.frame.name, x: sprite.x, y: sprite.y, originY: sprite.originY }]

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

  /** Depois da física e antes de desenhar: câmera no jogador, sombra dos pés, luz. */
  private preRender() {
    const player = this.player
    const cam = this.cameras.main
    if (player) {
      const s = player.sprite
      let x = cam.scrollX + (s.x - cam.width / 2 - cam.scrollX) * FOLLOW_LERP
      let y = cam.scrollY + (s.y - cam.height / 2 - cam.scrollY) * FOLLOW_LERP
      if (cam.useBounds) {
        x = cam.clampX(x)
        y = cam.clampY(y)
      }
      cam.setScroll(x, y)
      this.blob?.setPosition(s.x, s.y - 1).setDepth(s.depth - 0.5)
    }
    const lighting = this.lighting
    if (!lighting) return
    lighting.render(this.game.loop.delta)
    const now = this.time.now
    if (this.cfg.onClock && now - this.clockAt > CLOCK_MS) {
      this.clockAt = now
      this.cfg.onClock(lighting.hour)
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
