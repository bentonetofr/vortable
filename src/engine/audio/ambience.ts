// ────────────────────────────────────────────────────────
// Camadas de som ambiente. Cada uma é um "leito" contínuo (ruído filtrado)
// e/ou eventos sorteados (pássaro, grilo, gota, estalo, trovão), com um
// volume que desliza até o alvo. Os nós só são criados quando a camada
// toca pela primeira vez.
// ────────────────────────────────────────────────────────

import type { AudioEngine } from './engine'
import { birdSong, crackle, cricket, drip, owl, thunder } from './synths'

export type LayerId = 'forest' | 'wind' | 'rain' | 'thunder' | 'snow' | 'water' | 'sea' | 'cave' | 'fire'

export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: 'forest', label: 'Floresta', hint: 'De dia, pássaros e folhas; à noite, grilos e uma coruja de vez em quando' },
  { id: 'wind', label: 'Vento', hint: 'Sopro que sobe nas rajadas (assobia na ventania)' },
  { id: 'rain', label: 'Chuva', hint: 'Chiado da chuva e pingos; mais forte na tempestade' },
  { id: 'thunder', label: 'Trovões', hint: 'Trovões rolando ao longe (mesmo sem chuva). Na tempestade, cada relâmpago troveja' },
  { id: 'snow', label: 'Neve', hint: 'Vento frio e abafado de dia de neve' },
  { id: 'water', label: 'Riacho', hint: 'Água correndo e borbulhando' },
  { id: 'sea', label: 'Mar', hint: 'Ondas indo e voltando' },
  { id: 'cave', label: 'Caverna', hint: 'Zumbido grave, gotas pingando e eco' },
  { id: 'fire', label: 'Fogueira', hint: 'Fogo crepitando' },
]

