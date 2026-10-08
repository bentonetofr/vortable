// ────────────────────────────────────────────────────────
// Sons curtos sintetizados: pássaros, grilo, coruja, trovão, gota de
// caverna, estalo de fogo e os passos (um timbre por tipo de chão). Cada
// chamada sorteia um pouco a altura, o tempo e o lado — nada se repete igual.
// ────────────────────────────────────────────────────────

import type { AudioEngine } from './engine'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Envelope: sobe em `attack`, segura e cai até zero em `decay` (exponencial). */
function env(g: GainNode, at: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
}

/** Nota de oscilador com glissando (pássaros, gotas, coruja). */
function tone(e: AudioEngine, dest: AudioNode, at: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine', attack = 0.006) {
  const o = e.ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, at)
  o.frequency.exponentialRampToValueAtTime(f1, at + dur)
  const g = e.gain(0)
  env(g, at, peak, attack, dur)
  o.connect(g)
  g.connect(dest)
  o.start(at)
  o.stop(at + attack + dur + 0.05)
  return o
}

// ── natureza ──

/** Canto de um pássaro (três jeitos diferentes). */
export function birdSong(e: AudioEngine, dest: AudioNode, volume: number, pan: number) {
  const out = e.gain(volume)
  const p = e.ctx.createStereoPanner()
  p.pan.value = pan
  out.connect(p)
  p.connect(dest)
  let t = e.now + 0.02
  const kind = Math.floor(Math.random() * 3)
  if (kind === 0) {
    // pardal: notinhas rápidas subindo
    const f = rand(3200, 4800), n = 3 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) {
      tone(e, out, t, f * rand(0.92, 1.05), f * rand(1.15, 1.35), rand(0.035, 0.06), 0.25)
      t += rand(0.07, 0.11)
    }
  } else if (kind === 1) {
    // assobio: duas notas longas que deslizam
    const f = rand(1800, 2600)
    tone(e, out, t, f, f * rand(1.2, 1.4), rand(0.18, 0.28), 0.18, 'sine', 0.03)
    t += rand(0.3, 0.42)
    tone(e, out, t, f * rand(1.25, 1.45), f * rand(0.95, 1.1), rand(0.2, 0.3), 0.16, 'sine', 0.03)
  } else {
    // trinado: uma nota tremendo rápido (modulação)
    const o = e.ctx.createOscillator(), m = e.ctx.createOscillator(), md = e.gain(rand(400, 700)), g = e.gain(0)
    o.frequency.value = rand(3000, 4200)
    m.frequency.value = rand(40, 70)
    m.connect(md)
    md.connect(o.frequency)
    o.connect(g)
    g.connect(out)
    const d = rand(0.4, 0.8)
    env(g, t, 0.14, 0.04, d)
    o.start(t); m.start(t)
    o.stop(t + d + 0.1); m.stop(t + d + 0.1)
  }
}

/** Grilo: três pulsos curtinhos numa nota aguda. */
export function cricket(e: AudioEngine, dest: AudioNode, volume: number, pan: number, freq: number) {
  const p = e.ctx.createStereoPanner()
  p.pan.value = pan
  p.connect(dest)
  let t = e.now + 0.01
  const pulses = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < pulses; i++) {
    tone(e, p, t, freq, freq * 0.99, 0.022, volume * 0.12, 'triangle', 0.004)
    t += 0.045
  }
}

/** Coruja: "hu... huu". */
export function owl(e: AudioEngine, dest: AudioNode, volume: number, pan: number) {
  const lp = e.filter('lowpass', 900)
  const p = e.ctx.createStereoPanner()
  p.pan.value = pan
  lp.connect(p)
  p.connect(dest)
  let t = e.now + 0.05
  const f = rand(360, 440)
  tone(e, lp, t, f * 1.05, f, 0.22, volume * 0.35, 'sine', 0.06)
  t += 0.5
  tone(e, lp, t, f * 1.08, f * 0.92, 0.5, volume * 0.4, 'sine', 0.08)
}

/** Gota caindo numa poça (caverna, masmorra). */
export function drip(e: AudioEngine, dest: AudioNode, volume: number, pan: number) {
  const p = e.ctx.createStereoPanner()
  p.pan.value = pan
  p.connect(dest)
  const f = rand(1500, 2600)
  tone(e, p, e.now + 0.01, f, f * 0.5, 0.09, volume * 0.35, 'sine', 0.002)
}

/** Estalo de lenha queimando. */
export function crackle(e: AudioEngine, dest: AudioNode, volume: number) {
  const t = e.now + rand(0, 0.03)
  const src = e.burst('white', t, 0.03)
  const hp = e.filter('highpass', rand(1500, 3500))
  const g = e.gain(0)
  env(g, t, volume * rand(0.15, 0.6), 0.001, rand(0.004, 0.02))
  e.chain(src, hp, g, dest)
}

/**
 * Trovão: estalo seco (se perto) e um ronco que rola e some. `distance`
 * 0 = em cima, 1 = longe (mais grave, mais fraco, sem estalo).
 */
