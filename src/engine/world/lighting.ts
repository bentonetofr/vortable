// ────────────────────────────────────────────────────────
// Iluminação da zona (jogo e editor). Três camadas, do tamanho da tela,
// redesenhadas a cada quadro:
//
//   sombras  (por baixo de quem está em pé): silhuetas dos objetos e dos
//            bonecos deitadas no chão na direção oposta ao sol; mudam de
//            tamanho e direção com a hora. Desenhadas numa textura só, pra
//            duas sombras que se cruzam não escurecerem em dobro.
//   escuridão (por cima de tudo, MULTIPLICA): enche com a cor ambiente
//            (céu da hora, interior, breu) e cada luz SOMA a cor dela num
//            gradiente — o "buraco" de luz no escuro, estilo Stardew. A
//            luz é barrada pelas paredes dos cômodos (shadowcast.ts).
//            Janelas: de dia jogam um facho de luz no chão do interior; à
//            noite, de fora, acendem. Lava e água venenosa brilham.
//   brilho   (por cima, SOMA): um halo fraco nas luzes quando escurece —
//            o fogo "acende" o ar em volta.
//
// Mais as partículas (particles.ts). As luzes, janelas e sombras saem da
// zona em rebuild(); o editor chama de novo quando a zona muda.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { objectDef, sheetTexture, type ObjectDef } from '../assets/objects'
import { TILE, type ZoneData, type ZoneObject } from '../types'
import { cornerTerrain } from './ground'
import { ambientAt, darkness, daylight, hexToRgb, lightingOf, rgbToInt, sunAt, zoneHour, type RGB } from './daylight'
import { buildOcclusion, maskedLight, type Occlusion } from './shadowcast'
import { DOT, PUFF, Particles, type FireSource } from './particles'

/**
 * Canvas na CPU: são pequenos e viram textura logo em seguida — no canvas da
 * placa de vídeo, cada envio pra textura custa ~15 ms (lê de volta da GPU).
 */
const CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true }

const SOFT = 'light:soft'
const BEAM = 'light:beam'
export const BLOB = 'light:blob'
const SOFT_SIZE = 256

const DEPTH_SHADOW = -400_000
const DEPTH_DARK = 900_000
const DEPTH_GLOW = 900_001

/** Resolução da escuridão em relação à tela (é um gradiente: meia resolução basta). */
const LIGHT_RES = 0.5
/** Sombras do sol: quão escuras no dia pleno. */
const SUN_SHADOW_ALPHA = 0.3
/** Objetos mais baixos que isso (acima do pé) não fazem sombra comprida. */
const SHADOW_MIN_H = 18

interface Live {
  x: number
  y: number
  radius: number
  color: number
  rgb: RGB
  intensity: number
  flicker: number
  /** Textura do gradiente (a comum ou a recortada pelas paredes) e o tamanho dela. */
  key: string
  size: number
  phase: number
  speed: number
  fire: boolean
}

interface Win { x: number; y: number; w: number; h: number }

interface Caster { def: ObjectDef; o: ZoneObject; frame: string; reach: number }

/** Quem mais faz sombra além dos objetos (os bonecos): quadro atual e os pés. */
export interface ExtraCaster {
  key: string
  frame: string | number
  x: number
  y: number
  /** Onde ficam os pés no quadro (0–1, de cima). */
  originY: number
  flipX?: boolean
}

export interface LightingView { x: number; y: number; w: number; h: number; zoom: number }

export class Lighting {
  private zone!: ZoneData
  private dark!: Phaser.GameObjects.RenderTexture
  private glow!: Phaser.GameObjects.RenderTexture
  private shade!: Phaser.GameObjects.RenderTexture
  private particles: Particles
  private live: Live[] = []
  private windows: Win[] = []
  private casters: Caster[] = []
  private emission: { key: string; strength: number } | null = null
  private occ: Occlusion | null = null
  /** Texturas de luz recortadas, por posição/raio/paredes (reaproveitadas entre rebuilds). */
  private masks = new Map<string, { key: string; size: number } | null>()
  private serial = 0
  private time = 0

  /** Desligada (editor: "ver iluminação" desmarcado) = tudo claro, sem sombras. */
  enabled = true
  /** Hora forçada (prévia do editor); null = a da zona. */
  hourOverride: number | null = null
  /** Deslocamento do relógio do mundo, em ms (o teste do editor começa na hora da prévia). */
  timeOffset = 0
  /** Bonecos que fazem sombra. */
  extraCasters: () => ExtraCaster[] = () => []
  /** Hora usada no último quadro. */
  hour = 12

