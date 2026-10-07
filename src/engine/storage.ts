// ────────────────────────────────────────────────────────
// Contrato de armazenamento de um mundo (as zonas + os dados do mundo).
// O motor só conhece esta interface; quem monta o Vortable entrega a
// implementação:
//   • LocalWorldStorage — no navegador (harness de dev, uso offline)
//   • (M4) Supabase, pela ponte no Vorterium (um mundo por campanha)
// ────────────────────────────────────────────────────────

import { LIGHT_RADIUS_MAX, LIGHT_RADIUS_MIN, TILE, ZONE_MAX, ZONE_MIN, Z_MAX, newId, type Portal, type WorldData, type ZoneData, type ZoneLight, type ZoneLighting } from './types'

export interface ZoneSummary {
  id: string
  name: string
  width: number
  height: number
  updatedAt: number
  /** Zonas pra onde as saídas desta levam (pro mapa do mundo, sem abrir cada zona). */
  links: string[]
  /** Saídas desta zona (pra escolher o destino de uma saída sem abrir a zona). */
  portals: { id: string; name: string }[]
}

export interface WorldStorage {
  /** Dados do mundo; se ainda não existe, devolve um mundo novo (sem salvar). */
  loadWorld(): Promise<WorldData>
  saveWorld(world: WorldData): Promise<void>
  list(): Promise<ZoneSummary[]>
  load(id: string): Promise<ZoneData | null>
  save(zone: ZoneData): Promise<void>
  remove(id: string): Promise<void>
}

export function summarize(zone: ZoneData, updatedAt = Date.now()): ZoneSummary {
  return {
    id: zone.id,
    name: zone.name,
    width: zone.width,
    height: zone.height,
    updatedAt,
    links: [...new Set(zone.portals.flatMap((p) => (p.to ? [p.to.zone] : [])))],
    portals: zone.portals.map((p) => ({ id: p.id, name: p.name })),
  }
}

export function newWorld(name = 'Meu mundo'): WorldData {
  return { version: 1, id: newId('mundo'), name, start: null, layout: {} }
}

/**
 * Mundo no localStorage do navegador. `space` separa mundos diferentes
 * no mesmo navegador; o padrão ('') usa as mesmas chaves do M1, então as
 * zonas salvas antes continuam aparecendo.
 */
export class LocalWorldStorage implements WorldStorage {
  private readonly zoneKey: string
  private readonly indexKey: string
  private readonly worldKey: string

  constructor(space = '') {
    const ns = space ? `vortable:${space}:` : 'vortable:'
    this.zoneKey = `${ns}zone:`
    this.indexKey = `${ns}zones`
    this.worldKey = `${ns}world`
  }

  private readIndex(): ZoneSummary[] {
    try {
      const list = JSON.parse(localStorage.getItem(this.indexKey) ?? '[]') as Partial<ZoneSummary>[]
      // índices do M1 não tinham links/portals
      return list.map((z) => ({ links: [], portals: [], ...z }) as ZoneSummary)
    } catch {
      return []
    }
  }

  private writeIndex(list: ZoneSummary[]) {
    localStorage.setItem(this.indexKey, JSON.stringify(list))
  }

  async loadWorld() {
    try {
      const raw = localStorage.getItem(this.worldKey)
      if (raw) return parseWorld(JSON.parse(raw))
    } catch {
      /* mundo corrompido ou storage bloqueado: começa um novo */
    }
    return newWorld()
  }

  async saveWorld(world: WorldData) {
    localStorage.setItem(this.worldKey, JSON.stringify(world))
  }

