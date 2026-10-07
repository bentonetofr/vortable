// ────────────────────────────────────────────────────────
// Partículas leves da atmosfera: faíscas e fumaça das fogueiras,
// vaga-lumes à noite ao ar livre, poeira no ar de interiores e
// masmorras. Poucas, com sprites reaproveitados, e só perto da tela.
// Faíscas e vaga-lumes ficam POR CIMA da escuridão (brilham sozinhos);
// fumaça e poeira ficam por baixo (só aparecem onde há luz).
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'

export const DOT = 'light:dot'
export const PUFF = 'light:puff'
export const DEPTH_GLOWING = 900_010
export const DEPTH_AIR = 800_000

type Kind = 'spark' | 'smoke' | 'fly' | 'dust'

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
}

export interface FireSource {
  x: number
  y: number
  /** Fogueira ao ar livre: solta fumaça além das faíscas. */
  smoke: boolean
}

export interface ParticleFrame {
  /** Área visível do mundo (com folga). */
  view: { x: number; y: number; w: number; h: number }
  fires: FireSource[]
  /** 0–1: quantos vaga-lumes (noite ao ar livre). */
  fireflies: number
  /** 0–1: quanta poeira no ar (interiores, subterrâneos). */
  dust: number
}

const FLIES_MAX = 18
const DUST_MAX = 30
const SPARKS_PER_S = 5
const SMOKE_PER_S = 1.4

export class Particles {
  private pool: Phaser.GameObjects.Image[] = []
  private list: P[] = []
  /** Sobra fracionária de partículas a soltar por fogueira (posição → acumulado). */
  private due = new Map<string, number>()

  constructor(private scene: Phaser.Scene) {}

  private take(kind: Kind, x: number, y: number): P {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, DOT)
    const glowing = kind === 'spark' || kind === 'fly'
    img.setTexture(kind === 'smoke' ? PUFF : DOT).setVisible(true).setAlpha(0)
      .setBlendMode(glowing ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setDepth(glowing ? DEPTH_GLOWING : DEPTH_AIR)
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

  update(dt: number, t: number, f: ParticleFrame) {
    const v = f.view
    const inView = (x: number, y: number, m = 0) => x > v.x - m && x < v.x + v.w + m && y > v.y - m && y < v.y + v.h + m

    // novas faíscas e fumaça nas fogueiras à vista
    for (const s of f.fires) {
      if (!inView(s.x, s.y, 64)) continue
      const k = `${s.x},${s.y}`
      let due = (this.due.get(k) ?? Math.random()) + dt * SPARKS_PER_S
      while (due >= 1) {
        due -= 1
        const p = this.take('spark', s.x + (Math.random() - 0.5) * 10, s.y + 2)
        p.vx = (Math.random() - 0.5) * 14
        p.vy = -(28 + Math.random() * 30)
        p.max = 0.5 + Math.random() * 0.7
        p.size = 0.3 + Math.random() * 0.2
        p.img.setTint(Math.random() < 0.5 ? 0xffd27a : 0xff8a3a)
      }
      this.due.set(k, due)
      if (!s.smoke) continue
      const ks = k + 's'
      let smoke = (this.due.get(ks) ?? Math.random()) + dt * SMOKE_PER_S
      while (smoke >= 1) {
        smoke -= 1
        const p = this.take('smoke', s.x + (Math.random() - 0.5) * 8, s.y - 10)
        p.vx = 4 + Math.random() * 5
        p.vy = -(10 + Math.random() * 7)
        p.max = 3 + Math.random() * 1.5
        p.size = 0.35 + Math.random() * 0.15
        p.img.setTint(0x8c8c8c)
      }
      this.due.set(ks, smoke)
    }

    // vaga-lumes e poeira: mantém a quantidade pedida espalhada pela tela
    const count = (kind: Kind) => this.list.reduce((n, p) => n + (p.kind === kind ? 1 : 0), 0)
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
      if (p.life >= p.max || ((p.kind === 'fly' || p.kind === 'dust') && !inView(p.x, p.y, 96))) {
        this.drop(i)
        continue
      }
      const a = p.life / p.max
      let alpha = 1, scale = p.size
      if (p.kind === 'spark') {
        p.vx += Math.sin(t * 9 + p.phase) * 40 * dt
        p.vy += 6 * dt
        alpha = 1 - a * a
        scale = p.size * (1 - a * 0.6)
      } else if (p.kind === 'smoke') {
        p.vx += 1.5 * dt
        alpha = 0.22 * Math.sin(Math.min(1, a * 4) * Math.PI / 2) * (1 - a)
        scale = p.size * (1 + a * 3)
      } else if (p.kind === 'fly') {
        p.vx = Math.cos(t * 0.7 + p.phase) * 10 + Math.sin(t * 1.9 + p.phase * 2) * 6
        p.vy = Math.sin(t * 0.9 + p.phase) * 8
        const blink = Math.max(0, Math.sin(t * 1.6 + p.phase * 3))
        alpha = blink * blink * Math.min(1, a * 6, (1 - a) * 6) * Math.max(0.3, f.fireflies)
      } else {
        p.vx += Math.sin(t * 0.5 + p.phase) * 0.6 * dt
        alpha = (0.3 + 0.25 * Math.sin(t * 1.3 + p.phase)) * Math.min(1, a * 5, (1 - a) * 5)
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.img.setPosition(p.x, p.y).setAlpha(alpha).setScale(scale)
    }
  }
}
