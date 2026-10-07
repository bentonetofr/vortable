// ────────────────────────────────────────────────────────
// Luz barrada pelas paredes. A borda dos cômodos (moldura/faixa escura)
// e o vazio dos interiores são "opacos": uma tocha num cômodo não
// atravessa a parede pro cômodo vizinho, mas passa pelas portas.
//
// Cada luz ganha um polígono de visibilidade (raios até as pontas das
// paredes) e uma textura própria: o gradiente recortado pelo polígono,
// tirado de 4 pontos levemente deslocados (penumbra suave). As luzes não
// se mexem, então isso é calculado uma vez e reaproveitado.
//
// Objetos (barris, árvores) NÃO barram a luz: na perspectiva ¾ o pé de
// um objeto faria sombra no próprio desenho dele.
// ────────────────────────────────────────────────────────

import { TILE, type ZoneData } from '../types'
import { cornerTerrain } from './ground'
import { roomRoles } from './rooms'

/**
 * Canvas na CPU: são pequenos e viram textura logo em seguida — no canvas da
 * placa de vídeo, cada envio pra textura custa ~15 ms (lê de volta da GPU).
 */
const CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true }

/** Segmento de parede alinhado aos eixos (y fixo = horizontal). */
interface Seg { x1: number; y1: number; x2: number; y2: number }

export interface Occlusion {
  w: number
  h: number
  opaque: Uint8Array
  segs: Seg[]
  /** Muda quando as paredes mudam (chave do cache das texturas de luz). */
  version: string
}

/** Tiles que barram a luz e as bordas entre eles e os livres. null = nada barra. */
export function buildOcclusion(zone: ZoneData): Occlusion | null {
  const W = zone.width, H = zone.height, VW = W + 1
  const roles = zone.rooms ? roomRoles(zone) : null
  const opaque = new Uint8Array(W * H)
  let any = false
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      let inRoom = 0, empty = 0
      for (const [vx, vy] of [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]]) {
        if (roles && roles[vy * VW + vx] !== '') inRoom++
        if (cornerTerrain(zone, vx, vy).edgeSolid) empty++
      }
      // a borda do cômodo (cantos dentro e fora), ou vazio fora de cômodo
      if ((inRoom > 0 && inRoom < 4) || (inRoom === 0 && empty >= 3)) {
        opaque[ty * W + tx] = 1
        any = true
      }
    }
  }
  if (!any) return null
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? opaque[y * W + x] : 0)
  const segs: Seg[] = []
  // horizontais: borda entre (x, y−1) e (x, y); emenda vizinhos na mesma linha
  for (let y = 0; y <= H; y++) {
    let run = -1
    for (let x = 0; x <= W; x++) {
      const edge = x < W && at(x, y - 1) !== at(x, y)
      if (edge && run < 0) run = x
      if (!edge && run >= 0) {
        segs.push({ x1: run * TILE, y1: y * TILE, x2: x * TILE, y2: y * TILE })
        run = -1
      }
    }
  }
  for (let x = 0; x <= W; x++) {
    let run = -1
    for (let y = 0; y <= H; y++) {
      const edge = y < H && at(x - 1, y) !== at(x, y)
      if (edge && run < 0) run = y
      if (!edge && run >= 0) {
        segs.push({ x1: x * TILE, y1: run * TILE, x2: x * TILE, y2: y * TILE })
        run = -1
      }
    }
  }
  let hash = 0
  for (let i = 0; i < opaque.length; i++) if (opaque[i]) hash = (Math.imul(hash, 31) + i) | 0
  return { w: W, h: H, opaque, segs, version: `${W}x${H}:${hash}` }
}

function opaqueAt(occ: Occlusion, x: number, y: number) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE)
  return tx >= 0 && ty >= 0 && tx < occ.w && ty < occ.h && occ.opaque[ty * occ.w + tx] === 1
}

/** Paredes que cortam o quadrado da luz, recortadas nele. */
function segsNear(occ: Occlusion, x0: number, y0: number, x1: number, y1: number): Seg[] {
  const out: Seg[] = []
  for (const s of occ.segs) {
    if (s.y1 === s.y2) {
      if (s.y1 < y0 || s.y1 > y1) continue
      const a = Math.max(x0, Math.min(s.x1, s.x2)), b = Math.min(x1, Math.max(s.x1, s.x2))
      if (a < b) out.push({ x1: a, y1: s.y1, x2: b, y2: s.y1 })
    } else {
      if (s.x1 < x0 || s.x1 > x1) continue
      const a = Math.max(y0, Math.min(s.y1, s.y2)), b = Math.min(y1, Math.max(s.y1, s.y2))
      if (a < b) out.push({ x1: s.x1, y1: a, x2: s.x1, y2: b })
    }
  }
  return out
}

