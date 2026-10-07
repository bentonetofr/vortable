// ────────────────────────────────────────────────────────
// Cena do editor: mostra a zona e aplica as ferramentas com o mouse.
//   pincel/borracha: pinta os vértices de um quadrado de N×N tiles
//                    (Shift + clique: linha reta desde o último ponto)
//   balde: troca todos os vértices ligados com o mesmo terreno
//   objeto: carimba o objeto escolhido; arrastando, vai carimbando
//           espaçado (Shift: variante e espelho sorteados)
//   selecionar: clique seleciona (Shift/Ctrl soma), arrastar no vazio faz
//               um retângulo de seleção, arrastar um objeto move o grupo
//   saída: arraste pra desenhar a área que leva a outra zona; clique pra
//          selecionar/arrastar; Del apaga (o destino se escolhe no painel)
//   cômodo: arraste um retângulo → piso, parede e moldura prontos (Ctrl:
//           apaga); clique num cômodo troca o estilo dele; Alt+clique copia
//   luz: clique põe uma luz solta; clique numa luz seleciona/arrasta; Del apaga
//   início: onde o jogador aparece
//   Alt+clique: conta-gotas (copia terreno ou objeto)
// Câmera: roda dá zoom suave (no cursor); Espaço + arrastar, botão do
// meio/direito ou setas/WASD movem; Alt + roda muda o pincel.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { objectDef, objectSolids, sheetTexture, variantsOf } from '../assets/objects'
import { isFence, isOverlay, terrainById } from '../assets/terrains'
import { FenceLayer, fenceAt, fenceSolids } from '../world/fences'
import { Ground, cornerTerrain, overlayTerrain, solidTerrainRects } from '../world/ground'
import { createObjectSprite, updateObjectSprite, type ObjectSprite } from '../world/objects'
import { isTyping } from '../world/Player'
import { TILE, newId, type Portal, type ZoneLight, type ZoneObject } from '../types'
import { Lighting } from '../world/lighting'
import { lightingOf } from '../world/daylight'
import type { EditorState } from './EditorState'
import { applyRooms, connectedRoom, decodeRoom, encodeRoom, roomRoles } from '../world/rooms'

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 8
/** Quanto a roda mexe no zoom por pixel de rolagem (uma "trava" da roda ≈ 100px ≈ ×1,16). */
const WHEEL_ZOOM = 0.0015
/** Velocidade da animação do zoom (maior = chega mais rápido no alvo). */
const ZOOM_EASE = 18
/** Velocidade do movimento da tela pelo teclado, em px de tela por segundo. */
const PAN_SPEED = 700
const SELECT_TINT = 0x9fd3ff
const BRUSH_MAX = 8
/** Espera depois da última edição pra recortar as luzes pelas paredes de novo. */
const LIGHT_REBUILD_MS = 180

type Keys = Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'shift', Phaser.Input.Keyboard.Key>

export class EditorScene extends Phaser.Scene {
  private state!: EditorState
  private ground!: Ground
  private fences!: FenceLayer
  private sprites: (ObjectSprite | null)[] = []
  private gridGfx!: Phaser.GameObjects.Graphics
  private collisionGfx!: Phaser.GameObjects.Graphics
  private cursorGfx!: Phaser.GameObjects.Graphics
  private selectGfx!: Phaser.GameObjects.Graphics
  private portalGfx!: Phaser.GameObjects.Graphics
  private portalLabels: Phaser.GameObjects.Text[] = []
  private spawnMarker!: Phaser.GameObjects.Container
  private lighting!: Lighting
  private lightGfx!: Phaser.GameObjects.Graphics
  private lightTimer?: Phaser.Time.TimerEvent
  private movingLight: { id: string; dx: number; dy: number; moved: boolean } | null = null
  private ghost!: Phaser.GameObjects.Image

  private painting = false
  /** A pincelada atual já guardou o passo de desfazer? (só guarda se mudar algo) */
  private strokeSaved = false
  private lastPaint: { tx: number; ty: number } | null = null
  /** Onde a última pincelada terminou (Shift + clique continua dali em linha reta). */
  private lastStrokeEnd: { tx: number; ty: number } | null = null
  private panning: { x: number; y: number } | null = null
  /** Arrastando objetos selecionados: posição inicial de cada um. */
  private dragging: { start: { x: number; y: number }; from: Map<number, { x: number; y: number }>; moved: boolean } | null = null
  /** Retângulo de seleção (mundo); `add` = soma à seleção que já existia. */
  private marquee: { x0: number; y0: number; x1: number; y1: number; add: boolean } | null = null
  /** Carimbando objetos arrastando: onde saiu o último. */
  private stamping: { x: number; y: number; random: boolean } | null = null
  /**
   * Arrasto da ferramenta Cômodo: retângulo de tiles (cômodo, porta, apagar)
   * e, pra parede, a linha de vértices (vx/vy).
   */
  private roomDrag: {
    tx0: number; ty0: number; tx1: number; ty1: number
    vx0: number; vy0: number; vx1: number; vy1: number
    mode: 'room' | 'wall' | 'door' | 'erase'
  } | null = null
  private drawingPortal: { x0: number; y0: number; x1: number; y1: number } | null = null
  private movingPortal: { id: string; dx: number; dy: number; moved: boolean } | null = null
  private spaceKey!: Phaser.Input.Keyboard.Key
  private keys!: Keys

  /**
   * Zoom pra onde a câmera está indo (anima até lá), o ponto de tela que fica
   * parado e o ponto do MUNDO que estava ali quando o zoom começou (guardado
   * uma vez: recalcular a cada quadro acumularia o arredondamento da câmera).
   */
  private zoomTarget = 2
  private zoomAnchor: { x: number; y: number; wx: number; wy: number } | null = null

  constructor() {
    super('editor')
  }

  init(data: { state: EditorState }) {
    this.state = data.state
  }

