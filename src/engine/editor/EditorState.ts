// ────────────────────────────────────────────────────────
// Estado do editor, fora do Phaser: a zona sendo editada, a ferramenta
// escolhida e o histórico de desfazer/refazer. A cena e a interface
// escutam as mudanças por aqui — nenhuma fala direto com a outra.
// ────────────────────────────────────────────────────────

import type { ZoneData } from '../types'

export type Tool = 'brush' | 'fill' | 'erase' | 'object' | 'select' | 'spawn'

/**
 * zone   = a zona inteira mudou (desfazer, abrir, nova) → redesenhar tudo
 * edit   = a zona mudou por uma edição que a cena já aplicou
 * ui     = ferramenta/opções mudaram
 * cursor = o mouse andou
 */
export type Change = 'zone' | 'edit' | 'ui' | 'cursor'

const HISTORY_MAX = 100

export class EditorState {
  zone: ZoneData
  tool: Tool = 'brush'
  terrain = 'dirt'
  brush = 2
  objectKind: string | null = null
  snap = false
  showGrid = false
  showCollision = false
  /** Índice do objeto selecionado em zone.objects. */
  selected: number | null = null
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

  set(patch: Partial<Pick<EditorState, 'tool' | 'terrain' | 'brush' | 'objectKind' | 'snap' | 'showGrid' | 'showCollision' | 'selected' | 'zoom'>>) {
    Object.assign(this, patch)
    if (patch.tool && patch.tool !== 'select') this.selected = null
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
    this.selected = null
    this.dirty = dirty
    this.emit('zone')
  }

  markSaved() {
    this.dirty = false
    this.emit('ui')
  }
}
