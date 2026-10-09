// ────────────────────────────────────────────────────────
// Estado do editor, fora do Phaser: a zona sendo editada, a ferramenta
// escolhida e o histórico de desfazer/refazer. A cena e a interface
// escutam as mudanças por aqui — nenhuma fala direto com a outra.
// ────────────────────────────────────────────────────────

import type { Appearance, Dir, WorldData, ZoneData, ZoneLight, ZoneObject } from '../types'
import { ROOM_PRESETS, type RoomStyle } from '../world/rooms'
import type { ZoneSummary } from '../storage'

export type Tool = 'brush' | 'fill' | 'erase' | 'object' | 'select' | 'room' | 'light' | 'portal' | 'spawn' | 'npc' | 'ruler'

/** NPC esperando lugar no mapa (gerador de NPCs): o clique seguinte o põe na zona. */
export interface NpcDraft {
  /** Só quando está sendo movido: mantém o id. */
  id?: string
  name: string
  role: string
  appearance: Appearance
  dir?: Dir
  /** Só quando está sendo movido: mantém o nome em cima da cabeça como estava. */
  showName?: boolean
  /** NPC especial: a ficha a que ele pertence. */
  sheet?: string
}

/** Jeito de uma luz solta (o que a ferramenta Luz põe; a selecionada é editada no lugar). */
export type LightLook = Pick<ZoneLight, 'radius' | 'color' | 'intensity' | 'flicker'>

/**
 * zone   = a zona inteira mudou (desfazer, abrir, nova) → redesenhar tudo
 * edit   = a zona mudou por uma edição que a cena já aplicou
 * ui     = ferramenta/opções mudaram
 * cursor = o mouse andou
 * world  = dados do mundo ou lista de zonas salvas mudaram
 * objects = objetos mudaram no lugar (espelhar, trocar variante) → reaplicar sprites
 * catalog = o catálogo de objetos mudou (curadoria) → refazer sprites e paleta
 * view   = a câmera mudou (zoom): só o indicador de zoom acompanha
 * npcs   = a lista de NPCs da zona mudou (pôs, tirou, virou)
 */
export type Change = 'zone' | 'edit' | 'ui' | 'cursor' | 'world' | 'objects' | 'catalog' | 'view' | 'npcs'

const HISTORY_MAX = 100

export class EditorState {
  zone: ZoneData
  tool: Tool = 'brush'
  terrain = 'dirt'
  brush = 2
  objectKind: string | null = null
  /** O objeto a carimbar sai espelhado. */
  flip = false
  /** Estilo dos cômodos novos (ferramenta Cômodo). */
  roomStyle: RoomStyle = { ...ROOM_PRESETS[0].style }
  /** Ferramenta Cômodo: criar cômodo, riscar parede interna ou abrir porta. */
  roomMode: 'room' | 'wall' | 'door' = 'room'
  snap = false
  showGrid = false
  showCollision = false
  /** Índices dos objetos selecionados em zone.objects (vários com Shift ou retângulo). */
  selected: number[] = []
  /** Objetos copiados (Ctrl C), com posição relativa ao centro do grupo. Vale entre zonas. */
  clipboard: ZoneObject[] = []
  /** NPC esperando lugar no mapa (ferramenta npc). */
  npcDraft: NpcDraft | null = null
  /** Pasta dos assets (os NPCs montam o boneco a partir dela). */
  assetBase = './assets/'
  /** Há uma janela aberta por cima do editor (o teclado é dela). */
  modalOpen = false
  /** Id da saída selecionada (ferramenta de saída). */
  selectedPortal: string | null = null
  /** Id da luz solta selecionada (ferramenta Luz). */
  selectedLight: string | null = null
  /** Como sai a próxima luz solta. */
  lightLook: LightLook = { radius: 112, color: '#ffa050', intensity: 1, flicker: 0.25 }
  /** Mostrar a iluminação no editor (escuro da hora, luzes, sombras). */
  lightPreview = true
  /** Zona em ciclo dia/noite: que hora mostrar no editor (só prévia, não é salva). */
  previewHour = 12
  /** O mundo e as zonas salvas nele (pro mapa do mundo e destinos das saídas). */
  world: WorldData | null = null
  zones: ZoneSummary[] = []
  cursor: { tx: number; ty: number } | null = null
  zoom = 2
  /** Centro da câmera do editor (pra voltar ao mesmo lugar depois de testar). */
  view: { x: number; y: number } | null = null
  /** Há mudanças não salvas. */
  dirty = false

  private undoStack: string[] = []
  private redoStack: string[] = []
  private listeners = new Set<(c: Change) => void>()

  constructor(zone: ZoneData) {
    this.zone = zone
  }

  on(fn: (c: Change) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(c: Change) {
    for (const fn of this.listeners) fn(c)
  }

  set(patch: Partial<Pick<EditorState, 'tool' | 'terrain' | 'brush' | 'objectKind' | 'flip' | 'roomStyle' | 'roomMode' | 'snap' | 'showGrid' | 'showCollision' | 'selected' | 'selectedPortal' | 'selectedLight' | 'lightLook' | 'lightPreview' | 'previewHour' | 'zoom' | 'npcDraft'>>) {
    Object.assign(this, patch)
    if (patch.tool && patch.tool !== 'select') this.selected = []
    if (patch.tool && patch.tool !== 'portal') this.selectedPortal = null
    if (patch.tool && patch.tool !== 'light') this.selectedLight = null
    this.emit('ui')
  }

  /** Guarda o estado atual ANTES de uma edição (uma pincelada inteira = 1 passo). */
  checkpoint() {
    this.undoStack.push(JSON.stringify(this.zone))
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift()
    this.redoStack = []
    this.dirty = true
  }

  /** Avisa que uma edição foi aplicada (a cena já desenhou). */
  edited() {
    this.dirty = true
    this.emit('edit')
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }

  undo() {
    const prev = this.undoStack.pop()
    if (!prev) return
    this.redoStack.push(JSON.stringify(this.zone))
    this.replace(JSON.parse(prev))
  }

  redo() {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(JSON.stringify(this.zone))
    this.replace(JSON.parse(next))
  }

  /** Troca a zona inteira (abrir/nova): zera o histórico. */
  load(zone: ZoneData) {
    this.undoStack = []
    this.redoStack = []
    this.replace(zone, false)
  }

  private replace(zone: ZoneData, dirty = true) {
    this.zone = zone
    this.selected = []
    this.selectedPortal = null
    this.selectedLight = null
    this.dirty = dirty
    this.emit('zone')
  }

  markSaved() {
    this.dirty = false
    this.emit('ui')
  }

  /** O objeto selecionado, quando é um só. */
  get single() {
    return this.selected.length === 1 ? this.zone.objects[this.selected[0]] ?? null : null
  }

  get light() {
    return this.zone.lights?.find((l) => l.id === this.selectedLight) ?? null
  }

  get portal() {
    return this.zone.portals.find((p) => p.id === this.selectedPortal) ?? null
  }

  /** Nome de uma zona pelo id (a atual pode ainda não estar salva). */
  zoneName(id: string) {
    if (id === this.zone.id) return this.zone.name
    return this.zones.find((z) => z.id === id)?.name ?? '(zona apagada)'
  }
}
