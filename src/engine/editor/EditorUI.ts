// ────────────────────────────────────────────────────────
// Interface do editor em DOM puro (sem React, pra rodar igual sozinho
// ou dentro do Vorterium). Lê e muda o EditorState; ações que mexem no
// Phaser passam pelos `hooks`.
// ────────────────────────────────────────────────────────

import css from './editor.css?inline'
import { ICONS } from './icons'
import type { EditorState, Tool } from './EditorState'
import { TERRAINS, TERRAIN_TEXTURE, terrainFrameRect, terrainById } from '../assets/terrains'
import { footRect, objectCatalog, objectDef, sheetTexture } from '../assets/objects'
import { parseZone, type ZoneStorage } from '../storage'
import { TILE, ZONE_MAX, ZONE_MIN, clampZoneSize, newZone, type ZoneData } from '../types'
import { solidTerrainRects } from '../world/ground'

export interface EditorHooks {
  /** Imagem de uma textura carregada no Phaser (pra desenhar miniaturas). */
  textureImage(key: string): CanvasImageSource
  startTest(): void
  stopTest(): void
  deleteSelected(): void
  centerOnZone(): void
}

type Children = (Node | string | null | undefined | false)[]

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'html') el.innerHTML = String(v)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'brush', label: 'Pincel de terreno', key: 'B' },
  { id: 'fill', label: 'Balde (preencher área)', key: 'G' },
  { id: 'erase', label: 'Borracha (volta ao terreno base)', key: 'E' },
  { id: 'object', label: 'Colocar objeto', key: 'O' },
  { id: 'select', label: 'Selecionar / mover objeto', key: 'V' },
  { id: 'spawn', label: 'Ponto de início do jogador', key: 'P' },
]

const BRUSH_MAX = 8

let styleInjected = false

