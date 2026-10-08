// ────────────────────────────────────────────────────────
// Vento. Uma força de base (parado, brisa, ventania) mais RAJADAS: ondas
// que atravessam o mapa na direção do vento. Tudo que mexe com o vento lê
// o mesmo campo — a árvore balança no instante em que a onda passa pela
// grama embaixo dela, e as folhas do chão correm junto.
//
// O que mexe: árvores, arbustos, flores, plantações, pendurados e os
// tufinhos da grama do chão (tufts.ts).
//
// O balanço dos objetos é um cisalhamento: o pé fica parado e o topo anda
// de lado (pendurados: o topo fica e a ponta de baixo balança). É feito na
// hora de mandar o sprite pra placa de vídeo (SwayPipeline), sem custo de
// desenho extra.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import type { ObjectDef } from '../assets/objects'
import type { TerrainDef } from '../assets/terrains'
import { hash2 } from '../rng'

/** Como uma peça balança. amp = px que o topo anda no vento forte. */
export interface SwaySpec {
  amp: number
  /** Oscilações por segundo (planta pequena treme mais rápido que árvore). */
  freq: number
  /** bottom = pé preso (plantas); top = pendurado (placas, lamparinas). */
  anchor: 'bottom' | 'top'
  phase: number
  /** Onde a peça está (a rajada chega em cada lugar numa hora). */
  x: number
  y: number
  /** Empurrão extra agora, em px (grama chacoalhando quando alguém passa). */
  kick?: number
}

export const WIND_LEVELS: [number, string, string][] = [
  [0, 'Parado', 'Sem vento: as plantas quase não mexem'],
  [0.45, 'Brisa', 'Balanço leve, folhas caindo de vez em quando'],
  [1, 'Ventania', 'Árvores curvando, rajadas fortes, folhas voando'],
]
export const DEFAULT_WIND = 0.45

const HANGING = /pendurad|placa de (estalagem|ferreiro|mercador)|sach[êe]|teia|varal|espantalho/i

/** Como a peça balança (null = não balança). */
export function swaySpec(def: ObjectDef, x: number, y: number): SwaySpec | null {
  const phase = (hash2(Math.round(x), Math.round(y)) % 1000) / 1000 * Math.PI * 2
  const c = def.category
  const spec = (amp: number, freq: number, anchor: SwaySpec['anchor'] = 'bottom'): SwaySpec => ({ amp, freq, anchor, phase, x, y })
  // chão (folhas no chão, tapetes) não balança
  if (def.kind === 'floor') return null
  if (HANGING.test(def.label)) return spec(Math.min(2, 0.6 + def.h * 0.03), 0.9, /varal|espantalho/i.test(def.label) ? 'bottom' : 'top')
  if (c === 'Árvores') return spec(Math.max(1.5, Math.min(4, def.h * 0.03)), 0.55)
  if (c === 'Arbustos') return spec(Math.max(1, Math.min(2.2, def.h * 0.035)), 0.8)
  if (c === 'Flores' || c === 'Plantas' || c === 'Plantações' || (c === 'Plantas aquáticas' && def.kind === 'stand')) {
    return spec(Math.max(0.8, Math.min(2.5, def.h * 0.07)), 1.3)
  }
  return null
}

/** Terrenos cujos tufos balançam (grama 1, capim/trigo mais; 0 = nada). */
export function terrainSway(t: TerrainDef) {
  if (t.category === 'Grama') return t.id === 'grass-dry' ? 0.8 : 1
  if (/trigo|capim/i.test(t.label)) return 1.6
  return 0
}

export class Wind {
  /** 0–1. */
  strength = DEFAULT_WIND
  time = 0
  /** Direção (normalizada): pra direita, um pouco pra baixo. */
  readonly dx = 0.97
  readonly dy = 0.24

  update(dt: number, strength: number) {
    this.time += dt
    // muda de força aos poucos (trocar o clima no editor não dá tranco)
    this.strength += (strength - this.strength) * Math.min(1, dt * 2)
  }

