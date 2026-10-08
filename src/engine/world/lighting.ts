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
// Mais o tempo (weather.ts: chuva, neve, neblina, nuvens no céu e
// relâmpagos), o vento (wind.ts: balanço das plantas e dos tufos de grama, sombra
// de nuvens passando) e as partículas (particles.ts: chamas, folhas, reflexos).
// As luzes, janelas, sombras e fontes saem da zona em rebuild(); o editor
// chama de novo quando a zona muda.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { objectDef, sheetTexture, type ObjectDef } from '../assets/objects'
import { TILE, type ZoneData, type ZoneObject } from '../types'
import { hash2 } from '../rng'
import { cornerTerrain } from './ground'
import { ambientAt, darkness, daylight, golden, hexToRgb, moonAt, nightAmount, sunny, twilight, lightingOf, rgbToInt, sunAt, zoneHour, type RGB } from './daylight'
import { buildOcclusion, maskedLight, type Occlusion } from './shadowcast'
import { DOT, PUFF, Particles, type FireSource, type LeafSource } from './particles'
import { DEFAULT_WIND, Wind, setActiveWind, swayOf, swaySpec, type SwaySpec } from './wind'
import { CLOUD_SIZE, CLOUD_TILE, WeatherFx, cloudTextures, weatherAmbient, weatherOf } from './weather'

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
const VIGNETTE = 'light:vignette'
const RAY = 'light:ray'
const DAPPLE = 'light:dapple'
/** Distância entre os raios de sol (px do mundo). */
const RAY_GAP = 120
const VIG = 128
/** Cores da luz da hora dourada: amanhecer (rosado) e entardecer (laranja). */
const DAWN_LIGHT: RGB = [1, 0.62, 0.5]
const DUSK_LIGHT: RGB = [1, 0.5, 0.2]
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
  /** Línguas de chama (0 = sem: luz solta, forno fechado). */
  flames: number
}

interface Win { x: number; y: number; w: number; h: number }