  async list() {
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async load(id: string) {
    try {
      const raw = localStorage.getItem(this.zoneKey + id)
      return raw ? parseZone(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  async save(zone: ZoneData) {
    localStorage.setItem(this.zoneKey + zone.id, JSON.stringify(zone))
    this.writeIndex([summarize(zone), ...this.readIndex().filter((z) => z.id !== zone.id)])
  }

  async remove(id: string) {
    localStorage.removeItem(this.zoneKey + id)
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

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * Confere um JSON importado e devolve uma zona utilizável. Recusa o que
 * quebraria o motor (tamanho fora do limite, grade com tamanho errado);
 * conserta o que dá (objetos/saídas malformados são descartados, início
 * fora da zona volta pro meio).
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
  const objects = (Array.isArray(z.objects) ? z.objects : []).filter(
    (o) => o && typeof o.kind === 'string' && num(o.x) && num(o.y),
  )
  const portals = (Array.isArray(z.portals) ? z.portals : []).filter(
    (p): p is Portal => !!p && typeof p.id === 'string' && num(p.x) && num(p.y) && num(p.w) && num(p.h) && p.w > 0 && p.h > 0,
  )
  const spawn = z.spawn && num(z.spawn.x) && num(z.spawn.y) && z.spawn.x >= 0 && z.spawn.y >= 0 && z.spawn.x <= W && z.spawn.y <= H
    ? z.spawn
    : { x: W / 2, y: H / 2 }
  return {
    version: 1,
    id: typeof z.id === 'string' && z.id ? z.id : newId('zona'),
    name: typeof z.name === 'string' ? z.name : 'Zona importada',
    width: width!,
    height: height!,
    base: typeof z.base === 'string' ? z.base : 'grass',
    corners: z.corners.map((c) => (typeof c === 'string' ? c : '')),
    // camada de cima com tamanho errado é descartada (não quebra a zona)
    ...(Array.isArray(z.overlay) && z.overlay.length === z.corners.length && z.overlay.some((c) => c)
      ? { overlay: z.overlay.map((c) => (typeof c === 'string' ? c : '')) }
      : {}),
    ...(Array.isArray(z.rooms) && z.rooms.length === z.corners.length && z.rooms.some((c) => c)
      ? { rooms: z.rooms.map((c) => (typeof c === 'string' ? c : '')) }
      : {}),
    ...(Array.isArray(z.fences) && z.fences.length === width! * height! && z.fences.some((c) => c)
      ? { fences: z.fences.map((c) => (typeof c === 'string' ? c : '')) }
      : {}),
    objects: objects.map((o) => ({
      kind: o.kind, x: Math.round(o.x), y: Math.round(o.y),
      ...(o.flip === true ? { flip: true } : {}),
      ...(num(o.z) && o.z > 0 ? { z: Math.min(Z_MAX, Math.round(o.z)) } : {}),
    })),
    ...parseLighting(z.lighting),
    ...(Array.isArray(z.lights) && z.lights.length ? { lights: parseLights(z.lights, W, H) } : {}),
    portals: portals.map((p) => ({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : 'Saída',
      x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h),
      to: p.to && typeof p.to.zone === 'string' && typeof p.to.portal === 'string' ? { zone: p.to.zone, portal: p.to.portal } : null,
    })),
    spawn: { x: Math.round(spawn.x), y: Math.round(spawn.y) },
  }
}

const COLOR = /^#[0-9a-f]{6}$/i
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

function parseLighting(l: unknown): { lighting?: ZoneLighting } {
  const v = l as Partial<ZoneLighting> | null
  if (!v || typeof v !== 'object') return {}
  const place = v.place === 'indoor' || v.place === 'underground' ? v.place : 'outdoor'
  return {
    lighting: {
      place,
      hour: num(v.hour) ? clamp(v.hour, 0, 24) % 24 : null,
      ...(num(v.dayMinutes) && v.dayMinutes > 0 ? { dayMinutes: clamp(v.dayMinutes, 1, 24 * 60) } : {}),
      ...(typeof v.tint === 'string' && COLOR.test(v.tint) ? { tint: v.tint } : {}),
      ...(v.sunShadows === false ? { sunShadows: false } : {}),
      ...(v.particles === false ? { particles: false } : {}),
      ...(num(v.wind) ? { wind: clamp(v.wind, 0, 1) } : {}),
      ...(v.clouds === false ? { clouds: false } : {}),
    },
  }
}

function parseLights(list: unknown[], W: number, H: number): ZoneLight[] {
  return list
    .filter((l): l is ZoneLight => !!l && typeof l === 'object' && num((l as ZoneLight).x) && num((l as ZoneLight).y))
    .map((l) => ({
      id: typeof l.id === 'string' && l.id ? l.id : newId('luz'),
      x: clamp(Math.round(l.x), 0, W),
      y: clamp(Math.round(l.y), 0, H),
      radius: num(l.radius) ? clamp(Math.round(l.radius), LIGHT_RADIUS_MIN, LIGHT_RADIUS_MAX) : 96,
      color: typeof l.color === 'string' && COLOR.test(l.color) ? l.color : '#ffb060',
      intensity: num(l.intensity) ? clamp(l.intensity, 0, 1) : 1,
      flicker: num(l.flicker) ? clamp(l.flicker, 0, 1) : 0,
    }))
}

export function parseWorld(json: unknown): WorldData {
  const w = json as Partial<WorldData> | null
  if (!w || typeof w !== 'object' || w.version !== 1) throw new Error('Dados de mundo inválidos.')
  const layout: WorldData['layout'] = {}
  for (const [id, p] of Object.entries(w.layout ?? {})) if (p && num(p.x) && num(p.y)) layout[id] = { x: p.x, y: p.y }
  return {
    version: 1,
    id: typeof w.id === 'string' ? w.id : newId('mundo'),
    name: typeof w.name === 'string' ? w.name : 'Meu mundo',
    start: typeof w.start === 'string' ? w.start : null,
    layout,
  }
}
