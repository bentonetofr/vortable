// ────────────────────────────────────────────────────────
// Cena do editor: mostra a zona e aplica as ferramentas com o mouse.
//   pincel/borracha: pinta os vértices de um quadrado de N×N tiles
//   balde: troca todos os vértices ligados com o mesmo terreno
//   objeto: carimba o objeto escolhido (fantasma segue o mouse)
//   selecionar: clica num objeto pra selecionar/arrastar; Del apaga
//   saída: arraste pra desenhar a área que leva a outra zona; clique pra
//          selecionar/arrastar; Del apaga (o destino se escolhe no painel)
//   início: onde o jogador aparece
//   Alt+clique: conta-gotas (copia terreno ou objeto)
// Câmera: botão do meio/direito (ou Espaço + arrastar) move, roda dá zoom.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { footRect, objectDef, sheetTexture } from '../assets/objects'
import { terrainById } from '../assets/terrains'
import { Ground, cornerTerrain, solidTerrainRects } from '../world/ground'
import { createObjectSprite, moveObjectSprite } from '../world/objects'
import { TILE, newId, type Portal } from '../types'
import type { EditorState } from './EditorState'

const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const SELECT_TINT = 0x9fd3ff

export class EditorScene extends Phaser.Scene {
  private state!: EditorState
  private ground!: Ground
  private sprites: (Phaser.GameObjects.Image | null)[] = []
  private gridGfx!: Phaser.GameObjects.Graphics
  private collisionGfx!: Phaser.GameObjects.Graphics
  private cursorGfx!: Phaser.GameObjects.Graphics
  private selectGfx!: Phaser.GameObjects.Graphics
  private portalGfx!: Phaser.GameObjects.Graphics
  private portalLabels: Phaser.GameObjects.Text[] = []
  private spawnMarker!: Phaser.GameObjects.Container
  private ghost!: Phaser.GameObjects.Image

  private painting = false
  /** A pincelada atual já guardou o passo de desfazer? (só guarda se mudar algo) */
  private strokeSaved = false
  private lastPaint: { tx: number; ty: number } | null = null
  private panning: { x: number; y: number } | null = null
  private dragging: { index: number; dx: number; dy: number; moved: boolean } | null = null
  private drawingPortal: { x0: number; y0: number; x1: number; y1: number } | null = null
  private movingPortal: { id: string; dx: number; dy: number; moved: boolean } | null = null
  private spaceKey!: Phaser.Input.Keyboard.Key

  constructor() {
    super('editor')
  }

  init(data: { state: EditorState }) {
    this.state = data.state
  }

