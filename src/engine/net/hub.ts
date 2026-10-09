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
//   npcmove   {zone, id, x, y, dir}    o mestre largou um NPC que controlava: ele fica nesse ponto
//   env       {zone, hour, weather, wind}   o mestre muda hora/tempo/vento ao vivo
//                                      (zone '*' = todas as zonas; null = o padrão da zona)
//
// O NetHub guarda quem está na sala. Ele vive fora da cena: trocar de zona
// reinicia a cena, mas ninguém some da lista.
// ────────────────────────────────────────────────────────

import type { Appearance, Dir } from '../types'

export type NetAnim = 'idle' | 'walk' | 'run'

/**
 * `npc`: NPC que o mestre está controlando (id `npc:<id do NPC>`). Aparece como um jogador, mas o NPC
 * parado da zona some enquanto isso, e o nome só aparece se `showName`.
 */
export interface NetHello { t: 'hello'; id: string; name: string; appearance: Appearance; npc?: boolean; showName?: boolean }
export interface NetNpcMove { t: 'npcmove'; zone: string; id: string; x: number; y: number; dir: Dir }
/** Prefixo do id de um NPC controlado pelo mestre na rede. */
export const NPC_PEER = 'npc:'
export interface NetState { t: 'state'; id: string; zone: string; x: number; y: number; dir: Dir; anim: NetAnim }
/** Sons ao vivo do mestre: `auto` = as camadas seguem o mundo; `layers` = camadas postas à mão (volume 0–1). */
export interface LiveSound { auto: boolean; layers: Record<string, number> }
export interface NetEnv { t: 'env'; zone: string; hour: number | null; weather: string | null; wind: number | null; sound?: LiveSound | null; dayMinutes?: number | null }
/** Reações que o espectador pode mandar. */
export const REACTIONS = ['👏', '😮', '😂', '❤️', '🔥', '🎉', '😱', '🤔'] as const
export interface NetReact { t: 'react'; id: string; name: string; emoji: string; zone: string; x: number; y: number }
export type NetMsg =
  | NetEnv
  | NetNpcMove
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
      return {
        t: 'hello', id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 60) : 'Jogador', appearance: a,
        ...(m.id.startsWith(NPC_PEER) ? { npc: true, showName: m.showName === true } : {}),
      }
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
        sound: parseLiveSound(m.sound),
        dayMinutes: num(m.dayMinutes) && m.dayMinutes >= 1 && m.dayMinutes <= 1440 ? m.dayMinutes : null,
      }
    case 'react':
      if (typeof m.id !== 'string' || typeof m.zone !== 'string' || !num(m.x) || !num(m.y)) return null
      if (typeof m.emoji !== 'string' || !(REACTIONS as readonly string[]).includes(m.emoji)) return null
      return { t: 'react', id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 60) : '', emoji: m.emoji, zone: m.zone, x: m.x, y: m.y }
    case 'npcmove':
      if (typeof m.zone !== 'string' || typeof m.id !== 'string' || !num(m.x) || !num(m.y)) return null
      return { t: 'npcmove', zone: m.zone.slice(0, 80), id: m.id.slice(0, 80), x: m.x, y: m.y, dir: DIRS.includes(m.dir as Dir) ? (m.dir as Dir) : 'down' }
    case 'teleport':
      return typeof m.zone === 'string' && num(m.x) && num(m.y) ? { t: 'teleport', zone: m.zone, x: m.x, y: m.y } : null
    default: return null
  }
}

/** Confere os sons ao vivo vindos da rede (camadas desconhecidas ou volumes fora de 0–1 não passam). */
function parseLiveSound(raw: unknown): LiveSound | null {
  const s = raw as { auto?: unknown; layers?: unknown } | null
  if (!s || typeof s !== 'object') return null
  const layers: Record<string, number> = {}
  if (s.layers && typeof s.layers === 'object') {
    for (const [k, v] of Object.entries(s.layers as Record<string, unknown>).slice(0, 24)) {
      if (/^[a-z]{2,16}$/.test(k) && num(v) && v > 0) layers[k] = Math.min(1, v)
    }
  }
  return { auto: s.auto !== false, layers }
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
  private npcMoves = new Set<(m: NetNpcMove) => void>()
  /** NPCs que ESTE mestre está controlando agora (vistos pela sala como jogadores). */
  private hosted = new Map<string, NetHello>()
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

  /** Mestre: começa a controlar um NPC (a sala o vê como um jogador de id `npc:<id>`). */
  hostNpc(npc: { id: string; name: string; appearance: Appearance; showName: boolean }) {
    const hello: NetHello = { t: 'hello', id: NPC_PEER + npc.id, name: npc.name, appearance: npc.appearance, npc: true, showName: npc.showName }
    this.hosted.set(hello.id, hello)
    this.link.send(hello)
  }

  /** Mestre: largou o NPC (some da sala como jogador). */
  unhostNpc(peerId: string) {
    if (this.hosted.delete(peerId)) this.link.send({ t: 'bye', id: peerId })
  }

  /** Mestre: o NPC largado fica neste ponto (todos atualizam o NPC parado da zona). */
  moveNpc(m: Omit<NetNpcMove, 't'>) {
    this.link.send({ t: 'npcmove', ...m })
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
    for (const h of this.hosted.values()) this.link.send(h)
    if (!this.hello) { this.link.send({ t: 'who' }); return }
    this.link.send(this.hello)
    this.link.send({ t: 'who' })
  }

  /** Saindo: avisa e esquece todo mundo. */
  leave() {
    for (const id of [...this.hosted.keys()]) this.unhostNpc(id)
    this.link.send({ t: 'bye', id: this.link.selfId })
    this.peers.clear()
    this.envs.clear()
    this.roster.clear()
    this.teleports.clear()
    this.zoneChanges.clear()
    this.reactions.clear()
    this.npcMoves.clear()
  }

  /** Chegou uma mensagem da rede. */
  receive(raw: unknown) {
    const msg = parseNet(raw)
    if (!msg) return
    switch (msg.t) {
      case 'who':
        if (this.hello) this.link.send(this.hello)
        for (const h of this.hosted.values()) this.link.send(h)
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
      case 'npcmove':
        this.npcMoves.forEach((fn) => fn(msg))
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

  /** O mestre largou um NPC num ponto novo. */
  onNpcMove(fn: (m: NetNpcMove) => void) {
    this.npcMoves.add(fn)
    return () => { this.npcMoves.delete(fn) }
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