interface Caster { def: ObjectDef; o: ZoneObject; frame: string; reach: number; sway: SwaySpec | null }

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
  /** Sombra de nuvens e cantos do pôr do sol: multiplicam a cena, por baixo da escuridão. */
  private cloudShade!: Phaser.GameObjects.TileSprite
  private vignette!: Phaser.GameObjects.Image
  /** Manchas de sol entre as folhas, passando devagar (dia aberto). */
  private dapple!: Phaser.GameObjects.TileSprite
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
  readonly wind = new Wind()
  private weather: WeatherFx
  /** O tempo usado no último quadro (o som acompanha). */
  weatherNow = weatherOf(undefined)
  private trees: LeafSource[] = []
  private water: { x: number; y: number }[] = []

  /** Desligada (editor: "ver iluminação" desmarcado) = tudo claro, sem sombras. */
  enabled = true
  /** Hora forçada (prévia do editor); null = a da zona. */
  hourOverride: number | null = null
  /** Ajuste ao vivo do mestre (hora, tempo, vento); cada campo null = o padrão da zona. */
  liveEnv: { hour: number | null; weather: string | null; wind: number | null } | null = null
  /** Deslocamento do relógio do mundo, em ms (o teste do editor começa na hora da prévia). */
  timeOffset = 0
  /** Bonecos que fazem sombra. */
  extraCasters: () => ExtraCaster[] = () => []
  /** Relâmpagos que já caíram. */
  get strikes() {
    return this.weather.strikes
  }

  /** Hora usada no último quadro. */
  hour = 12

  constructor(private scene: Phaser.Scene, zone: ZoneData) {
    ensureTextures(scene)
    this.particles = new Particles(scene)
    this.weather = new WeatherFx(scene)
    this.cloudShade = scene.add.tileSprite(0, 0, 4, 4, SOFT).setOrigin(0, 0).setDepth(DEPTH_DARK - 2)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false)
    this.dapple = scene.add.tileSprite(0, 0, 4, 4, DAPPLE).setOrigin(0, 0).setDepth(DEPTH_DARK - 3)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false)
    this.vignette = scene.add.image(0, 0, VIGNETTE).setOrigin(0, 0).setDepth(DEPTH_DARK - 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false)
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
    setActiveWind(null)
    this.weather.destroy()
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
    this.weather.clear()
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
    const light = (x: number, y: number, radius: number, color: string, intensity: number, flicker: number, flames = false): Live => {
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
        flames: flames && flicker >= 0.2 && rgb[0] > rgb[2] + 0.3 ? Math.max(0.6, Math.min(1.6, radius / 96)) : 0,
      }
    }

    this.live = []
    this.windows = []
    this.casters = []
    this.trees = []
    for (const o of zone.objects) {
      const def = objectDef(o.kind)
      if (!def) continue
      if (def.light) {
        const l = def.light
        // fogo fechado (forno, fogão) não solta chama pra fora
        const open = !/forno|fog[ãa]o|fornalha/i.test(def.label)
        this.live.push(light(o.x + (o.flip ? -l.x : l.x), o.y - (o.z ?? 0) + l.y, l.radius, l.color, l.intensity, l.flicker, open))
      }
      if (def.category === 'Árvores' && def.h >= 48 && !o.z) {
        // a copa: a parte de cima do desenho, um pouco pra dentro das bordas
        this.trees.push({
          x0: o.x - def.w * 0.35, x1: o.x + def.w * 0.35, y0: o.y - def.h * 0.92, y1: o.y - def.h * 0.45,
          foot: o.y, colors: leafColors(this.scene, def),
        })
      }
      if (def.kind === 'wall' && /janela/i.test(def.label)) {
        this.windows.push({ x: o.x, y: o.y - (o.z ?? 0), w: def.w, h: def.h })
      }
      if (def.kind === 'stand' && !o.z && def.h - def.sort >= SHADOW_MIN_H) {
        const frame = shadowFrame(this.scene, def)
        if (frame) this.casters.push({ def, o, frame, reach: Math.max(def.w, def.h) * 1.4, sway: swaySpec(def, o.x, o.y) })
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
    this.findWater()
  }

  /**
   * Raios de luz atravessando o mapa. São do CENÁRIO: ficam em linhas fixas do
   * mundo (só a luz oscila), e a câmera passa por eles — não andam colados no
   * boneco. `skip` = fração de faixas sem raio; `seed` muda o sorteio.
   */
  private rays(g: Phaser.GameObjects.RenderTexture, v: LightingView, s: number, t: number, angle: number, gap: number, tint: number, alpha: number, skip: number, seed: number) {
    const reach = Math.max(v.w, v.h), len = reach * 2.4
    const nx = Math.cos(angle), ny = Math.sin(angle) // perpendicular aos raios
    const cs = [v.x * nx + v.y * ny, (v.x + v.w) * nx + v.y * ny, v.x * nx + (v.y + v.h) * ny, (v.x + v.w) * nx + (v.y + v.h) * ny]
    const i0 = Math.floor(Math.min(...cs) / gap) - 1, i1 = Math.ceil(Math.max(...cs) / gap) + 1
    const px = (x: number) => (x - v.x) * s, py = (y: number) => (y - v.y) * s
    for (let i = i0; i <= i1; i++) {
      const h1 = (hash2(i, 11 + seed) % 1000) / 1000, h2 = (hash2(i, 29 + seed) % 1000) / 1000, h3 = (hash2(i, 47 + seed) % 1000) / 1000
      if (h3 < skip) continue // nem toda faixa tem raio
      const c = i * gap + (h1 - 0.5) * gap * 0.7 + Math.sin(t * 0.12 + i * 1.3) * 14
      const width = 56 + 80 * h2
      const shimmer = 0.5 + 0.5 * Math.sin(t * (0.3 + 0.25 * h1) + i * 2.3)
      // o ponto da reta (n·p = c) na altura do meio da tela, recuado até antes da tela
      const midY = v.y + v.h / 2
      const mx = (c - ny * midY) / nx
      const back = len * 0.5
      g.stamp(RAY, undefined, px(mx + Math.sin(angle) * back), py(midY - Math.cos(angle) * back), {
        originX: 0.5, originY: 0, scaleX: (width * s) / 32, scaleY: (len * s) / 128,
        rotation: angle, tint, alpha: alpha * (0.45 + 0.55 * shimmer) * (0.6 + 0.4 * h2), blendMode: Phaser.BlendModes.ADD, skipBatch: true,
      })
    }
  }

  /** Onde tem água (os reflexos piscam ali). */
  private findWater() {
    const z = this.zone
    this.water = []
    for (let vy = 0; vy <= z.height; vy++) {
      for (let vx = 0; vx <= z.width; vx++) {
        if (/^water(-light|-deep)?$/.test(cornerTerrain(z, vx, vy).id)) this.water.push({ x: vx * TILE, y: vy * TILE })
      }
    }
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
      this.cloudShade.setVisible(false)
      this.vignette.setVisible(false)
      this.dapple.setVisible(false)
      this.particles.clear()
      this.weather.clear()
      setActiveWind(null)
      return
    }
    const base = lightingOf(this.zone)
    const live = this.liveEnv
    const l = live
      ? {
        ...base,
        ...(live.weather != null ? { weather: live.weather === 'clear' ? undefined : live.weather } : {}),
        ...(live.wind != null ? { wind: live.wind } : {}),
      }
      : base
    const hour = (this.hour = this.hourOverride ?? live?.hour ?? zoneHour(l, Date.now() + this.timeOffset))
    const v = this.view()
    const t = this.time
    const outdoor = l.place === 'outdoor'
    // subterrâneo não tem céu: sem tempo
    const wth = (this.weatherNow = weatherOf(l.place === 'underground' ? undefined : l.weather))
    const sun = sunAt(hour)
    // hora dourada: o céu aberto deixa a luz esquentar; chuva e neve apagam
    const gold = golden(hour)
    const open = Math.max(0, 1 - wth.rain * 0.9 - wth.snow * 0.6 - wth.cover * 0.3)
    const warm = outdoor ? gold * open : 0
    const dawn = hour < 12
    const night = outdoor ? nightAmount(hour) * open : 0
    const sunnyK = outdoor ? sunny(hour) * open : 0
    const moon = moonAt(hour)
    // névoa baixa: rosada no amanhecer, azulada de noite
    const clearSky = Math.max(0, 1 - wth.rain - wth.snow)
    const mistDawn = outdoor && dawn ? gold * 0.38 * clearSky : 0
    const mistNight = night * 0.2 * clearSky
    // dentro de casa não venta (mas o que é pendurado ainda balança de leve)
    this.wind.update(dt, outdoor ? Math.max(l.wind ?? DEFAULT_WIND, wth.minWind) : 0)
    setActiveWind(this.wind)
    // nuvens: as do tempo (sempre) ou as poucas do céu limpo (se ligadas)
    const cover = outdoor && (wth.cover >= 0.5 || l.clouds !== false) ? wth.cover : 0
    const cloudSpeed = 10 + 45 * this.wind.strength
    const cloudX = t * cloudSpeed * this.wind.dx, cloudY = t * cloudSpeed * this.wind.dy
    this.weather.update(dt, {
      view: { x: v.x - 32, y: v.y - 32, w: v.w + 64, h: v.h + 64 },
      def: wth, wind: this.wind, outdoor, sunAngle: sun.angle, cloudX, cloudY,
      mist: Math.max(mistDawn, mistNight),
      mistTint: mistNight > mistDawn ? 0x9db2ee : 0xffcfc0,
      day: l.place === 'underground' ? 0 : daylight(hour),
    })
    // o tempo escurece/acinzenta a luz do dia (dentro de casa, a parte que vem das janelas)
    const flash = this.weather.flash
    let ambient = ambientAt(l, hour)
    if (l.place !== 'underground') ambient = weatherAmbient(ambient, wth, outdoor ? 1 : daylight(hour))
    if (flash) {
      const k = flash * (outdoor ? 0.85 : 0.35)
      ambient = [ambient[0] + (0.86 - ambient[0]) * k, ambient[1] + (0.9 - ambient[1]) * k, ambient[2] + (1 - ambient[2]) * k]
    }
    const dark = darkness(ambient)
    const day = l.place === 'underground' ? 0 : daylight(hour) * (1 - wth.dim)

    // ── escuridão + luzes ──
    const s = LIGHT_RES * v.zoom
    const px = (x: number) => (x - v.x) * s, py = (y: number) => (y - v.y) * s
    const rt = this.dark
    rt.setPosition(v.x, v.y).setScale(1 / s)
    paint(rt, rgbToInt(ambient))
    // sombra de nuvens passando com o vento (de dia, ao ar livre)
    // (na hora dourada a sombra das nuvens é mais leve: não apaga o pôr do sol)
    // (camada própria: multiplicar DENTRO da escuridão a apaga inteira no Phaser 3.90)
    const clouds = cover ? day * (1 - 0.55 * warm) : 0
    if (clouds > 0.02) {
      const key = cloudTextures(this.scene, cover).shadow
      const scale = CLOUD_TILE / CLOUD_SIZE
      const cs = this.cloudShade
      if (cs.texture.key !== key) cs.setTexture(key)
      cs.setVisible(true).setPosition(v.x, v.y).setSize(v.w, v.h).setTileScale(scale).setAlpha(clouds * 0.9)
      cs.tilePositionX = (v.x - cloudX) / scale
      cs.tilePositionY = (v.y - cloudY) / scale
    } else {
      this.cloudShade.setVisible(false)
    }
    // manhã/meio-dia/tarde: manchas de sol entre as folhas, andando devagar com o vento
    if (sunnyK > 0.02) {
      const dscale = 2.2
      const drift = t * (3 + 10 * this.wind.strength)
      this.dapple.setVisible(true).setPosition(v.x, v.y).setSize(v.w, v.h).setTileScale(dscale).setAlpha(Math.min(1, sunnyK * 0.75))
      this.dapple.tilePositionX = (v.x - drift * this.wind.dx - Math.sin(t * 0.2) * 6) / dscale
      this.dapple.tilePositionY = (v.y - drift * this.wind.dy) / dscale
    } else {
      this.dapple.setVisible(false)
    }
    // semi noite: gradiente pelo mapa, do lado do sol ainda rosado ao lado
    // oposto já noite (a luz que sobra no horizonte)
    const semi = outdoor ? twilight(hour) * Math.max(0, 1 - wth.rain * 0.8 - wth.snow * 0.5 - wth.cover * 0.3) : 0
    if (semi > 0.02) {
      const reach = Math.max(v.w, v.h)
      // centro na beirada da tela do lado do sol: metade do mapa visível fica no gradiente
      const sx = v.x + v.w / 2 + Math.sin(sun.angle) * v.w * 0.55, sy = v.y + v.h / 2 - Math.cos(sun.angle) * v.h * 0.4
      const glowTint = dawn ? 0xff9fb4 : 0xff8f70
      rt.stamp(SOFT, undefined, px(sx), py(sy), {
        scale: (reach * 2.2 * s) / SOFT_SIZE, tint: glowTint, alpha: 0.85 * semi, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
      })
      rt.stamp(SOFT, undefined, px(sx), py(sy), {
        scale: (reach * 1.1 * s) / SOFT_SIZE, tint: 0xffc49a, alpha: 0.5 * semi, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
      })
    }
    // hora dourada: cantos arroxeados e mais escuros (moldura de luz do pôr do sol)
    if (warm > 0.02) {
      this.vignette.setVisible(true).setPosition(v.x, v.y).setDisplaySize(v.w, v.h).setAlpha(Math.min(1, warm * 1.1))
    } else {
      this.vignette.setVisible(false)
    }
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
          rotation: sun.angle * 0.3, tint, alpha: day * wth.sun * 0.6 + day * 0.4, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
    }
    // relâmpago lá fora: as janelas do interior piscam
    if (flash && l.place === 'indoor') {
      for (const win of this.windows) {
        const len = Math.max(96, win.h * 2.6)
        if (!visible(win.x, win.y + len / 2, len)) continue
        rt.stamp(BEAM, undefined, px(win.x), py(win.y - win.h * 0.6), {
          originX: 0.5, originY: 0, scaleX: (win.w * 1.25 * s) / 64, scaleY: (len * s) / 128,
          tint: 0xdde6ff, alpha: flash, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
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

    // ── brilho: o fogo que acende o ar quando escurece + a luz dourada do sol ──
    if (dark > 0.05 || warm > 0.02 || night > 0.02 || sunnyK > 0.02) {
      const g = this.glow
      g.setVisible(true).setPosition(v.x, v.y).setScale(1 / s)
      // a hora dourada banha tudo de um tom quente (soma por cima do mapa)
      // (no fim do entardecer o laranja vira rosa-magenta)
      const late = dawn ? 0 : Math.max(0, Math.min(1, (hour - 18.2) / 1.2))
      const tone: RGB = dawn ? DAWN_LIGHT : [
        DUSK_LIGHT[0] + (0.95 - DUSK_LIGHT[0]) * late, DUSK_LIGHT[1] + (0.3 - DUSK_LIGHT[1]) * late, DUSK_LIGHT[2] + (0.55 - DUSK_LIGHT[2]) * late,
      ]
      // (e a noite ganha um fio de azul de luar, pra o escuro não ser preto)
      const m = night * 0.06
      paint(g, rgbToInt([tone[0] * warm * 0.17 + 0.5 * m, tone[1] * warm * 0.17 + 0.68 * m, tone[2] * warm * 0.17 + m]))
      if (dark > 0.05) {
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
      }
      if (warm > 0.02) {
        // o sol está do lado oposto ao das sombras: um clarão grande vindo de lá…
        const reach = Math.max(v.w, v.h)
        const cx = v.x + v.w / 2 + Math.sin(sun.angle) * reach * 0.62, cy = v.y + v.h / 2 - Math.cos(sun.angle) * reach * 0.55
        const bloom = rgbToInt([tone[0], tone[1] * 0.92, tone[2] * 0.8])
        g.stamp(SOFT, undefined, px(cx), py(cy), {
          scale: (reach * 1.9 * s) / SOFT_SIZE, tint: bloom, alpha: 0.5 * warm, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
        g.stamp(SOFT, undefined, px(cx), py(cy), {
          scale: (reach * 0.8 * s) / SOFT_SIZE, tint: 0xfff0c8, alpha: 0.4 * warm, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
        // …e raios de luz atravessando o mapa, na direção das sombras
        this.rays(g, v, s, t, sun.angle, RAY_GAP, rgbToInt([1, 0.82, 0.55]), 0.2 * warm, 0.28, 0)
      }
      // dia aberto: raios leves entre as folhas e um clarão suave do sol
      if (sunnyK > 0.02) {
        const reach = Math.max(v.w, v.h), k = sunnyK * (1 - warm)
        this.rays(g, v, s, t, sun.angle, 150, rgbToInt([1, 0.95, 0.78]), 0.15 * k, 0.4, 100)
        g.stamp(SOFT, undefined, px(v.x + v.w / 2 + Math.sin(sun.angle) * reach * 0.7), py(v.y + v.h / 2 - Math.cos(sun.angle) * reach * 0.6), {
          scale: (reach * 1.8 * s) / SOFT_SIZE, tint: 0xfff0c0, alpha: 0.3 * k, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
      }
      // noite: luar — clarão frio do lado da lua e raios azulados bem sutis
      if (night > 0.02) {
        const reach = Math.max(v.w, v.h)
        g.stamp(SOFT, undefined, px(v.x + v.w / 2 + Math.sin(moon.angle) * reach * 0.7), py(v.y + v.h / 2 - Math.cos(moon.angle) * reach * 0.6), {
          scale: (reach * 1.7 * s) / SOFT_SIZE, tint: 0x8aa8ff, alpha: 0.3 * night, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
        g.stamp(SOFT, undefined, px(v.x + v.w / 2 + Math.sin(moon.angle) * reach * 0.7), py(v.y + v.h / 2 - Math.cos(moon.angle) * reach * 0.6), {
          scale: (reach * 0.55 * s) / SOFT_SIZE, tint: 0xdce6ff, alpha: 0.28 * night, blendMode: Phaser.BlendModes.ADD, skipBatch: true,
        })
        this.rays(g, v, s, t, moon.angle, 190, rgbToInt([0.6, 0.72, 1]), 0.09 * night, 0.5, 200)
      }
      g.endDraw()
    }

    // ── sombras: do sol de dia, da lua de noite (a mais forte vence) ──
    const sunShadow = l.place === 'outdoor' && l.sunShadows !== false ? sun.strength * wth.sun : 0
    const shadeTint = rgbToInt([0.2 * gold, 0.08 * gold, 0.34 * gold])
    const sunA = SUN_SHADOW_ALPHA * (1 + 0.55 * gold) * sunShadow
    const moonA = l.sunShadows !== false ? 0.24 * night : 0
    const useMoon = moonA > sunA
    const shadowA = useMoon ? moonA : sunA
    if (shadowA > 0.02) {
      const sh = this.shade, k = v.zoom
      // na hora dourada a sombra é mais forte e arroxeada (luz quente, sombra fria);
      // a da lua é longa, suave e azul-noite
      const ang = useMoon ? moon.angle : sun.angle, slen = useMoon ? moon.length : sun.length
      const tint = useMoon ? rgbToInt([0.02, 0.05, 0.16]) : shadeTint
      sh.setVisible(true).setPosition(v.x, v.y).setScale(1 / k).setAlpha(shadowA)
      sh.clear()
      sh.beginDraw()
      for (const c of this.casters) {
        const { o, def } = c
        if (!visible(o.x, o.y, c.reach)) continue
        // a sombra balança junto com a árvore
        const bend = c.sway ? swayOf(c.sway) / Math.max(8, (def.h - def.sort) * slen) : 0
        sh.stamp(sheetTexture(def.sheet), c.frame, (o.x - v.x) * k, (o.y - def.sort - v.y) * k, {
          originX: 0.5, originY: 1, scaleX: (o.flip ? -1 : 1) * k, scaleY: -slen * k, rotation: ang - bend,
          tint, skipBatch: true,
        })
      }
      for (const c of this.extraCasters()) {
        if (!visible(c.x, c.y, 64)) continue
        sh.stamp(c.key, c.frame, (c.x - v.x) * k, (c.y - v.y) * k, {
          originX: 0.5, originY: c.originY, scaleX: (c.flipX ? -1 : 1) * k, scaleY: -slen * k, rotation: ang,
          tint, skipBatch: true,
        })
      }
      sh.endDraw()
    }

    // ── partículas ──
    const particles = l.particles !== false
    const fires: FireSource[] = particles
      ? this.live.filter((L) => L.flames || (L.fire && L.radius >= 110)).map((L) => ({
        x: L.x, y: L.y, size: L.flames, sparks: L.fire && L.radius >= 110, smoke: outdoor && L.fire && L.radius >= 128,
      }))
      : []
    this.particles.update(dt, t, {
      view: { x: v.x - 32, y: v.y - 32, w: v.w + 64, h: v.h + 64 },
      bounds: { w: this.zone.width * TILE, h: this.zone.height * TILE },
      wind: this.wind,
      fires,
      trees: particles && outdoor ? this.trees : [],
      water: particles && l.place !== 'underground' ? this.water : [],
      day,
      warm: particles ? warm : 0,
      dew: particles && outdoor && dawn ? warm : 0,
      // vaga-lume não sai na chuva nem na neve
      fireflies: particles && outdoor && !wth.rain && !wth.snow ? Math.max(0, (dark - 0.45) / 0.4) : 0,
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
  const h = def.h - Math.max(0, def.sort)
  if (h < 4) return null
  // a altura entra no nome: a curadoria pode mudar a linha do pé
  const key = `${def.id}#sh${h}`
  if (tex.has(key)) return key
  tex.add(key, 0, def.x, def.y, def.w, h)
  return key
}

const leafCache = new Map<string, number[]>()

/** Cores das folhas que caem: amostras da copa da própria árvore. */
function leafColors(scene: Phaser.Scene, def: ObjectDef): number[] {
  const cached = leafCache.get(def.id)
  if (cached) return cached
  const out: number[] = []
  try {
    const src = scene.textures.get(sheetTexture(def.sheet)).getSourceImage() as CanvasImageSource
    const w = def.w, h = Math.max(1, Math.round(def.h * 0.5))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d', CPU)!
    ctx.drawImage(src, def.x, def.y, w, h, 0, 0, w, h)
    const d = ctx.getImageData(0, 0, w, h).data
    const pool: number[] = []
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 220) continue
      const lum = d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15
      // folhas que se vejam no chão: nem as sombras escuras da copa, nem o brilho branco
      if (lum < 70 || lum > 230) continue
      pool.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    }
    for (let k = 0; k < 10 && pool.length; k++) out.push(pool[Math.floor(Math.random() * pool.length)])
  } catch {
    // folha sem cor própria: as de outono das partículas
  }
  leafCache.set(def.id, out)
  return out
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
  if (!tm.exists(DAPPLE)) {
    // manchas de sol entre as folhas: branco com buracos suaves mais escuros
    // (opaco, emenda nas bordas; multiplica a cena)
    const N = 128
    const rnd = (cells: number, seed: number) => {
      const g = new Float32Array(cells * cells)
      let a = seed
      for (let i = 0; i < g.length; i++) { a = (a * 1103515245 + 12345) >>> 0; g[i] = (a >>> 8) / 16777216 }
      return (x: number, y: number) => {
        const fx = (x / N) * cells, fy = (y / N) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
        const at = (cx: number, cy: number) => g[(((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells)]
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx, bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
        return top + (bot - top) * sy
      }
    }
    const a1 = rnd(6, 5), a2 = rnd(12, 17)
    const c = document.createElement('canvas')
    c.width = c.height = N
    const ctx = c.getContext('2d', CPU)!
    const img = ctx.createImageData(N, N)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = a1(x, y) * 0.65 + a2(x, y) * 0.35
        const t = Math.max(0, Math.min(1, (n - 0.48) / 0.4))
        const v = Math.round(255 * (1 - 0.2 * t * t * (3 - 2 * t)))
        const i = (y * N + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    add(DAPPLE, c)
  }
  if (!tm.exists(RAY)) {
    // raio de sol: macio nas laterais e nas pontas, parelho no meio (não some
    // com a distância: tem que ficar parado no mapa, não na tela)
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 128
    const ctx = c.getContext('2d', CPU)!
    const img = ctx.createImageData(32, 128)
    for (let y = 0; y < 128; y++) {
      const ty = y / 127
      const ends = Math.min(1, ty / 0.18, (1 - ty) / 0.18)
      for (let x = 0; x < 32; x++) {
        const dx = Math.abs(x / 31 - 0.5) * 2
        const side = Math.pow(Math.max(0, 1 - dx * dx), 1.5)
        const v = Math.round(255 * side * ends * ends * (3 - 2 * ends))
        const i = (y * 32 + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v
        img.data[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    add(RAY, c)
  }
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
  if (!tm.exists(VIGNETTE)) {
    // cantos arroxeados: OPACO, branco no centro (multiplicar por branco não
    // muda nada) e roxo escuro nas bordas. Com transparência, multiplicar
    // dentro da camada apagava a escuridão inteira.
    const c = document.createElement('canvas')
    c.width = c.height = VIG
    const ctx = c.getContext('2d', CPU)!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, VIG, VIG)
    const grad = ctx.createRadialGradient(VIG / 2, VIG / 2, VIG * 0.28, VIG / 2, VIG / 2, VIG * 0.72)
    grad.addColorStop(0, 'rgba(90,40,110,0)')
    grad.addColorStop(1, 'rgba(90,40,110,0.62)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, VIG, VIG)
    add(VIGNETTE, c)
  }
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
