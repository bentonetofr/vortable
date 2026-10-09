// ────────────────────────────────────────────────────────
// Marcas desenhadas por código (o LPC quase não tem): sardas e manchas de pele,
// cicatrizes, maquiagem, pintura de rosto e tatuagens. Cada peça é uma receita
// que pinta pixels no rosto do boneco, em cima da cabeça e embaixo do cabelo,
// só onde existe cabeça (a máscara é a própria folha da cabeça).
//
// O rosto é descrito em coordenadas (u, v), iguais em todos os corpos e quadros:
//   u — pra o lado, a partir do meio do rosto (lado direito da imagem; `both` faz os dois lados);
//   v — pra baixo, a partir da linha dos olhos (os olhos ficam em u 3..4, v -1..1).
// De frente a receita aparece inteira; de lado só o lado que se vê; de costas, nada.
// ────────────────────────────────────────────────────────

import type { CharItem, CharPalettes, CharSlot } from './catalog'

/** Caixa da cabeça num quadro (px do quadro de 64). */
interface Box { x0: number; y0: number; x1: number; y1: number }

/** Caneta que pinta no rosto: traduz (u, v) pro quadro e respeita a máscara da cabeça. */
export class Gfx {
  /** Lado de quem pinta: 1 = lado direito da imagem, -1 = esquerdo (o espelho). */
  side: 1 | -1 = 1
  color = '#000000'
  alpha = 1
  /** Pode pintar por cima dos olhos (cicatriz que corta o olho, sombra). */
  eyes = false

  constructor(
    private ctx: CanvasRenderingContext2D,
    private ox: number, private oy: number,
    private head: ImageData, private sx: number, private sy: number,
    /** 0 cima, 1 esquerda, 2 baixo, 3 direita (linhas do LPC). */
    private row: number,
    private box: Box,
  ) {}

  private get eyeY() {
    const h = this.box.y1 - this.box.y0
    return this.box.y0 + Math.round(15 * (h / 21))
  }

  /** Pixel do quadro pra um ponto do rosto; null = não aparece nesta vista. */
  private map(u: number, v: number, side: 1 | -1): [number, number] | null {
    const { x0, x1 } = this.box
    const y = this.eyeY + v
    if (this.row === 2) {
      const cx = x0 + Math.floor((x1 - x0) / 2)
      return [side > 0 ? cx + u : cx - 1 - u, y]
    }
    // de lado só se vê um lado do rosto; os pontos do meio (u < 0 no lado visível) ficam na frente
    if (this.row === 1) return side > 0 ? [x0 + 6 + (u - 3), y] : null
    if (this.row === 3) return side < 0 ? [x1 - 1 - 6 - (u - 3), y] : null
    return null
  }

  private opaque(x: number, y: number) {
    if (x < 0 || y < 0 || x >= 64 || y >= 64) return false
    return this.head.data[((this.sy + y) * this.head.width + this.sx + x) * 4 + 3] > 0
  }

  /** Um pixel do rosto. */
  dot(u: number, v: number, alpha = this.alpha, color = this.color) {
    if (!this.eyes && u >= 3 && u <= 4 && v >= -1 && v <= 1) return
    const p = this.map(u, v, this.side)
    if (!p) return
    const [x, y] = p
    if (!this.opaque(x, y)) return
    this.ctx.globalAlpha = alpha
    this.ctx.fillStyle = color
    this.ctx.fillRect(this.ox + x, this.oy + y, 1, 1)
    this.ctx.globalAlpha = 1
  }

  /** Um pixel no meio do rosto (u de -3 a 2): de lado vira um pontinho na frente. */
  cdot(u: number, v: number, alpha = this.alpha, color = this.color) {
    const { x0, x1 } = this.box
    let p: [number, number] | null
    if (this.row === 2) p = [x0 + Math.floor((x1 - x0) / 2) + u, this.eyeY + v]
    else if (this.row === 1) p = [x0 + 2 + Math.floor((u + 3) / 2), this.eyeY + v]
    else if (this.row === 3) p = [x1 - 3 - Math.floor((u + 3) / 2), this.eyeY + v]
    else p = null
    if (!p || !this.opaque(p[0], p[1])) return
    this.ctx.globalAlpha = alpha
    this.ctx.fillStyle = color
    this.ctx.fillRect(this.ox + p[0], this.oy + p[1], 1, 1)
    this.ctx.globalAlpha = 1
  }