  create() {
    this.ground = new Ground(this, this.state.zone)
    this.fences = new FenceLayer(this, this.state.zone)
    this.gridGfx = this.add.graphics().setDepth(1e8)
    this.collisionGfx = this.add.graphics().setDepth(1e8 + 1)
    this.cursorGfx = this.add.graphics().setDepth(1e8 + 2)
    this.selectGfx = this.add.graphics().setDepth(1e8 + 2)
    this.portalGfx = this.add.graphics().setDepth(1e8 + 1)
    this.ghost = this.add.image(0, 0, '__WHITE').setOrigin(0.5, 1).setAlpha(0.6).setDepth(1e8 + 3).setVisible(false)
    this.spawnMarker = this.makeSpawnMarker()
    this.lightGfx = this.add.graphics().setDepth(1e8 + 1)
    this.rebuildObjects()
    this.lighting = new Lighting(this, this.state.zone)
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
    this.refreshOverlays()

    const cam = this.cameras.main
    this.zoomTarget = this.state.zoom
    cam.setBackgroundColor('#0b0f18').setZoom(this.state.zoom).setRoundPixels(true)
    this.fitBounds()
    const view = this.state.view ?? this.state.zone.spawn
    cam.centerOn(view.x, view.y)

    this.input.mouse?.disableContextMenu()
    const kb = this.input.keyboard!
    const K = Phaser.Input.Keyboard.KeyCodes
    // sem "capturar" as teclas: os campos de texto continuam funcionando
    this.spaceKey = kb.addKey(K.SPACE, false)
    this.keys = kb.addKeys({ up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT, w: K.W, a: K.A, s: K.S, d: K.D, shift: K.SHIFT }, false) as Keys
    this.spaceKey.on('down', () => this.updateCursorStyle())
    this.spaceKey.on('up', () => this.updateCursorStyle())

    this.input.on('pointerdown', this.onDown, this)
    this.input.on('pointermove', this.onMove, this)
    this.input.on('pointerup', this.onUp, this)
    this.input.on('pointerupoutside', this.onUp, this)
    this.input.on('wheel', this.onWheel, this)
    this.input.on('gameout', () => {
      this.cursorGfx.clear()
      this.ghost.setVisible(false)
    })

    const off = this.state.on((c) => {
      if (c === 'zone') this.reloadZone()
      if (c === 'ui') this.onUiChange()
      if (c === 'world' || c === 'edit') this.drawPortals()
      if (c === 'edit') this.drawLights()
      if (c === 'objects') this.syncObjects()
      if (c === 'edit' || c === 'objects' || c === 'catalog') this.scheduleLights()
      if (c === 'catalog') {
        this.rebuildObjects()
        this.refreshOverlays()
        this.onUiChange()
      }
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off()
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, this.preRender, this)
      this.lightTimer?.remove()
      this.input.setDefaultCursor('')
      this.state.view = { x: cam.midPoint.x, y: cam.midPoint.y }
    })
  }

  // ── Câmera ─────────────────────────────────────────────

  update(_time: number, delta: number) {
    const cam = this.cameras.main
    const dt = Math.min(delta, 50) / 1000

    // zoom anima até o alvo, em escala logarítmica (cada passo "parece" igual)
    if (cam.zoom !== this.zoomTarget) {
      const a = 1 - Math.exp(-ZOOM_EASE * dt)
      let z = Math.exp(Math.log(cam.zoom) + (Math.log(this.zoomTarget) - Math.log(cam.zoom)) * a)
      if (Math.abs(Math.log(z / this.zoomTarget)) < 0.002) z = this.zoomTarget
      this.applyZoom(z, this.zoomAnchor ?? this.anchorAt(cam.width / 2, cam.height / 2))
      if (z === this.zoomTarget) this.zoomAnchor = null
    }

    // setas/WASD movem a tela (setas empurram os objetos selecionados — ver nudge)
    if (this.keyboardFree()) {
      const k = this.keys
      const arrowsMoveView = !(this.state.tool === 'select' && this.state.selected.length)
      let dx = 0, dy = 0
      if (k.a.isDown || (arrowsMoveView && k.left.isDown)) dx -= 1
      if (k.d.isDown || (arrowsMoveView && k.right.isDown)) dx += 1
      if (k.w.isDown || (arrowsMoveView && k.up.isDown)) dy -= 1
      if (k.s.isDown || (arrowsMoveView && k.down.isDown)) dy += 1
      if (dx || dy) {
        const speed = (PAN_SPEED * (k.shift.isDown ? 2.5 : 1) * dt) / cam.zoom
        this.panBy(dx * speed, dy * speed)
      }
    }
  }

  /** Antes de desenhar (a câmera já está no lugar): a iluminação da prévia. */
  private preRender() {
    const l = this.lighting
    l.enabled = this.state.lightPreview
    // hora fixa da zona, ou a hora escolhida pra prévia (zona em ciclo)
    l.hourOverride = lightingOf(this.state.zone).hour ?? this.state.previewHour
    l.render(this.game.loop.delta)
    this.ground.tufts.update(this.cameras.main, this.game.loop.delta / 1000)
  }

  /** Luzes refeitas um pouco depois da última edição (recortar pelas paredes custa). */
  private scheduleLights() {
    this.lightTimer?.remove()
    this.lightTimer = this.time.delayedCall(LIGHT_REBUILD_MS, () => this.lighting.rebuild())
  }

  /** Teclas de câmera só valem fora de campos de texto e janelas. */
  private keyboardFree() {
    return !isTyping() && !this.state.modalOpen && !(document.activeElement as HTMLElement | null)?.closest?.('.vt-modal')
  }

  /** Ponto de tela (px) + o ponto do mundo que está nele agora. */
  private anchorAt(x: number, y: number) {
    const cam = this.cameras.main
    // a câmera do Phaser dá zoom em volta do centro: mundo = scroll + w/2 + (tela − w/2)/zoom
    const hw = cam.width / 2, hh = cam.height / 2
    return { x, y, wx: cam.scrollX + hw + (x - hw) / cam.zoom, wy: cam.scrollY + hh + (y - hh) / cam.zoom }
  }

  /** Muda o zoom mantendo o ponto do mundo `anchor.wx/wy` no ponto de tela `anchor.x/y`. */
  private applyZoom(z: number, anchor: { x: number; y: number; wx: number; wy: number }) {
    const cam = this.cameras.main
    const hw = cam.width / 2, hh = cam.height / 2
    cam.setZoom(z)
    cam.scrollX = anchor.wx - hw - (anchor.x - hw) / z
    cam.scrollY = anchor.wy - hh - (anchor.y - hh) / z
    this.state.zoom = z
    this.state.emit('view')
    this.afterView()
  }

  /** Move a tela (unidades do mundo). Um zoom em andamento passa a segurar o ponto novo. */
  private panBy(dx: number, dy: number) {
    const cam = this.cameras.main
    cam.scrollX += dx
    cam.scrollY += dy
    if (this.zoomAnchor) this.zoomAnchor = this.anchorAt(this.zoomAnchor.x, this.zoomAnchor.y)
    this.afterView()
  }

  /** O que depende do zoom/posição da câmera (espessura das linhas, rótulos). */
  private afterView() {
    this.drawSelection()
    this.drawPortals()
    this.drawLights()
    this.drawCursor(this.input.activePointer)
  }

  /** Zoom relativo (×factor), animado; `anchor` em px de tela (padrão: centro). */
  zoomBy(factor: number, anchor?: { x: number; y: number }) {
    this.zoomTo(this.zoomTarget * factor, anchor)
  }

  zoomTo(z: number, anchor?: { x: number; y: number }) {
    this.zoomTarget = Phaser.Math.Clamp(z, ZOOM_MIN, ZOOM_MAX)
    const cam = this.cameras.main
    const at = anchor ?? { x: cam.width / 2, y: cam.height / 2 }
    // mesmo ponto de tela de uma rolagem anterior ainda em andamento: mantém o ponto do mundo
    if (!this.zoomAnchor || Math.abs(this.zoomAnchor.x - at.x) > 1 || Math.abs(this.zoomAnchor.y - at.y) > 1) this.zoomAnchor = this.anchorAt(at.x, at.y)
  }

  /** Enquadra a zona inteira na tela. */
  fitZone() {
    const z = this.state.zone, cam = this.cameras.main
    const fit = Math.min(cam.width / (z.width * TILE + 96), cam.height / (z.height * TILE + 96))
    this.zoomTarget = Phaser.Math.Clamp(fit, ZOOM_MIN, ZOOM_MAX)
    this.zoomAnchor = null
    this.applyZoom(this.zoomTarget, this.anchorAt(cam.width / 2, cam.height / 2))
    this.centerOnZone()
  }

  private updateCursorStyle() {
    const grab = this.spaceKey.isDown && this.keyboardFree()
    this.input.setDefaultCursor(this.panning ? 'grabbing' : grab ? 'grab' : '')
  }

  // ── Construção ─────────────────────────────────────────

  private reloadZone() {
    this.state.view = null
    this.ground.destroy()
    this.ground = new Ground(this, this.state.zone)
    this.fences.setZone(this.state.zone)
    this.lastStrokeEnd = null
    this.rebuildObjects()
    this.lighting.setZone(this.state.zone)
    this.fitBounds()
    this.refreshOverlays()
  }

  private rebuildObjects() {
    for (const s of this.sprites) s?.destroy()
    this.sprites = this.state.zone.objects.map((o) => this.makeSprite(o))
    this.applySelection()
  }

  /** Reaplica cada objeto no seu sprite (espelho, variante, altura) sem refazer tudo. */
  private syncObjects() {
    this.state.zone.objects.forEach((o, i) => {
      const s = this.sprites[i]
      if (s) updateObjectSprite(s, o)
    })
    this.applySelection()
    this.refreshOverlays()
  }

  private makeSprite(o: ZoneObject) {
    const s = createObjectSprite(this, o, 'placeholder')
    s?.setInteractive({ pixelPerfect: true, alphaTolerance: 1 })
    return s
  }

  private fitBounds() {
    const z = this.state.zone, pad = 6 * TILE
    this.cameras.main.setBounds(-pad, -pad, z.width * TILE + pad * 2, z.height * TILE + pad * 2)
  }

  private makeSpawnMarker() {
    const g = this.add.graphics()
    g.fillStyle(0xf59e0b, 0.35).fillEllipse(0, 0, 26, 12)
    g.lineStyle(2, 0xffc174, 1).strokeEllipse(0, 0, 26, 12)
    g.fillStyle(0xffc174, 1).fillTriangle(-6, -26, 6, -26, 0, -12)
    const t = this.add.text(0, -40, 'INÍCIO', { fontFamily: 'system-ui', fontSize: '10px', color: '#ffc174', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5, 0.5).setResolution(4)
    return this.add.container(0, 0, [g, t]).setDepth(1e8 + 4)
  }

  // ── Sobreposições ──────────────────────────────────────

  private onUiChange() {
    this.applySelection()
    this.refreshOverlays()
    if (this.state.tool === 'object' && this.state.objectKind) {
      const def = objectDef(this.state.objectKind)
      if (def) this.ghost.setTexture(sheetTexture(def.sheet), def.id).setFlipX(this.state.flip)
    } else {
      this.ghost.setVisible(false)
    }
    this.drawCursor(this.input.activePointer)
  }

  private refreshOverlays() {
    const z = this.state.zone
    this.spawnMarker.setPosition(z.spawn.x, z.spawn.y)
    this.drawPortals()
    this.drawLights()

    this.gridGfx.clear()
    if (this.state.showGrid) {
      this.gridGfx.lineStyle(1, 0xffffff, 0.12)
      for (let x = 0; x <= z.width; x++) this.gridGfx.lineBetween(x * TILE, 0, x * TILE, z.height * TILE)
      for (let y = 0; y <= z.height; y++) this.gridGfx.lineBetween(0, y * TILE, z.width * TILE, y * TILE)
    }
    this.gridGfx.lineStyle(2, 0xffc174, 0.5).strokeRect(0, 0, z.width * TILE, z.height * TILE)

    this.collisionGfx.clear()
    if (this.state.showCollision) {
      this.collisionGfx.fillStyle(0x3b82f6, 0.35)
      for (const r of [...solidTerrainRects(z), ...fenceSolids(z)]) this.collisionGfx.fillRect(r.x, r.y, r.w, r.h)
      this.collisionGfx.fillStyle(0xef4444, 0.55)
      for (const o of z.objects) {
        const def = objectDef(o.kind)
        if (def && !o.z) for (const r of objectSolids(def, o)) this.collisionGfx.fillRect(r.x, r.y, r.w, r.h)
      }
      // linha do pé dos selecionados: quem passa acima dela fica atrás
      for (const i of this.state.selected) {
        const sel = z.objects[i]
        const def = sel && objectDef(sel.kind)
        if (sel && def && (def.kind === 'stand' || def.kind === 'wall')) {
          this.collisionGfx.lineStyle(1 / this.cameras.main.zoom, 0xfacc15, 1)
            .lineBetween(sel.x - def.w / 2, sel.y - def.sort, sel.x + def.w / 2, sel.y - def.sort)
        }
      }
    }
  }

  /** Saídas: retângulo roxo com o destino escrito; a selecionada em dourado. */
  private drawPortals() {
    const g = this.portalGfx
    g.clear()
    for (const t of this.portalLabels) t.destroy()
    this.portalLabels = []
    const px = 1 / this.cameras.main.zoom
    const all: (Portal | { x: number; y: number; w: number; h: number; preview: true })[] = [...this.state.zone.portals]
    if (this.drawingPortal) all.push({ ...this.portalRect(this.drawingPortal), preview: true })
    for (const p of all) {
      const selected = 'id' in p && p.id === this.state.selectedPortal
      const linked = 'to' in p && !!p.to
      g.fillStyle(linked ? 0x8b5cf6 : 0xef4444, 0.25).fillRect(p.x, p.y, p.w, p.h)
      g.lineStyle(px * 2, selected ? 0xffc174 : linked ? 0xa78bfa : 0xef4444, 1).strokeRect(p.x, p.y, p.w, p.h)
      if (!('id' in p)) continue
      const label = p.to ? `${p.name} → ${this.state.zoneName(p.to.zone)}` : `${p.name} (sem destino)`
      const t = this.add.text(p.x + p.w / 2, p.y - 2, label, {
        fontFamily: 'system-ui', fontSize: '10px', color: '#ffffff', stroke: '#000', strokeThickness: 3,
      }).setOrigin(0.5, 1).setResolution(4).setScale(Math.min(2, px * 2)).setDepth(1e8 + 4)
      this.portalLabels.push(t)
    }
  }

  /**
   * Luzes soltas: um ponto com a cor dela (sempre, pra saber que existe);
   * com a ferramenta Luz, também o alcance — a selecionada em dourado.
   */
  private drawLights() {
    const g = this.lightGfx
    g.clear()
    const px = 1 / this.cameras.main.zoom
    const tool = this.state.tool === 'light'
    for (const l of this.state.zone.lights ?? []) {
      const selected = l.id === this.state.selectedLight
      const color = Phaser.Display.Color.HexStringToColor(l.color).color
      if (tool) {
        g.lineStyle(px * (selected ? 2 : 1), selected ? 0xffc174 : color, selected ? 0.9 : 0.45).strokeCircle(l.x, l.y, l.radius)
      }
      g.fillStyle(0x000000, 0.6).fillCircle(l.x, l.y, px * 8)
      g.fillStyle(color, 1).fillCircle(l.x, l.y, px * 6)
      g.lineStyle(px * 2, selected ? 0xffc174 : 0xffffff, selected ? 1 : 0.8).strokeCircle(l.x, l.y, px * 8)
    }
  }

  private lightAt(wx: number, wy: number): ZoneLight | null {
    const list = this.state.zone.lights ?? []
    const reach = Math.max(10 / this.cameras.main.zoom, 4)
    for (let i = list.length - 1; i >= 0; i--) if (Math.hypot(list[i].x - wx, list[i].y - wy) <= reach) return list[i]
    return null
  }

  private portalRect(d: { x0: number; y0: number; x1: number; y1: number }) {
    const g = TILE / 2
    const x0 = Math.round(Math.min(d.x0, d.x1) / g) * g, y0 = Math.round(Math.min(d.y0, d.y1) / g) * g
    const x1 = Math.round(Math.max(d.x0, d.x1) / g) * g, y1 = Math.round(Math.max(d.y0, d.y1) / g) * g
    const z = this.state.zone
    const cx0 = Phaser.Math.Clamp(x0, 0, z.width * TILE), cy0 = Phaser.Math.Clamp(y0, 0, z.height * TILE)
    const cx1 = Phaser.Math.Clamp(Math.max(x1, x0 + g), 0, z.width * TILE), cy1 = Phaser.Math.Clamp(Math.max(y1, y0 + g), 0, z.height * TILE)
    return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 }
  }

  private portalAt(wx: number, wy: number) {
    const list = this.state.zone.portals
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return p
    }
    return null
  }

  private applySelection() {
    const sel = new Set(this.state.selected)
    this.sprites.forEach((s, i) => (sel.has(i) ? s?.setTint(SELECT_TINT) : s?.clearTint()))
    this.drawSelection()
  }

  private drawSelection() {
    const g = this.selectGfx
    g.clear()
    const w = 2 / this.cameras.main.zoom
    for (const i of this.state.selected) {
      const s = this.sprites[i]
      if (!s) continue
      const b = s.getBounds()
      g.lineStyle(w * 2, 0x000000, 0.5).strokeRect(b.x, b.y, b.width, b.height)
      g.lineStyle(w, 0xffc174, 1).strokeRect(b.x, b.y, b.width, b.height)
      // elevado: mostra o ponto no chão que decide quem fica na frente
      const o = this.state.zone.objects[i]
      if (o?.z) {
        g.lineStyle(w, 0xffc174, 0.8).lineBetween(o.x, o.y, o.x, o.y - o.z)
        g.strokeEllipse(o.x, o.y, 10, 5)
      }
    }
    if (this.marquee) {
      const m = this.marquee
      const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1)
      g.fillStyle(0x9fd3ff, 0.12).fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0))
      g.lineStyle(w, 0x9fd3ff, 0.9).strokeRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0))
    }
  }

  private drawCursor(p: Phaser.Input.Pointer) {
    const g = this.cursorGfx
    g.clear()
    const { tool } = this.state
    const wx = p.worldX, wy = p.worldY
    /** 1 pixel de tela, em unidades do mundo (linhas com a mesma espessura em qualquer zoom). */
    const px = 1 / this.cameras.main.zoom
    if (tool === 'brush' || tool === 'erase') {
      const { tx0, ty0, n } = this.brushTiles(wx, wy)
      g.lineStyle(px * 2, tool === 'erase' ? 0xef4444 : 0xffc174, 0.9).strokeRect(tx0 * TILE, ty0 * TILE, n * TILE, n * TILE)
      // Shift: mostra a linha reta que vai sair do último ponto
      const shift = (p.event as MouseEvent | undefined)?.shiftKey || this.keys?.shift.isDown
      if (shift && this.lastStrokeEnd && !this.painting) {
        const from = this.lastStrokeEnd
        g.lineStyle(px * 2, 0xffc174, 0.6).lineBetween((from.tx + 0.5) * TILE, (from.ty + 0.5) * TILE, (Math.floor(wx / TILE) + 0.5) * TILE, (Math.floor(wy / TILE) + 0.5) * TILE)
      }
    } else if (tool === 'fill') {
      const vx = Math.round(wx / TILE), vy = Math.round(wy / TILE)
      g.fillStyle(0xffc174, 0.9).fillCircle(vx * TILE, vy * TILE, px * 4)
    } else if (tool === 'room') {
      const d = this.roomDrag
      const mode = d?.mode ?? this.state.roomMode
      if (mode === 'wall') {
        // parede interna: linha reta sobre os vértices
        if (d) {
          const line = this.wallLine(d)
          g.lineStyle(px * 4, 0xffc174, 0.9).lineBetween(line.x0 * TILE, line.y0 * TILE, line.x1 * TILE, line.y1 * TILE)
        } else {
          g.fillStyle(0xffc174, 0.95).fillCircle(Math.round(wx / TILE) * TILE, Math.round(wy / TILE) * TILE, px * 5)
        }
      } else {
        const r = d ? this.tileRect(d) : { x0: Math.floor(wx / TILE), y0: Math.floor(wy / TILE), x1: Math.floor(wx / TILE), y1: Math.floor(wy / TILE) }
        const color = mode === 'erase' ? 0xef4444 : mode === 'door' ? 0x9fd3ff : 0xffc174
        const x = r.x0 * TILE, y = r.y0 * TILE, w = (r.x1 - r.x0 + 1) * TILE, h = (r.y1 - r.y0 + 1) * TILE
        if (d) g.fillStyle(color, 0.12).fillRect(x, y, w, h)
        g.lineStyle(px * 2, color, 0.95).strokeRect(x, y, w, h)
        // a faixa da parede: mostra onde a face vai ficar
        const hgt = this.state.roomStyle.height
        if (d && mode === 'room' && hgt > 0) g.fillStyle(0xffc174, 0.18).fillRect(x, y, w, Math.min(hgt, r.y1 - r.y0 + 1) * TILE)
      }
    } else if (tool === 'spawn') {
      g.lineStyle(px * 2, 0xffc174, 0.9).strokeEllipse(wx, wy, 26, 12)
    } else if (tool === 'light' && !this.movingLight && !this.lightAt(wx, wy) && this.inside(wx, wy)) {
      // onde a luz nova vai cair e até onde ela vai
      const look = this.state.lightLook
      const color = Phaser.Display.Color.HexStringToColor(look.color).color
      g.lineStyle(px, color, 0.6).strokeCircle(wx, wy, look.radius)
      g.fillStyle(color, 0.9).fillCircle(wx, wy, px * 5)
    }
    if (tool === 'object' && this.state.objectKind) {
      const { x, y } = this.snapped(wx, wy)
      this.ghost.setPosition(x, y).setVisible(true)
    }
  }

  // ── Mouse ──────────────────────────────────────────────

  private onDown(p: Phaser.Input.Pointer) {
    const ev = p.event as MouseEvent
    if (p.middleButtonDown() || p.rightButtonDown() || this.spaceKey.isDown) {
      this.panning = { x: p.x, y: p.y }
      this.updateCursorStyle()
      return
    }
    const { tool } = this.state
    const wx = p.worldX, wy = p.worldY

    if (ev.altKey) {
      this.eyedropper(p)
      return
    }
    if (tool === 'brush' || tool === 'erase') {
      this.strokeSaved = false
      this.painting = true
      // Shift + clique: linha reta desde onde a última pincelada terminou
      this.lastPaint = ev.shiftKey && this.lastStrokeEnd ? this.lastStrokeEnd : null
      this.paintAt(wx, wy)
    } else if (tool === 'fill') {
      this.fillAt(wx, wy)
    } else if (tool === 'object' && this.state.objectKind) {
      const { x, y } = this.snapped(wx, wy)
      if (!this.inside(x, y)) return
      this.state.checkpoint()
      this.stamping = { x, y, random: ev.shiftKey }
      this.placeObject(x, y, ev.shiftKey)
    } else if (tool === 'select') {
      const index = this.objectAt(p)
      const add = ev.shiftKey || ev.ctrlKey || ev.metaKey
      if (index === null) {
        // vazio: retângulo de seleção (Shift/Ctrl soma ao que já está)
        if (!add) this.state.set({ selected: [] })
        this.marquee = { x0: wx, y0: wy, x1: wx, y1: wy, add }
        return
      }
      const sel = this.state.selected
      if (add) {
        this.state.set({ selected: sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index] })
        if (!this.state.selected.includes(index)) return
      } else if (!sel.includes(index)) {
        this.state.set({ selected: [index] })
      }
      const from = new Map(this.state.selected.map((i) => [i, { x: this.state.zone.objects[i].x, y: this.state.zone.objects[i].y }]))
      this.dragging = { start: { x: wx, y: wy }, from, moved: false }
    } else if (tool === 'room') {
      const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE)
      const vx = Math.round(wx / TILE), vy = Math.round(wy / TILE)
      const mode = ev.ctrlKey || ev.metaKey ? 'erase' : this.state.roomMode
      this.roomDrag = { tx0: tx, ty0: ty, tx1: tx, ty1: ty, vx0: vx, vy0: vy, vx1: vx, vy1: vy, mode }
      this.drawCursor(p)
    } else if (tool === 'portal') {
      const hit = this.portalAt(wx, wy)
      if (hit) {
        this.state.set({ selectedPortal: hit.id })
        this.movingPortal = { id: hit.id, dx: hit.x - wx, dy: hit.y - wy, moved: false }
      } else if (this.inside(wx, wy)) {
        this.state.set({ selectedPortal: null })
        this.drawingPortal = { x0: wx, y0: wy, x1: wx, y1: wy }
      }
    } else if (tool === 'light') {
      const hit = this.lightAt(wx, wy)
      if (hit) {
        this.state.set({ selectedLight: hit.id })
        this.movingLight = { id: hit.id, dx: hit.x - wx, dy: hit.y - wy, moved: false }
      } else if (this.inside(wx, wy)) {
        this.state.checkpoint()
        const light: ZoneLight = { id: newId('luz'), x: Math.round(wx), y: Math.round(wy), ...this.state.lightLook }
        this.state.zone.lights = [...(this.state.zone.lights ?? []), light]
        this.state.edited()
        this.state.set({ selectedLight: light.id })
      } else {
        this.state.set({ selectedLight: null })
      }
    } else if (tool === 'spawn') {
      if (!this.inside(wx, wy)) return
      if (Math.round(wx) === this.state.zone.spawn.x && Math.round(wy) === this.state.zone.spawn.y) return
      this.state.checkpoint()
      this.state.zone.spawn = { x: Math.round(wx), y: Math.round(wy) }
      this.refreshOverlays()
      this.state.edited()
    }
  }

  private onMove(p: Phaser.Input.Pointer) {
    const tx = Math.floor(p.worldX / TILE), ty = Math.floor(p.worldY / TILE)
    if (!this.state.cursor || this.state.cursor.tx !== tx || this.state.cursor.ty !== ty) {
      this.state.cursor = { tx, ty }
      this.state.emit('cursor')
    }

    if (this.panning) {
      const cam = this.cameras.main
      this.panBy(-(p.x - this.panning.x) / cam.zoom, -(p.y - this.panning.y) / cam.zoom)
      this.panning = { x: p.x, y: p.y }
      return
    }
    if (this.painting) this.paintAt(p.worldX, p.worldY)
    if (this.stamping) {
      // carimbo contínuo: um objeto novo a cada "largura" de distância
      const def = this.state.objectKind ? objectDef(this.state.objectKind) : undefined
      const gap = Math.max(16, (def?.w ?? 32) * 0.8)
      const { x, y } = this.snapped(p.worldX, p.worldY)
      if (Math.hypot(x - this.stamping.x, y - this.stamping.y) >= gap && this.inside(x, y)) {
        this.stamping.x = x
        this.stamping.y = y
        this.placeObject(x, y, this.stamping.random || (p.event as MouseEvent).shiftKey)
      }
    }
    if (this.roomDrag) {
      this.roomDrag.tx1 = tx
      this.roomDrag.ty1 = ty
      this.roomDrag.vx1 = Math.round(p.worldX / TILE)
      this.roomDrag.vy1 = Math.round(p.worldY / TILE)
    }
    if (this.marquee) {
      this.marquee.x1 = p.worldX
      this.marquee.y1 = p.worldY
      this.drawSelection()
    }
    if (this.drawingPortal) {
      this.drawingPortal.x1 = p.worldX
      this.drawingPortal.y1 = p.worldY
      this.drawPortals()
    }
    if (this.movingPortal) {
      const m = this.movingPortal
      const portal = this.state.zone.portals.find((q) => q.id === m.id)
      if (portal) {
        if (!m.moved) {
          this.state.checkpoint()
          m.moved = true
        }
        const z = this.state.zone, g = TILE / 2
        portal.x = Phaser.Math.Clamp(Math.round((p.worldX + m.dx) / g) * g, 0, z.width * TILE - portal.w)
        portal.y = Phaser.Math.Clamp(Math.round((p.worldY + m.dy) / g) * g, 0, z.height * TILE - portal.h)
        this.drawPortals()
      }
    }
    if (this.movingLight) {
      const m = this.movingLight
      const light = this.state.zone.lights?.find((q) => q.id === m.id)
      if (light) {
        if (!m.moved) {
          this.state.checkpoint()
          m.moved = true
        }
        const z = this.state.zone
        light.x = Phaser.Math.Clamp(Math.round(p.worldX + m.dx), 0, z.width * TILE)
        light.y = Phaser.Math.Clamp(Math.round(p.worldY + m.dy), 0, z.height * TILE)
        // arrastando: a luz acompanha sem recortar pelas paredes (rápido); solta, recorta
        this.lighting.rebuild(false)
        this.drawLights()
      }
    }
    if (this.dragging) {
      const d = this.dragging
      let dx = Math.round(p.worldX - d.start.x), dy = Math.round(p.worldY - d.start.y)
      if (!d.moved && Math.hypot(dx, dy) < 2) return this.drawCursor(p)
      if (!d.moved) {
        this.state.checkpoint()
        d.moved = true
      }
      // com encaixe ligado, o primeiro objeto encaixa e os outros andam junto
      if (this.state.snap) {
        const [first] = d.from.values()
        const s = this.snapped(first.x + dx, first.y + dy)
        dx = s.x - first.x
        dy = s.y - first.y
      }
      for (const [i, at] of d.from) {
        const o = this.state.zone.objects[i]
        if (!o) continue
        o.x = at.x + dx
        o.y = at.y + dy
        const s = this.sprites[i]
        if (s) updateObjectSprite(s, o)
      }
      this.drawSelection()
    }
    this.drawCursor(p)
  }

  private onUp() {
    if (this.painting) {
      this.painting = false
      this.lastStrokeEnd = this.lastPaint
      // pincelada que não mudou nada (fora da zona, mesmo terreno) não vira passo
      if (this.strokeSaved) {
        this.refreshOverlays()
        this.state.edited()
      }
    }
    if (this.stamping) {
      this.stamping = null
      this.refreshOverlays()
      this.state.edited()
    }
    if (this.roomDrag) {
      const d = this.roomDrag
      this.roomDrag = null
      const r = this.tileRect(d)
      const single = r.x0 === r.x1 && r.y0 === r.y1
      if (d.mode === 'wall') this.drawWall(this.wallLine(d))
      else if (d.mode === 'door') this.openDoor(r)
      else if (d.mode === 'erase') this.paintRooms(r, '')
      // clique (sem arrastar) num cômodo: troca o estilo dele todo
      else if (!(single && this.restyleRoomAt(r.x0, r.y0))) this.paintRooms(r, encodeRoom(this.state.roomStyle))
      this.drawCursor(this.input.activePointer)
    }
    if (this.marquee) {
      const m = this.marquee
      this.marquee = null
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1)
      if (x1 - x0 > 2 || y1 - y0 > 2) {
        const hit: number[] = []
        this.sprites.forEach((s, i) => {
          if (!s) return
          const b = s.getBounds()
          if (b.right >= x0 && b.x <= x1 && b.bottom >= y0 && b.y <= y1) hit.push(i)
        })
        this.state.set({ selected: m.add ? [...new Set([...this.state.selected, ...hit])] : hit })
      } else {
        this.drawSelection()
      }
    }
    if (this.dragging?.moved) {
      this.refreshOverlays()
      this.state.edited()
    }
    if (this.drawingPortal) {
      const r = this.portalRect(this.drawingPortal)
      this.drawingPortal = null
      if (r.w >= TILE / 2 && r.h >= TILE / 2) {
        this.state.checkpoint()
        const n = this.state.zone.portals.length + 1
        const portal: Portal = { id: newId('saida'), name: `Saída ${n}`, ...r, to: null }
        this.state.zone.portals.push(portal)
        this.state.edited()
        this.state.set({ selectedPortal: portal.id })
      } else {
        this.drawPortals()
      }
    }
    if (this.movingPortal?.moved) this.state.edited()
    this.movingPortal = null
    if (this.movingLight?.moved) this.state.edited()
    this.movingLight = null
    this.dragging = null
    this.panning = null
    this.updateCursorStyle()
  }

  private onWheel(p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) {
    const ev = p.event as WheelEvent
    // rolagem por "linhas" (algumas rodas/sistemas) → px
    const pixels = ev.deltaMode === 1 ? dy * 16 : ev.deltaMode === 2 ? dy * 400 : dy
    if (ev.altKey) {
      // Alt + roda: tamanho do pincel
      ev.preventDefault()
      if (pixels) this.state.set({ brush: Phaser.Math.Clamp(this.state.brush + (pixels > 0 ? -1 : 1), 1, BRUSH_MAX) })
      return
    }
    // passo proporcional ao quanto rolou: roda dá passos pequenos, trackpad é contínuo
    const factor = Math.exp(Phaser.Math.Clamp(-pixels * WHEEL_ZOOM, -0.7, 0.7))
    // ponto do cursor tirado do próprio evento (o ponteiro do Phaser pode estar atrasado)
    const rect = this.game.canvas.getBoundingClientRect()
    const cam = this.cameras.main
    const at = rect.width ? { x: ((ev.clientX - rect.left) * cam.width) / rect.width, y: ((ev.clientY - rect.top) * cam.height) / rect.height } : { x: p.x, y: p.y }
    this.zoomBy(factor, at)
  }

  // ── Ferramentas ────────────────────────────────────────

  private brushTiles(wx: number, wy: number) {
    const n = this.state.brush
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE)
    return { tx0: tx - Math.floor((n - 1) / 2), ty0: ty - Math.floor((n - 1) / 2), n }
  }

  /** Pinta do último ponto até aqui (sem buracos quando o mouse anda rápido). */
  private paintAt(wx: number, wy: number) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE)
    const from = this.lastPaint ?? { tx, ty }
    const steps = Math.max(Math.abs(tx - from.tx), Math.abs(ty - from.ty), 1)
    for (let i = 1; i <= steps; i++) {
      const x = from.tx + Math.round(((tx - from.tx) * i) / steps)
      const y = from.ty + Math.round(((ty - from.ty) * i) / steps)
      this.stamp((x + 0.5) * TILE, (y + 0.5) * TILE)
    }
    this.lastPaint = { tx, ty }
  }

  /** O terreno escolhido é uma cerca (camada de tiles)? */
  private get fenceLayer() {
    const t = terrainById.get(this.state.terrain)
    return !!t && isFence(t)
  }

  /** Cercas: pinta TILES (não vértices) e refaz os pedaços ligados. */
  private stampFence(tx0: number, ty0: number, n: number, value: string) {
    const z = this.state.zone
    if (value === '' && !z.fences) return
    let changed = false
    for (let ty = Math.max(0, ty0); ty < Math.min(z.height, ty0 + n); ty++) {
      for (let tx = Math.max(0, tx0); tx < Math.min(z.width, tx0 + n); tx++) {
        const i = ty * z.width + tx
        if ((z.fences?.[i] ?? '') === value) continue
        if (!this.strokeSaved) {
          this.state.checkpoint()
          this.strokeSaved = true
        }
        if (!z.fences) z.fences = new Array(z.width * z.height).fill('')
        z.fences[i] = value
        changed = true
      }
    }
    if (changed) this.fences.rebuild()
  }

  /** O terreno escolhido é da camada de cima (molduras, tapetes)? */
  private get overlayLayer() {
    const t = terrainById.get(this.state.terrain)
    return !!t && isOverlay(t)
  }

  /** A grade de vértices da camada do terreno escolhido (cria a de cima, se preciso). */
  private layerGrid() {
    const z = this.state.zone
    if (!this.overlayLayer) return z.corners
    if (!z.overlay) z.overlay = new Array(z.corners.length).fill('')
    return z.overlay
  }

  /**
   * Pinta os vértices do quadrado do pincel, na camada do terreno escolhido.
   * O pincel grava o terreno explicitamente; a borracha grava '' (no chão =
   * o fundo da zona, que pode mudar; na camada de cima = nada).
   */
  private stamp(wx: number, wy: number) {
    const z = this.state.zone
    const value = this.state.tool === 'erase' ? '' : this.state.terrain
    const { tx0, ty0, n } = this.brushTiles(wx, wy)
    if (this.fenceLayer) return this.stampFence(tx0, ty0, n, value)
    const vx0 = Math.max(0, tx0), vy0 = Math.max(0, ty0)
    const vx1 = Math.min(z.width, tx0 + n), vy1 = Math.min(z.height, ty0 + n)
    if (vx0 > vx1 || vy0 > vy1) return
    const W = z.width + 1
    // apagar a camada de cima que nem existe: nada a fazer
    if (value === '' && this.overlayLayer && !z.overlay) return
    let changed = false
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const i = vy * W + vx
        if ((this.overlayLayer ? z.overlay?.[i] ?? '' : z.corners[i]) === value) continue
        if (!this.strokeSaved) {
          this.state.checkpoint()
          this.strokeSaved = true
        }
        this.layerGrid()[i] = value
        changed = true
      }
    }
    if (changed) this.ground.redrawVertices(vx0, vy0, vx1, vy1)
  }

  private fillAt(wx: number, wy: number) {
    const z = this.state.zone
    const vx = Math.round(wx / TILE), vy = Math.round(wy / TILE)
    if (vx < 0 || vy < 0 || vx > z.width || vy > z.height) return
    // cerca não tem balde: o pincel já desenha a linha
    if (this.fenceLayer) return
    const W = z.width + 1, H = z.height + 1
    const overlay = this.overlayLayer
    // na camada de cima, o "terreno" de um vértice é o id gravado ('' = nada)
    const at = (x: number, y: number) => (overlay ? z.overlay?.[y * W + x] ?? '' : cornerTerrain(z, x, y).id)
    const target = at(vx, vy)
    const value = this.state.terrain
    if (target === value || !terrainById.has(value)) return

    this.state.checkpoint()
    const grid = this.layerGrid()
    const seen = new Uint8Array(W * H)
    const stack = [vy * W + vx]
    seen[stack[0]] = 1
    while (stack.length) {
      const i = stack.pop()!
      grid[i] = value
      const x = i % W, y = (i - x) / W
      const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      for (const [nx, ny] of next) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!seen[j] && at(nx, ny) === target) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    this.ground.redrawAll()
    this.refreshOverlays()
    this.state.edited()
  }

  /** Põe um objeto (o passo de desfazer é guardado por quem chamou). `random` = variante e espelho sorteados. */
  private placeObject(x: number, y: number, random: boolean) {
    let kind = this.state.objectKind!
    let flip = this.state.flip
    if (random) {
      const def = objectDef(kind)
      const variants = def ? variantsOf(def) : []
      if (variants.length > 1) kind = variants[Math.floor(Math.random() * variants.length)].id
      flip = Math.random() < 0.5
    }
    const o: ZoneObject = { kind, x, y, ...(flip ? { flip: true } : {}) }
    this.state.zone.objects.push(o)
    this.sprites.push(this.makeSprite(o))
  }

  private snapped(x: number, y: number) {
    if (!this.state.snap) return { x: Math.round(x), y: Math.round(y) }
    const g = TILE / 2
    return { x: Math.round(x / g) * g, y: Math.round(y / g) * g }
  }

  private inside(x: number, y: number) {
    const z = this.state.zone
    return x >= 0 && y >= 0 && x <= z.width * TILE && y <= z.height * TILE
  }

  /** Objeto de cima sob o mouse (pixel a pixel), ou null. */
  private objectAt(p: Phaser.Input.Pointer): number | null {
    const hits = this.input.hitTestPointer(p) as ObjectSprite[]
    let best: ObjectSprite | null = null
    for (const h of hits) if (this.sprites.includes(h) && (!best || h.depth > best.depth)) best = h
    return best ? this.sprites.indexOf(best) : null
  }

  // ── Cômodos ─────────────────────────────────────────────

  /** Retângulo de tiles (ordenado e dentro da zona). */
  private tileRect(d: { tx0: number; ty0: number; tx1: number; ty1: number }) {
    const z = this.state.zone
    const c = (v: number, max: number) => Phaser.Math.Clamp(v, 0, max - 1)
    return {
      x0: c(Math.min(d.tx0, d.tx1), z.width), x1: c(Math.max(d.tx0, d.tx1), z.width),
      y0: c(Math.min(d.ty0, d.ty1), z.height), y1: c(Math.max(d.ty0, d.ty1), z.height),
    }
  }

  /**
   * Marca (ou apaga, value = '') os tiles do retângulo como cômodo. Encostado
   * num cômodo de OUTRO estilo, a borda fica de fora: nasce uma parede fina
   * entre os dois. Do mesmo estilo, os dois viram um cômodo só.
   */
  private paintRooms(r: { x0: number; y0: number; x1: number; y1: number }, value: string) {
    const z = this.state.zone
    const W = z.width + 1, H = z.height + 1
    const rooms = z.rooms ?? new Array(z.corners.length).fill('')
    const inRect = (x: number, y: number) => x >= r.x0 && x <= r.x1 + 1 && y >= r.y0 && y <= r.y1 + 1
    const next: [number, string][] = []
    // o cômodo ocupa os vértices dos tiles (um tile = 4 cantos)
    for (let vy = r.y0; vy <= r.y1 + 1; vy++) {
      for (let vx = r.x0; vx <= r.x1 + 1; vx++) {
        let v = value
        if (v) {
          const other = [[vx + 1, vy], [vx - 1, vy], [vx, vy + 1], [vx, vy - 1]].some(([x, y]) =>
            x >= 0 && y >= 0 && x < W && y < H && !inRect(x, y) && rooms[y * W + x] && rooms[y * W + x] !== value)
          if (other) v = ''
        }
        next.push([vy * W + vx, v])
      }
    }
    this.commitRooms(next)
  }

  /** Grava vértices de cômodo e refaz piso/parede/moldura onde mudou (um passo de desfazer). */
  private commitRooms(changes: [number, string][]) {
    const z = this.state.zone
    const rooms = z.rooms ?? new Array(z.corners.length).fill('')
    const real = changes.filter(([i, v]) => rooms[i] !== v)
    if (!real.length) return
    const before = roomRoles(z)
    this.state.checkpoint()
    for (const [i, v] of real) rooms[i] = v
    z.rooms = rooms
    applyRooms(z, before)
    this.ground.redrawAll()
    this.refreshOverlays()
    this.state.edited()
  }

  /** Linha reta (horizontal ou vertical, a que andou mais) de vértices da parede interna. */
  private wallLine(d: { vx0: number; vy0: number; vx1: number; vy1: number }) {
    const z = this.state.zone
    const c = (v: number, max: number) => Phaser.Math.Clamp(v, 0, max)
    const horizontal = Math.abs(d.vx1 - d.vx0) >= Math.abs(d.vy1 - d.vy0)
    return horizontal
      ? { x0: c(Math.min(d.vx0, d.vx1), z.width), x1: c(Math.max(d.vx0, d.vx1), z.width), y0: c(d.vy0, z.height), y1: c(d.vy0, z.height) }
      : { x0: c(d.vx0, z.width), x1: c(d.vx0, z.width), y0: c(Math.min(d.vy0, d.vy1), z.height), y1: c(Math.max(d.vy0, d.vy1), z.height) }
  }

  /** Parede interna: tira os vértices da linha do cômodo (a parede fina e a face aparecem sozinhas). */
  private drawWall(l: { x0: number; y0: number; x1: number; y1: number }) {
    const W = this.state.zone.width + 1
    const next: [number, string][] = []
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) next.push([y * W + x, ''])
    this.commitRooms(next)
  }

  /** Porta: preenche o vão da parede com o estilo do cômodo vizinho. */
  private openDoor(r: { x0: number; y0: number; x1: number; y1: number }) {
    const z = this.state.zone
    const W = z.width + 1, H = z.height + 1
    const rooms = z.rooms
    if (!rooms) return
    const next: [number, string][] = []
    for (let vy = r.y0; vy <= r.y1 + 1; vy++) {
      for (let vx = r.x0; vx <= r.x1 + 1; vx++) {
        if (rooms[vy * W + vx]) continue
        // estilo do vizinho (prefere o de cima: a porta continua o cômodo de onde se vem)
        const near = [[vx, vy - 1], [vx - 1, vy], [vx + 1, vy], [vx, vy + 1]]
          .map(([x, y]) => (x >= 0 && y >= 0 && x < W && y < H ? rooms[y * W + x] : ''))
          .find(Boolean)
        if (near) next.push([vy * W + vx, near])
      }
    }
    this.commitRooms(next)
  }

  /** Troca o estilo do cômodo sob o tile pelo estilo escolhido. */
  private restyleRoomAt(tx: number, ty: number) {
    const z = this.state.zone
    const W = z.width + 1
    const corner = [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]].find(([x, y]) => z.rooms?.[y * W + x])
    if (!corner) return false
    const value = encodeRoom(this.state.roomStyle)
    const cells = connectedRoom(z, corner[0], corner[1])
    if (cells.every((i) => z.rooms![i] === value)) return true
    const before = roomRoles(z)
    this.state.checkpoint()
    for (const i of cells) z.rooms![i] = value
    applyRooms(z, before)
    this.ground.redrawAll()
    this.refreshOverlays()
    this.state.edited()
    return true
  }

  /**
   * Conta-gotas (Alt+clique): com ferramenta de objeto/seleção copia o
   * objeto sob o mouse; senão copia o terreno do vértice mais próximo.
   */
  private eyedropper(p: Phaser.Input.Pointer) {
    const { tool } = this.state
    if (tool === 'room') {
      const z = this.state.zone
      const vx = Phaser.Math.Clamp(Math.round(p.worldX / TILE), 0, z.width)
      const vy = Phaser.Math.Clamp(Math.round(p.worldY / TILE), 0, z.height)
      const style = decodeRoom(z.rooms?.[vy * (z.width + 1) + vx] ?? '')
      if (style) this.state.set({ roomStyle: style })
      return
    }
    if (tool === 'object' || tool === 'select') {
      const i = this.objectAt(p)
      if (i !== null) {
        const o = this.state.zone.objects[i]
        this.state.set({ objectKind: o.kind, flip: !!o.flip, tool: 'object' })
      }
      return
    }
    const z = this.state.zone
    const vx = Phaser.Math.Clamp(Math.round(p.worldX / TILE), 0, z.width)
    const vy = Phaser.Math.Clamp(Math.round(p.worldY / TILE), 0, z.height)
    // cerca no tile, depois tapete/moldura, depois o chão
    const picked = fenceAt(z, Math.floor(p.worldX / TILE), Math.floor(p.worldY / TILE)) ?? overlayTerrain(z, vx, vy) ?? cornerTerrain(z, vx, vy)
    this.state.set({ terrain: picked.id, tool: tool === 'fill' ? 'fill' : 'brush' })
  }

  // ── Ações chamadas pela interface ──────────────────────

  deleteSelected() {
    const light = this.state.light
    if (light) {
      this.state.checkpoint()
      this.state.zone.lights = this.state.zone.lights!.filter((l) => l !== light)
      if (!this.state.zone.lights.length) delete this.state.zone.lights
      this.state.selectedLight = null
      this.state.edited()
      this.state.emit('ui')
      return
    }
    const portal = this.state.portal
    if (portal) {
      this.state.checkpoint()
      this.state.zone.portals = this.state.zone.portals.filter((p) => p !== portal)
      this.state.selectedPortal = null
      this.state.edited()
      this.state.emit('ui')
      return
    }
    const sel = new Set(this.state.selected)
    if (!sel.size) return
    this.state.checkpoint()
    this.state.zone.objects = this.state.zone.objects.filter((_, i) => !sel.has(i))
    this.sprites = this.sprites.filter((s, i) => {
      if (sel.has(i)) s?.destroy()
      return !sel.has(i)
    })
    this.state.selected = []
    this.refreshOverlays()
    this.state.edited()
    this.state.emit('ui')
  }

  /** Seleciona todos os objetos da zona. */
  selectAll() {
    this.state.set({ tool: 'select' })
    this.state.set({ selected: this.state.zone.objects.map((_, i) => i) })
  }

  /** Copia os selecionados (posições relativas ao centro do grupo). Devolve quantos. */
  copySelected() {
    const list = this.state.selected.map((i) => this.state.zone.objects[i]).filter(Boolean)
    if (!list.length) return 0
    const cx = list.reduce((a, o) => a + o.x, 0) / list.length
    const cy = list.reduce((a, o) => a + o.y, 0) / list.length
    this.state.clipboard = list.map((o) => ({ ...o, x: Math.round(o.x - cx), y: Math.round(o.y - cy) }))
    return list.length
  }

  cutSelected() {
    const n = this.copySelected()
    if (n) this.deleteSelected()
    return n
  }

  /** Cola no mouse (ou no meio da tela); os colados ficam selecionados. */
  paste(at?: { x: number; y: number }) {
    const clip = this.state.clipboard
    if (!clip.length) return 0
    const p = this.input.activePointer
    const cam = this.cameras.main
    const over = p.x >= 0 && p.y >= 0 && p.x <= cam.width && p.y <= cam.height
    const base = at ?? (over ? this.snapped(p.worldX, p.worldY) : { x: Math.round(cam.midPoint.x), y: Math.round(cam.midPoint.y) })
    this.state.checkpoint()
    const first = this.state.zone.objects.length
    for (const o of clip) {
      const copy: ZoneObject = { ...o, x: base.x + o.x, y: base.y + o.y }
      this.state.zone.objects.push(copy)
      this.sprites.push(this.makeSprite(copy))
    }
    this.state.set({ tool: 'select' })
    this.state.set({ selected: clip.map((_, k) => first + k) })
    this.refreshOverlays()
    this.state.edited()
    return clip.length
  }

  /** Duplica os selecionados um pouco ao lado. */
  duplicate() {
    const list = this.state.selected.map((i) => this.state.zone.objects[i]).filter(Boolean)
    if (!list.length) return 0
    this.copySelected()
    const cx = list.reduce((a, o) => a + o.x, 0) / list.length
    const cy = list.reduce((a, o) => a + o.y, 0) / list.length
    return this.paste({ x: Math.round(cx + 16), y: Math.round(cy + 16) })
  }

  /** Empurra os selecionados (setas). Teclas seguidas viram um passo só de desfazer. */
  private lastNudge = 0
  nudge(dx: number, dy: number) {
    const sel = this.state.selected
    if (!sel.length) return false
    const now = performance.now()
    if (now - this.lastNudge > 700) this.state.checkpoint()
    this.lastNudge = now
    for (const i of sel) {
      const o = this.state.zone.objects[i]
      if (!o) continue
      o.x += dx
      o.y += dy
      const s = this.sprites[i]
      if (s) updateObjectSprite(s, o)
    }
    this.drawSelection()
    this.refreshOverlays()
    this.state.edited()
    return true
  }

  /** Espelha os selecionados (ou o carimbo). */
  flipSelected() {
    const sel = this.state.selected
    if (this.state.tool === 'object' && !sel.length) {
      this.state.set({ flip: !this.state.flip })
      return
    }
    if (!sel.length) return
    this.state.checkpoint()
    for (const i of sel) {
      const o = this.state.zone.objects[i]
      if (!o) continue
      if (o.flip) delete o.flip
      else o.flip = true
    }
    this.state.edited()
    this.state.emit('objects')
  }

  /** Próxima/anterior variante (cor, estado) dos selecionados — ou do carimbo. */
  cycleVariant(dir: 1 | -1) {
    const next = (kind: string) => {
      const def = objectDef(kind)
      if (!def) return kind
      const list = variantsOf(def)
      const i = list.findIndex((v) => v.id === def.id)
      return list[(i + dir + list.length) % list.length].id
    }
    const sel = this.state.selected
    if (!sel.length) {
      if (this.state.objectKind) this.state.set({ objectKind: next(this.state.objectKind) })
      return
    }
    this.state.checkpoint()
    for (const i of sel) {
      const o = this.state.zone.objects[i]
      if (o) o.kind = next(o.kind)
    }
    this.state.edited()
    this.state.emit('objects')
  }

  /** Muda o tamanho do pincel (+1/−1). */
  brushBy(d: number) {
    this.state.set({ brush: Phaser.Math.Clamp(this.state.brush + d, 1, BRUSH_MAX) })
  }

  centerOnZone() {
    const z = this.state.zone
    this.cameras.main.centerOn((z.width * TILE) / 2, (z.height * TILE) / 2)
    this.afterView()
  }
}