export interface LayerFrame {
  /** Volume alvo (0–1). */
  level: number
  /** Dia (1) ou noite (0) — muda os bichos da floresta. */
  day: number
  /** Força do vento (0–1). */
  wind: number
  /** De que lado está (−1 esquerda, 1 direita): fogo e água perto. */
  pan: number
  /** Abafado (dentro de casa ouvindo a chuva lá fora). */
  muffled: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Layer {
  private out?: GainNode
  private muffle?: BiquadFilterNode
  private panner?: StereoPannerNode
  private sources: AudioScheduledSourceNode[] = []
  private params: Record<string, AudioParam> = {}
  private timers: Record<string, number> = {}
  private current = 0
  private time = 0
  private crickets = [rand(0, 1), rand(0, 1), rand(0, 1), rand(0, 1)].map((t, i) => ({ t, f: 4100 + i * 170 + rand(-40, 40), pan: rand(-0.8, 0.8) }))
  /** Nível de agora (pro painel mostrar). */
  level = 0

  constructor(private e: AudioEngine, readonly id: LayerId) {}

  /** Monta os nós na primeira vez que a camada toca. */
  private build() {
    const e = this.e
    this.out = e.gain(0)
    this.muffle = e.filter('lowpass', 18000, 0.5)
    this.panner = e.ctx.createStereoPanner()
    this.out.connect(this.muffle)
    this.muffle.connect(this.panner)
    const reverb = { cave: 1, water: 0.2, thunder: 0.4, fire: 0.25 }[this.id as string] ?? 0.15
    e.out(this.panner, reverb)
    const bed = (kind: 'white' | 'pink' | 'brown', gain: number, ...filters: BiquadFilterNode[]) => {
      const src = e.loop(kind, rand(0.97, 1.03))
      const g = e.gain(gain)
      e.chain(src, ...filters, g, this.out!)
      this.sources.push(src)
      return { g, filters }
    }
    switch (this.id) {
      case 'forest': {
        const leaves = bed('pink', 0.05, e.filter('bandpass', 3000, 0.6))
        this.params.leaves = leaves.g.gain
        break
      }
      case 'wind': {
        const body = bed('pink', 0.55, e.filter('bandpass', 500, 0.6))
        this.params.windFreq = body.filters[0].frequency
        this.params.windGain = body.g.gain
        const whistle = bed('white', 0, e.filter('bandpass', 1100, 9))
        this.params.whistleFreq = whistle.filters[0].frequency
        this.params.whistle = whistle.g.gain
        break
      }
      case 'rain':
        bed('white', 0.28, e.filter('highpass', 900), e.filter('lowpass', 7000))
        bed('brown', 0.5, e.filter('lowpass', 450))
        break
      case 'snow': {
        bed('brown', 0.5, e.filter('lowpass', 260))
        const gust = bed('pink', 0.12, e.filter('bandpass', 650, 0.5))
        this.params.snowGust = gust.g.gain
        break
      }
      case 'water': {
        const a = bed('white', 0.2, e.filter('bandpass', 1100, 0.9))
        const b = bed('white', 0.12, e.filter('bandpass', 2300, 1.6))
        this.params.waterA = a.filters[0].frequency
        this.params.waterB = b.filters[0].frequency
        break
      }
      case 'sea': {
        const swell = bed('brown', 0.7, e.filter('lowpass', 650))
        const foam = bed('white', 0, e.filter('highpass', 1800), e.filter('lowpass', 6000))
        this.params.swell = swell.g.gain
        this.params.foam = foam.g.gain
        break
      }
      case 'cave':
        bed('brown', 0.35, e.filter('lowpass', 110))
        break
      case 'fire':
        bed('brown', 0.3, e.filter('lowpass', 320))
        break
    }
  }

  /** Um trovão agora (relâmpago da tempestade, ou o botão de ouvir). */
  strike(distance: number, volume = 1) {
    if (!this.out) this.build()
    thunder(this.e, this.muffle!, volume * Math.max(this.current, 0.6), distance)
  }

  update(dt: number, f: LayerFrame) {
    const e = this.e
    this.time += dt
    // desliza até o alvo (sem estalo ao ligar/desligar)
    this.current += (f.level - this.current) * Math.min(1, dt * 1.5)
    if (Math.abs(this.current - f.level) < 0.002) this.current = f.level
    this.level = this.current
    if (!this.out) {
      if (f.level <= 0.001) return
      this.build()
    }
    const now = e.now
    const v = this.current
    this.out!.gain.setTargetAtTime(v, now, 0.1)
    this.muffle!.frequency.setTargetAtTime(f.muffled ? 650 : 18000, now, 0.3)
    this.panner!.pan.setTargetAtTime(f.pan, now, 0.2)
    if (v <= 0.002 || !e.running) return

    const every = (key: string, min: number, max: number) => {
      this.timers[key] = (this.timers[key] ?? rand(0, max)) - dt
      if (this.timers[key] > 0) return false
      this.timers[key] = rand(min, max)
      return true
    }
    const dest = this.muffle!
    switch (this.id) {
      case 'forest': {
        this.params.leaves.setTargetAtTime(0.03 + 0.08 * f.wind, now, 0.5)
        if (f.day > 0.3 && every('bird', 0.6 / f.day, 3.2 / f.day)) birdSong(e, dest, 0.9 * f.day, rand(-0.8, 0.8))
        if (f.day < 0.5) {
          const night = 1 - f.day * 2
          for (const c of this.crickets) {
            c.t -= dt
            if (c.t > 0) continue
            c.t = rand(0.55, 1.1)
            cricket(e, dest, night, c.pan, c.f)
          }
          if (every('owl', 22, 50)) owl(e, dest, night, rand(-0.7, 0.7))
        }
        break
      }
      case 'wind': {
        // sobe e desce sozinho (rajadas), mais agudo e forte com vento forte
        const g = 0.5 + 0.5 * Math.sin(this.time * 0.37) * Math.sin(this.time * 0.13 + 1)
        this.params.windFreq.setTargetAtTime(300 + 500 * f.wind * (0.5 + g), now, 0.4)
        this.params.windGain.setTargetAtTime((0.25 + 0.75 * f.wind) * (0.55 + 0.45 * g), now, 0.4)
        this.params.whistle.setTargetAtTime(f.wind > 0.6 ? (f.wind - 0.6) * 0.25 * g : 0, now, 0.5)
        this.params.whistleFreq.setTargetAtTime(900 + 700 * g, now, 0.5)
        break
      }
      case 'rain':
        // pingos estalando perto (telhado, folhas)
        for (let n = Math.floor(rand(0, 1) + dt * 18 * v); n > 0; n--) crackle(e, dest, 0.18 * v)
        break
      case 'thunder':
        if (every('roll', 9, 26)) thunder(e, dest, v, rand(0.55, 0.95))
        break
      case 'snow':
        this.params.snowGust.setTargetAtTime(0.06 + 0.2 * f.wind * (0.5 + 0.5 * Math.sin(this.time * 0.5)), now, 0.6)
        break
      case 'water':
        // borbulha: as faixas do chiado pulam de um tom pro outro
        if (every('bubble', 0.06, 0.16)) {
          this.params.waterA.setTargetAtTime(rand(800, 1500), now, 0.03)
          this.params.waterB.setTargetAtTime(rand(1800, 3000), now, 0.03)
        }
        break
      case 'sea': {
        // onda a cada ~8 s: cresce, quebra (espuma) e volta
        const phase = (this.time / 8) % 1
        const wave = Math.pow(Math.sin(phase * Math.PI), 2)
        this.params.swell.setTargetAtTime(0.25 + 0.75 * wave, now, 0.3)
        this.params.foam.setTargetAtTime(phase > 0.4 && phase < 0.65 ? 0.18 * wave : 0, now, 0.15)
        break
      }
      case 'cave':
        if (every('drip', 0.8, 3.5)) drip(e, dest, 0.8, rand(-0.8, 0.8))
        break
      case 'fire':
        for (let n = Math.floor(rand(0, 1) + dt * 14); n > 0; n--) crackle(e, dest, 0.7)
        break
    }
  }

  destroy() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // já parou
      }
    }
    this.sources = []
    this.panner?.disconnect()
    this.out = undefined
  }
}