  pts(list: [number, number][], alpha = this.alpha) { for (const [u, v] of list) this.dot(u, v, alpha) }

  line(u0: number, v0: number, u1: number, v1: number, alpha = this.alpha) {
    const n = Math.max(Math.abs(u1 - u0), Math.abs(v1 - v0), 1)
    for (let i = 0; i <= n; i++) this.dot(Math.round(u0 + ((u1 - u0) * i) / n), Math.round(v0 + ((v1 - v0) * i) / n), alpha)
  }

  rect(u: number, v: number, w: number, h: number, alpha = this.alpha) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(u + i, v + j, alpha)
  }

  /** Roda a receita nos dois lados do rosto. */
  both(fn: () => void) {
    for (const s of [1, -1] as const) { this.side = s; fn() }
    this.side = 1
  }

  /** Pontos espalhados, sempre os mesmos pra mesma `seed` (pintas e sardas não "andam" entre quadros). */
  scatter(seed: number, n: number, area: [number, number, number, number], alpha = this.alpha, size = 1) {
    const [u0, v0, u1, v1] = area
    const cells: [number, number][] = []
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) cells.push([u, v])
    let a = seed >>> 0
    const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    for (let i = 0; i < n && cells.length; i++) {
      const [u, v] = cells.splice(Math.floor(rnd() * cells.length), 1)[0]
      this.dot(u, v, alpha)
      if (size > 1) this.dot(u + 1, v, alpha)
    }
  }
}

/** Receita de uma peça. */
export interface ProcDef {
  id: string
  slot: string
  name: string
  /** Camada (zPos do LPC): cabeça 100, expressão 101, cabelo acima. */
  z?: number
  /** Cor da paleta (nome de PROC_PALETTES); sem isso a peça não tem cor. */
  palette?: keyof typeof PROC_PALETTES
  /** Cor padrão (nome na paleta). */
  color?: string
  /** Pode pintar por cima dos olhos. */
  eyes?: boolean
  alpha?: number
  draw(g: Gfx): void
}

const FACE_Z = 102

// ── Cores (uma por nome; a paleta do boneco guarda listas, aqui cada lista tem 1 cor) ──
export const PROC_PALETTES = {
  freckle: { castanho: ['#8a5a3c'], ruivo: ['#b4602a'], claro: ['#c99a78'], escuro: ['#4a2e22'], dourado: ['#c9a05a'], cinza: ['#8a8a92'] },
  scar: { palida: ['#e3b4a4'], fresca: ['#b3263a'], antiga: ['#7a4a42'], branca: ['#f3e6de'], escura: ['#3a2a30'], arroxeada: ['#8a4a6a'] },
  lip: {
    vermelho: ['#c41230'], rosa: ['#e8668a'], vinho: ['#6e1230'], ameixa: ['#7a2a6a'], nude: ['#c98a7a'], coral: ['#ee6b5d'],
    preto: ['#17151a'], roxo: ['#6a2fb0'], azul: ['#2a5ad8'], verde: ['#2a9a5a'], dourado: ['#d9a82a'], branco: ['#f2f2f4'], neon_rosa: ['#ff3fa0'], neon_ciano: ['#2ae6f0'],
  },
  shadow: {
    preto: ['#17151a'], marrom: ['#4a2e22'], cinza: ['#5a5a66'], azul: ['#2a4aa0'], verde: ['#2a7a5a'], roxo: ['#6a3aa8'], rosa: ['#d85a9a'],
    dourado: ['#d9a82a'], prata: ['#b6bcc6'], vermelho: ['#a8182c'], neon_azul: ['#3ab7ff'], neon_rosa: ['#ff4fa3'], neon_verde: ['#39ff88'],
  },
  blush: { rosa: ['#ee7a9a'], pessego: ['#f09a7a'], coral: ['#ee6b5d'], vermelho: ['#d0344a'], roxo: ['#a85ac0'], marrom: ['#9a5a4a'], dourado: ['#d9a850'] },
  paint: {
    branco: ['#f4f4f6'], vermelho: ['#c41230'], preto: ['#17151a'], azul: ['#2a5ad8'], verde: ['#2a9a5a'], amarelo: ['#f0cc2a'], laranja: ['#f08a2a'],
    roxo: ['#7a3ad0'], dourado: ['#d9a82a'], prata: ['#b6bcc6'], neon_ciano: ['#2ae6f0'], neon_rosa: ['#ff3fa0'], neon_verde: ['#39ff88'], neon_amarelo: ['#f4f23a'],
  },
  ink: { preto: ['#1b1a22'], azul_escuro: ['#1b2a56'], verde_escuro: ['#1b4a36'], vermelho: ['#8a1a2a'], branco: ['#e8e8ee'], roxo: ['#4a2a7a'], cinza: ['#555563'] },
} satisfies Record<string, Record<string, string[]>>

