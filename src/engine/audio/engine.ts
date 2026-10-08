// ────────────────────────────────────────────────────────
// Motor de som. Tudo é SINTETIZADO no navegador (Web Audio): ruídos
// filtrados (chuva, vento, mar, fogo), osciladores (pássaros, grilos,
// coruja, gotas) e rajadas curtas (passos). Nada pra baixar, nenhuma
// licença, e cada som sai um pouco diferente do anterior.
//
// Usa o AudioContext do Phaser (ele já destrava o som no primeiro clique).
// Saída: tudo passa por `master`; o que manda para `reverbSend` ganha eco
// (sala pequena dentro de casa, eco longo em cavernas).
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { readPrefs, writePrefs } from './prefs'

export type NoiseKind = 'white' | 'pink' | 'brown'
export type Room = 'none' | 'room' | 'cave'

const engines = new WeakMap<Phaser.Game, AudioEngine | null>()

export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  /** Entrada sem eco (cada som decide quanto manda pro eco também). */
  readonly dry: GainNode
  readonly reverbSend: GainNode
  private reverb: ConvolverNode
  private room: Room = 'none'
  private noises = new Map<NoiseKind, AudioBuffer>()
  private irs = new Map<Room, AudioBuffer>()

  /** O motor do jogo (um por jogo); null se o navegador não tem Web Audio. */
  static of(scene: Phaser.Scene): AudioEngine | null {
    const game = scene.game
    if (engines.has(game)) return engines.get(game)!
    const sm = scene.sound as Phaser.Sound.WebAudioSoundManager
    const ctx = (sm as unknown as { context?: AudioContext }).context
    const engine = ctx ? new AudioEngine(ctx) : null
    engines.set(game, engine)
    return engine
  }

  private constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.dry = ctx.createGain()
    this.dry.connect(this.master)
    this.reverb = ctx.createConvolver()
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0
    this.reverbSend.connect(this.reverb)
    this.reverb.connect(this.master)
    this.applyPrefs()
  }

  get now() {
    return this.ctx.currentTime
  }

  /** Som destravado e tocando (o navegador só deixa depois de um clique/tecla). */
  get running() {
    return this.ctx.state === 'running'
  }

  applyPrefs() {
    const p = readPrefs()
    this.master.gain.setTargetAtTime(p.muted ? 0 : p.master, this.now, 0.05)
  }

  /** Eco do lugar: nenhum (ao ar livre), sala, caverna. */
  setRoom(room: Room) {
    if (room === this.room) return
    this.room = room
    if (room !== 'none') this.reverb.buffer = this.ir(room)
    this.reverbSend.gain.setTargetAtTime(room === 'none' ? 0 : room === 'room' ? 0.35 : 0.8, this.now, 0.3)
  }

  /** Resposta de eco gerada: ruído que se apaga (curto na sala, longo na caverna). */
  private ir(room: Room) {
    const cached = this.irs.get(room)
    if (cached) return cached
    const sr = this.ctx.sampleRate
    const len = Math.floor(sr * (room === 'cave' ? 2.8 : 0.7))
    const buf = this.ctx.createBuffer(2, len, sr)
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, room === 'cave' ? 2.2 : 3.5)
    }
    this.irs.set(room, buf)
    return buf
  }

  /** 4 s de ruído (branco, rosa, marrom), gerados uma vez e tocados em laço. */
  noise(kind: NoiseKind) {
    const cached = this.noises.get(kind)
    if (cached) return cached
    const sr = this.ctx.sampleRate, len = sr * 4
    const buf = this.ctx.createBuffer(1, len, sr)
    const d = buf.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      if (kind === 'white') d[i] = w * 0.5
      else if (kind === 'pink') {
        // filtro de Paul Kellet
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
      } else {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      }
    }
    // emenda o fim no começo (laço sem estalo)
    const fade = Math.floor(sr * 0.05)
    for (let i = 0; i < fade; i++) d[len - fade + i] *= 1 - i / fade
    this.noises.set(kind, buf)
    return buf
  }

  /** Fonte de ruído em laço, começando num ponto qualquer (camadas iguais não ficam em fase). */
  loop(kind: NoiseKind, rate = 1) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise(kind)
    src.loop = true
    src.playbackRate.value = rate
    src.start(this.now, Math.random() * 3.5)
    return src
  }

  /** Um trecho curto de ruído (passos, estalos, trovão). */
  burst(kind: NoiseKind, at: number, dur: number) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise(kind)
    src.start(at, Math.random() * 3.5, dur + 0.05)
    return src
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  gain(v = 0) {
    const g = this.ctx.createGain()
    g.gain.value = v
    return g
  }

  /** Liga em série: a → b → c ... e devolve o último. */
  chain(...nodes: AudioNode[]) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    return nodes[nodes.length - 1]
  }

  /** Saída de um som: seco no master e uma parte no eco. */
  out(node: AudioNode, reverb = 0.5, pan = 0) {
    let last: AudioNode = node
    if (pan) {
      const p = this.ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      last.connect(p)
      last = p
    }
    last.connect(this.dry)
    if (reverb > 0) {
      const s = this.gain(reverb)
      last.connect(s)
      s.connect(this.reverbSend)
    }
  }
}

export { readPrefs, writePrefs }
