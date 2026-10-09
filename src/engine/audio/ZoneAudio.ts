// ────────────────────────────────────────────────────────
// O som de uma zona. No modo automático (padrão) as camadas seguem o
// mundo: floresta onde há árvores (pássaros de dia, grilos à noite), vento
// conforme o vento, chuva/tempestade/neve conforme o tempo, um trovão a
// cada relâmpago, fogo, lago e pântano quando o jogador chega perto (do
// lado em que estão). Dentro de casa o de fora soa abafado e há eco de
// sala; nas cavernas, eco longo. O painel Sons soma camadas à mão.
//
// Passos: um a cada tantos px andados, com a gravação do chão sob os pés.
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { objectDef } from '../assets/objects'
import type { TerrainDef } from '../assets/terrains'
import { TILE, type ZoneData, type ZoneSound } from '../types'
import { cornerTerrain, overlayTerrain } from '../world/ground'
import { daylight, lightingOf } from '../world/daylight'
import type { WeatherDef } from '../world/weather'
import { AudioEngine, readPrefs } from './engine'
import { LAYERS, Layer, type LayerId } from './ambience'
import { Steps, type Surface } from './steps'

/** Até onde se ouve o fogo e a água (px). */
const FIRE_RANGE = 240
const WATER_RANGE = 280

export interface AudioFrame {
  /** Quem escuta (o jogador; no editor, o meio da tela). */
  x: number
  y: number
  hour: number
  wind: number
  weather: WeatherDef
  /** Relâmpagos até agora (cada novo vira um trovão). */
  strikes: number
}

/** O som da zona: o que está salvo, ou o automático. */
export function soundOf(zone: ZoneData): ZoneSound {
  return zone.sound ?? {}
}

export class ZoneAudio {
  private layers = new Map<LayerId, Layer>()
  private fires: { x: number; y: number }[] = []
  private torches: { x: number; y: number }[] = []
  private water: { x: number; y: number }[] = []
  private swamp: { x: number; y: number }[] = []
  private steps: Steps
  private trees = 0
  private strikes = -1
  private pending: { at: number; distance: number }[] = []
  private stepSide = 1
  private nearCache = { at: 0, fire: { level: 0, pan: 0 }, torch: { level: 0, pan: 0 }, lake: { level: 0, pan: 0 }, swamp: { level: 0, pan: 0 } }
  /** Silencia tudo (editor com a prévia de som desligada). */
  enabled = true
  /** Sons ao vivo do mestre (Controle): valem no lugar do som salvo da zona. null = o da zona. */
  live: ZoneSound | null = null

  constructor(private engine: AudioEngine, private zone: ZoneData) {
    for (const l of LAYERS) this.layers.set(l.id, new Layer(engine, l.id))
    this.steps = new Steps(engine)
    this.setZone(zone)
  }

  static create(scene: Phaser.Scene, zone: ZoneData) {
    const engine = AudioEngine.of(scene)
    return engine ? new ZoneAudio(engine, zone) : null
  }

  setZone(zone: ZoneData) {
    this.zone = zone
    this.fires = []
    this.torches = []
    this.trees = 0
    for (const o of zone.objects) {
      const def = objectDef(o.kind)
      if (!def) continue
      // fogo grande (fogueira, lareira) crepita; pequeno (tocha) só chia
      if (def.light && def.light.flicker >= 0.2) (def.light.radius >= 110 ? this.fires : this.torches).push({ x: o.x, y: o.y - (o.z ?? 0) + def.light.y })
      if (def.category === 'Árvores') this.trees++
    }
    this.water = []
    this.swamp = []
    for (let vy = 0; vy <= zone.height; vy++) {
      for (let vx = 0; vx <= zone.width; vx++) {
        const t = cornerTerrain(zone, vx, vy)
        if (t.id === 'swamp') this.swamp.push({ x: vx * TILE, y: vy * TILE })
        else if (/^water/.test(t.id)) this.water.push({ x: vx * TILE, y: vy * TILE })
      }
    }
    this.nearCache.at = -1
  }

  /** Nível de cada camada agora (pro painel mostrar). */
  levels() {
    const out: Partial<Record<LayerId, number>> = {}
    for (const [id, l] of this.layers) out[id] = l.level
    return out
  }

  /** Ouvir um passo num chão (botões do painel). */
  previewStep(surface: Surface) {
    this.steps.play(surface, Math.max(0.4, readPrefs().steps))
  }

  /** Ouvir um trovão agora (botão do painel). */
  thunderNow() {
    this.layers.get('thunder')!.strike(0.3, 1)
  }

