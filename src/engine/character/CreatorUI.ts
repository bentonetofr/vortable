// ────────────────────────────────────────────────────────
// Criador de personagem: prévia animada à esquerda; à direita, abas
// (Corpo, Cabelo, Roupa, Acessórios, Marcas) com os espaços de cada uma.
// Cada espaço tem uma grade de opções com miniatura, as cores de cada
// canal e as variantes. Personagens ficam no CharacterStorage.
// ────────────────────────────────────────────────────────

import editorCss from '../editor/editor.css?inline'
import css from './creator.css?inline'
import { h, injectStyle } from '../ui/dom'
import { creditsBody } from '../ui/credits'
import { ICONS } from '../editor/icons'
import {
  BODY_LABELS, defaultAppearance, itemLabel, itemsForSlot, loadCharacterData, normalizeAppearance, randomAppearance, swatch,
  type CharItem, type CharacterData,
} from './catalog'
import { ANIMS, FRAME, composeAll, composeFrame, type AnimName } from './compose'
import { newCharacter, type CharacterStorage } from './storage'
import { characterFileName, downloadText, exportCharacters, parseCharacterFile, pickTextFile } from './transfer'
import type { Appearance, AppearanceItem, BodyType, CharacterSave } from '../types'

export interface CreatorOptions {
  assetBase: string
  storage: CharacterStorage
  /** Botão "voltar" (ex.: pro editor). Sem ele, o botão não aparece. */
  back?: { label: string; onClick: () => void }
  /**
   * Modo jogador: um boneco só, sem lista nem "Novo". Salvar guarda o boneco
   * e chama `onSaved` (é como o jogador entra no jogo pela primeira vez).
   */
  single?: boolean
  /** Título da barra de cima (padrão: "Crie seu boneco" no modo jogador). */
  title?: string
  saveLabel?: string
  /** Salvar também põe o boneco em uso (padrão: sim). O mestre cria NPCs sem tomar o lugar do dele. */
  activateOnSave?: boolean
  onSaved?: (c: CharacterSave) => void
}

const ANIM_LABELS: Record<AnimName, string> = { idle: 'Parado', walk: 'Andando', run: 'Correndo' }
const PREVIEW_SCALE = 4