// ── Receitas ───────────────────────────────────────────────────────────────

const defs: ProcDef[] = []
const add = (d: ProcDef) => { defs.push({ z: FACE_Z, ...d }) }

// Pintas, sardas e manchas
add({ id: 'proc/sardas_leves', slot: 'skin_spots', name: 'Sardas leves', palette: 'freckle', color: 'castanho', alpha: 0.7,
  draw: (g) => g.both(() => g.scatter(11, 7, [0, 1, 8, 4])) })
add({ id: 'proc/sardas_fortes', slot: 'skin_spots', name: 'Sardas por todo o rosto', palette: 'freckle', color: 'ruivo', alpha: 0.85,
  draw: (g) => g.both(() => { g.scatter(21, 15, [0, 0, 8, 4]); g.scatter(5, 6, [0, -8, 7, -4], 0.7) }) })
add({ id: 'proc/sardas_nariz', slot: 'skin_spots', name: 'Sardas no nariz', palette: 'freckle', color: 'castanho', alpha: 0.85,
  draw: (g) => g.both(() => g.scatter(31, 5, [0, 1, 2, 3])) })
add({ id: 'proc/pinta_bochecha', slot: 'skin_spots', name: 'Pinta na bochecha', palette: 'freckle', color: 'escuro', alpha: 1,
  draw: (g) => g.dot(6, 3) })
add({ id: 'proc/pinta_boca', slot: 'skin_spots', name: 'Pinta perto da boca', palette: 'freckle', color: 'escuro', alpha: 1,
  draw: (g) => g.dot(2, 4) })
add({ id: 'proc/manchas_idade', slot: 'skin_spots', name: 'Manchas de idade', palette: 'freckle', color: 'castanho', alpha: 0.5,
  draw: (g) => g.both(() => g.scatter(41, 7, [0, -7, 8, 4], 0.5, 2)) })
add({ id: 'proc/acne', slot: 'skin_spots', name: 'Espinhas', palette: 'scar', color: 'fresca', alpha: 0.8,
  draw: (g) => g.both(() => g.scatter(51, 7, [0, -5, 8, 4])) })
add({ id: 'proc/queimado_sol', slot: 'skin_spots', name: 'Queimado de sol', palette: 'blush', color: 'vermelho', alpha: 0.28,
  draw: (g) => g.both(() => { g.rect(-1, 1, 10, 3); g.rect(3, -2, 6, 1) }) })
add({ id: 'proc/vitiligo', slot: 'skin_spots', name: 'Manchas claras (vitiligo)', palette: 'paint', color: 'branco', alpha: 0.7,
  draw: (g) => { g.pts([[5, 2], [6, 2], [7, 2], [5, 3], [6, 3], [8, 3], [2, 3], [3, 3], [2, 4], [7, 4], [8, 4], [6, -4], [7, -4], [5, -5], [6, -5], [6, -6]]); g.side = -1; g.pts([[-1, -2], [0, -2], [-1, -1], [1, 2], [2, 2], [1, 3], [4, 3]]); g.side = 1 } })
add({ id: 'proc/olheiras', slot: 'skin_spots', name: 'Olheiras', palette: 'scar', color: 'arroxeada', alpha: 0.4,
  draw: (g) => g.both(() => { g.rect(2, 2, 4, 1); g.rect(3, 3, 2, 1) }) })
add({ id: 'proc/olho_roxo', slot: 'skin_spots', name: 'Olho roxo', palette: 'scar', color: 'arroxeada', alpha: 0.6,
  draw: (g) => { g.rect(2, -2, 5, 1); g.rect(2, 2, 5, 1); g.rect(2, -1, 1, 3); g.rect(6, -1, 1, 3); g.rect(3, 3, 3, 1) } })
add({ id: 'proc/fuligem', slot: 'skin_spots', name: 'Fuligem e sujeira', palette: 'scar', color: 'escura', alpha: 0.32,
  draw: (g) => g.both(() => { g.scatter(61, 6, [0, -6, 8, 4], 0.32, 2); g.scatter(62, 4, [2, 1, 8, 4], 0.4, 2) }) })