export function thunder(e: AudioEngine, dest: AudioNode, volume: number, distance: number) {
  const t = e.now + 0.02
  const len = rand(4, 7)
  const lp = e.filter('lowpass', 2400 * (1 - distance) + 260, 0.5)
  lp.frequency.setValueAtTime(lp.frequency.value, t)
  lp.frequency.exponentialRampToValueAtTime(110, t + len)
  const g = e.gain(0)
  // ronco: várias ondas que crescem e somem (sorteadas)
  const n = 64, curve = new Float32Array(n)
  let swell = 0
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    if (Math.random() < 0.18) swell = rand(0.4, 1)
    swell *= 0.9
    curve[i] = (x < 0.04 ? x / 0.04 : Math.pow(1 - x, 1.6)) * (0.45 + swell * 0.55) * volume * (1 - distance * 0.55)
  }
  curve[n - 1] = 0
  g.gain.setValueCurveAtTime(curve, t, len)
  const src = e.burst('brown', t, len)
  e.chain(src, lp, g, dest)
  if (distance < 0.45) {
    // o estalo do raio perto
    const c = e.burst('white', t, 0.25)
    const cg = e.gain(0)
    env(cg, t, volume * 0.5 * (1 - distance), 0.002, 0.22)
    e.chain(c, e.filter('lowpass', 5000), cg, dest)
  }
}

// ── passos ──

export type Surface = 'grass' | 'dirt' | 'sand' | 'gravel' | 'snow' | 'stone' | 'wood' | 'rug' | 'water'

export const SURFACE_LABELS: Record<Surface, string> = {
  grass: 'Grama', dirt: 'Terra', sand: 'Areia', gravel: 'Cascalho', snow: 'Neve', stone: 'Pedra', wood: 'Madeira', rug: 'Tapete', water: 'Água rasa',
}

/** Rajadas curtinhas de ruído numa janela (crocante: neve, cascalho, grama seca). */
function grains(e: AudioEngine, dest: AudioNode, at: number, n: number, span: number, peak: number) {
  for (let i = 0; i < n; i++) {
    const t = at + Math.random() * span
    const g = e.gain(0)
    env(g, t, peak * rand(0.4, 1), 0.001, rand(0.004, 0.012))
    e.chain(e.burst('white', t, 0.02), g, dest)
  }
}

/** Um passo no chão dado. `volume` 0–1; `pan` −1 a 1. */
export function footstep(e: AudioEngine, dest: AudioNode, surface: Surface, volume: number, pan = 0, wet = false) {
  const out = e.gain(volume)
  const p = e.ctx.createStereoPanner()
  p.pan.value = pan
  out.connect(p)
  p.connect(dest)
  const t = e.now + 0.005
  const k = rand(0.9, 1.1)
  const noise = (kind: 'white' | 'pink' | 'brown', dur: number, peak: number, attack: number, ...filters: BiquadFilterNode[]) => {
    const g = e.gain(0)
    env(g, t, peak, attack, dur)
    e.chain(e.burst(kind, t, dur + attack), ...filters, g, out)
  }
  switch (surface) {
    case 'grass':
      // folhagem amassando: chiado macio em duas camadas
      noise('pink', 0.09, 0.5, 0.012, e.filter('bandpass', 2600 * k, 0.7), e.filter('highpass', 700))
      grains(e, out, t + 0.01, 5, 0.06, 0.12)
      break
    case 'dirt':
      noise('brown', 0.07, 0.8, 0.004, e.filter('lowpass', 700 * k))
      noise('pink', 0.05, 0.25, 0.004, e.filter('bandpass', 1400 * k, 0.8))
      break
    case 'sand':
      noise('white', 0.12, 0.22, 0.02, e.filter('bandpass', 3800 * k, 0.6))
      noise('brown', 0.06, 0.4, 0.008, e.filter('lowpass', 500))
      break
    case 'gravel':
      grains(e, out, t, 14, 0.09, 0.35)
      noise('brown', 0.06, 0.5, 0.004, e.filter('lowpass', 600))
      break
    case 'snow': {
      // neve: crocante abafado
      const lp = e.filter('lowpass', 3200 * k)
      lp.connect(out)
      grains(e, lp, t, 18, 0.13, 0.4)
      noise('brown', 0.1, 0.35, 0.02, e.filter('lowpass', 400))
      break
    }
    case 'stone':
      // salto na pedra: clique seco + um "toc" curto
      noise('white', 0.018, 0.35, 0.001, e.filter('highpass', 2200 * k))
      tone(e, out, t, 1500 * k, 1300 * k, 0.035, 0.07, 'triangle', 0.001)
      noise('brown', 0.04, 0.4, 0.002, e.filter('lowpass', 500))
      break
    case 'wood':
      // tábua: batida oca
      tone(e, out, t, 170 * k, 120 * k, 0.09, 0.45, 'sine', 0.002)
      noise('pink', 0.05, 0.35, 0.002, e.filter('bandpass', 750 * k, 2.2))
      noise('white', 0.012, 0.1, 0.001, e.filter('highpass', 3000))
      break
    case 'rug':
      noise('brown', 0.06, 0.35, 0.01, e.filter('lowpass', 420 * k))
      break
    case 'water': {
      // respingo: chiado que desce
      const bp = e.filter('bandpass', 2600 * k, 1.1)
      bp.frequency.setValueAtTime(2600 * k, t)
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.16)
      noise('white', 0.17, 0.45, 0.006, bp)
      tone(e, out, t + 0.03, 900 * k, 500 * k, 0.06, 0.05, 'sine', 0.003)
      break
    }
  }
  // chão molhado (chuva): um respingo leve junto
  if (wet && surface !== 'water' && surface !== 'rug' && surface !== 'wood') {
    noise('white', 0.08, 0.12, 0.004, e.filter('bandpass', 1800 * k, 1))
  }
}