/** Distância (em múltiplos de d) até a parede mais próxima no raio. */
function cast(ox: number, oy: number, dx: number, dy: number, segs: Seg[]) {
  let best = Infinity
  for (const s of segs) {
    if (s.y1 === s.y2) {
      if (Math.abs(dy) < 1e-9) continue
      const t = (s.y1 - oy) / dy
      if (t <= 1e-6 || t >= best) continue
      const x = ox + dx * t
      if (x >= s.x1 - 1e-6 && x <= s.x2 + 1e-6) best = t
    } else {
      if (Math.abs(dx) < 1e-9) continue
      const t = (s.x1 - ox) / dx
      if (t <= 1e-6 || t >= best) continue
      const y = oy + dy * t
      if (y >= s.y1 - 1e-6 && y <= s.y2 + 1e-6) best = t
    }
  }
  return best
}

/** Polígono do que a luz enxerga dentro do quadrado (x0,y0)-(x1,y1). */
function visibility(ox: number, oy: number, segs: Seg[], x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const all = [
    ...segs,
    { x1: x0, y1: y0, x2: x1, y2: y0 }, { x1: x0, y1: y1, x2: x1, y2: y1 },
    { x1: x0, y1: y0, x2: x0, y2: y1 }, { x1: x1, y1: y0, x2: x1, y2: y1 },
  ]
  const angles: number[] = []
  for (const s of all) {
    for (const [px, py] of [[s.x1, s.y1], [s.x2, s.y2]]) {
      const a = Math.atan2(py - oy, px - ox)
      angles.push(a - 1e-4, a, a + 1e-4)
    }
  }
  angles.sort((a, b) => a - b)
  const pts: [number, number][] = []
  let last = NaN
  for (const a of angles) {
    if (a === last) continue
    last = a
    const dx = Math.cos(a), dy = Math.sin(a)
    const t = cast(ox, oy, dx, dy, all)
    if (t !== Infinity) pts.push([ox + dx * t, oy + dy * t])
  }
  return pts
}

/** Pontos da penumbra: a luz "tem tamanho", então a sombra não tem quina dura. */
const JITTER: [number, number][] = [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]

/**
 * Textura da luz recortada pelas paredes, num canvas de `size`×`size`
 * (cobre o quadrado do raio). null = nenhuma parede perto (use o
 * gradiente comum).
 */
export function maskedLight(occ: Occlusion, x: number, y: number, radius: number, gradient: CanvasImageSource, size: number): HTMLCanvasElement | null {
  const x0 = x - radius, y0 = y - radius, x1 = x + radius, y1 = y + radius
  const segs = segsNear(occ, x0, y0, x1, y1)
  if (!segs.length) return null
  // luz dentro da parede (tocha pendurada na moldura): desce até achar chão livre
  let oy = y
  while (opaqueAt(occ, x, oy) && oy < y + TILE) oy += 4
  if (opaqueAt(occ, x, oy)) return null

  const k = size / (radius * 2)
  const mask = document.createElement('canvas')
  mask.width = mask.height = size
  const m = mask.getContext('2d', CPU)!
  m.fillStyle = '#000'
  m.fillRect(0, 0, size, size)
  m.globalCompositeOperation = 'lighter'
  const origins = JITTER.map(([dx, dy]) => [x + dx, oy + dy]).filter(([px, py]) => !opaqueAt(occ, px, py))
  if (!origins.length) origins.push([x, oy])
  m.fillStyle = `rgba(255,255,255,${1 / origins.length})`
  for (const [px, py] of origins) {
    const poly = visibility(px, py, segs, x0, y0, x1, y1)
    if (poly.length < 3) continue
    m.beginPath()
    poly.forEach(([qx, qy], i) => (i ? m.lineTo((qx - x0) * k, (qy - y0) * k) : m.moveTo((qx - x0) * k, (qy - y0) * k)))
    m.closePath()
    m.fill()
  }

  const out = document.createElement('canvas')
  out.width = out.height = size
  const c = out.getContext('2d', CPU)!
  c.drawImage(gradient, 0, 0, size, size)
  // tudo opaco: gradiente (cinza no preto) × máscara (branco no preto)
  c.globalCompositeOperation = 'multiply'
  // borda um pouco borrada (onde o navegador suporta filtro no canvas)
  c.filter = `blur(${Math.max(0.5, 1.5 * k)}px)`
  c.drawImage(mask, 0, 0)
  c.filter = 'none'
  return out
}