// Cicatrizes: cada uma em dois lados (esquerdo e direito do personagem)
const scar = (id: string, name: string, draw: (g: Gfx) => void, eyes = false) => {
  for (const [suffix, side] of [['esq.', 1], ['dir.', -1]] as const) {
    add({ id: `${id}_${suffix === 'esq.' ? 'e' : 'd'}`, slot: 'scar_face', name: `${name} (${suffix})`, palette: 'scar', color: 'palida', alpha: 0.95, eyes,
      draw: (g) => { g.side = side; draw(g); g.side = 1 } })
  }
}
scar('proc/cic_olho_diag', 'Corte no olho', (g) => g.line(2, -5, 6, 4), true)
scar('proc/cic_olho_vert', 'Corte vertical no olho', (g) => g.line(4, -4, 4, 3), true)
scar('proc/cic_sobrancelha', 'Corte na sobrancelha', (g) => g.line(3, -4, 6, -2))
scar('proc/cic_bochecha', 'Cicatriz na bochecha', (g) => g.line(8, 0, 5, 5))
scar('proc/cic_corte_horizontal', 'Corte na face', (g) => g.line(3, 3, 9, 3))
scar('proc/cic_garras', 'Marcas de garra', (g) => { g.line(5, -1, 7, 4); g.line(6, -2, 8, 3); g.line(4, 0, 6, 5) })
scar('proc/cic_mandibula', 'Cicatriz na mandíbula', (g) => g.line(8, 3, 4, 5))
scar('proc/cic_costurada', 'Cicatriz costurada', (g) => { g.line(6, -1, 6, 5); g.pts([[5, 0], [7, 0], [5, 2], [7, 2], [5, 4], [7, 4]]) })
scar('proc/cic_cruz', 'Cicatriz em cruz', (g) => { g.line(6, 0, 6, 4); g.line(4, 2, 8, 2) })
scar('proc/cic_queimadura', 'Queimadura', (g) => g.pts([[6, 1], [7, 1], [5, 2], [6, 2], [7, 2], [8, 2], [6, 3], [7, 3], [8, 3], [7, 4], [8, 4], [6, 4]]))
scar('proc/cic_testa', 'Cicatriz na testa', (g) => g.line(2, -9, 5, -5))
// no meio do rosto (uma só)
add({ id: 'proc/cic_labio', slot: 'scar_face', name: 'Lábio partido', palette: 'scar', color: 'palida', alpha: 0.95,
  draw: (g) => { for (let v = 2; v <= 5; v++) g.cdot(1, v) } })
add({ id: 'proc/cic_nariz', slot: 'scar_face', name: 'Corte no nariz', palette: 'scar', color: 'palida', alpha: 0.95,
  draw: (g) => { g.dot(-2, 1); g.dot(-1, 2); g.dot(0, 2); g.dot(1, 3) } })
add({ id: 'proc/cic_queixo', slot: 'scar_face', name: 'Cicatriz no queixo', palette: 'scar', color: 'palida', alpha: 0.95,
  draw: (g) => { g.dot(0, 4); g.dot(0, 5); g.dot(1, 5) } })

// Maquiagem
add({ id: 'proc/batom_fino', slot: 'makeup_lips', name: 'Batom fino', palette: 'lip', color: 'vermelho', alpha: 0.95,
  draw: (g) => { for (let u = -2; u <= 1; u++) g.cdot(u, 3) } })
add({ id: 'proc/batom_cheio', slot: 'makeup_lips', name: 'Batom cheio', palette: 'lip', color: 'vermelho', alpha: 0.95,
  draw: (g) => { for (let u = -2; u <= 1; u++) g.cdot(u, 3); g.cdot(-1, 4); g.cdot(0, 4) } })
add({ id: 'proc/batom_largo', slot: 'makeup_lips', name: 'Batom largo', palette: 'lip', color: 'rosa', alpha: 0.95,
  draw: (g) => { for (let u = -3; u <= 2; u++) g.cdot(u, 3); for (let u = -2; u <= 1; u++) g.cdot(u, 4) } })
