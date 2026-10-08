// ────────────────────────────────────────────────────────
// Motor de som (Web Audio). Os sons são GRAVAÇÕES livres (public/assets/
// audio, créditos em credits/CREDITS-audio.txt), baixadas só quando tocam
// pela primeira vez e guardadas decodificadas.
//
// Usa o AudioContext do Phaser (ele já destrava o som no primeiro clique).
// Saída: tudo passa por `master`; o que manda para `reverbSend` ganha eco
// (sala pequena dentro de casa, eco longo em cavernas).
// ────────────────────────────────────────────────────────

import Phaser from 'phaser'
import { readPrefs, writePrefs } from './prefs'

export type Room = 'none' | 'room' | 'cave'

const engines = new WeakMap<Phaser.Game, AudioEngine | null>()
let base = './assets/'

/** Onde ficam os assets (mountVortable avisa). */
export function setAudioBase(assetBase: string) {
  base = assetBase
}

/** Um som carregado e os pontos de laço (sem o silêncio que o MP3 põe nas pontas). */
export interface Clip { buffer: AudioBuffer; start: number; end: number }

export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  /** Entrada sem eco (cada som decide quanto manda pro eco também). */
  readonly dry: GainNode
  readonly reverbSend: GainNode
  private reverb: ConvolverNode
  private room: Room = 'none'
  private irs = new Map<Room, AudioBuffer>()
  private clips = new Map<string, Promise<Clip | null>>()

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

  /** Carrega (uma vez) audio/<nome>.mp3. null = não deu (sem rede, arquivo faltando). */
  clip(name: string): Promise<Clip | null> {
    let p = this.clips.get(name)
    if (!p) {
      p = fetch(`${base}audio/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => ({ buffer, ...edges(buffer) }))
        .catch((err) => {
          console.warn('[vortable] som não carregou:', name, err)
          return null
        })
      this.clips.set(name, p)
    }
    return p
  }

  /** Toca um som uma vez. */
  play(clip: Clip, dest: AudioNode, volume = 1, rate = 1, at = this.now) {
    const src = this.ctx.createBufferSource()
    src.buffer = clip.buffer
    src.playbackRate.value = rate
    const g = this.gain(volume)
    src.connect(g)
    g.connect(dest)
    src.start(at, clip.start)
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

/** Onde o som começa e acaba de verdade (o MP3 põe um pouco de silêncio nas pontas). */
function edges(b: AudioBuffer) {
  const d = b.getChannelData(0), limit = 0.0008
  let i = 0, j = d.length - 1
  while (i < d.length - 1 && Math.abs(d[i]) < limit) i++
  while (j > i && Math.abs(d[j]) < limit) j--
  return { start: i / b.sampleRate, end: (j + 1) / b.sampleRate }
}

export { readPrefs, writePrefs }
