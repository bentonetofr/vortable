// ────────────────────────────────────────────────────────
// Tempo da zona: limpo, nublado, neblina, garoa, chuva, tempestade, neve
// leve, neve, nevasca. Cada um mexe em:
//   - a luz (lighting.ts): céu mais cinza/escuro, sombra do sol some no
//     encoberto, relâmpago clareia tudo, nuvens fazem sombra no chão
//   - o que cai do céu (aqui): gotas inclinadas pelo vento com respingo no
//     chão, flocos que flutuam e pousam
//   - o que passa por cima (aqui): nuvens translúcidas no céu (a sombra
//     delas fica deslocada pelo sol) e neblina arrastando devagar
// Gotas e flocos ficam debaixo da escuridão: à noite só aparecem perto da luz.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import type { RGB } from './daylight'
import type { Wind } from './wind'

export type WeatherId = 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'lightsnow' | 'snow' | 'blizzard'

export interface WeatherDef {
  label: string
  /** Quanto do céu está coberto (0–1): sombra de nuvens e nuvens visíveis. */
  cover: number
  /** Escurece a luz do dia (0–1) e tira cor (0–1). */
  dim: number
  desat: number
  /** Puxa a luz pra essa cor (neve: azulada). */
  tint?: string
  /** Força do sol (sombras): 1 = limpo, 0 = encoberto. */
  sun: number
  /** 0–1. */
  rain: number
  snow: number
  fog: number
  fogColor: number
  /** Nuvens no céu, cinza nas de chuva. */
  skyColor: number
  /** Vento mínimo (tempestade e nevasca sopram forte). */
  minWind: number
  lightning: boolean
}

const base: Omit<WeatherDef, 'label'> = {
  cover: 0.15, dim: 0, desat: 0, sun: 1, rain: 0, snow: 0, fog: 0, fogColor: 0xffffff, skyColor: 0xffffff, minWind: 0, lightning: false,
}

export const WEATHERS: Record<WeatherId, WeatherDef> = {
  clear: { ...base, label: 'Limpo' },
  cloudy: { ...base, label: 'Nublado', cover: 0.62, dim: 0.12, desat: 0.25, sun: 0.25 },
  fog: { ...base, label: 'Neblina', cover: 0.45, dim: 0.1, desat: 0.4, sun: 0.15, fog: 0.75 },
  drizzle: { ...base, label: 'Garoa', cover: 0.72, dim: 0.16, desat: 0.3, sun: 0.1, rain: 0.25, minWind: 0.15, skyColor: 0xc8ccd6 },
  rain: { ...base, label: 'Chuva', cover: 0.85, dim: 0.27, desat: 0.42, sun: 0, rain: 0.6, fog: 0.15, fogColor: 0xa8b0c0, minWind: 0.35, skyColor: 0xa4aab8 },
  storm: { ...base, label: 'Tempestade', cover: 1, dim: 0.45, desat: 0.5, sun: 0, rain: 1, fog: 0.28, fogColor: 0x8c94a6, minWind: 0.9, skyColor: 0x80869a, lightning: true },
  lightsnow: { ...base, label: 'Neve leve', cover: 0.6, dim: 0.04, desat: 0.3, tint: '#e4ecff', sun: 0.25, snow: 0.3 },
  snow: { ...base, label: 'Neve', cover: 0.8, dim: 0.1, desat: 0.4, tint: '#dce6ff', sun: 0, snow: 0.65, fog: 0.15 },
  blizzard: { ...base, label: 'Nevasca', cover: 1, dim: 0.2, desat: 0.55, tint: '#dce6ff', sun: 0, snow: 1, fog: 0.6, minWind: 1 },
}

export const WEATHER_ORDER: WeatherId[] = ['clear', 'cloudy', 'fog', 'drizzle', 'rain', 'storm', 'lightsnow', 'snow', 'blizzard']

export function weatherOf(id: string | undefined): WeatherDef {
  return WEATHERS[(id as WeatherId) ?? 'clear'] ?? WEATHERS.clear
}

