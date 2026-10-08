// ────────────────────────────────────────────────────────
// Passos gravados, um conjunto por tipo de chão (audio/steps/<chão>-N.mp3).
// Cada passo sorteia uma das gravações e varia um pouco a altura e o volume.
// Chãos sem gravação própria usam a mais parecida com um filtro (terra =
// cascalho abafado; areia = neve mais aguda).
// ────────────────────────────────────────────────────────

import type { AudioEngine, Clip } from './engine'
import { brownNoise, softRugStep } from './rugstep'

export type Surface = 'grass' | 'dirt' | 'sand' | 'gravel' | 'snow' | 'stone' | 'wood' | 'rug' | 'water'

export const SURFACE_LABELS: Record<Surface, string> = {
  grass: 'Grama', dirt: 'Terra', sand: 'Areia', gravel: 'Cascalho', snow: 'Neve', stone: 'Pedra', wood: 'Madeira', rug: 'Tapete', water: 'Água',
}

/** Gravações e como tocar cada chão. */
const KIT: Record<Surface, { set: string; n: number; gain: number; rate?: number; lowpass?: number; highpass?: number }> = {
  grass: { set: 'grass', n: 5, gain: 0.9 },
  dirt: { set: 'gravel', n: 8, gain: 0.6, lowpass: 1600, rate: 0.9 },
  sand: { set: 'snow', n: 5, gain: 0.55, rate: 1.25, highpass: 900 },
  gravel: { set: 'gravel', n: 8, gain: 0.75 },
  snow: { set: 'snow', n: 5, gain: 0.9 },
  stone: { set: 'concrete', n: 5, gain: 0.8 },
  wood: { set: 'wood', n: 5, gain: 0.85 },
  rug: { set: 'carpet', n: 0, gain: 1 }, // sem gravação: o tapete é sintetizado (rugstep.ts)
  water: { set: 'water', n: 5, gain: 0.8 },
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class Steps {
  private clips = new Map<string, Clip[]>()
  private last = new Map<string, number>()
  private noise: AudioBuffer | null = null

  constructor(private e: AudioEngine) {
    // todas as gravações de passos (são pequenas): prontas antes do primeiro passo
    for (const set of new Set(Object.values(KIT).map((k) => k.set))) {
      const n = Math.max(...Object.values(KIT).filter((k) => k.set === set).map((k) => k.n))
      Promise.all(Array.from({ length: n }, (_, i) => e.clip(`steps/${set}-${i}`))).then((list) => {
        this.clips.set(set, list.filter((c): c is Clip => !!c))
      })
    }
  }

  /** Um passo. `wet` = chão molhado (chuva): um respingo leve junto. */
  play(surface: Surface, volume: number, pan = 0, wet = false) {
    if (surface === 'rug') return this.playRug(volume, pan, wet)
    const k = KIT[surface]
    const list = this.clips.get(k.set)
    if (!list?.length) return
    // nunca a mesma gravação duas vezes seguidas
    let i = Math.floor(Math.random() * list.length)
    if (list.length > 1 && i === this.last.get(k.set)) i = (i + 1) % list.length
    this.last.set(k.set, i)
    const e = this.e
    let dest: AudioNode = e.dry
    const p = e.ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(dest)
    dest = p
    if (k.lowpass) { const f = e.filter('lowpass', k.lowpass); f.connect(dest); dest = f }
    if (k.highpass) { const f = e.filter('highpass', k.highpass); f.connect(dest); dest = f }
    // um pouco do passo vai pro eco (salas, cavernas)
    const send = e.gain(0.4)
    p.connect(send)
    send.connect(e.reverbSend)
    e.play(list[i], dest, volume * k.gain * rand(0.8, 1), (k.rate ?? 1) * rand(0.93, 1.07))
    if (wet && surface !== 'water') {
      const water = this.clips.get('water')
      if (water?.length) e.play(water[Math.floor(Math.random() * water.length)], p, volume * 0.22, rand(1.1, 1.3))
    }
  }

  /** Tapete: passo macio sintetizado (calcanhar + ponta do pé), com um fiozinho de eco. */
  private playRug(volume: number, pan: number, wet: boolean) {
    const e = this.e
    this.noise ??= brownNoise(e.ctx)
    const p = e.ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(e.dry)
    const send = e.gain(0.3)
    p.connect(send)
    send.connect(e.reverbSend)
    softRugStep(e.ctx, p, this.noise, e.now, volume)
    if (wet) {
      const water = this.clips.get('water')
      if (water?.length) e.play(water[Math.floor(Math.random() * water.length)], p, volume * 0.22, rand(1.1, 1.3))
    }
  }
}
