// ────────────────────────────────────────────────────────
// Painel "Gerador de NPCs" do editor: analisa a zona aberta, sorteia gente que
// combina com o lugar (rosto, cabelo e roupa diferentes entre si) e deixa
// pôr cada um no mapa, onde ele fica até o mestre remover.
// ────────────────────────────────────────────────────────

import { h } from '../ui/dom'
import { loaderEl } from '../ui/loader'
import { ICONS } from './icons'
import { loadCharacterData, type CharacterData } from '../character/catalog'
import { composeFrame } from '../character/compose'
import { PROFILE_LABELS, analyzeZone, type ProfileId, type ZoneAnalysis } from '../npc/analyze'
import { generateBatch, generateNpc, type NpcDraft } from '../npc/generate'
import { parseCharacterFile, pickTextFile } from '../character/transfer'
import { CreatorUI } from '../character/CreatorUI'
import type { CharacterStorage } from '../character/storage'
import type { CharacterSave, Dir, ZoneNpc } from '../types'
import type { EditorState } from './EditorState'

const BATCH = 6
const TURN: Dir[] = ['down', 'left', 'up', 'right']

export interface NpcPanelHooks {
  assetBase: string
  /** Leva a câmera do editor até um ponto da zona. */
  focus(x: number, y: number): void
  toast(msg: string, error?: boolean): void
}

export class NpcPanel {
  readonly el: HTMLElement
  private data: CharacterData | null = null
  private analysis: ZoneAnalysis | null = null
  /** 'auto' = o estilo que a análise achou; senão o que o mestre escolheu. */
  private style: ProfileId | 'auto' = 'auto'
  private drafts: NpcDraft[] = []
  private zoneId = ''
  private body: HTMLElement
  private opened = false
  private off: () => void

  constructor(private state: EditorState, private hooks: NpcPanelHooks) {
    this.body = h('div', { class: 'vt-npc-body' })
    this.el = h('aside', { class: 'vt-npc', hidden: true, 'aria-label': 'Gerador de NPCs' },
      h('header', { class: 'vt-npc-head' },
        h('span', { class: 'vt-npc-title', html: `${ICONS.npc}<b>Gerador de NPCs</b>` }),
        h('button', { class: 'vt-btn vt-icononly', title: 'Fechar', html: ICONS.close, onclick: () => this.close() }),
      ),
      this.body,
    )
    this.off = state.on((c) => {
      if (!this.opened) return
      if (c === 'zone') this.refreshAnalysis(true)
      else if (c === 'npcs' || c === 'edit') this.renderList()
      else if (c === 'ui' && state.tool !== 'npc') this.renderList()
    })
  }

  get isOpen() { return this.opened }

  toggle() {
    if (this.opened) this.close()
    else void this.open()
  }

  async open() {
    this.opened = true
    this.el.hidden = false
    if (!this.data) {
      this.body.replaceChildren(h('div', { class: 'vt-npc-note', style: 'display:flex;justify-content:center' }, loaderEl(this.hooks.assetBase, true)))
      try {
        this.data = await loadCharacterData(this.hooks.assetBase)
      } catch (err) {
        this.body.replaceChildren(h('p', { class: 'vt-npc-note vt-error' }, `Não deu pra carregar o catálogo: ${(err as Error).message}`))
        return
      }
    }
    this.refreshAnalysis(true)
  }

  close() {
    this.opened = false
    this.el.hidden = true
    // largou o painel com um NPC pendurado no mouse: solta
    if (this.state.tool === 'npc') this.state.set({ tool: 'select', npcDraft: null })
  }

  destroy() {
    this.look?.close()
    this.off()
    this.el.remove()
  }

  // ── Conteúdo ───────────────────────────────────────────

  /** Reanalisa a zona (e sorteia uma leva nova quando o estilo mudou ou é a primeira vez). */
  private refreshAnalysis(regen: boolean) {
    if (!this.data) return
    const zone = this.state.zone
    this.analysis = analyzeZone(zone)
    const changedZone = this.zoneId !== zone.id
    this.zoneId = zone.id
    if (regen && (changedZone || this.drafts.length === 0)) this.newBatch()
    else this.render()
  }

  private get profile(): ProfileId {
    return this.style === 'auto' ? this.analysis?.profile ?? 'geral' : this.style
  }

