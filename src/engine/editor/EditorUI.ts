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
import { ZOOM_MAX, ZOOM_MIN, type EditorScene } from './EditorScene'
import { ROOM_HEIGHT_MAX, ROOM_PRESETS, encodeRoom, type RoomStyle } from '../world/rooms'
import type { TerrainDef } from '../assets/terrains'
import { TERRAINS, canBeBase, isFence, isOverlay, terrainById, terrainTexture, terrainThumb } from '../assets/terrains'
import { KIND_LABELS, objectCatalog, objectDef, objectSolids, paletteObjects, sheetTexture, variantsOf, type ObjectDef } from '../assets/objects'
import { curateForm, type CurateOverride } from './curate'
import { readList, writeList } from './prefs'
import { parseZone, summarize, type WorldStorage, type ZoneSummary } from '../storage'
import {
  DAY_MINUTES, LIGHT_RADIUS_MAX, LIGHT_RADIUS_MIN, TILE, ZONE_MAX, ZONE_MIN, Z_MAX, clampZoneSize, newId, newZone,
  type Portal, type ZoneData, type ZoneLighting, type ZoneObject,
} from '../types'
import { LIGHT_PRESETS, UNDERGROUND_TINT, ambientAt, daylight, formatHour, lightingOf, rgbToInt } from '../world/daylight'
import type { LightLook } from './EditorState'
import { DEFAULT_WIND, WIND_LEVELS } from '../world/wind'
import { WEATHERS, WEATHER_ORDER } from '../world/weather'
import { LAYERS, type LayerId } from '../audio/ambience'
import { SURFACE_LABELS, type Surface } from '../audio/steps'
import { soundOf } from '../audio/ZoneAudio'
import { readPrefs, writePrefs } from '../audio/prefs'
import { solidTerrainRects } from '../world/ground'
import { fenceSolids } from '../world/fences'

export interface EditorHooks {
  /** Pasta de assets (pros créditos). */
  assetBase: string
  /** Imagem de uma textura carregada no Phaser (pra desenhar miniaturas). */
  textureImage(key: string): CanvasImageSource
  startTest(): void
  stopTest(): void
  deleteSelected(): void
  centerOnZone(): void
  /** A cena do editor, quando está ativa (câmera, seleção, área de transferência). */
  scene(): EditorScene | null
  /** Abrir o criador de personagem (se quem montou o editor oferecer). */
  editCharacter?: () => void
  /** O volume mudou (o motor de som relê as preferências). */
  applySound?: () => void
  /** Curadoria (só no desenvolvimento): grava o ajuste de uma peça no pacote e recarrega o catálogo. */
  curate?: (pack: string, id: string, override: CurateOverride) => Promise<void>
}

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'brush', label: 'Pincel de terreno', key: 'B' },
  { id: 'fill', label: 'Balde (preencher área)', key: 'G' },
  { id: 'erase', label: 'Borracha (volta ao terreno base)', key: 'E' },
  { id: 'object', label: 'Colocar objeto', key: 'O' },
  { id: 'select', label: 'Selecionar / mover objeto', key: 'V' },
  { id: 'room', label: 'Cômodo: arraste um retângulo (piso, parede e moldura prontos)', key: 'C' },
  { id: 'light', label: 'Luz solta: clique pra pôr, arraste pra mover', key: 'L' },
  { id: 'portal', label: 'Saída para outra zona (porta, borda, escada)', key: 'X' },
  { id: 'spawn', label: 'Ponto de início do jogador', key: 'P' },
]

const BRUSH_MAX = 8
const FAV_KEY = 'vortable:objects:favorites'
const RECENT_KEY = 'vortable:objects:recent'
const RECENT_MAX = 24
/** Cores prontas das luzes soltas: [nome, cor, tremulação]. */
const LIGHT_COLORS: [string, string, number][] = [
  ['Fogo', '#ffa050', 0.3], ['Vela', '#ffd080', 0.15], ['Lampião', '#ffe0a0', 0.05], ['Luar', '#9fb8ff', 0],
  ['Magia', '#a07dff', 0.1], ['Veneno', '#7dff5a', 0.1], ['Sangue', '#ff4848', 0.2], ['Gelo', '#8ae8ff', 0],
]
const DAY_LENGTHS = [12, 24, 48, 96]

