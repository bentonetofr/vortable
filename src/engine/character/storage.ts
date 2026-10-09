// ────────────────────────────────────────────────────────
// Contrato de armazenamento dos personagens. No Vorterium (M4) cada
// personagem fica junto da ficha; aqui, no navegador.
// ────────────────────────────────────────────────────────

import type { Appearance, BodyType, CharacterSave } from '../types'

const BODIES: BodyType[] = ['male', 'female', 'muscular', 'teen', 'child']
import { newId } from '../types'

export interface CharacterStorage {
  list(): Promise<CharacterSave[]>
  save(c: CharacterSave): Promise<void>
  remove(id: string): Promise<void>
  /** Personagem usado pra testar/jogar neste navegador. */
  getActive(): Promise<string | null>
  setActive(id: string | null): Promise<void>
}

export function newCharacter(name: string, appearance: Appearance): CharacterSave {
  return { version: 1, id: newId('pers'), name, appearance, updatedAt: Date.now() }
}

/** Confere um personagem lido do armazenamento (aparência v2). */
export function parseCharacter(json: unknown): CharacterSave | null {
  const c = json as Partial<CharacterSave> | null
  const a = c?.appearance as Partial<Appearance> | undefined
  if (!c || typeof c.id !== 'string' || !a || a.version !== 2 || !BODIES.includes(a.body as BodyType)) return null
  if (typeof a.slots !== 'object' || !a.slots) return null
  return {
    version: 1,
    id: c.id,
    name: typeof c.name === 'string' ? c.name : 'Sem nome',
    appearance: { version: 2, body: a.body as BodyType, skin: typeof a.skin === 'string' ? a.skin : 'light', slots: a.slots, ...(typeof a.height === 'number' ? { height: a.height } : {}), ...(a.shape && typeof a.shape === 'object' ? { shape: a.shape } : {}) },
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
  }
}

export class LocalCharacterStorage implements CharacterStorage {
  private readonly key: string
  private readonly activeKey: string

  constructor(space = '') {
    const ns = space ? `vortable:${space}:` : 'vortable:'
    this.key = `${ns}characters`
    this.activeKey = `${ns}activeCharacter`
  }

  private read(): CharacterSave[] {
    try {
      const list = JSON.parse(localStorage.getItem(this.key) ?? '[]') as unknown[]
      return list.map(parseCharacter).filter((c): c is CharacterSave => !!c)
    } catch {
      return []
    }
  }

  async list() {
    return this.read().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async save(c: CharacterSave) {
    const list = this.read().filter((x) => x.id !== c.id)
    localStorage.setItem(this.key, JSON.stringify([{ ...c, updatedAt: Date.now() }, ...list]))
  }

  async remove(id: string) {
    localStorage.setItem(this.key, JSON.stringify(this.read().filter((x) => x.id !== id)))
    if ((await this.getActive()) === id) await this.setActive(null)
  }

  async getActive() {
    try {
      return localStorage.getItem(this.activeKey)
    } catch {
      return null
    }
  }

  async setActive(id: string | null) {
    if (id) localStorage.setItem(this.activeKey, id)
    else localStorage.removeItem(this.activeKey)
  }
}