  private newBatch() {
    if (!this.data) return
    this.drafts = generateBatch(this.data, this.profile, BATCH)
    this.render()
  }

  private render() {
    if (!this.analysis) return
    const a = this.analysis
    const select = h('select', {
      class: 'vt-select', title: 'Estilo dos NPCs',
      onchange: (e: Event) => { this.style = (e.target as HTMLSelectElement).value as ProfileId | 'auto'; this.newBatch() },
    },
      h('option', { value: 'auto' }, `Automático (${a.label})`),
      ...(Object.keys(PROFILE_LABELS) as ProfileId[]).map((id) => h('option', { value: id }, PROFILE_LABELS[id])),
    ) as HTMLSelectElement
    select.value = this.style

    const grid = h('div', { class: 'vt-npc-grid' })
    this.drafts.forEach((d, i) => grid.append(this.card(d, i)))

    this.listEl = h('div', { class: 'vt-npc-list' })
    this.body.replaceChildren(
      h('div', { class: 'vt-npc-analysis' },
        h('b', {}, `Zona: ${a.label}`),
        a.reasons.length ? h('small', {}, `Por causa de: ${a.reasons.join(', ')}`) : null,
        select,
      ),
      h('div', { class: 'vt-npc-actions' },
        h('button', { class: 'vt-btn vt-primary', html: `${ICONS.star}<span>Gerar novos</span>`, onclick: () => this.newBatch() }),
        h('button', { class: 'vt-btn', title: 'Usar um personagem salvo (arquivo) como NPC', html: `${ICONS.upload}<span>Importar personagem</span>`, onclick: () => void this.importCharacter() }),
      ),
      grid,
      h('h4', {}, 'NPCs desta zona'),
      this.listEl,
    )
    this.renderList()
  }

  private listEl: HTMLElement | null = null

  private card(d: NpcDraft, i: number) {
    const canvas = h('canvas', { class: 'vt-npc-thumb', width: 64, height: 64 }) as HTMLCanvasElement
    this.paint(canvas, d)
    return h('div', { class: 'vt-npc-card' },
      h('button', { class: 'vt-btn vt-icononly vt-npc-reroll', title: 'Sortear outro com o mesmo estilo', html: ICONS.star, onclick: () => this.reroll(i) }),
      canvas,
      h('b', { class: 'vt-npc-name', title: d.name }, d.name),
      h('small', {}, d.role),
      h('div', { class: 'vt-npc-row' },
        h('button', { class: 'vt-btn vt-primary', title: 'Escolher e clicar no mapa pra posicionar', html: `${ICONS.plus}<span>Adicionar</span>`, onclick: () => this.pick(d) }),
      ),
    )
  }

