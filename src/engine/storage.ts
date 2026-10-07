// ────────────────────────────────────────────────────────
// Contrato de armazenamento das zonas. O motor só conhece esta
// interface; quem monta o Vortable entrega a implementação:
//   • LocalZoneStorage — no navegador (harness de dev, uso offline)
//   • (M4) Supabase, pela ponte no Vorterium
// ────────────────────────────────────────────────────────

import { TILE, ZONE_MAX, ZONE_MIN, type ZoneData } from './types'

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
      return raw ? parseZone(JSON.parse(raw)) : null
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

/** localStorage pode estar bloqueado (aba anônima, cookies desligados). */
export function localStorageAvailable() {
  try {
    const k = 'vortable:teste'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

/**
 * Confere um JSON importado e devolve uma zona utilizável. Recusa o que
 * quebraria o motor (tamanho fora do limite, grade com tamanho errado);
 * conserta o que dá (objetos malformados são descartados, início fora da
 * zona volta pro meio).
 */
export function parseZone(json: unknown): ZoneData {
  const z = json as Partial<ZoneData> | null
  if (!z || typeof z !== 'object' || z.version !== 1) throw new Error('Arquivo não é uma zona do Vortable.')
  const { width, height } = z
  const okSize = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= ZONE_MIN && n <= ZONE_MAX
  if (!okSize(width) || !okSize(height)) throw new Error(`Tamanho de zona inválido (precisa ser de ${ZONE_MIN} a ${ZONE_MAX} tiles).`)
  if (!Array.isArray(z.corners) || z.corners.length !== (width! + 1) * (height! + 1)) {
    throw new Error('Zona corrompida: a grade de terrenos não bate com o tamanho.')
  }
  const W = width! * TILE, H = height! * TILE
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  const objects = (Array.isArray(z.objects) ? z.objects : []).filter(
    (o) => o && typeof o.kind === 'string' && num(o.x) && num(o.y),
  )
  const spawn = z.spawn && num(z.spawn.x) && num(z.spawn.y) && z.spawn.x >= 0 && z.spawn.y >= 0 && z.spawn.x <= W && z.spawn.y <= H
    ? z.spawn
    : { x: W / 2, y: H / 2 }
  return {
    version: 1,
    id: typeof z.id === 'string' && z.id ? z.id : `zona-${Date.now().toString(36)}`,
    name: typeof z.name === 'string' ? z.name : 'Zona importada',
    width: width!,
    height: height!,
    base: typeof z.base === 'string' ? z.base : 'grass',
    corners: z.corners.map((c) => (typeof c === 'string' ? c : '')),
    objects: objects.map((o) => ({ kind: o.kind, x: Math.round(o.x), y: Math.round(o.y) })),
    spawn: { x: Math.round(spawn.x), y: Math.round(spawn.y) },
  }
}