  create() {
    this.ground = new Ground(this, this.state.zone)
    this.gridGfx = this.add.graphics().setDepth(1e8)
    this.collisionGfx = this.add.graphics().setDepth(1e8 + 1)
    this.cursorGfx = this.add.graphics().setDepth(1e8 + 2)
    this.selectGfx = this.add.graphics().setDepth(1e8 + 2)
    this.portalGfx = this.add.graphics().setDepth(1e8 + 1)
    this.ghost = this.add.image(0, 0, '__WHITE').setOrigin(0.5, 1).setAlpha(0.6).setDepth(1e8 + 3).setVisible(false)
    this.spawnMarker = this.makeSpawnMarker()
    this.rebuildObjects()
    this.refreshOverlays()

    const cam = this.cameras.main
    cam.setBackgroundColor('#0b0f18').setZoom(this.state.zoom).setRoundPixels(true)
    this.fitBounds()
    const view = this.state.view ?? this.state.zone.spawn
    cam.centerOn(view.x, view.y)

    this.input.mouse?.disableContextMenu()
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false)
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
    })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off()
      this.state.view = { x: cam.midPoint.x, y: cam.midPoint.y }
    })
  }

  // ── Construção ─────────────────────────────────────────

  private reloadZone() {
    this.state.view = null
    this.ground.rt.destroy()
    this.ground = new Ground(this, this.state.zone)
    this.rebuildObjects()
    this.fitBounds()
    this.refreshOverlays()
  }

  private rebuildObjects() {
    for (const s of this.sprites) s?.destroy()
    this.sprites = this.state.zone.objects.map((o) => this.makeSprite(o))
    this.applySelection()
  }

  private makeSprite(o: { kind: string; x: number; y: number }) {
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
    const cam = this.cameras.main
    if (cam.zoom !== this.state.zoom) cam.setZoom(this.state.zoom)
    this.applySelection()
    this.refreshOverlays()
    if (this.state.tool === 'object' && this.state.objectKind) {
      const def = objectDef(this.state.objectKind)
      if (def) this.ghost.setTexture(sheetTexture(def.sheet), def.id)
    } else {
      this.ghost.setVisible(false)
    }
    this.drawCursor(this.input.activePointer)
  }

  private refreshOverlays() {
    const z = this.state.zone
    this.spawnMarker.setPosition(z.spawn.x, z.spawn.y)
    this.drawPortals()

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
      for (const r of solidTerrainRects(z)) this.collisionGfx.fillRect(r.x, r.y, r.w, r.h)
      this.collisionGfx.fillStyle(0xef4444, 0.55)
      for (const o of z.objects) {
        const def = objectDef(o.kind)
        const r = def && footRect(def, o.x, o.y)
        if (r) this.collisionGfx.fillRect(r.x, r.y, r.w, r.h)
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
    this.sprites.forEach((s, i) => (i === this.state.selected ? s?.setTint(SELECT_TINT) : s?.clearTint()))
    this.drawSelection()
  }

  private drawSelection() {
    const g = this.selectGfx
    g.clear()
    const s = this.state.selected !== null ? this.sprites[this.state.selected] : null
    if (!s) return
    const b = s.getBounds()
    const w = 2 / this.cameras.main.zoom
    g.lineStyle(w * 2, 0x000000, 0.5).strokeRect(b.x, b.y, b.width, b.height)
    g.lineStyle(w, 0xffc174, 1).strokeRect(b.x, b.y, b.width, b.height)
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
    } else if (tool === 'fill') {
      const vx = Math.round(wx / TILE), vy = Math.round(wy / TILE)
      g.fillStyle(0xffc174, 0.9).fillCircle(vx * TILE, vy * TILE, px * 4)
    } else if (tool === 'spawn') {
      g.lineStyle(px * 2, 0xffc174, 0.9).strokeEllipse(wx, wy, 26, 12)
    }
    if (tool === 'object' && this.state.objectKind) {
      const { x, y } = this.snapped(wx, wy)
      this.ghost.setPosition(x, y).setVisible(true)
    }
  }

  // ── Mouse ──────────────────────────────────────────────

  private onDown(p: Phaser.Input.Pointer) {
    if (p.middleButtonDown() || p.rightButtonDown() || this.spaceKey.isDown) {
      this.panning = { x: p.x, y: p.y }
      return
    }
    const { tool } = this.state
    const wx = p.worldX, wy = p.worldY

    if ((p.event as MouseEvent).altKey) {
      this.eyedropper(p)
      return
    }
    if (tool === 'brush' || tool === 'erase') {
      this.strokeSaved = false
      this.painting = true
      this.lastPaint = null
      this.paintAt(wx, wy)
    } else if (tool === 'fill') {
      this.fillAt(wx, wy)
    } else if (tool === 'object' && this.state.objectKind) {
      const { x, y } = this.snapped(wx, wy)
      if (!this.inside(x, y)) return
      this.state.checkpoint()
      const o = { kind: this.state.objectKind, x, y }
      this.state.zone.objects.push(o)
      this.sprites.push(this.makeSprite(o))
      this.refreshOverlays()
      this.state.edited()
    } else if (tool === 'select') {
      const index = this.objectAt(p)
      this.state.set({ selected: index })
      if (index !== null) {
        const o = this.state.zone.objects[index]
        this.dragging = { index, dx: o.x - wx, dy: o.y - wy, moved: false }
      } else {
        this.panning = { x: p.x, y: p.y }
      }
    } else if (tool === 'portal') {
      const hit = this.portalAt(wx, wy)
      if (hit) {
        this.state.set({ selectedPortal: hit.id })
        this.movingPortal = { id: hit.id, dx: hit.x - wx, dy: hit.y - wy, moved: false }
      } else if (this.inside(wx, wy)) {
        this.state.set({ selectedPortal: null })
        this.drawingPortal = { x0: wx, y0: wy, x1: wx, y1: wy }
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
      cam.scrollX -= (p.x - this.panning.x) / cam.zoom
      cam.scrollY -= (p.y - this.panning.y) / cam.zoom
      this.panning = { x: p.x, y: p.y }
      return
    }
    if (this.painting) this.paintAt(p.worldX, p.worldY)
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
    if (this.dragging) {
      const d = this.dragging
      if (!d.moved) {
        this.state.checkpoint()
        d.moved = true
      }
      const o = this.state.zone.objects[d.index]
      const { x, y } = this.snapped(p.worldX + d.dx, p.worldY + d.dy)
      o.x = x
      o.y = y
      const s = this.sprites[d.index]
      if (s) moveObjectSprite(s, o)
      this.drawSelection()
    }
    this.drawCursor(p)
  }

  private onUp() {
    if (this.painting) {
      this.painting = false
      // pincelada que não mudou nada (fora da zona, mesmo terreno) não vira passo
      if (this.strokeSaved) {
        this.refreshOverlays()
        this.state.edited()
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
    this.dragging = null
    this.panning = null
  }

  private onWheel(p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) {
    const cam = this.cameras.main
    const before = cam.getWorldPoint(p.x, p.y)
    const zoom = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.8 : 1.25), ZOOM_MIN, ZOOM_MAX)
    cam.setZoom(zoom)
    const after = cam.getWorldPoint(p.x, p.y)
    cam.scrollX += before.x - after.x
    cam.scrollY += before.y - after.y
    this.state.set({ zoom })
    this.drawSelection()
    this.drawPortals()
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

  /**
   * Pinta os vértices do quadrado do pincel. O pincel grava o terreno
   * explicitamente; a borracha grava '' (= o fundo da zona, que pode mudar).
   */
  private stamp(wx: number, wy: number) {
    const z = this.state.zone
    const value = this.state.tool === 'erase' ? '' : this.state.terrain
    const { tx0, ty0, n } = this.brushTiles(wx, wy)
    const vx0 = Math.max(0, tx0), vy0 = Math.max(0, ty0)
    const vx1 = Math.min(z.width, tx0 + n), vy1 = Math.min(z.height, ty0 + n)
    if (vx0 > vx1 || vy0 > vy1) return
    const W = z.width + 1
    let changed = false
    for (let vy = vy0; vy <= vy1; vy++) {
      for (let vx = vx0; vx <= vx1; vx++) {
        const i = vy * W + vx
        if (z.corners[i] === value) continue
        if (!this.strokeSaved) {
          this.state.checkpoint()
          this.strokeSaved = true
        }
        z.corners[i] = value
        changed = true
      }
    }
    if (changed) this.ground.redrawVertices(vx0, vy0, vx1, vy1)
  }

  private fillAt(wx: number, wy: number) {
    const z = this.state.zone
    const vx = Math.round(wx / TILE), vy = Math.round(wy / TILE)
    if (vx < 0 || vy < 0 || vx > z.width || vy > z.height) return
    const W = z.width + 1, H = z.height + 1
    const target = cornerTerrain(z, vx, vy).id
    const value = this.state.terrain
    if (target === value || !terrainById.has(value)) return

    this.state.checkpoint()
    const seen = new Uint8Array(W * H)
    const stack = [vy * W + vx]
    seen[stack[0]] = 1
    while (stack.length) {
      const i = stack.pop()!
      z.corners[i] = value
      const x = i % W, y = (i - x) / W
      const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      for (const [nx, ny] of next) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!seen[j] && cornerTerrain(z, nx, ny).id === target) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    this.ground.redrawAll()
    this.refreshOverlays()
    this.state.edited()
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
    const hits = this.input.hitTestPointer(p) as Phaser.GameObjects.Image[]
    let best: Phaser.GameObjects.Image | null = null
    for (const h of hits) if (this.sprites.includes(h) && (!best || h.depth > best.depth)) best = h
    return best ? this.sprites.indexOf(best) : null
  }

  /**
   * Conta-gotas (Alt+clique): com ferramenta de objeto/seleção copia o
   * objeto sob o mouse; senão copia o terreno do vértice mais próximo.
   */
  private eyedropper(p: Phaser.Input.Pointer) {
    const { tool } = this.state
    if (tool === 'object' || tool === 'select') {
      const i = this.objectAt(p)
      if (i !== null) this.state.set({ objectKind: this.state.zone.objects[i].kind, tool: 'object' })
      return
    }
    const z = this.state.zone
    const vx = Phaser.Math.Clamp(Math.round(p.worldX / TILE), 0, z.width)
    const vy = Phaser.Math.Clamp(Math.round(p.worldY / TILE), 0, z.height)
    this.state.set({ terrain: cornerTerrain(z, vx, vy).id, tool: tool === 'fill' ? 'fill' : 'brush' })
  }

  // ── Ações chamadas pela interface ──────────────────────

  deleteSelected() {
    const portal = this.state.portal
    if (portal) {
      this.state.checkpoint()
      this.state.zone.portals = this.state.zone.portals.filter((p) => p !== portal)
      this.state.selectedPortal = null
      this.state.edited()
      this.state.emit('ui')
      return
    }
    const i = this.state.selected
    if (i === null) return
    this.state.checkpoint()
    this.state.zone.objects.splice(i, 1)
    this.sprites.splice(i, 1)[0]?.destroy()
    this.state.selected = null
    this.refreshOverlays()
    this.state.edited()
    this.state.emit('ui')
  }

  centerOnZone() {
    const z = this.state.zone
    this.cameras.main.centerOn((z.width * TILE) / 2, (z.height * TILE) / 2)
  }
}