  constructor(private scene: Phaser.Scene, zone: ZoneData) {
    ensureTextures(scene)
    this.particles = new Particles(scene)
    this.resize()
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.resize, this)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
    this.setZone(zone)
  }

  /**
   * Camadas do tamanho da tela. Recriadas quando a tela muda: uma
   * RenderTexture redimensionada no Phaser 3.90 para de receber desenhos.
   */
  private resize() {
    const cam = this.scene.cameras.main
    const w = Math.max(4, cam.width), h = Math.max(4, cam.height)
    const make = (old: Phaser.GameObjects.RenderTexture | undefined, rw: number, rh: number, depth: number, blend: number, smooth: boolean) => {
      old?.destroy()
      const rt = this.scene.add.renderTexture(0, 0, rw, rh).setOrigin(0, 0).setDepth(depth).setBlendMode(blend).setVisible(false)
      if (smooth) rt.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
      return rt
    }
    const lw = Math.ceil(w * LIGHT_RES) + 2, lh = Math.ceil(h * LIGHT_RES) + 2
    this.dark = make(this.dark, lw, lh, DEPTH_DARK, Phaser.BlendModes.MULTIPLY, true)
    this.glow = make(this.glow, lw, lh, DEPTH_GLOW, Phaser.BlendModes.ADD, true)
    this.shade = make(this.shade, w + 2, h + 2, DEPTH_SHADOW, Phaser.BlendModes.NORMAL, false)
  }

  destroy() {
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.resize, this)
    this.particles.destroy()
    for (const m of this.masks.values()) if (m) this.scene.textures.remove(m.key)
    this.masks.clear()
    if (this.emission) this.scene.textures.remove(this.emission.key)
    this.emission = null
  }

  setZone(zone: ZoneData) {
    this.zone = zone
    this.particles.clear()
    this.rebuild()
  }

  /**
   * Relê luzes, janelas, sombras e brilho do chão da zona. `walls` = recorta
   * as luzes pelas paredes (mais lento; o editor desliga enquanto arrasta).
   */
  rebuild(walls = true) {
    const zone = this.zone
    if (walls) this.occ = buildOcclusion(zone)
    const used = new Set<string>()
    const light = (x: number, y: number, radius: number, color: string, intensity: number, flicker: number): Live => {
      let key = SOFT, size = SOFT_SIZE
      if (walls && this.occ) {
        const id = `${Math.round(x)},${Math.round(y)},${Math.round(radius)},${this.occ.version}`
        used.add(id)
        let m = this.masks.get(id)
        if (m === undefined) {
          const sz = Math.min(SOFT_SIZE, Math.max(32, Math.ceil(radius * 2)))
          const canvas = maskedLight(this.occ, x, y, radius, softCanvas!, sz)
          m = canvas ? { key: `light:mask:${++this.serial}`, size: sz } : null
          if (m && canvas) this.scene.textures.addCanvas(m.key, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR)
          this.masks.set(id, m)
        }
        if (m) ({ key, size } = m)
      }
      const rgb = hexToRgb(color)
      return {
        x, y, radius, color: rgbToInt(rgb), rgb, intensity, flicker, key, size,
        phase: Math.random() * 100, speed: 0.8 + Math.random() * 0.6,
        fire: flicker >= 0.2 && rgb[0] > rgb[2] + 0.3,
      }
    }

    this.live = []
    this.windows = []
    this.casters = []
    for (const o of zone.objects) {
      const def = objectDef(o.kind)
      if (!def) continue
      if (def.light) {
        const l = def.light
        this.live.push(light(o.x + (o.flip ? -l.x : l.x), o.y - (o.z ?? 0) + l.y, l.radius, l.color, l.intensity, l.flicker))
      }
      if (def.kind === 'wall' && /janela/i.test(def.label)) {
        this.windows.push({ x: o.x, y: o.y - (o.z ?? 0), w: def.w, h: def.h })
      }
      if (def.kind === 'stand' && !o.z && def.h - def.sort >= SHADOW_MIN_H) {
        const frame = shadowFrame(this.scene, def)
        if (frame) this.casters.push({ def, o, frame, reach: Math.max(def.w, def.h) * 1.4 })
      }
    }
    for (const l of zone.lights ?? []) this.live.push(light(l.x, l.y, l.radius, l.color, l.intensity, l.flicker))

    // máscaras que ninguém usa mais (luz movida/apagada, parede mudou)
    if (walls) {
      for (const [id, m] of this.masks) {
        if (used.has(id)) continue
        if (m) this.scene.textures.remove(m.key)
        this.masks.delete(id)
      }
    }
    this.buildEmission()
  }

  /** Brilho do chão (lava, água venenosa): um mapa pequeno, borrado e esticado. */
  private buildEmission() {
    if (this.emission) this.scene.textures.remove(this.emission.key)
    this.emission = null
    const z = this.zone, VW = z.width + 1, VH = z.height + 1
    const small = document.createElement('canvas')
    small.width = VW
    small.height = VH
    const sc = small.getContext('2d', CPU)!
    // texturas de luz são OPACAS (preto = sem luz): somar não depende de alfa pré-multiplicado
    sc.fillStyle = '#000'
    sc.fillRect(0, 0, VW, VH)
    let any = false, strength = 0
    for (let vy = 0; vy < VH; vy++) {
      for (let vx = 0; vx < VW; vx++) {
        const g = cornerTerrain(z, vx, vy).glow
        if (!g) continue
        any = true
        strength = Math.max(strength, g.intensity)
        const [r, gg, b] = hexToRgb(g.color)
        sc.fillStyle = `rgb(${r * 255 * g.intensity},${gg * 255 * g.intensity},${b * 255 * g.intensity})`
        sc.fillRect(vx, vy, 1, 1)
      }
    }
    if (!any) return
    // 4px por tile, esticado com suavização e borrado: o brilho vaza pra fora da borda
    const big = document.createElement('canvas')
    big.width = VW * 4
    big.height = VH * 4
    const bc = big.getContext('2d', CPU)!
    bc.fillStyle = '#000'
    bc.fillRect(0, 0, big.width, big.height)
    bc.imageSmoothingEnabled = true
    bc.filter = 'blur(5px)'
    bc.drawImage(small, 0, 0, big.width, big.height)
    bc.filter = 'none'
    bc.globalCompositeOperation = 'lighter'
    bc.globalAlpha = 0.7
    bc.drawImage(small, 0, 0, big.width, big.height)
    const key = `light:emission:${++this.serial}`
    this.scene.textures.addCanvas(key, big)?.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.emission = { key, strength }
  }

  /** Área do mundo que a câmera mostra agora (a câmera dá zoom em volta do centro). */
  private view(): LightingView {
    const cam = this.scene.cameras.main
    const z = cam.zoom
    const w = cam.width / z, h = cam.height / z
    return { x: cam.scrollX + cam.width / 2 - w / 2, y: cam.scrollY + cam.height / 2 - h / 2, w, h, zoom: z }
  }

  /**
   * Desenha as três camadas. Chame no PRE_RENDER da cena, depois de a
   * câmera chegar na posição final do quadro (senão a luz "atrasa").
   */
  render(delta: number) {
    const dt = Math.min(delta, 100) / 1000
    this.time += dt
    const on = this.enabled
    this.dark.setVisible(on)
    this.glow.setVisible(false)
    this.shade.setVisible(false)
    if (!on) {
      this.particles.clear()
      return
    }
    const l = lightingOf(this.zone)
    const hour = (this.hour = this.hourOverride ?? zoneHour(l, Date.now() + this.timeOffset))
    const ambient = ambientAt(l, hour)
    const dark = darkness(ambient)
    const day = l.place === 'underground' ? 0 : daylight(hour)
    const v = this.view()
    const t = this.time

    // ── escuridão + luzes ──
    const s = LIGHT_RES * v.zoom
    const px = (x: number) => (x - v.x) * s, py = (y: number) => (y - v.y) * s
    const rt = this.dark
    rt.setPosition(v.x, v.y).setScale(1 / s)
    paint(rt, rgbToInt(ambient))
    if (this.emission) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.3)
      rt.stamp(this.emission.key, undefined, px(-TILE / 2), py(-TILE / 2), {
        originX: 0, originY: 0, scale: (TILE / 4) * s, alpha: pulse, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
      })
    }
    const flick = (L: Live) => {
      if (!L.flicker) return { a: 1, k: 1 }
      const a = t * 7 * L.speed + L.phase
      const n = 0.6 * Math.sin(a) + 0.3 * Math.sin(a * 2.7 + 1.3) + 0.1 * Math.sin(a * 7.3 + 2.1)
      return { a: 1 - L.flicker * 0.32 * (0.5 + 0.5 * n), k: 1 + L.flicker * 0.05 * n }
    }
    const visible = (x: number, y: number, r: number) => x + r > v.x && x - r < v.x + v.w && y + r > v.y && y - r < v.y + v.h
    for (const L of this.live) {
      if (!visible(L.x, L.y, L.radius * 1.1)) continue
      const f = flick(L)
      rt.stamp(L.key, undefined, px(L.x), py(L.y), {
        scale: (L.radius * 2 * f.k * s) / L.size, tint: L.color, alpha: L.intensity * f.a,
        blendMode: Phaser.BlendModes.ADD, skipBatch: true,
      })
    }
    // janelas: de dia, facho de sol no chão (interior); de noite, acesas (ao ar livre)
    const sun = sunAt(hour)
    const beams: { x: number; y: number; sx: number; sy: number; tint: number }[] = []
    if (l.place === 'indoor' && day > 0.02) {
      const sky = ambientAt({ place: 'outdoor', hour: null }, hour)
      const tint = rgbToInt(sky)
      for (const w of this.windows) {
        const len = Math.max(96, w.h * 2.6)
        if (!visible(w.x, w.y + len / 2, len)) continue
        // o vidro claro (lá fora é dia) e o facho descendo até o chão, inclinado pelo sol
        rt.stamp(SOFT, undefined, px(w.x), py(w.y - w.h / 2), {
          scale: (Math.max(w.w, w.h) * 1.6 * s) / SOFT_SIZE, tint, alpha: 0.5 * day, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
        const beam = { x: w.x, y: w.y - w.h * 0.6, sx: (w.w * 1.25) / 64, sy: len / 128, tint }
        beams.push(beam)
        rt.stamp(BEAM, undefined, px(beam.x), py(beam.y), {
          originX: 0.5, originY: 0, scaleX: beam.sx * s, scaleY: beam.sy * s,
          rotation: sun.angle * 0.3, tint, alpha: day, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
    } else if (l.place === 'outdoor' && day < 0.9) {
      for (const w of this.windows) {
        const r = Math.max(w.w, w.h) * 1.3
        if (!visible(w.x, w.y - w.h / 2, r)) continue
        rt.stamp(SOFT, undefined, px(w.x), py(w.y - w.h / 2), {
          scale: (r * 2 * s) / SOFT_SIZE, tint: 0xffc070, alpha: 0.75 * (1 - day), blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
    }
    rt.endDraw()

    // ── brilho (só quando escurece) ──
    if (dark > 0.05) {
      const g = this.glow
      g.setVisible(true).setPosition(v.x, v.y).setScale(1 / s)
      paint(g, 0x000000)
      for (const L of this.live) {
        if (!visible(L.x, L.y, L.radius)) continue
        const f = flick(L)
        g.stamp(SOFT, undefined, px(L.x), py(L.y), {
          scale: (L.radius * 1.1 * f.k * s) / SOFT_SIZE, tint: L.color, alpha: L.intensity * f.a * 0.3 * dark,
          blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
      // o facho de sol também "brilha" (passa do claro normal, como poeira iluminada)
      for (const b of beams) {
        g.stamp(BEAM, undefined, px(b.x), py(b.y), {
          originX: 0.5, originY: 0, scaleX: b.sx * s, scaleY: b.sy * s,
          rotation: sun.angle * 0.3, tint: b.tint, alpha: 0.22 * day, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
      if (this.emission) {
        g.stamp(this.emission.key, undefined, px(-TILE / 2), py(-TILE / 2), {
          originX: 0, originY: 0, scale: (TILE / 4) * s, alpha: 0.35 * dark, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
      g.endDraw()
    }

    // ── sombras do sol ──
    const sunShadow = l.place === 'outdoor' && l.sunShadows !== false ? sun.strength : 0
    if (sunShadow > 0.02) {
      const sh = this.shade, k = v.zoom
      sh.setVisible(true).setPosition(v.x, v.y).setScale(1 / k).setAlpha(SUN_SHADOW_ALPHA * sunShadow)
      sh.clear()
      sh.beginDraw()
      for (const c of this.casters) {
        const { o, def } = c
        if (!visible(o.x, o.y, c.reach)) continue
        sh.stamp(sheetTexture(def.sheet), c.frame, (o.x - v.x) * k, (o.y - def.sort - v.y) * k, {
          originX: 0.5, originY: 1, scaleX: (o.flip ? -1 : 1) * k, scaleY: -sun.length * k, rotation: sun.angle,
          tint: 0x000000, skipBatch: true,
        })
      }
      for (const c of this.extraCasters()) {
        if (!visible(c.x, c.y, 64)) continue
        sh.stamp(c.key, c.frame, (c.x - v.x) * k, (c.y - v.y) * k, {
          originX: 0.5, originY: c.originY, scaleX: (c.flipX ? -1 : 1) * k, scaleY: -sun.length * k, rotation: sun.angle,
          tint: 0x000000, skipBatch: true,
        })
      }
      sh.endDraw()
    }

    // ── partículas ──
    const particles = l.particles !== false
    const fires: FireSource[] = particles
      ? this.live.filter((L) => L.fire && L.radius >= 110).map((L) => ({ x: L.x, y: L.y, smoke: l.place === 'outdoor' && L.radius >= 128 }))
      : []
    this.particles.update(dt, t, {
      view: { x: v.x - 32, y: v.y - 32, w: v.w + 64, h: v.h + 64 },
      fires,
      fireflies: particles && l.place === 'outdoor' ? Math.max(0, (dark - 0.45) / 0.4) : 0,
      dust: particles && l.place !== 'outdoor' ? 1 : 0,
    })
  }
}

/**
 * Limpa a camada e pinta o fundo com uma cor opaca, já abrindo o lote de
 * desenho. (O fill() do Phaser usa o modo de mistura que estiver ativo — depois
 * de luzes em SOMA, ele somaria em vez de pintar, e a tela ia clareando.)
 */
function paint(rt: Phaser.GameObjects.RenderTexture, color: number) {
  rt.clear()
  rt.beginDraw()
  const white = rt.scene.textures.getFrame('__WHITE')
  rt.stamp('__WHITE', undefined, 0, 0, {
    originX: 0, originY: 0, scaleX: rt.width / white.width, scaleY: rt.height / white.height,
    tint: color, blendMode: Phaser.BlendModes.NORMAL, skipBatch: true,
  })
}

/** Quadro da peça só acima da linha do pé (sem a sombra já desenhada na arte). */
function shadowFrame(scene: Phaser.Scene, def: ObjectDef): string | null {
  const tex = scene.textures.get(sheetTexture(def.sheet))
  const key = `${def.id}#sh`
  if (tex.has(key)) return key
  const h = def.h - Math.max(0, def.sort)
  if (h < 4) return null
  tex.add(key, 0, def.x, def.y, def.w, h)
  return key
}

let softCanvas: HTMLCanvasElement | null = null

/**
 * Texturas geradas uma vez: gradiente da luz, facho da janela, ponto, fumaça,
 * sombra dos pés. As de luz (gradiente, facho) são opacas, em tons de cinza:
 * preto não soma nada, e não há borda clara de alfa pré-multiplicado.
 */
function ensureTextures(scene: Phaser.Scene) {
  const tm = scene.textures
  const add = (key: string, canvas: HTMLCanvasElement) => {
    if (!tm.exists(key)) tm.addCanvas(key, canvas)?.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
  if (!softCanvas) {
    // queda suave (1 − d²)², com o miolo um pouco mais forte
    softCanvas = radial(SOFT_SIZE, SOFT_SIZE, (d) => {
      const f = Math.max(0, 1 - d * d)
      const v = 255 * f * f * (0.85 + 0.15 * Math.max(0, 1 - d * 3))
      return [v, v, v, 1]
    })
  }
  add(SOFT, softCanvas)
  if (!tm.exists(BEAM)) {
    // facho: mais forte embaixo da janela, some no chão; bordas macias e alargando
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 128
    const ctx = c.getContext('2d', CPU)!
    const img = ctx.createImageData(64, 128)
    for (let y = 0; y < 128; y++) {
      const ty = y / 127
      const fade = Math.pow(1 - ty, 1.4) * Math.min(1, ty * 10)
      const half = 0.36 + 0.14 * ty
      for (let x = 0; x < 64; x++) {
        const dx = Math.abs(x / 63 - 0.5)
        const edge = Math.max(0, Math.min(1, (half - dx) / 0.08))
        const i = (y * 64 + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * fade * edge)
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    add(BEAM, c)
  }
  if (!tm.exists(DOT)) add(DOT, radial(16, 16, (d) => [255, 255, 255, Math.pow(Math.max(0, 1 - d), 1.6)]))
  if (!tm.exists(PUFF)) add(PUFF, radial(32, 32, (d) => [255, 255, 255, Math.pow(Math.max(0, 1 - d), 1.3) * 0.9]))
  if (!tm.exists(BLOB)) add(BLOB, radial(32, 14, (d) => [0, 0, 0, Math.pow(Math.max(0, 1 - d), 0.9) * 0.9]))
}

/** Canvas com um gradiente radial (elíptico se w ≠ h) dado por cor(distância 0–1). */
function radial(w: number, h: number, color: (d: number) => [number, number, number, number]) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', CPU)!
  const img = ctx.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2)
      const [r, g, b, a] = color(Math.min(1, Math.hypot(dx, dy)))
      const i = (y * w + x) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}