/** Seções especiais da lista de objetos. */
const FAV = '★', RECENT = '⟲'

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
  private tab: 'terrains' | 'objects' | 'rooms' | 'light' | 'sound' = 'terrains'
  /** Atualiza as barrinhas de nível do painel Sons. */
  private meterTimer = 0
  /** Camada escolhida no painel Sons (mostra a régua dela). */
  private soundPick: LayerId | null = null
  /** Qual luz solta o painel Luz está mostrando (só redesenha quando troca). */
  private shownLight: string | null = null
  private testClockEl!: HTMLElement
  private muteBtn!: HTMLButtonElement
  /** Seção aberta de cada lista (só uma por vez). */
  private openSection = { terrains: 'Grama', objects: 'Árvores' }
  private tabButtons = new Map<string, HTMLButtonElement>()
  private paneEl!: HTMLDivElement
  private zonePropsEl!: HTMLDivElement
  private portalEl!: HTMLDivElement
  private testZoneEl!: HTMLElement
  /** Qual saída o painel está mostrando (só redesenha quando troca). */
  private shownPortal: string | null = null
  private objectFilter = ''
  private terrainFilter = ''
  private objectEl!: HTMLDivElement
  /** O que o painel da peça está mostrando (só redesenha quando muda). */
  private shownObject = ''
  private catalogVersion = 0
  private favorites = readList(FAV_KEY)
  private recents = readList(RECENT_KEY)
  private terrainCells = new Map<string, HTMLElement>()
  private objectCells = new Map<string, HTMLElement>()
  private testing = false
  private modals: (() => void)[] = []
  private zoomLabel!: HTMLButtonElement
  private zoomSlider!: HTMLInputElement
  private offState: () => void
  private onKey = (e: KeyboardEvent) => this.handleKey(e)
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.state.dirty) e.preventDefault()
  }

  constructor(parent: HTMLElement, private state: EditorState, private storage: WorldStorage, private hooks: EditorHooks) {
    injectStyle('editor', css)
    this.stage = h('div', { class: 'vt-stage' }, this.buildZoomBar())
    this.root = h('div', { class: 'vt-root' },
      this.buildTop(),
      this.buildTools(),
      this.stage,
      this.buildPanel(),
      this.buildStatus(),
      h('div', { class: 'vt-testbar' },
        this.testZoneEl = h('b', { class: 'vt-testzone' }),
        this.testClockEl = h('span', { class: 'vt-testclock' }),
        this.muteBtn = h('button', { class: 'vt-btn vt-mutebtn', title: 'Som (M)', onclick: () => this.toggleMute() }),
        h('span', {}, h('kbd', {}, 'WASD'), ' anda, ', h('kbd', {}, 'Shift'), ' corre, ', h('kbd', {}, 'C'), ' colisões, ', h('kbd', {}, 'M'), ' som'),
        h('button', { class: 'vt-btn vt-primary', html: `${ICONS.stop}<span>Voltar ao editor</span>`, onclick: () => this.stopTest() }),
      ),
    )
    // a interface é posicionada por cima do container: ele precisa ser referência
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    parent.append(this.root)
    // botão clicado perde o foco: senão Espaço (arrastar a tela) "clica" nele de novo
    this.root.addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur())

    this.offState = state.on((c) => {
      if (c === 'view') return this.updateZoomBar()
      if (c === 'cursor') return this.refresh()
      if (c === 'zone') this.nameInput.value = state.zone.name
      if (c === 'zone' || c === 'edit') this.renderZoneProps()
      if (c === 'zone' || c === 'world' || state.selectedPortal !== this.shownPortal) this.renderPortal()
      // painel Luz: zona nova/desfeita (outra luz) ou outra luz selecionada
      if (this.tab === 'light' && (c === 'zone' || state.selectedLight !== this.shownLight)) this.renderPane()
      // desfazer/abrir zona: o painel Sons e o de cômodos mostram a zona nova
      if (this.tab === 'sound' && c === 'zone') this.renderPane()
      if (c === 'catalog') {
        this.catalogVersion++
        this.renderPane()
      }
      this.refresh()
    })
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('beforeunload', this.onBeforeUnload)
  }

  /** Chamado quando a arte terminou de carregar (as miniaturas dependem dela). */
  assetsReady() {
    this.updateZoomBar()
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

  /** Relógio do teste (hora da zona). */
  showTestClock(hour: number) {
    const day = daylight(hour) > 0.5
    this.testClockEl.innerHTML = `${day ? ICONS.sun : ICONS.moon}<span>${formatHour(hour)}</span>`
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
    toggle(ICONS.sun, 'Ver iluminação: hora, luzes e sombras (I)', () => this.state.lightPreview, () => this.state.set({ lightPreview: !this.state.lightPreview }))
    toggle(ICONS.sound, 'Ouvir os sons da zona no editor (U)', () => readPrefs().editor, () => this.toggleEditorSound())
    toggle(ICONS.snap, 'Encaixar objetos na grade (N)', () => this.state.snap, () => this.state.set({ snap: !this.state.snap }))
    el.append(h('button', { class: 'vt-tool', title: 'Centralizar a zona (Home)', html: ICONS.center, onclick: () => this.hooks.centerOnZone() }))
    return el
  }

  /** Controle de zoom no canto do palco: −, régua, porcentagem (volta a 100%), +, enquadrar. */
  private buildZoomBar() {
    const steps = 1000
    // régua em escala logarítmica: o meio é ~90%, cada pedaço "parece" igual
    const toSlider = (z: number) => String(Math.round((Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * steps))
    const fromSlider = (v: number) => ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v / steps)
    this.zoomSlider = h('input', {
      class: 'vt-zoom-range', type: 'range', min: 0, max: steps, value: toSlider(this.state.zoom),
      title: 'Zoom (roda do mouse, Ctrl + / Ctrl −)',
      oninput: () => this.hooks.scene()?.zoomTo(fromSlider(Number(this.zoomSlider.value))),
    }) as HTMLInputElement
    this.zoomSlider.dataset.toSlider = '1'
    this.zoomLabel = h('button', { class: 'vt-zoom-label', title: 'Voltar a 100% (Ctrl 1)', onclick: () => this.hooks.scene()?.zoomTo(1) }, '') as HTMLButtonElement
    this.toSlider = toSlider
    return h('div', { class: 'vt-zoombar' },
      h('button', { class: 'vt-btn', title: 'Menos zoom (Ctrl −)', onclick: () => this.hooks.scene()?.zoomBy(1 / 1.25) }, '−'),
      this.zoomSlider,
      h('button', { class: 'vt-btn', title: 'Mais zoom (Ctrl +)', onclick: () => this.hooks.scene()?.zoomBy(1.25) }, '+'),
      this.zoomLabel,
      h('button', { class: 'vt-btn', title: 'Enquadrar a zona (Ctrl 0)', html: ICONS.center, onclick: () => this.hooks.scene()?.fitZone() }),
    )
  }

  private toSlider: (z: number) => string = () => '0'

  private updateZoomBar() {
    if (!this.zoomLabel) return
    this.zoomLabel.textContent = `${Math.round(this.state.zoom * 100)}%`
    // não briga com quem está arrastando a régua
    if (document.activeElement !== this.zoomSlider) this.zoomSlider.value = this.toSlider(this.state.zoom)
  }

  private buildPanel() {
    const tabs = h('div', { class: 'vt-tabs' })
    for (const [id, label] of [['terrains', 'Terrenos'], ['objects', 'Objetos'], ['rooms', 'Cômodos'], ['light', 'Clima'], ['sound', 'Sons']] as const) {
      const b = h('button', {
        class: 'vt-tab',
        onclick: () => {
          this.tab = id
          if (id === 'rooms') this.state.set({ tool: 'room' })
          if (id === 'light') this.state.set({ tool: 'light' })
          // abrir o painel Sons liga a prévia de som no editor
          if (id === 'sound') {
            if (!readPrefs().editor) writePrefs({ editor: true })
            // sem ferramenta de mapa ativa: clicar no mapa não põe luz nem cômodo sem querer
            if (this.state.tool === 'light' || this.state.tool === 'room') this.state.set({ tool: 'select' })
          }
          this.renderPane()
          this.refresh()
        },
      }, label)
      this.tabButtons.set(id, b)
      tabs.append(b)
    }
    this.paneEl = h('div', { class: 'vt-pane' })
    this.zonePropsEl = h('div', { class: 'vt-zoneprops' })
    this.portalEl = h('div', { class: 'vt-zoneprops vt-portalprops' })
    this.objectEl = h('div', { class: 'vt-zoneprops vt-objinfo', hidden: true })
    return h('aside', { class: 'vt-panel' }, tabs, this.paneEl, this.objectEl, this.portalEl, this.zonePropsEl)
  }

  private buildStatus() {
    this.statusEl = h('footer', { class: 'vt-status' })
    return this.statusEl
  }

  // ── Painel: terrenos e objetos ─────────────────────────

  private renderPane() {
    clearInterval(this.meterTimer)
    this.paneEl.replaceChildren()
    this.terrainCells.clear()
    this.objectCells.clear()
    if (this.tab === 'terrains') this.renderTerrains()
    else if (this.tab === 'objects') this.renderObjects()
    else if (this.tab === 'light') this.renderLight()
    else if (this.tab === 'sound') this.renderSound()
    else this.renderRooms()
  }

  /**
   * Lista que abre e fecha: uma seção aberta por vez (clicar no título abre
   * e fecha as outras). Buscando, todas as seções com resultado ficam abertas.
   */
  private accordion(
    kind: 'terrains' | 'objects',
    sections: { id: string; title: string; count: number; icon?: string; content: () => Node[] }[],
    searching: boolean,
  ) {
    const list = h('div', { class: 'vt-acc-list' })
    if (!sections.length) list.append(h('div', { class: 'vt-empty' }, 'Nada encontrado.'))
    for (const sec of sections) {
      const open = searching || this.openSection[kind] === sec.id
      const head = h('button', {
        class: `vt-acc${open ? ' vt-open' : ''}`,
        'aria-expanded': open ? 'true' : 'false',
        onclick: () => {
          this.openSection[kind] = this.openSection[kind] === sec.id ? '' : sec.id
          const y = this.paneEl.scrollTop
          this.renderPane()
          this.refresh()
          // a seção clicada fica onde estava (não pula pro topo) e, aberta, aparece inteira se couber
          this.paneEl.scrollTop = y
          this.paneEl.querySelector('.vt-acc.vt-open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        },
      },
        h('span', { class: 'vt-acc-chev', html: ICONS.chevron }),
        sec.icon ? h('span', { class: 'vt-acc-icon', html: sec.icon }) : null,
        h('span', { class: 'vt-acc-title' }, sec.title),
        h('span', { class: 'vt-acc-count' }, String(sec.count)),
      )
      list.append(head)
      if (open) list.append(h('div', { class: 'vt-acc-body' }, ...sec.content()))
    }
    return list
  }

  private searchBox(value: string, placeholder: string, onInput: (v: string) => void) {
    const input = h('input', { class: 'vt-search', placeholder, value, type: 'search' }) as HTMLInputElement
    input.addEventListener('input', () => onInput(input.value))
    return h('div', { class: 'vt-searchwrap' }, h('span', { class: 'vt-search-icon', html: ICONS.search }), input)
  }

  private terrainCell(t: TerrainDef, onPick: () => void, on = false) {
    const c = h('canvas', { width: 32, height: 32 }) as HTMLCanvasElement
    const r = terrainThumb(t)
    c.getContext('2d')!.drawImage(this.hooks.textureImage(terrainTexture(t)), r.x, r.y, 32, 32, 0, 0, 32, 32)
    return h('button', {
      class: `vt-cell${on ? ' vt-on' : ''}`,
      title: t.label + (t.solid ? ' (não dá pra andar)' : '') + (isOverlay(t) ? ' (camada de cima: pinta por cima do chão)' : '') + (isFence(t) ? ' (cerca: pinta tiles e liga sozinha)' : ''),
      onclick: onPick,
    }, c, h('span', {}, t.label))
  }

  /** Terrenos agrupados nas seções da lista (paredes juntas, com subtítulos por família). */
  private terrainSections(list: TerrainDef[], pick: (t: TerrainDef) => void, cells: Map<string, HTMLElement> | null) {
    const groups = new Map<string, TerrainDef[]>()
    for (const t of list) {
      const sec = t.category.startsWith('Paredes:') ? 'Paredes' : t.category
      groups.set(sec, [...(groups.get(sec) ?? []), t])
    }
    const order = ['Grama', 'Terra', 'Areia e neve', 'Pedra', 'Água', 'Buracos', 'Fazenda', 'Interior', 'Pisos de madeira', 'Ladrilhos', 'Pisos de pedra', 'Tapetes', 'Paredes', 'Molduras de teto', 'Cercas']
    const ids = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b, 'pt'))
    return ids.map((id) => {
      const items = groups.get(id)!
      return {
        id,
        title: id,
        count: items.length,
        content: () => {
          // paredes: uma grade por família, com subtítulo
          const fams = new Map<string, TerrainDef[]>()
          for (const t of items) fams.set(t.category, [...(fams.get(t.category) ?? []), t])
          return [...fams].map(([fam, ts]) => {
            const grid = h('div', { class: 'vt-grid vt-terrains' })
            for (const t of ts) {
              const cell = this.terrainCell(t, () => pick(t))
              cells?.set(t.id, cell)
              grid.append(cell)
            }
            return fams.size > 1 ? h('div', { class: 'vt-subgroup' }, h('h5', {}, fam.replace('Paredes: ', '')), grid) : grid
          })
        },
      }
    })
  }

  private renderTerrains() {
    const q = fold(this.terrainFilter.trim())
    const list = TERRAINS.filter((t) => !q || fold(`${t.label} ${t.category}`).includes(q))
    const box = this.searchBox(this.terrainFilter, `Buscar entre ${TERRAINS.length} terrenos`, (v) => {
      this.terrainFilter = v
      this.renderPane()
      this.refresh()
      const input = this.paneEl.querySelector('input')!
      input.focus()
      input.setSelectionRange(v.length, v.length)
    })
    const sections = this.terrainSections(list, (t) => this.state.set({ terrain: t.id, tool: this.state.tool === 'fill' ? 'fill' : 'brush' }), this.terrainCells)
    this.paneEl.append(box, this.accordion('terrains', sections, !!q))
  }

  private objectCell(o: ObjectDef) {
    const n = variantsOf(o).length
    const cell = h('button', {
      class: 'vt-cell',
      title: `${o.label} — ${KIND_LABELS[o.kind]}, ${o.w}×${o.h}px${o.solids.length ? '' : ', atravessável'}${n > 1 ? `, ${n} variantes` : ''}${o.anim ? ', animado' : ''}`,
      onclick: () => this.pick(o.id),
    }, this.thumb(o, 64), n > 1 ? h('i', { class: 'vt-badge' }, `${n}`) : null, o.anim ? h('i', { class: 'vt-badge vt-badge-anim' }, '▶') : null)
    this.objectCells.set(o.id, cell)
    return cell
  }

  private renderObjects() {
    const objects = paletteObjects()
    const q = fold(this.objectFilter.trim())
    const match = (o: ObjectDef) => !q || fold(searchText(o)).includes(q)
    const box = this.searchBox(this.objectFilter, `Buscar entre ${objects.length} peças (nome, tag, tipo)`, (v) => {
      this.objectFilter = v
      this.renderPane()
      this.refresh()
      const input = this.paneEl.querySelector('input')!
      input.focus()
      input.setSelectionRange(v.length, v.length)
    })
    const ids = (list: string[]) => list.map((id) => objectDef(id)).filter((d): d is ObjectDef => !!d).filter(match)
    const grid = (list: ObjectDef[], empty: string) => {
      const g = h('div', { class: 'vt-grid vt-objects' })
      if (!list.length) g.append(h('div', { class: 'vt-empty', style: 'grid-column: 1 / -1' }, empty))
      for (const o of list) g.append(this.objectCell(o))
      return [g]
    }
    const byCat = new Map<string, ObjectDef[]>()
    for (const o of objects) if (match(o)) byCat.set(o.category, [...(byCat.get(o.category) ?? []), o])
    const order = ['Árvores', 'Arbustos', 'Flores', 'Plantas', 'Plantas aquáticas', 'Cogumelos', 'Troncos e galhos', 'Pedras',
      'Plantações', 'Fazenda', 'Comida', 'Vila', 'Feira', 'Ferramentas', 'Acampamento', 'Cemitério', 'Estátuas e fontes',
      'Móveis', 'Móveis estofados', 'Casa e cozinha', 'Portas e janelas', 'Luzes', 'Masmorra']
    const cats = [...byCat.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b, 'pt'))
    const fav = ids(this.favorites), rec = ids(this.recents)
    const sections = [
      ...(!q || fav.length ? [{ id: FAV, title: 'Favoritos', icon: ICONS.star, count: fav.length, content: () => grid(fav, 'Nenhum favorito ainda. Escolha uma peça e clique na estrela.') }] : []),
      ...(!q || rec.length ? [{ id: RECENT, title: 'Recentes', icon: ICONS.clock, count: rec.length, content: () => grid(rec, 'As peças que você usar aparecem aqui.') }] : []),
      ...cats.map((c) => ({ id: c, title: c, count: byCat.get(c)!.length, content: () => grid(byCat.get(c)!, '') })),
    ]
    this.paneEl.append(box, this.accordion('objects', sections, !!q))
  }

  // ── Painel: cômodos ────────────────────────────────────

  /** Miniatura pequena de um terreno (estilo de cômodo). */
  private swatch(id: string) {
    const c = h('canvas', { class: 'vt-swatch', width: 32, height: 32 }) as HTMLCanvasElement
    const t = terrainById.get(id)
    if (t) {
      const r = terrainThumb(t)
      c.getContext('2d')!.drawImage(this.hooks.textureImage(terrainTexture(t)), r.x, r.y, 32, 32, 0, 0, 32, 32)
    }
    return c
  }

  private renderRooms() {
    const s = this.state
    const style = s.roomStyle
    const setStyle = (patch: Partial<RoomStyle>) => {
      s.set({ roomStyle: { ...s.roomStyle, ...patch }, tool: 'room' })
      this.renderPane()
    }
    const current = encodeRoom(style)
    const presets = h('div', { class: 'vt-presets' }, ...ROOM_PRESETS.map((p) => h('button', {
      class: `vt-preset${encodeRoom(p.style) === current ? ' vt-on' : ''}`,
      onclick: () => setStyle(p.style),
    }, h('span', { class: 'vt-preset-sw' }, this.swatch(p.style.wall), this.swatch(p.style.floor), this.swatch(p.style.trim)), h('span', {}, p.name))))

    const part = (label: string, id: string, which: 'floor' | 'wall' | 'trim') => h('button', {
      class: 'vt-stylepart',
      title: `Trocar ${label.toLowerCase()}`,
      onclick: () => this.openTerrainPicker(which, (t) => setStyle({ [which]: t.id } as Partial<RoomStyle>)),
    }, this.swatch(id), h('span', {}, h('b', {}, label), h('small', {}, terrainById.get(id)?.label ?? '(não encontrado)')), h('span', { class: 'vt-stylepart-chev', html: ICONS.chevron }))

    const height = h('input', { type: 'range', min: 0, max: ROOM_HEIGHT_MAX, step: 1, value: style.height, class: 'vt-range' }) as HTMLInputElement
    const heightOut = h('b', {}, String(style.height))
    height.addEventListener('input', () => { heightOut.textContent = height.value })
    height.addEventListener('change', () => setStyle({ height: Number(height.value) }))

    const modes = h('div', { class: 'vt-segmented' }, ...([
      ['room', 'Cômodo', 'Arraste um retângulo: piso, parede e moldura prontos'],
      ['wall', 'Parede', 'Risque uma linha pra dividir um cômodo em dois'],
      ['door', 'Porta', 'Arraste sobre uma parede entre cômodos pra abrir um vão'],
    ] as const).map(([id, label, title]) => h('button', {
      class: `vt-seg${s.roomMode === id ? ' vt-on' : ''}`,
      title,
      onclick: () => { s.set({ roomMode: id, tool: 'room' }); this.renderPane() },
    }, label)))
    const modeHelp = {
      room: 'Arraste no mapa pra criar.',
      wall: 'Risque uma linha pra dividir.',
      door: 'Arraste sobre uma parede pra abrir.',
    }[s.roomMode]

    this.paneEl.append(
      h('div', { class: 'vt-group' }, modes, h('small', { class: 'vt-note vt-modehelp' }, modeHelp)),
      h('div', { class: 'vt-group' }, h('h4', {}, 'Estilos prontos'), presets),
      h('div', { class: 'vt-group' }, h('h4', {}, 'Estilo do cômodo'),
        h('div', { class: 'vt-styleparts' }, part('Parede', style.wall, 'wall'), part('Piso', style.floor, 'floor'), part('Moldura', style.trim, 'trim')),
        h('div', { class: 'vt-row vt-heightrow' }, h('label', {}, 'Altura da parede'), height, heightOut),
      ),
      h('small', { class: 'vt-note' }, 'Alt + clique copia um estilo; Ctrl + arrastar apaga.'),
    )
  }

  // ── Painel: luz ────────────────────────────────────

  /**
   * Clima da zona (presets, lugar, hora fixa ou ciclo) e as luzes soltas:
   * a selecionada é editada no lugar; sem seleção, o painel ajusta como
   * sai a próxima.
   */
  private renderLight() {
    const s = this.state
    const z = s.zone
    const cur = lightingOf(z)
    this.shownLight = s.selectedLight
    const setLighting = (patch: Partial<ZoneLighting>) => {
      s.checkpoint()
      z.lighting = { ...lightingOf(z), ...patch }
      for (const k of Object.keys(z.lighting) as (keyof ZoneLighting)[]) if (z.lighting[k] === undefined) delete z.lighting[k]
      s.edited()
      this.renderPane()
    }

    // presets: a amostra é a cor do céu (dois tons no ciclo: dia e noite)
    const sky = (l: ZoneLighting) => {
      const css = (hour: number) => `#${rgbToInt(ambientAt(l, hour)).toString(16).padStart(6, '0')}`
      return l.hour === null && l.place !== 'underground' ? `linear-gradient(135deg, ${css(12)} 0 50%, ${css(23)} 50% 100%)` : css(l.hour ?? 12)
    }
    const same = (a: ZoneLighting, b: ZoneLighting) =>
      a.place === b.place && a.hour === b.hour && (a.place !== 'underground' || (a.tint ?? UNDERGROUND_TINT) === (b.tint ?? UNDERGROUND_TINT))
    const presets = h('div', { class: 'vt-climates' }, ...LIGHT_PRESETS.map((p) => h('button', {
      class: `vt-climate${same(cur, p.lighting) ? ' vt-on' : ''}`,
      onclick: () => setLighting({ ...p.lighting, tint: p.lighting.tint }),
    }, h('span', { class: 'vt-climate-sw', style: `background:${sky(p.lighting)}` }), h('span', {}, p.label))))

    const seg = <T extends string>(items: [T, string, string][], on: T, pick: (v: T) => void) =>
      h('div', { class: 'vt-segmented' }, ...items.map(([id, label, title]) => h('button', {
        class: `vt-seg${on === id ? ' vt-on' : ''}`, title, onclick: () => on !== id && pick(id),
      }, label)))
    const place = seg([
      ['outdoor', 'Ar livre', 'Céu muda com a hora; o sol faz sombra'],
      ['indoor', 'Interior', 'Mais escuro; de dia entra sol pelas janelas'],
      ['underground', 'Subterrâneo', 'Nunca vê o sol: só as luzes clareiam'],
    ], cur.place, (v) => setLighting({ place: v }))

    // hora: slider que mexe ao vivo e vira UM passo de desfazer ao soltar
    const hourSlider = (value: number, onLive: (h: number) => void, onDone?: () => void) => {
      const out = h('b', { class: 'vt-hourout' })
      const show = (hr: number) => { out.innerHTML = `${daylight(hr) > 0.5 ? ICONS.sun : ICONS.moon}<span>${formatHour(hr)}</span>` }
      const input = h('input', { type: 'range', min: 0, max: 23.9, step: 0.1, value, class: 'vt-range' }) as HTMLInputElement
      input.addEventListener('input', () => { show(Number(input.value)); onLive(Number(input.value)) })
      if (onDone) input.addEventListener('change', onDone)
      show(value)
      return h('div', { class: 'vt-row vt-hourrow' }, input, out)
    }

    const timeBlock: Node[] = []
    if (cur.place === 'underground') {
      const tint = h('input', { type: 'color', value: cur.tint ?? UNDERGROUND_TINT, class: 'vt-color' }) as HTMLInputElement
      let saved = false
      tint.addEventListener('input', () => {
        if (!saved) { s.checkpoint(); saved = true }
        z.lighting = { ...lightingOf(z), tint: tint.value }
        s.edited()
      })
      tint.addEventListener('change', () => { saved = false; this.renderPane() })
      timeBlock.push(
        h('div', { class: 'vt-row' }, h('label', {}, 'Cor do escuro'), tint),
        h('small', { class: 'vt-note' }, 'Sem sol: só tochas e velas clareiam.'),
      )
    } else {
      timeBlock.push(seg([
        ['cycle', 'Ciclo dia/noite', 'A hora corre sozinha (o mesmo relógio pra todo o mundo)'],
        ['fixed', 'Hora fixa', 'Sempre a mesma hora (a taverna é sempre noite)'],
      ], cur.hour === null ? 'cycle' : 'fixed', (v) => setLighting({ hour: v === 'cycle' ? null : s.previewHour })))
      if (cur.hour === null) {
        const len = h('select', { class: 'vt-select' }, ...DAY_LENGTHS.map((m) => h('option', { value: m, selected: (cur.dayMinutes ?? DAY_MINUTES) === m }, `${m} min`))) as HTMLSelectElement
        len.addEventListener('change', () => setLighting({ dayMinutes: Number(len.value) === DAY_MINUTES ? undefined : Number(len.value) }))
        timeBlock.push(
          h('div', { class: 'vt-row' }, h('label', {}, 'Um dia dura'), len),
          h('label', { class: 'vt-sublabel' }, 'Ver no editor às'),
          hourSlider(s.previewHour, (hr) => s.set({ previewHour: hr })),
        )
      } else {
        let saved = false
        timeBlock.push(hourSlider(cur.hour, (hr) => {
          if (!saved) { s.checkpoint(); saved = true }
          z.lighting = { ...lightingOf(z), hour: hr }
          s.previewHour = hr
          s.edited()
        }, () => { saved = false; this.renderPane() }))
      }
    }

    const check = (label: string, on: boolean, flip: (v: boolean) => void, title = '') => {
      const box = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement
      box.addEventListener('change', () => flip(box.checked))
      return h('label', { class: 'vt-check', title }, box, h('span', {}, label))
    }
    const extras = h('div', { class: 'vt-checks' },
      cur.place === 'outdoor' ? check('Sombras do sol', cur.sunShadows !== false, (v) => setLighting({ sunShadows: v ? undefined : false }), 'Árvores e bonecos fazem sombra; o tamanho e a direção mudam com a hora') : null,
      cur.place === 'outdoor' ? check('Sombra de nuvens', cur.clouds !== false, (v) => setLighting({ clouds: v ? undefined : false }), 'Manchas de sombra passando pelo chão, levadas pelo vento') : null,
      check('Partículas', cur.particles !== false, (v) => setLighting({ particles: v ? undefined : false }), 'Folhas caindo, chamas, faíscas e fumaça, vaga-lumes, poeira, reflexos na água'),
    )

    // tempo: chuva, neve, neblina... (subterrâneo não tem céu)
    const weatherId = cur.weather && cur.weather in WEATHERS ? cur.weather : 'clear'
    const weathers = h('div', { class: 'vt-weathers' }, ...WEATHER_ORDER.map((id) => h('button', {
      class: `vt-weather${weatherId === id ? ' vt-on' : ''}`, title: WEATHERS[id].label,
      onclick: () => weatherId !== id && setLighting({ weather: id === 'clear' ? undefined : id }),
    }, h('span', { html: id === 'clear' ? ICONS.sun : id === 'cloudy' ? ICONS.cloud : ICONS[id] }), h('span', {}, WEATHERS[id].label))))
    const weatherNote = cur.place === 'indoor'
      ? 'Dentro, o tempo só aparece nas janelas.'
      : ''

    // vento: o mais próximo dos três níveis fica marcado
    const wind = cur.wind ?? DEFAULT_WIND
    const near = WIND_LEVELS.reduce((a, b) => (Math.abs(b[0] - wind) < Math.abs(a[0] - wind) ? b : a))[0]
    const windSeg = h('div', { class: 'vt-segmented' }, ...WIND_LEVELS.map(([value, label, title]) => h('button', {
      class: `vt-seg${near === value ? ' vt-on' : ''}`, title,
      onclick: () => near !== value && setLighting({ wind: value === DEFAULT_WIND ? undefined : value }),
    }, label)))

    this.paneEl.append(
      h('div', { class: 'vt-group' }, h('h4', {}, 'Ambientes prontos'), presets),
      h('div', { class: 'vt-group' }, h('h4', {}, 'Onde fica'), place),
      ...(cur.place !== 'underground'
        ? [h('div', { class: 'vt-group' }, h('h4', {}, 'Tempo'), weathers, weatherNote ? h('small', { class: 'vt-note vt-modehelp' }, weatherNote) : null)]
        : []),
      ...(cur.place === 'outdoor'
        ? [h('div', { class: 'vt-group' }, h('h4', {}, 'Vento'), windSeg)]
        : []),
      h('div', { class: 'vt-group' }, h('h4', {}, cur.place === 'underground' ? 'Escuridão' : 'Hora'), ...timeBlock),
      h('div', { class: 'vt-group' }, extras),
      this.lightLookGroup(),
      ...(s.lightPreview ? [] : [h('small', { class: 'vt-note' }, 'Prévia desligada (I).')]),
    )
  }

  /** Cor, alcance, força e tremulação: da luz selecionada, ou de como sai a próxima. */
  private lightLookGroup() {
    const s = this.state
    const sel = s.light
    const look: LightLook = sel ?? s.lightLook
    const objLights = s.zone.objects.filter((o) => objectDef(o.kind)?.light).length
    const total = s.zone.lights?.length ?? 0
    let saved = false
    const apply = (patch: Partial<LightLook>, live = false) => {
      if (sel) {
        if (!saved) { s.checkpoint(); saved = true }
        Object.assign(sel, patch)
        s.edited()
      }
      // a próxima luz sai igual à última ajustada
      s.lightLook = { radius: look.radius, color: look.color, intensity: look.intensity, flicker: look.flicker, ...patch }
      if (!live) { saved = false; this.renderPane() }
    }
    const slider = (label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, key: keyof LightLook, scale = 1) => {
      const out = h('b', {}, fmt(value))
      const input = h('input', { type: 'range', min, max, step, value: value * scale, class: 'vt-range' }) as HTMLInputElement
      input.addEventListener('input', () => { out.textContent = fmt(Number(input.value) / scale); apply({ [key]: Number(input.value) / scale }, true) })
      input.addEventListener('change', () => apply({ [key]: Number(input.value) / scale }))
      return h('div', { class: 'vt-row vt-lightrow' }, h('label', {}, label), input, out)
    }
    const color = h('input', { type: 'color', value: look.color, class: 'vt-color', title: 'Outra cor' }) as HTMLInputElement
    color.addEventListener('input', () => apply({ color: color.value }, true))
    color.addEventListener('change', () => apply({ color: color.value }))
    const swatches = h('div', { class: 'vt-lightcolors' },
      ...LIGHT_COLORS.map(([name, c, flicker]) => h('button', {
        class: `vt-lightcolor${look.color.toLowerCase() === c ? ' vt-on' : ''}`, title: name, style: `--c:${c}`,
        onclick: () => apply({ color: c, flicker }),
      })),
      color,
    )
    return h('div', { class: 'vt-group' },
      h('h4', {}, sel ? 'Luz selecionada' : 'Luzes soltas', h('span', { class: 'vt-acc-count' }, ` ${total} solta${total === 1 ? '' : 's'} · ${objLights} em objetos`)),
      h('small', { class: 'vt-note vt-modehelp' }, sel
        ? 'Arraste pra mover; Del apaga.'
        : 'Clique no mapa pra pôr uma luz (L).'),
      swatches,
      slider('Alcance', LIGHT_RADIUS_MIN, LIGHT_RADIUS_MAX, 8, look.radius, (v) => `${(v / TILE).toFixed(1).replace('.0', '')} tiles`, 'radius'),
      slider('Força', 0, 100, 5, look.intensity, (v) => `${Math.round(v * 100)}%`, 'intensity', 100),
      slider('Tremor', 0, 100, 5, look.flicker, (v) => (v === 0 ? 'parada' : `${Math.round(v * 100)}%`), 'flicker', 100),
      sel ? h('div', { class: 'vt-row' },
        h('button', { class: 'vt-btn', style: 'flex:1', onclick: () => s.set({ selectedLight: null }) }, 'Soltar seleção'),
        h('button', { class: 'vt-btn vt-danger', title: 'Apagar luz (Del)', html: ICONS.trash, onclick: () => this.hooks.deleteSelected() }),
      ) : null,
    )
  }

  // ── Painel: sons ───────────────────────────────────

  private toggleEditorSound() {
    writePrefs({ editor: !readPrefs().editor })
    if (this.tab === 'sound') this.renderPane()
    this.refresh()
  }

  private toggleMute() {
    writePrefs({ muted: !readPrefs().muted })
    this.applySound()
  }

  /** Volume novo vale na hora (o motor lê as preferências). */
  private applySound() {
    this.hooks.applySound?.()
    const muted = readPrefs().muted
    this.muteBtn.innerHTML = muted ? ICONS.mute : ICONS.sound
    this.muteBtn.classList.toggle('vt-on', !muted)
  }

  /** Interruptor (liga/desliga) no estilo do editor. */
  private switchEl(on: boolean, flip: (v: boolean) => void, title = '') {
    const box = h('input', { type: 'checkbox', checked: on, class: 'vt-switch', title }) as HTMLInputElement
    box.addEventListener('change', () => flip(box.checked))
    return box
  }

  /**
   * Sons: camadas em cartões (clique liga/desliga; o escolhido mostra o
   * volume), automático, passos e o volume de quem joga.
   */
  private renderSound() {
    const s = this.state
    const z = s.zone
    const cur = soundOf(z)
    const prefs = readPrefs()
    let saved = false
    const setLayers = (layers: Record<string, number>, live = false) => {
      if (!saved) { s.checkpoint(); saved = true }
      const next = { ...soundOf(z), layers: { ...soundOf(z).layers, ...layers } }
      for (const k of Object.keys(next.layers)) if (!next.layers[k]) delete next.layers[k]
      if (!Object.keys(next.layers).length) delete (next as { layers?: unknown }).layers
      if (Object.keys(next).length) z.sound = next
      else delete z.sound
      s.edited()
      if (!live) { saved = false; this.renderPane() }
    }
    const setAuto = (on: boolean) => {
      s.checkpoint()
      const next = { ...soundOf(z) }
      if (on) delete next.auto
      else next.auto = false
      if (Object.keys(next).length) z.sound = next
      else delete z.sound
      s.edited()
      this.renderPane()
    }
    const range = (value: number, onLive: (v: number) => void, onDone: (v: number) => void, title = '') => {
      const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(value * 100), class: 'vt-range', title }) as HTMLInputElement
      input.addEventListener('input', () => onLive(Number(input.value) / 100))
      input.addEventListener('change', () => onDone(Number(input.value) / 100))
      return input
    }

    // ── ouvir: interruptor, volume e mudo ──
    const hear = h('div', { class: 'vt-soundbar' },
      h('label', { class: 'vt-switchrow', title: 'Tocar os sons enquanto edita (U)' }, this.switchEl(prefs.editor, () => this.toggleEditorSound()), h('span', {}, 'Ouvir')),
      range(prefs.master, (v) => { writePrefs({ master: v }); this.applySound() }, () => this.applySound(), 'Volume geral'),
      h('button', { class: `vt-iconbtn${prefs.muted ? ' vt-on' : ''}`, title: prefs.muted ? 'Ligar o som' : 'Mudo', html: prefs.muted ? ICONS.mute : ICONS.sound, onclick: () => { this.toggleMute(); this.renderPane() } }),
    )

    // ── camadas ──
    const manual = cur.layers ?? {}
    const pick = this.soundPick && LAYERS.some((l) => l.id === this.soundPick) ? this.soundPick : null
    const meters = new Map<LayerId, HTMLElement>()
    const tiles = LAYERS.map((l) => {
      const on = (manual[l.id] ?? 0) > 0
      const meter = h('span', { class: 'vt-soundtile-meter' })
      meters.set(l.id, meter)
      return h('button', {
        class: `vt-soundtile${on ? ' vt-on' : ''}${pick === l.id ? ' vt-picked' : ''}`,
        title: l.label,
        onclick: () => {
          this.soundPick = l.id
          if (!readPrefs().editor) writePrefs({ editor: true })
          // clique no escolhido liga/desliga; em outro, só escolhe (e liga se estava desligado)
          if (pick === l.id || !on) setLayers({ [l.id]: on ? 0 : 0.7 })
          else this.renderPane()
        },
      }, h('span', { class: 'vt-soundtile-icon', html: ICONS[l.icon as keyof typeof ICONS] ?? ICONS.sound }), h('span', {}, l.label), meter)
    })
    const tick = () => {
      const levels = this.hooks.scene()?.audio?.levels() ?? {}
      for (const [id, el] of meters) el.style.width = `${Math.round(Math.min(1, levels[id] ?? 0) * 100)}%`
    }
    tick()
    this.meterTimer = window.setInterval(tick, 200)

    let picked: Node | null = null
    if (pick) {
      const layer = LAYERS.find((l) => l.id === pick)!
      const value = manual[pick] ?? 0
      const out = h('b', {}, value ? `${Math.round(value * 100)}%` : 'auto')
      picked = h('div', { class: 'vt-soundpick' },
        h('span', { class: 'vt-soundtile-icon', html: ICONS[layer.icon as keyof typeof ICONS] ?? ICONS.sound }),
        h('label', {}, layer.label),
        range(value,
          (v) => { out.textContent = v ? `${Math.round(v * 100)}%` : 'auto'; setLayers({ [pick]: v }, true) },
          (v) => setLayers({ [pick]: v })),
        out,
        pick === 'thunder' ? h('button', { class: 'vt-iconbtn', title: 'Ouvir um trovão', html: ICONS.play, onclick: () => this.hooks.scene()?.audio?.thunderNow() }) : null,
      )
    }

    const steps = (Object.keys(SURFACE_LABELS) as Surface[]).map((surface) => h('button', {
      class: 'vt-chipbtn', title: 'Ouvir',
      onclick: () => this.hooks.scene()?.audio?.previewStep(surface),
    }, SURFACE_LABELS[surface]))

    this.paneEl.append(
      h('div', { class: 'vt-group' }, hear),
      h('div', { class: 'vt-group' },
        h('div', { class: 'vt-grouphead' }, h('h4', {}, 'Ambiente'),
          h('label', { class: 'vt-switchrow', title: 'Segue o tempo, a hora e o que há perto' }, h('span', {}, 'Automático'), this.switchEl(cur.auto !== false, setAuto))),
        h('div', { class: 'vt-soundtiles' }, ...tiles),
        picked ?? h('small', { class: 'vt-note' }, 'Clique numa camada pra ligar e ajustar.'),
      ),
      h('div', { class: 'vt-group' },
        h('div', { class: 'vt-grouphead' }, h('h4', {}, 'Passos'),
          range(prefs.steps, (v) => writePrefs({ steps: v }), () => undefined, 'Volume dos passos')),
        h('div', { class: 'vt-chips' }, ...steps),
      ),
    )
  }

  /** Janela pra escolher o piso, a parede ou a moldura de um cômodo. */
  private openTerrainPicker(which: 'floor' | 'wall' | 'trim', pick: (t: TerrainDef) => void) {
    const floorCats = ['Interior', 'Pisos de madeira', 'Ladrilhos', 'Pisos de pedra', 'Terra', 'Pedra', 'Grama', 'Areia e neve']
    const list = TERRAINS.filter((t) =>
      which === 'wall' ? t.category.startsWith('Paredes:')
        : which === 'trim' ? t.category === 'Molduras de teto'
          : floorCats.includes(t.category) && !t.solid && !isOverlay(t))
    const title = { floor: 'Escolher o piso', wall: 'Escolher a parede', trim: 'Escolher a moldura' }[which]
    const body = h('div', { class: 'vt-picker' })
    let open = ''
    const render = () => {
      const sections = this.terrainSections(list, (t) => { close(); pick(t) }, null)
      // seções que abrem e fecham dentro da janela (estado local)
      const acc = h('div', { class: 'vt-acc-list' })
      for (const sec of sections) {
        const isOpen = sections.length === 1 || open === sec.id || (!open && sec === sections[0])
        acc.append(h('button', { class: `vt-acc${isOpen ? ' vt-open' : ''}`, onclick: () => { open = isOpen ? '-' : sec.id; render() } },
          h('span', { class: 'vt-acc-chev', html: ICONS.chevron }), h('span', { class: 'vt-acc-title' }, sec.title), h('span', { class: 'vt-acc-count' }, String(sec.count))))
        if (isOpen) acc.append(h('div', { class: 'vt-acc-body' }, ...sec.content()))
      }
      body.replaceChildren(acc)
    }
    const close = this.modal(title, [body], [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')], undefined, true)
    render()
  }

  /** Miniatura de uma peça, encostada embaixo (como fica no chão). */
  private thumb(o: ObjectDef, size: number, maxScale = 2) {
    const c = h('canvas', { width: size, height: size }) as HTMLCanvasElement
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const k = Math.min(size / o.w, size / o.h, maxScale)
    const w = o.w * k, hh = o.h * k
    ctx.drawImage(this.hooks.textureImage(sheetTexture(o.sheet)), o.x, o.y, o.w, o.h, (size - w) / 2, size - hh, w, hh)
    return c
  }

  /** Peça base do grupo de variantes (é ela que aparece na paleta e que se cura). */
  private primary(def: ObjectDef) {
    return (def.group && objectDef(def.group)) || def
  }

  /** Escolhe a peça pra carimbar (e lembra nos recentes). */
  private pick(id: string) {
    const def = objectDef(id)
    if (!def) return
    const base = this.primary(def).id
    this.recents = [base, ...this.recents.filter((r) => r !== base)].slice(0, RECENT_MAX)
    writeList(RECENT_KEY, this.recents)
    this.state.set({ objectKind: id, tool: 'object' })
  }

  private toggleFavorite(def: ObjectDef) {
    const id = this.primary(def).id
    this.favorites = this.favorites.includes(id) ? this.favorites.filter((f) => f !== id) : [id, ...this.favorites]
    writeList(FAV_KEY, this.favorites)
    if (this.tab === 'objects') {
      const y = this.paneEl.scrollTop
      this.renderPane()
      this.paneEl.scrollTop = y
    }
    this.refresh()
  }

  /** Espelha os selecionados (ou o que vai ser carimbado). */
  private flip() {
    this.hooks.scene()?.flipSelected()
  }

  // ── Painel: peça escolhida / objeto selecionado ────────

  private renderObjectInfo() {
    const s = this.state
    let def: ObjectDef | undefined
    let placed: ZoneObject | null = null
    if (s.tool === 'select' && s.selected.length > 1) return this.renderMultiInfo()
    if (s.tool === 'select' && s.single) {
      placed = s.single
      def = objectDef(placed.kind)
    } else if (s.tool === 'object' && s.objectKind) {
      def = objectDef(s.objectKind)
    }
    const flipped = placed ? !!placed.flip : s.flip
    const fav = !!def && this.favorites.includes(this.primary(def).id)
    const key = def ? [def.id, flipped, !!placed, placed?.z ?? 0, fav, this.catalogVersion].join('|') : ''
    if (key === this.shownObject) return
    this.shownObject = key
    this.objectEl.hidden = !def
    if (!def) {
      this.objectEl.replaceChildren()
      return
    }
    const d = def
    const pack = objectCatalog().packs.find((p) => p.id === d.pack)
    const variants = variantsOf(d)
    const choose = (v: ObjectDef) => {
      if (!placed) return this.pick(v.id)
      if (placed.kind === v.id) return
      s.checkpoint()
      placed.kind = v.id
      s.edited()
      s.emit('objects')
    }
    this.objectEl.replaceChildren(
      h('h4', { class: 'vt-subtitle' }, placed ? 'Objeto selecionado' : 'Peça pra colocar'),
      h('div', { class: 'vt-objhead' },
        this.thumb(d, 56),
        h('div', {},
          h('b', {}, d.label),
          h('small', {}, `${KIND_LABELS[d.kind]} · ${d.w}×${d.h}px${d.solids.length ? '' : ' · atravessável'}${d.light ? ' · ilumina' : ''}`),
          h('small', { title: pack?.license ?? '' }, pack?.name ?? d.pack),
        ),
      ),
      h('div', { class: 'vt-variants', hidden: variants.length < 2 },
        ...variants.map((v) => h('button', {
          class: `vt-cell${v.id === d.id ? ' vt-on' : ''}`,
          title: v.variant ?? v.label,
          onclick: () => choose(v),
        }, this.thumb(v, 36))),
      ),
      ...(placed ? [h('div', { class: 'vt-row vt-objheight', title: 'Altura (em cima de mesa, balcão, prateleira). O ponto no chão decide quem fica na frente.' },
        h('label', {}, 'Altura'),
        h('button', { class: 'vt-btn', title: 'Baixar (Shift: 16px)', onclick: (e: MouseEvent) => this.lift(placed, e.shiftKey ? -16 : -4) }, '▼'),
        h('b', {}, `${placed.z ?? 0}px`),
        h('button', { class: 'vt-btn', title: 'Elevar (Shift: 16px)', onclick: (e: MouseEvent) => this.lift(placed, e.shiftKey ? 16 : 4) }, '▲'),
      )] : []),
      h('div', { class: 'vt-row vt-objactions' },
        h('button', { class: `vt-btn${fav ? ' vt-on' : ''}`, title: fav ? 'Tirar dos favoritos' : 'Favoritar', html: `${ICONS.star}<span>${fav ? 'Favorito' : 'Favoritar'}</span>`, onclick: () => this.toggleFavorite(d) }),
        h('button', { class: `vt-btn${flipped ? ' vt-on' : ''}`, title: 'Espelhar (F)', onclick: () => this.flip() }, 'Espelhar'),
        this.hooks.curate ? h('button', { class: 'vt-btn', title: 'Ajustar nome, colisão, tipo e luz da peça no pacote (desenvolvimento)', onclick: () => this.openCurate(d) }, 'Curar') : null,
        placed ? h('button', { class: 'vt-btn vt-danger', title: 'Apagar (Del)', html: ICONS.trash, onclick: () => this.hooks.deleteSelected() }) : null,
      ),
    )
  }

  /** Vários objetos selecionados: quantos, e o que dá pra fazer com todos. */
  private renderMultiInfo() {
    const n = this.state.selected.length
    const key = `multi|${n}|${this.state.selected.join(',')}`
    if (key === this.shownObject) return
    this.shownObject = key
    this.objectEl.hidden = false
    const btn = (label: string, title: string, fn: () => void, extra = '') => h('button', { class: `vt-btn ${extra}`, title, onclick: fn }, label)
    this.objectEl.replaceChildren(
      h('h4', { class: 'vt-subtitle' }, `${n} objetos selecionados`),
      h('div', { class: 'vt-row vt-objactions' },
        btn('Espelhar', 'Espelhar todos (F)', () => this.flip()),
        btn('Variante', 'Próxima variante de cada um (.)', () => this.hooks.scene()?.cycleVariant(1)),
        btn('Duplicar', 'Duplicar (Ctrl D)', () => this.hooks.scene()?.duplicate()),
        h('button', { class: 'vt-btn vt-danger', title: 'Apagar todos (Del)', html: ICONS.trash, onclick: () => this.hooks.deleteSelected() }),
      ),
      h('small', { class: 'vt-note' }, 'Arraste um deles pra mover o grupo · setas empurram 1px (Shift: 8px)'),
    )
  }

  /** Sobe/desce um objeto colocado (em cima de mesa etc.). */
  private lift(o: ZoneObject, dz: number) {
    const z = Math.max(0, Math.min(Z_MAX, (o.z ?? 0) + dz))
    if (z === (o.z ?? 0)) return
    const s = this.state
    s.checkpoint()
    if (z) o.z = z
    else delete o.z
    s.edited()
    s.emit('objects')
  }

  private openCurate(def: ObjectDef) {
    const base = this.primary(def)
    const cats = [...new Set(objectCatalog().objects.map((o) => o.category))].sort((a, b) => a.localeCompare(b, 'pt'))
    const form = curateForm(base, this.hooks.textureImage(sheetTexture(base.sheet)), cats)
    const save = h('button', {
      class: 'vt-btn vt-primary',
      onclick: async () => {
        save.disabled = true
        try {
          await this.hooks.curate!(base.pack, base.id, form.value())
          close()
          this.toast('Peça atualizada no pacote.')
        } catch (err) {
          this.toast(`Não deu pra gravar: ${(err as Error).message}`, true)
          save.disabled = false
        }
      },
    }, 'Gravar no pacote') as HTMLButtonElement
    const close = this.modal(`Curar peça: ${base.label}`, form.body, [
      h('button', { class: 'vt-btn', onclick: () => close() }, 'Cancelar'),
      save,
    ], undefined, true)
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
    const chosen = s.tool === 'object' && s.objectKind ? objectDef(s.objectKind) : undefined
    const chosenBase = chosen && this.primary(chosen).id
    for (const [id, c] of this.objectCells) c.classList.toggle('vt-on', chosenBase === id)
    this.renderObjectInfo()
    this.brushLabel.textContent = String(s.brush)
    this.undoBtn.disabled = !s.canUndo
    this.redoBtn.disabled = !s.canRedo

    const z = s.zone
    const parts: Node[] = []
    if (s.cursor) parts.push(h('span', {}, `Tile ${s.cursor.tx}, ${s.cursor.ty}`))
    parts.push(h('span', {}, `${z.width}×${z.height} tiles`))
    parts.push(h('span', {}, `${z.objects.length} objetos`))
    parts.push(s.dirty ? h('span', { class: 'vt-dirty' }, '● não salvo') : h('span', {}, 'salvo'))
    const chosenTerrain = terrainById.get(s.terrain)
    const overlay = !!chosenTerrain && isOverlay(chosenTerrain)
    const fence = !!chosenTerrain && isFence(chosenTerrain)
    const layerNote = overlay ? ' (camada de cima)' : fence ? ' (cerca: pinta tiles e liga sozinha)' : ''
    const hint = {
      brush: `Pincel: ${chosenTerrain?.label ?? ''}${layerNote} — arraste pra pintar · Shift + clique: linha reta · Alt + roda: tamanho`,
      fill: fence ? 'Balde não vale pra cercas — use o pincel' : `Balde: ${chosenTerrain?.label ?? ''}${layerNote} — clique pra preencher a área`,
      erase: overlay ? 'Borracha — apaga tapetes e molduras (camada de cima)' : fence ? 'Borracha — apaga cercas' : 'Borracha — volta ao terreno de fundo',
      object: s.objectKind ? 'Clique ou arraste pra colocar (Shift: variantes sorteadas) · , . trocam a variante · F espelha · Esc solta' : 'Escolha um objeto na aba Objetos',
      select: s.selected.length ? 'Arraste pra mover · setas empurram · F espelha · Ctrl D duplica · Del apaga' : 'Clique num objeto (Shift soma) ou arraste um retângulo pra selecionar',
      portal: s.selectedPortal ? 'Escolha o destino no painel · arraste pra mover · Del apaga' : 'Arraste pra desenhar uma saída · clique numa saída pra editar',
      spawn: 'Clique onde o jogador deve aparecer',
      light: s.selectedLight ? 'Arraste a luz pra mover · ajuste no painel · Del apaga' : 'Clique pra pôr uma luz · clique numa luz pra editar · I liga/desliga a prévia',
      room: { room: 'Cômodo: arraste pra criar · clique aplica o estilo · Alt + clique copia · Ctrl + arrastar apaga', wall: 'Parede interna: risque uma linha dentro do cômodo', door: 'Porta: arraste sobre uma parede pra abrir um vão' }[s.roomMode],
    }[s.tool]
    parts.push(h('span', { class: 'vt-hint' }, `${hint} · Espaço + arrastar move a tela · roda dá zoom`))
    parts.push(h('button', { class: 'vt-link', title: 'Todos os atalhos (?)', onclick: () => this.openShortcuts() }, 'Atalhos'))
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
    if (tool === 'room' && this.tab !== 'rooms') {
      this.tab = 'rooms'
      this.renderPane()
    }
    if (tool === 'light' && this.tab !== 'light') {
      this.tab = 'light'
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
    const regrid = (src: string[]) => {
      const out: string[] = new Array((width + 1) * (height + 1)).fill('')
      for (let y = 0; y <= Math.min(height, z.height); y++)
        for (let x = 0; x <= Math.min(width, z.width); x++)
          out[y * (width + 1) + x] = src[y * (z.width + 1) + x]
      return out
    }
    const corners = regrid(z.corners)
    const regridTiles = (src: string[]) => {
      const out: string[] = new Array(width * height).fill('')
      for (let y = 0; y < Math.min(height, z.height); y++)
        for (let x = 0; x < Math.min(width, z.width); x++)
          out[y * width + x] = src[y * z.width + x]
      return out
    }
    const W = width * TILE, H = height * TILE
    const resized: ZoneData = {
      ...z,
      width,
      height,
      corners,
      ...(z.overlay ? { overlay: regrid(z.overlay) } : {}),
      ...(z.rooms ? { rooms: regrid(z.rooms) } : {}),
      ...(z.fences ? { fences: regridTiles(z.fences) } : {}),
      objects: z.objects.filter((o) => o.x <= W && o.y <= H),
      portals: z.portals.filter((p) => p.x < W && p.y < H).map((p) => ({ ...p, w: Math.min(p.w, W - p.x), h: Math.min(p.h, H - p.y) })),
      spawn: { x: Math.min(z.spawn.x, W - 16), y: Math.min(z.spawn.y, H - 16) },
    }
    this.state.zone = resized
    this.state.selected = []
    this.state.emit('zone')
    this.toast(`Zona agora tem ${width}×${height} tiles.`)
  }

  private openShortcuts() {
    const rows: [string, string][][] = [
      [
        ['Roda do mouse', 'Zoom suave no ponto do cursor (trackpad: pinça)'],
        ['Ctrl + / Ctrl −', 'Mais / menos zoom'],
        ['Ctrl 0', 'Enquadrar a zona inteira'],
        ['Ctrl 1 · Ctrl 2', 'Zoom 100% · 200%'],
        ['Espaço + arrastar', 'Mover a tela (também: botão do meio ou direito)'],
        ['WASD / setas', 'Mover a tela (Shift: rápido)'],
        ['Home', 'Centralizar a zona'],
      ],
      [
        ['B · G · E', 'Pincel · balde · borracha'],
        ['O · V', 'Colocar objeto · selecionar'],
        ['C', 'Cômodo (arraste; Ctrl apaga)'],
        ['L', 'Luz solta (clique põe; arraste move)'],
        ['X · P', 'Saída · ponto de início'],
        ['[ · ] ou Alt + roda', 'Tamanho do pincel'],
        ['Shift + clique', 'Pincel: linha reta desde o último ponto'],
        ['Alt + clique', 'Conta-gotas (copia terreno ou objeto)'],
        ['H · K · N', 'Grade · colisões · encaixe na grade'],
        ['I', 'Ver iluminação (hora, luzes, sombras)'],
        ['U', 'Ouvir os sons da zona no editor'],
        ['M (no teste)', 'Ligar/desligar o som'],
      ],
      [
        ['Arrastar (objeto)', 'Carimba vários seguidos; com Shift, variantes e espelho sorteados'],
        ['Shift/Ctrl + clique', 'Somar/tirar da seleção'],
        ['Arrastar no vazio', 'Selecionar com um retângulo'],
        ['Ctrl A', 'Selecionar todos os objetos'],
        ['Ctrl C · X · V', 'Copiar · recortar · colar (no mouse)'],
        ['Ctrl D', 'Duplicar'],
        ['Setas', 'Empurrar a seleção 1px (Shift: 8px)'],
        [', · .', 'Variante anterior / próxima'],
        ['F', 'Espelhar'],
        ['Del', 'Apagar'],
        ['Esc', 'Soltar a seleção / o objeto'],
      ],
      [
        ['Ctrl Z · Ctrl Y', 'Desfazer · refazer'],
        ['Ctrl S', 'Salvar'],
        ['?', 'Esta janela'],
      ],
    ]
    const titles = ['Câmera', 'Ferramentas', 'Objetos', 'Geral']
    const body = rows.map((list, i) => h('div', { class: 'vt-keys' },
      h('h4', {}, titles[i]),
      ...list.map(([k, v]) => h('div', { class: 'vt-keyrow' }, h('kbd', {}, k), h('span', {}, v))),
    ))
    const close = this.modal('Atalhos', [h('div', { class: 'vt-keys-grid' }, ...body)], [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')], undefined, true)
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
    this.applySound()
    this.hooks.startTest()
  }

  /** O pé do boneco no ponto de início encosta em água, buraco ou tronco? */
  private spawnBlocked() {
    const z = this.state.zone
    const foot = { x: z.spawn.x - 9, y: z.spawn.y - 10, w: 18, h: 10 }
    const hit = (r: { x: number; y: number; w: number; h: number }) =>
      foot.x < r.x + r.w && r.x < foot.x + foot.w && foot.y < r.y + r.h && r.y < foot.y + foot.h
    if (solidTerrainRects(z).some(hit) || fenceSolids(z).some(hit)) return true
    return z.objects.some((o) => {
      const def = objectDef(o.kind)
      return !!def && objectSolids(def, o).some(hit)
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
      this.state.modalOpen = this.modals.length > 0
      bg.remove()
    }
    const dismiss = () => {
      close()
      onDismiss?.()
    }
    this.modals.push(dismiss)
    this.state.modalOpen = true
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
    const typing = target.matches('input:not([type=range]), textarea, select')
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    const scene = this.hooks.scene()

    if (ctrl && k === 's') { e.preventDefault(); this.save(); return }
    if (typing) return
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); this.state.undo(); return }
    if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.state.redo(); return }
    // zoom pelo teclado (também segura o zoom do navegador)
    if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); scene?.zoomBy(1.25); return }
    if (ctrl && (k === '-' || k === '_')) { e.preventDefault(); scene?.zoomBy(1 / 1.25); return }
    if (ctrl && k === '0') { e.preventDefault(); scene?.fitZone(); return }
    if (ctrl && k === '1') { e.preventDefault(); scene?.zoomTo(1); return }
    if (ctrl && k === '2') { e.preventDefault(); scene?.zoomTo(2); return }
    if (ctrl && k === 'a') { e.preventDefault(); scene?.selectAll(); return }
    if (ctrl && k === 'c') { e.preventDefault(); const n = scene?.copySelected() ?? 0; if (n) this.toast(`${n} objeto${n > 1 ? 's' : ''} copiado${n > 1 ? 's' : ''}.`); return }
    if (ctrl && k === 'x') { e.preventDefault(); scene?.cutSelected(); return }
    if (ctrl && k === 'v') { e.preventDefault(); if (!scene?.paste()) this.toast('Nada copiado ainda (Ctrl C com objetos selecionados).'); return }
    if (ctrl && k === 'd') { e.preventDefault(); scene?.duplicate(); return }
    if (ctrl) return

    // setas: com objetos selecionados empurram; sem, a cena move a tela
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (arrows[e.key]) {
      e.preventDefault()
      if (this.state.tool === 'select' && this.state.selected.length) {
        const step = e.shiftKey ? 8 : 1
        scene?.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step)
      }
      return
    }

    const tool = TOOLS.find((t) => t.key.toLowerCase() === k)
    if (tool) { this.setTool(tool.id); return }
    if (k === '[') this.setBrush(this.state.brush - 1)
    else if (k === ']') this.setBrush(this.state.brush + 1)
    else if (k === 'h') this.state.set({ showGrid: !this.state.showGrid })
    else if (k === 'k') this.state.set({ showCollision: !this.state.showCollision })
    else if (k === 'n') this.state.set({ snap: !this.state.snap })
    else if (k === 'i') this.state.set({ lightPreview: !this.state.lightPreview })
    else if (k === 'u') this.toggleEditorSound()
    else if (k === 'f') this.flip()
    else if (e.key === ',' || e.key === '<') scene?.cycleVariant(-1)
    else if (e.key === '.' || e.key === '>') scene?.cycleVariant(1)
    else if (e.key === '?' || e.key === 'F1') { e.preventDefault(); this.openShortcuts() }
    else if (k === '+' || k === '=') scene?.zoomBy(1.25)
    else if (k === '-') scene?.zoomBy(1 / 1.25)
    else if (e.key === 'Home') this.hooks.centerOnZone()
    else if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.deleteSelected()
    else if (e.key === 'Escape') {
      // primeiro solta a seleção; de novo, volta pra ferramenta de seleção
      if (this.state.selected.length) this.state.set({ selected: [] })
      else this.state.set({ tool: 'select' })
    }
    else if (e.key === ' ') e.preventDefault()
  }
}

/** Sem acento e minúsculo, pra busca achar "arvore" em "Árvore". */
function fold(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function searchText(o: ObjectDef) {
  return [o.label, o.category, KIND_LABELS[o.kind], ...o.tags, ...variantsOf(o).map((v) => v.variant ?? '')].join(' ')
}

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