  private async paint(canvas: HTMLCanvasElement, d: NpcDraft) {
    try {
      const frame = await composeFrame(this.hooks.assetBase, d.appearance)
      const ctx = canvas.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, 64, 64)
      ctx.drawImage(frame, 0, 0)
    } catch { /* sem miniatura, o cartão continua útil */ }
  }

  private reroll(i: number) {
    if (!this.data) return
    this.drafts[i] = generateNpc(this.data, { profile: this.profile })
    this.render()
  }

  /** Personagem de um arquivo (o do criador de personagens) vira NPC: o clique seguinte no mapa o põe. */
  private async importCharacter() {
    if (!this.data) return
    try {
      const text = await pickTextFile()
      if (text == null) return
      const [first] = parseCharacterFile(text, this.data)
      this.pick({ name: first.name, role: '', appearance: first.appearance })
    } catch (err) {
      this.hooks.toast((err as Error).message, true)
    }
  }

  /** Escolheu: o NPC vai pro mouse e o próximo clique no mapa o põe na zona. */
  private pick(d: NpcDraft) {
    this.state.set({ tool: 'npc', npcDraft: { ...d, dir: 'down' } })
    this.hooks.toast('Clique no mapa pra pôr o NPC (Esc cancela).')
    this.renderList()
  }

  private renderList() {
    const el = this.listEl
    if (!el) return
    const npcs = this.state.zone.npcs ?? []
    if (!npcs.length) {
      el.replaceChildren(h('p', { class: 'vt-npc-note' }, 'Nenhum NPC aqui ainda.'))
      return
    }
    el.replaceChildren(...npcs.map((n) => this.row(n)))
  }

  private row(n: ZoneNpc) {
    const canvas = h('canvas', { class: 'vt-npc-mini', width: 64, height: 64 }) as HTMLCanvasElement
    void this.paint(canvas, n)
    const moving = this.state.npcDraft?.id === n.id
    return h('div', { class: `vt-npc-item${moving ? ' vt-on' : ''}` },
      canvas,
      h('div', { class: 'vt-npc-info' }, h('b', { title: n.name }, n.name), h('small', {}, n.role)),
      h('button', { class: 'vt-btn vt-icononly', title: 'Ver no mapa', html: ICONS.center, onclick: () => this.hooks.focus(n.x, n.y - 20) }),
      h('button', {
        class: `vt-btn vt-icononly${n.showName ? ' vt-on' : ''}`,
        title: n.showName ? 'Nome em cima da cabeça: ligado' : 'Nome em cima da cabeça: desligado',
        html: ICONS.nametag, onclick: () => this.toggleName(n),
      }),
      h('button', { class: 'vt-btn vt-icononly', title: 'Alterar a aparência (o mesmo criador do personagem)', html: ICONS.person, onclick: () => this.editLook(n) }),
      h('button', { class: 'vt-btn vt-icononly', title: 'Virar (muda pra onde ele olha)', html: ICONS.flip, onclick: () => this.turn(n) }),
      h('button', { class: 'vt-btn vt-icononly', title: 'Mover: clique no novo lugar', html: ICONS.select, onclick: () => this.move(n) }),
      h('button', { class: 'vt-btn vt-icononly vt-danger', title: 'Remover da zona', html: ICONS.trash, onclick: () => this.remove(n) }),
    )
  }

  /** Abre o criador de personagem (o mesmo do jogador) com a aparência do NPC; Aplicar muda o NPC na zona. */
  private editLook(n: ZoneNpc) {
    if (this.look) return
    let kept: CharacterSave[] = [{ version: 1, id: n.id, name: n.name, appearance: structuredClone(n.appearance), updatedAt: Date.now() }]
    const storage: CharacterStorage = {
      list: async () => structuredClone(kept),
      save: async (c) => { kept = [structuredClone(c)] },
      remove: async () => {},
      getActive: async () => n.id,
      setActive: async () => {},
    }
    const host = h('div', { class: 'vt-npc-look' })
    document.body.append(host)
    const close = () => { ui.destroy(); host.remove(); this.look = null }
    const ui = new CreatorUI(host, {
      assetBase: this.hooks.assetBase,
      storage,
      single: true,
      title: 'Aparência do NPC',
      saveLabel: 'Aplicar',
      activateOnSave: false,
      back: { label: 'Voltar ao mapa', onClick: close },
      onSaved: (c) => {
        const cur = (this.state.zone.npcs ?? []).find((x) => x.id === n.id)
        if (cur) {
          this.state.checkpoint()
          cur.name = c.name
          cur.appearance = c.appearance
          this.state.emit('npcs')
          this.state.edited()
          this.hooks.toast(`"${cur.name}" atualizado.`)
        }
        close()
      },
    })
    this.look = { close }
  }

  private look: { close: () => void } | null = null

  private toggleName(n: ZoneNpc) {
    this.state.checkpoint()
    if (n.showName) delete n.showName
    else n.showName = true
    this.state.emit('npcs')
    this.state.edited()
  }

  private turn(n: ZoneNpc) {
    this.state.checkpoint()
    n.dir = TURN[(TURN.indexOf(n.dir) + 1) % TURN.length]
    this.state.emit('npcs')
    this.state.edited()
  }

  private move(n: ZoneNpc) {
    this.state.set({ tool: 'npc', npcDraft: { id: n.id, name: n.name, role: n.role, appearance: n.appearance, dir: n.dir, showName: n.showName } })
    this.hooks.toast('Clique no novo lugar (Esc cancela).')
    this.renderList()
  }

  private remove(n: ZoneNpc) {
    this.state.checkpoint()
    this.state.zone.npcs = (this.state.zone.npcs ?? []).filter((x) => x.id !== n.id)
    if (!this.state.zone.npcs.length) delete this.state.zone.npcs
    if (this.state.npcDraft?.id === n.id) this.state.set({ tool: 'select', npcDraft: null })
    this.state.emit('npcs')
    this.state.edited()
    this.hooks.toast(`"${n.name}" removido.`)
  }
}