  /** Rajada neste ponto agora (0–1): duas ondas de tamanhos diferentes andando juntas. */
  gust(x: number, y: number) {
    const u = x * this.dx + y * this.dy
    const speed = 110 + 160 * this.strength
    const a = Math.sin(u * 0.012 - this.time * speed * 0.012)
    const b = Math.sin(u * 0.0047 - this.time * speed * 0.0047 * 0.8 + 1.7)
    const g = 0.5 + 0.5 * (a * 0.6 + b * 0.4)
    const t = Math.max(0, Math.min(1, (g - 0.3) / 0.7))
    return t * t * (3 - 2 * t)
  }

  /** Deslocamento (px) do topo (ou da ponta, se pendurado) agora. */
  sway(s: SwaySpec) {
    const S = this.strength
    const g = this.gust(s.x, s.y)
    const osc = Math.sin(this.time * s.freq * Math.PI * 2 * (0.75 + 0.5 * S) + s.phase)
    if (s.anchor === 'top') return s.amp * (osc * (0.15 + 0.6 * S * (0.5 + g)) + S * g * 0.4)
    // inclina pro lado do vento nas rajadas e oscila em volta disso
    return s.amp * (S * (0.2 + 0.8 * g) + osc * (0.12 + 0.3 * S) * (0.6 + 0.8 * g))
  }
}

/** O vento da cena que está desenhando agora (null = nada balança: prévia desligada). */
let active: Wind | null = null
export function setActiveWind(w: Wind | null) {
  active = w
}

type SwaySprite = Phaser.GameObjects.GameObject & { sway?: SwaySpec }

/**
 * Pipeline de sprites que entorta (cisalha) os que têm `sway`: mexe só na
 * posição dos cantos de cima (ou de baixo, se pendurado). O resto é o
 * desenho normal do Phaser, no mesmo lote.
 */
class SwayPipeline extends Phaser.Renderer.WebGL.Pipelines.MultiPipeline {
  private zoom = 1

  constructor(game: Phaser.Game) {
    super({ game, name: SWAY_PIPELINE })
  }

  batchSprite(go: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, camera: Phaser.Cameras.Scene2D.Camera, parent?: Phaser.GameObjects.Components.TransformMatrix) {
    this.zoom = camera.zoom
    super.batchSprite(go, camera, parent)
  }

  batchQuad(go: SwaySprite | null, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, ...rest: unknown[]) {
    const spec = go?.sway
    if (spec && active) {
      const d = (active.sway(spec) + (spec.kick ?? 0)) * this.zoom
      if (spec.anchor === 'top') { x1 += d; x2 += d } else { x0 += d; x3 += d }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (super.batchQuad as any)(go, x0, y0, x1, y1, x2, y2, x3, y3, ...rest)
  }
}

export const SWAY_PIPELINE = 'VortableSway'

/** Põe (ou tira) o balanço num sprite de objeto. */
export function applySway(s: Phaser.GameObjects.Sprite, def: ObjectDef | undefined, x: number, y: number, z = 0) {
  setSway(s, def && !z ? swaySpec(def, x, y) : null)
}

/** Põe (ou tira) um balanço qualquer num sprite. */
export function setSway(s: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, spec: SwaySpec | null) {
  ;(s as SwaySprite).sway = spec ?? undefined
  const renderer = s.scene.game.renderer
  if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return
  if (!renderer.pipelines.has(SWAY_PIPELINE)) renderer.pipelines.add(SWAY_PIPELINE, new SwayPipeline(s.scene.game))
  if (spec) s.setPipeline(SWAY_PIPELINE)
  else if (s.pipeline?.name === SWAY_PIPELINE) s.resetPipeline()
}

/** O balanço de uma peça (pras sombras acompanharem). */
export function swayOf(s: SwaySpec | undefined) {
  return s && active ? active.sway(s) : 0
}
