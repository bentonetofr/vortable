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
import { NPC_PEER } from '../net/hub'
import { NpcLayer } from '../world/npcs'
import type { NetHub } from '../net/hub'
import { BLOB, Lighting } from '../world/lighting'
import { ZoneAudio } from '../audio/ZoneAudio'
import { AudioEngine, readPrefs, writePrefs } from '../audio/engine'
import { DAY_MINUTES, TILE, type Appearance, type Dir, type Portal, type WorldSky, type ZoneData } from '../types'

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
  /** Hora e tempo do mundo, iguais em todas as zonas (acompanha a cena nas trocas de zona). */
  sky?: WorldSky
  /** O teclado do boneco está travado agora? (lido ao abrir a cena e a cada zona nova) */
  inputLocked?: () => boolean
  /** Rede: os outros jogadores (sem isto, o jogo é solo). */
  hub?: NetHub
  /** Aparece neste ponto (teletransporte do mestre), no lugar da saída ou do início. */
  at?: { x: number; y: number }
  /** Pra onde o boneco olha ao aparecer em `at` (voltar de onde parou). */
  facing?: Dir
  /** Aviso mostrado quando a cena abre (ex.: "o mestre atualizou o mapa"). */
  notice?: string
  /** Câmera do mestre: sem boneco, câmera livre, só observa os jogadores. */
  watch?: boolean
  /** Câmera de observador: quem ela está acompanhando (guardado nas trocas de zona). */
  follow?: string
  /** Zoom da câmera enquanto acompanha alguém (padrão 2, o do jogo). */
  followZoom?: number
  /** Observador que também ouve os sons da zona (espectador; o mestre no Controle). */
  listen?: boolean
  /** Observador que ouve: o "Ouvir" está ligado? (lido a cada zona nova) */
  audioOn?: () => boolean
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
  private npcs?: NpcLayer
  private netAt = 0
  private netSent = ''
  /** Os "calços" dos NPCs parados (somem enquanto o mestre controla o NPC; mudam de lugar quando ele o larga). */
  private npcSolids = new Map<string, Phaser.GameObjects.Zone>()
  private solids?: Phaser.Physics.Arcade.StaticGroup
  /** NPC que o mestre (câmera) controla agora, como se fosse um jogador. */
  private npcCtl: { id: string; player: Player; blob: Phaser.GameObjects.Image; at: number; sent: string } | null = null
  private hiddenNpcs = ''
  /** Quanto andou desde o último passo, e onde estava no quadro anterior. */

  constructor() {
    super('world')
  }

  init(data: WorldSceneData) {
    // a cena recomeçou com um NPC controlado (troca de zona): a sala deixa de vê-lo como jogador
    if (this.npcCtl) this.cfg?.hub?.unhostNpc(NPC_PEER + this.npcCtl.id)
    this.npcCtl = null
    this.npcSolids = new Map()
    this.solids = undefined
    this.hiddenNpcs = ''
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
    this.switching = false
    this.reactions = 0
    this.remotes = undefined
    this.npcs = undefined
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
    lighting.sky = this.cfg.sky ?? { hour: null }
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
    // o observador (mestre) não ouve os sons da zona
    this.audio = this.cfg.watch && !this.cfg.listen ? null : ZoneAudio.create(this, zone)
    if (this.audio) this.audio.enabled = this.cfg.audioOn?.() ?? true
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
      this.audio?.destroy()
      this.audio = null
    })

    const solids = this.physics.add.staticGroup()
    for (const r of [...solidTerrainRects(zone), ...fenceSolids(zone)]) solids.add(this.add.zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h))
    addObjectSolids(this, zone.objects, solids)
    // NPCs parados: o jogador não atravessa
    this.solids = solids
    for (const n of zone.npcs ?? []) {
      const block = this.add.zone(n.x, n.y - 3, 18, 10)
      solids.add(block)
      this.npcSolids.set(n.id, block)
    }
    this.npcs = new NpcLayer(this, assetBase, this.cfg.watch ? 'always' : 'near')
    this.npcs.set(zone.npcs ?? [])

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
    // reações dos espectadores: um emoji que sobe no ponto onde ele estava olhando
    // o mestre largou um NPC que controlava: o NPC parado da zona passa pra esse ponto
    if (this.cfg.hub) {
      const off = this.cfg.hub.onNpcMove((m) => { if (m.zone === zone.id) this.applyNpcMove(m) })
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, off)
    }
    if (this.cfg.hub) {
      const off = this.cfg.hub.onReact((m) => { if (m.zone === zone.id) this.showReaction(m.emoji, m.name, m.x, m.y) })
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
    this.player = new Player(this, PLAYER_KEY, at.x, at.y, arrival?.dir ?? this.cfg.facing ?? 'down')
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
    if (this.npcCtl) this.npcCtl.player.locked = locked
  }

  // ── Câmera do mestre (observador) ──────────────────────

  private following: string | null = null
  private switching = false
  private followZoom = 2
  private reactions = 0

  private startWatch(zone: ZoneData, W: number, H: number) {
    const cam = this.cameras.main
    cam.removeBounds()
    this.watchFit()
    // seguindo alguém antes da troca de zona: continua e volta ao zoom do jogo
    if (this.cfg.follow) { this.following = this.cfg.follow; cam.setZoom(this.cfg.followZoom ?? 2) }
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
      lighting.extraCasters = () => [...(this.remotes?.sprites ?? []), ...(this.npcCtl ? [this.npcCtl.player.sprite] : [])].map((s) => ({ key: s.texture.key, frame: s.frame.name, x: s.x, y: s.y, originY: s.originY }))
    }
    void W; void H
  }

  /** Troca a zona que o observador está vendo. */
  async watchZone(id: string) {
    if (!this.cfg.watch || id === this.cfg.zone.id) return
    const zone = await this.cfg.loadZone(id).catch(() => null)
    if (!zone || !this.sys.isActive()) return
    this.scene.restart({ ...this.cfg, zone, follow: this.following ?? undefined, followZoom: this.followZoom, notice: undefined } satisfies WorldSceneData)
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
  watchFollow(id: string | null, zoom = 2) {
    this.following = id
    this.followZoom = zoom // o padrão é o enquadramento do próprio jogo
    if (id) this.cameras.main.setZoom(zoom)
  }

  /** Onde o jogador está agora (pra voltar exatamente aí depois). */
  snapshotPlay() {
    const s = this.player?.sprite
    if (!s || this.travelling) return null
    return { zoneId: this.cfg.zone.id, x: Math.round(s.x), y: Math.round(s.y), dir: this.player!.facing }
  }

  /** Quem a câmera acompanha agora. */
  watchFollowing() {
    return this.following
  }

  /** Espectador reage: o emoji aparece no jogador acompanhado (ou no centro da câmera) pra todos. */
  watchReact(emoji: string) {
    const hub = this.cfg.hub
    if (!hub) return
    const p = this.following ? hub.peers.get(this.following) : null
    const at = p?.state && p.state.zone === this.cfg.zone.id ? { x: p.state.x, y: p.state.y - 40 } : this.cameras.main.midPoint
    // um pouco de espalhamento: várias reações seguidas não ficam uma em cima da outra
    hub.react(emoji, this.cfg.zone.id, at.x + (Math.random() - 0.5) * 70, at.y - Math.random() * 10)
  }

  /** Um emoji sobe e some (com o nome de quem reagiu embaixo). */
  private showReaction(emoji: string, name: string, x: number, y: number) {
    if (this.reactions >= 24) return
    this.reactions++
    const icon = this.add.text(x, y, emoji, {
      fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui', fontSize: '20px',
    }).setOrigin(0.5, 1).setDepth(1e9).setResolution(4)
    const label = name
      ? this.add.text(x, y + 1, name, { fontFamily: 'system-ui', fontSize: '8px', color: '#e9e2d0', stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5, 0).setDepth(1e9).setResolution(4)
      : null
    this.tweens.add({
      targets: label ? [icon, label] : [icon], y: '-=44', alpha: { from: 1, to: 0 }, duration: 1900, ease: 'Sine.easeOut',
      onComplete: () => { icon.destroy(); label?.destroy(); this.reactions = Math.max(0, this.reactions - 1) },
    })
    this.tweens.add({ targets: icon, scale: { from: 0.6, to: 1.15 }, duration: 260, ease: 'Back.easeOut' })
  }

  /** Quem está na sala e onde (pra lista do mestre). */
  watchPeers() {
    const hub = this.cfg.hub
    if (!hub) return []
    return [...hub.peers.values()].filter((p) => !p.hello.npc).map((p) => ({
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
    const ctl = this.npcCtl
    const player = this.player ?? ctl?.player
    const cam = this.cameras.main
    this.syncHiddenNpcs()
    if (player) {
      const s = player.sprite
      let x = cam.scrollX + (s.x - cam.width / 2 - cam.scrollX) * FOLLOW_LERP
      let y = cam.scrollY + (s.y - cam.height / 2 - cam.scrollY) * FOLLOW_LERP
      if (cam.useBounds) {
        x = cam.clampX(x)
        y = cam.clampY(y)
      }
      cam.setScroll(x, y)
      ;(ctl && !this.player ? ctl.blob : this.blob)?.setPosition(s.x, s.y - 1).setDepth(s.depth - 0.5)
    }
    // a grama chacoalha embaixo de quem está andando
    const s = player?.sprite
    const moving = !!s && (s.body as Phaser.Physics.Arcade.Body).velocity.lengthSq() > 1
    this.remotes?.update(this.game.loop.delta / 1000)
    this.npcs?.update(player?.sprite)
    if (this.following) {
      const p = this.cfg.hub?.peers.get(this.following)
      if (p?.state && p.state.zone === this.cfg.zone.id) {
        cam.scrollX += (p.state.x - cam.width / 2 - cam.scrollX) * FOLLOW_LERP
        cam.scrollY += (p.state.y - cam.height / 2 - cam.scrollY) * FOLLOW_LERP
      } else if (p?.state && this.cfg.watch && !this.switching) {
        // o jogador seguido foi pra outra zona: a câmera vai atrás
        this.switching = true
        void this.watchZone(p.state.zone).finally(() => { this.switching = false })
      }
    }
    // hora, tempo e vento do mestre (ao vivo)
    const liveEnv = this.cfg.hub?.envFor(this.cfg.zone.id) ?? null
    if (this.lighting) this.lighting.liveEnv = liveEnv
    if (this.audio) this.audio.live = liveEnv?.sound ?? null
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
    const ctl = this.npcCtl
    if (ctl) {
      ctl.player.update()
      this.publishNpc(ctl)
      this.occluders.update(ctl.player.sprite.x, ctl.player.sprite.y)
    }
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

  // ── Mestre controla um NPC ─────────────────────────────

  private npcNoScroll = (e: KeyboardEvent) => {
    if (!isTyping() && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault()
  }

  /** O som da zona (pra o painel Sons do mestre: níveis, passos, trovão). */
  watchAudio() {
    return this.audio
  }

  /** Hora do mundo definida no editor (fixa ou ciclo). */
  watchSky() {
    const sky = this.cfg.sky ?? { hour: null }
    return { hour: sky.hour, dayMinutes: sky.dayMinutes ?? DAY_MINUTES }
  }

  /** NPCs parados desta zona (pra lista do mestre). */
  watchNpcs() {
    return (this.cfg.zone.npcs ?? []).map((n) => ({ id: n.id, name: n.name, role: n.role }))
  }

  /** O NPC que o mestre controla agora (null = nenhum). */
  controllingNpc() {
    return this.npcCtl?.id ?? null
  }

  /**
   * Câmera do mestre: passa a andar com este NPC (teclado, colisão e animação como um jogador).
   * Os jogadores o veem andar. Não atravessa saídas: fica na zona.
   */
  async controlNpc(id: string): Promise<boolean> {
    if (!this.cfg.watch || this.npcCtl || !this.solids) return false
    const npc = (this.cfg.zone.npcs ?? []).find((n) => n.id === id)
    if (!npc) return false
    const texKey = `char:npc:${npc.id}`
    try {
      await buildCharacter(this, texKey, this.cfg.assetBase, npc.appearance)
    } catch (err) {
      console.error('[vortable] NPC não carregou', err)
      return false
    }
    if (!this.sys.isActive() || this.npcCtl || !this.solids) return false
    const player = new Player(this, texKey, npc.x, npc.y, npc.dir)
    player.locked = this.inputLocked
    this.physics.add.collider(player.sprite, this.solids)
    const blob = this.add.image(npc.x, npc.y, BLOB).setScale(0.75, 0.6).setAlpha(0.32)
    this.npcCtl = { id, player, blob, at: 0, sent: '' }
    this.following = null
    this.cameras.main.setZoom(2)
    window.addEventListener('keydown', this.npcNoScroll)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', this.npcNoScroll))
    this.cfg.hub?.hostNpc({ id, name: npc.name, appearance: npc.appearance, showName: !!npc.showName })
    this.syncHiddenNpcs()
    return true
  }

  /**
   * Solta o NPC: ele fica onde está. Todos atualizam na hora; `persist` guarda o ponto na zona
   * (pra quem entrar depois) e roda em segundo plano.
   */
  async releaseNpc(persist?: (r: { id: string; zone: string; x: number; y: number; dir: Dir }) => Promise<void>) {
    const ctl = this.npcCtl
    if (!ctl) return
    this.npcCtl = null
    window.removeEventListener('keydown', this.npcNoScroll)
    const s = ctl.player.sprite
    const r = { id: ctl.id, zone: this.cfg.zone.id, x: Math.round(s.x), y: Math.round(s.y), dir: ctl.player.facing }
    s.destroy()
    ctl.blob.destroy()
    const hub = this.cfg.hub
    this.applyNpcMove(r)
    this.syncHiddenNpcs()
    hub?.moveNpc(r)
    hub?.unhostNpc(NPC_PEER + r.id)
    try { await persist?.(r) } catch (err) { console.error('[vortable] não deu pra guardar o ponto do NPC', err) }
  }

  /** O NPC parado passa pra este ponto (e o "calço" dele junto). */
  private applyNpcMove(m: { id: string; x: number; y: number; dir: Dir }) {
    const npc = (this.cfg.zone.npcs ?? []).find((n) => n.id === m.id)
    if (!npc) return
    npc.x = m.x
    npc.y = m.y
    npc.dir = m.dir
    this.npcs?.set(this.cfg.zone.npcs ?? [])
    const block = this.npcSolids.get(m.id)
    if (block) {
      block.setPosition(m.x, m.y - 3)
      ;(block.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject()
    }
  }

  /** Quem está sendo controlado pelo mestre some do lugar parado (e o "calço" dele deixa de barrar). */
  private syncHiddenNpcs() {
    const ids = new Set<string>()
    if (this.npcCtl) ids.add(this.npcCtl.id)
    for (const id of this.cfg.hub?.peers.keys() ?? []) if (id.startsWith(NPC_PEER)) ids.add(id.slice(NPC_PEER.length))
    const key = [...ids].sort().join(',')
    if (key === this.hiddenNpcs) return
    this.hiddenNpcs = key
    this.npcs?.setHidden(ids)
    for (const [id, block] of this.npcSolids) (block.body as Phaser.Physics.Arcade.StaticBody).enable = !ids.has(id)
  }

  /** Conta pra sala onde o NPC controlado está (como um jogador de id `npc:<id>`). */
  private publishNpc(ctl: { id: string; player: Player; at: number; sent: string }) {
    const hub = this.cfg.hub
    if (!hub) return
    const now = this.time.now
    if (now - ctl.at < 100) return
    const s = ctl.player.sprite
    const sig = `${Math.round(s.x)},${Math.round(s.y)},${ctl.player.facing},${ctl.player.animName}`
    if (sig === ctl.sent && now - ctl.at < 1000) return
    ctl.at = now
    ctl.sent = sig
    hub.link.send({
      t: 'state', id: NPC_PEER + ctl.id, zone: this.cfg.zone.id,
      x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, dir: ctl.player.facing, anim: ctl.player.animName,
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
