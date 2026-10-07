// ────────────────────────────────────────────────────────
// Partículas da atmosfera, com sprites reaproveitados e só perto da tela:
//   faísca, chama  — sobem das fogueiras/tochas (brilham: por cima do escuro)
//   fumaça         — das fogueiras ao ar livre
//   vaga-lume      — à noite ao ar livre (brilha)
//   poeira         — no ar dos interiores (só aparece onde há luz)
//   folha          — cai da copa das árvores, pousa e o vento leva pelo chão;
//                    a cor vem da própria copa (cerejeira solta pétala rosa)
//   brilho         — reflexos piscando na água
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import type { Wind } from './wind'

export const DOT = 'light:dot'
export const PUFF = 'light:puff'
const LEAF = 'fx:leaf'
const GLINT = 'fx:glint'
export const DEPTH_GLOWING = 900_010
export const DEPTH_AIR = 800_000
/** Folha voando: na frente das coisas, mas debaixo da escuridão. */
const DEPTH_LEAF_AIR = 700_000
/** Folha no chão: em cima das sombras, debaixo de quem está em pé. */
const DEPTH_LEAF_GROUND = -399_000
const DEPTH_GLINT = -449_000

type Kind = 'spark' | 'flame' | 'smoke' | 'fly' | 'dust' | 'leaf' | 'glint'

interface P {
  img: Phaser.GameObjects.Image
  kind: Kind
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  phase: number
  size: number
  /** Folha: ainda caindo (até chegar em groundY) ou já no chão. */
  falling?: boolean
  groundY?: number
  rot?: number
}

export interface FireSource {
  x: number
  y: number
  /** Tamanho do fogo (1 = tocha). */
  size: number
  /** Fogueira/lareira grande: solta faíscas. */
  sparks: boolean
  /** Fogueira ao ar livre: solta fumaça. */
  smoke: boolean
}

export interface LeafSource {
  /** Área da copa (de onde as folhas se soltam), px do mundo. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Onde fica o chão embaixo da árvore. */
  foot: number
  colors: number[]
}

export interface ParticleFrame {
  /** Área visível do mundo (com folga). */
  view: { x: number; y: number; w: number; h: number }
  /** A zona (px): folhas não voam pra fora dela. */
  bounds: { w: number; h: number }
  wind: Wind
  fires: FireSource[]
  trees: LeafSource[]
  /** Pontos com água (centros de vértice), pra os reflexos. */
  water: { x: number; y: number }[]
  /** 0–1: quantos vaga-lumes (noite ao ar livre). */
  fireflies: number
  /** 0–1: quanta poeira no ar (interiores, subterrâneos). */
  dust: number
  /** 0–1: quanto sol (reflexos na água mais fortes de dia). */
  day: number
}

const FLIES_MAX = 18
const DUST_MAX = 30
const LEAVES_MAX = 160
const SPARKS_PER_S = 5
const FLAMES_PER_S = 11
const SMOKE_PER_S = 1.4
/** Folhas sem árvore (ventania): cores de outono. */
const STRAY_LEAVES = [0x8fb03a, 0xd9a032, 0xc4662a, 0x76a83a, 0xe2b648]

export function ensureParticleTextures(scene: Phaser.Scene) {
  const tm = scene.textures
  const pixels = (key: string, rows: string[]) => {
    if (tm.exists(key)) return
    const c = document.createElement('canvas')
    c.width = rows[0].length
    c.height = rows.length
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = ch === '#' ? '#fff' : 'rgba(255,255,255,0.55)'
      ctx.fillRect(x, y, 1, 1)
    }))
    tm.addCanvas(key, c)?.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }
  // folha 5×3 (com um tom mais claro na ponta) e brilho em cruz
  pixels(LEAF, ['.##+.', '#####', '.+##.'])
  pixels(GLINT, ['..+..', '..#..', '+###+', '..#..', '..+..'])
}

export class Particles {
  private pool: Phaser.GameObjects.Image[] = []
  private list: P[] = []
  /** Sobra fracionária de partículas a soltar por fonte (chave → acumulado). */
  private due = new Map<string, number>()