export class CreatorUI {
  readonly root: HTMLDivElement
  private data!: CharacterData
  private character: CharacterSave
  private dirty = false
  private group = 'Corpo'
  private slot = 'body'
  private anim: AnimName = 'walk'
  private dir = 2 // linha "down"
  private sheets: Record<AnimName, HTMLCanvasElement> | null = null
  private composeToken = 0
  private raf = 0
  private nameInput: HTMLInputElement
  private preview: HTMLCanvasElement
  private tabsEl: HTMLDivElement
  private slotsEl: HTMLDivElement
  private optionsEl: HTMLDivElement
  private statusEl: HTMLElement
  private animButtons = new Map<AnimName, HTMLButtonElement>()
  private thumbObserver: IntersectionObserver | null = null
  private baseThumb: Promise<HTMLCanvasElement> | null = null
  private modals: (() => void)[] = []
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.modals.length) this.modals[this.modals.length - 1]()
  }
  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.dirty) e.preventDefault()
  }

  constructor(parent: HTMLElement, private opts: CreatorOptions) {
    injectStyle('editor', editorCss)
    injectStyle('creator', css)
    this.character = newCharacter('Novo personagem', defaultAppearance())

    this.nameInput = h('input', {
      class: 'vt-name',
      value: this.character.name,
      title: 'Nome do personagem',
      oninput: () => {
        this.character.name = this.nameInput.value
        this.markDirty()
      },
    }) as HTMLInputElement
    this.preview = h('canvas', { class: 'vt-preview-canvas', width: FRAME * PREVIEW_SCALE, height: FRAME * PREVIEW_SCALE }) as HTMLCanvasElement
    this.tabsEl = h('div', { class: 'vt-tabs vt-creator-tabs' })
    this.slotsEl = h('div', { class: 'vt-slots' })
    this.optionsEl = h('div', { class: 'vt-options' })
    this.statusEl = h('footer', { class: 'vt-status' })

    const animBar = h('div', { class: 'vt-chips vt-center' })
    for (const a of ['idle', 'walk', 'run'] as AnimName[]) {
      const b = h('button', { class: 'vt-chip', onclick: () => { this.anim = a; this.refreshAnimButtons() } }, ANIM_LABELS[a]) as HTMLButtonElement
      this.animButtons.set(a, b)
      animBar.append(b)
    }

    this.root = h('div', { class: 'vt-root vt-creator' },
      h('header', { class: 'vt-top' },
        h('span', { class: 'vt-brand' }, 'Vortable'),
        h('span', { class: 'vt-top-title' }, opts.title ?? (opts.single ? 'Crie seu boneco' : 'Personagem')),
        this.nameInput,
        h('span', { class: 'vt-sep' }),
        opts.single ? null : this.iconBtn(ICONS.plus, 'Novo', () => this.newCharacter()),
        opts.single ? null : this.iconBtn(ICONS.open, 'Personagens', () => this.openList()),
        this.iconBtn(ICONS.save, opts.saveLabel ?? 'Salvar', () => this.save(), opts.single ? 'vt-primary' : ''),
        this.iconBtn(ICONS.download, 'Exportar', () => this.exportFile()),
        this.iconBtn(ICONS.upload, 'Importar', () => void this.importFile()),
        h('span', { class: 'vt-spacer' }),
        opts.back ? this.iconBtn(ICONS.world, opts.back.label, () => this.goBack(), 'vt-primary') : null,
      ),
      h('main', { class: 'vt-creator-body' },
        h('section', { class: 'vt-preview' },
          h('div', { class: 'vt-preview-stage' }, this.preview),
          h('div', { class: 'vt-row vt-center' },
            h('button', { class: 'vt-btn', title: 'Girar', onclick: () => this.turn(-1) }, '⟲'),
            h('button', { class: 'vt-btn', title: 'Girar', onclick: () => this.turn(1) }, '⟳'),
          ),
          animBar,
          h('button', { class: 'vt-btn vt-random', html: `${ICONS.star}<span>Aleatório</span>`, onclick: () => this.randomize() }),
        ),
        h('section', { class: 'vt-custom' }, this.tabsEl, h('div', { class: 'vt-custom-body' }, this.slotsEl, this.optionsEl)),
      ),
      this.statusEl,
    )
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    parent.append(this.root)
    this.root.addEventListener('click', (e) => (e.target as HTMLElement).closest('button')?.blur())
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('beforeunload', this.onBeforeUnload)
    this.statusEl.textContent = 'Carregando o catálogo...'
    this.init()
  }

  private async init() {
    try {
      this.data = await loadCharacterData(this.opts.assetBase)
    } catch (err) {
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
    this.renderSlots()
    this.renderOptions()
    this.refreshAnimButtons()
    this.recompose()
    this.loop()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.thumbObserver?.disconnect()
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    this.root.remove()
  }

  // ── Montagem ───────────────────────────────────────────

  private iconBtn(icon: string, label: string, onclick: () => void, extra = '') {
    return h('button', { class: `vt-btn ${extra}`, title: label, html: `${icon}<span class="vt-label">${label}</span>`, onclick })
  }

  private get appearance() {
    return this.character.appearance
  }

  private groups() {
    return [...new Set(this.data.catalog.slots.map((s) => s.group))]
  }

  private renderTabs() {
    this.tabsEl.replaceChildren(...this.groups().map((g) => h('button', {
      class: `vt-tab${g === this.group ? ' vt-on' : ''}`,
      onclick: () => {
        this.group = g
        this.slot = this.data.catalog.slots.find((s) => s.group === g)!.id
        this.renderTabs()
        this.renderSlots()
        this.renderOptions()
      },
    }, g)))
  }

  /** Lista de espaços da aba, com o item escolhido em cada um. */
  private renderSlots() {
    const a = this.appearance
    const slots = this.data.catalog.slots.filter((s) => s.group === this.group)
    this.slotsEl.replaceChildren(...slots
      .filter((s) => itemsForSlot(this.data, s.id, a.body).length)
      .map((s) => {
        const chosen = a.slots[s.id]
        const item = chosen && this.data.byId.get(chosen.id)
        return h('button', {
          class: `vt-slot${s.id === this.slot ? ' vt-on' : ''}${item ? ' vt-filled' : ''}`,
          onclick: () => {
            this.slot = s.id
            this.renderSlots()
            this.renderOptions()
          },
        }, h('b', {}, s.label), h('small', {}, item ? itemLabel(item) : 'nenhum'))
      }))
  }

  /** Opções do espaço escolhido: corpo/pele (no Corpo), itens, cores e variantes. */
  private renderOptions() {
    const a = this.appearance
    const parts: Node[] = []

    if (this.slot === 'body') {
      parts.push(h('h4', {}, 'Tipo de corpo'), h('div', { class: 'vt-chips' }, ...this.data.catalog.bodies.map((b) => h('button', {
        class: `vt-chip${a.body === b ? ' vt-on' : ''}`,
        onclick: () => this.setBody(b),
      }, BODY_LABELS[b]))))
      parts.push(h('h4', {}, 'Pele'), this.swatches('body', a.skin, (c) => this.update((x) => { x.skin = c })))
    }

    const slotDef = this.data.catalog.slots.find((s) => s.id === this.slot)!
    const items = itemsForSlot(this.data, this.slot, a.body)
    const chosen = a.slots[this.slot]
    const current = chosen && this.data.byId.get(chosen.id)

    // cores e variantes do item escolhido (antes da grade: é o que mais se mexe)
    if (current) {
      for (const ch of current.colors ?? []) {
        if (ch.material === 'body' && current.matchBody) continue
        const label = ch.label ?? (current.colors!.length > 1 ? `Cor (${ch.material})` : 'Cor')
        parts.push(h('h4', {}, label), this.swatches(ch.material, chosen.colors?.[ch.key] ?? null, (c) =>
          this.update((x) => { (x.slots[this.slot].colors ??= {})[ch.key] = c })))
      }
      if (current.variants && current.variants.length > 1) {
        parts.push(h('h4', {}, 'Variante'), h('div', { class: 'vt-chips' }, ...current.variants.map((v) => h('button', {
          class: `vt-chip${chosen.variant === v ? ' vt-on' : ''}`,
          onclick: () => this.update((x) => { x.slots[this.slot].variant = v }),
        }, v.replace(/_/g, ' ')))))
      }
    }

    parts.push(h('h4', {}, `${slotDef.label} — ${items.length} opç${items.length === 1 ? 'ão' : 'ões'}`))
    const grid = h('div', { class: 'vt-grid vt-char-grid' })
    if (!slotDef.required) {
      grid.append(h('button', {
        class: `vt-cell vt-none${!chosen ? ' vt-on' : ''}`,
        title: 'Nenhum',
        onclick: () => this.update((x) => { delete x.slots[this.slot] }),
      }, h('span', {}, 'Nenhum')))
    }
    this.thumbObserver?.disconnect()
    this.thumbObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        this.thumbObserver!.unobserve(e.target)
        this.drawThumb(e.target as HTMLElement)
      }
    }, { root: this.optionsEl, rootMargin: '120px' })
    for (const item of items) {
      const cell = h('button', {
        class: `vt-cell${chosen?.id === item.id ? ' vt-on' : ''}`,
        title: itemLabel(item),
        'data-item': item.id,
        onclick: () => this.chooseItem(item),
      }, h('canvas', { width: FRAME, height: FRAME }), h('span', {}, itemLabel(item)))
      grid.append(cell)
      this.thumbObserver.observe(cell)
    }
    parts.push(grid)
    this.optionsEl.replaceChildren(...parts)
  }

  private swatches(material: string, selected: string | null, onPick: (color: string) => void) {
    const names = Object.keys(this.data.palettes[material] ?? {})
    return h('div', { class: 'vt-swatches' }, ...names.map((n) => h('button', {
      class: `vt-swatch${n === selected ? ' vt-on' : ''}`,
      title: n.replace(/_/g, ' '),
      style: `background:${swatch(this.data.palettes, material, n)}`,
      onclick: () => onPick(n),
    })))
  }

  /** Miniatura: o item sobre o corpo e a cabeça atuais (meio apagados). */
  private async drawThumb(cell: HTMLElement) {
    const id = cell.dataset.item!
    const item = this.data.byId.get(id)
    const canvas = cell.querySelector('canvas')
    if (!item || !canvas) return
    const a = this.appearance
    const chosen: AppearanceItem = a.slots[this.slot]?.id === id
      ? a.slots[this.slot]
      : { id, ...(item.variants ? { variant: item.variants[0] } : {}), colors: this.carryColors(item) }
    try {
      const [base, frame] = await Promise.all([
        (this.baseThumb ??= composeFrame(this.opts.assetBase, { ...a, slots: pickSlots(a, ['body', 'head']) })),
        composeFrame(this.opts.assetBase, { ...a, slots: { [this.slot]: chosen } }),
      ])
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, FRAME, FRAME)
      if (this.slot !== 'body' && this.slot !== 'head') {
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
  private carryColors(item: CharItem) {
    const prev = this.appearance.slots[this.slot]
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

  private update(fn: (a: Appearance) => void, rerenderSlots = true) {
    const a = structuredClone(this.appearance)
    fn(a)
    this.character.appearance = normalizeAppearance(this.data, a)
    this.markDirty()
    this.baseThumb = null
    if (rerenderSlots) this.renderSlots()
    this.renderOptions()
    this.recompose()
  }

  private chooseItem(item: CharItem) {
    this.update((a) => {
      a.slots[this.slot] = { id: item.id, ...(item.variants ? { variant: item.variants[0] } : {}), colors: this.carryColors(item) }
    })
  }

  private setBody(body: BodyType) {
    if (body === this.appearance.body) return
    this.update((a) => {
      a.body = body
      // cabeça humana acompanha o corpo
      const head = a.slots.head?.id ?? ''
      if (head.includes('/human/')) {
        const other = body === 'male' ? head.replace('_female', '_male') : head.replace(/_male/, '_female')
        if (this.data.byId.has(other)) a.slots.head = { ...a.slots.head, id: other }
      }
    })
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
    for (const [a, b] of this.animButtons) b.classList.toggle('vt-on', a === this.anim)
  }

  private markDirty() {
    this.dirty = true
    this.refreshStatus()
  }

  private refreshStatus() {
    if (!this.data) return // catálogo ainda não carregou (ou falhou)
    const n = Object.keys(this.appearance.slots).length
    this.statusEl.replaceChildren(
      h('span', {}, `${this.data.catalog.items.length} itens no catálogo`),
      h('span', {}, `${n} peças neste personagem`),
      this.dirty ? h('span', { class: 'vt-dirty' }, '● não salvo') : h('span', {}, 'salvo'),
      h('span', { class: 'vt-hint' }, 'Arte: Liberated Pixel Cup (LPC) — CC-BY-SA / GPL / OGA-BY · ',
        h('button', { class: 'vt-link', onclick: () => this.openCredits() }, 'ver créditos')),
    )
  }

  /** Remonta as folhas da prévia (a mais recente vence se clicarem rápido). */
  private async recompose() {
    const token = ++this.composeToken
    try {
      const sheets = await composeAll(this.opts.assetBase, this.appearance)
      if (token === this.composeToken) this.sheets = sheets
    } catch (err) {
      this.statusEl.textContent = `Erro montando o personagem: ${(err as Error).message}`
    }
    this.refreshStatus()
  }

  /** Prévia animada (desenha a folha da animação escolhida, quadro a quadro). */
  private loop() {
    const ctx = this.preview.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const start = performance.now()
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick)
      const sheet = this.sheets?.[this.anim]
      ctx.clearRect(0, 0, this.preview.width, this.preview.height)
      if (!sheet) return
      const { frames, rate } = ANIMS[this.anim]
      const first = this.anim === 'walk' ? 1 : 0
      const count = frames - first
      const col = first + (Math.floor(((now - start) / 1000) * rate) % count)
      const size = FRAME * PREVIEW_SCALE
      ctx.drawImage(sheet, col * FRAME, this.dir * FRAME, FRAME, FRAME, 0, 0, size, size)
    }
    this.raf = requestAnimationFrame(tick)
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

  /** Voltar: com mudanças, pergunta se salva (OK) ou descarta (Cancelar). */
  private async goBack() {
    if (this.dirty && confirm(`Salvar "${this.nameInput.value || 'o personagem'}" antes de voltar?\n\nOK = salvar · Cancelar = sair sem salvar`)) {
      if (!(await this.save())) return
    }
    this.dirty = false // sem o aviso de "sair da página"
    this.opts.back?.onClick()
  }

  private openCredits() {
    const close = this.modal('Créditos da arte', creditsBody(this.opts.assetBase),
      [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')])
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
    this.renderSlots()
    this.renderOptions()
    this.recompose()
  }

  private async openList() {
    const list = h('div', { class: 'vt-list' })
    const close = this.modal('Personagens', [list], [h('button', { class: 'vt-btn', onclick: () => close() }, 'Fechar')])
    const render = async () => {
      let chars: CharacterSave[], active: string | null
      try {
        [chars, active] = await Promise.all([this.opts.storage.list(), this.opts.storage.getActive()])
      } catch (err) {
        list.replaceChildren(h('div', { class: 'vt-empty' }, `Não deu pra ler os personagens: ${(err as Error).message}`))
        return
      }
      list.replaceChildren()
      if (!chars.length) list.append(h('div', { class: 'vt-empty' }, 'Nenhum personagem salvo ainda.'))
      for (const c of chars) {
        const thumb = h('canvas', { class: 'vt-item-thumb', width: FRAME, height: FRAME }) as HTMLCanvasElement
        composeFrame(this.opts.assetBase, c.appearance).then((f) => thumb.getContext('2d')!.drawImage(f, 0, 0)).catch(() => {})
        list.append(h('div', { class: 'vt-item' },
          thumb,
          h('div', {}, h('b', {}, c.name), h('small', {}, c.id === active ? 'em uso no jogo' : new Date(c.updatedAt).toLocaleString('pt-BR'))),
          h('button', {
            class: 'vt-btn vt-primary',
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
            class: 'vt-btn vt-danger',
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
    const bg = h('div', { class: 'vt-modal-bg', onmousedown: (e: MouseEvent) => { if (e.target === bg) close() } },
      h('div', { class: 'vt-modal' }, h('h3', {}, title), h('div', { class: 'vt-modal-body' }, ...body), h('div', { class: 'vt-modal-foot' }, ...foot)))
    this.root.append(bg)
    return close
  }

  private toast(msg: string, error = false) {
    const t = h('div', { class: `vt-toast${error ? ' vt-error' : ''}` }, msg)
    this.root.append(t)
    setTimeout(() => t.remove(), 2500)
  }
}

function pickSlots(a: Appearance, ids: string[]) {
  return Object.fromEntries(ids.filter((id) => a.slots[id]).map((id) => [id, a.slots[id]]))
}