/** A luz do dia passando pelas nuvens: mais escura, menos colorida, às vezes azulada. */
export function weatherAmbient(a: RGB, w: WeatherDef, amount = 1): RGB {
  if (!amount || (!w.dim && !w.desat && !w.tint)) return a
  const lum = a[0] * 0.3 + a[1] * 0.55 + a[2] * 0.15
  let c: RGB = [a[0] + (lum - a[0]) * w.desat, a[1] + (lum - a[1]) * w.desat, a[2] + (lum - a[2]) * w.desat]
  if (w.tint) {
    const n = parseInt(w.tint.slice(1), 16)
    c = [c[0] * ((n >> 16) & 255) / 255, c[1] * ((n >> 8) & 255) / 255, c[2] * (n & 255) / 255]
  }
  const k = 1 - w.dim
  c = [c[0] * k, c[1] * k, c[2] * k]
  return [a[0] + (c[0] - a[0]) * amount, a[1] + (c[1] - a[1]) * amount, a[2] + (c[2] - a[2]) * amount]
}

// ── nuvens: um ruído que emenda nas bordas, recortado conforme a cobertura ──

export const CLOUD_SIZE = 256
/** Um ladrilho da textura de nuvens cobre isso do mundo (px). */
export const CLOUD_TILE = 1024
let noise: Float32Array | null = null

function cloudNoise() {
  if (noise) return noise
  const N = CLOUD_SIZE
  const grid = (cells: number, seed: number) => {
    const g = new Float32Array(cells * cells)
    let a = seed
    for (let i = 0; i < g.length; i++) {
      a = (a * 1103515245 + 12345) >>> 0
      g[i] = (a >>> 8) / 16777216
    }
    return (x: number, y: number) => {
      const fx = (x / N) * cells, fy = (y / N) * cells
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const at = (cx: number, cy: number) => g[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)]
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
      return top + (bot - top) * sy
    }
  }
  const big = grid(4, 7), mid = grid(8, 31), small = grid(16, 97)
  noise = new Float32Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) noise[y * N + x] = big(x, y) * 0.55 + mid(x, y) * 0.3 + small(x, y) * 0.15
  return noise
}

/** Quanto de nuvem em cada ponto (0–1) pra essa cobertura. */
function cloudAt(n: number, cover: number) {
  const threshold = 0.68 - cover * 0.4
  const t = Math.max(0, Math.min(1, (n - threshold) / 0.18))
  return t * t * (3 - 2 * t)
}

/**
 * Texturas das nuvens pra uma cobertura: a SOMBRA (opaca, cinza no branco,
 * pra multiplicar a luz) e o CÉU (branco com alfa, pra passar por cima).
 */