  constructor(private scene: Phaser.Scene) {
    ensureParticleTextures(scene)
  }

  private take(kind: Kind, x: number, y: number): P {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, DOT)
    const glowing = kind === 'spark' || kind === 'fly' || kind === 'flame'
    const tex = kind === 'smoke' ? PUFF : kind === 'leaf' ? LEAF : kind === 'glint' ? GLINT : DOT
    img.setTexture(tex).setVisible(true).setAlpha(0).setRotation(0).setScale(1).clearTint()
      .setBlendMode(glowing || kind === 'glint' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setDepth(glowing ? DEPTH_GLOWING : kind === 'leaf' ? DEPTH_LEAF_AIR : kind === 'glint' ? DEPTH_GLINT : DEPTH_AIR)
    const p: P = { img, kind, x, y, vx: 0, vy: 0, life: 0, max: 1, phase: Math.random() * Math.PI * 2, size: 1 }
    this.list.push(p)
    return p
  }

  private drop(i: number) {
    const p = this.list[i]
    p.img.setVisible(false)
    this.pool.push(p.img)
    this.list[i] = this.list[this.list.length - 1]
    this.list.pop()
  }

  /** Some com tudo (iluminação desligada, troca de zona). */
  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this.drop(i)
    this.due.clear()
  }

  destroy() {
    this.clear()
    for (const img of this.pool) img.destroy()
    this.pool = []
  }

  /** Quantas soltar agora de uma fonte que solta `rate` por segundo. */
  private emit(key: string, rate: number, dt: number) {
    let due = (this.due.get(key) ?? Math.random()) + dt * rate
    const n = Math.floor(due)
    due -= n
    this.due.set(key, due)
    return n
  }

  update(dt: number, t: number, f: ParticleFrame) {
    const v = f.view, wind = f.wind, S = wind.strength
    const inView = (x: number, y: number, m = 0) => x > v.x - m && x < v.x + v.w + m && y > v.y - m && y < v.y + v.h + m
    const count = (kind: Kind) => this.list.reduce((n, p) => n + (p.kind === kind ? 1 : 0), 0)

    // ── fogo: chamas em toda tocha/lareira; faíscas e fumaça nas grandes ──
    for (const s of f.fires) {
      if (!inView(s.x, s.y, 48)) continue
      const k = `${s.x},${s.y}`
      for (let n = this.emit(k + 'f', FLAMES_PER_S * s.size, dt); n > 0; n--) {
        const p = this.take('flame', s.x + (Math.random() - 0.5) * 5 * s.size, s.y + 2)
        p.vx = (Math.random() - 0.5) * 6
        p.vy = -(16 + Math.random() * 14) * Math.sqrt(s.size)
        p.max = 0.25 + Math.random() * 0.2
        p.size = (0.24 + Math.random() * 0.08) * Math.sqrt(s.size)
      }
      if (s.sparks) {
        for (let n = this.emit(k + 's', SPARKS_PER_S, dt); n > 0; n--) {
          const p = this.take('spark', s.x + (Math.random() - 0.5) * 10, s.y + 2)
          p.vx = (Math.random() - 0.5) * 14
          p.vy = -(28 + Math.random() * 30)
          p.max = 0.5 + Math.random() * 0.7
          p.size = 0.3 + Math.random() * 0.2
          p.img.setTint(Math.random() < 0.5 ? 0xffd27a : 0xff8a3a)
        }
      }
      if (s.smoke) {
        for (let n = this.emit(k + 'm', SMOKE_PER_S, dt); n > 0; n--) {
          const p = this.take('smoke', s.x + (Math.random() - 0.5) * 8, s.y - 10)
          p.vx = 4 + Math.random() * 5
          p.vy = -(10 + Math.random() * 7)
          p.max = 3 + Math.random() * 1.5
          p.size = 0.35 + Math.random() * 0.15
          p.img.setTint(0x8c8c8c)
        }
      }
    }

    // ── folhas: soltam da copa (mais com vento) ──
    let leaves = count('leaf')
    for (const tr of f.trees) {
      if (leaves >= LEAVES_MAX) break
      if (!inView((tr.x0 + tr.x1) / 2, tr.foot, 96)) continue
      const rate = (0.03 + 0.4 * S * S) * Math.max(0.5, (tr.x1 - tr.x0) / 64)
      for (let n = this.emit(`${tr.x0},${tr.foot}`, rate, dt); n > 0 && leaves < LEAVES_MAX; n--, leaves++) {
        const p = this.take('leaf', tr.x0 + Math.random() * (tr.x1 - tr.x0), tr.y0 + Math.random() * (tr.y1 - tr.y0))
        p.falling = true
        p.groundY = tr.foot - 6 + Math.random() * 28
        p.max = 10 + Math.random() * 8
        p.img.setTint(tr.colors[Math.floor(Math.random() * tr.colors.length)] ?? STRAY_LEAVES[0])
      }
    }
    // ventania: folhas soltas entrando pelo lado de onde vem o vento
    // (só dentro da zona: a borda de quem entra é a esquerda da tela ou da zona)
    const sx0 = Math.max(0, v.x), sy0 = Math.max(0, v.y), sy1 = Math.min(f.bounds.h, v.y + v.h)
    if (S > 0.6 && leaves < LEAVES_MAX && sx0 < f.bounds.w && sy0 < sy1) {
      for (let n = this.emit('stray', (S - 0.6) * 10, dt); n > 0; n--) {
        const p = this.take('leaf', sx0 + Math.random() * 40, sy0 + Math.random() * (sy1 - sy0))
        p.falling = false
        p.vx = 40 * S
        p.max = 8 + Math.random() * 6
        p.img.setTint(STRAY_LEAVES[Math.floor(Math.random() * STRAY_LEAVES.length)]).setDepth(DEPTH_LEAF_GROUND)
      }
    }

    // ── reflexos na água ──
    if (f.water.length) {
      const rate = Math.min(14, f.water.length * 0.02) * (0.25 + 0.75 * f.day)
      for (let n = this.emit('glint', rate, dt); n > 0; n--) {
        for (let tries = 0; tries < 6; tries++) {
          const w = f.water[Math.floor(Math.random() * f.water.length)]
          if (!inView(w.x, w.y)) continue
          const p = this.take('glint', Math.round(w.x + (Math.random() - 0.5) * 28), Math.round(w.y + (Math.random() - 0.5) * 28))
          p.max = 0.5 + Math.random() * 0.6
          p.size = Math.random() < 0.3 ? 1 : 0.6
          p.img.setTint(f.day > 0.3 ? 0xffffff : 0xc8d8ff)
          break
        }
      }
    }

    // ── vaga-lumes e poeira: mantém a quantidade pedida espalhada pela tela ──
    const flies = Math.round(FLIES_MAX * f.fireflies), dust = Math.round(DUST_MAX * f.dust)
    for (let n = count('fly'); n < flies; n++) {
      const p = this.take('fly', v.x + Math.random() * v.w, v.y + Math.random() * v.h)
      p.max = 6 + Math.random() * 8
      p.size = 0.32 + Math.random() * 0.1
      p.img.setTint(0xd8ff70)
    }
    for (let n = count('dust'); n < dust; n++) {
      const p = this.take('dust', v.x + Math.random() * v.w, v.y + Math.random() * v.h)
      p.vx = 2 + Math.random() * 3
      p.vy = (Math.random() - 0.5) * 3
      p.max = 8 + Math.random() * 10
      p.size = 0.12 + Math.random() * 0.1
      p.img.setTint(0xfff0d0)
    }
    let extraFlies = count('fly') - flies, extraDust = count('dust') - dust

    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      p.life += dt
      // sobrando (amanheceu, apagou): somem aos poucos, quando acabam a vida
      if (p.kind === 'fly' && extraFlies > 0 && p.life > p.max * 0.5) { extraFlies--; p.max = Math.min(p.max, p.life + 1) }
      if (p.kind === 'dust' && extraDust > 0 && p.life > p.max * 0.5) { extraDust--; p.max = Math.min(p.max, p.life + 1) }
      const wanders = p.kind === 'fly' || p.kind === 'dust' || p.kind === 'leaf'
      const outside = p.kind === 'leaf' && (p.x < 0 || p.y < 0 || p.x > f.bounds.w || p.y > f.bounds.h)
      if (p.life >= p.max || outside || (wanders && !inView(p.x, p.y, 160))) {
        this.drop(i)
        continue
      }
      const a = p.life / p.max
      let alpha = 1, scaleX = p.size, scaleY = p.size
      if (p.kind === 'spark') {
        p.vx += Math.sin(t * 9 + p.phase) * 40 * dt
        p.vy += 6 * dt
        alpha = 1 - a * a
        scaleX = scaleY = p.size * (1 - a * 0.6)
      } else if (p.kind === 'flame') {
        // amarelo no pé, laranja, vermelho na ponta; balança e afina subindo
        p.vx += (Math.sin(t * 14 + p.phase) * 30 + wind.dx * S * 25) * dt
        alpha = 1 - a
        scaleX = p.size * (1 - a * 0.7)
        scaleY = scaleX * 1.4
        p.img.setTint(a < 0.3 ? 0xfff2a8 : a < 0.65 ? 0xffa23c : 0xff5a22)
      } else if (p.kind === 'smoke') {
        p.vx += (1.5 + S * 12 * wind.dx) * dt
        alpha = 0.22 * Math.sin(Math.min(1, a * 4) * Math.PI / 2) * (1 - a)
        scaleX = scaleY = p.size * (1 + a * 3)
      } else if (p.kind === 'fly') {
        p.vx = Math.cos(t * 0.7 + p.phase) * 10 + Math.sin(t * 1.9 + p.phase * 2) * 6
        p.vy = Math.sin(t * 0.9 + p.phase) * 8
        const blink = Math.max(0, Math.sin(t * 1.6 + p.phase * 3))
        alpha = blink * blink * Math.min(1, a * 6, (1 - a) * 6) * Math.max(0.3, f.fireflies)
      } else if (p.kind === 'dust') {
        p.vx += Math.sin(t * 0.5 + p.phase) * 0.6 * dt
        alpha = (0.3 + 0.25 * Math.sin(t * 1.3 + p.phase)) * Math.min(1, a * 5, (1 - a) * 5)
      } else if (p.kind === 'glint') {
        alpha = Math.sin(a * Math.PI)
        scaleX = scaleY = p.size * (0.6 + 0.4 * Math.sin(a * Math.PI))
      } else {
        // folha
        const g = wind.gust(p.x, p.y)
        const push = S * (0.25 + g)
        if (p.falling) {
          // cai devagar, ziguezagueando, levada pelo vento
          p.vy = 12 + 6 * Math.sin(p.phase)
          p.vx = wind.dx * push * 45 + Math.sin(t * 2.6 + p.phase) * 14
          p.rot = Math.sin(t * 3 + p.phase) * 0.9
          scaleY = Math.cos(t * 5 + p.phase)
          if (p.y >= p.groundY!) {
            p.falling = false
            p.img.setDepth(DEPTH_LEAF_GROUND)
          }
        } else {
          // no chão: só anda quando a rajada é forte; rola, pula e para
          const target = push > 0.35 ? push * 80 : 0
          p.vx += (wind.dx * target - p.vx) * Math.min(1, dt * (target ? 2.5 : 4))
          p.vy += (wind.dy * target * 0.6 - p.vy) * Math.min(1, dt * (target ? 2.5 : 4))
          const speed = Math.hypot(p.vx, p.vy)
          p.rot = (p.rot ?? 0) + p.vx * dt * 0.15
          scaleY = speed > 8 ? Math.cos(t * 14 + p.phase) : 1
        }
        p.img.setRotation(p.rot ?? 0)
        alpha = Math.min(1, a * 8, (1 - a) * 5)
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      // folha e brilho no pixel inteiro (arte pixelada); o resto é macio
      const pixel = p.kind === 'leaf' || p.kind === 'glint'
      p.img.setPosition(pixel ? Math.round(p.x) : p.x, pixel ? Math.round(p.y) : p.y).setAlpha(alpha).setScale(scaleX, scaleY)
    }
  }
}
