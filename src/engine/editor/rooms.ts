// ────────────────────────────────────────────────────────
// Cômodos estilo Stardew. A zona guarda ONDE há cômodo (zone.rooms, um
// valor por vértice, como corners) e o estilo de cada vértice, escrito
// "piso|parede|moldura|altura". Daí sai, sozinho:
//   • piso dentro do cômodo (corners)
//   • a face da parede nos `altura` primeiros vértices abaixo de cada
//     borda de cima (corners = terreno de parede: moldura em cima, face,
//     rodapé — o autotile das paredes desenha)
//   • a moldura escura em toda a volta (overlay = moldura de teto)
// Só os vértices cujo papel mudou são reescritos: o que foi pintado à
// mão dentro de um cômodo (outro piso num canto) fica.
// ────────────────────────────────────────────────────────

import type { ZoneData } from '../types'

export interface RoomStyle {
  floor: string
  wall: string
  trim: string
  /** Altura da parede em tiles (0 = só a borda, como um corredor visto de cima). */
  height: number
}

export const ROOM_HEIGHT_MAX = 4

export const encodeRoom = (s: RoomStyle) => `${s.floor}|${s.wall}|${s.trim}|${s.height}`

export function decodeRoom(v: string): RoomStyle | null {
  const [floor, wall, trim, h] = v.split('|')
  if (!floor || !wall || !trim) return null
  const height = Math.max(0, Math.min(ROOM_HEIGHT_MAX, Number(h) || 0))
  return { floor, wall, trim, height }
}

/** Estilos prontos (ids dos terrenos dos pacotes de piso, parede e moldura). */
export const ROOM_PRESETS: { name: string; style: RoomStyle }[] = [
  { name: 'Casa de fazenda', style: { floor: 'floor-wood', wall: 'wall-226', trim: 'ceil-6', height: 3 } },
  { name: 'Taverna', style: { floor: 'floor-5', wall: 'wall-196', trim: 'ceil-3', height: 3 } },
  { name: 'Casa de pedra', style: { floor: 'floor-stone', wall: 'wall-2', trim: 'ceil-25', height: 3 } },
  { name: 'Castelo', style: { floor: 'floor-60', wall: 'wall-4', trim: 'ceil-25', height: 3 } },
  { name: 'Masmorra', style: { floor: 'floor-80', wall: 'wall-49', trim: 'ceil-25', height: 2 } },
  { name: 'Corredor de pedra (só borda)', style: { floor: 'floor-stone', wall: 'wall-49', trim: 'ceil-26', height: 0 } },
]

/**
 * O papel de cada vértice: '' (fora), `${estilo}#f` (piso) ou `${estilo}#w`
 * (parede). A face da parede nasce abaixo de uma borda de cima de verdade:
 * a coluna precisa de uma vizinha (esquerda ou direita) que comece na mesma
 * linha — assim o vão de uma porta numa parede vertical não ganha face.
 */
export function roomRoles(zone: ZoneData): string[] {
  const W = zone.width + 1, H = zone.height + 1
  const roles: string[] = new Array(W * H).fill('')
  const rooms = zone.rooms
  if (!rooms) return roles
  // linha onde começa a sequência de vértices de cômodo de cada coluna (-1 = fora)
  const start = new Int32Array(W * H).fill(-1)
  for (let x = 0; x < W; x++) {
    let top = -1
    for (let y = 0; y < H; y++) {
      const i = y * W + x
      if (!rooms[i] || !decodeRoom(rooms[i])) { top = -1; continue }
      if (top < 0) top = y
      start[i] = top
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (start[i] < 0) continue
      const style = decodeRoom(rooms[i])!
      const run = y - start[i]
      const sameTop = (x > 0 && start[i - 1] === start[i]) || (x < W - 1 && start[i + 1] === start[i])
      roles[i] = `${rooms[i]}#${style.height > 0 && run <= style.height && sameTop ? 'w' : 'f'}`
    }
  }
  return roles
}

/**
 * Reescreve piso/parede/moldura onde o papel do vértice mudou (de `before`
 * pra agora). Devolve se algo mudou.
 */
export function applyRooms(zone: ZoneData, before: string[]): boolean {
  const after = roomRoles(zone)
  let changed = false
  for (let i = 0; i < after.length; i++) {
    if (after[i] === before[i]) continue
    changed = true
    if (!after[i]) {
      // saiu de um cômodo: volta ao fundo e some a moldura
      zone.corners[i] = ''
      if (zone.overlay) zone.overlay[i] = ''
      continue
    }
    const style = decodeRoom(after[i].slice(0, -2))!
    zone.corners[i] = after[i].endsWith('#w') ? style.wall : style.floor
    if (!zone.overlay) zone.overlay = new Array(zone.corners.length).fill('')
    zone.overlay[i] = style.trim
  }
  if (zone.rooms && !zone.rooms.some((v) => v)) delete zone.rooms
  return changed
}

/** Vértices do cômodo ligado ao vértice (x, y), com o mesmo estilo dele. */
export function connectedRoom(zone: ZoneData, vx: number, vy: number): number[] {
  const W = zone.width + 1, H = zone.height + 1
  const rooms = zone.rooms
  const style = rooms?.[vy * W + vx]
  if (!rooms || !style) return []
  const seen = new Uint8Array(W * H)
  const out: number[] = []
  const stack = [vy * W + vx]
  seen[stack[0]] = 1
  while (stack.length) {
    const i = stack.pop()!
    out.push(i)
    const x = i % W, y = (i - x) / W
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const j = ny * W + nx
      if (!seen[j] && rooms[j] === style) { seen[j] = 1; stack.push(j) }
    }
  }
  return out
}