export function cloudTextures(scene: Phaser.Scene, cover: number) {
  const level = Math.round(cover * 20) / 20
  const shadow = `fx:clouds:shadow:${level}`, sky = `fx:clouds:sky:${level}`, mist = 'fx:mist'
  const tm = scene.textures
  if (!tm.exists(shadow)) {
    const n = cloudNoise(), N = CLOUD_SIZE
    const mk = (fill: (i: number, d: Uint8ClampedArray, o: number) => void) => {
      const c = document.createElement('canvas')
      c.width = c.height = N
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      const img = ctx.createImageData(N, N)
      for (let i = 0; i < N * N; i++) fill(i, img.data, i * 4)
      ctx.putImageData(img, 0, 0)
      return c
    }
    const dark = 0.28 + level * 0.12
    tm.addCanvas(shadow, mk((i, d, o) => {
      const v = 255 * (1 - dark * cloudAt(n[i], level))
      d[o] = d[o + 1] = d[o + 2] = v
      d[o + 3] = 255
    }))?.setFilter(Phaser.Textures.FilterMode.LINEAR)
    tm.addCanvas(sky, mk((i, d, o) => {
      d[o] = d[o + 1] = d[o + 2] = 255
      d[o + 3] = 255 * cloudAt(n[i], level)
    }))?.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
  if (!tm.exists(mist)) {
    // neblina: o mesmo ruído, bem mais mole (faixas que vão e voltam)
    const n = cloudNoise(), N = CLOUD_SIZE
    const c = document.createElement('canvas')
    c.width = c.height = N
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const img = ctx.createImageData(N, N)
    for (let i = 0; i < N * N; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = 255 * Math.max(0, Math.min(1, 0.35 + (n[(i * 3) % (N * N)] - 0.45) * 1.6))
    }
    ctx.putImageData(img, 0, 0)
    tm.addCanvas(mist, c)?.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
  return { shadow, sky, mist }
}

// ── o que cai do céu ──

const DROP = 'fx:drop'
const SPLASH = 'fx:splash'
const FLAKE = 'fx:flake'
const DEPTH_FALLING = 850_000
const DEPTH_SPLASH = -398_000
const DEPTH_FOG = 860_000
const DEPTH_SKY = 870_000
/** Quantos na tela de referência (700×450 px do mundo) com a força máxima. */
const DROPS_MAX = 650
const FLAKES_MAX = 700
const CAP = 1400

function ensureTextures(scene: Phaser.Scene) {
  const tm = scene.textures
  const pixels = (key: string, rows: string[]) => {
    if (tm.exists(key)) return
    const c = document.createElement('canvas')
    c.width = rows[0].length
    c.height = rows.length
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = ch === '#' ? '#fff' : ch === '+' ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)'
      ctx.fillRect(x, y, 1, 1)
    }))
    tm.addCanvas(key, c)?.setFilter(Phaser.Textures.FilterMode.NEAREST)
  }
  // gota: risco com a cauda apagando; respingo: coroinha; floco: cruz macia
  pixels(DROP, ['-', '-', '+', '+', '+', '#', '#'])
  pixels(SPLASH, ['+...+', '.+.+.', '..#..'])
  pixels(FLAKE, ['.+.', '+#+', '.+.'])
}

interface Fall { img: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; land: number; size: number; phase: number; fade: number }
interface Splash { img: Phaser.GameObjects.Image; life: number }

export interface WeatherFrame {
  view: { x: number; y: number; w: number; h: number }
  def: WeatherDef
  wind: Wind
  /** Ao ar livre (dentro de casa não chove nem neva). */
  outdoor: boolean
  /** Pra onde cai a sombra (radianos, 0 = pra baixo): a nuvem fica do outro lado. */
  sunAngle: number
  /** Brilho das nuvens de dia/noite (de noite somem no escuro). */
  day: number
  /** Onde está o desenho das nuvens agora (o mesmo da sombra delas). */
  cloudX: number
  cloudY: number
}

export class WeatherFx {
  private drops: Fall[] = []
  private flakes: Fall[] = []
  private splashes: Splash[] = []
  private spare: Phaser.GameObjects.Image[] = []
  private sky?: Phaser.GameObjects.TileSprite
  private fog?: Phaser.GameObjects.TileSprite
  private time = 0
  private nextStrike = 4
  /** Relâmpago agora (0–1): a luz clareia por um instante. */
  flash = 0
  private strike = -1

  constructor(private scene: Phaser.Scene) {
    ensureTextures(scene)
  }

  private take(tex: string, depth: number) {
    const img = this.spare.pop() ?? this.scene.add.image(0, 0, tex)
    return img.setTexture(tex).setDepth(depth).setVisible(true).setAlpha(1).setRotation(0).setScale(1).setOrigin(0.5, 1)
  }

  private give(img: Phaser.GameObjects.Image) {
    img.setVisible(false)
    this.spare.push(img)
  }

  clear() {
    for (const d of this.drops) this.give(d.img)
    for (const f of this.flakes) this.give(f.img)
    for (const s of this.splashes) this.give(s.img)
    this.drops = []
    this.flakes = []
    this.splashes = []
    this.sky?.setVisible(false)
    this.fog?.setVisible(false)
    this.flash = 0
  }

