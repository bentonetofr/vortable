// ────────────────────────────────────────────────────────
// Camadas de som ambiente: gravações em laço (floresta, chuva, mar...) com
// um volume que desliza até o alvo. O arquivo só é baixado quando a camada
// toca pela primeira vez. A floresta troca sozinha entre o dia (pássaros)
// e a noite (grilos). Trovões são toques soltos, não laço.
// ────────────────────────────────────────────────────────

import type { AudioEngine, Clip } from './engine'

export type LayerId =
  | 'forest' | 'spooky' | 'wind' | 'rain' | 'storm' | 'thunder' | 'snow'
  | 'stream' | 'lake' | 'waterfall' | 'swamp' | 'sea' | 'cave' | 'fire' | 'torch'

/** Camadas do painel, na ordem em que aparecem; `icon` = nome no ICONS do editor. */
export const LAYERS: { id: LayerId; label: string; icon: string }[] = [
  { id: 'forest', label: 'Floresta', icon: 'tree' },
  { id: 'spooky', label: 'Sombria', icon: 'ghost' },
  { id: 'wind', label: 'Vento', icon: 'wind' },
  { id: 'rain', label: 'Chuva', icon: 'rain' },
  { id: 'storm', label: 'Tempestade', icon: 'storm' },
  { id: 'thunder', label: 'Trovões', icon: 'zap' },
  { id: 'snow', label: 'Neve', icon: 'blizzard' },
  { id: 'stream', label: 'Riacho', icon: 'waves' },
  { id: 'lake', label: 'Lago', icon: 'droplet' },
  { id: 'waterfall', label: 'Cachoeira', icon: 'waterfall' },
  { id: 'swamp', label: 'Pântano', icon: 'sprout' },
  { id: 'sea', label: 'Mar', icon: 'sea' },
  { id: 'cave', label: 'Caverna', icon: 'mountain' },
  { id: 'fire', label: 'Fogueira', icon: 'flame' },
  { id: 'torch', label: 'Tocha', icon: 'torch' },
]

/** Arquivo de cada camada (audio/amb/<nome>.mp3); a floresta tem dois (dia e noite). */
const FILES: Record<Exclude<LayerId, 'thunder'>, string[]> = {
  forest: ['amb/forest-day', 'amb/forest-night'],
  spooky: ['amb/spooky'], wind: ['amb/wind'], rain: ['amb/rain'], storm: ['amb/storm'], snow: ['amb/snow'],
  stream: ['amb/stream'], lake: ['amb/lake'], waterfall: ['amb/waterfall'], swamp: ['amb/swamp'], sea: ['amb/sea'],
  cave: ['amb/cave'], fire: ['amb/fire'], torch: ['amb/torch'],
}

export interface LayerFrame {
  /** Volume alvo (0–1). */
  level: number
  /** Dia (1) ou noite (0): a floresta troca de gravação. */
  day: number
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
  private sources: AudioBufferSourceNode[] = []
  /** Volume de cada gravação da camada (floresta: dia e noite). */
  private parts: GainNode[] = []
  private current = 0
  private nextThunder = rand(4, 12)
  private thunder?: Clip | null
  /** Nível de agora (pro painel mostrar). */
  level = 0

  constructor(private e: AudioEngine, readonly id: LayerId) {}

  /** Monta os nós e começa os laços (assim que os arquivos chegarem). */
  private build() {
    const e = this.e
    this.out = e.gain(0)
    this.muffle = e.filter('lowpass', 18000, 0.5)
    this.panner = e.ctx.createStereoPanner()
    this.out.connect(this.muffle)
    this.muffle.connect(this.panner)
    e.out(this.panner, this.id === 'cave' ? 0.6 : 0.12)
    if (this.id === 'thunder') {
      e.clip('fx/thunder').then((c) => (this.thunder = c))
      return
    }
    for (const name of FILES[this.id]) {
      const part = e.gain(name.endsWith('night') ? 0 : 1)
      part.connect(this.out)
      this.parts.push(part)
      e.clip(name).then((clip) => {
        if (!clip || !this.out) return
        const src = e.ctx.createBufferSource()
        src.buffer = clip.buffer
        src.loop = true
        src.loopStart = clip.start
        src.loopEnd = clip.end
        src.connect(part)
        // começa num ponto qualquer: duas zonas com a mesma camada não ficam iguais
        src.start(e.now, clip.start + Math.random() * (clip.end - clip.start - 1))
        this.sources.push(src)
      })
    }
  }

  /** Um trovão agora: perto (0) é forte e agudo; longe (1) é fraco e grave. */
  strike(distance: number, volume = 1) {
    if (!this.out) this.build()
    const play = (clip: Clip | null | undefined) => {
      if (!clip || !this.muffle) return
      const lp = this.e.filter('lowpass', 9000 - distance * 8000, 0.5)
      lp.connect(this.muffle)
      this.e.play(clip, lp, volume * (1 - distance * 0.55), rand(0.82, 1.08) - distance * 0.12)
    }
    if (this.thunder !== undefined) play(this.thunder)
    else this.e.clip('fx/thunder').then(play)
  }

  update(dt: number, f: LayerFrame) {
    const e = this.e
    // desliza até o alvo (sem estalo ao ligar/desligar)
    this.current += (f.level - this.current) * Math.min(1, dt * 1.2)
    if (Math.abs(this.current - f.level) < 0.002) this.current = f.level
    this.level = this.current
    if (!this.out) {
      if (f.level <= 0.001) return
      this.build()
    }
    const now = e.now
    // trovões soltos: a camada só decide quando trovejar; o volume de cada um é fixo
    this.out!.gain.setTargetAtTime(this.id === 'thunder' ? 1 : this.current, now, 0.15)
    this.muffle!.frequency.setTargetAtTime(f.muffled ? 700 : 18000, now, 0.3)
    this.panner!.pan.setTargetAtTime(f.pan, now, 0.3)
    if (this.id === 'forest' && this.parts.length === 2) {
      // dia: pássaros; noite: grilos (troca no entardecer)
      this.parts[0].gain.setTargetAtTime(f.day, now, 1)
      this.parts[1].gain.setTargetAtTime(1 - f.day, now, 1)
    }
    if (this.id === 'thunder' && this.current > 0.01 && e.running) {
      this.nextThunder -= dt
      if (this.nextThunder <= 0) {
        this.nextThunder = rand(10, 28) / Math.max(0.3, this.current)
        this.strike(rand(0.5, 0.95), this.current)
      }
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
