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
import { Remotes } from '../net/remotes'
import type { NetHub } from '../net/hub'
import { BLOB, Lighting } from '../world/lighting'
import { ZoneAudio } from '../audio/ZoneAudio'
import { AudioEngine, readPrefs, writePrefs } from '../audio/engine'
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
  /** O teclado do boneco está travado agora? (lido ao abrir a cena e a cada zona nova) */
  inputLocked?: () => boolean
  /** Rede: os outros jogadores (sem isto, o jogo é solo). */
  hub?: NetHub
  /** Aparece neste ponto (teletransporte do mestre), no lugar da saída ou do início. */
  at?: { x: number; y: number }
  /** Aviso mostrado quando a cena abre (ex.: "o mestre atualizou o mapa"). */
  notice?: string
  /** Câmera do mestre: sem boneco, câmera livre, só observa os jogadores. */
  watch?: boolean
}

const PLAYER_KEY = 'char:me'
const FADE_MS = 220
/** Quanto a câmera anda até o jogador por quadro (0–1). */
const FOLLOW_LERP = 0.15
const CLOCK_MS = 500
/**
 * Quadros do ciclo em que o pé toca o chão (medidos nas folhas LPC):
 * andando, os quadros 2 e 6 de 1–8; correndo, o 0 e o 4 de 0–7.
 */