  destroy() {
    this.clear()
    for (const img of this.spare) img.destroy()
    this.spare = []
    this.sky?.destroy()
    this.fog?.destroy()
  }

  update(dt: number, f: WeatherFrame) {
    this.time += dt
    const { view: v, def: w, wind } = f
    const area = Math.min(4, (v.w * v.h) / (700 * 450))
    const S = wind.strength

    // ── relâmpagos ──
    this.flash = 0
    if (w.lightning) {
      this.nextStrike -= dt
      if (this.nextStrike <= 0) {
        this.strike = 0
        this.nextStrike = 5 + Math.random() * 10
      }
      if (this.strike >= 0) {
        // dois clarões rápidos e um rabo apagando
        const s = (this.strike += dt)
        this.flash = s < 0.08 ? 1 : s < 0.16 ? 0.25 : s < 0.24 ? 0.85 : Math.max(0, 0.85 - (s - 0.24) * 1.6)
        if (this.flash <= 0 && s > 0.3) this.strike = -1
      }
    } else {
      this.strike = -1
    }

    const outdoor = f.outdoor
    // ── chuva ──
    const wantDrops = outdoor ? Math.min(CAP, Math.round(DROPS_MAX * w.rain * area)) : 0
    const fallSpeed = 430 + 140 * w.rain
    const slant = wind.dx * (40 + 260 * S)
    while (this.drops.length < wantDrops) this.drops.push(this.newDrop(v, fallSpeed, slant, true))
    while (this.drops.length > wantDrops) this.give(this.drops.pop()!.img)
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i]
      d.x += d.vx * dt
      d.y += d.vy * dt
      if (d.y >= d.land) {
        // respingo (nem toda gota, pra não pesar) e volta lá pra cima
        if (Math.random() < 0.35 && this.splashes.length < 260) {
          const img = this.take(SPLASH, DEPTH_SPLASH).setPosition(Math.round(d.x), Math.round(d.land)).setOrigin(0.5, 1)
          this.splashes.push({ img, life: 0 })
        }
        this.give(d.img)
        this.drops[i] = this.newDrop(v, fallSpeed, slant, false)
        continue
      }
      d.img.setPosition(d.x, d.y)
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]
      s.life += dt
      const a = s.life / 0.28
      if (a >= 1) {
        this.give(s.img)
        this.splashes[i] = this.splashes[this.splashes.length - 1]
        this.splashes.pop()
        continue
      }
      s.img.setAlpha(0.7 * (1 - a)).setScale(0.7 + a * 0.6, 1)
    }

    // ── neve ──
    const wantFlakes = outdoor ? Math.min(CAP, Math.round(FLAKES_MAX * w.snow * area)) : 0
    while (this.flakes.length < wantFlakes) this.flakes.push(this.newFlake(v, w.snow, S, true))
    while (this.flakes.length > wantFlakes) this.give(this.flakes.pop()!.img)
    for (let i = 0; i < this.flakes.length; i++) {
      const fl = this.flakes[i]
      const gust = wind.gust(fl.x, fl.y)
      fl.x += (fl.vx * (0.6 + gust) + Math.sin(this.time * 1.7 + fl.phase) * 10 * fl.size) * dt
      fl.y += fl.vy * dt
      // pousou: apaga rápido e nasce outro lá em cima
      if (fl.y >= fl.land) fl.fade += dt * 3
      const out = fl.x < v.x - 80 || fl.x > v.x + v.w + 80 || fl.y > v.y + v.h + 20
      if (fl.fade >= 1 || out) {
        this.give(fl.img)
        this.flakes[i] = this.newFlake(v, w.snow, S, false)
        continue
      }
      fl.img.setPosition(Math.round(fl.x), Math.round(fl.y)).setAlpha((1 - fl.fade) * 0.95)
    }

    // ── nuvens passando por cima e neblina ──
    const { sky, mist } = cloudTextures(this.scene, w.cover)
    const skyAlpha = outdoor && w.cover >= 0.5 ? (0.08 + (w.cover - 0.5) * 0.36) * (0.35 + 0.65 * f.day) : 0
    const ox = f.cloudX, oy = f.cloudY
    if (skyAlpha > 0.01) {
      if (!this.sky) this.sky = this.scene.add.tileSprite(0, 0, 4, 4, sky).setOrigin(0, 0).setDepth(DEPTH_SKY).setTileScale(CLOUD_TILE / CLOUD_SIZE)
      // a nuvem fica do lado oposto da sombra dela (a sombra cai na direção do sol)
      const shift = 150
      const cx = ox + Math.sin(f.sunAngle) * shift, cy = oy - Math.cos(f.sunAngle) * shift
      this.tile(this.sky, sky, v, cx, cy).setAlpha(skyAlpha).setTint(w.skyColor)
    } else {
      this.sky?.setVisible(false)
    }
    if (w.fog > 0.01) {
      if (!this.fog) this.fog = this.scene.add.tileSprite(0, 0, 4, 4, mist).setOrigin(0, 0).setDepth(DEPTH_FOG).setTileScale(2)
      // neblina anda devagar, mesmo sem vento
      this.tile(this.fog, mist, v, this.time * (6 + 30 * S), this.time * 3, 512).setAlpha(w.fog * 0.55).setTint(w.fogColor)
    } else {
      this.fog?.setVisible(false)
    }
  }

  /** Ladrilho que cobre a tela, preso ao mundo e deslizando (ox, oy) px. */
  private tile(t: Phaser.GameObjects.TileSprite, key: string, v: WeatherFrame['view'], ox: number, oy: number, tileWorld = CLOUD_TILE) {
    if (t.texture.key !== key) t.setTexture(key)
    const scale = tileWorld / CLOUD_SIZE
    t.setTileScale(scale).setVisible(true).setPosition(v.x, v.y).setSize(v.w, v.h)
    t.tilePositionX = (v.x - ox) / scale
    t.tilePositionY = (v.y - oy) / scale
    return t
  }

  private newDrop(v: WeatherFrame['view'], speed: number, slant: number, anywhere: boolean): Fall {
    const vy = speed * (0.85 + Math.random() * 0.3)
    const land = v.y + Math.random() * (v.h + 40)
    // nasce acima de onde vai cair, recuado contra o vento
    const t = anywhere ? Math.random() * 0.6 : (land - (v.y - 30)) / vy
    const x = v.x - 40 + Math.random() * (v.w + 80) - slant * t
    const img = this.take(DROP, DEPTH_FALLING)
    const len = 0.8 + Math.random() * 0.6
    img.setScale(1, len * 1.5).setRotation(-Math.atan2(slant, vy)).setAlpha(0.32 + Math.random() * 0.2).setPosition(x, land - vy * t)
    return { img, x, y: land - vy * t, vx: slant, vy, land, size: len, phase: 0, fade: 0 }
  }

  private newFlake(v: WeatherFrame['view'], snow: number, S: number, anywhere: boolean): Fall {
    const size = 0.5 + Math.random() * 0.8
    const vy = (14 + 26 * size) * (0.8 + snow * 0.6)
    const vx = (8 + 150 * S * S) * size
    const y = anywhere ? v.y + Math.random() * v.h : v.y - 10 - Math.random() * 30
    // com vento forte, entra pelo lado de onde ele vem
    const fromSide = !anywhere && S > 0.5 && Math.random() < S * 0.6
    const x = fromSide ? v.x - 20 - Math.random() * 40 : v.x - 60 + Math.random() * (v.w + 60)
    const img = this.take(FLAKE, DEPTH_FALLING).setScale(size).setOrigin(0.5, 0.5)
    const y0 = fromSide ? v.y + Math.random() * v.h : y
    // pousa em algum lugar abaixo de onde nasceu
    return { img, x, y: y0, vx, vy, land: y0 + 30 + Math.random() * v.h, size, phase: Math.random() * 6.28, fade: 0 }
  }
}