add({ id: 'proc/batom_escuro', slot: 'makeup_lips', name: 'Batom escuro (gótico)', palette: 'lip', color: 'preto', alpha: 1,
  draw: (g) => { for (let u = -3; u <= 2; u++) g.cdot(u, 3); for (let u = -2; u <= 1; u++) g.cdot(u, 4); g.cdot(-3, 2); g.cdot(2, 2) } })
add({ id: 'proc/gloss', slot: 'makeup_lips', name: 'Gloss', palette: 'lip', color: 'nude', alpha: 0.7,
  draw: (g) => { for (let u = -2; u <= 1; u++) g.cdot(u, 3); g.cdot(-1, 4); g.cdot(0, 4); g.cdot(0, 3, 1, '#ffffff') } })

add({ id: 'proc/delineado', slot: 'makeup_eyes', name: 'Delineado', palette: 'shadow', color: 'preto', alpha: 0.95, eyes: true,
  draw: (g) => g.both(() => g.rect(2, -2, 4, 1)) })
add({ id: 'proc/delineado_gatinho', slot: 'makeup_eyes', name: 'Delineado gatinho', palette: 'shadow', color: 'preto', alpha: 0.95, eyes: true,
  draw: (g) => g.both(() => { g.rect(2, -2, 4, 1); g.dot(6, -3); g.dot(7, -4) }) })
add({ id: 'proc/sombra', slot: 'makeup_eyes', name: 'Sombra nos olhos', palette: 'shadow', color: 'roxo', alpha: 0.6,
  draw: (g) => g.both(() => g.rect(2, -3, 4, 2)) })
add({ id: 'proc/esfumado', slot: 'makeup_eyes', name: 'Olho esfumado', palette: 'shadow', color: 'preto', alpha: 0.4,
  draw: (g) => g.both(() => { g.rect(1, -3, 6, 2); g.rect(2, 2, 5, 2); g.rect(2, -1, 1, 3); g.rect(5, -1, 2, 3) }) })
add({ id: 'proc/brilho_olhos', slot: 'makeup_eyes', name: 'Glitter nos olhos', palette: 'shadow', color: 'dourado', alpha: 1,
  draw: (g) => g.both(() => { g.pts([[2, -3], [4, -3], [6, -2], [7, 0], [6, 2], [3, 3], [5, 3], [1, -1]]) }) })
add({ id: 'proc/lagrima_brilho', slot: 'makeup_eyes', name: 'Lágrima de glitter', palette: 'shadow', color: 'prata', alpha: 1,
  draw: (g) => g.both(() => { g.dot(4, 2); g.dot(4, 3); g.dot(5, 4) }) })
add({ id: 'proc/olheiras_goticas', slot: 'makeup_eyes', name: 'Olheiras góticas', palette: 'shadow', color: 'preto', alpha: 0.55, eyes: true,
  draw: (g) => g.both(() => { g.rect(2, 2, 5, 2); g.rect(2, -2, 5, 1); g.dot(7, 1) }) })

add({ id: 'proc/blush_suave', slot: 'makeup_cheeks', name: 'Blush suave', palette: 'blush', color: 'rosa', alpha: 0.45,
  draw: (g) => g.both(() => g.rect(5, 2, 3, 2)) })
add({ id: 'proc/blush_forte', slot: 'makeup_cheeks', name: 'Blush forte', palette: 'blush', color: 'coral', alpha: 0.65,
  draw: (g) => g.both(() => { g.rect(5, 1, 4, 3); g.rect(6, 4, 2, 1) }) })
add({ id: 'proc/rubor_nariz', slot: 'makeup_cheeks', name: 'Rubor no nariz e bochechas', palette: 'blush', color: 'rosa', alpha: 0.35,
  draw: (g) => g.both(() => { g.rect(-1, 1, 10, 2); g.rect(-1, 3, 3, 1) }) })
add({ id: 'proc/contorno', slot: 'makeup_cheeks', name: 'Contorno', palette: 'blush', color: 'marrom', alpha: 0.4,
  draw: (g) => g.both(() => { g.line(9, 0, 6, 4); g.line(8, 0, 6, 3) }) })

// Pintura de rosto
add({ id: 'proc/guerra_listras', slot: 'face_paint', name: 'Pintura de guerra', palette: 'paint', color: 'vermelho', alpha: 1,
  draw: (g) => g.both(() => { g.line(5, 0, 8, 3); g.line(4, 1, 7, 4); g.line(3, 2, 6, 5) }) })
