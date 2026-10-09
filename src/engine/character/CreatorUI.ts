// ────────────────────────────────────────────────────────
// Criador de personagem, em tela cheia, no estilo dos criadores de personagem
// de jogos cyberpunk: o boneco enorme à esquerda (rosto de perto quando se mexe
// no rosto e no cabelo; corpo inteiro quando se mexe no corpo e na roupa) e, à
// direita, as categorias com uma linha por peça (◀ valor ▶, cores logo abaixo).
// Personagens ficam no CharacterStorage.
// ────────────────────────────────────────────────────────

import editorCss from '../editor/editor.css?inline'
import css from './creator.css?inline'
import { h, injectStyle } from '../ui/dom'
import { loaderCover } from '../ui/loader'
import { creditsBody } from '../ui/credits'
import { scale2x } from '../ui/scale2x'
import { ICONS } from '../editor/icons'
import {
  BODY_LABELS, HEIGHT_LABELS, defaultAppearance, itemLabel, itemsForSlot, loadCharacterData, normalizeAppearance, randomAppearance, swatch,
  type CharItem, type CharSlot, type CharacterData,
} from './catalog'
import { ANIMS, FRAME, composeAll, composeFrame, type AnimName } from './compose'
import { newCharacter, type CharacterStorage } from './storage'
import { characterFileName, downloadText, exportCharacters, parseCharacterFile, pickTextFile } from './transfer'
import { HEIGHTS, type Appearance, type AppearanceItem, type BodyType, type CharacterSave } from '../types'

export interface CreatorOptions {
  assetBase: string
  storage: CharacterStorage
  /** Botão de fechar/voltar (ex.: pro editor). Sem ele, o botão não aparece. */
  back?: { label: string; onClick: () => void }
  /**
   * Modo jogador: um boneco só, sem lista nem "Novo". Salvar guarda o boneco
   * e chama `onSaved` (é como o jogador fixa o personagem dele na campanha).
   */
  single?: boolean
  /** Título no alto da tela (padrão: "Definir aparência"). */
  title?: string
  saveLabel?: string
  /** Salvar também põe o boneco em uso (padrão: sim). O mestre cria NPCs sem tomar o lugar do dele. */
  activateOnSave?: boolean
  onSaved?: (c: CharacterSave) => void
}

const ANIM_LABELS: Record<AnimName, string> = { idle: 'Parado', walk: 'Andando', run: 'Correndo' }

/** Abas, na ordem. Peças que o catálogo põe em outro grupo são realocadas aqui. */
const GROUP_ORDER = ['Corpo', 'Rosto', 'Cabelo', 'Maquiagem', 'Marcas', 'Roupa', 'Acessórios']
const GROUP_OF: Record<string, string> = {
  body: 'Corpo', tail: 'Corpo', wings: 'Corpo', horns: 'Corpo',
  head: 'Rosto', ears: 'Rosto', nose: 'Rosto', eyebrows: 'Rosto', eyes: 'Rosto', wrinkles: 'Rosto', expression: 'Rosto',
  hair: 'Cabelo', ponytail: 'Cabelo', beard: 'Cabelo', mustache: 'Cabelo',
}
/** Peças que se veem de perto: a câmera chega no rosto. */
const FACE_SLOTS = new Set([
  'head', 'ears', 'nose', 'eyebrows', 'eyes', 'wrinkles', 'expression', 'hair', 'ponytail', 'beard', 'mustache', 'horns',
  'hat', 'bandana', 'facial', 'mask', 'earrings', 'scar_eye_l', 'scar_eye_r', 'scar_mouth', 'wound_head',
  'skin_spots', 'scar_face', 'makeup_lips', 'makeup_eyes', 'makeup_cheeks', 'face_paint', 'tattoo_face',
])
const FACE_GROUPS = new Set(['Rosto', 'Cabelo', 'Maquiagem'])

/** Rótulos dos canais de cor e dos materiais (vêm em inglês do LPC). */
const COLOR_LABELS: Record<string, string> = {
  'Eye color': 'Cor dos olhos', 'Eye Color': 'Cor dos olhos', 'eye color': 'Cor dos olhos', Hair: 'Cabelo', Skin: 'Pele', Primary: 'Cor principal',
  Secondary: 'Cor secundária', Trim: 'Detalhe', Metal: 'Metal', Fabric: 'Tecido', Cloth: 'Tecido', Leather: 'Couro',
}
const MATERIAL_LABELS: Record<string, string> = { body: 'pele', hair: 'cabelo', cloth: 'tecido', eye: 'olho', metal: 'metal', wood: 'madeira' }

/** Enquadramentos (em px do quadro de 64): centro e altura visível. */
const CAMERA = { face: { cx: 32, cy: 27, h: 42, minW: 40 }, body: { cx: 32, cy: 35, h: 70, minW: 46 } }
/** Quantas vezes a Scale2x passa na prévia (3 = 8×). */
const UP_PASSES = 3
const UP = 2 ** UP_PASSES

