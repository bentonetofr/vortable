// ────────────────────────────────────────────────────────
// Interface do editor em DOM puro (sem React, pra rodar igual sozinho
// ou dentro do Vorterium). Lê e muda o EditorState; ações que mexem no
// Phaser passam pelos `hooks`.
// ────────────────────────────────────────────────────────

import css from './editor.css?inline'
import { h, injectStyle } from '../ui/dom'
import { creditsBody } from '../ui/credits'
import { ICONS } from './icons'
import type { EditorState, Tool } from './EditorState'
import { TERRAINS, canBeBase, terrainById, terrainFrameRect, terrainTexture } from '../assets/terrains'
import { footRect, objectCatalog, objectDef, sheetTexture } from '../assets/objects'
import { parseZone, summarize, type WorldStorage, type ZoneSummary } from '../storage'
import { TILE, ZONE_MAX, ZONE_MIN, clampZoneSize, newId, newZone, type Portal, type ZoneData } from '../types'
import { solidTerrainRects } from '../world/ground'

export interface EditorHooks {
  /** Pasta de assets (pros créditos). */
  assetBase: string
  /** Imagem de uma textura carregada no Phaser (pra desenhar miniaturas). */
  textureImage(key: string): CanvasImageSource
  startTest(): void
  stopTest(): void
  deleteSelected(): void
  centerOnZone(): void
  /** Abrir o criador de personagem (se quem montou o editor oferecer). */
  editCharacter?: () => void
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'brush', label: 'Pincel de terreno', key: 'B' },
  { id: 'fill', label: 'Balde (preencher área)', key: 'G' },
  { id: 'erase', label: 'Borracha (volta ao terreno base)', key: 'E' },
  { id: 'object', label: 'Colocar objeto', key: 'O' },
  { id: 'select', label: 'Selecionar / mover objeto', key: 'V' },
  { id: 'portal', label: 'Saída para outra zona (porta, borda, escada)', key: 'X' },
  { id: 'spawn', label: 'Ponto de início do jogador', key: 'P' },
]

