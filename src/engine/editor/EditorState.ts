// ────────────────────────────────────────────────────────
// Estado do editor, fora do Phaser: a zona sendo editada, a ferramenta
// escolhida e o histórico de desfazer/refazer. A cena e a interface
// escutam as mudanças por aqui — nenhuma fala direto com a outra.
// ────────────────────────────────────────────────────────

import type { WorldData, ZoneData, ZoneObject } from '../types'
import { ROOM_PRESETS, type RoomStyle } from '../world/rooms'
import type { ZoneSummary } from '../storage'

export type Tool = 'brush' | 'fill' | 'erase' | 'object' | 'select' | 'room' | 'portal' | 'spawn'

/**
 * zone   = a zona inteira mudou (desfazer, abrir, nova) → redesenhar tudo
 * edit   = a zona mudou por uma edição que a cena já aplicou
 * ui     = ferramenta/opções mudaram
 * cursor = o mouse andou
 * world  = dados do mundo ou lista de zonas salvas mudaram
 * objects = objetos mudaram no lugar (espelhar, trocar variante) → reaplicar sprites
 * catalog = o catálogo de objetos mudou (curadoria) → refazer sprites e paleta
 * view   = a câmera mudou (zoom): só o indicador de zoom acompanha
 */
export type Change = 'zone' | 'edit' | 'ui' | 'cursor' | 'world' | 'objects' | 'catalog' | 'view'

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
  /** Há uma janela aberta por cima do editor (o teclado é dela). */
  modalOpen = false
  /** Id da saída selecionada (ferramenta de saída). */
  selectedPortal: string | null = null
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

  set(patch: Partial<Pick<EditorState, 'tool' | 'terrain' | 'brush' | 'objectKind' | 'flip' | 'roomStyle' | 'roomMode' | 'snap' | 'showGrid' | 'showCollision' | 'selected' | 'selectedPortal' | 'zoom'>>) {
    Object.assign(this, patch)
    if (patch.tool && patch.tool !== 'select') this.selected = []
    if (patch.tool && patch.tool !== 'portal') this.selectedPortal = null
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

  get portal() {
    return this.zone.portals.find((p) => p.id === this.selectedPortal) ?? null
  }

  /** Nome de uma zona pelo id (a atual pode ainda não estar salva). */
  zoneName(id: string) {
    if (id === this.zone.id) return this.zone.name
    return this.zones.find((z) => z.id === id)?.name ?? '(zona apagada)'
  }
}
