// ────────────────────────────────────────────────────────
// Contrato de armazenamento das zonas. O motor só conhece esta
// interface; quem monta o Vortable entrega a implementação:
//   • LocalZoneStorage — no navegador (harness de dev, uso offline)
//   • (M4) Supabase, pela ponte no Vorterium
// ────────────────────────────────────────────────────────

import type { ZoneData } from './types'

export interface ZoneSummary {
  id: string
  name: string
  width: number
  height: number
  updatedAt: number
}

export interface ZoneStorage {
  list(): Promise<ZoneSummary[]>
  load(id: string): Promise<ZoneData | null>
  save(zone: ZoneData): Promise<void>
  remove(id: string): Promise<void>
}

const PREFIX = 'vortable:zone:'
const INDEX = 'vortable:zones'

/** Zonas no localStorage do navegador (pode falhar em aba anônima — aí avisa). */
export class LocalZoneStorage implements ZoneStorage {
  private readIndex(): ZoneSummary[] {
    try {
      return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as ZoneSummary[]
    } catch {
      return []
    }
  }

  private writeIndex(list: ZoneSummary[]) {
    localStorage.setItem(INDEX, JSON.stringify(list))
  }

  async list() {
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string) {
    try {
      const raw = localStorage.getItem(PREFIX + id)
      return raw ? (JSON.parse(raw) as ZoneData) : null
    } catch {
      return null
    }
  }

  async save(zone: ZoneData) {
    localStorage.setItem(PREFIX + zone.id, JSON.stringify(zone))
    const summary: ZoneSummary = { id: zone.id, name: zone.name, width: zone.width, height: zone.height, updatedAt: Date.now() }
    this.writeIndex([summary, ...this.readIndex().filter((z) => z.id !== zone.id)])
  }

  async remove(id: string) {
    localStorage.removeItem(PREFIX + id)
    this.writeIndex(this.readIndex().filter((z) => z.id !== id))
  }
}

/** Confere se um JSON importado parece uma zona válida. */
export function parseZone(json: unknown): ZoneData {
  const z = json as ZoneData
  if (!z || z.version !== 1 || typeof z.width !== 'number' || typeof z.height !== 'number' || !Array.isArray(z.corners)) {
    throw new Error('Arquivo não é uma zona do Vortable.')
  }
  if (z.corners.length !== (z.width + 1) * (z.height + 1)) throw new Error('Zona corrompida: tamanho da grade não bate.')
  z.objects ??= []
  z.spawn ??= { x: (z.width * 32) / 2, y: (z.height * 32) / 2 }
  return z
}
