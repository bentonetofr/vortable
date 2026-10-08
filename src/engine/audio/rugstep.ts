// ────────────────────────────────────────────────────────
// Passo no tapete, sintetizado: um "fof" macio (calcanhar) seguido de um toque
// mais leve (ponta do pé), sem estalo nenhum. Três camadas:
//   • batida grave — seno que desce de ~110 Hz a ~55 Hz (o peso do pé afundando)
//   • almofada — ruído marrom filtrado em ~600 Hz (o corpo abafado do tapete)
//   • fibra — um fiapo de ruído agudo e baixinho (o roçar do tecido)
// Tudo com subida suave (10–14 ms) e queda longa, e valores sorteados a cada passo.
// A gravação antiga (Kenney) era brilhante (≈2–3 kHz) e de ataque seco: cansava.
// ────────────────────────────────────────────────────────

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Meio segundo de ruído marrom (graves fortes, agudos fracos), feito uma vez. */
export function brownNoise(ctx: BaseAudioContext) {
  const len = Math.floor(ctx.sampleRate * 0.5)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last * 3.5
  }
  return buf
}

/** Uma batida: `weight` 1 = calcanhar, menos = ponta do pé. */
function thud(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, at: number, weight: number, tone: number) {
  // corpo grave
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(110 * tone, at)
  osc.frequency.exponentialRampToValueAtTime(55 * tone, at + 0.11)
  const og = ctx.createGain()
  og.gain.setValueAtTime(0, at)
  og.gain.linearRampToValueAtTime(0.55 * weight, at + 0.012)
  og.gain.exponentialRampToValueAtTime(0.001, at + 0.17)
  osc.connect(og).connect(dest)
  osc.start(at)
  osc.stop(at + 0.2)

  // almofada do tapete
  const body = ctx.createBufferSource()
  body.buffer = noise
  body.playbackRate.value = rand(0.9, 1.1)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = rand(520, 700) * tone
  lp.Q.value = 0.5
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 70
  const bg = ctx.createGain()
  bg.gain.setValueAtTime(0, at)
  bg.gain.linearRampToValueAtTime(0.9 * weight, at + 0.014)
  bg.gain.exponentialRampToValueAtTime(0.001, at + 0.16)
  body.connect(lp).connect(hp).connect(bg).connect(dest)
  body.start(at, rand(0, 0.25))
  body.stop(at + 0.2)

  // fibras do tecido: bem baixinho, só pra não ficar "de borracha"
  const fib = ctx.createBufferSource()
  fib.buffer = noise
  fib.playbackRate.value = 2.4
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = rand(1800, 2600)
  bp.Q.value = 0.7
  const fg = ctx.createGain()
  fg.gain.setValueAtTime(0, at + 0.006)
  fg.gain.linearRampToValueAtTime(0.14 * weight, at + 0.024)
  fg.gain.exponentialRampToValueAtTime(0.001, at + 0.11)
  fib.connect(bp).connect(fg).connect(dest)
  fib.start(at, rand(0, 0.25))
  fib.stop(at + 0.14)
}

/** Toca um passo no tapete em `dest` (calcanhar e, logo depois, a ponta do pé). */
export function softRugStep(ctx: BaseAudioContext, dest: AudioNode, noise: AudioBuffer, when: number, volume: number) {
  const out = ctx.createGain()
  out.gain.value = volume * 1.0
  out.connect(dest)
  const tone = rand(0.9, 1.12)
  thud(ctx, out, noise, when, rand(0.85, 1), tone)
  thud(ctx, out, noise, when + rand(0.06, 0.085), rand(0.3, 0.42), tone * 1.12)
}