const FOOTFALLS: Record<string, number[]> = { walk: [2, 6], run: [0, 4] }

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
  private ground?: Ground
  private clockAt = 0
  private audio: ZoneAudio | null = null
  private remotes?: Remotes
  private netAt = 0
  private netSent = ''
  /** Quanto andou desde o último passo, e onde estava no quadro anterior. */

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
    this.ground = undefined
    this.clockAt = 0
    this.audio = null
    this.reloading = false
    this.remotes = undefined
    this.netAt = 0
    this.netSent = ''
  }

  async create() {
    const { zone, assetBase, appearance, arrival } = this.cfg
    const W = zone.width * TILE, H = zone.height * TILE

    this.ground = new Ground(this, zone)
    for (const o of zone.objects) this.occluders.add(createObjectSprite(this, o), o)
    new FenceLayer(this, zone)
    const lighting = (this.lighting = new Lighting(this, zone))
    lighting.timeOffset = this.cfg.timeOffset ?? 0
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
    // o observador (mestre) não ouve os sons da zona
    this.audio = this.cfg.watch ? null : ZoneAudio.create(this, zone)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
      this.audio?.destroy()
      this.audio = null
    })

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
    if (this.cfg.notice) this.toast(this.cfg.notice)
    // o mestre salvou ESTA zona: recarrega com a versão nova, sem sair do lugar
    if (this.cfg.hub) {
      const off = this.cfg.hub.onZoneChanged((id) => { if (id === zone.id) void this.reloadZone() })
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
    }
    if (this.cfg.watch) return this.startWatch(zone, W, H)

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
    const at = this.cfg.at ?? (door ? { x: door.x + door.w / 2, y: door.y + door.h / 2 + 5 } : zone.spawn)
    this.player = new Player(this, PLAYER_KEY, at.x, at.y, arrival?.dir ?? 'down')
    this.inputLocked = this.cfg.inputLocked?.() ?? this.inputLocked
    this.player.locked = this.inputLocked
    this.physics.add.collider(this.player.sprite, solids)
    this.syncFootsteps(this.player.sprite)
    cam.centerOn(at.x, at.y)
    // sombra macia sob os pés (o boneco LPC não tem) + a sombra comprida do sol
    this.blob = this.add.image(at.x, at.y, BLOB).setScale(0.75, 0.6).setAlpha(0.32)
    const sprite = this.player.sprite
    lighting.extraCasters = () => [
      { key: sprite.texture.key, frame: sprite.frame.name, x: sprite.x, y: sprite.y, originY: sprite.originY },
      ...(this.remotes?.sprites ?? []).map((s) => ({ key: s.texture.key, frame: s.frame.name, x: s.x, y: s.y, originY: s.originY })),
    ]

    // rede: os outros jogadores aparecem, e o mestre pode me levar pra outro lugar
    const hub = this.cfg.hub
    if (hub) {
      this.remotes = new Remotes(this, hub, assetBase, zone.id)
      hub.announce(this.cfg.appearance)
      const off = hub.onTeleport((m) => void this.teleportTo(m.zone, m.x, m.y))
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
    }

    // setas e espaço não rolam a página enquanto se joga (sem prender WASD dos campos de texto)
    const noScroll = (e: KeyboardEvent) => {
      if (!isTyping() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault()
    }
    window.addEventListener('keydown', noScroll)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', noScroll))

    // M: liga/desliga o som
    this.input.keyboard!.on('keydown-M', () => {
      if (isTyping()) return
      const muted = !readPrefs().muted
      writePrefs({ muted })
      AudioEngine.of(this)?.applyPrefs()
      this.toast(muted ? 'Som desligado (M liga de novo)' : 'Som ligado')
    })

    this.input.keyboard!.on('keydown-C', () => {
      if (isTyping()) return
      const w = this.physics.world
      w.drawDebug = !w.drawDebug
      if (!w.debugGraphic) w.createDebugGraphic()
      w.debugGraphic.clear().setDepth(1e9).setVisible(w.drawDebug)
    })
  }

  /** Um passo a cada vez que o quadro da animação é o de um pé tocando o chão. */
  private syncFootsteps(sprite: Phaser.GameObjects.Sprite) {
    const onFrame = (anim: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => {
      const kind = anim.key.split(':')[2] // `${chave}:${walk|run}:${direção}`
      const feet = FOOTFALLS[kind]
      if (!feet || !this.audio || !this.lighting) return
      const cols = kind === 'walk' ? 9 : 8
      if (!feet.includes(Number(frame.textureFrame) % cols)) return
      this.audio.step(sprite.x, sprite.y - 2, kind === 'run', this.lighting.weatherNow)
    }
    sprite.on(Phaser.Animations.Events.ANIMATION_START, onFrame)
    sprite.on(Phaser.Animations.Events.ANIMATION_UPDATE, onFrame)
  }

  private inputLocked = false

  /** Trava/destrava o teclado do boneco (cena do mestre por cima da tela). */
  setInputLocked(locked: boolean) {
    this.inputLocked = locked
    if (this.player) this.player.locked = locked
  }

  // ── Câmera do mestre (observador) ──────────────────────

  private following: string | null = null

  private startWatch(zone: ZoneData, W: number, H: number) {
    const cam = this.cameras.main
    cam.removeBounds()
    this.watchFit()
    cam.setRoundPixels(false)
    // arrastar move a câmera; a roda dá zoom no ponto sob o mouse
    const input = this.input
    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return
      this.following = null
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom
    })
    input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const before = cam.getWorldPoint(p.x, p.y)
      cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy < 0 ? 1.15 : 1 / 1.15), 0.2, 6))
      const after = cam.getWorldPoint(p.x, p.y)
      cam.scrollX += before.x - after.x
      cam.scrollY += before.y - after.y
    })
    const hub = this.cfg.hub
    if (hub) {
      this.remotes = new Remotes(this, hub, this.cfg.assetBase, zone.id)
      hub.observe()
    }
    const lighting = this.lighting
    if (lighting) {
      lighting.extraCasters = () => (this.remotes?.sprites ?? []).map((s) => ({ key: s.texture.key, frame: s.frame.name, x: s.x, y: s.y, originY: s.originY }))
    }
    void W; void H
  }

  /** Troca a zona que o observador está vendo. */
  async watchZone(id: string) {
    if (!this.cfg.watch || id === this.cfg.zone.id) return
    const zone = await this.cfg.loadZone(id).catch(() => null)
    if (!zone || !this.sys.isActive()) return
    this.scene.restart({ ...this.cfg, zone, notice: undefined } satisfies WorldSceneData)
  }

  /** Enquadra a zona inteira na tela. */
  watchFit() {
    const { zone } = this.cfg
    const cam = this.cameras.main
    const W = zone.width * TILE, H = zone.height * TILE
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / (W + 48), cam.height / (H + 48)), 0.2, 6))
    cam.centerOn(W / 2, H / 2)
    this.following = null
  }

  watchZoom(factor: number) {
    const cam = this.cameras.main
    cam.setZoom(Phaser.Math.Clamp(cam.zoom * factor, 0.2, 6))
  }

  watchFocus(x: number, y: number) {
    this.following = null
    this.cameras.main.centerOn(x, y)
  }

  /** A câmera acompanha um jogador (null solta). */
  watchFollow(id: string | null) {
    this.following = id
  }

  /** Quem está na sala e onde (pra lista do mestre). */
  watchPeers() {
    const hub = this.cfg.hub
    if (!hub) return []
    return [...hub.peers.values()].map((p) => ({
      id: p.hello.id, name: p.hello.name, zone: p.state?.zone ?? null, x: p.state?.x ?? 0, y: p.state?.y ?? 0,
    }))
  }

  private reloading = false

  /** Relê a zona atual (o mestre salvou) e reabre a cena no mesmo ponto. */
  private async reloadZone() {
    if (this.reloading || this.travelling) return
    this.reloading = true
    const fresh = await this.cfg.loadZone(this.cfg.zone.id).catch(() => null)
    if (!fresh || !this.sys.isActive()) { this.reloading = false; return }
    const s = this.player?.sprite
    this.scene.restart({
      ...this.cfg, zone: fresh, arrival: undefined, at: s ? { x: s.x, y: s.y } : undefined,
      notice: this.cfg.watch ? undefined : 'O mestre atualizou o mapa.',
    } satisfies WorldSceneData)
  }

  /** O mestre levou este jogador pra (x, y) de uma zona. */
  private async teleportTo(zoneId: string, x: number, y: number) {
    const player = this.player
    if (!player || this.travelling) return
    if (zoneId === this.cfg.zone.id) {
      player.sprite.setPosition(x, y)
      this.cameras.main.centerOn(x, y)
      return
    }
    this.travelling = true
    player.frozen = true
    const zone = await this.cfg.loadZone(zoneId).catch(() => null)
    if (!this.sys.isActive()) return
    if (!zone) {
      player.frozen = false
      this.travelling = false
      this.toast('O mestre tentou te levar a uma zona que não existe.')
      return
    }
    this.scene.restart({ ...this.cfg, zone, arrival: undefined, at: { x, y }, notice: undefined } satisfies WorldSceneData)
  }

  /** Troca a aparência do jogador sem recarregar a cena. */
  async setAppearance(appearance: Appearance) {
    this.cfg.appearance = appearance
    try {
      await buildCharacter(this, PLAYER_KEY, this.cfg.assetBase, appearance)
      this.cfg.hub?.announce(appearance)
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
    // a grama chacoalha embaixo de quem está andando
    const s = player?.sprite
    const moving = !!s && (s.body as Phaser.Physics.Arcade.Body).velocity.lengthSq() > 1
    this.remotes?.update(this.game.loop.delta / 1000)
    if (this.following) {
      const p = this.cfg.hub?.peers.get(this.following)
      if (p?.state && p.state.zone === this.cfg.zone.id) {
        cam.scrollX += (p.state.x - cam.width / 2 - cam.scrollX) * FOLLOW_LERP
        cam.scrollY += (p.state.y - cam.height / 2 - cam.scrollY) * FOLLOW_LERP
      }
    }
    // hora, tempo e vento do mestre (ao vivo)
    if (this.lighting) this.lighting.liveEnv = this.cfg.hub?.envFor(this.cfg.zone.id) ?? null
    this.ground?.tufts.update(cam, this.game.loop.delta / 1000, moving ? [{ x: s!.x, y: s!.y - 2 }] : [])
    const lighting = this.lighting
    if (!lighting) return
    lighting.render(this.game.loop.delta)
    if (this.audio) {
      const listener = player?.sprite ?? cam.midPoint
      this.audio.update(this.game.loop.delta / 1000, {
        x: listener.x, y: listener.y, hour: lighting.hour, wind: lighting.wind.strength, weather: lighting.weatherNow, strikes: lighting.strikes,
      })
    }
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
    this.publish(player)
    this.occluders.update(player.sprite.x, player.sprite.y)
    if (this.travelling) return

    const portal = this.portalUnder(player.foot)
    if (!portal) this.armed = true
    else if (this.armed && portal.to) this.travel(portal)
  }

  /** Conta pra sala onde estou: ~10×/s, e só quando mudou (com um sinal de vida por segundo). */
  private publish(player: Player) {
    const hub = this.cfg.hub
    if (!hub) return
    const now = this.time.now
    if (now - this.netAt < 100) return
    const s = player.sprite
    const sig = `${Math.round(s.x)},${Math.round(s.y)},${player.facing},${player.animName}`
    if (sig === this.netSent && now - this.netAt < 1000) return
    this.netAt = now
    this.netSent = sig
    hub.link.send({
      t: 'state', id: hub.link.selfId, zone: this.cfg.zone.id,
      x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, dir: player.facing, anim: player.animName,
    })
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
    this.scene.restart({ ...this.cfg, zone, arrival: { portal: to.portal, dir: player.facing }, at: undefined, notice: undefined } satisfies WorldSceneData)
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