const BRUSH_MAX = 8

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
  private portalEl!: HTMLDivElement
  private testZoneEl!: HTMLElement
  /** Qual saída o painel está mostrando (só redesenha quando troca). */
  private shownPortal: string | null = null
  private objectFilter = ''
  private objectCategory = 'Todas'
  private terrainCells = new Map<string, HTMLElement>()
  private objectCells = new Map<string, HTMLElement>()
  private testing = false
  private modals: (() => void)[] = []
  private offState: () => void
  private onKey = (e: KeyboardEvent) => this.handleKey(e)
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.state.dirty) e.preventDefault()
  }

  constructor(parent: HTMLElement, private state: EditorState, private storage: WorldStorage, private hooks: EditorHooks) {
    injectStyle('editor', css)
    this.stage = h('div', { class: 'vt-stage' })
    this.root = h('div', { class: 'vt-root' },
      this.buildTop(),
      this.buildTools(),
      this.stage,
      this.buildPanel(),
      this.buildStatus(),
      h('div', { class: 'vt-testbar' },
        this.testZoneEl = h('b', { class: 'vt-testzone' }),
        h('span', {}, h('kbd', {}, 'WASD'), ' anda, ', h('kbd', {}, 'Shift'), ' corre, ', h('kbd', {}, 'C'), ' colisões'),
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
      if (c === 'zone' || c === 'world' || state.selectedPortal !== this.shownPortal) this.renderPortal()
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
    this.reloadWorld()
  }

  /** Relê o mundo e a lista de zonas salvas. */
  private async reloadWorld() {
    try {
      this.state.world = await this.storage.loadWorld()
      this.state.zones = await this.storage.list()
    } catch (err) {
      this.toast(`Não deu pra ler o mundo: ${(err as Error).message}`, true)
    }
    this.state.emit('world')
  }

  /** Nome da zona onde o teste está agora (muda ao atravessar saídas). */
  showTestZone(name: string) {
    this.testZoneEl.textContent = name
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
      this.iconBtn(ICONS.world, 'Mundo', () => this.openWorldModal()),
      this.iconBtn(ICONS.save, 'Salvar', () => this.save()),
      h('span', { class: 'vt-sep' }),
      this.iconBtn(ICONS.download, 'Exportar', () => this.exportZone()),
      this.iconBtn(ICONS.upload, 'Importar', () => importInput.click()),
      importInput,
      h('span', { class: 'vt-sep' }),
      this.undoBtn,
      this.redoBtn,
      h('span', { class: 'vt-spacer' }),
      this.hooks.editCharacter ? this.iconBtn(ICONS.person, 'Personagem', () => this.openCharacter()) : null,
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
    this.portalEl = h('div', { class: 'vt-zoneprops vt-portalprops' })
    return h('aside', { class: 'vt-panel' }, tabs, this.paneEl, this.portalEl, this.zonePropsEl)
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
    const groups = new Map<string, typeof TERRAINS>()
    for (const t of TERRAINS) groups.set(t.category, [...(groups.get(t.category) ?? []), t])
    for (const [cat, list] of groups) {
      const grid = h('div', { class: 'vt-grid vt-terrains' })
      for (const t of list) {
        const c = h('canvas', { width: 32, height: 32 }) as HTMLCanvasElement
        const r = terrainFrameRect(t, 10)
        c.getContext('2d')!.drawImage(this.hooks.textureImage(terrainTexture(t)), r.x, r.y, 32, 32, 0, 0, 32, 32)
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
    for (const t of TERRAINS.filter(canBeBase)) base.append(h('option', { value: t.id, selected: t.id === z.base }, t.label))
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

  // ── Painel: saída selecionada ──────────────────────────

  /** Nome, destino e ligação de volta da saída selecionada. */
  private renderPortal() {
    const s = this.state
    const portal = s.portal
    this.shownPortal = portal?.id ?? null
    this.portalEl.hidden = !portal
    if (!portal) {
      this.portalEl.replaceChildren()
      return
    }
    const name = h('input', {
      class: 'vt-input',
      value: portal.name,
      oninput: () => {
        portal.name = name.value
        s.edited()
      },
    }) as HTMLInputElement

    // destinos possíveis: esta zona + as salvas no mundo
    const zones = [{ id: s.zone.id, name: `${s.zone.name} (esta zona)` }, ...s.zones.filter((z) => z.id !== s.zone.id)]
    const zoneSel = h('select', { class: 'vt-select' },
      h('option', { value: '' }, '— nenhuma —'),
      ...zones.map((z) => h('option', { value: z.id, selected: portal.to?.zone === z.id }, z.name)),
    ) as HTMLSelectElement
    const portalsOf = (zoneId: string) =>
      zoneId === s.zone.id
        ? s.zone.portals.filter((q) => q.id !== portal.id).map((q) => ({ id: q.id, name: q.name }))
        : s.zones.find((z) => z.id === zoneId)?.portals ?? []
    const destSel = h('select', { class: 'vt-select' }) as HTMLSelectElement
    const fillDest = () => {
      const list = portalsOf(zoneSel.value)
      destSel.replaceChildren(
        h('option', { value: '' }, !zoneSel.value ? '—' : list.length ? '— escolha —' : '(nenhuma saída lá)'),
        ...list.map((q) => h('option', { value: q.id, selected: portal.to?.portal === q.id }, q.name)),
      )
      destSel.disabled = !zoneSel.value || !list.length
    }
    fillDest()
    const apply = () => {
      const to = zoneSel.value && destSel.value ? { zone: zoneSel.value, portal: destSel.value } : null
      if (JSON.stringify(to) === JSON.stringify(portal.to)) return
      s.checkpoint()
      portal.to = to
      s.edited()
    }
    zoneSel.addEventListener('change', () => {
      fillDest()
      if (destSel.options.length === 2) destSel.selectedIndex = 1 // só uma saída lá: já escolhe
      apply()
    })
    destSel.addEventListener('change', apply)

    const saved = s.zones.some((z) => z.id === s.zone.id)
    this.portalEl.replaceChildren(
      h('h4', { class: 'vt-subtitle' }, 'Saída selecionada'),
      h('div', { class: 'vt-row' }, h('label', {}, 'Nome'), name),
      h('div', { class: 'vt-row' }, h('label', {}, 'Leva para'), zoneSel),
      h('div', { class: 'vt-row' }, h('label', {}, 'Chega em'), destSel),
      h('div', { class: 'vt-row' },
        h('button', {
          class: 'vt-btn',
          style: 'flex:1',
          title: 'A saída de lá passa a trazer de volta pra cá (se não houver uma, cria)',
          onclick: () => this.linkBack(portal, zoneSel.value, destSel.value),
        }, 'Ligar ida e volta'),
        h('button', { class: 'vt-btn vt-danger', title: 'Apagar saída (Del)', html: ICONS.trash, onclick: () => this.hooks.deleteSelected() }),
      ),
      ...(saved ? [] : [h('small', { class: 'vt-note' }, 'Salve esta zona pra que outras zonas possam trazer o jogador até aqui.')]),
    )
  }

  /** Faz a saída de destino apontar de volta pra esta (criando uma, se preciso). */
  private async linkBack(portal: Portal, zoneId: string, destId: string) {
    const s = this.state
    if (!zoneId) return this.toast('Escolha primeiro pra qual zona a saída leva.', true)
    const here = { zone: s.zone.id, portal: portal.id }
    const returnPortal = (spawn: { x: number; y: number }): Portal => {
      const g = TILE / 2
      return { id: newId('saida'), name: `Volta: ${s.zone.name}`, x: Math.round((spawn.x - 16) / g) * g, y: Math.round((spawn.y - 16) / g) * g, w: 32, h: 32, to: null }
    }

    if (zoneId === s.zone.id) {
      s.checkpoint()
      let dest = s.zone.portals.find((q) => q.id === destId)
      if (!dest) {
        dest = returnPortal(s.zone.spawn)
        s.zone.portals.push(dest)
      }
      dest.to = here
      portal.to = { zone: zoneId, portal: dest.id }
      s.edited()
      this.renderPortal()
      return this.toast('Ida e volta ligadas.')
    }

    try {
      const target = await this.storage.load(zoneId)
      if (!target) return this.toast('Não achei a zona de destino.', true)
      let dest = target.portals.find((q) => q.id === destId)
      const created = !dest
      if (!dest) {
        dest = returnPortal(target.spawn)
        target.portals.push(dest)
      }
      dest.to = here
      await this.storage.save(target)
      s.checkpoint()
      portal.to = { zone: zoneId, portal: dest.id }
      s.edited()
      s.zones = await this.storage.list()
      s.emit('world')
      this.renderPortal()
      this.toast(created
        ? `Criei "${dest.name}" em ${target.name}, no ponto de início de lá. Ajuste a posição quando abrir aquela zona.`
        : 'Ida e volta ligadas.')
    } catch (err) {
      this.toast(`Não deu pra ligar: ${(err as Error).message}`, true)
    }
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
      portal: s.selectedPortal ? 'Escolha o destino no painel · arraste pra mover · Del apaga' : 'Arraste pra desenhar uma saída · clique numa saída pra editar',
      spawn: 'Clique onde o jogador deve aparecer',
    }[s.tool]
    parts.push(h('span', { class: 'vt-hint' }, `${hint} · Alt+clique copia · botão direito arrasta a tela · roda dá zoom`))
    parts.push(h('button', { class: 'vt-link', onclick: () => this.openCredits() }, 'Créditos'))
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
      // a primeira zona salva vira o começo do mundo
      const world = this.state.world
      if (world && !world.start) {
        world.start = this.state.zone.id
        await this.storage.saveWorld(world)
      }
      this.state.markSaved()
      this.state.zones = await this.storage.list()
      this.state.emit('world')
      this.toast('Zona salva.')
      return true
    } catch (err) {
      this.toast(`Não deu pra salvar: ${(err as Error).message}`, true)
      return false
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
      if (!(await this.resolveUnsaved())) return
      this.state.load(zone)
      this.state.dirty = true
      this.state.emit('ui')
      this.hooks.centerOnZone()
      this.toast(`"${zone.name}" importada. Salve pra guardar.`)
    } catch (err) {
      this.toast((err as Error).message, true)
    }
  }

  /**
   * Antes de trocar de zona: se há mudanças, pergunta se salva, descarta ou
   * cancela. Devolve true quando pode seguir.
   */
  private resolveUnsaved(): Promise<boolean> {
    if (!this.state.dirty) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (ok: boolean) => { close(); resolve(ok) }
      const close = this.modal('Mudanças não salvas', [
        h('p', { style: 'margin:0' }, `"${this.state.zone.name}" tem mudanças que ainda não foram salvas.`),
      ], [
        h('button', { class: 'vt-btn', onclick: () => done(false) }, 'Cancelar'),
        h('button', { class: 'vt-btn vt-danger', onclick: () => done(true) }, 'Descartar'),
        h('button', { class: 'vt-btn vt-primary', onclick: async () => done(await this.save()) }, 'Salvar e continuar'),
      ], () => resolve(false))
    })
  }

  /** Abre uma zona salva (pelo mapa do mundo ou pela lista). */
  private async openZone(id: string) {
    if (id === this.state.zone.id) return true
    if (!(await this.resolveUnsaved())) return false
    const zone = await this.storage.load(id).catch(() => null)
    if (!zone) {
      this.toast('Não deu pra abrir essa zona (apagada ou corrompida).', true)
      return false
    }
    this.state.load(zone)
    this.hooks.centerOnZone()
    return true
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
      portals: z.portals.filter((p) => p.x < W && p.y < H).map((p) => ({ ...p, w: Math.min(p.w, W - p.x), h: Math.min(p.h, H - p.y) })),
      spawn: { x: Math.min(z.spawn.x, W - 16), y: Math.min(z.spawn.y, H - 16) },
    }
    this.state.zone = resized
    this.state.selected = null
    this.state.emit('zone')
    this.toast(`Zona agora tem ${width}×${height} tiles.`)
  }

  private openCredits() {
    const close = this.modal('Créditos da arte', creditsBody(this.hooks.assetBase),
      [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')])
  }

  private async openCharacter() {
    if (!(await this.resolveUnsaved())) return
    this.hooks.editCharacter?.()
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

  /** Janela por cima do editor. `onDismiss` roda se fechar por fora (Esc, clique no fundo). */
  private modal(title: string, body: Node[], foot: Node[], onDismiss?: () => void, wide = false) {
    const close = () => {
      this.modals = this.modals.filter((m) => m !== dismiss)
      bg.remove()
    }
    const dismiss = () => {
      close()
      onDismiss?.()
    }
    this.modals.push(dismiss)
    const bg = h('div', {
      class: 'vt-modal-bg',
      onmousedown: (e: MouseEvent) => { if (e.target === bg) dismiss() },
    }, h('div', { class: `vt-modal${wide ? ' vt-modal-wide' : ''}` },
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
    for (const t of TERRAINS.filter(canBeBase)) base.append(h('option', { value: t.id }, t.label))
    const kind = h('select', { class: 'vt-select' },
      h('option', { value: 'out' }, 'Exterior (40×30, grama)'),
      h('option', { value: 'in' }, 'Interior (16×12, vazio escuro)'),
    ) as HTMLSelectElement
    kind.addEventListener('change', () => {
      const inside = kind.value === 'in'
      w.value = inside ? '16' : '40'
      hh.value = inside ? '12' : '30'
      base.value = inside ? 'void' : 'grass'
    })
    const create = async () => {
      close()
      if (!(await this.resolveUnsaved())) return
      this.state.load(newZone(name.value.trim() || 'Nova zona', Number(w.value), Number(hh.value), base.value))
      this.state.dirty = true
      this.state.emit('ui')
      this.hooks.centerOnZone()
    }
    const close = this.modal('Nova zona', [
      h('div', { class: 'vt-row' }, h('label', {}, 'Nome'), name),
      h('div', { class: 'vt-row' }, h('label', {}, 'Tipo'), kind),
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
              close()
              await this.openZone(z.id)
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
                // o mundo esquece a zona (posição no mapa e, se era, o começo)
                const world = await this.storage.loadWorld()
                delete world.layout[z.id]
                if (world.start === z.id) world.start = null
                await this.storage.saveWorld(world)
              } catch (err) {
                this.toast(`Não deu pra apagar: ${(err as Error).message}`, true)
              }
              // apagou a zona aberta: ela continua na tela, mas agora não está salva
              if (z.id === this.state.zone.id) {
                this.state.dirty = true
                this.state.emit('ui')
              }
              await this.reloadWorld()
              render()
            },
          }),
        ))
      }
    }
    render()
  }

  // ── Mapa do mundo ──────────────────────────────────────

  private async openWorldModal() {
    await this.reloadWorld()
    const s = this.state
    const world = s.world
    if (!world) return
    // zonas salvas; a atual entra com as mudanças que ainda não foram salvas
    const zones: ZoneSummary[] = s.zones.map((z) => (z.id === s.zone.id ? summarize(s.zone, z.updatedAt) : z))
    if (!zones.some((z) => z.id === s.zone.id)) zones.unshift(summarize(s.zone, 0))

    const NODE_W = 190, NODE_H = 84, GAP_X = 60, GAP_Y = 50
    // zona sem posição: primeiro espaço livre numa grade de 4 colunas
    const taken = (x: number, y: number) =>
      Object.values(world.layout).some((p) => Math.abs(p.x - x) < NODE_W && Math.abs(p.y - y) < NODE_H)
    let placedNew = false
    for (const z of zones) {
      if (world.layout[z.id]) continue
      for (let i = 0; ; i++) {
        const x = 24 + (i % 4) * (NODE_W + GAP_X), y = 24 + Math.floor(i / 4) * (NODE_H + GAP_Y)
        if (!taken(x, y)) {
          world.layout[z.id] = { x, y }
          placedNew = true
          break
        }
      }
    }

    const inner = h('div', { class: 'vt-world-inner' })
    const board = h('div', { class: 'vt-world' }, inner)
    const svgNs = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNs, 'svg')
    svg.classList.add('vt-world-links')
    inner.append(svg)

    const resize = () => {
      const pos = Object.values(world.layout)
      const w = Math.max(...pos.map((p) => p.x), 0) + NODE_W + 40
      const hh = Math.max(...pos.map((p) => p.y), 0) + NODE_H + 40
      inner.style.width = `${w}px`
      inner.style.height = `${hh}px`
      svg.setAttribute('width', String(w))
      svg.setAttribute('height', String(hh))
    }
    /** Ponto onde a linha entre os centros sai pela borda do cartão de destino. */
    const edge = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const dx = from.x - to.x, dy = from.y - to.y
      const k = Math.min((NODE_W / 2 + 4) / Math.abs(dx || 1e-6), (NODE_H / 2 + 4) / Math.abs(dy || 1e-6))
      return { x: to.x + dx * k, y: to.y + dy * k }
    }
    const drawLinks = () => {
      resize()
      svg.innerHTML = '<defs><marker id="vt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="currentColor"/></marker></defs>'
      const center = (id: string) => {
        const p = world.layout[id]
        return p && { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }
      }
      for (const z of zones) {
        for (const target of z.links) {
          const a = center(z.id), b = center(target)
          if (!a || !b || target === z.id) continue
          const end = edge(a, b), start = edge(b, a)
          const line = document.createElementNS(svgNs, 'line')
          line.setAttribute('x1', String(start.x))
          line.setAttribute('y1', String(start.y))
          line.setAttribute('x2', String(end.x))
          line.setAttribute('y2', String(end.y))
          line.setAttribute('marker-end', 'url(#vt-arrow)')
          svg.append(line)
        }
      }
    }

    const saveWorld = () => {
      this.storage.saveWorld(world).catch((e) => this.toast(`Não deu pra salvar o mundo: ${e.message}`, true))
    }

    const renderNodes = () => {
      for (const n of inner.querySelectorAll('.vt-node')) n.remove()
      for (const z of zones) {
        const pos = world.layout[z.id]
        const isStart = world.start === z.id
        const node = h('div', {
          class: `vt-node${z.id === s.zone.id ? ' vt-current' : ''}${isStart ? ' vt-start' : ''}`,
          style: `left:${pos.x}px;top:${pos.y}px;width:${NODE_W}px;height:${NODE_H}px`,
        },
          h('div', { class: 'vt-node-title' }, isStart ? h('span', { class: 'vt-star', html: ICONS.star, title: 'Os jogadores começam aqui' }) : null, h('b', {}, z.name || '(sem nome)')),
          h('small', {}, `${z.width}×${z.height} · ${z.portals.length} saída${z.portals.length === 1 ? '' : 's'}${z.updatedAt ? '' : ' · não salva'}`),
          h('div', { class: 'vt-node-actions' },
            z.id === s.zone.id
              ? h('span', { class: 'vt-tag' }, 'aberta')
              : h('button', { class: 'vt-btn', onclick: async () => { if (await this.openZone(z.id)) close() } }, 'Abrir'),
            !isStart && h('button', {
              class: 'vt-btn',
              title: 'Os jogadores começam nesta zona',
              onclick: () => { world.start = z.id; saveWorld(); renderNodes() },
            }, 'Começar aqui'),
          ),
        )
        // arrastar o cartão (não os botões)
        node.addEventListener('pointerdown', (e) => {
          if ((e.target as HTMLElement).closest('button')) return
          const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          node.setPointerCapture(e.pointerId)
          node.classList.add('vt-dragging')
          const move = (ev: PointerEvent) => {
            pos.x = Math.max(0, Math.round(start.px + ev.clientX - start.x))
            pos.y = Math.max(0, Math.round(start.py + ev.clientY - start.y))
            node.style.left = `${pos.x}px`
            node.style.top = `${pos.y}px`
            drawLinks()
          }
          const up = () => {
            node.removeEventListener('pointermove', move)
            node.removeEventListener('pointerup', up)
            node.classList.remove('vt-dragging')
            saveWorld()
          }
          node.addEventListener('pointermove', move)
          node.addEventListener('pointerup', up)
        })
        inner.append(node)
      }
      drawLinks()
    }

    const worldName = h('input', {
      class: 'vt-input',
      value: world.name,
      oninput: () => { world.name = worldName.value; saveWorld() },
    }) as HTMLInputElement
    const close = this.modal('Mapa do mundo', [
      h('div', { class: 'vt-row' }, h('label', {}, 'Mundo'), worldName),
      board,
      h('small', { class: 'vt-note' }, 'Arraste os cartões pra organizar. As setas são as saídas entre zonas. A estrela marca onde os jogadores começam.'),
    ], [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')], undefined, true)
    renderNodes()
    if (placedNew) saveWorld()
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
    if (this.modals.length) {
      if (e.key === 'Escape') this.modals[this.modals.length - 1]()
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