export class EditorUI {
  readonly root: HTMLDivElement
  readonly stage: HTMLDivElement
  private nameInput!: HTMLInputElement
  private toolButtons = new Map<Tool, HTMLButtonElement>()
  private toggles: { el: HTMLButtonElement; on: () => boolean }[] = []
  private brushLabel!: HTMLElement
  private undoBtn!: HTMLButtonElement
  private redoBtn!: HTMLButtonElement
  private statusEl!: HTMLElement
  private tab: 'terrains' | 'objects' = 'terrains'
  private tabButtons = new Map<string, HTMLButtonElement>()
  private paneEl!: HTMLDivElement
  private zonePropsEl!: HTMLDivElement
  private objectFilter = ''
  private objectCategory = 'Todas'
  private terrainCells = new Map<string, HTMLElement>()
  private objectCells = new Map<string, HTMLElement>()
  private testing = false
  private modalOpen = false
  private offState: () => void
  private onKey = (e: KeyboardEvent) => this.handleKey(e)
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.state.dirty) e.preventDefault()
  }

  constructor(parent: HTMLElement, private state: EditorState, private storage: ZoneStorage, private hooks: EditorHooks) {
    if (!styleInjected) {
      document.head.append(h('style', { 'data-vortable': '' }, css))
      styleInjected = true
    }
    this.stage = h('div', { class: 'vt-stage' })
    this.root = h('div', { class: 'vt-root' },
      this.buildTop(),
      this.buildTools(),
      this.stage,
      this.buildPanel(),
      this.buildStatus(),
      h('div', { class: 'vt-testbar' },
        h('span', {}, 'Testando a zona — ', h('kbd', {}, 'WASD'), ' anda, ', h('kbd', {}, 'Shift'), ' corre, ', h('kbd', {}, 'C'), ' colisões'),
        h('button', { class: 'vt-btn vt-primary', html: `${ICONS.stop}<span>Voltar ao editor</span>`, onclick: () => this.stopTest() }),
      ),
    )
    // a interface é posicionada por cima do container: ele precisa ser referência
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    parent.append(this.root)
    // botão clicado perde o foco: senão Espaço (arrastar a tela) "clica" nele de novo
    this.root.addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur())

    this.offState = state.on((c) => {
      if (c === 'zone') this.nameInput.value = state.zone.name
      if (c === 'zone' || c === 'edit') this.renderZoneProps()
      this.refresh()
    })
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('beforeunload', this.onBeforeUnload)
  }

  /** Chamado quando a arte terminou de carregar (as miniaturas dependem dela). */
  assetsReady() {
    this.renderPane()
    this.renderZoneProps()
    this.refresh()
  }

  destroy() {
    this.offState()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.root.remove()
  }

  // ── Montagem ───────────────────────────────────────────

  private iconBtn(icon: string, label: string, onclick: () => void, extra = '') {
    return h('button', { class: `vt-btn ${extra}`, title: label, html: `${icon}<span class="vt-label">${label}</span>`, onclick })
  }

  private buildTop() {
    this.nameInput = h('input', {
      class: 'vt-name',
      value: this.state.zone.name,
      title: 'Nome da zona',
      oninput: () => {
        this.state.zone.name = this.nameInput.value
        this.state.dirty = true
        this.refresh()
      },
    })
    this.undoBtn = h('button', { class: 'vt-btn', title: 'Desfazer (Ctrl+Z)', html: ICONS.undo, onclick: () => this.state.undo() })
    this.redoBtn = h('button', { class: 'vt-btn', title: 'Refazer (Ctrl+Y)', html: ICONS.redo, onclick: () => this.state.redo() })
    const importInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: (e: Event) => this.importFile(e) })
    return h('header', { class: 'vt-top' },
      h('span', { class: 'vt-brand' }, 'Vortable'),
      this.nameInput,
      h('span', { class: 'vt-sep' }),
      this.iconBtn(ICONS.plus, 'Nova', () => this.openNewModal()),
      this.iconBtn(ICONS.open, 'Abrir', () => this.openOpenModal()),
      this.iconBtn(ICONS.save, 'Salvar', () => this.save()),
      h('span', { class: 'vt-sep' }),
      this.iconBtn(ICONS.download, 'Exportar', () => this.exportZone()),
      this.iconBtn(ICONS.upload, 'Importar', () => importInput.click()),
      importInput,
      h('span', { class: 'vt-sep' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'vt-spacer' }),
      this.iconBtn(ICONS.play, 'Testar', () => this.startTest(), 'vt-primary'),
    )
  }

  private buildTools() {
    const el = h('aside', { class: 'vt-tools' })
    for (const t of TOOLS) {
      const b = h('button', {
        class: 'vt-tool',
        title: `${t.label} (${t.key})`,
        html: ICONS[t.id],
        onclick: () => this.setTool(t.id),
      })
      this.toolButtons.set(t.id, b)
      el.append(b)
    }
    el.append(h('hr'))
    this.brushLabel = h('b', {}, String(this.state.brush))
    el.append(h('div', { class: 'vt-size', title: 'Tamanho do pincel ([ e ])' },
      h('button', { class: 'vt-btn', onclick: () => this.setBrush(this.state.brush + 1) }, '+'),
      this.brushLabel,
      h('button', { class: 'vt-btn', onclick: () => this.setBrush(this.state.brush - 1) }, '−'),
      'pincel',
    ))
    el.append(h('hr'))
    const toggle = (icon: string, label: string, on: () => boolean, flip: () => void) => {
      const b = h('button', { class: 'vt-tool', title: label, html: icon, onclick: flip })
      this.toggles.push({ el: b, on })
      el.append(b)
    }
    toggle(ICONS.grid, 'Mostrar grade (H)', () => this.state.showGrid, () => this.state.set({ showGrid: !this.state.showGrid }))
    toggle(ICONS.collision, 'Mostrar colisões (K)', () => this.state.showCollision, () => this.state.set({ showCollision: !this.state.showCollision }))
    toggle(ICONS.snap, 'Encaixar objetos na grade (N)', () => this.state.snap, () => this.state.set({ snap: !this.state.snap }))
    el.append(h('button', { class: 'vt-tool', title: 'Centralizar a zona (Home)', html: ICONS.center, onclick: () => this.hooks.centerOnZone() }))
    return el
  }

  private buildPanel() {
    const tabs = h('div', { class: 'vt-tabs' })
    for (const [id, label] of [['terrains', 'Terrenos'], ['objects', 'Objetos']] as const) {
      const b = h('button', { class: 'vt-tab', onclick: () => { this.tab = id; this.renderPane(); this.refresh() } }, label)
      this.tabButtons.set(id, b)
      tabs.append(b)
    }
    this.paneEl = h('div', { class: 'vt-pane' })
    this.zonePropsEl = h('div', { class: 'vt-zoneprops' })
    return h('aside', { class: 'vt-panel' }, tabs, this.paneEl, this.zonePropsEl)
  }

  private buildStatus() {
    this.statusEl = h('footer', { class: 'vt-status' })
    return this.statusEl
  }

  // ── Painel: terrenos e objetos ─────────────────────────

  private renderPane() {
    this.paneEl.replaceChildren()
    this.terrainCells.clear()
    this.objectCells.clear()
    if (this.tab === 'terrains') this.renderTerrains()
    else this.renderObjects()
  }

  private renderTerrains() {
    const img = this.hooks.textureImage(TERRAIN_TEXTURE)
    const groups = new Map<string, typeof TERRAINS>()
    for (const t of TERRAINS) groups.set(t.category, [...(groups.get(t.category) ?? []), t])
    for (const [cat, list] of groups) {
      const grid = h('div', { class: 'vt-grid vt-terrains' })
      for (const t of list) {
        const c = h('canvas', { width: 32, height: 32 }) as HTMLCanvasElement
        const r = terrainFrameRect(t, 10)
        c.getContext('2d')!.drawImage(img, r.x, r.y, 32, 32, 0, 0, 32, 32)
        const cell = h('button', {
          class: 'vt-cell',
          title: t.label + (t.solid ? ' (não dá pra andar)' : ''),
          onclick: () => {
            this.state.set({ terrain: t.id, tool: this.state.tool === 'fill' ? 'fill' : 'brush' })
          },
        }, c, h('span', {}, t.label))
        this.terrainCells.set(t.id, cell)
        grid.append(cell)
      }
      this.paneEl.append(h('div', { class: 'vt-group' }, h('h4', {}, cat), grid))
    }
  }

  private renderObjects() {
    const { objects } = objectCatalog()
    const cats = ['Todas', ...new Set(objects.map((o) => o.category))]
    const search = h('input', {
      class: 'vt-search',
      placeholder: `Buscar entre ${objects.length} objetos...`,
      value: this.objectFilter,
      oninput: () => { this.objectFilter = search.value; fill() },
    })
    const chips = h('div', { class: 'vt-chips' })
    for (const c of cats) {
      chips.append(h('button', {
        class: `vt-chip${c === this.objectCategory ? ' vt-on' : ''}`,
        onclick: () => { this.objectCategory = c; this.renderPane(); this.refresh() },
      }, c))
    }
    const grid = h('div', { class: 'vt-grid vt-objects' })
    const fill = () => {
      grid.replaceChildren()
      this.objectCells.clear()
      const q = this.objectFilter.trim().toLowerCase()
      const list = objects.filter((o) =>
        (this.objectCategory === 'Todas' || o.category === this.objectCategory) &&
        (!q || o.label.toLowerCase().includes(q) || o.category.toLowerCase().includes(q)))
      if (!list.length) grid.append(h('div', { class: 'vt-empty', style: 'grid-column: 1 / -1' }, 'Nada encontrado.'))
      for (const o of list) {
        const size = 64
        const c = h('canvas', { width: size, height: size }) as HTMLCanvasElement
        const ctx = c.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        const s = Math.min(size / o.w, size / o.h, 2)
        const w = o.w * s, hh = o.h * s
        ctx.drawImage(this.hooks.textureImage(sheetTexture(o.sheet)), o.x, o.y, o.w, o.h, (size - w) / 2, size - hh, w, hh)
        const cell = h('button', {
          class: 'vt-cell',
          title: `${o.label} — ${o.w}×${o.h}px${o.foot ? '' : ' (sem colisão)'}`,
          onclick: () => this.state.set({ objectKind: o.id, tool: 'object' }),
        }, c)
        this.objectCells.set(o.id, cell)
        grid.append(cell)
      }
      this.refresh()
    }
    this.paneEl.append(search, chips, grid)
    fill()
  }

  private renderZoneProps() {
    const z = this.state.zone
    const base = h('select', {
      class: 'vt-select',
      onchange: () => {
        this.state.checkpoint()
        this.state.zone.base = base.value
        this.state.emit('zone')
      },
    }) as HTMLSelectElement
    for (const t of TERRAINS.filter((t) => !t.solid)) base.append(h('option', { value: t.id, selected: t.id === z.base }, t.label))
    const w = h('input', { class: 'vt-input vt-num', type: 'number', min: ZONE_MIN, max: ZONE_MAX, value: z.width })
    const hh = h('input', { class: 'vt-input vt-num', type: 'number', min: ZONE_MIN, max: ZONE_MAX, value: z.height })
    this.zonePropsEl.replaceChildren(
      h('div', { class: 'vt-row' }, h('label', {}, 'Fundo'), base),
      h('div', { class: 'vt-row' },
        h('label', {}, 'Tamanho'), w, '×', hh,
        h('button', {
          class: 'vt-btn',
          onclick: () => this.resizeZone(Number(w.value), Number(hh.value)),
        }, 'Aplicar'),
      ),
    )
  }

  // ── Estado → tela ──────────────────────────────────────

  private refresh() {
    const s = this.state
    for (const [id, b] of this.toolButtons) b.classList.toggle('vt-on', s.tool === id)
    for (const t of this.toggles) t.el.classList.toggle('vt-on', t.on())
    for (const [id, b] of this.tabButtons) b.classList.toggle('vt-on', this.tab === id)
    for (const [id, c] of this.terrainCells) c.classList.toggle('vt-on', s.terrain === id && (s.tool === 'brush' || s.tool === 'fill'))
    for (const [id, c] of this.objectCells) c.classList.toggle('vt-on', s.objectKind === id && s.tool === 'object')
    this.brushLabel.textContent = String(s.brush)
    this.undoBtn.disabled = !s.canUndo
    this.redoBtn.disabled = !s.canRedo

    const z = s.zone
    const parts: Node[] = []
    if (s.cursor) parts.push(h('span', {}, `Tile ${s.cursor.tx}, ${s.cursor.ty}`))
    parts.push(h('span', {}, `${z.width}×${z.height} tiles`))
    parts.push(h('span', {}, `Zoom ${Math.round(s.zoom * 100)}%`))
    parts.push(h('span', {}, `${z.objects.length} objetos`))
    parts.push(s.dirty ? h('span', { class: 'vt-dirty' }, '● não salvo') : h('span', {}, 'salvo'))
    const hint = {
      brush: `Pincel: ${terrainById.get(s.terrain)?.label ?? ''} — arraste pra pintar`,
      fill: `Balde: ${terrainById.get(s.terrain)?.label ?? ''} — clique pra preencher a área`,
      erase: 'Borracha — volta ao terreno de fundo',
      object: s.objectKind ? 'Clique pra colocar · Esc solta o objeto' : 'Escolha um objeto na aba Objetos',
      select: s.selected !== null ? 'Arraste pra mover · Del apaga' : 'Clique num objeto pra selecionar',
      spawn: 'Clique onde o jogador deve aparecer',
    }[s.tool]
    parts.push(h('span', { class: 'vt-hint' }, `${hint} · Alt+clique copia · botão direito arrasta a tela · roda dá zoom`))
    this.statusEl.replaceChildren(...parts)
  }

  // ── Ações ──────────────────────────────────────────────

  private setTool(tool: Tool) {
    if (tool === 'object' && this.tab !== 'objects') {
      this.tab = 'objects'
      this.renderPane()
    }
    if ((tool === 'brush' || tool === 'fill') && this.tab !== 'terrains') {
      this.tab = 'terrains'
      this.renderPane()
    }
    this.state.set({ tool })
  }

  private setBrush(n: number) {
    this.state.set({ brush: Math.max(1, Math.min(BRUSH_MAX, n)) })
  }

  private async save() {
    try {
      await this.storage.save(this.state.zone)
      this.state.markSaved()
      this.toast('Zona salva.')
    } catch (err) {
      this.toast(`Não deu pra salvar: ${(err as Error).message}`, true)
    }
  }

  private exportZone() {
    const z = this.state.zone
    const blob = new Blob([JSON.stringify(z)], { type: 'application/json' })
    const a = h('a', { href: URL.createObjectURL(blob), download: `${slug(z.name) || 'zona'}.vortable.json` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  private async importFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const zone = parseZone(JSON.parse(await file.text()))
      if (!this.confirmDiscard()) return
      this.state.load(zone)
      this.state.dirty = true
      this.state.emit('ui')
      this.hooks.centerOnZone()
      this.toast(`"${zone.name}" importada. Salve pra guardar.`)
    } catch (err) {
      this.toast((err as Error).message, true)
    }
  }

  private confirmDiscard() {
    return !this.state.dirty || confirm('Há mudanças não salvas nesta zona. Descartar?')
  }

  private resizeZone(width: number, height: number) {
    const z = this.state.zone
    width = clampZoneSize(width, z.width)
    height = clampZoneSize(height, z.height)
    if (width === z.width && height === z.height) {
      this.renderZoneProps()
      return
    }
    this.state.checkpoint()
    const corners: string[] = new Array((width + 1) * (height + 1)).fill('')
    for (let y = 0; y <= Math.min(height, z.height); y++)
      for (let x = 0; x <= Math.min(width, z.width); x++)
        corners[y * (width + 1) + x] = z.corners[y * (z.width + 1) + x]
    const W = width * TILE, H = height * TILE
    const resized: ZoneData = {
      ...z,
      width,
      height,
      corners,
      objects: z.objects.filter((o) => o.x <= W && o.y <= H),
      spawn: { x: Math.min(z.spawn.x, W - 16), y: Math.min(z.spawn.y, H - 16) },
    }
    this.state.zone = resized
    this.state.selected = null
    this.state.emit('zone')
    this.toast(`Zona agora tem ${width}×${height} tiles.`)
  }

  private startTest() {
    if (this.spawnBlocked()) this.toast('Atenção: o ponto de início está dentro de algo sólido — o boneco pode ficar preso.', true)
    this.testing = true
    this.root.classList.add('vt-testing')
    this.hooks.startTest()
  }

  /** O pé do boneco no ponto de início encosta em água, buraco ou tronco? */
  private spawnBlocked() {
    const z = this.state.zone
    const foot = { x: z.spawn.x - 9, y: z.spawn.y - 10, w: 18, h: 10 }
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      foot.x < r.x + r.w && r.x < foot.x + foot.w && foot.y < r.y + r.h && r.y < foot.y + foot.h
    if (solidTerrainRects(z).some(hit)) return true
    return z.objects.some((o) => {
      const def = objectDef(o.kind)
      const r = def && footRect(def, o.x, o.y)
      return !!r && hit(r)
    })
  }

  private stopTest() {
    if (!this.testing) return
    this.testing = false
    this.root.classList.remove('vt-testing')
    this.hooks.stopTest()
  }

  // ── Janelas ────────────────────────────────────────────

  private modal(title: string, body: Node[], foot: Node[]) {
    this.modalOpen = true
    const close = () => {
      this.modalOpen = false
      bg.remove()
    }
    const bg = h('div', {
      class: 'vt-modal-bg',
      onmousedown: (e: MouseEvent) => { if (e.target === bg) close() },
    }, h('div', { class: 'vt-modal' },
      h('h3', {}, title),
      h('div', { class: 'vt-modal-body' }, ...body),
      h('div', { class: 'vt-modal-foot' }, ...foot),
    ))
    this.root.append(bg)
    return close
  }

  private openNewModal() {
    const name = h('input', { class: 'vt-input', value: 'Nova zona' })
    const w = h('input', { class: 'vt-input vt-num', type: 'number', min: ZONE_MIN, max: ZONE_MAX, value: 40 })
    const hh = h('input', { class: 'vt-input vt-num', type: 'number', min: ZONE_MIN, max: ZONE_MAX, value: 30 })
    const base = h('select', { class: 'vt-select' }) as HTMLSelectElement
    for (const t of TERRAINS.filter((t) => !t.solid)) base.append(h('option', { value: t.id }, t.label))
    const create = () => {
      if (!this.confirmDiscard()) return
      this.state.load(newZone(name.value.trim() || 'Nova zona', Number(w.value), Number(hh.value), base.value))
      this.hooks.centerOnZone()
      close()
    }
    const close = this.modal('Nova zona', [
      h('div', { class: 'vt-row' }, h('label', {}, 'Nome'), name),
      h('div', { class: 'vt-row' }, h('label', {}, 'Tamanho'), w, '×', hh, h('small', { style: 'color:var(--vt-muted)' }, `tiles (${ZONE_MIN}–${ZONE_MAX})`)),
      h('div', { class: 'vt-row' }, h('label', {}, 'Fundo'), base),
    ], [
      h('button', { class: 'vt-btn', onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'vt-btn vt-primary', onclick: create }, 'Criar'),
    ])
    for (const input of [name, w, hh]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create() })
    setTimeout(() => name.select(), 0)
  }

  private async openOpenModal() {
    const list = h('div', { class: 'vt-list' })
    const close = this.modal('Abrir zona', [list], [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')])
    const render = async () => {
      let zones
      try {
        zones = await this.storage.list()
      } catch (err) {
        list.replaceChildren(h('div', { class: 'vt-empty' }, `Não deu pra ler as zonas: ${(err as Error).message}`))
        return
      }
      list.replaceChildren()
      if (!zones.length) list.append(h('div', { class: 'vt-empty' }, 'Nenhuma zona salva ainda.'))
      for (const z of zones) {
        list.append(h('div', { class: 'vt-item' },
          h('div', {},
            h('b', {}, z.name || '(sem nome)'),
            h('small', {}, `${z.width}×${z.height} tiles · ${new Date(z.updatedAt).toLocaleString('pt-BR')}`),
          ),
          h('button', {
            class: 'vt-btn vt-primary',
            onclick: async () => {
              if (!this.confirmDiscard()) return
              const zone = await this.storage.load(z.id).catch(() => null)
              if (!zone) return this.toast('Não deu pra abrir essa zona (apagada ou corrompida).', true)
              this.state.load(zone)
              this.hooks.centerOnZone()
              close()
            },
          }, 'Abrir'),
          h('button', {
            class: 'vt-btn vt-danger',
            title: 'Apagar',
            html: ICONS.trash,
            onclick: async () => {
              if (!confirm(`Apagar "${z.name}"? Não dá pra desfazer.`)) return
              try {
                await this.storage.remove(z.id)
              } catch (err) {
                this.toast(`Não deu pra apagar: ${(err as Error).message}`, true)
              }
              render()
            },
          }),
        ))
      }
    }
    render()
  }

  private toast(msg: string, error = false) {
    const t = h('div', { class: `vt-toast${error ? ' vt-error' : ''}` }, msg)
    this.root.append(t)
    setTimeout(() => t.remove(), 2500)
  }

  // ── Teclado ────────────────────────────────────────────

  private handleKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement
    if (this.testing) {
      if (e.key === 'Escape') this.stopTest()
      return
    }
    if (this.modalOpen) {
      if (e.key === 'Escape') this.root.querySelector('.vt-modal-bg')?.dispatchEvent(new MouseEvent('mousedown'))
      return
    }
    const typing = target.matches('input, textarea, select')
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()

    if (ctrl && k === 's') { e.preventDefault(); this.save(); return }
    if (typing) return
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); this.state.undo(); return }
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.state.redo(); return }
    if (ctrl) return

    const tool = TOOLS.find((t) => t.key.toLowerCase() === k)
    if (tool) { this.setTool(tool.id); return }
    if (k === '[') this.setBrush(this.state.brush - 1)
    else if (k === ']') this.setBrush(this.state.brush + 1)
    else if (k === 'h') this.state.set({ showGrid: !this.state.showGrid })
    else if (k === 'k') this.state.set({ showCollision: !this.state.showCollision })
    else if (k === 'n') this.state.set({ snap: !this.state.snap })
    else if (e.key === 'Home') this.hooks.centerOnZone()
    else if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.deleteSelected()
    else if (e.key === 'Escape') this.state.set({ tool: 'select', selected: null })
    else if (e.key === ' ') e.preventDefault()
  }
}

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