  update(dt: number, f: AudioFrame) {
    const e = this.engine
    const l = lightingOf(this.zone)
    const place = l.place
    e.setRoom(place === 'outdoor' ? 'none' : place === 'indoor' ? 'room' : 'cave')
    const day = place === 'underground' ? 0 : daylight(f.hour)
    const w = f.weather
    const outdoor = place === 'outdoor', indoor = place === 'indoor'
    const sound = this.live ?? soundOf(this.zone)
    const auto = sound.auto !== false && this.enabled
    const near = this.near(f.x, f.y)

    // automático: o que o mundo pede
    const a = Object.fromEntries(LAYERS.map((l) => [l.id, 0])) as Record<LayerId, number>
    // chuva forte vira a gravação de tempestade; garoa/chuva, a de chuva
    const rain = w.lightning ? 0 : w.rain, storm = w.lightning ? w.rain : 0
    if (auto) {
      if (outdoor) {
        a.forest = this.trees >= 3 ? 0.6 : this.trees ? 0.4 : 0.2
        if (w.rain > 0.5 || w.snow > 0.5) a.forest *= 0.25
        a.wind = 0.1 + 0.5 * f.wind
        a.rain = rain
        a.storm = storm
        a.snow = w.snow * 0.9
      } else if (indoor) {
        a.wind = w.minWind >= 0.9 ? 0.4 : 0
        a.rain = rain * 0.9
        a.storm = storm * 0.9
        a.snow = w.snow * 0.4
      } else {
        a.cave = 0.6
      }
      a.fire = near.fire.level
      a.torch = near.torch.level * 0.6
      a.lake = near.lake.level * 0.7
      a.swamp = near.swamp.level * 0.8
    }
    // camadas postas à mão somam (o maior vale)
    const manual = (this.enabled && sound.layers) || {}
    const muffledOutside = indoor
    for (const [id, layer] of this.layers) {
      const level = this.enabled ? Math.max(a[id], manual[id] ?? 0) : 0
      const outside = id === 'rain' || id === 'storm' || id === 'thunder' || id === 'wind' || id === 'snow'
      const spot = id === 'fire' || id === 'torch' || id === 'lake' || id === 'swamp' ? near[id] : null
      layer.update(dt, { level, day, pan: spot && spot.level >= (manual[id] ?? 0) ? spot.pan : 0, muffled: muffledOutside && outside })
    }

    // um trovão pra cada relâmpago (o som chega um pouco depois da luz)
    if (this.strikes < 0) this.strikes = f.strikes
    if (f.strikes > this.strikes && this.enabled) {
      this.pending.push({ at: e.now + 0.25 + Math.random() * 1.4, distance: Math.random() * 0.5 })
    }
    this.strikes = f.strikes
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (e.now < this.pending[i].at) continue
      this.layers.get('thunder')!.strike(this.pending[i].distance, 1)
      this.pending.splice(i, 1)
    }
  }

  /** Fogo e água mais perto (volume pela distância, lado pelo x), recalculado a cada 0,2 s. */
  private near(x: number, y: number) {
    const c = this.nearCache, now = this.engine.now
    if (c.at >= 0 && now - c.at < 0.2) return c
    c.at = now
    const closest = (list: { x: number; y: number }[], range: number) => {
      let best = range, bx = 0
      for (const p of list) {
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < best) { best = d; bx = p.x - x }
      }
      const k = 1 - best / range
      return { level: k * k, pan: Math.max(-0.8, Math.min(0.8, bx / range)) }
    }
    c.fire = closest(this.fires, FIRE_RANGE)
    c.torch = closest(this.torches, FIRE_RANGE * 0.6)
    c.lake = closest(this.water, WATER_RANGE)
    c.swamp = closest(this.swamp, WATER_RANGE)
    return c
  }

  /** Um passo em (x, y): o chão decide o timbre; chuva molha, neve cobre. */
  step(x: number, y: number, running: boolean, weather: WeatherDef) {
    const prefs = readPrefs()
    if (!prefs.steps || !this.engine.running) return
    const outdoor = lightingOf(this.zone).place === 'outdoor'
    let surface = surfaceAt(this.zone, x, y)
    if (outdoor && weather.snow >= 0.6 && (surface === 'grass' || surface === 'dirt' || surface === 'sand')) surface = 'snow'
    this.stepSide = -this.stepSide
    this.steps.play(surface, prefs.steps * (running ? 0.9 : 0.7), this.stepSide * 0.08, outdoor && weather.rain > 0.2)
  }

  destroy() {
    for (const l of this.layers.values()) l.destroy()
    this.layers.clear()
  }
}

/** Que chão está sob os pés: tapete/moldura por cima, senão o terreno do vértice mais perto. */
export function surfaceAt(zone: ZoneData, x: number, y: number): Surface {
  const vx = Math.max(0, Math.min(zone.width, Math.round(x / TILE)))
  const vy = Math.max(0, Math.min(zone.height, Math.round(y / TILE)))
  const over = overlayTerrain(zone, vx, vy)
  if (over && /tapete|rug/i.test(over.label + over.category)) return 'rug'
  return surfaceOf(cornerTerrain(zone, vx, vy))
}

/** O timbre de cada terreno, pelo nome/categoria. */
export function surfaceOf(t: TerrainDef): Surface {
  const s = `${t.id} ${t.label} ${t.category}`.toLowerCase()
  if (/neve|snow/.test(s)) return 'snow'
  if (/areia|sand/.test(s)) return 'sand'
  if (/swamp|p[âa]ntano|água rasa|water/.test(s)) return 'water'
  if (/tapete|rug/.test(s)) return 'rug'
  if (/cascalho|gravel|pedrinha|pebble/.test(s)) return 'gravel'
  if (/madeira|wood|tábua/.test(s)) return 'wood'
  if (/pedra|stone|calçamento|cobble|ladrilho|tile|castelo|masmorra|mármore|piso/.test(s)) return 'stone'
  if (/grama|grass|trigo|capim|musgo/.test(s)) return 'grass'
  return 'dirt'
}