add({ id: 'proc/faixa_olhos', slot: 'face_paint', name: 'Faixa sobre os olhos', palette: 'paint', color: 'preto', alpha: 1,
  draw: (g) => { g.rect(-9, -2, 19, 1); g.rect(-9, 2, 19, 1); g.rect(-9, -1, 4, 3) ; g.rect(6, -1, 4, 3) } })
add({ id: 'proc/boca_costurada', slot: 'face_paint', name: 'Boca costurada', palette: 'paint', color: 'preto', alpha: 1,
  draw: (g) => { for (let u = -3; u <= 2; u++) g.cdot(u, 3); for (const u of [-3, -1, 1]) { g.cdot(u, 2); g.cdot(u, 4) } } })
add({ id: 'proc/meia_face', slot: 'face_paint', name: 'Meia face pintada', palette: 'paint', color: 'branco', alpha: 0.92,
  draw: (g) => { g.rect(0, -8, 10, 14) } })
add({ id: 'proc/lagrimas_pintadas', slot: 'face_paint', name: 'Lágrimas pintadas', palette: 'paint', color: 'azul', alpha: 1,
  draw: (g) => g.both(() => { g.dot(4, 2); g.dot(4, 3); g.dot(3, 4); g.dot(4, 4); g.dot(5, 4); g.dot(4, 5) }) })
add({ id: 'proc/estrelas', slot: 'face_paint', name: 'Estrelas', palette: 'paint', color: 'dourado', alpha: 1,
  draw: (g) => g.both(() => { g.pts([[6, 2], [5, 3], [6, 3], [7, 3], [6, 4]]); g.dot(8, -2); g.dot(2, 4) }) })
add({ id: 'proc/raio', slot: 'face_paint', name: 'Raio', palette: 'paint', color: 'amarelo', alpha: 1,
  draw: (g) => { g.pts([[6, -6], [5, -5], [6, -5], [5, -4], [6, -3], [5, -2], [4, -2]]); g.pts([[5, 2], [6, 2], [5, 3], [4, 4], [5, 4], [4, 5]]) } })
add({ id: 'proc/linhas_cyber', slot: 'face_paint', name: 'Linhas cyber', palette: 'paint', color: 'neon_ciano', alpha: 1,
  draw: (g) => g.both(() => { g.line(9, -3, 6, -3); g.line(6, -3, 6, 1); g.line(6, 1, 8, 3); g.dot(9, -3, 1, '#ffffff'); g.dot(8, 3, 1, '#ffffff') }) })
add({ id: 'proc/tigre', slot: 'face_paint', name: 'Listras de tigre', palette: 'paint', color: 'preto', alpha: 1,
  draw: (g) => g.both(() => { g.rect(6, 0, 3, 1); g.rect(5, 2, 4, 1); g.rect(6, 4, 3, 1); g.rect(2, -7, 1, 3); g.rect(5, -7, 1, 3) }) })
add({ id: 'proc/palhaco', slot: 'face_paint', name: 'Bochechas de palhaço', palette: 'paint', color: 'vermelho', alpha: 1,
  draw: (g) => { g.both(() => g.rect(6, 1, 3, 3)); g.cdot(-1, 2); g.cdot(0, 2); g.cdot(-1, 1); g.cdot(0, 1) } })
add({ id: 'proc/lua_testa', slot: 'face_paint', name: 'Lua na testa', palette: 'paint', color: 'prata', alpha: 1,
  draw: (g) => { g.pts([[0, -7], [1, -7], [2, -6], [2, -5], [1, -4], [0, -4], [-1, -7], [-2, -6], [-2, -5], [-1, -4]]) } })

// Tatuagens do rosto
add({ id: 'proc/tat_tribal', slot: 'tattoo_face', name: 'Tribal na testa', palette: 'ink', color: 'preto', alpha: 0.95,
  draw: (g) => g.both(() => { g.line(0, -5, 4, -7); g.line(1, -4, 6, -6); g.line(4, -7, 4, -4) }) })
add({ id: 'proc/tat_lagrima', slot: 'tattoo_face', name: 'Lágrima tatuada', palette: 'ink', color: 'azul_escuro', alpha: 0.95,
  draw: (g) => { g.dot(4, 2); g.dot(4, 3); g.dot(3, 4); g.dot(5, 4); g.dot(4, 5) } })
add({ id: 'proc/tat_queixo', slot: 'tattoo_face', name: 'Linhas no queixo', palette: 'ink', color: 'preto', alpha: 0.95,
  draw: (g) => { for (const u of [-2, 0, 2]) { g.cdot(u, 4); g.cdot(u, 5) } } })
