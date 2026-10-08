// ────────────────────────────────────────────────────────
// Rede do Vortable, do lado do motor. O motor não sabe COMO as mensagens
// viajam (WebRTC no Vorterium, BroadcastChannel no teste): quem monta o jogo
// entrega um NetLink com `send`, e chama `handle.receive(msg)` pro que chega.
//
//   hello     {id, name, appearance}   quem sou eu (ao entrar, ao trocar de boneco, e em resposta a "who")
//   who       {}                       "quem está aí?" (recém-chegado) → todos respondem hello
//   state     {id, zone, x, y, dir, anim}   onde estou (≈10×/s)
//   bye       {id}                     saí
//   teleport  {zone, x, y}             o mestre leva ESTE jogador pra outro lugar
//   zone      {id}                     o mestre salvou esta zona: quem está nela recarrega
//   react     {id, name, emoji, zone, x, y}   reação de um espectador (um emoji que sobe no ponto x,y da zona)
//   env       {zone, hour, weather, wind}   o mestre muda hora/tempo/vento ao vivo
//                                      (zone '*' = todas as zonas; null = o padrão da zona)
//
// O NetHub guarda quem está na sala. Ele vive fora da cena: trocar de zona
// reinicia a cena, mas ninguém some da lista.
// ────────────────────────────────────────────────────────

import type { Appearance, Dir } from '../types'

export type NetAnim = 'idle' | 'walk' | 'run'

export interface NetHello { t: 'hello'; id: string; name: string; appearance: Appearance }
export interface NetState { t: 'state'; id: string; zone: string; x: number; y: number; dir: Dir; anim: NetAnim }
export interface NetEnv { t: 'env'; zone: string; hour: number | null; weather: string | null; wind: number | null }
/** Reações que o espectador pode mandar. */
export const REACTIONS = ['👏', '😮', '😂', '❤️', '🔥', '🎉', '😱', '🤔'] as const
export interface NetReact { t: 'react'; id: string; name: string; emoji: string; zone: string; x: number; y: number }
export type NetMsg =
  | NetEnv
  | NetReact
  | { t: 'zone'; id: string }
  | NetHello
  | { t: 'who' }
  | NetState
  | { t: 'bye'; id: string }
  | { t: 'teleport'; zone: string; x: number; y: number }

export interface NetLink {
  /** Id deste jogador na rede (único na sala). */
  selfId: string
  /** Pode ser um getter: o nome é lido a cada anúncio. */
  name: string
  /** Manda uma mensagem pra sala; a ponte decide quem recebe. */
  send(msg: NetMsg): void
}

export interface NetPeer {
  hello: NetHello
  state: NetState | null
}

const DIRS: Dir[] = ['up', 'left', 'down', 'right']
const ANIMS: NetAnim[] = ['idle', 'walk', 'run']
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Confere o que chegou da rede: devolve a mensagem limpa ou null. */
export function parseNet(raw: unknown): NetMsg | null {
  const m = raw as Record<string, unknown> | null
  if (!m || typeof m !== 'object') return null
  switch (m.t) {
    case 'hello': {
      const a = m.appearance as Appearance | undefined
      if (typeof m.id !== 'string' || !m.id || !a || a.version !== 2 || typeof a.slots !== 'object') return null
      return { t: 'hello', id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 60) : 'Jogador', appearance: a }
    }
    case 'who': return { t: 'who' }
    case 'state':
      if (typeof m.id !== 'string' || typeof m.zone !== 'string' || !num(m.x) || !num(m.y)) return null
      return {
        t: 'state', id: m.id, zone: m.zone, x: m.x, y: m.y,
        dir: DIRS.includes(m.dir as Dir) ? (m.dir as Dir) : 'down',
        anim: ANIMS.includes(m.anim as NetAnim) ? (m.anim as NetAnim) : 'idle',
      }
    case 'bye': return typeof m.id === 'string' ? { t: 'bye', id: m.id } : null
    case 'zone': return typeof m.id === 'string' && m.id ? { t: 'zone', id: m.id.slice(0, 80) } : null
    case 'env':
      if (typeof m.zone !== 'string' || !m.zone) return null
      return {
        t: 'env', zone: m.zone.slice(0, 80),
        hour: num(m.hour) ? Math.min(24, Math.max(0, m.hour)) : null,
        weather: typeof m.weather === 'string' ? m.weather.slice(0, 20) : null,
        wind: num(m.wind) ? Math.min(1, Math.max(0, m.wind)) : null,
      }
    case 'react':
      if (typeof m.id !== 'string' || typeof m.zone !== 'string' || !num(m.x) || !num(m.y)) return null
      if (typeof m.emoji !== 'string' || !(REACTIONS as readonly string[]).includes(m.emoji)) return null
      return { t: 'react', id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 60) : '', emoji: m.emoji, zone: m.zone, x: m.x, y: m.y }
    case 'teleport':
      return typeof m.zone === 'string' && num(m.x) && num(m.y) ? { t: 'teleport', zone: m.zone, x: m.x, y: m.y } : null
    default: return null
  }
}