export class CreatorUI {
  readonly root: HTMLDivElement
  private data!: CharacterData
  private character: CharacterSave
  private dirty = false
  private group = 'Corpo'
  private slot = 'body'
  private anim: AnimName = 'idle'
  private dir = 2 // linha "down"
  private sheets: Record<AnimName, HTMLCanvasElement> | null = null
  private composeToken = 0
  /** Sobe a cada folha nova (a ampliação guardada vale só pra versão dela). */
  private rev = 0
  private raf = 0
  private cam = { cx: 32, cy: 34, h: 68 }
  /** Altura mostrada agora (anima até a escolhida). */
  private hs = 1
  private camOverride: 'face' | 'body' | null = null
  private upCache = new Map<string, HTMLCanvasElement>()
  private stageEl: HTMLElement
  private canvas: HTMLCanvasElement
  private resizeObs: ResizeObserver | null = null
  private nameInput: HTMLInputElement
  private tabsEl: HTMLDivElement
  private rowsEl: HTMLDivElement
  private statusEl: HTMLElement
  private camBtn: HTMLButtonElement
  private nextBtn: HTMLButtonElement
  private prevBtn: HTMLButtonElement
  /** O cavaleiro correndo, por cima do criador enquanto o catálogo carrega. */
  private loading?: HTMLElement
  private animButtons = new Map<AnimName, HTMLButtonElement>()
  private thumbObserver: IntersectionObserver | null = null
  private baseThumb: Promise<HTMLCanvasElement> | null = null
  private modals: (() => void)[] = []
  private drag: { x: number; acc: number } | null = null
  private onKey = (e: KeyboardEvent) => this.handleKey(e)
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.dirty) e.preventDefault()
  }

  constructor(parent: HTMLElement, private opts: CreatorOptions) {
    injectStyle('editor', editorCss)
    injectStyle('creator', css)
    this.character = newCharacter('Novo personagem', defaultAppearance())

    this.nameInput = h('input', {
      class: 'cp-name',
      value: this.character.name,
      title: 'Nome do personagem',
      maxlength: 60,
      placeholder: 'Nome do personagem',
      oninput: () => {
        this.character.name = this.nameInput.value
        this.markDirty()
      },
    }) as HTMLInputElement
    this.canvas = h('canvas', { class: 'cp-canvas' }) as HTMLCanvasElement
    this.tabsEl = h('div', { class: 'cp-tabs', role: 'tablist' }) as HTMLDivElement
    this.rowsEl = h('div', { class: 'cp-rows' }) as HTMLDivElement
    this.statusEl = h('footer', { class: 'cp-status' })
    this.camBtn = h('button', { class: 'cp-chip', title: 'Aproximar no rosto ou ver o corpo inteiro', onclick: () => this.toggleCamera() }) as HTMLButtonElement
    this.prevBtn = h('button', { class: 'cp-btn cp-ghost', onclick: () => this.stepGroup(-1) }, '‹ Anterior') as HTMLButtonElement
    this.nextBtn = h('button', { class: 'cp-btn', onclick: () => this.stepGroup(1) }, 'Próximo ›') as HTMLButtonElement

    const animBar = h('div', { class: 'cp-chips' })
    for (const a of ['idle', 'walk', 'run'] as AnimName[]) {
      const b = h('button', { class: 'cp-chip', onclick: () => { this.anim = a; this.refreshAnimButtons() } }, ANIM_LABELS[a]) as HTMLButtonElement
      this.animButtons.set(a, b)
      animBar.append(b)
    }

    this.stageEl = h('section', { class: 'cp-stage' },
      this.canvas,
      h('div', { class: 'cp-stage__fx', 'aria-hidden': 'true' }),
      h('header', { class: 'cp-stage__head' },
        h('span', { class: 'cp-kicker' }, opts.title ?? 'Definir aparência'),
        this.nameInput,
        h('div', { class: 'cp-tools' },
          opts.single ? null : this.tool(ICONS.plus, 'Novo personagem', () => this.newCharacter()),
          opts.single ? null : this.tool(ICONS.open, 'Meus personagens', () => this.openList()),
          this.tool(ICONS.upload, 'Importar de um arquivo', () => void this.importFile()),
          this.tool(ICONS.download, 'Exportar para um arquivo', () => this.exportFile()),
        ),
      ),
      h('footer', { class: 'cp-stage__foot' },
        h('div', { class: 'cp-rotate' },
          h('button', { class: 'cp-round', title: 'Girar (Q)', onclick: () => this.turn(-1) }, '⟲'),
          h('span', {}, 'Arraste pra girar'),
          h('button', { class: 'cp-round', title: 'Girar (E)', onclick: () => this.turn(1) }, '⟳'),
        ),
        h('div', { class: 'cp-stage__opts' }, animBar, this.camBtn),
      ),
    )

    this.root = h('div', { class: 'cp-root' },
      this.stageEl,
      h('section', { class: 'cp-panel' },
        h('header', { class: 'cp-panel__head' },
          h('div', { class: 'cp-panel__title' },
            h('span', { class: 'cp-panel__icon', html: ICONS.person }),
            h('div', {}, h('b', {}, 'Personagem'), h('small', {}, 'A aparência é tudo')),
          ),
          h('div', { class: 'cp-panel__actions' },
            h('button', { class: 'cp-btn cp-primary', onclick: () => void this.save() }, opts.saveLabel ?? 'Salvar'),
            opts.back ? h('button', { class: 'cp-btn cp-ghost cp-x', title: opts.back.label, 'aria-label': opts.back.label, html: ICONS.close, onclick: () => void this.goBack() }) : null,
          ),
        ),
        this.tabsEl,
        this.rowsEl,
        h('footer', { class: 'cp-panel__foot' },
          h('button', { class: 'cp-btn cp-ghost', title: 'Sortear um personagem inteiro', html: `${ICONS.star}<span>Aleatório</span>`, onclick: () => this.randomize() }),
          h('span', { class: 'cp-spacer' }),
          this.prevBtn,
          this.nextBtn,
        ),
        this.statusEl,
      ),
    )
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    parent.append(this.root)
    this.root.addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur())
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('beforeunload', this.onBeforeUnload)
    this.setupStageInput()
    // o cavaleiro corre por cima do criador até o catálogo chegar
    this.loading = loaderCover(opts.assetBase)
    this.root.append(this.loading)
    this.init()
  }

  private async init() {
    try {
      this.data = await loadCharacterData(this.opts.assetBase)
    } catch (err) {
      this.loading?.remove()
      this.statusEl.textContent = `Não deu pra carregar o catálogo de personagem: ${(err as Error).message}`
      return
    }
    // abre o personagem ativo (ou o mais recente)
    const [list, active] = await Promise.all([
      this.opts.storage.list().catch(() => []),
      this.opts.storage.getActive().catch(() => null),
    ])
    const start = list.find((c) => c.id === active) ?? list[0]
    if (start) this.character = structuredClone(start)
    this.character.appearance = normalizeAppearance(this.data, this.character.appearance)
    this.nameInput.value = this.character.name
    this.renderTabs()
    this.renderRows()
    this.refreshAnimButtons()
    this.recompose()
    this.loop()
    this.loading?.remove()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObs?.disconnect()
    this.thumbObserver?.disconnect()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.root.remove()
  }

  // ── Montagem ───────────────────────────────────────────

  private tool(icon: string, label: string, onclick: () => void) {
    return h('button', { class: 'cp-tool', title: label, 'aria-label': label, html: icon, onclick })
  }

  private get appearance() {
    return this.character.appearance
  }

  /** As peças de um espaço que servem pro corpo e pra cabeça de agora. */
  private itemsFor(slot: string) {
    return itemsForSlot(this.data, slot, this.appearance.body, this.appearance)
  }

  private groupOf(s: CharSlot) {
    return GROUP_OF[s.id] ?? s.group
  }

  /** Abas com peças pra escolher (na ordem do criador). */
  private groups() {
    const have = new Set(this.data.catalog.slots.filter((s) => this.itemsFor(s.id).length).map((s) => this.groupOf(s)))
    const extra = [...have].filter((g) => !GROUP_ORDER.includes(g))
    return [...GROUP_ORDER, ...extra].filter((g) => have.has(g))
  }

  private slotsOfGroup(group = this.group) {
    return this.data.catalog.slots.filter((s) => this.groupOf(s) === group && this.itemsFor(s.id).length)
  }

  private renderTabs() {
    const groups = this.groups()
    if (!groups.includes(this.group)) this.setGroup(groups[0] ?? 'Corpo', false)
    this.tabsEl.replaceChildren(...groups.map((g, i) => h('button', {
      class: `cp-tab${g === this.group ? ' cp-on' : ''}`,
      role: 'tab',
      'aria-selected': g === this.group ? 'true' : 'false',
      onclick: () => this.setGroup(g),
    }, h('i', {}, String(i + 1)), g)))
    const i = groups.indexOf(this.group)
    this.prevBtn.disabled = i <= 0
    this.nextBtn.disabled = i >= groups.length - 1
  }

  private setGroup(g: string, render = true) {
    this.group = g
    this.slot = this.slotsOfGroup(g)[0]?.id ?? this.slot
    this.camOverride = null
    if (render) {
      this.renderTabs()
      this.renderRows()
      this.rowsEl.scrollTop = 0
    }
  }

  private stepGroup(step: number) {
    const groups = this.groups()
    const i = groups.indexOf(this.group) + step
    if (i >= 0 && i < groups.length) this.setGroup(groups[i])
  }

  private focusSlot(id: string) {
    if (this.slot === id) return
    this.slot = id
    this.camOverride = null
    this.renderRows()
  }

  /** Linhas da aba: uma por peça (◀ valor ▶); a escolhida mostra as cores embaixo. */
  private renderRows() {
    const keep = this.rowsEl.scrollTop
    const rows: Node[] = []
    if (this.group === 'Corpo') rows.push(this.bodyRow(), this.heightRow(), this.skinRow())
    for (const s of this.slotsOfGroup()) rows.push(this.slotRow(s))
    this.rowsEl.replaceChildren(...rows)
    this.rowsEl.scrollTop = keep
    this.refreshStatus()
  }

  private arrow(dir: -1 | 1, onclick: () => void) {
    return h('button', { class: 'cp-arrow', title: dir < 0 ? 'Anterior' : 'Próximo', 'aria-label': dir < 0 ? 'Anterior' : 'Próximo', onclick }, dir < 0 ? '◀' : '▶')
  }

  private bodyRow() {
    const bodies = this.data.catalog.bodies
    const a = this.appearance
    const idx = bodies.indexOf(a.body)
    const step = (d: number) => this.setBody(bodies[(idx + d + bodies.length) % bodies.length])
    return h('div', { class: 'cp-row cp-plain' },
      h('div', { class: 'cp-row__head' }, h('span', { class: 'cp-row__label' }, 'Tipo de corpo'), h('span', { class: 'cp-row__count' }, `${idx + 1}/${bodies.length}`)),
      h('div', { class: 'cp-row__ctl' },
        this.arrow(-1, () => step(-1)),
        h('span', { class: 'cp-row__value' }, BODY_LABELS[a.body] ?? a.body),
        this.arrow(1, () => step(1)),
      ),
    )
  }

  private heightRow() {
    const a = this.appearance
    const idx = Math.max(0, HEIGHTS.findIndex((v) => v === (a.height ?? 1)))
    const step = (d: number) => this.update((x) => {
      const h = HEIGHTS[(idx + d + HEIGHTS.length) % HEIGHTS.length]
      if (h === 1) delete x.height
      else x.height = h
    })
    return h('div', { class: 'cp-row cp-plain' },
      h('div', { class: 'cp-row__head' }, h('span', { class: 'cp-row__label' }, 'Altura'), h('span', { class: 'cp-row__count' }, `${idx + 1}/${HEIGHTS.length}`)),
      h('div', { class: 'cp-row__ctl' },
        this.arrow(-1, () => step(-1)),
        h('span', { class: 'cp-row__value' }, HEIGHT_LABELS[idx]),
        this.arrow(1, () => step(1)),
      ),
    )
  }

  private skinRow() {
    return h('div', { class: 'cp-row cp-plain' },
      h('div', { class: 'cp-row__head' }, h('span', { class: 'cp-row__label' }, 'Tom de pele')),
      this.swatches('body', this.appearance.skin, (c) => this.update((x) => { x.skin = c })),
    )
  }

  private slotRow(s: CharSlot) {
    const a = this.appearance
    const items = this.itemsFor(s.id)
    const chosen = a.slots[s.id]
    const current = chosen && this.data.byId.get(chosen.id)
    const focused = s.id === this.slot
    const total = items.length + (s.required ? 0 : 1)
    // posição na lista ("Nenhum" é a primeira, nos espaços que podem ficar vazios)
    const pos = current ? items.findIndex((i) => i.id === current.id) + 1 + (s.required ? 0 : 1) : 1
    const row = h('div', { class: `cp-row${focused ? ' cp-on' : ''}${current ? ' cp-filled' : ''}`, 'data-slot': s.id },
      h('button', { class: 'cp-row__head', onclick: () => this.focusSlot(s.id) },
        h('span', { class: 'cp-row__label' }, s.label),
        h('span', { class: 'cp-row__count' }, `${pos}/${total}`),
      ),
      h('div', { class: 'cp-row__ctl' },
        this.arrow(-1, () => this.cycle(s, -1)),
        h('button', { class: 'cp-row__value', title: 'Ver todas as opções', onclick: () => { this.focusSlot(s.id); this.openGrid(s) } }, current ? itemLabel(current) : 'Nenhum'),
        this.arrow(1, () => this.cycle(s, 1)),
        h('button', { class: 'cp-arrow cp-grid', title: 'Ver todas as opções', 'aria-label': 'Ver todas as opções', html: ICONS.grid, onclick: () => { this.focusSlot(s.id); this.openGrid(s) } }),
      ),
    )
    if (focused && current) row.append(...this.detail(s, chosen, current))
    return row
  }

  /** Cores e variantes da peça escolhida. */
  private detail(s: CharSlot, chosen: AppearanceItem, current: CharItem) {
    const parts: Node[] = []
    for (const ch of current.colors ?? []) {
      if (ch.material === 'body' && current.matchBody) continue
      const label = ch.label ? (COLOR_LABELS[ch.label] ?? ch.label) : current.colors!.length > 1 ? `Cor (${MATERIAL_LABELS[ch.material] ?? ch.material})` : 'Cor'
      parts.push(h('div', { class: 'cp-sub' }, label), this.swatches(ch.material, chosen.colors?.[ch.key] ?? null, (c) =>
        this.update((x) => { (x.slots[s.id].colors ??= {})[ch.key] = c })))
    }
    if (current.variants && current.variants.length > 1) {
      parts.push(h('div', { class: 'cp-sub' }, 'Versão'), h('div', { class: 'cp-chips cp-wrap' }, ...current.variants.map((v) => h('button', {
        class: `cp-chip${chosen.variant === v ? ' cp-on' : ''}`,
        onclick: () => this.update((x) => { x.slots[s.id].variant = v }),
      }, v.replace(/_/g, ' ')))))
    }
    return parts
  }

  private swatches(material: string, selected: string | null, onPick: (color: string) => void) {
    const names = Object.keys(this.data.palettes[material] ?? {})
    return h('div', { class: 'cp-swatches' }, ...names.map((n) => h('button', {
      class: `cp-swatch${n === selected ? ' cp-on' : ''}`,
      title: n.replace(/_/g, ' '),
      style: `background:${swatch(this.data.palettes, material, n)}`,
      onclick: () => onPick(n),
    })))
  }

  /** Janela com todas as opções de uma peça, com miniaturas. */
  private openGrid(s: CharSlot) {
    const a = this.appearance
    const items = this.itemsFor(s.id)
    const chosen = a.slots[s.id]
    const grid = h('div', { class: 'cp-grid-list' })
    const body = h('div', { class: 'cp-modal-body' }, grid)
    let close = () => {}
    if (!s.required) {
      grid.append(h('button', {
        class: `cp-cell cp-none${!chosen ? ' cp-on' : ''}`,
        title: 'Nenhum',
        onclick: () => { this.update((x) => { delete x.slots[s.id] }); close() },
      }, h('span', {}, 'Nenhum')))
    }
    this.thumbObserver?.disconnect()
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        obs.unobserve(e.target)
        this.drawThumb(e.target as HTMLElement, s.id)
      }
    }, { root: body, rootMargin: '120px' })
    this.thumbObserver = obs
    for (const item of items) {
      const cell = h('button', {
        class: `cp-cell${chosen?.id === item.id ? ' cp-on' : ''}`,
        title: itemLabel(item),
        'data-item': item.id,
        onclick: () => { this.chooseItem(s.id, item); close() },
      }, h('canvas', { width: FRAME, height: FRAME }), h('span', {}, itemLabel(item)))
      grid.append(cell)
      obs.observe(cell)
    }
    close = this.modal(`${s.label} — ${items.length} opç${items.length === 1 ? 'ão' : 'ões'}`, [body], [h('button', { class: 'cp-btn cp-ghost', onclick: () => close() }, 'Fechar')])
  }

  /** Miniatura: o item sobre o corpo e a cabeça atuais (meio apagados). */
  private async drawThumb(cell: HTMLElement, slot: string) {
    const id = cell.dataset.item!
    const item = this.data.byId.get(id)
    const canvas = cell.querySelector('canvas')
    if (!item || !canvas) return
    const a = this.appearance
    const chosen: AppearanceItem = a.slots[slot]?.id === id
      ? a.slots[slot]
      : { id, ...(item.variants ? { variant: item.variants[0] } : {}), colors: this.carryColors(slot, item) }
    try {
      const ctx = canvas.getContext('2d')!
      // peças do rosto desenhadas por código: miniatura do rosto de perto (cabeça + a peça, sem cabelo)
      if (item.proc) {
        const face = await composeFrame(this.opts.assetBase, { ...a, slots: { ...pickSlots(a, ['body', 'head']), [slot]: chosen } })
        ctx.clearRect(0, 0, FRAME, FRAME)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(face, 16, 10, 32, 32, 0, 0, FRAME, FRAME)
        return
      }
      const [base, frame] = await Promise.all([
        (this.baseThumb ??= composeFrame(this.opts.assetBase, { ...a, slots: pickSlots(a, ['body', 'head']) })),
        composeFrame(this.opts.assetBase, { ...a, slots: { [slot]: chosen } }),
      ])
      ctx.clearRect(0, 0, FRAME, FRAME)
      if (slot !== 'body' && slot !== 'head') {
        ctx.globalAlpha = 0.35
        ctx.drawImage(base, 0, 0)
        ctx.globalAlpha = 1
      }
      ctx.drawImage(frame, 0, 0)
    } catch {
      /* miniatura que falha não atrapalha */
    }
  }

  /** Ao trocar de item, mantém as cores que fazem sentido (mesmo canal e material). */
  private carryColors(slot: string, item: CharItem) {
    const prev = this.appearance.slots[slot]
    const prevItem = prev && this.data.byId.get(prev.id)
    const colors: Record<string, string> = {}
    for (const ch of item.colors ?? []) {
      const same = prevItem?.colors?.find((c) => c.key === ch.key && c.material === ch.material)
      const c = same && prev!.colors?.[same.key]
      if (c) colors[ch.key] = c
    }
    return colors
  }

  // ── Ações ──────────────────────────────────────────────

  private update(fn: (a: Appearance) => void) {
    const a = structuredClone(this.appearance)
    fn(a)
    this.character.appearance = normalizeAppearance(this.data, a)
    this.markDirty()
    this.baseThumb = null
    this.renderRows()
    this.recompose()
  }

  private chooseItem(slot: string, item: CharItem) {
    this.update((a) => {
      a.slots[slot] = { id: item.id, ...(item.variants ? { variant: item.variants[0] } : {}), colors: this.carryColors(slot, item) }
    })
  }

  /** Passa pra a peça anterior/seguinte do espaço (volta ao começo no fim; "Nenhum" conta, se puder). */
  private cycle(s: CharSlot, step: number) {
    const items = this.itemsFor(s.id)
    const chosen = this.appearance.slots[s.id]
    const options: (CharItem | null)[] = s.required ? [...items] : [null, ...items]
    const at = Math.max(0, options.findIndex((o) => (o?.id ?? null) === (chosen?.id ?? null)))
    const next = options[(at + step + options.length) % options.length]
    this.slot = s.id
    this.camOverride = null
    if (next) this.chooseItem(s.id, next)
    else this.update((x) => { delete x.slots[s.id] })
  }

  private setBody(body: BodyType) {
    if (body === this.appearance.body) return
    this.update((a) => {
      // peças que não existem pro corpo novo: troca por uma parecida (mesmo nome) ou, em roupa de baixo, pela primeira da lista
      for (const [slot, chosen] of Object.entries(a.slots)) {
        const item = this.data.byId.get(chosen.id)
        if (!item || item.bodies.includes(body)) continue
        const options = itemsForSlot(this.data, slot, body)
        const alt = options.find((i) => i.name === item.name) ?? (['legs', 'shoes'].includes(slot) ? options[0] : undefined)
        if (alt) a.slots[slot] = { id: alt.id, ...(alt.variants ? { variant: alt.variants[0] } : {}), ...(chosen.colors ? { colors: chosen.colors } : {}) }
      }
      a.body = body
      // cabeça humana acompanha o corpo (só o feminino usa a cabeça feminina)
      const head = a.slots.head?.id ?? ''
      if (head.includes('/human/')) {
        const other = body === 'female' ? head.replace(/_male/, '_female') : head.replace('_female', '_male')
        if (this.data.byId.has(other)) a.slots.head = { ...a.slots.head, id: other }
      }
    })
    this.renderTabs()
  }

  private randomize() {
    this.update((a) => {
      const r = randomAppearance(this.data)
      a.body = r.body
      a.skin = r.skin
      a.slots = r.slots
    })
  }

  private turn(step: number) {
    // ordem visual: baixo, esquerda, cima, direita
    const order = [2, 1, 0, 3]
    this.dir = order[(order.indexOf(this.dir) + step + 4) % 4]
  }

  private refreshAnimButtons() {
    for (const [a, b] of this.animButtons) b.classList.toggle('cp-on', a === this.anim)
  }

  private markDirty() {
    this.dirty = true
    this.refreshStatus()
  }

  private refreshStatus() {
    if (!this.data) return // catálogo ainda não carregou (ou falhou)
    const n = Object.keys(this.appearance.slots).length
    this.statusEl.replaceChildren(
      h('span', {}, `${this.data.catalog.items.length} peças no catálogo · ${n} neste personagem`),
      this.dirty ? h('span', { class: 'cp-dirty' }, '● não salvo') : h('span', {}, 'salvo'),
      h('button', { class: 'cp-link', onclick: () => this.openCredits() }, 'Créditos da arte'),
    )
  }

  // ── Palco: prévia grande, câmera, giro ─────────────────

  private cameraMode(): 'face' | 'body' {
    if (this.camOverride) return this.camOverride
    return FACE_SLOTS.has(this.slot) || FACE_GROUPS.has(this.group) ? 'face' : 'body'
  }

  private toggleCamera() {
    this.camOverride = this.cameraMode() === 'face' ? 'body' : 'face'
  }

  private setupStageInput() {
    const el = this.stageEl
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button, input')) return
      this.drag = { x: e.clientX, acc: 0 }
      el.setPointerCapture(e.pointerId)
      el.classList.add('cp-dragging')
    })
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return
      this.drag.acc += e.clientX - this.drag.x
      this.drag.x = e.clientX
      while (this.drag.acc > 70) { this.turn(-1); this.drag.acc -= 70 }
      while (this.drag.acc < -70) { this.turn(1); this.drag.acc += 70 }
    })
    const end = () => { this.drag = null; el.classList.remove('cp-dragging') }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    this.resizeObs = new ResizeObserver(() => this.fitCanvas())
    this.resizeObs.observe(el)
  }

  private fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(this.stageEl.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.stageEl.clientHeight * dpr))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
  }

  /** O quadro (anim, direção, coluna) já ampliado 8×, guardado enquanto a folha for a mesma. */
  private upscaled(anim: AnimName, dir: number, col: number, sheet: HTMLCanvasElement) {
    const key = `${this.rev}:${anim}:${dir}:${col}`
    let up = this.upCache.get(key)
    if (!up) {
      const f = document.createElement('canvas')
      f.width = f.height = FRAME
      f.getContext('2d')!.drawImage(sheet, col * FRAME, dir * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME)
      up = scale2x(f, UP_PASSES)
      if (this.upCache.size > 60) this.upCache.delete(this.upCache.keys().next().value!)
      this.upCache.set(key, up)
    }
    return up
  }

  /** Prévia animada: desenha o quadro ampliado, com a câmera chegando no rosto ou no corpo todo. */
  private loop() {
    const ctx = this.canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const start = performance.now()
    let last = start
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      this.fitCanvas()
      const W = this.canvas.width
      const H = this.canvas.height
      ctx.clearRect(0, 0, W, H)

      // a câmera vai (suave) pro enquadramento da peça que se mexe
      const mode = this.cameraMode()
      const target = CAMERA[mode]
      const k = 1 - Math.exp(-dt * 7)
      // a altura do personagem (escala em volta dos pés): a câmera acompanha o rosto e o topo
      this.hs += ((this.appearance.height ?? 1) - this.hs) * k
      const hs = this.hs
      const wantCy = 62 - (62 - target.cy) * hs
      const wantH = Math.max(target.h * (mode === 'body' ? Math.max(1, hs) : 1), target.minW * hs / (W / H))
      this.cam.cx += (target.cx - this.cam.cx) * k
      this.cam.cy += (wantCy - this.cam.cy) * k
      this.cam.h += (wantH - this.cam.h) * k
      this.camBtn.textContent = this.cameraMode() === 'face' ? 'Ver o corpo' : 'Ver o rosto'

      const sheet = this.sheets?.[this.anim]
      if (!sheet) return
      const { frames, rate } = ANIMS[this.anim]
      const first = this.anim === 'walk' ? 1 : 0
      const count = frames - first
      const col = first + (Math.floor(((now - start) / 1000) * rate) % count)
      const up = this.upscaled(this.anim, this.dir, col, sheet)

      const camH = this.cam.h
      const camW = camH * (W / H)
      const x0 = this.cam.cx - camW / 2
      const y0 = this.cam.cy - camH / 2
      const px = W / camW // px de tela por px do quadro

      // chão: elipse sob os pés e um anel de luz
      const fx = (32 - x0) * px
      const fy = (61.5 - y0) * px
      ctx.save()
      ctx.translate(fx, fy)
      ctx.scale(1, 0.22)
      const r = 17 * px
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(0.7, 'rgba(0,0,0,0.25)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 79, 94, 0.55)'
      ctx.lineWidth = Math.max(1, px * 0.35)
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // o personagem cresce/encolhe em volta dos pés
      ctx.save()
      ctx.translate(fx, (62 - y0) * px)
      ctx.scale(this.hs, this.hs)
      ctx.translate(-fx, -(62 - y0) * px)
      drawRegion(ctx, up, x0 * UP, y0 * UP, camW * UP, camH * UP, 0, 0, W, H)
      ctx.restore()
    }
    this.raf = requestAnimationFrame(tick)
  }

  /** Remonta as folhas da prévia (a mais recente vence se clicarem rápido). */
  private async recompose() {
    const token = ++this.composeToken
    try {
      const sheets = await composeAll(this.opts.assetBase, this.appearance)
      if (token === this.composeToken) {
        this.sheets = sheets
        this.rev++
        this.upCache.clear()
      }
    } catch (err) {
      this.statusEl.textContent = `Erro montando o personagem: ${(err as Error).message}`
      return
    }
    this.refreshStatus()
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && this.modals.length) {
      this.modals[this.modals.length - 1]()
      return
    }
    const t = e.target as HTMLElement | null
    if (this.modals.length || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || e.ctrlKey || e.metaKey || e.altKey) return
    if (!this.data || !this.root.isConnected) return
    const slots = this.slotsOfGroup()
    const at = slots.findIndex((s) => s.id === this.slot)
    switch (e.key) {
      case 'ArrowUp':
        if (slots.length) this.focusSlot(slots[(Math.max(0, at) - 1 + slots.length) % slots.length].id)
        break
      case 'ArrowDown':
        if (slots.length) this.focusSlot(slots[(at + 1) % slots.length].id)
        break
      case 'ArrowLeft':
      case 'ArrowRight':
        if (at >= 0) this.cycle(slots[at], e.key === 'ArrowRight' ? 1 : -1)
        break
      case 'q': case 'Q': this.turn(-1); return
      case 'e': case 'E': this.turn(1); return
      default: return
    }
    e.preventDefault()
  }

  // ── Salvar / abrir ─────────────────────────────────────

  private async save() {
    try {
      this.character.name = this.nameInput.value.trim() || 'Sem nome'
      this.nameInput.value = this.character.name
      await this.opts.storage.save(this.character)
      if (this.opts.activateOnSave !== false) await this.opts.storage.setActive(this.character.id)
      this.dirty = false
      this.refreshStatus()
      this.toast(this.opts.single || this.opts.activateOnSave === false ? `"${this.character.name}" salvo.` : `"${this.character.name}" salvo. É ele que aparece quando você testar ou jogar.`)
      this.opts.onSaved?.(structuredClone(this.character))
      return true
    } catch (err) {
      this.toast(`Não deu pra salvar: ${(err as Error).message}`, true)
      return false
    }
  }

  /** Baixa o personagem aberto como arquivo (vale em qualquer campanha). */
  private exportFile() {
    const name = this.nameInput.value.trim() || 'Sem nome'
    downloadText(characterFileName(name), exportCharacters([{ name, appearance: this.appearance }]))
    this.toast(`"${name}" exportado.`)
  }

  /** Abre um arquivo de personagem na tela (sem salvar). No modo jogador, troca o boneco que já existe. */
  private async importFile() {
    const text = await pickTextFile()
    if (text === null) return
    try {
      const [imported] = parseCharacterFile(text, this.data)
      if (this.dirty && !confirm('O personagem atual tem mudanças não salvas. Descartar?')) return
      this.character = this.opts.single ? { ...imported, id: this.character.id } : imported
      this.nameInput.value = this.character.name
      this.dirty = true
      this.afterLoad()
      this.refreshStatus()
      this.toast(`"${this.character.name}" importado. Salve pra guardar.`)
    } catch (err) {
      this.toast((err as Error).message, true)
    }
  }

  /** Fechar: com mudanças, pergunta se salva (OK) ou descarta (Cancelar). */
  private async goBack() {
    if (this.dirty && confirm(`Salvar "${this.nameInput.value || 'o personagem'}" antes de sair?\n\nOK = salvar · Cancelar = sair sem salvar`)) {
      if (!(await this.save())) return
    }
    this.dirty = false // sem o aviso de "sair da página"
    this.opts.back?.onClick()
  }

  private openCredits() {
    const close = this.modal('Créditos da arte', creditsBody(this.opts.assetBase),
      [h('button', { class: 'cp-btn cp-ghost', onclick: () => close() }, 'Fechar')])
  }

  private newCharacter() {
    if (this.dirty && !confirm('O personagem atual tem mudanças não salvas. Descartar?')) return
    this.character = newCharacter('Novo personagem', defaultAppearance(this.appearance.body))
    this.nameInput.value = this.character.name
    this.dirty = true
    this.afterLoad()
  }

  private afterLoad() {
    this.character.appearance = normalizeAppearance(this.data, this.character.appearance)
    this.baseThumb = null
    this.renderTabs()
    this.renderRows()
    this.recompose()
  }

  private async openList() {
    const list = h('div', { class: 'cp-list' })
    const close = this.modal('Personagens', [list], [h('button', { class: 'cp-btn cp-ghost', onclick: () => close() }, 'Fechar')])
    const render = async () => {
      let chars: CharacterSave[], active: string | null
      try {
        [chars, active] = await Promise.all([this.opts.storage.list(), this.opts.storage.getActive()])
      } catch (err) {
        list.replaceChildren(h('div', { class: 'cp-empty' }, `Não deu pra ler os personagens: ${(err as Error).message}`))
        return
      }
      list.replaceChildren()
      if (!chars.length) list.append(h('div', { class: 'cp-empty' }, 'Nenhum personagem salvo ainda.'))
      for (const c of chars) {
        const thumb = h('canvas', { class: 'cp-item-thumb', width: FRAME, height: FRAME }) as HTMLCanvasElement
        composeFrame(this.opts.assetBase, c.appearance).then((f) => thumb.getContext('2d')!.drawImage(f, 0, 0)).catch(() => {})
        list.append(h('div', { class: 'cp-item' },
          thumb,
          h('div', {}, h('b', {}, c.name), h('small', {}, c.id === active ? 'em uso no jogo' : new Date(c.updatedAt).toLocaleString('pt-BR'))),
          h('button', {
            class: 'cp-btn cp-primary',
            onclick: async () => {
              if (this.dirty && !confirm('O personagem atual tem mudanças não salvas. Descartar?')) return
              this.character = structuredClone(c)
              this.nameInput.value = c.name
              this.dirty = false
              await this.opts.storage.setActive(c.id)
              this.afterLoad()
              close()
            },
          }, 'Usar'),
          h('button', {
            class: 'cp-btn cp-ghost',
            title: 'Apagar',
            html: ICONS.trash,
            onclick: async () => {
              if (!confirm(`Apagar "${c.name}"? Não dá pra desfazer.`)) return
              try {
                await this.opts.storage.remove(c.id)
              } catch (err) {
                return this.toast(`Não deu pra apagar: ${(err as Error).message}`, true)
              }
              // apagou o que está aberto: ele continua na tela, mas agora não está salvo
              if (c.id === this.character.id) this.markDirty()
              render()
            },
          }),
        ))
      }
    }
    render()
  }

  private modal(title: string, body: Node[], foot: Node[]) {
    const close = () => {
      this.modals = this.modals.filter((m) => m !== close)
      bg.remove()
    }
    this.modals.push(close)
    const bg = h('div', { class: 'cp-modal-bg', onmousedown: (e: MouseEvent) => { if (e.target === bg) close() } },
      h('div', { class: 'cp-modal' }, h('h3', {}, title), ...body, h('div', { class: 'cp-modal-foot' }, ...foot)))
    this.root.append(bg)
    return close
  }

  private toast(msg: string, error = false) {
    const t = h('div', { class: `cp-toast${error ? ' cp-error' : ''}` }, msg)
    this.root.append(t)
    setTimeout(() => t.remove(), 2500)
  }
}

function pickSlots(a: Appearance, ids: string[]) {
  return Object.fromEntries(ids.filter((id) => a.slots[id]).map((id) => [id, a.slots[id]]))
}

/** drawImage que aceita um pedaço de origem que passa das bordas (a parte de fora fica vazia). */
function drawRegion(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number },
  sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number,
) {
  const kx = dw / sw
  const ky = dh / sh
  const cx0 = Math.max(0, sx)
  const cy0 = Math.max(0, sy)
  const cx1 = Math.min(img.width, sx + sw)
  const cy1 = Math.min(img.height, sy + sh)
  if (cx1 <= cx0 || cy1 <= cy0) return
  ctx.drawImage(img, cx0, cy0, cx1 - cx0, cy1 - cy0, dx + (cx0 - sx) * kx, dy + (cy0 - sy) * ky, (cx1 - cx0) * kx, (cy1 - cy0) * ky)
}