add({ id: 'proc/tat_tempora', slot: 'tattoo_face', name: 'Linhas na têmpora', palette: 'ink', color: 'preto', alpha: 0.95,
  draw: (g) => g.both(() => { g.line(8, -4, 8, 2); g.line(9, -2, 9, 3) }) })
add({ id: 'proc/tat_runas', slot: 'tattoo_face', name: 'Runas na bochecha', palette: 'ink', color: 'vermelho', alpha: 0.95,
  draw: (g) => { g.line(7, 0, 7, 4); g.dot(6, 1); g.dot(8, 2); g.dot(6, 3) } })
add({ id: 'proc/tat_estrela', slot: 'tattoo_face', name: 'Estrela na bochecha', palette: 'ink', color: 'preto', alpha: 0.95,
  draw: (g) => { g.pts([[7, 1], [6, 2], [7, 2], [8, 2], [7, 3]]) } })

export const PROC_DEFS = new Map(defs.map((d) => [d.id, d]))

/** Espaços novos (aba e nome em português). */
export const PROC_SLOTS: CharSlot[] = [
  { id: 'skin_spots', label: 'Manchas e sardas', group: 'Marcas' },
  { id: 'scar_face', label: 'Cicatriz no rosto', group: 'Marcas' },
  { id: 'makeup_lips', label: 'Batom', group: 'Maquiagem' },
  { id: 'makeup_eyes', label: 'Olhos', group: 'Maquiagem' },
  { id: 'makeup_cheeks', label: 'Bochechas', group: 'Maquiagem' },
  { id: 'face_paint', label: 'Pintura de rosto', group: 'Maquiagem' },
  { id: 'tattoo_face', label: 'Tatuagem no rosto', group: 'Maquiagem' },
]

const ALL_BODIES = ['male', 'female', 'muscular', 'teen', 'child'] as CharItem['bodies']

/** As receitas como itens do catálogo (sem folhas de imagem: `proc`). */
export function procItems(): CharItem[] {
  return defs.map((d) => ({
    id: d.id,
    slot: d.slot,
    name: d.name,
    layers: [],
    bodies: ALL_BODIES,
    anims: ['walk', 'idle', 'run'],
    proc: true,
    ...(d.palette ? { colors: [{ key: 'color', label: 'Cor', material: d.palette, source: [] }] } : {}),
  }))
}

/** Paletas das peças desenhadas, no formato das do boneco. */
export function procPalettes(): CharPalettes {
  return Object.fromEntries(Object.entries(PROC_PALETTES).map(([k, v]) => [k, v])) as CharPalettes
}

/** A cor (hex) de uma peça: a escolhida na paleta, senão a padrão. */
export function procColor(def: ProcDef, chosen?: string): string {
  if (!def.palette) return '#000000'
  const table = PROC_PALETTES[def.palette] as Record<string, string[]>
  const name = chosen && table[chosen] ? chosen : def.color && table[def.color] ? def.color : Object.keys(table)[0]
  return table[name][0]
}

/** Caixa da cabeça no quadro (col, row) de uma folha de cabeça. */
export function headBox(head: ImageData, sx: number, sy: number): Box | null {
  let x0 = 64, y0 = 64, x1 = 0, y1 = 0
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (head.data[((sy + y) * head.width + sx + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x >= x1) x1 = x + 1
      if (y < y0) y0 = y
      if (y >= y1) y1 = y + 1
    }
  }
  return x1 > x0 ? { x0, y0, x1, y1 } : null
}

/**
 * Pinta uma peça no quadro (col,row) da folha de saída.
 * `head` = a folha (já com a cor da pele) da cabeça; `dx,dy` = onde o quadro fica em `ctx`; `sx,sy` = onde fica em `head`.
 */
export function paintProc(
  ctx: CanvasRenderingContext2D, dx: number, dy: number, head: ImageData, sx: number, sy: number,
  row: number, def: ProcDef, chosenColor?: string,
) {
  if (row === 0) return
  const box = headBox(head, sx, sy)
  if (!box) return
  const g = new Gfx(ctx, dx, dy, head, sx, sy, row, box)
  g.color = procColor(def, chosenColor)
  g.alpha = def.alpha ?? 1
  g.eyes = !!def.eyes
  def.draw(g)
}