export class NetHub {
  readonly peers = new Map<string, NetPeer>()
  /** Hora/tempo/vento do mestre, por zona ('*' = todas). */
  readonly envs = new Map<string, NetEnv>()
  /** Mudou quem está na sala (entrou, saiu, trocou de boneco). */
  private roster = new Set<() => void>()
  private zoneChanges = new Set<(id: string) => void>()
  private teleports = new Set<(m: { zone: string; x: number; y: number }) => void>()
  private reactions = new Set<(m: NetReact) => void>()
  private hello: NetHello | null = null
  private asked = false

  constructor(readonly link: NetLink) {}

  /** Diz pra sala quem eu sou (e, na primeira vez, pede que todos digam quem são). */
  announce(appearance: Appearance) {
    this.hello = { t: 'hello', id: this.link.selfId, name: this.link.name, appearance }
    this.link.send(this.hello)
    if (!this.asked) {
      this.asked = true
      this.link.send({ t: 'who' })
    }
  }

  /** Observador (a câmera do mestre): só pergunta quem está na sala, sem aparecer. */
  observe() {
    this.link.send({ t: 'who' })
  }

  /** Mestre: muda hora/tempo/vento ao vivo (vale pra mim e pra sala). */
  setEnv(env: Omit<NetEnv, 't'>) {
    const msg: NetEnv = { t: 'env', ...env }
    this.envs.set(msg.zone, msg)
    this.link.send(msg)
  }

  /** O que vale numa zona: o ajuste dela, senão o de todas. */
  envFor(zoneId: string): NetEnv | null {
    return this.envs.get(zoneId) ?? this.envs.get('*') ?? null
  }

  /** O nome mudou (o NetLink.name é lido de novo): reanuncia o mesmo boneco com o nome novo. */
  rename() {
    if (this.hello) this.announce(this.hello.appearance)
  }

  /** A rede acabou de abrir (ou reabriu): conta quem sou e pergunta quem está aí. */
  resync() {
    // observador (mestre ou espectador): sem boneco, só pergunta quem está na sala
    if (!this.hello) { this.link.send({ t: 'who' }); return }
    this.link.send(this.hello)
    this.link.send({ t: 'who' })
  }

  /** Saindo: avisa e esquece todo mundo. */
  leave() {
    this.link.send({ t: 'bye', id: this.link.selfId })
    this.peers.clear()
    this.envs.clear()
    this.roster.clear()
    this.teleports.clear()
    this.zoneChanges.clear()
    this.reactions.clear()
  }

  /** Chegou uma mensagem da rede. */
  receive(raw: unknown) {
    const msg = parseNet(raw)
    if (!msg) return
    switch (msg.t) {
      case 'who':
        if (this.hello) this.link.send(this.hello)
        break
      case 'hello': {
        if (msg.id === this.link.selfId) break
        const prev = this.peers.get(msg.id)
        this.peers.set(msg.id, { hello: msg, state: prev?.state ?? null })
        this.roster.forEach((fn) => fn())
        break
      }
      case 'state': {
        if (msg.id === this.link.selfId) break
        const peer = this.peers.get(msg.id)
        // sem hello ainda: não sabemos o boneco; pede de novo e espera
        if (!peer) { this.link.send({ t: 'who' }); break }
        peer.state = msg
        break
      }
      case 'bye':
        if (this.peers.delete(msg.id)) this.roster.forEach((fn) => fn())
        break
      case 'teleport':
        this.teleports.forEach((fn) => fn(msg))
        break
      case 'react':
        this.reactions.forEach((fn) => fn(msg))
        break
      case 'env':
        this.envs.set(msg.zone, msg)
        break
      case 'zone':
        this.zoneChanges.forEach((fn) => fn(msg.id))
        break
    }
  }

  onRoster(fn: () => void) {
    this.roster.add(fn)
    return () => { this.roster.delete(fn) }
  }

  /** O mestre salvou uma zona (o jogo recarrega se for a que está aberta). */
  onZoneChanged(fn: (id: string) => void) {
    this.zoneChanges.add(fn)
    return () => { this.zoneChanges.delete(fn) }
  }

  /** Chegou uma reação (de um espectador) pra mostrar no mapa. */
  onReact(fn: (m: NetReact) => void) {
    this.reactions.add(fn)
    return () => { this.reactions.delete(fn) }
  }

  /** Manda uma reação (de espectador) no ponto dado; também aparece pra quem mandou. */
  react(emoji: string, zone: string, x: number, y: number) {
    if (!(REACTIONS as readonly string[]).includes(emoji)) return
    const msg: NetReact = { t: 'react', id: this.link.selfId, name: this.link.name, emoji, zone, x: Math.round(x), y: Math.round(y) }
    this.link.send(msg)
    this.reactions.forEach((fn) => fn(msg))
  }

  onTeleport(fn: (m: { zone: string; x: number; y: number }) => void) {
    this.teleports.add(fn)
    return () => { this.teleports.delete(fn) }
  }
}
